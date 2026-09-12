const candidatePool = require('./candidate-pool');
const watchlist = require('./watchlist');
const rulesStore = require('./rules-store');
const { readKlineStats, latestWatchRecommendations } = require('./storage');
const { RULE_VERSION } = require('./watch-recommendation');
const { assessRecommendation, recommendationEvidence, recommendationSelected, stableValue } = require('./recommendation-validity');

const DEFAULT_SELECTED_LIMIT = 5;

function primaryTheme(candidate = {}) {
  const ranks = Array.isArray(candidate.candidateThemeRanks) ? candidate.candidateThemeRanks : [];
  const first = ranks.slice().sort((a, b) => Number(a.rank) - Number(b.rank))[0];
  if (first) return { code: String(first.code || first.name || ''), name: String(first.name || first.code || '') };
  const themes = Array.isArray(candidate.themeEvidence) ? candidate.themeEvidence : [];
  const theme = themes.slice().sort((a, b) => Number(a.rank) - Number(b.rank))[0];
  return theme ? { code: String(theme.code || theme.name || ''), name: String(theme.name || theme.code || '') } : { code: '', name: '未分类' };
}

function concentrationWarnings(watchItems = []) {
  const counts = new Map();
  for (const item of watchItems) {
    const evidence = item.selectionEvidence || {};
    const candidate = { ...item, candidateThemeRanks: evidence.candidateThemeRanks, themeEvidence: evidence.themeEvidence || item.themeEvidence };
    const primary = primaryTheme(candidate);
    const themes = Array.isArray(candidate.themeEvidence) ? candidate.themeEvidence : [];
    const exposures = new Map(themes.map((theme) => [String(theme.code || theme.name || ''), String(theme.name || theme.code || '')]));
    if (primary.code) exposures.set(primary.code, primary.name);
    for (const [code, name] of exposures) {
      if (!code) continue;
      const current = counts.get(code) || { name, count: 0 };
      current.count++;
      counts.set(code, current);
    }
  }
  return [...counts.values()].filter((item) => item.count > 2).map((item) => `${item.name}已有${item.count}只，题材集中度超过建议线2只`);
}

function recommendationSnapshot(record, validity) {
  return {
    batchId: String(record.batchId || ''), classification: String(record.classification || ''), selected: recommendationSelected(record),
    status: String(record.status || ''), ruleVersion: String(record.ruleVersion || ''), evidenceHash: String(record.evidenceHash || ''),
    createdAt: Number(record.createdAt) || 0, reasonCodes: record.reasonCodesJson || record.reasonCodes || [],
    evidence: recommendationEvidence(record), conditions: record.conditionsJson || record.conditions || {}, missing: record.missingJson || record.missing || [], validity,
  };
}

async function migratePoolToWatch(input = {}, adapters = {}) {
  const poolStore = adapters.candidatePool || candidatePool;
  const watchStore = adapters.watchlist || watchlist;
  const loadRules = adapters.loadRules || rulesStore.load;
  const loadRecommendations = adapters.latestWatchRecommendations || latestWatchRecommendations;
  const loadKlineStats = adapters.readKlineStats || readKlineStats;
  const expectedRuleVersion = adapters.ruleVersion || RULE_VERSION;
  const today = String(input.baselineTargetDate || '');
  const mode = input.mode === 'observation' ? 'observation' : 'selected';
  const explicitCodes = input.codes !== undefined;
  if (explicitCodes && !Array.isArray(input.codes)) return { ok: false, error: 'codes必须是股票代码数组', moved: [], skipped: [], failed: [] };
  const requested = [...new Set((Array.isArray(input.codes) ? input.codes : []).map(String).filter((code) => /^\d{6}$/.test(code)))];
  if (explicitCodes && !requested.length) return { ok: true, mode, requested: 0, eligible: 0, moved: [], skipped: [], failed: [], warnings: [] };
  const pool = JSON.parse(JSON.stringify(poolStore.getList()));
  const poolByCode = new Map(pool.map((item) => [String(item.code), item]));
  const targets = (explicitCodes ? requested.map((code) => poolByCode.get(code)).filter(Boolean) : pool.slice());
  const codes = targets.map((item) => String(item.code));
  const [recommendations, stats] = await Promise.all([loadRecommendations(codes), loadKlineStats(codes, { includeFingerprint: true })]);
  const statsByCode = new Map((stats || []).map((item) => [String(item.code), item]));
  const rules = loadRules();
  const eligible = [];
  const skipped = [];
  for (const candidate of targets) {
    const record = recommendations[String(candidate.code)];
    if (!record) { skipped.push({ code: candidate.code, reason: '尚未完成严格复核' }); continue; }
    const stat = statsByCode.get(String(candidate.code)) || {};
    const validity = assessRecommendation(record, { candidate, currentRules: rules, klineDate: String(stat.latestDate || ''), klineHash: stat.klineHash || '', expectedRuleVersion,
      tailStatus: stat.tailStatus || '', tailConfirmedAt: stat.tailConfirmedAt || '', klineSource: stat.source || '', adjustmentType: stat.adjustmentType || '' });
    if (!validity.current) { skipped.push({ code: candidate.code, reason: '复核结论已失效：' + validity.reasons.join('；') }); continue; }
    const allowed = mode === 'observation'
      ? record.classification === 'pending_confirmation'
      : record.classification === 'passed' && recommendationSelected(record);
    if (!allowed) { skipped.push({ code: candidate.code, reason: mode === 'observation' ? '仅待确认股票可转入观察' : '仅本批精选可批量转入' }); continue; }
    eligible.push({ candidate, record, validity });
  }
  if (mode === 'selected') eligible.sort((a, b) => Number(b.record.evidenceJson?.riskReward?.value || 0) - Number(a.record.evidenceJson?.riskReward?.value || 0) || String(a.candidate.code).localeCompare(String(b.candidate.code)));
  const limited = mode === 'selected' ? eligible.slice(0, Number(input.limit) > 0 ? Math.min(Number(input.limit), DEFAULT_SELECTED_LIMIT) : DEFAULT_SELECTED_LIMIT) : eligible;
  for (const extra of eligible.slice(limited.length)) skipped.push({ code: extra.candidate.code, reason: `超过本次精选转入上限${DEFAULT_SELECTED_LIMIT}只` });
  const moved = [];
  const failed = [];
  for (const entry of limited) {
    let latestStats;
    try { latestStats = (await loadKlineStats([String(entry.candidate.code)], { includeFingerprint: true }))[0]; }
    catch (error) { failed.push({ code: entry.candidate.code, stage: 'evidence_check', error: String(error.message || error) }); continue; }
    const latestValidity = assessRecommendation(entry.record, {
      candidate: entry.candidate, currentRules: loadRules(), expectedRuleVersion,
      klineDate: latestStats?.latestDate || '', klineHash: latestStats?.klineHash || '',
      tailStatus: latestStats?.tailStatus || '', tailConfirmedAt: latestStats?.tailConfirmedAt || '',
      klineSource: latestStats?.source || '', adjustmentType: latestStats?.adjustmentType || '',
    });
    if (!latestValidity.current) { skipped.push({ code: entry.candidate.code, reason: '提交前证据已失效：' + latestValidity.reasons.join('；') }); continue; }
    entry.validity = latestValidity;
    // 前面的异步读取期间，用户可能删除或重新扫描此候选。提交前同步复查。
    const current = poolStore.getList().find((item) => String(item.code) === String(entry.candidate.code));
    if (!current || JSON.stringify(stableValue(current)) !== JSON.stringify(stableValue(entry.candidate))) {
      skipped.push({ code: entry.candidate.code, reason: '候选已删除或证据已更新，请重新复核' });
      continue;
    }
    let stage = 'watch_save';
    try {
    const saved = watchStore.upsertFromPool(entry.candidate, {
      mode, recommendation: recommendationSnapshot(entry.record, entry.validity), transferredAt: new Date().toISOString(),
    }, { baselineTargetDate: today });
    if (!saved.ok) { failed.push({ code: entry.candidate.code, stage: 'watch_save', error: saved.error }); continue; }
    stage = 'pool_remove';
    const removed = poolStore.remove(entry.candidate.code);
    if (!removed.ok) { failed.push({ code: entry.candidate.code, stage: 'pool_remove', error: removed.error, watchSaved: true }); continue; }
    moved.push({ code: entry.candidate.code, name: entry.candidate.name || '', unchanged: saved.unchanged === true, mode });
    } catch (error) {
      failed.push({ code: entry.candidate.code, stage, error: String(error.message || error), watchSaved: stage === 'pool_remove' });
    }
  }
  const warnings = concentrationWarnings(watchStore.getList());
  return { ok: failed.length === 0, mode, requested: targets.length, eligible: eligible.length, moved, skipped, failed, warnings, limit: mode === 'selected' ? DEFAULT_SELECTED_LIMIT : null };
}

module.exports = { DEFAULT_SELECTED_LIMIT, primaryTheme, concentrationWarnings, recommendationSnapshot, migratePoolToWatch };
