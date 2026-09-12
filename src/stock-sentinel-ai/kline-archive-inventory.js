// 智诊盯盘 · 历史批次覆盖盘点（第十五阶段 D15-03）
//
// 只读汇总五类证据的交易日、批次数、样本数与缺失原因，输出机器可读 JSON。
// 硬约束：
// - 全程只读：不写入、不修复、不覆盖任何归档；SQLite 只按磁盘字节查询，不初始化 schema、不导出数据库。
// - 只回答「有没有证据、缺什么」，不得据此输出胜率、收益结论或参数建议。
const fs = require('fs');
const path = require('path');
const { DATA_DIR, DB_FILE } = require('./storage');
const { verifyKlineVersionArchive, listKlineVersionArchives, SELECTION_ARCHIVE_DIR } = require('./kline-archive');

const PRESCAN_ARCHIVE_DIR = path.join(DATA_DIR, 'market-prescan-archive');
const KLINE_ARCHIVE_DIR = path.join(DATA_DIR, 'kline-archive');
const JUDGMENTS_FILE = path.join(DATA_DIR, 'judgments.json');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json') && !name.endsWith('.tmp'))
    .sort()
    .map((name) => path.join(dir, name));
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function emptySection(dir, extra = {}) {
  return { dir, exists: fs.existsSync(dir), batchCount: 0, sampleCount: 0, batches: [], byDate: {}, missing: [], ...extra };
}

function pushMissing(section, reason, example) {
  const found = section.missing.find((item) => item.reason === reason);
  if (found) { found.count += 1; if (found.examples.length < 5 && example) found.examples.push(example); return; }
  section.missing.push({ reason, count: 1, examples: example ? [example] : [] });
}

// ── 市场预扫描归档 ────────────────────────────────────────────────
function inventoryPrescan(dir = PRESCAN_ARCHIVE_DIR) {
  const section = emptySection(dir);
  for (const file of listJsonFiles(dir)) {
    const id = path.basename(file, '.json');
    const payload = readJson(file);
    if (!payload) { pushMissing(section, 'archive_json_invalid', id); continue; }
    const prescan = payload.prescan || {};
    const batchId = String(prescan.batchId || id);
    const date = String(prescan.asOf || (payload.snapshot && payload.snapshot.snapshotDate) || '');
    if (!batchId) pushMissing(section, 'batch_id_missing', id);
    if (!DATE_RE.test(date)) pushMissing(section, 'trade_date_missing', batchId);
    const records = payload.snapshot && Array.isArray(payload.snapshot.records) ? payload.snapshot.records.length : 0;
    const rawEvidence = payload.rawEvidence || {};
    let attachment = '';
    if (!rawEvidence.file) pushMissing(section, 'attachment_reference_missing', batchId);
    else {
      attachment = path.join(path.dirname(file), rawEvidence.file);
      if (!fs.existsSync(attachment)) pushMissing(section, 'attachment_missing', batchId);
    }
    if (!prescan.sourceEvidence || !prescan.sourceEvidence.sentimentPools) pushMissing(section, 'sentiment_evidence_missing', batchId);
    if (!Array.isArray(prescan.themeMembership) && !prescan.themeMembership) pushMissing(section, 'theme_membership_missing', batchId);
    section.batches.push({
      batchId, date: DATE_RE.test(date) ? date : '', records, bytes: fs.statSync(file).size,
      attachment: attachment ? path.basename(attachment) : '',
      focusThemes: Array.isArray(prescan.focusThemes) ? prescan.focusThemes.length : 0,
      focusConcepts: Array.isArray(prescan.focusConcepts) ? prescan.focusConcepts.length : 0,
    });
    section.sampleCount += records;
    section.byDate[date || 'unknown'] = (section.byDate[date || 'unknown'] || 0) + 1;
  }
  section.batchCount = section.batches.length;
  return section;
}

// ── 候选批次归档 ──────────────────────────────────────────────────
function inventorySelection(dir = SELECTION_ARCHIVE_DIR) {
  const section = emptySection(dir);
  for (const file of listJsonFiles(dir)) {
    const id = path.basename(file, '.json');
    const payload = readJson(file);
    if (!payload) { pushMissing(section, 'archive_json_invalid', id); continue; }
    const records = Array.isArray(payload.records) ? payload.records : [];
    const batchId = String(payload.batchId || id);
    const versions = [...new Set(records.map((row) => Number(row && row.selectionContractVersion)).filter((value) => Number.isFinite(value)))];
    if (!batchId) pushMissing(section, 'batch_id_missing', id);
    if (!records.length) pushMissing(section, 'no_records', batchId);
    if (!versions.length) pushMissing(section, 'contract_version_missing', batchId);
    else if (versions.some((value) => value !== 3)) pushMissing(section, 'contract_version_unsupported', batchId);
    const date = String((records[0] && records[0].snapshotDate) || '');
    if (!DATE_RE.test(date)) pushMissing(section, 'trade_date_missing', batchId);
    else if (records.some((row) => String((row && row.snapshotDate) || '') !== date)) pushMissing(section, 'trade_date_mixed', batchId);
    section.batches.push({ batchId, date, records: records.length, bytes: fs.statSync(file).size, contractVersions: versions });
    section.sampleCount += records.length;
    section.byDate[date || 'unknown'] = (section.byDate[date || 'unknown'] || 0) + 1;
  }
  section.batchCount = section.batches.length;
  return section;
}

// ── K线版本归档（按归档内批次分别校验） ──────────────────────────
async function inventoryKlineArchive(dir = KLINE_ARCHIVE_DIR, { verify = true, reviewBatchReader = null, selectionArchiveDir = null } = {}) {
  const section = emptySection(dir, { statusCounts: { complete: 0, incomplete: 0, corrupt: 0 }, verified: false });
  const listed = listKlineVersionArchives({ archiveDir: dir });
  for (const item of listed) {
    const entry = {
      archiveId: item.archiveId, selectionBatchId: item.selectionBatchId || '', reviewBatchId: item.reviewBatchId || '',
      date: item.tradeDate || '', records: item.recordCount || 0, bytes: item.bytes, status: item.readOk ? 'unverified' : 'corrupt',
    };
    if (!item.readOk) pushMissing(section, 'archive_json_invalid', item.archiveId);
    if (verify) {
      const verifyOptions = { archiveDir: dir, reviewBatchReader };
      if (selectionArchiveDir) verifyOptions.selectionArchiveDir = selectionArchiveDir;
      const result = await verifyKlineVersionArchive(item.file, verifyOptions);
      entry.status = result.status;
      entry.issueCodes = [...new Set(result.issues.map((issue) => issue.code))];
      for (const issue of result.issues) pushMissing(section, issue.code, item.archiveId);
    }
    section.statusCounts[entry.status] = (section.statusCounts[entry.status] || 0) + 1;
    section.batches.push(entry);
    section.sampleCount += entry.records;
    if (DATE_RE.test(entry.date)) section.byDate[entry.date] = (section.byDate[entry.date] || 0) + 1;
  }
  section.verified = verify;
  section.batchCount = listed.length;
  return section;
}

// ── 复核批次（SQLite 只读字节查询） ──────────────────────────────
async function inventoryReview({ dbFile = DB_FILE, reader = null } = {}) {
  const section = emptySection(path.dirname(dbFile), { source: 'watch_recommendation_batches', available: false, statusCounts: {} });
  let rows = null;
  if (typeof reader === 'function') rows = await reader();
  else if (fs.existsSync(dbFile)) {
    try {
      const initSqlJs = require('sql.js/dist/sql-asm.js').default;
      const SQL = await initSqlJs();
      const db = new SQL.Database(fs.readFileSync(dbFile));
      try {
        const q = db.exec('SELECT batchId,status,total,done,succeeded,failed,startedAt,finishedAt,createdAt FROM watch_recommendation_batches ORDER BY COALESCE(finishedAt, startedAt, 0) DESC');
        rows = q.length ? q[0].values.map((row) => Object.fromEntries(q[0].columns.map((column, index) => [column, row[index]]))) : [];
      } finally { db.close(); }
    } catch { rows = null; }
  }
  if (!Array.isArray(rows)) { pushMissing(section, 'review_storage_unavailable', path.basename(dbFile)); return section; }
  section.available = true;
  for (const row of rows) {
    const status = String(row.status || 'unknown');
    const startedAt = Number(row.startedAt) || 0;
    const date = startedAt ? new Date(startedAt).toISOString().slice(0, 10) : '';
    section.statusCounts[status] = (section.statusCounts[status] || 0) + 1;
    if (status === 'running') pushMissing(section, 'review_batch_interrupted', String(row.batchId || ''));
    if (!date) pushMissing(section, 'batch_start_time_missing', String(row.batchId || ''));
    section.batches.push({
      batchId: String(row.batchId || ''), date, status, total: Number(row.total) || 0, done: Number(row.done) || 0,
      succeeded: Number(row.succeeded) || 0, failed: Number(row.failed) || 0,
    });
    section.sampleCount += Number(row.total) || 0;
    if (date) section.byDate[date] = (section.byDate[date] || 0) + 1;
  }
  section.batchCount = rows.length;
  return section;
}

// ── AI 研判批次（JSON 只读） ──────────────────────────────────────
function inventoryAiBatches({ file = JUDGMENTS_FILE } = {}) {
  const section = emptySection(path.dirname(file), { source: 'judgments.json', available: false, statusCounts: {} });
  if (!fs.existsSync(file)) { pushMissing(section, 'ai_batch_storage_missing', path.basename(file)); return section; }
  const payload = readJson(file);
  if (!payload || typeof payload !== 'object') { pushMissing(section, 'ai_batch_json_invalid', path.basename(file)); return section; }
  section.available = true;
  const batches = payload.batches && typeof payload.batches === 'object' ? Object.values(payload.batches) : [];
  for (const batch of batches) {
    const status = Number(batch && batch.finishedAt) > 0 ? String(batch.reason || 'completed') : 'running';
    const startedAt = Number(batch && batch.startedAt) || 0;
    const date = startedAt ? new Date(startedAt).toISOString().slice(0, 10) : '';
    section.statusCounts[status] = (section.statusCounts[status] || 0) + 1;
    if (status === 'running') pushMissing(section, 'ai_batch_interrupted', String((batch && batch.batchId) || ''));
    if (!date) pushMissing(section, 'batch_start_time_missing', String((batch && batch.batchId) || ''));
    section.batches.push({ batchId: String((batch && batch.batchId) || ''), date, status, total: Number(batch && batch.total) || 0, done: Number(batch && batch.done) || 0 });
    section.sampleCount += Number(batch && batch.total) || 0;
    if (date) section.byDate[date] = (section.byDate[date] || 0) + 1;
  }
  section.batchCount = batches.length;
  return section;
}

function buildTradingDateCoverage(sections) {
  const dates = new Map();
  const touch = (date, name, count) => {
    if (!DATE_RE.test(String(date || ''))) return;
    if (!dates.has(date)) dates.set(date, { date, sections: {}, batchCount: 0, sampleCount: 0 });
    const item = dates.get(date);
    item.sections[name] = (item.sections[name] || 0) + count;
    item.batchCount += count;
  };
  for (const [name, section] of Object.entries(sections)) {
    for (const batch of section.batches) {
      const samples = name === 'marketPrescan' || name === 'selection' || name === 'kline' ? batch.records : batch.total;
      touch(batch.date, name, 1);
      const item = dates.get(batch.date);
      if (item) item.sampleCount += Number(samples) || 0;
    }
  }
  const list = [...dates.values()].sort((left, right) => left.date.localeCompare(right.date));
  return { count: list.length, dates: list };
}

async function inventorySelectionArchives(options = {}) {
  const review = await inventoryReview({ dbFile: options.dbFile || DB_FILE, reader: options.reviewBatchReaderRows || null });
  const reviewIds = new Set(review.batches.map((batch) => String(batch.batchId || '')).filter(Boolean));
  const sections = {
    marketPrescan: inventoryPrescan(options.prescanDir || PRESCAN_ARCHIVE_DIR),
    selection: inventorySelection(options.selectionDir || SELECTION_ARCHIVE_DIR),
    kline: await inventoryKlineArchive(options.klineDir || KLINE_ARCHIVE_DIR, {
      verify: options.verifyKline !== false,
      reviewBatchReader: options.reviewBatchReader || (async (batchId) => reviewIds.has(String(batchId || ''))),
      selectionArchiveDir: options.selectionDir || SELECTION_ARCHIVE_DIR,
    }),
    review,
    aiJudgment: inventoryAiBatches({ file: options.judgmentFile || JUDGMENTS_FILE }),
  };
  const klineSelectionIds = new Set(sections.kline.batches.map((batch) => String(batch.selectionBatchId || '')).filter(Boolean));
  const klineReviewIds = new Set(sections.kline.batches.map((batch) => String(batch.reviewBatchId || '')).filter(Boolean));
  for (const batch of sections.selection.batches) {
    if (!klineSelectionIds.has(String(batch.batchId || ''))) pushMissing(sections.selection, 'kline_archive_missing', batch.batchId);
  }
  for (const batch of sections.review.batches) {
    if (batch.status === 'completed' && !klineReviewIds.has(String(batch.batchId || ''))) pushMissing(sections.review, 'kline_archive_missing', batch.batchId);
  }
  const missingReasons = new Map();
  for (const [name, section] of Object.entries(sections)) {
    for (const item of section.missing) {
      const key = `${name}:${item.reason}`;
      const found = missingReasons.get(key);
      if (found) found.count += item.count;
      else missingReasons.set(key, { section: name, reason: item.reason, count: item.count, examples: item.examples.slice() });
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    mode: 'read_only_inventory',
    dataDir: options.dataDir || DATA_DIR,
    scope: '已归档证据的覆盖情况，不代表完整市场全集',
    disclaimer: '本盘点只统计证据覆盖与缺失原因，不输出胜率、收益结论或参数建议；缺证据的批次一律标记缺失，不用推断补齐。',
    tradingDates: buildTradingDateCoverage(sections),
    sections,
    missingReasons: [...missingReasons.values()].sort((left, right) => right.count - left.count),
  };
}

module.exports = {
  PRESCAN_ARCHIVE_DIR,
  KLINE_ARCHIVE_DIR,
  JUDGMENTS_FILE,
  inventoryPrescan,
  inventorySelection,
  inventoryKlineArchive,
  inventoryReview,
  inventoryAiBatches,
  buildTradingDateCoverage,
  inventorySelectionArchives,
};
