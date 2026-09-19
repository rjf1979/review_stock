// limit_pullback v4 选股公式自检：纯函数，不联网、不落盘。
// 覆盖入场条件（近 15 日有涨停 + 末根缩量回踩不破支撑 + 近 60 日跌幅 ≤ -30% + 近 20 日相对沪深300 ≤ -5pp）、
// 相对强度过滤、基准缺失降级、无未来函数，以及价位层与形态退出口径的一致性。
const assert = require('assert');
const { matchKlinePattern, limitPullbackEvidence, listEnabledRules } = require('../screener-core');
const { atr } = require('../indicators');
const levels = require('../price-levels');

const V4 = { window: 15, vol_shrink: 0.9, drop_days: 60, drop_max: -30, rs_days: 20, rs_max: -5 };
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

let day = 0;
function bar(close, { open = close + 0.2, high = null, low = null, volume = 1000 } = {}) {
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

// 70 根横盘（100）→ 40 根阴跌（100 → 100−declineTotal）→ 1 根涨停（+10%，收盘=最高）→ 3 根缩量回踩。
// 默认跌幅 34：信号日 i 相对 i-60（落在横盘区 100）跌 -31%；区间支撑由阴跌尾段最低点给出，回踩低点不破。
function limitPullbackSeries({ declineTotal = 34 } = {}) {
  const out = [];
  for (let k = 0; k < 70; k++) out.push(bar(100, { open: 100, high: 100.5, low: 99.5, volume: 1000 }));
  const end = 100 - declineTotal;
  const step = declineTotal / 40;
  for (let k = 0; k < 40; k++) {
    const close = 100 - step * (k + 1);
    out.push(bar(close, { open: close + 0.4, high: close + 0.6, low: close - 0.3, volume: 1000 }));
  }
  const limitClose = end * 1.1;
  out.push(bar(limitClose, { open: end + 0.6, high: limitClose, low: end + 0.2, volume: 3000 })); // 涨停，收盘=最高
  out.push(bar(limitClose * 0.985, { open: limitClose * 0.992, high: limitClose * 0.995, low: limitClose * 0.978, volume: 1600 }));
  out.push(bar(limitClose * 0.970, { open: limitClose * 0.983, high: limitClose * 0.985, low: limitClose * 0.964, volume: 1200 }));
  out.push(bar(limitClose * 0.950, { open: limitClose * 0.967, high: limitClose * 0.972, low: limitClose * 0.945, volume: 700 }));
  return out;
}

// 基准查询表：默认全程平盘（相对强度 = 个股涨幅），lastClose 覆盖信号日收盘用于构造相对走强/走弱。
function benchLookup(candles, lastClose = 100) {
  return {
    dates: candles.map((c) => c.date),
    closes: candles.map((_, idx) => (idx === candles.length - 1 ? lastClose : 100)),
  };
}

const candles = limitPullbackSeries();
const n = candles.length;
const bench = benchLookup(candles);
const flatBench = benchLookup(candles, 100);

// ── 1. 命中：涨停后缩量回踩不破支撑 + 超跌 + 相对沪深300 走弱 ──
const ev = limitPullbackEvidence(candles, { ...V4, code: '600001' }, n - 1, flatBench);
assert.strictEqual(ev.limitBarIndex, n - 4, '涨停日应在信号日前 3 根');
assert.ok(ev.volRatio < V4.vol_shrink, `末根应缩量，实际量比 ${ev.volRatio}`);
assert.ok(ev.low >= ev.support * 0.98, '回踩低点不应跌破区间支撑');
assert.ok(ev.dropPct <= V4.drop_max, `近 60 日跌幅应达标，实际 ${ev.dropPct}`);
assert.ok(ev.rsPct <= V4.rs_max, `相对强度应达标，实际 ${ev.rsPct}`);
const hit = matchKlinePattern('limit_pullback', candles, { ...V4, code: '600001', benchLookup: flatBench });
assert.strictEqual(hit.matched, true, '涨停缩量回踩 + 超跌 + 相对走弱应命中');
assert.ok(hit.reason.includes('相对沪深300'), '命中理由应带上相对强度证据');
assert.ok(hit.detail.includes('量比'), '命中明细应带量比证据');

// ── 2. 相对强度不达标：基准同期跌幅远大于个股（个股反而相对走强），不应命中 ──
const strongBench = benchLookup(candles, 85); // 基准近 20 日 -15%，个股 -13.3% → 相对 +1.7pp
const evWeak = limitPullbackEvidence(candles, { ...V4, code: '600001' }, n - 1, strongBench);
assert.ok(evWeak.rsPct > V4.rs_max, `该基准下相对强度应不达标，实际 ${evWeak.rsPct}`);
const missRs = matchKlinePattern('limit_pullback', candles, { ...V4, code: '600001', benchLookup: strongBench });
assert.strictEqual(missRs.matched, false, '相对强度不达标不应命中');
assert.ok(missRs.reason.includes('相对强度'), '未命中理由应写清相对强度不达标');

// ── 3. 基准缺失：不允许静默放行，必须给出可解释的不命中原因 ──
const needRs = limitPullbackEvidence(candles, { ...V4, code: '600001' }, n - 1, null);
assert.strictEqual(needRs.benchMissing, true);
const missBench = matchKlinePattern('limit_pullback', candles, { ...V4, code: '600001', benchLookup: null });
assert.strictEqual(missBench.matched, false, '基准缺失时相对强度过滤不得放行');
assert.ok(missBench.reason.includes('基准'), '基准缺失应给出明确原因');

// ── 4. 缩量边界：末根放量则不应命中 ──
const noShrink = candles.slice();
noShrink[n - 1] = { ...noShrink[n - 1], volume: 5000 };
assert.strictEqual(matchKlinePattern('limit_pullback', noShrink, { ...V4, code: '600001', benchLookup: flatBench }).matched, false, '末根未缩量不应命中');

// ── 5. 跌幅边界：整体只跌 12%（不足 -30%）不应命中 ──
const shallow = limitPullbackSeries({ declineTotal: 12 });
const shallowEv = limitPullbackEvidence(shallow, { ...V4, code: '600001' }, shallow.length - 1, benchLookup(shallow));
assert.ok(shallowEv.dropPct > V4.drop_max, `整体上移后跌幅应不足，实际 ${shallowEv.dropPct}`);
const missDrop = matchKlinePattern('limit_pullback', shallow, { ...V4, code: '600001', benchLookup: benchLookup(shallow) });
assert.strictEqual(missDrop.matched, false, '跌幅不足 -30% 不应命中');
assert.ok(missDrop.reason.includes('跌幅'), '未命中理由应写清跌幅不达标');

// ── 6. 涨停识别口径：收盘未封在最高价不算涨停 ──
const notSealed = limitPullbackSeries();
notSealed[n - 4] = { ...notSealed[n - 4], high: notSealed[n - 4].close + 0.5 };
assert.strictEqual(limitPullbackEvidence(notSealed, { ...V4, code: '600001' }, n - 1, flatBench).limitBarIndex, null, '收盘未封板不应算涨停');

// ── 7. 无未来函数：只用信号日及以前的数据 ──
const cutIndex = n - 2;
const cutEv = limitPullbackEvidence(candles, { ...V4, code: '600001' }, cutIndex, flatBench);
const slicedEv = limitPullbackEvidence(candles.slice(0, cutIndex + 1), { ...V4, code: '600001' }, null, flatBench);
assert.strictEqual(cutEv.volRatio, slicedEv.volRatio, '指定索引与截断序列的量比必须一致');
assert.strictEqual(cutEv.dropPct, slicedEv.dropPct, '跌幅也只应使用信号日之前的数据');

// ── 8. 价位层：可执行计划与回测 v4 口径逐项对齐 ──
const plan = levels.limitPullbackPlan(candles, { code: '600001', params: V4, benchLookup: flatBench });
assert.strictEqual(plan.available, true, '命中样本应产出可执行计划');
assert.strictEqual(plan.algorithmVersion, 'limit-pullback-v4');
assert.strictEqual(plan.patternId, 'limit_pullback');
const buy = candles[n - 1].close;
assert.strictEqual(plan.price, round(buy), '入场参考价应为信号日收盘价');
const atrSeries = atr(candles, 14);
const atrPrev = atrSeries[n - 2];
assert.strictEqual(plan.atr14, round(atrPrev), 'ATR 应取信号日前一根，与回测一致');
const structuralRaw = Math.min(...candles.slice(n - 9, n - 1).map((c) => c.low)) * 0.98;
const floorStop = buy - 2 * atrPrev;
const capStop = buy * 0.92;
const expectedStop = round(Math.max(Math.min(structuralRaw, floorStop), capStop));
assert.ok(Math.abs(plan.stopLoss.value - expectedStop) <= 0.01, `结构止损应等于 max(min(近8根低点×0.98, 买点−2×ATR14), 买点×92%)，实际 ${plan.stopLoss.value} / 期望 ${expectedStop}`);
assert.strictEqual(plan.stopLoss.structural, round(structuralRaw), '结构低点应取信号日前 8 根（不含信号日）');
assert.ok(plan.stopLoss.riskPct > 0 && plan.stopLoss.riskPct <= 8, `风险上限应为 8%，实际 ${plan.stopLoss.riskPct}%`);
const risk = buy - plan.stopLoss.value;
assert.ok(Math.abs(plan.takeProfit[0].value - (buy + 6 * risk)) <= 0.06, '6R 跟踪启动线应等于买点 + 6×风险');
assert.strictEqual(plan.takeProfit[0].type, 'trail_activation', '6R 只是跟踪启动线，不是固定目标');
assert.strictEqual(plan.exitRule.partialExitFraction, 0, 'v4 不做 1R 减仓');
assert.strictEqual(plan.exitRule.maxHoldDays, 20, 'v4 最长持有 20 个交易日');
assert.strictEqual(plan.exitRule.trailMa, 5);
assert.strictEqual(plan.exitRule.trailPct, 0.06);
assert.strictEqual(plan.entryTriggers[0].type, 'close_signal', '入场为信号日收盘确认');
assert.deepStrictEqual(levels.limitPullbackPlan(candles, { code: '600001', params: V4, benchLookup: flatBench }), plan, '同一输入应得到确定性结果');

// ── 9. 未命中 / 基准缺失时的计划原因 ──
const planNoBench = levels.limitPullbackPlan(candles, { code: '600001', params: V4, benchLookup: null });
assert.strictEqual(planNoBench.available, false);
assert.strictEqual(planNoBench.reason, 'bench_unavailable');
assert.strictEqual(levels.limitPullbackPlan(candles, { code: '600001', params: V4, benchLookup: strongBench }).reason, 'rs_not_met');
assert.strictEqual(levels.limitPullbackPlan([], { code: '600001', params: V4 }).reason, 'no_kline');

// ── 10. 与通用价位合并：可执行价位被 v4 覆盖，支撑/压力区保留 ──
const generic = levels.computeLevels(candles, { code: '600001' });
const merged = levels.withLimitPullbackPlan(generic, plan);
assert.deepStrictEqual(merged.supportZones, generic.supportZones, '支撑区应保留通用口径');
assert.deepStrictEqual(merged.resistanceZones, generic.resistanceZones, '压力区应保留通用口径');
assert.deepStrictEqual(merged.invalidationLevel, plan.stopLoss, '失效位应改用 v4 结构止损');
assert.deepStrictEqual(merged.entryTriggers, plan.entryTriggers, '入场触发应改用 v4 收盘信号');
assert.strictEqual(merged.riskReward.value, 6, '观察空间比应改用 v4 计划口径');
assert.strictEqual(merged.atr14, plan.atr14, 'ATR 应与 v4 止损同源');
assert.strictEqual(merged.patternExitVersion, 'limit-pullback-v4');
const summary = levels.levelsSummary(merged);
assert.strictEqual(summary.patternId, 'limit_pullback');
assert.strictEqual(summary.patternExitPlan.version, 'limit-pullback-v4');
assert.strictEqual(levels.withLimitPullbackPlan(generic, planNoBench), generic, '未命中时应原样返回通用价位');

// ── 11. 启用集合：默认规则库同时启用两条 v4 超跌修复形态 ──
assert.deepStrictEqual(listEnabledRules().map((r) => r.id), ['limit_pullback', 'rsi_low_turn'], '默认启用 limit_pullback v4 与 rsi_low_turn v4');

console.log('limit_pullback v4 通过', 'signal@', plan.klineDate, 'buy', plan.price, 'stop', plan.stopLoss.value, 'risk%', plan.stopLoss.riskPct, '6R', plan.takeProfit[0].value);
