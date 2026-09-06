// 量能洞察 · 本地存储 + dataSource 复用 单测（验证「先落地后筛选」，按市场分别落盘，不污染真实数据）。
const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

// 必须在 require storage/data 之前设置数据目录，指向临时目录。
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-data-'));
process.env.VOLUME_INSIGHT_DATA_DIR = TMP;

const storage = require('../storage');
const { todayStr, fetchMarketSnapshot, fetchKline } = require('../data');
const { uniqueDates } = require('./helpers');

const TODAY = todayStr();
const KEY_SH = 'sh_main';
const KEY_CY = 'chuangye';
const KEY_KC = 'kechuang';

function rec(code, name) {
  return {
    code, name, market: code.startsWith('6') ? 'sh_main' : 'chuangye',
    price: 10, changePct: 3.2, amount: 2.1e9, turnover: 4.5, volumeRatio: 2.1,
    totalMcap: 8e9, floatMcap: 6e9, mainNet: 1.2e8,
  };
}

const recsSh = [rec('600001', '沪样例1'), rec('600002', '沪样例2')];
const recsCy = [rec('300001', '创样例1')];

// ── 逐市场写入今日本地快照 ──
assert.ok(storage.writeSnapshot(TODAY, KEY_SH, recsSh), 'writeSnapshot(sh_main) 应成功');
assert.ok(storage.writeSnapshot(TODAY, KEY_CY, recsCy), 'writeSnapshot(chuangye) 应成功');
assert.strictEqual(storage.readSnapshot(TODAY, KEY_SH).records.length, 2);
assert.strictEqual(storage.readSnapshot(TODAY, KEY_CY).records.length, 1);
assert.strictEqual(storage.readSnapshot(TODAY, KEY_KC), null, 'kechuang 当日应无快照');
assert.ok(storage.readLatestSnapshot(KEY_SH), 'readLatestSnapshot 应命中');
assert.ok(storage.listSnapshotDates().includes(TODAY), 'listSnapshotDates 应包含今日');

// ── 联网打点（东财 clist 分页桩）──
let networkHit = 0;
function makeClist(code) {
  return {
    data: {
      total: 1,
      diff: [{ f12: code, f14: '实时补拉' + code, f2: 12, f3: 1.5, f6: 3.2e8, f8: 2.1, f10: 1.4, f20: 6e9, f21: 5e9, f62: 8e5 }],
    },
  };
}
global.fetch = async (url) => {
  networkHit += 1;
  await new Promise((r) => setTimeout(r, 5)); // 模拟网络延迟，使耗时可测
  const u = String(url);
  if (u.includes('clist')) {
    const data = makeClist('300999');
    return { ok: true, json: async () => data };
  }
  throw new Error('不应发起网络请求：' + u);
};

(async () => {
  // ── local：单市场，纯本地，不联网 ──
  const localSh = await fetchMarketSnapshot({ markets: [KEY_SH], dataSource: 'local', limit: Number.POSITIVE_INFINITY });
  assert.strictEqual(localSh.dataSource, 'local');
  assert.strictEqual(localSh.snapshotDate, TODAY);
  assert.strictEqual(localSh.records.length, 2);
  assert.strictEqual(networkHit, 0, 'local 单市场已命中不应联网');
  assert.strictEqual(localSh.byMarket.length, 1);
  assert.strictEqual(localSh.byMarket[0].key, KEY_SH);
  assert.strictEqual(localSh.byMarket[0].source, 'local');
  assert.strictEqual(localSh.byMarket[0].count, 2);

  // ── local：多市场全部命中，纯本地不联网，byMarket 逐市场标 local ──
  const localAll = await fetchMarketSnapshot({ markets: [KEY_SH, KEY_CY], dataSource: 'local', limit: Number.POSITIVE_INFINITY });
  assert.strictEqual(localAll.records.length, 3);
  assert.strictEqual(networkHit, 0, 'local 多市场全部命中不应联网');
  assert.deepStrictEqual(localAll.byMarket.map((m) => [m.key, m.source]), [[KEY_SH, 'local'], [KEY_CY, 'local']]);

  // ── last：最近一次，纯本地不联网 ──
  const lastSh = await fetchMarketSnapshot({ markets: [KEY_SH], dataSource: 'last' });
  assert.strictEqual(lastSh.dataSource, 'last');
  assert.strictEqual(lastSh.records.length, 2);
  assert.strictEqual(networkHit, 0, 'last 命中最近快照不应联网');

  // ── local：部分市场缺失 → 只对缺失市场实时补拉并落盘，byMarket 如实标 live ──
  const networkBefore = networkHit;
  const partial = await fetchMarketSnapshot({ markets: [KEY_SH, KEY_KC], dataSource: 'local', limit: Number.POSITIVE_INFINITY });
  assert.ok(networkHit > networkBefore, '缺失市场应实时补拉');
  assert.ok(partial.ms > 0, '部分补拉应累加耗时，不能误标为 0');
  assert.strictEqual(partial.records.length, 3, '沪 2 只 + 补拉 1 只');
  const byMap = Object.fromEntries(partial.byMarket.map((m) => [m.key, m.source]));
  assert.strictEqual(byMap[KEY_SH], 'local', '已命中市场保持 local');
  assert.strictEqual(byMap[KEY_KC], 'live', '缺失市场标 live');
  assert.ok(storage.readSnapshot(TODAY, KEY_KC), '补拉市场应落盘今日快照');

  // ── K线缓存：local 用当日缓存，不联网 ──
  const klineDates = uniqueDates(30);
  const kline = klineDates.map((date, i) => ({ date, open: 10 + i * 0.1, close: 10 + i * 0.1, high: 10.5 + i * 0.1, low: 9.8 + i * 0.1, volume: 1000 }));
  assert.ok(await storage.writeKline('600001', kline, TODAY));
  const netForKline = networkHit;
  const cached = await fetchKline('600001', { dataSource: 'local' });
  assert.strictEqual(cached.length, 30);
  assert.strictEqual(networkHit, netForKline, 'local K线应命中当日缓存，不联网');

  // ── last：minDate 不晚于缓存日期即可用缓存 ──
  const netForLastKline = networkHit;
  const lastKline = await fetchKline('600001', { dataSource: 'last', minDate: TODAY });
  assert.strictEqual(lastKline.length, 30);
  assert.strictEqual(networkHit, netForLastKline, 'last K线应命中满足 minDate 的缓存');

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('storage-local.test 通过');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
