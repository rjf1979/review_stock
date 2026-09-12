// D15-04 隔离回归：回放输入预检必须拦住证据不足与未来数据，并与既有回放口径保持一致。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-replay-precheck-'));
process.env.VOLUME_INSIGHT_DATA_DIR = temp;
process.env.VOLUME_INSIGHT_KLINE_DB = path.join(temp, 'test.db');

const { precheckSample, precheckReplayInputs, assessQuoteSourceTime } = require('../replay-precheck');
const { rulesFingerprint, klineFingerprint } = require('../recommendation-validity');
const { historicalEvidenceIssues } = require('../selection-replay');
const selectionPolicy = require('../selection-policy');

const AS_OF = '2026-09-11';
const rules = [{ id: 'platform_breakout', patternId: 'platform_breakout', enabled: true }];

function bars(count, endISO = AS_OF) {
  const end = new Date(`${endISO}T00:00:00Z`);
  const out = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const date = new Date(end);
    date.setUTCDate(date.getUTCDate() - i);
    const close = 10 + (count - i) * 0.01;
    out.push({ date: date.toISOString().slice(0, 10), open: close - 0.05, high: close + 0.1, low: close - 0.1, close, volume: 1000 });
  }
  return out;
}

function item(overrides = {}) {
  return {
    code: '600001', snapshotDate: AS_OF, selectionBatchId: 'sel-1', prescanBatchId: 'pre-1', selectionContractVersion: 3,
    selectionPolicyVersion: 'selection-policy-v1', selectionParameterStatus: 'provisional',
    selectionPolicyParams: { ...selectionPolicy.DEFAULT_PARAMS },
    selectionRulesFingerprint: rulesFingerprint(rules), selectionRuleEvidence: rules,
    quoteEvidence: { sourceAt: `${AS_OF}T07:00:00Z` },
    themeEvidence: [{ code: 'BK1', name: '题材一', rank: 1, asOf: AS_OF }],
    ...overrides,
  };
}

const meta = {
  source: 'tencent', adjustmentType: 'qfq', sourceLatestDate: AS_OF,
  fetchedAt: `${AS_OF}T07:01:00.000Z`, tailStatus: 'confirmed', tailConfirmedAt: `${AS_OF}T07:01:00.000Z`,
};

function sample(overrides = {}) {
  const base = { item: item(), candles: bars(120), klineMeta: { ...meta }, ...overrides };
  const evidence = base.candles.filter((bar) => bar.date <= AS_OF);
  const hash = klineFingerprint(evidence);
  if (!base.archivedVersionFor) base.archivedVersionFor = () => ({ archiveId: 'sel-1__rec-1', contentHash: hash, status: 'complete' });
  if (!base.prescanEvidenceFor) base.prescanEvidenceFor = () => ({
    batchId: 'pre-1', status: 'complete', tradeDate: AS_OF, themeMembership: { BK1: [String(base.item.code || '')] },
  });
  return base;
}

function codes(result) { return result.blockers.map((blocker) => blocker.code); }

// 证据齐备：预检通过
const ok = precheckSample(sample(), { asOf: AS_OF });
assert.equal(ok.ready, true, JSON.stringify(ok.blockers));
assert.equal(ok.blockers.length, 0);
assert.equal(ok.checks.evidenceBars, 120);
assert.equal(ok.checks.archivedKlineHash, klineFingerprint(bars(120)));
// 与既有回放口径一致：预检通过者必须同时通过历史证据校验
assert.equal(historicalEvidenceIssues(item(), AS_OF).complete, true, '预检通过样本不得与既有回放口径冲突');

// 批次 / 交易日 / 契约
assert.ok(codes(precheckSample(sample({ item: item({ selectionBatchId: '' }) }), { asOf: AS_OF })).includes('batch_id_missing'));
assert.ok(codes(precheckSample(sample({ item: item({ prescanBatchId: '' }) }), { asOf: AS_OF })).includes('prescan_batch_id_missing'));
assert.ok(codes(precheckSample(sample({ item: item({ snapshotDate: '2026-09-10' }) }), { asOf: AS_OF })).includes('snapshot_date_mismatch'));
assert.ok(codes(precheckSample(sample({ item: item({ selectionContractVersion: 2 }) }), { asOf: AS_OF })).includes('contract_version_unsupported'));

// 规则指纹
assert.ok(codes(precheckSample(sample({ item: item({ selectionRulesFingerprint: 'stale' }) }), { asOf: AS_OF })).includes('rules_fingerprint_mismatch'));
assert.ok(codes(precheckSample(sample({ item: item({ selectionRuleEvidence: [] }) }), { asOf: AS_OF })).includes('rules_snapshot_missing'));

// 行情源时间
assert.equal(assessQuoteSourceTime(`${AS_OF}T07:00:00Z`, AS_OF).ok, true);
assert.equal(assessQuoteSourceTime('2026-09-12T07:00:00Z', AS_OF).code, 'quote_source_future');
assert.equal(assessQuoteSourceTime('', AS_OF).code, 'quote_source_time_missing');
assert.ok(codes(precheckSample(sample({ item: item({ quoteEvidence: { sourceAt: '2026-09-12T01:00:00Z' } }) }), { asOf: AS_OF })).includes('quote_source_future'));
assert.ok(codes(precheckSample(sample({ item: item({ quoteEvidence: {} }) }), { asOf: AS_OF })).includes('quote_source_time_missing'));

// 题材成分与未来题材证据
assert.ok(codes(precheckSample(sample({ item: item({ themeEvidence: [] }) }), { asOf: AS_OF })).includes('theme_evidence_missing'));
assert.ok(codes(precheckSample(sample({ item: item({ themeEvidence: [{ code: 'BK1', asOf: '2026-09-12' }] }) }), { asOf: AS_OF })).includes('theme_future'));
assert.ok(codes(precheckSample(sample({ prescanEvidenceFor: () => null }), { asOf: AS_OF })).includes('prescan_archive_missing'));
assert.ok(codes(precheckSample(sample({ prescanEvidenceFor: () => ({ status: 'complete', tradeDate: AS_OF, themeMembership: { BK1: [] } }) }), { asOf: AS_OF })).includes('theme_membership_unverified'));

// K线版本 / 复权 / 尾K状态
assert.ok(codes(precheckSample(sample({ klineMeta: {} }), { asOf: AS_OF })).includes('kline_final_evidence_missing'));
assert.ok(codes(precheckSample(sample({ klineMeta: { ...meta, adjustmentType: 'unknown' } }), { asOf: AS_OF })).includes('kline_adjustment_unverified'));
assert.ok(codes(precheckSample(sample({ klineMeta: { ...meta, tailStatus: 'provisional', tailConfirmedAt: '' } }), { asOf: AS_OF })).includes('kline_tail_not_confirmed'));
assert.ok(codes(precheckSample(sample({ klineMeta: { ...meta, tailConfirmedAt: '' } }), { asOf: AS_OF })).includes('kline_tail_confirmed_at_missing'));
assert.ok(codes(precheckSample(sample({ klineMeta: { ...meta, source: '' } }), { asOf: AS_OF })).includes('kline_source_missing'));

// 未来数据：K线晚于回放日必须拦截
assert.ok(codes(precheckSample(sample({ candles: bars(120, '2026-09-12') }), { asOf: AS_OF })).includes('kline_latest_after_as_of'));
// 无K线
assert.ok(codes(precheckSample(sample({ candles: [] }), { asOf: AS_OF })).includes('kline_missing'));

// K线版本归档核对
assert.ok(codes(precheckSample(sample({ archivedVersionFor: () => null }), { asOf: AS_OF })).includes('kline_archive_missing'));
assert.ok(codes(precheckSample(sample({ archivedVersionFor: () => ({ contentHash: 'deadbeef', status: 'complete' }) }), { asOf: AS_OF })).includes('kline_hash_mismatch'));
const notComplete = precheckSample(sample({ archivedVersionFor: () => ({ contentHash: klineFingerprint(bars(120)), status: 'incomplete' }) }), { asOf: AS_OF });
assert.equal(notComplete.ready, false, '归档不完整不得进入参数比较');
assert.ok(notComplete.blockers.some((blocker) => blocker.code === 'kline_archive_not_complete'));

// 批次聚合：证据不足时必须阻止参数比较
(async () => {
const blocked = await precheckReplayInputs([
  sample(),
  sample({ item: item({ code: '600002', selectionBatchId: '' }) }),
  sample({ item: item({ code: '600003' }), klineMeta: {} }),
], { asOf: AS_OF });
assert.equal(blocked.sampleCount, 3);
assert.equal(blocked.readyCount, 1);
assert.equal(blocked.blockedCount, 2);
assert.equal(blocked.ok, false);
assert.equal(blocked.parameterComparisonAllowed, true, '只要有样本通过就允许在通过样本上比较');
assert.deepEqual(blocked.readyIndexes, [0], '通过样本必须按输入位置标识，不能只按股票代码筛选');
assert.ok(blocked.blockingReasons.includes('batch_id_missing'));
assert.ok(blocked.blockingReasons.includes('kline_final_evidence_missing'));
assert.ok(blocked.items.every((entry) => Array.isArray(entry.blockers) && Array.isArray(entry.warnings)));

const none = await precheckReplayInputs([sample({ item: item({ selectionBatchId: '' }) })], { asOf: AS_OF });
assert.equal(none.parameterComparisonAllowed, false, '全部样本被拦时必须禁止参数比较');
assert.equal(none.readyCount, 0);
assert.equal((await precheckReplayInputs([], {})).ok, false, '无样本不得视为通过');

const sameCodeDifferentBatch = await precheckReplayInputs([
  sample({ replayArchive: { archiveId: 'archive-ready' } }),
  sample({ item: item({ selectionBatchId: '' }), replayArchive: { archiveId: 'archive-blocked' } }),
], {
  asOf: AS_OF,
  archiveIndex: {
    size: 2,
    index: new Map([['sel-1|600001', [
      { archiveId: 'archive-other', contentHash: 'wrong', status: 'complete' },
      { archiveId: 'archive-ready', contentHash: klineFingerprint(bars(120)), status: 'complete' },
    ]]]),
  },
});
assert.deepEqual(sameCodeDifferentBatch.readySamples, ['600001']);
assert.deepEqual(sameCodeDifferentBatch.readyIndexes, [0], '同代码跨批次时不得把未通过批次带入回放');
assert.equal(sameCodeDifferentBatch.items[0].checks.archivedArchiveId, 'archive-ready', '预检必须精确核对装载时选中的归档版本');

console.log('replay-precheck.test 通过');
})().catch((error) => { console.error(error); process.exitCode = 1; });
