// 量能洞察 · 全市场 K 线预取 单测（验证断点续传/跳过已有缓存，不联网真实接口）
const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-prefetch-'));
process.env.VOLUME_INSIGHT_DATA_DIR = TMP;

const storage = require('../storage');
const { todayStr } = require('../data');
const { runPrefetch } = require('../prefetch');
const { uniqueDates } = require('./helpers');

const TODAY = todayStr();
const KEY = 'sh_main';
// 用 120 根模拟「旧缓存不足目标天数」：深度感知下会被重新补足，而非当作已缓存跳过。
const DATES120 = uniqueDates(120);

// 今日快照（两只有价股票）
storage.writeSnapshot(TODAY, KEY, [
  { code: '600001', name: '沪A', price: 10, changePct: 2, amount: 1e8, turnover: 3, volumeRatio: 1.2, totalMcap: 5e9, floatMcap: 4e9, mainNet: 1e6, market: 'sh_main' },
  { code: '600002', name: '沪B', price: 11, changePct: -1, amount: 2e8, turnover: 4, volumeRatio: 1.4, totalMcap: 6e9, floatMcap: 5e9, mainNet: -5e5, market: 'sh_main' },
]);

function tencentResp(secid) {
  return {
    data: {
      [secid]: {
        qfqday: DATES120.map((date, i) => [
          date,
          10 + i * 0.1, 10 + i * 0.1, 10.5 + i * 0.1, 9.8 + i * 0.1, 1000 + i * 10,
        ]),
      },
    },
  };
}

let fetchCalls = [];
global.fetch = async (url) => {
  fetchCalls.push(String(url));
  const u = String(url);
  if (u.includes('/appstock/app/fqkline/get')) {
    const secid = /param=(sh|sz|bj)(\d{6})/.exec(u).slice(1).join('');
    return { ok: true, json: async () => tencentResp(secid) };
  }
  throw new Error('不应发起其他请求：' + u);
};

(async () => {
  // ── 断点续传：已有缓存（600001）跳过，缺的 600002 拉取 ──
  await storage.writeKline('600001', DATES120.map((date) => ({ date, open: 1, close: 1, high: 1, low: 1, volume: 1 })), TODAY);
  let st = await runPrefetch({ markets: [KEY], lmt: 120, fresh: false, gapMs: 0 });
  assert.strictEqual(st.total, 2);
  assert.strictEqual(st.skipped, 1, '已有缓存应跳过');
  assert.strictEqual(st.fetched, 1, '缺的应拉取');
  assert.strictEqual(st.errors, 0);
  assert.ok(await storage.readKline('600002'), '600002 应成功落盘');
  assert.strictEqual((await storage.readKline('600002')).kline.length, 120);
  assert.strictEqual(fetchCalls.length, 1, '只应请求一次 K 线');

  // ── fresh：把 600001 缓存改成昨日 → 两根都会重新拉取 ──
  await storage.writeKline('600001', DATES120.map((date) => ({ date, open: 1, close: 1, high: 1, low: 1, volume: 1 })), '2026-09-02');
  fetchCalls = [];
  st = await runPrefetch({ markets: [KEY], lmt: 120, fresh: true, gapMs: 0 });
  assert.strictEqual(st.fetched, 1, '昨日缓存应重新拉取');
  assert.strictEqual(st.skipped, 1, '今日已缓存应跳过');
  assert.strictEqual((await storage.readKline('600001')).date, TODAY, '600001 被刷新为今日');
  assert.strictEqual((await storage.readKline('600001')).kline.length, 120);
  assert.ok(fetchCalls.length >= 1, '至少请求 1 次 K 线（刷新陈旧缓存）');

  // ── 深度感知：仅 30 日旧缓存（不足 lmt）→ 不跳过，应重新拉取补足到目标天数 ──
  await storage.clearKlines(); // 清空旧行，避免 writeKline 只覆盖部分日期导致长度仍为 120
  await storage.writeKline('600001', uniqueDates(30).map((date) => ({ date, open: 1, close: 1, high: 1, low: 1, volume: 1 })), '2026-09-02');
  await storage.writeKline('600002', DATES120.map((date) => ({ date, open: 1, close: 1, high: 1, low: 1, volume: 1 })), '2026-09-02');
  fetchCalls = [];
  st = await runPrefetch({ markets: [KEY], lmt: 120, fresh: false, gapMs: 0 });
  assert.strictEqual(st.fetched, 1, '不足目标天数的旧缓存应重新拉取');
  assert.strictEqual(st.skipped, 1, '600002 已有 120 日缓存应跳过');
  assert.strictEqual((await storage.readKline('600001')).kline.length, 120, '应补足到目标天数');
  assert.ok(fetchCalls.length >= 1, '至少请求 1 次 K 线（补足旧缓存）');

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('prefetch.test 通过');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
