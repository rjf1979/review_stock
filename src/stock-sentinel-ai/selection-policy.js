const POLICY_VERSION = 'selection-policy-v1';
const PARAMETER_STATUS = 'provisional';

const DEFAULT_PARAMS = Object.freeze({
  maxPerTheme: 3,
  maxCandidates: 20,
  minAmountYi: 0.5,
  minTurnover: 0.3,
  heatRatioOfLimit: 0.7,
});

function priceLimitRate(code) {
  const value = String(code || '');
  if (/^(4|8|92)/.test(value)) return 0.3;
  if (/^(30|68)/.test(value)) return 0.2;
  return 0.1;
}

function limitUpPrice(prevClose, code) {
  const close = Number(prevClose);
  if (!(close > 0)) return null;
  return Math.round(close * (1 + priceLimitRate(code)) * 100) / 100;
}

function assessInitialCandidate(profile, params = DEFAULT_PARAMS) {
  const p = profile || {};
  const reasons = [];
  if (!(Number(p.price) > 0) || p.changePct == null || String(p.changePct).trim() === '' || !Number.isFinite(Number(p.changePct))) reasons.push('行情价格无效');
  if (!(Number(p.amountYi) >= params.minAmountYi)) reasons.push(`成交额低于${params.minAmountYi}亿`);
  if (!(Number(p.turnover) >= params.minTurnover)) reasons.push(`换手率低于${params.minTurnover}%`);
  if (reasons.length) return { bucket: 'data_insufficient', reasons, isLimitUp: false, limitUpPrice: null };

  const upper = limitUpPrice(p.prevClose, p.code);
  const isLimitUp = upper != null && Number(p.price) >= upper - 0.005;
  const limitRatePct = priceLimitRate(p.code) * 100;
  const heatThreshold = limitRatePct * params.heatRatioOfLimit;
  const exceptionalLimitRule = Number(p.changePct) > limitRatePct + 0.5;
  if (exceptionalLimitRule) {
    return {
      bucket: 'strong_watch',
      reasons: [`涨幅超过常规${limitRatePct}%限制，可能属于新股、复牌或无涨跌停限制日`],
      isLimitUp: false,
      limitUpPrice: upper,
      heatThreshold,
      limitRule: 'exceptional',
    };
  }
  const isHot = isLimitUp || Number(p.changePct) >= heatThreshold;
  if (isHot) {
    return {
      bucket: 'strong_watch',
      reasons: [isLimitUp ? `触及有效涨停价${upper.toFixed(2)}` : `当日涨幅达到${heatThreshold.toFixed(1)}%防追高线`],
      isLimitUp,
      limitUpPrice: upper,
      heatThreshold,
      limitRule: 'standard',
    };
  }
  return { bucket: 'potential', reasons: [], isLimitUp, limitUpPrice: upper, heatThreshold, limitRule: 'standard' };
}

function applyCandidateQuotas(entries, { maxPerTheme = DEFAULT_PARAMS.maxPerTheme, maxCandidates = DEFAULT_PARAMS.maxCandidates } = {}) {
  const selected = [];
  const overQuota = [];
  const themeCounts = new Map();
  const seen = new Set();
  for (const entry of entries || []) {
    const code = String(entry.code || entry.profile?.code || '');
    if (!code || seen.has(code)) { overQuota.push({ ...entry, quotaReason: '代码缺失或重复候选' }); continue; }
    seen.add(code);
    if (selected.length >= maxCandidates) {
      overQuota.push({ ...entry, quotaReason: '超过全局候选上限' });
      continue;
    }
    const themeCodes = [...new Set((entry.matchingThemes || []).map((theme) => String(theme.code || theme.name || '')).filter(Boolean))];
    const fullTheme = themeCodes.find((code) => (themeCounts.get(code) || 0) >= maxPerTheme);
    if (fullTheme) {
      const theme = (entry.matchingThemes || []).find((item) => String(item.code || item.name || '') === fullTheme);
      overQuota.push({ ...entry, quotaReason: `${theme && theme.name || fullTheme}已达每题材${maxPerTheme}只上限` });
      continue;
    }
    selected.push(entry);
    for (const code of themeCodes) themeCounts.set(code, (themeCounts.get(code) || 0) + 1);
  }
  return { selected, overQuota, themeCounts: Object.fromEntries(themeCounts) };
}

function buildInitialSelection(entries, options = {}) {
  const params = { ...DEFAULT_PARAMS, ...(options.params || {}) };
  const potential = [];
  const strongWatch = [];
  const dataInsufficient = [];
  for (const entry of entries || []) {
    const initialAssessment = assessInitialCandidate(entry.profile, params);
    const enriched = { ...entry, initialAssessment };
    if (initialAssessment.bucket === 'potential') potential.push(enriched);
    else if (initialAssessment.bucket === 'strong_watch') strongWatch.push(enriched);
    else dataInsufficient.push(enriched);
  }
  const quota = applyCandidateQuotas(potential, {
    maxPerTheme: params.maxPerTheme,
    maxCandidates: Math.min(params.maxCandidates, options.limit == null ? params.maxCandidates : Math.max(0, Number(options.limit) || 0)),
  });
  return {
    policyVersion: POLICY_VERSION,
    parameterStatus: PARAMETER_STATUS,
    params,
    selected: quota.selected,
    strongWatch,
    dataInsufficient,
    overQuota: quota.overQuota,
    themeCounts: quota.themeCounts,
  };
}

module.exports = {
  POLICY_VERSION,
  PARAMETER_STATUS,
  DEFAULT_PARAMS,
  priceLimitRate,
  limitUpPrice,
  assessInitialCandidate,
  applyCandidateQuotas,
  buildInitialSelection,
};
