const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

const root = path.resolve(__dirname, '..');
const requiredFiles = [
  'electron-main.js',
  'preload.js',
  'server.js',
  'storage.js',
  'review-core.js',
  'review-scheduler.js',
  'updater.js',
  'telemetry.js'
];
const archives = [
  path.join(root, 'release', 'win-unpacked', 'resources', 'app.asar'),
  path.join(root, 'release', 'win-ia32-unpacked', 'resources', 'app.asar')
];

for (const archive of archives) {
  if (!fs.existsSync(archive)) throw new Error(`缺少构建归档：${archive}`);
  const entries = new Set(asar.listPackage(archive).map(entry => entry.replaceAll('\\', '/').replace(/^\//, '')));
  const missing = requiredFiles.filter(file => !entries.has(file));
  if (missing.length) throw new Error(`${archive} 缺少主进程文件：${missing.join(', ')}`);
  console.log(`归档校验通过：${path.relative(root, archive)}`);
}
