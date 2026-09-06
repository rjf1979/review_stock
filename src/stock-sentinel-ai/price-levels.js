// 智诊盯盘 · 观察价位与触发标记（本地确定性算法，纯函数，无 IO、无联网）
// 依据 docs/ai-judgment-copy-v1.md §5.3 固定口径计算：
//   支撑区 / 压力区 / 入场观察条件 / 结构失效位 / 退出观察区 / 观察空间比。
// AI 只解释价位依据，不得自行生成、移动或补全价格。

const { sma } = require('./screener-core');
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
  return {
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
  gapBoundaries,
  platformBoundaries,
  riskReward,
};
