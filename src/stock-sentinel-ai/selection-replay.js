const crypto = require('crypto');
const selectionPolicy = require('./selection-policy');
const candidateReview = require('./candidate-review');
const { matchKlinePattern } = require('./screener-core');
const priceLevels = require('./price-levels');
const { rulesFingerprint } = require('./recommendation-validity');
const { validDate, validBar } = require('./kline-quality');

const REPLAY_VERSION = 'selection-replay-v2';
const FORWARD_WINDOW = 10;

const DEFAULT_SENSITIVITY_GRID = Object.freeze([
  { id: 'baseline', label: '当前基线' },
  { id: 'heat_60', label: '防追高线60%', initialParams: { heatRatioOfLimit: 0.6 } },
  { id: 'heat_80', label: '防追高线80%', initialParams: { heatRatioOfLimit: 0.8 } },
  { id: 'return_5_15', label: '5日涨幅15%', reviewParams: { maxReturn5Pct: 15 } },
  { id: 'return_5_25', label: '5日涨幅25%', reviewParams: { maxReturn5Pct: 25 } },
  { id: 'return_10_30', label: '10日涨幅30%', reviewParams: { maxReturn10Pct: 30 } },
  { id: 'return_10_40', label: '10日涨幅40%', reviewParams: { maxReturn10Pct: 40 } },
  { id: 'ma20_10', label: 'MA20偏离10%', reviewParams: { maxMa20DeviationPct: 10 } },
  { id: 'ma20_20', label: 'MA20偏离20%', reviewParams: { maxMa20DeviationPct: 20 } },
  { id: 'rr_1_5', label: '最低风险收益1.5', reviewParams: { minRiskReward: 1.5 } },
  { id: 'rr_2_5', label: '最低风险收益2.5', reviewParams: { minRiskReward: 2.5 } },
  { id: 'quota_narrow', label: '候选/精选配额10/5', initialParams: { maxCandidates: 10 }, reviewParams: { maxSelected: 5 } },
  { id: 'quota_wide', label: '候选/精选配额30/15', initialParams: { maxCandidates: 30 }, reviewParams: { maxSelected: 15 } },
]);

function dateOnly(value) {
  const text = String(value || '').trim();
  return validDate(text) ? text : '';
}

function shanghaiDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(date);
}

function round(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function hashEvidence(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex').slice(0, 24);
}

function splitCandlesAt(candles, asOf, forwardWindow = FORWARD_WINDOW) {
  const cutoff = dateOnly(asOf);
  const dated = (Array.isArray(candles) ? candles : [])
    .map((bar, index) => ({ bar, index, date: dateOnly(bar && bar.date) }))
    .filter((entry) => entry.date)
    .sort((left, right) => left.date.localeCompare(right.date) || left.index - right.index);
  const byDate = new Map();
  for (const entry of dated) byDate.set(entry.date, entry.bar);
  const normalized = [...byDate.entries()].map(([date, bar]) => ({ ...bar, date }));
  const evidence = cutoff ? normalized.filter((bar) => bar.date <= cutoff) : [];
  const future = cutoff ? normalized.filter((bar) => bar.date > cutoff).slice(0, Math.max(0, Number(forwardWindow) || 0)) : [];
  return {
    asOf: cutoff,
    evidence,
    future,
    invalidDateCount: Math.max(0, (Array.isArray(candles) ? candles.length : 0) - dated.length),
    duplicateDateCount: Math.max(0, dated.length - normalized.length),
  };
}

function observeForwardOutcome(evidence, future) {
  const reference = Number(Array.isArray(evidence) && evidence.length ? evidence.at(-1).close : NaN);
  const rows = Array.isArray(future) ? future : [];
  if (!(reference > 0) || !rows.length || rows.some((bar) => !validBar(bar))) {
    return { verified: false, bars: rows.length, referenceClose: reference > 0 ? reference : null, maxFavorablePct: null, maxAdversePct: null, endReturnPct: null };
  }
  const highs = rows.map((bar) => Number(bar.high)).filter(Number.isFinite);
  const lows = rows.map((bar) => Number(bar.low)).filter(Number.isFinite);
  const end = Number(rows.at(-1).close);
  return {
    verified: Boolean(highs.length && lows.length && Number.isFinite(end)),
    bars: rows.length,
    referenceClose: round(reference),
    maxFavorablePct: highs.length ? round((Math.max(...highs) / reference - 1) * 100) : null,
    maxAdversePct: lows.length ? round((Math.min(...lows) / reference - 1) * 100) : null,
    endReturnPct: Number.isFinite(end) ? round((end / reference - 1) * 100) : null,
  };
}

function profileFromItem(item = {}) {
  return {
    code: String(item.code || ''),
    price: item.price,
    prevClose: item.prevClose,
    changePct: item.changePct,
    amountYi: item.amountYi,
    turnover: item.turnover,
  };
}

function historicalEvidenceIssues(item = {}, asOf = '') {
  const cutoff = dateOnly(asOf);
  const missing = [];
  const futureDated = [];
  if (!cutoff) missing.push('缺少有效回放日期');
  if (Number(item.selectionContractVersion) !== 3) missing.push('不是可回放的v3精选契约');
  if (!dateOnly(item.snapshotDate) || item.snapshotDate !== cutoff) missing.push('行情交易日与回放日不一致');
  if (!item.selectionBatchId) missing.push('缺少精选批次ID');
  if (!item.selectionPolicyVersion) missing.push('缺少初筛参数版本');
  if (!item.selectionParameterStatus) missing.push('缺少参数验证状态');
  if (!item.selectionPolicyParams || !Object.keys(selectionPolicy.DEFAULT_PARAMS).every((key) =>
    typeof item.selectionPolicyParams[key] === 'number' && Number.isFinite(item.selectionPolicyParams[key]) && item.selectionPolicyParams[key] >= 0)) missing.push('初筛参数快照不完整或无效');
  if (!item.selectionRulesFingerprint) missing.push('缺少入池规则指纹');
  if (!Array.isArray(item.selectionRuleEvidence) || !item.selectionRuleEvidence.length) missing.push('缺少入池规则配置快照');
  else if (item.selectionRulesFingerprint && rulesFingerprint(item.selectionRuleEvidence) !== item.selectionRulesFingerprint) missing.push('入池规则配置快照与指纹不一致');
  if (!item.quoteEvidence || !item.quoteEvidence.sourceAt) missing.push('缺少行情源时间');
  if (!Array.isArray(item.themeEvidence) || !item.themeEvidence.length) missing.push('缺少历史题材证据');
  const sourceDate = item.quoteEvidence && item.quoteEvidence.sourceAt ? shanghaiDate(item.quoteEvidence.sourceAt) : '';
  if (!sourceDate || sourceDate !== cutoff) missing.push('行情源时间无效或与回放日不一致');
  if (sourceDate && cutoff && sourceDate > cutoff) futureDated.push(`行情源日期${sourceDate}晚于回放日期${cutoff}`);
  for (const theme of Array.isArray(item.themeEvidence) ? item.themeEvidence : []) {
    const themeDate = dateOnly(theme && theme.asOf);
    if (!themeDate) missing.push(`题材${String(theme && (theme.name || theme.code) || '未知')}缺少证据日期`);
    else if (cutoff && themeDate > cutoff) futureDated.push(`题材${String(theme.name || theme.code || '未知')}证据日期${themeDate}晚于回放日期${cutoff}`);
    else if (themeDate !== cutoff) missing.push('题材证据已跨交易日');
  }
  return { complete: missing.length === 0 && futureDated.length === 0, missing: [...new Set(missing)], futureDated: [...new Set(futureDated)] };
}

function primaryTheme(item = {}) {
  const themes = Array.isArray(item.themeEvidence) ? item.themeEvidence.slice() : [];
  const theme = themes.sort((left, right) => Number(left.rank) - Number(right.rank))[0];
  return theme ? String(theme.code || theme.name || '') : '';
}

function detectRulePatterns(candles, { code = '', rules = [] } = {}) {
  const hits = [];
  for (const rule of Array.isArray(rules) ? rules : []) {
    if (!rule || rule.enabled === false || rule.kind === 'scan' || !rule.patternId) continue;
    try {
      const result = matchKlinePattern(rule.patternId, candles, { ...(rule.params || {}), code });
      if (result && result.matched) hits.push({ ruleId: rule.id, patternId: rule.patternId, label: rule.label || rule.id, score: Number(result.score) || 0 });
    } catch (error) { throw new Error(`历史规则${rule.id}执行失败：${error.message}`); }
  }
  hits.sort((left, right) => Number(right.score) - Number(left.score));
  return { hits };
}

function replayCandidate(sample = {}, options = {}) {
  const item = sample.item || {};
  const asOf = dateOnly(options.asOf || item.snapshotDate);
  const asOfThemes = (Array.isArray(item.themeEvidence) ? item.themeEvidence : []).filter((theme) => {
    const themeDate = dateOnly(theme && theme.asOf);
    return themeDate && asOf && themeDate <= asOf;
  });
  const asOfItem = { ...item, themeEvidence: asOfThemes };
  const initialParams = { ...selectionPolicy.DEFAULT_PARAMS, ...(item.selectionPolicyParams || {}), ...(options.initialParams || {}) };
  const reviewParams = { ...candidateReview.DEFAULT_PARAMS, ...(options.reviewParams || {}) };
  const detector = options.detectPatterns || detectRulePatterns;
  const levelComputer = options.computeLevels || priceLevels.computeLevels;
  const partition = splitCandlesAt(sample.candles, asOf, options.forwardWindow);
  const initialAssessment = selectionPolicy.assessInitialCandidate(profileFromItem(asOfItem), initialParams);
  const replayRules = Array.isArray(item.selectionRuleEvidence) && item.selectionRuleEvidence.length ? item.selectionRuleEvidence : (sample.rules || []);
  const patterns = partition.evidence.length >= 2 ? detector(partition.evidence, { code: String(item.code || ''), rules: replayRules }).hits : [];
  const levels = levelComputer(partition.evidence, { code: String(item.code || '') });
  const review = candidateReview.reviewCandidate({
    item: asOfItem,
    candles: partition.evidence,
    klineMeta: sample.klineMeta || {},
    patterns,
    rules: replayRules,
    levels,
    isFinal: options.isFinal !== false,
  }, { params: reviewParams });
  const issues = historicalEvidenceIssues(item, asOf);
  if (partition.invalidDateCount || partition.duplicateDateCount || !review.klineQuality.strategyReady) {
    issues.complete = false;
    issues.missing.push('历史K线存在无效字段、重复日期、深度或日期问题');
  }
  if (!issues.complete) {
    review.classification = 'insufficient';
    review.selected = false;
    review.missing.push('历史证据未通过时点校验');
    review.reasons = ['历史证据未通过时点校验'];
  }
  const decision = {
    code: String(item.code || ''),
    initialBucket: initialAssessment.bucket,
    classification: !issues.complete ? 'insufficient' : initialAssessment.bucket === 'potential' ? review.classification : initialAssessment.bucket,
    initialReasons: initialAssessment.reasons,
    reviewReasons: review.reasons,
    metrics: review.metrics,
    riskReward: review.riskReward,
  };
  const evidenceHash = hashEvidence({
    replayVersion: REPLAY_VERSION,
    asOf,
    item: {
      code: item.code, price: item.price, prevClose: item.prevClose, changePct: item.changePct,
      amountYi: item.amountYi, turnover: item.turnover, snapshotDate: item.snapshotDate,
      selectionBatchId: item.selectionBatchId, selectionPolicyVersion: item.selectionPolicyVersion,
      selectionParameterStatus: item.selectionParameterStatus,
      selectionPolicyParams: item.selectionPolicyParams,
      selectionRuleEvidence: item.selectionRuleEvidence,
      selectionRulesFingerprint: item.selectionRulesFingerprint,
      ruleIds: asOfItem.ruleIds, themeEvidence: asOfItem.themeEvidence, quoteEvidence: asOfItem.quoteEvidence,
    },
    candles: partition.evidence,
    rules: replayRules,
    initialParams,
    reviewParams,
    decision,
  });
  return {
    replayVersion: REPLAY_VERSION,
    code: String(item.code || ''),
    asOf,
    selectionBatchId: String(item.selectionBatchId || ''),
    initialParams,
    reviewParams,
    evidenceHash,
    evidenceBars: partition.evidence.length,
    latestEvidenceDate: partition.evidence.length ? partition.evidence.at(-1).date : '',
    futureBarsObserved: partition.future.length,
    invalidDateCount: partition.invalidDateCount,
    duplicateDateCount: partition.duplicateDateCount,
    historicalEvidence: issues,
    matchingThemes: asOfThemes,
    initialAssessment,
    review: { ...review, primaryThemeCode: primaryTheme(asOfItem), patternScore: patterns.length ? Number(patterns[0].score) || 0 : 0, score: Number(item.score) || 0 },
    decision,
    observation: observeForwardOutcome(partition.evidence, partition.future),
  };
}

function summarizeReplays(replays, variant = {}) {
  const rows = Array.isArray(replays) ? replays : [];
  const groups = new Map();
  for (const row of rows.filter((row) => row.historicalEvidence.complete)) {
    const key = `${row.asOf}/${row.selectionBatchId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const admitted = [], excluded = [], finalized = [];
  let verifiedBatches = 0, verifiedSamples = 0;
  for (const batch of groups.values()) {
    // 冲突参数或重复候选不能让同一批次产生多份配额。
    if (new Set(batch.map((row) => row.code)).size !== batch.length
      || new Set(batch.map((row) => hashEvidence([row.initialParams, row.reviewParams]))).size !== 1) continue;
    verifiedBatches += 1;
    verifiedSamples += batch.length;
    const candidates = batch.filter((row) => row.initialAssessment.bucket === 'potential')
      .map((row) => ({ ...row.review, code: row.code, matchingThemes: row.matchingThemes }))
      .sort((a, b) => Number(b.score) - Number(a.score) || a.code.localeCompare(b.code));
    const quota = selectionPolicy.applyCandidateQuotas(candidates, batch[0].initialParams);
    admitted.push(...quota.selected);
    excluded.push(...quota.overQuota);
    finalized.push(...candidateReview.finalizeSelections(quota.selected, { params: batch[0].reviewParams }));
  }
  const count = (predicate) => rows.filter(predicate).length;
  return {
    sampleCount: rows.length,
    completeHistoricalEvidence: count((row) => row.historicalEvidence.complete),
    limitedHistoricalEvidence: count((row) => !row.historicalEvidence.complete),
    potential: count((row) => row.initialAssessment.bucket === 'potential'),
    quotaScope: 'available_candidates_only',
    quotaVerifiedBatches: verifiedBatches,
    quotaUnverifiedSamples: rows.length - verifiedSamples,
    admittedAfterInitialQuota: verifiedBatches ? admitted.length : null,
    overInitialQuota: verifiedBatches ? excluded.length : null,
    strongWatch: count((row) => row.initialAssessment.bucket === 'strong_watch'),
    initialDataInsufficient: count((row) => row.initialAssessment.bucket === 'data_insufficient'),
    reviewPassed: count((row) => row.initialAssessment.bucket === 'potential' && row.review.classification === 'passed'),
    reviewPending: count((row) => row.initialAssessment.bucket === 'potential' && row.review.classification === 'pending_confirmation'),
    reviewNotPassed: count((row) => row.initialAssessment.bucket === 'potential' && row.review.classification === 'not_passed'),
    reviewInsufficient: count((row) => row.initialAssessment.bucket === 'potential' && row.review.classification === 'insufficient'),
    selected: finalized.filter((row) => row.selected).length,
    return5Overheat: count((row) => row.review.metrics.flags.some((flag) => flag.key === 'return_5_overheat')),
    return10Overheat: count((row) => row.review.metrics.flags.some((flag) => flag.key === 'return_10_overheat')),
    ma20Extended: count((row) => row.review.metrics.flags.some((flag) => flag.key === 'ma20_extended')),
    riskRewardAvailable: count((row) => row.review.riskReward.available),
    riskRewardPassing: count((row) => row.review.riskReward.available && row.review.riskReward.value >= (variant.reviewParams && variant.reviewParams.minRiskReward || candidateReview.DEFAULT_PARAMS.minRiskReward)),
    forwardObservationAvailable: count((row) => row.observation.verified),
    evidenceBars: {
      min: rows.length ? Math.min(...rows.map((row) => row.evidenceBars)) : 0,
      max: rows.length ? Math.max(...rows.map((row) => row.evidenceBars)) : 0,
      average: rows.length ? round(rows.reduce((sum, row) => sum + row.evidenceBars, 0) / rows.length, 1) : 0,
    },
  };
}

function runSensitivity(samples, variants = DEFAULT_SENSITIVITY_GRID, options = {}) {
  return (Array.isArray(variants) ? variants : []).map((variant) => {
    const replays = (Array.isArray(samples) ? samples : []).map((sample) => replayCandidate(sample, {
      ...options,
      initialParams: variant.initialParams,
      reviewParams: variant.reviewParams,
    }));
    return {
      id: variant.id,
      label: variant.label,
      initialParams: { ...selectionPolicy.DEFAULT_PARAMS, ...(variant.initialParams || {}) },
      reviewParams: { ...candidateReview.DEFAULT_PARAMS, ...(variant.reviewParams || {}) },
      summary: summarizeReplays(replays, variant),
    };
  });
}

module.exports = {
  REPLAY_VERSION,
  FORWARD_WINDOW,
  DEFAULT_SENSITIVITY_GRID,
  dateOnly,
  splitCandlesAt,
  observeForwardOutcome,
  historicalEvidenceIssues,
  detectRulePatterns,
  replayCandidate,
  summarizeReplays,
  runSensitivity,
};
