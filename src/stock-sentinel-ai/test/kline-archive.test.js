// D15-01 / D15-02 隔离回归：K线版本不可变归档的写入、不可覆盖、读取与完整性校验。
// 仅使用临时数据目录，不触碰真实 data/。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-kline-archive-'));
process.env.VOLUME_INSIGHT_DATA_DIR = temp;
process.env.VOLUME_INSIGHT_KLINE_DB = path.join(temp, 'test.db');

const storage = require('../storage');
const archive = require('../kline-archive');

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

function writeSelectionStub(batchId) {
  const dir = path.join(temp, 'selection-archive');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${batchId}.json`), JSON.stringify({ archiveVersion: 'selection-archive-v1', batchId, records: [{ code: '600001', snapshotDate: '2026-09-11' }] }));
}

function mutate(file, fn) {
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  fn(payload);
  fs.writeFileSync(file, JSON.stringify(payload));
}

(async () => {
  // 端到端：从本地K线库归档并校验完整
  assert.equal(await storage.writeKline('600001', bars(250), '2026-09-11', META), true);
  writeSelectionStub('sel-1');
  const archived = await archive.archiveFromStorage(['600001', '600002'], {
    archiveId: 'sel-1__rec-1', selectionBatchId: 'sel-1', reviewBatchId: 'rec-1', tradeDate: '2026-09-11',
  });
  assert.equal(archived.ok, true);
  assert.equal(archived.skipped, false);
  assert.equal(archived.records, 1, '无本地K线的股票不得归档');
  assert.equal(archived.missing.length, 1, '缺K线的股票应记录缺失原因');

  const complete = await archive.verifyKlineVersionArchive('sel-1__rec-1', { reviewBatchReader: async (batchId) => batchId === 'rec-1' });
  assert.equal(complete.status, 'complete', JSON.stringify(complete.issues));
  assert.equal(complete.counts.records, 1);
  assert.equal(complete.counts.verified, 1);
  assert.match(complete.hashes['600001'], /^[0-9a-f]{64}$/);

  // 幂等重试允许跳过；同一ID若内容或来源不同必须报冲突且文件字节不变。
  const before = fs.readFileSync(archived.file, 'utf8');
  const again = await archive.archiveFromStorage(['600001'], { archiveId: 'sel-1__rec-1', selectionBatchId: 'sel-1', reviewBatchId: 'rec-1', tradeDate: '2026-09-11' });
  assert.equal(again.skipped, true, '同一归档ID禁止覆盖');
  const conflicting = archive.archiveKlineVersion({
    archiveId: 'sel-1__rec-1', selectionBatchId: 'sel-1', reviewBatchId: 'rec-1', tradeDate: '2026-09-11',
    records: [archive.buildRecord({ code: '600001', bars: bars(120), meta: { ...META, adjustmentType: 'unadjusted' } })],
  });
  assert.equal(conflicting.ok, false);
  assert.equal(conflicting.code, 'KLINE_ARCHIVE_CONFLICT');
  assert.equal(fs.readFileSync(archived.file, 'utf8'), before, '归档内容不得被改写');

  // 批次回链：缺少复核归档时归为不完整
  const unlinked = await archive.verifyKlineVersionArchive('sel-1__rec-1', { reviewBatchReader: async () => false });
  assert.equal(unlinked.status, 'incomplete');
  assert.ok(unlinked.issues.some((item) => item.code === 'review_batch_unlinked'));

  // 候选批次归档缺失时也不得声称完整
  const orphan = await archive.archiveFromStorage(['600001'], { archiveId: 'sel-missing__rec-2', selectionBatchId: 'sel-missing', tradeDate: '2026-09-11' });
  const orphanResult = await archive.verifyKlineVersionArchive(orphan.file);
  assert.equal(orphanResult.status, 'incomplete');
  assert.ok(orphanResult.issues.some((item) => item.code === 'selection_batch_unlinked'));

  // 正文被改写：哈希不符必须判为损坏
  const tampered = await archive.archiveFromStorage(['600001'], { archiveId: 'sel-1__rec-3', selectionBatchId: 'sel-1', tradeDate: '2026-09-11' });
  mutate(tampered.file, (payload) => { payload.records[0].bars[0].close = Number(payload.records[0].bars[0].close) + 1; });
  const tamperedResult = await archive.verifyKlineVersionArchive(tampered.file);
  assert.equal(tamperedResult.status, 'corrupt');
  assert.ok(tamperedResult.issues.some((item) => item.code === 'record_hash_mismatch'));

  // 未来数据：归档交易日之后出现K线必须判为损坏
  const futureBars = archive.buildRecord({ code: '600001', bars: bars(10, '2026-09-12'), meta: META });
  const future = archive.archiveKlineVersion({
    archiveId: 'future-1', selectionBatchId: 'sel-1', tradeDate: '2026-09-11', records: [futureBars],
  });
  const futureResult = await archive.verifyKlineVersionArchive(future.file);
  assert.equal(futureResult.status, 'corrupt');
  assert.ok(futureResult.issues.some((item) => item.code === 'record_bar_after_trade_date'));

  // 复权口径无法验证：不得写成 qfq，只能报不完整
  const unknownAdj = archive.buildRecord({ code: '600001', bars: bars(20), meta: { ...META, adjustmentType: '' } });
  const unknown = archive.archiveKlineVersion({ archiveId: 'adj-1', selectionBatchId: 'sel-1', tradeDate: '2026-09-11', records: [unknownAdj] });
  const unknownResult = await archive.verifyKlineVersionArchive(unknown.file);
  assert.equal(unknownResult.status, 'incomplete');
  assert.ok(unknownResult.issues.some((item) => item.code === 'record_adjustment_unverified'));

  // 暂定尾K：不能算作已验证版本
  const provisional = archive.buildRecord({ code: '600001', bars: bars(20), meta: { ...META, tailStatus: 'provisional', tailConfirmedAt: '' } });
  const provisionalFile = archive.archiveKlineVersion({ archiveId: 'tail-1', selectionBatchId: 'sel-1', tradeDate: '2026-09-11', records: [provisional] });
  const provisionalResult = await archive.verifyKlineVersionArchive(provisionalFile.file);
  assert.equal(provisionalResult.status, 'incomplete');
  assert.ok(provisionalResult.issues.some((item) => item.code === 'record_tail_not_confirmed'));

  // 只存元数据（无正文）：内容无法校验，只能算不完整
  const metaOnly = archive.buildRecord({ code: '600001', bars: bars(20), meta: META, contentHash: 'deadbeef' });
  delete metaOnly.bars;
  const metaOnlyFile = archive.archiveKlineVersion({ archiveId: 'meta-1', selectionBatchId: 'sel-1', tradeDate: '2026-09-11', records: [metaOnly] });
  const metaOnlyResult = await archive.verifyKlineVersionArchive(metaOnlyFile.file);
  assert.equal(metaOnlyResult.status, 'incomplete');
  assert.ok(metaOnlyResult.issues.some((item) => item.code === 'record_content_unverifiable'));

  // 归档不存在 / JSON 损坏
  assert.equal((await archive.verifyKlineVersionArchive('not-exist')).status, 'incomplete');
  fs.writeFileSync(path.join(archive.ARCHIVE_DIR, 'broken.json'), '{not json');
  const broken = await archive.verifyKlineVersionArchive('broken');
  assert.equal(broken.status, 'corrupt');
  assert.ok(broken.issues.some((item) => item.code === 'archive_json_invalid'));

  // 只读清单包含记录代码与内容哈希（供回放预检使用）
  const listed = archive.listKlineVersionArchives();
  const selEntry = listed.find((item) => item.archiveId === 'sel-1__rec-1');
  assert.ok(selEntry && selEntry.recordCodes.includes('600001'));
  assert.ok(selEntry.contentHashes['600001']);
  assert.equal(selEntry.selectionBatchId, 'sel-1');
  console.log('kline-archive.test 通过');
})().catch((error) => { console.error(error); process.exitCode = 1; });
