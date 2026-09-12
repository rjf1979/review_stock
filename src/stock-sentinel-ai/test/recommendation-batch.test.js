const assert = require('node:assert/strict');
const recommendation = require('../watch-recommendation');
const items = [{ code: '600001' }, { code: '600002' }];
const settle = async () => {
  for (let i = 0; i < 100 && recommendation.getStatus().running; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(recommendation.getStatus().running, false, '任务必须收尾');
  return recommendation.getStatus();
};
const base = { loadRules: () => [], saveBatch: async () => true, saveResult: async () => true,
  evaluate: async (item) => ({ code: item.code, classification: 'insufficient', evidence: {} }) };
(async () => {
  const first = await recommendation.start(items, { ...base, saveBatch: async () => { throw new Error('启动写入失败'); } });
  assert.equal(first.started, false);
  assert.equal(recommendation.getStatus().running, false);
  let calls = 0;
  await recommendation.start(items, { ...base, saveBatch: async () => { if (++calls > 1) return false; return true; } });
  assert.equal((await settle()).status, 'failed', '进度落盘返回false也必须终止');
  await recommendation.start(items, { ...base, saveResult: async () => { throw new Error('结果写入失败'); } });
  assert.equal((await settle()).status, 'failed');
  const rules = [{ id: 'original', params: { days: 20 } }], seen = [];
  await recommendation.start(items, { ...base, loadRules: () => rules, evaluate: async (item, adapters) => {
    seen.push(adapters.loadRules()[0].params.days);
    rules[0].params.days = 99;
    return base.evaluate(item);
  } });
  assert.equal((await settle()).status, 'completed');
  assert.deepEqual(seen, [20, 20], '批内使用同一规则快照');
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const saved = [];
  await recommendation.start(items, { ...base, evaluate: async (item) => {
    await gate; return { code: item.code, classification: 'passed', riskReward: { value: 3 }, evidence: {} };
  }, saveResult: async (row) => { saved.push(row); } });
  await recommendation.start([{ code: '600003' }], base);
  recommendation.stop(); release();
  assert.equal((await settle()).status, 'cancelled');
  assert.ok(saved.every((row) => !row.selected));
  assert.equal(saved.length, 1, '取消后不执行余下项和排队项');
  await recommendation.start([], base);
  assert.equal((await settle()).status, 'completed', '取消后能重新启动');
  console.log('recommendation-batch.test 通过');
})().catch((error) => { console.error(error); process.exitCode = 1; });
