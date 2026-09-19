// limit_pullback v4 接入验收（对 127.0.0.1:3110 上的当前版本服务发请求，只读）
// 用法：先 `npm start`（或直接打开智诊盯盘桌面版），再执行
//   node tools/verify_limit_pullback_integration.js [代码] [信号日]
// 不带参数时，从本地 K 线库自动找最近一笔真实命中作为样本，再截到信号日发给服务端确认。
const assert = require('assert');
const { listKlineDates, readKline } = require('../storage');
const { matchKlinePattern } = require('../screener-core');
const { benchLookupSync } = require('../bench-series');

const BASE = process.env.SENTINEL_BASE || 'http://127.0.0.1:3110';
const LOOKBACK = 120; // 自动找样本时的回看交易日数

async function getJson(path) {
  const res = await fetch(BASE + path);
  assert.ok(res.ok, path + ' 应返回 2xx，实际 ' + res.status);
  return res.json();
}
async function postJson(path, body) {
  const res = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.ok(res.ok, path + ' 应返回 2xx，实际 ' + res.status);
  return res.json();
}

// 本地找样本：走生产同一入口 matchKlinePattern，参数用服务端返回的规则配置，不复制阈值。
async function findLatestHit(params) {
  const codes = await listKlineDates();
  const bench = benchLookupSync();
  assert.ok(bench, '本地应有沪深300 基准序列（data/bench-sh000300.json 或通达信兜底）');
  let best = null;
  for (const code of codes) {
    const rec = await readKline(code);
    const candles = rec && Array.isArray(rec.kline) ? rec.kline : [];
    if (candles.length < 61) continue;
    for (let i = candles.length - 1; i >= Math.max(1, candles.length - LOOKBACK); i--) {
      const res = matchKlinePattern('limit_pullback', candles.slice(0, i + 1), { ...params, code, benchLookup: bench });
      if (!res.matched) continue;
      const date = String(candles[i].date);
      if (!best || date > best.date) best = { code, date, reason: res.reason, score: res.score };
      break;
    }
  }
  return best;
}

async function main() {
  const health = await getJson('/api/health');
  assert.strictEqual(health.ok, true, '服务应健康');
  console.log('健康检查 ok');

  const patterns = await getJson('/api/patterns');
  assert.ok(patterns.patterns.includes('limit_pullback'), '形态清单应包含 limit_pullback');
  console.log('形态清单 ok：' + patterns.patterns.length + ' 个形态，含 limit_pullback');

  const rules = await getJson('/api/rules');
  const enabled = rules.rules.filter((r) => r.enabled);
  assert.deepStrictEqual(enabled.map((r) => r.id), ['limit_pullback', 'rsi_low_turn'], '应同时启用 limit_pullback 与 rsi_low_turn，实际 ' + enabled.map((r) => r.id).join(','));
  const rule = enabled.find((r) => r.id === 'limit_pullback');
  assert.deepStrictEqual(
    rule.params,
    { window: 15, vol_shrink: 0.9, drop_days: 60, drop_max: -30, rs_days: 20, rs_max: -5 },
    'limit_pullback v4 参数应与回测口径一致'
  );
  assert.strictEqual(rule.minVolumeScore, 0, 'limit_pullback 规则级量能分门槛应为 0');
  console.log('规则库 ok：共 ' + rules.rules.length + ' 条，启用 ' + enabled.map((r) => r.id).join(',') + '，量能分门槛 ' + rule.minVolumeScore);

  const code = process.argv[2];
  const signalDate = process.argv[3];
  const sample = code && signalDate ? { code, date: signalDate } : await findLatestHit(rule.params);
  assert.ok(sample, '本地 K 线库中应能找到一笔 limit_pullback v4 命中样本');
  console.log('样本：' + sample.code + ' ' + sample.date + (sample.reason ? ' → ' + sample.reason : ''));

  const rec = await readKline(sample.code);
  const all = rec && Array.isArray(rec.kline) ? rec.kline : [];
  const cut = all.findIndex((c) => String(c.date) === sample.date);
  assert.ok(cut > 60, sample.code + ' 应包含信号日 ' + sample.date);
  const candles = all.slice(0, cut + 1);
  const hit = await postJson('/api/kline/patterns', { code: sample.code, kline: candles });
  const v4 = (hit.hits || []).find((h) => h.patternId === 'limit_pullback');
  assert.ok(v4, '服务端应判出 limit_pullback（' + sample.code + ' ' + sample.date + '），实际 ' + JSON.stringify((hit.hits || []).map((h) => h.patternId)));
  assert.ok(String(v4.reason).includes('相对沪深300'), '命中理由应带上相对强度证据');
  assert.deepStrictEqual(v4.params, rule.params, '判定应透传规则参数');
  console.log('服务端形态判定 ok：' + sample.code + ' ' + sample.date + ' → ' + v4.reason);

  const levels = await postJson('/api/kline/levels', { code: sample.code, kline: candles });
  assert.strictEqual(levels.ok, true, '价位接口应返回 ok');
  const plan = levels.levels || {};
  assert.strictEqual(plan.patternExitVersion, 'limit-pullback-v4', '命中 limit_pullback 时价位应改用 v4 退出口径，实际 ' + plan.patternExitVersion);
  assert.strictEqual(plan.riskReward.value, 6, '观察空间比应为 6R 跟踪启动线口径');
  console.log('价位接口 ok：' + sample.code + ' 失效位 ' + plan.invalidationLevel.value + '（风险 ' + plan.invalidationLevel.riskPct + '%），跟踪启动 ' + plan.takeProfit[0].value);

  console.log('limit_pullback v4 接入验收通过');
}

main().catch((e) => { console.error('验收失败：' + e.message); process.exit(1); });
