const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');

const REQUIRED_FREE_BYTES = 350 * 1024 * 1024;
const WINDOWS_MINIMUM = [10, 0, 10240];
const UNINSTALL_KEY = 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Hangqing Desktop';

function parseWindowsRelease(release) {
  const numbers = String(release || '').split('.').map(Number);
  if (numbers.length !== 3 || numbers.some(number => !Number.isFinite(number))) return null;
  return numbers;
}

function compareWindowsReleases(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1;
  }
  return 0;
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return '未知';
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  if (value >= 1024 ** 2) return `${Math.round(value / 1024 ** 2)} MB`;
  return `${Math.round(value / 1024)} KB`;
}

function formatArchitecture(architecture) {
  if (architecture === 'x64') return 'Windows 64 位（x64）';
  if (architecture === 'ia32') return 'Windows 32 位（x86）';
  return architecture || '未知';
}

function readRegistryValue(commandRunner, root, valueName) {
  try {
    const output = commandRunner('reg', [ 'query', root, '/v', valueName ], { encoding: 'utf8', windowsHide: true });
    const pattern = new RegExp(`${valueName}\\s+REG(?:_EXPAND_)?_(?:SZ|DWORD|QWORD)\\s+(.+?)\\s*$`, 'im');
    const match = String(output).match(pattern);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

function getFreeDiskSpace(directory) {
  const stats = fs.statfsSync(directory);
  return Number(stats.bavail) * Number(stats.bsize);
}

function detectVcRuntime(commandRunner = execFileSync, architecture = process.arch) {
  const keys = architecture === 'x64'
    ? [
        'HKLM\\SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64',
        'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64',
      ]
    : [
        'HKLM\\SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x86',
        'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x86',
      ];
  return keys.some(key => readRegistryValue(commandRunner, key, 'Installed') === '0x1');
}

function detectInstalledVersion(commandRunner = execFileSync) {
  return readRegistryValue(commandRunner, `HKCU\\${UNINSTALL_KEY}`, 'DisplayVersion');
}

function checkEnvironment(input = {}) {
  const platform = input.platform ?? process.platform;
  const architecture = input.architecture ?? process.arch;
  const windowsRelease = input.windowsRelease ?? (platform === 'win32' ? os.release() : '');
  const freeBytes = input.freeBytes ?? null;
  const hasVcRuntime = input.hasVcRuntime ?? null;
  const installedVersion = input.installedVersion ?? null;
  const release = parseWindowsRelease(windowsRelease);
  const windowsOk = platform === 'win32' && release && compareWindowsReleases(release, WINDOWS_MINIMUM) >= 0;
  const architectureOk = architecture === 'x64' || architecture === 'ia32';
  const diskOk = Number.isFinite(freeBytes) && freeBytes >= REQUIRED_FREE_BYTES;

  return {
    ready: platform === 'win32' && windowsOk && architectureOk && diskOk,
    platform: {
      ok: platform === 'win32',
      label: platform === 'win32' ? 'Windows' : '仅支持 Windows',
    },
    windows: {
      ok: Boolean(windowsOk),
      label: windowsOk ? `Windows ${release?.[0]}（版本 ${windowsRelease}）` : '需要 Windows 10 1803 或更新版本',
    },
    architecture: {
      ok: architectureOk,
      value: architectureOk ? architecture : null,
      label: architectureOk ? formatArchitecture(architecture) : `不支持的架构：${architecture || '未知'}`,
    },
    disk: {
      ok: Boolean(diskOk),
      available: freeBytes,
      required: REQUIRED_FREE_BYTES,
      label: freeBytes == null ? '磁盘空间未知' : `可用 ${formatBytes(freeBytes)}，需要至少 ${formatBytes(REQUIRED_FREE_BYTES)}`,
    },
    vcRuntime: {
      ok: hasVcRuntime === true,
      warningOnly: true,
      label: hasVcRuntime == null ? '未确认 VC++ 运行库，可继续安装' : hasVcRuntime ? 'VC++ 2015–2022 运行库已安装' : '未检测到 VC++ 运行库，建议安装后再使用',
    },
    installedVersion: {
      value: installedVersion,
      label: installedVersion ? `已安装 v${installedVersion}` : '未检测到已安装版本',
    },
  };
}

async function downloadWithRetry(operation, attempts = 3, { retryDelayMs = 1200, onRetry = () => {} } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        onRetry({ attempt, nextAttempt: attempt + 1, error });
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      }
    }
  }
  throw lastError;
}

function installerFilename(version, architecture) {
  if (!/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(version || ''))) throw new Error('安装包版本号无效');
  if (architecture !== 'x64' && architecture !== 'ia32') throw new Error('安装包架构无效');
  return `hangqing-desktop-${version}-win-${architecture}-setup.exe`;
}

module.exports = {
  REQUIRED_FREE_BYTES,
  UNINSTALL_KEY,
  checkEnvironment,
  compareWindowsReleases,
  detectInstalledVersion,
  detectVcRuntime,
  downloadWithRetry,
  formatArchitecture,
  formatBytes,
  getFreeDiskSpace,
  installerFilename,
  parseWindowsRelease,
};
