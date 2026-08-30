'use strict';
// 对象键 / 槽位键派生：同一份数据在所有设备上算出同一键，谁先到达都收敛到同一对象。
// 纯函数，无 IO，便于单测。

const PREFIX = 'hangqing';

function compact(dateStr) {
  return String(dateStr || '').replace(/-/g, '');
}
function safeCode(code) {
  return String(code || '').replace(/[^A-Za-z0-9]/g, '');
}
// 复盘模式归一化：午间快照(snapshot)/morning 归到 morning，其余归 close。
function canonicalMode(mode) {
  return mode === 'snapshot' || mode === 'morning' ? 'morning' : 'close';
}

// 槽位（不可变、一天一次）：返回 { slotKey, objectKey }
function reviewSlot(date, mode) {
  const m = canonicalMode(mode);
  return { slotKey: `review:${date}:${m}`, objectKey: `${PREFIX}/review/${compact(date)}/${m}.json` };
}
function dragonSlot(date) {
  return { slotKey: `dragon:${date}`, objectKey: `${PREFIX}/dragon/${compact(date)}.json` };
}
function klineSlot(code, date) {
  const c = safeCode(code);
  return { slotKey: `kline:${c}:${date}`, objectKey: `${PREFIX}/kline/${c}/${compact(date)}.json` };
}

// 头指针（持续变化、时间桶去重）
function realtimeKey(date, hhmmss) {
  return `${PREFIX}/realtime/${compact(date)}/${hhmmss || 'latest'}.json`;
}
function quotesKey(date, hhmmss) {
  return `${PREFIX}/quotes/${compact(date)}/${hhmmss || 'latest'}.json`;
}

function shanghaiParts(value) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(value);
  return Object.fromEntries(p.filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
}

// 由时间戳派生时间桶（上海时区），用于实时/报价的 objectKey。
function timeBucket(iso) {
  const p = shanghaiParts(new Date(iso));
  return { date: `${p.year}${p.month}${p.day}`, hhmmss: `${p.hour}${p.minute}${p.second}` };
}

module.exports = { PREFIX, compact, safeCode, canonicalMode, reviewSlot, dragonSlot, klineSlot, realtimeKey, quotesKey, timeBucket };
