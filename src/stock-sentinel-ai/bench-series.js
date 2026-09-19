// 沪深 300（sh000300）日线基准序列。
//
// 存在的唯一理由：limit_pullback v4 的入场过滤里有一条「20 日相对强度 ≤ -5pp」，
// 相对强度 = 个股近 N 日涨幅 − 基准指数同期涨幅，必须与个股按日对齐。回测口径见
// docs/rsi_low_turn与limit_pullback盈亏比优化报告-2021至2026.md：
// 只加跌幅过滤（PF 1.4158）远不如「跌幅 + 相对强度」叠加（PF 1.8626），
// 基准缺失时不允许静默放行这条过滤，否则选出来的票不是回测口径的那批。
//
// 取数顺序：进程内缓存 → 本地磁盘缓存 → 腾讯日K（主站，被 WAF 拦截时回退财经代理）
//          → 项目内通达信日线兜底 → available:false（由调用方显式降级）。
// 本模块只负责产出「交易日 → 基准收盘价」序列，不做任何形态判断，不写其它文件。

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./storage');

const BENCH_CODE = 'sh000300';
const BENCH_NAME = '沪深300';
const CACHE_FILE = path.join(DATA_DIR, 'bench-sh000300.json');
const HSJDAY_FILE = path.join(__dirname, 'data', 'hsjday', 'sh', 'lday', 'sh000300.day');
const DEFAULT_TTL_MINUTES = 240;
const FETCH_BARS = 400;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// 与 data.js 的腾讯日K契约保持一致：主站优先，被 WAF 拦截时用财经代理回退。
const HOSTS = [
  'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get',
  'https://proxy.finance.qq.com/ifzqgtimg/appstock/app/fqkline/get',
];

let memory = null; // { code, name, available, source, fetchedAt, lastDate, bars }
let inflight = null;

function shanghaiDate(d = new Date()) {
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function normalizeBars(raw) {
  const out = [];
  for (const bar of Array.isArray(raw) ? raw : []) {
    const date = String((bar && bar.date) || '');
    const close = Number(bar && bar.close);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(close) || close <= 0) continue;
    out.push({ date, close });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

function payload(source, bars, extra = {}) {
  const list = normalizeBars(bars);
  return {
    code: BENCH_CODE,
    name: BENCH_NAME,
    available: list.length > 0,
    source,
    fetchedAt: new Date().toISOString(),
    lastDate: list.length ? list[list.length - 1].date : '',
    bars: list,
    ...extra,
  };
}

// 通达信日线兜底：32 字节/条，date(int32 YYYYMMDD)、open/high/low/close(int32，单位分)，
// amount(float32)、volume(int32)。只在完全没有网络缓存的机器上用，口径为指数点位、无复权。
function readHsjdayFile() {
  try {
    if (!fs.existsSync(HSJDAY_FILE)) return [];
    const buf = fs.readFileSync(HSJDAY_FILE);
    const out = [];
    for (let off = 0; off + 32 <= buf.length; off += 32) {
      const date = buf.readInt32LE(off);
      const close = buf.readInt32LE(off + 16);
      const y = Math.floor(date / 10000);
      const m = Math.floor((date % 10000) / 100);
      const d = date % 100;
      if (!(y > 1990 && m >= 1 && m <= 12 && d >= 1 && d <= 31) || !(close > 0)) continue;
      out.push({
        date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        close: close / 100,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function readCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    const bars = normalizeBars(parsed && parsed.bars);
    if (!bars.length) return null;
    return {
      code: BENCH_CODE,
      name: BENCH_NAME,
      available: true,
      source: String(parsed.source || 'cache'),
      fetchedAt: String(parsed.fetchedAt || ''),
      lastDate: bars[bars.length - 1].date,
      bars,
    };
  } catch {
    return null;
  }
}

function writeCache(series) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({
      code: series.code, name: series.name, source: series.source,
      fetchedAt: series.fetchedAt, bars: series.bars,
    }));
  } catch { /* 缓存写失败不影响本次使用 */ }
}

async function fetchRemote() {
  const query = `param=${BENCH_CODE},day,,,${FETCH_BARS},qfq`;
  const failures = [];
  for (const host of HOSTS) {
    try {
      const response = await fetch(`${host}?${query}`, {
        headers: { 'User-Agent': UA, Referer: 'https://gu.qq.com/' },
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const res = await response.json();
      const node = res && res.data && res.data[BENCH_CODE];
      // 指数没有复权概念：请求带 qfq 时节点名仍是 day，这里两种节点名都接受。
      const arr = (node && (node.qfqday || node.day)) || [];
      const bars = normalizeBars(arr.map((k) => ({ date: k && k[0], close: k && k[2] })));
      if (!bars.length) throw new Error('响应无日线节点');
      return payload('tencent', bars, { host: new URL(host).host });
    } catch (e) {
      failures.push(`${new URL(host).host} ${String((e && e.message) || e).slice(0, 60)}`);
    }
  }
  throw new Error(failures.join('; ') || '沪深300 日线取数失败');
}

function isFresh(series, ttlMinutes) {
  if (!series || !series.bars || !series.bars.length) return false;
  const fetched = Date.parse(series.fetchedAt || '');
  if (!Number.isFinite(fetched)) return false;
  if (Date.now() - fetched > ttlMinutes * 60 * 1000) return false;
  // 缓存尾日落后于今天的自然日，说明跨过了一个交易日边界，必须重取。
  return series.bars[series.bars.length - 1].date >= shanghaiDate();
}

/**
 * 取沪深300 日线序列（带缓存）。
 * @param {{ ttlMinutes?: number, force?: boolean, allowNetwork?: boolean }} opts
 *        allowNetwork=false 时只读内存/磁盘/通达信兜底，用于研判冻结等不允许联网的链路。
 */
async function ensureBenchSeries({ ttlMinutes = DEFAULT_TTL_MINUTES, force = false, allowNetwork = true } = {}) {
  if (!force && memory && isFresh(memory, ttlMinutes)) return { ...memory, stale: false };
  if (!allowNetwork) {
    const cached = memory || readCache();
    if (cached) return { ...cached, stale: !isFresh(cached, ttlMinutes) };
    const bars = readHsjdayFile();
    if (bars.length) return { ...payload('hsjday', bars), stale: true };
    return { code: BENCH_CODE, name: BENCH_NAME, available: false, source: '', fetchedAt: '', lastDate: '', bars: [], stale: true };
  }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const fresh = await fetchRemote();
      memory = fresh;
      writeCache(fresh);
      return { ...fresh, stale: false };
    } catch (e) {
      const cached = memory || readCache();
      if (cached) return { ...cached, stale: true, error: String((e && e.message) || e).slice(0, 120) };
      const bars = readHsjdayFile();
      if (bars.length) return { ...payload('hsjday', bars), stale: true, error: String((e && e.message) || e).slice(0, 120) };
      return {
        code: BENCH_CODE, name: BENCH_NAME, available: false, source: '', fetchedAt: '', lastDate: '',
        bars: [], stale: true, error: String((e && e.message) || e).slice(0, 120),
      };
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

// 基准收盘价查询表：交易日 → 收盘价（按日期字符串比较，便于与个股 K 线对齐）。
function benchCloseLookup(series) {
  const bars = normalizeBars(series && series.bars);
  return { dates: bars.map((b) => b.date), closes: bars.map((b) => b.close) };
}

// 与回测引擎一致：基准当日缺失时沿用最近一个交易日。
function benchCloseOnOrBefore(lookup, date) {
  const target = String(date || '');
  if (!target || !lookup || !lookup.dates.length) return null;
  let lo = 0;
  let hi = lookup.dates.length - 1;
  if (target < lookup.dates[0]) return null;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (lookup.dates[mid] <= target) lo = mid;
    else hi = mid - 1;
  }
  const value = Number(lookup.closes[lo]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function resetBenchCache() {
  memory = null;
  inflight = null;
}

// 纯本地（不联网）的同步查询表：内存 → 磁盘缓存 → 项目内通达信日线兜底。
// 供同步链路（形态识别 / 单票研判 / 历史复算）在不允许 await 的位置取基准序列；
// 一条都取不到时返回 null，由调用方显式降级（禁止静默放行相对强度过滤）。
function benchLookupSync() {
  if (!memory) {
    const cached = readCache();
    if (cached) memory = cached;
    else {
      const bars = readHsjdayFile();
      if (bars.length) memory = payload('hsjday', bars);
    }
  }
  if (!memory || !memory.bars || !memory.bars.length) return null;
  return benchCloseLookup(memory);
}

module.exports = {
  BENCH_CODE,
  BENCH_NAME,
  CACHE_FILE,
  ensureBenchSeries,
  benchCloseLookup,
  benchCloseOnOrBefore,
  benchLookupSync,
  readCache,
  resetBenchCache,
};
