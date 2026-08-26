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
});
