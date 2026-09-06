// 智诊盯盘 · 候选池批量 AI 研判队列
// 启动时冻结候选池股票清单与每只证据快照；逐只串行调用，可停止、可续跑、可只重试失败项。
// 幂等键由 judgment-core 内部处理：相同 evidenceHash 不重复计费，成功结果不因失败重试被覆盖。
const settings = require('./settings');
const aiAssist = require('./ai-assist');
const judgmentStore = require('./judgment-store');
const judgmentCore = require('./judgment-core');
const candidatePool = require('./candidate-pool');
const { recentTradingDates, getLastSuccessJudgment, listJudgmentAttempts, getAiPrompt } = require('./storage');

const DEFAULT_GAP_MS = 800;
const MAX_BATCH_ERRORS = 200;
const PREPARE_TIMEOUT_MS = 15000;
const DEFAULT_CONCURRENCY = 3;
const PREPARE_CONCURRENCY = 6;

const state = {
  running: false,
  batchId: '',
  retryOnly: false,
  startedAt: 0,
  finishedAt: 0,
  total: 0,
  done: 0,
  success: 0,
  failed: 0,
  formatError: 0,
  skipped: 0,
  noChange: 0,
  notReady: 0,
  current: '',
  currentName: '',
  errorsList: [],
  categories: { first: 0, failedRetry: 0, evidenceUpdate: 0, noChange: 0, notReady: 0 },
  plan: [],
  gapMs: DEFAULT_GAP_MS,
  concurrency: DEFAULT_CONCURRENCY,
  phase: 'idle',
  prepareDone: 0,
  prepareTotal: 0,
};
let eventSink = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function firstStageConfig(ai) {
  const base = ai && typeof ai === 'object' ? ai : {};
  return base.first && typeof base.first === 'object' ? { ...base, ...base.first } : base;
}

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

function resetState(opts = {}) {
  state.running = false;
  state.batchId = '';
  state.retryOnly = opts.retryOnly === true;
  state.startedAt = 0;
  state.finishedAt = 0;
  state.total = 0;
  state.done = 0;
  state.success = 0;
  state.failed = 0;
  state.formatError = 0;
  state.skipped = 0;
  state.noChange = 0;
  state.notReady = 0;
  state.current = '';
  state.currentName = '';
  state.errorsList = [];
  state.categories = { first: 0, failedRetry: 0, evidenceUpdate: 0, noChange: 0, notReady: 0 };
  state.plan = [];
  state.gapMs = Number(opts.gapMs) >= 100 ? Number(opts.gapMs) : DEFAULT_GAP_MS;
  state.concurrency = Math.min(5, Math.max(1, Number(opts.concurrency) || DEFAULT_CONCURRENCY));
  state.phase = 'preparing';
  state.prepareDone = 0;
  state.prepareTotal = 0;
}

function getStatus() {
  const started = Number(state.startedAt) || 0;
  const finished = Number(state.finishedAt) || 0;
  return {
    running: state.running,
    batchId: state.batchId,
    retryOnly: state.retryOnly,
    startedAt: started,
    finishedAt: finished,
    durationMs: state.running ? Date.now() - started : Math.max(0, finished - started),
    total: state.total,
    done: state.done,
    success: state.success,
    failed: state.failed,
    formatError: state.formatError,
    skipped: state.skipped,
    noChange: state.noChange,
    notReady: state.notReady,
    current: state.current,
    currentName: state.currentName,
    errorsList: state.errorsList.slice(0, 50),
    categories: { ...state.categories },
    gapMs: state.gapMs,
    concurrency: state.concurrency,
    phase: state.phase,
    prepareDone: state.prepareDone,
    prepareTotal: state.prepareTotal,
  };
}

function saveBatchSnapshot(reason = 'running') {
  if (!state.batchId) return;
  const status = getStatus();
  judgmentStore.saveBatch({
    batchId: state.batchId,
    retryOnly: state.retryOnly,
    startedAt: status.startedAt,
    finishedAt: reason === 'running' ? 0 : status.finishedAt,
    durationMs: reason === 'running' ? 0 : status.durationMs,
    reason,
    total: status.total,
    done: status.done,
    success: status.success,
    failed: status.failed,
    formatError: status.formatError,
    skipped: status.skipped,
    noChange: status.noChange,
    notReady: status.notReady,
    categories: status.categories,
    errorsList: status.errorsList,
    concurrency: status.concurrency,
  });
  if (eventSink) eventSink({ type: 'batch.status', status });
}

async function retryableFailure(code) {
  const attempts = await listJudgmentAttempts(code, 500);
  if (!attempts.length) return false;
  const last = attempts[attempts.length - 1];
  return last && (last.judgmentStatus === 'failed' || last.judgmentStatus === 'format_error');
}

async function classify(code, prepared, model, retryOnly) {
  if (prepared.dataStatus === 'not_ready') return { type: 'notReady' };
  const last = await getLastSuccessJudgment(code);
  if (last && Number(last.finishedAt) > 0 && Date.now() - Number(last.finishedAt) < 60 * 60 * 1000) return { type: 'noChange' };
  if (last && judgmentCore.detectMarketPhase(prepared.snapshotDate, prepared.read && prepared.read.klineDate) === 'closed'
      && String(last.tradeDate || '') === String(prepared.snapshotDate || '')) return { type: 'noChange' };
  if (last && judgmentCore.sameEvidenceAsLast(prepared, last, model)) return { type: 'noChange' };
  if (last) return { type: 'evidenceUpdate' };
  if (await retryableFailure(code)) return { type: 'failedRetry' };
  return { type: 'first' };
}

async function buildPlan(retryOnly) {
  const cfg = settings.load().ai || {};
  const model = String(firstStageConfig(cfg).model || '');
  const fetchDays = Math.round(Number(settings.load().fetchDays) || 250);
  const calendar = await recentTradingDates(Math.max(500, fetchDays * 3));
  const poolItems = candidatePool.getList();
  const seen = new Set();
  const codes = [];
  for (const item of poolItems) {
    const code = String((item && item.code) || '').trim();
    if (!/^\d{6}$/.test(code) || seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
  }

  const plan = [];
  state.prepareTotal = codes.length;
  const categories = { first: 0, failedRetry: 0, evidenceUpdate: 0, noChange: 0, notReady: 0 };
  const errorsList = [];
  let prepareCursor = 0;
  const prepareOne = async () => { while (state.running) {
    const code = codes[prepareCursor++];
    if (!code) return;
    state.current = code;
    const item = poolItems.find((x) => String(x.code) === code);
    state.currentName = item ? String(item.name || '') : '';
    let prepared;
    try {
      prepared = await Promise.race([
        judgmentCore.prepareCode(code, { fetchDays, calendar }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('准备证据超时')), PREPARE_TIMEOUT_MS)),
      ]);
    } catch (e) {
      if (errorsList.length < MAX_BATCH_ERRORS) {
        errorsList.push({ code, type: 'prepare', err: String((e && e.message) || e).slice(0, 160) });
      }
      state.prepareDone += 1;
      saveBatchSnapshot('running');
      continue;
    }
    state.prepareDone += 1;
    saveBatchSnapshot('running');
    const cls = await classify(code, prepared, model, retryOnly);
    if (retryOnly && cls.type !== 'failedRetry') continue;
    categories[cls.type] += 1;
    plan.push({ code, name: prepared.name, prepared, type: cls.type });
  } };
  await Promise.all(Array.from({ length: Math.min(PREPARE_CONCURRENCY, codes.length || 1) }, prepareOne));
  return { plan, categories, errorsList };
}

/**
 * 批量研判前预览：不发起任何调用，只返回分类数量与预计调用次数，供前端确认弹窗展示。
 * 使用轻量 statusForCode 分类，避免整池逐只 prepareCode 计算价位/指标并写库导致超时。
 */
async function preview({ retryOnly = false } = {}) {
  const custom = await getAiPrompt();
  if (!custom || !String(custom.prompt || '').trim()) {
    return { ok: false, reason: 'prompt_required', message: '请先在设置中配置并保存专业操盘 Prompt', categories: { first: 0, failedRetry: 0, evidenceUpdate: 0, noChange: 0, notReady: 0 }, total: 0, expectedCalls: 0 };
  }
  const cfg = settings.load().ai || {};
  const ready = aiAssist.configReady(firstStageConfig(cfg));
  if (!ready.ok) {
    return { ok: false, reason: 'config', message: ready.message, categories: { first: 0, failedRetry: 0, evidenceUpdate: 0, noChange: 0, notReady: 0 }, total: 0, expectedCalls: 0 };
  }
  const fetchDays = Math.round(Number(settings.load().fetchDays) || 250);
  const calendar = await recentTradingDates(Math.max(500, fetchDays * 3));
  const poolItems = candidatePool.getList();
  const seen = new Set();
  const categories = { first: 0, failedRetry: 0, evidenceUpdate: 0, noChange: 0, notReady: 0 };
  const errorsList = [];
  for (const item of poolItems) {
    const code = String((item && item.code) || '').trim();
    if (!/^\d{6}$/.test(code) || seen.has(code)) continue;
    seen.add(code);
    let st;
    try {
      st = await judgmentCore.statusForCode(code, { fetchDays, calendar });
    } catch (e) {
      if (errorsList.length < MAX_BATCH_ERRORS) {
        errorsList.push({ code, type: 'prepare', err: String((e && e.message) || e).slice(0, 160) });
      }
      continue;
    }
    let type;
    if (st.dataStatus === 'not_ready') type = 'notReady';
    else if (!st.lastSuccess) type = st.hasFailure ? 'failedRetry' : 'first';
    else {
      const lastDates = (st.lastSuccess.evidenceDates || {});
      const changed = (lastDates.klineDate || '') !== (st.klineDate || '')
        || (lastDates.snapshotDate || '') !== (st.snapshotDate || '');
      type = changed ? 'evidenceUpdate' : 'noChange';
    }
    if (retryOnly && type !== 'failedRetry') continue;
    categories[type] += 1;
  }
  const expectedCalls = categories.first + categories.failedRetry + categories.evidenceUpdate;
  return {
    ok: true,
    categories,
    total: categories.first + categories.failedRetry + categories.evidenceUpdate + categories.noChange + categories.notReady,
    expectedCalls,
    errorsList: errorsList.slice(0, 50),
  };
}

async function run({ retryOnly = false, gapMs = DEFAULT_GAP_MS } = {}) {
  if (state.running) return { started: false, reason: 'running', ...getStatus() };
  const custom = await getAiPrompt();
  if (!custom || !String(custom.prompt || '').trim()) {
    return { started: false, reason: 'prompt_required', message: '请先在设置中配置并保存专业操盘 Prompt', ...getStatus() };
  }
  const cfg = settings.load().ai || {};
  const ready = aiAssist.configReady(firstStageConfig(cfg));
  if (!ready.ok) {
    return { started: false, reason: 'config', message: ready.message, ...getStatus() };
  }

  resetState({ retryOnly, gapMs });
  state.running = true;
  state.startedAt = Date.now();
  state.batchId = 'batch_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

  try {
    const built = await buildPlan(retryOnly);
    state.plan = built.plan;
    state.phase = 'judging';
    state.categories = built.categories;
    state.errorsList = built.errorsList.slice(0, MAX_BATCH_ERRORS);
    state.total = state.plan.length;
    state.done = 0;
    saveBatchSnapshot('running');

    let cursor = 0;
    const runOne = async () => {
      while (state.running) {
        const item = state.plan[cursor++];
        if (!item) return;
        state.current = item.code;
        state.currentName = item.name || '';
        if (item.type === 'noChange' || item.type === 'notReady') {
          if (item.type === 'noChange') state.noChange += 1;
          else state.notReady += 1;
        } else {
          try {
            const res = await judgmentCore.judgePrepared(item.prepared, { batchId: state.batchId });
            if (res.judgmentStatus === 'success') state.success += 1;
            else if (res.judgmentStatus === 'format_error') state.formatError += 1;
            else if (res.judgmentStatus === 'failed') state.failed += 1;
            else state.skipped += 1;
            if (res.judgmentStatus === 'failed' && state.errorsList.length < MAX_BATCH_ERRORS) state.errorsList.push({ code: item.code, type: 'judge', err: res.message || res.errorCode || '调用失败' });
          } catch (e) {
            state.failed += 1;
            if (state.errorsList.length < MAX_BATCH_ERRORS) state.errorsList.push({ code: item.code, type: 'judge', err: String((e && e.message) || e).slice(0, 160) });
          }
        }
        state.done += 1;
        saveBatchSnapshot('running');
        if (state.gapMs > 0) await sleepInterruptible(state.gapMs);
      }
    };
    await Promise.all(Array.from({ length: Math.min(state.concurrency, state.plan.length || 1) }, runOne));
  } finally {
    state.running = false;
    state.finishedAt = Date.now();
    state.current = '';
    state.currentName = '';
    saveBatchSnapshot(state.done >= state.total ? 'completed' : 'stopped');
  }
  return getStatus();
}

async function start(opts = {}) {
  if (state.running) return { started: false, reason: 'running', ...getStatus() };
  const custom = await getAiPrompt();
  if (!custom || !String(custom.prompt || '').trim()) return { started: false, reason: 'prompt_required', message: '请先在设置中配置并保存专业操盘 Prompt', ...getStatus() };
  const cfg = settings.load().ai || {};
  const ready = aiAssist.configReady(firstStageConfig(cfg));
  if (!ready.ok) return { started: false, reason: 'config', message: ready.message, ...getStatus() };
  run(opts).catch(() => {});
  return { started: true, reason: 'started', ...getStatus() };
}

function stop() {
  const wasRunning = state.running;
  state.running = false;
  return { stopped: wasRunning, ...getStatus() };
}

module.exports = { start, stop, getStatus, run, preview, DEFAULT_GAP_MS, setEventSink: (fn) => { eventSink = typeof fn === 'function' ? fn : null; } };
