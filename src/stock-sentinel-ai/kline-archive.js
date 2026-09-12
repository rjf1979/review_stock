// 智诊盯盘 · K线版本不可变归档（第十五阶段 D15-01 / D15-02）
//
// 目的：把「某候选/复核批次当时实际使用的 K 线版本」按内容冻结下来，供日后回放核对。
// 归档记录内容哈希、来源、复权口径、源最新日期、抓取时间、尾K状态与确认时间；
// 同一归档ID已存在时绝不覆盖（与 market-prescan-archive / selection-archive 同一口径）。
//
// 硬约束：
// - 只为未来批次建立机制，不回填旧数据，不把「当前 K 线」冒充历史版本。
// - 复权口径只按 kline-source-contract 的可验证声明判定，未知口径不得写成 qfq。
// - 校验只读，不修复、不回写归档内容。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./storage');
const { klineFingerprint } = require('./recommendation-validity');
const { normalizeAdjustment, isAdjustmentCorroborated, adjustmentLabel } = require('./kline-source-contract');
const { normalizeTailStatus, TAIL_STATUS } = require('./kline-tail-status');

const ARCHIVE_VERSION = 'kline-archive-v1';
const ARCHIVE_DIR = path.join(DATA_DIR, 'kline-archive');
const SELECTION_ARCHIVE_DIR = path.join(DATA_DIR, 'selection-archive');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function safeFilePart(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120) || 'archive';
}

function validDate(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  const time = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === text ? text : '';
}

function validTimestamp(value) {
  const text = String(value || '').trim();
  return text && Number.isFinite(Date.parse(text)) ? text : '';
}

function shanghaiDate(value) {
  const timestamp = validTimestamp(value);
  if (!timestamp) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(timestamp));
}

// 归档路径解析：既接受归档ID，也接受主归档绝对/相对路径（与预扫描校验工具一致）。
function archiveFileFor(input, archiveDir) {
  const value = String(input || '').trim();
  if (!value) return '';
  if (path.isAbsolute(value) || path.dirname(value) !== '.') return path.resolve(value);
  return path.join(archiveDir, `${safeFilePart(value.replace(/\.json$/i, ''))}.json`);
}

// 归一化 K 线：只保留字段完整的有效 bar，按日期去重升序；无效行不参与哈希与深度。
function normalizeBars(bars) {
  const byDate = new Map();
  let invalid = 0;
  for (const bar of Array.isArray(bars) ? bars : []) {
    const date = String((bar && bar.date) || '');
    const open = Number(bar && bar.open), high = Number(bar && bar.high), low = Number(bar && bar.low), close = Number(bar && bar.close);
    if (!validDate(date) || ![open, high, low, close].every(Number.isFinite) || !(open > 0 && high > 0 && low > 0 && close > 0)) { invalid += 1; continue; }
    const volume = bar.volume == null || String(bar.volume).trim() === '' ? null : Number(bar.volume);
    if (volume == null || !Number.isFinite(volume) || volume < 0) { invalid += 1; continue; }
    const item = { date, open, high, low, close, volume };
    if (bar.amount != null && String(bar.amount).trim() !== '' && Number.isFinite(Number(bar.amount))) item.amount = Number(bar.amount);
    byDate.set(date, item);
  }
  const rows = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  return { bars: rows, invalid, duplicates: Math.max(0, (Array.isArray(bars) ? bars.length : 0) - invalid - rows.length) };
}

// 由「K线序列 + 元数据」构造一条归档记录。元数据缺失时留空，不用当前时间或序列日期冒充。
function buildRecord({ code, bars = null, meta = {}, contentHash = '', evidenceAt = '' } = {}) {
  const normalized = bars ? normalizeBars(bars) : null;
  const rows = normalized ? normalized.bars : null;
  const latest = rows && rows.length ? rows[rows.length - 1].date : '';
  const first = rows && rows.length ? rows[0].date : '';
  return {
    code: String(code || ''),
    depth: rows ? rows.length : Number(meta.depth) || 0,
    firstDate: first || String(meta.firstDate || ''),
    latestDate: latest || String(meta.latestDate || ''),
    invalidBars: normalized ? normalized.invalid : Number(meta.invalidBars) || 0,
    duplicateDates: normalized ? normalized.duplicates : Number(meta.duplicateDates) || 0,
    contentHash: rows ? klineFingerprint(rows) : String(contentHash || ''),
    source: String(meta.source || ''),
    adjustmentType: normalizeAdjustment(meta.adjustmentType),
    adjustmentDeclaredBySource: normalizeAdjustment(meta.adjustmentType),
    sourceLatestDate: String(meta.sourceLatestDate || ''),
    fetchedAt: String(meta.fetchedAt || ''),
    tailStatus: normalizeTailStatus(meta.tailStatus),
    tailConfirmedAt: String(meta.tailConfirmedAt || ''),
    evidenceAt: String(evidenceAt || meta.fetchedAt || meta.savedAt || ''),
    bars: rows || undefined,
  };
}

// 写入不可变归档。同一归档ID已存在时返回 skipped，不覆盖原文件。
function archiveKlineVersion({
  archiveId, selectionBatchId = '', reviewBatchId = '', tradeDate = '', records = [], note = '', archiveDir = ARCHIVE_DIR,
} = {}) {
  const id = String(archiveId || '').trim();
  if (!id) return { ok: false, error: '缺少K线归档ID' };
  if (!Array.isArray(records)) return { ok: false, error: 'records 必须为数组' };
  try {
    const dir = path.resolve(archiveDir);
    ensureDir(dir);
    const file = path.join(dir, `${safeFilePart(id)}.json`);
    const payload = {
      archiveVersion: ARCHIVE_VERSION,
      archiveId: id,
      selectionBatchId: String(selectionBatchId || ''),
      reviewBatchId: String(reviewBatchId || ''),
      tradeDate: validDate(tradeDate),
      createdAt: new Date().toISOString(),
      note: String(note || ''),
      records: records.map((record) => ({ ...record })),
    };
    if (fs.existsSync(file)) return existingArchiveResult(file, payload, id);
    const temp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(payload, null, 2), 'utf8');
    try {
      // hard-link 以“目标不存在”为前提原子发布；并发写同一ID时只有一个调用能成功。
      fs.linkSync(temp, file);
    } catch (error) {
      if (fs.existsSync(file)) return existingArchiveResult(file, payload, id);
      throw error;
    } finally {
      try { fs.unlinkSync(temp); } catch { /* 临时文件清理由后续盘点忽略 */ }
    }
    return { ok: true, skipped: false, file, archiveId: id, records: payload.records.length };
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) };
  }
}

// 从本地K线库读取指定股票并归档（K线版本由存储层元数据决定，不做任何复权换算）。
async function archiveFromStorage(codes, options = {}) {
  const { readKline } = require('./storage');
  const list = [...new Set((Array.isArray(codes) ? codes : []).map((x) => String(x || '').trim()).filter((x) => /^\d{6}$/.test(x)))];
  if (!list.length) return { ok: false, error: '没有可归档的股票代码' };
  const includeBars = options.includeBars !== false;
  const records = [];
  const missing = [];
  for (const code of list) {
    const record = await readKline(code);
    const bars = record && Array.isArray(record.kline) ? record.kline : [];
    if (!record || !bars.length) { missing.push({ code, reason: 'no_local_kline' }); continue; }
    records.push(buildRecord({
      code,
      bars: includeBars ? bars : null,
      meta: {
        source: record.source, adjustmentType: record.adjustmentType, sourceLatestDate: record.sourceLatestDate,
        fetchedAt: record.fetchedAt, savedAt: record.savedAt, tailStatus: record.tailStatus, tailConfirmedAt: record.tailConfirmedAt,
      },
      contentHash: includeBars ? '' : klineFingerprint(bars),
    }));
  }
  if (!records.length) return { ok: false, error: '没有本地K线可供归档', missing };
  const tradeDate = options.tradeDate
    || records.map((x) => x.latestDate).filter(Boolean).sort().at(-1) || '';
  const archived = archiveKlineVersion({ ...options, tradeDate, records });
  return { ...archived, missing };
}

function readKlineVersionArchive(input, { archiveDir = ARCHIVE_DIR } = {}) {
  const file = archiveFileFor(input, path.resolve(archiveDir));
  if (!file || !fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? { ...parsed, file } : null;
  } catch {
    return null;
  }
}

function addIssue(issues, severity, code, message, extra = {}) {
  issues.push({ severity, code, message, ...extra });
}

function archiveIdentity(payload) {
  return JSON.stringify({
    archiveVersion: payload && payload.archiveVersion,
    archiveId: payload && payload.archiveId,
    selectionBatchId: payload && payload.selectionBatchId,
    reviewBatchId: payload && payload.reviewBatchId,
    tradeDate: payload && payload.tradeDate,
    records: (Array.isArray(payload && payload.records) ? payload.records : []).map((record) => ({
      code: record && record.code,
      contentHash: record && record.contentHash,
      source: record && record.source,
      adjustmentType: normalizeAdjustment(record && record.adjustmentType),
      latestDate: record && record.latestDate,
      depth: record && record.depth,
      tailStatus: normalizeTailStatus(record && record.tailStatus),
      tailConfirmedAt: record && record.tailConfirmedAt,
    })),
  });
}

function existingArchiveResult(file, payload, id) {
  try {
    const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (archiveIdentity(existing) === archiveIdentity(payload)) {
      return { ok: true, skipped: true, file, archiveId: id };
    }
  } catch { /* 损坏的既有文件同样属于冲突，绝不覆盖 */ }
  return { ok: false, skipped: false, conflict: true, code: 'KLINE_ARCHIVE_CONFLICT', file, archiveId: id, error: '同一K线归档ID已存在不同版本，拒绝覆盖' };
}

// 归档链接：默认核对同批次的候选归档是否存在；复核批次可注入 reader 复核。
async function verifyBatchLinks(payload, issues, options) {
  const selectionBatchId = String(payload.selectionBatchId || '');
  const selectionDir = path.resolve(options.selectionArchiveDir || SELECTION_ARCHIVE_DIR);
  if (selectionBatchId) {
    const file = path.join(selectionDir, `${safeFilePart(selectionBatchId)}.json`);
    if (!fs.existsSync(file)) addIssue(issues, 'incomplete', 'selection_batch_unlinked', `候选批次 ${selectionBatchId} 缺少候选归档，K线版本无法回链到入池批次`);
    else {
      try {
        const selection = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (String(selection.batchId || '') !== selectionBatchId) {
          addIssue(issues, 'corrupt', 'selection_batch_id_mismatch', `候选归档ID与K线归档关联的批次 ${selectionBatchId} 不一致`);
        }
        const rows = Array.isArray(selection.records) ? selection.records : [];
        const codes = new Set(rows.map((row) => String((row && row.code) || '')));
        const dates = new Set(rows.map((row) => String((row && row.snapshotDate) || '')).filter(Boolean));
        for (const record of Array.isArray(payload.records) ? payload.records : []) {
          if (!codes.has(String((record && record.code) || ''))) {
            addIssue(issues, 'incomplete', 'selection_record_unlinked', `K线记录 ${String((record && record.code) || '')} 不在候选批次 ${selectionBatchId} 的归档中`);
          }
        }
        if (!dates.size) addIssue(issues, 'incomplete', 'selection_trade_date_missing', `候选批次 ${selectionBatchId} 缺少交易日`);
        else if (dates.size !== 1 || !dates.has(String(payload.tradeDate || ''))) {
          addIssue(issues, 'corrupt', 'selection_trade_date_mismatch', `候选批次 ${selectionBatchId} 的交易日与K线归档不一致`);
        }
      } catch {
        addIssue(issues, 'corrupt', 'selection_archive_invalid', `候选批次 ${selectionBatchId} 的归档无法解析`);
      }
    }
  }
  const reviewBatchId = String(payload.reviewBatchId || '');
  if (!reviewBatchId) addIssue(issues, 'incomplete', 'review_batch_id_missing', 'K线版本归档缺少复核批次ID');
  else {
    if (typeof options.reviewBatchReader !== 'function') {
      addIssue(issues, 'incomplete', 'review_batch_unverified', `未提供复核批次读取器，无法验证 ${reviewBatchId} 的回链`);
    } else {
      const found = await options.reviewBatchReader(reviewBatchId);
      if (!found) addIssue(issues, 'incomplete', 'review_batch_unlinked', `复核批次 ${reviewBatchId} 在复核归档中不存在`);
    }
  }
}

async function verifyKlineVersionArchive(input, options = {}) {
  const archiveDir = path.resolve(options.archiveDir || ARCHIVE_DIR);
  const file = archiveFileFor(input, archiveDir);
  const issues = [];
  const result = {
    status: 'incomplete', archiveId: '', file, selectionBatchId: '', reviewBatchId: '', tradeDate: '',
    hashes: {}, counts: { records: 0, verified: 0, corrupt: 0, incomplete: 0 }, issues,
  };
  if (!file || !fs.existsSync(file)) {
    addIssue(issues, 'incomplete', 'archive_missing', 'K线版本归档不存在');
    return result;
  }
  const bytes = fs.readFileSync(file);
  result.hashes.fileSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  let payload;
  try { payload = JSON.parse(bytes.toString('utf8')); }
  catch {
    addIssue(issues, 'corrupt', 'archive_json_invalid', 'K线版本归档不是有效 JSON');
    return { ...result, status: 'corrupt' };
  }
  result.archiveId = String(payload.archiveId || '');
  result.selectionBatchId = String(payload.selectionBatchId || '');
  result.reviewBatchId = String(payload.reviewBatchId || '');
  result.tradeDate = String(payload.tradeDate || '');
  if (payload.archiveVersion !== ARCHIVE_VERSION) addIssue(issues, 'incomplete', 'archive_version_unknown', 'K线版本归档版本缺失或不受支持');
  const requestedId = path.basename(file, '.json');
  if (!result.archiveId) addIssue(issues, 'corrupt', 'archive_id_missing', 'K线版本归档缺少归档ID');
  else if (safeFilePart(result.archiveId) !== requestedId) addIssue(issues, 'corrupt', 'archive_id_mismatch', '文件名与归档ID不一致');
  const tradeDate = validDate(payload.tradeDate);
  if (!tradeDate) addIssue(issues, 'incomplete', 'trade_date_missing', 'K线版本归档缺少有效交易日');
  if (!validTimestamp(payload.createdAt)) addIssue(issues, 'incomplete', 'created_at_missing', 'K线版本归档缺少有效写入时间');
  if (!result.selectionBatchId) addIssue(issues, 'incomplete', 'selection_batch_id_missing', 'K线版本归档缺少候选批次ID');
  const records = Array.isArray(payload.records) ? payload.records : null;
  if (!records || !records.length) addIssue(issues, 'incomplete', 'no_records', 'K线版本归档没有记录任何股票');
  const seenCodes = new Set();
  for (const record of records || []) {
    result.counts.records += 1;
    const label = `记录 ${String((record && record.code) || '(空)')}`;
    const recordIssues = [];
    if (!record || typeof record !== 'object') { addIssue(issues, 'corrupt', 'record_invalid', `${label} 不是有效对象`); result.counts.corrupt += 1; continue; }
    if (!/^\d{6}$/.test(String(record.code || ''))) addIssue(recordIssues, 'corrupt', 'record_code_invalid', `${label} 代码不合法`);
    else if (seenCodes.has(String(record.code))) addIssue(recordIssues, 'corrupt', 'record_code_duplicate', `${label} 在同一归档中重复出现`);
    else seenCodes.add(String(record.code));
    const depth = Number(record.depth);
    const latestDate = validDate(record.latestDate);
    const firstDate = record.firstDate ? validDate(record.firstDate) : '';
    if (!Number.isFinite(depth) || depth <= 0) addIssue(recordIssues, 'incomplete', 'record_depth_missing', `${label} 缺少有效深度`);
    if (!latestDate) addIssue(recordIssues, 'incomplete', 'record_latest_date_missing', `${label} 缺少有效最新日期`);
    if (record.firstDate && !firstDate) addIssue(recordIssues, 'corrupt', 'record_first_date_invalid', `${label} 最早日期不合法`);
    else if (firstDate && latestDate && firstDate > latestDate) addIssue(recordIssues, 'corrupt', 'record_date_order', `${label} 最早日期晚于最新日期`);
    if (tradeDate && latestDate && latestDate > tradeDate) addIssue(recordIssues, 'corrupt', 'record_bar_after_trade_date', `${label} 的K线日期 ${latestDate} 晚于归档交易日 ${tradeDate}，存在未来数据`);
    if (Array.isArray(record.bars)) {
      const normalized = normalizeBars(record.bars);
      if (normalized.invalid || normalized.duplicates) addIssue(recordIssues, 'corrupt', 'record_bars_invalid', `${label} 归档K线含无效或重复行（无效${normalized.invalid}/重复${normalized.duplicates}）`);
      if (Number.isFinite(depth) && normalized.bars.length !== depth) addIssue(recordIssues, 'corrupt', 'record_depth_mismatch', `${label} 归档深度 ${normalized.bars.length} 与声明 ${depth} 不一致`);
      if (latestDate && normalized.bars.length && normalized.bars[normalized.bars.length - 1].date !== latestDate) addIssue(recordIssues, 'corrupt', 'record_latest_date_mismatch', `${label} 声明最新日期与归档K线不一致`);
      const recomputed = klineFingerprint(normalized.bars);
      if (!record.contentHash) addIssue(recordIssues, 'incomplete', 'record_hash_missing', `${label} 缺少内容哈希`);
      else if (record.contentHash !== recomputed) addIssue(recordIssues, 'corrupt', 'record_hash_mismatch', `${label} 内容哈希与归档K线不一致`);
      else if (Number.isFinite(depth) && normalized.bars.length === depth) result.hashes[String(record.code)] = recomputed;
    } else {
      addIssue(recordIssues, 'incomplete', 'record_content_unverifiable', `${label} 只保存了元数据，缺少K线正文，内容无法校验`);
    }
    if (!String(record.source || '')) addIssue(recordIssues, 'incomplete', 'record_source_missing', `${label} 缺少K线来源`);
    const adjustment = normalizeAdjustment(record.adjustmentType);
    if (!isAdjustmentCorroborated(record.source, adjustment)) {
      addIssue(recordIssues, 'incomplete', 'record_adjustment_unverified', `${label} 复权口径${adjustmentLabel(adjustment)}无法从来源响应验证`);
    }
    if (normalizeTailStatus(record.tailStatus) !== TAIL_STATUS.CONFIRMED) addIssue(recordIssues, 'incomplete', 'record_tail_not_confirmed', `${label} 尾K不是已收盘确认版本`);
    else if (!record.tailConfirmedAt) addIssue(recordIssues, 'incomplete', 'record_tail_confirmed_at_missing', `${label} 缺少尾K确认时间`);
    const sourceLatestDate = validDate(record.sourceLatestDate);
    if (!sourceLatestDate) addIssue(recordIssues, 'incomplete', 'record_source_latest_date_missing', `${label} 缺少有效来源最新日期`);
    else if (tradeDate && sourceLatestDate > tradeDate) addIssue(recordIssues, 'corrupt', 'record_source_date_future', `${label} 来源最新日期晚于归档交易日`);
    else if (latestDate && sourceLatestDate !== latestDate) addIssue(recordIssues, 'corrupt', 'record_source_date_mismatch', `${label} 来源最新日期与归档尾K日期不一致`);
    if (!validTimestamp(record.fetchedAt)) addIssue(recordIssues, 'incomplete', 'record_fetched_at_missing', `${label} 缺少有效抓取时间`);
    const evidenceDate = shanghaiDate(record.evidenceAt);
    if (!evidenceDate) addIssue(recordIssues, 'incomplete', 'record_evidence_time_missing', `${label} 缺少有效证据时间`);
    else if (tradeDate && evidenceDate > tradeDate) addIssue(recordIssues, 'corrupt', 'record_evidence_time_future', `${label} 证据时间晚于归档交易日`);
    if (normalizeTailStatus(record.tailStatus) === TAIL_STATUS.CONFIRMED && record.tailConfirmedAt && !validTimestamp(record.tailConfirmedAt)) {
      addIssue(recordIssues, 'incomplete', 'record_tail_confirmed_at_invalid', `${label} 尾K确认时间无效`);
    }
    if (recordIssues.length) issues.push(...recordIssues);
    const hasCorrupt = recordIssues.some((item) => item.severity === 'corrupt');
    if (hasCorrupt) result.counts.corrupt += 1;
    else if (recordIssues.length) result.counts.incomplete += 1;
    else result.counts.verified += 1;
  }
  await verifyBatchLinks(payload, issues, options);
  result.status = issues.some((item) => item.severity === 'corrupt') ? 'corrupt' : issues.length ? 'incomplete' : 'complete';
  return result;
}

// 只读列举归档。默认不解析正文体积过大的字段，只返回清单摘要。
function listKlineVersionArchives({ archiveDir = ARCHIVE_DIR } = {}) {
  const dir = path.resolve(archiveDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json') && !name.endsWith('.tmp'))
    .sort()
    .map((name) => {
      const file = path.join(dir, name);
      const stat = fs.statSync(file);
      const item = { file, archiveId: name.replace(/\.json$/i, ''), bytes: stat.size, mtime: stat.mtime.toISOString(), readOk: false };
      try {
        const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
        item.readOk = true;
        item.archiveVersion = String(payload.archiveVersion || '');
        item.archiveId = String(payload.archiveId || item.archiveId);
        item.selectionBatchId = String(payload.selectionBatchId || '');
        item.reviewBatchId = String(payload.reviewBatchId || '');
        item.tradeDate = String(payload.tradeDate || '');
        item.recordCount = Array.isArray(payload.records) ? payload.records.length : 0;
        // 记录代码与内容哈希：供回放预检在不重复读盘的前提下核对K线版本。
        item.recordCodes = (Array.isArray(payload.records) ? payload.records : [])
          .map((record) => String((record && record.code) || '')).filter((code) => /^\d{6}$/.test(code));
        item.contentHashes = Object.fromEntries((Array.isArray(payload.records) ? payload.records : [])
          .filter((record) => record && /^\d{6}$/.test(String(record.code || '')) && record.contentHash)
          .map((record) => [String(record.code), String(record.contentHash)]));
      } catch { /* 读取失败保留 readOk=false，由校验工具报错 */ }
      return item;
    });
}

module.exports = {
  ARCHIVE_VERSION,
  ARCHIVE_DIR,
  SELECTION_ARCHIVE_DIR,
  buildRecord,
  normalizeBars,
  archiveFileFor,
  archiveKlineVersion,
  archiveFromStorage,
  readKlineVersionArchive,
  verifyKlineVersionArchive,
  listKlineVersionArchives,
};
