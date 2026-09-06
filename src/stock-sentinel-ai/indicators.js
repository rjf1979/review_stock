// 智诊盯盘 · 技术指标层（纯函数，无 IO、无配置）
// 为 AI 研判提供「value + state + trend + available」结构，AI 只读取状态摘要，
// 不接收完整指标数组。所有指标共用同一套前复权、升序 K 线；缺失样本时返回 null，
// 不缩短窗口伪装完整、不用 0 顶替不可用值。

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const last = (arr) => (Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null);

function candlesOk(candles) {
  return Array.isArray(candles) && candles.length > 0;
}

// 升序 K 线中各字段数组；amount 可能缺失，由调用方判断 null。
function series(candles) {
  if (!candlesOk(candles)) return { closes: [], highs: [], lows: [], volumes: [], amounts: [], dates: [] };
  return {
    closes: candles.map((c) => num(c.close)),
    highs: candles.map((c) => num(c.high)),
    lows: candles.map((c) => num(c.low)),
    opens: candles.map((c) => num(c.open)),
    volumes: candles.map((c) => num(c.volume)),
    amounts: candles.map((c) => num(c.amount)),
    dates: candles.map((c) => String(c.date || '')),
  };
}

// 样本百分位：当前值在有效窗口内“小于或等于当前值”的占比（0~100）。
// 有效样本不足窗口时返回 null。
function percentileRank(values, window, value) {
  const list = values.filter((v) => v != null).slice(-window);
  if (list.length < window || value == null) return null;
  const le = list.filter((v) => v <= value).length;
  return Math.round((le / list.length) * 100);
}

// ───────────────────────── ATR（Wilder 平滑） ─────────────────────────
function atr(candles, period = 14) {
  const out = new Array(candles.length).fill(null);
  if (!candlesOk(candles) || period < 1) return out;
  const prevClose = candles.map((c) => num(c.close));
  let trSum = 0;
  let prevAtr = null;
  for (let i = 0; i < candles.length; i++) {
    const h = num(candles[i].high);
    const l = num(candles[i].low);
    const pc = i > 0 ? prevClose[i - 1] : null;
    if (h == null || l == null) continue;
    const tr = Math.max(h - l, pc == null ? 0 : Math.abs(h - pc), pc == null ? 0 : Math.abs(l - pc));
    if (i < period) {
      trSum += tr;
      if (i === period - 1) {
        prevAtr = trSum / period;
        out[i] = prevAtr;
      }
    } else if (prevAtr != null) {
      prevAtr = (prevAtr * (period - 1) + tr) / period;
      out[i] = prevAtr;
    }
  }
  return out;
}

function atrSummary(candles, period = 14) {
  const a = atr(candles, period);
  const values = a.filter((v) => v != null);
  const latest = last(values);
  const close = last(series(candles).closes);
  const atrPct = latest != null && close ? (latest / close) * 100 : null;
  const pctValues = values.map((v, i) => {
    const c = series(candles).closes[i];
    return c ? (v / c) * 100 : null;
  });
  let state = null;
  if (atrPct != null) {
    const pctRank = percentileRank(pctValues, period, atrPct);
    if (pctRank != null) state = pctRank >= 75 ? 'high' : pctRank <= 25 ? 'low' : 'medium';
  }
  return { atr14Pct: { value: round(atrPct), state, available: atrPct != null } };
}

// ───────────────────────── BOLL（20 日总体标准差） ─────────────────────────
function boll(candles, period = 20, mult = 2) {
  const n = candles.length;
  const out = new Array(n).fill(null);
  const { closes } = series(candles);
  for (let i = period - 1; i < n; i++) {
    const win = closes.slice(i - period + 1, i + 1);
    if (win.some((v) => v == null)) continue;
    const mid = win.reduce((a, b) => a + b, 0) / period;
    const variance = win.reduce((a, b) => a + (b - mid) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    const upper = mid + mult * sd;
    const lower = mid - mult * sd;
    const percentB = upper - lower !== 0 ? (closes[i] - lower) / (upper - lower) : null;
    const bandwidth = mid !== 0 ? (upper - lower) / mid : null;
    out[i] = { upper, middle: mid, lower, percentB, bandwidth };
  }
  return out;
}

function bollSummary(candles, period = 20, mult = 2) {
  const b = boll(candles, period, mult);
  const latest = last(b.filter((x) => x != null));
  if (!latest) return { boll20: { percentB: null, bandwidth: null, trend: null, available: false } };
  const bwList = b.map((x) => (x ? x.bandwidth : null)).filter((v) => v != null);
  const last5 = bwList.slice(-5);
  let trend = null;
  if (last5.length >= 5) {
    const avg = last5.reduce((a, v) => a + v, 0) / last5.length;
    if (avg && latest.bandwidth > avg * 1.1) trend = 'expanding';
    else if (avg && latest.bandwidth < avg * 0.9) trend = 'contracting';
    else trend = 'stable';
  }
  return {
    boll20: {
      percentB: round(latest.percentB),
      bandwidth: round(latest.bandwidth),
      trend,
      available: true,
    },
  };
}

// ───────────────────────── ADX / DMI ─────────────────────────
function adx(candles, period = 14) {
  const n = candles.length;
  const adxOut = new Array(n).fill(null);
  const plusOut = new Array(n).fill(null);
  const minusOut = new Array(n).fill(null);
  if (n < period * 2 + 1) return { adx: adxOut, plusDI: plusOut, minusDI: minusOut };
  const highs = candles.map((c) => num(c.high));
  const lows = candles.map((c) => num(c.low));
  const closes = candles.map((c) => num(c.close));
  const trs = [];
  const plusDMs = [];
  const minusDMs = [];
  for (let i = 1; i < n; i++) {
    const up = highs[i] - highs[i - 1];
    const down = lows[i - 1] - lows[i];
    const plusDM = up > down && up > 0 ? up : 0;
    const minusDM = down > up && down > 0 ? down : 0;
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trs.push(tr);
    plusDMs.push(plusDM);
    minusDMs.push(minusDM);
  }
  const wilder = (arr) => {
    const out = [];
    let prev = null;
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
      if (i < period) {
        sum += arr[i];
        if (i === period - 1) prev = sum;
      } else {
        prev = prev - prev / period + arr[i];
      }
      out.push(prev);
    }
    return out;
  };
  const trW = wilder(trs);
  const plusW = wilder(plusDMs);
  const minusW = wilder(minusDMs);
  for (let i = period - 1; i < trW.length; i++) {
    const dx = trW[i] ? (Math.abs(plusW[i] - minusW[i]) / trW[i]) * 100 : null;
    const j = i + 1; // 原始数组从 index 1 开始，映射回 K 线 index
    plusOut[j] = trW[i] ? (plusW[i] / trW[i]) * 100 : null;
    minusOut[j] = trW[i] ? (minusW[i] / trW[i]) * 100 : null;
    if (dx != null) adxOut[j] = dx;
  }
  // Wilder 后的 ADX 再平滑一次（标准实现）
  const dxList = adxOut.map((v, idx) => (v != null ? { idx, v } : null)).filter(Boolean);
  let adxSmooth = null;
  for (let k = period - 1; k < dxList.length; k++) {
    if (k === period - 1) {
      let sum = 0;
      for (let m = 0; m < period; m++) sum += dxList[m].v;
      adxSmooth = sum / period;
    } else {
      adxSmooth = (adxSmooth * (period - 1) + dxList[k].v) / period;
    }
    adxOut[dxList[k].idx] = adxSmooth;
  }
  return { adx: adxOut, plusDI: plusOut, minusDI: minusOut };
}

function adxSummary(candles, period = 14) {
  const { adx: a, plusDI, minusDI } = adx(candles, period);
  const latest = last(a.filter((v) => v != null));
  const plus = last(plusDI.filter((v) => v != null));
  const minus = last(minusDI.filter((v) => v != null));
  let direction = null;
  if (plus != null && minus != null) {
    direction = plus === minus ? 'neutral' : plus > minus ? 'positive' : 'negative';
  }
  return {
    adx14: {
      value: round(latest),
      direction,
      available: latest != null,
    },
  };
}

// ───────────────────────── OBV ─────────────────────────
function obv(candles) {
  const out = new Array(candles.length).fill(null);
  if (!candlesOk(candles)) return out;
  let acc = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = num(candles[i].close);
    const o = num(candles[i].open);
    const v = num(candles[i].volume);
    if (c == null || o == null || v == null) { out[i] = acc; continue; }
    if (c > o) acc += v;
    else if (c < o) acc -= v;
    out[i] = acc;
  }
  return out;
}

function linSlope(values, window = 20) {
  const arr = values.filter((v) => v != null).slice(-window);
  if (arr.length < 2) return null;
  const n = arr.length;
  const xMean = (n - 1) / 2;
  const yMean = arr.reduce((a, b) => a + b, 0) / n;
  let numSum = 0;
  let denSum = 0;
  for (let i = 0; i < n; i++) {
    numSum += (i - xMean) * (arr[i] - yMean);
    denSum += (i - xMean) ** 2;
  }
  return denSum ? numSum / denSum : null;
}

function obvSummary(candles, window = 20) {
  const o = obv(candles);
  const vols = series(candles).volumes;
  const slope = linSlope(o, window);
  const avgVol = (() => {
    const list = vols.filter((v) => v != null).slice(-window);
    return list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;
  })();
  const slope20 = slope != null && avgVol ? slope / avgVol : null;
  let trend = null;
  if (slope != null) trend = slope > 0 ? 'rising' : slope < 0 ? 'falling' : 'flat';
  let divergence = 'none';
  if (o.length >= window) {
    const priceSeg = series(candles).closes.slice(-window);
    const obvSeg = o.slice(-window);
    const pSlope = linSlope(priceSeg, window);
    if (pSlope != null && slope != null && pSlope > 0 && slope < 0) divergence = 'bearish';
    else if (pSlope != null && slope != null && pSlope < 0 && slope > 0) divergence = 'bullish';
  }
  return { obv: { slope20: round(slope20), trend, divergence, available: slope20 != null } };
}

// ───────────────────────── 量能历史分位 ─────────────────────────
function volumePercentileSummary(candles, window = 60) {
  const { volumes, amounts } = series(candles);
  const v = last(volumes);
  const a = last(amounts);
  const volume = v != null ? percentileRank(volumes, window, v) : null;
  const amount = a != null ? percentileRank(amounts.filter((x) => x != null), window, a) : null;
  return {
    volumePercentile: {
      volume60: volume,
      amount60: amount,
      turnover60: null, // 日 K 无流通股本，无法还原换手率；标不可用而非伪造。
      available: volume != null || amount != null,
    },
  };
}

// ───────────────────────── 相对强弱 RS ─────────────────────────
// 个股与基准按共同交易日内连接；共同样本不足返回 null。
function relativeStrength(stockCandles, benchCandles, window = 20) {
  const s = new Map((stockCandles || []).map((c) => [String(c.date), num(c.close)]));
  const b = new Map((benchCandles || []).map((c) => [String(c.date), num(c.close)]));
  const aligned = [];
  for (const [date, sc] of s) {
    const bc = b.get(date);
    if (sc != null && bc != null) aligned.push({ date, sc, bc });
  }
  if (aligned.length < window + 1) return null;
  const t = aligned[aligned.length - 1];
  const t0 = aligned[aligned.length - 1 - window];
  const stockRet = t.sc / t0.sc - 1;
  const benchRet = t.bc / t0.bc - 1;
  return round((stockRet - benchRet) * 100);
}

function round(v) {
  return v == null ? null : Math.round(v * 100) / 100;
}

// 汇总为 doc §5.1 建议发送给 AI 的技术指标摘要。
function summarize(candles, { benchCandles = null } = {}) {
  return {
    ...atrSummary(candles),
    ...bollSummary(candles),
    ...adxSummary(candles),
    ...obvSummary(candles),
    ...volumePercentileSummary(candles),
    relativeStrength: {
      index60: benchCandles ? relativeStrength(candles, benchCandles, 60) : null,
      industry20: null, // 行业归属未接线，待题材数据接入后计算。
      available: false,
    },
  };
}

module.exports = {
  atr,
  boll,
  adx,
  obv,
  percentileRank,
  linSlope,
  relativeStrength,
  atrSummary,
  bollSummary,
  adxSummary,
  obvSummary,
  volumePercentileSummary,
  summarize,
};
