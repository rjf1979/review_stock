// rsi_low_turn v4 选股公式自检：纯函数，不联网、不落盘。
// 覆盖入场条件（RSI14 低位拐头 + 近 60 交易日跌幅 ≤ -30%；上线阈值 low=18）、
// 参数边界、缺省口径兼容、无未来函数，以及价位层与形态退出口径的一致性。
const assert = require('assert');
const { matchKlinePattern, rsiLowTurnEvidence, listEnabledRules } = require('../screener-core');
const { DEFAULT_RULES } = require('../rules-store');
const { atr } = require('../indicators');
const levels = require('../price-levels');

const V4 = { period: 14, low: 20, drop_days: 60, drop_max: -30 };
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

let day = 0;
function bar(close, { open = close + 0.5, high = null, low = null, volume = 1000 } = {}) {
  day += 1;
  return {
    date: `2026-${String(Math.floor(day / 28) + 1).padStart(2, '0')}-${String((day % 28) + 1).padStart(2, '0')}`,
    open,
    high: high == null ? Math.max(open, close) + 0.2 : high,
    low: low == null ? Math.min(open, close) - 0.2 : low,
    close,
    volume,
  };
}

// 先横盘、再深跌、最后小幅反弹：构成「超跌 + RSI 低位拐头」。
function deepDrop({ flat = 20, decline = 40, base = 100, end = 58.6, bounce = 3, bounceStep = 0.6 } = {}) {
  const out = [];
  for (let i = 0; i < flat; i++) out.push(bar(base, { open: base, high: base + 0.5, low: base - 0.5 }));
  const step = (base - end) / decline;
  for (let i = 0; i < decline; i++) {
    const p = base - step * (i + 1);
    out.push(bar(p, { open: p + step, high: p + step * 0.6, low: p - 0.15 }));
  }
  for (let i = 0; i < bounce; i++) {
    const p = end + bounceStep * (i + 1);
    out.push(bar(p, { open: p - bounceStep, high: p + 0.2, low: p - bounceStep * 1.1, volume: 1300 }));
  }
  return out;
}

// ── 1. 命中：深跌 -30% 以上后 RSI14 低位拐头 ──
const hitCandles = deepDrop();
const hitEvidence = rsiLowTurnEvidence(hitCandles, V4, hitCandles.length - 1);
assert.ok(hitEvidence.prevRsi < V4.low, '命中样本的拐头前 RSI 应低于 20');
assert.ok(hitEvidence.rsi > hitEvidence.prevRsi, '命中样本的 RSI 应向上拐头');
assert.ok(hitEvidence.dropPct <= V4.drop_max, '命中样本的近 60 日跌幅应达到 -30%');
const hit = matchKlinePattern('rsi_low_turn', hitCandles, V4);
assert.strictEqual(hit.matched, true, '超跌 + RSI 低位拐头应命中');
assert.ok(hit.reason.includes('RSI 低位（<20）拐头向上'), '命中理由应写清 v4 入场条件');
assert.ok(hit.reason.includes('跌幅'), '命中理由应带上近 60 日跌幅证据');

// ── 2. 参数边界：跌幅恰好 -30% 命中，-29.999% 不命中 ──
// 基准收盘 100，信号日收盘 70 → 恰好 -30%（回测口径为 ≤）。
const boundaryBase = new Array(3).fill(0).map(() => bar(100, { open: 100, high: 100.5, low: 99.5 }));
function declineTo(last) {
  const out = [];
  for (let i = 0; i < 56; i++) out.push(bar(98 - i * 0.5, { open: 98.5 - i * 0.5, high: 99 - i * 0.5, low: 97.4 - i * 0.5 }));
  out.push(bar(69.4, { open: 70.4, high: 70.6, low: 69.2 }));   // 拐头前一根：继续下跌
  out.push(bar(last, { open: 69.9, high: last + 0.3, low: 69.3 })); // 信号日：小幅反弹
  return boundaryBase.concat(out);
}
const exactly30 = declineTo(70);
const ev30 = rsiLowTurnEvidence(exactly30, V4, exactly30.length - 1);
assert.ok(ev30.dropPct <= -30, `-30% 边界应视为达标，实际 ${ev30.dropPct}`);
assert.strictEqual(matchKlinePattern('rsi_low_turn', exactly30, V4).matched, true, '跌幅恰好 -30% 应命中');
const justAbove30 = declineTo(70.002);
const evAbove = rsiLowTurnEvidence(justAbove30, V4, justAbove30.length - 1);
assert.ok(evAbove.dropPct > -30 && evAbove.dropPct < -29.9, `跌幅略小于 30% 应不达标，实际 ${evAbove.dropPct}`);
assert.strictEqual(matchKlinePattern('rsi_low_turn', justAbove30, V4).matched, false, '跌幅不足 -30% 不应命中');

// ── 3. RSI 阈值边界：拐头前值必须严格小于 low ──
// 阴跌型样本：台阶式下跌（每天 -4.4 / +1.3 交替）能跌够 -30%，
// 但因为夹杂反弹，Wilder RSI 只回落到 24 左右，不会进入 20 以下的超卖区。
function zigzagDrop({ flat = 55, down = 4.4, up = 1.3, pairs = 10, last = 0.9 } = {}) {
  const out = [];
  const base = 100;
  for (let i = 0; i < flat; i++) out.push(bar(base, { open: base, high: base + 0.5, low: base - 0.5 }));
  let p = base;
  let prev = p;
  for (let k = 0; k < pairs; k++) {
    p = prev - down;
    out.push(bar(p, { open: prev, high: prev + 0.1, low: p - 0.2 }));
    prev = p;
    p = prev + up;
    out.push(bar(p, { open: prev, high: p + 0.2, low: prev - 0.3 }));
    prev = p;
  }
  const close = prev + last;
  out.push(bar(close, { open: prev, high: close + 0.3, low: prev - 0.15 }));
  return out;
}
const mildTurn = zigzagDrop();
const mildEv = rsiLowTurnEvidence(mildTurn, V4, mildTurn.length - 1);
assert.ok(mildEv.prevRsi >= V4.low, `温和回调不应进入超卖区间，实际前值 ${mildEv.prevRsi}`);
assert.ok(mildEv.rsi > mildEv.prevRsi, '阴跌样本的 RSI 应向上拐头');
assert.ok(mildEv.dropPct <= V4.drop_max, `阴跌样本应跌够 -30%，实际 ${mildEv.dropPct}`);
assert.strictEqual(matchKlinePattern('rsi_low_turn', mildTurn, V4).matched, false, 'RSI 拐头前值不低于 20 不应命中');

// low 阈值可调：同一段行情放宽到 95 则应命中（验证参数真的生效，而不是写死 20）。
assert.strictEqual(matchKlinePattern('rsi_low_turn', mildTurn, { ...V4, low: 99 }).matched, mildEv.rsi > mildEv.prevRsi, 'low 阈值应可调');
// 阈值边界必须精确落在 prevRsi 上：高一点命中、低一点不命中。
assert.strictEqual(
  matchKlinePattern('rsi_low_turn', hitCandles, { ...V4, low: hitEvidence.prevRsi + 0.01 }).matched, true,
  '阈值高于拐头前 RSI 时应命中',
);
assert.strictEqual(
  matchKlinePattern('rsi_low_turn', hitCandles, { ...V4, low: hitEvidence.prevRsi - 0.01 }).matched, false,
  '阈值低于拐头前 RSI 时不应命中',
);

// ── 4. 样本不足与状态取值 ──
const shortCandles = deepDrop({ flat: 5, decline: 30, end: 60, bounce: 3 });
const shortPlan = levels.rsiLowTurnPlan(shortCandles, { code: '600002', params: V4 });
assert.strictEqual(shortPlan.available, false, '样本不足时不应给出可执行计划');
assert.strictEqual(shortPlan.reason, 'sample_too_short', '样本不足应给出明确原因');
assert.strictEqual(shortPlan.matched, false);
assert.deepStrictEqual(levels.rsiLowTurnPlan([], { code: '600002', params: V4 }).reason, 'no_kline');

// ── 5. 缺省口径兼容：不带 v4 参数时维持旧的 RSI<30 口径，且不做跌幅过滤 ──
const legacyCandles = deepDrop({ flat: 20, decline: 40, end: 58.6, bounce: 3 });
const legacyHit = matchKlinePattern('rsi_low_turn', legacyCandles, {});
const legacyEv = rsiLowTurnEvidence(legacyCandles, {}, legacyCandles.length - 1);
assert.strictEqual(legacyEv.needDrop, false, '缺省参数不应启用跌幅过滤');
assert.strictEqual(legacyHit.matched, legacyEv.prevRsi < 30 && legacyEv.rsi > legacyEv.prevRsi, '缺省口径应按 RSI<30 判定');
assert.ok(legacyHit.reason.includes('<30'), '缺省命中理由应保持旧文案');

// ── 6. 无未来函数：只用信号日及以前的数据 ──
const cutIndex = hitCandles.length - 4;
const cutEvidence = rsiLowTurnEvidence(hitCandles, V4, cutIndex);
const slicedEvidence = rsiLowTurnEvidence(hitCandles.slice(0, cutIndex + 1), V4);
assert.strictEqual(cutEvidence.rsi, slicedEvidence.rsi, '指定索引与截断序列的 RSI 必须一致');
assert.strictEqual(cutEvidence.dropPct, slicedEvidence.dropPct, '跌幅也只应使用信号日之前的数据');

// ── 7. 价位层：可执行计划与回测 v4 口径逐项对齐 ──
const plan = levels.rsiLowTurnPlan(hitCandles, { code: '600001', params: V4 });
assert.strictEqual(plan.available, true, '命中样本应产出可执行计划');
assert.strictEqual(plan.algorithmVersion, 'rsi-low-turn-v4');
const n = hitCandles.length;
const buy = hitCandles[n - 1].close;
assert.strictEqual(plan.price, round(buy), '入场参考价应为信号日收盘价');
const atrSeries = atr(hitCandles, 14);
const atrPrev = atrSeries[n - 2];
assert.strictEqual(plan.atr14, round(atrPrev), 'ATR 应取信号日前一根，与回测一致');
const structuralRaw = Math.min(...hitCandles.slice(n - 11, n - 1).map((c) => c.low)) * 0.99;
const floorStop = buy - 2 * atrPrev;
const capStop = buy * 0.92;
const expectedStop = round(Math.max(Math.min(structuralRaw, floorStop), capStop));
assert.ok(Math.abs(plan.stopLoss.value - expectedStop) <= 0.01, `结构止损应等于 max(min(近10根低点×0.99, 买点−2×ATR14), 买点×92%)，实际 ${plan.stopLoss.value} / 期望 ${expectedStop}`);
assert.strictEqual(plan.stopLoss.structural, round(structuralRaw), '结构低点应取信号日前 10 根（不含信号日）');
assert.ok(plan.stopLoss.riskPct > 0 && plan.stopLoss.riskPct <= 8, `风险上限应为 8%，实际 ${plan.stopLoss.riskPct}%`);
const risk = buy - plan.stopLoss.value;
// 计划内部用未取整的止损价算风险，这里用展示价复算，允许两位小数取整带来的偏差。
assert.ok(Math.abs(plan.takeProfit[0].value - (buy + 6 * risk)) <= 0.06, '6R 跟踪启动线应等于买点 + 6×风险');
assert.strictEqual(plan.takeProfit[0].type, 'trail_activation', '6R 只是跟踪启动线，不是固定目标');
assert.strictEqual(plan.exitRule.partialExitFraction, 0, 'v4 不做 1R 减仓');
assert.strictEqual(plan.exitRule.maxHoldDays, 20, 'v4 最长持有 20 个交易日');
assert.strictEqual(plan.exitRule.trailMa, 10);
assert.strictEqual(plan.exitRule.trailPct, 0.08);
assert.strictEqual(plan.entryTriggers[0].type, 'close_signal', '入场为信号日收盘确认');
assert.deepStrictEqual(levels.rsiLowTurnPlan(hitCandles, { code: '600001', params: V4 }), plan, '同一输入应得到确定性结果');

// ── 8. 与通用价位合并：可执行价位被 v4 覆盖，支撑/压力区保留 ──
const generic = levels.computeLevels(hitCandles, { code: '600001' });
const merged = levels.withRsiLowTurnPlan(generic, plan);
assert.deepStrictEqual(merged.supportZones, generic.supportZones, '支撑区应保留通用口径');
assert.deepStrictEqual(merged.resistanceZones, generic.resistanceZones, '压力区应保留通用口径');
assert.deepStrictEqual(merged.invalidationLevel, plan.stopLoss, '失效位应改用 v4 结构止损');
assert.deepStrictEqual(merged.entryTriggers, plan.entryTriggers, '入场触发应改用 v4 收盘信号');
assert.strictEqual(merged.riskReward.value, 6, '观察空间比应改用 v4 计划口径');
assert.strictEqual(merged.atr14, plan.atr14, 'ATR 应与 v4 止损同源，避免详情页出现两套口径');
assert.strictEqual(merged.algorithmVersion, 'levels-v1', '通用价位版本号保持可追溯');
assert.strictEqual(merged.patternExitVersion, 'rsi-low-turn-v4');
const summary = levels.levelsSummary(merged);
assert.strictEqual(summary.patternId, 'rsi_low_turn');
assert.strictEqual(summary.patternExitPlan.version, 'rsi-low-turn-v4');
assert.strictEqual(summary.invalidationLevel.riskPct, plan.stopLoss.riskPct);
assert.strictEqual(levels.withRsiLowTurnPlan(generic, shortPlan), generic, '未命中时应原样返回通用价位');

// ── 9. 启用集合：默认规则库只启用两条 v4 超跌修复形态 ──
assert.deepStrictEqual(listEnabledRules().map((r) => r.id), ['limit_pullback', 'rsi_low_turn'], '默认启用 limit_pullback v4 与 rsi_low_turn v4');
const shippedRsi = DEFAULT_RULES.find((r) => r.id === 'rsi_low_turn');
assert.deepStrictEqual(
  shippedRsi.params, { period: 14, low: 18, drop_days: 60, drop_max: -30 },
  '上线默认 RSI 阈值应为 18：全市场 2021-2026 回测中 low=18 剔除 2024 后（盈亏比 2.2087 / PF 2.4734）优于 low=20，'
  + '而 low=15 的整段优势集中在 2024 年、剔除后反而最差（2.1476 / 1.7577）',
);
assert.strictEqual(shippedRsi.minVolumeScore, 0, '超跌修复口径不设量能分门槛');

console.log('rsi_low_turn v4 通过', 'signal@', plan.klineDate, 'buy', plan.price, 'stop', plan.stopLoss.value, 'risk%', plan.stopLoss.riskPct, '6R', plan.takeProfit[0].value);
