const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-sentinel-scan-preferences-'));
process.env.VOLUME_INSIGHT_DATA_DIR = tempDir;
const storage = require('../storage');

(async () => {
  assert.equal(await storage.getScanPreferences(), null);
  const saved = await storage.saveScanPreferences(['sz_main', 'sh_main', 'sz_main', '', null], 88);
  assert.deepEqual(saved.markets, ['sz_main', 'sh_main']);
  assert.equal(saved.scanLimit, 88);
  const read = await storage.getScanPreferences();
  assert.deepEqual(read.markets, ['sz_main', 'sh_main']);
  assert.equal(read.scanLimit, 88);
  console.log('scan-preferences.test 通过');
})().catch((error) => { console.error(error); process.exitCode = 1; });
