const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStorage } = require('./storage');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hangqing-storage-'));
  const storage = await createStorage({
    dbPath: path.join(dir, 'test.sqlite'),
    legacyStatePath: path.join(dir, 'desktop-state.json'),
    legacyReviewsDir: path.join(dir, 'reviews'),
  });

  let settings = storage.getSettings();
  assert.strictEqual(settings.monitorEnabled, false);
  assert.strictEqual(settings.monitorOnMainClose, false);
  assert.deepStrictEqual(settings.monitorWatchlist, []);

  storage.replaceWatchlist(['600519', '000858']);
  storage.setSettings({ monitorEnabled: true, monitorOnMainClose: true, monitorWatchlist: ['600519', '999999', '000858', '600520'] });
  settings = storage.getSettings();
  assert.strictEqual(settings.monitorEnabled, true);
  assert.strictEqual(settings.monitorOnMainClose, true);
  assert.deepStrictEqual(settings.monitorWatchlist, ['600519', '000858']);

  storage.replaceWatchlist(['600519']);
  assert.deepStrictEqual(storage.getSettings().monitorWatchlist, ['600519']);

  storage.setSettings({ monitorEnabled: 'yes' });
  assert.strictEqual(storage.getSettings().monitorEnabled, false);
  storage.setSettings({ monitorOnMainClose: 'yes' });
  assert.strictEqual(storage.getSettings().monitorOnMainClose, false);

  storage.setSettings({ monitorOpacity: 0 });
  assert.strictEqual(storage.getSettings().monitorOpacity, 0);
  storage.setSettings({ monitorOpacity: 135 });
  assert.strictEqual(storage.getSettings().monitorOpacity, 100);

  storage.saveReviewSnapshot('2026-08-28', { date: '2026-08-28', meta: { trade_date: '2026-08-28' }, temperature: { score: 52 } });
  storage.saveDragonSnapshot('2026-08-28', { date: '2026-08-28', list: [{ code: '600519' }] });
  storage.saveDragonSnapshot('2026-08-27', { date: '2026-08-27', list: [] });
  assert.deepStrictEqual(storage.getDragonSnapshot('2026-08-28').list, [{ code: '600519' }]);
  assert.deepStrictEqual(storage.getHistoryEntries().map(item => [item.date, Boolean(item.review), Boolean(item.dragon)]), [
    ['2026-08-28', true, true],
    ['2026-08-27', false, true],
  ]);

  storage.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('storage monitor tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
