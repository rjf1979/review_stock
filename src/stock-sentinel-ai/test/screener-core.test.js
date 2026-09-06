// 量能洞察 · 纯函数单元测试（不联网）
const assert = require('assert');
const { AUTO_POOL_MIN_SCORE, meetsAutoPoolGate, scoreVolume, volumeProfile, listRules, listEnabledRules } = require('../screener-core');

function approx(a, b, tol = 1e-6) {
  assert.ok(Math.abs(a - b) <= tol, `expected ${a} to be ~${b}`);
}

// scoreVolume 量比高、换手活跃、主力净流入为正 → 高分
const hot = scoreVolume({ volumeRatio: 3, turnover: 12, mainNet: 3e8, amount: 2e9, changePct: 4 });
// 量比低、缩量、主力净流出、成交少 → 低分
const cold = scoreVolume({ volumeRatio: 0.4, turnover: 0.5, mainNet: -2e8, amount: 2e7, changePct: -3 });
assert.ok(hot > cold, `hot(${hot}) 应大于 cold(${cold})`);
assert.ok(hot >= 0 && hot <= 100, `hot 应在 0~100，实际 ${hot}`);

// volumeProfile 归一化单位
const raw = { code: '600519', name: '贵州茅台', price: 1500, changePct: 2.5, turnover: 0.6, volumeRatio: 1.2, amount: 8.1e9, mainNet: 5.1e7, floatMcap: 1.8e12 };
const profile = volumeProfile(raw);
approx(profile.amountYi, 81);
approx(profile.mainNetYi, 0.51);
approx(profile.floatMcapYi, 18000);
assert.strictEqual(profile.score, scoreVolume(raw));
// 原始字段缺失时不应把整分变成 NaN
assert.ok(Number.isFinite(scoreVolume({ volumeRatio: 1.2, turnover: 0.6, changePct: 2.5 })));

// 默认规则已剔除“量能活跃”，全部为 K 线形态规则且默认启用
const defaultRules = listRules();
assert.ok(!defaultRules.some((r) => r.id === 'volume_act'), '默认规则不应再包含 volume_act');
assert.ok(defaultRules.length > 0, '应存在默认规则');
assert.ok(defaultRules.every((r) => r.kind === 'kline'), '默认规则应全部为 kline 形态');
assert.ok(defaultRules.every((r) => r.patternId && (r.prefilter && typeof r.prefilter === 'object')), 'kline 规则应带 patternId 与 prefilter');
assert.ok(listEnabledRules().length === defaultRules.length, '默认规则应全部启用');

// 自动入池门槛：70 分压缩全市场候选规模；量能分达标且为有限数才算入池资格。
assert.strictEqual(AUTO_POOL_MIN_SCORE, 70, '初始自动入池量能分门槛应为 70');
assert.strictEqual(meetsAutoPoolGate({ score: 70 }), true, 'score=70 应达到门槛');
assert.strictEqual(meetsAutoPoolGate({ score: 69.9 }), false, 'score<70 不应达到门槛');
assert.strictEqual(meetsAutoPoolGate({ score: 100 }), true, 'score=100 应达到门槛');
assert.strictEqual(meetsAutoPoolGate({}), false, '缺失 score 不应达到门槛');
assert.strictEqual(meetsAutoPoolGate(null), false, '空档案不应达到门槛');
assert.strictEqual(meetsAutoPoolGate({ score: 'NaN' }), false, 'NaN score 不应达到门槛');

console.log('screener-core.test 通过');
