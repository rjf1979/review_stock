const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.VOLUME_INSIGHT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-watch-baseline-'));
const watchlist = require('../watchlist');

const added = watchlist.add('600001', { name: '测试股', market: 'sh_main', source: 'manual', baselineTargetDate: '2026-09-08' });
assert.equal(added.ok, true, '应建立自选记录');
const pending = watchlist.get('600001');
assert.equal(pending.returnBaseline.status, 'pending_close', '新加入必须等待当日收盘确认');
assert.equal(pending.returnBaseline.close, null, '盘中/未确认时不得写入基准价');

const frozen = watchlist.confirmReturnBaseline('600001', { targetDate: '2026-09-08', close: 12.34, confirmedAt: '2026-09-08T08:00:00.000Z' });
assert.equal(frozen.ok, true, '精确目标日收盘价可以冻结');
assert.equal(watchlist.get('600001').returnBaseline.close, 12.34);
assert.equal(watchlist.get('600001').returnBaseline.status, 'confirmed');

const repeat = watchlist.confirmReturnBaseline('600001', { targetDate: '2026-09-08', close: 13 });
assert.equal(repeat.ok, true);
assert.equal(repeat.unchanged, true, '已经冻结的基准不可被后续K线改写');
assert.equal(watchlist.get('600001').returnBaseline.close, 12.34);
assert.equal(watchlist.confirmReturnBaseline('600001', { targetDate: '2026-09-07', close: 10 }).ok, true, '已冻结记录重复调用不应破坏既有基准');

const legacy = [{ code: '000001', name: '历史股', addedAt: '2025-01-01T00:00:00.000Z' }];
fs.writeFileSync(watchlist.WATCHLIST_FILE, JSON.stringify(legacy), 'utf8');
assert.equal(watchlist.get('000001').returnBaseline, undefined, '历史自选不应被自动伪造收益基准');
const custom = watchlist.setCustomReturnBaseline('000001', '10.50', { monitorStartDate: '2026-09-08', now: '2026-09-08T08:00:00.000Z' });
assert.equal(custom.ok, true, '历史自选允许设置模拟买入价');
assert.equal(watchlist.get('000001').customReturnBaseline.status, 'pending_touch');
const sameDayFill = watchlist.findFirstSimulatedFill([{ date: '2026-09-08', low: 10.5, high: 12 }], 10.5, '2026-09-08');
assert.equal(sameDayFill.date, '2026-09-08', '日K高低点含模拟价即视为当天触达');
assert.equal(watchlist.findFirstSimulatedFill([{ date: '2026-09-08', low: 10.51, high: 12 }, { date: '2026-09-09', low: 9, high: 11 }], 10.5, '2026-09-08').date, '2026-09-09', '未触达时持续等待后续交易日');
const marked = watchlist.markCustomReturnBaselineFilled('000001', { expectedUpdatedAt: watchlist.get('000001').customReturnBaseline.updatedAt, filledDate: '2026-09-08' });
assert.equal(marked.ok, true);
assert.equal(watchlist.get('000001').customReturnBaseline.status, 'filled');
assert.equal(watchlist.clearCustomReturnBaseline('000001').ok, true, '可清除模拟价恢复自动逻辑');
assert.equal(watchlist.get('000001').customReturnBaseline, undefined);
console.log('watchlist-return-baseline.test 通过');
