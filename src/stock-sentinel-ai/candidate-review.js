const REVIEW_VERSION = 'candidate-review-v4';
const PARAMETER_STATUS = 'provisional';
const priceLevels = require('./price-levels');
const { rulesFingerprint } = require('./recommendation-validity');
const { assessKlineCoverage } = require('./kline-quality');
const selectionPolicy = require('./selection-policy');

const DEFAULT_PARAMS = Object.freeze({
  minBars: 60,
  maxReturn5Pct: 20,
  maxReturn10Pct: 35,
  maxMa20DeviationPct: 15,
  minRiskReward: 2,
  costRate: 0.0015,
  slippageRate: 0.0015,
  minStopDistancePct: 0.015,
  maxSelected: 10,
  maxSelectedPerTheme: 2,
});

const num = (value) => {
  if (value == null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function shanghaiDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(date);
}

function pctChange(candles, periods) {
  if (!Array.isArray(candles) || candles.length <= periods) return null;
  const start = num(candles[candles.length - 1 - periods].close);
  const end = num(candles[candles.length - 1].close);
  return start > 0 && end != null ? (end / start - 1) * 100 : null;
}

function average(values) {
  const usable = values.map(num).filter((value) => value != null);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

function technicalRisk(candles, params = DEFAULT_PARAMS) {
  const rows = Array.isArray(candles) ? candles : [];
  const closes = rows.map((bar) => num(bar.close));
  const latest = rows.at(-1) || {};
  const close = num(latest.close);
  const ma20 = closes.length >= 20 ? average(closes.slice(-20)) : null;
  const prevMa20 = closes.length >= 21 ? average(closes.slice(-21, -1)) : null;
  const ma20DeviationPct = close != null && ma20 > 0 ? (close / ma20 - 1) * 100 : null;
  const return5Pct = pctChange(rows, 5);
  const return10Pct = pctChange(rows, 10);
  const range = num(latest.high) != null && num(latest.low) != null ? num(latest.high) - num(latest.low) : null;
  const upperShadowRatio = range > 0 && num(latest.high) != null && close != null && num(latest.open) != null
    ? (num(latest.high) - Math.max(close, num(latest.open))) / range : null;
  const avgVolume20 = rows.length >= 21 ? average(rows.slice(-21, -1).map((bar) => bar.volume)) : null;
  const volumeMultiple = avgVolume20 > 0 && num(latest.volume) != null ? num(latest.volume) / avgVolume20 : null;
  const flags = [];
  if (return5Pct != null && return5Pct > params.maxReturn5Pct) flags.push({ key: 'return_5_overheat', label: `近5日累计涨幅${return5Pct.toFixed(1)}%` });
  if (return10Pct != null && return10Pct > params.maxReturn10Pct) flags.push({ key: 'return_10_overheat', label: `近10日累计涨幅${return10Pct.toFixed(1)}%` });
  if (ma20DeviationPct != null && ma20DeviationPct > params.maxMa20DeviationPct) flags.push({ key: 'ma20_extended', label: `偏离MA20 ${ma20DeviationPct.toFixed(1)}%` });
  if (upperShadowRatio != null && upperShadowRatio >= 0.45 && volumeMultiple != null && volumeMultiple >= 1.5) flags.push({ key: 'high_volume_upper_shadow', label: '异常放量长上影' });
  if (close != null && ma20 != null && prevMa20 != null && close < ma20 && ma20 < prevMa20) flags.push({ key: 'trend_broken', label: '收盘跌破下弯MA20' });
  return { return5Pct, return10Pct, ma20, ma20DeviationPct, upperShadowRatio, volumeMultiple, flags };
}

function riskRewardWithCosts(levels, params = DEFAULT_PARAMS) {
  return priceLevels.actionableRiskReward(levels, params);
}

function reviewCandidate({ item = {}, candles = [], klineMeta = {}, patterns = [], rules = [], levels = null, isFinal = false } = {}, options = {}) {
  const params = { ...DEFAULT_PARAMS, ...(options.params || {}) };
  const missing = [];
  const initial = selectionPolicy.assessInitialCandidate(item);
  if (initial.bucket === 'data_insufficient') missing.push(...initial.reasons);
  const themes = Array.isArray(item.themeEvidence) ? item.themeEvidence : [];
  if (!themes.length || themes.some((theme) => !theme.code || theme.asOf !== item.snapshotDate)) missing.push('缺少同日有效题材证据');
  const quality = assessKlineCoverage(candles, {
    target: params.minBars, strategyMin: params.minBars,
    expectedLatestDate: String(item.snapshotDate || ''),
    listingDate: String(klineMeta.listingDate || ''),
  });
  if (!quality.strategyReady) missing.push(...quality.reasons);
  const latestDate = candles.length ? String(candles.at(-1).date || '') : '';
  if (candles.length < params.minBars) missing.push(`日K样本不足（${candles.length}/${params.minBars}）`);
  if (!item.snapshotDate) missing.push('缺少行情交易日');
  if (item.snapshotDate && latestDate && String(item.snapshotDate) !== latestDate) missing.push(`K线日期${latestDate}与行情日期${item.snapshotDate}不一致`);
  if (!item.quoteEvidence || !item.quoteEvidence.sourceAt) missing.push('缺少行情源时间');
  if (item.quoteEvidence && item.quoteEvidence.sourceAt && item.snapshotDate) {
    const sourceDate = shanghaiDate(item.quoteEvidence.sourceAt);
    if (!sourceDate) missing.push('行情源时间无效');
    else if (sourceDate !== String(item.snapshotDate)) missing.push(`行情源日期${sourceDate}与入池日期${item.snapshotDate}不一致`);
  }
  const originalRuleIds = Array.isArray(item.ruleIds) ? item.ruleIds : [];
  if (!originalRuleIds.length) missing.push('缺少入池原策略ID');

  const rulesById = new Map((rules || []).map((rule) => [rule.id, rule]));
  const originalRules = originalRuleIds.map((id) => rulesById.get(id)).filter(Boolean);
  if (originalRules.length !== originalRuleIds.length) missing.push('入池策略已变更或不存在');
  if (originalRules.some((rule) => rule.enabled === false)) missing.push('入池策略已停用，需重新评估');
  if (!item.selectionRulesFingerprint) missing.push('缺少入池规则指纹');
  else if (originalRules.length === originalRuleIds.length && item.selectionRulesFingerprint !== rulesFingerprint(originalRules)) missing.push('入池策略参数已变化，需重新评估');
  const matchedOriginalRules = originalRules.filter((rule) => (patterns || []).some((pattern) =>
    pattern.ruleId === rule.id && pattern.patternId === rule.patternId));
  const risk = technicalRisk(candles, params);
  for (const flag of Array.isArray(item.riskFlags) ? item.riskFlags : []) {
    if (flag && flag.key === 'flow_divergence') risk.flags.push({ key: flag.key, label: flag.label || '上涨但资金流向背离' });
  }
  const rr = riskRewardWithCosts(levels, params);
  const opposingEvidence = risk.flags.map((flag) => flag.label);
  let classification = 'passed';
  const reasons = [];
  if (missing.length) {
    classification = 'insufficient';
    reasons.push(...missing);
  } else if (!matchedOriginalRules.length) {
    classification = 'not_passed';
    reasons.push('入池时命中的原策略未通过K线复核');
  } else if (initial.bucket !== 'potential') {
    classification = 'not_passed';
    reasons.push(...initial.reasons);
  } else if (risk.flags.length) {
    classification = 'not_passed';
    reasons.push(...opposingEvidence);
  } else if (!rr.available || rr.value < params.minRiskReward) {
    classification = 'not_passed';
    reasons.push(rr.available ? `成本后风险收益比${rr.value}低于${params.minRiskReward}` : rr.reason);
  } else if (!isFinal || rr.triggerStatus === 'approaching') {
    classification = 'pending_confirmation';
    reasons.push(!isFinal ? '盘中K线尚未收盘确认' : '入场触发条件尚未确认');
  } else {
    reasons.push(`原策略复核通过，成本后风险收益比${rr.value}`);
  }
  return {
    code: String(item.code || ''),
    classification,
    selected: false,
    reasons,
    missing,
    opposingEvidence,
    originalRuleIds,
    matchedOriginalRuleIds: matchedOriginalRules.map((rule) => rule.id),
    metrics: risk,
    klineQuality: quality,
    riskReward: rr,
    reviewVersion: REVIEW_VERSION,
    parameterStatus: PARAMETER_STATUS,
    params,
  };
}

function finalizeSelections(results, options = {}) {
  const params = { ...DEFAULT_PARAMS, ...(options.params || {}) };
  const passed = (results || []).filter((result) => result.classification === 'passed').sort((a, b) =>
    Number(b.riskReward && b.riskReward.value) - Number(a.riskReward && a.riskReward.value)
    || Number(b.patternScore) - Number(a.patternScore)
    || Number(b.score) - Number(a.score)
    || String(a.code).localeCompare(String(b.code)));
  const selectedCodes = new Set();
  const themeCounts = new Map();
  for (const result of passed) {
    if (selectedCodes.size >= params.maxSelected) break;
    const primaryTheme = String(result.primaryThemeCode || 'unclassified');
    if ((themeCounts.get(primaryTheme) || 0) >= params.maxSelectedPerTheme) continue;
    selectedCodes.add(result.code);
    themeCounts.set(primaryTheme, (themeCounts.get(primaryTheme) || 0) + 1);
  }
  return (results || []).map((result) => result.classification === 'passed'
    ? { ...result, selected: selectedCodes.has(result.code), selectionReason: selectedCodes.has(result.code) ? '进入本批精选' : '通过但未入精选配额' }
    : result);
}

module.exports = {
  REVIEW_VERSION,
  PARAMETER_STATUS,
  DEFAULT_PARAMS,
  pctChange,
  technicalRisk,
  riskRewardWithCosts,
  shanghaiDate,
  reviewCandidate,
  finalizeSelections,
};
