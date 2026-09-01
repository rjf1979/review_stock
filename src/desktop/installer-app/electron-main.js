const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { compareVersions, DEFAULT_MANIFEST_URL, downloadUpdate, fetchManifest, selectAsset } = require('../updater');
const {
  checkEnvironment,
  detectInstalledVersion,
  detectVcRuntime,
  downloadWithRetry,
  getFreeDiskSpace,
  installerFilename,
} = require('../installer-core');

if (process.platform === 'win32') app.setAppUserModelId('io.zhicha.dailystock.installer');

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  let mainWindow;
  let installJob;

  function downloadDirectory() {
    const directory = path.join(app.getPath('downloads'), 'StockPulse');
    fs.mkdirSync(directory, { recursive: true });
    return directory;
  }

  function readEnvironment() {
    const directory = downloadDirectory();
    const environment = checkEnvironment({
      freeBytes: getFreeDiskSpace(directory),
      hasVcRuntime: detectVcRuntime(),
      installedVersion: detectInstalledVersion(),
    });
    return { ...environment, downloadDirectory: directory };
  }

  function publish(state) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('installer:state-changed', state);
    return state;
  }

  async function startInstall() {
    if (installJob) return installJob;
    installJob = (async () => {
      try {
        const environment = readEnvironment();
        if (!environment.ready) throw new Error('当前电脑暂不满足安装条件');
        publish({ phase: 'checking', message: '正在检查环境和最新版本…' });

        const manifest = await fetchManifest(process.env.UPDATE_MANIFEST_URL || DEFAULT_MANIFEST_URL);
        const architecture = environment.architecture.value;
        if (environment.installedVersion.value && compareVersions(environment.installedVersion.value, manifest.version) > 0) {
          throw new Error(`本机已安装更高版本 v${environment.installedVersion.value}，无需降级`);
        }
        const asset = selectAsset(manifest, architecture);
        const destination = path.join(environment.downloadDirectory, installerFilename(manifest.version, architecture));
        publish({
          phase: 'downloading',
          message: `正在下载 v${manifest.version} ${architecture === 'x64' ? '64 位' : '32 位'}安装包…`,
          version: manifest.version,
          notes: manifest.notes || [],
          progress: { received: 0, total: Number(asset.size) || null, percent: 0 },
        });

        await downloadWithRetry(
          () => downloadUpdate({
            asset,
            destination,
            onProgress: progress => publish({ phase: 'downloading', message: '正在下载安装包…', version: manifest.version, notes: manifest.notes || [], progress }),
          }),
          3,
          { retryDelayMs: 1500, onRetry: ({ nextAttempt }) => publish({ phase: 'downloading', message: `下载中断，正在进行第 ${nextAttempt} 次尝试…`, version: manifest.version, progress: null }) },
        );

        publish({ phase: 'launching', message: '下载完成，正在启动 Windows 安装向导…', version: manifest.version, notes: manifest.notes || [], progress: { received: Number(asset.size) || null, total: Number(asset.size) || null, percent: 100 } });
        const launchError = await shell.openPath(destination);
        if (launchError) throw new Error(launchError);
        return publish({ phase: 'success', message: '安装向导已启动，请按屏幕提示完成安装。', version: manifest.version, notes: manifest.notes || [], destination });
      } catch (error) {
        return publish({ phase: 'error', message: error.message || '安装准备失败', error: error.message || String(error) });
      } finally {
        installJob = null;
      }
    })();
    return installJob;
  }

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 520,
      height: 680,
      minWidth: 420,
      minHeight: 560,
      resizable: true,
      title: '股市脉搏安装助手',
      backgroundColor: '#f7f7f2',
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, 'preload.js'),
      },
    });
    mainWindow.once('ready-to-show', () => mainWindow.show());
    mainWindow.loadFile(path.join(__dirname, 'index.html'));
  }

  ipcMain.handle('installer:environment', () => readEnvironment());
  ipcMain.handle('installer:start', () => startInstall());

  app.whenReady().then(createWindow);
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
