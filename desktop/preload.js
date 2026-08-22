const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopBridge', {
  setNotifyEnabled(enabled) {
    ipcRenderer.send('desktop:notify-setting', Boolean(enabled));
  },
});
