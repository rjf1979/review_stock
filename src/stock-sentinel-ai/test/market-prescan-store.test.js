const assert = require('node:assert/strict');
const { isClosedMarketTime, canReuseClosedPrescan, assessPrescanValidity, expectedPrescanDate } = require('../market-prescan-store');

const at = (iso) => new Date(iso);
assert.equal(isClosedMarketTime(at('2026-09-04T07:01:00Z')), true, '交易日 15:01 应视为闭市');
assert.equal(isClosedMarketTime(at('2026-09-04T06:59:00Z')), false, '交易日 14:59 仍是盘中');
const record = { fetchedAt: '2026-09-04T06:50:00Z', isFinal: false, asOf: '2026-09-04', marketKey: 'sh_main', scopeCodes: ['600000'], marketRegime: {} };
const closedRecord = { ...record, fetchedAt: '2026-09-04T07:05:00Z', isFinal: true };
assert.equal(canReuseClosedPrescan(record, at('2026-09-04T06:59:00Z')), true, '同一交易日可继续使用已确认的题材范围');
assert.equal(canReuseClosedPrescan(closedRecord, at('2026-09-05T02:00:00Z')), true, '周末可以使用最近交易日的闭市题材扫描股票');
assert.equal(canReuseClosedPrescan(closedRecord, at('2026-09-07T00:30:00Z')), true, '新交易日盘前仍可使用上一交易日闭市题材');
assert.equal(canReuseClosedPrescan(closedRecord, at('2026-09-07T01:15:00Z')), false, '新交易时段开始后必须切换到当天数据');
assert.deepEqual(assessPrescanValidity(closedRecord, { marketKey: 'sh_main', now: at('2026-09-05T02:00:00Z') }), {
  displayable: true, scanEligible: true, reason: '', currentDate: '2026-09-05', expectedDate: '2026-09-04',
});
assert.equal(assessPrescanValidity(record, { marketKey: 'sz_main', now: at('2026-09-04T02:00:00Z') }).reason, 'market_changed');
assert.equal(assessPrescanValidity({ ...record, scopeCodes: new Set(record.scopeCodes) }, { marketKey: 'sh_main', now: at('2026-09-04T06:59:00Z') }).scanEligible, true, '服务恢复后的运行时 Set 范围应保持可扫描');
console.log('market-prescan-store.test 通过');
assert.equal(assessPrescanValidity(record, { now: at('2026-09-04T07:30:00Z') }).reason, 'prescan_expired');
assert.equal(assessPrescanValidity({ ...record, fetchedAt: '' }, { now: at('2026-09-04T06:59:00Z') }).reason, 'source_time_missing');
assert.equal(assessPrescanValidity({ ...record, fetchedAt: '2026-09-04T07:05:00Z', isFinal: true }, { now: at('2026-09-04T12:00:00Z') }).scanEligible, true);
const { isQuoteFresh } = require('../market-prescan-store');
assert.equal(isQuoteFresh('2026-09-04T02:00:00Z', '2026-09-04', at('2026-09-04T02:06:00Z')), false);
assert.equal(isQuoteFresh('2026-09-04T02:04:00Z', '2026-09-04', at('2026-09-04T02:06:00Z')), true);
assert.equal(isQuoteFresh('2026-09-04T03:30:00Z', '2026-09-04', at('2026-09-04T04:30:00Z')), true);
assert.equal(isQuoteFresh('2026-09-04T03:30:00Z', '2026-09-04', at('2026-09-04T05:06:00Z')), false);
assert.equal(isQuoteFresh('2026-09-04T07:00:00Z', '2026-09-04', at('2026-09-04T12:00:00Z')), true);
assert.equal(isQuoteFresh('2026-09-04T07:00:00Z', '2026-09-04', at('2026-09-04T02:00:00Z')), false);
assert.equal(expectedPrescanDate(at('2026-09-05T02:00:00Z')), '2026-09-04', '周末基准是最近交易日');
assert.equal(expectedPrescanDate(at('2026-09-07T00:30:00Z')), '2026-09-04', '交易日盘前基准仍是上一交易日');
assert.equal(expectedPrescanDate(at('2026-09-07T01:15:00Z')), '2026-09-07', '交易时段开始切换到当天');
assert.equal(isQuoteFresh('2026-09-04T07:05:00Z', '2026-09-04', at('2026-09-05T02:00:00Z')), true, '周末接受最近交易日收盘板块行情');
assert.equal(isQuoteFresh('2026-09-04T07:05:00Z', '2026-09-04', at('2026-09-07T00:30:00Z')), true, '周一盘前接受周五收盘板块行情');
assert.equal(isQuoteFresh('2026-09-04T07:05:00Z', '2026-09-04', at('2026-09-07T01:15:00Z')), false, '周一开盘后拒绝周五板块行情');
