// theme.js 自检：非法 code 不联网；正常 code 正确解析东财 slist diff（fetch 桩，不联网）。
const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-theme-'));
process.env.VOLUME_INSIGHT_DATA_DIR = TMP;

const theme = require('../theme');

(async () => {
  const bad = await theme.fetchConceptBlocks('abc');
  assert.strictEqual(bad.total, 0, '非法 code 应返回空结构');
  assert.deepStrictEqual(bad.boards, []);
  assert.deepStrictEqual(bad.conceptTags, []);

  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    assert.ok(String(url).includes('push2.eastmoney.com/api/qt/slist/get'), '应请求东财 slist');
    assert.ok(String(url).includes('secid=1.600519'), '沪市 600519 应映射为 1.600519');
    return {
      ok: true,
      json: async () => ({
        data: {
          diff: [
            { f12: 'BK0475', f14: '白酒', f3: 1.2, f128: '贵州茅台' },
            { f12: 'BK0421', f14: '食品饮料', f3: -0.5, f128: '' },
          ],
        },
      }),
    };
  };

  try {
    const good = await theme.fetchConceptBlocks('600519');
    assert.strictEqual(good.total, 2, '应解析出两个板块');
    assert.strictEqual(good.boards[0].name, '白酒');
    assert.strictEqual(good.boards[0].code, 'BK0475');
    assert.strictEqual(good.boards[0].changePct, 1.2);
    assert.strictEqual(good.boards[0].leadStock, '贵州茅台');
    assert.deepStrictEqual(good.conceptTags, ['白酒', '食品饮料']);
  } finally {
    global.fetch = originalFetch;
  }

  console.log('theme ok');
})().catch((e) => { console.error(e); process.exit(1); });
