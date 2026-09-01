'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { enrichReviewWithPreviousTurnover } = require('./server');

function reviewPayload({ turnoverYi, previousTurnoverYi = null, otherMissing = false }) {
  return {
    date: '2026-09-01',
    breadth: {
      turnoverYi,
      previousTurnoverYi,
      status: 'ready',
    },
    quality: {
      status: otherMissing ? 'partial' : 'partial',
      confidence: otherMissing ? 'medium' : 'medium',
      missingFields: [
        'breadth.previous_turnover_yuan',
        'breadth.turnover_change_rate',
        ...(otherMissing ? ['sentiment.promotion_rate'] : []),
      ],
    },
  };
}

test('复盘读取时回补最近交易日成交额并更新数据核对', async () => {
  const payload = reviewPayload({ turnoverYi: 13491.71 });
  const enriched = await enrichReviewWithPreviousTurnover(payload, async () => ({
    date: '2026-08-31',
    breadth: { turnoverYi: 13109.69 },
  }));

  assert.equal(enriched.breadth.previousTurnoverYi, 13109.69);
  assert.equal(enriched.breadth.previousTurnoverDate, '2026-08-31');
  assert.ok(Math.abs(enriched.breadth.turnoverChangeRate - 2.914) < 0.001);
  assert.deepEqual(enriched.quality.missingFields, []);
  assert.equal(enriched.quality.status, 'ok');
  assert.equal(enriched.quality.confidence, 'high');
  assert.notEqual(enriched, payload);
});

test('复盘读取时跳过缺失的上一交易日并最终回补', async () => {
  const payload = reviewPayload({ turnoverYi: 13491.71 });
  const missingDays = new Set(['2026-08-31', '2026-08-28']);
  const enriched = await enrichReviewWithPreviousTurnover(payload, async (date) => {
    if (missingDays.has(date)) return null;
    return { date, breadth: { turnoverYi: 12000 } };
  });

  assert.equal(enriched.breadth.previousTurnoverDate, '2026-08-27');
  assert.equal(enriched.breadth.previousTurnoverYi, 12000);
});

test('无昨日复盘时保留原缺失标记', async () => {
  const payload = reviewPayload({ turnoverYi: 13491.71 });
  const enriched = await enrichReviewWithPreviousTurnover(payload, async () => null);

  assert.equal(enriched.breadth.previousTurnoverYi, null);
  assert.deepEqual(enriched.quality.missingFields, [
    'breadth.previous_turnover_yuan',
    'breadth.turnover_change_rate',
  ]);
});

test('已有昨日成交额时不重复覆盖', async () => {
  const payload = reviewPayload({ turnoverYi: 13491.71, previousTurnoverYi: 12000 });
  const enriched = await enrichReviewWithPreviousTurnover(payload, async () => ({
    breadth: { turnoverYi: 999 },
  }));

  assert.equal(enriched.breadth.previousTurnoverYi, 12000);
});
