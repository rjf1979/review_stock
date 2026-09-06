const assert = require('node:assert/strict');
const { isClosedMarketTime, canReuseClosedPrescan } = require('../market-prescan-store');

const at = (iso) => new Date(iso);
assert.equal(isClosedMarketTime(at('2026-09-04T07:01:00Z')), true, '交易日 15:01 应视为闭市');
assert.equal(isClosedMarketTime(at('2026-09-04T06:59:00Z')), false, '交易日 14:59 仍是盘中');
assert.equal(canReuseClosedPrescan({ isFinal: true, asOf: '2026-09-04' }, at('2026-09-05T02:00:00Z')), true, '周末复用周五闭市结果');
assert.equal(canReuseClosedPrescan({ isFinal: true, asOf: '2026-09-04' }, at('2026-09-07T02:00:00Z')), false, '新交易日开盘后不能继续复用旧闭市结果');
assert.equal(canReuseClosedPrescan({ isFinal: false, asOf: '2026-09-04' }, at('2026-09-05T02:00:00Z')), false, '盘中结果不能作为闭市结果复用');
console.log('market-prescan-store.test 通过');
