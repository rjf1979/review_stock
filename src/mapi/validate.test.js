'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('./validate');

// 已知事实：2026-01-01 周四，2026-01-03 周六。
const TODAY = '2026-08-29';
const NOW = Date.parse('2026-08-29T00:00:00Z');

test('validDate 校验格式', () => {
  assert.equal(v.validDate('2026-08-29'), true);
  assert.equal(v.validDate('2026-8-29'), false);
  assert.equal(v.validDate(''), false);
  assert.equal(v.validDate(undefined), false);
});

test('isWeekend 识别周末', () => {
  assert.equal(v.isWeekend('2026-01-03'), true);  // 周六
  assert.equal(v.isWeekend('2026-01-01'), false); // 周四
});

test('validateReview 拒绝未来日期与周末', () => {
  assert.equal(v.validateReview({ date: '2026-12-31', markdown: 'x' }, { today: TODAY }).ok, false);
  assert.equal(v.validateReview({ date: '2026-01-03', markdown: 'x' }, { today: TODAY }).ok, false);
  assert.equal(v.validateReview({ date: '2026-01-01', markdown: 'x' }, { today: TODAY }).ok, true);
  assert.equal(v.validateReview({ date: '2026-01-01' }, { today: TODAY }).ok, false); // 缺内容
});

test('validateDragon 校验 date 与 list', () => {
  assert.equal(v.validateDragon({ date: '2026-01-01', list: [] }, { today: TODAY }).ok, true);
  assert.equal(v.validateDragon({ date: '2026-01-01' }, { today: TODAY }).ok, false);
});

test('validateKline 校验 code 与 kline', () => {
  assert.equal(v.validateKline({ code: '600000', kline: [] }, { today: TODAY }).ok, true);
  assert.equal(v.validateKline({ code: '', kline: [] }, { today: TODAY }).ok, false);
});

test('validateRealtime / validateQuotes 校验 updatedAt 时间合理性', () => {
  assert.equal(v.validateRealtime({ updatedAt: '2026-08-29T00:00:00Z' }, { now: NOW }).ok, true);
  assert.equal(v.validateRealtime({ updatedAt: '2099-01-01T00:00:00Z' }, { now: NOW }).ok, false);
  assert.equal(v.validateRealtime({}, { now: NOW }).ok, false);
  assert.equal(v.validateQuotes({ stocks: [], updatedAt: '2026-08-29T00:00:00Z' }, { now: NOW }).ok, true);
  assert.equal(v.validateQuotes({ updatedAt: '2026-08-29T00:00:00Z' }, { now: NOW }).ok, false);
});

test('validateQuotes 拒绝负价格', () => {
  assert.equal(v.validateQuotes({ stocks: [{ code: '1', price: -1 }], updatedAt: '2026-08-29T00:00:00Z' }, { now: NOW }).ok, false);
  assert.equal(v.validateQuotes({ stocks: [{ code: '1', price: 10.5 }], updatedAt: '2026-08-29T00:00:00Z' }, { now: NOW }).ok, true);
});
