const { createHash } = require('crypto');
const fs = require('fs');
const path = require('path');

const desktopRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(desktopRoot, '..', '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'));
const changelog = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'frontend', 'changelog.json'), 'utf8'));
const version = packageJson.version;
const release = changelog.releases.find(item => item.version === version);
if (!release) throw new Error(`更新日志缺少 v${version}`);

function asset(arch) {
  const filename = `hangqing-desktop-${version}-win-${arch}-setup.exe`;
  const file = path.join(desktopRoot, 'release', filename);
  if (!fs.existsSync(file)) throw new Error(`缺少安装包：${file}`);
  const content = fs.readFileSync(file);
  return { url: `https://dailystock.zhicha.io/updates/files/${filename}`, size: content.length, sha256: createHash('sha256').update(content).digest('hex') };
}

const manifest = {
  version,
  publishedAt: new Date().toISOString(),
  notes: release.changes,
  assets: { x64: asset('x64'), ia32: asset('ia32') },
};
const output = path.join(repositoryRoot, 'src', 'web', 'public', 'updates', 'latest.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`已生成 ${output}`);
