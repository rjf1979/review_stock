'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { reviewListEntry } = require('./server');

test('复盘列表摘要提取温度等级与涨跌宽度', () => {
  const entry = reviewListEntry({
    date: '2026-09-01',
    temperature: { score: 62, level: '活跃', vp: 30, tech: 32 },
    limitUpCount: 65,
    limitDownCount: 1,
    breadth: { status: 'ready', up: 3308, flat: 80, down: 1819, limitUp: 65, limitDown: 1 },
    meta: { report_mode: 'close', as_of: '2026-09-01T15:00:00Z' },
    updatedAt: '2026-09-01T15:05:00Z',
  }, 'fallback-date');

  assert.equal(entry.date, '2026-09-01');
  assert.equal(entry.temperature, 62);
  assert.equal(entry.temperatureLevel, '活跃');
  assert.equal(entry.limitUpCount, 65);
  assert.equal(entry.limitDownCount, 1);
  assert.equal(entry.up, 3308);
  assert.equal(entry.flat, 80);
  assert.equal(entry.down, 1819);
  assert.equal(entry.reportMode, 'close');
  assert.equal(entry.updatedAt, '2026-09-01T15:05:00Z');
});

test('复盘列表摘要兼容数值温度与缺失字段', () => {
  const entry = reviewListEntry({ date: '2026-08-25', temperature: 48 }, '2026-08-25');

  assert.equal(entry.date, '2026-08-25');
  assert.equal(entry.temperature, 48);
  assert.equal(entry.temperatureLevel, null);
  assert.equal(entry.limitUpCount, null);
  assert.equal(entry.up, null);
  assert.equal(entry.reportMode, 'snapshot');
});

test('复盘列表摘要允许空 payload 并回退文件名日期', () => {
  const entry = reviewListEntry(null, '2026-08-22');

  assert.equal(entry.date, '2026-08-22');
  assert.equal(entry.temperature, null);
  assert.equal(entry.temperatureLevel, null);
  assert.equal(entry.reportMode, 'snapshot');
});
