// 智诊盯盘 · 候选池日 K 补齐（后台任务，可中断）
// 业务调整：扫描阶段只做快照初筛（不复筛），命中进候选池后再对池内股票
// 逐只拉取完整「目标天数」的前复权日 K，边拉边落库（fetchKline 内部 writeKline）。
// 复用 data.fetchKline（多源链 + 熔断），仅串行 + 间隔，避免轰接口。
const { fetchKline } = require('./data');
const { readKline, readKlineStats, recentTradingDates } = require('./storage');
const { shanghaiClock, isAfterCnMarketClose, marketSession } = require('./market-session');
const { assessKlineCoverage } = require('./kline-quality');
const { effectiveTailStatus, TAIL_STATUS } = require('./kline-tail-status');
const taskMarkers = require('./task-markers');

const DEFAULT_LMT = 250;
const DEFAULT_GAP_MS = 350;      // 串行间隔，兼顾速度与东财/腾讯限流
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const state = {
  running: false,
  startedAt: 0,
  finishedAt: 0,
  codes: [],
  lmt: DEFAULT_LMT,
  gapMs: DEFAULT_GAP_MS,
  total: 0,
  done: 0,
  ok: 0,
  listingComplete: 0,
  strategyReady: 0,
  incomplete: 0,
  failed: 0,
  skipped: 0,
  current: '',
  errorsList: [],
  statusByCode: {},
};

// 可被 stop 打断的睡眠：分片检查 running。
async function sleepInterruptible(ms) {
  let remaining = ms;
  while (remaining > 0) {
    if (!state.running) return false;
    const step = Math.min(100, remaining);
    await sleep(step);
    remaining -= step;
  }
  return state.running;
}

function getStatus() {
  return {
    running: state.running,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    lmt: state.lmt,
    total: state.total,
    done: state.done,
    ok: state.ok,
    listingComplete: state.listingComplete,
    strategyReady: state.strategyReady,
    incomplete: state.incomplete,
    failed: state.failed,
    skipped: state.skipped,
    current: state.current,
    errorsList: state.errorsList.slice(0, 50),
    statusByCode: { ...state.statusByCode },
  };
}

async function run(codesInput, { lmt = DEFAULT_LMT, gapMs = DEFAULT_GAP_MS } = {}) {
  const codes = Array.isArray(codesInput) ? codesInput.map((c) => String(c).trim()).filter(Boolean) : [];
  state.running = true;
  state.startedAt = Date.now();
  state.finishedAt = 0;
  state.codes = codes.slice();
  state.lmt = lmt;
  state.gapMs = gapMs;
  state.total = codes.length;
  state.done = 0;
  state.ok = 0;
  state.listingComplete = 0;
  state.strategyReady = 0;
  state.incomplete = 0;
  state.failed = 0;
  state.skipped = 0;
  state.current = '';
  state.errorsList = [];
  state.statusByCode = {};
  // D15-05：写跨进程可识别的队列标记。进程异常退出后由启动结算标记为 interrupted，不会自动续跑。
  taskMarkers.startMarker('kline-queue', { total: codes.length, lmt, scope: 'pool_kline' });
  try {
    const stats = await readKlineStats(codes);
    const statMap = new Map(stats.map((x) => [x.code, x]));
    const now = new Date();
    const clock = shanghaiClock(now);
    const closed = isAfterCnMarketClose(now);
    const today = clock.date;
    const session = marketSession(now);
    const intraday = session === 'morning' || session === 'midday_break' || session === 'afternoon';
    const expectedDates = await recentTradingDates(lmt, { anchor: closed || intraday ? today : '' });
    const expectedLatestDate = expectedDates.at(-1) || '';
    const provisional = intraday;
    for (const code of codes) {
      if (!state.running) break;
      state.current = code;
      const meta = statMap.get(code);
      const saved = meta && meta.savedAt ? new Date(meta.savedAt) : null;
      const savedHour = saved && !Number.isNaN(saved.getTime()) ? Number(saved.toLocaleString('en-US', { timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false })) : -1;
      const savedDay = saved && !Number.isNaN(saved.getTime()) ? saved.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }) : '';
      const cachedBefore = await readKline(code);
      const beforeQuality = assessKlineCoverage(cachedBefore && cachedBefore.kline, {
        target: lmt, expectedDates, expectedLatestDate, provisional,
        listingDate: (cachedBefore && cachedBefore.listingDate) || (meta && meta.listingDate) || '',
      });
      // 盘中写入的暂定尾K在收盘后必须重新抓取，不能凭旧数据直接算作收盘确认。
      const cachedTailStatus = effectiveTailStatus({
        storedTailStatus: (cachedBefore && cachedBefore.tailStatus) || (meta && meta.tailStatus) || '',
        barDate: (cachedBefore && cachedBefore.kline && cachedBefore.kline.length
          ? cachedBefore.kline[cachedBefore.kline.length - 1].date : (meta && meta.latestDate)) || '',
        now,
      });
      const tailFinal = cachedTailStatus === TAIL_STATUS.CONFIRMED;
      if ((beforeQuality.complete || beforeQuality.listingHistoryComplete) && (!closed || (meta && meta.latestDate === today && savedDay === today && savedHour >= 15 && tailFinal))) {
        state.statusByCode[code] = { ...beforeQuality, tailStatus: cachedTailStatus };
        state.skipped += 1;
        state.done += 1;
        continue;
      }
      try {
        await fetchKline(code, { lmt, dataSource: 'live' });
        const cachedAfter = await readKline(code);
        const quality = assessKlineCoverage(cachedAfter && cachedAfter.kline, {
          target: lmt, expectedDates, expectedLatestDate, provisional,
          listingDate: (cachedAfter && cachedAfter.listingDate) || '',
        });
        const tailStatus = effectiveTailStatus({
          storedTailStatus: (cachedAfter && cachedAfter.tailStatus) || '',
          barDate: (cachedAfter && cachedAfter.kline && cachedAfter.kline.length
            ? cachedAfter.kline[cachedAfter.kline.length - 1].date : '') || '',
          now,
        });
        state.statusByCode[code] = {
          ...quality,
          tailStatus,
          source: (cachedAfter && cachedAfter.source) || '',
          adjustmentType: (cachedAfter && cachedAfter.adjustmentType) || '',
          tailConfirmedAt: (cachedAfter && cachedAfter.tailConfirmedAt) || '',
        };
        if (quality.complete) state.ok += 1;
        else if (quality.listingHistoryComplete) state.listingComplete += 1;
        else if (quality.strategyReady) state.strategyReady += 1;
        else if (quality.status === 'incomplete') state.incomplete += 1;
        else state.failed += 1;
        if (!quality.complete && !quality.listingHistoryComplete && !state.errorsList.some((x) => x.code === code)) {
          state.errorsList.push({ code, err: quality.reasons.join('；').slice(0, 160), status: quality.status });
        }
      } catch (e) {
        state.failed += 1;
        if (!state.errorsList.some((x) => x.code === code)) {
          state.errorsList.push({ code, err: String((e && e.message) || e).slice(0, 120), status: 'failed' });
        }
      }
      state.done += 1;
      if (state.running && gapMs > 0) {
        const okGap = await sleepInterruptible(gapMs);
        if (!okGap) break;
      }
    }
  } finally {
    state.running = false;
    state.finishedAt = Date.now();
    state.current = '';
    taskMarkers.finishMarker('kline-queue', {
      total: state.total, done: state.done, ok: state.ok, listingComplete: state.listingComplete, failed: state.failed, skipped: state.skipped,
      status: state.done >= state.total ? 'finished' : 'stopped',
    });
  }
  return getStatus();
}

// 供 HTTP 端点使用：立即返回「已启动/已在跑」，后台执行，不阻塞响应。
function start(codes, opts = {}) {
  if (state.running) return { started: false, reason: 'running', ...getStatus() };
  run(codes, opts).catch(() => {});
  return { started: true, reason: 'started', ...getStatus() };
}

function stop() {
  state.running = false;
  return getStatus();
}

// 候选池内某只股票当前 K 线深度（用于前端展示「补齐状态」）；失败返回 0。
async function depth(code) {
  const cached = await readKline(code);
  return cached && Array.isArray(cached.kline) ? cached.kline.length : 0;
}

module.exports = { start, stop, getStatus, run, depth, DEFAULT_LMT, DEFAULT_GAP_MS };
