// 智诊盯盘 · 本地后端（取数 + 静态前端 + API）
// 数据在用户本地直连腾讯/东财公开接口，不经过任何服务器中转。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { MARKETS, fetchMarketSnapshot, fetchKline, snapshotStatus, fetchQuotes, fetchLatestSnapshotQuotes, isCnStockTradingSession, resolveStockMeta, codeMarket, todayStr } = require('./data');
const { listRules, scanByMarketContext, getMarketPrescan, PATTERNS, detectSinglePatterns } = require('./screener-core');
const rulesStore = require('./rules-store');
const { DATA_DIR, DB_FILE, listSnapshotDates, listKlineDates, klineStats, clearJudgments, recentTradingDates, readKlineDates, readKline, readKlineStats, getAiPrompt, saveAiPrompt, getScanPreferences, saveScanPreferences, flushSync, getStockRiskPlans } = require('./storage');
const prefetch = require('./prefetch');
const watchlist = require('./watchlist');
const candidatePool = require('./candidate-pool');
const poolPrefetch = require('./pool-prefetch');
const settings = require('./settings');
const aiAssist = require('./ai-assist');
const judgmentCore = require('./judgment-core');
const judgmentBatch = require('./judgment-batch');
const judgmentStore = require('./judgment-store');
const judgmentWorker = require('./worker-manager');
const watchRecommendation = require('./watch-recommendation');

const DEFAULT_PORT = 3110;
const MARKETS_DEFAULTS = ['sh_main', 'sz_main', 'chuangye', 'kechuang', 'beijiao'];
const FRONTEND = path.join(__dirname, 'frontend');
const batchEventClients = new Set();
let poolJudgmentsCache = { at: 0, key: '', value: null };
let poolPatternsCache = { at: 0, key: '', value: null };
const workerBatchProgress = new Map();

function syncWorkerJudgments() {
  // Worker 落库已统一转交主进程写入（worker-manager.applyDbWrite），主进程内存即最新状态；
  // 这里只需要让候选池研判缓存失效，不再从磁盘重载数据库。
  poolJudgmentsCache = { at: 0, key: '', value: null };
}

judgmentWorker.onEvent((msg) => {
  const status = msg && msg.status ? msg.status : {};
  const batchId = String(status.batchId || '');
  const done = Number(status.done) || 0;
  const previousDone = workerBatchProgress.get(batchId) || 0;
  // 只有已完成股票数增长才说明 Worker 已写入新的研判记录；准备证据进度不重载数据库。
  if (batchId && done > previousDone) syncWorkerJudgments();
  if (batchId) workerBatchProgress.set(batchId, Math.max(previousDone, done));
  const payload = `event: ${msg.event}\ndata: ${JSON.stringify(msg.status)}\n\n`;
  for (const res of batchEventClients) { try { res.write(payload); } catch { batchEventClients.delete(res); } }
});

function send(res, status, body) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function serveStatic(res, filePath) {
  const resolved = path.normalize(path.join(FRONTEND, filePath.replace(/^\//, '')));
  if (!resolved.startsWith(FRONTEND)) return send(res, 403, 'Forbidden');
  fs.readFile(resolved, (err, buf) => {
    if (err) return send(res, 404, 'Not Found');
    const ext = path.extname(resolved).toLowerCase();
    const type = ext === '.html' ? 'text/html; charset=utf-8'
      : ext === '.js' ? 'application/javascript; charset=utf-8'
        : ext === '.css' ? 'text/css; charset=utf-8'
          : ext === '.png' ? 'image/png'
            : ext === '.ico' ? 'image/x-icon'
              : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}

function pickDataSource(query) {
  const v = String(query.get('dataSource') || 'live').toLowerCase();
  return ['live', 'local', 'last'].includes(v) ? v : 'live';
}

function isWeekendDate(date) {
  const match = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
  return day === 0 || day === 6;
}

// 基于「K线日期索引」统计候选池各股票在窗口内缺失日期，供设置页提示补全。
// 只核对候选池里的股票，不做全市场逐只扫描，避免无关股票拖慢核对。
async function computeKlineGaps(lmt) {
  const poolItems = candidatePool.getList();
  const seen = new Set();
  const codes = [];
  for (const item of poolItems) {
    const code = String((item && item.code) || '').trim();
    if (!/^\d{6}$/.test(code)) continue;
    if (!seen.has(code)) { seen.add(code); codes.push(code); }
  }
  const anchor = todayStr();
  const windowDates = await recentTradingDates(lmt, { anchor });
  let complete = 0;
  let incomplete = 0;
  let missingRows = 0;
  const examples = [];
  const perStock = [];
  for (const code of codes) {
    const allDates = await readKlineDates(code);
    const haveSet = new Set(allDates);
    // 上市日近似：取该股已落盘最早日期；早于该日的窗口日期视为新股/停牌前，不计入缺失。
    const firstDate = allDates.length ? allDates[0] : '';
    const win = firstDate ? windowDates.filter((d) => d >= firstDate) : windowDates;
    const missing = win.filter((d) => !haveSet.has(d));
    const isComplete = win.length > 0 && missing.length === 0;
    if (isComplete) complete += 1;
    else {
      incomplete += 1;
      missingRows += missing.length;
      if (examples.length < 8) examples.push({ code, missing });
    }
    perStock.push({ code, have: haveSet.size, missing: missing.length, firstDate });
  }
  perStock.sort((a, b) => b.missing - a.missing);
  return {
    scope: 'pool',
    lmt,
    anchor,
    windowSize: windowDates.length,
    total: codes.length,
    complete,
    incomplete,
    missingRows,
    examples,
    worst: perStock.slice(0, 20),
  };
}

// 读取并解析 JSON 请求体（上限 1MB，防止异常大请求）。
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      if (size > 1_000_000) {
        done = true;
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

async function handleScan(query) {
  const prefs = await getScanPreferences();
  const markets = prefs && prefs.markets.length ? prefs.markets : MARKETS_DEFAULTS;
  const limit = prefs ? prefs.scanLimit : 500;
  // 业务调整：固定实时拉取全市场快照 + 全部启用规则并集全识别；
  // 扫描阶段只做快照粗筛（不联网复筛 K 线）：量能分不低于自动入池门槛才算命中；
  // 命中进候选池后再拉完整 250 日 K 线并复筛形态。
  const forcePrescan = ['1', 'true', 'yes'].includes(String(query.get('force') || '').toLowerCase());
  return scanByMarketContext({ markets, limit, dataSource: 'live', forcePrescan });
}

async function handleMarketPrescan(query) {
  const prefs = await getScanPreferences();
  const markets = prefs && prefs.markets.length ? prefs.markets : MARKETS_DEFAULTS;
  const force = ['1', 'true', 'yes'].includes(String(query.get('force') || '').toLowerCase());
  return getMarketPrescan({ markets, dataSource: 'live', force });
}

function createServer(port = DEFAULT_PORT) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const pathname = url.pathname;
    try {
      if (pathname === '/api/health') return send(res, 200, { ok: true, service: 'stock-sentinel-ai' });
      if (pathname === '/api/markets') return send(res, 200, { markets: MARKETS });
      if (pathname === '/api/market-prescan') return send(res, 200, await handleMarketPrescan(url.searchParams));
      if (pathname === '/api/rules' && req.method === 'GET') return send(res, 200, { rules: listRules() });
      if (pathname === '/api/rules' && req.method === 'POST') {
        const body = await readBody(req);
        const list = Array.isArray(body) ? body : (Array.isArray(body.rules) ? body.rules : []);
        const saved = rulesStore.save(list);
        return send(res, 200, { ok: true, rules: saved });
      }
      if (pathname === '/api/rules/reset' && req.method === 'POST') {
        const saved = rulesStore.reset();
        return send(res, 200, { ok: true, rules: saved });
      }
      if (pathname === '/api/patterns') return send(res, 200, { patterns: Object.keys(PATTERNS) });
      if (pathname === '/api/settings' && req.method === 'GET') {
        const prefs = await getScanPreferences();
        return send(res, 200, { ...settings.load(), scanMarkets: prefs?.markets || MARKETS_DEFAULTS, scanLimit: prefs?.scanLimit || 500 });
      }
      if (pathname === '/api/settings' && req.method === 'POST') {
        const next = await readBody(req);
        const saved = settings.save(next);
        const previous = await getScanPreferences();
        const scanPreferences = Array.isArray(next && next.scanMarkets)
          ? await saveScanPreferences(next.scanMarkets, next.scanLimit)
          : (previous || { markets: MARKETS_DEFAULTS, scanLimit: 500 });
        return send(res, 200, { ok: true, settings: { ...saved, scanMarkets: scanPreferences.markets, scanLimit: scanPreferences.scanLimit } });
      }
      if (pathname === '/api/settings/trading' && req.method === 'POST') {
        const body = await readBody(req);
        const saved = settings.save({ ...settings.load(), tradingStyle: body && body.tradingStyle });
        return send(res, 200, { ok: true, settings: saved });
      }
      if (pathname === '/api/settings/scan-preferences' && req.method === 'POST') {
        const body = await readBody(req);
        const saved = await saveScanPreferences(body && body.scanMarkets, body && body.scanLimit);
        return send(res, 200, { ok: true, scanPreferences: saved });
      }
      if (pathname === '/api/ai/prompt' && req.method === 'GET') return send(res, 200, { ok: true, prompt: await getAiPrompt() });
      if (pathname === '/api/ai/prompt' && req.method === 'POST') { const body = await readBody(req); return send(res, 200, await saveAiPrompt(body && body.prompt, body && body.version)); }
      if (pathname === '/api/status') {
        const kline = await klineStats();
        return send(res, 200, {
          ok: true,
          dataDir: DATA_DIR,
          snapshotDates: listSnapshotDates(),
          klineDb: DB_FILE,
          // 所有数量统一以 SQLite kline 表为准，兼容 JSON 缓存清理后的目录。
          klineCount: kline.stockCount,
        });
      }
      if (pathname === '/api/local-status') {
        const markets = String(url.searchParams.get('markets') || '').split(',').map((s) => s.trim()).filter(Boolean);
        return send(res, 200, snapshotStatus(markets));
      }
      if (pathname === '/api/data-integrity') {
        const defaultMarkets = ['sh_main', 'sz_main', 'chuangye'];
        const snap = snapshotStatus(defaultMarkets);
        const k = await klineStats();
        const latestTradingDates = isWeekendDate(snap.today) ? await recentTradingDates(1) : [];
        const expectedSnapshotDate = latestTradingDates[0] || snap.today;
        const snapshotUsesRecentTradingDay = expectedSnapshotDate !== snap.today;
        const cfg = settings.load();
        const fetchDays = Math.round(Number(cfg.fetchDays) || 250);
        const klineTarget = Math.max(20, Math.round(fetchDays * 0.7));
        const missing = [];
        const missingSnapshots = snapshotUsesRecentTradingDay
          ? snap.markets.filter((m) => m.lastDate !== expectedSnapshotDate)
          : snap.markets.filter((m) => !m.hasToday);
        if (missingSnapshots.length) {
          const missMkts = missingSnapshots.map((m) => m.label);
          const label = snapshotUsesRecentTradingDay ? `最近交易日（${expectedSnapshotDate}）` : '今日';
          missing.push({ key: 'snapshot', text: `${label}全市场快照缺失：` + (missMkts.join('、') || '全部') });
        }
        if (!k.stockCount) {
          missing.push({ key: 'kline-empty', text: '本地 K 线库为空' });
        } else if (k.avgDays < klineTarget) {
          missing.push({ key: 'kline-depth', text: `K 线深度不足（平均 ${Math.round(k.avgDays)} 日 / 目标 ${klineTarget} 日）` });
        }
        const firstRun = k.stockCount === 0 && snap.okToday === 0;
        return send(res, 200, {
          ok: true,
          today: snap.today,
          expectedSnapshotDate,
          snapshotUsesRecentTradingDay,
          defaultMarkets,
          snapshot: { okToday: snap.okToday, total: snap.total, allToday: snap.allToday, lastDate: snap.lastDate },
          kline: { stockCount: k.stockCount, minDays: k.minDays, maxDays: k.maxDays, avgDays: Math.round(k.avgDays), fetchDays, target: klineTarget },
          firstRun,
          needsData: missing.length > 0,
          missing,
        });
      }
      if (pathname === '/api/scan') return send(res, 200, await handleScan(url.searchParams));
      if (pathname === '/api/prefetch-kline') {
        const markets = String(url.searchParams.get('markets') || '').split(',').map((s) => s.trim()).filter(Boolean);
        const lmt = Math.min(Math.max(Number(url.searchParams.get('lmt')) || prefetch.DEFAULT_LMT, 20), 500);
        const fresh = ['1', 'true', 'yes'].includes(String(url.searchParams.get('fresh') || '').toLowerCase());
        const gapMs = Math.max(Number(url.searchParams.get('gapMs')) || prefetch.DEFAULT_GAP_MS, 100);
        return send(res, 200, prefetch.startPrefetch({ markets, lmt, fresh, gapMs }));
      }
      if (pathname === '/api/prefetch-status') return send(res, 200, prefetch.getStatus());
      if (pathname === '/api/prefetch-stop') return send(res, 200, prefetch.stopPrefetch());
      if (pathname === '/api/watchlist' && req.method === 'GET') {
        return send(res, 200, { watchlist: watchlist.getList(), file: watchlist.WATCHLIST_FILE });
      }
      if (pathname === '/api/watchlist' && req.method === 'POST') {
        const code = String(url.searchParams.get('code') || '').trim();
        if (!/^\d{6}$/.test(code)) return send(res, 400, { ok: false, error: 'code 必须为 6 位数字' });
        let name = String(url.searchParams.get('name') || '');
        let market = String(url.searchParams.get('market') || '');
        if (!market) market = codeMarket(code);
        if (!name) {
          const meta = resolveStockMeta(code);
          name = meta.name;
        }
        if (!name) {
          const qs = await fetchQuotes([code]).catch(() => []);
          if (qs[0]) name = qs[0].name;
        }
        const r = watchlist.add(code, { name, market });
        if (!r.ok) return send(res, 409, { ok: false, error: r.error });
        return send(res, 200, { ok: true, code, name, market });
      }
      if (pathname === '/api/watchlist' && req.method === 'DELETE') {
        const code = String(url.searchParams.get('code') || '').trim();
        const r = watchlist.remove(code);
        return send(res, r.ok ? 200 : 404, r);
      }
      if (pathname === '/api/watchlist/quotes') {
        const codes = String(url.searchParams.get('codes') || '').split(',').map((s) => s.trim()).filter(Boolean);
        const closedMarket = !isCnStockTradingSession();
        const snapshotResult = closedMarket ? await fetchLatestSnapshotQuotes(codes) : null;
        const liveQuotes = !closedMarket || !snapshotResult.quotes.length ? await fetchQuotes(codes) : null;
        const quotes = snapshotResult ? (snapshotResult.quotes.length ? snapshotResult.quotes : liveQuotes) : liveQuotes;
        const asOf = snapshotResult && snapshotResult.quotes.length ? snapshotResult.asOf : todayStr();
        const source = snapshotResult && snapshotResult.quotes.length ? snapshotResult.source : 'live_quote';
        const plans = await getStockRiskPlans(codes);
        const alerts = [];
        for (const quote of quotes) {
          const plan = plans[quote.code]; const price = Number(quote.price);
          if (!plan || !Number.isFinite(price)) continue;
          const stop = Number(plan.stopLoss && (plan.stopLoss.value || plan.stopLoss.price));
          const entries = (plan.entryTriggers || []).map((x) => Number(x.confirmAbove || x.value || x.price)).filter(Number.isFinite);
          const profits = (plan.takeProfit || []).map((x) => Number(x.value || x.price || (x.zone && x.zone.low))).filter(Number.isFinite);
          if (Number.isFinite(stop) && price <= stop) alerts.push({ code: quote.code, type: 'stop_loss', label: '触及止损价位', price, level: stop, tradingStyle: plan.tradingStyle });
          else if (profits.some((x) => price >= x)) alerts.push({ code: quote.code, type: 'take_profit', label: '触及止盈价位', price, level: Math.min(...profits), tradingStyle: plan.tradingStyle });
          else if (entries.some((x) => Math.abs(price / x - 1) <= 0.01)) alerts.push({ code: quote.code, type: 'entry', label: '接近建仓价位', price, level: entries[0], tradingStyle: plan.tradingStyle });
        }
        return send(res, 200, { quotes, alerts, asOf, source });
      }
      if (pathname === '/api/pool' && req.method === 'GET') {
        return send(res, 200, { pool: candidatePool.getList(), file: candidatePool.POOL_FILE, klineState: poolPrefetch.getStatus() });
      }
      if (pathname === '/api/pool/recommendations' && req.method === 'GET') {
        const items = candidatePool.getList();
        return send(res, 200, { recommendations: await watchRecommendation.latest(items.map((x) => x.code)), status: watchRecommendation.getStatus(), ruleVersion: watchRecommendation.RULE_VERSION });
      }
      if (pathname === '/api/pool/recommendations' && req.method === 'POST') {
        const running = watchRecommendation.getStatus();
        if (running.running) return send(res, 409, { ok: false, error: '评估任务正在运行', ...running });
        const result = await watchRecommendation.start(candidatePool.getList());
        return send(res, result.started ? 200 : 409, result);
      }
      if (pathname === '/api/pool/recommendations' && req.method === 'DELETE') return send(res, 200, watchRecommendation.stop());
      if (pathname === '/api/pool/judgments' && req.method === 'GET') {
        const fetchDays = Math.round(Number(settings.load().fetchDays) || 250);
        const calendar = await recentTradingDates(Math.max(500, fetchDays * 3));
        const items = candidatePool.getList();
        const cacheKey = `${items.length}:${items.map((x) => `${x.code}:${x.snapshotDate || ''}`).join(',')}:${fetchDays}`;
        if (poolJudgmentsCache.value && poolJudgmentsCache.key === cacheKey && Date.now() - poolJudgmentsCache.at < 5000) {
          return send(res, 200, { judgments: poolJudgmentsCache.value, cached: true });
        }
        const map = {};
        const stats = await readKlineStats(items.map((x) => x && x.code));
        const statsMap = new Map(stats.map((x) => [x.code, x]));
        for (const item of items) {
          const code = String((item && item.code) || '').trim();
          if (!/^\d{6}$/.test(code)) continue;
          map[code] = await judgmentCore.statusForCode(code, { fetchDays, calendar, fast: true, klineStat: statsMap.get(code) || null });
        }
        poolJudgmentsCache = { at: Date.now(), key: cacheKey, value: map };
        return send(res, 200, { judgments: map });
      }
      if (pathname === '/api/pool/patterns' && req.method === 'GET') {
        const items = candidatePool.getList();
        const stats = await readKlineStats(items.map((x) => x && x.code));
        const statsMap = new Map(stats.map((x) => [x.code, x]));
        const cacheKey = items.map((x) => {
          const stat = statsMap.get(String(x && x.code || '')) || {};
          return `${x.code}:${stat.depth || 0}:${stat.latestDate || ''}`;
        }).join(',');
        if (poolPatternsCache.value && poolPatternsCache.key === cacheKey && Date.now() - poolPatternsCache.at < 10000) {
          return send(res, 200, { patterns: poolPatternsCache.value, cached: true });
        }
        const entries = await Promise.all(items.map(async (item) => {
          const code = String((item && item.code) || '').trim();
          if (!/^\d{6}$/.test(code)) return null;
          const rec = await readKline(code);
          const result = detectSinglePatterns(rec && rec.kline, { code });
          return [code, { hits: result.hits, checkedRules: result.rules.length }];
        }));
        const patterns = Object.fromEntries(entries.filter(Boolean));
        poolPatternsCache = { at: Date.now(), key: cacheKey, value: patterns };
        return send(res, 200, { patterns });
      }
      if (pathname === '/api/pool' && req.method === 'POST') {
        const body = await readBody(req);
        const items = Array.isArray(body) ? body : (body && Array.isArray(body.items) ? body.items : []);
        const r = candidatePool.addMany(items);
        return send(res, 200, r);
      }
      if (pathname === '/api/pool/kline' && req.method === 'POST') {
        const body = await readBody(req);
        const lmt = Math.min(Math.max(Number(body && body.lmt) || poolPrefetch.DEFAULT_LMT, 20), 500);
        const codes = (body && Array.isArray(body.codes) ? body.codes : []).map((c) => String(c).trim()).filter(Boolean);
        const r = poolPrefetch.start(codes, { lmt });
        return send(res, r.started ? 200 : 409, r);
      }
      if (pathname === '/api/pool/kline' && req.method === 'DELETE') {
        return send(res, 200, poolPrefetch.stop());
      }
      if (pathname === '/api/pool/kline-status') {
        return send(res, 200, poolPrefetch.getStatus());
      }
      if (pathname === '/api/kline-depths' && (req.method === 'GET' || req.method === 'POST')) {
        let codes = [];
        if (req.method === 'POST') {
          const body = await readBody(req);
          codes = (body && Array.isArray(body.codes) ? body.codes : []).map((c) => String(c).trim()).filter(Boolean);
        } else {
          codes = String(url.searchParams.get('codes') || '').split(',').map((s) => s.trim()).filter(Boolean);
        }
        const depths = await readKlineStats(codes);
        return send(res, 200, { depths });
      }
      if (pathname === '/api/pool' && req.method === 'DELETE') {
        const all = String(url.searchParams.get('all') || '').trim();
        if (all === '1' || all === 'true') return send(res, 200, candidatePool.clear());
        const code = String(url.searchParams.get('code') || '').trim();
        const r = candidatePool.remove(code);
        return send(res, r.ok ? 200 : 404, r);
      }
      if (pathname === '/api/kline-gaps') {
        const lmt = Math.min(Math.max(Number(url.searchParams.get('lmt')) || prefetch.DEFAULT_LMT, 20), 500);
        return send(res, 200, await computeKlineGaps(lmt));
      }
      if (pathname === '/api/kline') {
        const code = String(url.searchParams.get('code') || '').trim();
        if (!/^\d{6}$/.test(code)) return send(res, 400, { error: 'code 必须为 6 位数字' });
        const dataSource = pickDataSource(url.searchParams);
        const minDate = String(url.searchParams.get('minDate') || '');
        return send(res, 200, { code, dataSource, kline: await fetchKline(code, { dataSource, minDate }) });
      }
      if (pathname === '/api/kline/patterns' && req.method === 'POST') {
        const body = await readBody(req);
        const code = String((body && body.code) || '').trim();
        const kline = Array.isArray(body && body.kline) ? body.kline : [];
        if (!/^\d{6}$/.test(code)) return send(res, 400, { error: 'code 必须为 6 位数字' });
        const result = detectSinglePatterns(kline, { code });
        return send(res, 200, { code, hits: result.hits, checkedRules: result.rules.length });
      }
      if (pathname === '/api/ai/analyze' && req.method === 'POST') {
        const body = await readBody(req);
        const code = String((body && body.code) || '').trim();
        if (!/^\d{6}$/.test(code)) return send(res, 400, { ok: false, error: 'code 必须为 6 位数字' });
        // 详情页已拉到前复权日 K，直接透传避免二次联网；后端据此复跑全部启用形态规则做证据。
        const kline = Array.isArray(body && body.kline) ? body.kline : [];
        const r = await aiAssist.analyze({
          code,
          name: String((body && body.name) || ''),
          market: String((body && body.market) || ''),
          snapshot: (body && body.snapshot && typeof body.snapshot === 'object') ? body.snapshot : null,
          kline,
          patterns: detectSinglePatterns(kline, { code }).hits,
          ruleLabel: String((body && body.ruleLabel) || ''),
        });
        return send(res, r.ok ? 200 : 200, r);
      }
      if (pathname === '/api/ai/judge' && req.method === 'POST') {
        const body = await readBody(req);
        const code = String((body && body.code) || '').trim();
        if (!/^\d{6}$/.test(code)) return send(res, 400, { ok: false, error: 'code 必须为 6 位数字' });
        const r = await judgmentCore.judgeOne(code, {
          force: (body && body.force) === true,
          fetchDays: Math.round(Number(settings.load().fetchDays) || 250),
        });
        return send(res, r.ok ? 200 : 200, r);
      }
      if (pathname === '/api/ai/record' && req.method === 'GET') {
        const code = String(url.searchParams.get('code') || '').trim();
        if (!/^\d{6}$/.test(code)) return send(res, 400, { ok: false, error: 'code 必须为 6 位数字' });
        // 二次打开详情时读回：最近成功 + 上一条成功 + 最近失败尝试 + 成功记录对应观察价位。
        const r = await judgmentCore.latestRecordForCode(code);
        const rec = r.latestSuccess || r.lastFailed || null;
        return send(res, 200, {
          ok: true,
          code,
          found: !!rec,
          status: r.latestSuccess ? 'success' : (r.lastFailed ? r.lastFailed.judgmentStatus : 'none'),
          record: r.latestSuccess || null,
          prevSuccess: r.prevSuccess || null,
          lastFailed: r.lastFailed || null,
          levels: r.levels || null,
          hasFailure: !!r.lastFailed,
          errorMessage: r.lastFailed ? (r.lastFailed.errorMessage || null) : null,
        });
      }
      if (pathname === '/api/ai/batch' && req.method === 'POST') {
        const body = await readBody(req);
        const r = await judgmentWorker.start({
          retryOnly: (body && body.retryOnly) === true,
          gapMs: Number(body && body.gapMs) >= 100 ? Number(body.gapMs) : judgmentBatch.DEFAULT_GAP_MS,
          concurrency: Number(body && body.concurrency) || Number(settings.load().ai.concurrency) || 3,
        });
        return send(res, r.started ? 200 : 200, r);
      }
      if (pathname === '/api/ai/batch-plan' && (req.method === 'GET' || req.method === 'POST')) {
        let retryOnly = false;
        if (req.method === 'POST') {
          const body = await readBody(req);
          retryOnly = (body && body.retryOnly) === true;
        } else {
          retryOnly = String(url.searchParams.get('retryOnly') || '') === 'true';
        }
        return send(res, 200, await judgmentWorker.preview({ retryOnly }));
      }
      if (pathname === '/api/ai/batch-status') {
        return send(res, 200, await judgmentWorker.status());
      }
      if (pathname === '/api/ai/batch-events' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write(': connected\n\n');
        batchEventClients.add(res);
        req.on('close', () => batchEventClients.delete(res));
        return;
      }
      if (pathname === '/api/ai/batch' && req.method === 'DELETE') {
        return send(res, 200, await judgmentWorker.stop());
      }
      if (pathname === '/api/ai/judgments' && req.method === 'DELETE') {
        await judgmentWorker.stop();
        const dbCleared = await clearJudgments();
        const jsonCleared = judgmentStore.clear();
        poolJudgmentsCache = { at: 0, key: '', value: null };
        poolPatternsCache = { at: 0, key: '', value: null };
        return send(res, dbCleared && jsonCleared ? 200 : 500, { ok: dbCleared && jsonCleared, dbCleared, jsonCleared });
      }
      if (pathname === '/api/ai/batch-retry' && req.method === 'POST') {
        const body = await readBody(req);
        const r = await judgmentWorker.start({
          retryOnly: true,
          gapMs: Number(body && body.gapMs) >= 100 ? Number(body.gapMs) : judgmentBatch.DEFAULT_GAP_MS,
          concurrency: Number(body && body.concurrency) || Number(settings.load().ai.concurrency) || 3,
        });
        return send(res, r.started ? 200 : 200, r);
      }
      if (pathname === '/') return serveStatic(res, 'index.html');
      return serveStatic(res, pathname.slice(1) || 'index.html');
    } catch (error) {
      return send(res, 500, { error: error.message || '解析失败' });
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.VOLUME_INSIGHT_PORT || DEFAULT_PORT);
  createServer(port).listen(port, '127.0.0.1', () => {
    console.log(`智诊盯盘本地后端运行于 http://127.0.0.1:${port}`);
  });
  // 退出兜底：把仍在内存、未达自动落盘阈值的写入（预取 K 线等）同步导出到 kline.db。
  process.on('exit', () => { try { flushSync(); } catch { /* 忽略退出期导出失败 */ } });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      try { flushSync(); } catch { /* 同上 */ }
      process.exit(0);
    });
  }
}

module.exports = { createServer, isWeekendDate };
