// 智诊盯盘 · 次日上涨概率（决策模型 v2）Node 侧桥接。
//
// 职责边界：
//   * Python（tools/score_candidates.py）负责把 T 日尾盘个股特征按回测口径组装成 31 维输入并打分，
//     它是唯一的口径实现，Node 侧**不得**重算分档、系数或概率。
//   * 本模块只做三件事：按交易日缓存打分结果、按需触发一次批量打分、把结果挂到扫描候选上。
//
// 缓存位置：data/backtest/live_score_<YYYYMMDD>.json（与 Python 默认输出一致，便于人工核对）。
// 打分口径（caliber）必须随结果透传到界面：daily_close 与训练一致，其余为快照合成口径。
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const backtestStore = require('./backtest-store');
const { readPrescan } = require('./market-prescan-store');
const { shanghaiClock } = require('./market-session');

const ROOT = __dirname;
const SCRIPT = path.join(ROOT, 'tools', 'score_candidates.py');
const OUT_DIR = path.join(ROOT, 'data', 'backtest');
const TARGETS = ['up3', 'up5', 'limitUp'];
const SCORE_TIMEOUT_MS = 10 * 60 * 1000;
// 收盘口径的当日打分不会随时间改善；超过该时长仍允许复用，只有换日或显式 force 才重算。
const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

// 模型文件缺失/损坏时的最后兜底基准；正常路径读 decision_model.json 的 regimeBases / baseSampleHit3Pct。
const FALLBACK_BASE_HIT3 = 21.31;

let memCache = { date: '', key: '', data: null, at: 0 };
let job = { running: false, date: '', phase: 'idle', startedAt: 0, finishedAt: 0, error: '', requested: 0, scored: 0, skipped: 0, caliber: '' };

function pythonBin() {
  return process.env.SENTINEL_PYTHON || process.env.PYTHON || 'python';
}

function todayYmd() {
  return String(shanghaiClock().date || '').replace(/-/g, '');
}

function scorePath(date) {
  return path.join(OUT_DIR, `live_score_${date}.json`);
}

function featureCsvPath(date) {
  return path.join(OUT_DIR, `live_features_${date}.csv`);
}

function normalizeCode(value) {
  const s = String(value === undefined || value === null ? '' : value).trim();
  return /^\d{1,6}$/.test(s) ? s.padStart(6, '0') : s;
}

// ── 基准命中率 ─────────────────────────────────────────────
// 实盘必须带基准锚定：模型是 2% 抽样训练（基准 21.31%），不同市场环境的
// 真实基准在 17.97%~23.09% 之间，不锚定会系统性高估「弱市」、低估「强市」。
// 基准随模型文件一起固化（decision_model.json → regimeBases.buckets），不查 bt_stat：
// 库里同时存在多个批次时，按 dimension 取行会拿到别的批次（例如 69 日分时反推批）的分档，
// 于是界面显示的基准和真正算概率用的基准会不一致。模型文件是唯一权威来源。
let regimeBaseCache = { at: 0, map: null };

async function regimeBaseMap() {
  if (regimeBaseCache.map && Date.now() - regimeBaseCache.at < 10 * 60 * 1000) return regimeBaseCache.map;
  const map = new Map();
  try {
    const got = await backtestStore.decisionModel();
    const buckets = (got && got.model && got.model.regimeBases
      && got.model.regimeBases.buckets) || {};
    for (const bucket of Object.keys(buckets)) {
      const hit3 = Number(buckets[bucket] && buckets[bucket].up3);
      if (bucket && Number.isFinite(hit3)) map.set(bucket, hit3);
    }
  } catch { /* 模型不可用时退回模型基准 / 常量 */ }
  regimeBaseCache = { at: Date.now(), map };
  return map;
}

async function baseHit3For(regime) {
  const map = await regimeBaseMap();
  const hit = map.get(String(regime || ''));
  if (Number.isFinite(hit)) return { value: hit, source: 'model.regimeBases' };
  try {
    const got = await backtestStore.decisionModel();
    const v = Number(got && got.model && got.model.baseSampleHit3Pct);
    if (Number.isFinite(v) && v > 0) return { value: v, source: 'model.baseSampleHit3Pct' };
  } catch { /* 落到常量兜底 */ }
  return { value: FALLBACK_BASE_HIT3, source: 'fallback' };
}

// 模型身份：bt_decision 的 runId / runKey 必须指向模型文件的真实批次。
// 写死 runId=1 会在旧批次被清出后让实盘凭据指错行，跨库追溯时看不到真实来源。
async function modelIdentity() {
  try {
    const got = await backtestStore.decisionModel();
    const m = (got && got.model) || {};
    const rid = Number(m.runId);
    return {
      runId: Number.isFinite(rid) ? rid : null,
      runKey: String(m.runKey || ''),
      version: String(m.version || ''),
    };
  } catch {
    return { runId: null, runKey: '', version: '' };
  }
}

// ── 缓存读写 ───────────────────────────────────────────────
function readScoreFile(date) {
  const file = scorePath(date);
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (String(data.date || '') !== String(date)) return null;
    return { data, file, mtimeMs: st.mtimeMs, size: st.size, ageMs: Date.now() - st.mtimeMs };
  } catch {
    return null;
  }
}

function coveredCodes(data) {
  const set = new Set();
  for (const item of (data && data.items) || []) set.add(normalizeCode(item.code));
  for (const item of (data && data.skipped) || []) set.add(normalizeCode(item.code));
  return set;
}

function missingCodes(data, codes) {
  const have = coveredCodes(data);
  return codes.map(normalizeCode).filter((code) => code && !have.has(code));
}

function cachedScores(date, codes = null) {
  const hit = readScoreFile(date);
  if (!hit) return null;
  if (codes && codes.length && missingCodes(hit.data, codes).length) return null;
  if (hit.ageMs > CACHE_MAX_AGE_MS && codes === null) return null;
  return hit;
}

// ── 批量打分 ───────────────────────────────────────────────
function runScorer({ date, codes, base, baseRegime, outJson, outCsv, targets = TARGETS }) {
  return new Promise((resolve) => {
    const listFile = path.join(os.tmpdir(), `sentinel_codes_${date}_${process.pid}_${Date.now()}.txt`);
    try {
      fs.writeFileSync(listFile, codes.join('\n'), 'utf8');
    } catch (e) {
      resolve({ ok: false, error: `候选清单写入失败：${e.message}` });
      return;
    }
    const args = [SCRIPT, '--date', String(date), '--codes-file', listFile,
      '--targets', targets.join(','), '--out-json', outJson, '--out-csv', outCsv];
    if (base) args.push('--base', String(base));
    if (baseRegime) args.push('--base-regime', String(baseRegime));
    let child;
    try {
      child = spawn(pythonBin(), args, {
        cwd: ROOT,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        windowsHide: true,
      });
    } catch (e) {
      resolve({ ok: false, error: `无法启动 Python（${pythonBin()}）：${e.message}` });
      return;
    }
    let stdout = ''; let stderr = ''; let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { child.kill(); } catch { /* 已退出 */ } }, SCORE_TIMEOUT_MS);
    child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    const done = (result) => {
      clearTimeout(timer);
      try { fs.unlinkSync(listFile); } catch { /* 临时文件可能已被清理 */ }
      resolve(result);
    };
    child.on('error', (e) => done({ ok: false, error: `Python 启动失败：${e.message}` }));
    child.on('close', (code) => {
      const tail = (stdout + stderr).trim().split('\n').slice(-12).join('\n');
      if (timedOut) { done({ ok: false, error: '打分超时（>10 分钟）', log: tail }); return; }
      if (code !== 0) { done({ ok: false, error: `打分进程退出码 ${code}`, log: tail }); return; }
      done({ ok: true, log: tail });
    });
  });
}

// 扫描范围：优先用最近一次市场预扫描的成分股范围，保证「每日一次全量打分」覆盖面稳定。
function prescanScopeCodes() {
  try {
    const stored = readPrescan();
    const codes = stored && Array.isArray(stored.scopeCodes) ? stored.scopeCodes : [];
    return codes.map(normalizeCode).filter((c) => /^\d{6}$/.test(c));
  } catch {
    return [];
  }
}

async function refresh({ date = '', codes = null, force = false, base = null, regime = '' } = {}) {
  const tradeDate = String(date || '').replace(/-/g, '') || todayYmd();
  if (job.running) return { ok: true, started: false, busy: true, status: jobStatus() };
  const requested = (codes && codes.length ? codes : prescanScopeCodes()).map(normalizeCode).filter((c) => /^\d{6}$/.test(c));
  if (!requested.length) return { ok: false, started: false, error: '没有可打分的股票范围（预扫描结果缺失）' };
  // 同交易日已有缓存时，用旧结果并集重算，避免子集打分把结果集缩小。
  const disk = readScoreFile(tradeDate);
  const union = new Set(requested);
  if (disk && !force) for (const code of coveredCodes(disk.data)) union.add(code);
  // 注意：Number(null) === 0 且会被判为有限值，必须显式排除空值，否则会退化成「不锚定」。
  const explicitBase = (base === null || base === undefined || base === '') ? NaN : Number(base);
  const effectiveRegime = String(regime || (disk && disk.data && disk.data.market && disk.data.market.regime) || '');
  const baseInfo = Number.isFinite(explicitBase) && explicitBase > 0
    ? { value: explicitBase, source: 'explicit', regime: '' }
    : { ...(await baseHit3For(effectiveRegime)), regime: effectiveRegime };

  job = { running: true, date: tradeDate, phase: 'running', startedAt: Date.now(), finishedAt: 0, error: '', requested: union.size, scored: 0, skipped: 0, caliber: '' };
  const started = await runScorer({
    date: tradeDate, codes: [...union],
    base: baseInfo.source === 'explicit' ? baseInfo.value : null,
    baseRegime: baseInfo.source === 'explicit' ? '' : baseInfo.regime,
    outJson: scorePath(tradeDate), outCsv: featureCsvPath(tradeDate),
  });
  const fresh = readScoreFile(tradeDate);
  if (!started.ok || !fresh) {
    job = { ...job, running: false, phase: 'failed', finishedAt: Date.now(), error: started.error || '打分结果文件缺失' };
    return { ok: false, started: true, error: job.error, log: started.log || '' };
  }
  fresh.data.baseHit3 = { value: baseInfo.value, source: baseInfo.source, regime: baseInfo.regime || '' };
  memCache = { date: tradeDate, key: '', data: fresh.data, at: Date.now() };
  job = {
    ...job, running: false, phase: 'done', finishedAt: Date.now(),
    scored: (fresh.data.items || []).length, skipped: (fresh.data.skipped || []).length,
    caliber: String(fresh.data.caliber || ''),
  };
  return { ok: true, started: true, status: jobStatus() };
}

function jobStatus() {
  return {
    running: job.running, date: job.date, phase: job.phase,
    startedAt: job.startedAt ? new Date(job.startedAt).toISOString() : null,
    finishedAt: job.finishedAt ? new Date(job.finishedAt).toISOString() : null,
    error: job.error || '', requested: job.requested, scored: job.scored, skipped: job.skipped, caliber: job.caliber || '',
  };
}

// 后台刷新：供扫描链路在结果缺失时补算，不阻塞当前请求。
function refreshInBackground(options = {}) {
  if (job.running) return { started: false, busy: true };
  refresh(options).catch((e) => {
    job = { ...job, running: false, phase: 'failed', finishedAt: Date.now(), error: String(e && e.message || e) };
  });
  return { started: true };
}

// ── 结果挂载 ───────────────────────────────────────────────
function scoreIndex(data) {
  const map = new Map();
  for (const item of (data && data.items) || []) map.set(normalizeCode(item.code), item);
  return map;
}

function probabilityView(item, caliber = '') {
  if (!item) return null;
  const probs = item.probs || {};
  return {
    up3: Number.isFinite(Number(probs.up3)) ? Number(probs.up3) : null,
    up5: Number.isFinite(Number(probs.up5)) ? Number(probs.up5) : null,
    limitUp: Number.isFinite(Number(probs.limitUp)) ? Number(probs.limitUp) : null,
    support: item.support || {},
    evidence: item.evidence || {},
    sector: item.sector || null,
    caliber: String(caliber || ''),
  };
}

function metaFor(data, { codes = [], missing = [], base = null } = {}) {
  const market = (data && data.market) || {};
  return {
    available: Boolean(data),
    asOf: (data && data.asOf) || null,
    caliber: (data && data.caliber) || '',
    caliberNote: caliberNote(data && data.caliber),
    scored: ((data && data.items) || []).length,
    skipped: ((data && data.skipped) || []).length,
    missing: missing.length,
    requested: codes.length,
    modelVersion: (data && data.model && data.model.version) || '',
    runId: (data && data.model && data.model.runId) || null,
    baseHit3Pct: base && Number.isFinite(base.value) ? Number(base.value.toFixed(3)) : null,
    baseSource: (base && base.source) || '',
    baseRegime: (base && base.regime) || (data && data.baseRegime) || '',
    baseByTarget: (data && data.baseByTarget) || {},
    marketRegime: market.regime || '',
    marketTemp: Number.isFinite(Number(market.tempScore)) ? Number(market.tempScore) : null,
    generatedAt: (data && data.generatedAt) || null,
    job: jobStatus(),
  };
}

function caliberNote(caliber) {
  if (caliber === 'daily_close') return 'T 日日线口径，与回测训练口径一致';
  if (caliber === 'close_snapshot') return 'T 日收盘快照合成日线，近似训练口径';
  if (caliber === 'intraday_snapshot') return '盘中快照合成日线，存在口径漂移，仅供盘中参考';
  if (caliber === 'mixed') return '日线与快照混合口径，存在口径漂移';
  return '未标注口径';
}

// ── 只读视图（供 /api/probability 与「先核对结果再入库」使用）──────────
// 概率分档：把全范围打分的分布摊开，才能判断某只票的高分是绝对高分还是当日普遍偏高。
const PROB_BUCKETS = [[30, '<30%'], [40, '30~40%'], [50, '40~50%'], [60, '50~60%'], [Infinity, '≥60%']];

function distributionView(items = []) {
  const counts = new Array(PROB_BUCKETS.length).fill(0);
  let scored = 0;
  for (const item of items) {
    const p = Number(item && item.probs && item.probs.up3);
    if (!Number.isFinite(p)) continue;
    scored += 1;
    for (let i = 0; i < PROB_BUCKETS.length; i += 1) {
      const lower = i === 0 ? -Infinity : PROB_BUCKETS[i - 1][0];
      if (p >= lower && p < PROB_BUCKETS[i][0]) { counts[i] += 1; break; }
    }
  }
  return PROB_BUCKETS.map((bucket, i) => ({
    label: bucket[1], count: counts[i],
    pct: scored ? Number(((counts[i] / scored) * 100).toFixed(2)) : 0,
  }));
}

// 单只股票视图：31 维特征 + 逐目标概率 + 支撑样本量 + 证据链，全部来自 Python 侧口径。
function compactItem(item) {
  return {
    code: normalizeCode(item.code),
    name: item.name || '',
    date: item.date || null,
    probs: item.probs || {},
    support: item.support || {},
    sector: item.sector || null,
    features: item.features || {},
    evidence: item.evidence || {},
  };
}

function orderedItems(data) {
  const items = (data && data.items) || [];
  return [...items].sort((a, b) => Number((b.probs || {}).up3 || 0) - Number((a.probs || {}).up3 || 0));
}

function summaryView(date = '', { top = 20 } = {}) {
  const target = String(date || '').replace(/-/g, '') || todayYmd();
  const hit = readScoreFile(target);
  const data = hit ? hit.data : null;
  const items = (data && data.items) || [];
  const limit = Math.max(1, Math.min(100, Number(top) || 20));
  return {
    date: target,
    available: Boolean(data),
    file: hit ? hit.file : scorePath(target),
    sizeBytes: hit ? hit.size : null,
    generatedAt: hit ? new Date(hit.mtimeMs).toISOString() : null,
    ageMinutes: hit ? Math.round(hit.ageMs / 60000) : null,
    caliber: (data && data.caliber) || '',
    caliberNote: caliberNote(data && data.caliber),
    model: (data && data.model) || null,
    market: (data && data.market) || null,
    bench: (data && data.bench) || null,
    baseByTarget: (data && data.baseByTarget) || {},
    baseRegime: (data && data.baseRegime) || '',
    // 基准锚点：v2 起由 Python 写进结果文件（baseHit3）；更早落盘的文件没有这个键，
    // 用文件里的逐目标基准回填，避免界面/凭据把「基准来源」显示成空。
    baseHit3: (data && data.baseHit3) || (data && Number.isFinite(Number(data.baseByTarget && data.baseByTarget.up3))
      ? {
        value: Number(data.baseByTarget.up3),
        source: 'score_file.baseByTarget',
        regime: (data && data.baseRegime) || '',
      }
      : null),
    scored: items.length,
    skipped: (data && data.skipped) || [],
    quoteErrors: (data && data.quoteErrors) || [],
    distribution: distributionView(items),
    top: orderedItems(data).slice(0, limit).map(compactItem),
    job: jobStatus(),
  };
}

function itemView(code, date = '') {
  const target = normalizeCode(code);
  if (!/^\d{6}$/.test(target)) return null;
  const view = summaryView(date, { top: 1 });
  if (!view.available) return null;
  const hit = readScoreFile(view.date);
  for (const item of (hit && hit.data && hit.data.items) || []) {
    if (normalizeCode(item.code) === target) {
      return { ...compactItem(item), caliber: view.caliber, caliberNote: view.caliberNote, baseByTarget: view.baseByTarget, baseRegime: view.baseRegime };
    }
  }
  return null;
}

// 把概率挂到扫描输出上：candidates / strongWatch / overQuota 三组同源同码，统一处理。
async function attachToScan(result, { date = '', regime = '' } = {}) {
  const groups = ['candidates', 'strongWatch', 'overQuota'];
  const codes = new Set();
  for (const key of groups) {
    for (const item of (result && result[key]) || []) {
      const code = normalizeCode(item.code);
      if (/^\d{6}$/.test(code)) codes.add(code);
    }
  }
  const tradeDate = String(date || (result && result.snapshotDate) || '').replace(/-/g, '') || todayYmd();
  if (!codes.size) {
    result.probabilityMeta = metaFor(null, { codes: [] });
    return result;
  }
  const list = [...codes];
  // 已有当日结果就挂上（哪怕只覆盖一部分），缺失的代码交给后台批量补齐。
  const hit = readScoreFile(tradeDate);
  const data = hit ? hit.data : (memCache.date === tradeDate ? memCache.data : null);
  const index = scoreIndex(data);
  const caliber = String((data && data.caliber) || '');
  let attached = 0;
  for (const key of groups) {
    result[key] = ((result && result[key]) || []).map((item) => {
      const view = probabilityView(index.get(normalizeCode(item.code)), caliber);
      if (view) attached += 1;
      return { ...item, probability: view };
    });
  }
  const missing = list.filter((code) => !index.has(code));
  const base = (data && data.baseHit3) || null;
  result.probabilityMeta = {
    ...metaFor(data, { codes: list, missing, base }),
    attached,
    hint: attached ? '' : (jobStatus().running
      ? '概率批量打分进行中，稍后重新扫描即可看到'
      : '尚未生成当日的次日概率，可在回测页触发「概率批量打分」'),
  };
  if (!data || missing.length) {
    refreshInBackground({ date: tradeDate, codes: missing.length ? missing : list, regime: regime || result.marketRegime?.status || '' });
  }
  return result;
}

// 供非扫描链路（如入池）复用同一套挂载逻辑：传入候选数组，拿回带 probability 的候选数组。
async function attachToItems(items = [], { date = '', regime = '' } = {}) {
  const wrapped = { candidates: Array.isArray(items) ? items : [], snapshotDate: date };
  await attachToScan(wrapped, { date, regime });
  return wrapped.candidates;
}

// 扫描/入池的候选 → bt_decision 行（实盘凭据）。概率缺失时不写伪值，保留 null 并在 reason 里说明。
function decisionRows(items = [], { tradeDate = '', runId = null, runKey = '', regime = '', marketTemp = null, base = null, source = 'scan' } = {}) {
  const rows = [];
  for (const item of items || []) {
    const code = normalizeCode(item.code);
    if (!/^\d{6}$/.test(code)) continue;
    const prob = item.probability || {};
    const up3 = Number(prob.up3);
    const up5 = Number(prob.up5);
    const limitUp = Number(prob.limitUp);
    const sector = prob.sector || {};
    rows.push({
      tradeDate: Number(String(tradeDate || item.snapshotDate || '').replace(/-/g, '')) || null,
      code,
      name: String(item.name || ''),
      runId: Number(runId) || null,
      runKey: runKey || null,
      score: Number.isFinite(Number(item.score)) ? Number(item.score) : null,
      up3Prob: Number.isFinite(up3) ? up3 : null,
      up5Prob: Number.isFinite(up5) ? up5 : null,
      limitUpProb: Number.isFinite(limitUp) ? limitUp : null,
      expectedRetHigh: null,
      expectedRetOpen: null,
      suggestedBuyTime: 1440,
      suggestedSellTime: 940,
      marketTemp: Number.isFinite(Number(marketTemp)) ? Number(marketTemp) : null,
      marketRegime: regime || null,
      sectorHeat: Number.isFinite(Number(sector.heat)) ? Number(sector.heat) : null,
      sectorUpRatio: Number.isFinite(Number(sector.upRatio)) ? Number(sector.upRatio) : null,
      evidenceJson: JSON.stringify({ caliber: prob.caliber || '', base, evidence: prob.evidence || {}, ruleLabel: item.ruleLabel || '' }),
      patternJson: JSON.stringify(item.pattern ? { pattern: item.pattern, patternScore: item.patternScore || 0 } : {}),
      confidence: confidenceOf(up3, prob),
      source,
      reason: buildReason(item, prob, base),
    });
  }
  return rows;
}

function confidenceOf(up3, prob = {}) {
  if (!Number.isFinite(up3)) return 'low';
  const caliber = String(prob.caliber || '');
  if (caliber === 'intraday_snapshot') return 'low';
  if (up3 >= 45) return caliber === 'daily_close' ? 'high' : 'medium';
  if (up3 >= 32) return 'medium';
  return 'low';
}

function buildReason(item, prob = {}, base = null) {
  const parts = [];
  if (Number.isFinite(Number(prob.up3))) parts.push(`次日≥+3% 概率 ${Number(prob.up3).toFixed(2)}%`);
  if (base && Number.isFinite(Number(base.value))) parts.push(`基准 ${Number(base.value).toFixed(2)}%`);
  if (item.ruleLabel) parts.push(`命中规则：${item.ruleLabel}`);
  if (prob.caliber) parts.push(`口径 ${prob.caliber}`);
  return parts.join('；');
}

module.exports = {
  TARGETS, scorePath, pythonBin, todayYmd,
  baseHit3For, regimeBaseMap, modelIdentity,
  cachedScores, readScoreFile, missingCodes, coveredCodes,
  refresh, refreshInBackground, jobStatus,
  attachToScan, attachToItems, decisionRows, caliberNote,
  summaryView, itemView, distributionView,
};
