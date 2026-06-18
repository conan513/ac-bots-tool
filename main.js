const { app, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');

const PORT = 3000;
let mainWindow;

// Check if a server is already running on PORT
function isServerRunning() {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${PORT}/api/status`, (res) => {
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'AzerothCore Builder Dashboard',
    show: false, // Prevents white flash before page loads
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const isDev = process.argv.includes('--dev');
  const targetUrl = isDev ? `http://localhost:5173` : `http://localhost:${PORT}`;

  const loadUrlWithRetry = () => {
    mainWindow.loadURL(targetUrl)
      .then(() => {
        mainWindow.show();
        if (isDev) {
          mainWindow.webContents.openDevTools();
        }
      })
      .catch(() => {
        // Server is still starting, retry
        setTimeout(loadUrlWithRetry, 300);
      });
  };

  loadUrlWithRetry();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  const alreadyRunning = await isServerRunning();

  if (!alreadyRunning) {
    // No server detected — start the embedded Express backend
    require('./server.js');
  } else {
    console.log(`[Electron] Server already running on port ${PORT}, attaching to it.`);
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // On macOS, apps stay active until the user quits explicitly
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
