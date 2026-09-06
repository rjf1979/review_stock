// 量能洞察 · 数据层：东方财富 clist/get 全市场分页快照 + 市场类型映射。
// 字段约定（fltt=2 时东财直接返回浮点值，无需再 /100）：
//   f12=代码  f14=名称  f2=现价  f3=涨跌幅(%)  f6=成交额(元)
//   f8=换手率(%)  f10=量比(倍)  f20=总市值(元)  f21=流通市值(元)  f62=主力净流入(元)
// 注意：以上为东财 clist 常规语义，落地时务必用真实响应核对 f8/f10 是否符合预期。

const { writeSnapshot, readSnapshot, readLatestSnapshot, writeMarketSnapshotBatch, writeMarketSentimentSnapshot, readMarketSentimentSnapshot, writeKline, readKline } = require('./storage');
const { TextDecoder } = require('util');

const REQUEST_GAP_MS = 1100; // 东财串行限流（>=1s），与 desktop 保持一致。
const CLI_BASE = 'https://push2delay.eastmoney.com/api/qt/clist/get';
const EM_TOPIC_BASE = 'https://push2ex.eastmoney.com';

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

// ── 市场类型 → 东财 fs 映射 ─────────────────────────────
// fs 组合参考项目现有全市场常量：'m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23'
//   m:0+t:6    深市主板（含原中小板）
//   m:0+t:80   创业板
//   m:1+t:2    沪市主板
//   m:1+t:23   科创板
//   m:0+t:81+s:2048  北交所（待实测校验，代码以 8/4/92 开头）
const MARKETS = {
  sh_main: { label: '上证主板', fs: 'm:1+t:2', secidPrefix: '1' },
  sz_main: { label: '深证主板', fs: 'm:0+t:6', secidPrefix: '0' },
  chuangye: { label: '创业板', fs: 'm:0+t:80', secidPrefix: '0' },
  kechuang: { label: '科创板', fs: 'm:1+t:23', secidPrefix: '1' },
  beijiao: { label: '北交所', fs: 'm:0+t:81+s:2048', secidPrefix: '0' },
};

const FIELDS = 'f12,f14,f2,f3,f6,f8,f10,f20,f21,f62';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 本地交易日（Asia/Shanghai）YYYY-MM-DD，用于快照/K线落盘与缓存日期比对。
function todayStr() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return parts;
}

// 逐市场返回本地状态：当日快照、最近一次快照（日期/数量），供前端「本地/最近」提前提示与按市场展示。
function snapshotStatus(markets = []) {
  const today = todayStr();
  const selected = markets.length ? markets : Object.keys(MARKETS);
  const items = selected.map((key) => {
    const todaySnap = readSnapshot(today, key);
    const lastSnap = readLatestSnapshot(key);
    return {
      key,
      label: MARKETS[key] ? MARKETS[key].label : key,
      hasToday: !!(todaySnap && Array.isArray(todaySnap.records) && todaySnap.records.length),
      todayCount: todaySnap ? todaySnap.records.length : 0,
      todayDate: todaySnap ? todaySnap.date : '',
      lastDate: lastSnap ? lastSnap.date : '',
      lastCount: lastSnap ? lastSnap.records.length : 0,
    };
  });
  const okToday = items.filter((i) => i.hasToday).length;
  const lastDates = items.map((i) => i.lastDate).filter(Boolean).sort();
  return {
    today,
    okToday,
    total: selected.length,
    allToday: okToday === selected.length,
    // last 模式整体日期取各市场最近一次的最早值（最保守），避免新旧数据混标。
    lastDate: lastDates.length ? lastDates[0] : '',
    markets: items,
  };
}

let lastEmCallAt = 0;

async function emGet(url, timeoutMs = 15000) {
  const wait = REQUEST_GAP_MS - (Date.now() - lastEmCallAt);
  if (wait > 0) await sleep(wait);
  const response = await fetch(url, {
    headers: { 'User-Agent': DEFAULT_UA, Referer: 'https://quote.eastmoney.com/' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  lastEmCallAt = Date.now();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

// 腾讯指数行情为 GBK 编码，涨跌幅由现价/昨收自行计算，避免依赖易变字段序号。
async function fetchMajorIndicesTencent() {
  const codes = ['sh000001', 'sz399001', 'sz399006'];
  const names = { sh000001: '上证指数', sz399001: '深证成指', sz399006: '创业板指' };
  const response = await fetch(`https://qt.gtimg.cn/q=${codes.join(',')}`, { headers: { 'User-Agent': DEFAULT_UA }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`腾讯指数 HTTP ${response.status}`);
  const raw = new TextDecoder('gbk').decode(await response.arrayBuffer());
  const indices = [];
  for (const line of raw.split(';')) {
    const match = line.match(/v_([a-z0-9]+)="([^"]*)"/i);
    if (!match) continue;
    const fields = match[2].split('~');
    const price = Number(fields[3]);
    const previousClose = Number(fields[4]);
    if (!Number.isFinite(price) || !Number.isFinite(previousClose) || previousClose <= 0) continue;
    const stamp = String(fields[30] || '');
    const quoteDate = /^\d{8}/.test(stamp) ? `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}` : '';
    indices.push({ code: match[1], name: fields[1] || names[match[1]] || match[1], price, previousClose, changePct: Math.round(((price / previousClose - 1) * 100) * 100) / 100, quoteDate, source: 'tencent' });
  }
  const dates = indices.map((x) => x.quoteDate).filter(Boolean).sort();
  return { asOf: dates.length ? dates[0] : '', fetchedAt: new Date().toISOString(), source: 'tencent', indices };
}

async function fetchIndustryBoards({ tradeDate = '' } = {}) {
  const fields = 'f12,f14,f3,f6,f62,f104,f105,f128';
  const url = `${CLI_BASE}?pn=1&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${encodeURIComponent('m:90+t:2')}&fields=${fields}`;
  const data = await emGet(url);
  const diff = data && data.data && Array.isArray(data.data.diff) ? data.data.diff : [];
  const boards = diff.map((row) => ({
    code: String(row.f12 || ''), name: String(row.f14 || ''), changePct: Number(row.f3), amount: Number(row.f6), mainNet: Number(row.f62), advanceCount: Number(row.f104), declineCount: Number(row.f105), leader: String(row.f128 || ''), source: 'eastmoney',
  })).filter((x) => x.code && Number.isFinite(x.changePct));
  return { asOf: String(tradeDate || todayStr()), fetchedAt: new Date().toISOString(), source: 'eastmoney', boards };
}

// 东财板块分类：t:2 为行业、t:3 为概念。二者字段口径相同，调用方可分别做强度排序。
async function fetchConceptBoards({ tradeDate = '' } = {}) {
  const fields = 'f12,f14,f3,f6,f62,f104,f105,f128';
  const url = `${CLI_BASE}?pn=1&pz=200&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${encodeURIComponent('m:90+t:3')}&fields=${fields}`;
  const data = await emGet(url);
  const diff = data && data.data && Array.isArray(data.data.diff) ? data.data.diff : [];
  const boards = diff.map((row) => ({
    code: String(row.f12 || ''), name: String(row.f14 || ''), changePct: Number(row.f3), amount: Number(row.f6), mainNet: Number(row.f62), advanceCount: Number(row.f104), declineCount: Number(row.f105), leader: String(row.f128 || ''), source: 'eastmoney',
  })).filter((x) => x.code && Number.isFinite(x.changePct));
  return { asOf: String(tradeDate || todayStr()), fetchedAt: new Date().toISOString(), source: 'eastmoney', boards };
}

async function fetchBoardConstituents(boardCode, { pageSize = 100 } = {}) {
  const code = String(boardCode || '').trim();
  if (!code) throw new Error('板块代码不能为空');
  const records = []; const seen = new Set(); let page = 1; let total = Infinity;
  while (records.length < total) {
    const url = `${CLI_BASE}?pn=${page}&pz=${pageSize}&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${encodeURIComponent(`b:${code}`)}&fields=${FIELDS}`;
    const data = await emGet(url);
    const d = data && data.data;
    const raw = d && Array.isArray(d.diff) ? d.diff : [];
    if (!raw.length) break;
    if (page === 1) total = Number(d.total) || raw.length;
    for (const row of raw) {
      const normalized = normalizeRow(row, '');
      if (normalized && !seen.has(normalized.code)) { seen.add(normalized.code); records.push(normalized); }
    }
    if (raw.length < pageSize) break;
    page++;
  }
  return { boardCode: code, records, expectedCount: Number(total) || records.length, fetchedAt: new Date().toISOString(), source: 'eastmoney' };
}

function normalizeTopicPool(raw, type) {
  const pool = raw && raw.data && Array.isArray(raw.data.pool) ? raw.data.pool : [];
  const seen = new Map();
  for (const row of pool) {
    const code = String(row.c || '');
    if (!/^\d{6}$/.test(code)) continue;
    const boardHeight = Math.max(1, Number(row.lbc) || Number(row.zttj && row.zttj.ct) || 1);
    const item = {
      code, name: String(row.n || ''), type,
      changePct: Number.isFinite(Number(row.zdp)) ? Number(row.zdp) : null,
      amount: Number.isFinite(Number(row.amount)) ? Number(row.amount) : null,
      industry: String(row.hybk || ''), mainNet: Number.isFinite(Number(row.fund)) ? Number(row.fund) : null,
      firstSealTime: row.fbt == null ? null : String(row.fbt), lastSealTime: row.lbt == null ? null : String(row.lbt),
      brokenCount: Number(row.zbc) || 0, boardHeight,
    };
    const old = seen.get(code);
    if (!old || item.boardHeight > old.boardHeight) seen.set(code, item);
  }
  return [...seen.values()];
}

async function fetchTopicPool(endpoint, tradeDate, type, sort) {
  const compactDate = String(tradeDate || '').replace(/-/g, '');
  const url = `${EM_TOPIC_BASE}/${endpoint}?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=1000&sort=${encodeURIComponent(sort)}&date=${compactDate}`;
  const raw = await emGet(url, 20000);
  if (!raw || Number(raw.rc) !== 0 || !raw.data || !Array.isArray(raw.data.pool)) throw new Error(`${type}池响应无效`);
  return { raw, records: normalizeTopicPool(raw, type), total: Number(raw.data.tc) || raw.data.pool.length };
}

async function fetchMarketSentiment(tradeDate, { dataSource = 'live', validationRecords = [] } = {}) {
  const date = String(tradeDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('情绪结构交易日无效');
  if (dataSource !== 'live') {
    const cached = await readMarketSentimentSnapshot(date);
    if (cached) return cached;
  }
  const fetchedAt = new Date().toISOString();
  try {
    // emGet 内部强制串行间隔，禁止 Promise.all 并发请求东财三个池。
    const up = await fetchTopicPool('getTopicZTPool', date, 'limit_up', 'fbt:asc');
    const down = await fetchTopicPool('getTopicDTPool', date, 'limit_down', 'fund:asc');
    const broken = await fetchTopicPool('getTopicZBPool', date, 'broken', 'zbc:desc');
    const denominator = up.records.length + broken.records.length;
    const snapshotByCode = new Map((Array.isArray(validationRecords) ? validationRecords : []).map((row) => [String(row.code || ''), row]));
    const validationPool = [...up.records, ...down.records, ...broken.records];
    const comparable = validationPool.filter((item) => {
      const row = snapshotByCode.get(item.code);
      return row && item.changePct != null && Number.isFinite(Number(row.changePct));
    });
    const matched = comparable.filter((item) => Math.abs(Number(snapshotByCode.get(item.code).changePct) - Number(item.changePct)) <= 0.2);
    const dateVerified = comparable.length >= 3 && matched.length / comparable.length >= 0.8;
    const heightDistribution = {};
    for (const item of up.records) heightDistribution[item.boardHeight] = (heightDistribution[item.boardHeight] || 0) + 1;
    const normalized = {
      available: true, tradeDate: date, fetchedAt, source: 'eastmoney',
      limitUpCount: up.records.length, limitDownCount: down.records.length, brokenCount: broken.records.length,
      sealRate: denominator ? up.records.length / denominator : null,
      maxBoardHeight: up.records.reduce((m, x) => Math.max(m, x.boardHeight), 0),
      heightDistribution,
      limitUp: up.records, limitDown: down.records, broken: broken.records,
      industryLimitUps: Object.entries(up.records.reduce((o, x) => { const k = x.industry || '未分类'; o[k] = (o[k] || 0) + 1; return o; }, {})).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      quality: {
        complete: up.records.length === up.total && down.records.length === down.total && broken.records.length === broken.total && dateVerified,
        dateVerified, validationSamples: comparable.length, validationMatches: matched.length,
        requestedDate: date, conflicts: dateVerified ? [] : ['池接口未返回可验证日期，且与同日全市场快照交叉验证不足'],
        counts: { limitUp: { records: up.records.length, total: up.total }, limitDown: { records: down.records.length, total: down.total }, broken: { records: broken.records.length, total: broken.total } },
      },
    };
    await writeMarketSentimentSnapshot({ ...normalized, normalized, raw: { limitUp: up.raw, limitDown: down.raw, broken: broken.raw }, quality: normalized.quality });
    return normalized;
  } catch (error) {
    const failed = { available: false, tradeDate: date, fetchedAt, source: 'eastmoney', reason: error.message || '情绪池抓取失败', quality: { complete: false, requestedDate: date, conflicts: [] } };
    await writeMarketSentimentSnapshot({ ...failed, normalized: failed, raw: null, quality: failed.quality });
    return failed;
  }
}

function normalizeRow(row, marketKey = '') {
  // 过滤停牌/无价格等无效行。
  const code = String(row.f12 || '');
  if (!code) return null;
  const price = Number(row.f2);
  if (!Number.isFinite(price) || price <= 0) return null;
  return {
    code,
    name: String(row.f14 || ''),
    price,
    changePct: Number(row.f3) || 0,
    amount: Number(row.f6) || 0,
    turnover: Number(row.f8) || 0,        // 换手率 %
    volumeRatio: Number(row.f10) || 0,    // 量比
    totalMcap: Number(row.f20) || 0,
    floatMcap: Number(row.f21) || 0,
    mainNet: Number(row.f62) || 0,        // 主力净流入（元）
    market: String(marketKey || ''),      // 市场标记（如 sh_main），供按市场筛选/展示
  };
}

function isStOrSuspended(item) {
  return /ST|退/.test(item.name || '');
}

async function archiveMarketSnapshot(date, marketKey, source, page) {
  if (!page || !Array.isArray(page.records) || !page.records.length) return;
  const expectedCount = Number(page.total) || page.records.length;
  const isComplete = page.records.length >= expectedCount;
  await writeMarketSnapshotBatch({
    id: `${date}__${marketKey}`,
    tradeDate: date,
    marketKey,
    source,
    expectedCount,
    records: page.records,
    isComplete,
    errors: isComplete ? null : { reason: '分页结果未达到接口总数' },
  });
}

/**
 * 拉取单个市场的全市场分页快照（东财 clist）。
 * @param {string} marketKey 市场 key（如 sh_main）。
 * @param {object} opts
 * @param {number} opts.pageSize 东财分页条数。
 * @param {number} opts.limit 拉取条数上限；默认 Infinity 表示全量。
 * @returns {Promise<{total:number, fetched:number, records:Array, ms:number}>}
 */
async function fetchMarketPages(marketKey, { pageSize = 100, limit = Infinity } = {}) {
  const market = MARKETS[marketKey];
  if (!market) throw new Error('未知市场类型：' + marketKey);

  const records = [];
  const seen = new Set();
  const startAt = Date.now();
  const urlFor = (page) =>
    `${CLI_BASE}?pn=${page}&pz=${pageSize}&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${encodeURIComponent(market.fs)}&fields=${FIELDS}`;

  let page = 1;
  let total = Infinity;
  while (records.length < limit) {
    const data = await emGet(urlFor(page));
    const d = data && data.data;
    if (!d || !Array.isArray(d.diff)) {
      if (page === 1) throw new Error(`市场 ${marketKey} 分页无数据：` + JSON.stringify(data || {}).slice(0, 200));
      break;
    }
    if (page === 1 && d.total) total = Number(d.total) || Infinity;
    // 用“原始页条数”判断是否到末页；normalizeRow 会剔除停牌/无价行，若用剔除后的行数
    // 会在第一页就误判结束，导致漏扫大量股票（北交所曾只取回 88/352）。
    const rawCount = Array.isArray(d.diff) ? d.diff.length : 0;
    if (rawCount === 0) break;
    const rows = d.diff.map((row) => normalizeRow(row, marketKey)).filter(Boolean);
    for (const row of rows) {
      if (seen.has(row.code)) continue;
      seen.add(row.code);
      records.push(row);
      if (records.length >= limit) break;
    }
    if (records.length >= total || rawCount < pageSize) break;
    page += 1;
  }

  return { total: Number(total) || records.length, fetched: records.length, records, ms: Date.now() - startAt };
}

/**
 * 拉取/读取所选市场的全市场快照。落盘与读取均按「单市场」粒度，records 带 market 标记。
 * @param {object} opts
 * @param {string[]} opts.markets 选定的市场 key（如 sh_main）；为空则全部市场。
 * @param {number} opts.pageSize 东财分页条数。
 * @param {number} opts.limit 拉取条数上限；默认 Infinity 表示全量。
 * @param {'live'|'local'|'last'} opts.dataSource 数据来源：
 *   - live ：逐市场实时拉取并按市场落盘（默认）。
 *   - local：逐市场仅用当日本地快照；某市场当日没有则实时补拉并落盘。
 *   - last ：逐市场用最近一次本地快照；某市场没有则实时补拉并落盘。
 * @returns {Promise<{total:number, fetched:number, records:Array, ms:number, dataSource:string, snapshotDate:string, byMarket:Array}>}
 */
async function fetchMarketSnapshot({ markets = [], pageSize = 100, limit = Infinity, dataSource = 'live', tradeDate = '' } = {}) {
  const selected = markets.length ? markets : Object.keys(MARKETS);
  const today = String(tradeDate || todayStr());
  const isFull = !Number.isFinite(limit);

  // local / last：逐市场读本地快照，缺的市场实时补拉（并落盘）。
  if (dataSource === 'local' || dataSource === 'last') {
    const merged = [];
    const seen = new Set();
    const byMarket = [];
    const missKeys = [];
    let ms = 0;
    for (const key of selected) {
      const snap = dataSource === 'local' ? readSnapshot(today, key) : readLatestSnapshot(key);
      if (snap && Array.isArray(snap.records) && snap.records.length) {
        for (const r of snap.records) {
          if (!seen.has(r.code)) { seen.add(r.code); merged.push(r); }
        }
        byMarket.push({ key, label: MARKETS[key] ? MARKETS[key].label : key, source: dataSource, count: snap.records.length, date: snap.date });
      } else {
        missKeys.push(key);
      }
    }
    // 全部命中 → 纯本地，不联网。
    if (!missKeys.length) {
      return { total: merged.length, fetched: merged.length, records: merged, ms, dataSource, snapshotDate: today, byMarket };
    }
    // 部分市场缺 → 只对缺的市场实时补拉，其余用本地；如实标注 source='live'。
    for (const key of missKeys) {
      const m = await fetchMarketPages(key, { pageSize, limit });
      ms += m.ms;
      for (const r of m.records) {
        if (!seen.has(r.code)) { seen.add(r.code); merged.push(r); }
      }
      if (isFull && m.records.length) {
        writeSnapshot(today, key, m.records);
        await archiveMarketSnapshot(today, key, 'live', m);
      }
      byMarket.push({ key, label: MARKETS[key] ? MARKETS[key].label : key, source: 'live', count: m.records.length, date: today });
    }
    return { total: merged.length, fetched: merged.length, records: merged, ms, dataSource, snapshotDate: today, byMarket };
  }

  // live：逐市场拉取并按市场落盘。
  const merged = [];
  const seen = new Set();
  const byMarket = [];
  let ms = 0;
  for (const key of selected) {
    const m = await fetchMarketPages(key, { pageSize, limit });
    ms += m.ms;
    for (const r of m.records) {
      if (!seen.has(r.code)) { seen.add(r.code); merged.push(r); }
    }
    if (isFull && m.records.length) {
      writeSnapshot(today, key, m.records);
      await archiveMarketSnapshot(today, key, 'live', m);
    }
    byMarket.push({ key, label: MARKETS[key] ? MARKETS[key].label : key, source: 'live', count: m.records.length, date: today });
  }
  return { total: merged.length, fetched: merged.length, records: merged, ms, dataSource: 'live', snapshotDate: today, byMarket };
}

// ── 单票日K ─────────────────────────────
// 主用：腾讯 fqkline（前复权，不封IP），sh/sz/创业板/科创板正常；
// 北交所 920 统一代码移动端接口暂未回填历史（仅当日一根），故缺历史时回退东财日K。
async function fetchKlineTencent(code, lmt) {
  // 北交所代码推断：当前统一为 92 开头，遗留为 4/8 开头；勿把 920 误判为深市。
  const prefix =
    code.startsWith('6') ? 'sh'
    : (code.startsWith('4') || code.startsWith('8') || code.startsWith('92')) ? 'bj'
    : 'sz';
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${prefix}${code},day,,,${lmt},qfq`;
  const response = await fetch(url, {
    headers: { 'User-Agent': DEFAULT_UA },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const res = await response.json();
  const node = res && res.data && res.data[`${prefix}${code}`];
  const arr = (node && (node.qfqday || node.day)) || [];
  return arr
    .filter((k) => k && k.length >= 6)
    .map((k) => ({
      date: k[0],
      open: Number(k[1]),
      close: Number(k[2]),
      high: Number(k[3]),
      low: Number(k[4]),
      volume: Number(k[5]) || 0,
    }));
}

// 东财日K（前复权）：为北交所提供完整历史；secid 规则 6 开头→沪(1)，其余→深/北(0)。
const EM_KLINE_BASE = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';

function eastmoneySecid(code) {
  return (code.startsWith('6') ? '1.' : '0.') + code;
}

async function fetchKlineEastmoney(code, lmt) {
  const url =
    `${EM_KLINE_BASE}?secid=${eastmoneySecid(code)}` +
    '&ut=fa5fd1943c7b386f172d6893dbfba10b' +
    '&fields1=f1,f2,f3,f4,f5,f6' +
    '&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61' +
    '&klt=101&fqt=1&end=20500101' +
    `&lmt=${lmt}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': DEFAULT_UA },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const res = await response.json();
  const kl = (res && res.data && res.data.klines) || [];
  return kl.map((k) => {
    const p = String(k).split(',');
    return {
      date: p[0],
      open: Number(p[1]),
      close: Number(p[2]),
      high: Number(p[3]),
      low: Number(p[4]),
      volume: Number(p[5]) || 0,
    };
  });
}

// 新浪日K（免费、当前网络可用）：symbol 前缀 sh/sz/bj，scale=240 为日线，返回未复权日K。
async function fetchKlineSina(code, lmt) {
  const prefix =
    code.startsWith('6') ? 'sh'
    : (code.startsWith('4') || code.startsWith('8') || code.startsWith('92')) ? 'bj'
    : 'sz';
  const url =
    `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData` +
    `?symbol=${prefix}${code}&scale=240&ma=no&datalen=${lmt}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': DEFAULT_UA },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const arr = await response.json();
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((k) => k && k.day)
    .map((k) => ({
      date: String(k.day),
      open: Number(k.open),
      close: Number(k.close),
      high: Number(k.high),
      low: Number(k.low),
      volume: Number(k.volume) || 0,
    }));
}

// ── K线多源链（免费平台故障转移）──────────────────────────────
// 依次尝试 腾讯 → 东财 → 新浪；任一源拉到足够历史即停。
// 每个源维护「健康熔断」：连续失败会被降级冷却（冷却期内不再请求），
// 成功后立即复位，从而在某个平台限流时自动切到其它免费平台，避免继续轰接口。
const KLINE_SOURCES = ['tencent', 'em', 'sina'];
const KLINE_SOURCE_COOLDOWN_MS = 60_000;      // 单源冷却起始时长
const KLINE_SOURCE_COOLDOWN_MAX_MS = 300_000; // 单源冷却上限（5 分钟）
const KLINE_SOURCE_FAIL_LIMIT = 2;            // 连续失败该次数 → 冷却
const sourceHealth = {};
let lastKlineSource = '';                     // 最近一次成功取数平台（供前端展示）

function getLastKlineSource() {
  return lastKlineSource;
}

function srcHealth(name) {
  if (!sourceHealth[name]) sourceHealth[name] = { consecFails: 0, fails: 0, cooldownUntil: 0 };
  return sourceHealth[name];
}
function markKlineSourceSuccess(name) {
  const h = srcHealth(name);
  h.consecFails = 0;
  h.cooldownUntil = 0;
}
function markKlineSourceFail(name) {
  const h = srcHealth(name);
  h.consecFails += 1;
  h.fails += 1;
  if (h.consecFails >= KLINE_SOURCE_FAIL_LIMIT) {
    const backoff = Math.min(KLINE_SOURCE_COOLDOWN_MAX_MS, KLINE_SOURCE_COOLDOWN_MS * Math.pow(2, h.consecFails - KLINE_SOURCE_FAIL_LIMIT));
    h.cooldownUntil = Date.now() + backoff;
  }
}

function klineSourceOrder(prefer) {
  let order = KLINE_SOURCES.slice();
  if (prefer && order.includes(prefer)) order = [prefer, ...order.filter((s) => s !== prefer)];
  const now = Date.now();
  // 冷却中的源排最后，且冷却越晚恢复越靠后；健康源优先。
  const hot = order.filter((s) => !(sourceHealth[s] && sourceHealth[s].cooldownUntil > now));
  const cold = order
    .filter((s) => sourceHealth[s] && sourceHealth[s].cooldownUntil > now)
    .sort((a, b) => sourceHealth[b].cooldownUntil - sourceHealth[a].cooldownUntil);
  return [...hot, ...cold];
}

async function fetchKlineBySource(src, code, lmt) {
  if (src === 'tencent') return fetchKlineTencent(code, lmt);
  if (src === 'em') return fetchKlineEastmoney(code, lmt);
  return fetchKlineSina(code, lmt);
}

// 纯联网取数（不落盘）：按多源链健康度取最近 lmt 根，返回 { code, kline, source }。
// 供预取「队列模式」使用：生产者联网取数后入队，由消费者统一写库，网络与落盘重叠。
async function fetchKlineRaw(code, { lmt = 250, prefer = '' } = {}) {
  let kline = [];
  let source = '';
  for (const src of klineSourceOrder(prefer)) {
    try {
      const rows = await fetchKlineBySource(src, code, lmt);
      if (rows && rows.length) markKlineSourceSuccess(src);
      if (rows && rows.length && !source) source = src;
      if (rows.length > kline.length) kline = rows;
      if (kline.length >= Math.min(lmt, 10)) break;
    } catch (e) {
      markKlineSourceFail(src);
    }
  }
  if (source) lastKlineSource = source;
  return { code: String(code), kline, source };
}

async function fetchKline(code, { lmt = 250, dataSource = 'live', minDate = '', prefer = '' } = {}) {
  const today = todayStr();

  // 缓存优先：live 不优先；local 仅用当日缓存；last 用不早于 minDate（快照日期）的缓存。
  if (dataSource !== 'live') {
    const cached = await readKline(code);
    if (cached && Array.isArray(cached.kline) && cached.kline.length >= Math.min(lmt, 10)) {
      const cacheDate = String(cached.date || '');
      const ok = dataSource === 'local' ? true
        : dataSource === 'last' ? (!minDate || cacheDate >= minDate)
          : false;
      if (ok) return cached.kline;
    }
  }

  // 多源链取数后落盘，兼容既有调用方（/api/kline、screener-core）。
  const { kline } = await fetchKlineRaw(code, { lmt, prefer });
  // 只在有有效 K 线时落盘，避免失败/无数据时写空文件污染 data/kline。
  if (kline.length) await writeKline(code, kline, today);
  return kline;
}

// ── 批量实时行情（自选盯盘）──────────────────────────────
// 副接口：东方财富 ulist.np/get，可一次取多只股票。字段与 clist 一致：
//   f12=代码 f14=名称 f2=现价 f3=涨跌幅(%) f4=涨跌额 f5=成交量
//   f6=成交额(元) f8=换手率(%) f10=量比 f15=最高 f16=最低 f17=今开 f18=昨收
const EM_QUOTE_BASE = 'https://push2delay.eastmoney.com/api/qt/ulist.np/get';
const QUOTE_FIELDS = 'f12,f14,f2,f3,f4,f5,f6,f8,f10,f15,f16,f17,f18';
const QUOTE_CHUNK = 50; // 单次请求上限，避免 URL 过长

function quoteSecid(code) {
  return (code.startsWith('6') ? '1.' : '0.') + code;
}

function numOr(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeQuote(d) {
  const code = String(d.f12 || '');
  if (!code) return null;
  const name = String(d.f14 || '');
  const prevClose = numOr(d.f18);
  let price = numOr(d.f2);
  const closed = price == null || price <= 0;
  if (closed) price = prevClose;
  // 无实时价也无昨收，但至少有名称时仍保留，避免休市/未开盘导致自选列表空白。
  if (price == null && !name) return null;
  const num = (k) => (closed ? null : numOr(d[k]));
  return {
    code,
    name,
    price: price != null ? price : 0,
    change: num(d.f4),
    changePct: num(d.f3),
    volume: num(d.f5),
    amount: num(d.f6),
    turnover: num(d.f8),
    volumeRatio: num(d.f10),
    high: num(d.f15),
    low: num(d.f16),
    open: num(d.f17),
    prevClose,
    closed,
  };
}

/**
 * 批量拉取多只股票实时行情（自动分块、去重、清洗）。
 * @param {string[]} codes 6 位股票代码数组。
 * @returns {Promise<Array>} 清洗后的行情数组（含 null 已剔除）。
 */
async function fetchQuotes(codes, { timeoutMs = 12000 } = {}) {
  const list = [...new Set((codes || []).map((c) => String(c).trim()).filter((c) => /^\d{6}$/.test(c)))];
  if (!list.length) return [];
  const out = [];
  for (let i = 0; i < list.length; i += QUOTE_CHUNK) {
    const chunk = list.slice(i, i + QUOTE_CHUNK);
    const secids = chunk.map(quoteSecid).join(',');
    const url = `${EM_QUOTE_BASE}?secids=${secids}&fields=${QUOTE_FIELDS}&fltt=2&invt=2&pn=1&pz=${QUOTE_CHUNK}`;
    const data = await emGet(url, timeoutMs);
    const diff = data && data.data && data.data.diff;
    if (Array.isArray(diff)) {
      for (const d of diff) {
        const q = normalizeQuote(d);
        if (q) out.push(q);
      }
    }
  }
  return out;
}

function shanghaiMarketMinutes(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).reduce((out, part) => { out[part.type] = part.value; return out; }, {});
  return { weekday: parts.weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

function isCnStockTradingSession(now = new Date()) {
  const { weekday, minutes } = shanghaiMarketMinutes(now);
  return weekday !== 'Sat' && weekday !== 'Sun' && minutes >= 9 * 60 + 15 && minutes <= 15 * 60;
}

// 闭市时盯盘列表必须使用本地已落盘的最后交易日快照，不能采用无交易日字段的报价接口结果。
async function fetchLatestSnapshotQuotes(codes) {
  const list = [...new Set((codes || []).map((c) => String(c).trim()).filter((c) => /^\d{6}$/.test(c)))];
  const snapshots = new Map();
  for (const code of list) {
    const snapshot = readLatestSnapshot(codeMarket(code));
    if (snapshot && Array.isArray(snapshot.records)) snapshots.set(code, snapshot);
  }
  const klineDates = new Map();
  await Promise.all(list.map(async (code) => {
    let record = await readKline(code);
    let candles = record && Array.isArray(record.kline) ? record.kline : [];
    if (!candles.length) candles = await fetchKline(code, { lmt: 2 }).catch(() => []);
    const latest = candles[candles.length - 1];
    if (latest && /^\d{4}-\d{2}-\d{2}$/.test(String(latest.date || ''))) klineDates.set(code, String(latest.date));
  }));
  const dates = [...klineDates.values()].sort();
  const asOf = dates.length ? dates[0] : '';
  const quotes = list.map((code) => {
    const snapshot = snapshots.get(code);
    if (!snapshot || klineDates.get(code) !== asOf) return null;
    const row = snapshot.records.find((item) => String(item.code) === code);
    if (!row) return null;
    const changePct = Number(row.changePct);
    const price = Number(row.price);
    const prevClose = Number.isFinite(changePct) && Number.isFinite(price) && (100 + changePct) !== 0 ? price / (1 + changePct / 100) : null;
    return {
      code, name: String(row.name || ''), price: Number.isFinite(price) ? price : 0,
      change: Number.isFinite(prevClose) ? price - prevClose : null,
      changePct: Number.isFinite(changePct) ? changePct : null,
      volume: null, amount: numOr(row.amount), turnover: numOr(row.turnover), volumeRatio: numOr(row.volumeRatio),
      high: null, low: null, open: null, prevClose, closed: true, asOf, source: 'local_snapshot',
    };
  }).filter(Boolean);
  return { quotes, asOf, source: 'local_snapshot' };
}

// 按代码前缀推断市场 key（与 MARKETS.secidPrefix 一致），供自选落库时标记市场。
function codeMarket(code) {
  if (/^(4|8|92)/.test(code)) return 'beijiao';
  if (/^68/.test(code)) return 'kechuang';
  if (/^30/.test(code)) return 'chuangye';
  if (/^6/.test(code)) return 'sh_main';
  return 'sz_main';
}

// 从本地快照（当日优先，其次最近一次）解析某只股票的元数据；找不到时 name 为空串。
function resolveStockMeta(code) {
  const mk = codeMarket(code);
  const today = todayStr();
  const snap = readSnapshot(today, mk) || readLatestSnapshot(mk);
  const rec = snap && snap.records && snap.records.find((r) => String(r.code) === String(code));
  return { name: rec ? String(rec.name || '') : '', market: mk };
}

module.exports = {
  MARKETS,
  FIELDS,
  REQUEST_GAP_MS,
  todayStr,
  snapshotStatus,
  fetchMarketPages,
  fetchMarketSnapshot,
  fetchKline,
  fetchKlineRaw,
  getLastKlineSource,
  fetchQuotes,
  fetchLatestSnapshotQuotes,
  isCnStockTradingSession,
  codeMarket,
  resolveStockMeta,
  normalizeRow,
  isStOrSuspended,
  emGet,
  fetchMajorIndicesTencent,
  fetchIndustryBoards,
  fetchConceptBoards,
  fetchBoardConstituents,
  fetchMarketSentiment,
  eastmoneySecid,
};
