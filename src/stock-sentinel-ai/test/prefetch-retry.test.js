// 量能洞察 · 预取失败重试队列 单测（不联网，桩控制腾讯/东财响应）
// 覆盖两条路径：
//   1) 主循环失败 → 入队 → 重试队列恢复成功（fetched 补回，errors=0）
//   2) 持续失败 → 重试超限 → 记错（errors=1，queued=0，未重复计数）
const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-prefetch-retry-'));
process.env.VOLUME_INSIGHT_DATA_DIR = TMP;

const storage = require('../storage');
const { todayStr } = require('../data');
const { runPrefetch } = require('../prefetch');
const { uniqueDates } = require('./helpers');

const TODAY = todayStr();
const KEY = 'sh_main';

storage.writeSnapshot(TODAY, KEY, [
  { code: '600010', name: 'A', price: 10, changePct: 1, amount: 1e8, turnover: 2, volumeRatio: 1, totalMcap: 1e9, floatMcap: 1e9, mainNet: 0, market: 'sh_main' },
  { code: '600011', name: 'B', price: 11, changePct: 2, amount: 2e8, turnover: 3, volumeRatio: 1.2, totalMcap: 2e9, floatMcap: 2e9, mainNet: 0, market: 'sh_main' },
  { code: '600020', name: 'C', price: 12, changePct: 3, amount: 3e8, turnover: 4, volumeRatio: 1.4, totalMcap: 3e9, floatMcap: 3e9, mainNet: 0, market: 'sh_main' },
  { code: '600021', name: 'D', price: 13, changePct: 4, amount: 4e8, turnover: 5, volumeRatio: 1.6, totalMcap: 4e9, floatMcap: 4e9, mainNet: 0, market: 'sh_main' },
]);

function mkDay(len) {
  return uniqueDates(len).map((date, i) => [
    date,
    10 + i * 0.1, 10 + i * 0.1, 10.5 + i * 0.1, 9.8 + i * 0.1, 1000 + i * 10,
  ]);
}

function mkCsv(len) {
  return uniqueDates(len).map((date, i) =>
    `${date},${10 + i * 0.1},${10 + i * 0.1},${10.5 + i * 0.1},${9.8 + i * 0.1},${1000 + i * 10},0,0,0,0,0`);
}

function codeFromUrl(u) {
  if (u.includes('/appstock/app/fqkline/get')) return /param=(?:sh|sz|bj)(\d{6})/.exec(u)[1];
  if (u.includes('push2his.eastmoney.com')) return /secid=(?:1|0)\.(\d{6})/.exec(u)[1];
  return null;
}

// emptyUntil[code] = 前 N 次全局请求返回空（模拟限流/断连），之后返回真实数据。
function installFetch(emptyUntil) {
  const calls = {};
  global.fetch = async (url) => {
    const u = String(url);
    const code = codeFromUrl(u);
    if (!code) throw new Error('不应请求其他地址：' + u);
    calls[code] = (calls[code] || 0) + 1;
    const empty = emptyUntil[code] && calls[code] <= emptyUntil[code];
    if (u.includes('/appstock/app/fqkline/get')) {
      if (empty) return { ok: true, json: async () => ({ data: { [`sh${code}`]: {} } }) };
      return { ok: true, json: async () => ({ data: { [`sh${code}`]: { qfqday: mkDay(30) } } }) };
    }
    if (empty) return { ok: true, json: async () => ({ data: null }) };
    return { ok: true, json: async () => ({ data: { code, klines: mkCsv(30) } }) };
  };
}

(async () => {
  // 路径1：600010 前 6 次全局请求空（主循环 3 次尝试 × 腾讯+东财兜底 = 6 次），第 7 次起成功。
  installFetch({ '600010': 6 });
  let st = await runPrefetch({ markets: [KEY], lmt: 120, fresh: false, gapMs: 0 });
  assert.strictEqual(st.total, 4);
  assert.strictEqual(st.fetched, 4, '所有股票最终都应成功（含重试队列恢复的 600010）');
  assert.strictEqual(st.errors, 0, '恢复后不应记错');
  assert.strictEqual(st.queued, 0, '重试队列应清空');
  assert.ok(await storage.readKline('600010'), '600010 应成功落盘');
  assert.strictEqual((await storage.readKline('600010')).kline.length, 30);
  assert.ok(await storage.readKline('600011'), '600011 应成功落盘');

  // 路径2：600020 永远返回空（主循环 + 后续 3 轮重试都空），应只计一次错误。
  // 先清掉路径1落盘的 K 线缓存，否则 600020 会命中缓存被跳过。
  await storage.clearKlines();
  installFetch({ '600020': Number.POSITIVE_INFINITY });
  st = await runPrefetch({ markets: [KEY], lmt: 120, fresh: false, gapMs: 0 });
  assert.strictEqual(st.errors, 1, '600020 重试超限应记 1 个错误');
  assert.strictEqual(st.queued, 0, '放弃后重试队列应清空');
  assert.strictEqual(st.fetched, 3, '600021 及其余股票成功（600020 失败）');
  const k600020 = await storage.readKline('600020');
  assert.ok(!(k600020 && k600020.kline && k600020.kline.length), '600020 不应落盘有效 K 线');
  const failEntries = st.errorsList.filter((e) => e.code === '600020');
  assert.strictEqual(failEntries.length, 1, '同一个失败码不应重复计入 errorsList');

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('prefetch-retry.test 通过');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
