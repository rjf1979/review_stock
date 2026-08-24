// 行情日报 Desktop · 本地后端（取数 + 静态前端）
// 数据在用户本地直连腾讯/东财公开接口，不经过任何服务器中转
const http = require('http');
const fs = require('fs');
const path = require('path');
const review = require('./review-core');
const { createStorage } = require('./storage');

const PORT = 3100;
const FRONTEND = path.join(__dirname, 'frontend');

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

async function buildReviewData(date, breadth = null) {
  const dateCompact = date.replace(/-/g, '');
  const [indices, limitUp, limitDown, broken, global, sectors, fundFlow, tech, news] = await Promise.all([
    review.fetchMarketIndices(),
    review.fetchLimitUpPool(dateCompact),
    review.fetchLimitDownPool(dateCompact),
    review.fetchBrokenBoardPool(dateCompact),
    review.fetchGlobalIndices(),
    review.fetchSectors(),
    review.fetchSectorFundFlow(),
    review.fetchTechnicalSentiment(date),
    review.fetchNews(date),
  ]);
  const temperature = review.computeTemperature(indices, limitUp.count, tech);
  return {
    date,
    indices,
    limitUpCount: limitUp.count,
    limitUpStocks: [...limitUp.stocks].sort((a, b) => (b.streak || 0) - (a.streak || 0) || (b.changePct || 0) - (a.changePct || 0)).slice(0, 20),
    limitDownCount: limitDown.count,
    limitDownStocks: limitDown.stocks.slice(0, 10),
    brokenCount: broken.count,
    brokenStocks: broken.stocks.slice(0, 10),
    breadth,
    global,
    sectors,
    fundFlow,
    news,
    techScore: tech.scores,
    techDetail: tech.detail,
    temperature,
    generatedAt: new Date().toISOString(),
  };
}

function createHttpServer(storage) {
  let lastSnapshotAt = 0;
  let breadthSnapshot = null;
  let breadthJob = null;
  let latestRealtimePayload = null;

  function startBreadthCollection() {
    if (breadthJob) return;
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
        const cached = storage.getSnapshot();
        if (!breadthSnapshot && cached?.breadth) breadthSnapshot = cached.breadth;
        const marketSession = getMarketSession();
        if (!marketSession.isTrading && (latestRealtimePayload || cached)) {
          return json(res, 200, decorateCachedSnapshot(latestRealtimePayload || cached));
        }
        const date = todayCompact();
        const [indices, indexFutures, limitUp, limitDown, broken, sectors, fallingSectors, concepts, fallingConcepts, fundFlow, outflow, pankou] = await Promise.all([
          review.fetchMarketIndices(),
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
          review.fetchPankouChanges(),
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
        return json(res, 200, payload);
      } catch (error) {
        const cached = storage.getSnapshot();
        if (cached) return json(res, 200, decorateCachedSnapshot(cached));
        throw error;
      }
    }
    if (url.pathname === '/api/review') {
      const date = url.searchParams.get('date') || todayISO();
      if (!validDate(date)) return json(res, 400, { error: '日期格式不正确，应为 YYYY-MM-DD' });
      const currentDate = latestTradingISO();
      if (date === currentDate && (!breadthSnapshot || breadthSnapshot.status !== 'ready')) startBreadthCollection();
      const breadth = date === currentDate ? (breadthSnapshot || { status: 'collecting', quality: 'pending', capturedAt: null }) : null;
      return json(res, 200, await buildReviewData(date, breadth));
    }
    if (url.pathname === '/api/dragon') {
      const date = url.searchParams.get('date') || todayISO();
      if (!validDate(date)) return json(res, 400, { error: '日期格式不正确，应为 YYYY-MM-DD' });
      return json(res, 200, { date, list: await review.fetchDragonTiger(date) });
    }
    if (url.pathname === '/api/global') {
      return json(res, 200, { global: await review.fetchGlobalIndices() });
    }
    if (url.pathname === '/api/stocks') {
      const codes = url.searchParams.get('codes') || '';
      return json(res, 200, { stocks: await review.fetchStockQuotes(codes) });
    }
    if (url.pathname === '/api/kline') {
      const code = url.searchParams.get('code') || '';
      const date = url.searchParams.get('date') || todayISO();
      const symbol = review.toTxSymbol ? review.toTxSymbol(code) : '';
      if (!symbol) return json(res, 400, { error: '代码格式不正确' });
      return json(res, 200, { code, kline: await review.fetchDailyKline(symbol, date) });
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
  console.log(`行情日报 Desktop 本地后端运行于 http://localhost:${port}`);
  return server;
}

if (require.main === module) startServer().catch(error => { console.error('[桌面端] 本地服务启动失败：', error); process.exitCode = 1; });

module.exports = { startServer };
