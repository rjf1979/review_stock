// 观察价位层自检：纯函数，不落盘、不联网，验证支撑/压力/失效/空间比结构与确定性。
const assert = require('assert');
const levels = require('../price-levels');

function mk(len, fn) {
  const out = [];
  for (let i = 0; i < len; i++) out.push(fn(i, out));
  return out;
}

// 一段带波段的上升序列，确保能识别出支撑/压力。
const candles = mk(160, (i) => {
  const wave = Math.sin(i / 8);
  const base = 10 + i * 0.06 + wave * 1.2;
  const open = base - 0.2;
  const close = base;
  const high = Math.max(open, close) + 0.3;
  const low = Math.min(open, close) - 0.3;
  return { date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`, open, high, low, close, volume: 1000 + i * 10, amount: (1000 + i * 10) * close };
});

const r = levels.computeLevels(candles, { code: '600001' });
assert.strictEqual(r.algorithmVersion, 'levels-v1');
assert.strictEqual(r.available, true, '有效样本应可计算价位');
assert.ok(Array.isArray(r.supportZones), 'supportZones 应为数组');
assert.ok(Array.isArray(r.resistanceZones), 'resistanceZones 应为数组');
assert.ok(r.supportZones.length <= 3, '支撑区最多 3 个');
assert.ok(r.resistanceZones.length <= 3, '压力区最多 3 个');
for (const z of [...r.supportZones, ...r.resistanceZones]) {
  assert.ok(z.low <= z.high, '区间 low 不应大于 high');
  assert.ok(Array.isArray(z.sources) && z.sources.length > 0, '每个区间都应有来源');
  assert.ok(z.strength >= 0 && z.strength <= 100, '强度应在 0~100');
}
assert.ok(Array.isArray(r.entryTriggers), 'entryTriggers 应为数组');
if (r.invalidationLevel) {
  assert.ok(r.invalidationLevel.value < r.supportZones[0].low, '失效位应低于首个支撑区下沿');
}
assert.deepStrictEqual(levels.computeLevels(candles, { code: '600001' }), r, '同一输入应得到确定性结果');
console.log('levels ok', r.algorithmVersion, 'support', r.supportZones.length, 'resistance', r.resistanceZones.length, 'rr', r.riskReward);

// ── 新增：缺口边界 / 平台箱体 / 移动保护线 / 穿越移除 / 空间比参考价 ──
const c = (date, open, close, high, low, volume = 1000) => ({ date, open, high, low, close, volume });

// 未回补向上跳空：昨日高点 10.2，今日低点 11.0，之后始终未回落到 10.2 以下。
const gapCandles = [
  c('2026-01-01', 10, 10, 10.2, 9.8),
  c('2026-01-02', 11.4, 11.5, 11.6, 11.0), // 向上跳空
  c('2026-01-03', 11.5, 11.6, 11.7, 11.2),
  c('2026-01-04', 11.6, 11.7, 11.8, 11.3),
];
const gaps = levels.gapBoundaries(gapCandles, 60);
assert.strictEqual(gaps.length, 1, '应识别到一个未回补向上跳空');
assert.strictEqual(gaps[0].type, 'gapUp');
assert.ok(Math.abs(gaps[0].low - 10.2) < 1e-9 && Math.abs(gaps[0].high - 11.0) < 1e-9, '缺口边界应等于昨高/今低');

// 移动保护线：最高收盘价 14 - 2 × ATR(1) = 12。
const trailCandles = [10, 11, 12, 13, 14].map((close, i) => c(`2026-02-0${i + 1}`, close - 0.5, close, close + 0.5, close - 0.5));
const trail = levels.trailingProtectionLine(trailCandles, 1, 120);
assert.ok(trail && trail.type === 'trailing' && Math.abs(trail.value - 12) < 1e-9, '移动保护线 = 最高收盘价 - 2×ATR');

// 穿越移除：现价 10，支撑区 [8,9] 被最近两日收盘跌破应移除，[5,6] 保留。
const crossedZones = [
  { low: 8, high: 9 },
  { low: 5, high: 6 },
];
const crossedCandles = [c('2026-03-01', 7, 7, 7.1, 6.9), c('2026-03-02', 7, 7, 7.1, 6.9)];
const crossed = levels.splitZones(crossedZones, 10, crossedCandles);
assert.strictEqual(crossed.support.length, 1, '被两日收盘跌破的支撑区应移除');
assert.strictEqual(crossed.support[0].low, 5);

// 空间比：以当前价为参考价，reward/risk 均为正。
const rr = levels.riskReward(
  { resistance: [{ low: 11.45, high: 11.68 }], support: [{ low: 10.20, high: 10.36 }] },
  10.52,
  0.4,
  { value: 10.08 }
);
assert.strictEqual(rr.available, true);
assert.ok(rr.value > 0, '空间比应为正');
assert.strictEqual(rr.state, 'reasonable');
console.log('price-levels 新增项通过', 'gaps', gaps.length, 'trail', trail.value, 'rr', rr.value);

const actionable = levels.actionableRiskReward({
  entryTriggers: [{ confirmAbove: 10.5, status: 'confirmed' }],
  invalidationLevel: { value: 10 },
  resistanceZones: [{ low: 12 }],
});
assert.equal(actionable.available, true);
assert.ok(actionable.value >= 2, '计入成本滑点后仍应按有效三价计算风险收益比');
assert.equal(levels.actionableRiskReward({ entryTriggers: [{ confirmAbove: 10 }], invalidationLevel: { value: 10.1 }, resistanceZones: [{ low: 12 }] }).available, false);
