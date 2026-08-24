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
});
