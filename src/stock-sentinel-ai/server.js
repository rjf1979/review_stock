// 智诊盯盘 · 本地后端（取数 + 静态前端 + API）
// 数据在用户本地直连腾讯/东财公开接口，不经过任何服务器中转。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { MARKETS, fetchMarketSnapshot, fetchKline, snapshotStatus, fetchQuotes, isCnStockTradingSession, resolveStockMeta, codeMarket, todayStr } = require('./data');
const { listRules, scanByMarketContext, getMarketPrescan, PATTERNS, detectSinglePatterns } = require('./screener-core');
const rulesStore = require('./rules-store');
const crypto = require('crypto');
const priceLevels = require('./price-levels');
const { DATA_DIR, DB_FILE, listSnapshotDates, listKlineDates, klineStats, clearJudgments, recentTradingDates, readKlineDates, readKline, readKlineStats, writeKline, writePriceLevelSet, getPriceLevelSet, flush, flushSync, getAiPrompt, saveAiPrompt, getScanPreferences, saveScanPreferences, getStockRiskPlans } = require('./storage');
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
const klineSync = require('./kline-sync');
const { shanghaiClock, isAfterCnMarketClose } = require('./market-session');

const DEFAULT_PORT = 3110;
const MARKETS_DEFAULTS = ['sh_main', 'sz_main', 'chuangye', 'kechuang', 'beijiao'];
// 前端源码在 frontend/src（Vite 构建），服务只伺服构建产物 frontend/dist。
const FRONTEND = path.join(__dirname, 'frontend', 'dist');
const batchEventClients = new Set();
let poolJudgmentsCache = { at: 0, key: '', value: null };
let poolPatternsCache = { at: 0, key: '', value: null };
const workerBatchProgress = new Map();

function syncWorkerJudgments() {
  // Worker 落库已统一转交主进程写入（worker-manager.applyDbWrite），主进程内存即最新状态；
  // 这里只需要让候选池研判缓存失效，不再从磁盘重载数据库。
  poolJudgmentsCache = { at: 0, key: '', value: null };
}

function invalidateKlineDerivedCaches() {
  // 同日 K 线覆盖不会改变深度或最新日期，必须主动失效形态缓存。
  poolJudgmentsCache = { at: 0, key: '', value: null };
  poolPatternsCache = { at: 0, key: '', value: null };
}

async function settlePendingCustomReturnBaselines() {
  const settled = [];
  for (const item of watchlist.getList()) {
    const baseline = item && item.customReturnBaseline;
    if (!baseline || baseline.status !== 'pending_touch') continue;
    const record = await readKline(item.code);
    const fill = watchlist.findFirstSimulatedFill(record && record.kline, baseline.price, baseline.monitorStartDate);
    if (!fill) continue;
    const result = watchlist.markCustomReturnBaselineFilled(item.code, { expectedUpdatedAt: baseline.updatedAt, filledDate: fill.date });
    if (result.ok && !result.unchanged) settled.push(item.code);
  }
  return settled;
}

async function settlePendingWatchBaselines(now = new Date()) {
  // 加入日基准只能在闭市后由同日期最终日 K 的 close 冻结；绝不退回上一日或使用实时价。
  if (!isAfterCnMarketClose(now)) return [];
  const settled = [];
  for (const item of watchlist.getList()) {
    const baseline = item && item.returnBaseline;
    if (!baseline || baseline.status !== 'pending_close' || !/^\d{4}-\d{2}-\d{2}$/.test(String(baseline.targetDate || ''))) continue;
    const record = await readKline(item.code);
    const bar = record && Array.isArray(record.kline) && record.kline.find((x) => String(x.date) === String(baseline.targetDate));
    if (!bar || !Number.isFinite(Number(bar.close)) || Number(bar.close) <= 0) continue;
    const result = watchlist.confirmReturnBaseline(item.code, { targetDate: baseline.targetDate, close: bar.close });
    if (result.ok && !result.unchanged) settled.push(item.code);
  }
  return settled;
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
        await settlePendingWatchBaselines();
        await settlePendingCustomReturnBaselines();
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
        // source=manual 为手工添加（盯盘页置顶展示）；候选池转入等其余入口默认 pool。
        const source = String(url.searchParams.get('source') || 'pool');
        const clock = shanghaiClock();
        const r = watchlist.add(code, { name, market, source, baselineTargetDate: clock.date });
        if (!r.ok) return send(res, 409, { ok: false, error: r.error });
        // 闭市加入时立即同步并尝试冻结加入日最终收盘价；盘中始终保持待收盘确认。
        if (isAfterCnMarketClose()) {
          const syncResult = await klineSync.sync([code], { gapMs: 0, lmt: 260 });
          if (syncResult.changedCodes && syncResult.changedCodes.length) invalidateKlineDerivedCaches();
          await settlePendingWatchBaselines();
        }
        return send(res, 200, { ok: true, code, name, market, watch: watchlist.get(code) });
      }
      if (pathname === '/api/watchlist' && req.method === 'PATCH') {
        const code = String(url.searchParams.get('code') || '').trim();
        if (!/^\d{6}$/.test(code)) return send(res, 400, { ok: false, error: 'code 必须为 6 位数字' });
        const body = await readBody(req);
        if (body && Object.prototype.hasOwnProperty.call(body, 'pinned')) {
          const saved = watchlist.setPinned(code, body.pinned === true);
          return send(res, saved.ok ? 200 : 404, { ...saved, watch: saved.item });
        }
        if (!body || !Object.prototype.hasOwnProperty.call(body, 'customReturnBaselinePrice')) return send(res, 400, { ok: false, error: '请提供模拟买入价' });
        if (body.customReturnBaselinePrice === null) {
          const cleared = watchlist.clearCustomReturnBaseline(code);
          return send(res, cleared.ok ? 200 : 404, { ...cleared, cleared: cleared.ok && !cleared.unchanged, watch: cleared.item });
        }
        const clock = shanghaiClock();
        const saved = watchlist.setCustomReturnBaseline(code, body.customReturnBaselinePrice, { monitorStartDate: body.customReturnBaselineMonitorStartDate, now: new Date().toISOString() });
        if (!saved.ok) return send(res, saved.error === '不在自选中' ? 404 : 400, saved);
        await settlePendingCustomReturnBaselines();
        return send(res, 200, { ok: true, watch: watchlist.get(code), monitorDateDefault: clock.date });
      }
      if (pathname === '/api/watchlist' && req.method === 'DELETE') {
        const code = String(url.searchParams.get('code') || '').trim();
        const r = watchlist.remove(code);
        return send(res, r.ok ? 200 : 404, r);
      }
      if (pathname === '/api/watchlist/quotes') {
        const codes = String(url.searchParams.get('codes') || '').split(',').map((s) => s.trim()).filter(Boolean);
        // 报价统一走实时源（闭市/午休时返回最近交易日的数据）；K 线图表始终以本地 K 线库为准，不使用快照文件。
        const quotes = await fetchQuotes(codes);
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
        return send(res, 200, { quotes, alerts, asOf: todayStr(), source: 'live_quote' });
      }
      if (pathname === '/api/pool' && req.method === 'GET') {
        // 展示层的现价/涨跌幅以本地 K 线库尾 bar 为准（与个股详情同源同值）；
        // 量能评分/形态等筛选基准保持入池时点不变。克隆返回，不污染候选池存储。
        const items = await Promise.all(candidatePool.getList().map(async (item) => {
          const out = { ...item };
          try {
            const rec = await readKline(String(item.code || ''));
            const bars = rec && Array.isArray(rec.kline) ? rec.kline : [];
            if (bars.length >= 2) {
              const last = bars[bars.length - 1];
              const prev = bars[bars.length - 2];
              if (Number(prev.close) > 0) {
                out.price = Number(last.close);
                out.changePct = ((last.close - prev.close) / prev.close) * 100;
              }
            }
          } catch { /* 无 K 线的代码保持入池数据 */ }
          return out;
        }));
        return send(res, 200, { pool: items, file: candidatePool.POOL_FILE, klineState: poolPrefetch.getStatus() });
      }
      if (pathname === '/api/pool/recommendations' && req.method === 'GET') {
        // 候选池与自选盯盘的代码都纳入查询：转入盯盘后推荐结论与理由在盯盘页仍然可见。
        const poolCodes = candidatePool.getList().map((x) => String((x && x.code) || ''));
        const watchCodes = watchlist.getList().map((x) => String((x && x.code) || ''));
        const codes = [...new Set([...poolCodes, ...watchCodes])].filter((c) => /^\d{6}$/.test(c));
        return send(res, 200, { recommendations: await watchRecommendation.latest(codes), status: watchRecommendation.getStatus(), ruleVersion: watchRecommendation.RULE_VERSION });
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
      if ((pathname === '/api/kline/sync' || pathname === '/api/kline/complete') && req.method === 'POST') {
        const body = await readBody(req);
        const scope = String(body && body.scope || 'managed');
        if (!['managed', 'watch', 'explicit'].includes(scope)) return send(res, 400, { ok: false, error: { code: 'INVALID_SCOPE', message: '无效的 K 线同步范围', retryable: false } });
        const result = await klineSync.sync(Array.isArray(body && body.codes) ? body.codes : [], {
          scope,
          gapMs: undefined,
          lmt: Math.min(Math.max(Number(body && body.lmt) || 260, 20), 500),
        });
        if (result.ok === false && result.errorCode === 'KLINE_FLUSH_FAILED') {
          return send(res, 503, { ok: false, error: { code: result.errorCode, message: result.error, retryable: true }, result });
        }
        const postSync = { settledBaselines: [], settledCustomBaselines: [], warnings: [] };
        try { postSync.settledBaselines = await settlePendingWatchBaselines(); } catch (e) { postSync.warnings.push('收益基准结算失败：' + String(e.message || e)); }
        try { postSync.settledCustomBaselines = await settlePendingCustomReturnBaselines(); } catch (e) { postSync.warnings.push('模拟基准结算失败：' + String(e.message || e)); }
        if (result.changedCodes && result.changedCodes.length) {
          invalidateKlineDerivedCaches();
          const changed = new Set(result.changedCodes);
          const affected = candidatePool.getList().filter((item) => changed.has(String(item.code || '')));
          if (affected.length) watchRecommendation.start(affected).catch(() => {});
        }
        return send(res, result.ok === false ? 503 : 200, result.ok === false ? {
          ok: false,
          error: { code: result.errorCode || 'KLINE_SYNC_FAILED', message: result.error || 'K 线同步失败', retryable: result.retryable !== false },
          result,
          postSync,
        } : { ...result, postSync });
      }
      if (pathname === '/api/kline/sync-status') return send(res, 200, klineSync.getStatus());
      if (pathname === '/api/kline/levels' && req.method === 'POST') {
        // 个股价位（建仓/止损/止盈）：优先读已落库价位集；按当前 K 线现算并持久化，保证每次打开详情都有。
        const body = await readBody(req);
        const code = String((body && body.code) || '').trim();
        if (!/^\d{6}$/.test(code)) return send(res, 400, { error: 'code 必须为 6 位数字' });
        const local = await readKline(code);
        const bars = local && Array.isArray(local.kline) ? local.kline : [];
        if (bars.length < 30) return send(res, 400, { ok: false, error: 'K 线样本不足，无法计算价位' });
        const lastBar = bars[bars.length - 1];
        const levels = priceLevels.computeLevels(bars, { code });
        const evidenceHash = 'auto-' + crypto.createHash('sha256').update(bars.map((b) => b.date + ':' + b.close).join('|')).digest('hex').slice(0, 24);
        await writePriceLevelSet({
          code,
          tradeDate: String(lastBar.date || ''),
          evidenceHash,
          algorithmVersion: 'levels-v1',
          adjustmentType: 'qfq',
          klineDate: String(lastBar.date || ''),
          entryTriggers: levels.entryTriggers || [],
          invalidationLevel: levels.invalidationLevel || null,
          exitWatchZones: levels.exitWatchZones || [],
          riskReward: levels.riskReward || null,
          supportZones: levels.supportZones || [],
          resistanceZones: levels.resistanceZones || [],
        });
        const stored = await getPriceLevelSet(code, evidenceHash, 'levels-v1');
        return send(res, 200, { ok: true, code, levels: stored ? { ...stored, available: true } : null });
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
  // 存量 K 线量纲迁移（手→股）：有标记即瞬时跳过；首次执行在后台跑，不阻塞服务。
  require('./kline-volume-migration').maybeRun({ log: (...args) => console.log(...args) }).catch(() => {});
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
