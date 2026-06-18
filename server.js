const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const http = require('http');
const open = require('open');

const app = express();
const PORT = process.env.PORT || 3000;
const isDev = process.argv.includes('--dev');

app.use(cors());
app.use(express.json());

// Serving frontend assets
if (!isDev) {
  app.use(express.static(path.join(__dirname, 'frontend', 'dist')));
}

// In-memory state
let buildState = {
  status: 'idle', // idle, downloading, compiling_deps, cloning, configuring, building, success, failed
  currentTask: '',
  progress: 0,
  os: process.platform, // win32, linux, darwin
  arch: process.arch,
  dependencies: {
    git: { installed: false, version: '', path: '' },
    cmake: { installed: false, version: '', path: '', portable: false },
    compiler: { installed: false, version: '', type: '', path: '' },
    boost: { installed: false, path: '', portable: false },
    openssl: { installed: false, path: '', portable: false },
    mariadb: { installed: false, path: '', portable: false }
  }
};

let logBuffer = [];
const sseClients = new Set();
let activeProcess = null;

// Broadcast state update to all SSE clients
function broadcastStatus() {
  const statusEvent = `event: status\ndata: ${JSON.stringify(buildState)}\n\n`;
  sseClients.forEach(client => client.write(statusEvent));
}

// Log function that broadcasts to clients
function logToConsole(message, type = 'info') {
  const logEntry = {
    timestamp: new Date().toLocaleTimeString(),
    type, // info, stdout, stderr, success, error, system
    text: message
  };
  logBuffer.push(logEntry);
  if (logBuffer.length > 5000) {
    logBuffer.shift();
  }
  
  // Broadcast to all active Server-Sent Events streams
  const sseData = `data: ${JSON.stringify(logEntry)}\n\n`;
  sseClients.forEach(client => client.write(sseData));
}

// Helper: Run command as child process with live logs
function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    logToConsole(`Running command: ${command} ${args.join(' ')}`, 'system');
    
    // Default working directory to app root
    const cwd = options.cwd || __dirname;
    if (!fs.existsSync(cwd)) {
      fs.mkdirSync(cwd, { recursive: true });
    }
    
    // Set custom env if needed (like adding portable cmake to PATH)
    const env = { ...process.env, ...options.env };
    
    activeProcess = spawn(command, args, { cwd, env, shell: false });
    
    activeProcess.stdout.on('data', (data) => {
      const text = data.toString();
      text.split('\n').forEach(line => {
        if (line.trim()) logToConsole(line, 'stdout');
      });
    });
    
    activeProcess.stderr.on('data', (data) => {
      const text = data.toString();
      text.split('\n').forEach(line => {
        if (line.trim()) logToConsole(line, 'stderr');
      });
    });
    
    activeProcess.on('close', (code) => {
      activeProcess = null;
      if (code === 0) {
        logToConsole(`Command completed successfully.`, 'success');
        resolve();
      } else {
        logToConsole(`Command exited with code ${code}.`, 'error');
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });
    
    activeProcess.on('error', (err) => {
      activeProcess = null;
      logToConsole(`Process error: ${err.message}`, 'error');
      reject(err);
    });
  });
}

// Helper: Recursively search for a file in directory
function findFileRecursive(dir, filename) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch (e) {
      continue;
    }
    if (stat.isDirectory()) {
      const found = findFileRecursive(filePath, filename);
      if (found) return found;
    } else if (file.toLowerCase() === filename.toLowerCase()) {
      return filePath;
    }
  }
  return null;
}

// Find portable CMake path
function getPortableCMakePath() {
  const cmakeDir = path.join(__dirname, 'deps', 'cmake');
  if (!fs.existsSync(cmakeDir)) return null;
  const binaryName = process.platform === 'win32' ? 'cmake.exe' : 'cmake';
  
  try {
    const folders = fs.readdirSync(cmakeDir);
    const v4Dir = folders.find(f => f.includes('4.3.3'));
    if (v4Dir) {
      const found = findFileRecursive(path.join(cmakeDir, v4Dir), binaryName);
      if (found) return found;
    }
  } catch (e) {
    // Ignore and fallback
  }
  
  return findFileRecursive(cmakeDir, binaryName);
}

// Find portable vcpkg path
function getPortableVcpkgPath() {
  const vcpkgDir = path.join(__dirname, 'deps', 'vcpkg');
  const binaryName = process.platform === 'win32' ? 'vcpkg.exe' : 'vcpkg';
  return findFileRecursive(vcpkgDir, binaryName);
}

// Run dependency check
async function checkDependencies() {
  logToConsole('Checking system dependencies...', 'system');
  
  // 1. Check Git
  await new Promise((resolve) => {
    exec('git --version', (err, stdout) => {
      if (!err && stdout) {
        buildState.dependencies.git.installed = true;
        buildState.dependencies.git.version = stdout.trim();
        buildState.dependencies.git.path = 'System Path';
      } else {
        buildState.dependencies.git.installed = false;
        buildState.dependencies.git.version = '';
      }
      resolve();
    });
  });

  // 2. Check CMake
  const portableCMake = getPortableCMakePath();
  if (portableCMake) {
    await new Promise((resolve) => {
      exec(`"${portableCMake}" --version`, (err, stdout) => {
        if (!err && stdout) {
          buildState.dependencies.cmake.installed = true;
          buildState.dependencies.cmake.version = stdout.split('\n')[0].trim();
          buildState.dependencies.cmake.path = portableCMake;
          buildState.dependencies.cmake.portable = true;
        }
        resolve();
      });
    });
  } else {
    await new Promise((resolve) => {
      exec('cmake --version', (err, stdout) => {
        if (!err && stdout) {
          buildState.dependencies.cmake.installed = true;
          buildState.dependencies.cmake.version = stdout.split('\n')[0].trim();
          buildState.dependencies.cmake.path = 'System Path';
          buildState.dependencies.cmake.portable = false;
        } else {
          buildState.dependencies.cmake.installed = false;
          buildState.dependencies.cmake.version = '';
        }
        resolve();
      });
    });
  }

  // 3. Check C++ Compiler
  if (process.platform === 'win32') {
    // Check for VS Build Tools / VS Community using vswhere
    const vswherePath = path.join(
      process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      'Microsoft Visual Studio',
      'Installer',
      'vswhere.exe'
    );
    
    if (fs.existsSync(vswherePath)) {
      await new Promise((resolve) => {
        exec(`"${vswherePath}" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`, (err, stdout) => {
          if (!err && stdout && stdout.trim()) {
            const vsPath = stdout.trim();
            buildState.dependencies.compiler.installed = true;
            buildState.dependencies.compiler.type = 'MSVC (Visual Studio)';
            buildState.dependencies.compiler.path = vsPath;
            if (vsPath.includes('\\18\\') || vsPath.toLowerCase().includes('2026')) {
              buildState.dependencies.compiler.version = 'Visual Studio 2026';
            } else if (vsPath.includes('\\2022\\') || vsPath.includes('\\17\\') || vsPath.includes('\\17.0\\')) {
              buildState.dependencies.compiler.version = 'Visual Studio 2022';
            } else if (vsPath.includes('\\2019\\') || vsPath.includes('\\16\\')) {
              buildState.dependencies.compiler.version = 'Visual Studio 2019';
            } else if (vsPath.includes('\\2017\\') || vsPath.includes('\\15\\')) {
              buildState.dependencies.compiler.version = 'Visual Studio 2017';
            } else {
              buildState.dependencies.compiler.version = 'Visual Studio (Detected)';
            }
          } else {
            buildState.dependencies.compiler.installed = false;
          }
          resolve();
        });
      });
    } else {
      buildState.dependencies.compiler.installed = false;
    }
  } else {
    // Linux/macOS compilers
    await new Promise((resolve) => {
      exec('g++ --version', (err, stdout) => {
        if (!err && stdout) {
          buildState.dependencies.compiler.installed = true;
          buildState.dependencies.compiler.type = 'GCC';
          buildState.dependencies.compiler.version = stdout.split('\n')[0].trim();
          buildState.dependencies.compiler.path = '/usr/bin/g++';
        } else {
          exec('clang++ --version', (err2, stdout2) => {
            if (!err2 && stdout2) {
              buildState.dependencies.compiler.installed = true;
              buildState.dependencies.compiler.type = 'Clang';
              buildState.dependencies.compiler.version = stdout2.split('\n')[0].trim();
              buildState.dependencies.compiler.path = '/usr/bin/clang++';
            } else {
              buildState.dependencies.compiler.installed = false;
            }
            resolve();
          });
          return;
        }
        resolve();
      });
    });
  }

  // 4. Check vcpkg libraries (Boost, OpenSSL, MariaDB)
  const vcpkgInstalledDir = path.join(__dirname, 'deps', 'vcpkg', 'installed');
  if (fs.existsSync(vcpkgInstalledDir)) {
    // Check if libraries actually exist in vcpkg installed directory
    const folders = fs.readdirSync(vcpkgInstalledDir);
    const hasTarget = folders.some(f => f.includes('x64-windows') || f.includes('x64-linux') || f.includes('x64-osx') || f.includes('arm64-osx'));
    
    if (hasTarget) {
      // Find the specific target directory (e.g. x64-windows)
      const targetSubdir = folders.find(f => f.includes('x64-windows') || f.includes('x64-linux') || f.includes('x64-osx') || f.includes('arm64-osx'));
      const targetPath = path.join(vcpkgInstalledDir, targetSubdir);
      
      // Check OpenSSL
      const hasOpenSSL = fs.existsSync(path.join(targetPath, 'include', 'openssl'));
      buildState.dependencies.openssl.installed = hasOpenSSL;
      buildState.dependencies.openssl.path = hasOpenSSL ? path.join(targetPath, 'include', 'openssl') : '';
      buildState.dependencies.openssl.portable = hasOpenSSL;

      // Check Boost
      const hasBoost = fs.existsSync(path.join(targetPath, 'include', 'boost'));
      buildState.dependencies.boost.installed = hasBoost;
      buildState.dependencies.boost.path = hasBoost ? path.join(targetPath, 'include') : '';
      buildState.dependencies.boost.portable = hasBoost;

      // Check MariaDB / MySQL connector
      const hasMariaDB = fs.existsSync(path.join(targetPath, 'include', 'mysql')) || fs.existsSync(path.join(targetPath, 'include', 'mariadb'));
      buildState.dependencies.mariadb.installed = hasMariaDB;
      buildState.dependencies.mariadb.path = hasMariaDB ? targetPath : '';
      buildState.dependencies.mariadb.portable = hasMariaDB;
    }
  } else {
    // Check system paths (only as fallback if not portable)
    buildState.dependencies.openssl.installed = false;
    buildState.dependencies.boost.installed = false;
    buildState.dependencies.mariadb.installed = false;
  }

  logToConsole('Dependency scan complete.', 'success');
}

// Download Helper
function downloadFile(url, destPath) {
  return new Promise(async (resolve, reject) => {
    logToConsole(`Downloading package from: ${url}`, 'info');
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      
      const fileStream = fs.createWriteStream(destPath);
      const reader = response.body.getReader();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fileStream.write(Buffer.from(value));
      }
      
      fileStream.end();
      fileStream.on('finish', () => resolve());
      fileStream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

// Express Endpoints

// 1. Get status & configuration
app.get('/api/status', async (req, res) => {
  res.json(buildState);
});

// 2. Clear logs
app.post('/api/clear-logs', (req, res) => {
  logBuffer = [];
  res.json({ success: true });
});

// 3. Trigger Dependency Scan
app.post('/api/check-deps', async (req, res) => {
  await checkDependencies();
  res.json(buildState);
});

// 4. Cancel active process
app.post('/api/cancel', (req, res) => {
  if (activeProcess) {
    logToConsole('Cancelling current operation by user request...', 'system');
    
    // On Windows, killing process group is safer
    if (process.platform === 'win32') {
      exec(`taskkill /pid ${activeProcess.pid} /T /F`);
    } else {
      activeProcess.kill('SIGINT');
    }
    
    buildState.status = 'idle';
    buildState.currentTask = 'Cancelled';
    res.json({ success: true, message: 'Operation cancelled.' });
  } else {
    res.json({ success: false, message: 'No active operation to cancel.' });
  }
});

// 5. Install System Compiler
app.post('/api/install-compiler', async (req, res) => {
  if (buildState.status !== 'idle') {
    return res.status(400).json({ error: 'Another task is currently running.' });
  }

  buildState.status = 'downloading';
  buildState.currentTask = 'Installing Compiler';
  res.json({ success: true });

  try {
    if (process.platform === 'win32') {
      logToConsole('Launching winget compiler installation. Requires system confirmation...', 'system');
      await runCommand('winget', [
        'install', '--id', 'Microsoft.VisualStudio.2022.BuildTools',
        '--override', '"--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive --norestart"'
      ]);
    } else if (process.platform === 'darwin') {
      logToConsole('Launching Apple command line tools install dialog...', 'system');
      await runCommand('xcode-select', ['--install']);
    } else {
      logToConsole('Compiler installation on Linux must be done via sudo. Run:', 'info');
      logToConsole('sudo apt-get update && sudo apt-get install -y build-essential gcc g++', 'info');
      throw new Error('Linux automatic compiler installation is not supported due to permissions. Use copy-paste commands.');
    }
    buildState.status = 'idle';
    buildState.currentTask = 'Compiler Install Succeeded';
    await checkDependencies();
    broadcastStatus();
  } catch (err) {
    buildState.status = 'failed';
    buildState.currentTask = 'Compiler Install Failed';
    logToConsole(`Compiler installation error: ${err.message}`, 'error');
    broadcastStatus();
  }
});

// 6. Setup Portable Dependencies (CMake, vcpkg, boost, openssl, mariadb)
app.post('/api/setup-portable-deps', async (req, res) => {
  if (buildState.status !== 'idle') {
    return res.status(400).json({ error: 'Another task is currently running.' });
  }

  buildState.status = 'downloading';
  buildState.currentTask = 'Setting up Portable dependencies';
  res.json({ success: true });

  const depsDir = path.join(__dirname, 'deps');
  const downloadsDir = path.join(depsDir, 'downloads');
  const cmakeDestDir = path.join(depsDir, 'cmake');
  
  try {
    // Step 1: Ensure directories exist
    fs.mkdirSync(downloadsDir, { recursive: true });
    fs.mkdirSync(cmakeDestDir, { recursive: true });

    // Step 2: Download portable CMake if not installed
    const hasCMake = getPortableCMakePath();
    let needNewCMake = false;

    // Visual Studio 2026 requires CMake 4.2+ (we download 4.3.3)
    if (hasCMake && buildState.dependencies.compiler.version.includes('2026')) {
      const cmakeVer = buildState.dependencies.cmake.version;
      if (cmakeVer && (cmakeVer.startsWith('cmake version 3') || cmakeVer.startsWith('3.'))) {
        needNewCMake = true;
        logToConsole('Detected Visual Studio 2026, but the local CMake version is 3.x. Upgrading to v4.3.3...', 'warning');
        try {
          fs.rmSync(cmakeDestDir, { recursive: true, force: true });
          fs.mkdirSync(cmakeDestDir, { recursive: true });
        } catch (e) {
          logToConsole(`Failed to delete old CMake folder: ${e.message}`, 'error');
        }
      }
    }

    if (!hasCMake || needNewCMake) {
      logToConsole('Downloading Portable CMake v4.3.3...', 'system');
      let cmakeUrl = '';
      let archiveName = '';
      
      if (process.platform === 'win32') {
        cmakeUrl = 'https://github.com/Kitware/CMake/releases/download/v4.3.3/cmake-4.3.3-windows-x86_64.zip';
        archiveName = 'cmake.zip';
      } else if (process.platform === 'darwin') {
        cmakeUrl = 'https://github.com/Kitware/CMake/releases/download/v4.3.3/cmake-4.3.3-macos-universal.tar.gz';
        archiveName = 'cmake.tar.gz';
      } else {
        cmakeUrl = 'https://github.com/Kitware/CMake/releases/download/v4.3.3/cmake-4.3.3-linux-x86_64.tar.gz';
        archiveName = 'cmake.tar.gz';
      }

      const archivePath = path.join(downloadsDir, archiveName);
      await downloadFile(cmakeUrl, archivePath);
      logToConsole('Extracting portable CMake...', 'system');
      
      await runCommand('tar', ['-xf', archivePath, '-C', cmakeDestDir]);
      logToConsole('CMake extraction completed.', 'success');
    } else {
      logToConsole('Portable CMake already present. Skipping download.', 'success');
    }

    // Step 3: Clone & Bootstrap vcpkg
    buildState.status = 'compiling_deps';
    buildState.currentTask = 'Bootstrapping vcpkg';
    const vcpkgDir = path.join(depsDir, 'vcpkg');
    
    if (!fs.existsSync(vcpkgDir)) {
      logToConsole('Cloning vcpkg repository...', 'system');
      await runCommand('git', ['clone', 'https://github.com/microsoft/vcpkg.git', vcpkgDir]);
    } else {
      logToConsole('vcpkg repository already cloned. Updating...', 'system');
      await runCommand('git', ['pull'], { cwd: vcpkgDir });
    }

    const vcpkgExe = getPortableVcpkgPath();
    if (!vcpkgExe) {
      logToConsole('Bootstrapping vcpkg (compiling vcpkg tool)...', 'system');
      if (process.platform === 'win32') {
        await runCommand('cmd.exe', ['/c', 'bootstrap-vcpkg.bat'], { cwd: vcpkgDir });
      } else {
        await runCommand('sh', ['bootstrap-vcpkg.sh'], { cwd: vcpkgDir });
      }
    } else {
      logToConsole('vcpkg executable already built.', 'success');
    }

    // Step 4: Run vcpkg install for libraries
    logToConsole('Installing libraries (OpenSSL, Boost sub-packages, MariaDB client) via vcpkg...', 'system');
    
    const vcpkgBinary = getPortableVcpkgPath();
    const triple = process.platform === 'win32' ? 'x64-windows' : 
                   process.platform === 'darwin' ? 'x64-osx' : 'x64-linux';
                   
    // Install target libraries (vcpkg will cache these)
    // Installing specific libraries reduces compile time drastically
    const packagesToInstall = [
      `openssl:${triple}`,
      `libmysql:${triple}`,
      `boost-system:${triple}`,
      `boost-filesystem:${triple}`,
      `boost-thread:${triple}`,
      `boost-program-options:${triple}`,
      `boost-regex:${triple}`,
      `boost-asio:${triple}`,
      `boost-iostreams:${triple}`,
      `boost-date-time:${triple}`,
      `boost-chrono:${triple}`,
      `boost-process:${triple}`,
      `boost-dll:${triple}`,
      `boost-heap:${triple}`,
      `boost-stacktrace:${triple}`,
      `boost-lexical-cast:${triple}`,
      `boost-container:${triple}`,
      `boost-smart-ptr:${triple}`,
      `boost-iterator:${triple}`,
      `boost-bind:${triple}`,
      `boost-functional:${triple}`,
      `boost-preprocessor:${triple}`,
      `boost-algorithm:${triple}`,
      `boost-core:${triple}`
    ];
    
    await runCommand(vcpkgBinary, ['install', ...packagesToInstall], { cwd: vcpkgDir });
    
    buildState.status = 'idle';
    buildState.currentTask = 'Portable Dependencies Ready';
    await checkDependencies();
    broadcastStatus();
  } catch (err) {
    buildState.status = 'failed';
    buildState.currentTask = 'Dependency Setup Failed';
    logToConsole(`Dependency setup error: ${err.message}`, 'error');
    broadcastStatus();
  }
});

// 7. Clone AzerothCore & mod-playerbots
app.post('/api/clone', async (req, res) => {
  if (buildState.status !== 'idle') {
    return res.status(400).json({ error: 'Another task is currently running.' });
  }

  buildState.status = 'cloning';
  buildState.currentTask = 'Cloning Repositories';
  res.json({ success: true });

  try {
    const acPath = path.join(__dirname, 'azerothcore');
    
    // Step 1: Clone AzerothCore
    if (!fs.existsSync(acPath)) {
      logToConsole('Cloning AzerothCore-wotlk repository...', 'system');
      await runCommand('git', ['clone', 'https://github.com/mod-playerbots/azerothcore-wotlk.git', 'azerothcore']);
    } else {
      logToConsole('AzerothCore directory already exists. Fetching updates...', 'system');
      await runCommand('git', ['pull'], { cwd: acPath });
    }

    // Step 2: Clone mod-playerbots module into modules folder
    const modPath = path.join(acPath, 'modules', 'mod-playerbots');
    if (!fs.existsSync(modPath)) {
      logToConsole('Cloning mod-playerbots repository into modules...', 'system');
      await runCommand('git', ['clone', 'https://github.com/mod-playerbots/mod-playerbots.git', 'modules/mod-playerbots'], { cwd: acPath });
    } else {
      logToConsole('mod-playerbots directory already exists. Fetching updates...', 'system');
      await runCommand('git', ['pull'], { cwd: modPath });
    }

    buildState.status = 'idle';
    buildState.currentTask = 'Cloning Succeeded';
    broadcastStatus();
  } catch (err) {
    buildState.status = 'failed';
    buildState.currentTask = 'Cloning Failed';
    logToConsole(`Cloning error: ${err.message}`, 'error');
    broadcastStatus();
  }
});

// 8. Configure CMake
app.post('/api/configure', async (req, res) => {
  if (buildState.status !== 'idle') {
    return res.status(400).json({ error: 'Another task is currently running.' });
  }

  const acPath = path.join(__dirname, 'azerothcore');
  if (!fs.existsSync(acPath)) {
    return res.status(400).json({ error: 'AzerothCore source code not cloned yet. Clone it first!' });
  }

  // Get active CMake path (prioritize portable)
  const cmakeExe = getPortableCMakePath() || 'cmake';
  
  buildState.status = 'configuring';
  buildState.currentTask = 'Configuring CMake';
  res.json({ success: true });

  try {
    const buildPath = path.join(acPath, 'build');
    if (!fs.existsSync(buildPath)) {
      fs.mkdirSync(buildPath, { recursive: true });
    } else {
      // Clear CMake cache to prevent generator mismatch or stale cache bugs
      const cacheFile = path.join(buildPath, 'CMakeCache.txt');
      if (fs.existsSync(cacheFile)) {
        logToConsole('Clearing CMakeCache.txt to prevent generator mismatch...', 'info');
        fs.unlinkSync(cacheFile);
      }
      const cmakeFilesDir = path.join(buildPath, 'CMakeFiles');
      if (fs.existsSync(cmakeFilesDir)) {
        logToConsole('Clearing CMakeFiles directory...', 'info');
        fs.rmSync(cmakeFilesDir, { recursive: true, force: true });
      }
    }

    const vcpkgBinary = getPortableVcpkgPath();
    const cmakeArgs = [];

    // Point CMake to build directory source
    cmakeArgs.push('..');

    // On Windows, explicitly set the Visual Studio Generator to use the MSVC compiler
    if (process.platform === 'win32') {
      let vsGenerator = 'Visual Studio 17 2022';
      const vsVersion = buildState.dependencies.compiler.version;
      if (vsVersion) {
        if (vsVersion.includes('2026')) {
          vsGenerator = 'Visual Studio 18 2026';
        } else if (vsVersion.includes('2019')) {
          vsGenerator = 'Visual Studio 16 2019';
        } else if (vsVersion.includes('2017')) {
          vsGenerator = 'Visual Studio 15 2017';
        }
      }
      cmakeArgs.push('-G', vsGenerator);
      cmakeArgs.push('-A', 'x64');
      logToConsole(`Using CMake generator: ${vsGenerator} (x64)`, 'success');
    }
    
    // Portable libraries via vcpkg toolchain
    if (vcpkgBinary) {
      const toolchainFile = path.join(__dirname, 'deps', 'vcpkg', 'scripts', 'buildsystems', 'vcpkg.cmake').replace(/\\/g, '/');
      cmakeArgs.push(`-DCMAKE_TOOLCHAIN_FILE=${toolchainFile}`);
      logToConsole(`Using local portable libraries: ${toolchainFile}`, 'success');
    }

    // Set installation target within the project folder
    const installPrefix = path.join(acPath, 'bin').replace(/\\/g, '/');
    cmakeArgs.push(`-DCMAKE_INSTALL_PREFIX=${installPrefix}`);
    
    // Choose build type (Release by default)
    const buildType = req.body.buildType || 'Release';
    cmakeArgs.push(`-DCMAKE_BUILD_TYPE=${buildType}`);
    
    // AzerothCore specific parameters
    cmakeArgs.push('-DTOOLS_BUILD=all');
    cmakeArgs.push('-DSCRIPTS=static');
    
    // Custom cmake arguments if provided
    if (req.body.customArgs) {
      req.body.customArgs.split(' ').forEach(arg => {
        if (arg.trim()) cmakeArgs.push(arg.trim());
      });
    }

    // Run CMake configure command
    await runCommand(cmakeExe, cmakeArgs, { cwd: buildPath });
    
    buildState.status = 'idle';
    buildState.currentTask = 'CMake Configure Succeeded';
    broadcastStatus();
  } catch (err) {
    buildState.status = 'failed';
    buildState.currentTask = 'CMake Configure Failed';
    logToConsole(`CMake Configure error: ${err.message}`, 'error');
    broadcastStatus();
  }
});

// 9. Build CMake Project
app.post('/api/build', async (req, res) => {
  if (buildState.status !== 'idle') {
    return res.status(400).json({ error: 'Another task is currently running.' });
  }

  const acPath = path.join(__dirname, 'azerothcore');
  const buildPath = path.join(acPath, 'build');
  if (!fs.existsSync(buildPath)) {
    return res.status(400).json({ error: 'Build folder not configured. Run Configure CMake first!' });
  }

  // Get active CMake path
  const cmakeExe = getPortableCMakePath() || 'cmake';
  
  buildState.status = 'building';
  buildState.currentTask = 'Compiling Server';
  res.json({ success: true });

  try {
    const buildType = req.body.buildType || 'Release';
    const parallelCores = req.body.parallelCores || '';

    // Auto-configure if CMakeCache.txt is missing (e.g. was cleared)
    const cmakeCachePath = path.join(buildPath, 'CMakeCache.txt');
    if (!fs.existsSync(cmakeCachePath)) {
      logToConsole('CMakeCache.txt not found – running CMake configure automatically...', 'system');
      buildState.currentTask = 'Auto-Configuring CMake';
      broadcastStatus();

      const vcpkgToolchain = path.join(__dirname, 'deps', 'vcpkg', 'scripts', 'buildsystems', 'vcpkg.cmake');
      const installPrefix = path.join(acPath, 'bin');
      const hasVcpkg = fs.existsSync(vcpkgToolchain);

      // Detect generator
      const vsVersions = [
        { version: '18 2026', minorVer: 18 },
        { version: '17 2022', minorVer: 17 },
        { version: '16 2019', minorVer: 16 },
      ];
      let generator = 'Visual Studio 17 2022';
      // Try to find installed VS
      for (const vs of vsVersions) {
        const vsPath = `C:/Program Files (x86)/Microsoft Visual Studio/${vs.minorVer}`;
        if (fs.existsSync(vsPath)) {
          generator = `Visual Studio ${vs.version}`;
          break;
        }
      }

      const cmakeArgs = [
        '..', '-G', generator, '-A', 'x64',
        `-DCMAKE_INSTALL_PREFIX=${installPrefix.replace(/\\/g, '/')}`,
        `-DCMAKE_BUILD_TYPE=${buildType}`,
        '-DTOOLS_BUILD=all',
        '-DSCRIPTS=static',
      ];
      if (hasVcpkg) {
        cmakeArgs.splice(1, 0, `-DCMAKE_TOOLCHAIN_FILE=${vcpkgToolchain.replace(/\\/g, '/')}`);
      }

      await runCommand(cmakeExe, cmakeArgs, { cwd: buildPath });
      logToConsole('Auto-configure finished. Starting compilation...', 'success');
      buildState.currentTask = 'Compiling Server';
      broadcastStatus();
    }
    
    const buildArgs = ['--build', '.', '--config', buildType, '--target', 'install'];
    
    // Enable parallel compilation
    if (parallelCores) {
      buildArgs.push('--parallel', parallelCores.toString());
    } else {
      buildArgs.push('--parallel'); // Auto detect / use all cores
    }

    if (process.platform === 'win32') {
      // Pass MSBuild specific flags to compile multiple C++ files within a single project in parallel
      buildArgs.push('--');
      if (parallelCores) {
        buildArgs.push(`/p:CL_MPCount=${parallelCores}`);
      } else {
        const cores = process.env.NUMBER_OF_PROCESSORS || '4';
        buildArgs.push(`/p:CL_MPCount=${cores}`);
      }
      buildArgs.push('/p:UseMultiToolTask=true', '/p:EnforceProcessCountAcrossBuilds=true');
    }

    await runCommand(cmakeExe, buildArgs, { cwd: buildPath });
    
    buildState.status = 'success';
    buildState.currentTask = 'AzerothCore Compiling Succeeded!';
    logToConsole('Compilation finished successfully! Built server binaries are stored in: azerothcore/bin/', 'success');
    broadcastStatus();
  } catch (err) {
    buildState.status = 'failed';
    buildState.currentTask = 'Compiling Failed';
    logToConsole(`Compiling error: ${err.message}`, 'error');
    broadcastStatus();
  }
});


// SSE Log Stream
app.get('/api/logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Send existing log buffer to reconnecting client
  logBuffer.forEach(entry => {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  });
  
  sseClients.add(res);
  
  req.on('close', () => {
    sseClients.delete(res);
  });
});

// Start Express Server
const server = http.createServer(app);
server.listen(PORT, async () => {
  console.log(`Server is running at http://localhost:${PORT}`);
  await checkDependencies();
  
  // Auto open browser in non-dev mode
  if (!isDev) {
    open(`http://localhost:${PORT}`);
  }
});
