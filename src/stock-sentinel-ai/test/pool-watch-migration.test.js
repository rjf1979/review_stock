const assert = require('node:assert/strict');
const { migratePoolToWatch, concentrationWarnings } = require('../pool-watch-migration');
const { rulesFingerprint } = require('../recommendation-validity');

const rules = [{ id: 'platform_breakout', patternId: 'platform_breakout', enabled: true }];
const candidates = Array.from({ length: 7 }, (_, index) => ({
  code: `60000${index + 1}`, name: `测试${index + 1}`, snapshotDate: '2026-09-11', selectionBatchId: 'selection-1',
  selectionPolicyVersion: 'selection-policy-v1', selectionContractVersion: 3, ruleIds: ['platform_breakout'],
  selectionRulesFingerprint: rulesFingerprint(rules),
  selectionRuleEvidence: rules, selectionParameterStatus: 'provisional', selectionPolicyParams: { heatRatioOfLimit: 0.7 },
  themeEvidence: [{ code: `BK${Math.floor(index / 2)}`, name: `题材${Math.floor(index / 2)}`, kind: 'concept', rank: 1 }],
  candidateThemeRanks: [{ code: `BK${Math.floor(index / 2)}`, name: `题材${Math.floor(index / 2)}`, rank: 1 }],
}));
let pool = candidates.slice();
const watched = [];
const poolStore = {
  getList: () => pool,
  remove: (code) => { pool = pool.filter((item) => item.code !== code); return { ok: true }; },
};
const watchStore = {
  getList: () => watched,
  upsertFromPool: (candidate, evidence) => {
    const existing = watched.find((item) => item.code === candidate.code);
    if (!existing) watched.push({ ...candidate, selectionEvidence: evidence });
    return { ok: true, unchanged: Boolean(existing) };
  },
};
const recommendations = Object.fromEntries(candidates.map((candidate, index) => [candidate.code, {
  batchId: 'review-1', code: candidate.code, status: 'success', classification: index === 6 ? 'pending_confirmation' : 'passed',
  ruleVersion: 'candidate-review-v2', evidenceHash: `hash-${index}`, reasonCodesJson: ['通过'], conditionsJson: {}, missingJson: [],
  evidenceJson: { selected: index < 6, rulesFingerprint: rulesFingerprint(rules), selectionRulesFingerprint: candidate.selectionRulesFingerprint, selectionBatchId: candidate.selectionBatchId, snapshotDate: candidate.snapshotDate, klineHash: 'same', klineDate: '2026-09-11', riskReward: { value: 3 - index * 0.1 } },
}]));
const adapters = {
  candidatePool: poolStore, watchlist: watchStore, loadRules: () => rules,
  latestWatchRecommendations: async (codes) => Object.fromEntries(codes.map((code) => [code, recommendations[code]]).filter(([, value]) => value)),
  readKlineStats: async (codes) => codes.map((code) => ({ code, klineHash: 'same', latestDate: '2026-09-11' })), ruleVersion: 'candidate-review-v2',
};
assert.ok(concentrationWarnings(Array.from({ length: 3 }, (_, index) => ({ code: String(index), themeEvidence: [{ code: 'BKX', name: '重叠概念', kind: 'concept' }] }))).some((text) => text.includes('重叠概念已有3只')), '所有重叠概念都应参与集中风险统计');

(async () => {
  for (const codes of [[], ['bad-code']]) {
    const result = await migratePoolToWatch({ codes }, adapters);
    assert.equal(result.moved.length, 0, '显式空选择不能扩大为整池迁移');
    assert.equal(pool.length, 7);
  }
  assert.equal((await migratePoolToWatch({ codes: '600001' }, adapters)).ok, false);
  const batch = await migratePoolToWatch({ mode: 'selected', baselineTargetDate: '2026-09-11' }, adapters);
  assert.equal(batch.moved.length, 5, '默认批量最多转入5只精选');
  assert.equal(pool.length, 2, '未入配额及待确认股票必须保留在候选池');
  assert.ok(batch.skipped.some((item) => item.reason.includes('上限5只')));
  assert.ok(batch.skipped.some((item) => item.reason.includes('仅本批精选')));

  const observation = await migratePoolToWatch({ codes: ['600007'], mode: 'observation', baselineTargetDate: '2026-09-11' }, adapters);
  assert.equal(observation.moved.length, 1, '待确认股票可从明确观察入口转入');
  assert.equal(watched.find((item) => item.code === '600007').selectionEvidence.mode, 'observation');

  let retained = [{ ...candidates[5] }];
  const failed = await migratePoolToWatch({ codes: ['600006'], mode: 'selected' }, {
    ...adapters,
    candidatePool: { getList: () => retained, remove: () => ({ ok: false, error: '模拟删除失败' }) },
    watchlist: { getList: () => [], upsertFromPool: () => ({ ok: true, unchanged: false }) },
  });
  assert.equal(failed.failed[0].stage, 'pool_remove');
  assert.equal(retained.length, 1, '目标写入后原池删除失败时必须保留原记录');

  let deleteAttempts = 0;
  const retryPool = [{ ...candidates[5] }];
  const retryWatch = [];
  const retryAdapters = {
    ...adapters,
    candidatePool: {
      getList: () => retryPool,
      remove: (code) => {
        deleteAttempts++;
        if (deleteAttempts === 1) return { ok: false, error: '模拟首次删除失败' };
        retryPool.splice(retryPool.findIndex((item) => item.code === code), 1);
        return { ok: true };
      },
    },
    watchlist: {
      getList: () => retryWatch,
      upsertFromPool: (candidate, evidence) => {
        const existing = retryWatch.find((item) => item.code === candidate.code);
        if (!existing) retryWatch.push({ ...candidate, selectionEvidence: evidence });
        return { ok: true, unchanged: Boolean(existing) };
      },
    },
  };
  const firstAttempt = await migratePoolToWatch({ codes: ['600006'], mode: 'selected' }, retryAdapters);
  assert.equal(firstAttempt.failed[0].stage, 'pool_remove');
  const retryAttempt = await migratePoolToWatch({ codes: ['600006'], mode: 'selected' }, retryAdapters);
  assert.equal(retryAttempt.moved[0].unchanged, true, '重试应复用已写入的自选记录');
  assert.equal(retryWatch.length, 1, '部分失败重试不能重复添加自选');
  assert.equal(retryPool.length, 0, '重试成功后才移出候选池');
  for (const mutation of ['delete', 'replace']) {
    let changingPool = [{ ...candidates[0] }];
    let writes = 0;
    const result = await migratePoolToWatch({ codes: ['600001'] }, {
      ...adapters,
      candidatePool: { getList: () => changingPool, remove: () => { throw new Error('不应删除'); } },
      latestWatchRecommendations: async () => {
        changingPool = mutation === 'delete' ? [] : [{ ...candidates[0], selectionBatchId: 'new-batch' }];
        return recommendations;
      },
      watchlist: { getList: () => [], upsertFromPool: () => { writes++; return { ok: true }; } },
    });
    assert.equal(writes, 0, '异步读取期间名单变化不能复活旧候选');
    assert.equal(result.skipped.length, 1);
  }
  console.log('pool-watch-migration.test 通过');
  let reads = 0;
  const changedKline = await migratePoolToWatch({ codes: ['600001'] }, {
    ...adapters,
    candidatePool: { getList: () => [candidates[0]], remove: () => { throw new Error('不得删除'); } },
    readKlineStats: async () => [{ code: '600001', latestDate: '2026-09-11', klineHash: ++reads === 1 ? 'same' : 'changed' }],
    watchlist: { getList: () => [], upsertFromPool: () => { throw new Error('不得写入'); } },
  });
  assert.equal(changedKline.moved.length, 0);
  assert.equal(changedKline.skipped.length, 1, '迁移等待期间同日K线变化必须拦截');
})().catch((error) => { console.error(error); process.exitCode = 1; });
