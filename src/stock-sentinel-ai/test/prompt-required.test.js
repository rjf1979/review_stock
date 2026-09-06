const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-sentinel-prompt-required-'));
process.env.VOLUME_INSIGHT_DATA_DIR = tempDir;
process.env.VOLUME_INSIGHT_KLINE_DB = path.join(tempDir, 'kline.db');
const settings = require('../settings');
settings.load = () => ({ tradingStyle: 'short', ai: { baseURL: 'https://example.test/v1', apiKey: 'test-key', model: 'test-model' } });
const judgmentCore = require('../judgment-core');

(async () => {
  const result = await judgmentCore.judgePrepared({ code: '600001', dataStatus: 'full', snapshotDate: '2026-09-04', read: {} });
  assert.equal(result.code, 'prompt_required');
  assert.equal(result.judgmentStatus, 'skipped');
  console.log('prompt-required.test 通过');
})().catch((error) => { console.error(error); process.exitCode = 1; });
