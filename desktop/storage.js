// 行情日报 Desktop · 每个操作系统用户独立的 SQLite 数据层
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DEFAULT_SETTINGS = { theme: 'light', refreshSec: 3, notify: false };

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
    return settings;
  }
  function setSettings(values) {
    transaction(() => Object.entries(values || {}).forEach(([key, value]) => setSetting(key, value)));
  }
  function getWatchlist() { return queryAll('SELECT code FROM watchlist ORDER BY position, code').map(row => row.code); }
  function replaceWatchlist(codes) {
    const clean = [...new Set((Array.isArray(codes) ? codes : []).filter(code => /^\d{6}$/.test(String(code))).map(String))];
    transaction(() => {
      execute('DELETE FROM watchlist');
      clean.forEach((code, position) => execute('INSERT INTO watchlist(code, position) VALUES ($code, $position)', { $code: code, $position: position }));
    });
    return clean;
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
    execute(`INSERT OR REPLACE INTO reviews(date, markdown, temperature, created_at, updated_at)
      VALUES ($date, $markdown, $temperature, COALESCE((SELECT created_at FROM reviews WHERE date = $date), CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)`, { $date: date, $markdown: String(markdown || ''), $temperature: temperature });
    persist();
  }
  function getReviewDates() { return queryAll('SELECT date, temperature, updated_at FROM reviews ORDER BY date DESC').map(row => ({ date: row.date, temperature: row.temperature, updatedAt: row.updated_at })); }

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
        const clean = [...new Set(data.watchlist.filter(code => /^\d{6}$/.test(String(code))).map(String))];
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
    getReviewDates,
    migrateLegacyFiles,
    importLegacyFrontend,
    close() { db.close(); },
  };
}

module.exports = { createStorage };
