const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { DATA_DIR } = require('./storage');
const { shanghaiClock, isAfterCnMarketClose, isCnTradingDay, marketSession } = require('./market-session');

const PRESCAN_FILE = path.join(DATA_DIR, 'market-prescan.json');
const ARCHIVE_DIR = path.join(DATA_DIR, 'market-prescan-archive');
const PRESCAN_MAX_AGE_MS = 30 * 60 * 1000;

function shanghaiDateOffset(date, days) {
  const [year, month, day] = String(date || '').split('-').map(Number);
  if (![year, month, day].every(Number.isFinite)) return null;
  return new Date(Date.UTC(year, month - 1, day + days, 4, 0, 0));
}

function expectedPrescanDate(now = new Date()) {
  const clock = shanghaiClock(now);
  if (isCnTradingDay(now) && marketSession(now) !== 'pre_open') return clock.date;
  for (let days = -1; days >= -15; days -= 1) {
    const candidate = shanghaiDateOffset(clock.date, days);
    if (candidate && isCnTradingDay(candidate)) return shanghaiClock(candidate).date;
  }
  return '';
}

function isQuoteFresh(sourceAt, expectedDate, now = new Date(), maxAgeMs = 5 * 60 * 1000) {
  const time = Date.parse(sourceAt || '');
  if (!Number.isFinite(time) || time > now.getTime() + 60000) return false;
  const clock = shanghaiClock(now);
  const sourceClock = shanghaiClock(new Date(time));
  if (sourceClock.date !== expectedDate || expectedPrescanDate(now) !== expectedDate) return false;
  // 周末、节假日和交易日盘前允许使用最近交易日的收盘板块数据。
  if (expectedDate < clock.date) return sourceClock.minutes >= 15 * 60;
  // 午休及收盘后以最近收市时刻计算时龄，不把正常停止更新的行情判为过期。
  const end = clock.minutes >= 900 ? '15:00' : clock.minutes >= 690 && clock.minutes < 780 ? '11:30' : '';
  const reference = end ? Date.parse(`${expectedDate}T${end}:00+08:00`) : now.getTime();
  return time >= reference - maxAgeMs;
}

function isClosedMarketTime(now = new Date()) {
  const clock = shanghaiClock(now);
  return !isCnTradingDay(now) || isAfterCnMarketClose(now);
}

function canReuseClosedPrescan(record, now = new Date()) {
  return assessPrescanValidity(record, { now }).scanEligible;
}

function assessPrescanValidity(record, { marketKey = '', now = new Date() } = {}) {
  if (!record || !record.asOf) return { displayable: false, scanEligible: false, reason: 'missing' };
  const clock = shanghaiClock(now);
  const expectedDate = expectedPrescanDate(now);
  const marketMatches = !marketKey || String(record.marketKey || '') === String(marketKey);
  const sameDate = String(record.asOf) === expectedDate;
  const displayable = Boolean(record.marketRegime || (record.focusThemes || []).length || (record.focusConcepts || []).length);
  let reason = '';
  if (!marketMatches) reason = 'market_changed';
  else if (!sameDate) reason = 'trading_date_changed';
  else {
    const fetched = Date.parse(record.fetchedAt || '');
    const fetchedClock = Number.isFinite(fetched) ? shanghaiClock(new Date(fetched)) : null;
    const confirmedClose = record.isFinal === true && Number.isFinite(fetched)
      && (String(record.asOf) < clock.date || (fetchedClock.date === clock.date && fetchedClock.minutes >= 900));
    if (!Number.isFinite(fetched)) reason = 'source_time_missing';
    else if (fetched > now.getTime() + 60000) reason = 'source_time_future';
    else if (!confirmedClose && now.getTime() - fetched > PRESCAN_MAX_AGE_MS) reason = 'prescan_expired';
    const scopeSize = Array.isArray(record.scopeCodes) ? record.scopeCodes.length
      : record.scopeCodes instanceof Set ? record.scopeCodes.size : 0;
    if (!scopeSize && !reason) reason = 'scope_missing';
  }
  return { displayable, scanEligible: displayable && marketMatches && sameDate && !reason, reason, currentDate: clock.date, expectedDate };
}

function readPrescan() {
  try { return JSON.parse(fs.readFileSync(PRESCAN_FILE, 'utf8')); } catch { return null; }
}

function writePrescan(record) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temp = `${PRESCAN_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(record, null, 2), 'utf8');
  fs.renameSync(temp, PRESCAN_FILE);
  return record;
}

// 市场预扫描的不可变归档：包含当时市场快照、题材成分和质量信息，供时点回放。
// 同一批次文件存在时绝不覆盖，避免刷新页面或重跑候选池改写历史证据。
function archivePrescan(record, snapshot = null, sourceRaw = {}) {
  const batchId = String(record && record.batchId || '');
  if (!batchId) return { ok: false, error: '缺少预扫描批次ID' };
  try {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    const file = path.join(ARCHIVE_DIR, `${batchId.replace(/[^a-zA-Z0-9_.-]/g, '_')}.json`);
    if (fs.existsSync(file)) return { ok: true, skipped: true, file };
    const rawBundle = Object.fromEntries(Object.entries(snapshot && snapshot.rawPagesByMarket || {}).map(([marketKey, pages]) => [marketKey,
      (Array.isArray(pages) ? pages : []).map((page) => ({ page: page.page, fetchedAt: page.fetchedAt, wireExact: page.wireExact === true, byteLength: page.byteLength, sha256: page.sha256, rawText: page.rawText }))]));
    const rawJson = JSON.stringify({ archiveVersion: 'market-source-raw-v2', batchId, markets: rawBundle, sources: sourceRaw || {} });
    const rawBytes = Buffer.from(rawJson, 'utf8');
    const compressed = zlib.gzipSync(rawBytes, { level: 9 });
    const rawFile = `${file}.responses.json.gz`;
    const rawTemp = `${rawFile}.tmp`;
    fs.writeFileSync(rawTemp, compressed);
    fs.renameSync(rawTemp, rawFile);
    const rawEvidence = {
      file: path.basename(rawFile), rawBytes: rawBytes.length, compressedBytes: compressed.length,
      sha256: crypto.createHash('sha256').update(rawBytes).digest('hex'), gzipSha256: crypto.createHash('sha256').update(compressed).digest('hex'),
      markets: Object.fromEntries(Object.entries(rawBundle).map(([key, pages]) => [key, { pages: pages.length }])),
      sources: Object.keys(sourceRaw || {}),
    };
    const payload = { archiveVersion: 'market-prescan-archive-v1', archivedAt: new Date().toISOString(), prescan: record, snapshot: snapshot && {
      snapshotDate: snapshot.snapshotDate || record.snapshotDate || '', dataSource: snapshot.dataSource || '', byMarket: snapshot.byMarket || [], records: Array.isArray(snapshot.records) ? snapshot.records : [],
    }, rawEvidence };
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(temp, file);
    return { ok: true, skipped: false, file, rawFile, rawEvidence, records: payload.snapshot?.records.length || 0 };
  } catch (error) { return { ok: false, error: String(error.message || error) }; }
}

module.exports = { PRESCAN_FILE, ARCHIVE_DIR, PRESCAN_MAX_AGE_MS, expectedPrescanDate, isQuoteFresh, shanghaiClock, isClosedMarketTime, canReuseClosedPrescan, assessPrescanValidity, readPrescan, writePrescan, archivePrescan };
