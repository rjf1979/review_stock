const assert = require('assert');
const { expectedSnapshotDate, canReuseClosedSnapshot, stockQuoteCacheKey, klineCacheTtl, buildMonitorPayload, normalizeMonitorCodes } = require('./server');

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
assert.deepStrictEqual(normalizeMonitorCodes('600519,,300750,bad'), ['600519', '300750']);
assert.strictEqual(normalizeMonitorCodes('600519,600520,600521,600522,600523,600524').length, 5);

const monitor = buildMonitorPayload(
  [
    { name: '上证指数', close: '3123.45', changePct: -0.12, quoteAt: null, capturedAt: '2026-08-26T07:00:00Z' },
    { name: '科创50', close: 1, changePct: 1 },
    { name: '创业板指', close: NaN },
  ],
  [
    { code: 600519, name: '', latest: 1500, changePct: '1.5', quoteAt: null },
    { code: '000858', latest: null, changePct: null, capturedAt: '2026-08-26T07:00:00Z' },
    { code: '399001', name: '不在监控列表', latest: 1, changePct: 1 },
  ],
  ['600519', '000858'],
  session('2026-08-26', 'closed'),
);
assert.deepStrictEqual(monitor.indices.map(item => item.name), ['上证指数', '深证成指', '创业板指'].filter(name => name !== '深证成指'));
assert.strictEqual(monitor.indices[0].close, 3123.45);
assert.strictEqual(monitor.indices[0].quoteAt, '2026-08-26T07:00:00Z');
assert.strictEqual(monitor.stocks.length, 2);
assert.strictEqual(monitor.stocks[0].name, '600519');
assert.strictEqual(monitor.stocks[0].changePct, 1.5);
assert.strictEqual(monitor.stocks[1].latest, null);
assert.strictEqual(monitor.stocks[1].code, '000858');
assert.strictEqual(monitor.session.date, '2026-08-26');
assert.deepStrictEqual(buildMonitorPayload([], [], ['300750'], session('2026-08-26', 'closed')).stocks, [{
  code: '300750', name: '300750', latest: null, changePct: null, quoteAt: null,
}]);

console.log('server cache-date tests passed');
