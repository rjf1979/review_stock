const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-prescan-integrity-'));
process.env.VOLUME_INSIGHT_DATA_DIR = temp;
process.env.VOLUME_INSIGHT_KLINE_DB = path.join(temp, 'test.db');
const store = require('../market-prescan-store');
const { verifyPrescanArchive } = require('../market-prescan-integrity');

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

const sentiment = {
  tradeDate: '2026-09-12', source: 'eastmoney', fetchedAt: '2026-09-12T07:01:00.000Z', available: true,
  rawBytes: 123, sha256: 'a'.repeat(64), storage: 'market_sentiment_snapshots.rawJson', rawFormat: 'json',
  pools: Object.fromEntries(['limitUp', 'limitDown', 'broken'].map((name) => [name, { present: true, rawBytes: 10, sha256: hash(name) }])),
  quality: { complete: true, requestedDate: '2026-09-12', responseDates: { limitUp: '2026-09-12', limitDown: '2026-09-12', broken: '2026-09-12' }, conflicts: [] },
};

function rawText(value) {
  const text = JSON.stringify(value);
  return { wireExact: true, byteLength: Buffer.byteLength(text), sha256: hash(text), rawText: text };
}

function makeArchive(batchId, options = {}) {
  const marketPage = rawText({ data: { total: 1, diff: [{ f12: '600001' }] } });
  if (options.badPageHash) marketPage.sha256 = '0'.repeat(64);
  const memberPage = { page: 1, ...rawText({ data: { total: 1, diff: [{ f12: '600001' }] } }) };
  const indexBytes = Buffer.from('index-wire-bytes');
  const sourceRaw = {
    indices: { encoding: 'gbk', wireExact: true, byteLength: indexBytes.length, sha256: hash(indexBytes), rawBase64: indexBytes.toString('base64') },
    industryBoards: rawText({ data: { diff: [{ f12: 'BK1' }] } }),
    conceptBoards: rawText({ data: { diff: [{ f12: 'BK2' }] } }),
    industryConstituents: { BK1: [memberPage] },
    conceptConstituents: { BK2: [memberPage] },
  };
  const sourceEvidence = {
    indices: { byteLength: indexBytes.length, sha256: hash(indexBytes) },
    industryBoards: { byteLength: sourceRaw.industryBoards.byteLength, sha256: sourceRaw.industryBoards.sha256 },
    conceptBoards: { byteLength: sourceRaw.conceptBoards.byteLength, sha256: sourceRaw.conceptBoards.sha256 },
    industryConstituents: { BK1: { records: 1, expectedCount: 1, pages: [{ page: 1, sha256: memberPage.sha256 }] } },
    conceptConstituents: { BK2: { records: 1, expectedCount: 1, pages: [{ page: 1, sha256: memberPage.sha256 }] } },
    sentimentPools: options.sentiment || sentiment,
  };
  const record = {
    batchId, snapshotDate: '2026-09-12', asOf: '2026-09-12', sourceEvidence,
    focusThemes: [{ code: 'BK1' }], focusConcepts: [{ code: 'BK2' }],
    scanScope: { mode: 'theme_and_concept_constituents' },
    themeMembership: { BK1: ['600001'], BK2: ['600001'] }, scopeCodes: ['600001'],
  };
  const snapshot = {
    snapshotDate: '2026-09-12', dataSource: 'live', records: [{ code: '600001', price: 10 }],
    byMarket: [{ key: 'sh_main', source: 'live', count: 1, quality: { complete: true } }],
    rawPagesByMarket: { sh_main: [{ page: 1, fetchedAt: '2026-09-12T07:00:00.000Z', ...marketPage }] },
  };
  const archived = store.archivePrescan(record, snapshot, sourceRaw);
  assert.equal(archived.ok, true);
  return archived;
}

(async () => {
  const valid = makeArchive('valid');
  const complete = await verifyPrescanArchive(valid.file, { sentimentEvidenceReader: async () => sentiment });
  assert.equal(complete.status, 'complete');
  assert.equal(complete.issues.length, 0);
  assert.equal(complete.counts.marketPages, 1);
  assert.ok(complete.counts.sourcePayloads >= 6);

  const missing = makeArchive('missing');
  fs.unlinkSync(missing.rawFile);
  assert.equal((await verifyPrescanArchive(missing.file, { sentimentEvidenceReader: async () => sentiment })).status, 'incomplete');

  const broken = makeArchive('broken');
  fs.writeFileSync(broken.rawFile, Buffer.from('not-gzip'));
  const brokenResult = await verifyPrescanArchive(broken.file, { sentimentEvidenceReader: async () => sentiment });
  assert.equal(brokenResult.status, 'corrupt');
  assert.ok(brokenResult.issues.some((item) => item.code === 'gzip_invalid'));

  const summaryMismatch = makeArchive('summary-mismatch');
  const main = JSON.parse(fs.readFileSync(summaryMismatch.file, 'utf8'));
  main.rawEvidence.sha256 = 'f'.repeat(64);
  fs.writeFileSync(summaryMismatch.file, JSON.stringify(main));
  const summaryResult = await verifyPrescanArchive(summaryMismatch.file, { sentimentEvidenceReader: async () => sentiment });
  assert.equal(summaryResult.status, 'corrupt');
  assert.ok(summaryResult.issues.some((item) => item.code === 'attachment_hash_mismatch'));

  const sourceSummaryMismatch = makeArchive('source-summary-mismatch');
  const sourceMain = JSON.parse(fs.readFileSync(sourceSummaryMismatch.file, 'utf8'));
  sourceMain.prescan.sourceEvidence.industryBoards.sha256 = 'e'.repeat(64);
  fs.writeFileSync(sourceSummaryMismatch.file, JSON.stringify(sourceMain));
  const sourceSummaryResult = await verifyPrescanArchive(sourceSummaryMismatch.file, { sentimentEvidenceReader: async () => sentiment });
  assert.equal(sourceSummaryResult.status, 'corrupt');
  assert.ok(sourceSummaryResult.issues.some((item) => item.code === 'source_summary_hash_mismatch'));

  const pageMismatch = makeArchive('page-mismatch', { badPageHash: true });
  const pageResult = await verifyPrescanArchive(pageMismatch.file, { sentimentEvidenceReader: async () => sentiment });
  assert.equal(pageResult.status, 'corrupt');
  assert.ok(pageResult.issues.some((item) => item.code === 'raw_hash_mismatch'));

  const conflictSentiment = { ...sentiment, quality: { ...sentiment.quality, complete: false, responseDates: { ...sentiment.quality.responseDates, limitUp: '2026-09-11' }, conflicts: ['日期冲突'] } };
  const conflict = makeArchive('sentiment-conflict', { sentiment: conflictSentiment });
  const conflictResult = await verifyPrescanArchive(conflict.file, { sentimentEvidenceReader: async () => conflictSentiment });
  assert.equal(conflictResult.status, 'corrupt');
  assert.ok(conflictResult.issues.some((item) => item.code === 'sentiment_response_date_conflict'));

  const weakSentiment = { ...sentiment, quality: { ...sentiment.quality, complete: false, responseDates: {} } };
  const weak = makeArchive('sentiment-incomplete', { sentiment: weakSentiment });
  const weakResult = await verifyPrescanArchive(weak.file, { sentimentEvidenceReader: async () => weakSentiment });
  assert.equal(weakResult.status, 'incomplete');
  assert.ok(weakResult.issues.some((item) => item.code === 'sentiment_quality_incomplete'));
  console.log('market-prescan-integrity.test 通过');
})().catch((error) => { console.error(error); process.exitCode = 1; });
