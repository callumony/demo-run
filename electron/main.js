// ═══════════════════════════════════════════════════════════════════════════════
// ELECTRON MAIN PROCESS
// Manages the app window, system tray, and process lifecycle
// ═══════════════════════════════════════════════════════════════════════════════

const { app, BrowserWindow, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

// ─────────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────────
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const SERVER_PORT = 3001;
const CLIENT_PORT = isDev ? 5173 : SERVER_PORT;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;
const CLIENT_URL = isDev ? `http://localhost:${CLIENT_PORT}` : SERVER_URL;

// ─────────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────────
let mainWindow = null;
let tray = null;
let serverProcess = null;
let clientProcess = null;
let isQuitting = false;
let serverReady = false;

// ─────────────────────────────────────────────────────────────────────────────────
// Process Management
// ─────────────────────────────────────────────────────────────────────────────────

function getProjectRoot() {
  // In dev, we're in /electron, in prod we might be in /resources/app
  if (isDev) {
    return path.join(__dirname, '..');
  }
  return path.join(process.resourcesPath, 'app');
}

function startServer() {
  return new Promise((resolve, reject) => {
    const projectRoot = getProjectRoot();
    console.log('Starting server from:', projectRoot);

    serverProcess = spawn('node', ['server/index.js'], {
      cwd: projectRoot,
      env: { ...process.env, NODE_ENV: isDev ? 'development' : 'production' },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true
    });

    serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('[Server]', output);
      if (output.includes('listening') || output.includes('Server running') || output.includes(`port ${SERVER_PORT}`)) {
        serverReady = true;
        resolve();
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error('[Server Error]', data.toString());
    });

    serverProcess.on('error', (err) => {
      console.error('Failed to start server:', err);
      reject(err);
    });

    serverProcess.on('close', (code) => {
      console.log(`Server process exited with code ${code}`);
      serverProcess = null;
      serverReady = false;
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      if (!serverReady) {
        // Check if server is responding anyway
        checkServerHealth().then(resolve).catch(() => {
          reject(new Error('Server startup timeout'));
        });
      }
    }, 30000);
  });
}

function startClient() {
  if (!isDev) return Promise.resolve(); // In production, server serves the client

  return new Promise((resolve, reject) => {
    const projectRoot = getProjectRoot();
    console.log('Starting Vite client from:', path.join(projectRoot, 'client'));

    clientProcess = spawn('npm', ['run', 'dev'], {
      cwd: path.join(projectRoot, 'client'),
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true
    });

    clientProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('[Client]', output);
      if (output.includes('localhost') || output.includes('ready') || output.includes('VITE')) {
        setTimeout(resolve, 2000); // Give Vite a moment to fully start
      }
    });

    clientProcess.stderr.on('data', (data) => {
      console.error('[Client Error]', data.toString());
    });

    clientProcess.on('error', (err) => {
      console.error('Failed to start client:', err);
      reject(err);
    });

    clientProcess.on('close', (code) => {
      console.log(`Client process exited with code ${code}`);
      clientProcess = null;
    });

    // Timeout after 60 seconds
    setTimeout(() => resolve(), 60000);
  });
}

function checkServerHealth() {
  return new Promise((resolve, reject) => {
    const req = http.get(`${SERVER_URL}/api/health`, (res) => {
      if (res.statusCode === 200) {
        resolve();
      } else {
        reject(new Error(`Server health check failed: ${res.statusCode}`));
      }
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Health check timeout'));
    });
  });
}

async function waitForServer(maxRetries = 30, interval = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await checkServerHealth();
      console.log('Server is ready!');
      return true;
    } catch (err) {
      console.log(`Waiting for server... (${i + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, interval));
    }
  }
  throw new Error('Server failed to start');
}

function killAllProcesses() {
  console.log('Killing all child processes...');

  const killProcess = (proc, name) => {
    if (proc && !proc.killed) {
      console.log(`Killing ${name} process (PID: ${proc.pid})`);
      try {
        // On Windows, we need to kill the entire process tree
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', proc.pid.toString(), '/f', '/t'], { shell: true });
        } else {
          proc.kill('SIGTERM');
          setTimeout(() => {
            if (!proc.killed) {
              proc.kill('SIGKILL');
            }
          }, 3000);
        }
      } catch (err) {
        console.error(`Error killing ${name}:`, err);
      }
    }
  };

  killProcess(clientProcess, 'client');
  killProcess(serverProcess, 'server');

  // Also kill any orphaned node processes on our ports (Windows)
  if (process.platform === 'win32') {
    try {
      spawn('cmd', ['/c', `for /f "tokens=5" %a in ('netstat -aon ^| findstr :${SERVER_PORT}') do taskkill /f /pid %a`], { shell: true });
      if (isDev) {
        spawn('cmd', ['/c', `for /f "tokens=5" %a in ('netstat -aon ^| findstr :${CLIENT_PORT}') do taskkill /f /pid %a`], { shell: true });
      }
    } catch (err) {
      console.error('Error cleaning up port processes:', err);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// Window Management
// ─────────────────────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    icon: path.join(__dirname, 'icons', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    frame: true,
    show: false, // Don't show until ready
    backgroundColor: '#1a1b26'
  });

  // Show when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Handle minimize to tray
  mainWindow.on('minimize', (event) => {
    event.preventDefault();
    mainWindow.hide();
    if (tray) {
      tray.displayBalloon({
        iconType: 'info',
        title: 'OMNIPOTENT',
        content: 'App minimized to system tray. Click the icon to restore.'
      });
    }
  });

  // Handle close button - minimize to tray instead of closing
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Load the app
  mainWindow.loadURL(CLIENT_URL);

  // Open DevTools in development
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// System Tray
// ─────────────────────────────────────────────────────────────────────────────────

function createTray() {
  // Create tray icon - try multiple paths
  const fs = require('fs');
  const iconPaths = [
    path.join(__dirname, 'icons', 'tray-icon.png'),
    path.join(__dirname, 'icons', 'icon.png'),
    path.join(__dirname, '..', 'client', 'public', 'favicon.ico')
  ];

  let trayIcon = null;

  for (const iconPath of iconPaths) {
    try {
      if (fs.existsSync(iconPath)) {
        trayIcon = nativeImage.createFromPath(iconPath);
        if (!trayIcon.isEmpty()) {
          trayIcon = trayIcon.resize({ width: 16, height: 16 });
          console.log('Loaded tray icon from:', iconPath);
          break;
        }
      }
    } catch (err) {
      console.log('Could not load icon from:', iconPath);
    }
  }

  // If no icon found, create a simple one programmatically
  if (!trayIcon || trayIcon.isEmpty()) {
    console.log('Using default tray icon');
    // Create a simple 16x16 purple square as fallback
    const size = 16;
    const canvas = Buffer.alloc(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      canvas[i * 4] = 99;      // R
      canvas[i * 4 + 1] = 102; // G
      canvas[i * 4 + 2] = 241; // B
      canvas[i * 4 + 3] = 255; // A
    }
    trayIcon = nativeImage.createFromBuffer(canvas, { width: size, height: size });
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('OMNIPOTENT - AI Development Assistant');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show App',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Hide App',
      click: () => {
        if (mainWindow) {
          mainWindow.hide();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Server Status',
      enabled: false,
      label: serverReady ? '● Server Running' : '○ Server Stopped'
    },
    { type: 'separator' },
    {
      label: 'Restart Server',
      click: async () => {
        killAllProcesses();
        await new Promise(r => setTimeout(r, 2000));
        try {
          await startServer();
          await waitForServer();
          if (mainWindow) {
            mainWindow.reload();
          }
        } catch (err) {
          dialog.showErrorBox('Server Error', 'Failed to restart server: ' + err.message);
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  // Double-click to show window
  tray.on('double-click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });

  // Single click to show window (on Windows)
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

function updateTrayMenu() {
  if (!tray) return;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show App',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Hide App',
      click: () => {
        if (mainWindow) {
          mainWindow.hide();
        }
      }
    },
    { type: 'separator' },
    {
      label: serverReady ? '● Server Running' : '○ Server Stopped',
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Restart Server',
      click: async () => {
        killAllProcesses();
        await new Promise(r => setTimeout(r, 2000));
        try {
          await startServer();
          await waitForServer();
          updateTrayMenu();
          if (mainWindow) {
            mainWindow.reload();
          }
        } catch (err) {
          dialog.showErrorBox('Server Error', 'Failed to restart server: ' + err.message);
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

// ─────────────────────────────────────────────────────────────────────────────────
// App Lifecycle
// ─────────────────────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  console.log('App starting...');
  console.log('Development mode:', isDev);
  console.log('Project root:', getProjectRoot());

  // Create tray first so user sees something
  createTray();

  try {
    // Start the server
    console.log('Starting server...');
    await startServer();
    await waitForServer();
    console.log('Server started successfully');
    updateTrayMenu();

    // Start client in dev mode
    if (isDev) {
      console.log('Starting Vite client...');
      await startClient();
      // Wait a bit more for Vite to be fully ready
      await new Promise(r => setTimeout(r, 3000));
    }

    // Create the window
    createWindow();

  } catch (err) {
    console.error('Startup error:', err);
    dialog.showErrorBox('Startup Error',
      'Failed to start the application:\n\n' + err.message +
      '\n\nPlease check the console for more details.'
    );
    app.quit();
  }
});

app.on('window-all-closed', () => {
  // On macOS, keep app running in tray
  if (process.platform !== 'darwin') {
    // Don't quit - keep running in tray
  }
});

app.on('activate', () => {
  // On macOS, re-create window when dock icon clicked
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else if (mainWindow) {
    mainWindow.show();
  }
});

app.on('before-quit', () => {
  isQuitting = true;

  // Auto-backup learned data on quit (fire-and-forget)
  // Tries cloud first (if connected), falls back to local backup
  if (serverReady) {
    try {
      const postData = JSON.stringify({ uploadToCloud: true, autoSave: true });
      const req = http.request({
        hostname: 'localhost',
        port: SERVER_PORT,
        path: '/api/backup/create',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 5000
      }, (res) => {
        console.log(`Auto-backup on quit: HTTP ${res.statusCode}`);
      });
      req.on('error', (err) => {
        console.warn('Auto-backup on quit failed (server may be stopping):', err.message);
      });
      req.write(postData);
      req.end();
    } catch (err) {
      console.warn('Auto-backup on quit error:', err.message);
    }
  }
});

app.on('will-quit', (event) => {
  console.log('App quitting, cleaning up processes...');
  killAllProcesses();

  // Give processes time to terminate
  if (serverProcess || clientProcess) {
    event.preventDefault();
    setTimeout(() => {
      app.quit();
    }, 2000);
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  killAllProcesses();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
});
