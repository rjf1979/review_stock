// 行情日报 Desktop · 每个操作系统用户独立的 SQLite 数据层
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DEFAULT_SETTINGS = {
  theme: 'light', refreshSec: 3, notify: false,
  monitorEnabled: false, monitorOnMainClose: false, monitorWatchlist: [], monitorOpacity: 60,
  cloud_enabled: false, cloud_url: '', cloud_token: '', cloud_device_id: '', cloud_device_token: '',
};
const WATCHLIST_LIMIT = 9;
const MONITOR_LIMIT = 5;

function parseValue(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}

async function createStorage({ dbPath, legacyStatePath, legacyReviewsDir }) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const SQL = await initSqlJs({ locateFile: file => path.join(path.dirname(require.resolve('sql.js')), file) });
  let db;
  const backupPath = dbPath + '.bak';
  try {
    if (fs.existsSync(dbPath)) db = new SQL.Database(fs.readFileSync(dbPath));
    else if (fs.existsSync(backupPath)) db = new SQL.Database(fs.readFileSync(backupPath));
    else db = new SQL.Database();
  } catch (error) {
    if (fs.existsSync(backupPath)) db = new SQL.Database(fs.readFileSync(backupPath));
    else throw error;
  }

  db.run(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS watchlist (
      code TEXT PRIMARY KEY,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS market_snapshots (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      captured_at TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reviews (
      date TEXT PRIMARY KEY,
      markdown TEXT NOT NULL,
      temperature REAL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS dragon_snapshots (
      date TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  function queryAll(sql, params = {}) {
    const statement = db.prepare(sql);
    try {
      statement.bind(params);
      const rows = [];
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally { statement.free(); }
  }

  function queryOne(sql, params = {}) { return queryAll(sql, params)[0] || null; }

  function execute(sql, params = {}) {
    const statement = db.prepare(sql);
    try { statement.run(params); } finally { statement.free(); }
  }

  function persist() {
    const temporaryPath = dbPath + '.tmp';
    fs.writeFileSync(temporaryPath, Buffer.from(db.export()));
    if (fs.existsSync(dbPath)) {
      try { fs.rmSync(backupPath, { force: true }); } catch {}
      fs.renameSync(dbPath, backupPath);
    }
    fs.renameSync(temporaryPath, dbPath);
    try { fs.rmSync(backupPath, { force: true }); } catch {}
  }

  function transaction(work) {
    db.run('BEGIN');
    try { const result = work(); db.run('COMMIT'); persist(); return result; }
    catch (error) { try { db.run('ROLLBACK'); } catch {} throw error; }
  }

  const reviewColumns = new Set(queryAll('PRAGMA table_info(reviews)').map(column => column.name));
  const reviewMigrations = [
    ['payload', 'TEXT'],
    ['report_mode', 'TEXT'],
    ['quality_status', 'TEXT'],
    ['as_of', 'TEXT'],
  ];
  let reviewSchemaChanged = false;
  for (const [name, type] of reviewMigrations) {
    if (reviewColumns.has(name)) continue;
    db.run(`ALTER TABLE reviews ADD COLUMN ${name} ${type}`);
    reviewSchemaChanged = true;
  }
  if (reviewSchemaChanged) persist();

  function getMeta(key) { return queryOne('SELECT value FROM schema_meta WHERE key = $key', { $key: key })?.value || null; }
  function setMeta(key, value) { execute('INSERT OR REPLACE INTO schema_meta(key, value) VALUES ($key, $value)', { $key: key, $value: String(value) }); }
  function getSetting(key, fallback = null) {
    const row = queryOne('SELECT value FROM settings WHERE key = $key', { $key: key });
    return row ? parseValue(row.value, fallback) : fallback;
  }
  function setSetting(key, value) {
    execute('INSERT OR REPLACE INTO settings(key, value, updated_at) VALUES ($key, $value, CURRENT_TIMESTAMP)', { $key: key, $value: JSON.stringify(value) });
  }
  function getSettings() {
    const settings = { ...DEFAULT_SETTINGS };
    for (const row of queryAll('SELECT key, value FROM settings')) settings[row.key] = parseValue(row.value, row.value);
    settings.monitorEnabled = settings.monitorEnabled === true;
    settings.monitorOnMainClose = settings.monitorOnMainClose === true;
    settings.monitorWatchlist = normalizeMonitorList(settings.monitorWatchlist);
    settings.monitorOpacity = normalizeMonitorOpacity(settings.monitorOpacity);
    settings.cloud_enabled = settings.cloud_enabled === true;
    settings.cloud_url = String(settings.cloud_url || '').trim();
    settings.cloud_token = String(settings.cloud_token || '').trim();
    settings.cloud_device_id = String(settings.cloud_device_id || '').trim();
    settings.cloud_device_token = String(settings.cloud_device_token || '').trim();
    return settings;
  }
  function setSettings(values) {
    const clean = { ...(values || {}) };
    if (clean.monitorEnabled !== undefined) clean.monitorEnabled = clean.monitorEnabled === true;
    if (clean.monitorOnMainClose !== undefined) clean.monitorOnMainClose = clean.monitorOnMainClose === true;
    if (clean.monitorOpacity !== undefined) clean.monitorOpacity = normalizeMonitorOpacity(clean.monitorOpacity);
    if (clean.cloud_enabled !== undefined) clean.cloud_enabled = clean.cloud_enabled === true;
    if (clean.cloud_url !== undefined) clean.cloud_url = String(clean.cloud_url || '').trim();
    if (clean.cloud_token !== undefined) clean.cloud_token = String(clean.cloud_token || '').trim();
    if (clean.cloud_device_id !== undefined) clean.cloud_device_id = String(clean.cloud_device_id || '').trim();
    if (clean.cloud_device_token !== undefined) clean.cloud_device_token = String(clean.cloud_device_token || '').trim();
    if (clean.monitorWatchlist !== undefined) {
      const allowed = new Set(getWatchlist());
      clean.monitorWatchlist = normalizeMonitorList(clean.monitorWatchlist).filter(code => allowed.has(code));
    }
    transaction(() => Object.entries(clean).forEach(([key, value]) => setSetting(key, value)));
  }
  function getWatchlist() { return queryAll('SELECT code FROM watchlist ORDER BY position, code').map(row => row.code).slice(0, WATCHLIST_LIMIT); }
  function replaceWatchlist(codes) {
    const clean = [...new Set((Array.isArray(codes) ? codes : []).filter(code => /^\d{6}$/.test(String(code))).map(String))].slice(0, WATCHLIST_LIMIT);
    transaction(() => {
      execute('DELETE FROM watchlist');
      clean.forEach((code, position) => execute('INSERT INTO watchlist(code, position) VALUES ($code, $position)', { $code: code, $position: position }));
      setSetting('monitorWatchlist', normalizeMonitorList(getSetting('monitorWatchlist')).filter(code => clean.includes(code)));
    });
    return clean;
  }
  function normalizeMonitorList(value) {
    return [...new Set((Array.isArray(value) ? value : []).filter(code => /^\d{6}$/.test(String(code))).map(String))].slice(0, MONITOR_LIMIT);
  }
  function normalizeMonitorOpacity(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : 60;
  }
  function saveSnapshot(payload) {
    execute('INSERT OR REPLACE INTO market_snapshots(id, captured_at, payload) VALUES (1, $capturedAt, $payload)', { $capturedAt: new Date().toISOString(), $payload: JSON.stringify(payload) });
    persist();
  }
  function getSnapshot() {
    const row = queryOne('SELECT captured_at, payload FROM market_snapshots WHERE id = 1');
    if (!row) return null;
    const payload = parseValue(row.payload, null);
    return payload ? { ...payload, cachedAt: row.captured_at, fromCache: true } : null;
  }
  function saveReview(date, markdown, temperature = null) {
    execute(`INSERT OR REPLACE INTO reviews(date, markdown, temperature, payload, report_mode, quality_status, as_of, created_at, updated_at)
      VALUES ($date, $markdown, $temperature,
        (SELECT payload FROM reviews WHERE date = $date),
        (SELECT report_mode FROM reviews WHERE date = $date),
        (SELECT quality_status FROM reviews WHERE date = $date),
        (SELECT as_of FROM reviews WHERE date = $date),
        COALESCE((SELECT created_at FROM reviews WHERE date = $date), CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)`, { $date: date, $markdown: String(markdown || ''), $temperature: temperature });
    persist();
  }
  function saveReviewSnapshot(date, payload) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !payload || typeof payload !== 'object') throw new Error('复盘快照格式不正确');
    const tradeDate = payload.meta?.trade_date || payload.date;
    if (tradeDate !== date) throw new Error(`复盘交易日期不一致：${tradeDate || '缺失'} / ${date}`);
    const reportMode = payload.meta?.report_mode || 'snapshot';
    const existing = queryOne('SELECT report_mode, payload FROM reviews WHERE date = $date', { $date: date });
    if (existing?.report_mode === 'close' && reportMode !== 'close') return parseValue(existing.payload, null);
    const temperature = Number.isFinite(Number(payload.temperature?.score)) ? Number(payload.temperature.score) : null;
    const qualityStatus = payload.quality?.status || null;
    const asOf = payload.meta?.as_of || payload.generatedAt || new Date().toISOString();
    execute(`INSERT OR REPLACE INTO reviews(date, markdown, temperature, payload, report_mode, quality_status, as_of, created_at, updated_at)
      VALUES ($date, COALESCE((SELECT markdown FROM reviews WHERE date = $date), ''), $temperature, $payload, $reportMode, $qualityStatus, $asOf,
        COALESCE((SELECT created_at FROM reviews WHERE date = $date), CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)`, {
      $date: date, $temperature: temperature, $payload: JSON.stringify(payload), $reportMode: reportMode, $qualityStatus: qualityStatus, $asOf: asOf,
    });
    persist();
    return payload;
  }
  function getReviewSnapshot(date) {
    const row = queryOne('SELECT payload, report_mode, quality_status, as_of, updated_at FROM reviews WHERE date = $date', { $date: date });
    const payload = parseValue(row?.payload, null);
    return payload ? { ...payload, persisted: true, persistedAt: row.updated_at } : null;
  }
  function getReviewMarkdown(date) {
    const row = queryOne('SELECT markdown FROM reviews WHERE date = $date', { $date: date });
    return row?.markdown || null;
  }
  function getReviewDates() {
    return queryAll('SELECT date, temperature, report_mode, quality_status, as_of, updated_at FROM reviews WHERE payload IS NOT NULL ORDER BY date DESC')
      .map(row => ({ date: row.date, temperature: row.temperature, reportMode: row.report_mode, qualityStatus: row.quality_status, asOf: row.as_of, updatedAt: row.updated_at }));
  }
  function saveDragonSnapshot(date, payload) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !payload || typeof payload !== 'object' || !Array.isArray(payload.list)) throw new Error('龙虎榜快照格式不正确');
    if (payload.date && payload.date !== date) throw new Error(`龙虎榜交易日期不一致：${payload.date} / ${date}`);
    execute(`INSERT OR REPLACE INTO dragon_snapshots(date, payload, created_at, updated_at)
      VALUES ($date, $payload, COALESCE((SELECT created_at FROM dragon_snapshots WHERE date = $date), CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)`, {
      $date: date,
      $payload: JSON.stringify({ ...payload, date }),
    });
    persist();
  }
  function getDragonSnapshot(date) {
    const payload = parseValue(queryOne('SELECT payload FROM dragon_snapshots WHERE date = $date', { $date: date })?.payload, null);
    return payload?.date === date && Array.isArray(payload.list) ? payload : null;
  }
  function getHistoryEntries() {
    const reviews = new Map(getReviewDates().map(item => [item.date, {
      date: item.date,
      review: { ...item, temperatureLevel: null, up: null, down: null, flat: null, limitUpCount: null, limitDownCount: null },
      dragon: null,
    }]));
    for (const row of queryAll('SELECT date, payload FROM reviews WHERE payload IS NOT NULL')) {
      const entry = reviews.get(row.date);
      if (!entry?.review) continue;
      const payload = parseValue(row.payload, null);
      if (!payload) continue;
      entry.review.temperatureLevel = payload.temperature?.level || null;
      entry.review.up = Number.isFinite(Number(payload.breadth?.up)) ? Number(payload.breadth.up) : null;
      entry.review.down = Number.isFinite(Number(payload.breadth?.down)) ? Number(payload.breadth.down) : null;
      entry.review.flat = Number.isFinite(Number(payload.breadth?.flat)) ? Number(payload.breadth.flat) : null;
      entry.review.limitUpCount = Number.isFinite(Number(payload.limitUpCount)) ? Number(payload.limitUpCount) : null;
      entry.review.limitDownCount = Number.isFinite(Number(payload.limitDownCount)) ? Number(payload.limitDownCount) : null;
    }
    for (const row of queryAll('SELECT date, updated_at FROM dragon_snapshots ORDER BY date DESC')) {
      const entry = reviews.get(row.date) || { date: row.date, review: null, dragon: null };
      entry.dragon = { updatedAt: row.updated_at };
      reviews.set(row.date, entry);
    }
    return [...reviews.values()].sort((left, right) => right.date.localeCompare(left.date));
  }

  function migrateLegacyFiles() {
    if (getMeta('legacy_files_v1')) return false;
    const state = (() => {
      try { return JSON.parse(fs.readFileSync(legacyStatePath, 'utf8')); } catch { return {}; }
    })();
    const files = fs.existsSync(legacyReviewsDir) ? fs.readdirSync(legacyReviewsDir) : [];
    transaction(() => {
      if (state.notifyEnabled !== undefined) setSetting('notify', state.notifyEnabled === true);
      if (state.lastReviewDate) setSetting('lastReviewDate', state.lastReviewDate);
      for (const file of files) {
        const match = /^(\d{4}-\d{2}-\d{2})-analysis\.md$/.exec(file);
        if (!match) continue;
        const markdown = fs.readFileSync(path.join(legacyReviewsDir, file), 'utf8');
        execute(`INSERT OR IGNORE INTO reviews(date, markdown) VALUES ($date, $markdown)`, { $date: match[1], $markdown: markdown });
      }
      setMeta('legacy_files_v1', new Date().toISOString());
    });
    return true;
  }

  function importLegacyFrontend(data) {
    if (getMeta('legacy_frontend_v1')) return false;
    transaction(() => {
      if (!queryOne('SELECT key FROM settings WHERE key = $key', { $key: 'theme' }) && ['light', 'dark'].includes(data?.theme)) setSetting('theme', data.theme);
      if (!queryOne('SELECT key FROM settings WHERE key = $key', { $key: 'refreshSec' }) && [0, 3, 5, 10].includes(Number(data?.refreshSec))) setSetting('refreshSec', Number(data.refreshSec));
      if (!queryOne('SELECT key FROM settings WHERE key = $key', { $key: 'notify' }) && typeof data?.notify === 'boolean') setSetting('notify', data.notify);
      if (!getWatchlist().length && Array.isArray(data?.watchlist)) {
        const clean = [...new Set(data.watchlist.filter(code => /^\d{6}$/.test(String(code))).map(String))].slice(0, WATCHLIST_LIMIT);
        clean.forEach((code, position) => execute('INSERT OR IGNORE INTO watchlist(code, position) VALUES ($code, $position)', { $code: code, $position: position }));
      }
      setMeta('legacy_frontend_v1', new Date().toISOString());
    });
    return true;
  }

  return {
    dbPath,
    getSetting,
    setSettings,
    getSettings,
    getWatchlist,
    replaceWatchlist,
    saveSnapshot,
    getSnapshot,
    saveReview,
    saveReviewSnapshot,
    getReviewSnapshot,
    getReviewMarkdown,
    getReviewDates,
    saveDragonSnapshot,
    getDragonSnapshot,
    getHistoryEntries,
    migrateLegacyFiles,
    importLegacyFrontend,
    close() { db.close(); },
  };
}

module.exports = { createStorage };
