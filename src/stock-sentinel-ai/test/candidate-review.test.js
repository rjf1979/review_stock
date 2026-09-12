const assert = require('node:assert/strict');
const review = require('../candidate-review');
const { rulesFingerprint } = require('../recommendation-validity');

function bars(count, step = 0.03) {
  return Array.from({ length: count }, (_, index) => {
    const close = 10 + index * step;
    const date = new Date('2026-06-24T00:00:00Z');
    date.setUTCDate(date.getUTCDate() + index);
    return { date: date.toISOString().slice(0, 10), open: close - 0.05, high: close + 0.1, low: close - 0.1, close, volume: 1000 };
  });
}
const rules = [{ id: 'platform_breakout', patternId: 'platform_breakout' }];
const item = { price: 10.2, changePct: 2, amountYi: 2, turnover: 2, themeEvidence: [{ code: 'BK1', asOf: '2026-09-11' }], code: '600001', snapshotDate: '2026-09-11', ruleIds: ['platform_breakout'], selectionRulesFingerprint: rulesFingerprint(rules), quoteEvidence: { sourceAt: '2026-09-11T07:00:00Z' } };
const patterns = [{ ruleId: 'platform_breakout', patternId: 'platform_breakout', score: 80 }];
const levels = { entryTriggers: [{ confirmAbove: 12, status: 'confirmed' }], invalidationLevel: { value: 11 }, resistanceZones: [{ low: 15 }] };
assert.equal(review.reviewCandidate({ item, candles: bars(80), rules, patterns, levels, isFinal: true }).classification, 'passed');
assert.equal(review.reviewCandidate({ item, candles: bars(80), rules, patterns: [{ patternId: 'other' }], levels, isFinal: true }).classification, 'not_passed', '其他形态不能替代原策略');
assert.equal(review.reviewCandidate({ item, candles: bars(20), rules, patterns, levels, isFinal: true }).classification, 'insufficient');
assert.equal(review.reviewCandidate({ item, candles: bars(80), rules, patterns, levels, isFinal: false }).classification, 'pending_confirmation');
assert.equal(review.reviewCandidate({ item, candles: bars(80), rules: [{ ...rules[0], enabled: false }], patterns, levels, isFinal: true }).classification, 'insufficient', '入池策略停用后不能继续通过');
assert.equal(review.reviewCandidate({ item, candles: bars(80), rules: [{ ...rules[0], params: { window: 30 } }], patterns, levels, isFinal: true }).classification, 'insufficient', '入池策略参数变化后不能继续通过');
assert.equal(review.reviewCandidate({ item: { ...item, riskFlags: [{ key: 'flow_divergence' }] }, candles: bars(80), rules, patterns, levels, isFinal: true }).classification, 'not_passed', '资金流背离必须形成反对证据');
assert.equal(review.reviewCandidate({ item: { ...item, quoteEvidence: { sourceAt: 'not-a-date' } }, candles: bars(80), rules, patterns, levels, isFinal: true }).classification, 'insufficient', '无效行情源时间不能抛错或通过');
assert.equal(review.riskRewardWithCosts({ entryTriggers: [{ confirmAbove: 10 }], invalidationLevel: { value: 10.1 }, resistanceZones: [{ low: 12 }] }).available, false, '价位顺序错误不能凑风险收益比');

const passed = Array.from({ length: 12 }, (_, index) => ({ code: String(index), classification: 'passed', riskReward: { value: 3 }, patternScore: 80, score: 80, primaryThemeCode: `BK${Math.floor(index / 3)}` }));
const final = review.finalizeSelections(passed);
assert.ok(final.filter((item) => item.selected).length <= 10);
assert.ok(final.some((item) => item.classification === 'passed' && !item.selected && item.selectionReason === '通过但未入精选配额'));
console.log('candidate-review.test 通过');
assert.equal(review.reviewCandidate({ item, candles: bars(80), rules, patterns: [{ ruleId: 'other_rule', patternId: 'platform_breakout' }], levels, isFinal: true }).classification, 'not_passed', '同形态的另一规则不能替代原规则');
const invalid = bars(80); invalid[30].close = null;
assert.equal(review.reviewCandidate({ item, candles: invalid, rules, patterns, levels, isFinal: true }).classification, 'insufficient');
assert.equal(review.reviewCandidate({ item, candles: Array(80).fill(bars(80).at(-1)), rules, patterns, levels, isFinal: true }).classification, 'insufficient');
assert.equal(review.reviewCandidate({ item: { ...item, changePct: 8 }, candles: bars(80), rules, patterns, levels, isFinal: true }).classification, 'not_passed');
assert.equal(review.reviewCandidate({ item: { ...item, changePct: null }, candles: bars(80), rules, patterns, levels, isFinal: true }).classification, 'insufficient');
assert.equal(review.reviewCandidate({ item: { ...item, themeEvidence: [] }, candles: bars(80), rules, patterns, levels, isFinal: true }).classification, 'insufficient');
