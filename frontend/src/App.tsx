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
      alert("Hiba: A Git nincs telepítve a gépeden! Kérlek telepítsd a Git-et, és frissítsd az állapotot.");
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
      alert("Hiba: A CMake nincs telepítve! Kérlek először kattints a 'Hordozható függőségek beszerzése' gombra a bal oldali panelen.");
      return;
    }
    if (state.dependencies.compiler.version.includes('2026') && (state.dependencies.cmake.version.includes('version 3.') || !state.dependencies.cmake.path.includes('4.3.3'))) {
      alert("Hiba: A Visual Studio 2026-hoz a CMake v4.3.3 szükséges. Kérlek kattints a bal oldali panelen a 'Hordozható függőségek beszerzése' gombra a CMake frissítéséhez!");
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
      alert("Hiba: Nem található C++ fordító! Kérlek először telepítsd a fordítót a bal oldali panelen található 'Fordító telepítése' gomb segítségével.");
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
            <p>Hordozható fordító és Playerbots modul integrator</p>
          </div>
        </div>
        
        <div className="system-status">
          <div className="status-badge">
            💻 OS: <strong>{getOSName(state.os)} ({state.arch})</strong>
          </div>
          <div className="status-badge">
            <span className={`pulse-indicator ${isBusy ? 'active' : state.status === 'success' ? 'success' : state.status === 'failed' ? 'error' : 'idle'}`}></span>
            Mód: <strong>{state.status.toUpperCase().replace('_', ' ')}</strong>
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
              <span>🛠️ Rendszerfüggőségek</span>
              <button className="btn btn-secondary" style={{ width: 'auto', padding: '0.25rem 0.75rem', fontSize: '0.75rem' }} onClick={triggerCheckDeps} disabled={isBusy}>
                🔄 Ellenőrzés
              </button>
            </div>
            
            <div className="dep-list">
              <div className={`dep-item ${state.dependencies.git.installed ? 'installed' : 'missing'}`}>
                <div className="dep-info">
                  <span className="dep-name">Git</span>
                  <span className="dep-version">{state.dependencies.git.installed ? state.dependencies.git.version : 'Nem található'}</span>
                </div>
                <span className={`dep-status-icon ${state.dependencies.git.installed ? 'success' : 'error'}`}>
                  {state.dependencies.git.installed ? '✔️' : '❌'}
                </span>
              </div>

              <div className={`dep-item ${state.dependencies.compiler.installed ? 'installed' : 'missing'}`}>
                <div className="dep-info">
                  <span className="dep-name">C++ Compiler</span>
                  <span className="dep-version">{state.dependencies.compiler.installed ? `${state.dependencies.compiler.type} (${state.dependencies.compiler.version})` : 'Nem található'}</span>
                </div>
                <span className={`dep-status-icon ${state.dependencies.compiler.installed ? 'success' : 'error'}`}>
                  {state.dependencies.compiler.installed ? '✔️' : '❌'}
                </span>
              </div>

              <div className={`dep-item ${state.dependencies.cmake.installed ? 'installed' : 'missing'}`}>
                <div className="dep-info">
                  <span className="dep-name">CMake {state.dependencies.cmake.portable && '(Hordozható)'}</span>
                  <span className="dep-version">{state.dependencies.cmake.installed ? state.dependencies.cmake.version : 'Nem található'}</span>
                </div>
                <span className={`dep-status-icon ${state.dependencies.cmake.installed ? 'success' : 'error'}`}>
                  {state.dependencies.cmake.installed ? '✔️' : '❌'}
                </span>
              </div>

              <div className={`dep-item ${state.dependencies.boost.installed ? 'installed' : 'missing'}`}>
                <div className="dep-info">
                  <span className="dep-name">Boost C++ Libraries {state.dependencies.boost.portable && '(vcpkg)'}</span>
                  <span className="dep-version">{state.dependencies.boost.installed ? 'Telepítve' : 'Nem található'}</span>
                </div>
                <span className={`dep-status-icon ${state.dependencies.boost.installed ? 'success' : 'error'}`}>
                  {state.dependencies.boost.installed ? '✔️' : '❌'}
                </span>
              </div>

              <div className={`dep-item ${state.dependencies.openssl.installed ? 'installed' : 'missing'}`}>
                <div className="dep-info">
                  <span className="dep-name">OpenSSL {state.dependencies.openssl.portable && '(vcpkg)'}</span>
                  <span className="dep-version">{state.dependencies.openssl.installed ? 'Telepítve' : 'Nem található'}</span>
                </div>
                <span className={`dep-status-icon ${state.dependencies.openssl.installed ? 'success' : 'error'}`}>
                  {state.dependencies.openssl.installed ? '✔️' : '❌'}
                </span>
              </div>

              <div className={`dep-item ${state.dependencies.mariadb.installed ? 'installed' : 'missing'}`}>
                <div className="dep-info">
                  <span className="dep-name">MariaDB Libraries {state.dependencies.mariadb.portable && '(vcpkg)'}</span>
                  <span className="dep-version">{state.dependencies.mariadb.installed ? 'Telepítve' : 'Nem található'}</span>
                </div>
                <span className={`dep-status-icon ${state.dependencies.mariadb.installed ? 'success' : 'error'}`}>
                  {state.dependencies.mariadb.installed ? '✔️' : '❌'}
                </span>
              </div>
            </div>

            {/* Compiler Help Trigger */}
            {!state.dependencies.compiler.installed && (
              <div className="installer-help-card">
                <h4>⚠️ Hiányzó C++ Fordító!</h4>
                <p>A C++ fordító szükséges a forráskód lefordításához.</p>
                {state.os === 'win32' && (
                  <button className="btn btn-primary" onClick={triggerInstallCompiler} disabled={isBusy}>
                    📥 Fordító telepítése (Winget)
                  </button>
                )}
                {state.os === 'darwin' && (
                  <button className="btn btn-primary" onClick={triggerInstallCompiler} disabled={isBusy}>
                    📥 Fordító telepítése (xcode-select)
                  </button>
                )}
                {state.os === 'linux' && (
                  <div>
                    <p>Futtasd az alábbi parancsot a terminálban:</p>
                    <div className="code-block">sudo apt install -y build-essential gcc g++</div>
                  </div>
                )}
              </div>
            )}

            {/* Portable Setup Trigger */}
            {state.dependencies.compiler.installed && (!state.dependencies.cmake.installed || !state.dependencies.boost.installed || !state.dependencies.openssl.installed || !state.dependencies.mariadb.installed) && (
              <div className="installer-help-card" style={{ backgroundColor: 'rgba(79, 172, 254, 0.05)', borderColor: 'rgba(79, 172, 254, 0.2)' }}>
                <h4 style={{ color: 'var(--color-primary)' }}>📦 Hordozható függőségek telepítése</h4>
                <p>Letölti a CMake-et, valamint a Boost, OpenSSL és MySQL/MariaDB függőségeket helyben a <code>deps/</code> mappába.</p>
                <button className="btn btn-purple" onClick={triggerSetupPortableDeps} disabled={isBusy}>
                  📥 Hordozható függőségek beszerzése
                </button>
              </div>
            )}
          </div>

          {/* Configuration Card */}
          <div className="card">
            <div className="card-title">⚙️ Konfigurációs Beállítások</div>
            
            <div className="form-group">
              <label>Build Típus</label>
              <select className="form-select" value={buildType} onChange={(e) => setBuildType(e.target.value as 'Release' | 'Debug')} disabled={isBusy}>
                <option value="Release">Release (Ajánlott játékhoz / gyors futáshoz)</option>
                <option value="Debug">Debug (Fejlesztéshez, crash diagnosztikához)</option>
              </select>
            </div>

            <div className="form-group">
              <label>Párhuzamos szálak száma (CPU Cores)</label>
              <input 
                type="number" 
                className="form-input" 
                placeholder="Összes mag használata" 
                value={parallelCores} 
                onChange={(e) => setParallelCores(e.target.value)} 
                disabled={isBusy}
                min="1"
              />
            </div>

            <div className="form-group">
              <label>Egyedi CMake argumentumok</label>
              <input 
                type="text" 
                className="form-input" 
                placeholder="Pl: -DWITH_WARNINGS=0" 
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
              <span>🚀 AzerothCore Összeállítási Lépések</span>
              {isBusy && (
                <button className="btn btn-danger" style={{ width: 'auto', padding: '0.25rem 1rem', fontSize: '0.85rem' }} onClick={triggerCancel}>
                  ⏹️ Leállítás
                </button>
              )}
            </div>
            
            {/* Status bar */}
            {isBusy && (
              <div style={{ marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                  <span>Feladat: <strong>{state.currentTask}</strong></span>
                  <span>Folyamatban...</span>
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
                  <div className="step-title">Forráskód Letöltése</div>
                  <div className="step-desc">Le klónozza az AzerothCore-wotlk fő ágat és a mod-playerbots kiegészítőt.</div>
                  <button className="btn btn-secondary" onClick={triggerClone} disabled={isBusy}>
                    📥 Klónozás és frissítés
                  </button>
                </div>
              </div>

              {/* Step 2 */}
              <div className={`step-card ${state.status === 'configuring' ? 'active' : ''}`}>
                <div className="step-number">2</div>
                <div className="step-content">
                  <div className="step-title">CMake Konfiguráció</div>
                  <div className="step-desc">Generálja a build fájlokat és beállítja a hordozható függőségek útvonalait.</div>
                  <button className="btn btn-secondary" onClick={triggerConfigure} disabled={isBusy}>
                    ⚙️ CMake Generálás
                  </button>
                </div>
              </div>

              {/* Step 3 */}
              <div className={`step-card ${state.status === 'building' ? 'active' : ''}`}>
                <div className="step-number">3</div>
                <div className="step-content">
                  <div className="step-title">Kompilálás és Telepítés</div>
                  <div className="step-desc">Lefordítja a C++ kódot, beépíti a mod-playerbots modult, és létrehozza a futtatható binárisokat a <code>bin/</code> mappában.</div>
                  <button className="btn btn-primary" onClick={triggerBuild} disabled={isBusy}>
                    🚀 Fordítás indítása
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
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: '0.5rem', fontFamily: 'var(--font-sans)' }}>Konzol Napló</span>
              </div>

              <div className="terminal-actions">
                <input 
                  type="text" 
                  placeholder="Keresés..." 
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
                  <option value="all">Minden log</option>
                  <option value="stdout">Standard kimenet</option>
                  <option value="stderr">Hibacsatorna</option>
                  <option value="system">Rendszerüzenetek</option>
                </select>

                <button className="terminal-action-btn" onClick={copyLogs} title="Összes másolása">
                  📋 Másolás
                </button>
                <button className="terminal-action-btn" onClick={clearLogs} title="Konzol ürítése">
                  🗑️ Törlés
                </button>
                <button 
                  className="terminal-action-btn" 
                  onClick={() => setAutoScroll(!autoScroll)}
                  style={{ color: autoScroll ? 'var(--color-primary)' : 'var(--text-muted)' }}
                  title="Automatikus görgetés ki/be"
                >
                  ⬇️ AutoScroll
                </button>
              </div>
            </div>

            <div className="terminal-console">
              {filteredLogs.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '2rem' }}>A konzol napló üres. Indíts el egy műveletet a részletekért.</div>
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
