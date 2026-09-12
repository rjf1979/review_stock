// D15-05 隔离回归：服务启动时把遗留 running 批次结算为 interrupted，且不得自动续跑/调用AI/迁移名单。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-task-recovery-'));
process.env.VOLUME_INSIGHT_DATA_DIR = temp;
process.env.VOLUME_INSIGHT_KLINE_DB = path.join(temp, 'test.db');

const storage = require('../storage');
const judgmentStore = require('../judgment-store');
const taskMarkers = require('../task-markers');
const recovery = require('../task-recovery');

(async () => {
  // AI 研判：一个运行中、一个已收尾
  judgmentStore.saveBatch({ batchId: 'ai-running', startedAt: Date.now() - 60000, finishedAt: 0, reason: 'running', total: 4, done: 1 });
  judgmentStore.saveBatch({ batchId: 'ai-done', startedAt: Date.now() - 120000, finishedAt: Date.now() - 60000, reason: 'completed', total: 3, done: 3 });

  // 复核：一个运行中、一个已完成
  await storage.saveWatchRecommendationBatch({ batchId: 'rec-running', status: 'running', total: 5, done: 2, succeeded: 2, failed: 0, startedAt: Date.now() - 60000, snapshot: [{ code: '600001' }] });
  await storage.saveWatchRecommendationBatch({ batchId: 'rec-done', status: 'completed', total: 2, done: 2, succeeded: 2, failed: 0, startedAt: Date.now() - 120000, finishedAt: Date.now() - 60000 });

  // K线队列：遗留 running 标记
  taskMarkers.startMarker('kline-queue', { total: 7, lmt: 250, scope: 'pool_kline' });

  const poolBefore = fs.existsSync(path.join(temp, 'candidate-pool.json'));
  const watchBefore = fs.existsSync(path.join(temp, 'watchlist.json'));

  const report = await recovery.settleInterruptedTasks({ log: () => {} });

  assert.equal(report.ok, true);
  assert.equal(report.autoResumed, false);
  assert.equal(report.autoInvokedAi, false);
  assert.equal(report.autoMigratedWatchlist, false);
  assert.equal(report.totals.aiJudgment, 1);
  assert.equal(report.totals.review, 1);
  assert.equal(report.totals.klineQueue, 1);
  assert.equal(report.totals.total, 3);
  assert.equal(report.retryHints.length, 3, '三类中断各自给出人工触发入口');
  assert.ok(report.retryHints.every((hint) => hint.entry));

  // AI 批次：运行中的被标为 interrupted，已收尾的保持不变
  const aiRunning = judgmentStore.getBatch('ai-running');
  assert.equal(aiRunning.reason, 'interrupted');
  assert.equal(aiRunning.interrupted, true);
  assert.ok(aiRunning.interruptedAt);
  const aiDone = judgmentStore.getBatch('ai-done');
  assert.equal(aiDone.reason, 'completed');

  // 复核批次：状态改为 interrupted，进度与快照保留
  const recRunning = await storage.readWatchRecommendationBatches({ batchId: 'rec-running', limit: 1 });
  assert.equal(recRunning[0].status, 'interrupted');
  assert.equal(Number(recRunning[0].done), 2, '中断结算不得清空进度');
  const recDone = await storage.readWatchRecommendationBatches({ batchId: 'rec-done', limit: 1 });
  assert.equal(recDone[0].status, 'completed', '已完成批次不得被改写');

  // K线队列标记：running → interrupted
  const marker = taskMarkers.readMarker('kline-queue');
  assert.equal(marker.status, 'interrupted');
  assert.equal(Number(marker.total), 7);
  assert.ok(marker.note.includes('人工'));

  // 名单与候选不得因结算被动过
  assert.equal(fs.existsSync(path.join(temp, 'candidate-pool.json')), poolBefore);
  assert.equal(fs.existsSync(path.join(temp, 'watchlist.json')), watchBefore);

  // 报告落盘且可只读读取
  assert.equal(fs.existsSync(recovery.REPORT_FILE), true);
  const last = recovery.lastRecoveryReport();
  assert.equal(last.totals.total, 3);
  assert.equal(last.settledAt, report.settledAt);

  // 幂等：再次启动结算不应重复改动任何东西
  const second = await recovery.settleInterruptedTasks({ log: () => {} });
  assert.equal(second.totals.total, 0, '已结算的批次不得被重复结算');
  assert.equal(judgmentStore.getBatch('ai-running').reason, 'interrupted');
  assert.equal((await storage.readWatchRecommendationBatches({ batchId: 'rec-running', limit: 1 }))[0].status, 'interrupted');
  assert.equal(taskMarkers.readMarker('kline-queue').status, 'interrupted');

  // 收尾后的队列标记不参与结算
  taskMarkers.finishMarker('kline-queue', { total: 7, done: 7, status: 'finished' });
  const third = await recovery.settleInterruptedTasks({ log: () => {} });
  assert.equal(third.totals.klineQueue, 0, '已收尾的队列不得被判为中断');
  assert.equal(taskMarkers.readMarker('kline-queue').status, 'finished');

  // 写库失败不得伪报恢复成功。
  const failed = await recovery.settleInterruptedTasks({
    log: () => {},
    review: {
      readBatches: async () => [{ batchId: 'rec-write-failed', status: 'running', total: 1, done: 0 }],
      markInterrupted: async () => ({ ok: false, changed: 0, error: 'write failed' }),
    },
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.review[0].ok, false);
  console.log('task-recovery.test 通过');
})().catch((error) => { console.error(error); process.exitCode = 1; });
