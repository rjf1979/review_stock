// 扫描偏好接口加固回归（GET 可读回 + 空 body 不得清空自选市场）：
//   1) 未保存过时 GET 回落到默认市场与 500，且 saved=false；
//   2) POST 正常写入（去重、去空、股数生效）；
//   3) POST 空 body / 完全无 body → 400，且库内市场保持原值；
//   4) POST 只带 scanLimit → 市场沿用已保存值，不被清空；
//   5) POST 非法字段（scanMarkets 非数组、scanLimit 非数字、显式空数组）→ 400；
//   6) GET 读回与库内一致。
// 用例只起临时端口的真实 server 实例，数据目录指向临时目录，不触碰真实 data/。
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-scan-pref-api-'));
process.env.VOLUME_INSIGHT_DATA_DIR = TMP;
process.env.VOLUME_INSIGHT_KLINE_DB = path.join(TMP, 'kline.db');
process.env.SENTINEL_BACKTEST_DB = path.join(TMP, 'backtest.db');

const { createServer } = require('../server');
const storage = require('../storage');

const DEFAULT_MARKETS = ['sh_main', 'sz_main', 'chuangye', 'kechuang', 'beijiao'];

async function call(base, urlPath, options = {}) {
  const res = await fetch(`${base}${urlPath}`, options);
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

function postJson(base, payload) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return call(base, '/api/settings/scan-preferences', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  });
}

(async () => {
  const server = createServer(3110);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const empty = await call(base, '/api/settings/scan-preferences');
    assert.strictEqual(empty.status, 200);
    assert.strictEqual(empty.body.ok, true);
    assert.strictEqual(empty.body.saved, false, '未保存过时 saved 应为 false');
    assert.deepStrictEqual(empty.body.scanPreferences.markets, DEFAULT_MARKETS);
    assert.strictEqual(empty.body.scanPreferences.scanLimit, 500);

    const saved = await postJson(base, { scanMarkets: ['sh_main', 'sz_main', 'sz_main', ''], scanLimit: 88 });
    assert.strictEqual(saved.status, 200);
    assert.deepStrictEqual(saved.body.scanPreferences.markets, ['sh_main', 'sz_main']);
    assert.strictEqual(saved.body.scanPreferences.scanLimit, 88);

    const blank = await postJson(base, {});
    assert.strictEqual(blank.status, 400, '空 body 应返回 400');
    assert.strictEqual(blank.body.ok, false);
    assert.ok(String(blank.body.error).includes('scanMarkets'), '错误信息应指明缺失字段');

    const noBody = await call(base, '/api/settings/scan-preferences', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
    });
    assert.strictEqual(noBody.status, 400, '完全没有请求体也应返回 400');

    const afterBlank = await storage.getScanPreferences();
    assert.deepStrictEqual(afterBlank.markets, ['sh_main', 'sz_main'], '空 body 后自选市场必须保持原值');
    assert.strictEqual(afterBlank.scanLimit, 88, '空 body 后扫描股数必须保持原值');

    const limitOnly = await postJson(base, { scanLimit: 120 });
    assert.strictEqual(limitOnly.status, 200);
    assert.deepStrictEqual(limitOnly.body.scanPreferences.markets, ['sh_main', 'sz_main'], '只改股数不得清空市场');
    assert.strictEqual(limitOnly.body.scanPreferences.scanLimit, 120);

    assert.strictEqual((await postJson(base, { scanMarkets: 'sh_main' })).status, 400, 'scanMarkets 非数组应 400');
    assert.strictEqual((await postJson(base, { scanLimit: 'abc' })).status, 400, 'scanLimit 非数字应 400');
    assert.strictEqual((await postJson(base, { scanLimit: null })).status, 400, 'scanLimit 为 null 应 400');
    assert.strictEqual((await postJson(base, { scanMarkets: [] })).status, 400, '显式清空市场应 400');
    assert.strictEqual((await postJson(base, '[]')).status, 400, '数组请求体应 400');

    const afterReject = await storage.getScanPreferences();
    assert.deepStrictEqual(afterReject.markets, ['sh_main', 'sz_main'], '被拒请求不得改动库内市场');
    assert.strictEqual(afterReject.scanLimit, 120, '被拒请求不得改动库内股数');

    const readBack = await call(base, '/api/settings/scan-preferences');
    assert.strictEqual(readBack.status, 200);
    assert.strictEqual(readBack.body.saved, true);
    assert.deepStrictEqual(readBack.body.scanPreferences.markets, ['sh_main', 'sz_main']);
    assert.strictEqual(readBack.body.scanPreferences.scanLimit, 120);

    console.log('scan-preferences-api.test 通过');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(TMP, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
