const assert = require('node:assert/strict');
const { rulesFingerprint, assessRecommendation } = require('../recommendation-validity');

const rules = [{ id: 'platform_breakout', patternId: 'platform_breakout', enabled: true, params: { days: 20 } }];
const candidate = { selectionBatchId: 'selection-1', snapshotDate: '2026-09-11', selectionRulesFingerprint: rulesFingerprint(rules) };
const record = {
  status: 'success', ruleVersion: 'candidate-review-v1',
  evidenceJson: { rulesFingerprint: rulesFingerprint(rules), selectionRulesFingerprint: candidate.selectionRulesFingerprint, selectionBatchId: 'selection-1', snapshotDate: '2026-09-11', klineHash: 'same', klineDate: '2026-09-11' },
};
assert.equal(assessRecommendation(record, { candidate, currentRules: rules, klineHash: 'same', klineDate: '2026-09-11', expectedRuleVersion: 'candidate-review-v1' }).current, true);
assert.equal(assessRecommendation(record, { candidate, currentRules: [{ ...rules[0], enabled: false }], klineHash: 'same', klineDate: '2026-09-11', expectedRuleVersion: 'candidate-review-v1' }).current, false, '规则启停变化必须使旧结论失效');
assert.equal(assessRecommendation(record, { candidate, currentRules: rules, klineDate: '2026-09-12', expectedRuleVersion: 'candidate-review-v1' }).current, false, 'K线日期变化必须使旧结论失效');
assert.equal(assessRecommendation(record, { candidate: { ...candidate, selectionBatchId: 'selection-2' }, currentRules: rules, klineHash: 'same', klineDate: '2026-09-11', expectedRuleVersion: 'candidate-review-v1' }).current, false, '候选批次变化必须使旧结论失效');
assert.equal(assessRecommendation(record, { candidate: { ...candidate, selectionRulesFingerprint: 'changed' }, currentRules: rules, klineHash: 'same', klineDate: '2026-09-11', expectedRuleVersion: 'candidate-review-v1' }).current, false, '入池规则指纹变化必须使旧结论失效');
console.log('recommendation-validity.test 通过');
const { klineFingerprint } = require('../recommendation-validity');
const candles = [{ date: '2026-09-11', open: 10, high: 11, low: 9, close: 10, volume: 100 }];
const fingerprint = klineFingerprint(candles);
const current = { ...record, evidenceJson: { ...record.evidenceJson, klineHash: fingerprint } };
const context = { candidate, currentRules: rules, klineDate: '2026-09-11', klineHash: fingerprint };
assert.equal(assessRecommendation(current, context).current, true);
assert.equal(assessRecommendation(current, { ...context, klineHash: klineFingerprint([{ ...candles[0], volume: 101 }]) }).current, false);
assert.equal(assessRecommendation(current, { ...context, klineHash: '' }).current, false);
for (const batchStatus of ['running', 'failed', 'cancelled', null]) {
  assert.equal(assessRecommendation({ ...current, batchStatus }, context).current, false);
}
const timed = { ...current, evidenceJson: { ...current.evidenceJson, quoteSourceAt: '2026-09-11T02:00:00Z' } };
assert.equal(assessRecommendation(timed, { ...context, now: new Date('2026-09-11T02:04:00Z') }).current, true);
assert.equal(assessRecommendation(timed, { ...context, now: new Date('2026-09-11T02:06:00Z') }).current, false, '即使K线尚未更新，过期行情也应使推荐失效');
assert.equal(assessRecommendation(null).current, false);
assert.equal(assessRecommendation(record, { candidate, currentRules: rules }).current, false, 'K线删除或查询失败不能仍然有效');

const confirmedAt = '2026-09-11T07:01:00.000Z';
const v4 = {
  ...current,
  ruleVersion: 'candidate-review-v4',
  evidenceJson: {
    ...current.evidenceJson,
    quoteSourceAt: '2026-09-11T07:00:00.000Z',
    tailStatus: 'confirmed', tailConfirmedAt: confirmedAt,
    klineSource: 'tencent', klineAdjustmentType: 'qfq',
  },
};
const v4Context = {
  ...context, expectedRuleVersion: 'candidate-review-v4', now: new Date('2026-09-11T07:04:00.000Z'),
  tailStatus: 'confirmed', tailConfirmedAt: confirmedAt, klineSource: 'tencent', adjustmentType: 'qfq',
};
assert.equal(assessRecommendation(v4, v4Context).current, true, 'v4完整且一致的收盘证据应保持有效');
for (const [change, message] of [
  [{ tailStatus: 'provisional' }, '当前尾K变为暂定时失效'],
  [{ tailConfirmedAt: '2026-09-11T07:02:00.000Z' }, '尾K确认时间变化时失效'],
  [{ klineSource: 'sina' }, 'K线来源变化时失效'],
  [{ adjustmentType: 'unknown' }, '复权口径无法验证时失效'],
]) {
  assert.equal(assessRecommendation(v4, { ...v4Context, ...change }).current, false, message);
}
for (const missing of ['tailConfirmedAt', 'klineSource', 'adjustmentType']) {
  const incomplete = { ...v4Context, [missing]: '' };
  assert.equal(assessRecommendation(v4, incomplete).current, false, `v4缺少${missing}时失效`);
}
