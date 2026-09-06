// 智诊盯盘 · 全市场日 K 预取（后台任务，可断点续传 + 队列模式 + 缺失日补全）
//
// 队列模式：生产者只负责联网取数（fetchKlineRaw，不落盘），取到即入内存队列；
//           消费者把队列按批写库（writeKline），网络等待与落盘相互重叠。
// 缺失日补全：先建全市场交易日窗口（recentTradingDates），对每只股票用日期索引
//           （readKlineDates）比对缺失日期；只有存在缺失日期的股票才联网，
//           已齐（或当天已抓过）直接跳过 → 后续几天无需整段重扫。
// 熔断：连续失败达到阈值 → 冷却（逐次翻倍封顶），一旦成功立即复位，避免轰接口。
// 重试：失败入队反复重试（单只最多 3 次后放弃并记错），直到全部成功或确认无数据。
// 补全耗时：每次运行结束（含中断/停止）把 {开始, 结束, 用时, 新增, 跳过, 失败, 来源}
//          追加到 data/prefetch_log.jsonl，供次日核验抓取满意度。

const fs = require('fs');
const path = require('path');
const { MARKETS, fetchMarketSnapshot, fetchKlineRaw, getLastKlineSource, todayStr } = require('./data');
const { readKline, readKlineDates, recentTradingDates, writeKline, flush, DATA_DIR } = require('./storage');

const DEFAULT_LMT = 250;
const DEFAULT_GAP_MS = 1100; // 串行间隔，与东财 clist 限流一致，避免触发接口封禁
const MAX_RETRY = 2;         // 单次拉取的重试次数（每次递增退避）
const CONSECUTIVE_FAIL_LIMIT = 6;  // 连续失败达该次数 → 触发冷却
const DRAIN_MAX_RETRY = 3;   // 失败队列里单只最多重试次数（超出则放弃并记错）
const DRAIN_MAX_PASSES = 60; // 失败队列最多整轮重试次数（防止接口永不复原时死循环）
const COOL_INIT_MS = 60_000;       // 初次冷却时长
const COOL_MAX_MS = 300_000;       // 冷却时长上限（5 分钟）
const COOL_STEP_MS = 200;          // 冷却时睡眠分片，保证可随时被停止
const WRITE_SYNC_EVERY = 40;       // 每消费 N 只导出一份 db 文件，避免崩溃丢进度

const state = {
  running: false,
  startedAt: 0,
  finishedAt: 0,
  markets: [],
  lmt: DEFAULT_LMT,
  today: '',
  total: 0,
  done: 0,
  fetched: 0,
  skipped: 0,
  errors: 0,
  written: 0,        // 已入队待写库（即已成功联网取到）
  dbSaved: 0,        // 已写入数据库
  processed: 0,      // 消费者已处理数量
  current: '',
  errorsList: [],
  consecutiveFails: 0,    // 连续拉取失败计数（用于熔断判断）
  reqCount: 0,            // 已请求股票计数（用于多源轮询）
  cooling: false,         // 是否处于冷却（接口被风控暂停）
  cooledAt: 0,            // 上次进入冷却的时间戳
  cooldownMs: COOL_INIT_MS, // 当前冷却时长
  completeToday: false,   // 所选市场 K 线今日已抓齐（闭市后无需重复抓取）
  needCount: 0,           // 本次判定为「存在缺失日、需联网」的股票数
  source: '',             // 最近一次成功取数平台
  queued: 0,              // 失败队列中待重试的股票数
  retryQueue: [],         // 内部：待重试代码
  retryMap: {},           // 内部：code → 已重试次数
};

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// 可被 stop 打断的睡眠：分片检查 running，避免冷却期间无法停止。
async function sleepInterruptible(ms) {
  let remaining = ms;
  while (remaining > 0) {
    if (!state.running) return false;
    const step = Math.min(COOL_STEP_MS, remaining);
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
    markets: state.markets.slice(),
    lmt: state.lmt,
    today: state.today,
    total: state.total,
    done: state.done,
    fetched: state.fetched,
    skipped: state.skipped,
    errors: state.errors,
    written: state.written,
    dbSaved: state.dbSaved,
    processed: state.processed,
    current: state.current,
    consecutiveFails: state.consecutiveFails,
    cooling: state.cooling,
    cooldownMs: state.cooldownMs,
    completeToday: state.completeToday,
    needCount: state.needCount,
    source: state.source,
    queued: state.queued,
    errorsList: state.errorsList.slice(0, 50),
  };
}

function countFail(code, message) {
  state.consecutiveFails += 1;
  if (!state.errorsList.some((x) => x.code === code)) {
    state.errorsList.push({ code, err: String(message).slice(0, 120) });
  }
}

function countError(code, message) {
  state.errors += 1;
  if (!state.errorsList.some((x) => x.code === code)) {
    state.errorsList.push({ code, err: String(message).slice(0, 120) });
  }
}

function markSuccess() {
  state.consecutiveFails = 0;
  state.cooldownMs = COOL_INIT_MS;
}

// 连续失败达到阈值 → 进入冷却，暂停一段时间再恢复。返回 false 表示已被外部停止。
async function maybeCoolDown() {
  if (state.consecutiveFails < CONSECUTIVE_FAIL_LIMIT) return true;
  state.cooling = true;
  state.cooledAt = Date.now();
  const wait = state.cooldownMs;
  const ok = await sleepInterruptible(wait);
  state.cooling = false;
  if (!ok) return false; // 冷却期间被停止
  state.consecutiveFails = Math.min(state.consecutiveFails, CONSECUTIVE_FAIL_LIMIT - 1);
  state.cooldownMs = Math.min(state.cooldownMs * 2, COOL_MAX_MS);
  return true;
}

// ── 消费者：把队列中的 {code,kline} 批量写入数据库 ──────────────────────
// 用互斥 + 一次性清空，避免与生产者并发重复写；生产者联网/限流睡眠时本函数被 await 让出
// 微任务，从而与网络请求真正重叠。
let writeQ = [];           // 待写库队列：{code, kline}
let consumerBusy = false;
let writeSyncCount = 0;
let needMap = {};          // code → 本窗口缺失日数（用于自适应取数天数）

async function pumpConsumer() {
  if (consumerBusy) return;
  consumerBusy = true;
  try {
    let guard = 0;
    while (writeQ.length) {
      const item = writeQ.shift();
      if (!item) {
        if (!writeQ.length) break;
        await sleep(10);
        continue;
      }
      try {
        const ok = await writeKline(item.code, item.kline, state.today);
        if (ok) state.dbSaved += 1;
      } catch { /* 单只写库失败可容忍，主循环已按熔断兜底 */ }
      state.processed += 1;
      writeSyncCount += 1;
      if (writeSyncCount >= WRITE_SYNC_EVERY) {
        writeSyncCount = 0;
        await flush();
      }
      if (++guard > 3000) { guard = 0; await flush(); } // 保险：防队列异常积压
    }
  } finally {
    consumerBusy = false;
  }
}

// ── 生产者：联网取单只 K 线（不落盘），成功即入队交由消费者写库 ────────
// 返回 'ok' / 'queued' / 'giveup'。
async function producerFetch(code, lmt) {
  // 自适应取数天数：只在缺失日附近拉取，避免每日整段重扫 250 日。
  // 缺失愈少拉愈少；新鲜个股（缺满窗口）仍需拉满 lmt。
  const missingFor = needMap[code];
  const fetchLmt = Math.max(8, Math.min(lmt, (Number.isFinite(missingFor) ? missingFor : lmt) + 8));
  let kline = [];
  let source = '';
  for (let attempt = 0; attempt <= MAX_RETRY && !kline.length; attempt += 1) {
    if (attempt > 0) await sleep(attempt * 1100); // 重试前线性退避
    try {
      const prefer = (state.reqCount % 2 === 0) ? 'tencent' : 'em';
      const r = await fetchKlineRaw(code, { lmt: fetchLmt, prefer });
      kline = (r && r.kline) || [];
      source = (r && r.source) || '';
    } catch (e) {
      if (attempt === MAX_RETRY) countFail(code, (e && e.message) || e);
    }
  }
  if (kline.length) {
    state.fetched += 1;
    state.written += 1;
    markSuccess();
    state.source = source || getLastKlineSource() || state.source;
    writeQ.push({ code, kline });
    pumpConsumer().catch(() => {}); // 不等待，让写库与下一次联网重叠
    delete state.retryMap[code];
    return 'ok';
  }
  // 失败：入队待重试（不立即记错），并累积熔断计数。
  countFail(code, '无 K 线数据');
  const retries = (state.retryMap[code] || 0) + 1;
  state.retryMap[code] = retries;
  if (retries > DRAIN_MAX_RETRY) {
    state.retryQueue = state.retryQueue.filter((c) => c !== code);
    state.queued = state.retryQueue.length;
    countError(code, '重试后仍无 K 线数据');
    return 'giveup';
  }
  if (!state.retryQueue.includes(code)) state.retryQueue.push(code);
  state.queued = state.retryQueue.length;
  return 'queued';
}

// 把本次预取的用时/结果追加到日志，供次日核验。
function writeTiming() {
  try {
    const now = Date.now();
    const record = {
      ts: new Date(now).toISOString(),
      date: state.today,
      markets: state.markets.slice(),
      lmt: state.lmt,
      total: state.total,
      done: state.done,
      fetched: state.fetched,
      skipped: state.skipped,
      errors: state.errors,
      written: state.written,
      dbSaved: state.dbSaved,
      source: state.source,
      cooling: state.cooling,
      completeToday: state.completeToday,
      needCount: state.needCount,
      startedAt: new Date(state.startedAt).toISOString(),
      finishedAt: new Date(state.finishedAt || now).toISOString(),
      elapsedMs: (state.finishedAt || now) - state.startedAt,
      complete: state.completeToday || (state.total > 0 && state.done >= state.total && state.errors === 0),
      stopped: state.finishedAt > 0 && state.startedAt > 0 && state.finishedAt < now,
    };
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(path.join(DATA_DIR, 'prefetch_log.jsonl'), JSON.stringify(record) + '\n', 'utf8');
  } catch { /* 日志失败不阻塞主流程 */ }
}

async function runPrefetch({ markets = [], lmt = DEFAULT_LMT, fresh = false, gapMs = DEFAULT_GAP_MS } = {}) {
  const selected = markets.length ? markets : Object.keys(MARKETS);
  const today = todayStr();

  state.running = true;
  state.startedAt = Date.now();
  state.finishedAt = 0;
  state.markets = selected.slice();
  state.lmt = lmt;
  state.today = today;
  state.total = 0;
  state.done = 0;
  state.fetched = 0;
  state.skipped = 0;
  state.errors = 0;
  state.written = 0;
  state.dbSaved = 0;
  state.processed = 0;
  state.reqCount = 0;
  state.current = '';
  state.completeToday = false;
  state.needCount = 0;
  state.source = '';
  state.consecutiveFails = 0;
  state.cooling = false;
  state.cooledAt = 0;
  state.cooldownMs = COOL_INIT_MS;
  state.queued = 0;
  state.retryQueue = [];
  state.retryMap = {};
  state.errorsList = [];
  writeQ = [];
  consumerBusy = false;
  writeSyncCount = 0;
  needMap = {};

  try {
    // 确保所选市场当日快照就绪（local 已命中则纯本地，缺的市场实时补拉）。
    const snapshot = await fetchMarketSnapshot({ markets: selected, dataSource: 'local', limit: Number.POSITIVE_INFINITY });
    const seen = new Set();
    const codes = [];
    for (const r of snapshot.records) {
      if (!seen.has(r.code)) { seen.add(r.code); codes.push(r.code); }
    }
    state.total = codes.length;

    // 用全市场交易日窗口做日期索引，判定哪只股票存在「缺失日期」→ 只对这些联网。
    // 已齐（窗口内无缺失）或已有深度 ≥ lmt → 跳过；浅缓存（如只抓到 20 日）会补足到目标天数。
    const anchor = snapshot.snapshotDate || today;
    const windowDates = await recentTradingDates(lmt, { anchor });
    needMap = {};   // 使用模块级变量，供生产者 producerFetch 读取缺失日数
    for (const code of codes) {
      if (!state.running) break;
      const allDates = await readKlineDates(code);
      const haveSet = new Set(allDates);
      const existing = await readKline(code);
      const cacheDate = existing ? String(existing.date || '') : '';
      // fresh：显式要求当日重拉 → 缓存日期非今日即视为陈旧，需重新联网覆盖。
      const stale = fresh && cacheDate !== today;
      // 上市日近似：取该股已落盘最早日期；窗口内早于上市日的日期视为新股/停牌前，不计入缺失。
      const firstDate = allDates.length ? allDates[0] : '';
      const win = firstDate ? windowDates.filter((d) => d >= firstDate) : windowDates;
      const missing = win.filter((d) => !haveSet.has(d));
      const deepOk = existing && Array.isArray(existing.kline) && existing.kline.length >= lmt;
      const complete = (win.length > 0 && missing.length === 0) || deepOk;
      if (!complete || stale) needMap[code] = stale ? windowDates.length : missing.length;
    }
    state.needCount = Object.keys(needMap).length;

    if (!state.running) {
      state.done = codes.length;
      state.skipped = codes.length;
      return getStatus();
    }
    if (!Object.keys(needMap).length) {
      // 全部抓齐：闭市后当天无需重复抓取。
      state.done = codes.length;
      state.skipped = codes.length;
      state.completeToday = true;
      state.current = '';
      return getStatus();
    }

    // 第一遍：正向扫全量。已齐/当天已抓的跳过；存在缺失的联网取数 → 入队 → 消费者写库。
    const needSet = new Set(Object.keys(needMap));
    for (const code of codes) {
      if (!state.running) break;
      state.current = code;
      const skip = !needSet.has(code);
      if (skip) {
        state.skipped += 1;
      } else {
        await producerFetch(code, lmt);
        if (gapMs > 0) {
          const okGap = await sleepInterruptible(gapMs);
          if (!okGap) break;
        }
        const okCool = await maybeCoolDown();
        if (!okCool) break;
      }
      state.done += 1;
    }

    // 第二遍：反复重试失败队列，直到全部成功、放弃或外部停止。
    let pass = 0;
    while (state.running && state.retryQueue.length && pass < DRAIN_MAX_PASSES) {
      pass += 1;
      const batch = state.retryQueue.slice();
      state.retryQueue = [];
      state.queued = 0;
      for (const code of batch) {
        if (!state.running) break;
        state.current = code;
        await producerFetch(code, lmt);
      }
      if (gapMs > 0) {
        const okGap = await sleepInterruptible(gapMs);
        if (!okGap) break;
      }
      const okCool = await maybeCoolDown();
      if (!okCool) break;
    }

    // 最后：把仍留在队列的（超出重试次数限制）记为错误。
    for (const code of state.retryQueue.slice()) {
      countError(code, '超出重试次数仍无 K 线数据');
    }
    state.retryQueue = [];
    state.queued = 0;
    state.retryMap = {};

    // 等消费者把已联网取到的数据全部写库（不依赖 running，写库期间保持消费）。
    const drainUntil = Date.now() + 30000;
    while ((writeQ.length || consumerBusy) && Date.now() < drainUntil) {
      await sleep(50);
    }
  } catch (e) {
    state.errors += 1;
    state.errorsList.push({ code: '', err: String((e && e.message) || e).slice(0, 200) });
  } finally {
    // 先确保已取到的数据落库，再记录耗时并结束，保证断点续抓依赖的缓存完整。
    const drainUntil = Date.now() + 5000;
    while ((writeQ.length || consumerBusy) && Date.now() < drainUntil) await sleep(20);
    writeTiming();
    await flush();
    state.running = false;
    state.finishedAt = Date.now();
    state.current = '';
    state.cooling = false;
  }
  return getStatus();
}

// 供 HTTP 端点使用：立即返回「已启动/已在跑」，后台执行，不阻塞响应。
function startPrefetch(opts = {}) {
  if (state.running) return { started: false, reason: 'running', ...getStatus() };
  runPrefetch(opts).catch(() => {});
  return { started: true, reason: 'started', ...getStatus() };
}

function stopPrefetch() {
  state.running = false;
  return getStatus();
}

module.exports = { startPrefetch, stopPrefetch, getStatus, runPrefetch, DEFAULT_LMT, DEFAULT_GAP_MS };
