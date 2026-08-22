// 收盘复盘调度器：工作日收盘后执行一次，失败时允许下一次 tick 重试。
const SHANGHAI = 'Asia/Shanghai';

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

function shouldRunAfterClose(value = new Date(), cutoff = '15:35') {
  const p = shanghaiParts(value);
  if (p.weekday === 'Sat' || p.weekday === 'Sun') return false;
  return p.hour + ':' + p.minute >= cutoff;
}

function createReviewScheduler({
  runReview,
  onSuccess = () => {},
  onError = () => {},
  initialDate = '',
  now = () => new Date(),
  intervalMs = 60_000,
} = {}) {
  let lastRunDate = initialDate;
  let running = false;
  let timer = null;

  async function tick() {
    const current = now();
    const date = todayISO(current);
    if (running || lastRunDate === date || !shouldRunAfterClose(current)) {
      return { status: 'skipped', date, running };
    }

    running = true;
    try {
      const result = await runReview(date);
      lastRunDate = date;
      await onSuccess(result, date);
      return { status: 'generated', date, result };
    } catch (error) {
      await onError(error, date);
      return { status: 'error', date, error };
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
      return { lastRunDate, running, active: Boolean(timer) };
    },
  };
}

module.exports = { todayISO, shouldRunAfterClose, createReviewScheduler };
