const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const observation = require('../selection-observation');

const archiveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-observation-'));
const write = (name, value) => fs.writeFileSync(path.join(archiveDir, name), JSON.stringify(value), 'utf8');
write('batch-a.json', {
  batchId: 'batch-a', records: [
    { code: '600001', snapshotDate: '2026-09-01', selectionBatchId: 'batch-a', selectionContractVersion: 3 },
    { code: '600002', snapshotDate: '2026-09-02', selectionBatchId: 'batch-a', selectionContractVersion: 3 },
  ],
});
write('batch-b.json', {
  batchId: 'batch-b', records: [
    { code: '600001', snapshotDate: '2026-09-15', selectionBatchId: 'batch-b', selectionContractVersion: 3 },
    { code: '600003', snapshotDate: '2026-01-01', selectionBatchId: 'batch-b', selectionContractVersion: 3 },
    { code: 'bad', snapshotDate: '2026-09-10', selectionBatchId: 'batch-b', selectionContractVersion: 3 },
  ],
});
fs.writeFileSync(path.join(archiveDir, 'broken.json'), '{bad', 'utf8');

const tradingDates = Array.from({ length: 30 }, (_, index) => {
  const date = new Date('2026-09-02T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + index);
  return date.toISOString().slice(0, 10);
});

(async () => {
  const result = await observation.pendingObservationCodes({
    archiveDir,
    now: new Date('2026-10-01T08:00:00Z'),
    retentionDays: 120,
    window: 20,
    readDates: async (code) => code === '600002' ? tradingDates.slice(0, 5) : tradingDates,
  });
  assert.deepEqual(result.codes, ['600001', '600002'], '同股早批次成熟但晚批次未成熟时仍需继续跟踪并按代码去重');
  assert.equal(result.mature.some((target) => target.batchId === 'batch-a' && target.code === '600001'), true);
  assert.equal(result.pending.some((target) => target.batchId === 'batch-b' && target.code === '600001'), true);
  assert.equal(result.pending.find((target) => target.code === '600002').observedTradingDays, 4, '入池当日不计入未来观察窗口');
  assert.ok(result.issues.some((issue) => issue.code === 'selection_observation_retention_expired' && issue.stockCode === '600003'));
  assert.ok(result.issues.some((issue) => issue.code === 'selection_observation_target_invalid'));
  assert.ok(result.issues.some((issue) => issue.code === 'selection_archive_invalid'));
  assert.equal(observation.validDate('2026-02-30'), '');
  assert.equal(observation.calendarAgeDays('2026-09-01', '2026-09-11'), 10);
  assert.equal(observation.isPostCloseObservationRequest('managed', 'post-close', true), true);
  assert.equal(observation.isPostCloseObservationRequest('managed', 'post-close', false), false, '前端标签不能绕过后端闭市判断');
  assert.equal(observation.isPostCloseObservationRequest('managed', 'interval', true), false, '盘中周期同步不得扩大到历史归档候选');
  assert.equal(observation.isPostCloseObservationRequest('watch', 'post-close', true), false, '仅自选同步不得混入历史归档候选');
  await assert.rejects(() => observation.pendingObservationCodes({ archiveDir }), /缺少K线日期读取器/);
  console.log('selection-observation.test 通过');
})().catch((error) => { console.error(error); process.exitCode = 1; });
