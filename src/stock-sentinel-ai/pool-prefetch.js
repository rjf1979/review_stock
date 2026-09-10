// 智诊盯盘 · 候选池日 K 补齐（后台任务，可中断）
// 业务调整：扫描阶段只做快照初筛（不复筛），命中进候选池后再对池内股票
// 逐只拉取完整「目标天数」的前复权日 K，边拉边落库（fetchKline 内部 writeKline）。
// 复用 data.fetchKline（多源链 + 熔断），仅串行 + 间隔，避免轰接口。
const { fetchKline } = require('./data');
const { readKline, readKlineStats } = require('./storage');
const { shanghaiClock, isAfterCnMarketClose } = require('./market-session');

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
  failed: 0,
  skipped: 0,
  current: '',
  errorsList: [],
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
    failed: state.failed,
    skipped: state.skipped,
    current: state.current,
    errorsList: state.errorsList.slice(0, 50),
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
  state.failed = 0;
  state.skipped = 0;
  state.current = '';
  state.errorsList = [];
  try {
    const stats = await readKlineStats(codes);
    const statMap = new Map(stats.map((x) => [x.code, x]));
    const now = new Date();
    const clock = shanghaiClock(now);
    const closed = isAfterCnMarketClose(now);
    const today = clock.date;
    for (const code of codes) {
      if (!state.running) break;
      state.current = code;
      const meta = statMap.get(code);
      const saved = meta && meta.savedAt ? new Date(meta.savedAt) : null;
      const savedHour = saved && !Number.isNaN(saved.getTime()) ? Number(saved.toLocaleString('en-US', { timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false })) : -1;
      const savedDay = saved && !Number.isNaN(saved.getTime()) ? saved.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }) : '';
      if (closed && meta && meta.latestDate === today && savedDay === today && savedHour >= 15) {
        state.skipped += 1;
        state.done += 1;
        continue;
      }
      try {
        const k = await fetchKline(code, { lmt, dataSource: 'live' });
        if (k && k.length) state.ok += 1;
        else state.failed += 1;
      } catch (e) {
        state.failed += 1;
        if (!state.errorsList.some((x) => x.code === code)) {
          state.errorsList.push({ code, err: String((e && e.message) || e).slice(0, 120) });
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
