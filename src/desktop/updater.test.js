const assert = require('assert');
const { createHash } = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { compareVersions, selectAsset, validateManifest, downloadUpdate } = require('./updater');

assert.strictEqual(compareVersions('0.2.2', '0.2.1'), 1);
assert.strictEqual(compareVersions('v1.0.0', '1.0.0'), 0);
assert.strictEqual(compareVersions('1.0.0-beta.1', '1.0.0'), -1);
assert.strictEqual(compareVersions('1.10.0', '1.9.9'), 1);
const manifest = validateManifest({ version: '0.2.2', publishedAt: '2026-08-27T00:00:00Z', assets: { x64: { url: 'https://example.com/x64.exe', sha256: 'a'.repeat(64) } } });
assert.strictEqual(selectAsset(manifest, 'x64').url, 'https://example.com/x64.exe');
assert.throws(() => selectAsset(manifest, 'ia32'), /ia32/);
assert.throws(() => selectAsset({ ...manifest, assets: { x64: { ...manifest.assets.x64, url: 'http://example.com/x64.exe' } } }, 'x64'), /HTTPS/);
assert.throws(() => validateManifest({ version: 'latest' }), /版本号/);

async function testDownload() {
  const content = Buffer.from('verified update payload');
  const sha256 = createHash('sha256').update(content).digest('hex');
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Length': content.length }); res.end(content); });
  let port = 32123;
  while (port < 32140) {
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
      break;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
      server.removeAllListeners('error');
      port += 1;
    }
  }
  if (!server.listening) throw new Error('没有可用的本地测试端口');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hangqing-update-test-'));
  const destination = path.join(directory, 'update.exe');
  try {
    const url = `http://127.0.0.1:${port}/update.exe`;
    const result = await downloadUpdate({ asset: { url, size: content.length, sha256 }, destination });
    assert.strictEqual(result.sha256, sha256);
    assert.deepStrictEqual(fs.readFileSync(destination), content);
    await assert.rejects(downloadUpdate({ asset: { url, size: content.length, sha256: '0'.repeat(64) }, destination: `${destination}.bad` }), /SHA-256/);
    assert.strictEqual(fs.existsSync(`${destination}.bad.download`), false);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

testDownload().then(() => console.log('updater tests passed')).catch(error => { console.error(error); process.exitCode = 1; });
