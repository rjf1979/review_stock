// 只读盘点历史批次覆盖情况（第十五阶段 D15-03）。
// 用法：npm run inventory:selection-archives -- [--out <文件>] [--no-verify]
// 只读：不写入任何归档、不初始化数据库 schema、不导出数据库；只输出机器可读 JSON。
const fs = require('fs');
const path = require('path');
const { inventorySelectionArchives } = require('../kline-archive-inventory');

function parseArgs(argv) {
  const options = { out: '', verify: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') options.out = String(argv[++i] || '');
    else if (arg === '--no-verify') options.verify = false;
  }
  return options;
}

const args = parseArgs(process.argv.slice(2));

inventorySelectionArchives({ verifyKline: args.verify })
  .then((report) => {
    const text = `${JSON.stringify(report, null, 2)}\n`;
    if (args.out) {
      const target = path.resolve(args.out);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, text, 'utf8');
      console.log(`已写入盘点报告：${target}`);
      return;
    }
    process.stdout.write(text);
  })
  .catch((error) => {
    console.error((error && error.message) || error);
    process.exitCode = 1;
  });
