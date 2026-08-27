const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopBridge', {
  setNotifyEnabled(enabled) {
    ipcRenderer.send('desktop:notify-setting', Boolean(enabled));
  },
  minimizeWindow() {
    ipcRenderer.send('desktop:minimize-window');
  },
  closeWindow() {
    ipcRenderer.send('desktop:close-window');
  },
  getUpdateState() {
    return ipcRenderer.invoke('desktop:update-state');
  },
  checkForUpdates() {
    return ipcRenderer.invoke('desktop:check-update');
  },
  downloadUpdate() {
    return ipcRenderer.invoke('desktop:download-update');
  },
  installUpdate() {
    return ipcRenderer.invoke('desktop:install-update');
  },
  getMonitorState() {
    return ipcRenderer.invoke('desktop:monitor-state');
  },
  setMonitorEnabled(enabled) {
    return ipcRenderer.invoke('desktop:monitor-set-enabled', Boolean(enabled));
  },
  showMonitor() {
    return ipcRenderer.invoke('desktop:monitor-show');
  },
  hideMonitor() {
    return ipcRenderer.invoke('desktop:monitor-hide');
  },
  toggleMonitor() {
    return ipcRenderer.invoke('desktop:monitor-toggle');
  },
  setMonitorWatchlist(codes) {
    return ipcRenderer.invoke('desktop:monitor-set-watchlist', Array.isArray(codes) ? codes : []);
  },
  setMonitorOpacity(opacity) {
    return ipcRenderer.invoke('desktop:monitor-set-opacity', opacity);
  },
  setMonitorOnMainClose(enabled) {
    return ipcRenderer.invoke('desktop:monitor-set-on-main-close', Boolean(enabled));
  },
  openMainWindow() {
    ipcRenderer.send('desktop:monitor-open-main');
  },
  closeMonitorWindow() {
    ipcRenderer.send('desktop:monitor-close-window');
  },
  monitorReady() {
    ipcRenderer.send('desktop:monitor-ready');
  },
  resizeMonitorWindow(width, height) {
    ipcRenderer.send('desktop:monitor-resize', width, height);
  },
  onConfirm(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('desktop:show-confirm', listener);
    return () => ipcRenderer.removeListener('desktop:show-confirm', listener);
  },
  confirmResult(id, ok) {
    ipcRenderer.send('desktop:confirm-result', { id, ok: Boolean(ok) });
  },
  onUpdateState(callback) {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('desktop:update-state-changed', listener);
    return () => ipcRenderer.removeListener('desktop:update-state-changed', listener);
  },
  onMonitorStateChanged(callback) {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('desktop:monitor-state-changed', listener);
    return () => ipcRenderer.removeListener('desktop:monitor-state-changed', listener);
  },
});
