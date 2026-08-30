'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const keys = require('./keys');

test('reviewSlot 归一化模式并生成确定性键', () => {
  assert.deepEqual(keys.reviewSlot('2026-08-29', 'close'),
    { slotKey: 'review:2026-08-29:close', objectKey: 'hangqing/review/20260829/close.json' });
  assert.deepEqual(keys.reviewSlot('2026-08-29', 'snapshot'),
    { slotKey: 'review:2026-08-29:morning', objectKey: 'hangqing/review/20260829/morning.json' });
  assert.equal(keys.reviewSlot('2026-08-29', 'morning').slotKey, 'review:2026-08-29:morning');
});

test('dragonSlot / klineSlot 键派生与代码清洗', () => {
  assert.deepEqual(keys.dragonSlot('2026-08-29'),
    { slotKey: 'dragon:2026-08-29', objectKey: 'hangqing/dragon/20260829.json' });
  assert.deepEqual(keys.klineSlot('600000.SH', '2026-08-29'),
    { slotKey: 'kline:600000SH:2026-08-29', objectKey: 'hangqing/kline/600000SH/20260829.json' });
});

test('canonicalMode 只归一化已知模式', () => {
  assert.equal(keys.canonicalMode('snapshot'), 'morning');
  assert.equal(keys.canonicalMode('morning'), 'morning');
  assert.equal(keys.canonicalMode('close'), 'close');
  assert.equal(keys.canonicalMode('whatever'), 'close');
});

test('timeBucket 按上海时区派生日期与时分秒', () => {
  // 2026-08-29T01:30:45Z = 上海 09:30:45
  const b = keys.timeBucket('2026-08-29T01:30:45.000Z');
  assert.equal(b.date, '20260829');
  assert.equal(b.hhmmss, '093045');
});

test('realtimeKey / quotesKey 用时间桶收敛', () => {
  assert.equal(keys.realtimeKey('20260829', '093045'), 'hangqing/realtime/20260829/093045.json');
  assert.equal(keys.quotesKey('20260829', '093045'), 'hangqing/quotes/20260829/093045.json');
});
