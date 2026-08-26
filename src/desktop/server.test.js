const assert = require('assert');
const { expectedSnapshotDate, canReuseClosedSnapshot, stockQuoteCacheKey, klineCacheTtl } = require('./server');

function session(date, state) {
  return { date, state, isTrading: false };
}

function snapshot(sourceDate) {
  return { dataMeta: { aShare: { sourceDate } } };
}

assert.strictEqual(expectedSnapshotDate(session('2026-08-26', 'closed')), '2026-08-26');
assert.strictEqual(canReuseClosedSnapshot(snapshot('2026-08-25'), session('2026-08-26', 'closed')), false);
assert.strictEqual(canReuseClosedSnapshot(snapshot('2026-08-26'), session('2026-08-26', 'closed')), true);
assert.strictEqual(canReuseClosedSnapshot(snapshot('2026-08-26'), session('2026-08-26', 'lunch')), true);
assert.strictEqual(expectedSnapshotDate(session('2026-08-27', 'preopen')), '2026-08-26');
assert.strictEqual(canReuseClosedSnapshot(snapshot('2026-08-26'), session('2026-08-27', 'preopen')), true);
assert.strictEqual(expectedSnapshotDate(session('2026-08-29', 'weekend')), '2026-08-28');
assert.strictEqual(canReuseClosedSnapshot(snapshot('2026-08-28'), session('2026-08-29', 'weekend')), true);
assert.strictEqual(stockQuoteCacheKey('600519', session('2026-08-26', 'closed')), 'stocks:2026-08-26:600519');
assert.notStrictEqual(stockQuoteCacheKey('600519', session('2026-08-25', 'closed')), stockQuoteCacheKey('600519', session('2026-08-26', 'closed')));
assert.strictEqual(klineCacheTtl('2026-08-26', session('2026-08-26', 'closed')), 5 * 60 * 1000);
assert.strictEqual(klineCacheTtl('2026-08-26', { ...session('2026-08-26', 'afternoon'), isTrading: true }), 60 * 1000);
assert.strictEqual(klineCacheTtl('2026-08-25', session('2026-08-26', 'closed')), Number.POSITIVE_INFINITY);

console.log('server cache-date tests passed');
