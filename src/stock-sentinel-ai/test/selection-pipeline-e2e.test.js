const assert = require('node:assert/strict');
const selectionPolicy = require('../selection-policy');
const candidateReview = require('../candidate-review');
const selectionReplay = require('../selection-replay');
const { migratePoolToWatch } = require('../pool-watch-migration');
const { rulesFingerprint } = require('../recommendation-validity');

function bars(count) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date('2026-07-03T00:00:00Z');
    date.setUTCDate(date.getUTCDate() + index);
    const close = 10 + index * 0.02;
    return { date: date.toISOString().slice(0, 10), open: close - 0.04, high: close + 0.08, low: close - 0.08, close, volume: 1000 };
  });
}

const rules = [{ id: 'platform_breakout', patternId: 'platform_breakout', enabled: true, params: { window: 20 } }];
const theme = { code: 'BK001', name: '隔离题材', kind: 'concept', rank: 1, asOf: '2026-09-11' };
const raw = [
  { code: '600101', price: 12, prevClose: 11.76, changePct: 2, amountYi: 2, turnover: 2 },
  { code: '600102', price: 11, prevClose: 10, changePct: 10, amountYi: 3, turnover: 3 },
  { code: '600103', price: 10.2, prevClose: 10, changePct: 2, amountYi: 0.1, turnover: 2 },
  { code: '600104', price: 12, prevClose: 11.76, changePct: 2, amountYi: 2, turnover: 2 },
];
const entries = raw.map((profile) => ({ profile, matchingThemes: [theme] }));
const initial = selectionPolicy.buildInitialSelection(entries);
assert.deepEqual(initial.selected.map((entry) => entry.profile.code), ['600101', '600104']);
assert.deepEqual(initial.strongWatch.map((entry) => entry.profile.code), ['600102']);
assert.deepEqual(initial.dataInsufficient.map((entry) => entry.profile.code), ['600103']);

const candidates = initial.selected.map((entry) => ({
  ...entry.profile,
  snapshotDate: '2026-09-11',
  selectionBatchId: 'selection-e2e',
  selectionPolicyVersion: initial.policyVersion,
  selectionRulesFingerprint: rulesFingerprint(rules),
  selectionRuleEvidence: rules,
  selectionParameterStatus: initial.parameterStatus,
  selectionPolicyParams: initial.params,
  selectionContractVersion: 3,
  ruleIds: ['platform_breakout'],
  themeEvidence: entry.matchingThemes,
  quoteEvidence: { sourceAt: '2026-09-11T07:00:00Z' },
}));
const replayed = candidates.map((item) => selectionReplay.replayCandidate({ item, candles: bars(71), rules }, {
  detectPatterns: () => ({ hits: [{ ruleId: 'platform_breakout', patternId: 'platform_breakout', score: 88 }] }),
  computeLevels: () => item.code === '600101'
    ? { entryTriggers: [{ confirmAbove: 11, status: 'confirmed' }], invalidationLevel: { value: 10 }, resistanceZones: [{ low: 14 }] }
    : { entryTriggers: [{ confirmAbove: 11, status: 'confirmed' }], invalidationLevel: { value: 11.1 }, resistanceZones: [{ low: 14 }] },
}));
const finalized = candidateReview.finalizeSelections(replayed.map((row) => ({ ...row.review })));
assert.equal(finalized.find((row) => row.code === '600101').selected, true);
assert.equal(finalized.find((row) => row.code === '600104').classification, 'not_passed');

let pool = candidates.slice();
const watched = [];
const recommendations = Object.fromEntries(finalized.map((result) => [result.code, {
  code: result.code,
  status: 'success',
  classification: result.classification,
  ruleVersion: 'candidate-review-v2',
  evidenceJson: {
    selected: result.selected,
    rulesFingerprint: rulesFingerprint(rules),
    selectionRulesFingerprint: candidates.find((item) => item.code === result.code).selectionRulesFingerprint,
    selectionBatchId: 'selection-e2e',
    snapshotDate: '2026-09-11',
    klineHash: 'same', klineDate: '2026-09-11',
    riskReward: result.riskReward,
  },
}]));

(async () => {
  const migrated = await migratePoolToWatch({}, {
    candidatePool: {
      getList: () => pool,
      remove: (code) => { pool = pool.filter((item) => item.code !== code); return { ok: true }; },
    },
    watchlist: {
      getList: () => watched,
      upsertFromPool: (candidate, evidence) => { watched.push({ ...candidate, selectionEvidence: evidence }); return { ok: true, unchanged: false }; },
    },
    loadRules: () => rules,
    latestWatchRecommendations: async () => recommendations,
    readKlineStats: async (codes) => codes.map((code) => ({ code, klineHash: 'same', latestDate: '2026-09-11' })),
    ruleVersion: 'candidate-review-v2',
  });
  assert.deepEqual(migrated.moved.map((item) => item.code), ['600101'], '只有有效精选能进入盯盘');
  assert.deepEqual(pool.map((item) => item.code), ['600104'], '未通过者必须保留在候选池');
  assert.deepEqual(watched.map((item) => item.code), ['600101']);
  console.log('selection-pipeline-e2e.test 通过');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
