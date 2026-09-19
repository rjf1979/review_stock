// rsi_low_turn v4 接入验收（对 127.0.0.1:3110 上的当前版本服务发请求，只读）
// 用法：先 `npm start`（或 node server.js），再执行
//   node tools/verify_rsi_low_turn_integration.js [真实命中代码] [信号日]
// 默认取本地 K 线库里真实出现过的 v4 信号：截到信号日为止的 K 线，
// POST /api/kline/patterns，确认服务端确实判出 rsi_low_turn 并透传 v4 参数。
// 样本说明：2026-09-18 把 rsi_low_turn 的 low 由 20 收紧到 18 后，原样本
// 002131@2026-07-09 的前值 RSI 为 19.99，按新口径本就不该命中（正是收紧的预期效果），
// 故改用 low=18 下的真实命中样本 600418@2026-07-09（前值 RSI 16.4→29.7，60 日 -47.7%）。
const assert = require('assert');
const { readKline } = require('../storage');

const BASE = process.env.SENTINEL_BASE || 'http://127.0.0.1:3110';
const CODE = process.argv[2] || '600418';
const SIGNAL_DATE = process.argv[3] || '2026-07-09';

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

async function main() {
  const health = await getJson('/api/health');
  assert.strictEqual(health.ok, true, '服务应健康');
  console.log('健康检查 ok');

  const patterns = await getJson('/api/patterns');
  assert.ok(patterns.patterns.includes('rsi_low_turn'), '形态清单应包含 rsi_low_turn');
  console.log('形态清单 ok：' + patterns.patterns.length + ' 个形态，含 rsi_low_turn');

  const rules = await getJson('/api/rules');
  const enabled = rules.rules.filter((r) => r.enabled);
  assert.deepStrictEqual(enabled.map((r) => r.id), ['limit_pullback', 'rsi_low_turn'], '默认应启用两条 v4 形态，实际 ' + enabled.map((r) => r.id).join(','));
  const rule = enabled.find((r) => r.id === 'rsi_low_turn');
  assert.deepStrictEqual(rule.params, { period: 14, low: 18, drop_days: 60, drop_max: -30 }, 'v4 参数应与回测口径一致（low 已于 2026-09-18 收紧到 18）');
  assert.strictEqual(rule.minVolumeScore, 0, 'v4 规则级量能分门槛应为 0');
  console.log('规则库 ok：共 ' + rules.rules.length + ' 条，启用 ' + enabled.map((r) => r.id).join(',') + '，量能分门槛 ' + rule.minVolumeScore);

  const rec = await readKline(CODE);
  const all = rec && Array.isArray(rec.kline) ? rec.kline : [];
  assert.ok(all.length, CODE + ' 应有本地 K 线');
  const cut = all.findIndex((c) => String(c.date) === SIGNAL_DATE);
  assert.ok(cut > 60, CODE + ' 应包含信号日 ' + SIGNAL_DATE);
  const candles = all.slice(0, cut + 1);
  const hit = await postJson('/api/kline/patterns', { code: CODE, kline: candles });
  const v4 = (hit.hits || []).find((h) => h.patternId === 'rsi_low_turn');
  assert.ok(v4, '服务端应判出 rsi_low_turn（' + CODE + ' ' + SIGNAL_DATE + '），实际 ' + JSON.stringify((hit.hits || []).map((h) => h.patternId)));
  console.log('服务端形态判定 ok：' + CODE + ' ' + SIGNAL_DATE + ' → ' + v4.reason);
  console.log('  形态参数透传：' + JSON.stringify(v4.params));

  const levels = await postJson('/api/kline/levels', { code: CODE });
  assert.strictEqual(levels.ok, true, '价位接口应返回 ok');
  assert.ok(levels.levels, '价位接口应返回价位集');
  const inv = levels.levels.invalidationLevel || {};
  const rr = levels.levels.riskReward || {};
  console.log('价位接口 ok：' + CODE + ' 失效位 ' + inv.value + '，观察空间比 ' + rr.value);

  console.log('rsi_low_turn v4 接入验收通过');
}

main().catch((e) => { console.error('验收失败：' + e.message); process.exit(1); });
