// 内置 A 股每日复盘：腾讯（首选，不封IP）+ 东方财富（深度数据）取数 → 温度 → 生成复盘 Markdown
// 由本地定时任务调度，按固定模板生成可审计的复盘数据。
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const REQUEST_GAP_MS = 1100; // 东财 2025 起风控加强：所有东财请求串行限流 ≥1s

async function emJson(url, timeoutMs = 15000) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Referer: 'https://quote.eastmoney.com/' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function parseTencentQuoteTime(value) {
  const raw = String(value || '');
  if (!/^\d{14}$/.test(raw)) return null;
  const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(8, 10)}:${raw.slice(10, 12)}:${raw.slice(12, 14)}+08:00`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// ── 腾讯行情（首选，单次可拿多标的） ──────────────
const TX_SYMBOLS = {
  'sh000001': '上证指数', 'sz399001': '深证成指', 'sz399006': '创业板指', 'sh000688': '科创50',
  'sh000300': '沪深300', 'sh000905': '中证500', 'sh000852': '中证1000',
  'hkHSI': '恒生指数', 'hkHSTECH': '恒生科技',
  'usIXIC': '纳斯达克', 'usINX': '标普500', 'usDJI': '道琼斯',
};
async function fetchTencentQuotes(symbols) {
  const response = await fetch(`https://qt.gtimg.cn/q=${symbols.join(',')}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) });
  const buf = Buffer.from(await response.arrayBuffer());
  const decoded = new TextDecoder('gbk').decode(buf);
  const out = {};
  for (const line of decoded.split(';')) {
    const m = line.match(/v_(\w+)="([^"]*)"/);
    if (!m) continue;
    const f = m[2].split('~');
    if (f.length < 6) continue;
    out[m[1]] = { name: f[1], latest: Number(f[3]), prevClose: Number(f[4]) || Number(f[3]), open: Number(f[5]) || null, volume: Number(f[6]) || 0, high: Number(f[33]) || null, low: Number(f[34]) || null, amountWan: Number(f[37]) || 0, pe: Number(f[39]) || null, quoteAt: parseTencentQuoteTime(f[30]), capturedAt: new Date().toISOString() };
  }
  return out;
}

// ── A 块 · 大盘指数（腾讯首选，东财兜底） ─────────
const INDICES = ['sh000001', 'sz399001', 'sz399006', 'sh000688', 'sh000300', 'sh000905', 'sh000852'];
const EM_INDEX_FALLBACK = { sh000001: [1, '000001'], sz399001: [0, '399001'], sz399006: [0, '399006'], sh000688: [1, '000688'], sh000300: [1, '000300'], sh000905: [1, '000905'], sh000852: [1, '000852'] };
async function fetchIndexEm(market, code) {
  const fields = 'f43,f57,f58,f170,f169,f47,f48';
  const d = await emJson(`https://push2delay.eastmoney.com/api/qt/stock/get?secid=${market}.${code}&fields=${fields}`);
  const row = d?.data;
  if (!row) throw new Error(`${code} 无数据`);
  return { name: String(row.f58 || ''), close: Number(row.f43) / 100, change: Number(row.f169) / 100, changePct: Number(row.f170) / 100, amountYi: Math.round((Number(row.f48) || 0) / 1e8 * 100) / 100, volume: Number(row.f47) || 0, capturedAt: new Date().toISOString() };
}
async function fetchMarketIndices() {
  let quotes;
  try { quotes = await fetchTencentQuotes(INDICES); }
  catch { quotes = null; }
  const indices = [];
  for (const sym of INDICES) {
    const name = TX_SYMBOLS[sym];
    if (quotes && quotes[sym] && quotes[sym].latest > 0) {
      const q = quotes[sym];
      indices.push({ name, close: q.latest, change: Math.round((q.latest - q.prevClose) * 100) / 100, changePct: Math.round((q.latest - q.prevClose) / q.prevClose * 10000) / 100, amountYi: q.amountWan ? Math.round(q.amountWan / 10000 * 100) / 100 : null, volume: q.volume, pe: q.pe, quoteAt: q.quoteAt, capturedAt: q.capturedAt });
    } else {
      try {
        const [mkt, code] = EM_INDEX_FALLBACK[sym];
        const r = await fetchIndexEm(mkt, code);
        if (r && r.name) indices.push({ ...r, name });
      } catch (error) { console.error(`[复盘] 指数 ${sym} 兜底失败：`, error.message); }
      await sleep(REQUEST_GAP_MS);
    }
  }
  return indices;
}

// 期指公开行情约 15 分钟延时；多空拆分只能使用结算后的公开会员持仓。
const INDEX_FUTURES = [
  { market: 'IF', name: '沪深300', variety: 2 },
  { market: 'IH', name: '上证50', variety: 3 },
  { market: 'IC', name: '中证500', variety: 1 },
  { market: 'IM', name: '中证1000', variety: 7 },
];
const futuresQuoteCache = new Map();
const futuresPositionCache = new Map();
const FUTURES_QUOTE_TTL_MS = 15000;
const FUTURES_POSITION_TTL_MS = 10 * 60 * 1000;

function parseJsonp(text) {
  const source = String(text || '').trim();
  return JSON.parse(source.replace(/^\s*\(/, '').replace(/\)\s*$/, ''));
}
function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
async function fetchFuturesQuote(item) {
  const cached = futuresQuoteCache.get(item.market);
  if (cached && Date.now() - cached.cachedAt < FUTURES_QUOTE_TTL_MS) return cached;
  const url = `https://futsseapi.eastmoney.com/list/variety/220/${item.variety}?orderBy=dm&sort=asc&pageSize=20&pageIndex=0&token=8163b6a9200dc68c03113094df2db2c7&field=zde,dm,name,p,zdf,vol,ccl,zjsj&callbackName=`;
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://quote.eastmoney.com/' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = parseJsonp(await response.text());
  const rows = Array.isArray(data?.list) ? data.list : [];
  // 选择持仓量大于零的最近实际合约，避免把已到期的连续合约用于多空对照。
  const pattern = new RegExp(`^${item.market}\\d{4}$`);
  const contract = rows.find(row => pattern.test(String(row.dm)) && Number(row.ccl) > 0) || rows.find(row => pattern.test(String(row.dm)));
  if (!contract) throw new Error('没有可用的实际合约');
  const result = {
    status: 'available',
    market: item.market,
    name: item.name,
    contractCode: String(contract.dm),
    contractName: String(contract.name || contract.dm),
    latest: finiteNumber(contract.p),
    change: finiteNumber(contract.zde),
    changePct: finiteNumber(contract.zdf),
    volume: finiteNumber(contract.vol),
    openInterest: finiteNumber(contract.ccl),
    prevSettlement: finiteNumber(contract.zjsj),
    sourceUrl: url,
  };
  if (result.latest == null || result.prevSettlement == null) throw new Error('行情字段不完整');
  const output = { ...result, cachedAt: Date.now() };
  futuresQuoteCache.set(item.market, output);
  return output;
}
async function fetchFuturesPosition(contractCode, date) {
  const cacheKey = `${contractCode}:${date}`;
  const cached = futuresPositionCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < FUTURES_POSITION_TTL_MS) return cached.value;
  const filter = `(TRADE_MARKET_CODE="069001009")(TRADE_DATE='${date}')(SECURITY_CODE="${contractCode}")`;
  const params = new URLSearchParams({ reportName: 'RPT_FUTU_DAILYPOSITION', columns: 'ALL', filter, sortColumns: 'SECURITY_CODE', sortTypes: '1', pageNumber: '1', pageSize: '200', source: 'WEB', client: 'WEB' });
  const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?${params}`;
  const data = await emJson(url);
  const rows = Array.isArray(data?.result?.data) ? data.result.data : [];
  const summary = rows.find(row => row.TYPE === '1' && row.MEMBER_NAME_ABBR === '本日合计' && finiteNumber(row.LONG_POSITION) != null && finiteNumber(row.SHORT_POSITION) != null)
    || rows.find(row => row.TYPE === '3' && row.MEMBER_NAME_ABBR === '本日合计' && finiteNumber(row.LONG_POSITION) != null && finiteNumber(row.SHORT_POSITION) != null);
  if (!summary) throw new Error('公开结算接口未返回会员多空汇总');
  const longPosition = finiteNumber(summary.LONG_POSITION);
  const shortPosition = finiteNumber(summary.SHORT_POSITION);
  const value = {
    status: 'available',
    date,
    scope: '公开会员汇总',
    longPosition,
    shortPosition,
    netPosition: longPosition != null && shortPosition != null ? longPosition - shortPosition : null,
    longChange: finiteNumber(summary.LP_CHANGE),
    shortChange: finiteNumber(summary.SP_CHANGE),
    volume: finiteNumber(summary.VOLUME),
    sourceUrl: url,
  };
  futuresPositionCache.set(cacheKey, { cachedAt: Date.now(), value });
  return value;
}
async function fetchIndexFutures(date) {
  const capturedAt = new Date().toISOString();
  const items = [];
  for (const item of INDEX_FUTURES) {
    try {
      const quote = await fetchFuturesQuote(item);
      let position;
      try {
        position = await fetchFuturesPosition(quote.contractCode, date);
      } catch (error) {
        position = { status: 'unavailable', date, scope: '公开会员汇总', error: error.message };
      }
      items.push({ ...quote, capturedAt, position });
    } catch (error) {
      items.push({ market: item.market, name: item.name, status: 'unavailable', error: error.message, capturedAt, position: { status: 'unavailable', date, scope: '公开会员汇总', error: '行情合约不可用' } });
    }
    await sleep(REQUEST_GAP_MS);
  }
  const available = items.filter(item => item.status !== 'unavailable' && item.latest != null).length;
  return {
    status: available ? 'ready' : 'error',
    quoteStatus: '公开延时行情',
    positionStatus: '上一交易日结算持仓',
    asOfDate: date,
    capturedAt,
    items,
    source: {
      quote: '东方财富公开期货行情（约 15 分钟延时）',
      position: '东方财富公开会员持仓结算数据（上一交易日）',
      realtimeLongShort: '盘中实时多空拆分需要商业数据授权，中金所 Level-1/Level-2 或合规数据服务商报价以最终合同为准',
    },
  };
}

// ── A+ 块 · 全市场广度（东财分页，避免把局部样本当成全市场） ──
const MARKET_FS = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23';
const MARKET_FIELDS = 'f12,f14,f2,f3,f6,f62,f184';
async function fetchMarketBreadth() {
  const pageSize = 100;
  const firstUrl = `https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=${pageSize}&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${MARKET_FS}&fields=${MARKET_FIELDS}`;
  const first = await emJson(firstUrl);
  const reportedCount = Number(first?.data?.total || 0);
  const rows = [...(first?.data?.diff || [])];
  const pageCount = Math.ceil(reportedCount / pageSize);
  for (let page = 2; page <= pageCount; page++) {
    await sleep(REQUEST_GAP_MS);
    const d = await emJson(`https://push2delay.eastmoney.com/api/qt/clist/get?pn=${page}&pz=${pageSize}&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${MARKET_FS}&fields=${MARKET_FIELDS}`);
    const pageRows = d?.data?.diff || [];
    if (!pageRows.length) break;
    rows.push(...pageRows);
  }
  const stocks = [...new Map(rows.filter(row => row?.f12).map(row => [String(row.f12), row])).values()]
    .filter(row => Number.isFinite(Number(row.f2)) && Number(row.f2) > 0 && Number.isFinite(Number(row.f3)));
  if (reportedCount < 1000 || stocks.length < 1000) {
    return { status: 'invalid', quality: 'insufficient', reportedCount, sampleCount: stocks.length, capturedAt: new Date().toISOString() };
  }
  const up = stocks.filter(row => Number(row.f3) > 0).length;
  const down = stocks.filter(row => Number(row.f3) < 0).length;
  const flat = stocks.length - up - down;
  const turnoverYi = stocks.reduce((sum, row) => sum + (Number(row.f6) || 0), 0) / 1e8;
  const viewStock = row => ({ code: String(row.f12), name: String(row.f14 || ''), close: Number(row.f2), changePct: Number(row.f3), amountYi: Math.round((Number(row.f6) || 0) / 1e8 * 100) / 100 });
  const topGainers = [...stocks].sort((a, b) => Number(b.f3) - Number(a.f3)).slice(0, 8).map(viewStock);
  const topLosers = [...stocks].sort((a, b) => Number(a.f3) - Number(b.f3)).slice(0, 8).map(viewStock);
  const topTurnover = [...stocks].sort((a, b) => Number(b.f6 || 0) - Number(a.f6 || 0)).slice(0, 8).map(viewStock);
  return {
    status: 'ready', quality: 'verified', reportedCount, sampleCount: stocks.length, up, down, flat,
    redRatio: Math.round(up / stocks.length * 10000) / 100,
    upDownRatio: down ? Math.round(up / down * 100) / 100 : null,
    turnoverYi: Math.round(turnoverYi * 100) / 100,
    tradedCodes: stocks.map(row => String(row.f12)),
    topGainers, topLosers, topTurnover,
    capturedAt: new Date().toISOString(),
  };
}

// ── A++ 块 · 盘口异动（东方财富公开实时事件） ─────────
const PANKOU_TYPES = [
  { key: 'largeBuy', label: '大笔买入', type: '8193', tone: 'up', format: 'order' },
  { key: 'largeSell', label: '大笔卖出', type: '8194', tone: 'down', format: 'order' },
  { key: 'rapidRise', label: '急速拉升', type: '8201', tone: 'up', format: 'change' },
  { key: 'strongPressure', label: '猛烈打压', type: '8204', tone: 'down', format: 'change' },
  { key: 'limitUp', label: '封板涨停', type: '4', tone: 'up', format: 'limit' },
  { key: 'limitDown', label: '封板跌停', type: '8', tone: 'down', format: 'limit' },
  { key: 'openLimitUp', label: '打开涨停', type: '16', tone: 'down', format: 'open' },
  { key: 'openLimitDown', label: '打开跌停', type: '32', tone: 'up', format: 'open' },
];
const pankouCache = new Map();
const lastGoodPankou = new Map();
const PANKOU_TTL_MS = 8000;
const PANKOU_TIMEOUT_MS = 8000;
const PANKOU_RETRY_MS = 600;
const PANKOU_STALE_TTL_MS = 10 * 60 * 1000;
const PANKOU_CONCURRENCY = 3;

// 限制并发，避免每 5 秒向东财爆发 8 个并行请求触发限流
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function formatPankouTime(value) {
  const raw = String(value || '').padStart(6, '0');
  return /^\d{6}$/.test(raw) ? `${raw.slice(0, 2)}:${raw.slice(2, 4)}:${raw.slice(4, 6)}` : null;
}
function parsePankouEvent(row, definition) {
  const parts = String(row.i || '').split(',').map(Number);
  const finite = value => Number.isFinite(value) ? value : null;
  const event = { time: formatPankouTime(row.tm), code: String(row.c || ''), name: String(row.n || ''), price: null, changePct: null, volume: null, amountYi: null };
  if (definition.format === 'order') {
    event.volume = finite(parts[0]); event.price = finite(parts[1]); event.changePct = finite(parts[2]) != null ? parts[2] * 100 : null; event.amountYi = finite(parts[3]) != null ? parts[3] / 1e8 : null;
  } else if (definition.format === 'change') {
    event.changePct = finite(parts[0]) != null ? parts[0] * 100 : null; event.price = finite(parts[1]);
  } else if (definition.format === 'limit') {
    event.price = finite(parts[0]); event.volume = finite(parts[1]); event.changePct = finite(parts[3]) != null ? parts[3] * 100 : null;
  } else {
    event.price = finite(parts[0]); event.changePct = finite(parts[1]) != null ? parts[1] * 100 : null;
  }
  return event;
}
async function fetchPankouCategory(definition) {
  const cached = pankouCache.get(definition.key);
  if (cached && Date.now() - cached.cachedAt < PANKOU_TTL_MS) return cached.value;
  const lastGood = lastGoodPankou.get(definition.key);
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const url = `https://push2ex.eastmoney.com/getAllStockChanges?type=${definition.type}&pageindex=0&pagesize=8&ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wzchanges`;
      const d = await emJson(url, PANKOU_TIMEOUT_MS);
      const rows = Array.isArray(d?.data?.allstock) ? d.data.allstock : [];
      const value = { key: definition.key, label: definition.label, tone: definition.tone, status: d?.rc === 0 ? 'ready' : 'error', events: rows.map(row => parsePankouEvent(row, definition)).filter(event => event.code && event.name && event.time), capturedAt: new Date().toISOString() };
      pankouCache.set(definition.key, { cachedAt: Date.now(), value });
      if (value.status === 'ready') lastGoodPankou.set(definition.key, { at: Date.now(), value });
      return value;
    } catch (error) {
      lastError = error;
      if (attempt === 0) { await sleep(PANKOU_RETRY_MS); continue; }
    }
  }
  if (lastGood && Date.now() - lastGood.at < PANKOU_STALE_TTL_MS) {
    const stale = { ...lastGood.value, status: 'stale', staleAt: new Date().toISOString() };
    console.warn(`[实时] ${definition.label}超时（${lastError?.message}），已显示最近一次数据`);
    return stale;
  }
  console.error(`[实时] ${definition.label}失败：`, lastError?.message);
  return { key: definition.key, label: definition.label, tone: definition.tone, status: 'error', events: [], capturedAt: new Date().toISOString(), error: lastError?.message };
}
async function fetchPankouChanges() {
  const categories = await mapLimit(PANKOU_TYPES, PANKOU_CONCURRENCY, fetchPankouCategory);
  const hasReady = categories.some(category => category.status === 'ready');
  const hasStale = categories.some(category => category.status === 'stale');
  return { status: hasReady ? 'ready' : hasStale ? 'stale' : 'error', categories, capturedAt: categories.map(category => category.capturedAt).filter(Boolean).sort().pop() || new Date().toISOString(), source: '东方财富公开盘口异动' };
}

// ── E 块 · 行业板块强弱（东财 push2delay，f62=主力净流入） ──
async function fetchSectors(order = 'desc') {
  try {
    const d = await emJson(`https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=5&po=${order === 'asc' ? 0 : 1}&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:2&fields=f12,f14,f3,f62`);
    const rows = d?.data?.diff || [];
    return rows.map(r => ({ name: String(r.f14 || ''), changePct: Number(r.f3) || 0, inflowYi: Math.round((Number(r.f62) || 0) / 1e8 * 100) / 100 })).filter(r => r.name && (order !== 'asc' || r.changePct < 0));
  } catch (error) { console.error('[复盘] 行业板块失败：', error.message); return []; }
}

// ── E+ 块 · 概念板块强弱（东财 push2delay，过滤策略/市场分类） ──
const NON_THEME_CONCEPT = /^(昨日|历史新高|近期新高|.*破净股|红利|大盘价值|融资融券|MSCI|富时罗素|标普|纳入|沪股通|深股通|转债|基金重仓|机构重仓|QFII重仓|社保重仓|养老金|证金持股).*|风格$/;
async function fetchConcepts(order = 'desc') {
  try {
    const d = await emJson(`https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=20&po=${order === 'asc' ? 0 : 1}&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:3&fields=f12,f14,f3,f62`);
    const rows = d?.data?.diff || [];
    return rows.map(r => ({
      name: String(r.f14 || '').trim(),
      changePct: Number(r.f3),
      inflowYi: Number.isFinite(Number(r.f62)) ? Math.round(Number(r.f62) / 1e8 * 100) / 100 : null,
    })).filter(r => r.name && Number.isFinite(r.changePct) && !NON_THEME_CONCEPT.test(r.name) && (order !== 'asc' || r.changePct < 0)).slice(0, 5);
  } catch (error) { console.error('[实时] 概念板块失败：', error.message); return []; }
}

// ── D 块 · 板块主力资金净流入 Top 5（东财 push2delay，fid=f62） ──
async function fetchSectorFundFlow() {
  try {
    const d = await emJson('https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=5&po=1&np=1&fltt=2&invt=2&fid=f62&fs=m:90+t:2&fields=f12,f14,f3,f62');
    const rows = d?.data?.diff || [];
    return rows.map(r => ({ name: String(r.f14 || ''), changePct: Number(r.f3) || 0, inflowYi: Math.round((Number(r.f62) || 0) / 1e8 * 100) / 100 })).filter(r => r.name && r.inflowYi > 0);
  } catch (error) { console.error('[复盘] 板块资金流失败：', error.message); return []; }
}

async function fetchSectorOutflow() {
  try {
    const d = await emJson('https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=5&po=0&np=1&fltt=2&invt=2&fid=f62&fs=m:90+t:2&fields=f12,f14,f3,f62');
    const rows = d?.data?.diff || [];
    return rows.map(r => ({ name: String(r.f14 || ''), changePct: Number(r.f3) || 0, inflowYi: Math.round((Number(r.f62) || 0) / 1e8 * 100) / 100 })).filter(r => r.name && r.inflowYi < 0);
  } catch (error) { console.error('[复盘] 板块资金流出失败：', error.message); return []; }
}

// ── H 块 · 今日要闻（东财快讯，JSONP 需去前缀） ────
async function fetchNews(date) {
  try {
    const response = await fetch('https://newsapi.eastmoney.com/kuaixun/v1/getlist_102_ajaxResult_50_1_.html', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Referer: 'https://kuaixun.eastmoney.com/' },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const json = JSON.parse(text.replace(/^var\s+\w+\s*=\s*/, '').replace(/;\s*$/, ''));
    const list = json?.LivesList || [];
    return list
      .filter(n => n.showtime && n.showtime.slice(0, 10) === date)
      .map(n => ({ time: String(n.showtime).slice(11, 16), title: String(n.title || '').trim(), digest: String(n.digest || '').trim() }))
      .filter(n => n.title)
      .slice(0, 8);
  } catch (error) { console.error('[复盘] 今日要闻失败：', error.message); return []; }
}

// ── G 块 · 港股/美股（腾讯） ────────────────────
async function fetchGlobalIndices() {
  const syms = ['hkHSI', 'hkHSTECH', 'usIXIC', 'usINX', 'usDJI'];
  try {
    const quotes = await fetchTencentQuotes(syms);
    return syms.map(s => { const q = quotes[s]; return q && q.latest > 0 ? { name: TX_SYMBOLS[s], close: q.latest, change: Math.round((q.latest - q.prevClose) * 100) / 100, changePct: Math.round((q.latest - q.prevClose) / q.prevClose * 10000) / 100 } : null; }).filter(Boolean);
  } catch (error) { console.error('[复盘] 港美股失败：', error.message); return []; }
}

// ── B 块 · 涨停/跌停/炸板池（连板梯队与风险异动） ─────
async function fetchTopicPool(kind, dateYYYYMMDD) {
  const endpoint = { limitUp: 'getTopicZTPool', limitDown: 'getTopicDTPool', broken: 'getTopicZBPool' }[kind];
  if (!endpoint) throw new Error(`未知池类型：${kind}`);
  const d = await emJson(`https://push2ex.eastmoney.com/${endpoint}?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=100&sort=fbt%3Aasc&date=${dateYYYYMMDD}`);
  const pool = d?.data?.pool || [];
  const stocks = pool.map(p => ({ code: p.c, name: p.n, changePct: Number(p.zdp), streak: Number(p.lbc || p.zttj?.ct || 0), sector: p.hybk || '', brokenCount: Number(p.zbc || 0) }));
  return { count: Number(d?.data?.tc ?? pool.length), stocks };
}
async function fetchLimitUpPool(dateYYYYMMDD) { return fetchTopicPool('limitUp', dateYYYYMMDD); }
async function fetchLimitDownPool(dateYYYYMMDD) { return fetchTopicPool('limitDown', dateYYYYMMDD); }
async function fetchBrokenBoardPool(dateYYYYMMDD) { return fetchTopicPool('broken', dateYYYYMMDD); }

// ── F 块 · 龙虎榜（个股汇总 + 买卖席位明细） ──────
async function fetchDragonTigerReport(reportName, date) {
  const filter = encodeURIComponent(`(TRADE_DATE>='${date}')(TRADE_DATE<='${date}')`);
  const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=${reportName}&columns=ALL&filter=${filter}&pageNumber=1&pageSize=500&source=WEB&client=WEB`;
  const d = await emJson(url);
  return Array.isArray(d?.result?.data) ? d.result.data : [];
}
function dragonSeatType(name) {
  if (name === '机构专用') return '机构专用';
  if (/^(沪股通|深股通)专用$/.test(name)) return '互联互通专用席位';
  return '证券营业部';
}
function mapDragonSeat(row) {
  const name = String(row.OPERATEDEPT_NAME || '').trim() || '营业部名称未披露';
  const toYi = value => Math.round((Number(value) || 0) / 1e8 * 10000) / 10000;
  return { name, type: dragonSeatType(name), buyYi: toYi(row.BUY), sellYi: toYi(row.SELL), netYi: toYi(row.NET) };
}
async function fetchDragonTiger(date) {
  const summaryRows = await fetchDragonTigerReport('RPT_BILLBOARD_DAILYDETAILS', date);
  await sleep(REQUEST_GAP_MS);
  const buyerRows = await fetchDragonTigerReport('RPT_BILLBOARD_DAILYDETAILSBUY', date);
  await sleep(REQUEST_GAP_MS);
  const sellerRows = await fetchDragonTigerReport('RPT_BILLBOARD_DAILYDETAILSSELL', date);
  const keyOf = row => `${String(row.SECURITY_CODE || '')}|${String(row.TRADE_ID || '')}`;
  const groupSeats = rows => rows.reduce((groups, row) => {
    const key = keyOf(row); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(mapDragonSeat(row)); return groups;
  }, new Map());
  const buyersByTrade = groupSeats(buyerRows);
  const sellersByTrade = groupSeats(sellerRows);
  const toYi = value => Math.round((Number(value) || 0) / 1e8 * 10000) / 10000;
  return summaryRows.map(row => {
    const key = keyOf(row);
    return {
      tradeId: String(row.TRADE_ID || ''), name: String(row.SECURITY_NAME_ABBR || ''), code: String(row.SECURITY_CODE || ''),
      changePct: Number(row.CHANGE_RATE), netBuy: toYi(row.TOTAL_NET), buy: toYi(row.TOTAL_BUY), sell: toYi(row.TOTAL_SELL),
      reason: String(row.EXPLANATION || ''),
      buyers: (buyersByTrade.get(key) || []).sort((a, b) => b.buyYi - a.buyYi).slice(0, 5),
      sellers: (sellersByTrade.get(key) || []).sort((a, b) => b.sellYi - a.sellYi).slice(0, 5),
    };
  }).filter(row => row.name && row.code).sort((a, b) => b.netBuy - a.netBuy);
}

// ── C 块 · 技术指标（东财 push2his 日K 计算） ───
async function fetchDailyKline(symbol, date, lmt = 60) {
  const start = addDays(date, -120); // 提前 ~120 天，保证够 40+ 根日K
  const response = await fetch(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,${start},${date},${lmt},qfq`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) });
  const d = await response.json();
  const node = d?.data?.[symbol];
  const arr = node?.qfqday || node?.day || [];
  return arr.filter(k => k[0] <= date).map(k => ({ date: k[0], open: Number(k[1]), close: Number(k[2]), high: Number(k[3]), low: Number(k[4]), volume: Number(k[5]) || 0 }));
}
function addDays(iso, days) {
  const d = new Date(iso + 'T00:00:00+08:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function ema(values, n) { const k = 2 / (n + 1); let out = [values[0]]; for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[i - 1] * (1 - k)); return out; }
function rsi(closes, period = 6) {
  let gain = 0, loss = 0;
  for (let i = 1; i <= period && i < closes.length; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) gain += d; else loss -= d; }
  if (loss === 0) return 100;
  const rs = (gain / period) / (loss / period);
  return 100 - 100 / (1 + rs);
}
function macd(closes) {
  const e12 = ema(closes, 12), e26 = ema(closes, 26);
  const dif = closes.map((_, i) => e12[i] - e26[i]);
  const dea = ema(dif, 9);
  const hist = dif.map((v, i) => 2 * (v - dea[i]));
  return { dif: dif[dif.length - 1], dea: dea[dea.length - 1], hist: hist[hist.length - 1], histPrev: hist[hist.length - 2] };
}
function kdj(kl) {
  const n = kl.length; const k = kl.slice(n - 9);
  const high9 = Math.max(...k.map(x => x.high)), low9 = Math.min(...k.map(x => x.low));
  const c = kl[n - 1].close;
  const rsv = high9 === low9 ? 50 : (c - low9) / (high9 - low9) * 100;
  const K = rsv * 1 / 3 + 50 * 2 / 3, D = K * 1 / 3 + 50 * 2 / 3, J = 3 * K - 2 * D;
  return { K, D, J };
}
function technicalScore(kl) {
  if (kl.length < 30) return null;
  const closes = kl.map(x => x.close);
  const m = macd(closes), r = rsi(closes, 6), k = kdj(kl);
  let score = 0;
  // MACD 10
  if (m.dif > m.dea && m.hist > m.histPrev) score += 10; else if (m.dif > m.dea) score += 7; else if (m.hist < m.histPrev) score += 0; else score += 3;
  // RSI6 10
  if (r > 80) score += 10; else if (r > 65) score += 8; else if (r > 50) score += 6; else if (r > 35) score += 4; else if (r > 20) score += 2;
  // KDJ 5
  if (k.K > k.D && k.J > 80) score += 5; else if (k.K > k.D) score += 3;
  return { score, macd: m.dif > m.dea ? '多头' : '空头', rsi6: Math.round(r), kdj: `${k.K > k.D ? 'K>D' : 'K≤D'} J=${Math.round(k.J)}` };
}
async function fetchTechnicalSentiment(date) {
  const targets = [['sh000001', '上证指数'], ['sz399006', '创业板指']];
  const out = { scores: [], detail: [] };
  for (const [symbol, name] of targets) {
    try {
      const kl = await fetchDailyKline(symbol, date);
      const ts = technicalScore(kl);
      if (ts) { out.scores.push(ts.score); out.detail.push(`${name} ${ts.macd} RSI${ts.rsi6} ${ts.kdj}（${ts.score}/25）`); }
    } catch (error) { console.error(`[复盘] 技术面 ${symbol} 失败：`, error.message); }
    await sleep(300);
  }
  return out;
}

// ── 温度（量价 50 + 技术面 50） ─────────────────
function computeTemperature(indices, limitUpCount, tech = null) {
  let vp = 0; // 量价 0-50
  const ups = indices.filter(i => i.changePct > 0).length;
  vp += indices.length ? (ups / indices.length) * 20 : 10;              // 上涨占比 20
  vp += limitUpCount > 0 ? Math.min(15, 5 + limitUpCount / 10) : 0;      // 涨停情绪 15
  const totalAmount = indices.reduce((s, i) => s + (i.amountYi || 0), 0);
  vp += totalAmount > 0 ? Math.min(15, 5 + totalAmount / 3000) : 0;      // 成交额分 15
  const techTotal = tech?.scores?.length ? tech.scores.reduce((a, b) => a + b, 0) : null;
  const score = Math.round(vp + (techTotal ?? 0));
  return { score, vp: Math.round(vp), tech: techTotal, level: score >= 80 ? '过热 🔥' : score >= 60 ? '偏暖 🌤️' : score >= 40 ? '中性 ☁️' : score >= 20 ? '偏冷 🌧️' : '冰冻 ❄️' };
}

// ── 报告生成 ─────────────────────────────────────
function truncate(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }
function buildMarkdown(date, data) {
  const { indices, limitUp, sectors, fundFlow, tech, temperature, news, slotLabel = '收盘复盘' } = data;
  const sectorRows = (sectors || []).map((s, i) => `| ${i + 1} | **${s.name}** | ${s.changePct >= 0 ? '+' : ''}${s.changePct.toFixed(2)}% | ${s.inflowYi >= 0 ? '+' : ''}${s.inflowYi.toFixed(2)} |`).join('\n');
  const flowRows = (fundFlow || []).map((s, i) => `| ${i + 1} | **${s.name}** | ${s.changePct >= 0 ? '+' : ''}${s.changePct.toFixed(2)}% | ${s.inflowYi >= 0 ? '+' : ''}${s.inflowYi.toFixed(2)} |`).join('\n');
  const rows = indices.map(i =>
    `| ${i.name} | ${i.close.toFixed(2)} | ${i.change >= 0 ? '+' : ''}${i.change.toFixed(2)} | ${i.changePct >= 0 ? '+' : ''}${i.changePct.toFixed(2)}% | ${i.amountYi != null ? i.amountYi.toFixed(0) : '-'} | ${i.pe != null ? i.pe.toFixed(1) : '-'} |`
  ).join('\n');
  const topUp = indices.filter(i => i.changePct > 0).sort((a, b) => b.changePct - a.changePct).slice(0, 3).map(i => `${i.name} ${i.changePct.toFixed(2)}%`).join('、');
  const ladder = limitUp.stocks.slice(0, 10).map(s => `| ${s.streak} 连板 | ${s.name} | ${s.sector} |`).join('\n');
  const newsRows = (news || []).map(n => `- **${n.time}** ${n.title}${n.digest ? `　— ${truncate(n.digest, 60)}` : ''}`).join('\n');
  const techLine = (tech && tech.detail && tech.detail.length) ? tech.detail.join('；') : '数据暂缺';
  const inflowTop = (fundFlow && fundFlow[0]) ? `${fundFlow[0].name}（主力净流入 ${fundFlow[0].inflowYi.toFixed(2)} 亿）` : '—';
  const topNews = (news && news[0]) ? `最新条目为「${news[0].title}」` : '当日快讯数据暂缺';

  return `# 📈 ${date} A 股每日行情复盘

> 抓取时段：${slotLabel} | 生成时间：${new Date().toISOString().slice(0, 16).replace('T', ' ')} | 数据来源：东方财富公开接口

---

## 一、市场温度 🌡️

| 指标 | 数值 | 说明 |
|------|------|------|
| **市场温度评分** | **${temperature.score} / 100** | 量价 ${temperature.vp} + 技术面 ${temperature.tech ?? '暂缺'} |
| 温度等级 | ${temperature.level} | |

### 评分细则
- 量价情绪分：${temperature.vp}/50（指数上涨占比 + 涨停家数 + 成交额）
- 技术面情绪分：${temperature.tech ?? '数据暂缺'}/50（${techLine}）

---

## 二、A 股大盘概览

| 指数 | 收盘 | 涨跌 | 涨跌幅 | 成交额(亿) | PE-TTM |
|------|------|------|--------|-----------|--------|
${rows}

### 关键解读
- 今日 ${upsLabel(indices)}，领涨 ${topUp || '—'}。

---

## 三、强势板块与资金流 🔥

### 今日领涨板块 Top 5

| 排名 | 板块名称 | 涨跌幅 | 主力净流入(亿) |
|------|----------|--------|---------------|
${sectorRows || '| - | - | - | - |'}

### 板块主力资金净流入 Top 5

| 排名 | 板块名称 | 涨跌幅 | 主力净流入(亿) |
|------|----------|--------|---------------|
${flowRows || '| - | - | - | - |'}

### 涨停与连板梯队

- 涨停家数：${limitUp.count} 家

| 连板 | 个股 | 板块 |
| --- | --- | --- |
${ladder || '| - | - | - |'}

---

## 四、今日要闻 📰

${newsRows || '- 暂无今日要闻'}

---

## 五、数据核对

- **指数**：${upsLabel(indices)}${topUp ? `；涨幅居前 ${topUp}` : ''}。
- **资金**：主力资金净流入首位为 ${inflowTop}。
- **技术面**：${techLine}。
- **消息面**：${topNews}。
- 以上内容由固定规则计算和排序，不包含走势预测。

---

*本报告由行情日报平台自动生成（东方财富公开数据），仅供参考，不构成投资建议。*`;
}
function upsLabel(indices) {
  const up = indices.filter(i => i.changePct > 0).length;
  const down = indices.filter(i => i.changePct < 0).length;
  return up > down ? '主要指数多数收涨' : '主要指数多数收跌';
}

// ── 主入口：抓数据 → 生成 Markdown ─────────────
async function runDailyReview(date, context = {}) {
  const dateCompact = date.replace(/-/g, '');
  const [indices, limitUp, sectors, fundFlow, tech, news] = await Promise.all([
    fetchMarketIndices(),
    fetchLimitUpPool(dateCompact),
    fetchSectors(),
    fetchSectorFundFlow(),
    fetchTechnicalSentiment(date),
    fetchNews(date),
  ]);
  const temperature = computeTemperature(indices, limitUp.count, tech);
  const slotLabel = context.slotLabel || (context.slot === 'midday' ? '午间快照' : '收盘复盘');
  const markdown = buildMarkdown(date, { indices, limitUp, sectors, fundFlow, tech, temperature, news, slotLabel });
  return { markdown, reviewSlot: context.slot || 'close', slotLabel, indices: indices.length, limitUpCount: limitUp.count, sectors: sectors.length, fundFlow: fundFlow.length, tech: tech.scores, temperature: temperature.score, news: news.length };
}

// ── I 块 · 自选股（默认列表，可在此调整） ────────
const WATCHLIST = '600519,300750,601318,600036,000858,002594'; // 默认最多 6 只

// ── 个股（自选股） ─────────────────────────────
function toTxSymbol(code) {
  const c = String(code || '').trim().toLowerCase().replace(/\..+$/, '');
  if (!/^\d{6}$/.test(c)) return '';
  if (/^(6|68|9)/.test(c)) return 'sh' + c;
  return 'sz' + c;
}
async function fetchStockQuotes(codes) {
  const syms = String(codes).split(',').map(s => toTxSymbol(s)).filter(Boolean);
  if (!syms.length) return [];
  const quotes = await fetchTencentQuotes(syms);
  return syms.map(s => {
    const q = quotes[s];
    return q && q.latest > 0 ? { symbol: s, name: q.name.replace(/\s+/g, ''), code: s.slice(2), latest: q.latest, prevClose: q.prevClose, open: q.open, high: q.high, low: q.low, volume: q.volume, change: Math.round((q.latest - q.prevClose) * 100) / 100, changePct: Math.round((q.latest - q.prevClose) / q.prevClose * 10000) / 100, quoteAt: q.quoteAt, capturedAt: q.capturedAt } : null;
  }).filter(Boolean);
}

module.exports = { runDailyReview, fetchMarketIndices, fetchMarketBreadth, fetchPankouChanges, fetchIndexFutures, fetchLimitUpPool, fetchLimitDownPool, fetchBrokenBoardPool, fetchDragonTiger, fetchGlobalIndices, fetchSectors, fetchConcepts, fetchSectorFundFlow, fetchSectorOutflow, fetchNews, fetchTechnicalSentiment, fetchTencentQuotes, fetchDailyKline, fetchStockQuotes, toTxSymbol, computeTemperature, WATCHLIST };
