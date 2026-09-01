const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkEnvironment, downloadWithRetry, installerFilename, parseWindowsRelease } = require('./installer-core');

assert.deepStrictEqual(parseWindowsRelease('10.0.19045'), [10, 0, 19045]);
assert.strictEqual(parseWindowsRelease('bad'), null);

const supported = checkEnvironment({
  platform: 'win32',
  architecture: 'x64',
  windowsRelease: '10.0.19045',
  freeBytes: 400 * 1024 * 1024,
  hasVcRuntime: true,
});
assert.strictEqual(supported.ready, true);
assert.strictEqual(supported.architecture.value, 'x64');

assert.strictEqual(checkEnvironment({ platform: 'darwin' }).ready, false);
assert.strictEqual(checkEnvironment({ platform: 'win32', windowsRelease: '6.3.9600' }).windows.ok, false);
assert.strictEqual(checkEnvironment({ platform: 'win32', architecture: 'arm64' }).architecture.ok, false);
assert.strictEqual(checkEnvironment({ platform: 'win32', freeBytes: 300 * 1024 * 1024 }).disk.ok, false);

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'installer-core-'));
assert.ok(Number(checkEnvironment({ freeBytes: require('./installer-core').getFreeDiskSpace(tempDirectory) }).disk.available) > 0);
fs.rmSync(tempDirectory, { recursive: true, force: true });

assert.strictEqual(installerFilename('0.3.9', 'ia32'), 'hangqing-desktop-0.3.9-win-ia32-setup.exe');
assert.throws(() => installerFilename('latest', 'x64'), /版本号/);
assert.throws(() => installerFilename('0.3.9', 'arm64'), /架构/);

(async () => {
  let attempts = 0;
  const retried = [];
  const result = await downloadWithRetry(async attempt => {
    attempts = attempt;
    if (attempt < 3) throw new Error(`interrupted ${attempt}`);
    return `ok-${attempt}`;
  }, 3, { retryDelayMs: 0, onRetry: payload => retried.push(payload.nextAttempt) });
  assert.strictEqual(result, 'ok-3');
  assert.strictEqual(attempts, 3);
  assert.deepStrictEqual(retried, [2, 3]);

  await assert.rejects(() => downloadWithRetry(async () => { throw new Error('always fails'); }, 2, { retryDelayMs: 0 }), /always fails/);
})();
