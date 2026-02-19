// ═══════════════════════════════════════════════════════════════════════════════
// ELECTRON PRELOAD SCRIPT
// Exposes safe APIs to the renderer process
// ═══════════════════════════════════════════════════════════════════════════════

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimizeToTray: () => ipcRenderer.send('minimize-to-tray'),
  showWindow: () => ipcRenderer.send('show-window'),

  // App info
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  isDev: () => ipcRenderer.invoke('is-dev'),

  // Platform info
  platform: process.platform,

  // Event listeners
  onServerStatus: (callback) => {
    ipcRenderer.on('server-status', (event, status) => callback(status));
  }
});
