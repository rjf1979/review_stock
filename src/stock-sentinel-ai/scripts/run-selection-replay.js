// 只读历史回放（第十五阶段：接入回放输入预检）。
// 先做输入预检：批次ID、交易日、规则指纹、行情源时间、题材成分、K线版本/复权/最终状态与未来数据。
// 预检未通过时只输出诊断报告，不进入参数比较；通过时才在通过样本上运行敏感性比较。
const { REPLAY_VERSION, DEFAULT_SENSITIVITY_GRID, replayCandidate, runSensitivity, summarizeReplays } = require('../selection-replay');
const { precheckReplayInputs } = require('../replay-precheck');
const { loadReplayInputs } = require('../replay-inputs');
const { assessT10Readiness } = require('../t10-readiness');

async function main() {
  const loaded = await loadReplayInputs();
  const samples = loaded.samples;
  // 预检：证据不足的样本一律不得进入参数比较，逐项原因保留在报告中。
  const precheck = await precheckReplayInputs(samples, { reviewBatchReader: async (batchId) => loaded.reviewBatchIds.has(String(batchId || '')) });
  const readyIndexSet = new Set(precheck.readyIndexes);
  const readySamples = samples.filter((sample, index) => readyIndexSet.has(index));
  const replayable = (sample) => ({ ...sample, candles: sample.candles.concat(sample.futureCandles || []) });
  const replays = readySamples.map((sample) => replayCandidate(replayable(sample)));
  const diagnostics = samples.map((sample) => replayCandidate(replayable(sample)));
  const dateCounts = {};
  const issueCounts = {};
  for (const replay of diagnostics) {
    dateCounts[replay.asOf || 'unknown'] = (dateCounts[replay.asOf || 'unknown'] || 0) + 1;
    for (const issue of [...replay.historicalEvidence.missing, ...replay.historicalEvidence.futureDated]) {
      issueCounts[issue] = (issueCounts[issue] || 0) + 1;
    }
  }
  const parameterComparisonPerformed = precheck.parameterComparisonAllowed && readySamples.length > 0;
  const report = {
    replayVersion: REPLAY_VERSION,
    generatedAt: new Date().toISOString(),
    mode: 'read_only_local_history',
    inputSource: loaded.source,
    releaseGate: precheck.blockedCount === 0 ? 'blocked_pending_full_archive_and_independent_acceptance' : 'blocked_pending_replay_precheck',
    releaseReasons: [
      '当前候选池不是历史选股全集',
      '未归档当时K线版本/复权证据与完整题材成分范围',
      '参数验证及最终独立终审尚未完成',
      ...(precheck.blockedCount ? [`回放预检未通过样本 ${precheck.blockedCount}/${precheck.sampleCount} 项`] : []),
    ],
    inputHashes: loaded.inputHashes,
    inputCounts: loaded.counts,
    inputIssues: loaded.issues,
    readiness: assessT10Readiness(samples, precheck, { inputSource: loaded.source }),
    caveat: '未来K线仅计算后续最大有利/不利波动，不参与当时分类、排名或参数选择；本报告不输出胜率。',
    precheck: {
      precheckVersion: precheck.precheckVersion,
      sampleCount: precheck.sampleCount,
      readyCount: precheck.readyCount,
      blockedCount: precheck.blockedCount,
      archiveIndex: precheck.archiveIndex,
      blockingReasons: precheck.blockingReasons,
      byCategory: precheck.byCategory,
      items: precheck.items,
    },
    parameterComparison: {
      performed: parameterComparisonPerformed,
      basis: 'only_precheck_ready_samples',
      readySamples: precheck.readySamples,
      reason: parameterComparisonPerformed
        ? `仅在通过预检的 ${readySamples.length} 个样本上运行参数比较`
        : '没有任何样本通过回放输入预检，按口径不进入参数比较（不输出参数结论）',
    },
    dates: dateCounts,
    summary: summarizeReplays(replays),
    diagnosticSummary: summarizeReplays(diagnostics),
    evidenceIssues: Object.entries(issueCounts).sort((left, right) => right[1] - left[1]).map(([reason, count]) => ({ reason, count })),
    observations: diagnostics.map((row) => ({ code: row.code, asOf: row.asOf, evidenceHash: row.evidenceHash, ...row.observation })),
    sensitivity: parameterComparisonPerformed
      ? runSensitivity(readySamples, DEFAULT_SENSITIVITY_GRID).map(({ id, label, initialParams, reviewParams, summary }) => ({ id, label, initialParams, reviewParams, summary }))
      : [],
  };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (!parameterComparisonPerformed) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
