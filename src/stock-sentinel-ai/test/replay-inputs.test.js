// T10 隔离回归：回放输入只从不可变批次归档取决策证据，现库只提供同源同复权的事后观察。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const initSqlJs = require('sql.js/dist/sql-asm.js').default;

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-replay-inputs-'));
process.env.VOLUME_INSIGHT_DATA_DIR = temp;
process.env.VOLUME_INSIGHT_KLINE_DB = path.join(temp, 'kline.db');

const { confirmedFutureBars, loadReplayInputs } = require('../replay-inputs');

const AS_OF = '2026-09-11';
const selectionDir = path.join(temp, 'selection-archive');
const klineDir = path.join(temp, 'kline-archive');
const legacyPoolFile = path.join(temp, 'candidate-pool.json');
fs.mkdirSync(selectionDir, { recursive: true });
fs.mkdirSync(klineDir, { recursive: true });

function bar(date, close) {
  return { date, open: close - 0.1, high: close + 0.2, low: close - 0.2, close, volume: 1000 };
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value), 'utf8');
}

function selection(batchId, code) {
  writeJson(path.join(selectionDir, `${batchId}.json`), {
    archiveVersion: 'selection-archive-v1', batchId, createdAt: `${AS_OF}T07:00:00.000Z`,
    records: [{ code, snapshotDate: AS_OF, selectionBatchId: batchId, selectionContractVersion: 3 }],
  });
}

function archive(fileName, { archiveId, selectionBatchId, reviewBatchId, createdAt, code, source = 'tencent', adjustmentType = 'qfq', close }) {
  writeJson(path.join(klineDir, fileName), {
    archiveVersion: 'kline-archive-v1', archiveId, selectionBatchId, reviewBatchId, tradeDate: AS_OF, createdAt,
    records: [{
      code, source, adjustmentType, sourceLatestDate: AS_OF, fetchedAt: `${AS_OF}T07:01:00.000Z`,
      tailStatus: 'confirmed', tailConfirmedAt: `${AS_OF}T07:01:00.000Z`, bars: [bar(AS_OF, close)],
    }],
  });
}

async function writeDatabase(file) {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('CREATE TABLE kline(code TEXT,date TEXT,open REAL,high REAL,low REAL,close REAL,volume REAL,amount REAL)');
  db.run('CREATE TABLE kline_meta(code TEXT,source TEXT,adjustmentType TEXT,sourceLatestDate TEXT,fetchedAt TEXT,tailStatus TEXT,tailConfirmedAt TEXT)');
  db.run('CREATE TABLE watch_recommendation_batches(batchId TEXT)');
  for (const code of ['600001', '600002', '600003']) {
    for (const row of [bar(AS_OF, 30), bar('2026-09-12', 31)]) {
      db.run('INSERT INTO kline VALUES(?,?,?,?,?,?,?,?)', [code, row.date, row.open, row.high, row.low, row.close, row.volume, null]);
    }
    const source = code === '600003' ? 'sina' : 'tencent';
    const adjustment = code === '600003' ? 'unknown' : 'qfq';
    db.run('INSERT INTO kline_meta VALUES(?,?,?,?,?,?,?)', [code, source, adjustment, '2026-09-12', '2026-09-12T07:01:00.000Z', 'confirmed', '2026-09-12T07:01:00.000Z']);
  }
  db.run('INSERT INTO watch_recommendation_batches VALUES(?)', ['rec-early']);
  fs.writeFileSync(file, Buffer.from(db.export()));
  db.close();
}

(async () => {
  const observationBars = [bar(AS_OF, 30), bar('2026-09-12', 31), bar('2026-09-15', 32)];
  const confirmed = confirmedFutureBars(observationBars, {
    sourceLatestDate: '2026-09-15', tailStatus: 'confirmed', tailConfirmedAt: '2026-09-15T07:01:00.000Z',
  }, AS_OF);
  assert.deepEqual(confirmed.bars.map((row) => row.date), ['2026-09-12', '2026-09-15'], '已确认尾K可以进入未来观察');
  assert.deepEqual(confirmed.issues, []);

  const provisional = confirmedFutureBars(observationBars, {
    sourceLatestDate: '2026-09-15', tailStatus: 'provisional', tailConfirmedAt: '',
  }, AS_OF);
  assert.deepEqual(provisional.bars.map((row) => row.date), ['2026-09-12'], '盘中暂定尾K必须排除');
  assert.equal(provisional.issues[0].code, 'future_kline_tail_provisional_excluded');

  const unknown = confirmedFutureBars(observationBars, {
    sourceLatestDate: '2026-09-15', tailStatus: '', tailConfirmedAt: '',
  }, AS_OF);
  assert.deepEqual(unknown.bars.map((row) => row.date), ['2026-09-12'], '未知尾K状态必须保守排除最新一根');
  assert.equal(unknown.issues[0].code, 'future_kline_tail_status_unknown_excluded');

  const staleSourceDate = confirmedFutureBars(observationBars, {
    sourceLatestDate: '2026-09-12', tailStatus: 'provisional', tailConfirmedAt: '',
  }, AS_OF);
  assert.deepEqual(staleSourceDate.bars.map((row) => row.date), ['2026-09-12'], '来源日期异常落后时仍只排除序列尾K，不误删更早完成日');

  const invalidConfirmation = confirmedFutureBars(observationBars, {
    sourceLatestDate: '2026-09-15', tailStatus: 'confirmed', tailConfirmedAt: 'invalid',
  }, AS_OF);
  assert.deepEqual(invalidConfirmation.bars.map((row) => row.date), ['2026-09-12'], '确认时间无效时不得信任尾K');
  assert.equal(invalidConfirmation.issues[0].code, 'future_kline_tail_confirmation_invalid');

  await writeDatabase(process.env.VOLUME_INSIGHT_KLINE_DB);
  selection('sel-a', '600001');
  selection('sel-b', '600001');
  selection('sel-missing', '600002');
  selection('sel-mismatch', '600003');
  writeJson(legacyPoolFile, [{ code: '999999', snapshotDate: AS_OF }]);

  archive('a-invalid-time.json', { archiveId: 'invalid-time', selectionBatchId: 'sel-a', reviewBatchId: 'rec-invalid', createdAt: '', code: '600001', close: 8 });
  archive('b-later.json', { archiveId: 'later', selectionBatchId: 'sel-a', reviewBatchId: 'rec-later', createdAt: '2026-09-11T08:00:00.000Z', code: '600001', close: 12 });
  archive('c-earlier.json', { archiveId: 'earlier', selectionBatchId: 'sel-a', reviewBatchId: 'rec-early', createdAt: '2026-09-11T07:30:00.000Z', code: '600001', close: 10 });
  archive('d-other-batch.json', { archiveId: 'other-batch', selectionBatchId: 'sel-b', reviewBatchId: 'rec-b', createdAt: '2026-09-11T07:15:00.000Z', code: '600001', close: 20 });
  archive('e-mismatch.json', { archiveId: 'mismatch', selectionBatchId: 'sel-mismatch', reviewBatchId: 'rec-mismatch', createdAt: '2026-09-11T07:10:00.000Z', code: '600003', close: 15 });

  const loaded = await loadReplayInputs({ selectionDir, klineDir, legacyPoolFile, dbFile: process.env.VOLUME_INSIGHT_KLINE_DB });
  assert.equal(loaded.source, 'selection_archives');
  assert.equal(loaded.samples.length, 4, '候选归档存在时不得读取可变候选池');
  assert.equal(loaded.samples.some((sample) => sample.item.code === '999999'), false);

  const first = loaded.samples.find((sample) => sample.item.selectionBatchId === 'sel-a');
  const otherBatch = loaded.samples.find((sample) => sample.item.selectionBatchId === 'sel-b');
  const missing = loaded.samples.find((sample) => sample.item.selectionBatchId === 'sel-missing');
  const mismatch = loaded.samples.find((sample) => sample.item.selectionBatchId === 'sel-mismatch');
  assert.equal(first.replayArchive.archiveId, 'earlier', '重复复核固定使用有效写入时间最早的归档');
  assert.equal(first.candles[0].close, 10);
  assert.equal(first.futureCandles.length, 1, '同源同复权的现库未来K线只进入事后观察');
  assert.equal(otherBatch.candles[0].close, 20, '同一股票跨候选批次不得串用K线归档');
  assert.deepEqual(missing.candles, [], '新契约缺K线归档时不得借用现库作为决策证据');
  assert.ok(loaded.issues.some((issue) => issue.code === 'kline_archive_missing_for_selection' && issue.selectionBatchId === 'sel-missing'));
  assert.deepEqual(mismatch.futureCandles, [], '来源或复权冲突时不得拼接现库未来K线');
  assert.ok(loaded.issues.some((issue) => issue.code === 'future_kline_provenance_mismatch' && issue.selectionBatchId === 'sel-mismatch'));
  assert.equal(loaded.reviewBatchIds.has('rec-early'), true);
  assert.equal(loaded.reviewBatchIds.has('rec-later'), false, '复核批次必须由SQLite证明，不能由K线归档自证');

  const emptySelections = path.join(temp, 'empty-selection');
  const emptyKlines = path.join(temp, 'empty-kline');
  fs.mkdirSync(emptySelections);
  fs.mkdirSync(emptyKlines);
  writeJson(legacyPoolFile, [{ code: '600001', snapshotDate: AS_OF }]);
  const legacy = await loadReplayInputs({ selectionDir: emptySelections, klineDir: emptyKlines, legacyPoolFile, dbFile: process.env.VOLUME_INSIGHT_KLINE_DB });
  assert.equal(legacy.source, 'legacy_candidate_pool');
  assert.equal(legacy.samples.length, 1);
  assert.deepEqual(legacy.samples[0].candles.map((row) => row.date), [AS_OF], '旧候选仅作诊断并严格截断现库K线');
  assert.deepEqual(legacy.samples[0].futureCandles, [], '旧候选无冻结来源证据，不拼接事后观察K线');

  const invalidSelections = path.join(temp, 'invalid-selection');
  fs.mkdirSync(invalidSelections);
  fs.writeFileSync(path.join(invalidSelections, 'broken.json'), '{broken', 'utf8');
  const invalid = await loadReplayInputs({ selectionDir: invalidSelections, klineDir: emptyKlines, legacyPoolFile, dbFile: process.env.VOLUME_INSIGHT_KLINE_DB });
  assert.equal(invalid.source, 'selection_archives', '候选归档存在但损坏时不得静默回退可变候选池');
  assert.equal(invalid.samples.length, 0);
  assert.ok(invalid.issues.some((issue) => issue.code === 'selection_archive_invalid'));

  console.log('replay-inputs.test 通过');
})().catch((error) => { console.error(error); process.exitCode = 1; });
