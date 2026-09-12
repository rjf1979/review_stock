const assert = require('node:assert/strict');
const recommendation = require('../watch-recommendation');
const { rulesFingerprint } = require('../recommendation-validity');

function bars(count) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date('2026-06-24T00:00:00Z');
    date.setUTCDate(date.getUTCDate() + index);
    const close = 10 + index * 0.03;
    return { date: date.toISOString().slice(0, 10), open: close - 0.05, high: close + 0.1, low: close - 0.1, close, volume: 1000 };
  });
}

(async () => {
  const rules = [{ id: 'platform_breakout', patternId: 'platform_breakout', enabled: true }];
  const klineMeta = {
    source: 'tencent', adjustmentType: 'qfq', sourceLatestDate: '2026-09-11',
    tailStatus: 'confirmed', tailConfirmedAt: '2026-09-11T07:01:00.000Z',
  };
  const baseItem = {
    price: 10.2, changePct: 2, amountYi: 2, turnover: 2, code: '600001', snapshotDate: '2026-09-11', ruleIds: ['platform_breakout'],
    quoteEvidence: { sourceAt: '2026-09-11T07:00:00Z' }, selectionBatchId: 'scan-test',
    selectionPolicyVersion: 'selection-policy-v1', themeEvidence: [{ code: 'BK001', rank: 1, asOf: '2026-09-11' }],
    selectionRulesFingerprint: rulesFingerprint(rules),
    selectionRuleEvidence: rules,
    selectionPolicyParams: { heatRatioOfLimit: 0.7 },
  };
  const adapters = (now, tailStatus) => ({
    readKline: async () => ({
      kline: bars(80), ...klineMeta, tailStatus,
      tailConfirmedAt: tailStatus === 'confirmed' ? klineMeta.tailConfirmedAt : '',
    }),
    detectSinglePatterns: () => ({ hits: [{ ruleId: 'platform_breakout', patternId: 'platform_breakout', label: '平台突破', score: 80 }] }),
    computeLevels: () => ({ entryTriggers: [{ confirmAbove: 12, status: 'confirmed' }], invalidationLevel: { value: 11 }, resistanceZones: [{ low: 15 }] }),
    loadRules: () => rules,
    todayStr: () => '2026-09-11', isAfterCnMarketClose: () => true,
    now: () => now,
  });

  const result = await recommendation.evaluate(baseItem, adapters(new Date('2026-09-11T07:05:00Z'), 'confirmed'));

  assert.equal(result.classification, 'passed');
  assert.equal(result.primaryThemeCode, 'BK001');
  assert.deepEqual(result.evidence.originalRuleIds, ['platform_breakout']);
  assert.deepEqual(result.evidence.matchedOriginalRuleIds, ['platform_breakout']);
  assert.equal(result.evidence.selectionBatchId, 'scan-test');
  assert.match(result.evidence.rulesFingerprint, /^[0-9a-f]{24}$/);
  assert.equal(result.ruleVersion, 'candidate-review-v4');
  assert.equal(result.status, 'success');

  const weekend = await recommendation.evaluate(baseItem, {
    ...adapters(new Date('2026-09-12T08:00:00Z'), 'confirmed'),
    todayStr: () => '2026-09-12', isAfterCnMarketClose: () => false,
  });
  assert.equal(weekend.classification, 'passed', '周末可对最近已完成交易日的确认尾K形成最终分类');

  // D14-05：取数→存储→推荐证据的元数据必须贯穿，推荐结果可追溯来源与尾K状态。
  assert.equal(result.evidence.tailStatus, 'confirmed', '收盘确认尾K写入推荐证据');
  assert.ok(result.evidence.tailConfirmedAt, '确认时间写入推荐证据');
  assert.equal(result.evidence.klineDate, '2026-09-11');
  assert.equal(result.evidence.klineSource, 'tencent', '来源写入推荐证据');
  assert.equal(result.evidence.klineAdjustmentType, 'qfq', '复权口径写入推荐证据');
  assert.equal(result.evidence.klineSourceLatestDate, '2026-09-11');
  assert.equal(result.klineArchiveRecord.contentHash, result.evidence.klineHash, '归档正文必须来自本次复核实际读取的K线');
  assert.equal(result.klineArchiveRecord.latestDate, result.evidence.klineDate);
  let archivedPayload = null;
  const archived = await recommendation.archiveUsedKlineVersions([result], 'rec-test', {
    archiveKlineVersion: async (payload) => { archivedPayload = payload; return { ok: true, skipped: false }; },
  });
  assert.equal(archived.ok, true);
  assert.equal(archivedPayload.selectionBatchId, 'scan-test');
  assert.equal(archivedPayload.tradeDate, '2026-09-11');
  assert.equal(archivedPayload.records[0].contentHash, result.evidence.klineHash);
  const mismatch = await recommendation.archiveUsedKlineVersions([{ ...result, evidence: { ...result.evidence, klineHash: 'changed' } }], 'rec-test');
  assert.equal(mismatch.ok, false, '决策哈希与冻结正文不一致时必须拒绝归档');
  assert.equal(mismatch.missing[0].reason, 'review_kline_snapshot_mismatch');

  // 盘中暂定尾K：不能产出“收盘确认通过”，且推荐证据保留暂定语义。
  // 收盘后仍为盘中暂定（未用收盘数据重新抓取）：同样不能产出“收盘确认通过”。
  const provisional = await recommendation.evaluate(baseItem, adapters(new Date('2026-09-11T07:05:00Z'), 'provisional'));
  assert.equal(provisional.classification, 'insufficient', '暂定尾K按数据证据不足处理，不得进入通过态');
  assert.equal(provisional.evidence.tailStatus, 'provisional');
  assert.equal(provisional.evidence.tailConfirmedAt, '');
  assert.ok(provisional.reasonCodes.some((x) => x.includes('尚未收盘确认')), '暂定尾K必须给出未收盘理由');

  const unknownAdjustment = await recommendation.evaluate(baseItem, {
    ...adapters(new Date('2026-09-11T07:05:00Z'), 'confirmed'),
    readKline: async () => ({ kline: bars(80), ...klineMeta, adjustmentType: 'unknown' }),
  });
  assert.equal(unknownAdjustment.classification, 'insufficient', '复权口径无法验证时不得生成严格通过结论');
  assert.ok(unknownAdjustment.reasonCodes.some((x) => x.includes('前复权口径未验证')));
  console.log('watch-recommendation.test 通过');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
