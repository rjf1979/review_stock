// 14:40 分时反推 → 次日早盘卖出的「纸面跟踪」调度器。
//
//   生成：当日 14:41 之后，调 tools/minute_reverse_score.py --stage generate，
//         预检 /api/decisions?tradeDate=T 后 POST /api/decisions（source=reverse-1440）。
//   结算：次日 10:31 之后，把上一决策日未回填的本通道记录交给
//         tools/minute_reverse_score.py --stage settle，再逐条 POST /api/decisions/settle。
//
// 只走本地 HTTP（固定 127.0.0.1:3110），绝不直接写 data/kline.db：
// storage.js 是 sql.js 内存库 + 整文件写回，外部进程直写会被覆盖。
// 数据未就绪 / 非交易日 / 服务未启动时打印原因继续等待，不做破坏性兜底。
//
// 用法：
//   node scripts/paper-track.js                 # 常驻，30 秒轮询
//   node scripts/paper-track.js --once          # 只跑一轮（验收用）
//   node scripts/paper-track.js --dry-run --once
//   node scripts/paper-track.js --synth-time 20260921T1441   # 时间旅行自检
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { shanghaiClock, isCnTradingDay, isTradingCalendarKnown, tradingCalendarNotice } = require('../market-session');

const ROOT = path.resolve(__dirname, '..');
const PY = path.join(ROOT, 'tools', 'minute_reverse_score.py');
const PAPER_DIR = path.join(ROOT, 'data', 'backtest', 'minute-reverse', 'paper');
const SOURCE = 'reverse-1440';
const DEFAULT_PORT = 3110;
const POLL_MS = 30 * 1000;
const GEN_AT = 14 * 60 + 41;   // 1441
const SETTLE_AT = 10 * 60 + 31; // 1031
const PY_TIMEOUT_MS = 30 * 60 * 1000;
const HTTP_RETRIES = 5;
const FAIL_BACKOFF_MS = [60e3, 3 * 60e3, 10 * 60e3, 20 * 60e3];

function parseArgs(argv) {
  const out = {
    dryRun: false, once: false, port: DEFAULT_PORT, top: 30,
    python: process.env.PAPER_TRACK_PYTHON || process.env.PYTHON || 'python',
    synthTime: '', date: '', force: '', minAmtWan: 0, verbose: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const val = () => argv[++i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--once') out.once = true;
    else if (a === '--verbose') out.verbose = true;
    else if (a === '--port') out.port = Number(val());
    else if (a === '--top') out.top = Number(val());
    else if (a === '--python') out.python = val();
    else if (a === '--synth-time') out.synthTime = String(val());
    else if (a === '--date') out.date = String(val()).replace(/-/g, '');
    else if (a === '--force') out.force = String(val());          // generate | settle
    else if (a === '--min-amt-wan') out.minAmtWan = Number(val());
    else throw new Error(`未知参数：${a}`);
  }
  if (!Number.isFinite(out.port) || out.port <= 0) out.port = DEFAULT_PORT;
  if (!Number.isFinite(out.top) || out.top < 0) out.top = 30;
  return out;
}

// ── 时钟（可被 --synth-time 覆盖，便于验收时「时间旅行」自检）────────
function nowClock(opts) {
  if (!opts.synthTime) return { ...shanghaiClock(), synthetic: false };
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})$/.exec(opts.synthTime);
  if (!m) throw new Error('--synth-time 需形如 20260921T1441');
  const [, y, mo, d, h, mi] = m;
  const at = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h) - 8, Number(mi)));
  return { ...shanghaiClock(at), synthetic: true };
}

function ymd(dateStr) { return String(dateStr || '').replace(/-/g, ''); }

// ── 纯函数（单元测试直接引用）──────────────────────────────────────
// 决定这一轮该做哪些动作：先结算上一决策日，再生成当日候选。
// 过 10:31 之后两个阶段都成立，所以必须一次返回多条，不能二选一。
function planTick(clock, opts, state = {}) {
  if (!isCnTradingDay0(clock)) return { actions: [], reason: '非交易日（周末或节假日）' };
  const tradeDate = opts.date || ymd(clock.date);
  if (opts.force) return { actions: [{ phase: opts.force, tradeDate, reason: '--force 指定' }], reason: '' };
  const actions = [];
  if (clock.minutes >= SETTLE_AT) {
    actions.push({ phase: 'settle', tradeDate, reason: `已过 ${SETTLE_AT}：结算上一决策日未回填记录` });
  }
  if (clock.minutes >= GEN_AT && state.synthDate !== tradeDate) {
    actions.push({ phase: 'generate', tradeDate, reason: `已过 ${GEN_AT}：生成当日 14:40 候选` });
  }
  return {
    actions,
    reason: actions.length ? '' : `未到触发时点（生成 ${GEN_AT} / 结算 ${SETTLE_AT}）`,
  };
}

// market-session 的判定只看时刻，不看 Date 的时区参数，这里统一用 clock 判一次。
function isCnTradingDay0(clock) {
  const [y, mo, d] = clock.date.split('-').map(Number);
  return isCnTradingDay(new Date(Date.UTC(y, mo - 1, d, 4, 0)));
}

// 同一 (tradeDate, code) 只允许一条：已被 pool 通道占用的代码不覆盖。
function splitPoolConflicts(rows = [], existing = []) {
  const busy = new Set(existing.filter((r) => String(r.source || '') !== SOURCE)
    .map((r) => String(r.code || '')));
  const kept = [];
  const skipped = [];
  for (const row of rows) {
    if (busy.has(String(row.code || ''))) skipped.push(String(row.code));
    else kept.push(row);
  }
  return { kept, skipped };
}

// 需要结算的记录：本通道 + 决策日早于今天 + 还没回填 settledAt。
function pendingSettleRows(existing = [], today) {
  const t = ymd(today);
  return (Array.isArray(existing) ? existing : []).filter((r) => String(r.source || '') === SOURCE
    && !r.settledAt && String(r.tradeDate || '') < t);
}

const SETTLE_FIELDS = ['actualEntryPrice', 'actualHigh', 'actualExitPrice',
  'actualRetHigh', 'actualRetExit', 'hit3'];

function buildSettlePatch(row = {}, settledAt) {
  const patch = { tradeDate: Number(row.tradeDate), code: String(row.code || '') };
  for (const k of SETTLE_FIELDS) patch[k] = row[k] === undefined ? null : row[k];
  patch.settledAt = settledAt || row.settledAt || new Date().toISOString();
  return patch;
}

module.exports = {
  SOURCE, DEFAULT_PORT, GEN_AT, SETTLE_AT, parseArgs, nowClock, ymd, planTick,
  splitPoolConflicts, pendingSettleRows, buildSettlePatch, SETTLE_FIELDS,
};

// ── 以下仅在直接运行时执行 ─────────────────────────────────────────
if (require.main !== module) return;

function log(msg) { console.log(`[paper ${new Date().toISOString()}] ${msg}`); }
function warn(msg) { console.error(`[paper ${new Date().toISOString()}] ${msg}`); }

function request(port, urlPath, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request({
      host: '127.0.0.1', port, path: urlPath, method,
      headers: payload
        ? { 'Content-Type': 'application/json', 'Content-Length': payload.length }
        : { 'Content-Type': 'application/json' },
    }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(text || '{}') }); } catch (e) { reject(new Error(`响应不是 JSON：${text.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function requestWithRetry(port, urlPath, method, body) {
  let lastErr = null;
  for (let i = 0; i < HTTP_RETRIES; i += 1) {
    try {
      const res = await request(port, urlPath, method, body);
      if (res.status >= 200 && res.status < 300) return res;
      lastErr = new Error(`HTTP ${res.status} ${JSON.stringify(res.data).slice(0, 200)}`);
      if (res.status < 500 && res.status !== 429) break;
    } catch (e) { lastErr = e; }
    await sleep(1000 * 2 ** i);
  }
  throw lastErr || new Error('请求失败');
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function runPython(opts, args) {
  const argv = [PY, ...args];
  if (opts.dryRun && !args.includes('--dry-run')) argv.push('--dry-run');
  const r = spawnSync(opts.python, argv, {
    cwd: ROOT, encoding: 'utf8', timeout: PY_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    // Windows 上子进程默认按 GBK 输出中文日志，必须显式要求 UTF-8，否则回显成乱码。
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  const tail = String(r.stdout || '').trim().split('\n').slice(-6).join(' | ');
  if (r.error) return { ok: false, reason: `无法执行 ${opts.python}：${r.error.message}`, tail };
  if (r.status !== 0) return { ok: false, reason: `打分工具退出码 ${r.status}`, tail };
  return { ok: true, tail };
}

function readJson(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

async function doGenerate(opts, tradeDate, state) {
  const out = path.join(PAPER_DIR, `${tradeDate}-candidates.json`);
  const args = ['--stage', 'generate', '--date', tradeDate, '--top', String(opts.top), '--out', out];
  if (opts.minAmtWan > 0) args.push('--min-amt-wan', String(opts.minAmtWan));
  const run = runPython(opts, args);
  if (!run.ok) return { ok: false, reason: run.reason, tail: run.tail };
  const doc = readJson(out);
  if (!doc || !Array.isArray(doc.decisions)) {
    return { ok: false, reason: `打分输出不可读：${out}` };
  }
  if (!doc.decisions.length) {
    return { ok: false, reason: `T=${tradeDate} 生成 0 条候选（扫描 ${doc.scanned} 只 / 命中 ${doc.scored} 只）；常见原因：T 日日线未就绪或 14:40 分钟线缺失` };
  }
  const current = await requestWithRetry(opts.port, `/api/decisions?tradeDate=${tradeDate}`, 'GET');
  const { kept, skipped } = splitPoolConflicts(doc.decisions, current.data.decisions || []);
  if (skipped.length) log(`跳过已被 pool 通道占用的 ${skipped.length} 只：${skipped.slice(0, 8).join(',')}`);
  if (!kept.length) return { ok: true, reason: '全部候选已被 pool 通道占用，无需写入' };
  if (opts.dryRun) {
    log(`[dry] 将写入 ${kept.length} 条（${kept.slice(0, 5).map((r) => r.code).join(',')}…）`
      + `，样本外基准 up3=${(doc.redline && doc.redline.baseHit3Pct) || '—'}%`);
    return { ok: true, reason: `dry-run 写入 ${kept.length} 条` };
  }
  const saved = await requestWithRetry(opts.port, '/api/decisions', 'POST', { decisions: kept });
  log(`已写入 ${saved.data.saved || 0} 条候选（T=${tradeDate}，source=${SOURCE}）`);
  return { ok: true, reason: `写入 ${saved.data.saved || 0} 条` };
}

async function doSettle(opts, today, state) {
  const list = await requestWithRetry(opts.port, '/api/decisions?limit=2000', 'GET');
  const pending = pendingSettleRows(list.data.decisions || [], today);
  if (!pending.length) return { ok: true, reason: '没有待结算记录' };
  const byDate = new Map();
  for (const row of pending) {
    const d = String(row.tradeDate);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(String(row.code));
  }
  let settled = 0;
  const notes = [];
  for (const [tradeDate, codes] of byDate) {
    const out = path.join(PAPER_DIR, `${tradeDate}-settle.json`);
    const run = runPython(opts, ['--stage', 'settle', '--date', tradeDate,
      '--codes', codes.join(','), '--out', out]);
    if (!run.ok) { notes.push(`${tradeDate}: ${run.reason}`); continue; }
    const doc = readJson(out);
    const rows = (doc && doc.rows) || [];
    if (!rows.length) {
      notes.push(`${tradeDate}: ${codes.length} 只均未结算（${JSON.stringify((doc && doc.skipped) || {})}）`);
      continue;
    }
    for (const row of rows) {
      if (opts.dryRun) continue;
      await requestWithRetry(opts.port, '/api/decisions/settle', 'POST', buildSettlePatch(row));
      settled += 1;
    }
    const miss = codes.filter((c) => !rows.some((r) => String(r.code) === c));
    if (miss.length) notes.push(`${tradeDate}: ${miss.length} 只未结算 ${miss.slice(0, 6).join(',')}`);
  }
  const tail = notes.length ? `；${notes.join('；')}` : '';
  if (opts.dryRun) return { ok: true, reason: `[dry] 将回填 ${pending.length} 条${tail}` };
  return { ok: true, reason: `回填 ${settled} 条${tail}` };
}

async function tick(opts, state) {
  const clock = nowClock(opts);
  if (!isTradingCalendarKnown(clock.date)) warn(tradingCalendarNotice(clock.date));
  const plan = planTick(clock, opts, state);
  if (!plan.actions.length) {
    if (opts.verbose) log(plan.reason);
    return;
  }
  for (const action of plan.actions) await runAction(opts, state, action);
}

async function runAction(opts, state, plan) {
  const key = `${plan.phase}:${plan.tradeDate}`;
  if (state.backoffUntil[key] > Date.now()) {
    const left = Math.ceil((state.backoffUntil[key] - Date.now()) / 1000);
    log(`${plan.phase} 阶段退避中（剩 ${left}s），跳过本轮`);
    return;
  }
  log(`${plan.phase}：${plan.reason}（T=${plan.tradeDate}）`);
  let result;
  try {
    result = plan.phase === 'generate'
      ? await doGenerate(opts, plan.tradeDate, state)
      : await doSettle(opts, plan.tradeDate, state);
  } catch (e) {
    result = { ok: false, reason: `本轮失败：${e.message}` };
  }
  if (result.ok) {
    log(`${plan.phase} 完成：${result.reason}`);
    state.fails = {};
    if (plan.phase === 'generate' && !opts.dryRun) state.synthDate = plan.tradeDate;
    return;
  }
  const n = (state.fails[key] || 0) + 1;
  state.fails[key] = n;
  const wait = FAIL_BACKOFF_MS[Math.min(n - 1, FAIL_BACKOFF_MS.length - 1)];
  state.backoffUntil[key] = Date.now() + wait;
  warn(`${plan.phase} 未完成（第 ${n} 次）：${result.reason}`
    + `${result.tail ? ` ｜${result.tail}` : ''}；${Math.round(wait / 1000)}s 后重试`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  fs.mkdirSync(PAPER_DIR, { recursive: true });
  const state = { fails: {}, backoffUntil: {}, synthDate: '' };
  log(`启动：端口 ${opts.port}／python ${opts.python}／Top ${opts.top}`
    + `${opts.dryRun ? '／dry-run' : ''}${opts.once ? '／单轮' : '／30s 轮询'}`);
  for (;;) {
    await tick(opts, state);
    if (opts.once) return;
    await sleep(POLL_MS);
  }
}

main().catch((e) => { warn(`致命错误：${e.stack || e.message}`); process.exit(1); });
