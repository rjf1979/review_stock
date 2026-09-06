// 智诊盯盘 · Electron 主进程：启动本地后端并加载窗口。禁止 Node 集成，仅暴露白名单 IPC。
// 数据目录指向可写的 userData，避免把快照/K线写进只读的 asar 安装目录。
const { app, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');

const BASE_PORT = Number(process.env.VOLUME_INSIGHT_PORT || 3110);
const APP_ID = 'io.zhicha.volumeinsight';
const ICON = path.join(__dirname, 'assets', 'icon.png');
let win = null;
let server = null;

// 单实例：重复启动时聚焦已有窗口。
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

function bindServer(srv, port) {
  return new Promise((resolve, reject) => {
    srv.listen(port, '127.0.0.1', () => resolve(port));
    srv.on('error', (err) => {
      if (err.code === 'EADDRINUSE') return reject(err);
      reject(err);
    });
  });
}

async function startBackend() {
  if (!process.env.VOLUME_INSIGHT_DATA_DIR) {
    // 开发模式与 Web 调试共用项目 data，避免桌面版切换到空的 userData 数据库。
    // 打包后安装目录通常只读，仍使用 Electron userData 保存运行时数据。
    process.env.VOLUME_INSIGHT_DATA_DIR = app.isPackaged
      ? app.getPath('userData')
      : path.join(__dirname, 'data');
  }
  // 必须在 require server（进而 require storage）前设置数据目录。
  const { createServer } = require('./server');
  // 端口冲突时顺延；每次尝试用新实例，前端的相对 /api URL 不依赖固定端口。
  for (let p = BASE_PORT; p < BASE_PORT + 20; p++) {
    const srv = createServer();
    try {
      await bindServer(srv, p);
      server = srv;
      return p;
    } catch (e) {
      if (e.code !== 'EADDRINUSE') throw e;
    }
  }
  throw new Error('找不到可用本地端口');
}

function waitForServer(url, timeoutMs = 10000) {
  const startAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 500) return resolve();
        retry();
      });
      req.on('error', retry);
      req.setTimeout(1200, () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() - startAt > timeoutMs) return reject(new Error('本地后端启动超时'));
      setTimeout(tick, 120);
    };
    tick();
  });
}

async function createWindow(port) {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: '#111318',
    title: '智诊盯盘',
    icon: ICON,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();
  win.once('ready-to-show', () => win.show());
  await waitForServer(`http://127.0.0.1:${port}/`);
  win.loadURL(`http://127.0.0.1:${port}/`);
  win.on('closed', () => { win = null; });
}

app.whenReady().then(async () => {
  app.setAppUserModelId(APP_ID);
  if (!gotLock) return; // 已在另一实例运行
  try {
    const port = await startBackend();
    await createWindow(port);
  } catch (e) {
    console.error('启动失败：', e);
    app.quit();
    return;
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      startBackend().then((p) => createWindow(p));
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (server && server.close) server.close();
});
