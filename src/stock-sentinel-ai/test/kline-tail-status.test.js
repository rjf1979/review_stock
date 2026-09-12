const assert = require('node:assert/strict');
const {
  TAIL_STATUS,
  normalizeTailStatus,
  tailStatusLabel,
  isTradingDayDate,
  evaluateTailStatus,
  evaluateKlineTailStatus,
  effectiveTailStatus,
} = require('../kline-tail-status');

// 2026-09-11 为周五交易日；以下 UTC 时刻对应上海时间。
const preOpen = new Date('2026-09-11T01:00:00Z'); // 09:00 盘前
const morning = new Date('2026-09-11T02:00:00Z'); // 10:00 上午盘
const midday = new Date('2026-09-11T04:00:00Z'); // 12:00 午休
const afternoon = new Date('2026-09-11T06:00:00Z'); // 14:00 下午盘
const postClose = new Date('2026-09-11T07:05:00Z'); // 15:05 收盘后
const today = '2026-09-11';
const barOf = (date, close = 10) => ({ date, open: close - 0.4, high: close + 0.6, low: close - 0.8, close, volume: 12345 });

// 状态枚举与标签
assert.equal(normalizeTailStatus('confirmed'), TAIL_STATUS.CONFIRMED);
assert.equal(normalizeTailStatus('provisional'), TAIL_STATUS.PROVISIONAL);
assert.equal(normalizeTailStatus('garbage'), '', '未登记状态一律视为未知');
assert.equal(tailStatusLabel(''), '状态未知');
assert.equal(tailStatusLabel('provisional'), '暂定未确认');

// 交易日历
assert.equal(isTradingDayDate('2026-09-11'), true, '周五是交易日');
assert.equal(isTradingDayDate('2026-09-05'), false, '周六不是交易日');
assert.equal(isTradingDayDate('2026-09-25'), false, '中秋节假日不是交易日');
assert.equal(isTradingDayDate('2026-09-31'), false, '非法日期不是交易日');

// 盘前 / 上午 / 午休 / 下午：当天尾K一律暂定
for (const [label, now, session] of [
  ['盘前', preOpen, 'pre_open'],
  ['上午盘', morning, 'morning'],
  ['午间休市', midday, 'midday_break'],
  ['下午盘', afternoon, 'afternoon'],
]) {
  const result = evaluateTailStatus({ bar: barOf(today), now, targetDate: today, expectedLatestDate: today });
  assert.equal(result.status, TAIL_STATUS.PROVISIONAL, `${label}尾K应暂定`);
  assert.equal(result.session, session, `${label}会话判定正确`);
  assert.equal(result.confirmedAt, '', `${label}暂定状态不得写确认时间`);
}

// 收盘后：日期与 OHLCV 校验通过才确认
const confirmed = evaluateTailStatus({ bar: barOf(today), now: postClose, targetDate: today, expectedLatestDate: today });
assert.equal(confirmed.status, TAIL_STATUS.CONFIRMED, '收盘后尾K应确认');
assert.equal(confirmed.session, 'post_close');
assert.ok(confirmed.confirmedAt, '确认状态必须带确认时间');
assert.equal(confirmed.stale, false);

// 收盘后：目标交易日不一致 / 期望最新交易日不一致 / OHLCV 不完整 → 暂定
assert.equal(
  evaluateTailStatus({ bar: barOf(today), now: postClose, targetDate: '2026-09-10' }).status,
  TAIL_STATUS.PROVISIONAL, '尾K日期与目标交易日不一致不得确认',
);
assert.equal(
  evaluateTailStatus({ bar: barOf(today), now: postClose, expectedLatestDate: '2026-09-10' }).status,
  TAIL_STATUS.PROVISIONAL, '尾K不是期望的最新交易日不得确认',
);
assert.equal(
  evaluateTailStatus({ bar: { ...barOf(today), volume: null }, now: postClose }).status,
  TAIL_STATUS.PROVISIONAL, '尾K缺少成交量不得确认',
);
assert.equal(
  evaluateTailStatus({ bar: { ...barOf(today), volume: 'abc' }, now: postClose }).status,
  TAIL_STATUS.PROVISIONAL, '尾K成交量非法不得确认',
);
assert.equal(
  evaluateTailStatus({ bar: null, barDate: today, now: postClose }).status,
  TAIL_STATUS.PROVISIONAL, '只知日期而缺少尾K实体时不能确认',
);

// 盘中写入的暂定尾K，收盘后不得直接升级
assert.equal(
  evaluateTailStatus({ bar: barOf(today), now: postClose, storedTailStatus: 'provisional' }).status,
  TAIL_STATUS.PROVISIONAL, '盘中写入的尾K必须重新抓取才能确认',
);
assert.equal(
  evaluateTailStatus({ bar: barOf(today), now: postClose, storedTailStatus: 'confirmed' }).status,
  TAIL_STATUS.CONFIRMED, '已确认状态在收盘后可保持',
);

// 历史交易日：按收盘事实确认，不因陈旧降级为暂定
const historical = evaluateTailStatus({ bar: barOf('2026-09-10'), now: postClose, expectedLatestDate: today });
assert.equal(historical.status, TAIL_STATUS.CONFIRMED, '历史交易日尾K应确认');
assert.equal(historical.stale, true, '落后于期望最新交易日应标记陈旧');
assert.equal(
  evaluateTailStatus({ bar: { ...barOf('2026-09-10'), close: null }, now: postClose }).status,
  TAIL_STATUS.PROVISIONAL, '历史交易日尾K字段无效时也不能确认',
);

// 历史日期不是交易日 → 来源数据异常，不得确认
assert.equal(
  evaluateTailStatus({ bar: barOf('2026-09-06'), now: postClose }).status,
  TAIL_STATUS.PROVISIONAL, '非交易日的历史日期不得确认',
);

// 未来日期：来源数据超前，不得确认
assert.equal(
  evaluateTailStatus({ bar: barOf('2026-09-14'), now: postClose }).status,
  TAIL_STATUS.PROVISIONAL, '未来日期尾K不得确认',
);

// 非交易日（周六）：不得确认
assert.equal(
  evaluateTailStatus({ bar: barOf('2026-09-05'), now: new Date('2026-09-05T07:05:00Z') }).status,
  TAIL_STATUS.PROVISIONAL, '非交易日不得确认尾K',
);

// 缺少日期
assert.equal(evaluateTailStatus({ bar: { ...barOf(today), date: '' }, now: postClose }).status, TAIL_STATUS.PROVISIONAL);

// 未知年份：必须带降级说明，不得冒充完整交易日历
const unknownYear = evaluateTailStatus({
  bar: barOf('2027-01-05'), now: new Date('2027-01-05T07:05:00Z'), targetDate: '2027-01-05',
});
assert.equal(unknownYear.status, TAIL_STATUS.CONFIRMED, '未知年份按周末规则降级判定');
assert.equal(unknownYear.degraded, true, '未知年份必须标记降级');
assert.equal(unknownYear.calendarKnown, false);
assert.match(unknownYear.notice, /交易日历未维护/, '未知年份必须带降级说明');
assert.match(unknownYear.reason, /交易日历未维护/, '降级说明须写入判定理由');
assert.ok(!evaluateTailStatus({ bar: barOf(today), now: postClose, targetDate: today }).degraded, '已维护年份不得标记降级');

// 整条序列取尾K
assert.equal(evaluateKlineTailStatus([barOf('2026-09-09'), barOf(today)], { now: postClose, targetDate: today }).status, TAIL_STATUS.CONFIRMED);
assert.equal(evaluateKlineTailStatus([], { now: postClose }).status, TAIL_STATUS.PROVISIONAL, '空序列无法确认');

// 既有序列的有效状态：历史交易日按收盘事实确认，当天缺状态不冒充已确认
assert.equal(effectiveTailStatus({ barDate: '2026-09-10', now: postClose }), TAIL_STATUS.CONFIRMED);
assert.equal(effectiveTailStatus({ barDate: today, now: postClose }), TAIL_STATUS.UNKNOWN, '当天缺落库状态不得冒充已确认');
assert.equal(effectiveTailStatus({ barDate: today, storedTailStatus: 'provisional', now: postClose }), TAIL_STATUS.PROVISIONAL);
assert.equal(effectiveTailStatus({ barDate: '2026-09-14', now: postClose }), TAIL_STATUS.PROVISIONAL, '超前日期不得确认');

console.log('kline-tail-status.test 通过');
