// 行情日报 Desktop · Electron 外壳
const { app, BrowserWindow, Tray, Menu, Notification, nativeImage, ipcMain, screen } = require('electron');
const path = require('path');
const review = require('./review-core');
const { createReviewScheduler } = require('./review-scheduler');
const { startServer } = require('./server');
const { createStorage } = require('./storage');

if (process.platform === 'win32') app.setAppUserModelId('io.zhicha.dailystock');

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
const PORT = 3100;
const REVIEW_TIMES = '12:00、16:00';
const APP_ICON = path.join(__dirname, 'assets', 'icon.png');
let win;
let tray;
let isQuitting = false;
let notifyEnabled = false;
let scheduler;
let savedState = {};
let storage;
let localServer;

function statePath() {
  return path.join(app.getPath('userData'), 'desktop-state.json');
}

function loadState() {
  storage.migrateLegacyFiles();
  savedState = storage.getSettings();
  notifyEnabled = savedState.notify === true;
}

function saveState(patch) {
  savedState = { ...savedState, ...patch };
  storage.setSettings(patch);
}

function saveReviewMarkdown(date, markdown) {
  storage.saveReview(date, markdown);
}

function fitWindowToDisplay() {
  if (!win || win.isDestroyed()) return;
  const display = screen.getDisplayMatching(win.getBounds());
  win.setBounds(display.workArea, false);
}

function createWindow() {
  const workArea = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
    frame: false,
    fullscreenable: false,
    title: '行情日报 Desktop',
    icon: APP_ICON,
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
  win.setResizable(false);
  win.setMaximizable(false);
  win.on('restore', () => setImmediate(fitWindowToDisplay));
  load();
}

function createTray() {
  const icon = nativeImage.createFromPath(APP_ICON).resize({ width: 16, height: 16 });
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
      label: '每日复盘通知',
      type: 'checkbox',
      checked: notifyEnabled,
      click: item => {
        notifyEnabled = item.checked;
        saveState({ notify: notifyEnabled });
      },
    },
    { label: '复盘时间：交易日 ' + REVIEW_TIMES, enabled: false },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } },
  ]));
}

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  fitWindowToDisplay();
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
    runReview: (date, slot) => review.runDailyReview(date, { slot: slot.id, slotLabel: slot.label }),
    initialDate: savedState.lastReviewDate || '',
    initialSlot: savedState.lastReviewSlot || '',
    onSuccess: (result, date, slot) => {
      saveReviewMarkdown(date, result.markdown);
      saveState({ lastReviewDate: date, lastReviewSlot: `${date}@${slot.id}` });
      notify('每日复盘已生成', date + ' · ' + slot.label + ' · 市场温度 ' + result.temperature + '°，打开行情日报查看');
      console.log('[桌面端] ' + slot.label + '完成：' + date + '，温度 ' + result.temperature);
    },
    onError: (error, date, slot) => {
      notify('每日复盘生成失败', date + ' · ' + slot.label + ' · 请检查网络后重试');
      console.error('[桌面端] ' + slot.label + '失败：' + date, error.message);
    },
  });
  scheduler.start();
}

ipcMain.on('desktop:notify-setting', (_event, enabled) => {
  notifyEnabled = Boolean(enabled);
  saveState({ notify: notifyEnabled });
  updateTrayMenu();
});

ipcMain.on('desktop:minimize-window', () => win?.minimize());
ipcMain.on('desktop:close-window', () => win?.close());

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  storage = await createStorage({
    dbPath: path.join(userData, 'hangqing.sqlite'),
    legacyStatePath: statePath(),
    legacyReviewsDir: path.join(userData, 'reviews'),
  });
  loadState();
  localServer = await startServer({ storage, port: PORT });
  createWindow();
  screen.on('display-metrics-changed', fitWindowToDisplay);
  screen.on('display-removed', fitWindowToDisplay);
  createTray();
  startReviewScheduler();
  app.on('activate', showWindow);
}).catch(error => {
  console.error('[桌面端] 初始化失败：', error);
  app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  if (scheduler) scheduler.stop();
  if (localServer) localServer.close();
  if (storage) storage.close();
});

app.on('window-all-closed', () => {
  // 托盘常驻：窗口关闭按钮只隐藏窗口，用户从托盘菜单退出应用。
});
}
