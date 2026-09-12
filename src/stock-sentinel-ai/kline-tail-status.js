// 智诊盯盘 · 尾K最终版判定（第十四阶段 D14-04）
//
// 尾K（K 线序列最后一根）只有「该交易日已收盘 + 日期是目标交易日 + OHLCV 字段有效」
// 时才算已确认；盘前、交易中、午休只能标暂定。历史交易日的 K 线按收盘事实可标已确认。
// 交易日历只维护了部分年份，未知年份必须带降级说明，不得冒充完整交易日历。
const { validBar } = require('./kline-quality');
const { shanghaiClock, isCnTradingDay, marketSession, isTradingCalendarKnown, tradingCalendarNotice } = require('./market-session');

const TAIL_STATUS = { CONFIRMED: 'confirmed', PROVISIONAL: 'provisional', UNKNOWN: 'unknown' };
const TAIL_STATUS_LABEL = { confirmed: '已收盘确认', provisional: '暂定未确认', unknown: '状态未知' };

const SESSION_LABEL = {
  non_trading: '非交易日',
  pre_open: '盘前',
  morning: '上午交易中',
  midday_break: '午间休市',
  afternoon: '下午交易中',
  post_close: '已收盘',
};

function normalizeTailStatus(value) {
  const text = String(value || '').trim();
  return text === TAIL_STATUS.CONFIRMED || text === TAIL_STATUS.PROVISIONAL ? text : '';
}

function tailStatusLabel(value) {
  return TAIL_STATUS_LABEL[normalizeTailStatus(value)] || TAIL_STATUS_LABEL.unknown;
}

function validDateText(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  const time = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === text ? text : '';
}

// 任意日期是否为交易日：未知年份按周末规则降级判定（调用方需结合 degraded 说明）。
function isTradingDayDate(value) {
  const text = validDateText(value);
  if (!text) return false;
  const at = new Date(`${text}T12:00:00+08:00`);
  if (!Number.isFinite(at.getTime())) return false;
  return isCnTradingDay(at);
}

// 尾K最终版判定。
//   bar            尾K实体（含 date/open/high/low/close/volume）；只知日期时可省略
//   barDate        未提供 bar 时的尾K日期
//   now            判定时刻（默认当前时间，Asia/Shanghai 口径）
//   targetDate     本次要求的目标交易日（如候选/快照日期），收盘后必须与尾K日期一致
//   expectedLatestDate 期望的最新交易日（用于标记陈旧，不改变确认结论）
//   storedTailStatus   已落库的尾K状态（'provisional' 表示该尾K是盘中写入的，收盘后不能直接升级）
function evaluateTailStatus({
  bar = null, barDate = '', now = new Date(), targetDate = '', expectedLatestDate = '', storedTailStatus = '',
} = {}) {
  const clock = shanghaiClock(now);
  const today = clock.date;
  const session = marketSession(now);
  const date = validDateText((bar && bar.date) || barDate);
  const target = validDateText(targetDate);
  const expected = validDateText(expectedLatestDate);
  const stored = normalizeTailStatus(storedTailStatus);
  const calendarKnown = isTradingCalendarKnown(today);
  const barYearKnown = date ? isTradingCalendarKnown(date) : false;
  const degraded = !calendarKnown || (Boolean(date) && !barYearKnown);
  const notice = degraded
    ? tradingCalendarNotice(!calendarKnown || !date ? today : date)
    : '';
  const base = {
    barDate: date,
    today,
    session,
    sessionLabel: SESSION_LABEL[session] || session,
    targetDate: target,
    expectedLatestDate: expected,
    storedTailStatus: stored,
    calendarKnown,
    barYearKnown,
    degraded,
    notice,
  };
  const finish = (status, reason, confirmedAt = '') => ({ ...base, status, confirmedAt, reason });

  if (!date) return finish(TAIL_STATUS.PROVISIONAL, '缺少尾K日期，无法确认是否收盘');
  const fieldValid = bar ? validBar(bar) : null;
  const stale = Boolean(expected && date < expected);

  if (date > today) {
    return { ...finish(TAIL_STATUS.PROVISIONAL, `尾K日期${date}晚于当前交易日${today}，来源数据超前，不能确认`), stale: false };
  }

  if (!bar || fieldValid === false) {
    return { ...finish(TAIL_STATUS.PROVISIONAL, !bar ? '缺少尾K实体字段，不能确认' : '尾K的 OHLCV 字段不完整，不能确认'), stale };
  }

  if (date < today) {
    if (barYearKnown && !isTradingDayDate(date)) {
      return {
        ...finish(TAIL_STATUS.PROVISIONAL, `尾K日期${date}不是交易日，来源数据异常，不能确认`),
        stale,
      };
    }
    const reason = stale
      ? `历史交易日${date}已收盘确认，但晚于该日的交易日数据尚未补齐（应到${expected}）`
      : `历史交易日${date}已收盘确认`;
    return { ...finish(TAIL_STATUS.CONFIRMED, degraded ? `${reason}；${notice}` : reason, new Date(now).toISOString()), stale };
  }

  // date === today
  if (!isTradingDayDate(today)) {
    return { ...finish(TAIL_STATUS.PROVISIONAL, `当前日期${today}为非交易日，尾K不能确认`), stale };
  }
  if (session !== 'post_close') {
    return {
      ...finish(TAIL_STATUS.PROVISIONAL, `当前为${SESSION_LABEL[session] || session}，尾K尚未收盘确认`),
      stale,
    };
  }
  if (stored === TAIL_STATUS.PROVISIONAL) {
    return {
      ...finish(TAIL_STATUS.PROVISIONAL, `尾K在盘中写入且未用收盘数据重新抓取，不能直接标记已确认`),
      stale,
    };
  }
  if (target && target !== date) {
    return { ...finish(TAIL_STATUS.PROVISIONAL, `尾K日期${date}与目标交易日${target}不一致，不能确认`), stale };
  }
  if (expected && date !== expected) {
    return { ...finish(TAIL_STATUS.PROVISIONAL, `尾K日期${date}不是期望的最新交易日${expected}，不能确认`), stale };
  }
  const reason = `收盘后尾K（${date}）日期与字段校验通过，已确认`;
  return { ...finish(TAIL_STATUS.CONFIRMED, degraded ? `${reason}；${notice}` : reason, new Date(now).toISOString()), stale };
}

// 对整条 K 线序列判定尾K状态（取最后一根有效 bar）。
function evaluateKlineTailStatus(kline, options = {}) {
  const rows = Array.isArray(kline) ? kline : [];
  const last = rows.length ? rows[rows.length - 1] : null;
  return evaluateTailStatus({ ...options, bar: last });
}

// 读取既有序列时的有效尾K状态：历史交易日的尾K按收盘事实已确认；
// 只有落在当前交易日的尾K才需要依赖落库状态，缺状态时不冒充已确认。
function effectiveTailStatus({ storedTailStatus = '', barDate = '', now = new Date() } = {}) {
  const stored = normalizeTailStatus(storedTailStatus);
  const date = validDateText(barDate);
  const today = shanghaiClock(now).date;
  if (date && date < today) return TAIL_STATUS.CONFIRMED;
  if (stored) return stored;
  if (date && date > today) return TAIL_STATUS.PROVISIONAL;
  return TAIL_STATUS.UNKNOWN;
}

module.exports = {
  TAIL_STATUS,
  TAIL_STATUS_LABEL,
  SESSION_LABEL,
  normalizeTailStatus,
  tailStatusLabel,
  isTradingDayDate,
  evaluateTailStatus,
  evaluateKlineTailStatus,
  effectiveTailStatus,
};
