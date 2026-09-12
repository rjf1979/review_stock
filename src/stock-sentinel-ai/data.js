// 量能洞察 · 数据层：东方财富 clist/get 全市场分页快照 + 市场类型映射。
// 字段约定（fltt=2 时东财直接返回浮点值，无需再 /100）：
//   f12=代码  f14=名称  f2=现价  f3=涨跌幅(%)  f6=成交额(元)
//   f8=换手率(%)  f10=量比(倍)  f20=总市值(元)  f21=流通市值(元)  f62=主力净流入(元)
// 注意：以上为东财 clist 常规语义，落地时务必用真实响应核对 f8/f10 是否符合预期。

const { writeSnapshot, readSnapshot, readLatestSnapshot, writeMarketSnapshotBatch, writeMarketSentimentSnapshot, readMarketSentimentSnapshot, readMarketSentimentEvidence, writeKline, writeKlineListingEvidence, readKline } = require('./storage');
const { isCnStockTradingSession } = require('./market-session');
const { validBar } = require('./kline-quality');
const { ADJUSTMENT, normalizeKlineVolumeByContract, resolveSourceAdjustment, decideKlineWrite, canSafelyRebuildUnverifiedSeries, describeSourceCapabilities } = require('./kline-source-contract');
const { evaluateTailStatus } = require('./kline-tail-status');
const { TextDecoder } = require('util');
const crypto = require('crypto');

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

async function emGet(url, timeoutMs = 15000, { captureRaw = false } = {}) {
  const wait = REQUEST_GAP_MS - (Date.now() - lastEmCallAt);
  if (wait > 0) await sleep(wait);
  const response = await fetch(url, {
    headers: { 'User-Agent': DEFAULT_UA, Referer: 'https://quote.eastmoney.com/' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  lastEmCallAt = Date.now();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!captureRaw) return response.json();
  if (typeof response.text === 'function') {
    const rawText = await response.text();
    return { data: JSON.parse(rawText), rawText, wireExact: true };
  }
  const data = await response.json();
  return { data, rawText: JSON.stringify(data), wireExact: false };
}

// 腾讯指数行情为 GBK 编码，涨跌幅由现价/昨收自行计算，避免依赖易变字段序号。
async function fetchMajorIndicesTencent() {
  const codes = ['sh000001', 'sz399001', 'sz399006'];
  const names = { sh000001: '上证指数', sz399001: '深证成指', sz399006: '创业板指' };
  const response = await fetch(`https://qt.gtimg.cn/q=${codes.join(',')}`, { headers: { 'User-Agent': DEFAULT_UA }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`腾讯指数 HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const raw = new TextDecoder('gbk').decode(bytes);
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
  return { asOf: dates.length ? dates[0] : '', fetchedAt: new Date().toISOString(), source: 'tencent', indices,
    rawResponse: { encoding: 'gbk', wireExact: true, byteLength: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), rawBase64: bytes.toString('base64') } };
}

async function fetchIndustryBoards({ tradeDate = '' } = {}) {
  const fields = 'f12,f14,f3,f6,f62,f104,f105,f128,f124';
  const url = `${CLI_BASE}?pn=1&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${encodeURIComponent('m:90+t:2')}&fields=${fields}`;
  const captured = await emGet(url, 15000, { captureRaw: true });
  const data = captured.data;
  const diff = data && data.data && Array.isArray(data.data.diff) ? data.data.diff : [];
  const boards = diff.map((row) => ({
    code: String(row.f12 || ''), name: String(row.f14 || ''), changePct: Number(row.f3), amount: Number(row.f6), mainNet: Number(row.f62), advanceCount: Number(row.f104), declineCount: Number(row.f105), leader: String(row.f128 || ''), source: 'eastmoney', sourceAt: Number(row.f124) > 0 ? new Date(Number(row.f124) * 1000).toISOString() : '',
  })).filter((x) => x.code && Number.isFinite(x.changePct));
  return { requestedDate: tradeDate, asOf: '', fetchedAt: new Date().toISOString(), source: 'eastmoney', boards, rawResponse: { wireExact: captured.wireExact, byteLength: Buffer.byteLength(captured.rawText), sha256: crypto.createHash('sha256').update(captured.rawText).digest('hex'), rawText: captured.rawText } };
}

// 东财板块分类：t:2 为行业、t:3 为概念。二者字段口径相同，调用方可分别做强度排序。
async function fetchConceptBoards({ tradeDate = '' } = {}) {
  const fields = 'f12,f14,f3,f6,f62,f104,f105,f128,f124';
  const url = `${CLI_BASE}?pn=1&pz=200&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${encodeURIComponent('m:90+t:3')}&fields=${fields}`;
  const captured = await emGet(url, 15000, { captureRaw: true });
  const data = captured.data;
  const diff = data && data.data && Array.isArray(data.data.diff) ? data.data.diff : [];
  const boards = diff.map((row) => ({
    code: String(row.f12 || ''), name: String(row.f14 || ''), changePct: Number(row.f3), amount: Number(row.f6), mainNet: Number(row.f62), advanceCount: Number(row.f104), declineCount: Number(row.f105), leader: String(row.f128 || ''), source: 'eastmoney', sourceAt: Number(row.f124) > 0 ? new Date(Number(row.f124) * 1000).toISOString() : '',
  })).filter((x) => x.code && Number.isFinite(x.changePct));
  return { requestedDate: tradeDate, asOf: '', fetchedAt: new Date().toISOString(), source: 'eastmoney', boards, rawResponse: { wireExact: captured.wireExact, byteLength: Buffer.byteLength(captured.rawText), sha256: crypto.createHash('sha256').update(captured.rawText).digest('hex'), rawText: captured.rawText } };
}

async function fetchBoardConstituents(boardCode, { pageSize = 100 } = {}) {
  const code = String(boardCode || '').trim();
  if (!code) throw new Error('板块代码不能为空');
  const records = []; const seen = new Set(); const rawPages = []; let page = 1; let total = Infinity;
  while (records.length < total) {
    const url = `${CLI_BASE}?pn=${page}&pz=${pageSize}&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${encodeURIComponent(`b:${code}`)}&fields=${FIELDS}`;
    const captured = await emGet(url, 15000, { captureRaw: true });
    const data = captured.data;
    rawPages.push({ page, wireExact: captured.wireExact, byteLength: Buffer.byteLength(captured.rawText), sha256: crypto.createHash('sha256').update(captured.rawText).digest('hex'), rawText: captured.rawText });
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
  return { boardCode: code, records, expectedCount: Number(total) || records.length, fetchedAt: new Date().toISOString(), source: 'eastmoney', rawPages };
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

function normalizeResponseDate(value) {
  const text = String(value == null ? '' : value).trim();
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : '';
}

function topicPoolResponseDate(raw) {
  const data = raw && raw.data || {};
  const values = [raw && raw.tradeDate, raw && raw.date, raw && raw.qdate, data.tradeDate, data.trade_date, data.date, data.qdate];
  for (const value of values) {
    const date = normalizeResponseDate(value);
    if (date) return date;
  }
  return '';
}

async function fetchTopicPool(endpoint, tradeDate, type, sort) {
  const compactDate = String(tradeDate || '').replace(/-/g, '');
  const url = `${EM_TOPIC_BASE}/${endpoint}?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=1000&sort=${encodeURIComponent(sort)}&date=${compactDate}`;
  const raw = await emGet(url, 20000);
  if (!raw || Number(raw.rc) !== 0 || !raw.data || !Array.isArray(raw.data.pool)) throw new Error(`${type}池响应无效`);
  return { raw, records: normalizeTopicPool(raw, type), total: Number(raw.data.tc) || raw.data.pool.length, responseDate: topicPoolResponseDate(raw) };
}

async function fetchMarketSentiment(tradeDate, { dataSource = 'live', validationRecords = [] } = {}) {
  const date = String(tradeDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('情绪结构交易日无效');
  if (dataSource !== 'live') {
    const cached = await readMarketSentimentSnapshot(date);
    if (cached) return { ...cached, sourceEvidence: await readMarketSentimentEvidence(date) };
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
    const responseDates = { limitUp: up.responseDate, limitDown: down.responseDate, broken: broken.responseDate };
    const knownResponseDates = Object.values(responseDates).filter(Boolean);
    const responseDateConflicts = knownResponseDates.filter((value) => value !== date);
    const snapshotCrossVerified = comparable.length >= 3 && matched.length / comparable.length >= 0.8;
    const allPoolsDateStamped = knownResponseDates.length === 3 && knownResponseDates.every((value) => value === date);
    const dateVerified = responseDateConflicts.length === 0 && (allPoolsDateStamped || snapshotCrossVerified);
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
        dateVerified, snapshotCrossVerified, validationSamples: comparable.length, validationMatches: matched.length,
        requestedDate: date, responseDates,
        conflicts: responseDateConflicts.length
          ? [`情绪池响应日期与请求日期冲突：${[...new Set(responseDateConflicts)].join('、')}`]
          : dateVerified ? [] : ['池接口未返回完整可验证日期，且与同日全市场快照交叉验证不足'],
        counts: { limitUp: { records: up.records.length, total: up.total }, limitDown: { records: down.records.length, total: down.total }, broken: { records: broken.records.length, total: broken.total } },
      },
    };
    await writeMarketSentimentSnapshot({ ...normalized, normalized, raw: { limitUp: up.raw, limitDown: down.raw, broken: broken.raw }, quality: normalized.quality });
    return { ...normalized, sourceEvidence: await readMarketSentimentEvidence(date) };
  } catch (error) {
    const failed = { available: false, tradeDate: date, fetchedAt, source: 'eastmoney', reason: error.message || '情绪池抓取失败', quality: { complete: false, requestedDate: date, conflicts: [] } };
    await writeMarketSentimentSnapshot({ ...failed, normalized: failed, raw: null, quality: failed.quality });
    return { ...failed, sourceEvidence: await readMarketSentimentEvidence(date) };
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
  const isComplete = page.quality ? page.quality.complete === true : page.records.length >= expectedCount;
  await writeMarketSnapshotBatch({
    id: `${date}__${marketKey}`,
    tradeDate: date,
    marketKey,
    source,
    expectedCount,
    records: page.records,
    isComplete,
    errors: page.quality && page.quality.complete ? null : { reason: '分页结果未达到接口总数或存在重复/空页', quality: page.quality || null },
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
  let rawRows = 0;
  let filteredRows = 0;
  let duplicateRows = 0;
  let emptyPages = 0;
  const rawPages = [];
  const errors = [];
  while (records.length < limit) {
    let data;
    let captured;
    try { captured = await emGet(urlFor(page), 15000, { captureRaw: true }); data = captured.data; }
    catch (error) {
      const reason = String(error && error.message || error).replace(/https?:\/\/\S+/g, '').slice(0, 160);
      errors.push({ page, reason: reason || '分页请求失败' });
      if (page === 1) throw error;
      break;
    }
    const rawJson = captured.rawText;
    rawPages.push({ page, fetchedAt: new Date().toISOString(), byteLength: Buffer.byteLength(rawJson), sha256: crypto.createHash('sha256').update(rawJson).digest('hex'), wireExact: captured.wireExact, rawText: rawJson });
    const d = data && data.data;
    if (!d || !Array.isArray(d.diff)) {
      if (page === 1) throw new Error(`市场 ${marketKey} 分页无数据：` + JSON.stringify(data || {}).slice(0, 200));
      emptyPages += 1;
      break;
    }
    if (page === 1 && d.total) total = Number(d.total) || Infinity;
    // 用“原始页条数”判断是否到末页；normalizeRow 会剔除停牌/无价行，若用剔除后的行数
    // 会在第一页就误判结束，导致漏扫大量股票（北交所曾只取回 88/352）。
    const rawCount = Array.isArray(d.diff) ? d.diff.length : 0;
    rawRows += rawCount;
    if (rawCount === 0) { emptyPages += 1; break; }
    const rows = d.diff.map((row) => normalizeRow(row, marketKey)).filter(Boolean);
    filteredRows += Math.max(0, rawCount - rows.length);
    for (const row of rows) {
      if (seen.has(row.code)) { duplicateRows += 1; continue; }
      seen.add(row.code);
      records.push(row);
      if (records.length >= limit) break;
    }
    if (rawRows >= total || rawCount < pageSize) break;
    page += 1;
  }

  const expected = Number(total) || records.length;
  const complete = rawRows >= expected && duplicateRows === 0 && emptyPages === 0 && errors.length === 0;
  return { total: expected, fetched: records.length, records, ms: Date.now() - startAt,
    rawPages,
    quality: { complete, expectedCount: expected, rawRows, normalizedRows: records.length, filteredRows, pages: rawPages.length, duplicateRows, emptyPages, errors,
      reason: complete ? '' : '原始分页不完整或存在重复、空页、请求失败' } };
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
    const rawPagesByMarket = {};
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
      rawPagesByMarket[key] = m.rawPages || [];
      ms += m.ms;
      for (const r of m.records) {
        if (!seen.has(r.code)) { seen.add(r.code); merged.push(r); }
      }
      if (isFull && m.records.length) {
        writeSnapshot(today, key, m.records);
        await archiveMarketSnapshot(today, key, 'live', m);
      }
      byMarket.push({ key, label: MARKETS[key] ? MARKETS[key].label : key, source: 'live', count: m.records.length, date: today, quality: m.quality, rawResponse: (m.rawPages || []).map(({ rawText, ...page }) => page) });
    }
    return { total: merged.length, fetched: merged.length, records: merged, ms, dataSource, snapshotDate: today, byMarket, rawPagesByMarket };
  }

  // live：逐市场拉取并按市场落盘。
  const merged = [];
  const seen = new Set();
  const byMarket = [];
  const rawPagesByMarket = {};
  let ms = 0;
  for (const key of selected) {
    const m = await fetchMarketPages(key, { pageSize, limit });
    rawPagesByMarket[key] = m.rawPages || [];
    ms += m.ms;
    for (const r of m.records) {
      if (!seen.has(r.code)) { seen.add(r.code); merged.push(r); }
    }
    if (isFull && m.records.length) {
      writeSnapshot(today, key, m.records);
      await archiveMarketSnapshot(today, key, 'live', m);
    }
    byMarket.push({ key, label: MARKETS[key] ? MARKETS[key].label : key, source: 'live', count: m.records.length, date: today, quality: m.quality, rawResponse: (m.rawPages || []).map(({ rawText, ...page }) => page) });
  }
  return { total: merged.length, fetched: merged.length, records: merged, ms, dataSource: 'live', snapshotDate: today, byMarket, rawPagesByMarket };
}

// ── 单票日K ─────────────────────────────
// 主用：腾讯 fqkline（前复权，不封IP），sh/sz/创业板/科创板正常；
// 北交所 920 统一代码移动端接口暂未回填历史（仅当日一根），故缺历史时回退东财日K。
function normalizeKlineVolume(rawVolume, source) {
  // 本地库统一以“股”存储。各源的原始单位以 kline-source-contract.js 的声明为准，
  // 在源适配边界统一，防止故障转移后将手数直接混入股数序列。
  return normalizeKlineVolumeByContract(rawVolume, source);
}

function normalizeKlineVolumeSeries(bars) {
  const list = Array.isArray(bars) ? bars.map((bar) => ({ ...bar })) : [];
  const vols = list.map((bar) => Number(bar.volume));
  const usable = vols.filter((value) => Number.isFinite(value) && value > 0);
  // 读侧兜底（docs/kline-data-standard.md §3）：仅当末尾连续 ≥2 根 ≥20× 历史中位时，
  // 判定“历史为手、尾部为股”，把边界前的柱 ×100。单根暴量/真实缩量不触发，不回写存储。
  if (usable.length < 16) return list;
  const sorted = [...usable].sort((a, b) => a - b);
  const medHist = sorted[Math.floor((sorted.length - 1) / 2)];
  if (!(medHist > 0)) return list;
  const threshold = medHist * 20;
  let highRun = 0;
  while (highRun < vols.length && Number.isFinite(vols[vols.length - 1 - highRun]) && vols[vols.length - 1 - highRun] >= threshold) highRun++;
  // 高量簇过长说明是真实放量行情而非单位边界；边界前至少要留 8 根历史。
  if (highRun < 2 || highRun > 10 || vols.length - highRun < 8) return list;
  for (let i = 0; i < vols.length - highRun; i++) {
    const bar = list[i];
    if (Number.isFinite(Number(bar.volume)) && Number(bar.volume) > 0) bar.volume = Number(bar.volume) * 100;
  }
  return list;
}

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
  const symbol = `${prefix}${code}`;
  const node = res && res.data && res.data[symbol];
  // 数据节点名是唯一能从响应验证复权口径的证据：qfq 请求返回 qfqday，去掉复权参数则返回 day。
  const nodeName = node && node.qfqday ? 'qfqday' : node && node.day ? 'day' : '';
  const arr = (node && (node.qfqday || node.day)) || [];
  const bars = arr
    .filter((k) => k && k.length >= 6)
    .map((k) => ({
      date: k[0],
      open: Number(k[1]),
      close: Number(k[2]),
      high: Number(k[3]),
      low: Number(k[4]),
      volume: normalizeKlineVolume(k[5], 'tencent'),
    }));
  return { bars, evidence: { node: nodeName, symbol, requestedAdjustment: ADJUSTMENT.QFQ } };
}

// 个股板块归属：东财公开 slist 接口一次返回行业层级、概念及地域/指数板块。
// 返回顺序的前几项是行业层级；地域和指数项不作为盯盘题材标签保存。
async function fetchStockThemeEvidence(codeInput) {
  const code = String(codeInput || '').trim();
  if (!/^\d{6}$/.test(code)) return [];
  const secid = `${code.startsWith('6') ? '1' : '0'}.${code}`;
  const url = `https://push2.eastmoney.com/api/qt/slist/get?fltt=2&invt=2&secid=${secid}&spt=3&pi=0&pz=200&po=1&fields=f12,f14,f3,f128`;
  const data = await emGet(url);
  const raw = data && data.data && data.data.diff;
  const boards = (Array.isArray(raw) ? raw : Object.values(raw || {})).map((item) => ({ code: String(item.f12 || ''), name: String(item.f14 || '').trim() })).filter((item) => item.code && item.name);
  const ignored = /板块$|融资融券|深股通|沪股通|^[沪深]证|^中证|^HS\d|^MSCI/;
  const usable = boards.filter((item) => !ignored.test(item.name));
  const seen = new Set();
  return usable.map((item, index) => ({ ...item, kind: index < 3 ? 'industry' : 'concept' }))
    .filter((item) => !seen.has(item.code) && (seen.add(item.code) || true)).slice(0, 12);
}

// 百度股市通日 K：公开接口，无需账号或 Token，返回字段表与分号分隔的行情行。
// 该接口的成交量单位为股，市场代码直接使用 6 位证券代码。
async function fetchKlineBaidu(code, lmt) {
  const url = new URL('https://finance.pae.baidu.com/selfselect/getstockquotation');
  const params = {
    all: '1', isIndex: 'false', isBk: 'false', isBlock: 'false', isFutures: 'false', isStock: 'true',
    newFormat: '1', group: 'quotation_kline_ab', finClientType: 'pc', code, start_time: '', ktype: '1',
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: {
      'User-Agent': DEFAULT_UA,
      Accept: 'application/vnd.finance-web.v1+json',
      Origin: 'https://gushitong.baidu.com',
      Referer: 'https://gushitong.baidu.com/',
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const market = (await response.json()).Result?.newMarketData || {};
  const keys = Array.isArray(market.keys) ? market.keys : [];
  const index = Object.fromEntries(keys.map((key, i) => [key, i]));
  if (![index.time, index.open, index.close, index.high, index.low, index.volume].every(Number.isInteger)) return [];
  return String(market.marketData || '').split(';').filter(Boolean).map((line) => {
    const row = line.split(',');
    return {
      date: String(row[index.time] || ''),
      open: Number(row[index.open]), close: Number(row[index.close]), high: Number(row[index.high]), low: Number(row[index.low]),
      volume: normalizeKlineVolume(row[index.volume], 'baidu'),
    };
  }).filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && [row.open, row.close, row.high, row.low].every(Number.isFinite)).slice(-lmt);
}

// 东财日K（前复权）：为北交所提供完整历史；secid 规则 6 开头→沪(1)，其余→深/北(0)。
const EM_KLINE_BASE = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';

function eastmoneySecid(code) {
  return (code.startsWith('6') ? '1.' : '0.') + code;
}

function normalizeListingDate(value) {
  const raw = String(value == null ? '' : value).replace(/\D/g, '');
  if (!/^\d{8}$/.test(raw)) return '';
  const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  const time = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date ? date : '';
}

async function fetchStockListingEvidence(code) {
  const listingFetchedAt = new Date().toISOString();
  try {
    const url = `https://push2delay.eastmoney.com/api/qt/stock/get?secid=${eastmoneySecid(String(code))}&fields=f57,f58,f189`;
    const payload = await emGet(url, 12000);
    const listingDate = normalizeListingDate(payload && payload.data && payload.data.f189);
    return listingDate ? { listingDate, listingSource: 'eastmoney_stock_profile', listingFetchedAt } : {};
  } catch {
    return {};
  }
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
      volume: normalizeKlineVolume(p[5], 'em'),
    };
  });
}

// 搜狐财经历史行情：公开接口，无需账号或 Token。返回按日期倒序的日线，成交量单位为手。
async function fetchKlineSohu(code, lmt) {
  const end = todayStr().replace(/-/g, '');
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - 3);
  const start = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(startDate).replace(/-/g, '');
  const url = `https://q.stock.sohu.com/hisHq?code=cn_${code}&start=${start}&end=${end}&stat=1&order=D&period=d`;
  const response = await fetch(url, {
    headers: { 'User-Agent': DEFAULT_UA, Referer: 'https://q.stock.sohu.com/' },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = JSON.parse(await response.text());
  const rows = Array.isArray(payload) && payload[0] && Array.isArray(payload[0].hq) ? payload[0].hq : [];
  return rows.map((row) => ({
    date: String(row[0] || ''), open: Number(row[1]), close: Number(row[2]), high: Number(row[6]), low: Number(row[5]),
    volume: normalizeKlineVolume(row[7], 'sohu'),
  })).filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && [row.open, row.close, row.high, row.low].every(Number.isFinite)).reverse().slice(-lmt);
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
      volume: normalizeKlineVolume(k.volume, 'sina'),
    }));
}

// ── K线多源链（免费平台故障转移）──────────────────────────────
// 依次尝试 腾讯 → 东财 → 新浪；任一源拉到足够历史即停。
// 每个源维护「健康熔断」：连续失败会被降级冷却（冷却期内不再请求），
// 成功后立即复位，从而在某个平台限流时自动切到其它免费平台，避免继续轰接口。
const KLINE_SOURCES = ['tencent', 'baidu', 'sohu', 'em', 'sina'];
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

// 源适配边界：统一返回 { bars, evidence }。evidence 只承载「响应本身可验证」的口径证据。
async function fetchKlineBySource(src, code, lmt) {
  const result =
    src === 'tencent' ? await fetchKlineTencent(code, lmt)
    : src === 'baidu' ? await fetchKlineBaidu(code, lmt)
    : src === 'sohu' ? await fetchKlineSohu(code, lmt)
    : src === 'em' ? await fetchKlineEastmoney(code, lmt)
    : await fetchKlineSina(code, lmt);
  if (Array.isArray(result)) return { bars: result, evidence: {} };
  return { bars: (result && result.bars) || [], evidence: (result && result.evidence) || {} };
}

// 纯联网取数（不落盘）：按多源链健康度取最近 lmt 根，返回取数结果与来源元数据。
// adjustmentType 只由 kline-source-contract 契约判定：无法从响应验证的来源一律 unknown。
// 供候选池/盯盘补齐使用：联网取数后统一写库，网络等待与落盘可以重叠。
async function fetchKlineRaw(code, { lmt = 250, prefer = '' } = {}) {
  let kline = [];
  let source = '';
  let adjustmentType = '';
  let sourceEvidence = {};
  const sourceAttempts = [];
  for (const src of klineSourceOrder(prefer)) {
    // 冷却源仍排在最后尝试：健康源全不可用时保留最后的故障转移机会。
    const cooling = srcHealth(src).cooldownUntil > Date.now();
    try {
      const fetched = await fetchKlineBySource(src, code, lmt);
      const rawRows = fetched.bars;
      const rows = normalizeKlineVolumeSeries(rawRows).filter(validBar);
      const resolvedAdjustment = resolveSourceAdjustment(src, fetched.evidence);
      if (rows && rows.length) {
        markKlineSourceSuccess(src);
        sourceAttempts.push({
          source: src, outcome: 'success', depth: rows.length, cooling,
          adjustmentType: resolvedAdjustment,
          adjustmentVerified: resolvedAdjustment !== ADJUSTMENT.UNKNOWN,
        });
      } else {
        sourceAttempts.push({ source: src, outcome: 'empty', retryable: false, cooling, adjustmentType: resolvedAdjustment });
      }
      const candidateLatest = rows.length ? String(rows[rows.length - 1].date || '') : '';
      const currentLatest = kline.length ? String(kline[kline.length - 1].date || '') : '';
      if (rows.length && (candidateLatest > currentLatest || (candidateLatest === currentLatest && rows.length > kline.length))) {
        kline = rows; source = src; adjustmentType = resolvedAdjustment; sourceEvidence = fetched.evidence || {};
      }
      // 主源已达到目标深度时停止，避免为校验备用源而重复请求；若主源尾日过旧，
      // 调用方可通过 prefer 指定备用源重试，避免不同复权口径的历史序列拼接。
      if (kline.length >= lmt) break;
    } catch (e) {
      markKlineSourceFail(src);
      const message = String(e && e.message || e).replace(/https?:\/\/\S+/g, '').slice(0, 120);
      sourceAttempts.push({ source: src, outcome: 'error', reason: message || '请求失败', retryable: true });
    }
  }
  if (source) lastKlineSource = source;
  const fetchedAt = new Date().toISOString();
  const tail = kline.length
    ? evaluateTailStatus({ bar: kline[kline.length - 1], now: new Date(fetchedAt) })
    : { status: '', confirmedAt: '', reason: '未取到有效K线' };
  return {
    code: String(code), kline, source,
    adjustmentType: adjustmentType || ADJUSTMENT.UNKNOWN,
    sourceEvidence, fetchedAt,
    sourceLatestDate: kline.length ? String(kline[kline.length - 1].date || '') : '',
    tailStatus: tail.status || '', tailConfirmedAt: tail.confirmedAt || '', tailReason: tail.reason || '',
    tailDegraded: Boolean(tail.degraded),
    sourceAttempts,
  };
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
  const raw = await fetchKlineRaw(code, { lmt, prefer });
  const { kline } = raw;
  const listingEvidence = kline.length < lmt ? await fetchStockListingEvidence(code) : {};
  if (listingEvidence.listingDate) await writeKlineListingEvidence(code, listingEvidence);
  // 只在有有效 K 线时落盘，避免失败/无数据时写空文件污染 data/kline。
  // 落盘前先判定复权口径是否与既有序列相容：冲突时保留既有序列，不静默混写。
  if (kline.length) {
    const stored = await readKline(code);
    const decision = decideKlineWrite({ stored, source: raw.source, adjustmentType: raw.adjustmentType });
    const rebuild = canSafelyRebuildUnverifiedSeries({
      storedBars: stored && stored.kline,
      incomingBars: kline,
      source: raw.source,
      adjustmentType: raw.adjustmentType,
      decisionStatus: decision.status,
    });
    if (decision.allowed || rebuild) {
      const written = await writeKline(code, kline, today, {
        source: raw.source,
        adjustmentType: raw.adjustmentType,
        sourceLatestDate: raw.sourceLatestDate,
        fetchedAt: raw.fetchedAt,
        tailStatus: raw.tailStatus,
        tailConfirmedAt: raw.tailConfirmedAt,
        ...listingEvidence,
        replaceSeries: rebuild,
      });
      if (!written && stored && Array.isArray(stored.kline)) return stored.kline;
    } else if (stored && Array.isArray(stored.kline) && stored.kline.length) {
      // 冲突源不得只因联网成功就进入详情/筛选；业务层继续使用已验证的本地序列。
      return stored.kline;
    }
  }
  return kline;
}

// ── 批量实时行情（自选盯盘）──────────────────────────────
// 副接口：东方财富 ulist.np/get，可一次取多只股票。字段与 clist 一致：
//   f12=代码 f14=名称 f2=现价 f3=涨跌幅(%) f4=涨跌额 f5=成交量
//   f6=成交额(元) f8=换手率(%) f10=量比 f15=最高 f16=最低 f17=今开 f18=昨收
const EM_QUOTE_BASE = 'https://push2delay.eastmoney.com/api/qt/ulist.np/get';
const QUOTE_FIELDS = 'f12,f14,f2,f3,f4,f5,f6,f8,f10,f15,f16,f17,f18,f21,f62,f124';
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
  const num = (v) => (closed ? null : numOr(v));
  return {
    code,
    name,
    price: price != null ? price : 0,
    change: num(d.f4),
    changePct: num(d.f3),
    // 东财快照 f5 成交量为“手”，在源边界统一为“股”（docs/kline-data-standard.md §2）。
    volume: numOr(d.f5) == null ? null : numOr(d.f5) * 100,
    amount: num(d.f6),
    turnover: num(d.f8),
    volumeRatio: num(d.f10),
    high: num(d.f15),
    low: num(d.f16),
    open: num(d.f17),
    prevClose,
    closed,
    mainNet: num(d.f62),
    floatMcap: num(d.f21),
    sourceAt: Number.isFinite(Number(d.f124)) && Number(d.f124) > 0 ? new Date(Number(d.f124) * 1000).toISOString() : '',
  };
}

/**
 * 批量拉取多只股票实时行情（自动分块、去重、清洗）。
 * @param {string[]} codes 6 位股票代码数组。
 * @returns {Promise<Array>} 清洗后的行情数组（含 null 已剔除）。
 */
async function fetchQuotes(codes, { timeoutMs = 12000 } = {}) {
  const result = await fetchQuotesDetailed(codes, { timeoutMs });
  return result.quotes;
}

async function fetchQuotesDetailed(codes, { timeoutMs = 12000 } = {}) {
  const list = [...new Set((codes || []).map((c) => String(c).trim()).filter((c) => /^\d{6}$/.test(c)))];
  const fetchedAt = new Date().toISOString();
  if (!list.length) return { quotes: [], requested: 0, received: 0, missingCodes: [], errors: [], fetchedAt, source: 'eastmoney' };
  const out = [];
  const errors = [];
  for (let i = 0; i < list.length; i += QUOTE_CHUNK) {
    const chunk = list.slice(i, i + QUOTE_CHUNK);
    const secids = chunk.map(quoteSecid).join(',');
    const url = `${EM_QUOTE_BASE}?secids=${secids}&fields=${QUOTE_FIELDS}&fltt=2&invt=2&pn=1&pz=${QUOTE_CHUNK}`;
    try {
      const data = await emGet(url, timeoutMs);
      const diff = data && data.data && data.data.diff;
      if (Array.isArray(diff)) {
        for (const d of diff) {
          const q = normalizeQuote(d);
          if (q) out.push(q);
        }
      }
    } catch (error) {
      errors.push({ codes: chunk, error: String(error && error.message || error).replace(/https?:\/\/\S+/g, '').slice(0, 160) });
    }
  }
  const receivedCodes = new Set(out.map((quote) => quote.code));
  return {
    quotes: out,
    requested: list.length,
    received: receivedCodes.size,
    missingCodes: list.filter((code) => !receivedCodes.has(code)),
    errors,
    fetchedAt: new Date().toISOString(),
    source: 'eastmoney',
  };
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
  fetchKlineBaidu,
  fetchKlineSohu,
  fetchStockListingEvidence,
  normalizeListingDate,
  normalizeKlineVolume,
  normalizeKlineVolumeSeries,
  describeSourceCapabilities,
  resolveSourceAdjustment,
  getLastKlineSource,
  fetchQuotes,
  fetchQuotesDetailed,
  normalizeQuote,
  isCnStockTradingSession,
  codeMarket,
  resolveStockMeta,
  normalizeRow,
  isStOrSuspended,
  emGet,
  fetchMajorIndicesTencent,
  fetchIndustryBoards,
  fetchConceptBoards,
  fetchStockThemeEvidence,
  fetchBoardConstituents,
  fetchMarketSentiment,
  eastmoneySecid,
};
