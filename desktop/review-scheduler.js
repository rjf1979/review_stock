// 每日复盘调度器：工作日 12:00 与 16:00 各执行一次，失败时允许下一次 tick 重试。
const SHANGHAI = 'Asia/Shanghai';
const REVIEW_SLOTS = [
  { id: 'midday', label: '午间快照', cutoff: '12:00' },
  { id: 'close', label: '收盘复盘', cutoff: '16:00' },
];

function shanghaiParts(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SHANGHAI,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(value);
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
}

function todayISO(value = new Date()) {
  const p = shanghaiParts(value);
  return p.year + '-' + p.month + '-' + p.day;
}

function isWeekday(value = new Date()) {
  const p = shanghaiParts(value);
  return p.weekday !== 'Sat' && p.weekday !== 'Sun';
}

function timeReached(value, cutoff) {
  const p = shanghaiParts(value);
  return p.hour + ':' + p.minute >= cutoff;
}

function shouldRunAfterClose(value = new Date(), cutoff = '16:00') {
  return isWeekday(value) && timeReached(value, cutoff);
}

function slotKey(date, slot) {
  return `${date}@${slot.id}`;
}

function nextDueSlot(value = new Date(), lastRunSlot = '') {
  if (!isWeekday(value)) return null;
  const date = todayISO(value);
  const closeKey = slotKey(date, REVIEW_SLOTS[REVIEW_SLOTS.length - 1]);
  if (lastRunSlot === closeKey) return null;
  if (lastRunSlot === slotKey(date, REVIEW_SLOTS[0])) {
    const closeSlot = REVIEW_SLOTS[REVIEW_SLOTS.length - 1];
    return timeReached(value, closeSlot.cutoff) ? closeSlot : null;
  }
  return REVIEW_SLOTS.filter(slot => timeReached(value, slot.cutoff)).pop() || null;
}

function createReviewScheduler({
  runReview,
  onSuccess = () => {},
  onError = () => {},
  initialDate = '',
  initialSlot = '',
  now = () => new Date(),
  intervalMs = 60_000,
} = {}) {
  let lastRunDate = initialDate;
  let lastRunSlot = initialSlot;
  let running = false;
  let timer = null;

  async function tick() {
    const current = now();
    const date = todayISO(current);
    const slot = nextDueSlot(current, lastRunSlot);
    if (running || !slot) {
      return { status: 'skipped', date, slot: null, running };
    }

    running = true;
    try {
      const result = await runReview(date, slot);
      await onSuccess(result, date, slot);
      lastRunDate = date;
      lastRunSlot = slotKey(date, slot);
      return { status: 'generated', date, slot, result };
    } catch (error) {
      await onError(error, date, slot);
      return { status: 'error', date, slot, error };
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (timer) return;
      tick();
      timer = setInterval(tick, intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    tick,
    getState() {
      return { lastRunDate, lastRunSlot, running, active: Boolean(timer) };
    },
  };
}

module.exports = { REVIEW_SLOTS, todayISO, isWeekday, timeReached, shouldRunAfterClose, nextDueSlot, createReviewScheduler };
