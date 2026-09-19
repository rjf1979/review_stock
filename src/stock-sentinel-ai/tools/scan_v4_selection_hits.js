// 智诊盯盘 v4 选股结果扫描（只读本地 K 线库与本地基准缓存，不联网、不写库）
// 用途：把当前启用规则在真实本地 K 线上的命中情况列出来，验证两条超跌修复形态的选股效果。
// 形态判定走生产同一入口 detectSinglePatterns → matchKlinePattern，参数取 data/rules.json 现值，
// 不复制任何阈值，保证工具结果与盯盘、研判选出来的是同一批票。
// 用法：node tools/scan_v4_selection_hits.js [--days 60] [--limit 0] [--print 30] [--last-only]
//   --days      回看的交易日根数（默认 60）
//   --limit     只扫前 N 只（0 = 全部，用于冒烟）
//   --print     打印多少条命中明细（默认 30）
//   --last-only 只看最新一根 K 线就是信号日，等价于今天盯盘会选的票
const path = require('path');
const { DATA_DIR, listKlineDates, readKline } = require('../storage');
const { detectSinglePatterns, listEnabledRules } = require('../screener-core');
const { ensureBenchSeries, benchCloseLookup } = require('../bench-series');

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

const days = Math.max(1, Math.round(argValue('--days', 60)));
const limit = Math.max(0, Math.round(argValue('--limit', 0)));
const printTop = Math.max(0, Math.round(argValue('--print', 30)));
const lastOnly = process.argv.includes('--last-only');
const FORWARD_BARS = 20; // 信号后观察窗口，仅作描述性统计，不代表 v4 实际成交。

const round = (v, d = 1) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 10 ** d) / 10 ** d : null);

// 信号后 20 根收盘的最高/最低，用来人工抽查选出来以后大概怎么走。
function forwardStats(candles, i, close) {
  const fwd = candles.slice(i + 1, i + 1 + FORWARD_BARS).map((c) => Number(c.close)).filter((v) => Number.isFinite(v));
  if (!fwd.length || !(close > 0)) return { fwdDays: 0, fwdMaxPct: null, fwdMinPct: null };
  return {
    fwdDays: fwd.length,
    fwdMaxPct: round((Math.max(...fwd) / close - 1) * 100),
    fwdMinPct: round((Math.min(...fwd) / close - 1) * 100),
  };
}

async function main() {
  const rules = listEnabledRules().filter((r) => r.kind !== 'scan');
  if (!rules.length) throw new Error('当前没有启用的 K 线形态规则（检查 data/rules.json）');
  const benchSeries = await ensureBenchSeries({ allowNetwork: false });
  const benchLookup = benchSeries && benchSeries.available ? benchCloseLookup(benchSeries) : null;

  const all = await listKlineDates();
  const codes = limit > 0 ? all.slice(0, limit) : all;
  const hits = [];
  let scanned = 0;
  let skipped = 0;
  const started = Date.now();

  for (const code of codes) {
    const rec = await readKline(code);
    const candles = rec && Array.isArray(rec.kline) ? rec.kline : [];
    if (candles.length < 61) { skipped += 1; continue; }
    scanned += 1;
    const name = String((rec && rec.name) || '');
    const start = lastOnly ? candles.length - 1 : Math.max(1, candles.length - days);
    for (let i = start; i < candles.length; i++) {
      const view = candles.slice(0, i + 1);
      const { hits: matched } = detectSinglePatterns(view, { code, benchLookup });
      if (!matched.length) continue;
      const close = Number(candles[i].close);
      const fwd = forwardStats(candles, i, close);
      for (const m of matched) {
        hits.push({
          code,
          name,
          patternId: m.patternId,
          ruleLabel: m.ruleLabel,
          date: String(candles[i].date),
          close: round(close, 2),
          score: m.score,
          reason: m.reason,
          detail: m.detail,
          ...fwd,
        });
      }
    }
    if (scanned % 500 === 0) console.error(`… 已扫描 ${scanned}/${codes.length} 只（命中 ${hits.length} 笔）`);
  }

  hits.sort((a, b) => (a.date === b.date ? b.score - a.score : a.date < b.date ? 1 : -1));
  const perPattern = {};
  for (const rule of rules) {
    const own = hits.filter((h) => h.patternId === rule.patternId);
    const dates = own.map((h) => h.date).sort();
    const maxes = own.map((h) => h.fwdMaxPct).filter((v) => v != null);
    const mins = own.map((h) => h.fwdMinPct).filter((v) => v != null);
    perPattern[rule.patternId] = {
      label: rule.label,
      params: rule.params,
      hits: own.length,
      codes: new Set(own.map((h) => h.code)).size,
      firstHitDate: dates[0] || null,
      lastHitDate: dates[dates.length - 1] || null,
      forward20: {
        sample: maxes.length,
        avgMaxPct: maxes.length ? round(maxes.reduce((a, b) => a + b, 0) / maxes.length) : null,
        avgMinPct: mins.length ? round(mins.reduce((a, b) => a + b, 0) / mins.length) : null,
      },
    };
  }

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    dataDir: path.relative(process.cwd(), DATA_DIR) || '.',
    bench: {
      available: !!benchLookup,
      source: (benchSeries && benchSeries.source) || '',
      lastDate: (benchSeries && benchSeries.lastDate) || '',
      stale: !!(benchSeries && benchSeries.stale),
    },
    scanMode: lastOnly ? 'last_bar_only' : `lookback_${days}_trading_days`,
    codesInDb: all.length,
    codesScanned: scanned,
    codesSkippedSampleTooShort: skipped,
    totalHits: hits.length,
    perPattern,
    elapsedMs: Date.now() - started,
  }, null, 2));

  for (const h of hits.slice(0, printTop)) {
    console.log(`${h.date}  ${h.code} ${h.name}  ${h.patternId}  收 ${h.close}  分 ${h.score}  后20日 高 ${h.fwdMaxPct}% / 低 ${h.fwdMinPct}%`);
    console.log(`    ${h.reason}`);
  }
}

main().catch((e) => { console.error(String((e && e.stack) || e)); process.exit(1); });
