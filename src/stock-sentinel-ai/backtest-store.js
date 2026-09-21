// 智诊盯盘 · 回测库只读访问层
// 职责边界：
//   * 回测结果（逐笔明细 / 统计 / 形态字典 / 时点网格）全部由 Python 侧写入 data/backtest.db
//     （tools/backtest_store.py，WAL + 单写者），App 只读，绝不写该文件。
//   * 实盘凭据写在 data/kline.db 的 bt_decision 表（见 storage.js），与本模块无关。
// 路径可用环境变量 SENTINEL_BACKTEST_DB 覆盖；默认与 storage.js 的 DATA_DIR 同目录。
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js/dist/sql-asm.js').default;

const DATA_DIR = process.env.VOLUME_INSIGHT_DATA_DIR
  ? path.resolve(process.env.VOLUME_INSIGHT_DATA_DIR)
  : path.join(__dirname, 'data');
// 路径在调用时解析（测试可临时改环境变量指向夹具库）。
function dbFile() {
  return process.env.SENTINEL_BACKTEST_DB
    ? path.resolve(process.env.SENTINEL_BACKTEST_DB)
    : path.join(DATA_DIR, 'backtest.db');
}

let SQL = null;
let initPromise = null;
let handle = null;          // { db, mtimeMs, size }
let modelCache = { mtimeMs: 0, size: 0, data: null };   // decision_model.json 按 mtime 缓存

async function getSQL() {
  if (!SQL) {
    initPromise = initPromise || initSqlJs();
    SQL = await initPromise;
  }
  return SQL;
}

function fileStat() {
  try {
    const st = fs.statSync(dbFile());
    return st.isFile() ? { mtimeMs: st.mtimeMs, size: st.size } : null;
  } catch {
    return null;
  }
}

function available() {
  return fileStat() !== null;
}

// 打开回测库（只读语义）。文件变化（Python 侧重建）时自动重载。
async function open() {
  const st = fileStat();
  if (!st) return null;
  if (handle && handle.mtimeMs === st.mtimeMs && handle.size === st.size) return handle.db;
  const sql = await getSQL();
  const file = dbFile();
  const db = new sql.Database(fs.readFileSync(file));
  handle = { db, file, mtimeMs: st.mtimeMs, size: st.size };
  return db;
}

function close() {
  if (handle && handle.db) {
    try { handle.db.close(); } catch { /* 已关闭 */ }
  }
  handle = null;
}

function tables(db) {
  const res = db.exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
  return res.length ? res[0].values.map((r) => String(r[0])) : [];
}

function rows(db, sql, params = []) {
  const res = db.exec(sql, params);
  if (!res.length) return [];
  const columns = res[0].columns;
  return res[0].values.map((values) => Object.fromEntries(columns.map((c, i) => [c, values[i]])));
}

// 回测批次总览：bt_run + bt_meta + 各表计数。App 用它判断「当前凭据引用的是哪个批次」。
async function summary() {
  const db = await open();
  if (!db) return { ok: false, available: false, error: '未找到回测库 data/backtest.db', dbFile: dbFile() };
  const present = tables(db);
  const counts = {};
  for (const name of ['bt_trade', 'bt_trade_tf', 'bt_stat', 'bt_pattern_def', 'bt_feature_def', 'bt_time_grid', 'bt_market_day', 'bt_sector_day']) {
    if (!present.includes(name)) continue;
    const res = db.exec(`SELECT COUNT(*) FROM ${name}`);
    counts[name] = res.length && res[0].values.length ? Number(res[0].values[0][0]) : 0;
  }
  return {
    ok: true,
    available: true,
    dbFile: dbFile(),
    tables: present,
    counts,
    meta: present.includes('bt_meta') ? Object.fromEntries(rows(db, 'SELECT key, value FROM bt_meta').map((r) => [String(r.key), String(r.value)])) : {},
    runs: present.includes('bt_run')
      ? rows(db, 'SELECT runId, runKey, createdAt, engineVersion, buyTime, sellTimeStart, sellTimeEnd, universeFilter, tradeCount, note FROM bt_run ORDER BY runId')
      : [],
  };
}

// 字段字典（250 条）：中文名、口径、单位、来源，供界面直接显示，避免前后端各写一份翻译。
async function featureDict({ tableName = null } = {}) {
  const db = await open();
  if (!db) return [];
  if (!tables(db).includes('bt_feature_def')) return [];
  const sql = 'SELECT tableName, columnName, nameCn, meaning, unit, valueScope, source, calcRule, isFeature '
    + 'FROM bt_feature_def'
    + (tableName ? ' WHERE tableName = ?' : '')
    + ' ORDER BY tableName, rowid';
  return rows(db, sql, tableName ? [String(tableName)] : []);
}

// 形态字典：既能拿日线 31 条，也能拿分钟层 108 条；usableForDecision=1 表示已达回测门槛。
async function patternDefs({ scope = null, usableOnly = false } = {}) {
  const db = await open();
  if (!db) return [];
  if (!tables(db).includes('bt_pattern_def')) return [];
  const where = [];
  const params = [];
  if (scope) { where.push('scope = ?'); params.push(String(scope)); }
  if (usableOnly) where.push('usableForDecision = 1');
  const sql = 'SELECT * FROM bt_pattern_def'
    + (where.length ? ` WHERE ${where.join(' AND ')}` : '')
    + " ORDER BY CASE scope WHEN 'day' THEN 0 ELSE 1 END, periods, priority, patternId";
  return rows(db, sql, params);
}

// 统计结果（bt_stat）：按批次 + 维度取分档，直接给出「该特征档的历史命中率」。
async function statRows({ runId = null, dimension = null } = {}) {
  const db = await open();
  if (!db) return [];
  if (!tables(db).includes('bt_stat')) return [];
  const where = [];
  const params = [];
  if (runId !== null) { where.push('runId = ?'); params.push(Number(runId)); }
  if (dimension) { where.push('dimension = ?'); params.push(String(dimension)); }
  return rows(db, `SELECT * FROM bt_stat${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY runId, dimension, bucket`, params);
}

// 买卖时点网格（bt_time_grid）：用于「14:30~14:55 买 / 09:30~10:00 卖」的时点选择。
async function timeGrid({ runId = null } = {}) {
  const db = await open();
  if (!db) return [];
  if (!tables(db).includes('bt_time_grid')) return [];
  return rows(db, `SELECT * FROM bt_time_grid${runId === null ? '' : ' WHERE runId = ?'} ORDER BY buyMinute, sellMinute`, runId === null ? [] : [Number(runId)]);
}

// 决策维度清单：界面筛选器只列出库里真实存在的维度，避免空档。
async function statDimensions() {
  const db = await open();
  if (!db) return [];
  if (!tables(db).includes('bt_stat')) return [];
  return rows(db, 'SELECT runId, dimension, COUNT(*) AS bucketCnt, MAX(sampleCnt) AS maxSample FROM bt_stat GROUP BY runId, dimension ORDER BY runId, dimension');
}

// 概率评分模型（data/backtest/decision_model.json）。
// Python 侧（tools/bt_decision_engine.py）生成，App 只读：分档系数、分年验证、
// 十分位校准、每日 Top-K 模拟与时点建议都在文件里，界面直接渲染，不重复计算。
function modelFile() {
  if (process.env.SENTINEL_DECISION_MODEL) return path.resolve(process.env.SENTINEL_DECISION_MODEL);
  // 生产默认：Python 侧 tools/bt_decision_engine.py 写的是 data/backtest/decision_model.json，
  // 已自定库路径（测试夹具等）时模型与本库同目录，故按此顺序探测，都不存在则回退首选路径便于排查。
  const candidates = [
    path.join(path.dirname(dbFile()), 'decision_model.json'),
    path.join(DATA_DIR, 'backtest', 'decision_model.json'),
  ];
  for (const candidate of candidates) {
    try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* 继续探测下一候选 */ }
  }
  return candidates[0];
}

async function decisionModel() {
  const file = modelFile();
  let st = null;
  try {
    const s = fs.statSync(file);
    if (s.isFile()) st = { mtimeMs: s.mtimeMs, size: s.size };
  } catch { st = null; }
  if (!st) {
    return { ok: false, available: false, error: '未找到概率评分模型 data/backtest/decision_model.json', modelFile: file };
  }
  if (modelCache.data && modelCache.mtimeMs === st.mtimeMs && modelCache.size === st.size) {
    return { ok: true, available: true, modelFile: file, model: modelCache.data };
  }
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    modelCache = { mtimeMs: st.mtimeMs, size: st.size, data };
    return { ok: true, available: true, modelFile: file, model: data };
  } catch (e) {
    return { ok: false, available: true, error: `概率评分模型解析失败：${e.message}`, modelFile: file };
  }
}

module.exports = {
  DATA_DIR, dbFile,
  available, open, close, summary, featureDict, patternDefs, statRows, timeGrid, statDimensions,
  modelFile, decisionModel,
};
