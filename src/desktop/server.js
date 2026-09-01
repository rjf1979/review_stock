// 行情日报 Desktop · 本地后端（取数 + 静态前端）
// 数据在用户本地直连腾讯/东财公开接口，不经过任何服务器中转
const http = require('http');
const fs = require('fs');
const path = require('path');
const review = require('./review-core');
const { createStorage, DEFAULT_CLOUD_URL, BUILTIN_CLOUD_TOKEN } = require('./storage');
const cloudUpload = require('./cloud-upload');

const PORT = 3100;
const FRONTEND = path.join(__dirname, 'frontend');
const CLOUD_THROTTLE_MS = 60 * 1000;
const PANKOU_WAIT_CAP_MS = 6000; // 盘口单次最长等待，超出即回退最近一次数据，避免拖慢实时聚合

function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}
function latestTradingISO() {
  const date = new Date(`${todayISO()}T00:00:00Z`);
  const weekday = date.getUTCDay();
  if (weekday === 6) date.setUTCDate(date.getUTCDate() - 1);
  if (weekday === 0) date.setUTCDate(date.getUTCDate() - 2);
  return date.toISOString().slice(0, 10);
}
function resolveDashboardDate(requestedDate, currentDate = todayISO(), latestDate = latestTradingISO()) {
  return !requestedDate || requestedDate === currentDate ? latestDate : requestedDate;
}
function todayCompact() { return latestTradingISO().replace(/-/g, ''); }
function shanghaiParts(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(value);
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
}
function getMarketSession(value = new Date()) {
  const p = shanghaiParts(value);
  const date = `${p.year}-${p.month}-${p.day}`;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const minutes = Number(p.hour) * 60 + Number(p.minute) + Number(p.second) / 60;
  const weekdayOpen = weekday >= 1 && weekday <= 5;
  const isTrading = weekdayOpen && ((minutes >= 570 && minutes < 690) || (minutes >= 780 && minutes < 900));
  let state = 'closed';
  let label = '今日已闭市';
  if (!weekdayOpen) { state = 'weekend'; label = '周末休市'; }
  else if (minutes < 570) { state = 'preopen'; label = '尚未开市'; }
  else if (minutes < 690) { state = 'morning'; label = '上午交易中'; }
  else if (minutes < 780) { state = 'lunch'; label = '午间休市'; }
  else if (minutes < 900) { state = 'afternoon'; label = '下午交易中'; }
  return { date, state, isTrading, mode: isTrading ? 'realtime' : 'last-trade', label, tradingHours: '09:30-11:30、13:00-15:00', timezone: 'Asia/Shanghai' };
}
function shanghaiDate(value) {
  if (!value) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(value));
}
function latestSourceAt(indices = []) {
  return indices.map(item => item.quoteAt || item.capturedAt).filter(Boolean).sort().pop() || null;
}
function snapshotTradeDate(snapshot) {
  if (!snapshot) return null;
  return snapshot.dataMeta?.aShare?.sourceDate
    || shanghaiDate(latestSourceAt(snapshot.indices))
    || snapshot.asOfDate
    || null;
}
function expectedSnapshotDate(session) {
  if (session.state === 'preopen') return previousWeekdayISO(session.date);
  if (session.state === 'weekend') {
    let date = session.date;
    while ([0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay())) date = previousWeekdayISO(date);
    return date;
  }
  return session.date;
}
function canReuseClosedSnapshot(snapshot, session = getMarketSession()) {
  return Boolean(snapshot && snapshotTradeDate(snapshot) === expectedSnapshotDate(session));
}
function stockQuoteCacheKey(codes, session = getMarketSession()) {
  return `stocks:${expectedSnapshotDate(session)}:${codes}`;
}
function klineCacheTtl(date, session = getMarketSession()) {
  if (date !== expectedSnapshotDate(session)) return Number.POSITIVE_INFINITY;
  return session.isTrading ? 60 * 1000 : 5 * 60 * 1000;
}

const MONITOR_INDEX_NAMES = ['上证指数', '深证成指', '创业板指'];
const MONITOR_LIMIT = 5;

function normalizeMonitorCodes(value) {
  return [...new Set(String(value || '').split(',').map(code => code.trim()).filter(code => /^\d{6}$/.test(code)))].slice(0, MONITOR_LIMIT);
}

function finiteQuoteValue(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildMonitorPayload(indices = [], stocks = [], codes = [], session = getMarketSession()) {
  const requested = normalizeMonitorCodes(Array.isArray(codes) ? codes.join(',') : codes);
  const stockByCode = new Map((stocks || []).map(stock => [String(stock?.code), stock]));
  return {
    session,
    updatedAt: new Date().toISOString(),
    indices: MONITOR_INDEX_NAMES
      .map(name => (indices || []).find(item => item?.name === name))
      .filter(Boolean)
      .map(index => ({
        name: index.name,
        close: finiteQuoteValue(index.close),
        changePct: finiteQuoteValue(index.changePct),
        quoteAt: index.quoteAt || index.capturedAt || null,
      })),
    stocks: requested.map(code => {
      const stock = stockByCode.get(code) || {};
      return {
        code,
        name: stock.name || code,
        latest: finiteQuoteValue(stock.latest),
        changePct: finiteQuoteValue(stock.changePct),
        quoteAt: stock.quoteAt || stock.capturedAt || null,
      };
    }),
  };
}
function buildDataMeta(session, indices, indexFutures, breadth, pankou = null) {
  const indexSourceAt = latestSourceAt(indices);
  const indexSourceDate = shanghaiDate(indexSourceAt);
  const aShareMode = session.isTrading && (!indexSourceDate || indexSourceDate === session.date) ? 'realtime' : 'last-trade';
  const aShareLabel = aShareMode === 'realtime' ? '盘中实时刷新' : '最近交易数据';
  const aShareDate = indexSourceDate || latestTradingISO();
  const make = (sourceAt, sourceDate = aShareDate, mode = aShareMode) => ({
    mode,
    label: mode === 'realtime' ? '盘中实时刷新' : '最近交易数据',
    sourceAt: sourceAt || null,
    sourceDate: sourceDate || null,
    tradingHours: session.tradingHours,
  });
  return {
    market: { ...session, mode: aShareMode, label: `${session.label} · ${aShareLabel}` },
    aShare: make(indexSourceAt, aShareDate, aShareMode),
    breadth: make(breadth?.capturedAt || indexSourceAt),
    sectors: make(indexSourceAt),
    concepts: make(indexSourceAt),
    events: make(indexSourceAt),
    pankou: make(pankou?.capturedAt || indexSourceAt),
    indexFutures: make(indexFutures?.capturedAt, indexFutures?.asOfDate || aShareDate, session.isTrading ? 'realtime' : 'last-trade'),
  };
}
function decorateCachedSnapshot(cached) {
  if (!cached) return null;
  const session = getMarketSession();
  const base = buildDataMeta(session, cached.indices, cached.indexFutures, cached.breadth, cached.pankou);
  const dataMeta = Object.fromEntries(Object.entries(base).map(([key, value]) => [key, { ...value, mode: 'last-trade', label: '缓存的最近数据' }]));
  dataMeta.market = { ...dataMeta.market, label: `${session.label} · 缓存的最近数据` };
  return { ...cached, marketSession: session, dataMeta, fromCache: true };
}
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}
function fail(res, error) { json(res, 500, { error: String(error?.message || '服务错误') }); }
function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1024 * 1024) reject(new Error('请求内容过大'));
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('JSON 格式不正确')); }
    });
    req.on('error', reject);
  });
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00+08:00`));
}

function previousWeekdayISO(date) {
  const value = new Date(`${date}T00:00:00+08:00`);
  do { value.setDate(value.getDate() - 1); } while ([0, 6].includes(value.getDay()));
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(value);
}

function reviewReportMode(date, currentDate) {
  if (date !== currentDate) return 'historical';
  const parts = shanghaiParts();
  const weekday = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`).getUTCDay();
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return weekday === 0 || weekday === 6 || minutes >= 15 * 60 + 10 ? 'close' : 'intraday';
}

function buildHeightDistribution(stocks) {
  const groups = new Map();
  for (const stock of stocks || []) {
    const height = Number(stock.streak) || 1;
    if (!groups.has(height)) groups.set(height, []);
    groups.get(height).push(stock.name);
  }
  return [...groups.entries()].sort((a, b) => b[0] - a[0]).map(([boardHeight, leaders]) => ({ boardHeight, count: leaders.length, leaders }));
}

function computeContractTemperature({ breadth, limitUpCount, brokenCount, maxBoardHeight, promotionRate }) {
  if (breadth?.status !== 'ready') return null;
  const redRate = Number(breadth.redRatio) / 100;
  const sealRate = limitUpCount + brokenCount > 0 ? limitUpCount / (limitUpCount + brokenCount) : null;
  const components = {
    breadth: Math.min(redRate / 0.8, 1) * 25,
    limitUp: Math.min(limitUpCount / 120, 1) * 20,
    seal: sealRate == null ? 0 : Math.min(sealRate / 0.85, 1) * 15,
    height: Math.min(maxBoardHeight / 8, 1) * 15,
    promotion: promotionRate == null ? 0 : Math.min(promotionRate / 0.65, 1) * 10,
    mainline: 0,
    riskDeduction: 0,
  };
  const score = Math.round(Math.max(0, Math.min(100, components.breadth + components.limitUp + components.seal + components.height + components.promotion + components.mainline - components.riskDeduction)));
  const level = score <= 20 ? '冰点' : score <= 40 ? '低迷' : score <= 60 ? '修复' : score <= 75 ? '活跃' : score <= 85 ? '高温' : '过热';
  return { score, level, zone: level, components };
}

async function buildReviewData(date, breadth = null, currentDate = latestTradingISO()) {
  const dateCompact = date.replace(/-/g, '');
  const isCurrent = date === currentDate;
  const previousDate = previousWeekdayISO(date);
  const [indices, limitUp, limitDown, broken, previousLimitUp, sectors, fundFlow, tech, news] = await Promise.all([
    isCurrent ? review.fetchMarketIndices() : [],
    review.fetchLimitUpPool(dateCompact),
    review.fetchLimitDownPool(dateCompact),
    review.fetchBrokenBoardPool(dateCompact),
    review.fetchLimitUpPool(previousDate.replace(/-/g, '')).catch(() => ({ count: 0, stocks: [] })),
    isCurrent ? review.fetchSectors() : [],
    isCurrent ? review.fetchSectorFundFlow() : [],
    review.fetchTechnicalSentiment(date),
    review.fetchNews(date),
  ]);
  const currentCodes = new Set(limitUp.stocks.map(stock => stock.code));
  const tradedCodes = new Set(breadth?.tradedCodes || []);
  const promotionBase = previousLimitUp.stocks.filter(stock => tradedCodes.has(stock.code));
  const promotionSuccessCount = promotionBase.filter(stock => currentCodes.has(stock.code)).length;
  const promotionRate = promotionBase.length ? promotionSuccessCount / promotionBase.length : null;
  const heightDistribution = buildHeightDistribution(limitUp.stocks);
  const maxBoardHeight = heightDistribution[0]?.boardHeight || 0;
  const sealRate = limitUp.count + broken.count > 0 ? limitUp.count / (limitUp.count + broken.count) : null;
  const enrichedBreadth = breadth ? { ...breadth, limitUp: limitUp.count, limitDown: limitDown.count, broken: broken.count, sealRate: sealRate == null ? null : sealRate * 100, promotionRate: promotionRate == null ? null : promotionRate * 100 } : null;
  const missingFields = [];
  if (!enrichedBreadth || enrichedBreadth.status !== 'ready') missingFields.push('breadth');
  if (enrichedBreadth?.previousTurnoverYi == null) missingFields.push('breadth.previous_turnover_yuan', 'breadth.turnover_change_rate');
  if (promotionRate == null) missingFields.push('sentiment.promotion_rate');
  if (!isCurrent) missingFields.push('indices', 'industries', 'mainlines');
  const warnings = [];
  if (enrichedBreadth?.sampleCount && enrichedBreadth.sampleCount < 5000) warnings.push(`有效交易样本 ${enrichedBreadth.sampleCount} 只，低于约 5000 只的完整市场目标`);
  if (!isCurrent) warnings.push('历史日期仅使用带日期的池数据；未持久化的指数、广度、行业和资金数据不以当前快照替代');
  const temperature = computeContractTemperature({ breadth: enrichedBreadth, limitUpCount: limitUp.count, brokenCount: broken.count, maxBoardHeight, promotionRate });
  const generatedAt = new Date().toISOString();
  const asOf = [enrichedBreadth?.capturedAt, ...indices.map(index => index.quoteAt || index.capturedAt)].filter(Boolean).sort().pop() || generatedAt;
  return {
    date,
    meta: { requested_date: date, trade_date: date, as_of: asOf, report_mode: reviewReportMode(date, currentDate), currency: 'CNY' },
    indices,
    limitUpCount: limitUp.count,
    limitUpStocks: [...limitUp.stocks].sort((a, b) => (b.streak || 0) - (a.streak || 0) || (b.changePct || 0) - (a.changePct || 0)).slice(0, 20),
    limitDownCount: limitDown.count,
    limitDownStocks: limitDown.stocks.slice(0, 10),
    brokenCount: broken.count,
    brokenStocks: broken.stocks.slice(0, 10),
    breadth: enrichedBreadth,
    sentiment: { limitUpCount: limitUp.count, limitDownCount: limitDown.count, brokenLimitCount: broken.count, sealRate, maxBoardHeight, promotionSuccessCount, promotionBaseCount: promotionBase.length || null, promotionRate },
    heightDistribution,
    sectors,
    fundFlow,
    news,
    techScore: tech.scores,
    techDetail: tech.detail,
    temperature,
    quality: { status: missingFields.length ? 'partial' : 'ok', confidence: missingFields.length ? 'medium' : 'high', missingFields, warnings, conflicts: [], fieldLineage: { indices: '腾讯财经', breadth: '东方财富全市场分页', sentiment: '东方财富涨停/跌停/炸板池', industries: '东方财富行业行情', fundFlow: '东方财富行业资金流' } },
    generatedAt,
  };
}

// 云端上传：读取设置 → 配置 cloud-upload → 异步推送。失败仅记录，不阻塞本地 UI。
function createCloudPush(storage) {
  const throttleMap = new Map();
  function configure() {
    const s = storage.getSettings();
    cloudUpload.setConfig({
      enabled: true, // 分享总开关恒真：采集方默认分享，不暴露用户开关
      url: s.cloud_url || DEFAULT_CLOUD_URL,
      token: s.cloud_token || BUILTIN_CLOUD_TOKEN,
      deviceId: s.cloud_device_id || '',
      deviceToken: s.cloud_device_token || '',
      onDevice: (d) => storage.setSettings({ cloud_device_id: d.deviceId, cloud_device_token: d.deviceToken }),
    });
    return cloudUpload.getConfig();
  }
  function throttled(key, minMs) {
    if (!key || !minMs) return false;
    const now = Date.now();
    const last = throttleMap.get(key) || 0;
    if (now - last < minMs) return true;
    throttleMap.set(key, now);
    return false;
  }
  function run(kind, data, opts = {}) {
    const cfg = configure();
    if (!cfg.enabled) return Promise.resolve({ skipped: true });
    if (!cfg.url) {
      console.warn('[云端上传] 未配置云端地址，跳过 ' + kind);
      return Promise.resolve({ skipped: true, reason: 'not_configured' });
    }
    if (throttled(opts.key, opts.minMs)) return Promise.resolve({ throttled: true });
    const fn = cloudUpload[kind];
    if (typeof fn !== 'function') return Promise.resolve({ skipped: true, reason: 'unknown' });
    return Promise.resolve()
      .then(() => fn(data))
      .then((result) => {
        console.log('[云端上传] ' + kind + ' 成功：' + JSON.stringify(result));
        return result;
      })
      .catch((error) => {
        console.warn('[云端上传] ' + kind + ' 失败：' + error.message);
        return { failed: true, error: error.message };
      });
  }
  return {
    realtime: (payload) => run('uploadRealtime', payload, { key: 'realtime', minMs: CLOUD_THROTTLE_MS }),
    review: (payload) => run('uploadReview', payload),
    dragon: (payload) => run('uploadDragon', payload),
    quotes: (payload) => run('uploadQuotes', payload, { key: 'quotes', minMs: CLOUD_THROTTLE_MS }),
    kline: (payload) => run('uploadKline', payload, { key: 'kline:' + (payload?.code || ''), minMs: CLOUD_THROTTLE_MS }),
    heartbeat: (payload) => run('heartbeat', payload),
    configure,
  };
}

function createHttpServer(storage) {
  let lastSnapshotAt = 0;
  let breadthSnapshot = null;
  let breadthJob = null;
  let latestRealtimePayload = null;
  const cloud = createCloudPush(storage);
  const responseCache = new Map();
  const cached = async (key, ttl, loader, force = false) => {
    const hit = responseCache.get(key);
    if (!force && hit?.promise) return hit.promise;
    if (!force && hit && Date.now() - hit.savedAt < ttl) return hit.value;
    const promise = Promise.resolve().then(loader).then(value => {
      responseCache.set(key, { savedAt: Date.now(), value });
      return value;
    }).catch(error => {
      if (responseCache.get(key)?.promise === promise) responseCache.delete(key);
      throw error;
    });
    responseCache.set(key, { savedAt: Date.now(), promise });
    return promise;
  };

  function startBreadthCollection() {
    if (breadthJob) return breadthJob;
    breadthJob = review.fetchMarketBreadth()
      .then(result => {
        breadthSnapshot = result;
        if (latestRealtimePayload) {
          latestRealtimePayload = { ...latestRealtimePayload, breadth: result, dataMeta: buildDataMeta(latestRealtimePayload.marketSession || getMarketSession(), latestRealtimePayload.indices, latestRealtimePayload.indexFutures, result, latestRealtimePayload.pankou) };
          storage.saveSnapshot(latestRealtimePayload);
        }
      })
      .catch(error => {
        console.error('[桌面端] 全市场广度采集失败：', error.message);
        breadthSnapshot = { status: 'error', quality: 'unavailable', error: error.message, capturedAt: new Date().toISOString() };
      })
      .finally(() => { breadthJob = null; });
    return breadthJob;
  }

  // 盘口异动独立取数：与主实时聚合并行，超时/失败时回退最近一次数据，避免阻塞指数/板块/资金
  async function loadPankou(marketSession, cachedSnapshot) {
    const key = `pankou:${expectedSnapshotDate(marketSession)}`;
    const ttl = marketSession.isTrading ? 8 * 1000 : 60 * 1000;
    const fallback = latestRealtimePayload?.pankou || cachedSnapshot?.pankou || null;
    try {
      return await Promise.race([
        cached(key, ttl, () => review.fetchPankouChanges()),
        new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('盘口响应等待超时'), { code: 'PANKOU_TIMEOUT' })), PANKOU_WAIT_CAP_MS)),
      ]);
    } catch (error) {
      if (error?.code === 'PANKOU_TIMEOUT') console.warn('[实时] 盘口数据等待超时，回退最近一次数据');
      return fallback || { status: 'error', categories: [], capturedAt: null, source: '东方财富公开盘口异动' };
    }
  }
  return http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname === '/api/settings' && req.method === 'GET') {
      return json(res, 200, { settings: storage.getSettings(), watchlist: storage.getWatchlist() });
    }
    if (url.pathname === '/api/settings' && req.method === 'POST') {
      const body = await readJson(req);
      storage.setSettings(body);
      return json(res, 200, { settings: storage.getSettings() });
    }
    if (url.pathname === '/api/watchlist' && req.method === 'POST') {
      const body = await readJson(req);
      return json(res, 200, { watchlist: storage.replaceWatchlist(body.watchlist) });
    }
    if (url.pathname === '/api/migrate/legacy' && req.method === 'POST') {
      const body = await readJson(req);
      return json(res, 200, { migrated: storage.importLegacyFrontend(body) });
    }
    if (url.pathname === '/api/realtime') {
      try {
        const cachedSnapshot = storage.getSnapshot();
        if (!breadthSnapshot && cachedSnapshot?.breadth) breadthSnapshot = cachedSnapshot.breadth;
        const marketSession = getMarketSession();
        const availableSnapshot = latestRealtimePayload || cachedSnapshot;
        if (!marketSession.isTrading && canReuseClosedSnapshot(availableSnapshot, marketSession)) {
          return json(res, 200, decorateCachedSnapshot(availableSnapshot));
        }
        const date = todayCompact();
        const [indices, indexFutures, limitUp, limitDown, broken, sectors, fallingSectors, concepts, fallingConcepts, fundFlow, outflow, pankou] = await Promise.all([
          cached(`indices:${expectedSnapshotDate(marketSession)}`, marketSession.isTrading ? 5 * 1000 : 60 * 1000, () => review.fetchMarketIndices()),
          review.fetchIndexFutures(latestTradingISO()),
          review.fetchLimitUpPool(date),
          review.fetchLimitDownPool(date),
          review.fetchBrokenBoardPool(date),
          review.fetchSectors('desc'),
          review.fetchSectors('asc'),
          review.fetchConcepts('desc'),
          review.fetchConcepts('asc'),
          review.fetchSectorFundFlow(),
          review.fetchSectorOutflow(),
          loadPankou(marketSession, cachedSnapshot),
        ]);
        if (!breadthSnapshot || breadthSnapshot.status !== 'ready' || Date.now() - Date.parse(breadthSnapshot.capturedAt || 0) > 60000) startBreadthCollection();
        const breadth = breadthSnapshot || { status: 'collecting', quality: 'pending', capturedAt: null };
        const payload = {
          indices,
          indexFutures,
          breadth: { ...breadth, limitUp: limitUp.count, limitDown: limitDown.count, broken: broken.count },
          limitUpCount: limitUp.count,
          limitUpStocks: [...limitUp.stocks].sort((a, b) => (b.streak || 0) - (a.streak || 0) || (b.changePct || 0) - (a.changePct || 0)).slice(0, 15),
          limitDownCount: limitDown.count,
          limitDownStocks: limitDown.stocks.slice(0, 8),
          brokenCount: broken.count,
          brokenStocks: broken.stocks.slice(0, 8),
          sectors,
          fallingSectors,
          concepts,
          fallingConcepts,
          fundFlow,
          outflow,
          pankou,
          marketSession,
          dataMeta: buildDataMeta(marketSession, indices, indexFutures, breadth, pankou),
          asOfDate: latestTradingISO(),
          updatedAt: new Date().toISOString(),
        };
        latestRealtimePayload = payload;
        if (Date.now() - lastSnapshotAt > 30000) { storage.saveSnapshot(payload); lastSnapshotAt = Date.now(); }
        if (marketSession.isTrading) cloud.realtime(payload);
        return json(res, 200, payload);
      } catch (error) {
        const cached = storage.getSnapshot();
        if (cached) return json(res, 200, decorateCachedSnapshot(cached));
        throw error;
      }
    }
    if (url.pathname === '/api/monitor') {
      const codes = normalizeMonitorCodes(url.searchParams.get('codes'));
      const marketSession = getMarketSession();
      const ttl = marketSession.isTrading ? 5 * 1000 : 60 * 1000;
      return json(res, 200, await cached(`monitor:${expectedSnapshotDate(marketSession)}:${codes.join(',')}`, ttl, async () => {
        const [indices, quoteResult] = await Promise.all([
          cached(`indices:${expectedSnapshotDate(marketSession)}`, ttl, () => review.fetchMarketIndices()),
          codes.length ? cached(stockQuoteCacheKey(codes.join(','), marketSession), ttl, () => review.fetchStockQuotes(codes.join(','))) : Promise.resolve([]),
        ]);
        const quotes = Array.isArray(quoteResult) ? quoteResult : quoteResult?.stocks || [];
        return buildMonitorPayload(indices, quotes, codes, marketSession);
      }));
    }
    if (url.pathname === '/api/review') {
      const date = resolveDashboardDate(url.searchParams.get('date'));
      const force = url.searchParams.get('refresh') === '1';
      if (!validDate(date)) return json(res, 400, { error: '日期格式不正确，应为 YYYY-MM-DD' });
      const currentDate = latestTradingISO();
      const persisted = storage.getReviewSnapshot(date);
      if (persisted && !force) return json(res, 200, persisted);
      if (date !== currentDate) {
        if (persisted) return json(res, 200, persisted);
        return json(res, 404, { error: '该日期没有已保存的完整复盘快照' });
      }
      const breadthIsStale = !breadthSnapshot?.capturedAt || Date.now() - Date.parse(breadthSnapshot.capturedAt) > 5 * 60 * 1000;
      if (date === currentDate && (breadthSnapshot?.status !== 'ready' || breadthIsStale)) await startBreadthCollection();
      const breadth = date === currentDate ? (breadthSnapshot || { status: 'collecting', quality: 'pending', capturedAt: null }) : null;
      const payload = await buildReviewData(date, breadth, currentDate);
      storage.saveReviewSnapshot(date, payload);
      cloud.review({ ...payload, markdown: storage.getReviewMarkdown(date) || '' });
      return json(res, 200, { ...payload, persisted: true, persistedAt: new Date().toISOString() });
    }
    if (url.pathname === '/api/reviews') return json(res, 200, { entries: storage.getHistoryEntries() });
    if (url.pathname === '/api/dragon') {
      const date = resolveDashboardDate(url.searchParams.get('date'));
      if (!validDate(date)) return json(res, 400, { error: '日期格式不正确，应为 YYYY-MM-DD' });
      const ttl = date === latestTradingISO() ? 10 * 60 * 1000 : Number.POSITIVE_INFINITY;
      const payload = await cached(`dragon:${date}`, ttl, async () => ({ date, list: await review.fetchDragonTiger(date) }));
      storage.saveDragonSnapshot(date, payload);
      cloud.dragon(payload);
      return json(res, 200, payload);
    }
    if (url.pathname === '/api/global') {
      return json(res, 200, { global: await review.fetchGlobalIndices() });
    }
    if (url.pathname === '/api/stocks') {
      const codes = url.searchParams.get('codes') || '';
      const marketSession = getMarketSession();
      const ttl = marketSession.isTrading ? 3000 : 15 * 60 * 1000;
      const payload = await cached(stockQuoteCacheKey(codes, marketSession), ttl, async () => ({ stocks: await review.fetchStockQuotes(codes) }));
      cloud.quotes(payload);
      return json(res, 200, payload);
    }
    if (url.pathname === '/api/kline') {
      const code = url.searchParams.get('code') || '';
      const marketSession = getMarketSession();
      const date = url.searchParams.get('date') || expectedSnapshotDate(marketSession);
      const symbol = review.toTxSymbol ? review.toTxSymbol(code) : '';
      if (!symbol) return json(res, 400, { error: '代码格式不正确' });
      const ttl = klineCacheTtl(date, marketSession);
      const payload = await cached(`kline:${code}:${date}`, ttl, async () => {
        const kline = await review.fetchDailyKline(symbol, date);
        const latestDate = kline.at(-1)?.date || null;
        return { code, tradeDate: date, latestDate, isFresh: latestDate === date, kline };
      });
      cloud.kline(payload);
      return json(res, 200, payload);
    }
    // 静态：前端
    const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const frontendRoot = path.resolve(FRONTEND);
    const file = path.resolve(frontendRoot, '.' + requested);
    if (file !== frontendRoot && !file.startsWith(frontendRoot + path.sep)) return json(res, 403, { error: 'Forbidden' });
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
      return res.end(fs.readFileSync(file));
    }
    return json(res, 404, { error: 'Not found' });
  } catch (error) { return fail(res, error); }
  });
}

async function startServer({ storage, port = PORT } = {}) {
  const activeStorage = storage || await createStorage({
    dbPath: path.join(__dirname, '.runtime', 'hangqing.sqlite'),
    legacyStatePath: path.join(__dirname, '.runtime', 'desktop-state.json'),
    legacyReviewsDir: path.join(__dirname, '.runtime', 'reviews'),
  });
  const server = createHttpServer(activeStorage);
  await new Promise(resolve => server.listen(port, resolve));
  // 云端心跳：默认分享，告知云端本机为最新采集源；失败仅记录不阻塞。
  const settings = activeStorage.getSettings();
  cloudUpload.setConfig({
    enabled: true,
    url: settings.cloud_url || DEFAULT_CLOUD_URL,
    token: settings.cloud_token || BUILTIN_CLOUD_TOKEN,
    deviceId: settings.cloud_device_id || '',
    deviceToken: settings.cloud_device_token || '',
  });
  try {
    await cloudUpload.heartbeat({ version: require('./package.json').version, fetchedAt: new Date().toISOString(), ok: true });
  } catch (error) {
    console.warn('[云端上传] 启动心跳失败：' + error.message);
  }
  console.log(`行情日报 Desktop 本地后端运行于 http://localhost:${port}`);
  return server;
}

if (require.main === module) startServer().catch(error => { console.error('[桌面端] 本地服务启动失败：', error); process.exitCode = 1; });

module.exports = { startServer, createCloudPush, snapshotTradeDate, expectedSnapshotDate, canReuseClosedSnapshot, stockQuoteCacheKey, klineCacheTtl, buildMonitorPayload, normalizeMonitorCodes, resolveDashboardDate };
