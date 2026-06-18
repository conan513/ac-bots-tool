import { useState, useEffect, useRef } from 'react';

interface DependencyStatus {
  installed: boolean;
  version: string;
  path: string;
  portable?: boolean;
  type?: string;
}

interface BuildState {
  status: 'idle' | 'downloading' | 'compiling_deps' | 'cloning' | 'configuring' | 'building' | 'success' | 'failed';
  currentTask: string;
  progress: number;
  os: string;
  arch: string;
  dependencies: {
    git: DependencyStatus;
    cmake: DependencyStatus;
    compiler: DependencyStatus;
    boost: DependencyStatus;
    openssl: DependencyStatus;
    mariadb: DependencyStatus;
  };
}

interface LogEntry {
  timestamp: string;
  type: 'info' | 'stdout' | 'stderr' | 'success' | 'error' | 'system';
  text: string;
}

export default function App() {
  const [state, setState] = useState<BuildState | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filterText, setFilterText] = useState('');
  const [logTypeFilter, setLogTypeFilter] = useState<'all' | 'stdout' | 'stderr' | 'system'>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  
  // Configuration inputs
  const [buildType, setBuildType] = useState<'Release' | 'Debug'>('Release');
  const [parallelCores, setParallelCores] = useState<string>('');
  const [customArgs, setCustomArgs] = useState<string>('');

  const consoleEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Fetch state on load and set up polling
  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, 1000);
    return () => clearInterval(interval);
  }, []);

  // EventSource for real-time logs and status updates
  useEffect(() => {
    const es = new EventSource('/api/logs');
    eventSourceRef.current = es;

    // Real-time log lines
    es.onmessage = (event) => {
      try {
        const newLog: LogEntry = JSON.parse(event.data);
        setLogs((prev) => {
          const updated = [...prev, newLog];
          if (updated.length > 5000) updated.shift();
          return updated;
        });
      } catch (err) {
        console.error('Failed to parse log entry:', err);
      }
    };

    // Instant status update when a task finishes (no need to wait for poll)
    es.addEventListener('status', (event) => {
      try {
        const newState = JSON.parse(event.data);
        setState(newState);
      } catch (err) {
        console.error('Failed to parse status update:', err);
      }
    });

    es.onerror = () => {
      console.log('SSE connection lost. Reconnecting...');
    };

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  // Autoscroll logic
  useEffect(() => {
    if (autoScroll && consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const fetchState = async () => {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      setState(data);
    } catch (err) {
      console.error('Failed to fetch status:', err);
    }
  };

  const triggerCheckDeps = async () => {
    try {
      const res = await fetch('/api/check-deps', { method: 'POST' });
      const data = await res.json();
      setState(data);
    } catch (err) {
      console.error(err);
    }
  };

  const triggerInstallCompiler = async () => {
    if (!confirm('This will launch a command line C++ compiler installer. On Windows, it uses winget and will request administrator approval (UAC popup). Proceed?')) {
      return;
    }
    try {
      await fetch('/api/install-compiler', { method: 'POST' });
      fetchState();
    } catch (err) {
      console.error(err);
    }
  };

  const triggerSetupPortableDeps = async () => {
    try {
      await fetch('/api/setup-portable-deps', { method: 'POST' });
      fetchState();
    } catch (err) {
      console.error(err);
    }
  };

  const triggerClone = async () => {
    if (!state?.dependencies.git.installed) {
      alert("Error: Git is not installed on your system! Please install Git and refresh the status.");
      return;
    }
    try {
      await fetch('/api/clone', { method: 'POST' });
      fetchState();
    } catch (err) {
      console.error(err);
    }
  };

  const triggerConfigure = async () => {
    if (!state?.dependencies.cmake.installed) {
      alert("Error: CMake is not installed! Please click 'Get Portable Dependencies' on the left panel first.");
      return;
    }
    if (state.dependencies.compiler.version.includes('2026') && (state.dependencies.cmake.version.includes('version 3.') || !state.dependencies.cmake.path.includes('4.3.3'))) {
      alert("Error: Visual Studio 2026 requires CMake v4.3.3. Please click 'Get Portable Dependencies' on the left panel to update CMake!");
      return;
    }
    try {
      await fetch('/api/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buildType, customArgs })
      });
      fetchState();
    } catch (err) {
      console.error(err);
    }
  };

  const triggerBuild = async () => {
    if (!state?.dependencies.compiler.installed) {
      alert("Error: C++ Compiler not found! Please install the compiler first using the 'Install Compiler' button on the left panel.");
      return;
    }
    try {
      await fetch('/api/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buildType, parallelCores })
      });
      fetchState();
    } catch (err) {
      console.error(err);
    }
  };

  const triggerCancel = async () => {
    try {
      await fetch('/api/cancel', { method: 'POST' });
      fetchState();
    } catch (err) {
      console.error(err);
    }
  };

  const clearLogs = async () => {
    try {
      await fetch('/api/clear-logs', { method: 'POST' });
      setLogs([]);
    } catch (err) {
      console.error(err);
    }
  };

  const copyLogs = () => {
    const text = logs.map(l => `[${l.timestamp}] ${l.text}`).join('\n');
    navigator.clipboard.writeText(text);
    alert('Logs copied to clipboard!');
  };

  // Helper to match text color class based on log entry type
  const getLogClass = (type: LogEntry['type']) => {
    switch (type) {
      case 'system': return 'log-line system';
      case 'success': return 'log-line success';
      case 'error': return 'log-line error';
      case 'stderr': return 'log-line stderr';
      default: return 'log-line stdout';
    }
  };

  // Log filtering
  const filteredLogs = logs.filter(log => {
    const textMatches = log.text.toLowerCase().includes(filterText.toLowerCase());
    if (logTypeFilter === 'all') return textMatches;
    if (logTypeFilter === 'stdout') return textMatches && log.type === 'stdout';
    if (logTypeFilter === 'stderr') return textMatches && log.type === 'stderr';
    if (logTypeFilter === 'system') return textMatches && log.type === 'system';
    return textMatches;
  });

  if (!state) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', flexDirection: 'column', gap: '1rem' }}>
        <div className="pulse-indicator active" style={{ width: '24px', height: '24px' }}></div>
        <p style={{ color: 'var(--text-muted)' }}>Connecting to build helper backend...</p>
      </div>
    );
  }

  const isBusy = state.status !== 'idle' && state.status !== 'success' && state.status !== 'failed';
  
  // OS readable names
  const getOSName = (os: string) => {
    if (os === 'win32') return 'Windows';
    if (os === 'darwin') return 'macOS';
    if (os === 'linux') return 'Linux';
    return os;
  };

  // Progress Bar Width
  const getProgressBarWidth = () => {
    if (state.status === 'downloading') return '25%';
    if (state.status === 'compiling_deps') return '50%';
    if (state.status === 'cloning') return '65%';
    if (state.status === 'configuring') return '80%';
    if (state.status === 'building') return '95%';
    if (state.status === 'success') return '100%';
    return '0%';
  };

  return (
    <div className="container">
      {/* Header */}
      <header className="header">
        <div className="logo-container">
          <div className="logo-icon">AC</div>
          <div className="logo-text">
            <h1>AzerothCore Builder</h1>
            <p>Portable compiler and Playerbots module integrator</p>
          </div>
        </div>
        
        <div className="system-status">
          <div className="status-badge">
            💻 OS: <strong>{getOSName(state.os)} ({state.arch})</strong>
          </div>
          <div className="status-badge">
            <span className={`pulse-indicator ${isBusy ? 'active' : state.status === 'success' ? 'success' : state.status === 'failed' ? 'error' : 'idle'}`}></span>
            Status: <strong>{state.status.toUpperCase().replace('_', ' ')}</strong>
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <div className="dashboard-grid">
        {/* Left Side: Setup & Config */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          
          {/* Dependencies Card */}
          <div className="card">
            <div className="card-title">
              <span>🛠️ System Dependencies</span>
              <button className="btn btn-secondary" style={{ width: 'auto', padding: '0.25rem 0.75rem', fontSize: '0.75rem' }} onClick={triggerCheckDeps} disabled={isBusy}>
                🔄 Check
              </button>
            </div>
            
            <div className="dep-list">
              <div className={`dep-item ${state.dependencies.git.installed ? 'installed' : 'missing'}`}>
                <div className="dep-info">
                  <span className="dep-name">Git</span>
                  <span className="dep-version">{state.dependencies.git.installed ? state.dependencies.git.version : 'Not found'}</span>
                </div>
                <span className={`dep-status-icon ${state.dependencies.git.installed ? 'success' : 'error'}`}>
                  {state.dependencies.git.installed ? '✔️' : '❌'}
                </span>
              </div>

              <div className={`dep-item ${state.dependencies.compiler.installed ? 'installed' : 'missing'}`}>
                <div className="dep-info">
                  <span className="dep-name">C++ Compiler</span>
                  <span className="dep-version">{state.dependencies.compiler.installed ? `${state.dependencies.compiler.type} (${state.dependencies.compiler.version})` : 'Not found'}</span>
                </div>
                <span className={`dep-status-icon ${state.dependencies.compiler.installed ? 'success' : 'error'}`}>
                  {state.dependencies.compiler.installed ? '✔️' : '❌'}
                </span>
              </div>

              <div className={`dep-item ${state.dependencies.cmake.installed ? 'installed' : 'missing'}`}>
                <div className="dep-info">
                  <span className="dep-name">CMake {state.dependencies.cmake.portable && '(Portable)'}</span>
                  <span className="dep-version">{state.dependencies.cmake.installed ? state.dependencies.cmake.version : 'Not found'}</span>
                </div>
                <span className={`dep-status-icon ${state.dependencies.cmake.installed ? 'success' : 'error'}`}>
                  {state.dependencies.cmake.installed ? '✔️' : '❌'}
                </span>
              </div>

              <div className={`dep-item ${state.dependencies.boost.installed ? 'installed' : 'missing'}`}>
                <div className="dep-info">
                  <span className="dep-name">Boost C++ Libraries {state.dependencies.boost.portable && '(vcpkg)'}</span>
                  <span className="dep-version">{state.dependencies.boost.installed ? 'Installed' : 'Not found'}</span>
                </div>
                <span className={`dep-status-icon ${state.dependencies.boost.installed ? 'success' : 'error'}`}>
                  {state.dependencies.boost.installed ? '✔️' : '❌'}
                </span>
              </div>

              <div className={`dep-item ${state.dependencies.openssl.installed ? 'installed' : 'missing'}`}>
                <div className="dep-info">
                  <span className="dep-name">OpenSSL {state.dependencies.openssl.portable && '(vcpkg)'}</span>
                  <span className="dep-version">{state.dependencies.openssl.installed ? 'Installed' : 'Not found'}</span>
                </div>
                <span className={`dep-status-icon ${state.dependencies.openssl.installed ? 'success' : 'error'}`}>
                  {state.dependencies.openssl.installed ? '✔️' : '❌'}
                </span>
              </div>

              <div className={`dep-item ${state.dependencies.mariadb.installed ? 'installed' : 'missing'}`}>
                <div className="dep-info">
                  <span className="dep-name">MariaDB Libraries {state.dependencies.mariadb.portable && '(vcpkg)'}</span>
                  <span className="dep-version">{state.dependencies.mariadb.installed ? 'Installed' : 'Not found'}</span>
                </div>
                <span className={`dep-status-icon ${state.dependencies.mariadb.installed ? 'success' : 'error'}`}>
                  {state.dependencies.mariadb.installed ? '✔️' : '❌'}
                </span>
              </div>
            </div>

            {/* Compiler Help Trigger */}
            {!state.dependencies.compiler.installed && (
              <div className="installer-help-card">
                <h4>⚠️ Missing C++ Compiler!</h4>
                <p>A C++ compiler is required to compile the source code.</p>
                {state.os === 'win32' && (
                  <button className="btn btn-primary" onClick={triggerInstallCompiler} disabled={isBusy}>
                    📥 Install Compiler (Winget)
                  </button>
                )}
                {state.os === 'darwin' && (
                  <button className="btn btn-primary" onClick={triggerInstallCompiler} disabled={isBusy}>
                    📥 Install Compiler (xcode-select)
                  </button>
                )}
                {state.os === 'linux' && (
                  <div>
                    <p>Run the following command in your terminal:</p>
                    <div className="code-block">sudo apt install -y build-essential gcc g++</div>
                  </div>
                )}
              </div>
            )}

            {/* Portable Setup Trigger */}
            {state.dependencies.compiler.installed && (!state.dependencies.cmake.installed || !state.dependencies.boost.installed || !state.dependencies.openssl.installed || !state.dependencies.mariadb.installed) && (
              <div className="installer-help-card" style={{ backgroundColor: 'rgba(79, 172, 254, 0.05)', borderColor: 'rgba(79, 172, 254, 0.2)' }}>
                <h4 style={{ color: 'var(--color-primary)' }}>📦 Install Portable Dependencies</h4>
                <p>Downloads CMake, along with Boost, OpenSSL, and MySQL/MariaDB dependencies locally into the <code>deps/</code> folder.</p>
                <button className="btn btn-purple" onClick={triggerSetupPortableDeps} disabled={isBusy}>
                  📥 Get Portable Dependencies
                </button>
              </div>
            )}
          </div>

          {/* Configuration Card */}
          <div className="card">
            <div className="card-title">⚙️ Configuration Settings</div>
            
            <div className="form-group">
              <label>Build Type</label>
              <select className="form-select" value={buildType} onChange={(e) => setBuildType(e.target.value as 'Release' | 'Debug')} disabled={isBusy}>
                <option value="Release">Release (Recommended for play / fast execution)</option>
                <option value="Debug">Debug (For development / crash diagnostics)</option>
              </select>
            </div>

            <div className="form-group">
              <label>Number of Parallel Cores (CPU Cores)</label>
              <input 
                type="number" 
                className="form-input" 
                placeholder="Use all cores" 
                value={parallelCores} 
                onChange={(e) => setParallelCores(e.target.value)} 
                disabled={isBusy}
                min="1"
              />
            </div>

            <div className="form-group">
              <label>Custom CMake Arguments</label>
              <input 
                type="text" 
                className="form-input" 
                placeholder="E.g., -DWITH_WARNINGS=0" 
                value={customArgs} 
                onChange={(e) => setCustomArgs(e.target.value)} 
                disabled={isBusy}
              />
            </div>
          </div>

        </div>

        {/* Right Side: Process workflow & Console */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          
          {/* Progress / Step Card */}
          <div className="card">
            <div className="card-title">
              <span>🚀 AzerothCore Build Steps</span>
              {isBusy && (
                <button className="btn btn-danger" style={{ width: 'auto', padding: '0.25rem 1rem', fontSize: '0.85rem' }} onClick={triggerCancel}>
                  ⏹️ Stop
                </button>
              )}
            </div>
            
            {/* Status bar */}
            {isBusy && (
              <div style={{ marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                  <span>Task: <strong>{state.currentTask}</strong></span>
                  <span>In progress...</span>
                </div>
                <div className="progress-bar-container">
                  <div className="progress-bar pulsing" style={{ width: getProgressBarWidth() }}></div>
                </div>
              </div>
            )}

            <div className="build-steps">
              {/* Step 1 */}
              <div className={`step-card ${state.status === 'cloning' ? 'active' : ''}`}>
                <div className="step-number">1</div>
                <div className="step-content">
                  <div className="step-title">Download Source Code</div>
                  <div className="step-desc">Clones the AzerothCore-wotlk main branch and the mod-playerbots module.</div>
                  <button className="btn btn-secondary" onClick={triggerClone} disabled={isBusy}>
                    📥 Clone and Update
                  </button>
                </div>
              </div>

              {/* Step 2 */}
              <div className={`step-card ${state.status === 'configuring' ? 'active' : ''}`}>
                <div className="step-number">2</div>
                <div className="step-content">
                  <div className="step-title">CMake Configuration</div>
                  <div className="step-desc">Generates build files and configures paths to portable dependencies.</div>
                  <button className="btn btn-secondary" onClick={triggerConfigure} disabled={isBusy}>
                    ⚙️ CMake Generate
                  </button>
                </div>
              </div>

              {/* Step 3 */}
              <div className={`step-card ${state.status === 'building' ? 'active' : ''}`}>
                <div className="step-number">3</div>
                <div className="step-content">
                  <div className="step-title">Compile and Install</div>
                  <div className="step-desc">Compiles C++ code, integrates the mod-playerbots module, and creates executable binaries in the <code>bin/</code> folder.</div>
                  <button className="btn btn-primary" onClick={triggerBuild} disabled={isBusy}>
                    🚀 Start Compilation
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Console / Terminal logs */}
          <div className="card terminal-card" style={{ flexGrow: 1 }}>
            <div className="terminal-header">
              <div className="terminal-controls">
                <span className="terminal-dot red"></span>
                <span className="terminal-dot yellow"></span>
                <span className="terminal-dot green"></span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: '0.5rem', fontFamily: 'var(--font-sans)' }}>Console Log</span>
              </div>

              <div className="terminal-actions">
                <input 
                  type="text" 
                  placeholder="Search..." 
                  className="terminal-search"
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                />
                
                <select 
                  className="terminal-search" 
                  value={logTypeFilter} 
                  onChange={(e) => setLogTypeFilter(e.target.value as any)}
                  style={{ paddingRight: '1rem' }}
                >
                  <option value="all">All logs</option>
                  <option value="stdout">Standard output</option>
                  <option value="stderr">Standard error</option>
                  <option value="system">System messages</option>
                </select>

                <button className="terminal-action-btn" onClick={copyLogs} title="Copy all">
                  📋 Copy
                </button>
                <button className="terminal-action-btn" onClick={clearLogs} title="Clear console">
                  🗑️ Clear
                </button>
                <button 
                  className="terminal-action-btn" 
                  onClick={() => setAutoScroll(!autoScroll)}
                  style={{ color: autoScroll ? 'var(--color-primary)' : 'var(--text-muted)' }}
                  title="Toggle automatic scrolling"
                >
                  ⬇️ AutoScroll
                </button>
              </div>
            </div>

            <div className="terminal-console">
              {filteredLogs.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '2rem' }}>The console log is empty. Start an action to see details.</div>
              ) : (
                filteredLogs.map((log, index) => (
                  <div key={index} className={getLogClass(log.type)}>
                    <span style={{ color: '#6B7280', marginRight: '0.5rem', userSelect: 'none' }}>[{log.timestamp}]</span>
                    {log.text}
                  </div>
                ))
              )}
              <div ref={consoleEndRef}></div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
