#!/usr/bin/env node
// T10 精简成熟度检查：只读，不运行参数敏感性，不输出收益结论。
const { loadReplayInputs } = require('../replay-inputs');
const { precheckReplayInputs } = require('../replay-precheck');
const { assessT10Readiness } = require('../t10-readiness');

async function main() {
  const loaded = await loadReplayInputs();
  const precheck = await precheckReplayInputs(loaded.samples, {
    reviewBatchReader: async (batchId) => loaded.reviewBatchIds.has(String(batchId || '')),
  });
  const readiness = assessT10Readiness(loaded.samples, precheck, { inputSource: loaded.source });
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'read_only_t10_readiness',
    inputCounts: loaded.counts,
    inputIssueCounts: Object.entries(loaded.issues.reduce((counts, issue) => {
      const code = String(issue && issue.code || 'unknown');
      counts[code] = (counts[code] || 0) + 1;
      return counts;
    }, {})).map(([code, count]) => ({ code, count })),
    precheck: {
      sampleCount: precheck.sampleCount,
      readyCount: precheck.readyCount,
      blockedCount: precheck.blockedCount,
      blockingReasons: precheck.blockingReasons,
    },
    readiness,
  };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (readiness.status !== 'ready_for_preliminary_replay') process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
