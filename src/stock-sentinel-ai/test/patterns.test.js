// 量能洞察 · 技术指标 + K线形态检测 单测（构造K线，不联网）
const assert = require('assert');
const {
  sma, ema, macd, rsi, volMa, limitPct,
  matchKlinePattern, PATTERNS, listRules,
} = require('../screener-core');

function candle(o, cl, hi, lo, volume) {
  return { open: o, close: cl, high: hi, low: lo, volume };
}

function makeFlat(n, base = 100, vol = 800) {
  const arr = [];
  for (let i = 0; i < n; i++) arr.push(candle(base, base + 0.2, base + 0.8, base - 0.6, vol));
  return arr;
}

function makeRise(n, start = 100, step = 1, vol = 1000) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    const p = start + i * step;
    arr.push(candle(p - 0.1, p, p + 0.4, p - 0.3, vol));
  }
  return arr;
}

// ── 指标正确性 ──
assert.deepStrictEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
assert.strictEqual(ema([5, 5, 5, 5], 3)[3], 5);
const m = macd(makeFlat(30, 100, 800));
assert.strictEqual(m.dif.length, 30);
assert.strictEqual(m.dea.length, 30);
assert.strictEqual(m.hist.length, 30);
assert.ok(Math.abs(m.hist[29] - (m.dif[29] - m.dea[29]) * 2) < 1e-9);
const rAllUp = rsi(makeRise(40, 100, 1, 1000));
const rAllDown = rsi(makeRise(40, 200, -1, 1000));
assert.ok(rAllUp[39] > 90, `单边上涨 RSI 应接近 100，实际 ${rAllUp[39]}`);
assert.ok(rAllDown[39] < 10, `单边下跌 RSI 应接近 0，实际 ${rAllDown[39]}`);
assert.strictEqual(limitPct('300750'), 0.2);
assert.strictEqual(limitPct('688111'), 0.2);
assert.strictEqual(limitPct('830799'), 0.3);
assert.strictEqual(limitPct('600519'), 0.1);
assert.strictEqual(limitPct('000001'), 0.1);

// ── 可稳定触发的形态 ──
const breakout = makeFlat(26, 100, 1000).concat([
  candle(104, 111, 112, 103, 3000), // 末根放量突破前高
]);
assert.ok(matchKlinePattern('volume_breakout', breakout).matched, '放量突破应命中');

const lianyang = makeFlat(4, 100, 800).concat([
  candle(100, 101, 101.4, 99.8, 800),
  candle(101, 102, 102.4, 100.8, 800),
  candle(102, 103.5, 104, 101.8, 2000),
]);
assert.ok(matchKlinePattern('consecutive_yang', lianyang).matched, '连阳启动应命中');

const engulf = makeFlat(10, 100, 800).concat([
  candle(103, 97, 104, 96, 800),     // 前阴
  candle(96, 105, 106, 95, 2000),    // 阳包阴
]);
assert.ok(matchKlinePattern('yang_engulf', engulf).matched, '阳包阴应命中');

const gap = makeFlat(10, 100, 800).concat([
  candle(99.8, 100, 100.2, 99.6, 800),
  candle(102, 105, 105.5, 101.8, 2000),
]);
assert.ok(matchKlinePattern('gap_breakout', gap).matched, '缺口突破应命中');

const shadow = makeFlat(10, 100, 800).concat([
  candle(100, 101, 101.5, 95, 1000), // 长下影
]);
assert.ok(matchKlinePattern('long_lower_shadow', shadow).matched, '长下影企稳应命中');

const bull = makeRise(70, 100, 1, 1000);
assert.ok(matchKlinePattern('ma_bullish', bull).matched, '均线多头应命中');

const nshape = makeRise(26, 100, 1, 1000).concat([
  candle(125, 123.5, 125, 122.5, 600),
  candle(123.5, 122, 123.6, 121.5, 600),
  candle(122, 123.2, 123.4, 121.7, 600),
  candle(124, 128, 128.6, 123.5, 2000),
]);
assert.ok(matchKlinePattern('n_shape', nshape).matched, 'N 字突破应命中');

// ── 健壮性：对平静序列调用所有形态，均返回合法对象、不抛错、不 NaN ──
const calm = makeFlat(60, 100, 800);
for (const id of Object.keys(PATTERNS)) {
  const res = matchKlinePattern(id, calm);
  assert.ok(typeof res.matched === 'boolean', `${id} 应返回 matched 布尔`);
  assert.ok(Number.isFinite(res.score), `${id} score 应有限`);
  assert.ok(typeof res.reason === 'string', `${id} 应返回 reason`);
}

// ── 规则引擎：默认剔除“量能活跃”，其余为 K 线形态规则，且每条都有对应形态实现 ──
const defaultRules = listRules();
assert.ok(!defaultRules.some((r) => r.id === 'volume_act'), '默认规则不应再包含 volume_act');
const klineRules = defaultRules.filter((r) => r.kind === 'kline');
assert.ok(klineRules.length >= 24, `应至少有 24 条 K 线形态规则，实际 ${klineRules.length}`);
for (const r of klineRules) {
  assert.ok(PATTERNS[r.patternId], `规则 ${r.id} 的 patternId=${r.patternId} 应有对应形态实现`);
}

console.log('patterns.test 通过');
