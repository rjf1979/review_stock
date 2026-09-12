// 智诊盯盘 · 统一日 K 同步。只同步本地行情与派生数据，不触发 AI 研判。
const { fetchKlineRaw } = require('./data');
const { readKline, writeKline, flush } = require('./storage');
const { decideKlineWrite, canSafelyRebuildUnverifiedSeries } = require('./kline-source-contract');
const watchlist = require('./watchlist');
const candidatePool = require('./candidate-pool');

const DEFAULT_LMT = 260;
const DEFAULT_GAP_MS = 350;
let active = null;
let pendingCodes = new Set();
let pendingScope = 'managed';
let lastStatus = { running: false, startedAt: 0, finishedAt: 0, checked: 0, changedCodes: [], results: [] };

function validCodes(codes) {
  return [...new Set((Array.isArray(codes) ? codes : []).map((x) => String(x || '').trim()).filter((x) => /^\d{6}$/.test(x)))];
}

function resolveManagedCodes(extraCodes = []) {
  return validCodes([
    ...watchlist.getList().map((x) => x && x.code),
    ...candidatePool.getList().map((x) => x && x.code),
    ...(Array.isArray(extraCodes) ? extraCodes : []),
  ]);
}

function resolveCodes(scope = 'managed', requestedCodes = []) {
  if (scope === 'watch') return validCodes(watchlist.getList().map((x) => x && x.code));
  if (scope === 'explicit') return validCodes(requestedCodes);
  return resolveManagedCodes(requestedCodes);
}

function normalizeBars(bars) {
  const byDate = new Map();
  for (const bar of Array.isArray(bars) ? bars : []) {
    const date = String(bar && bar.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const open = Number(bar.open), high = Number(bar.high), low = Number(bar.low), close = Number(bar.close);
    if (![open, high, low, close].every(Number.isFinite) || high < low || high < Math.max(open, close) || low > Math.min(open, close)) continue;
    const volume = bar.volume == null || bar.volume === '' ? NaN : Number(bar.volume);
    if (!Number.isFinite(volume) || volume < 0) continue;
    const item = { date, open, high, low, close, volume };
    if (Number.isFinite(Number(bar.amount))) item.amount = Number(bar.amount);
    byDate.set(date, item);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function sameBar(a, b) {
  if (!a || !b) return false;
  return ['open', 'high', 'low', 'close', 'volume', 'amount'].every((key) => {
    const av = a[key] == null ? null : Number(a[key]);
    const bv = b[key] == null ? null : Number(b[key]);
    return av === bv;
  });
}

function summaryFor(bars) {
  const last = bars[bars.length - 1] || null;
  const prev = bars[bars.length - 2] || null;
  return last ? {
    latestDate: last.date,
    price: last.close,
    changePct: prev && Number(prev.close) > 0 ? ((last.close - prev.close) / prev.close) * 100 : null,
  } : null;
}

async function syncOne(code, { lmt = DEFAULT_LMT } = {}) {
  const localRecord = await readKline(code);
  const localBars = normalizeBars(localRecord && localRecord.kline);
  const localByDate = new Map(localBars.map((bar) => [bar.date, bar]));
  const localLast = localBars[localBars.length - 1];
  try {
    const raw = await fetchKlineRaw(code, { lmt });
    const sourceBars = normalizeBars(raw && raw.kline);
    if (!sourceBars.length) {
      const attempts = Array.isArray(raw && raw.sourceAttempts) ? raw.sourceAttempts : [];
      const allErrors = attempts.length > 0 && attempts.every((x) => x.outcome === 'error' || x.outcome === 'cooldown');
      return {
        code, ok: false, checked: true, changed: false, appended: 0, overwritten: 0, changedDates: [],
        latestDate: localLast && localLast.date || '', sourceAttempts: attempts,
        errorCode: allErrors ? 'KLINE_SOURCE_UNAVAILABLE' : 'KLINE_SOURCE_EMPTY',
        error: allErrors ? '实时数据源暂不可用，请稍后重试' : '源无有效数据', retryable: allErrors,
      };
    }
    const sourceLast = sourceBars[sourceBars.length - 1];
    // 源仅返回更旧数据时绝不回退本地库。
    if (localLast && sourceLast.date < localLast.date) return { code, checked: true, changed: false, appended: 0, overwritten: 0, changedDates: [], latestDate: localLast.date, staleSource: true };
    const writes = [];
    let appended = 0;
    let overwritten = 0;
    for (const bar of sourceBars) {
      const existing = localByDate.get(bar.date);
      if (!existing) {
        // 只接受本地尾部及其后的日期，避免不同源历史复权差异反复抖动。
        if (!localLast || bar.date >= localLast.date) { writes.push(bar); appended++; }
      } else if (bar.date >= (localLast && localLast.date || '') && !sameBar(existing, bar)) {
        writes.push(bar); overwritten++;
      }
    }
    // 落盘前先判定复权口径相容性：口径冲突或无法验证时拒绝覆盖既有序列，要求重建。
    const decision = decideKlineWrite({ stored: localRecord, source: raw.source, adjustmentType: raw.adjustmentType });
    const metaOptions = {
      source: raw.source,
      adjustmentType: raw.adjustmentType,
      sourceLatestDate: raw.sourceLatestDate,
      fetchedAt: raw.fetchedAt,
      tailStatus: raw.tailStatus,
      tailConfirmedAt: raw.tailConfirmedAt,
    };
    const rebuild = canSafelyRebuildUnverifiedSeries({
      storedBars: localBars,
      incomingBars: sourceBars,
      source: raw.source,
      adjustmentType: raw.adjustmentType,
      decisionStatus: decision.status,
    });
    if (rebuild) {
      const written = await writeKline(code, sourceBars, sourceLast.date, { ...metaOptions, replaceSeries: true });
      if (!written) return { code, ok: false, checked: true, changed: false, appended: 0, overwritten: 0, changedDates: [], latestDate: localLast && localLast.date || '', errorCode: 'KLINE_REBUILD_FAILED', error: '本地 K 线整段重建失败，旧序列已保留', retryable: true, source: raw.source, sourceAttempts: raw.sourceAttempts || [] };
      return {
        code, ok: true, checked: true, changed: true, rebuilt: true,
        previousDepth: localBars.length, depth: sourceBars.length,
        appended: Math.max(0, sourceBars.length - localBars.length), overwritten: Math.min(sourceBars.length, localBars.length),
        changedDates: sourceBars.map((bar) => bar.date), latestDate: sourceLast.date,
        source: raw.source, sourceAdjustmentType: raw.adjustmentType, sourceAttempts: raw.sourceAttempts || [],
        tailStatus: raw.tailStatus || '', tailConfirmedAt: raw.tailConfirmedAt || '',
        writeDecision: 'full-rebuild-from-verified-source', summary: summaryFor(sourceBars),
      };
    }
    if (!decision.allowed) {
      return {
        code, ok: false, checked: true, changed: false, appended: 0, overwritten: 0, changedDates: [],
        latestDate: localLast && localLast.date || '',
        source: raw.source, sourceAdjustmentType: raw.adjustmentType, sourceAttempts: raw.sourceAttempts || [],
        errorCode: decision.code || 'KLINE_ADJUSTMENT_CONFLICT',
        error: decision.reason || '源复权口径与本地不一致，拒绝覆盖',
        retryable: false, action: decision.action || 'rebuild_required',
        writeDecision: decision.status, storedAdjustment: decision.storedAdjustment || '', storedSource: decision.storedSource || '',
      };
    }
    let metaRefreshed = false;
    if (writes.length) {
      const written = await writeKline(code, writes, sourceLast.date, metaOptions);
      if (!written) return { code, ok: false, checked: true, changed: false, appended: 0, overwritten: 0, changedDates: [], latestDate: localLast && localLast.date || '', errorCode: 'KLINE_WRITE_FAILED', error: '本地 K 线写入失败，请检查数据目录权限', retryable: true, source: raw.source, sourceAttempts: raw.sourceAttempts || [] };
    } else if (localRecord && localLast && sourceLast.date === localLast.date
      && (String(localRecord.tailStatus || '') !== String(raw.tailStatus || '')
        || String(localRecord.source || '') !== String(raw.source || '')
        || String(localRecord.adjustmentType || '') !== String(raw.adjustmentType || ''))) {
      // 序列内容未变时只刷新元数据（例如盘中暂定尾K在收盘后重新抓取到收盘数据）。
      metaRefreshed = await writeKline(code, [], sourceLast.date, metaOptions);
    }
    return {
      code,
      ok: true,
      source: raw.source || '',
      sourceAdjustmentType: raw.adjustmentType || '',
      sourceAttempts: raw.sourceAttempts || [],
      checked: true,
      changed: writes.length > 0 || Boolean(metaRefreshed),
      appended,
      overwritten,
      changedDates: writes.map((bar) => bar.date),
      latestDate: sourceLast.date,
      tailStatus: raw.tailStatus || '',
      tailConfirmedAt: raw.tailConfirmedAt || '',
      writeDecision: decision.status,
      warning: decision.warning || '',
      summary: summaryFor(sourceBars),
    };
  } catch (error) {
    return { code, ok: false, checked: true, changed: false, appended: 0, overwritten: 0, changedDates: [], latestDate: localLast && localLast.date || '', errorCode: 'KLINE_SYNC_FAILED', error: String(error && error.message || error).slice(0, 160), retryable: true };
  }
}

async function run(codes, options = {}) {
  const list = validCodes(codes);
  const state = { ok: true, scope: options.scope || 'managed', running: true, startedAt: Date.now(), finishedAt: 0, checked: 0, total: list.length, current: '', changedCodes: [], summaries: {}, results: [] };
  active = state;
  try {
    for (const code of list) {
      state.current = code;
      const result = await syncOne(code, options);
      state.results.push(result);
      state.checked++;
      if (result.changed) {
        state.changedCodes.push(code);
        if (result.summary) state.summaries[code] = result.summary;
      }
      if (options.gapMs !== 0 && state.checked < list.length) await new Promise((resolve) => setTimeout(resolve, Number(options.gapMs) || DEFAULT_GAP_MS));
    }
    if (state.changedCodes.length) {
      const flushed = await flush();
      if (!flushed) {
        state.ok = false;
        state.errorCode = 'KLINE_FLUSH_FAILED';
        state.error = 'K 线已写入内存，但保存到本地数据库失败，请重试';
        state.retryable = true;
      }
    }
    state.failedCodes = state.results.filter((x) => x.error).map((x) => x.code);
    state.ok = state.ok !== false;
  } finally {
    state.running = false;
    state.finishedAt = Date.now();
    state.current = '';
    lastStatus = { ...state, changedCodes: state.changedCodes.slice(), results: state.results.slice(), summaries: { ...state.summaries } };
    active = null;
  }
  return lastStatus;
}

function sync(extraCodes = [], options = {}) {
  const scope = options.scope || 'managed';
  const codes = resolveCodes(scope, extraCodes);
  if (active) {
    // 后续全局维护任务可以覆盖较窄的等待范围；否则保留最新窄范围请求。
    if (scope === 'managed' || !pendingCodes.size) pendingScope = scope;
    validCodes(extraCodes).forEach((code) => pendingCodes.add(code));
    return Promise.resolve({ ok: true, scope, running: true, queued: true, ...getStatus() });
  }
  return run(codes, options).then(async (result) => {
    if (pendingCodes.size) {
      const queued = [...pendingCodes];
      pendingCodes = new Set();
      // 补充并发期间新出现的临时代码；不阻塞本次响应。
      run(resolveCodes(pendingScope, queued), { ...options, scope: pendingScope }).catch(() => {});
      pendingScope = 'managed';
    }
    return { ok: true, running: false, queued: false, ...result };
  });
}

function getStatus() {
  const state = active || lastStatus;
  return { ...state, changedCodes: (state.changedCodes || []).slice(), results: (state.results || []).slice(), summaries: { ...(state.summaries || {}) } };
}

module.exports = { resolveManagedCodes, resolveCodes, normalizeBars, sameBar, syncOne, sync, getStatus };
