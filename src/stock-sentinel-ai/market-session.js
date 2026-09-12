// A 股交易时段（Asia/Shanghai）。节假日表按年度维护；未知年份安全退回周末规则。
const HOLIDAYS = new Set([
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20',
  '2026-04-06', '2026-05-01', '2026-05-04', '2026-05-05', '2026-06-19', '2026-06-22',
  '2026-09-25', '2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07',
]);
// HOLIDAYS 已覆盖的年份。表中没有该年份记录时无法判断是「无节假日」还是「未维护」，
// 因此只把显式登记的年份视为已知；其它年份必须降级说明，不得冒充完整交易日历。
const CALENDAR_YEARS = Object.freeze([2026]);

function isTradingCalendarKnown(date) {
  const year = Number(String(date || '').slice(0, 4));
  return Number.isInteger(year) && CALENDAR_YEARS.includes(year);
}

// 未知年份的降级说明（尾K确认、数据质量提示统一引用同一文案）。
function tradingCalendarNotice(date) {
  const year = String(date || '').slice(0, 4);
  return `${year || '未知'} 年交易日历未维护，仅按周末规则降级判定，节假日可能误判`;
}
function shanghaiClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).reduce((out, part) => { out[part.type] = part.value; return out; }, {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function isCnWeekday(now = new Date()) {
  const { weekday } = shanghaiClock(now);
  return weekday !== 'Sat' && weekday !== 'Sun' && !HOLIDAYS.has(shanghaiClock(now).date);
}

function isCnTradingDay(now = new Date()) { return isCnWeekday(now); }

function isCnStockTradingSession(now = new Date()) {
  const clock = shanghaiClock(now);
  if (!isCnTradingDay(now)) return false;
  const t = clock.minutes;
  return (t >= 9 * 60 + 15 && t < 11 * 60 + 30) || (t >= 13 * 60 && t < 15 * 60);
}

function isAfterCnMarketClose(now = new Date()) {
  const clock = shanghaiClock(now);
  return isCnTradingDay(now) && clock.minutes >= 15 * 60;
}

function marketSession(now = new Date()) {
  const clock = shanghaiClock(now);
  if (!isCnTradingDay(now)) return 'non_trading';
  if (clock.minutes < 9 * 60 + 15) return 'pre_open';
  if (clock.minutes < 11 * 60 + 30) return 'morning';
  if (clock.minutes < 13 * 60) return 'midday_break';
  if (clock.minutes < 15 * 60) return 'afternoon';
  return 'post_close';
}

function shanghaiDateAt(clock, daysAhead, hour, minute) {
  const [year, month, day] = clock.date.split('-').map(Number);
  // Date.UTC 会正确处理跨月/跨年的日期进位；上海时间比 UTC 快 8 小时。
  return Date.UTC(year, month - 1, day + daysAhead, hour - 8, minute, 0, 0);
}

function marketSessionStatus(now = new Date()) {
  const clock = shanghaiClock(now);
  const session = marketSession(now);
  let sessionLabel = '';
  let countdownLabel = '';
  let nextTransitionAt = 0;
  if (session === 'non_trading') {
    let daysAhead = 1;
    while (!isCnTradingDay(new Date(shanghaiDateAt(clock, daysAhead, 9, 15)))) daysAhead++;
    sessionLabel = '非交易日'; countdownLabel = '距下次开盘'; nextTransitionAt = shanghaiDateAt(clock, daysAhead, 9, 15);
  } else if (session === 'pre_open') {
    sessionLabel = '盘前'; countdownLabel = '距开盘'; nextTransitionAt = shanghaiDateAt(clock, 0, 9, 15);
  } else if (session === 'morning') {
    sessionLabel = '上午交易'; countdownLabel = '距午间休市'; nextTransitionAt = shanghaiDateAt(clock, 0, 11, 30);
  } else if (session === 'midday_break') {
    sessionLabel = '午间休市'; countdownLabel = '距下午开盘'; nextTransitionAt = shanghaiDateAt(clock, 0, 13, 0);
  } else if (session === 'afternoon') {
    sessionLabel = '下午交易'; countdownLabel = '距收盘'; nextTransitionAt = shanghaiDateAt(clock, 0, 15, 0);
  } else {
    let daysAhead = 1;
    while (!isCnTradingDay(new Date(shanghaiDateAt(clock, daysAhead, 9, 15)))) daysAhead++;
    sessionLabel = '已收盘'; countdownLabel = '距下次开盘'; nextTransitionAt = shanghaiDateAt(clock, daysAhead, 9, 15);
  }
  return { serverEpochMs: now.getTime(), timeZone: 'Asia/Shanghai', session, sessionLabel, countdownLabel, nextTransitionAt };
}

module.exports = { HOLIDAYS, CALENDAR_YEARS, isTradingCalendarKnown, tradingCalendarNotice, shanghaiClock, isCnWeekday, isCnTradingDay, isCnStockTradingSession, isAfterCnMarketClose, marketSession, marketSessionStatus };
