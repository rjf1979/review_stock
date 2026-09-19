// 详情图 RSI 副图与选股口径一致性守门（纯函数，不联网、不落盘）。
//
// 副图画的是 frontend/src/lib/rsi.mjs，选股/回测用的是 screener-core.js。
// 两者一旦分叉，用户会在图上看到「明明拐头了却没入选」或反向的假信号。
// 本测试用同一份 K 线同时跑前后端实现，逐点比对 RSI 数值、拐头点与完整命中点。
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { rsi, matchKlinePattern, rsiLowTurnEvidence } = require('../screener-core');
const { DEFAULT_RULES } = require('../rules-store');

const LIB_URL = pathToFileURL(path.join(__dirname, '../frontend/src/lib/rsi.mjs')).href;

// 固定种子随机游走：样本量足以覆盖 RSI 全区间，并确定性复现，避免偶发通过/偶发失败。
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function walkSeries({ count = 260, seed = 20260918, start = 60 } = {}) {
  const rnd = mulberry32(seed);
  const bars = [];
  let close = start;
  for (let i = 0; i < count; i++) {
    // 中段（第 80—150 根）强制阴跌，确保序列里真的存在「超跌 + RSI 低位拐头」样本。
    const drift = (i >= 80 && i < 150) ? -0.012 : (rnd() - 0.5) * 0.025;
    const open = close;
    close = Math.max(1, +(close * (1 + drift)).toFixed(2));
    const high = +(Math.max(open, close) * (1 + rnd() * 0.01)).toFixed(2);
    const low = +(Math.min(open, close) * (1 - rnd() * 0.01)).toFixed(2);
    bars.push({
      date: `2026-${String(Math.floor(i / 21) + 1).padStart(2, '0')}-${String((i % 21) + 1).padStart(2, '0')}`,
      open, high, low, close,
      volume: Math.round(1e6 * (0.6 + rnd())),
    });
  }
  return bars;
}

(async () => {
  const { wilderRsi, rsiLowTurnScan, rsiZoneLabel } = await import(LIB_URL);
  const candles = walkSeries();
  const rule = DEFAULT_RULES.find((r) => r.patternId === 'rsi_low_turn');
  assert.ok(rule, '默认规则里必须有 rsi_low_turn');
  const params = rule.params;
  assert.equal(params.period, 14, 'RSI 周期应为 14');
  assert.equal(params.low, 18, '上线阈值应为 low=18');

  // ── 1. RSI 数值逐点一致 ──
  const backendRsi = rsi(candles, params.period);
  const frontendRsi = wilderRsi(candles, params.period);
  assert.equal(frontendRsi.length, backendRsi.length, 'RSI 序列长度应与 K 线一致');
  for (let i = 0; i < backendRsi.length; i++) {
    if (backendRsi[i] == null) assert.equal(frontendRsi[i], null, `第 ${i} 根 RSI 应同为 null`);
    else assert.equal(frontendRsi[i], backendRsi[i], `第 ${i} 根 RSI 数值必须与后端一致`);
  }
  assert.ok(backendRsi.some((v) => v != null), 'RSI 序列不应全为 null');

  // ── 2. 拐头点集合一致：前值 < low 且当前值 > 前值 ──
  const scan = rsiLowTurnScan(candles, params);
  assert.equal(scan.period, 14);
  assert.equal(scan.low, 18);
  assert.equal(scan.values.length, candles.length);
  const turnSet = new Set(scan.turns.map((p) => p.index));
  for (let i = 1; i < candles.length; i++) {
    const ev = rsiLowTurnEvidence(candles, params, i);
    const expected = ev.rsi != null && ev.prevRsi != null && ev.prevRsi < params.low && ev.rsi > ev.prevRsi;
    assert.equal(turnSet.has(i), expected, `第 ${i} 根拐头判定应与后端一致`);
  }
  assert.ok(scan.turns.length > 0, '测试序列应至少出现一次超卖拐头');

  // ── 3. 完整命中集合一致：后端把 K 线截到信号日判定的结果必须相同 ──
  const hitSet = new Set(scan.hits.map((p) => p.index));
  assert.ok(scan.hits.length > 0, '测试序列应至少出现一次完整命中');
  for (let i = 1; i < candles.length; i++) {
    const backend = matchKlinePattern('rsi_low_turn', candles.slice(0, i + 1), params);
    assert.equal(hitSet.has(i), backend.matched, `第 ${i} 根命中判定应与后端一致（后端理由：${backend.reason}）`);
  }
  // 命中必须是拐头的子集，且带得出跌幅证据。
  for (const point of scan.hits) {
    assert.ok(turnSet.has(point.index), '命中点必须同时是拐头点');
    assert.ok(point.dropPct != null && point.dropPct <= params.drop_max, '命中点必须满足前期跌幅过滤');
  }

  // ── 4. 缺省口径（low=30、无跌幅过滤）也与后端一致，避免老规则画错线 ──
  const legacy = rsiLowTurnScan(candles, { period: 14, low: 30 });
  for (let i = 1; i < candles.length; i++) {
    const backend = matchKlinePattern('rsi_low_turn', candles.slice(0, i + 1), { period: 14, low: 30 });
    assert.equal(new Set(legacy.hits.map((p) => p.index)).has(i), backend.matched, `缺省口径第 ${i} 根命中判定应与后端一致`);
  }
  assert.ok(legacy.hits.length >= scan.hits.length, '缺省口径没有跌幅过滤，命中不应少于上线口径');

  // ── 5. 样本不足时不给命中：前端不得画出后端不会认的信号 ──
  const shortCandles = candles.slice(0, 40);
  const shortScan = rsiLowTurnScan(shortCandles, params);
  assert.equal(shortScan.hits.length, 0, '样本不足 minBars 时不应产出命中');
  assert.equal(shortScan.minBars, params.drop_days + 1, 'minBars 应覆盖跌幅窗口');

  // ── 6. 区间文案与阈值同源 ──
  assert.match(rsiZoneLabel(12, 18), /超卖区（<18）/);
  assert.match(rsiZoneLabel(18, 18), /中性偏弱/);
  assert.match(rsiZoneLabel(55, 18), /中性偏强/);
  assert.match(rsiZoneLabel(82, 18), /高位区（≥70）/);
  assert.equal(rsiZoneLabel(null, 18), 'RSI 未形成');

  console.log(`rsi-chart-parity.test 通过（${candles.length} 根 K 线逐点比对：RSI 数值 / 拐头 ${scan.turns.length} 处 / 命中 ${scan.hits.length} 处）`);
})();
