const assert = require('node:assert/strict');
let sourceTime;
global.fetch = async () => ({ ok: true, json: async () => ({ data: { diff: [{
  f12: 'BK1', f14: '样例', f3: 2, f6: 1000, f62: 100, f124: sourceTime,
}] } }) });
const { fetchIndustryBoards, fetchConceptBoards } = require('../data');
(async () => {
  const missing = await fetchIndustryBoards({ tradeDate: '2026-09-11' });
  assert.equal(missing.asOf, '', '请求日期不能冒充响应日期');
  assert.equal(missing.boards[0].sourceAt, '');
  sourceTime = Date.parse('2026-09-10T07:00:00Z') / 1000;
  const old = await fetchConceptBoards({ tradeDate: '2026-09-11' });
  assert.equal(old.boards[0].sourceAt, '2026-09-10T07:00:00.000Z');
  console.log('board-source-time.test 通过');
})().catch((error) => { console.error(error); process.exitCode = 1; });
