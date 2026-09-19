// 智诊盯盘 · 通达信本地「股本变迁」(gbbq) 解析
//
// 用途：vipdoc 的 .day 文件只有未复权价格，前复权必须靠除权除息事件推导。
// 通达信把全部除权除息记录放在 <tdxRoot>/T0002/hq_cache/gbbq，文件本身按固定密钥表
// 做逐记录异或/加法混淆；本模块按公开实现（pytdx gbbq_reader，字段布局 <B7sIBffff>，
// 每条 4(计数) 头 + 29 字节记录）在本地解密并索引，只读，不改写通达信任何文件。
//
// 记录字段（category=1 即除权除息，前复权只用这一类）：
//   datetime=除权除息日(YYYYMMDD)，hongli=每 10 股现金红利(元)，
//   peigujia=配股价(元)，songgu=每 10 股送转股，peigu=每 10 股配股。
const fs = require('fs');
const path = require('path');

// 固定密钥表（4176 字节），随包分发的二进制资产，避免在源码里塞 8KB 十六进制字面量。
const KEY_FILE = path.join(__dirname, 'assets', 'gbbq-keys.bin');
const KEY_BYTES = 4176;
const RECORD_BYTES = 29;

let keysCache = null;
function keys() {
  if (keysCache) return keysCache;
  const buf = fs.readFileSync(KEY_FILE);
  if (buf.length !== KEY_BYTES) throw new Error(`gbbq 密钥表长度异常：${buf.length}`);
  keysCache = buf;
  return keysCache;
}

// 单个 8 字节块的解密：与公开实现逐位对齐，全部按 uint32 回绕。
function decodeBlock(lo, hi, key) {
  let num = (key.readUInt32LE(0x44) ^ lo) >>> 0;
  let numold = hi >>> 0;
  for (let j = 0x40; j >= 0x04; j -= 0x04) {
    let eax = key.readUInt32LE(((num >>> 16) & 0xff) * 4 + 0x448);
    eax = (eax + key.readUInt32LE((num >>> 24) * 4 + 0x48)) >>> 0;
    eax = (eax ^ key.readUInt32LE(((num >>> 8) & 0xff) * 4 + 0x848)) >>> 0;
    eax = (eax + key.readUInt32LE((num & 0xff) * 4 + 0xc48)) >>> 0;
    eax = (eax ^ key.readUInt32LE(j)) >>> 0;
    const carry = num;
    num = (numold ^ eax) >>> 0;
    numold = carry >>> 0;
  }
  numold = (numold ^ key.readUInt32LE(0)) >>> 0;
  return [numold, num];
}

function decodeCode(buffer, offset) {
  // code 为 7 字节 NUL 截断的 ASCII/UTF-8。
  let end = offset;
  while (end < offset + 7 && buffer[end] !== 0) end++;
  return buffer.toString('utf8', offset, end);
}

// 解析整个 gbbq 文件为记录数组。count 与文件长度必须自洽，否则视为文件损坏。
function decodeGbbq(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) throw new Error('gbbq 文件为空');
  const key = keys();
  const count = buffer.readUInt32LE(0);
  const expected = 4 + count * RECORD_BYTES;
  if (buffer.length !== expected) {
    throw new Error(`gbbq 记录数与文件长度不一致：count=${count} 期望 ${expected} 字节，实际 ${buffer.length}`);
  }
  const records = [];
  let offset = 4;
  // 解密后拼出完整 29 字节明文记录（3×8 字节密文块 + 5 字节跟随明文），再按字段读取。
  const plain = Buffer.allocUnsafe(RECORD_BYTES);
  for (let i = 0; i < count; i++) {
    const a = decodeBlock(buffer.readUInt32LE(offset), buffer.readUInt32LE(offset + 4), key);
    const b = decodeBlock(buffer.readUInt32LE(offset + 8), buffer.readUInt32LE(offset + 12), key);
    const c = decodeBlock(buffer.readUInt32LE(offset + 16), buffer.readUInt32LE(offset + 20), key);
    plain.writeUInt32LE(a[0], 0); plain.writeUInt32LE(a[1], 4);
    plain.writeUInt32LE(b[0], 8); plain.writeUInt32LE(b[1], 12);
    plain.writeUInt32LE(c[0], 16); plain.writeUInt32LE(c[1], 20);
    buffer.copy(plain, 24, offset + 24, offset + RECORD_BYTES);
    records.push({
      market: plain.readUInt8(0),
      code: decodeCode(plain, 1),
      date: plain.readUInt32LE(8),
      category: plain.readUInt8(12),
      hongli: plain.readFloatLE(13),
      peigujia: plain.readFloatLE(17),
      songgu: plain.readFloatLE(21),
      peigu: plain.readFloatLE(25),
    });
    offset += RECORD_BYTES;
  }
  return records;
}

// 除权除息事件的去重键：同一除权日出现完全相同的两条记录只应折算一次。
function eventKey(event) {
  return [event.date, event.hongli, event.peigujia, event.songgu, event.peigu].join('|');
}

// 按证券代码建索引。只保留复权用得到的 category=1（除权除息）事件，按除权日升序去重。
function indexByCode(records) {
  const byCode = new Map();
  for (const record of records) {
    if (Number(record.category) !== 1) continue;
    const code = String(record.code || '');
    if (!code) continue;
    if (!byCode.has(code)) byCode.set(code, { seen: new Set(), events: [] });
    const bucket = byCode.get(code);
    const key = eventKey(record);
    if (bucket.seen.has(key)) continue;
    bucket.seen.add(key);
    bucket.events.push(record);
  }
  for (const bucket of byCode.values()) {
    bucket.events.sort((a, b) => a.date - b.date);
    delete bucket.seen;
  }
  return byCode;
}

// 进程内缓存：gbbq 是 5MB+ 的大文件，按 mtime+size 判定是否需要重新解析。
let cache = { file: '', mtimeMs: 0, size: 0, index: null, count: 0, error: '' };

function loadIndex(file) {
  const target = String(file || '');
  if (!target) return { index: null, count: 0, error: '未提供 gbbq 路径' };
  let stat = null;
  try {
    stat = fs.statSync(target);
  } catch {
    return { index: null, count: 0, error: 'gbbq 文件不存在' };
  }
  if (cache.index && cache.file === target && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) return cache;
  try {
    const records = decodeGbbq(fs.readFileSync(target));
    cache = { file: target, mtimeMs: stat.mtimeMs, size: stat.size, index: indexByCode(records), count: records.length, error: '' };
  } catch (e) {
    cache = { file: target, mtimeMs: stat.mtimeMs, size: stat.size, index: null, count: 0, error: String((e && e.message) || e).slice(0, 160) };
  }
  return cache;
}

function gbbqEvents(index, code) {
  if (!index) return [];
  const bucket = index.get(String(code || ''));
  return bucket ? bucket.events : [];
}

// 测试与运维入口：清空进程内缓存，避免临时目录替换文件后被旧索引命中。
function resetGbbqCache() {
  cache = { file: '', mtimeMs: 0, size: 0, index: null, count: 0, error: '' };
}

module.exports = { KEY_FILE, decodeGbbq, indexByCode, loadIndex, gbbqEvents, resetGbbqCache };
