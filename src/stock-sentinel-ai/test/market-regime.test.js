const assert = require('assert');
const { summarizeSnapshot, classifyMarketRegime, strategyForRegime, riskFlagsForCandidate } = require('../market-regime');

function snapshot({ up = 600, down = 300, strong = 40, weak = 5 } = {}) {
  const rows = [];
  for (let i = 0; i < 1000; i++) {
    let changePct = 0;
    if (i < strong) changePct = 5.5;
    else if (i < strong + up) changePct = 1;
    else if (i < strong + up + weak) changePct = -5.5;
    else if (i < strong + up + weak + down) changePct = -1;
    rows.push({ code: String(600000 + i), price: 10, changePct, amount: 1e8 });
  }
  return rows;
}

const trend = classifyMarketRegime({ breadth: summarizeSnapshot(snapshot({ up: 680, down: 250, strong: 50 })), indices: [{ changePct: 0.8 }], asOf: '2026-09-05' });
assert.strictEqual(trend.status, 'strong_trend');
assert.strictEqual(trend.confidence, 'partial');
const weak = classifyMarketRegime({ breadth: summarizeSnapshot(snapshot({ up: 220, down: 680, strong: 3, weak: 45 })), indices: [{ changePct: -1.8 }], asOf: '2026-09-05' });
assert.strictEqual(weak.status, 'weak');
const fragile = classifyMarketRegime({
  breadth: summarizeSnapshot(snapshot({ up: 590, down: 300, strong: 35 })),
  indices: [{ changePct: 0.2 }],
  limitStructure: { available: true, limitUpCount: 35, limitDownCount: 24, brokenCount: 30, sealRate: 0.54, maxBoardHeight: 2, heightDistribution: { 1: 35 }, quality: { complete: true } },
});
assert.strictEqual(fragile.status, 'weak', '跌停扩散且封板率低时应判为弱势退潮');
assert.strictEqual(fragile.confidence, 'confirmed');
const unavailable = classifyMarketRegime({ breadth: summarizeSnapshot(snapshot().slice(0, 999)) });
assert.strictEqual(unavailable.confidence, 'unavailable');
assert.ok(unavailable.fallback);

const strategy = strategyForRegime('recovery', [{ id: 'double_bottom', enabled: true }, { id: 'platform_breakout', enabled: true }]);
assert.deepStrictEqual(strategy.enabledRuleIds, ['double_bottom']);
const flags = riskFlagsForCandidate({ changePct: 8.2, mainNetYi: -0.2, volumeRatio: 0.8 });
assert.strictEqual(flags.length, 3);
assert.ok(riskFlagsForCandidate({ changePct: 1, mainNetYi: 0.2, volumeRatio: 1.2 }, { marketStatus: 'weak' }).some((x) => x.key === 'weak_market'));
console.log('market-regime.test 通过');
