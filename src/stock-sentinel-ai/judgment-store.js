// 智诊盯盘 · AI 研判结果持久化（独立 JSON，不放 sql.js）
// 存批次与单只结果，包含幂等键、evidenceHash、usage、attempt、errorCode、上次成功结论。
// 二次研判失败/超时/格式异常时保留上次成功结果，并将本次尝试作为独立失败记录保存。
// 使用临时文件 + rename 原子落盘，避免写入中断破坏文件。
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./storage');

const STORE_FILE = path.join(DATA_DIR, 'judgments.json');
const STORE_VERSION = 1;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function empty() {
  return { version: STORE_VERSION, results: {}, batches: {} };
}

function load() {
  try {
    ensureDir(DATA_DIR);
    if (!fs.existsSync(STORE_FILE)) return empty();
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return empty();
    return {
      version: STORE_VERSION,
      results: parsed.results && typeof parsed.results === 'object' ? parsed.results : {},
      batches: parsed.batches && typeof parsed.batches === 'object' ? parsed.batches : {},
    };
  } catch {
    return empty();
  }
}

function save(data) {
  try {
    ensureDir(DATA_DIR);
    const tmp = STORE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, STORE_FILE);
    return true;
  } catch {
    return false;
  }
}

function normCode(codeInput) {
  return String(codeInput || '').trim();
}

function getResult(code) {
  const c = normCode(code);
  const data = load();
  return data.results[c] || null;
}

function getLastSuccess(code) {
  const r = getResult(code);
  return r && r.lastSuccess ? r.lastSuccess : null;
}

function getAttempts(code) {
  const r = getResult(code);
  return r && Array.isArray(r.attempts) ? r.attempts : [];
}

/**
 * 记录一次研判尝试。record 为一次完整记录；成功时写入 lastSuccess。
 * @param {object} record
 * @returns {{ok:boolean, record:object}}
 */
function recordAttempt(record) {
  const code = normCode(record && record.code);
  if (!/^\d{6}$/.test(code)) return { ok: false, record: null };
  const data = load();
  const slot = data.results[code] || { code, name: '', market: '', attempts: [], lastSuccess: null };
  slot.code = code;
  if (record.name) slot.name = String(record.name);
  if (record.market) slot.market = String(record.market);
  const rec = { ...record, code, finishedAt: record.finishedAt || Date.now() };
  slot.attempts = (slot.attempts || []).concat([rec]).slice(-500); // 只保留最近 500 次，防膨胀。
  if (rec.judgmentStatus === 'success') slot.lastSuccess = rec;
  data.results[code] = slot;
  save(data);
  return { ok: true, record: rec };
}

function allResults() {
  const data = load();
  return Object.keys(data.results).map((k) => data.results[k]);
}

function saveBatch(batch) {
  const id = String((batch && batch.batchId) || '');
  if (!id) return false;
  const data = load();
  data.batches[id] = { ...batch, batchId: id };
  return save(data);
}

function getBatch(batchId) {
  const data = load();
  return data.batches[String(batchId || '')] || null;
}

function listBatches() {
  const data = load();
  return Object.keys(data.batches)
    .map((k) => data.batches[k])
    .sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0));
}

function clear() {
  return save(empty());
}

// 供前端列表使用：把一只股票的研判状态压成可展示摘要（不改变内部三类状态）。
function summary(code) {
  const r = getResult(code);
  if (!r) {
    return { code: normCode(code), hasResult: false, judgmentStatus: 'pending', dataStatus: '', scoreStatus: 'none' };
  }
  const last = r.lastSuccess;
  const latestAttempt = r.attempts && r.attempts.length ? r.attempts[r.attempts.length - 1] : null;
  return {
    code: r.code,
    name: r.name || '',
    market: r.market || '',
    hasResult: true,
    dataStatus: last ? last.dataStatus : (latestAttempt ? latestAttempt.dataStatus : ''),
    judgmentStatus: last ? last.judgmentStatus : (latestAttempt ? latestAttempt.judgmentStatus : 'pending'),
    scoreStatus: last ? (last.scoreStatus || 'none') : 'none',
    verdict: last && last.modelResult ? last.modelResult.verdict : null,
    summary: last && last.modelResult ? last.modelResult.summary : '',
    model: last ? last.model : '',
    evidenceHash: last ? last.evidenceHash : (latestAttempt ? latestAttempt.evidenceHash : ''),
    evidenceDates: last ? last.evidenceDates : (latestAttempt ? latestAttempt.evidenceDates : {}),
    sampleLimited: !!(last && last.dataStatus === 'limited'),
    startedAt: last ? last.startedAt : (latestAttempt ? latestAttempt.startedAt : 0),
    finishedAt: last ? last.finishedAt : (latestAttempt ? latestAttempt.finishedAt : 0),
    durationMs: last ? last.durationMs : (latestAttempt ? latestAttempt.durationMs : 0),
    attempt: last ? last.attempt : (latestAttempt ? latestAttempt.attempt : 0),
    errorCode: last ? last.errorCode : (latestAttempt ? latestAttempt.errorCode : ''),
  };
}

module.exports = {
  STORE_FILE,
  load,
  getResult,
  getLastSuccess,
  getAttempts,
  recordAttempt,
  allResults,
  saveBatch,
  getBatch,
  listBatches,
  clear,
  summary,
};
