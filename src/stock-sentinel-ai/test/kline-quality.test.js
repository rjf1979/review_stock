const assert = require('node:assert/strict');
const { assessKlineCoverage } = require('../kline-quality');

const bars = Array.from({ length: 250 }, (_, i) => ({
  date: `2026-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
  open: 1, high: 2, low: 1, close: 2, volume: 100,
}));
const dates = bars.slice(-5).map((x) => x.date);
assert.equal(assessKlineCoverage(bars, { target: 250, expectedDates: dates, expectedLatestDate: dates.at(-1) }).status, 'complete');
assert.equal(assessKlineCoverage(bars.slice(-60), { target: 250, strategyMin: 60, expectedLatestDate: dates.at(-1) }).status, 'strategy_ready');
assert.equal(assessKlineCoverage(bars.slice(-10), { target: 250, strategyMin: 60 }).status, 'incomplete');
assert.equal(assessKlineCoverage([], { target: 250 }).status, 'failed');
console.log('kline-quality.test 通过');
assert.equal(assessKlineCoverage(Array(250).fill(bars[0])).strategyReady, false);
assert.equal(assessKlineCoverage([...bars, { ...bars[0], close: null }]).complete, false);
assert.equal(assessKlineCoverage(bars, { expectedLatestDate: dates[0] }).strategyReady, false, '未来日期不能代替目标日期');
const invalidOhlc = bars.map((bar) => ({ ...bar })); invalidOhlc[0].low = 3;
assert.equal(assessKlineCoverage(invalidOhlc).complete, false);

const tradingDates = [];
for (let cursor = new Date('2025-10-01T00:00:00Z'); tradingDates.length < 250; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
  if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) tradingDates.push(cursor.toISOString().slice(0, 10));
}
const listingDates = tradingDates.slice(132);
const listingBars = listingDates.map((date) => ({ date, open: 10, high: 11, low: 9, close: 10.5, volume: 100 }));
const listingQuality = assessKlineCoverage(listingBars, {
  target: 250, strategyMin: 60, expectedDates: tradingDates,
  expectedLatestDate: tradingDates.at(-1), listingDate: listingDates[0],
});
assert.equal(listingQuality.status, 'listing_complete');
assert.equal(listingQuality.complete, false, '新股上市历史完整不能冒充250日完整');
assert.equal(listingQuality.strategyReady, true);
assert.equal(listingQuality.listingHistoryComplete, true);
assert.equal(listingQuality.missingDates.length, 0, '上市前交易日不得计为缺口');
assert.equal(listingQuality.availableTarget, 118);

const conservativeQuality = assessKlineCoverage(listingBars, {
  target: 250, strategyMin: 60, expectedDates: tradingDates, expectedLatestDate: tradingDates.at(-1),
});
assert.equal(conservativeQuality.strategyReady, false, '缺少可验证上市日时保持保守缺口判断');
assert.equal(conservativeQuality.missingDates.length, 132);

const postListingGap = assessKlineCoverage(listingBars.filter((_, index) => index !== 20), {
  target: 250, strategyMin: 60, expectedDates: tradingDates,
  expectedLatestDate: tradingDates.at(-1), listingDate: listingDates[0],
});
assert.equal(postListingGap.strategyReady, false, '上市后的真实缺口仍应阻断');
assert.equal(postListingGap.missingDates.length, 1);

const tooNew = assessKlineCoverage(listingBars.slice(-59), {
  target: 250, strategyMin: 60, expectedDates: tradingDates.slice(-59),
  expectedLatestDate: tradingDates.at(-1), listingDate: tradingDates.at(-59),
});
assert.equal(tooNew.strategyReady, false, '不足策略最小样本时仍不满足策略要求');
