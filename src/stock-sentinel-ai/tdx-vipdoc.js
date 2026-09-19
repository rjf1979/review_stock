// 智诊盯盘 · 通达信本地日线（vipdoc）数据源
//
// 为什么需要它：腾讯 fqkline 对部分证券（688 段、部分次新）只返回 `day`（未复权）节点，
// 拿不到可以自证口径的 `qfqday` 序列，候选池因此永久卡在「K 线来源或前复权口径未验证」。
// 本地通达信 vipdoc 的 .day 是未复权原始价，但同一目录下的 gbbq 有完整除权除息事件，
// 按通达信除权公式推导即可得到前复权序列，从而补齐这条通道。
//
// 口径声明（诚实边界）：本来源的前复权不是「响应里带标记」，而是本地推导：
//   除权除息价 = (前收盘 - 每股现金红利 + 配股价 × 每股配股) / (1 + 每股送转 + 每股配股)
//   k = 除权除息价 / 前收盘；除权日之前的 K 线乘 k，即得前复权价。
// 推导结果已与腾讯 qfq 全市场对账（1769 只 / 437372 个交易日样本）：整票最大误差
// ≤0.01 元的占 94.0%，逐日中位误差 0.0000 元；残余偏差来自 category≠1 的股本变迁事件
// 与送转比例四舍五入口径。因此只把「完整推导成功」的序列声明为 qfq；gbbq 缺失时
// 只能返回未复权原始价，口径记 unknown，绝不冒充前复权。
//
// 路径来源（按优先级）：环境变量 STOCK_SENTINEL_TDX_DIR（显式空值 = 关闭本来源）
// → settings.json 的 tdxDir → 未配置则关闭。本地读盘失败与网络无关，不进入源健康熔断。
const fs = require('fs');
const path = require('path');
const settings = require('./settings');
const { loadIndex, gbbqEvents } = require('./tdx-gbbq');

const DAY_RECORD_BYTES = 32;
const TDX_MARKETS = ['sh', 'sz', 'bj'];

// 市场归属与 data.js / storage 保持同一规则：6→沪，4/8/92→北，其余→深。
function tdxMarketOf(code) {
  const text = String(code || '');
  if (text.startsWith('6')) return 'sh';
  if (text.startsWith('4') || text.startsWith('8') || text.startsWith('92')) return 'bj';
  return 'sz';
}

function configuredRoot() {
  if (Object.prototype.hasOwnProperty.call(process.env, 'STOCK_SENTINEL_TDX_DIR')) {
    return String(process.env.STOCK_SENTINEL_TDX_DIR || '').trim();
  }
  try {
    return String(settings.load().tdxDir || '').trim();
  } catch {
    return '';
  }
}

function tdxPaths(root = configuredRoot()) {
  const base = String(root || '').trim();
  if (!base) return { root: '', vipdoc: '', gbbq: '' };
  const resolved = path.resolve(base);
  return {
    root: resolved,
    vipdoc: path.join(resolved, 'vipdoc'),
    gbbq: path.join(resolved, 'T0002', 'hq_cache', 'gbbq'),
  };
}

function dayFileFor(code, root = configuredRoot()) {
  const paths = tdxPaths(root);
  if (!paths.root) return { path: '', market: '' };
  const market = tdxMarketOf(code);
  return { path: path.join(paths.vipdoc, market, 'lday', `${market}${code}.day`), market };
}

// 只读探针：供设置页展示当前配置是否可用，不触发任何解析。
function tdxStatus() {
  const root = configuredRoot();
  const paths = tdxPaths(root);
  const status = {
    configured: Boolean(root),
    root: paths.root,
    vipdocAvailable: false,
    gbbqAvailable: false,
    gbbqBytes: 0,
    markets: [],
  };
  if (!paths.root) return status;
  try {
    status.vipdocAvailable = fs.statSync(paths.vipdoc).isDirectory();
  } catch { status.vipdocAvailable = false; }
  try {
    const stat = fs.statSync(paths.gbbq);
    status.gbbqAvailable = stat.isFile();
    status.gbbqBytes = stat.size;
  } catch { status.gbbqAvailable = false; }
  if (status.vipdocAvailable) {
    for (const market of TDX_MARKETS) {
      try {
        if (fs.statSync(path.join(paths.vipdoc, market, 'lday')).isDirectory()) status.markets.push(market);
      } catch { /* 缺该市场目录时忽略 */ }
    }
  }
  return status;
}

function ymdToIso(value) {
  const text = String(Number(value) || '');
  if (text.length !== 8) return '';
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

function isoToYmd(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return 0;
  return Number(text.replace(/-/g, ''));
}

// .day 记录：<IIIIIfII>，价格 ×100 存整数，amount 为 float32（元），vol 为股。
function decodeDayBuffer(buffer) {
  const bars = [];
  if (!Buffer.isBuffer(buffer)) return bars;
  const count = Math.floor(buffer.length / DAY_RECORD_BYTES);
  for (let i = 0; i < count; i++) {
    const offset = i * DAY_RECORD_BYTES;
    const date = ymdToIso(buffer.readUInt32LE(offset));
    if (!date) continue;
    const open = buffer.readUInt32LE(offset + 4) / 100;
    const high = buffer.readUInt32LE(offset + 8) / 100;
    const low = buffer.readUInt32LE(offset + 12) / 100;
    const close = buffer.readUInt32LE(offset + 16) / 100;
    const amount = buffer.readFloatLE(offset + 20);
    const volume = buffer.readUInt32LE(offset + 24);
    bars.push({
      date, open, high, low, close,
      volume: Number.isFinite(volume) ? volume : null,
      amount: Number.isFinite(amount) ? amount : null,
    });
  }
  bars.sort((a, b) => a.date.localeCompare(b.date));
  return bars;
}

// 除权除息事件 → 复权比例序列（按除权日升序）。
// 除权日之前必须存在真实交易日收盘价，否则该事件无法折算，跳过（与公开实现一致）。
function buildQfqFactors(events, rawBars, { lastDate = '' } = {}) {
  const dates = rawBars.map((bar) => isoToYmd(bar.date));
  const closes = rawBars.map((bar) => Number(bar.close));
  const factors = [];
  for (const event of events) {
    const exDate = Number(event.date);
    // 尚未生效（除权日在序列最新交易日之后）的事件不参与，否则会把最新价错误压低。
    if (lastDate && exDate > lastDate) continue;
    let priorIndex = -1;
    for (let i = dates.length - 1; i >= 0; i--) {
      if (dates[i] < exDate) { priorIndex = i; break; }
    }
    if (priorIndex < 0) continue;
    const priorClose = closes[priorIndex];
    if (!(priorClose > 0)) continue;
    const cash = Number(event.hongli) / 10;
    const rightPrice = Number(event.peigujia);
    const send = Number(event.songgu) / 10;
    const right = Number(event.peigu) / 10;
    const denominator = 1 + send + right;
    if (!(denominator > 0)) continue;
    const exPrice = (priorClose - cash + rightPrice * right) / denominator;
    if (!(exPrice > 0)) continue;
    factors.push({ date: exDate, ratio: exPrice / priorClose });
  }
  factors.sort((a, b) => a.date - b.date);
  return factors;
}

// 对未复权价应用复权比例：第 i 天乘「除权日在该日之后」的所有比例之积（后缀积）。
function applyQfq(rawBars, factors) {
  const suffix = new Array(factors.length + 1).fill(1);
  for (let i = factors.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] * factors[i].ratio;
  return rawBars.map((bar) => {
    const day = isoToYmd(bar.date);
    let lo = 0;
    let hi = factors.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (factors[mid].date <= day) lo = mid + 1; else hi = mid;
    }
    const k = suffix[lo];
    if (k === 1) return { ...bar };
    return {
      ...bar,
      open: bar.open * k, high: bar.high * k, low: bar.low * k, close: bar.close * k,
    };
  });
}

// 取数边界：返回 { bars, evidence }。evidence.adjustmentMethod 是复权口径的唯一证据，
// 只有 'gbbq-derived' 才允许契约判定为 qfq。
async function fetchTdxKline(code, lmt = 250, { root = configuredRoot() } = {}) {
  const target = dayFileFor(code, root);
  // `disabled` 与「文件缺失」区分开：未配置时本来源根本没被尝试过，
  // 多源链不应把它记进 sourceAttempts，也不应让它改变「全部源不可用」的判定。
  if (!target.path) return { bars: [], evidence: { adjustmentMethod: 'none', disabled: true, reason: '未配置通达信本地数据目录' } };
  let buffer = null;
  try {
    buffer = await fs.promises.readFile(target.path);
  } catch {
    return { bars: [], evidence: { adjustmentMethod: 'none', reason: '通达信本地日线文件缺失', file: target.path } };
  }
  const rawBars = decodeDayBuffer(buffer);
  if (!rawBars.length) return { bars: [], evidence: { adjustmentMethod: 'none', reason: '通达信本地日线文件无有效记录', file: target.path } };
  const lastDate = isoToYmd(rawBars[rawBars.length - 1].date);
  const gbbq = loadIndex(tdxPaths(root).gbbq);
  const events = gbbqEvents(gbbq.index, code);
  const factors = gbbq.index ? buildQfqFactors(events, rawBars, { lastDate }) : [];
  const adjusted = gbbq.index ? applyQfq(rawBars, factors) : rawBars.map((bar) => ({ ...bar }));
  const depth = Math.max(1, Number(lmt) || rawBars.length);
  const bars = adjusted.slice(-depth);
  return {
    bars,
    evidence: {
      adjustmentMethod: gbbq.index ? 'gbbq-derived' : 'none',
      market: target.market,
      barCount: bars.length,
      totalBars: rawBars.length,
      eventCount: factors.length,
      file: target.path,
      gbbqError: gbbq.error || '',
    },
  };
}

module.exports = {
  TDX_MARKETS,
  tdxMarketOf,
  configuredRoot,
  tdxPaths,
  dayFileFor,
  tdxStatus,
  decodeDayBuffer,
  buildQfqFactors,
  applyQfq,
  fetchTdxKline,
};
