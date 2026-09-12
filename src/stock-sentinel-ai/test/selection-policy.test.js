const assert = require('node:assert/strict');
const policy = require('../selection-policy');

assert.equal(policy.priceLimitRate('600001'), 0.1);
assert.equal(policy.priceLimitRate('300001'), 0.2);
assert.equal(policy.priceLimitRate('688001'), 0.2);
assert.equal(policy.priceLimitRate('920001'), 0.3);
assert.equal(policy.limitUpPrice(10.01, '600001'), 11.01);

const hot = policy.assessInitialCandidate({ code: '600001', price: 11, prevClose: 10, changePct: 10, amountYi: 2, turnover: 2 });
assert.equal(hot.bucket, 'strong_watch');
assert.equal(hot.isLimitUp, true);
const growthPotential = policy.assessInitialCandidate({ code: '300001', price: 10.8, prevClose: 10, changePct: 8, amountYi: 2, turnover: 2 });
assert.equal(growthPotential.bucket, 'potential', '创业板8%未达到14%初始防追高线');
assert.equal(policy.assessInitialCandidate({ code: '600002', price: 10, prevClose: 10, changePct: 1, amountYi: 0.1, turnover: 2 }).bucket, 'data_insufficient');
const exceptional = policy.assessInitialCandidate({ code: '600003', price: 12, prevClose: 10, changePct: 20, amountYi: 2, turnover: 2 });
assert.equal(exceptional.limitRule, 'exceptional');
assert.equal(exceptional.bucket, 'strong_watch', '疑似无涨跌停限制日只能进入强势观察');

const theme = { code: 'BK1', name: '题材一' };
const entries = Array.from({ length: 5 }, (_, index) => ({
  profile: { code: `60000${index}`, price: 10, prevClose: 10, changePct: 2, amountYi: 2, turnover: 2 },
  matchingThemes: [theme],
}));
const selected = policy.buildInitialSelection(entries, { limit: 20 });
assert.equal(selected.selected.length, 3, '每题材最多3只');
assert.equal(selected.overQuota.length, 2);

const globalEntries = Array.from({ length: 25 }, (_, index) => ({
  profile: { code: String(600100 + index), price: 10, prevClose: 10, changePct: 2, amountYi: 2, turnover: 2 },
  matchingThemes: [{ code: `BK${index}`, name: `题材${index}` }],
}));
assert.equal(policy.buildInitialSelection(globalEntries, { limit: 100 }).selected.length, 20, '全局候选不能超过20只');
assert.equal(policy.buildInitialSelection([], { limit: 20 }).selected.length, 0, '零结果不能放宽门槛凑数');
console.log('selection-policy.test 通过');
for (const changePct of [null, undefined, '', '  ']) {
  assert.equal(policy.assessInitialCandidate({ ...entries[0].profile, changePct }).bucket, 'data_insufficient');
}
assert.equal(policy.buildInitialSelection(entries, { limit: 0 }).selected.length, 0);
assert.equal(policy.buildInitialSelection([entries[0], entries[0]]).selected.length, 1);
