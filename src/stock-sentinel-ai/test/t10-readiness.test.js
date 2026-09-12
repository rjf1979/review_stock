const assert = require('node:assert/strict');
const { assessT10Readiness, futureTradingDates, regimeGroup } = require('../t10-readiness');
const { confirmedFutureBars } = require('../replay-inputs');

function sample(batch, regime, days, code) {
  return {
    item: { code, selectionBatchId: batch, prescanBatchId: `pre-${batch}`, marketRegime: { status: regime } },
    replayArchive: { archiveId: `arc-${batch}-${code}`, reviewBatchId: `rec-${batch}` },
    futureCandles: Array.from({ length: days }, (_, index) => ({ date: `2026-10-${String(index + 1).padStart(2, '0')}` })),
  };
}

const rows = [
  sample('a', 'strong_trend', 20, '600001'),
  sample('b', 'rotation', 10, '600002'),
  sample('c', 'weak', 5, '600003'),
];
const ready = assessT10Readiness(rows, { readyIndexes: [0, 1, 2] });
assert.equal(ready.status, 'ready_for_preliminary_replay');
assert.deepEqual(ready.regimeCoverage, { strong: 1, medium: 1, weak: 1, unknown: 0 });
assert.equal(ready.observationWindows['5'].matureSamples, 3);
assert.equal(ready.observationWindows['10'].matureSamples, 2);
assert.equal(ready.observationWindows['20'].matureSamples, 1);
assert.equal(ready.chains.selectionBatches, 3);
assert.equal(Object.prototype.hasOwnProperty.call(ready, 'winRate'), false);
assert.match(ready.disclaimer, /不代表样本量达到统计有效性/);

const blocked = assessT10Readiness(rows, { readyIndexes: [0, 1] });
assert.equal(blocked.status, 'awaiting_samples');
assert.ok(blocked.missing.includes('allSamplesPassedPrecheck'));
assert.ok(blocked.missing.includes('coversWeakMarket'));
assert.equal(blocked.observationWindows['20'].matureSamples, 1);

assert.equal(regimeGroup({ marketRegime: 'range_strong' }), 'strong');
assert.equal(regimeGroup({ marketRegime: { status: 'recovery' } }), 'medium');
assert.equal(regimeGroup({}), 'unknown');
assert.deepEqual(futureTradingDates({ futureCandles: [{ date: '2026-10-02' }, { date: '2026-10-01' }, { date: '2026-10-01' }] }), ['2026-10-01', '2026-10-02']);
assert.equal(assessT10Readiness([], { readyIndexes: [] }).status, 'awaiting_samples');
const legacy = assessT10Readiness(rows, { readyIndexes: [] }, { inputSource: 'legacy_candidate_pool' });
assert.equal(legacy.checks.hasArchivedSamples, false, '旧候选池不能被计作已归档样本');

const provisionalOnly = confirmedFutureBars(
  [{ date: '2026-09-11' }, { date: '2026-09-12' }],
  { sourceLatestDate: '2026-09-12', tailStatus: 'provisional', tailConfirmedAt: '' },
  '2026-09-11',
);
const premature = assessT10Readiness([
  { ...sample('p', 'strong_trend', 0, '600004'), futureCandles: provisionalOnly.bars },
], { readyIndexes: [0] }, { inputSource: 'selection_archives' });
assert.equal(premature.observationWindows['5'].matureSamples, 0, '唯一未来K线未确认时成熟天数必须保持为0');
assert.equal(futureTradingDates({ futureCandles: provisionalOnly.bars }).length, 0);

console.log('t10-readiness.test 通过');
