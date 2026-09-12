// T10 回放输入装载：优先使用不可变候选/K线归档，当前候选池只保留为旧数据诊断回退。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const initSqlJs = require('sql.js/dist/sql-asm.js').default;
const { DATA_DIR, DB_FILE } = require('./storage');
const { SELECTION_ARCHIVE_DIR, ARCHIVE_DIR: KLINE_ARCHIVE_DIR } = require('./kline-archive');
const { dateOnly } = require('./selection-replay');
const { normalizeAdjustment } = require('./kline-source-contract');

const LEGACY_POOL_FILE = path.join(DATA_DIR, 'candidate-pool.json');

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith('.json') && !name.endsWith('.tmp')).sort().map((name) => path.join(dir, name));
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function digestFiles(files) {
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(path.basename(file));
    hash.update(fs.readFileSync(file));
  }
  return hash.digest('hex');
}

function loadSelectionRecords(selectionDir) {
  const files = listJsonFiles(selectionDir);
  const records = [];
  const issues = [];
  for (const file of files) {
    const payload = readJson(file);
    if (!payload || !Array.isArray(payload.records)) {
      issues.push({ code: 'selection_archive_invalid', file: path.basename(file) });
      continue;
    }
    for (const item of payload.records) records.push({ ...item, selectionBatchId: String(item.selectionBatchId || payload.batchId || '') });
  }
  return { files, records, issues };
}

function loadKlineRecords(klineDir) {
  const files = listJsonFiles(klineDir);
  const bySelectionAndCode = new Map();
  const issues = [];
  for (const file of files) {
    const payload = readJson(file);
    if (!payload || !Array.isArray(payload.records)) {
      issues.push({ code: 'kline_archive_invalid', file: path.basename(file) });
      continue;
    }
    const selectionBatchId = String(payload.selectionBatchId || '');
    for (const record of payload.records) {
      const code = String((record && record.code) || '');
      const key = `${selectionBatchId}|${code}`;
      const value = {
        archiveId: String(payload.archiveId || path.basename(file, '.json')),
        reviewBatchId: String(payload.reviewBatchId || ''),
        createdAt: String(payload.createdAt || ''),
        tradeDate: String(payload.tradeDate || ''),
        file: path.basename(file),
        record,
      };
      const current = bySelectionAndCode.get(key);
      // 同一候选批次重复复核时固定使用最早归档，避免事后重跑覆盖首次决策时点。
      const valueTime = Date.parse(value.createdAt);
      const currentTime = current ? Date.parse(current.createdAt) : NaN;
      const valueOrder = Number.isFinite(valueTime) ? valueTime : Number.POSITIVE_INFINITY;
      const currentOrder = Number.isFinite(currentTime) ? currentTime : Number.POSITIVE_INFINITY;
      if (!current || valueOrder < currentOrder || (valueOrder === currentOrder && value.file.localeCompare(current.file) < 0)) {
        bySelectionAndCode.set(key, value);
      }
    }
  }
  return { files, bySelectionAndCode, issues };
}

function queryBars(db, code) {
  const result = db.exec('SELECT date,open,high,low,close,volume,amount FROM kline WHERE code=? ORDER BY date', [code]);
  if (!result.length) return [];
  return result[0].values.map((values) => Object.fromEntries(result[0].columns.map((column, index) => [column, values[index]])));
}

function queryMeta(db, code) {
  try {
    const result = db.exec('SELECT source,adjustmentType,sourceLatestDate,fetchedAt,tailStatus,tailConfirmedAt FROM kline_meta WHERE code=? LIMIT 1', [code]);
    return result.length && result[0].values.length
      ? Object.fromEntries(result[0].columns.map((column, index) => [column, result[0].values[0][index]]))
      : {};
  } catch { return {}; }
}

function queryReviewBatchIds(db) {
  try {
    const result = db.exec('SELECT batchId FROM watch_recommendation_batches');
    return new Set(result.length ? result[0].values.map((row) => String(row[0] || '')).filter(Boolean) : []);
  } catch { return new Set(); }
}

function archiveMeta(record = {}) {
  return {
    source: String(record.source || ''),
    adjustmentType: normalizeAdjustment(record.adjustmentType),
    sourceLatestDate: String(record.sourceLatestDate || ''),
    fetchedAt: String(record.fetchedAt || ''),
    tailStatus: String(record.tailStatus || ''),
    tailConfirmedAt: String(record.tailConfirmedAt || ''),
  };
}

function confirmedFutureBars(currentBars = [], currentMeta = {}, asOf = '') {
  const bars = Array.isArray(currentBars) && asOf
    ? currentBars.filter((bar) => String((bar && bar.date) || '') > asOf)
    : [];
  if (!bars.length) return { bars: [], issues: [] };

  const status = String(currentMeta.tailStatus || '').trim().toLowerCase();
  const confirmedAt = String(currentMeta.tailConfirmedAt || '').trim();
  if (status === 'confirmed' && confirmedAt && Number.isFinite(Date.parse(confirmedAt))) {
    return { bars, issues: [] };
  }

  // 现库尾K只有后端明确确认收盘后才可进入事后观察，未知状态同样保守排除。
  const latestDate = String((currentBars[currentBars.length - 1] && currentBars[currentBars.length - 1].date) || '');
  const sourceLatestDate = String(currentMeta.sourceLatestDate || '');
  const excludedDates = new Set([latestDate]);
  const reason = status === 'provisional'
    ? 'future_kline_tail_provisional_excluded'
    : status === 'confirmed'
      ? 'future_kline_tail_confirmation_invalid'
      : 'future_kline_tail_status_unknown_excluded';
  const filtered = bars.filter((bar) => !excludedDates.has(String((bar && bar.date) || '')));
  return {
    bars: filtered,
    issues: [{
      code: reason,
      tailStatus: status || 'unknown',
      tailConfirmedAt: confirmedAt,
      sourceLatestDate,
      excludedDates: [...excludedDates].filter(Boolean).sort(),
    }],
  };
}

async function loadReplayInputs(options = {}) {
  const selectionDir = path.resolve(options.selectionDir || SELECTION_ARCHIVE_DIR);
  const klineDir = path.resolve(options.klineDir || KLINE_ARCHIVE_DIR);
  const dbFile = path.resolve(options.dbFile || DB_FILE);
  const legacyPoolFile = path.resolve(options.legacyPoolFile || LEGACY_POOL_FILE);
  const selections = loadSelectionRecords(selectionDir);
  const klines = loadKlineRecords(klineDir);
  let records = selections.records;
  let source = 'selection_archives';
  let legacyBytes = null;
  if (!selections.files.length) {
    source = 'legacy_candidate_pool';
    if (fs.existsSync(legacyPoolFile)) {
      legacyBytes = fs.readFileSync(legacyPoolFile);
      const parsed = JSON.parse(legacyBytes.toString('utf8'));
      records = Array.isArray(parsed) ? parsed : [];
    }
  }
  if (!fs.existsSync(dbFile)) throw new Error(`K线数据库不存在：${dbFile}`);
  const dbBytes = fs.readFileSync(dbFile);
  const SQL = await initSqlJs();
  const db = new SQL.Database(dbBytes);
  const samples = [];
  const issues = [...selections.issues, ...klines.issues];
  const reviewBatchIds = queryReviewBatchIds(db);
  try {
    for (const item of records) {
      const code = String((item && item.code) || '');
      const asOf = dateOnly(item && item.snapshotDate);
      const currentBars = /^\d{6}$/.test(code) ? queryBars(db, code) : [];
      const currentMeta = /^\d{6}$/.test(code) ? queryMeta(db, code) : {};
      const archived = klines.bySelectionAndCode.get(`${String(item.selectionBatchId || '')}|${code}`) || null;
      const evidenceBars = archived && Array.isArray(archived.record.bars)
        ? archived.record.bars.map((bar) => ({ ...bar }))
        : source === 'legacy_candidate_pool'
          ? currentBars.filter((bar) => !asOf || String(bar.date || '') <= asOf)
          : [];
      const meta = archived ? archiveMeta(archived.record) : currentMeta;
      const futureCompatible = Boolean(archived)
        && String(currentMeta.source || '') === String(meta.source || '')
        && normalizeAdjustment(currentMeta.adjustmentType) === normalizeAdjustment(meta.adjustmentType);
      const futureObservation = futureCompatible
        ? confirmedFutureBars(currentBars, currentMeta, asOf)
        : { bars: [], issues: [] };
      const futureCandles = futureObservation.bars;
      for (const issue of futureObservation.issues) {
        issues.push({
          ...issue,
          stockCode: code,
          selectionBatchId: String(item.selectionBatchId || ''),
          archiveId: archived ? archived.archiveId : '',
        });
      }
      if (archived && !futureCompatible && currentBars.some((bar) => String(bar.date || '') > asOf)) {
        issues.push({ code: 'future_kline_provenance_mismatch', stockCode: code, selectionBatchId: String(item.selectionBatchId || ''), archiveId: archived.archiveId });
      }
      if (source === 'selection_archives' && !archived) {
        issues.push({ code: 'kline_archive_missing_for_selection', stockCode: code, selectionBatchId: String(item.selectionBatchId || '') });
      }
      samples.push({ item, candles: evidenceBars, futureCandles, klineMeta: meta, replayArchive: archived });
    }
  } finally { db.close(); }
  return {
    source,
    samples,
    issues,
    reviewBatchIds,
    inputHashes: {
      selectionArchives: selections.files.length ? digestFiles(selections.files) : '',
      klineArchives: klines.files.length ? digestFiles(klines.files) : '',
      legacyCandidates: legacyBytes ? crypto.createHash('sha256').update(legacyBytes).digest('hex') : '',
      klineDatabase: crypto.createHash('sha256').update(dbBytes).digest('hex'),
    },
    counts: { selectionArchives: selections.files.length, klineArchives: klines.files.length, samples: samples.length },
  };
}

module.exports = {
  LEGACY_POOL_FILE,
  listJsonFiles,
  digestFiles,
  loadSelectionRecords,
  loadKlineRecords,
  queryReviewBatchIds,
  confirmedFutureBars,
  loadReplayInputs,
};
