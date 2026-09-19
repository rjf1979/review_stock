// 智诊盯盘 · 观察价位与触发标记（本地确定性算法，纯函数，无 IO、无联网）
// 依据 docs/ai-judgment-copy-v1.md §5.3 固定口径计算：
//   支撑区 / 压力区 / 入场观察条件 / 结构失效位 / 退出观察区 / 观察空间比。
// AI 只解释价位依据，不得自行生成、移动或补全价格。

const { sma, rsiLowTurnEvidence, limitPullbackEvidence } = require('./screener-core');
const { atr, adx, boll, obv, linSlope, relativeStrength } = require('./indicators');

const ALGORITHM_VERSION = 'levels-v1';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round = (v, d = 2) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
const last = (arr) => (Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null);

function candlesOk(candles) {
  return Array.isArray(candles) && candles.length > 0;
}

function series(candles) {
  return {
    closes: candles.map((c) => num(c.close)),
    highs: candles.map((c) => num(c.high)),
    lows: candles.map((c) => num(c.low)),
    volumes: candles.map((c) => num(c.volume)),
    dates: candles.map((c) => String(c.date || '')),
  };
}

// 最近 window 根内，左右各 k 根确认的局部高低点；最后 k 根未确认，不参与。
function swingPoints(candles, window = 120, k = 3) {
  const arr = candles.slice(-window);
  const n = arr.length;
  const highs = [];
  const lows = [];
  for (let i = k; i < n - k; i++) {
    const high = num(arr[i].high);
    const low = num(arr[i].low);
    let isHigh = true;
    let isLow = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (num(arr[j].high) >= high) isHigh = false;
      if (num(arr[j].low) <= low) isLow = false;
    }
    if (isHigh && high != null) highs.push({ price: high, date: String(arr[i].date || ''), index: i });
    if (isLow && low != null) lows.push({ price: low, date: String(arr[i].date || ''), index: i });
  }
  return { highs, lows };
}

// 未回补缺口边界（跳空缺口）：向上跳空形成下方支撑，向下跳空形成上方压力。
// “未回补” = 缺口形成后，价格尚未回到缺口另一侧（向上缺口未见低点回落至昨高之下，
// 向下缺口未见高点回升至昨低之上）。
function gapBoundaries(candles, window = 120) {
  const arr = candles.slice(-window);
  const out = [];
  for (let i = 1; i < arr.length; i++) {
    const prevHigh = num(arr[i - 1].high);
    const prevLow = num(arr[i - 1].low);
    const curHigh = num(arr[i].high);
    const curLow = num(arr[i].low);
    if (prevHigh == null || prevLow == null || curHigh == null || curLow == null) continue;

    if (curLow > prevHigh) {
      // 向上跳空：区间 [昨高, 今低]
      let filled = false;
      for (let j = i + 1; j < arr.length; j++) {
        const l = num(arr[j].low);
        if (l != null && l <= prevHigh) { filled = true; break; }
      }
      if (!filled) out.push({ type: 'gapUp', low: prevHigh, high: curLow, date: String(arr[i].date || ''), index: i });
    }
    if (curHigh < prevLow) {
      // 向下跳空：区间 [今高, 昨低]
      let filled = false;
      for (let j = i + 1; j < arr.length; j++) {
        const h = num(arr[j].high);
        if (h != null && h >= prevLow) { filled = true; break; }
      }
      if (!filled) out.push({ type: 'gapDown', low: curHigh, high: prevLow, date: String(arr[i].date || ''), index: i });
    }
  }
  return out;
}

// 平台/箱体边界：最近 window 内至少 minLen 根的横向整理箱体。
// 判定：区间振幅 <= boxAtrMult × ATR，且无单边趋势（收盘价不持续创新高/新低）。
function platformBoundaries(candles, window = 120, atrValue, { minLen = 15, boxAtrMult = 2.5 } = {}) {
  const arr = candles.slice(-window);
  const out = [];
  if (arr.length < minLen || atrValue == null) return out;
  for (let start = arr.length - minLen; start >= 0; start--) {
    const seg = arr.slice(start);
    if (seg.length < minLen) continue;
    const highs = seg.map((c) => num(c.high)).filter((v) => v != null);
    const lows = seg.map((c) => num(c.low)).filter((v) => v != null);
    const closes = seg.map((c) => num(c.close)).filter((v) => v != null);
    if (!highs.length || !lows.length || !closes.length) continue;
    const hi = Math.max(...highs);
    const lo = Math.min(...lows);
    const range = hi - lo;
    if (range > boxAtrMult * atrValue) break; // 越往前的窗口通常越宽，停止向前扩展，取最近一个稳定箱体。
    const firstClose = closes[0];
    const lastClose = closes[closes.length - 1];
    // 无单边趋势：首尾收盘价仍在箱体中段附近，未明显突破。
    const mid = (hi + lo) / 2;
    const half = range / 2 || 1;
    const trending = Math.abs(lastClose - firstClose) > half && (lastClose > hi * 0.99 || lastClose < lo * 1.01);
    if (!trending) {
      out.push({ type: 'platform', low: lo, high: hi, start, count: seg.length, date: String(arr[arr.length - 1].date || '') });
      break;
    }
  }
  return out;
}

// 生成候选价位：波段高低点、20/60/120 日区间高低、MA20/MA60、BOLL 中/上/下轨、
// 平台/箱体边界与未回补缺口边界。
function candidates(candles, window = 120, atrValue = null) {
  const arr = candles.slice(-window);
  const s = series(arr);
  const out = [];
  const add = (price, source, date = '') => {
    const v = num(price);
    if (v == null) return;
    out.push({ price: v, source, date: String(date || '') });
  };
  const sw = swingPoints(arr, window);
  for (const p of sw.highs) add(p.price, 'swingHigh', p.date);
  for (const p of sw.lows) add(p.price, 'swingLow', p.date);
  const closes = s.closes;
  if (arr.length >= 20) {
    add(Math.max(...arr.slice(-20).map((c) => num(c.high)).filter((v) => v != null)), 'rangeHigh20', arr[arr.length - 1].date);
    add(Math.min(...arr.slice(-20).map((c) => num(c.low)).filter((v) => v != null)), 'rangeLow20', arr[arr.length - 1].date);
  }
  if (arr.length >= 60) {
    add(Math.max(...arr.slice(-60).map((c) => num(c.high)).filter((v) => v != null)), 'rangeHigh60', arr[arr.length - 1].date);
    add(Math.min(...arr.slice(-60).map((c) => num(c.low)).filter((v) => v != null)), 'rangeLow60', arr[arr.length - 1].date);
  }
  if (arr.length >= 120) {
    add(Math.max(...arr.slice(-120).map((c) => num(c.high)).filter((v) => v != null)), 'rangeHigh120', arr[arr.length - 1].date);
    add(Math.min(...arr.slice(-120).map((c) => num(c.low)).filter((v) => v != null)), 'rangeLow120', arr[arr.length - 1].date);
  }
  const ma20 = sma(closes, 20);
  const ma60 = sma(closes, 60);
  add(last(ma20), 'MA20', arr[arr.length - 1].date);
  add(last(ma60), 'MA60', arr[arr.length - 1].date);
  const b = boll(arr, 20, 2);
  const lb = last(b.filter((x) => x != null));
  if (lb) {
    add(lb.middle, 'bollMiddle', arr[arr.length - 1].date);
    add(lb.upper, 'bollUpper', arr[arr.length - 1].date);
    add(lb.lower, 'bollLower', arr[arr.length - 1].date);
  }
  for (const p of platformBoundaries(candles, window, atrValue)) {
    add(p.low, 'platformLow', p.date);
    add(p.high, 'platformHigh', p.date);
  }
  for (const g of gapBoundaries(candles, window)) {
    if (g.type === 'gapUp') {
      add(g.low, 'gapUpLow', g.date);
      add(g.high, 'gapUpHigh', g.date);
    } else {
      add(g.low, 'gapDownLow', g.date);
      add(g.high, 'gapDownHigh', g.date);
    }
  }
  return out.sort((a, b) => a.price - b.price);
}

// 两个候选价位距离不超过 0.3×ATR 时合并；组外各扩 0.15×ATR 缓冲。
function mergeZones(cands, atrValue) {
  if (!cands.length || atrValue == null) return [];
  const eps = 0.3 * atrValue;
  const buffer = 0.15 * atrValue;
  const zones = [];
  let cur = null;
  for (const c of cands) {
    if (!cur || c.price - cur.max > eps) {
      if (cur) zones.push(cur);
      cur = { min: c.price, max: c.price, points: [c] };
    } else {
      cur.max = c.price;
      cur.points.push(c);
    }
  }
  if (cur) zones.push(cur);
  return zones.map((z) => ({
    low: round(Math.max(0, z.min - buffer)),
    high: round(z.max + buffer),
    sources: [...new Set(z.points.map((p) => p.source))],
    points: z.points,
  }));
}

// 区域强度 0~100：来源多样性 30 + 120 日有效触碰 30 + 最近验证时间 20 + 验证日量能确认 20。
function zoneStrength(zone, candles, window = 120) {
  const s = series(candles.slice(-window));
  const touches = [];
  for (let i = 0; i < s.closes.length; i++) {
    const high = s.highs[i];
    const low = s.lows[i];
    if (high != null && low != null && high >= zone.low && low <= zone.high) {
      touches.push({ i, high, low, volume: s.volumes[i], date: s.dates[i] });
    }
  }
  const sourceScore = Math.min(30, zone.sources.length * 7);
  const touchScore = Math.min(30, touches.length * 3);
  let recencyScore = 0;
  if (touches.length) {
    const idx = touches[touches.length - 1].i;
    recencyScore = Math.min(20, Math.max(0, Math.round(((idx + 1) / s.closes.length) * 20)));
  }
  const vols = s.volumes.filter((v) => v != null);
  const avgVol = vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : null;
  const confirmed = touches.filter((t) => avgVol && num(t.volume) >= avgVol * 1.2).length;
  const volumeScore = avgVol ? Math.min(20, confirmed * 4) : 0;
  return {
    strength: Math.min(100, sourceScore + touchScore + recencyScore + volumeScore),
    evidence: {
      sourceScore,
      touchScore,
      recencyScore,
      volumeScore,
      touches: touches.length,
      confirmedVolumeTouches: confirmed,
      lastTouchDate: touches.length ? touches[touches.length - 1].date : null,
    },
  };
}

// 支撑/压力分级：仅保留现价下方最近 3 个支撑区与上方最近 3 个压力区；
// 已被收盘价连续两日有效穿越的区域降级/移除（支撑区被两日收盘跌破下沿、压力区被两日收盘突破上沿）。
function splitZones(zones, price, candles = []) {
  const support = [];
  const resistance = [];
  const closes = candles.map((c) => num(c.close)).filter((v) => v != null);
  const crossedSupport = (z) => closes.length >= 2 && closes[closes.length - 1] < z.low && closes[closes.length - 2] < z.low;
  const crossedResistance = (z) => closes.length >= 2 && closes[closes.length - 1] > z.high && closes[closes.length - 2] > z.high;
  for (const z of zones) {
    if (z.high < price) {
      if (!crossedSupport(z)) support.push(z);
    } else if (z.low > price) {
      if (!crossedResistance(z)) resistance.push(z);
    }
  }
  support.sort((a, b) => b.low - a.low);
  resistance.sort((a, b) => a.low - b.low);
  return { support: support.slice(0, 3), resistance: resistance.slice(0, 3) };
}

function entryTriggers(candles, zones, price, atrValue, { benchCandles = null } = {}) {
  const out = [];
  const support = zones.support[0];
  const resistance = zones.resistance[0];
  const s = series(candles.slice(-20));
  const vma20 = s.volumes.filter((v) => v != null).slice(-20).reduce((a, b) => a + b, 0) / 20 || null;
  if (support && atrValue != null) {
    const last2 = candles.slice(-2);
    const closedAbove = last2.length === 2 && num(last2[1].close) > support.high;
    const contraction = last2.length === 2 && num(last2[1].volume) != null && num(last2[0].volume) != null
      && num(last2[1].volume) < num(last2[0].volume);
    // RS 与 OBV 不得同步明显转弱；RS 缺失时按未知处理，只显示接近回踩。
    const obvLine = obv(candles);
    const obvSlope = linSlope(obvLine, 20);
    const obvWeak = obvSlope != null && obvSlope < 0;
    const rs20 = benchCandles ? relativeStrength(candles, benchCandles, 20) : null;
    const rsWeak = rs20 != null && rs20 <= 0;
    const rsMissing = rs20 == null;
    // 图表阶段只按价位是否已被收盘价站上判断；量能、OBV、RS 仍保留在 missing 中供研判解释。
    const status = closedAbove ? 'achieved' : 'approaching';
    out.push({
      type: 'pullback',
      status,
      zone: { low: support.low, high: support.high },
      confirmAbove: round(support.high),
      missing: {
        volumeContraction: !contraction,
        obv: obvWeak,
        rs: rsWeak || rsMissing,
      },
    });
  }
  if (resistance && atrValue != null) {
    const confirmAbove = resistance.high + 0.2 * atrValue;
    const lastC = last(candles);
    const lastClose = lastC ? num(lastC.close) : null;
    const lastVol = lastC ? num(lastC.volume) : null;
    const adxRes = adx(candles, 14);
    const adxVal = last(adxRes.adx.filter((v) => v != null));
    const volOk = vma20 && lastVol ? lastVol > vma20 * 1.5 : false;
    const adxOk = adxVal != null && adxVal > 25;
    const priceOk = lastClose != null && lastClose > confirmAbove;
    const rs20 = benchCandles ? relativeStrength(candles, benchCandles, 20) : null;
    const rsOk = rs20 != null && rs20 > 0;
    const status = priceOk && volOk && adxOk && rsOk ? 'confirmed' : 'approaching';
    out.push({
      type: 'breakout',
      status,
      zone: { low: resistance.low, high: resistance.high },
      confirmAbove: round(confirmAbove),
      missing: {
        price: !priceOk,
        volume: !volOk,
        adx: !adxOk,
        rs: !rsOk, // 相对强弱 RS20 需行业/宽基基准；基准缺失或 rs20<=0 时只显示接近突破。
      },
    });
  }
  return out;
}

function invalidationLevel(zones, atrValue) {
  const support = zones.support[0];
  if (!support || atrValue == null) return null;
  return {
    value: round(support.low - 0.3 * atrValue),
    confirmation: 'two_closes_or_high_volume_break',
    sourceSupportLow: support.low,
  };
}

// 移动保护线：最近有效窗口最高收盘价 - 2 × ATR14（仅作退出观察证据，非卖出指令）。
function trailingProtectionLine(candles, atrValue, window = 120) {
  const arr = candles.slice(-window);
  const closes = arr.map((c) => num(c.close)).filter((v) => v != null);
  if (!closes.length || atrValue == null) return null;
  const highestClose = Math.max(...closes);
  return {
    type: 'trailing',
    value: round(Math.max(0, highestClose - 2 * atrValue)),
    sourceHighestClose: round(highestClose),
    window,
  };
}

function exitWatchZones(zones, candles = [], atrValue = null) {
  const out = zones.resistance.map((z) => ({ type: 'resistance', low: z.low, high: z.high }));
  const trailing = trailingProtectionLine(candles, atrValue);
  if (trailing) out.push(trailing);
  return out;
}

// ───────── rsi_low_turn v4：形态自带退出计划（与回测口径一一对应）─────────
// 依据 docs/rsi_low_turn与limit_pullback盈亏比优化报告-2021至2026.md 与 tools/pattern_exits.py 的 rsi_low_turn 规格：
//   入场：RSI14 拐头前值 < low（默认 20）且当前值 > 前值，且近 drop_days（60）个交易日跌幅 ≤ drop_max（-30%）。
//   止损：max( min(近 10 根低点 × 0.99, 买点 − 2 × ATR14), 买点 × (1 − 8%) )，风险上限 8%。
//   目标：不做固定目标止盈，也不做 1R 减半；6R 只是「切换跟踪」的启动线（不减仓）。
//   跟踪：启动后 max(MA10 前一根 × 0.92, 期间最高价 × 0.92, 买点保本)。
//   时间止损：最长持有 20 个交易日。
// 该口径只使用信号日及以前的数据；纯函数，无 IO、无联网。
const RSI_LOW_TURN_VERSION = 'rsi-low-turn-v4';
const RSI_LOW_TURN_EXIT = {
  version: RSI_LOW_TURN_VERSION,
  lowLookback: 10,
  stopBuf: 0.01,
  atrMult: 2,
  riskCapPct: 8,
  firstRMultiple: 6,
  trailMa: 10,
  trailPct: 0.08,
  maxHoldDays: 20,
};

const RSI_LOW_TURN_EXIT_TEXT = '结构止损（近10根低点下方1% 与 买点−2×ATR14 取更近者，风险上限8%）'
  + '；6R 只切换到跟踪止盈（MA10 前一根×0.92 / 期间最高价×0.92 / 保本价），不减仓、不设固定目标；'
  + `最长持有 ${RSI_LOW_TURN_EXIT.maxHoldDays} 个交易日`;

function rsiLowTurnPlan(candles, { code = '', params = {} } = {}) {
  const cfg = RSI_LOW_TURN_EXIT;
  const out = {
    code: String(code || ''),
    patternId: 'rsi_low_turn',
    algorithmVersion: cfg.version,
    klineDate: '',
    matched: false,
    available: false,
    reason: null,
    evidence: null,
    price: null,
    atr14: null,
    entryTriggers: [],
    stopLoss: null,
    takeProfit: [],
    exitWatchZones: [],
    riskReward: { value: null, state: null, available: false },
    exitRule: {
      version: cfg.version,
      kind: 'pattern_native',
      maxHoldDays: cfg.maxHoldDays,
      partialExitFraction: 0,
      firstRMultiple: cfg.firstRMultiple,
      trailMa: cfg.trailMa,
      trailPct: cfg.trailPct,
      text: RSI_LOW_TURN_EXIT_TEXT,
    },
  };
  if (!candlesOk(candles)) { out.reason = 'no_kline'; return out; }
  const arr = candles;
  const n = arr.length;
  out.klineDate = String(arr[n - 1] && arr[n - 1].date || '');
  const ev = rsiLowTurnEvidence(arr, params || {}, n - 1);
  out.evidence = {
    period: ev.period,
    low: ev.low,
    rsi: round(ev.rsi),
    prevRsi: round(ev.prevRsi),
    dropDays: ev.dropDays,
    dropMax: ev.dropMax,
    dropPct: round(ev.dropPct),
  };
  if (n < ev.minBars) { out.reason = 'sample_too_short'; return out; }
  if (ev.rsi == null || ev.prevRsi == null) { out.reason = 'rsi_unavailable'; return out; }
  if (!(ev.prevRsi < ev.low && ev.rsi > ev.prevRsi)) { out.reason = 'no_signal'; return out; }
  if (ev.needDrop && ev.dropPct == null) { out.reason = 'drop_window_short'; return out; }
  if (ev.needDrop && !(ev.dropPct <= ev.dropMax)) { out.reason = 'drop_not_met'; return out; }

  const s = series(arr);
  const buy = num(s.closes[n - 1]);
  if (!(buy > 0)) { out.reason = 'close_unavailable'; return out; }
  // ATR 与结构位都取「信号日之前」的已完成数据，与回测 _plan_pattern 一致。
  const atrSeries = atr(arr, 14);
  let atrPrev = null;
  for (let i = n - 2; i >= 0; i--) {
    const v = num(atrSeries[i]);
    if (v != null && v > 0) { atrPrev = v; break; }
  }
  const atrUsed = atrPrev != null ? atrPrev : buy * 0.03;
  const lowWindow = s.lows.slice(Math.max(0, n - 1 - cfg.lowLookback), n - 1).filter((v) => v != null);
  const structural = lowWindow.length ? Math.min(...lowWindow) * (1 - cfg.stopBuf) : null;
  const floorStop = buy - cfg.atrMult * atrUsed;
  const capStop = buy * (1 - cfg.riskCapPct / 100);
  let stop = structural == null ? floorStop : Math.min(structural, floorStop);
  stop = Math.max(stop, capStop);
  if (!(stop < buy)) stop = capStop;
  const risk = buy - stop;
  const firstTarget = buy + risk * cfg.firstRMultiple;
  const riskPct = (risk / buy) * 100;

  out.price = round(buy);
  out.atr14 = round(atrUsed);
  out.matched = true;
  out.available = true;
  out.entryTriggers = [{
    type: 'close_signal',
    status: 'confirmed',
    confirmAbove: round(buy),
    label: '信号日收盘确认（RSI 低位拐头 + 前期超跌），按信号日收盘价为可执行参考价',
  }];
  out.stopLoss = {
    type: 'structure_stop',
    value: round(stop),
    price: round(stop),
    label: `结构止损 ${round(stop)}（风险 ${round(riskPct)}%）`,
    confirmation: 'close_below_stop',
    source: 'max(min(近10根低点×0.99, 买点−2×ATR14), 买点×(1−8%))',
    structural: round(structural),
    floorStop: round(floorStop),
    capStop: round(capStop),
    riskPct: round(riskPct),
  };
  out.takeProfit = [{
    type: 'trail_activation',
    value: round(firstTarget),
    label: `6R 跟踪止盈启动线 ${round(firstTarget)}（不减仓，突破后按 MA10×0.92 / 最高价×0.92 跟踪）`,
    rMultiple: cfg.firstRMultiple,
    trailMa: cfg.trailMa,
    trailPct: cfg.trailPct,
    note: '不设固定目标止盈；未启动跟踪前只受结构止损与 20 日时间止损约束。',
  }];
  out.exitWatchZones = out.takeProfit;
  out.riskReward = {
    value: cfg.firstRMultiple,
    state: 'reasonable',
    available: true,
    referencePrice: round(buy),
    basis: 'planned_6R_trailing',
    stopDistancePct: round(risk / buy, 4),
  };
  return out;
}

// 用 v4 计划覆盖通用价位口径中的「可执行价位」（入场参考价 / 止损 / 止盈观察 / 观察空间比），
// 支撑区与压力区仍保留通用口径，保证详情页原有结构信息不丢失。
function withRsiLowTurnPlan(levels, plan) {
  if (!levels || !plan || !plan.available) return levels;
  return {
    ...levels,
    patternId: plan.patternId,
    patternExitVersion: plan.algorithmVersion,
    patternExitPlan: plan.exitRule,
    // 与 v4 止损同源：一律显示信号日前一根的 ATR14，避免详情页出现两套 ATR 口径。
    atr14: plan.atr14,
    entryTriggers: plan.entryTriggers,
    invalidationLevel: plan.stopLoss,
    exitWatchZones: plan.exitWatchZones,
    takeProfit: plan.takeProfit,
    riskReward: plan.riskReward,
  };
}

// ───────── limit_pullback v4：形态自带退出计划（与回测口径一一对应）─────────
// 依据 docs/rsi_low_turn与limit_pullback盈亏比优化报告-2021至2026.md 与 tools/pattern_exits.py 的 limit_pullback 规格
// （v4 覆盖 first_r_multiple=6.0 / first_exit_fraction=0.0 / no_target=true）：
//   入场：近 window（15）日内有涨停（不含信号日）、末根缩量（量 < 5 日均量 × 0.9）、低点不破区间支撑；
//         再叠加「近 drop_days（60）日跌幅 ≤ drop_max（-30%）」与「近 rs_days（20）日相对沪深300 ≤ rs_max（-5pp）」。
//   止损：max( min(近 8 根低点 × 0.98, 买点 − 2 × ATR14), 买点 × (1 − 8%) )，风险上限 8%。
//   目标：不做固定目标止盈，也不做 1R 减半；6R 只是「切换跟踪」的启动线（不减仓）。
//   跟踪：启动后 max(MA5 前一根 × 0.94, 期间最高价 × 0.94, 买点保本)。
//   时间止损：最长持有 20 个交易日。
// 该口径只使用信号日及以前的数据；基准缺失时不做相对强度放行，直接给出不可执行原因。
const LIMIT_PULLBACK_VERSION = 'limit-pullback-v4';
const LIMIT_PULLBACK_EXIT = {
  version: LIMIT_PULLBACK_VERSION,
  lowLookback: 8,
  stopBuf: 0.02,
  atrMult: 2,
  riskCapPct: 8,
  firstRMultiple: 6,
  trailMa: 5,
  trailPct: 0.06,
  maxHoldDays: 20,
};

const LIMIT_PULLBACK_EXIT_TEXT = '结构止损（近8根低点下方2% 与 买点−2×ATR14 取更近者，风险上限8%）'
  + '；6R 只切换到跟踪止盈（MA5 前一根×0.94 / 期间最高价×0.94 / 保本价），不减仓、不设固定目标；'
  + `最长持有 ${LIMIT_PULLBACK_EXIT.maxHoldDays} 个交易日`;

function limitPullbackPlan(candles, { code = '', params = {}, benchLookup = null } = {}) {
  const cfg = LIMIT_PULLBACK_EXIT;
  const out = {
    code: String(code || ''),
    patternId: 'limit_pullback',
    algorithmVersion: cfg.version,
    klineDate: '',
    matched: false,
    available: false,
    reason: null,
    evidence: null,
    price: null,
    atr14: null,
    entryTriggers: [],
    stopLoss: null,
    takeProfit: [],
    exitWatchZones: [],
    riskReward: { value: null, state: null, available: false },
    exitRule: {
      version: cfg.version,
      kind: 'pattern_native',
      maxHoldDays: cfg.maxHoldDays,
      partialExitFraction: 0,
      firstRMultiple: cfg.firstRMultiple,
      trailMa: cfg.trailMa,
      trailPct: cfg.trailPct,
      text: LIMIT_PULLBACK_EXIT_TEXT,
    },
  };
  if (!candlesOk(candles)) { out.reason = 'no_kline'; return out; }
  const arr = candles;
  const n = arr.length;
  out.klineDate = String(arr[n - 1] && arr[n - 1].date || '');
  const ev = limitPullbackEvidence(arr, { ...(params || {}), code }, n - 1, benchLookup);
  out.evidence = {
    window: ev.window,
    volShrink: ev.volShrink,
    limit: Number(ev.limit),
    limitDate: ev.limitDate,
    limitDaysAgo: ev.limitDaysAgo,
    support: round(ev.support),
    low: round(ev.low),
    volRatio: round(ev.volRatio, 4),
    dropDays: ev.dropDays,
    dropMax: ev.dropMax,
    dropPct: round(ev.dropPct),
    rsDays: ev.rsDays,
    rsMax: ev.rsMax,
    rsPct: round(ev.rsPct),
    benchMissing: ev.benchMissing,
  };
  if (n < ev.minBars) { out.reason = 'sample_too_short'; return out; }
  if (ev.limitBarIndex == null) { out.reason = 'no_limit_up'; return out; }
  if (ev.needDrop && ev.dropPct == null) { out.reason = 'drop_window_short'; return out; }
  if (ev.needRs && ev.rsPct == null) { out.reason = ev.benchMissing ? 'bench_unavailable' : 'rs_window_short'; return out; }
  if (ev.volRatio == null) { out.reason = 'volume_unavailable'; return out; }
  if (!(ev.volRatio < ev.volShrink)) { out.reason = 'not_contracted'; return out; }
  if (ev.support == null || ev.low == null || !(ev.low >= ev.support * 0.98)) { out.reason = 'support_broken'; return out; }
  if (ev.needDrop && !(ev.dropPct <= ev.dropMax)) { out.reason = 'drop_not_met'; return out; }
  if (ev.needRs && !(ev.rsPct <= ev.rsMax)) { out.reason = 'rs_not_met'; return out; }

  const s = series(arr);
  const buy = num(s.closes[n - 1]);
  if (!(buy > 0)) { out.reason = 'close_unavailable'; return out; }
  // ATR 与结构位都取「信号日之前」的已完成数据，与回测 _plan_pattern 一致。
  const atrSeries = atr(arr, 14);
  let atrPrev = null;
  for (let i = n - 2; i >= 0; i--) {
    const v = num(atrSeries[i]);
    if (v != null && v > 0) { atrPrev = v; break; }
  }
  const atrUsed = atrPrev != null ? atrPrev : buy * 0.03;
  const lowWindow = s.lows.slice(Math.max(0, n - 1 - cfg.lowLookback), n - 1).filter((v) => v != null);
  const structural = lowWindow.length ? Math.min(...lowWindow) * (1 - cfg.stopBuf) : null;
  const floorStop = buy - cfg.atrMult * atrUsed;
  const capStop = buy * (1 - cfg.riskCapPct / 100);
  let stop = structural == null ? floorStop : Math.min(structural, floorStop);
  stop = Math.max(stop, capStop);
  if (!(stop < buy)) stop = capStop;
  const risk = buy - stop;
  const firstTarget = buy + risk * cfg.firstRMultiple;
  const riskPct = (risk / buy) * 100;

  out.price = round(buy);
  out.atr14 = round(atrUsed);
  out.matched = true;
  out.available = true;
  out.entryTriggers = [{
    type: 'close_signal',
    status: 'confirmed',
    confirmAbove: round(buy),
    label: '信号日收盘确认（涨停后缩量回踩不破支撑，且超跌弱于大盘），按信号日收盘价为可执行参考价',
  }];
  out.stopLoss = {
    type: 'structure_stop',
    value: round(stop),
    price: round(stop),
    label: `结构止损 ${round(stop)}（风险 ${round(riskPct)}%）`,
    confirmation: 'close_below_stop',
    source: 'max(min(近8根低点×0.98, 买点−2×ATR14), 买点×(1−8%))',
    structural: round(structural),
    floorStop: round(floorStop),
    capStop: round(capStop),
    riskPct: round(riskPct),
  };
  out.takeProfit = [{
    type: 'trail_activation',
    value: round(firstTarget),
    label: `6R 跟踪止盈启动线 ${round(firstTarget)}（不减仓，突破后按 MA5×0.94 / 最高价×0.94 跟踪）`,
    rMultiple: cfg.firstRMultiple,
    trailMa: cfg.trailMa,
    trailPct: cfg.trailPct,
    note: '不设固定目标止盈；未启动跟踪前只受结构止损与 20 日时间止损约束。',
  }];
  out.exitWatchZones = out.takeProfit;
  out.riskReward = {
    value: cfg.firstRMultiple,
    state: 'reasonable',
    available: true,
    referencePrice: round(buy),
    basis: 'planned_6R_trailing',
    stopDistancePct: round(risk / buy, 4),
  };
  return out;
}

// 用 v4 计划覆盖通用价位口径中的「可执行价位」（入场参考价 / 止损 / 止盈观察 / 观察空间比），
// 支撑区与压力区仍保留通用口径，保证详情页原有结构信息不丢失。
function withLimitPullbackPlan(levels, plan) {
  if (!levels || !plan || !plan.available) return levels;
  return {
    ...levels,
    patternId: plan.patternId,
    patternExitVersion: plan.algorithmVersion,
    patternExitPlan: plan.exitRule,
    // 与 v4 止损同源：一律显示信号日前一根的 ATR14，避免详情页出现两套 ATR 口径。
    atr14: plan.atr14,
    entryTriggers: plan.entryTriggers,
    invalidationLevel: plan.stopLoss,
    exitWatchZones: plan.exitWatchZones,
    takeProfit: plan.takeProfit,
    riskReward: plan.riskReward,
  };
}

// 观察空间比：以当前价作为入场参考价，衡量到下一压力区下沿的潜在空间 vs 到结构失效位的风险距离。
// （doc §5.3 rule10 的“入场确认价”在突破/回踩两种场景下不一致，统一以当前收盘价为可复算参考价，
//   保证 reward/risk 均为正，且与示例空间比量级一致。）
function riskReward(zones, price, atrValue, invalidation) {
  const resistance = zones.resistance[0];
  const entry = price;
  const reward = resistance ? resistance.low - entry : null;
  const risk = invalidation ? entry - invalidation.value : null;
  if (!resistance || !invalidation || reward == null || risk == null || risk <= 0) {
    return { value: null, state: null, available: false };
  }
  const value = reward / risk;
  const state = value >= 2 ? 'reasonable' : value >= 1.5 ? 'moderate' : 'limited';
  return { value: round(value), state, available: true, referencePrice: round(entry) };
}

// 可执行风险收益：必须使用可追溯触发价、结构失效价和第一压力目标，并计入双边成本与滑点。
function actionableRiskReward(levels, { costRate = 0.0015, slippageRate = 0.0015, minStopDistancePct = 0.015 } = {}) {
  const triggers = Array.isArray(levels && levels.entryTriggers) ? levels.entryTriggers : [];
  const trigger = triggers.find((item) => item.status === 'confirmed' || item.status === 'achieved') || triggers[0];
  const entry = num(trigger && trigger.confirmAbove);
  const invalidation = num(levels && levels.invalidationLevel && levels.invalidationLevel.value);
  const resistance = Array.isArray(levels && levels.resistanceZones) ? levels.resistanceZones[0] : null;
  const target = num(resistance && resistance.low);
  if (!(invalidation > 0 && entry > invalidation && target > entry)) {
    return { available: false, value: null, reason: '价位顺序不满足失效价 < 入场价 < 第一目标价', entry, invalidation, target };
  }
  const stopDistancePct = (entry - invalidation) / entry;
  if (stopDistancePct < minStopDistancePct) {
    return { available: false, value: null, reason: '止损距离过小', entry, invalidation, target, stopDistancePct };
  }
  const effectiveEntry = entry * (1 + costRate + slippageRate);
  const effectiveTarget = target * (1 - costRate - slippageRate);
  const effectiveInvalidation = invalidation * (1 - slippageRate);
  const reward = effectiveTarget - effectiveEntry;
  const risk = effectiveEntry - effectiveInvalidation;
  if (!(reward > 0 && risk > 0)) return { available: false, value: null, reason: '计入成本滑点后收益或风险距离无效', entry, invalidation, target };
  return {
    available: true,
    value: round(reward / risk),
    entry,
    invalidation,
    target,
    stopDistancePct,
    costRate,
    slippageRate,
    triggerStatus: trigger.status || 'approaching',
  };
}

/**
 * 计算一只股票某段 K 线的观察价位集合（纯函数）。
 * @param {Array} candles 前复权升序日 K。
 * @param {{code?:string, window?:number}} opts
 */
function computeLevels(candles, { code = '', window = 120, benchCandles = null } = {}) {
  if (!candlesOk(candles)) {
    return {
      code: String(code || ''),
      algorithmVersion: ALGORITHM_VERSION,
      available: false,
      reason: 'no_kline',
      supportZones: [],
      resistanceZones: [],
      entryTriggers: [],
      invalidationLevel: null,
      exitWatchZones: [],
      riskReward: { value: null, state: null, available: false },
    };
  }
  const a = atr(candles, 14);
  const atrValue = last(a.filter((v) => v != null));
  const price = last(series(candles).closes);
  const cands = candidates(candles, window, atrValue);
  const rawZones = mergeZones(cands, atrValue);
  const zonesWithStrength = rawZones.map((z) => ({
    ...z,
    ...zoneStrength(z, candles, window),
  }));
  const split = splitZones(zonesWithStrength, price, candles);
  const supportZones = split.support.map((z) => ({ low: z.low, high: z.high, strength: z.strength, sources: z.sources, evidence: z.evidence }));
  const resistanceZones = split.resistance.map((z) => ({ low: z.low, high: z.high, strength: z.strength, sources: z.sources, evidence: z.evidence }));
  const triggers = entryTriggers(candles, split, price, atrValue, { benchCandles });
  const invalidation = invalidationLevel(split, atrValue);
  const exitWatch = exitWatchZones(split, candles, atrValue);
  const rr = riskReward(split, price, atrValue, invalidation);
  const available = atrValue != null && price != null;
  return {
    code: String(code || ''),
    algorithmVersion: ALGORITHM_VERSION,
    available,
    reason: available ? null : (atrValue == null ? 'atr_unavailable' : 'close_unavailable'),
    klineDate: last(series(candles).dates),
    atr14: round(atrValue),
    price: round(price),
    supportZones,
    resistanceZones,
    entryTriggers: triggers,
    invalidationLevel: invalidation,
    exitWatchZones: exitWatch,
    riskReward: rr,
  };
}

// 直接供 AI 读取的价位摘要（本地结构化摘要，不发送完整 K 线）。
function levelsSummary(levels) {
  if (!levels || !levels.available) {
    return { algorithmVersion: levels && levels.algorithmVersion || ALGORITHM_VERSION, available: false, reason: levels && levels.reason || 'unavailable' };
  }
  const out = {
    algorithmVersion: levels.algorithmVersion,
    available: true,
    atr14: levels.atr14,
    price: levels.price,
    supportZones: levels.supportZones.map((z) => ({ low: z.low, high: z.high, strength: z.strength, sources: z.sources })),
    resistanceZones: levels.resistanceZones.map((z) => ({ low: z.low, high: z.high, strength: z.strength, sources: z.sources })),
    entryTriggers: levels.entryTriggers,
    invalidationLevel: levels.invalidationLevel,
    exitWatchZones: levels.exitWatchZones,
    riskReward: levels.riskReward,
  };
  // 命中 v4 形态（rsi_low_turn / limit_pullback）时附上形态自带退出计划
  // （固定规则文本，供 AI 解释风险，不含新价格）；patternId 由 v4 计划写入。
  if (levels.patternExitPlan) {
    out.patternId = levels.patternId || 'rsi_low_turn';
    out.patternExitPlan = levels.patternExitPlan;
  }
  return out;
}

module.exports = {
  ALGORITHM_VERSION,
  computeLevels,
  levelsSummary,
  swingPoints,
  candidates,
  mergeZones,
  zoneStrength,
  splitZones,
  entryTriggers,
  invalidationLevel,
  exitWatchZones,
  trailingProtectionLine,
  RSI_LOW_TURN_EXIT,
  rsiLowTurnPlan,
  withRsiLowTurnPlan,
  LIMIT_PULLBACK_EXIT,
  limitPullbackPlan,
  withLimitPullbackPlan,
  gapBoundaries,
  platformBoundaries,
  riskReward,
  actionableRiskReward,
};
