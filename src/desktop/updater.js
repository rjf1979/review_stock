const { createHash } = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_MANIFEST_URL = 'https://dailystock.zhicha.io/updates/latest.json';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function parseVersion(value) {
  const match = String(value || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return { numbers: match.slice(1, 4).map(Number), prerelease: match[4] || '' };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error('版本号格式不正确');
  for (let index = 0; index < 3; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] > b.numbers[index] ? 1 : -1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease, 'en', { numeric: true });
}

function selectAsset(manifest, arch = process.arch) {
  const asset = manifest?.assets?.[arch];
  if (!asset?.url || !/^[a-f0-9]{64}$/i.test(asset.sha256 || '')) throw new Error(`升级清单缺少 ${arch} 安装包或校验值`);
  if (new URL(asset.url).protocol !== 'https:') throw new Error('正式升级包必须使用 HTTPS 地址');
  return asset;
}

function validateManifest(manifest) {
  if (!parseVersion(manifest?.version)) throw new Error('升级清单版本号无效');
  if (!manifest?.publishedAt || Number.isNaN(Date.parse(manifest.publishedAt))) throw new Error('升级清单发布时间无效');
  return manifest;
}

async function fetchManifest(url = DEFAULT_MANIFEST_URL) {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000), cache: 'no-store' });
  if (!response.ok) throw new Error(`检查更新失败：HTTP ${response.status}`);
  return validateManifest(await response.json());
}

async function downloadUpdate({ asset, destination, onProgress = () => {} }) {
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(30 * 60 * 1000), redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`升级包下载失败：HTTP ${response.status}`);
  const expectedSize = Number(asset.size) || Number(response.headers.get('content-length')) || null;
  const temporary = `${destination}.download`;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.rmSync(temporary, { force: true });
  const output = fs.createWriteStream(temporary, { flags: 'wx' });
  const hash = createHash('sha256');
  let received = 0;
  try {
    for await (const chunk of response.body) {
      received += chunk.length;
      hash.update(chunk);
      if (!output.write(chunk)) await new Promise(resolve => output.once('drain', resolve));
      onProgress({ received, total: expectedSize, percent: expectedSize ? Math.min(100, Math.round(received / expectedSize * 100)) : null });
    }
    await new Promise((resolve, reject) => output.end(error => error ? reject(error) : resolve()));
    if (expectedSize && received !== expectedSize) throw new Error('升级包大小与清单不一致');
    const digest = hash.digest('hex');
    if (digest.toLowerCase() !== asset.sha256.toLowerCase()) throw new Error('升级包 SHA-256 校验失败');
    fs.rmSync(destination, { force: true });
    fs.renameSync(temporary, destination);
    return { destination, size: received, sha256: digest };
  } catch (error) {
    output.destroy();
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

module.exports = { DEFAULT_MANIFEST_URL, CHECK_INTERVAL_MS, parseVersion, compareVersions, selectAsset, validateManifest, fetchManifest, downloadUpdate };
