const crypto = require('crypto');

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function rulesFingerprint(rules = []) {
  const normalized = (Array.isArray(rules) ? rules : [])
    .map((rule) => stableValue(rule))
    .sort((left, right) => String(left.id || '').localeCompare(String(right.id || '')));
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, 24);
}

function recommendationEvidence(record = {}) {
  return record && (record.evidenceJson || record.evidence) || {};
}

function recommendationSelected(record = {}) {
  return recommendationEvidence(record).selected === true;
}

function klineFingerprint(bars = []) {
  if (!bars.length) return '';
  const rows = bars.map((bar) => ['date', 'open', 'high', 'low', 'close', 'volume', 'amount'].map((key) =>
    key === 'date' ? String(bar[key] || '') : bar[key] == null || bar[key] === '' ? null : Number(bar[key])));
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

function assessRecommendation(record, { candidate = {}, currentRules = [], klineDate = '', klineHash = '', expectedRuleVersion = '', tailStatus = '', tailConfirmedAt = '', klineSource = '', adjustmentType = '', now = new Date() } = {}) {
  const reasons = [];
  const evidence = recommendationEvidence(record);
  const requiresKlineMeta = record?.ruleVersion === 'candidate-review-v4' || Object.prototype.hasOwnProperty.call(evidence, 'tailStatus');
  if (requiresKlineMeta) {
    if (String(tailStatus || '') !== 'confirmed') reasons.push('尾K尚未获得可核对的收盘确认，需重新抓取');
    if (String(evidence.tailStatus || '') !== 'confirmed') reasons.push('推荐缺少已确认尾K证据');
    if (!tailConfirmedAt || !evidence.tailConfirmedAt) reasons.push('尾K确认时间缺失');
    else if (String(evidence.tailConfirmedAt) !== String(tailConfirmedAt)) reasons.push('尾K确认状态已变化');
    if (!klineSource || !evidence.klineSource) reasons.push('K线来源证据缺失');
    else if (String(evidence.klineSource) !== String(klineSource)) reasons.push('K线来源已变化');
    if (String(adjustmentType || '') !== 'qfq' || String(evidence.klineAdjustmentType || '') !== 'qfq') reasons.push('K线前复权口径未验证');
  } else if (String(tailStatus || '') === 'provisional') {
    reasons.push('尾K尚未收盘确认，需收盘后重新抓取');
  }
  if (!record || record.status !== 'success') reasons.push('最近一次复核失败');
  if (record && 'batchStatus' in record && record.batchStatus !== 'completed') reasons.push('复核批次未成功完成');
  if (expectedRuleVersion && (!record || record.ruleVersion !== expectedRuleVersion)) reasons.push('复核规则版本已变化');
  if (!evidence.rulesFingerprint || evidence.rulesFingerprint !== rulesFingerprint(currentRules)) reasons.push('选股规则已变化');
  if (!evidence.selectionBatchId || evidence.selectionBatchId !== String(candidate.selectionBatchId || '')) reasons.push('候选批次已变化');
  if (!evidence.selectionRulesFingerprint || evidence.selectionRulesFingerprint !== String(candidate.selectionRulesFingerprint || '')) reasons.push('候选入池规则已变化');
  if (!evidence.snapshotDate || evidence.snapshotDate !== String(candidate.snapshotDate || '')) reasons.push('候选行情日期已变化');
  if (!klineDate) reasons.push('当前K线证据缺失');
  else if (evidence.klineDate !== klineDate) reasons.push('K线证据已更新');
  if (!klineHash || !evidence.klineHash || evidence.klineHash !== klineHash) reasons.push('K线内容已变化或缺少指纹，需重新复核');
  if (record?.ruleVersion === 'candidate-review-v4' || 'quoteSourceAt' in evidence) {
    if (!require('./market-prescan-store').isQuoteFresh(evidence.quoteSourceAt, evidence.snapshotDate, now)) reasons.push('推荐所依据的行情已过期');
  }
  return { current: reasons.length === 0, reasons, checkedAt: new Date().toISOString() };
}

module.exports = { stableValue, rulesFingerprint, klineFingerprint, recommendationEvidence, recommendationSelected, assessRecommendation };
