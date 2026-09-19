// rsi_low_turn v4 本地命中扫描（只读本地 K 线库，不联网、不写库）
// 用途：验证「v4 形态接入智诊盯盘选股链路后」在真实本地 K 线上确实会选出票，
// 并给出信号日与信号后 20 个交易日内的高/低点表现，便于人工抽查。
// 用法：node tools/scan_rsi_low_turn_v4_hits.js [--days 60] [--limit 0] [--print 50]
//   --days  回看的交易日根数（默认 60，即最近约三个月）
//   --limit 只扫描前 N 只股票（0 = 全部，用于快速冒烟）
//   --print 打印多少条命中明细（默认 30）
const { listKlineDates, readKline } = require('../storage');
const { rsi } = require('../screener-core');
const { DEFAULT_RULES } = require('../rules-store');

// 参数直接取上线默认规则，避免工具与 rules-store 口径漂移。
const V4 = (DEFAULT_RULES.find((r) => r.id === 'rsi_low_turn') || {}).params
  || { period: 14, low: 18, drop_days: 60, drop_max: -30 };

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

const days = Math.max(1, Math.round(argValue('--days', 60)));
const limit = Math.max(0, Math.round(argValue('--limit', 0)));
const printTop = Math.max(0, Math.round(argValue('--print', 30)));
// --last-only：只看「最新一根 K 线就是信号日」的票，等价于当前选股链路会选出来的结果。
const lastOnly = process.argv.includes('--last-only');

// 与 PATTERNS.rsi_low_turn + rsiLowTurnEvidence 完全同一套判定，只是预先算一次 RSI 序列。
function scanCode(code, candles) {
  const out = [];
  const n = candles.length;
  if (n < V4.drop_days + 1) return out;
  const series = rsi(candles, V4.period);
  const start = lastOnly ? Math.max(V4.drop_days, n - 1) : Math.max(V4.drop_days, 1, n - days);
  for (let i = start; i < n; i++) {
    const prevRsi = Number(series[i - 1]);
    const curRsi = Number(series[i]);
    if (!Number.isFinite(prevRsi) || !Number.isFinite(curRsi)) continue;
    if (!(prevRsi < V4.low && curRsi > prevRsi)) continue;
    const base = Number(candles[i - V4.drop_days].close);
    const close = Number(candles[i].close);
    if (!(base > 0) || !Number.isFinite(close)) continue;
    const dropPct = (close / base - 1) * 100;
    if (!(dropPct <= V4.drop_max)) continue;
    // 信号后 20 个交易日的最高/最低收盘（仅描述性统计，不代表 v4 实际出场成交）
    const fwd = candles.slice(i + 1, i + 21).map((c) => Number(c.close)).filter((v) => Number.isFinite(v));
    const maxClose = fwd.length ? Math.max(...fwd) : null;
    const minClose = fwd.length ? Math.min(...fwd) : null;
    out.push({
      code,
      date: String(candles[i].date),
      close: Math.round(close * 100) / 100,
      rsi: Math.round(curRsi * 10) / 10,
      prevRsi: Math.round(prevRsi * 10) / 10,
      dropPct: Math.round(dropPct * 10) / 10,
      fwdDays: fwd.length,
      fwdMaxPct: maxClose == null ? null : Math.round((maxClose / close - 1) * 1000) / 10,
      fwdMinPct: minClose == null ? null : Math.round((minClose / close - 1) * 1000) / 10,
    });
  }
  return out;
}

async function main() {
  const all = await listKlineDates();
  const codes = limit > 0 ? all.slice(0, limit) : all;
  const hits = [];
  let scanned = 0;
  let skipped = 0;
  const started = Date.now();
  for (const code of codes) {
    const rec = await readKline(code);
    const candles = rec && Array.isArray(rec.kline) ? rec.kline : [];
    if (candles.length < V4.drop_days + 1) { skipped += 1; continue; }
    scanned += 1;
    for (const hit of scanCode(code, candles)) hits.push(hit);
    if (scanned % 500 === 0) console.error(`… 已扫描 ${scanned}/${codes.length} 只（命中 ${hits.length} 笔）`);
  }
  hits.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.code.localeCompare(b.code)));
  const dates = hits.map((h) => h.date).sort();
  const summary = {
    codesInDb: all.length,
    codesScanned: scanned,
    codesSkippedSampleTooShort: skipped,
    lookbackTradingDays: days,
    hits: hits.length,
    hitCodes: new Set(hits.map((h) => h.code)).size,
    firstHitDate: dates[0] || null,
    lastHitDate: dates[dates.length - 1] || null,
    elapsedMs: Date.now() - started,
  };
  console.log(JSON.stringify(summary, null, 2));
  for (const h of hits.slice(0, printTop)) {
    console.log(`${h.date}  ${h.code}  收 ${h.close}  RSI ${h.prevRsi}→${h.rsi}  60日 ${h.dropPct}%  后 20 日 高 ${h.fwdMaxPct}% / 低 ${h.fwdMinPct}%`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
