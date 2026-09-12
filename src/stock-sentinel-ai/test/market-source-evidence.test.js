const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fields = Array(31).fill('');
fields[1] = 'INDEX'; fields[3] = '3000'; fields[4] = '2990'; fields[30] = '20260912150000';
const indexBytes = Buffer.from(`v_sh000001="${fields.join('~')}";`, 'ascii');
global.fetch = async (url) => {
  if (String(url).includes('qt.gtimg.cn')) return { ok: true, arrayBuffer: async () => indexBytes };
  const payload = { data: { total: 1, diff: [{ f12: 'BK1', f14: '样例', f2: 10, f3: 2, f6: 1000, f8: 1, f10: 1, f20: 1, f21: 1, f62: 100, f124: 1789196400 }] } };
  const text = JSON.stringify(payload);
  return { ok: true, text: async () => text, json: async () => payload };
};
const { fetchMajorIndicesTencent, fetchIndustryBoards, fetchBoardConstituents } = require('../data');
(async () => {
  const indices = await fetchMajorIndicesTencent();
  assert.equal(indices.indices.length, 1);
  assert.equal(indices.rawResponse.wireExact, true);
  assert.equal(indices.rawResponse.sha256, crypto.createHash('sha256').update(indexBytes).digest('hex'));
  assert.equal(Buffer.from(indices.rawResponse.rawBase64, 'base64').equals(indexBytes), true);
  const boards = await fetchIndustryBoards({ tradeDate: '2026-09-12' });
  assert.match(boards.rawResponse.sha256, /^[0-9a-f]{64}$/);
  assert.equal(boards.rawResponse.wireExact, true);
  const members = await fetchBoardConstituents('BK1');
  assert.equal(members.rawPages.length, 1);
  assert.equal(JSON.parse(members.rawPages[0].rawText).data.total, 1);
  console.log('market-source-evidence.test 通过');
})().catch((error) => { console.error(error); process.exitCode = 1; });
