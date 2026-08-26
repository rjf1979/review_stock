// 行情日报 Desktop · Electron 外壳
const { app, BrowserWindow, Tray, Menu, Notification, nativeImage, ipcMain, screen, dialog } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const review = require('./review-core');
const { createReviewScheduler } = require('./review-scheduler');
const { startServer } = require('./server');
const { createStorage } = require('./storage');
const { DEFAULT_MANIFEST_URL, CHECK_INTERVAL_MS, compareVersions, selectAsset, fetchManifest, downloadUpdate } = require('./updater');

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
let updateTimer;
let updateJob;
let updateManifest;
let downloadedInstaller;
let updateState = { status: 'idle', currentVersion: app.getVersion(), availableVersion: null, progress: null, error: null, checkedAt: null };

function publishUpdateState(patch) {
  updateState = { ...updateState, ...patch };
  if (win && !win.isDestroyed()) win.webContents.send('desktop:update-state-changed', updateState);
  return updateState;
}

async function checkForUpdates({ silent = false } = {}) {
  if (updateJob) return updateJob;
  updateJob = (async () => {
    publishUpdateState({ status: 'checking', error: null });
    try {
      const manifest = await fetchManifest(process.env.UPDATE_MANIFEST_URL || DEFAULT_MANIFEST_URL);
      const hasUpdate = compareVersions(manifest.version, app.getVersion()) > 0;
      updateManifest = hasUpdate ? manifest : null;
      if (!hasUpdate) downloadedInstaller = null;
      return publishUpdateState({ status: hasUpdate ? 'available' : 'current', availableVersion: hasUpdate ? manifest.version : null, notes: hasUpdate ? manifest.notes || [] : [], progress: null, error: null, checkedAt: new Date().toISOString() });
    } catch (error) {
      console.error('[桌面端] 检查更新失败：', error.message);
      return publishUpdateState({ status: silent ? 'idle' : 'error', error: silent ? null : error.message, checkedAt: new Date().toISOString() });
    } finally {
      updateJob = null;
    }
  })();
  return updateJob;
}

async function downloadAvailableUpdate() {
  if (updateJob) return updateJob;
  if (!updateManifest) await checkForUpdates();
  if (!updateManifest) return updateState;
  updateJob = (async () => {
    try {
      const asset = selectAsset(updateManifest, process.arch);
      const filename = `hangqing-desktop-${updateManifest.version}-win-${process.arch}-setup.exe`;
      const destination = path.join(app.getPath('userData'), 'updates', filename);
      publishUpdateState({ status: 'downloading', progress: { received: 0, total: Number(asset.size) || null, percent: 0 }, error: null });
      await downloadUpdate({ asset, destination, onProgress: progress => publishUpdateState({ status: 'downloading', progress }) });
      downloadedInstaller = destination;
      return publishUpdateState({ status: 'downloaded', progress: { received: Number(asset.size) || null, total: Number(asset.size) || null, percent: 100 } });
    } catch (error) {
      console.error('[桌面端] 下载更新失败：', error.message);
      return publishUpdateState({ status: 'error', error: error.message });
    } finally {
      updateJob = null;
    }
  })();
  return updateJob;
}

async function installDownloadedUpdate() {
  if (!downloadedInstaller || !fs.existsSync(downloadedInstaller)) throw new Error('尚未下载可安装的升级包');
  const choice = await dialog.showMessageBox(win, {
    type: 'question', buttons: ['立即升级', '稍后'], defaultId: 0, cancelId: 1,
    title: '安装行情日报更新', message: `已准备好 v${updateManifest?.version || ''}，升级时应用将自动关闭。`,
    detail: '自选股、设置、行情快照和历史复盘会继续保留。', noLink: true,
  });
  if (choice.response !== 0) return updateState;
  const child = spawn(downloadedInstaller, ['/S'], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  publishUpdateState({ status: 'installing' });
  isQuitting = true;
  setTimeout(() => app.quit(), 300);
  return updateState;
}

function startUpdateChecks() {
  setTimeout(() => checkForUpdates({ silent: true }), 15000);
  updateTimer = setInterval(() => checkForUpdates({ silent: true }), CHECK_INTERVAL_MS);
}

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
    onSuccess: async (result, date, slot) => {
      saveReviewMarkdown(date, result.markdown);
      if (slot.id === 'close') {
        const response = await fetch(`http://127.0.0.1:${PORT}/api/review?date=${encodeURIComponent(date)}&refresh=1`, { signal: AbortSignal.timeout(180000) });
        if (!response.ok) throw new Error(`完整复盘快照保存失败：HTTP ${response.status}`);
        await response.json();
      }
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
ipcMain.handle('desktop:update-state', () => updateState);
ipcMain.handle('desktop:check-update', () => checkForUpdates());
ipcMain.handle('desktop:download-update', () => downloadAvailableUpdate());
ipcMain.handle('desktop:install-update', () => installDownloadedUpdate());

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
  startUpdateChecks();
  app.on('activate', showWindow);
}).catch(error => {
  console.error('[桌面端] 初始化失败：', error);
  app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  if (scheduler) scheduler.stop();
  if (updateTimer) clearInterval(updateTimer);
  if (localServer) localServer.close();
  if (storage) storage.close();
});

app.on('window-all-closed', () => {
  // 托盘常驻：窗口关闭按钮只隐藏窗口，用户从托盘菜单退出应用。
});
}
