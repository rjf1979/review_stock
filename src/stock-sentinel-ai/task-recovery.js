// 智诊盯盘 · 中断任务恢复标记（第十五阶段 D15-05）
//
// 服务启动时识别上一次进程遗留的 `running` 批次，明确结算为 `interrupted`，并记录可人工重试的入口。
//
// 硬约束（不得违反）：
// - 只改状态，不自动续跑、不自动调用 AI、不自动迁移候选/自选名单、不删除任何已完成结果。
// - 需要重试时必须由用户在界面上显式触发（复核重试、AI 研判重试、K 线补齐）。
// - 结算结果只读记录在 data/task-recovery.json，供后续复核查看。
const fs = require('fs');
const path = require('path');
const { DATA_DIR, readWatchRecommendationBatches, markWatchRecommendationBatchInterrupted } = require('./storage');
const judgmentStore = require('./judgment-store');
const taskMarkers = require('./task-markers');

const REPORT_FILE = path.join(DATA_DIR, 'task-recovery.json');
const MAX_REPORT_RUNS = 20;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function saveReport(report) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const previous = readJson(REPORT_FILE);
    const runs = Array.isArray(previous && previous.runs) ? previous.runs.slice(-(MAX_REPORT_RUNS - 1)) : [];
    runs.push(report);
    const temp = `${REPORT_FILE}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ version: 1, updatedAt: report.settledAt, runs }, null, 2), 'utf8');
    fs.renameSync(temp, REPORT_FILE);
    return true;
  } catch {
    return false;
  }
}

function readReport() {
  const parsed = readJson(REPORT_FILE);
  if (!parsed || !Array.isArray(parsed.runs)) return { version: 1, updatedAt: '', runs: [] };
  return parsed;
}

// AI 研判批次：judgments.json 中未收尾（finishedAt 为空）的批次结算为 interrupted。
function settleAiJudgmentBatches({ listBatches = () => judgmentStore.listBatches(), saveBatch = (batch) => judgmentStore.saveBatch(batch) } = {}) {
  const settled = [];
  for (const batch of listBatches()) {
    if (!batch || !batch.batchId) continue;
    // 已结算过中断的批次不重复改写，保证多次启动幂等。
    if (batch.interrupted === true || String(batch.reason || '') === 'interrupted') continue;
    if (Number(batch.finishedAt) > 0) continue;
    const ok = saveBatch({
      ...batch,
      reason: 'interrupted',
      interrupted: true,
      interruptedAt: new Date().toISOString(),
      interruptedNote: '服务重启时该批次仍在运行，已结算为中断；不会自动续跑，需人工重新发起',
    });
    settled.push({ batchId: String(batch.batchId), total: Number(batch.total) || 0, done: Number(batch.done) || 0, ok: ok !== false });
  }
  return settled;
}

// 复核批次：SQLite 中 status='running' 的批次结算为 interrupted。
async function settleReviewBatches({ readBatches = readWatchRecommendationBatches, markInterrupted = markWatchRecommendationBatchInterrupted } = {}) {
  const running = await readBatches({ status: 'running', limit: 200, throwOnError: true });
  const settled = [];
  for (const batch of running) {
    const batchId = String((batch && batch.batchId) || '');
    if (!batchId) continue;
    let result;
    try { result = await markInterrupted(batchId, { note: '服务重启时复核批次仍在运行' }); }
    catch (error) { result = { ok: false, changed: 0, error: String((error && error.message) || error) }; }
    settled.push({ batchId, total: Number(batch.total) || 0, done: Number(batch.done) || 0, ok: result.ok !== false, changed: Number(result.changed) || 0 });
  }
  return settled;
}

// K线队列：读取队列标记，把遗留 running 结算为 interrupted。
function settleKlineQueues({ markers = taskMarkers.listMarkers(), interrupt = taskMarkers.interruptMarker } = {}) {
  const settled = [];
  for (const marker of markers) {
    if (!marker || marker.status !== 'running') continue;
    const name = String(marker.name || '');
    if (!name) continue;
    const result = interrupt(name, '服务重启时K线队列仍在运行，已标记中断；需人工重新发起补齐');
    settled.push({ name, total: Number(marker.total) || 0, done: Number(marker.done) || 0, ok: result.ok !== false });
  }
  return settled;
}

/**
 * 结算全部遗留任务。默认只读+状态结算，不触发任何后续动作。
 * @returns {{ok:boolean, settledAt:string, aiJudgment:Array, review:Array, klineQueue:Array, totals:object, retryHints:Array}}
 */
async function settleInterruptedTasks(options = {}) {
  const settledAt = new Date().toISOString();
  const aiJudgment = settleAiJudgmentBatches(options.aiJudgment);
  const review = await settleReviewBatches(options.review);
  const klineQueue = settleKlineQueues(options.klineQueue);
  const totals = {
    aiJudgment: aiJudgment.length,
    review: review.length,
    klineQueue: klineQueue.length,
    total: aiJudgment.length + review.length + klineQueue.length,
  };
  const report = {
    settledAt,
    autoResumed: false,
    autoInvokedAi: false,
    autoMigratedWatchlist: false,
    note: '只结算状态，不自动续跑、不自动调用AI、不自动迁移名单；重试必须由用户显式触发。',
    aiJudgment,
    review,
    klineQueue,
    totals,
    retryHints: [
      aiJudgment.length ? { task: 'aiJudgment', entry: 'POST /api/ai/batch-retry', note: 'AI 研判重试（人工触发）' } : null,
      review.length ? { task: 'review', entry: 'POST /api/pool/recommendations', note: '候选池严格复核重试（人工触发）' } : null,
      klineQueue.length ? { task: 'klineQueue', entry: 'POST /api/pool/kline 或 POST /api/kline/sync', note: 'K 线补齐重试（人工触发）' } : null,
    ].filter(Boolean),
  };
  const settlementOk = [...aiJudgment, ...review, ...klineQueue].every((item) => item.ok !== false && item.changed !== 0);
  if (typeof options.log === 'function' && totals.total) options.log(`[task-recovery] 结算中断任务：AI研判 ${totals.aiJudgment}、复核 ${totals.review}、K线队列 ${totals.klineQueue}`);
  saveReport(report);
  return { ok: settlementOk, ...report };
}

function lastRecoveryReport() {
  const report = readReport();
  return report.runs.length ? report.runs[report.runs.length - 1] : null;
}

module.exports = {
  REPORT_FILE,
  settleAiJudgmentBatches,
  settleReviewBatches,
  settleKlineQueues,
  settleInterruptedTasks,
  lastRecoveryReport,
  readReport,
};
