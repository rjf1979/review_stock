// 量能洞察 · 本地存储层
// 快照（snapshots）仍为 JSON 文件，按市场单独落盘；
// K线改为 SQLite（sql.js 纯 JS 版），一张 kline 表 = 每只股票每个交易日一行，
// 另用 kline_meta 记录「该股票最近一次抓取日期」用于缓存时效判断。
// 目录可用环境变量 VOLUME_INSIGHT_DATA_DIR 覆盖（Electron 打包时指向 userData）。
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js/dist/sql-asm.js').default;

const DATA_DIR = process.env.VOLUME_INSIGHT_DATA_DIR
  ? path.resolve(process.env.VOLUME_INSIGHT_DATA_DIR)
  : path.join(__dirname, 'data');
const SNAP_DIR = path.join(DATA_DIR, 'snapshots');
const DB_FILE = process.env.VOLUME_INSIGHT_KLINE_DB
  ? path.resolve(process.env.VOLUME_INSIGHT_KLINE_DB)
  : path.join(DATA_DIR, 'kline.db');

let SQL = null;         // sql.js 模块（init 后）
let db = null;          // Database 实例
let initPromise = null; // initSqlJs 的 Promise（惰性单次）
let dirtyWrites = 0;    // 距上次落盘的写入数（sql.js 导出的昂贵，批量落盘用）
let statsTimer = null;
const FLUSH_BATCH = 250; // 每累计 250 次写入导出一份 db 文件，避免 O(n²) 全量导出

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function safeKey(key) {
  return String(key).replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function getSQL() {
  if (!SQL) {
    initPromise = initPromise || initSqlJs();
    SQL = await initPromise;
  }
  return SQL;
}

// 惰性初始化 SQLite：有库文件则加载，无则新建；建表/建索引。
async function ensureDb() {
  await getSQL();
  if (!db) {
    ensureDir(DATA_DIR);
    if (fs.existsSync(DB_FILE)) {
      db = new SQL.Database(fs.readFileSync(DB_FILE));
    } else {
      db = new SQL.Database();
    }
    db.run(`CREATE TABLE IF NOT EXISTS kline (
      code   TEXT NOT NULL,
      date   TEXT NOT NULL,
      open   REAL,
      high   REAL,
      low    REAL,
      close  REAL,
      volume REAL,
      amount REAL,
      PRIMARY KEY (code, date)
    )`);
    db.run('CREATE INDEX IF NOT EXISTS idx_kline_code ON kline(code)');
    db.run('CREATE INDEX IF NOT EXISTS idx_kline_date ON kline(date)');
    db.run(`CREATE TABLE IF NOT EXISTS kline_meta (
      code     TEXT PRIMARY KEY,
      date     TEXT,
      savedAt  TEXT
    )`);
    // 全市场快照采用批次表 + 明细表。批次保存数据质量与来源，明细以 batchId+code
    // 唯一，避免把一次 5,000+ 股票抓取拆成逐行落盘和逐行导出数据库。
    db.run(`CREATE TABLE IF NOT EXISTS market_snapshot_batches (
      id TEXT PRIMARY KEY,
      tradeDate TEXT NOT NULL,
      marketKey TEXT NOT NULL,
      source TEXT NOT NULL,
      fetchedAt TEXT NOT NULL,
      expectedCount INTEGER,
      recordCount INTEGER NOT NULL,
      isComplete INTEGER NOT NULL DEFAULT 0,
      errorJson TEXT,
      createdAt TEXT NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS market_snapshot_records (
      batchId TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT,
      marketKey TEXT NOT NULL,
      price REAL,
      changePct REAL,
      amount REAL,
      turnover REAL,
      volumeRatio REAL,
      totalMcap REAL,
      floatMcap REAL,
      mainNet REAL,
      PRIMARY KEY (batchId, code),
      FOREIGN KEY (batchId) REFERENCES market_snapshot_batches(id)
    )`);
    db.run('CREATE INDEX IF NOT EXISTS idx_snapshot_batches_trade_market ON market_snapshot_batches(tradeDate, marketKey, fetchedAt DESC)');
    db.run('CREATE INDEX IF NOT EXISTS idx_snapshot_records_code ON market_snapshot_records(code)');
    db.run('CREATE INDEX IF NOT EXISTS idx_snapshot_records_market ON market_snapshot_records(marketKey, batchId)');
    db.run(`CREATE TABLE IF NOT EXISTS market_sentiment_snapshots (
      tradeDate TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      fetchedAt TEXT NOT NULL,
      available INTEGER NOT NULL DEFAULT 0,
      limitUpCount INTEGER,
      limitDownCount INTEGER,
      brokenCount INTEGER,
      sealRate REAL,
      maxBoardHeight INTEGER,
      normalizedJson TEXT,
      rawJson TEXT,
      qualityJson TEXT,
      updatedAt TEXT NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS stock_risk_plans (
      code TEXT PRIMARY KEY,
      tradingStyle TEXT NOT NULL,
      evidenceHash TEXT NOT NULL,
      generatedAt TEXT NOT NULL,
      entryTriggersJson TEXT,
      stopLossJson TEXT,
      takeProfitJson TEXT,
      sourceLevelSetId INTEGER,
      updatedAt TEXT NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS judgment_records (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      batchId        TEXT,
      code           TEXT NOT NULL,
      tradeDate      TEXT,
      marketPhase    TEXT,
      isFinal        INTEGER DEFAULT 0,
      evidenceHash   TEXT,
      promptVersion  TEXT,
      model          TEXT,
      priceLevelSetId TEXT,
      dataStatus     TEXT,
      judgmentStatus TEXT,
      scoreStatus    TEXT,
      attempt        INTEGER DEFAULT 0,
      startedAt      INTEGER,
      finishedAt     INTEGER,
      durationMs     INTEGER,
      errorCode      TEXT,
      errorMessage   TEXT,
      modelResultJson TEXT,
      rawText        TEXT,
      usageJson      TEXT,
      evidenceJson   TEXT,
      createdAt      TEXT
    )`);
    db.run('CREATE INDEX IF NOT EXISTS idx_judgment_code ON judgment_records(code)');
    db.run('CREATE INDEX IF NOT EXISTS idx_judgment_batch ON judgment_records(batchId)');
    // 幂等约束只作用于成功结果：同一 code+evidenceHash+promptVersion+model 不允许重复成功，
    // 但允许保留失败/格式异常尝试作为独立记录，避免覆盖或丢失排错信息。
    db.run('CREATE UNIQUE INDEX IF NOT EXISTS uq_judgment_success ON judgment_records(code, evidenceHash, promptVersion, model) WHERE judgmentStatus = \'success\'');
    db.run(`CREATE TABLE IF NOT EXISTS watch_recommendation_batches (
      batchId TEXT PRIMARY KEY, status TEXT NOT NULL, total INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0,
      succeeded INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, snapshotJson TEXT, startedAt INTEGER, finishedAt INTEGER, createdAt TEXT NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS watch_recommendations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, batchId TEXT NOT NULL, code TEXT NOT NULL, classification TEXT NOT NULL,
      reasonCodesJson TEXT, evidenceJson TEXT, conditionsJson TEXT, missingJson TEXT, ruleVersion TEXT NOT NULL,
      evidenceHash TEXT, status TEXT NOT NULL, createdAt INTEGER NOT NULL
    )`);
    db.run('CREATE INDEX IF NOT EXISTS idx_watch_recommendations_code ON watch_recommendations(code, createdAt DESC)');
    db.run(`CREATE TABLE IF NOT EXISTS price_level_sets (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      code           TEXT NOT NULL,
      tradeDate      TEXT,
      evidenceHash   TEXT,
      algorithmVersion TEXT,
      adjustmentType TEXT,
      klineDate      TEXT,
      snapshotAt     TEXT,
      supportZonesJson      TEXT,
      resistanceZonesJson   TEXT,
      entryTriggersJson     TEXT,
      invalidationLevelJson TEXT,
      exitWatchZonesJson    TEXT,
      riskRewardJson        TEXT,
      evidenceJson          TEXT,
      createdAt      TEXT
    )`);
    db.run('CREATE INDEX IF NOT EXISTS idx_price_levels_code ON price_level_sets(code)');
    db.run(`CREATE TABLE IF NOT EXISTS kline_stats (
      code TEXT PRIMARY KEY,
      barCount INTEGER NOT NULL DEFAULT 0,
      firstDate TEXT,
      latestDate TEXT,
      updatedAt TEXT NOT NULL
    )`);
    db.run('CREATE INDEX IF NOT EXISTS idx_kline_stats_latest ON kline_stats(latestDate)');
    db.run(`INSERT OR REPLACE INTO kline_stats(code,barCount,firstDate,latestDate,updatedAt)
      SELECT code, COUNT(*), MIN(date), MAX(date), datetime('now') FROM kline GROUP BY code`);
    db.run('CREATE UNIQUE INDEX IF NOT EXISTS uq_price_level_set ON price_level_sets(code, evidenceHash, algorithmVersion)');
    db.run(`CREATE TABLE IF NOT EXISTS data_stats (
      statKey TEXT PRIMARY KEY,
      statValue REAL NOT NULL,
      updatedAt TEXT NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS ai_prompt_configs (id INTEGER PRIMARY KEY CHECK (id = 1), prompt TEXT NOT NULL, version TEXT NOT NULL, updatedAt TEXT NOT NULL)`);
    db.run(`CREATE TABLE IF NOT EXISTS scan_preferences (id INTEGER PRIMARY KEY CHECK (id = 1), marketsJson TEXT NOT NULL, updatedAt TEXT NOT NULL)`);
    const scanPreferenceColumns = db.exec('PRAGMA table_info(scan_preferences)');
    const hasScanLimit = scanPreferenceColumns.length && scanPreferenceColumns[0].values.some((row) => String(row[1]) === 'scanLimit');
    if (!hasScanLimit) db.run('ALTER TABLE scan_preferences ADD COLUMN scanLimit INTEGER NOT NULL DEFAULT 500');
    // 兼容早期 statValue 为 TEXT 的数据库，启动时一次性迁移为 REAL。
    const statCols = db.exec('PRAGMA table_info(data_stats)');
    const statType = statCols.length && statCols[0].values.find((r) => String(r[1]) === 'statValue');
    if (statType && String(statType[2]).toUpperCase() !== 'REAL') {
      db.run('ALTER TABLE data_stats RENAME TO data_stats_legacy');
      db.run('CREATE TABLE data_stats (statKey TEXT PRIMARY KEY, statValue REAL NOT NULL, updatedAt TEXT NOT NULL)');
      db.run('INSERT INTO data_stats(statKey,statValue,updatedAt) SELECT statKey,CAST(statValue AS REAL),updatedAt FROM data_stats_legacy');
      db.run('DROP TABLE data_stats_legacy');
    }
  }
  return db;
}

function persist() {
  ensureDir(DATA_DIR);
  const bytes = db.export();
  fs.writeFileSync(DB_FILE, Buffer.from(bytes));
}

// 将 sql.js 导出刷盘安排到下一轮事件循环，避免在 HTTP/批量研判处理栈中同步阻塞。
function persistAsync() {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try { persist(); resolve(); } catch (e) { reject(e); }
    });
  });
}

function scheduleDataStatsRefresh() {
  if (statsTimer) return;
  statsTimer = setTimeout(() => { statsTimer = null; refreshDataStats().catch(() => {}); }, 200);
}

// ── 每日快照归档（data/snapshots/<date>__<marketKey>.json）────────────────
function writeSnapshot(date, marketKey, records) {
  try {
    ensureDir(SNAP_DIR);
    const file = path.join(SNAP_DIR, `${date}__${safeKey(marketKey)}.json`);
    fs.writeFileSync(file, JSON.stringify({ date, marketKey, records, savedAt: new Date().toISOString() }), 'utf8');
    return file;
  } catch {
    return null;
  }
}

function readSnapshot(date, marketKey) {
  try {
    ensureDir(SNAP_DIR);
    const file = path.join(SNAP_DIR, `${date}__${safeKey(marketKey)}.json`);
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && Array.isArray(parsed.records) ? parsed : null;
  } catch {
    return null;
  }
}

// 读取指定市场最近一次的快照（跨日期），用于「最近一次」模式。
function readLatestSnapshot(marketKey) {
  try {
    ensureDir(SNAP_DIR);
    const files = fs.readdirSync(SNAP_DIR)
      .filter((f) => f.endsWith(`__${safeKey(marketKey)}.json`))
      .sort()
      .reverse();
    if (!files.length) return null;
    return readSnapshot(files[0].split('__')[0], marketKey);
  } catch {
    return null;
  }
}

function listSnapshotDates() {
  try {
    ensureDir(SNAP_DIR);
    return fs.readdirSync(SNAP_DIR)
      .filter((f) => /^\d{4}-\d{2}-\d{2}__/.test(f) && f.endsWith('.json'))
      .map((f) => f.split('__')[0])
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

// 批量归档全市场快照：整批明细放在一个事务内写入，事务完成后只导出一次 sql.js
// 数据库文件。保留最近 45 个交易日，历史回放所需数据可由后续专门归档任务延长。
async function writeMarketSnapshotBatch({ id, tradeDate, marketKey, source = 'live', expectedCount = 0, records = [], isComplete = false, errors = null } = {}) {
  const batchId = String(id || '').trim();
  const date = String(tradeDate || '').trim();
  const key = String(marketKey || '').trim();
  if (!batchId || !date || !key || !Array.isArray(records)) return false;
  try {
    const d = await ensureDb();
    const now = new Date().toISOString();
    d.run('BEGIN');
    d.run(`INSERT OR REPLACE INTO market_snapshot_batches
      (id,tradeDate,marketKey,source,fetchedAt,expectedCount,recordCount,isComplete,errorJson,createdAt)
      VALUES(?,?,?,?,?,?,?,?,?,?)`, [batchId, date, key, String(source), now, Number(expectedCount) || 0, records.length, isComplete ? 1 : 0, errors ? JSON.stringify(errors) : null, now]);
    d.run('DELETE FROM market_snapshot_records WHERE batchId = ?', [batchId]);
    const stmt = d.prepare(`INSERT INTO market_snapshot_records
      (batchId,code,name,marketKey,price,changePct,amount,turnover,volumeRatio,totalMcap,floatMcap,mainNet)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const row of records) {
      if (!row || !/^\d{6}$/.test(String(row.code || ''))) continue;
      stmt.run([batchId, String(row.code), String(row.name || ''), key, num(row.price), num(row.changePct), num(row.amount), num(row.turnover), num(row.volumeRatio), num(row.totalMcap), num(row.floatMcap), num(row.mainNet)]);
    }
    stmt.free();
    // 不保留无限量日内批次；每个市场只留最近 45 个交易日的最新完整快照。
    d.run(`DELETE FROM market_snapshot_records WHERE batchId IN (
      SELECT id FROM market_snapshot_batches WHERE marketKey = ? AND id NOT IN (
        SELECT id FROM market_snapshot_batches WHERE marketKey = ? AND isComplete = 1
        ORDER BY tradeDate DESC, fetchedAt DESC LIMIT 45
      ) AND isComplete = 1
    )`, [key, key]);
    d.run(`DELETE FROM market_snapshot_batches WHERE marketKey = ? AND isComplete = 1 AND id NOT IN (
      SELECT id FROM market_snapshot_batches WHERE marketKey = ? AND isComplete = 1
      ORDER BY tradeDate DESC, fetchedAt DESC LIMIT 45
    )`, [key, key]);
    d.run('COMMIT');
    await persistAsync();
    return true;
  } catch {
    try { db && db.run('ROLLBACK'); } catch { /* ignore */ }
    return false;
  }
}

async function saveStockRiskPlan({ code, tradingStyle, evidenceHash, entryTriggers, stopLoss, takeProfit, sourceLevelSetId = null } = {}) {
  if (writeDelegate) return delegateWrite('saveStockRiskPlan', [{ code, tradingStyle, evidenceHash, entryTriggers, stopLoss, takeProfit, sourceLevelSetId }]);
  if (!/^\d{6}$/.test(String(code || ''))) return false;
  try {
    const d = await ensureDb();
    const now = new Date().toISOString();
    d.run(`INSERT OR REPLACE INTO stock_risk_plans
      (code,tradingStyle,evidenceHash,generatedAt,entryTriggersJson,stopLossJson,takeProfitJson,sourceLevelSetId,updatedAt)
      VALUES(?,?,?,?,?,?,?,?,?)`, [String(code), String(tradingStyle || 'short'), String(evidenceHash || ''), now, toJson(entryTriggers || []), toJson(stopLoss || null), toJson(takeProfit || []), sourceLevelSetId, now]);
    await persistAsync();
    return true;
  } catch { return false; }
}

async function writeMarketSentimentSnapshotUnsafe(record = {}) {
  try {
    const date = String(record.tradeDate || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const d = await ensureDb();
    const now = new Date().toISOString();
    d.run(`INSERT OR REPLACE INTO market_sentiment_snapshots
      (tradeDate,source,fetchedAt,available,limitUpCount,limitDownCount,brokenCount,sealRate,maxBoardHeight,normalizedJson,rawJson,qualityJson,updatedAt)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, [date, String(record.source || 'eastmoney'), String(record.fetchedAt || now), record.available ? 1 : 0,
      num(record.limitUpCount), num(record.limitDownCount), num(record.brokenCount), num(record.sealRate), num(record.maxBoardHeight),
      toJson(record.normalized || null), toJson(record.raw || null), toJson(record.quality || null), now]);
    // 情绪池用于短周期判断与回放，保留最近 120 个交易日。
    d.run('DELETE FROM market_sentiment_snapshots WHERE tradeDate NOT IN (SELECT tradeDate FROM market_sentiment_snapshots ORDER BY tradeDate DESC LIMIT 120)');
    await persistAsync();
    return true;
  } catch { return false; }
}

async function readMarketSentimentSnapshot(tradeDate) {
  try {
    const d = await ensureDb();
    const q = d.exec('SELECT normalizedJson FROM market_sentiment_snapshots WHERE tradeDate = ? LIMIT 1', [String(tradeDate || '')]);
    return q.length && q[0].values.length ? fromJson(q[0].values[0][0]) : null;
  } catch { return null; }
}

async function getStockRiskPlans(codes = []) {
  try {
    const d = await ensureDb();
    const list = [...new Set((Array.isArray(codes) ? codes : []).map(String).filter((x) => /^\d{6}$/.test(x)))];
    if (!list.length) return {};
    const q = d.exec(`SELECT * FROM stock_risk_plans WHERE code IN (${list.map(() => '?').join(',')})`, list);
    if (!q.length) return {};
    return Object.fromEntries(q[0].values.map((row) => {
      const x = Object.fromEntries(q[0].columns.map((c, i) => [c, row[i]]));
      return [x.code, { ...x, entryTriggers: fromJson(x.entryTriggersJson) || [], stopLoss: fromJson(x.stopLossJson), takeProfit: fromJson(x.takeProfitJson) || [] }];
    }));
  } catch { return {}; }
}

// ── 单票K线落盘（SQLite：一票一日一行）─────────────────────────────
// kline: [{date, open, high, low, close, volume, amount?}], date: 抓取日期。
async function writeKline(code, kline, date) {
  try {
    const d = await ensureDb();
    d.run('BEGIN');
    const stmt = d.prepare(
      'INSERT OR REPLACE INTO kline(code,date,open,high,low,close,volume,amount) VALUES(?,?,?,?,?,?,?,?)'
    );
    for (const c of kline || []) {
      if (!c || !c.date) continue;
      stmt.run([String(code), String(c.date), num(c.open), num(c.high), num(c.low), num(c.close), num(c.volume), num(c.amount)]);
    }
    stmt.free();
    d.run('INSERT OR REPLACE INTO kline_meta(code,date,savedAt) VALUES(?,?,?)', [String(code), String(date || ''), new Date().toISOString()]);
    const stat = d.exec('SELECT COUNT(*), MIN(date), MAX(date) FROM kline WHERE code = ?', [String(code)]);
    const sv = stat.length && stat[0].values.length ? stat[0].values[0] : [0, null, null];
    d.run('INSERT OR REPLACE INTO kline_stats(code,barCount,firstDate,latestDate,updatedAt) VALUES(?,?,?,?,?)', [String(code), Number(sv[0]) || 0, sv[1], sv[2], new Date().toISOString()]);
    d.run('COMMIT');
    dirtyWrites += 1;
    if (dirtyWrites >= FLUSH_BATCH) {
      persist();
      dirtyWrites = 0;
    }
    return true;
  } catch {
    return false;
  }
}

// 返回 { code, date(抓取日期), kline:[{date,open,high,low,close,volume,amount?}] } 或 null。
async function readKline(code) {
  try {
    const d = await ensureDb();
    const res = d.exec(
      'SELECT date, open, high, low, close, volume, amount FROM kline WHERE code = ? ORDER BY date ASC',
      [String(code)]
    );
    if (!res.length || !res[0].values.length) return null;
    const rows = res[0].values.map((r) => {
      const o = { date: String(r[0]), open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] };
      if (r[6] != null) o.amount = r[6];
      return o;
    });
    let fetchDate = '';
    try {
      const meta = d.exec('SELECT date FROM kline_meta WHERE code = ?', [String(code)]);
      if (meta.length && meta[0].values.length) fetchDate = String(meta[0].values[0][0] || '');
    } catch { /* meta 缺失可容忍 */ }
    return { code: String(code), date: fetchDate || rows[rows.length - 1].date, kline: rows };
  } catch {
    return null;
  }
}

// 返回已落盘的股票代码列表（server.js 用它统计 K 线缓存数量）。
async function listKlineDates() {
  try {
    const d = await ensureDb();
    const res = d.exec('SELECT DISTINCT code FROM kline ORDER BY code');
    if (!res.length || !res[0].values.length) return [];
    return res[0].values.map((r) => String(r[0]));
  } catch {
    return [];
  }
}

// ── K线日期索引 / 缺失日补全 ──────────────────────────────

// 返回某只股票已落盘的全部日期（升序）。用于「哪天没数据就提示补全」。
async function readKlineDates(code) {
  try {
    const d = await ensureDb();
    const res = d.exec('SELECT date FROM kline WHERE code = ? ORDER BY date ASC', [String(code)]);
    if (!res.length || !res[0].values.length) return [];
    return res[0].values.map((r) => String(r[0]));
  } catch {
    return [];
  }
}

async function readKlineStats(codes = []) {
  try {
    const d = await ensureDb();
    const list = [...new Set((Array.isArray(codes) ? codes : []).map((c) => String(c).trim()).filter(Boolean))];
    if (!list.length) return [];
    const marks = list.map(() => '?').join(',');
    const res = d.exec(`SELECT s.code, s.barCount, s.firstDate, s.latestDate, m.savedAt FROM kline_stats s LEFT JOIN kline_meta m ON m.code = s.code WHERE s.code IN (${marks})`, list);
    const map = new Map();
    if (res.length) for (const row of res[0].values) map.set(String(row[0]), { code: String(row[0]), depth: Number(row[1]) || 0, firstDate: row[2] || '', latestDate: row[3] || '', savedAt: row[4] || '' });
    return list.map((code) => map.get(code) || { code, depth: 0, firstDate: '', latestDate: '', savedAt: '' });
  } catch { return []; }
}

// 返回「最近 limit 个交易日」的日期（升序），即全市场 K 线日期集合取尾部。
// 用全市场已落盘日期的并集作为交易日历，天然跳过周末/节假日；anchor 用于把
// 最新交易日锚点（如本次快照日期）纳入窗口，避免空库/数据源未回填时窗口偏短。
async function recentTradingDates(limit, { anchor = '' } = {}) {
  try {
    const d = await ensureDb();
    const res = d.exec('SELECT DISTINCT date FROM kline ORDER BY date DESC');
    const dates = res.length && res[0].values.length ? res[0].values.map((r) => String(r[0])) : [];
    const set = new Set(dates);
    if (anchor) {
      const max = dates.length ? dates[0] : '';
      if (!max || anchor >= max) set.add(anchor);
    }
    return [...set].sort().slice(-limit);
  } catch {
    return [];
  }
}

// 单票缺失日：在给定交易日窗口内，返回尚未落盘的日期（升序）。
// listDate：上市日近似（该股已落盘最早日期）；缺省时自动取已落盘最小日期。
// 窗口内早于上市日的日期视为新股/停牌前，不计入缺失，避免新股/停牌被误判为数据缺口。
async function klineGaps(code, windowDates, { listDate = '' } = {}) {
  try {
    const allDates = await readKlineDates(code);
    const have = new Set(allDates);
    const w = Array.isArray(windowDates) ? windowDates : [];
    const first = listDate || (allDates.length ? allDates[0] : '');
    const win = first ? w.filter((d) => d >= first) : w;
    return win.filter((d) => !have.has(d));
  } catch {
    return Array.isArray(windowDates) ? windowDates.slice() : [];
  }
}

// 测试/重置用：清空全部 K 线并落盘。
async function clearKlines() {
  try {
    const d = await ensureDb();
    d.run('DELETE FROM kline');
    d.run('DELETE FROM kline_meta');
    await persistAsync();
    dirtyWrites = 0;
    scheduleDataStatsRefresh();
    return true;
  } catch {
    return false;
  }
}

async function clearJudgments() {
  try {
    const d = await ensureDb();
    d.run('DELETE FROM judgment_records');
    d.run('DELETE FROM price_level_sets');
    await persistAsync();
    return true;
  } catch {
    return false;
  }
}

// 强制把所有已写入的 K 线导出到磁盘（迁移/预取结束、进程退出前调用）。
async function flush() {
  try {
    await ensureDb();
    if (dirtyWrites || !fs.existsSync(DB_FILE)) {
      persist();
      dirtyWrites = 0;
    }
    return true;
  } catch {
    return false;
  }
}

// 同步落盘：仅在内存库已加载且存在未落盘写入时导出。exit 事件回调里无法等待异步接口，
// 信号量退出（SIGINT/SIGTERM）与 process.exit 前用它兜底，避免近期写入随进程丢失。
function flushSync() {
  try {
    if (db && dirtyWrites > 0) {
      persist();
      dirtyWrites = 0;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// 批量研判在独立 Worker 中写入 sql.js 文件。sql.js 不会观察磁盘上的后续变更，
// 因此主进程在收到 Worker 的「已落库」事件后必须显式重载，才能让候选池读到最新状态。
async function reloadDbFromDisk() {
  try {
    await writeQueue;
    await getSQL();
    if (!fs.existsSync(DB_FILE)) return false;
    const next = new SQL.Database(fs.readFileSync(DB_FILE));
    const previous = db;
    db = next;
    dirtyWrites = 0;
    if (previous) previous.close();
    return true;
  } catch {
    return false;
  }
}

// 返回 K 线库完整性统计：已缓存股票数、单票最大/最小/平均深度（日）。
async function klineStats() {
  try {
    const d = await ensureDb();
    const c = d.exec('SELECT COUNT(DISTINCT code) FROM kline');
    const stockCount = c.length && c[0].values.length ? Number(c[0].values[0][0]) : 0;
    if (!stockCount) return { stockCount: 0, minDays: 0, maxDays: 0, avgDays: 0 };
    const agg = d.exec(
      'SELECT COALESCE(MIN(c),0), COALESCE(MAX(c),0), COALESCE(AVG(c),0) FROM (SELECT COUNT(*) c FROM kline GROUP BY code)'
    );
    const v = agg.length && agg[0].values.length ? agg[0].values[0] : [0, 0, 0];
    return {
      stockCount,
      minDays: Number(v[0] || 0),
      maxDays: Number(v[1] || 0),
      avgDays: Number(v[2] || 0),
    };
  } catch {
    return { stockCount: 0, minDays: 0, maxDays: 0, avgDays: 0 };
  }
}

// 统一统计快照：统计值持久化在 SQLite，查询方不再依赖目录文件数量或临时聚合。
async function refreshDataStats() {
  const d = await ensureDb();
  const q = (sql) => { const r = d.exec(sql); return r.length && r[0].values.length ? r[0].values[0][0] : 0; };
  const values = {
    klineStockCount: q('SELECT COUNT(DISTINCT code) FROM kline'),
    klineRowCount: q('SELECT COUNT(*) FROM kline'),
    klineMinDays: q('SELECT COALESCE(MIN(c),0) FROM (SELECT COUNT(*) c FROM kline GROUP BY code)'),
    klineMaxDays: q('SELECT COALESCE(MAX(c),0) FROM (SELECT COUNT(*) c FROM kline GROUP BY code)'),
    klineAvgDays: q('SELECT COALESCE(AVG(c),0) FROM (SELECT COUNT(*) c FROM kline GROUP BY code)'),
    judgmentCount: q('SELECT COUNT(*) FROM judgment_records'),
    judgmentStockCount: q('SELECT COUNT(DISTINCT code) FROM judgment_records'),
    priceLevelCount: q('SELECT COUNT(*) FROM price_level_sets'),
    priceLevelStockCount: q('SELECT COUNT(DISTINCT code) FROM price_level_sets'),
  };
  const now = new Date().toISOString();
  d.run('BEGIN');
  for (const [key, value] of Object.entries(values)) d.run('INSERT OR REPLACE INTO data_stats(statKey,statValue,updatedAt) VALUES(?,?,?)', [key, Number(value) || 0, now]);
  d.run('COMMIT');
  await persistAsync();
  return values;
}

async function getDataStats({ refresh = false } = {}) {
  const d = await ensureDb();
  if (refresh) return refreshDataStats();
  const r = d.exec('SELECT statKey, statValue FROM data_stats');
  const out = {};
  if (r.length) for (const row of r[0].values) out[String(row[0])] = Number(row[1]);
  return out;
}
async function getAiPrompt() {
  const d = await ensureDb();
  const r = d.exec('SELECT prompt, version, updatedAt FROM ai_prompt_configs WHERE id = 1');
  return r.length && r[0].values.length ? { prompt: String(r[0].values[0][0]), version: String(r[0].values[0][1]), updatedAt: String(r[0].values[0][2]) } : null;
}
async function saveAiPrompt(prompt, version = 'current') {
  const d = await ensureDb(); const value = String(prompt || '').trim();
  if (!value) return { ok: false, error: 'Prompt 不能为空' };
  const updatedAt = new Date().toISOString();
  d.run('INSERT OR REPLACE INTO ai_prompt_configs(id,prompt,version,updatedAt) VALUES(1,?,?,?)', [value, String(version), updatedAt]);
  await persistAsync(); return { ok: true, prompt: value, version: String(version), updatedAt };
}

async function getScanPreferences() {
  const d = await ensureDb();
  const r = d.exec('SELECT marketsJson, scanLimit, updatedAt FROM scan_preferences WHERE id = 1');
  if (!r.length || !r[0].values.length) return null;
  let markets = [];
  try { markets = JSON.parse(String(r[0].values[0][0])); } catch { markets = []; }
  return { markets: Array.isArray(markets) ? markets : [], scanLimit: Math.min(Math.max(Math.round(Number(r[0].values[0][1]) || 500), 1), 500), updatedAt: String(r[0].values[0][2] || '') };
}
async function saveScanPreferences(markets, scanLimit = 500) {
  const normalized = [...new Set((Array.isArray(markets) ? markets : []).filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean))];
  const normalizedLimit = Math.min(Math.max(Math.round(Number(scanLimit) || 500), 1), 500);
  const updatedAt = new Date().toISOString();
  const d = await ensureDb();
  d.run('INSERT OR REPLACE INTO scan_preferences(id,marketsJson,scanLimit,updatedAt) VALUES(1,?,?,?)', [JSON.stringify(normalized), normalizedLimit, updatedAt]);
  await persistAsync();
  return { markets: normalized, scanLimit: normalizedLimit, updatedAt };
}

// ── AI 研判记录（SQLite，追加记录，成功结果按幂等键唯一） ──────────────
function toJson(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return null; }
}

function fromJson(v) {
  if (v == null || v === '') return null;
  try { return JSON.parse(String(v)); } catch { return null; }
}

// 写入一次研判尝试。record 需含 code；成功后按幂等键 upsert 一条成功记录。
// 返回 { ok, id, code, skipped }；同一成功幂等键重复写入时跳过并返回已有 id。
// 业务口径：同一股票同一 tradeDate（研判所用 K 线截止日）只保留一份成功结论，
// 后写入的成功会覆盖当日先前成功；失败/格式异常尝试仍独立追加，便于排错续跑。
async function writeJudgmentRecordUnsafe(record) {
  try {
    const d = await ensureDb();
    const code = String((record && record.code) || '');
    if (!code) return { ok: false, id: null, code: '' };
    const idem = [
      code,
      String((record && record.evidenceHash) || ''),
      String((record && record.promptVersion) || ''),
      String((record && record.model) || ''),
    ];
    const tradeDate = String((record && record.tradeDate) || '') || null;
    let supersedeId = null;
    let supersedeLevelSetId = null;
    if ((record && record.judgmentStatus) === 'success') {
      const existing = d.exec(
        'SELECT id FROM judgment_records WHERE code = ? AND evidenceHash = ? AND promptVersion = ? AND model = ? AND judgmentStatus = \'success\'',
        idem
      );
      if (existing.length && existing[0].values.length) {
        return { ok: true, id: Number(existing[0].values[0][0]), code, skipped: true };
      }
      // 同一 code + tradeDate 已有其它成功记录时，本次为当日更新：事务内替换旧成功行。
      if (tradeDate) {
        const sameDay = d.exec(
          `SELECT id, priceLevelSetId FROM judgment_records
           WHERE code = ? AND tradeDate = ? AND judgmentStatus = 'success'
           ORDER BY id DESC LIMIT 1`,
          [code, tradeDate]
        );
        if (sameDay.length && sameDay[0].values.length) {
          supersedeId = Number(sameDay[0].values[0][0]);
          supersedeLevelSetId = sameDay[0].values[0][1] != null ? Number(sameDay[0].values[0][1]) : null;
        }
      }
    }
    const createdAt = new Date().toISOString();
    d.run('BEGIN');
    if (supersedeId != null) {
      d.run('DELETE FROM judgment_records WHERE id = ?', [supersedeId]);
      // 旧成功行若不再被任何记录引用，其观察价位集合一并清理；与本次价位相同时保留。
      if (supersedeLevelSetId != null && Number(record && record.priceLevelSetId) !== supersedeLevelSetId) {
        const refs = d.exec('SELECT COUNT(*) FROM judgment_records WHERE priceLevelSetId = ?', [String(supersedeLevelSetId)]);
        const refCount = refs.length && refs[0].values.length ? Number(refs[0].values[0][0]) : 0;
        if (refCount === 0) d.run('DELETE FROM price_level_sets WHERE id = ?', [supersedeLevelSetId]);
      }
    }
    d.run(
      `INSERT INTO judgment_records (
        batchId, code, tradeDate, marketPhase, isFinal, evidenceHash, promptVersion, model,
        priceLevelSetId, dataStatus, judgmentStatus, scoreStatus, attempt, startedAt,
        finishedAt, durationMs, errorCode, errorMessage, modelResultJson, rawText,
        usageJson, evidenceJson, createdAt
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        String((record && record.batchId) || '') || null,
        code,
        String((record && record.tradeDate) || '') || null,
        String((record && record.marketPhase) || '') || null,
        (record && record.isFinal) ? 1 : 0,
        String((record && record.evidenceHash) || '') || null,
        String((record && record.promptVersion) || '') || null,
        String((record && record.model) || '') || null,
        String((record && record.priceLevelSetId) || '') || null,
        String((record && record.dataStatus) || '') || null,
        String((record && record.judgmentStatus) || '') || null,
        String((record && record.scoreStatus) || 'none') || 'none',
        Number(record && record.attempt) || 0,
        Number(record && record.startedAt) || null,
        Number(record && record.finishedAt) || null,
        Number(record && record.durationMs) || 0,
        String((record && record.errorCode) || '') || null,
        String((record && record.errorMessage) || '') || null,
        toJson((record && record.modelResult) || null),
        String((record && record.rawContent) || '') || null,
        toJson((record && record.usage) || null),
        toJson((record && record.evidence) || null),
        createdAt,
      ]
    );
    const idRes = d.exec('SELECT last_insert_rowid()');
    d.run('COMMIT');
    const id = idRes.length && idRes[0].values.length ? Number(idRes[0].values[0][0]) : null;
    dirtyWrites += 1;
    // 研判结果是用户可见的逐票进度，事务提交后立即刷盘，进程异常时不丢已完成股票。
    await persistAsync();
    dirtyWrites = 0;
    scheduleDataStatsRefresh();
    return { ok: true, id, code, skipped: false };
  } catch {
    try { db && db.run('ROLLBACK'); } catch { /* ignore */ }
    return { ok: false, id: null, code: String((record && record.code) || '') };
  }
}

// 按 code 读取该股最近一次成功记录（供幂等跳过与二次研判对比）。
async function getLastSuccessJudgment(code) {
  try {
    const d = await ensureDb();
    const res = d.exec(
      `SELECT * FROM judgment_records
       WHERE code = ? AND judgmentStatus = 'success'
       ORDER BY id DESC LIMIT 1`,
      [String(code)]
    );
    if (!res.length || !res[0].values.length) return null;
    return rowToJudgment(res[0].columns, res[0].values[0]);
  } catch {
    return null;
  }
}

// 按 code 读取全部尝试（升序），最多 max 条。
async function listJudgmentAttempts(code, max = 500) {
  try {
    const d = await ensureDb();
    const res = d.exec(
      'SELECT * FROM judgment_records WHERE code = ? ORDER BY id DESC LIMIT ?',
      [String(code), Number(max) || 500]
    );
    if (!res.length || !res[0].values.length) return [];
    return res[0].values.map((r) => rowToJudgment(res[0].columns, r)).reverse();
  } catch {
    return [];
  }
}

function rowToJudgment(cols, row) {
  const o = {};
  cols.forEach((c, i) => {
    if (c === 'modelResultJson') o.modelResult = fromJson(row[i]);
    else if (c === 'usageJson') o.usage = fromJson(row[i]);
    else if (c === 'evidenceJson') o.evidence = fromJson(row[i]);
    else if (c === 'isFinal') o.isFinal = !!row[i];
    else if (c === 'rawText') o.rawContent = row[i];
    else o[c] = row[i];
  });
  return o;
}

// ── 观察价位集合（价格层级算法结果，SQLite，版本追加） ──────────────
async function writePriceLevelSetUnsafe(record) {
  try {
    const d = await ensureDb();
    const code = String((record && record.code) || '');
    if (!code) return { ok: false, id: null, code: '' };
    const existing = d.exec(
      'SELECT id FROM price_level_sets WHERE code = ? AND evidenceHash = ? AND algorithmVersion = ?',
      [code, String((record && record.evidenceHash) || ''), String((record && record.algorithmVersion) || '')]
    );
    if (existing.length && existing[0].values.length) {
      return { ok: true, id: Number(existing[0].values[0][0]), code, skipped: true };
    }
    const createdAt = new Date().toISOString();
    d.run('BEGIN');
    d.run(
      `INSERT INTO price_level_sets (
        code, tradeDate, evidenceHash, algorithmVersion, adjustmentType, klineDate,
        snapshotAt, supportZonesJson, resistanceZonesJson, entryTriggersJson,
        invalidationLevelJson, exitWatchZonesJson, riskRewardJson, evidenceJson, createdAt
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        code,
        String((record && record.tradeDate) || '') || null,
        String((record && record.evidenceHash) || '') || null,
        String((record && record.algorithmVersion) || '') || null,
        String((record && record.adjustmentType) || '') || null,
        String((record && record.klineDate) || '') || null,
        String((record && record.snapshotAt) || '') || null,
        toJson((record && record.supportZones) || null),
        toJson((record && record.resistanceZones) || null),
        toJson((record && record.entryTriggers) || null),
        toJson((record && record.invalidationLevel) || null),
        toJson((record && record.exitWatchZones) || null),
        toJson((record && record.riskReward) || null),
        toJson((record && record.evidence) || null),
        createdAt,
      ]
    );
    const idRes = d.exec('SELECT last_insert_rowid()');
    d.run('COMMIT');
    const id = idRes.length && idRes[0].values.length ? Number(idRes[0].values[0][0]) : null;
    dirtyWrites += 1;
    // 支撑/压力等价位与研判结果一一对应，完成计算后立即持久化。
    await persistAsync();
    dirtyWrites = 0;
    return { ok: true, id, code, skipped: false };
  } catch {
    try { db && db.run('ROLLBACK'); } catch { /* ignore */ }
    return { ok: false, id: null, code: String((record && record.code) || '') };
  }
}

// 按 code + evidenceHash + algorithmVersion 读取价位集合。
async function getPriceLevelSet(code, evidenceHash, algorithmVersion) {
  try {
    const d = await ensureDb();
    const res = d.exec(
      'SELECT * FROM price_level_sets WHERE code = ? AND evidenceHash = ? AND algorithmVersion = ? ORDER BY id DESC LIMIT 1',
      [String(code), String(evidenceHash || ''), String(algorithmVersion || '')]
    );
    if (!res.length || !res[0].values.length) return null;
    return rowToPriceLevelSet(res[0].columns, res[0].values[0]);
  } catch {
    return null;
  }
}

function rowToPriceLevelSet(cols, row) {
  const o = {};
  cols.forEach((c, i) => {
    if (c === 'supportZonesJson') o.supportZones = fromJson(row[i]);
    else if (c === 'resistanceZonesJson') o.resistanceZones = fromJson(row[i]);
    else if (c === 'entryTriggersJson') o.entryTriggers = fromJson(row[i]);
    else if (c === 'invalidationLevelJson') o.invalidationLevel = fromJson(row[i]);
    else if (c === 'exitWatchZonesJson') o.exitWatchZones = fromJson(row[i]);
    else if (c === 'riskRewardJson') o.riskReward = fromJson(row[i]);
    else if (c === 'evidenceJson') o.evidence = fromJson(row[i]);
    else o[c] = row[i];
  });
  return o;
}

// 单写入者队列：计算与 AI 调用可并发，SQLite 事务按提交顺序串行执行。
let writeQueue = Promise.resolve();
function enqueueWrite(fn, record) {
  const run = writeQueue.then(() => fn(record));
  writeQueue = run.catch(() => {});
  return run;
}

// ── 写入委托（研判 Worker 模式）────────────────────────────────────
// kline.db 是全量导出落盘的 sql.js 内存库，绝不允许两个进程同时持有写入权，
// 否则后导出的一方会用自己陈旧的内存副本整体覆盖对方刚写入的数据（历史上丢过整批判量结果）。
// 研判 Worker 进程必须通过 setWriteDelegate 把全部写操作经 IPC 转交主进程执行；
// 主进程是唯一的文件写入者，Worker 自身内存库保持只读基线。
let writeDelegate = null;
function setWriteDelegate(fn) { writeDelegate = typeof fn === 'function' ? fn : null; }
function delegateWrite(fnName, args) {
  if (!writeDelegate) return null;
  return writeDelegate(fnName, args);
}

function writeJudgmentRecord(record) {
  if (writeDelegate) return delegateWrite('writeJudgmentRecord', [record]);
  return enqueueWrite(writeJudgmentRecordUnsafe, record);
}
function writePriceLevelSet(record) {
  if (writeDelegate) return delegateWrite('writePriceLevelSet', [record]);
  return enqueueWrite(writePriceLevelSetUnsafe, record);
}
function writeMarketSentimentSnapshot(record) { return enqueueWrite(writeMarketSentimentSnapshotUnsafe, record); }

async function saveWatchRecommendationBatch(batch) {
  return enqueueWrite(async (record) => {
    const d = await ensureDb();
    d.run(`INSERT OR REPLACE INTO watch_recommendation_batches(batchId,status,total,done,succeeded,failed,snapshotJson,startedAt,finishedAt,createdAt)
      VALUES(?,?,?,?,?,?,?,?,?,?)`, [record.batchId, record.status, record.total, record.done || 0, record.succeeded || 0, record.failed || 0, toJson(record.snapshot || []), record.startedAt || Date.now(), record.finishedAt || null, new Date().toISOString()]);
    await persistAsync(); return { ok: true };
  }, batch);
}
async function saveWatchRecommendation(record) {
  return enqueueWrite(async (item) => {
    const d = await ensureDb();
    d.run(`INSERT INTO watch_recommendations(batchId,code,classification,reasonCodesJson,evidenceJson,conditionsJson,missingJson,ruleVersion,evidenceHash,status,createdAt)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`, [item.batchId, item.code, item.classification, toJson(item.reasonCodes), toJson(item.evidence), toJson(item.conditions), toJson(item.missing), item.ruleVersion, item.evidenceHash, item.status || 'success', item.createdAt || Date.now()]);
    await persistAsync(); return { ok: true };
  }, record);
}
async function latestWatchRecommendations(codes = []) {
  const d = await ensureDb(); const list = codes.filter((x) => /^\d{6}$/.test(String(x)));
  if (!list.length) return {};
  const q = d.exec(`SELECT w.* FROM watch_recommendations w JOIN (SELECT code, MAX(id) id FROM watch_recommendations WHERE code IN (${list.map(() => '?').join(',')}) GROUP BY code) x ON x.id=w.id`, list);
  const result = {};
  if (q.length) q[0].values.forEach((row) => { const o = {}; q[0].columns.forEach((c, i) => { o[c] = ['reasonCodesJson','evidenceJson','conditionsJson','missingJson'].includes(c) ? fromJson(row[i]) : row[i]; }); result[o.code] = o; });
  return result;
}

module.exports = {
  DATA_DIR, SNAP_DIR, KLINE_DIR: path.join(DATA_DIR, 'kline'), DB_FILE,
  writeSnapshot, readSnapshot, readLatestSnapshot, listSnapshotDates,
  writeMarketSnapshotBatch, writeMarketSentimentSnapshot, readMarketSentimentSnapshot, saveStockRiskPlan, getStockRiskPlans,
  writeKline, readKline, readKlineStats, listKlineDates, clearKlines, clearJudgments, flush, reloadDbFromDisk, klineStats,
  readKlineDates, recentTradingDates, klineGaps,
  writeJudgmentRecord, getLastSuccessJudgment, listJudgmentAttempts,
  writePriceLevelSet, getPriceLevelSet, refreshDataStats, getDataStats, getAiPrompt, saveAiPrompt, getScanPreferences, saveScanPreferences,
  saveWatchRecommendationBatch, saveWatchRecommendation, latestWatchRecommendations,
  setWriteDelegate, flushSync,
};
