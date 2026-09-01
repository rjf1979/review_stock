const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('installerBridge', {
  readEnvironment() {
    return ipcRenderer.invoke('installer:environment');
  },
  startInstall() {
    return ipcRenderer.invoke('installer:start');
  },
  onStateChanged(callback) {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('installer:state-changed', listener);
    return () => ipcRenderer.removeListener('installer:state-changed', listener);
  },
});
