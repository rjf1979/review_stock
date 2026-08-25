const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const changelog = JSON.parse(fs.readFileSync(path.join(root, 'frontend', 'changelog.json'), 'utf8'));
const latest = Array.isArray(changelog.releases) ? changelog.releases[0] : null;

if (!latest || latest.version !== pkg.version) {
  throw new Error(`更新日志最新版本必须与 package.json 一致：${latest?.version || '缺失'} / ${pkg.version}`);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(latest.date) || !Array.isArray(latest.changes) || !latest.changes.length) {
  throw new Error(`版本 ${pkg.version} 的更新日志缺少日期或改动内容`);
}

console.log(`更新日志校验通过：v${pkg.version}`);
