// T10 归档候选的后续观察目标：只读归档和K线日期，不写名单、不抓全市场。
const fs = require('fs');
const path = require('path');
const { SELECTION_ARCHIVE_DIR } = require('./kline-archive');

const DEFAULT_WINDOW = 20;
const DEFAULT_RETENTION_DAYS = 120;

function validDate(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  const time = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === text ? text : '';
}

function shanghaiDate(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(date);
}

function calendarAgeDays(from, to) {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

function readObservationTargets({ archiveDir = SELECTION_ARCHIVE_DIR, now = new Date(), retentionDays = DEFAULT_RETENTION_DAYS } = {}) {
  const currentDate = shanghaiDate(now);
  const targets = [];
  const issues = [];
  const seen = new Set();
  if (!fs.existsSync(archiveDir)) return { currentDate, targets, issues };
  const files = fs.readdirSync(archiveDir).filter((name) => name.endsWith('.json') && !name.endsWith('.tmp')).sort();
  for (const name of files) {
    const file = path.join(archiveDir, name);
    let payload;
    try { payload = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { issues.push({ code: 'selection_archive_invalid', file: name }); continue; }
    const batchId = String(payload && payload.batchId || '');
    const records = payload && Array.isArray(payload.records) ? payload.records : [];
    for (const record of records) {
      const code = String(record && record.code || '');
      const snapshotDate = validDate(record && record.snapshotDate);
      if (!batchId || String(record && record.selectionBatchId || '') !== batchId
        || Number(record && record.selectionContractVersion) !== 3 || !/^\d{6}$/.test(code) || !snapshotDate) {
        issues.push({ code: 'selection_observation_target_invalid', batchId, stockCode: code });
        continue;
      }
      const ageDays = currentDate ? calendarAgeDays(snapshotDate, currentDate) : -1;
      if (ageDays < 0) {
        issues.push({ code: 'selection_observation_future_target', batchId, stockCode: code, snapshotDate });
        continue;
      }
      if (ageDays > retentionDays) {
        issues.push({ code: 'selection_observation_retention_expired', batchId, stockCode: code, snapshotDate, ageDays });
        continue;
      }
      const key = `${batchId}|${code}`;
      if (!seen.has(key)) targets.push({ batchId, code, snapshotDate, ageDays });
      seen.add(key);
    }
  }
  return { currentDate, targets, issues };
}

function isPostCloseObservationRequest(scope, reason, afterClose) {
  return String(scope || '') === 'managed' && String(reason || '') === 'post-close' && afterClose === true;
}

async function pendingObservationCodes(options = {}) {
  const window = Math.max(1, Number(options.window) || DEFAULT_WINDOW);
  const readDates = options.readDates;
  if (typeof readDates !== 'function') throw new Error('缺少K线日期读取器');
  const loaded = readObservationTargets(options);
  const datesByCode = new Map();
  for (const code of [...new Set(loaded.targets.map((target) => target.code))]) {
    const dates = await readDates(code);
    datesByCode.set(code, [...new Set((Array.isArray(dates) ? dates : []).map(validDate).filter(Boolean))].sort());
  }
  const pending = [];
  const mature = [];
  for (const target of loaded.targets) {
    const observedTradingDays = (datesByCode.get(target.code) || []).filter((date) => date > target.snapshotDate).length;
    const row = { ...target, observedTradingDays, requiredTradingDays: window };
    (observedTradingDays >= window ? mature : pending).push(row);
  }
  return {
    observationVersion: 'selection-observation-v1',
    currentDate: loaded.currentDate,
    window,
    codes: [...new Set(pending.map((target) => target.code))].sort(),
    targetCount: loaded.targets.length,
    pendingTargetCount: pending.length,
    matureTargetCount: mature.length,
    pending,
    mature,
    issues: loaded.issues,
  };
}

module.exports = {
  DEFAULT_WINDOW,
  DEFAULT_RETENTION_DAYS,
  validDate,
  shanghaiDate,
  calendarAgeDays,
  isPostCloseObservationRequest,
  readObservationTargets,
  pendingObservationCodes,
};
