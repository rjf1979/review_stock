// 候选池到盯盘的规则推荐。结论仅辅助人工复核，绝不自动交易或迁移名单。
const crypto = require('crypto');
const { readKline, saveWatchRecommendationBatch, saveWatchRecommendation, latestWatchRecommendations } = require('./storage');
const { detectSinglePatterns } = require('./screener-core');
const { riskFlagsForCandidate } = require('./market-regime');
const RULE_VERSION = 'candidate-watch-v1';
let active = null;
let lastStatus = { running: false };
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);

async function evaluate(item) {
  const code = String(item.code || ''); const rec = await readKline(code); const bars = (rec && rec.kline) || [];
  const missing = [];
  if (!Number.isFinite(Number(item.price))) missing.push('缺少有效行情价格');
  if (bars.length < 60) missing.push(`日K样本不足（${bars.length}/60）`);
  const latest = bars[bars.length - 1] || {}; const patterns = bars.length >= 60 ? detectSinglePatterns(bars, { code }).hits : [];
  const flags = [...(Array.isArray(item.riskFlags) ? item.riskFlags : []), ...riskFlagsForCandidate(item, { marketStatus: item.marketRegime && item.marketRegime.status })];
  const reasons = []; let classification;
  if (missing.length) classification = 'insufficient';
  else if (item.marketRegime && item.marketRegime.status === 'weak') { classification = 'confirm'; reasons.push('弱势市场仅保留等待确认'); }
  else if (flags.some((x) => ['extended_gain', 'flow_divergence'].includes(x.key)) || !patterns.length) { classification = 'not_recommended'; reasons.push(!patterns.length ? '未发现已验证的日K形态' : '风险门槛未满足'); }
  else if (Number(item.volumeRatio) >= 1 && Number(item.score) >= 60) { classification = 'priority'; reasons.push('形态、量能与流动性满足优先盯盘条件'); }
  else { classification = 'confirm'; reasons.push('已有形态依据，等待量能或收盘确认'); }
  const conditions = classification === 'priority' || classification === 'confirm'
    ? { trigger: `日线收盘确认站稳 ${Number(latest.close || item.price).toFixed(2)}，且量比不低于 1`, invalidation: '跌破近期形态低点或量价结构转弱时重新评估', basis: '仅按日K验证，不宣称盘中持续放量' }
    : { trigger: '补齐数据或出现新的有效日K形态后重新评估', invalidation: '当前不满足策略门槛', basis: '规则结论，不构成投资建议' };
  const evidence = { snapshotDate: item.snapshotDate || '', klineDate: latest.date || '', bars: bars.length, patterns: patterns.map((x) => ({ label: x.label, score: x.score })), riskFlags: flags, marketRegime: item.marketRegime || null };
  return { code, classification, reasonCodes: reasons, evidence, conditions, missing, ruleVersion: RULE_VERSION, evidenceHash: hash({ item, evidence }), status: 'success', createdAt: Date.now() };
}
async function start(items) {
  if (active) return { started: false, reason: 'running', ...active.status };
  const snapshot = (Array.isArray(items) ? items : []).filter((x) => /^\d{6}$/.test(String(x && x.code)));
  const batchId = `rec-${Date.now()}`; const status = { batchId, running: true, status: 'running', total: snapshot.length, done: 0, succeeded: 0, failed: 0, startedAt: Date.now(), finishedAt: 0 };
  active = { status, cancelled: false }; lastStatus = status;
  await saveWatchRecommendationBatch({ ...status, snapshot });
  (async () => { for (const item of snapshot) { if (active.cancelled) break; try { const result = await evaluate(item); result.batchId = batchId; await saveWatchRecommendation(result); status.succeeded++; } catch { status.failed++; } status.done++; await saveWatchRecommendationBatch({ ...status, snapshot }); }
    status.running = false; status.status = active.cancelled ? 'cancelled' : 'completed'; status.finishedAt = Date.now(); await saveWatchRecommendationBatch({ ...status, snapshot }); lastStatus = { ...status }; active = null;
  })();
  return { started: true, ...status };
}
function getStatus() { return active ? { ...active.status } : { ...lastStatus }; }
function stop() { if (!active) return { running: false }; active.cancelled = true; return { ...active.status, stopping: true }; }
module.exports = { start, getStatus, stop, latest: latestWatchRecommendations, RULE_VERSION };
