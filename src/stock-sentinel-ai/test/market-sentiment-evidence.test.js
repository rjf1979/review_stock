const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sentiment-evidence-'));
process.env.VOLUME_INSIGHT_DATA_DIR = temp;
process.env.VOLUME_INSIGHT_KLINE_DB = path.join(temp, 'test.db');

global.fetch = async (url) => {
  const text = String(url);
  const isUp = text.includes('getTopicZTPool');
  const isDown = text.includes('getTopicDTPool');
  const code = isUp ? '600001' : isDown ? '600002' : '600003';
  const payload = {
    rc: 0,
    data: {
      qdate: isUp ? '20260911' : '20260912',
      tc: 1,
      pool: [{ c: code, n: code, zdp: isDown ? -10 : 10, amount: 1, hybk: '样例', lbc: 1 }],
    },
  };
  return { ok: true, json: async () => payload };
};

const { fetchMarketSentiment } = require('../data');

(async () => {
  const result = await fetchMarketSentiment('2026-09-12', { dataSource: 'live' });
  assert.equal(result.tradeDate, '2026-09-12', '记录分区日期保持请求日期，但不得冒充响应日期');
  assert.equal(result.quality.dateVerified, false);
  assert.equal(result.quality.responseDates.limitUp, '2026-09-11');
  assert.match(result.quality.conflicts[0], /响应日期与请求日期冲突/);
  assert.equal(result.sourceEvidence.tradeDate, '2026-09-12');
  assert.match(result.sourceEvidence.sha256, /^[0-9a-f]{64}$/);
  assert.ok(result.sourceEvidence.rawBytes > 0);
  assert.equal(result.sourceEvidence.pools.limitUp.present, true);
  assert.equal(result.sourceEvidence.pools.limitDown.present, true);
  assert.equal(result.sourceEvidence.pools.broken.present, true);
  console.log('market-sentiment-evidence.test 通过');
})().catch((error) => { console.error(error); process.exitCode = 1; });
