// A 股交易时段（Asia/Shanghai）。当前仅排除周末；法定节假日等待交易日历接入。
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
  return weekday !== 'Sat' && weekday !== 'Sun';
}

function isCnStockTradingSession(now = new Date()) {
  const clock = shanghaiClock(now);
  if (clock.weekday === 'Sat' || clock.weekday === 'Sun') return false;
  const t = clock.minutes;
  return (t >= 9 * 60 + 15 && t < 11 * 60 + 30) || (t >= 13 * 60 && t < 15 * 60);
}

function isAfterCnMarketClose(now = new Date()) {
  const clock = shanghaiClock(now);
  return clock.weekday !== 'Sat' && clock.weekday !== 'Sun' && clock.minutes >= 15 * 60;
}

function marketSession(now = new Date()) {
  const clock = shanghaiClock(now);
  if (clock.weekday === 'Sat' || clock.weekday === 'Sun') return 'non_trading';
  if (clock.minutes < 9 * 60 + 15) return 'pre_open';
  if (clock.minutes < 11 * 60 + 30) return 'morning';
  if (clock.minutes < 13 * 60) return 'midday_break';
  if (clock.minutes < 15 * 60) return 'afternoon';
  return 'post_close';
}

module.exports = { shanghaiClock, isCnWeekday, isCnStockTradingSession, isAfterCnMarketClose, marketSession };
