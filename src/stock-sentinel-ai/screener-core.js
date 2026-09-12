// 量能洞察 · 选股引擎（两段式 + K线形态）
//   第一段：clist 全市场快照 → 量能/快照初筛 → 候选池。
//   第二段：对候选池拉历史K线（腾讯前复权）→ 形态复筛。
// 形态规则基于用户提供《量价形态选股示意图》（5 大类）逐字落地。
// 其余形态说明与量化方案见 docs/xingtaidu-patterns.md。

const { MARKETS, fetchMarketSnapshot, fetchKline, fetchQuotesDetailed, isStOrSuspended, fetchMajorIndicesTencent, fetchIndustryBoards, fetchConceptBoards, fetchBoardConstituents, fetchMarketSentiment } = require('./data');
const { readKline, recentTradingDates } = require('./storage');
const rulesStore = require('./rules-store');
const { summarizeSnapshot, classifyMarketRegime, strategyForRegime, riskFlagsForCandidate } = require('./market-regime');
const { isClosedMarketTime, canReuseClosedPrescan, assessPrescanValidity, readPrescan, writePrescan, archivePrescan } = require('./market-prescan-store');
const { SELECTION_CONTRACT_VERSION, EVIDENCE_STATUS, EXCLUSION_REASONS, createBatchId } = require('./selection-contract');
const { buildInitialSelection } = require('./selection-policy');
const { rulesFingerprint } = require('./recommendation-validity');
const { isAdjustmentCorroborated } = require('./kline-source-contract');

let runtimePrescan = null;

// 候选自动入池门槛：量能分（0~100）默认取 70。
// 55 分适合观察池，不适合作为全市场自动入池门槛；70 分用于压缩
// 候选规模，后续仍可通过形态复筛和 AI 综合评分继续收敛。
const AUTO_POOL_MIN_SCORE = 70;
const LOCAL_KLINE_CONFIRM_MIN_BARS = 60;

function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

function shanghaiDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(date);
}

function last(candles) {
  return candles[candles.length - 1];
}

function isYang(c) { return c.close >= c.open; }
function isYin(c) { return c.close < c.open; }
function body(c) { return Math.abs(c.close - c.open); }
function lowerShadow(c) { return Math.min(c.open, c.close) - c.low; }
function range(c) { return c.high - c.low; }

// ───────────────────────── 量能评分（0~100） ─────────────────────────
function scoreVolume(item) {
  const { volumeRatio, turnover, changePct } = item;
  const mainNet = Number(item.mainNet) || 0;
  const amount = Number(item.amount) || 0;
  const vrScore = clamp(volumeRatio / 3, 0, 1);
  const toScore = clamp(turnover / 10, 0, 1);
  const netScore = clamp(mainNet / 5e7, -1, 1);
  const amtScore = clamp(Math.log10(amount + 1) / 8.5, 0, 1);
  const chgScore = clamp((changePct + 5) / 10, 0, 1);
  const raw = 0.34 * vrScore + 0.2 * toScore + 0.2 * netScore + 0.14 * amtScore + 0.12 * chgScore;
  return Math.round(clamp(raw, 0, 1) * 100);
}

function volumeProfile(item) {
  const amountYi = item.amount / 1e8;
  const netYi = item.mainNet / 1e8;
  return {
    code: item.code,
    name: item.name,
    market: item.market || '',
    price: item.price,
    prevClose: Number(item.prevClose) || null,
    changePct: item.changePct,
    turnover: item.turnover,
    volumeRatio: item.volumeRatio,
    amountYi: Math.round(amountYi * 100) / 100,
    mainNetYi: Math.round(netYi * 100) / 100,
    floatMcapYi: item.floatMcap ? Math.round((item.floatMcap / 1e8) * 100) / 100 : 0,
    score: scoreVolume(item),
  };
}

// 自动入池资格：当日实时快照有效（score 为有限数）+ 命中至少一条启用规则
// （调用处保证已命中）+ 量能分不低于门槛。
function meetsAutoPoolGate(profile, minScore = AUTO_POOL_MIN_SCORE) {
  const score = Number(profile && profile.score);
  return Number.isFinite(score) && score >= minScore;
}

// 同一股票可属于多个行业或概念。题材内的龙头名次只比较同题材成分股，依次看
// 涨停状态、涨跌幅、主力净流入和量能分，避免把不同题材的绝对成交额直接混排。
function compareThemeLeader(left, right) {
  return Number(right.profile.isLimitUp) - Number(left.profile.isLimitUp)
    || Number(right.profile.changePct) - Number(left.profile.changePct)
    || Number(right.profile.mainNetYi) - Number(left.profile.mainNetYi)
    || Number(right.profile.score) - Number(left.profile.score)
    || String(left.profile.code).localeCompare(String(right.profile.code));
}

function rankThemeLeaders(entries, themes, themeCodes, rankField = 'themeLeaderRanks') {
  const groups = new Map();
  for (const entry of entries) {
    entry.matchingThemes = themes.filter((theme) => (themeCodes.get(theme.code) || new Set()).has(entry.profile.code));
    entry[rankField] = [];
    for (const theme of entry.matchingThemes) {
      if (!groups.has(theme.code)) groups.set(theme.code, []);
      groups.get(theme.code).push(entry);
    }
  }
  for (const [code, members] of groups) {
    members.sort(compareThemeLeader).forEach((entry, index) => {
      const theme = entry.matchingThemes.find((item) => item.code === code);
      entry[rankField].push({ name: theme.name, code, kind: theme.kind, rank: index + 1, coverage: theme.coverage || 'partial' });
    });
  }
  for (const entry of entries) {
    entry[rankField].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
    entry.bestThemeRank = entry[rankField].length ? entry[rankField][0].rank : Number.MAX_SAFE_INTEGER;
    entry.isThemeLeader = entry.bestThemeRank === 1;
  }
  entries.sort((a, b) => a.bestThemeRank - b.bestThemeRank || compareThemeLeader(a, b));
  return entries;
}

// ───────────────────────── 技术指标层 ─────────────────────────
function sma(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

function ema(values, n) {
  const out = new Array(values.length).fill(null);
  if (!values.length) return out;
  const k = 2 / (n + 1);
  let prev = values[0];
  out[0] = prev;
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function macd(candles, fast = 12, slow = 26, signal = 9) {
  const closes = candles.map((c) => c.close);
  const eF = ema(closes, fast);
  const eS = ema(closes, slow);
  const dif = eF.map((v, i) => v - eS[i]);
  const dea = ema(dif, signal);
  const hist = dif.map((v, i) => (v - dea[i]) * 2);
  return { dif, dea, hist };
}

function rsi(candles, n = 14) {
  const closes = candles.map((c) => c.close);
  const out = new Array(closes.length).fill(null);
  let gain = 0;
  let loss = 0;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const g = Math.max(ch, 0);
    const l = Math.max(-ch, 0);
    if (i <= n) {
      gain += g;
      loss += l;
      if (i === n) {
        avgGain = gain / n;
        avgLoss = loss / n;
        out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
      }
    } else {
      avgGain = (avgGain * (n - 1) + g) / n;
      avgLoss = (avgLoss * (n - 1) + l) / n;
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
  }
  return out;
}

function volMa(candles, n) {
  return sma(candles.map((c) => c.volume), n);
}

// 涨幅限制（按代码推断，用于涨停识别）
function limitPct(code) {
  if (/^30/.test(code)) return 0.2;
  if (/^68/.test(code)) return 0.2;
  if (/^(8|4|92)/.test(code)) return 0.3;
  return 0.1;
}

// ───────────────────────── 形态检测器（输入：升序K线数组） ─────────────────────────
function miss(reason) { return { matched: false, score: 0, reason }; }
function ok(score, reason, detail) { return { matched: true, score, reason, detail }; }

const PATTERNS = {
  ma_bullish(candles) {
    const n = candles.length;
    if (n < 60) return miss('均线样本不足');
    const close = candles.map((c) => c.close);
    const ma5 = sma(close, 5), ma10 = sma(close, 10), ma20 = sma(close, 20), ma60 = sma(close, 60);
    const i = n - 2;
    const a5 = ma5[i], a10 = ma10[i], a20 = ma20[i], a60 = ma60[i];
    if (!(a5 > a10 && a10 > a20)) return miss('非多头排列');
    const disp5 = ma5[n - 1] - ma5[n - 6];
    const disp10 = ma10[n - 1] - ma10[n - 6];
    if (!(disp5 > 0 && disp10 > 0)) return miss('均线未向上发散');
    const c = last(candles);
    const vol = c.volume;
    const ref = volMa(candles, 5)[n - 2] || 1;
    const score = 60 + clamp((a20 > a60 ? 15 : 0) + clamp(disp5 / c.close, 0, 0.25) * 80 + clamp(vol / ref - 1, 0, 1) * 15, 0, 40);
    return ok(Math.round(score), '5/10/20 多头排列向上发散，回踩不破');
  },
  pullback_ma20(candles) {
    const n = candles.length;
    if (n < 60) return miss('样本不足');
    const close = candles.map((c) => c.close);
    const ma20 = sma(close, 20);
    const i = n - 1;
    const c = last(candles);
    const ma = ma20[i];
    if (!ma) return miss('MA20 未形成');
    const chg20 = (close[i] - close[i - 20]) / close[i - 20];
    if (chg20 < 0.05) return miss('前期涨幅不足');
    if (c.low < ma * 0.98) return miss('已跌破20日线');
    const vol = c.volume;
    const ref = volMa(candles, 5)[i - 1] || 1;
    if (vol > ref * 1.2) return miss('回踩未缩量');
    const stabil = isYang(c) || c.close >= c.open * 0.995;
    const score = 60 + clamp((vol / ref) * 40, 0, 30) + (stabil ? 10 : 0);
    return ok(Math.round(score), '上涨后缩量回踩20日线，不破且企稳');
  },
  macd_water_golden(candles) {
    const n = candles.length;
    if (n < 40) return miss('样本不足');
    const { dif, dea } = macd(candles);
    const i = n - 1, p = n - 2;
    if (dif[i] <= 0) return miss('DIF 不在零轴上方');
    if (dea[i] <= 0) return miss('DEA 不在零轴上方');
    if (!(dif[p] <= dea[p] && dif[i] > dea[i])) return miss('DIF 未上穿 DEA');
    const c = last(candles);
    const vol = c.volume;
    const ref = volMa(candles, 5)[p] || 1;
    const score = 65 + clamp((vol / ref - 1) * 30, 0, 25) + (isYang(c) ? 10 : 0);
    return ok(Math.round(score), 'MACD 水上金叉，DIF 上穿 DEA');
  },
  ma_golden_start(candles) {
    const n = candles.length;
    if (n < 60) return miss('样本不足');
    const close = candles.map((c) => c.close);
    const ma5 = sma(close, 5), ma20 = sma(close, 20), ma60 = sma(close, 60);
    const i = n - 1, p = n - 2;
    const cross = ma5[p] <= ma20[p] && ma5[i] > ma20[i];
    const aboveLong = ma20[i] > ma60[i];
    if (!(cross && aboveLong)) return miss('未出现 5 日上穿 20 日金叉');
    const c = last(candles);
    const vol = c.volume;
    const ref = volMa(candles, 5)[p] || 1;
    const score = 60 + clamp((vol / ref - 1) * 30, 0, 30) + (isYang(c) ? 10 : 0);
    return ok(Math.round(score), '短期均线上穿长期均线（金叉启动）');
  },
  volume_breakout(candles, params = {}) {
    const n = candles.length;
    const win = params.window || 20;
    if (n < win + 5) return miss('样本不足');
    const i = n - 1;
    const c = last(candles);
    const prevHigh = Math.max(...candles.slice(i - win, i).map((k) => k.high));
    if (c.close <= prevHigh) return miss('未突破前高');
    const ref = volMa(candles, 5)[i - 1] || 1;
    const ratio = c.volume / ref;
    if (ratio < (params.volFactor || 1.5)) return miss('突破未放量');
    const score = 70 + clamp((ratio - 1.5) * 20, 0, 20) + (isYang(c) ? 10 : 0);
    return ok(Math.round(score), `放量突破 ${win} 日内前高（量能 ${ratio.toFixed(1)} 倍）`);
  },
  shrink_stabilize(candles) {
    const n = candles.length;
    if (n < 40) return miss('样本不足');
    const close = candles.map((c) => c.close);
    const volRef = volMa(candles, 20)[n - 1];
    const recentVol = candles.slice(n - 8).reduce((s, k) => s + k.volume, 0) / 8;
    if (!volRef || recentVol > volRef * 0.8) return miss('量能未持续萎缩');
    const chg20 = (close[n - 1] - close[n - 20]) / close[n - 20];
    if (chg20 > 0.02) return miss('并非低位企稳');
    const c = last(candles);
    if (!isYang(c) || c.volume < volRef * 1.1) return miss('末根未放量启动');
    const score = 65 + clamp((c.volume / volRef - 1.1) * 30, 0, 25);
    return ok(Math.round(score), '下跌缩量企稳，末端放量阳线启动');
  },
  dry_price_bottom(candles) {
    const n = candles.length;
    if (n < 60) return miss('样本不足');
    const close = candles.map((c) => c.close);
    const volRef = volMa(candles, 60)[n - 1];
    if (!volRef) return miss('量能样本不足');
    const minClose = Math.min(...close.slice(n - 20));
    if (close[n - 1] > minClose * 1.03) return miss('未创新低');
    const curVol = candles[n - 1].volume;
    if (curVol > volRef * 0.6) return miss('未达到地量');
    const c = last(candles);
    const rr = c.high - c.low || 1;
    const score = 60 + (isYang(c) ? 15 : 5) + clamp((c.close - c.low) / rr, 0, 1) * 20;
    return ok(Math.round(score), '地量地价：股价创新低且成交量萎缩至极低');
  },
  consecutive_yang(candles) {
    const n = candles.length;
    const need = 3;
    if (n < need + 2) return miss('样本不足');
    const seg = candles.slice(n - need);
    if (!seg.every((k) => isYang(k))) return miss('非连续阳线');
    for (let i = 1; i < seg.length; i++) {
      if (seg[i].close <= seg[i - 1].close) return miss('未稳步抬升');
    }
    const ref = volMa(candles, 5)[n - need] || 1;
    const cur = seg[need - 1].volume;
    if (cur <= ref) return miss('末端未温和放量');
    const score = 60 + clamp((cur / ref - 1) * 30, 0, 30) + (seg[need - 1].close > seg[0].open ? 10 : 0);
    return ok(Math.round(score), '连续阳线稳步抬升，量能温和放大');
  },
  strong_sideways(candles) {
    const n = candles.length;
    const win = 15;
    if (n < win + 5) return miss('样本不足');
    const seg = candles.slice(n - win);
    const c = last(candles);
    const hi = Math.max(...seg.map((k) => k.high));
    const lo = Math.min(...seg.map((k) => k.low));
    const width = (hi - lo) / (lo || 1);
    if (width > 0.12) return miss('并非窄幅震荡');
    const ref = volMa(candles, win)[n - 1];
    const midVol = seg.slice(0, win - 1).reduce((s, k) => s + k.volume, 0) / (win - 1);
    if (!ref || midVol > ref * 1.1) return miss('未缩量横盘');
    if (c.close <= hi) return miss('未放量突破横盘区间');
    if (c.volume < ref * 1.2) return miss('突破未放量');
    return ok(75, '强势横盘缩量蓄势，放量突破上沿');
  },
  limit_pullback(candles, params = {}) {
    const n = candles.length;
    if (n < 30) return miss('样本不足');
    const limit = limitPct(params.code || '');
    const close = candles.map((c) => c.close);
    let hadLimit = false;
    for (let i = 2; i <= 15 && i < n; i++) {
      const chg = (close[n - i] - close[n - i - 1]) / close[n - i - 1];
      if (chg >= limit * 0.98) { hadLimit = true; break; }
    }
    if (!hadLimit) return miss('近期无涨停');
    const lastChg = (close[n - 1] - close[n - 2]) / close[n - 2];
    if (lastChg > 0.02) return miss('当前已上攻而非回踩');
    const c = last(candles);
    const low = Math.min(...candles.slice(n - 15).map((k) => k.low));
    if (c.low < low * 0.98) return miss('已跌破支撑');
    const ref = volMa(candles, 5)[n - 2] || 1;
    const score = 65 + clamp((ref - c.volume) / ref * 60, 0, 30) + (isYang(c) ? 5 : 0);
    return ok(Math.round(score), '涨停后缩量回踩重要支撑，不破企稳');
  },
  fake_break_pack(candles) {
    const n = candles.length;
    if (n < 30) return miss('样本不足');
    const p = n - 2;
    const prev = candles[p];
    const cur = last(candles);
    const low = Math.min(...candles.slice(n - 20).map((k) => k.low));
    if (!(prev.low < low && prev.close < prev.open)) return miss('前根未假跌破');
    if (!isYang(cur)) return miss('末根未反包');
    if (cur.close < prev.open || cur.open > prev.high) return miss('反包不明显');
    const ref = volMa(candles, 5)[p] || 1;
    if (cur.volume < ref * 1.2) return miss('反包无量');
    return ok(72, '假跌破后放量大阳反包，洗盘后转强');
  },
  yang_engulf(candles) {
    const n = candles.length;
    if (n < 10) return miss('样本不足');
    const prev = candles[n - 2];
    const cur = last(candles);
    if (!isYin(prev) || !isYang(cur)) return miss('非阴后阳');
    if (!(cur.open <= prev.close && cur.close >= prev.open)) return miss('实体未完全覆盖');
    const ref = volMa(candles, 5)[n - 2] || 1;
    const score = 60 + clamp((cur.volume / ref - 1) * 20, 0, 25) + (cur.close > prev.high ? 15 : 0);
    return ok(Math.round(score), '阳包阴：大阳实体覆盖前阴，多头反攻');
  },
  long_lower_shadow(candles) {
    const n = candles.length;
    if (n < 10) return miss('样本不足');
    const c = last(candles);
    const r = range(c);
    if (r <= 0) return miss('无振幅');
    const ls = lowerShadow(c);
    if (ls / r < 0.5) return miss('下影不显著');
    const bodyRatio = body(c) / r;
    if (bodyRatio > 0.6) return miss('实体过大，非承接型');
    const mid = (c.high + c.low) / 2;
    const score = 60 + clamp((ls / r) * 40, 0, 30) + (c.close >= mid ? 10 : 0);
    return ok(Math.round(score), '长下影线企稳，下方抛压被承接');
  },
  rsi_low_turn(candles, params = {}) {
    const n = candles.length;
    if (n < 30) return miss('样本不足');
    const r = rsi(candles, params.period || 14);
    const i = n - 1, p = n - 2;
    if (r[i] == null || r[p] == null) return miss('RSI 未形成');
    if (!(r[p] < 30 && r[i] > r[p])) return miss('非 30 以下拐头向上');
    const score = 60 + clamp((r[i] - 30) * 1.2, 0, 30) + (r[i] > 50 ? 10 : 0);
    return ok(Math.round(score), 'RSI 低位（<30）拐头向上，超跌修复');
  },
  double_bottom(candles) {
    const n = candles.length;
    if (n < 40) return miss('样本不足');
    const close = candles.map((c) => c.close);
    const win = 30;
    const lo = Math.min(...close.slice(n - win));
    const loIdx = close.slice(n - win).indexOf(lo) + (n - win);
    if (loIdx >= n - 10) return miss('底距当前过近');
    const after = close.slice(loIdx + 1, loIdx + 1 + 10);
    if (after.length < 3) return miss('底部后样本不足');
    const neck = Math.max(...after);
    const sec = close.slice(loIdx + 1, n - 3);
    const secLow = Math.min(...sec);
    if (secLow > lo * 1.03) return miss('第二底未踩平/抬高');
    if (close[n - 1] <= neck * 0.99) return miss('未放量突破颈线');
    const ref = volMa(candles, 5)[n - 2] || 1;
    if (candles[n - 1].volume < ref * 1.2) return miss('突破未放量');
    return ok(72, '双底（W底）成型，放量突破颈线');
  },
  second_test(candles) {
    const n = candles.length;
    if (n < 40) return miss('样本不足');
    const close = candles.map((c) => c.close);
    const win = 25;
    const lo = Math.min(...close.slice(n - win));
    const loIdx = close.slice(n - win).indexOf(lo) + (n - win);
    if (loIdx >= n - 8) return miss('支撑距当前过近');
    if (loIdx + 7 > n - 2) return miss('第二底样本不足');
    const secondLow = Math.min(...close.slice(loIdx + 7, n - 2));
    if (secondLow > lo * 1.05) return miss('第二底未回踩支撑');
    const c = last(candles);
    if (!isYang(c)) return miss('第二次企稳后未反弹');
    const ref = volMa(candles, 5)[n - 2] || 1;
    const score = 60 + clamp((c.volume / ref - 1) * 20, 0, 25) + 5;
    return ok(Math.round(score), '两次回踩同一支撑，第二次企稳反弹');
  },
  platform_breakout(candles, params = {}) {
    const n = candles.length;
    const win = params.window || 20;
    if (n < win + 3) return miss('样本不足');
    const seg = candles.slice(n - win - 1, n - 1);
    const hi = Math.max(...seg.map((k) => k.high));
    const lo = Math.min(...seg.map((k) => k.low));
    const width = (hi - lo) / (lo || 1);
    if (width > 0.15) return miss('非横盘平台');
    const c = last(candles);
    if (c.close <= hi) return miss('未突破平台上沿');
    const ref = volMa(candles, 5)[n - 2] || 1;
    if (c.volume < ref * 1.5) return miss('突破未放量');
    const score = 70 + clamp((c.volume / ref - 1.5) * 20, 0, 20);
    return ok(Math.round(score), '长期横盘后放量突破平台上沿');
  },
  box_breakout(candles, params = {}) {
    const n = candles.length;
    const win = params.window || 25;
    if (n < win + 3) return miss('样本不足');
    const seg = candles.slice(n - win - 1, n - 1);
    const hi = Math.max(...seg.map((k) => k.high));
    const touches = seg.filter((k) => k.high >= hi * 0.99).length;
    if (touches < 2) return miss('箱体多次受压不明确');
    const c = last(candles);
    if (c.close <= hi) return miss('未突破箱体上沿');
    const ref = volMa(candles, 5)[n - 2] || 1;
    if (c.volume < ref * 1.5) return miss('突破未放量');
    return ok(70 + clamp((c.volume / ref - 1.5) * 15, 0, 15), '箱体上沿放量突破');
  },
  ascending_triangle(candles, params = {}) {
    const n = candles.length;
    const win = params.window || 20;
    if (n < win + 3) return miss('样本不足');
    const seg = candles.slice(n - win, n - 1);
    const hi = Math.max(...seg.map((k) => k.high));
    const lo = Math.min(...seg.map((k) => k.low));
    const half = Math.floor(seg.length / 2);
    if (half < 2) return miss('三角形样本不足');
    const lo2 = Math.min(...seg.slice(half).map((k) => k.low));
    const lo1 = Math.min(...seg.slice(0, half).map((k) => k.low));
    if (!(lo2 > lo1)) return miss('支撑未上移');
    if ((hi - lo) / (lo || 1) > 0.2) return miss('振幅过大，三角形不明显');
    const c = last(candles);
    if (c.close <= hi) return miss('未突破压力线');
    const ref = volMa(candles, 5)[n - 2] || 1;
    if (c.volume < ref * 1.4) return miss('突破未放量');
    return ok(70, '上升三角形收敛，放量突破水平压力线');
  },
  gap_breakout(candles) {
    const n = candles.length;
    if (n < 10) return miss('样本不足');
    const prev = candles[n - 2];
    const c = last(candles);
    if (c.open <= prev.high) return miss('未形成向上跳空');
    if (c.close <= prev.high) return miss('缺口已回补/未收上');
    const ref = volMa(candles, 5)[n - 2] || 1;
    if (c.volume < ref * 1.3) return miss('跳空未放量');
    return ok(72, '向上跳空缺口突破重要压力，未回补');
  },
  n_shape(candles) {
    const n = candles.length;
    if (n < 30) return miss('样本不足');
    const close = candles.map((c) => c.close);
    const win = 25;
    const slice = candles.slice(n - win, n - 1);
    const hi = Math.max(...slice.map((k) => k.high));
    const hiIdx = slice.findIndex((k) => k.high === hi) + (n - win);
    if (hiIdx < n - 15) return miss('前高过远，N 结构不明显');
    const ref = volMa(candles, 5)[n - 2] || 1;
    const pull = candles.slice(hiIdx + 1, n - 1);
    const pullVol = pull.reduce((s, k) => s + k.volume, 0) / (pull.length || 1);
    if (pullVol > ref * 1.2) return miss('回调未缩量');
    const c = last(candles);
    if (c.close <= hi) return miss('未再次突破前高');
    if (c.volume < ref * 1.5) return miss('二次突破未放量');
    return ok(75, 'N 字突破：回踩缩量后二次放量突破前高');
  },
  trendline_breakout(candles, params = {}) {
    const n = candles.length;
    const win = params.window || 20;
    if (n < win + 5) return miss('样本不足');
    const seg = candles.slice(n - win - 5, n - 1);
    if (seg.length < 8) return miss('趋势线样本不足');
    const xs = seg.map((_, i) => i);
    const ys = seg.map((k) => k.low);
    const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
    const my = ys.reduce((s, v) => s + v, 0) / ys.length;
    let sxy = 0;
    let sxx = 0;
    for (let i = 0; i < xs.length; i++) {
      sxy += (xs[i] - mx) * (ys[i] - my);
      sxx += (xs[i] - mx) * (xs[i] - mx);
    }
    const slope = sxx ? sxy / sxx : 0;
    const intercept = my - slope * mx;
    if (slope > -1e-6) return miss('并非下降趋势线');
    const todayIdx = seg.length;
    const trendVal = slope * todayIdx + intercept;
    const c = last(candles);
    if (c.close <= trendVal) return miss('未突破下降趋势线');
    const ref = volMa(candles, 5)[n - 2] || 1;
    if (c.volume < ref * 1.4) return miss('未放量');
    return ok(70, '放量突破下降趋势线，空头结构被破坏');
  },
  arc_bottom(candles, params = {}) {
    const n = candles.length;
    const win = params.window || 25;
    if (n < win + 5) return miss('样本不足');
    const seg = candles.slice(n - win, n - 1);
    if (seg.length < 15) return miss('圆弧样本不足');
    const lows = seg.map((k) => k.low);
    const hi = Math.max(...seg.map((k) => k.high));
    const mid = Math.floor(lows.length / 2);
    const loIdx = lows.indexOf(Math.min(...lows));
    if (loIdx < mid * 0.3 || loIdx > mid * 1.7) return miss('并非圆弧状下凹');
    const c = last(candles);
    if (c.close <= hi) return miss('未突破弧线右肩高点');
    const ref = volMa(candles, 5)[n - 2] || 1;
    if (c.volume < ref * 1.3) return miss('未放量');
    return ok(70, '圆弧底蓄势，放量突破前期高点');
  },
  head_shoulder_bottom(candles, params = {}) {
    const n = candles.length;
    const win = params.window || 35;
    if (n < win + 5) return miss('样本不足');
    const seg = candles.slice(n - win, n - 1);
    if (seg.length < 20) return miss('头肩样本不足');
    const lows = seg.map((k) => k.low);
    const headLow = Math.min(...lows);
    const headIdx = lows.indexOf(headLow);
    if (headIdx < 4 || headIdx > lows.length - 5) return miss('头部位置不居中');
    const leftLows = lows.slice(0, headIdx);
    const rightLows = lows.slice(headIdx + 1);
    const leftShoulder = Math.min(...leftLows);
    const rightShoulder = Math.min(...rightLows);
    if (!(leftShoulder > headLow && rightShoulder > headLow)) return miss('左右肩未高于头部');
    const neck = Math.min(leftShoulder, rightShoulder);
    const c = last(candles);
    if (c.close <= neck) return miss('未突破颈线');
    const ref = volMa(candles, 5)[n - 2] || 1;
    if (c.volume < ref * 1.3) return miss('未放量');
    return ok(70, '头肩底成型，放量突破颈线');
  },
};

function matchKlinePattern(id, candles, params) {
  const fn = PATTERNS[id];
  if (!fn) return miss('未知形态');
  try {
    return fn(candles, params || {});
  } catch (e) {
    return miss('计算异常');
  }
}

// ───────────────────────── 规则源：可序列化，热插拔 ─────────────────────────
// 规则来自 data/rules.json（与 settings.json/watchlist.json 同级），只存配置不含函数，可在设置页增删改、启停。
// kind='scan'：仅用 clist 快照字段，可全市场（快）；由 params 生成 match。
// kind='kline'：需历史K线，仅对候选池复筛；由 prefilter 阈值做快照粗筛。
function listRules() {
  return rulesStore.load();
}

function listEnabledRules() {
  return rulesStore.load().filter((r) => r.enabled !== false);
}

// 由 scan 规则 params 生成匹配函数：全部阈值取交集（AND）。缺省参数不参与，保证可热插拔、可安全编辑。
function matchScanRule(rule, p) {
  const a = rule.params || {};
  if (Number.isFinite(a.minVolumeRatio) && !(p.volumeRatio >= a.minVolumeRatio)) return false;
  if (Number.isFinite(a.minTurnover) && !(p.turnover >= a.minTurnover)) return false;
  if (Number.isFinite(a.maxTurnover) && !(p.turnover <= a.maxTurnover)) return false;
  if (Number.isFinite(a.minMainNetYi) && !(p.mainNetYi >= a.minMainNetYi)) return false;
  if (Number.isFinite(a.minAmountYi) && !(p.amountYi >= a.minAmountYi)) return false;
  return true;
}

// 由 kline 规则 prefilter 阈值生成快照粗筛函数（AND）。
function matchPrefilter(rule, p) {
  const a = rule.prefilter || {};
  if (Number.isFinite(a.minChangePct) && !(p.changePct >= a.minChangePct)) return false;
  if (Number.isFinite(a.maxChangePct) && !(p.changePct <= a.maxChangePct)) return false;
  if (Number.isFinite(a.minVolumeRatio) && !(p.volumeRatio >= a.minVolumeRatio)) return false;
  if (Number.isFinite(a.maxVolumeRatio) && !(p.volumeRatio <= a.maxVolumeRatio)) return false;
  if (Number.isFinite(a.minTurnover) && !(p.turnover >= a.minTurnover)) return false;
  if (Number.isFinite(a.maxTurnover) && !(p.turnover <= a.maxTurnover)) return false;
  return true;
}

// 快照预筛后只读取少量命中股票的本地 K 线。证据完整时立即确认原策略；
// 缺数据或口径不可核对时保留待补齐，不能把“无法判断”误作形态失败。
function assessLocalKlinePrefilter(entry, cached, snapshotDate) {
  const hitRules = Array.isArray(entry && entry.hitRules) ? entry.hitRules : [];
  const klineRules = hitRules.filter((rule) => rule.kind === 'kline');
  const scanRules = hitRules.filter((rule) => rule.kind !== 'kline');
  if (!klineRules.length) {
    return { status: 'confirmed', entry: { ...entry, hitRules: scanRules }, confirmedRuleIds: scanRules.map((rule) => rule.id) };
  }

  const candles = cached && Array.isArray(cached.kline) ? cached.kline : [];
  const tailDate = candles.length ? String(candles.at(-1).date || '') : '';
  let pendingReason = '';
  if (!cached || !candles.length) pendingReason = '本地K线缺失';
  else if (String(cached.source || '') !== 'tencent' || !isAdjustmentCorroborated(cached.source, cached.adjustmentType) || cached.adjustmentType !== 'qfq') pendingReason = 'K线来源或前复权口径未验证';
  else if (candles.length < LOCAL_KLINE_CONFIRM_MIN_BARS) pendingReason = `K线不足${LOCAL_KLINE_CONFIRM_MIN_BARS}根`;
  else if (tailDate !== snapshotDate || String(cached.sourceLatestDate || '') !== snapshotDate) pendingReason = 'K线尾日与扫描交易日不一致';
  else if (cached.tailStatus !== 'confirmed') pendingReason = 'K线尾日尚未确认';

  if (pendingReason) {
    return {
      status: 'pending_kline',
      reason: pendingReason,
      entry: {
        ...entry,
        localKlineConfirmation: { status: 'pending_kline', reason: pendingReason, source: String(cached && cached.source || ''), adjustmentType: String(cached && cached.adjustmentType || ''), depth: candles.length, tailDate },
      },
    };
  }

  const matched = [];
  for (const rule of klineRules) {
    const result = matchKlinePattern(rule.patternId, candles, { ...rule.params, code: entry.profile && entry.profile.code });
    if (result.matched) matched.push({ rule, result });
  }
  const confirmedRules = [...scanRules, ...matched.map((item) => item.rule)];
  if (!confirmedRules.length) {
    return { status: 'rejected', reason: '入池预筛命中的原策略未通过本地K线形态确认' };
  }
  const best = matched.sort((left, right) => Number(right.result.score || 0) - Number(left.result.score || 0))[0] || null;
  return {
    status: 'confirmed',
    confirmedRuleIds: confirmedRules.map((rule) => rule.id),
    entry: {
      ...entry,
      hitRules: confirmedRules,
      pattern: best ? best.result.reason : '',
      patternScore: best ? Number(best.result.score || 0) : 0,
      patternId: best ? best.rule.patternId : '',
      localKlineConfirmation: { status: 'confirmed', source: cached.source, adjustmentType: cached.adjustmentType, depth: candles.length, tailDate, ruleIds: confirmedRules.map((rule) => rule.id) },
    },
  };
}

async function confirmPrefilterEntriesWithLocalKline(entries, snapshotDate) {
  const retained = [];
  const exclusions = [];
  let confirmed = 0;
  let pending = 0;
  for (const entry of entries || []) {
    const cached = await readKline(entry.profile.code);
    const assessment = assessLocalKlinePrefilter(entry, cached, snapshotDate);
    if (assessment.status === 'rejected') {
      exclusions.push({ code: entry.profile.code, reason: EXCLUSION_REASONS.KLINE_PATTERN_NOT_CONFIRMED, detail: assessment.reason });
      continue;
    }
    retained.push(assessment.entry);
    if (assessment.status === 'confirmed') confirmed += 1;
    else pending += 1;
  }
  return { retained, exclusions, confirmed, pending };
}

// ───────────────────────── 第一段：快照初筛 → 候选池 ─────────────────────────
// dataSource：'live' 实时拉取并落盘；'local' 仅用当日本地快照；'last' 用最近一次本地快照。
// ruleId：空 → 全部启用规则（并集，快照预筛命中才进入候选）；指定 → 仅用该规则。
// refine=true 会直接对候选联网跑 K 线复筛（老链路保留兼容）；全市扫描固定 refine=false，
// 命中结果先进候选池，补齐 K 线后再复筛，避免扫描阶段逐只联网触发限流。
// autoPoolMinScore：自动入池的量能分门槛（默认 55，见 AUTO_POOL_MIN_SCORE）。
async function scanByMarkets({ markets = [], ruleId = '', limit = 100, accountSt = false, refine = true, dataSource = 'live', autoPoolMinScore = AUTO_POOL_MIN_SCORE } = {}) {
  const enabled = listEnabledRules();
  const single = ruleId ? (enabled.find((r) => r.id === ruleId) || null) : null;
  const rules = single ? [single] : enabled;
  const snapshot = await fetchMarketSnapshot({ markets, limit: Number.POSITIVE_INFINITY, dataSource });
  const entries = [];

  for (const row of snapshot.records) {
    if (!accountSt && isStOrSuspended(row)) continue;
    const profile = volumeProfile(row);
    const hitRules = [];
    for (const rule of rules) {
      if (rule.kind === 'kline') {
        if (matchPrefilter(rule, profile)) hitRules.push(rule);
      } else if (matchScanRule(rule, profile)) {
        hitRules.push(rule);
      }
    }
    if (hitRules.length) entries.push({ profile, hitRules });
  }

  entries.sort((a, b) => b.profile.score - a.profile.score);
  // 业务口径：未命中启用规则、或量能分低于自动入池门槛的股票不作为扫描命中。
  // 用户在观察主题下的人工保留属于候选池「人工保留」路径，不走全市扫描命中。
  const autoEntries = entries.filter((e) => meetsAutoPoolGate(e.profile, autoPoolMinScore));
  const top = autoEntries.slice(0, Math.max(1, Number(limit) || 1));
  const marketLabel = (markets.length ? markets : Object.keys(MARKETS)).map((k) => (MARKETS[k] ? MARKETS[k].label : k));
  const hasKline = rules.some((r) => r.kind === 'kline');
  const ruleIds = rules.map((r) => r.id);
  const base = {
    marketLabel,
    rule: single,
    ruleIds,
    totalScanned: snapshot.fetched,
    ms: snapshot.ms,
    dataSource: snapshot.dataSource,
    snapshotDate: snapshot.snapshotDate,
    byMarket: snapshot.byMarket || [],
    autoPool: {
      minScore: autoPoolMinScore,
      hitTotal: entries.length,
      eligible: autoEntries.length,
    },
  };

  if (hasKline && refine) {
    const matched = await refineWithKline(top, rules, snapshot.dataSource, snapshot.snapshotDate);
    return { ...base, candidates: matched, refineStage: 'kline' };
  }
  // 快照粗筛结果（未做 K 线复筛）：扫描阶段只承诺「量能分 + 规则命中（预筛）」，
  // 不给形态判定结论；K 线复筛与形态命中在候选池补齐数据后进行。
  const coarse = top.map((e) => {
    return {
      ...e.profile,
      snapshotDate: snapshot.snapshotDate,
      ruleLabel: e.hitRules.map((r) => r.label).join(' / '),
      ruleIds: e.hitRules.map((r) => r.id),
      pattern: '',
      patternScore: 0,
      autoPool: true,
    };
  });
  return { ...base, candidates: coarse, refineStage: hasKline ? 'prefilter' : 'scan' };
}

// 新全市扫描漏斗：先判定市场环境，再按资金/涨幅排序选行业板块、收集成分股，最后以
// 环境适配形态做快照预筛。板块接口异常时明确回退到完整全市场，而非静默缺扫。
async function buildMarketPrescan({ markets = [], dataSource = 'live', force = false } = {}) {
  const stored = readPrescan();
  const marketKey = [...markets].sort().join(',');
  if (!force && canReuseClosedPrescan(stored) && stored.marketKey === marketKey) return { ...stored, reused: true };
  let indices = [];
  let indexDate = '';
  const sourceRaw = {};
  const sourceEvidence = {};
  const summarizeRaw = (raw) => raw ? Object.fromEntries(Object.entries(raw).filter(([key]) => !['rawText', 'rawBase64'].includes(key))) : null;
  try {
    const indexResult = await fetchMajorIndicesTencent(); indices = indexResult.indices; indexDate = indexResult.asOf || '';
    sourceRaw.indices = indexResult.rawResponse;
    sourceEvidence.indices = summarizeRaw(indexResult.rawResponse);
  } catch { /* 指数缺失使置信度降级，不中断扫描 */ }
  if (!indexDate) {
    const localDates = await recentTradingDates(1);
    indexDate = localDates[0] || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  }
  const snapshot = await fetchMarketSnapshot({ markets, limit: Number.POSITIVE_INFINITY, dataSource, tradeDate: indexDate });
  const breadth = summarizeSnapshot(snapshot.records);
  const sentimentResult = await fetchMarketSentiment(indexDate, { dataSource, validationRecords: snapshot.records });
  const { sourceEvidence: sentimentEvidence, ...limitStructure } = sentimentResult || {};
  sourceEvidence.sentimentPools = sentimentEvidence || {
    tradeDate: indexDate, source: 'eastmoney', available: false, rawBytes: 0, sha256: '',
    quality: { complete: false, requestedDate: indexDate, conflicts: ['情绪池原始证据摘要缺失'] },
  };
  const marketRegime = classifyMarketRegime({ breadth, indices, asOf: indexDate, limitStructure });
  const enabled = listEnabledRules();
  const strategy = strategyForRegime(marketRegime.status, enabled);
  const strategyRules = enabled.filter((r) => strategy.enabledRuleIds.includes(r.id));

  let focusThemes = [];
  let focusConcepts = [];
  let scopeCodes = null;
  const themeCodes = new Map();
  let scanScope = { mode: 'theme_data_unavailable', stockCount: 0, reason: '行业与概念板块数据尚未获取，不能执行题材内股票扫描' };
  const selectedCount = marketRegime.status === 'weak' ? 3 : 6;
  const codes = new Set();
  const collectBoards = async (kind, getBoards, limitUpsByIndustry) => {
    try {
      const result = await getBoards({ tradeDate: indexDate });
      sourceRaw[`${kind}Boards`] = result.rawResponse;
      sourceEvidence[`${kind}Boards`] = summarizeRaw(result.rawResponse);
      const ranked = result.boards.map((board) => ({ ...board, limitUpCount: kind === 'industry' ? (limitUpsByIndustry.get(board.name) || 0) : 0 }))
        .filter((board) => Number.isFinite(board.mainNet) && Number.isFinite(board.changePct) && require('./market-prescan-store').isQuoteFresh(board.sourceAt, indexDate))
        .sort((a, b) => (b.limitUpCount - a.limitUpCount) || (b.mainNet - a.mainNet) || (b.changePct - a.changePct))
        .slice(0, selectedCount);
      const constituents = await Promise.all(ranked.map((board) => fetchBoardConstituents(board.code)));
      sourceRaw[`${kind}Constituents`] = Object.fromEntries(constituents.map((rows) => [rows.boardCode, rows.rawPages || []]));
      sourceEvidence[`${kind}Constituents`] = Object.fromEntries(constituents.map((rows) => [rows.boardCode, {
        records: rows.records.length, expectedCount: rows.expectedCount, pages: (rows.rawPages || []).map(summarizeRaw),
      }]));
      return ranked.map((board, i) => {
        const rows = constituents[i];
        const boardCodes = new Set(rows.records.map((item) => item.code));
        themeCodes.set(board.code, boardCodes);
        for (const code of boardCodes) codes.add(code);
        const totalMoves = Math.max(0, Number(board.advanceCount) || 0) + Math.max(0, Number(board.declineCount) || 0);
        return { ...board, kind, rank: i + 1, asOf: shanghaiDate(board.sourceAt), advanceRatio: totalMoves ? Number(board.advanceCount) / totalMoves : null, constituentCount: rows.records.length, coverage: rows.records.length >= rows.expectedCount ? 'complete' : 'partial' };
      });
    } catch {
      return [];
    }
  };
  const limitUpsByIndustry = new Map((limitStructure.industryLimitUps || []).map((x) => [x.name, Number(x.count) || 0]));
  focusThemes = await collectBoards('industry', fetchIndustryBoards, limitUpsByIndustry);
  focusConcepts = await collectBoards('concept', fetchConceptBoards, limitUpsByIndustry);
  if (codes.size >= 20) {
    scopeCodes = codes;
    scanScope = { mode: 'theme_and_concept_constituents', stockCount: codes.size, industryCount: focusThemes.length, conceptCount: focusConcepts.length, source: 'eastmoney' };
  } else {
    scanScope.reason = '行业与概念板块成分股范围不足，不能执行题材内股票扫描';
  }

  const fetchedAt = new Date().toISOString();
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const isFinal = indexDate < localDate || (indexDate === localDate && isClosedMarketTime());
  const themeMembership = Object.fromEntries([...themeCodes.entries()].map(([code, codes]) => [code, [...codes]]));
  const persisted = { batchId: createBatchId('prescan'), contractVersion: SELECTION_CONTRACT_VERSION, marketRegime, focusThemes, focusConcepts, scanScope, strategy, snapshotDate: indexDate, asOf: indexDate, fetchedAt, session: isFinal ? 'closed' : 'intraday', isFinal, dataSource: snapshot.dataSource, marketKey, scopeCodes: scopeCodes ? [...scopeCodes] : null, themeMembership, sourceEvidence };
  writePrescan(persisted);
  const archive = archivePrescan(persisted, snapshot, sourceRaw);
  runtimePrescan = { ...persisted, snapshot, scopeCodes, themeCodes, limitStructure };
  return { ...persisted, archive, reused: false };
}

async function getMarketPrescan(options = {}) {
  const result = await buildMarketPrescan(options);
  const { scopeCodes, themeMembership, marketKey, ...publicResult } = result;
  return { ...publicResult, validity: assessPrescanValidity(result, { marketKey }) };
}

async function scanByMarketContext({ markets = [], limit = 100, accountSt = false, dataSource = 'live', autoPoolMinScore = AUTO_POOL_MIN_SCORE, forcePrescan = false } = {}) {
  const requestedMarketKey = [...markets].sort().join(',');
  if (forcePrescan) {
    await buildMarketPrescan({ markets, dataSource, force: true });
  } else if (!runtimePrescan || !runtimePrescan.snapshot || runtimePrescan.marketKey !== requestedMarketKey) {
    const stored = readPrescan();
    if (canReuseClosedPrescan(stored) && stored.marketKey === requestedMarketKey) {
      const snapshot = await fetchMarketSnapshot({ markets, limit: Number.POSITIVE_INFINITY, dataSource: 'local', tradeDate: stored.asOf });
      runtimePrescan = {
        ...stored,
        snapshot,
        scopeCodes: Array.isArray(stored.scopeCodes) ? new Set(stored.scopeCodes) : null,
        themeCodes: new Map(Object.entries(stored.themeMembership || {}).map(([code, codes]) => [code, new Set(codes)])),
        limitStructure: stored.marketRegime && stored.marketRegime.evidence && stored.marketRegime.evidence.limitStructure,
      };
    } else {
      throw new Error('市场预扫描结果不可用，请先扫描市场以确定强势题材。');
    }
  }
  const context = runtimePrescan;
  const validity = assessPrescanValidity(context, { marketKey: requestedMarketKey });
  if (!validity.scanEligible) throw new Error(validity.reason === 'trading_date_changed' ? '市场扫描结果已跨交易日，请重新扫描市场。' : '市场扫描结果已失效，请重新扫描市场。');
  const { marketRegime, focusThemes, focusConcepts = [], scanScope, strategy, snapshot, scopeCodes, themeCodes, limitStructure, snapshotDate: indexDate } = context;
  if (!scopeCodes || !scopeCodes.size) throw new Error(scanScope.reason || '未取得题材成分股范围，无法执行题材内龙头扫描。');
  const enabled = listEnabledRules();
  const strategyRules = enabled.filter((r) => strategy.enabledRuleIds.includes(r.id));

  const scopedRows = snapshot.records.filter((row) => scopeCodes.has(row.code));
  const oldByCode = new Map(scopedRows.map((row) => [row.code, row]));
  const effectiveScopeCodes = [...scopeCodes].filter((code) => oldByCode.has(code));
  const quoteStartedAt = Date.now();
  const quoteBatch = await fetchQuotesDetailed(effectiveScopeCodes);
  const quoteByCode = new Map(quoteBatch.quotes.map((quote) => [quote.code, quote]));
  const allRankable = [];
  const exclusions = [];
  for (const code of effectiveScopeCodes) {
    const old = oldByCode.get(code) || { code, market: '' };
    const quote = quoteByCode.get(code);
    if (!quote) { exclusions.push({ code, reason: EXCLUSION_REASONS.QUOTE_MISSING }); continue; }
    const quoteDate = shanghaiDate(quote.sourceAt);
    if (!quoteDate || !require('./market-prescan-store').isQuoteFresh(quote.sourceAt, indexDate)) { exclusions.push({ code, reason: EXCLUSION_REASONS.QUOTE_STALE }); continue; }
    const row = { ...old, ...quote, amount: quote.amount };
    if (!accountSt && isStOrSuspended(row)) { exclusions.push({ code, reason: EXCLUSION_REASONS.ST_OR_SUSPENDED }); continue; }
    if (quote.closed || !Number.isFinite(quote.price) || !Number.isFinite(quote.changePct)
      || !Number.isFinite(quote.turnover) || !Number.isFinite(quote.volumeRatio) || !Number.isFinite(quote.amount)
      || !Number.isFinite(quote.mainNet) || !Number.isFinite(quote.floatMcap)) {
      exclusions.push({ code, reason: EXCLUSION_REASONS.QUOTE_INCOMPLETE });
      continue;
    }
    const profile = { ...volumeProfile(row), isLimitUp: Number(row.changePct) >= limitPct(row.code) * 100 * 0.98 };
    allRankable.push({ profile });
  }
  rankThemeLeaders(allRankable, [...focusThemes, ...focusConcepts], themeCodes, 'boardLeaderRanks');
  const boardRanksByCode = new Map(allRankable.map((entry) => [entry.profile.code, entry.boardLeaderRanks]));
  const entries = [];
  for (const ranked of allRankable) {
    const profile = ranked.profile;
    const hitRules = strategyRules.filter((rule) => rule.kind === 'kline' ? matchPrefilter(rule, profile) : matchScanRule(rule, profile));
    if (!hitRules.length) { exclusions.push({ code: profile.code, reason: EXCLUSION_REASONS.RULE_NOT_MATCHED }); continue; }
    if (!meetsAutoPoolGate(profile, autoPoolMinScore)) { exclusions.push({ code: profile.code, reason: EXCLUSION_REASONS.SCORE_TOO_LOW }); continue; }
    entries.push({ profile, hitRules, boardLeaderRanks: boardRanksByCode.get(profile.code) || [] });
  }
  const prefilterMatched = entries.length;
  const localConfirmation = await confirmPrefilterEntriesWithLocalKline(entries, indexDate);
  exclusions.push(...localConfirmation.exclusions);
  const refinedEntries = localConfirmation.retained;
  rankThemeLeaders(refinedEntries, [...focusThemes, ...focusConcepts], themeCodes, 'candidateThemeRanks');
  const initialSelection = buildInitialSelection(refinedEntries, { limit });
  const selectionBatchId = createBatchId('selection');
  const staleQuoteCount = quoteBatch.quotes.filter((quote) => {
    return !require('./market-prescan-store').isQuoteFresh(quote.sourceAt, indexDate);
  }).length;
  const quoteEvidence = {
    status: quoteBatch.missingCodes.length || quoteBatch.errors.length || staleQuoteCount ? EVIDENCE_STATUS.PARTIAL : EVIDENCE_STATUS.COMPLETE,
    source: quoteBatch.source,
    sourceAt: quoteBatch.quotes.map((quote) => quote.sourceAt).filter(Boolean).sort().at(-1) || '',
    fetchedAt: quoteBatch.fetchedAt,
    requested: quoteBatch.requested,
    received: quoteBatch.received,
    missingCodes: quoteBatch.missingCodes,
    reasons: [...quoteBatch.errors.map((item) => item.error), ...(staleQuoteCount ? [`${staleQuoteCount}只行情源时间缺失或非本交易日`] : [])],
  };
  const toPublicCandidate = ({ profile, hitRules, matchingThemes, boardLeaderRanks, candidateThemeRanks, isThemeLeader, initialAssessment, pattern, patternScore, patternId, localKlineConfirmation }, admissionMode, autoPool, extra = {}) => {
    const themeEvidence = matchingThemes.map((theme) => ({ name: theme.name, code: theme.code, kind: theme.kind, rank: theme.rank, asOf: theme.asOf, changePct: theme.changePct, mainNet: theme.mainNet, limitUpCount: theme.limitUpCount, advanceRatio: theme.advanceRatio }));
    const flags = riskFlagsForCandidate(profile, { marketStatus: marketRegime.status, limitStructure });
    return {
      ...profile,
      isLimitUp: initialAssessment ? initialAssessment.isLimitUp : profile.isLimitUp,
      selectionBatchId,
      prescanBatchId: String(context.batchId || ''),
      selectionContractVersion: SELECTION_CONTRACT_VERSION,
      quoteEvidence: { ...quoteEvidence, sourceAt: quoteByCode.get(profile.code)?.sourceAt || '' },
      snapshotDate: indexDate,
      ruleLabel: hitRules.map((r) => r.label).join(' / '),
      ruleIds: hitRules.map((r) => r.id),
      pattern: pattern || '', patternScore: Number(patternScore) || 0, patternId: patternId || '', autoPool,
      admissionMode,
      localKlineConfirmation: localKlineConfirmation || null,
      initialAssessment: initialAssessment || null,
      selectionPolicyVersion: initialSelection.policyVersion,
      selectionParameterStatus: initialSelection.parameterStatus,
      selectionPolicyParams: { ...initialSelection.params },
      selectionRuleEvidence: hitRules.map((rule) => JSON.parse(JSON.stringify(rule))),
      selectionRulesFingerprint: rulesFingerprint(hitRules),
      marketRegime: { status: marketRegime.status, label: marketRegime.label, confidence: marketRegime.confidence },
      themeEvidence,
      boardLeaderRanks,
      candidateThemeRanks,
      themeLeaderRanks: candidateThemeRanks,
      isBoardLeader: boardLeaderRanks.some((item) => item.rank === 1),
      isCandidateThemeLeader: isThemeLeader,
      isThemeLeader,
      scanScope,
      strategyRuleIds: strategy.enabledRuleIds,
      deprioritizedRuleIds: strategy.deprioritizedRuleIds,
      riskFlags: flags,
      selectionTrace: [`市场环境：${marketRegime.label}`, limitStructure.available ? `情绪结构：涨停 ${limitStructure.limitUpCount} / 跌停 ${limitStructure.limitDownCount} / 炸板 ${limitStructure.brokenCount}` : '情绪结构：不可用', `策略：${strategy.label}`, scanScope.mode === 'theme_and_concept_constituents' ? '范围：重点行业与概念成分股' : `范围回退：${scanScope.reason}`, `快照预筛：${hitRules.map((r) => r.label).join('、')}`, localKlineConfirmation && localKlineConfirmation.status === 'confirmed' ? `本地K线确认：${hitRules.map((r) => r.label).join('、')}` : (admissionMode === 'strong_watch' ? `防追高分流：${(initialAssessment && initialAssessment.reasons || []).join('、')}` : '下一步：入候选池补齐 K 线后复筛原策略')],
      ...extra,
    };
  };
  const candidates = initialSelection.selected.map((entry) => toPublicCandidate(entry, entry.localKlineConfirmation && entry.localKlineConfirmation.status === 'confirmed' ? 'kline_confirmed' : 'pending_kline', true));
  const strongWatch = initialSelection.strongWatch.map((entry) => toPublicCandidate(entry, 'strong_watch', false));
  const overQuota = initialSelection.overQuota.map((entry) => toPublicCandidate(entry, 'over_quota', false, { quotaReason: entry.quotaReason }));
  const dataInsufficientCount = exclusions.filter((item) => [EXCLUSION_REASONS.QUOTE_MISSING, EXCLUSION_REASONS.QUOTE_INCOMPLETE, EXCLUSION_REASONS.QUOTE_STALE].includes(item.reason)).length + initialSelection.dataInsufficient.length;
  const funnel = {
    scope: quoteBatch.requested,
    validQuotes: allRankable.length,
    excluded: exclusions.length + initialSelection.dataInsufficient.length,
    prefilterMatched,
    potential: initialSelection.selected.length,
    strongWatch: strongWatch.length,
    overQuota: overQuota.length,
    dataInsufficient: dataInsufficientCount,
  };
  return {
    marketRegime,
    focusThemes,
    focusConcepts,
    scanScope,
    strategy,
    candidates,
    strongWatch,
    overQuota,
    funnel,
    selectionPolicy: { version: initialSelection.policyVersion, parameterStatus: initialSelection.parameterStatus, params: initialSelection.params },
    selectionBatchId,
    selectionContractVersion: SELECTION_CONTRACT_VERSION,
    quoteEvidence,
    exclusions,
    totalScanned: quoteBatch.requested,
    ms: Date.now() - quoteStartedAt,
    dataSource: 'live_quote',
    snapshotDate: indexDate,
    byMarket: snapshot.byMarket || [],
    refineStage: 'local_kline',
    prescan: { fetchedAt: context.fetchedAt, isFinal: context.isFinal },
    prefilter: { matched: prefilterMatched, klineMissing: localConfirmation.pending, confirmed: localConfirmation.confirmed },
    autoPool: { minScore: autoPoolMinScore, hitTotal: prefilterMatched, eligible: candidates.length, observationOnly: false },
  };
}

// ───────────────────────── 第二段：候选池 → K线形态复筛 ─────────────────────────
// 对每个候选，按 命中规则(candidate.hitRules) 逐一跑形态匹配，保留最优（分数最高）形态；
// 纯 scan 规则命中的候选无需形态复筛，直接保留。
// local / last 优先用本地 K 线缓存（深度 ≥ 20 日），避免逐只联网拖慢本地筛选。
async function getKlineForScan(code, dataSource, snapshotDate) {
  if (dataSource === 'local' || dataSource === 'last') {
    const cached = await readKline(code);
    if (cached && Array.isArray(cached.kline) && cached.kline.length >= 20) return cached.kline;
  }
  return fetchKline(code, { dataSource, minDate: snapshotDate });
}

async function refineWithKline(entries, enabledRules, dataSource, snapshotDate) {
  const matched = [];
  for (const entry of entries) {
    const profile = entry.profile;
    const klineRules = (entry.hitRules || []).filter((r) => r.kind === 'kline');
    const scanRules = (entry.hitRules || []).filter((r) => r.kind === 'scan');
    let best = null;
    try {
      if (klineRules.length) {
        const kline = await getKlineForScan(profile.code, dataSource, snapshotDate);
        for (const rule of klineRules) {
          const res = matchKlinePattern(rule.patternId, kline, { ...rule.params, code: profile.code });
          if (res.matched && (!best || res.score > best.patternScore)) {
            best = { pattern: res.reason, patternScore: res.score, ruleLabel: rule.label, patternId: rule.patternId };
          }
        }
      }
    } catch (e) {
      // 拉取失败跳过；若仅 scan 规则命中仍保留。
    }
    if (best) {
      matched.push({ ...profile, snapshotDate, pattern: best.pattern, patternScore: best.patternScore, ruleLabel: best.ruleLabel, patternId: best.patternId, autoPool: true });
    } else if (scanRules.length) {
      matched.push({ ...profile, snapshotDate, pattern: scanRules[0].label, patternScore: 0, ruleLabel: scanRules.map((r) => r.label).join(' / '), autoPool: true });
    }
  }
  matched.sort((a, b) => (b.patternScore || 0) - (a.patternScore || 0));
  return matched;
}

// ───────────────────────── 个股级证据：对单只票跑全部启用形态规则 ─────────────────────────
// 供 AI 研判组装证据使用：返回命中形态明细（含 label/reason/score/detail 与 ruleLabel），
// 单个维度命中由外部决定如何呈现。非候选进入详情也仍可用本地 K 线直接判断。
function detectSinglePatterns(candles, { code = '', accountSt = false, rules: ruleSnapshot = null } = {}) {
  const rules = (ruleSnapshot || listEnabledRules()).filter((r) => r.enabled !== false && r.kind !== 'scan');
  const hits = [];
  if (!Array.isArray(candles) || candles.length < 2) return { hits, rules };
  // detail 字段由各形态 detector 的 ok() 返回；此处收集 label 与证据。
  for (const rule of rules) {
    try {
      const res = matchKlinePattern(rule.patternId, candles, { ...rule.params, code });
      if (res && res.matched) {
        hits.push({
          ruleId: rule.id,
          patternId: rule.patternId,
          label: rule.label,
          ruleLabel: rule.label,
          reason: res.reason || '',
          score: res.score || 0,
          detail: res.detail || '',
        });
      }
    } catch { /* 单票失败不中断，跳过该规则 */ }
  }
  hits.sort((a, b) => (b.score || 0) - (a.score || 0));
  return { hits, rules };
}

module.exports = {
  MARKETS,
  PATTERNS,
  AUTO_POOL_MIN_SCORE,
  meetsAutoPoolGate,
  shanghaiDate,
  listRules,
  listEnabledRules,
  matchScanRule,
  matchPrefilter,
  assessLocalKlinePrefilter,
  scoreVolume,
  volumeProfile,
  rankThemeLeaders,
  scanByMarkets,
  scanByMarketContext,
  getMarketPrescan,
  refineWithKline,
  matchKlinePattern,
  detectSinglePatterns,
  sma, ema, macd, rsi, volMa, limitPct,
};
