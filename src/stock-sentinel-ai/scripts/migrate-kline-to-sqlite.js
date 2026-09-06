#!/usr/bin/env node
// 量能洞察 · 一次性迁移：把 data/kline/<code>.json（逐票一天一文件）导入 SQLite kline 表。
// 用法： node scripts/migrate-kline-to-sqlite.js [--delete]
//   --delete  迁移成功后删除旧的 data/kline 目录（默认仅迁移，不删除原文件）。
const fs = require('fs');
const path = require('path');
const storage = require('../storage');

const KLINE_DIR = path.join(storage.DATA_DIR, 'kline');
const DELETE_AFTER = process.argv.includes('--delete');

async function main() {
  if (!fs.existsSync(KLINE_DIR)) {
    console.log(`无旧 K 线目录可迁移（${KLINE_DIR}）`);
    return;
  }
  const files = fs.readdirSync(KLINE_DIR).filter((f) => /^\d{6}\.json$/.test(f));
  let ok = 0, skipped = 0, fail = 0;
  const start = Date.now();
  for (const f of files) {
    const code = f.replace(/\.json$/, '');
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(KLINE_DIR, f), 'utf8'));
      const kline = raw && Array.isArray(raw.kline) ? raw.kline : [];
      if (!kline.length) { skipped += 1; continue; }
      const done = await storage.writeKline(code, kline, raw.date || '');
      if (done) ok += 1; else fail += 1;
    } catch {
      fail += 1;
    }
  }
  console.log(`迁移完成：文件 ${files.length}，成功 ${ok}，跳过(空) ${skipped}，失败 ${fail}，耗时 ${((Date.now() - start) / 1000).toFixed(1)}s`);
  await storage.flush();
  console.log(`SQLite 库：${storage.DB_FILE}`);
  console.log(`当前缓存股票数：${(await storage.listKlineDates()).length}`);
  if (DELETE_AFTER) {
    if (fail === 0) {
      fs.rmSync(KLINE_DIR, { recursive: true, force: true });
      console.log(`已删除旧目录：${KLINE_DIR}`);
    } else {
      console.log(`存在 ${fail} 个失败文件，为防数据丢失未删除旧目录。`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
