// 行情日报 Desktop · Electron 外壳
const { app, BrowserWindow, Tray, Menu, Notification, nativeImage, ipcMain, screen } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const review = require('./review-core');
const { createReviewScheduler } = require('./review-scheduler');
const { startServer } = require('./server');
const { createStorage } = require('./storage');
const { DEFAULT_MANIFEST_URL, CHECK_INTERVAL_MS, compareVersions, selectAsset, fetchManifest, downloadUpdate } = require('./updater');
const { createTelemetry } = require('./telemetry');

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
let monitorWin;
let monitorEnabled = false;
let monitorReady = false;
let monitorOnMainClose = false;
let scheduler;
let savedState = {};
let storage;
let localServer;
let telemetry;
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

let confirmSeq = 0;
const confirmWaiters = new Map();
function confirmFromWindow(payload) {
  if (!win || win.isDestroyed() || !win.webContents) return Promise.resolve(false);
  return new Promise(resolve => {
    confirmSeq += 1;
    const id = confirmSeq;
    confirmWaiters.set(id, resolve);
    win.webContents.send('desktop:show-confirm', { id, ...payload });
  });
}
ipcMain.on('desktop:confirm-result', (_event, { id, ok }) => {
  const resolve = confirmWaiters.get(id);
  if (resolve) { confirmWaiters.delete(id); resolve(Boolean(ok)); }
});

async function installDownloadedUpdate() {
  if (!downloadedInstaller || !fs.existsSync(downloadedInstaller)) throw new Error('尚未下载可安装的升级包');
  const proceed = await confirmFromWindow({
    type: 'question',
    title: '安装行情日报更新',
    message: `已准备好 v${updateManifest?.version || ''}，升级时应用将自动关闭。`,
    detail: '自选股、设置、行情快照和历史复盘会继续保留。',
    okLabel: '立即升级',
    cancelLabel: '稍后',
  });
  if (!proceed) return updateState;
  const child = spawn(downloadedInstaller, [], { detached: true, stdio: 'ignore', windowsHide: false });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();
  publishUpdateState({ status: 'installing' });
  isQuitting = true;
  setTimeout(() => app.quit(), 500);
  return updateState;
}

function startUpdateChecks() {
  setTimeout(() => checkForUpdates({ silent: true }), 15000);
  updateTimer = setInterval(() => checkForUpdates({ silent: true }), CHECK_INTERVAL_MS);
}

function statePath() {
  return path.join(app.getPath('userData'), 'desktop-state.json');
}

function telemetryEnabled() {
  return app.isPackaged || Boolean(process.env.TELEMETRY_ENDPOINT);
}

function installTelemetryErrorHandlers() {
  const originalConsoleError = console.error.bind(console);
  console.error = (...args) => {
    originalConsoleError(...args);
    try {
      const message = args.map(arg => {
        if (arg instanceof Error) return arg.stack || arg.message;
        if (typeof arg === 'string') return arg;
        try { return JSON.stringify(arg); } catch { return String(arg); }
      }).join(' ').slice(0, 500);
      telemetry?.captureError(new Error(message), 'console');
    } catch {}
  };
  process.on('uncaughtException', error => {
    try { telemetry?.captureError(error, 'uncaughtException'); } catch {}
  });
  process.on('unhandledRejection', reason => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    try { telemetry?.captureError(error, 'unhandledRejection'); } catch {}
  });
}

function loadState() {
  storage.migrateLegacyFiles();
  savedState = storage.getSettings();
  notifyEnabled = savedState.notify === true;
  monitorEnabled = false;
  monitorOnMainClose = savedState.monitorOnMainClose === true;
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

const MONITOR_DEFAULT_WIDTH = 300;
const MONITOR_DEFAULT_HEIGHT = 200;
function normalizeMonitorOpacity(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : 60;
}

function clampMonitorBounds(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const width = Math.round(Math.min(Math.max(Number(raw.width) || MONITOR_DEFAULT_WIDTH, 260), 560));
  const height = Math.round(Math.min(Math.max(Number(raw.height) || MONITOR_DEFAULT_HEIGHT, 200), 820));
  const areas = screen.getAllDisplays().map(display => display.workArea);
  const area = areas.find(work => {
    const overlapWidth = Math.min(raw.x + width, work.x + work.width) - Math.max(raw.x, work.x);
    const overlapHeight = Math.min(raw.y + height, work.y + work.height) - Math.max(raw.y, work.y);
    return overlapWidth >= 48 && overlapHeight >= 48;
  });
  if (!area) return null;
  return {
    x: Math.round(Math.max(area.x, Math.min(raw.x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(raw.y, area.y + area.height - height))),
    width,
    height,
  };
}

function resolveMonitorBounds() {
  const restored = clampMonitorBounds(savedState.monitorBounds);
  if (restored) return restored;
  const primary = screen.getPrimaryDisplay().workArea;
  return {
    x: primary.x + primary.width - MONITOR_DEFAULT_WIDTH - 28,
    y: primary.y + 28,
    width: MONITOR_DEFAULT_WIDTH,
    height: MONITOR_DEFAULT_HEIGHT,
  };
}

let monitorBoundsTimer;
function scheduleMonitorBoundsSave() {
  clearTimeout(monitorBoundsTimer);
  monitorBoundsTimer = setTimeout(() => {
    if (!monitorWin || monitorWin.isDestroyed()) return;
    saveState({ monitorBounds: monitorWin.getBounds() });
  }, 400);
}

function createMonitorWindow() {
  if (monitorWin && !monitorWin.isDestroyed()) return monitorWin;
  monitorReady = false;
  monitorWin = new BrowserWindow({
    ...resolveMonitorBounds(),
    minWidth: 260,
    minHeight: 200,
    frame: false,
    transparent: true,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    show: false,
    title: '股市脉搏 v0.2.5 · 行情监控',
    icon: APP_ICON,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  monitorWin.setAlwaysOnTop(true, 'screen-saver');
  monitorWin.on('move', scheduleMonitorBoundsSave);
  monitorWin.on('resize', scheduleMonitorBoundsSave);
  monitorWin.on('close', event => {
    if (!isQuitting) {
      event.preventDefault();
      setMonitorEnabled(false);
    }
  });
  monitorWin.loadURL(`http://localhost:${PORT}/?mode=monitor`);
  return monitorWin;
}

function isMonitorVisibleOnScreen(bounds) {
  const areas = screen.getAllDisplays().map(display => display.workArea);
  return areas.some(work => {
    const overlapWidth = Math.min(bounds.x + bounds.width, work.x + work.width) - Math.max(bounds.x, work.x);
    const overlapHeight = Math.min(bounds.y + bounds.height, work.y + work.height) - Math.max(bounds.y, work.y);
    return overlapWidth >= 48 && overlapHeight >= 48;
  });
}

function showMonitorWindow() {
  const target = createMonitorWindow();
  const current = target.getBounds();
  if (!isMonitorVisibleOnScreen(current)) {
    target.setBounds(resolveMonitorBounds());
  }
  if (monitorReady) target.showInactive();
  publishMonitorState();
}

function hideMonitorWindow() {
  if (!monitorWin || monitorWin.isDestroyed()) return;
  monitorWin.hide();
  publishMonitorState();
}

function refitMonitorWindow() {
  if (!monitorWin || monitorWin.isDestroyed() || !monitorWin.isVisible()) return;
  monitorWin.setBounds(resolveMonitorBounds());
}

function monitorState() {
  return {
    enabled: monitorEnabled,
    visible: Boolean(monitorWin && !monitorWin.isDestroyed() && monitorWin.isVisible()),
    watchlist: Array.isArray(savedState.monitorWatchlist) ? savedState.monitorWatchlist : [],
    opacity: normalizeMonitorOpacity(savedState.monitorOpacity),
    onMainClose: monitorOnMainClose,
  };
}

function publishMonitorState() {
  const state = monitorState();
  [win, monitorWin].forEach(target => {
    if (target && !target.isDestroyed()) target.webContents.send('desktop:monitor-state-changed', state);
  });
  return state;
}

function setMonitorEnabled(value) {
  const next = Boolean(value);
  monitorEnabled = next;
  saveState({ monitorEnabled: next });
  if (next) showMonitorWindow(); else hideMonitorWindow();
  updateTrayMenu();
  return publishMonitorState();
}

function setMonitorWatchlist(codes) {
  const allowed = new Set(storage ? storage.getWatchlist() : []);
  const clean = (Array.isArray(codes) ? codes : [])
    .map(code => String(code))
    .filter((code, index, all) => /^\d{6}$/.test(code) && allowed.has(code) && all.indexOf(code) === index)
    .slice(0, 5);
  savedState = { ...savedState, monitorWatchlist: clean };
  if (storage) storage.setSettings({ monitorWatchlist: clean });
  return publishMonitorState();
}

function setMonitorOpacity(value) {
  const opacity = normalizeMonitorOpacity(value);
  saveState({ monitorOpacity: opacity });
  return publishMonitorState();
}

function setMonitorOnMainClose(value) {
  monitorOnMainClose = value === true;
  saveState({ monitorOnMainClose });
  return publishMonitorState();
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
    title: '股市脉搏 v0.2.5',
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
    if (monitorOnMainClose) setMonitorEnabled(true);
  });
  win.setResizable(false);
  win.setMaximizable(false);
  win.on('restore', () => setImmediate(fitWindowToDisplay));
  load();
}

function createTray() {
  const icon = nativeImage.createFromPath(APP_ICON).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('股市脉搏 v0.2.5');
  tray.on('double-click', showWindow);
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开股市脉搏', click: showWindow },
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
    {
      label: '透明浮窗监控',
      type: 'checkbox',
      checked: monitorEnabled,
      click: item => { setMonitorEnabled(item.checked); },
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
      notify('每日复盘已生成', date + ' · ' + slot.label + ' · 市场温度 ' + result.temperature + '°，打开股市脉搏查看');
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

ipcMain.handle('desktop:monitor-state', () => monitorState());
ipcMain.handle('desktop:monitor-set-enabled', (_event, enabled) => setMonitorEnabled(Boolean(enabled)));
ipcMain.handle('desktop:monitor-show', () => setMonitorEnabled(true));
ipcMain.handle('desktop:monitor-hide', () => setMonitorEnabled(false));
ipcMain.handle('desktop:monitor-toggle', () => {
  if (monitorWin && !monitorWin.isDestroyed() && monitorWin.isVisible()) {
    return setMonitorEnabled(false);
  }
  return setMonitorEnabled(true);
});
ipcMain.handle('desktop:monitor-set-watchlist', (_event, codes) => setMonitorWatchlist(codes));
ipcMain.handle('desktop:monitor-set-opacity', (_event, opacity) => setMonitorOpacity(opacity));
ipcMain.handle('desktop:monitor-set-on-main-close', (_event, enabled) => setMonitorOnMainClose(Boolean(enabled)));
ipcMain.on('desktop:monitor-open-main', showWindow);
ipcMain.on('desktop:monitor-close-window', event => {
  if (!monitorWin || monitorWin.isDestroyed()) return;
  if (event.sender !== monitorWin.webContents) return;
  setMonitorEnabled(false);
});
ipcMain.on('desktop:monitor-ready', event => {
  if (!monitorWin || monitorWin.isDestroyed() || event.sender !== monitorWin.webContents) return;
  monitorReady = true;
  if (monitorEnabled) monitorWin.showInactive();
  publishMonitorState();
});
ipcMain.on('desktop:monitor-resize', (event, width, height) => {
  if (!monitorWin || monitorWin.isDestroyed()) return;
  if (event.sender !== monitorWin.webContents) return;
  const current = monitorWin.getBounds();
  const parsedWidth = Number(width);
  const parsedHeight = Number(height);
  const nextWidth = width != null && Number.isFinite(parsedWidth) ? Math.min(560, Math.max(260, Math.round(parsedWidth))) : current.width;
  const nextHeight = height != null && Number.isFinite(parsedHeight) ? Math.min(820, Math.max(200, Math.round(parsedHeight))) : current.height;
  const nextBounds = clampMonitorBounds({ ...current, width: nextWidth, height: nextHeight });
  if (nextBounds) monitorWin.setBounds(nextBounds);
});

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  storage = await createStorage({
    dbPath: path.join(userData, 'hangqing.sqlite'),
    legacyStatePath: statePath(),
    legacyReviewsDir: path.join(userData, 'reviews'),
  });
  loadState();
  telemetry = createTelemetry({
    storage,
    queuePath: path.join(userData, 'telemetry-queue.json'),
    appVersion: app.getVersion(),
    arch: process.arch,
    osVersion: `${process.platform} ${os.release()}`,
    enabled: telemetryEnabled,
  });
  installTelemetryErrorHandlers();
  const installedNow = telemetry.reportInstall();
  if (!installedNow) telemetry.reportStartup();
  localServer = await startServer({ storage, port: PORT });
  createWindow();
  screen.on('display-metrics-changed', () => { fitWindowToDisplay(); refitMonitorWindow(); });
  screen.on('display-removed', () => { fitWindowToDisplay(); refitMonitorWindow(); });
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
  clearTimeout(monitorBoundsTimer);
  if (monitorWin && !monitorWin.isDestroyed()) monitorWin.destroy();
  if (telemetry) {
    telemetry.reportClose();
    telemetry.close();
  }
  if (storage) storage.close();
});

app.on('window-all-closed', () => {
  // 托盘常驻：窗口关闭按钮只隐藏窗口，用户从托盘菜单退出应用。
});
}
