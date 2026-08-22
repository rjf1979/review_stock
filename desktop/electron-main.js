// 行情日报 Desktop · Electron 外壳（试运行）
// 说明：最终打包目标为 Tauri；此 Electron 外壳用于快速本地试运行，核心代码（前端+取数）与 Tauri 通用。
const { app, BrowserWindow } = require('electron');
require('./server.js'); // 启动本地取数服务（端口 3100）

const PORT = 3100;

function createWindow() {
  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: '行情日报 Desktop',
    backgroundColor: '#f3f5f7',
    autoHideMenuBar: true,
  });
  const load = () => win.loadURL(`http://localhost:${PORT}`);
  win.webContents.on('did-fail-load', () => setTimeout(load, 500));
  load();
}

app.whenReady().then(() => {
  setTimeout(createWindow, 400); // 等服务就绪
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
