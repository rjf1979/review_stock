const assert = require('node:assert/strict');
const replay = require('../selection-replay');
const { rulesFingerprint } = require('../recommendation-validity');

function candles(count, start = '2026-05-01', step = 0.02) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(`${start}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + index);
    const close = 10 + index * step;
    return { date: date.toISOString().slice(0, 10), open: close - 0.05, high: close + 0.1, low: close - 0.1, close, volume: 1000 };
  });
}

const rules = [{ id: 'platform_breakout', patternId: 'platform_breakout', enabled: true }];
const baseItem = {
  code: '600001', price: 11.2, changePct: 2, amountYi: 2, turnover: 2,
  snapshotDate: '2026-07-19', selectionBatchId: 'selection-test', selectionPolicyVersion: 'selection-policy-v1', selectionContractVersion: 3,
  selectionRulesFingerprint: rulesFingerprint(rules),
  selectionRuleEvidence: rules,
  selectionParameterStatus: 'provisional',
  selectionPolicyParams: { maxPerTheme: 3, maxCandidates: 20, minAmountYi: 0.5, minTurnover: 0.3, heatRatioOfLimit: 0.7 },
  ruleIds: ['platform_breakout'], quoteEvidence: { sourceAt: '2026-07-19T07:00:00Z' },
  themeEvidence: [{ code: 'BK1', name: '测试题材', rank: 1, asOf: '2026-07-19' }],
};
const adapters = {
  detectPatterns: () => ({ hits: [{ ruleId: 'platform_breakout', patternId: 'platform_breakout', score: 88 }] }),
  computeLevels: () => ({
    entryTriggers: [{ confirmAbove: 11, status: 'confirmed' }],
    invalidationLevel: { value: 10 },
    resistanceZones: [{ low: 14 }],
  }),
};

const history = candles(80);
const futureA = [
  { date: '2026-07-20', open: 11.6, high: 12, low: 11.4, close: 11.8, volume: 1200 },
  { date: '2026-07-21', open: 11.8, high: 12.5, low: 11.7, close: 12.2, volume: 1200 },
];
const futureB = futureA.map((bar) => ({ ...bar, high: bar.high + 10, close: bar.close + 8 }));
const resultA = replay.replayCandidate({ item: baseItem, candles: history.concat(futureA), rules }, adapters);
const resultB = replay.replayCandidate({ item: baseItem, candles: history.concat(futureB), rules }, adapters);
assert.equal(resultA.latestEvidenceDate, '2026-07-19');
assert.equal(resultA.evidenceHash, resultB.evidenceHash, '未来K线变化不能改变当时证据指纹');
assert.deepEqual(resultA.decision, resultB.decision, '未来K线变化不能改变当时分类');
assert.notEqual(resultA.observation.maxFavorablePct, resultB.observation.maxFavorablePct, '未来数据只允许改变事后观察值');
assert.equal(resultA.historicalEvidence.complete, true);
assert.equal(resultA.review.classification, 'passed');

const futureThemeA = replay.replayCandidate({ item: { ...baseItem, themeEvidence: [{ code: 'FUTURE-A', name: '未来题材A', asOf: '2026-07-20' }] }, candles: history, rules }, adapters);
const futureThemeB = replay.replayCandidate({ item: { ...baseItem, themeEvidence: [{ code: 'FUTURE-B', name: '未来题材B', asOf: '2026-07-20' }] }, candles: history, rules }, adapters);
assert.deepEqual(futureThemeA.matchingThemes, []);
assert.equal(futureThemeA.evidenceHash, futureThemeB.evidenceHash, '未来题材证据不能影响回放指纹或配额');

const partition = replay.splitCandlesAt([
  { date: '2026-07-20', close: 2 }, { date: 'bad', close: 3 }, { date: '2026-07-19', close: 1 }, { date: '2026-07-19', close: 1.1 },
], '2026-07-19');
assert.equal(partition.evidence.length, 1, '同日重复K线不能扩大证据样本');
assert.equal(partition.future.length, 1);
assert.equal(partition.invalidDateCount, 1);
assert.equal(partition.duplicateDateCount, 1);

const hotBoundary = replay.replayCandidate({ item: { ...baseItem, price: 10.7, changePct: 7 }, candles: history, rules }, { ...adapters, initialParams: { heatRatioOfLimit: 0.7 } });
assert.equal(hotBoundary.initialAssessment.bucket, 'strong_watch', '主板达到7%防追高线时必须进入强势观察');
const lowLiquidity = replay.replayCandidate({ item: { ...baseItem, amountYi: 0.1 }, candles: history, rules }, adapters);
assert.equal(lowLiquidity.initialAssessment.bucket, 'data_insufficient');

const futureEvidence = replay.historicalEvidenceIssues({
  ...baseItem,
  quoteEvidence: { sourceAt: '2026-07-20T02:00:00Z' },
  themeEvidence: [{ code: 'BK1', name: '测试题材', asOf: '2026-07-20' }],
}, '2026-07-19');
assert.equal(futureEvidence.complete, false);
assert.equal(futureEvidence.futureDated.length, 2, '晚于回放时点的行情和题材证据都必须拒绝');

const missingEvidence = replay.replayCandidate({
  item: { ...baseItem, selectionBatchId: '', quoteEvidence: {} }, candles: history, rules,
}, adapters);
assert.equal(missingEvidence.historicalEvidence.complete, false);
assert.equal(missingEvidence.review.classification, 'insufficient');

const quotaSamples = Array.from({ length: 12 }, (_, index) => ({
  item: { ...baseItem, code: String(600100 + index), themeEvidence: [{ code: `BK${Math.floor(index / 2)}`, rank: 1, asOf: baseItem.snapshotDate }] },
  candles: history,
  rules,
}));
const sensitivity = replay.runSensitivity(quotaSamples, [
  { id: 'five', label: '5只', reviewParams: { maxSelected: 5 } },
  { id: 'ten', label: '10只', reviewParams: { maxSelected: 10 } },
], adapters);
assert.equal(sensitivity[0].summary.selected, 5);
assert.equal(sensitivity[1].summary.selected, 10);
assert.equal(replay.runSensitivity([], [{ id: 'empty', label: '空样本' }], adapters)[0].summary.selected, 0, '零结果不得补足配额');

console.log('selection-replay.test 通过');
const noBatch = replay.replayCandidate({ item: { ...baseItem, selectionBatchId: '' }, candles: history, rules }, adapters);
assert.equal(noBatch.review.classification, 'insufficient', '缺少批次不能只作提示后继续通过');
assert.equal(replay.summarizeReplays([noBatch]).selected, 0);
assert.equal(replay.summarizeReplays([noBatch]).admittedAfterInitialQuota, null, '旧样本不得合并为一个虚构批次');
assert.equal(futureThemeA.review.classification, 'insufficient');
assert.equal(replay.historicalEvidenceIssues({ ...baseItem, selectionContractVersion: undefined }, baseItem.snapshotDate).complete, false);
assert.equal(replay.historicalEvidenceIssues({ ...baseItem, quoteEvidence: { sourceAt: 'bad' } }, baseItem.snapshotDate).complete, false);
assert.equal(replay.dateOnly('2026-02-30'), '');
assert.equal(replay.observeForwardOutcome(history, [{ ...futureA[0], low: null }]).maxAdversePct, null);
const twoBatches = [resultA, { ...resultA, selectionBatchId: 'second' }];
assert.equal(replay.summarizeReplays(twoBatches).selected, 2, '不同批次的同一股票应独立回放');
const smallQuota = replay.runSensitivity(quotaSamples, [{ id: 'small', initialParams: { maxCandidates: 1 } }], adapters);
assert.equal(smallQuota[0].summary.selected, 1);
const duplicateBatch = replay.summarizeReplays([resultA, resultA]);
assert.equal(duplicateBatch.quotaVerifiedBatches, 0);
assert.equal(duplicateBatch.quotaUnverifiedSamples, 2);
assert.equal(duplicateBatch.admittedAfterInitialQuota, null);
