const assert = require('node:assert/strict');
let calls = 0;
global.fetch = async () => {
  calls += 1;
  const rows = calls === 1 ? [
    { f12: '600001', f14: 'A', f2: 10, f3: 1, f6: 1, f8: 1, f10: 1, f20: 1, f21: 1, f62: 1 },
    { f12: '600001', f14: 'A', f2: 10, f3: 1, f6: 1, f8: 1, f10: 1, f20: 1, f21: 1, f62: 1 },
  ] : [];
  const payload = { data: { total: 3, diff: rows } };
  return { ok: true, text: async () => JSON.stringify(payload), json: async () => payload };
};
const { fetchMarketPages } = require('../data');
(async () => {
  const result = await fetchMarketPages('sh_main', { pageSize: 2 });
  assert.equal(result.total, 3);
  assert.equal(result.fetched, 1);
  assert.equal(result.quality.rawRows, 2);
  assert.equal(result.quality.duplicateRows, 1);
  assert.equal(result.quality.complete, false);
  assert.equal(result.rawPages.length, 2);
  assert.match(result.rawPages[0].sha256, /^[0-9a-f]{64}$/);
  assert.ok(result.rawPages[0].byteLength > 0);
  assert.equal(JSON.parse(result.rawPages[0].rawText).data.total, 3);
  assert.equal(result.rawPages[0].wireExact, true, 'text()响应须保留原始文本');
  console.log('market-pages-quality.test 通过');
  calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 2) throw new Error('模拟第二页失败');
    return { ok: true, json: async () => ({ data: { total: 3, diff: [
      { f12: '600001', f14: 'A', f2: 10, f3: 1, f6: 1, f8: 1, f10: 1, f20: 1, f21: 1, f62: 1 },
      { f12: '600002', f14: 'B', f2: 10, f3: 1, f6: 1, f8: 1, f10: 1, f20: 1, f21: 1, f62: 1 },
    ] } }) };
  };
  const partial = await fetchMarketPages('sh_main', { pageSize: 2 });
  assert.equal(partial.records.length, 2, '中途失败仍保留已成功页用于诊断');
  assert.equal(partial.quality.complete, false);
  assert.equal(partial.quality.errors.length, 1);
  assert.equal(partial.quality.pages, 1);
  assert.equal(partial.rawPages[0].wireExact, false, '缺少text()时明确标记为重序列化');

  calls = 0;
  global.fetch = async () => {
    calls += 1;
    const payload = { data: { total: 2, diff: [
      { f12: '600001', f14: '正常交易', f2: 10, f3: 1, f6: 1, f8: 1, f10: 1, f20: 1, f21: 1, f62: 1 },
      { f12: '600002', f14: '停牌无价', f2: 0, f3: 0, f6: 0, f8: 0, f10: 0, f20: 1, f21: 1, f62: 0 },
    ] } };
    return { ok: true, text: async () => JSON.stringify(payload) };
  };
  const filtered = await fetchMarketPages('sh_main', { pageSize: 2 });
  assert.equal(calls, 1, '原始行数达到接口总数后不因停牌过滤误抓额外页');
  assert.equal(filtered.records.length, 1);
  assert.equal(filtered.quality.rawRows, 2);
  assert.equal(filtered.quality.filteredRows, 1);
  assert.equal(filtered.quality.complete, true, '停牌或无价行被正常过滤不代表分页不完整');
})().catch((error) => { console.error(error); process.exitCode = 1; });
