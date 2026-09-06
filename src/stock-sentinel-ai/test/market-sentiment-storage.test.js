const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sentiment-storage-'));
process.env.VOLUME_INSIGHT_DATA_DIR = temp;
process.env.VOLUME_INSIGHT_KLINE_DB = path.join(temp, 'test.db');
const storage = require('../storage');

(async () => {
  const normalized = { available: true, tradeDate: '2026-09-04', limitUpCount: 39, limitDownCount: 9, brokenCount: 48, sealRate: 39 / 87, maxBoardHeight: 5, heightDistribution: { 1: 30, 2: 6, 3: 2, 5: 1 }, quality: { complete: true } };
  assert.strictEqual(await storage.writeMarketSentimentSnapshot({ ...normalized, normalized, raw: { ok: true }, quality: normalized.quality }), true);
  const saved = await storage.readMarketSentimentSnapshot('2026-09-04');
  assert.strictEqual(saved.limitUpCount, 39);
  assert.strictEqual(saved.quality.complete, true);
  console.log('market-sentiment-storage.test 通过');
})().catch((error) => { console.error(error); process.exit(1); });
