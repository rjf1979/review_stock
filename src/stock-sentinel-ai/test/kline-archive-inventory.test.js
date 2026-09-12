// D15-03 隔离回归：历史批次覆盖盘点必须只读、可机器读取、并逐项列出缺失原因。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-inventory-'));
process.env.VOLUME_INSIGHT_DATA_DIR = temp;
process.env.VOLUME_INSIGHT_KLINE_DB = path.join(temp, 'test.db');

const archive = require('../kline-archive');
const inventory = require('../kline-archive-inventory');

const META = {
  source: 'tencent', adjustmentType: 'qfq', sourceLatestDate: '2026-09-11',
  fetchedAt: '2026-09-11T07:01:00.000Z', tailStatus: 'confirmed', tailConfirmedAt: '2026-09-11T07:01:00.000Z',
};

function bars(count, endISO = '2026-09-11') {
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

const prescanDir = path.join(temp, 'prescan');
const selectionDir = path.join(temp, 'selection');
const klineDir = path.join(temp, 'kline');
fs.mkdirSync(prescanDir, { recursive: true });
fs.mkdirSync(selectionDir, { recursive: true });

fs.writeFileSync(path.join(prescanDir, 'scan-1.json'), JSON.stringify({
  archiveVersion: 'market-prescan-archive-v1',
  prescan: { batchId: 'scan-1', asOf: '2026-09-11', focusThemes: [{ code: 'BK1' }], focusConcepts: [{ code: 'BK2' }], themeMembership: { BK1: ['600001'] }, sourceEvidence: { sentimentPools: { tradeDate: '2026-09-11' } } },
  snapshot: { snapshotDate: '2026-09-11', records: [{ code: '600001' }] },
  rawEvidence: { file: 'scan-1.json.responses.json.gz' },
}));
fs.writeFileSync(path.join(prescanDir, 'scan-broken.json'), '{not json');
fs.writeFileSync(path.join(selectionDir, 'sel-1.json'), JSON.stringify({
  archiveVersion: 'selection-archive-v1', batchId: 'sel-1',
  records: [{ code: '600001', snapshotDate: '2026-09-11', selectionContractVersion: 3 }],
}));
fs.writeFileSync(path.join(selectionDir, 'sel-old.json'), JSON.stringify({
  archiveVersion: 'selection-archive-v1', batchId: 'sel-old',
  records: [{ code: '600002', snapshotDate: '2026-09-10', selectionContractVersion: 2 }],
}));
archive.archiveKlineVersion({
  archiveId: 'sel-1__rec-1', selectionBatchId: 'sel-1', reviewBatchId: 'rec-1', tradeDate: '2026-09-11',
  records: [archive.buildRecord({ code: '600001', bars: bars(120), meta: META })],
  archiveDir: klineDir,
});
archive.archiveKlineVersion({
  archiveId: 'orphan-1', selectionBatchId: '', reviewBatchId: '', tradeDate: '2026-09-11',
  records: [archive.buildRecord({ code: '600003', bars: bars(30), meta: { ...META, adjustmentType: '' } })],
  archiveDir: klineDir,
});
archive.archiveKlineVersion({
  archiveId: 'sel-missing__rec-9', selectionBatchId: 'sel-missing', reviewBatchId: '', tradeDate: '2026-09-11',
  records: [archive.buildRecord({ code: '600004', bars: bars(30), meta: META })],
  archiveDir: klineDir,
});

const reviewRows = [
  { batchId: 'rec-1', status: 'completed', total: 3, done: 3, succeeded: 3, failed: 0, startedAt: Date.parse('2026-09-11T07:00:00Z'), finishedAt: Date.parse('2026-09-11T07:10:00Z') },
  { batchId: 'rec-2', status: 'running', total: 4, done: 1, succeeded: 1, failed: 0, startedAt: Date.parse('2026-09-12T01:00:00Z'), finishedAt: 0 },
];
const judgmentFile = path.join(temp, 'judgments.json');
fs.writeFileSync(judgmentFile, JSON.stringify({
  version: 1,
  results: {},
  batches: {
    'ai-1': { batchId: 'ai-1', startedAt: Date.parse('2026-09-11T08:00:00Z'), finishedAt: Date.parse('2026-09-11T08:20:00Z'), reason: 'completed', total: 5, done: 5 },
    'ai-2': { batchId: 'ai-2', startedAt: Date.parse('2026-09-12T02:00:00Z'), finishedAt: 0, reason: 'running', total: 6, done: 2 },
  },
}));

(async () => {
  const report = await inventory.inventorySelectionArchives({
    prescanDir, selectionDir, klineDir, judgmentFile, reviewBatchReaderRows: async () => reviewRows,
  });

  assert.equal(report.mode, 'read_only_inventory');
  assert.ok(report.dataDir);
  assert.equal(report.sections.marketPrescan.batchCount, 1, '无法解析的归档不计为批次，只记录缺失原因');
  assert.equal(report.sections.selection.batchCount, 2);
  assert.equal(report.sections.kline.batchCount, 3);
  assert.equal(report.sections.review.batchCount, 2);
  assert.equal(report.sections.aiJudgment.batchCount, 2);

  // 缺失原因必须逐项列出
  const reasons = report.missingReasons.map((item) => `${item.section}:${item.reason}`);
  assert.ok(reasons.includes('marketPrescan:archive_json_invalid'));
  assert.ok(reasons.includes('marketPrescan:attachment_missing'));
  assert.ok(reasons.includes('selection:contract_version_unsupported'));
  assert.ok(reasons.includes('review:review_batch_interrupted'));
  assert.ok(reasons.includes('aiJudgment:ai_batch_interrupted'));
  assert.ok(reasons.includes('kline:selection_batch_unlinked'));
  assert.ok(reasons.includes('kline:record_adjustment_unverified'));

  // K线归档状态汇总：一条完整、两条不完整（缺复权证据 / 缺候选批次回链）
  assert.equal(report.sections.kline.statusCounts.complete, 1);
  assert.equal(report.sections.kline.statusCounts.incomplete, 2);
  assert.equal(report.sections.kline.verified, true);

  // 交易日覆盖：预扫描/候选/K线/复核/AI 五个来源都能落到 2026-09-11 与 2026-09-12
  assert.ok(report.tradingDates.dates.some((item) => item.date === '2026-09-11' && item.sections.marketPrescan));
  assert.ok(report.tradingDates.dates.some((item) => item.date === '2026-09-12' && item.sections.review && item.sections.aiJudgment));

  // 口径约束：不得输出胜率、收益或参数建议字段，且必须在报告中显式声明该边界
  const text = JSON.stringify(report);
  for (const forbidden of ['winRate', 'returnPct', 'expectedReturn', 'promisedReturn', 'parameterSuggestion']) {
    assert.ok(!text.includes(forbidden), `盘点报告不得包含字段 ${forbidden}`);
  }
  assert.match(report.disclaimer, /不输出胜率/);

  // --no-verify 时不逐条校验，但仍列出批次
  const light = await inventory.inventorySelectionArchives({
    prescanDir, selectionDir, klineDir, judgmentFile, verifyKline: false, reviewBatchReaderRows: async () => reviewRows,
  });
  assert.equal(light.sections.kline.verified, false);
  assert.equal(light.sections.kline.batchCount, 3);
  assert.equal(light.sections.kline.statusCounts.unverified, 3);
  console.log('kline-archive-inventory.test 通过');
})().catch((error) => { console.error(error); process.exitCode = 1; });
