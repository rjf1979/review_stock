// 行情日报 Desktop · Electron 外壳
const { app, BrowserWindow, Tray, Menu, Notification, nativeImage, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const review = require('./review-core');
const { createReviewScheduler } = require('./review-scheduler');

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
require('./server.js'); // 启动本地取数服务（端口 3100）

const PORT = 3100;
const CLOSE_TIME = '15:35';
let win;
let tray;
let isQuitting = false;
let notifyEnabled = false;
let scheduler;
let savedState = {};

function statePath() {
  return path.join(app.getPath('userData'), 'desktop-state.json');
}

function loadState() {
  try {
    savedState = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    notifyEnabled = savedState.notifyEnabled === true;
  } catch {
    savedState = {};
  }
}

function saveState(patch) {
  savedState = { ...savedState, ...patch };
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify(savedState, null, 2), 'utf8');
  } catch (error) {
    console.error('[桌面端] 保存本地状态失败：', error.message);
  }
}

function saveReviewMarkdown(date, markdown) {
  const dir = path.join(app.getPath('userData'), 'reviews');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, date + '-analysis.md'), markdown, 'utf8');
}

function createWindow() {
  win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: '行情日报 Desktop',
    backgroundColor: '#f6f8f7',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  const load = () => win.loadURL('http://localhost:' + PORT);
  win.webContents.on('did-fail-load', () => setTimeout(load, 500));
  win.on('close', event => {
    if (isQuitting) return;
    event.preventDefault();
    win.hide();
  });
  load();
}

function createTray() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" rx="3" fill="#17212b"/><path d="M3 11h2V7h2v4h2V4h2v7h2" fill="none" stroke="#e34845" stroke-width="1.5"/></svg>';
  const icon = nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
  tray = new Tray(icon);
  tray.setToolTip('行情日报 Desktop');
  tray.on('double-click', showWindow);
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开行情日报', click: showWindow },
    { type: 'separator' },
    {
      label: '收盘复盘通知',
      type: 'checkbox',
      checked: notifyEnabled,
      click: item => {
        notifyEnabled = item.checked;
        saveState({ notifyEnabled });
      },
    },
    { label: '复盘时间：工作日 ' + CLOSE_TIME + ' 后', enabled: false },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } },
  ]));
}

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

app.on('second-instance', showWindow);

function notify(title, body) {
  if (!notifyEnabled || !Notification.isSupported()) return;
  new Notification({ title, body }).show();
}

function startReviewScheduler() {
  scheduler = createReviewScheduler({
    runReview: date => review.runDailyReview(date),
    initialDate: savedState.lastReviewDate || '',
    onSuccess: (result, date) => {
      saveReviewMarkdown(date, result.markdown);
      saveState({ lastReviewDate: date });
      notify('每日复盘已生成', date + ' · 市场温度 ' + result.temperature + '°，打开行情日报查看');
      console.log('[桌面端] 收盘复盘完成：' + date + '，温度 ' + result.temperature);
    },
    onError: (error, date) => {
      notify('每日复盘生成失败', date + ' · 请检查网络后重试');
      console.error('[桌面端] 收盘复盘失败：' + date, error.message);
    },
  });
  scheduler.start();
}

ipcMain.on('desktop:notify-setting', (_event, enabled) => {
  notifyEnabled = Boolean(enabled);
  saveState({ notifyEnabled });
  updateTrayMenu();
});

app.whenReady().then(() => {
  loadState();
  createWindow();
  createTray();
  startReviewScheduler();
  app.on('activate', showWindow);
});

app.on('before-quit', () => {
  isQuitting = true;
  if (scheduler) scheduler.stop();
});

app.on('window-all-closed', () => {
  // 托盘常驻：窗口关闭按钮只隐藏窗口，用户从托盘菜单退出应用。
});
}
