const assert = require('node:assert/strict');
const { normalizeBars, sameBar } = require('../kline-sync');
const { normalizeKlineVolume } = require('../data');

const bars = normalizeBars([
  { date: '2026-09-03', open: 10, high: 11, low: 9, close: 10.5, volume: 100 },
  { date: '2026-09-02', open: 9, high: 10, low: 8.5, close: 9.5, volume: 80 },
  { date: '2026-09-03', open: 10, high: 11.2, low: 9, close: 10.6, volume: 120, amount: 1000 },
  { date: '2026-09-04', open: 10, high: 11, low: 9, close: 10.5, volume: null },
  { date: 'bad', open: 1, high: 1, low: 1, close: 1 },
]);
assert.equal(bars.length, 2, '按日期去重并过滤无效 bar');
assert.equal(bars.some((bar) => bar.date === '2026-09-04'), false, '缺失成交量不能被归一为零后混入序列');
assert.equal(bars[0].date, '2026-09-02', '按日期升序');
assert.equal(bars[1].close, 10.6, '保留源返回的同日最新 bar');
assert.equal(sameBar(bars[1], { ...bars[1] }), true, '完全相同无需覆盖');
assert.equal(sameBar(bars[1], { ...bars[1], close: 10.7 }), false, '同日收盘变化必须覆盖');
assert.equal(normalizeKlineVolume(464263, 'tencent'), 46426300, '腾讯手数应归一为股数');
assert.equal(normalizeKlineVolume(464263, 'em'), 46426300, '东财手数应归一为股数');
assert.equal(normalizeKlineVolume(46426300, 'sina'), 46426300, '新浪股数无需换算');
console.log('kline-sync.test 通过');
