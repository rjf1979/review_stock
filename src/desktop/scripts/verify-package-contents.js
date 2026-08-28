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
const archives = {
  x64: path.join(root, 'release', 'win-unpacked', 'resources', 'app.asar'),
  ia32: path.join(root, 'release', 'win-ia32-unpacked', 'resources', 'app.asar')
};
const requestedArch = process.argv[2];
if (requestedArch && !archives[requestedArch]) throw new Error(`不支持的架构：${requestedArch}`);

for (const archive of requestedArch ? [archives[requestedArch]] : Object.values(archives)) {
  if (!fs.existsSync(archive)) throw new Error(`缺少构建归档：${archive}`);
  const entries = new Set(asar.listPackage(archive).map(entry => entry.replaceAll('\\', '/').replace(/^\//, '')));
  const missing = requiredFiles.filter(file => !entries.has(file));
  if (missing.length) throw new Error(`${archive} 缺少主进程文件：${missing.join(', ')}`);
  const packageJson = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
  if (packageJson.name !== 'hangqing-desktop') throw new Error(`${archive} 的应用标识会改变既有用户数据目录：${packageJson.name}`);
  console.log(`归档校验通过：${path.relative(root, archive)}`);
}
