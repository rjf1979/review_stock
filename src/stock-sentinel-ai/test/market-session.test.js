const assert = require('node:assert/strict');
const { marketSession, isCnStockTradingSession, isAfterCnMarketClose } = require('../market-session');

const at = (iso) => new Date(iso);
assert.equal(marketSession(at('2026-09-07T01:14:00Z')), 'pre_open', '09:14 为盘前');
assert.equal(isCnStockTradingSession(at('2026-09-07T01:15:00Z')), true, '09:15 开始同步');
assert.equal(marketSession(at('2026-09-07T03:29:00Z')), 'morning', '11:29 为上午盘');
assert.equal(isCnStockTradingSession(at('2026-09-07T03:30:00Z')), false, '11:30 开始午休');
assert.equal(marketSession(at('2026-09-07T04:59:00Z')), 'midday_break', '12:59 为午休');
assert.equal(isCnStockTradingSession(at('2026-09-07T05:00:00Z')), true, '13:00 恢复同步');
assert.equal(isCnStockTradingSession(at('2026-09-07T07:00:00Z')), false, '15:00 不再作为盘中');
assert.equal(isAfterCnMarketClose(at('2026-09-07T07:00:00Z')), true, '15:00 进入盘后校验');
assert.equal(marketSession(at('2026-09-05T02:00:00Z')), 'non_trading', '周末不交易');
console.log('market-session.test 通过');
