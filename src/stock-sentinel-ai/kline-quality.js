function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function validBar(bar) {
  if (!bar || !validDate(bar.date)) return false;
  if (!['open', 'high', 'low', 'close', 'volume'].every((key) =>
    bar[key] != null && String(bar[key]).trim() !== '' && Number.isFinite(Number(bar[key])))) return false;
  return ['open', 'high', 'low', 'close'].every((key) => Number(bar[key]) > 0)
    && Number(bar.volume) >= 0 && Number(bar.low) <= Math.min(Number(bar.open), Number(bar.close))
    && Number(bar.high) >= Math.max(Number(bar.open), Number(bar.close));
}

function assessKlineCoverage(kline, {
  target = 250,
  strategyMin = 60,
  expectedDates = [],
  expectedLatestDate = '',
  listingDate = '',
  provisional = false,
} = {}) {
  const input = Array.isArray(kline) ? kline : [];
  const rows = input.filter(validBar);
  const dates = new Set(rows.map((row) => String(row.date)));
  const invalidCount = input.length - rows.length;
  const duplicateCount = rows.length - dates.size;
  const latestDate = rows.length ? [...dates].sort().at(-1) : '';
  const verifiedListingDate = validDate(listingDate) ? String(listingDate) : '';
  const fullExpectedDates = (Array.isArray(expectedDates) ? expectedDates : []).filter(validDate);
  const applicableExpectedDates = verifiedListingDate
    ? fullExpectedDates.filter((date) => date >= verifiedListingDate)
    : fullExpectedDates;
  const listingLimited = Boolean(verifiedListingDate && fullExpectedDates.some((date) => date < verifiedListingDate));
  const availableTarget = listingLimited ? applicableExpectedDates.length : target;
  const missingDates = applicableExpectedDates.filter((date) => !dates.has(date));
  const reasons = [];
  if (!rows.length) reasons.push('无有效K线');
  if (dates.size < target && !listingLimited) reasons.push(`深度不足：${dates.size}/${target}`);
  if (listingLimited && dates.size < strategyMin) reasons.push(`上市后样本不足：${dates.size}/${strategyMin}`);
  if (invalidCount) reasons.push(`无效K线：${invalidCount}根`);
  if (duplicateCount) reasons.push(`重复交易日：${duplicateCount}根`);
  if (expectedLatestDate && latestDate < expectedLatestDate) reasons.push(`日期陈旧：最新${latestDate || '无'}，应到${expectedLatestDate}`);
  if (missingDates.length) reasons.push(`交易日缺口：${missingDates.length}日`);
  if (expectedLatestDate && latestDate > expectedLatestDate) reasons.push('K线包含晚于目标交易日的数据');
  const current = !expectedLatestDate || latestDate === expectedLatestDate;
  const structurallyValid = !invalidCount && !duplicateCount;
  const complete = dates.size >= target && current && missingDates.length === 0 && structurallyValid;
  const strategyReady = dates.size >= strategyMin && current && missingDates.length === 0 && structurallyValid;
  const listingHistoryComplete = listingLimited && strategyReady
    && applicableExpectedDates.length > 0
    && applicableExpectedDates.every((date) => dates.has(date));
  return {
    status: complete ? 'complete' : listingHistoryComplete ? 'listing_complete' : strategyReady ? 'strategy_ready' : rows.length ? 'incomplete' : 'failed',
    complete,
    strategyReady,
    listingHistoryComplete,
    listingLimited,
    listingDate: verifiedListingDate,
    availableTarget,
    depth: dates.size,
    invalidCount,
    duplicateCount,
    target,
    strategyMin,
    latestDate,
    expectedLatestDate,
    missingDates,
    provisional: Boolean(provisional && latestDate === expectedLatestDate),
    reasons,
  };
}

module.exports = { validDate, validBar, assessKlineCoverage };
