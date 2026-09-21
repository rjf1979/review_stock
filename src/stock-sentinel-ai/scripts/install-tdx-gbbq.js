#!/usr/bin/env node
// 智诊盯盘 · 为任意通达信数据根目录安装 / 刷新「除权除息」文件 gbbq
//
// 背景：vipdoc 的 .day 存的是未复权原始价，前复权必须靠 <root>/T0002/hq_cache/gbbq 里的
// 除权除息事件本地推导（见 tdx-vipdoc.js 的 buildQfqFactors / applyQfq）。用 datatool
// （通达信行情数据处理工具）产出的数据目录里没有这个文件，所以只能给出未复权序列、
// evidence.adjustmentMethod 记 none，契约判定为口径未知。
//
// 本脚本从通达信数据服务下载 dbf/gbbq.zip，只取出 gbbq 与 gbbq.map，用项目自己的解密链
// 校验可解析后原子写入目标目录。
//
// **这是 scripts/ 下唯一会联网的脚本**；其余分析、回测、核验工具一律只读本地数据。
// gbbq 是快照而不是流水：新除权除息不会自动进已装的文件，长期不用会让前复权悄悄失真，
// 所以它需要定期重跑（配合每日数据下载任务）。
//
// 用法：
//   node scripts/install-tdx-gbbq.js --root "D:\迅雷下载\datatool\data"
//   node scripts/install-tdx-gbbq.js --root "..." --dry-run          # 只下载校验并对比，不写盘
//   node scripts/install-tdx-gbbq.js --root "..." --from gbbq.zip    # 离线安装（不联网）
//   node scripts/install-tdx-gbbq.js --root "..." --force            # 覆盖前先备份
//
// 退出码：0 成功（含 dry-run 且校验通过）；1 校验失败或未安装；2 参数错误。
'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const { decodeGbbq } = require('../tdx-gbbq.js');

const DEFAULT_URL = 'http://124.220.54.32/products/data/data/dbf/gbbq.zip';
const PARTS = ['gbbq', 'gbbq.map'];
const MAX_REDIRECT = 3;

function parseArgs(argv) {
  const opts = { root: '', from: '', url: DEFAULT_URL, force: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root') opts.root = argv[++i] || '';
    else if (arg === '--from') opts.from = argv[++i] || '';
    else if (arg === '--url') opts.url = argv[++i] || '';
    else if (arg === '--force') opts.force = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else return { error: `未知参数：${arg}` };
  }
  if (opts.help) return opts;
  if (!opts.root) return { error: '缺少 --root（通达信数据根目录，其下应有 vipdoc/）' };
  return opts;
}

const USAGE = `用法：
  node scripts/install-tdx-gbbq.js --root <通达信数据根目录> [--dry-run] [--force]
  node scripts/install-tdx-gbbq.js --root <目录> --from <本地 gbbq.zip>   # 离线

  --root    目标根目录，脚本会写入 <root>/T0002/hq_cache/gbbq
  --from    已下载的 dbf/gbbq.zip，给了就不联网
  --url     数据包地址，默认 ${DEFAULT_URL}
  --dry-run 只下载、校验、对比，不写盘
  --force   覆盖已存在的 gbbq（先备份为 gbbq.<时间戳>.bak）`;

// ───────────────────────── 最小 ZIP 读取（不引第三方依赖） ─────────────────────────

function findEocd(buf) {
  const floor = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

function listEntries(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('不是有效的 zip：找不到中央目录结尾记录');
  const total = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < total; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) {
      throw new Error(`中央目录第 ${i + 1} 项签名异常`);
    }
    const compSize = buf.readUInt32LE(off + 20);
    if (compSize === 0xffffffff) throw new Error('该 zip 使用 ZIP64，本脚本不支持');
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    entries.push({
      name: buf.toString('utf8', off + 46, off + 46 + nameLen),
      method: buf.readUInt16LE(off + 10),
      rawSize: buf.readUInt32LE(off + 24),
      compSize,
      localOff: buf.readUInt32LE(off + 42),
    });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extractEntry(buf, entry) {
  const lo = entry.localOff;
  if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== 0x04034b50) {
    throw new Error(`本地文件头签名异常：${entry.name}`);
  }
  const start = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
  const data = buf.subarray(start, start + entry.compSize);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return zlib.inflateRawSync(data);
  throw new Error(`不支持的压缩方式 ${entry.method}：${entry.name}`);
}

// ───────────────────────── 下载 ─────────────────────────

function fetchBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'stock-sentinel-ai/install-tdx-gbbq' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects >= MAX_REDIRECT) return reject(new Error(`重定向次数超过 ${MAX_REDIRECT}`));
        const next = new URL(res.headers.location, url).toString();
        return fetchBuffer(next, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('下载超时（60s）')));
  });
}

// ───────────────────────── 校验与安装 ─────────────────────────

function describeGbbq(buffer, label) {
  const records = decodeGbbq(buffer);
  const cat1 = records.filter((r) => Number(r.category) === 1);
  const dates = cat1.map((r) => Number(r.date)).filter((d) => d > 19000000);
  const codes = new Set(records.map((r) => String(r.code || '')).filter(Boolean));
  return {
    label,
    bytes: buffer.length,
    records: records.length,
    cat1: cat1.length,
    codes: codes.size,
    first: dates.length ? Math.min(...dates) : 0,
    last: dates.length ? Math.max(...dates) : 0,
  };
}

function printStat(s) {
  console.log(`  ${s.label}：${s.bytes} 字节，总记录 ${s.records}，除权除息 ${s.cat1}，`
    + `覆盖代码 ${s.codes}，除权日 ${s.first} ~ ${s.last}`);
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.error) {
    console.error(`参数错误：${opts.error}\n\n${USAGE}`);
    return 2;
  }
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }

  const root = path.resolve(opts.root);
  const vipdoc = path.join(root, 'vipdoc');
  if (!fs.existsSync(vipdoc)) {
    console.error(`目标根目录下没有 vipdoc：${vipdoc}\n请确认 --root 指向通达信数据根目录（其下应有 vipdoc/）。`);
    return 2;
  }
  const destDir = path.join(root, 'T0002', 'hq_cache');

  console.log(`目标根目录：${root}`);
  console.log(`写入位置　：${path.join(destDir, 'gbbq')}`);

  let zipBuf;
  if (opts.from) {
    const src = path.resolve(opts.from);
    if (!fs.existsSync(src)) {
      console.error(`--from 指定的文件不存在：${src}`);
      return 2;
    }
    zipBuf = fs.readFileSync(src);
    console.log(`数据包来源：本地 ${src}（${zipBuf.length} 字节）`);
  } else {
    console.log(`数据包来源：${opts.url}`);
    zipBuf = await fetchBuffer(opts.url);
    console.log(`下载完成　：${zipBuf.length} 字节`);
  }

  const entries = listEntries(zipBuf);
  const missing = PARTS.filter((name) => !entries.some((e) => e.name === name));
  if (missing.length) {
    console.error(`数据包里缺少必需条目：${missing.join('、')}`);
    console.error(`包内条目：${entries.map((e) => e.name).join(', ')}`);
    return 1;
  }

  const fresh = {};
  for (const name of PARTS) {
    fresh[name] = extractEntry(zipBuf, entries.find((e) => e.name === name));
  }

  console.log('校验数据包：');
  let stat;
  try {
    stat = describeGbbq(fresh.gbbq, '包内 gbbq');
    printStat(stat);
  } catch (e) {
    console.error(`  包内 gbbq 无法解析：${e.message}`);
    console.error('  该文件与项目的解密链不兼容，已放弃安装（不写盘）。');
    return 1;
  }

  const destFile = path.join(destDir, 'gbbq');
  const existed = fs.existsSync(destFile);
  if (existed) {
    console.log('目标目录现有 gbbq：');
    try {
      printStat(describeGbbq(fs.readFileSync(destFile), '现有 gbbq'));
    } catch (e) {
      console.log(`  现有 gbbq 无法解析：${e.message}`);
    }
  } else {
    console.log('目标目录当前没有 gbbq（这就是 datatool 目录只能出未复权的原因）。');
  }

  if (opts.dryRun) {
    console.log('--dry-run：校验通过，未写盘。');
    return 0;
  }
  if (existed && !opts.force) {
    console.error('目标已存在 gbbq，未指定 --force，不覆盖。'
      + '（上面的对比可供判断是否需要刷新；确认要换成包内版本请加 --force）');
    return 1;
  }

  fs.mkdirSync(destDir, { recursive: true });
  if (existed && opts.force) {
    const bak = path.join(destDir, `gbbq.${stamp()}.bak`);
    fs.copyFileSync(destFile, bak);
    console.log(`已备份原文件：${bak}`);
  }
  for (const name of PARTS) {
    const target = path.join(destDir, name);
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, fresh[name]);
    fs.renameSync(tmp, target);
  }
  console.log('安装完成：');
  for (const name of PARTS) {
    const target = path.join(destDir, name);
    console.log(`  ${target}  ${fs.statSync(target).size} 字节`);
  }
  console.log(`提示：gbbq 是快照而非流水，新增除权除息不会自动进来，需定期重跑本脚本。`
    + `当前包内最新除权日 ${stat.last}。`);
  return 0;
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error(`失败：${e.message}`);
  process.exit(1);
});
