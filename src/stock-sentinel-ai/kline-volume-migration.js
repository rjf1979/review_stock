// 智诊盯盘 · K 线量纲一次性迁移（docs/kline-data-standard.md §4）。
// 历史数据由旧版代码把腾讯/东财“手”直接入库；迁移不做量级猜测，
// 逐代码与实时源（源边界已归一为“股”）同日期比对，比值 ≤0.05 的柱 ×100 修正。
const fs = require('fs');
const { fetchKlineRaw } = require('./data');
const storage = require('./storage');

const MIGRATION_NAME = 'kline_volume_unit_v1';
const MATCH_WINDOW = 12;        // 最多比对最近 12 个重叠交易日
const MIN_OVERLAP = 3;          // 重叠日不足时无法判定
const FIX_MAX_RATIO = 0.05;     // stored/source ≤ 0.05 → 存储为“手”，需 ×100
const OK_MIN_RATIO = 0.2;       // 0.2～5 视为一致（容许盘中/复权噪声）
const OK_MAX_RATIO = 5;
const SOURCE_GAP_MS = 350;      // 与取数链一致的限速

// 单根比值分类：'fix'（手，需 ×100）/ 'ok'（正确）/ 'ambiguous'（灰色地带，宁跳过不盲修）。
function classifyStoredRatio(ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) return 'ambiguous';
  if (ratio <= FIX_MAX_RATIO) return 'fix';
  if (ratio >= OK_MIN_RATIO && ratio <= OK_MAX_RATIO) return 'ok';
  return 'ambiguous';
}

// 纯函数：对存储 K 线与已归一源 K 线输出迁移计划。
// 返回 { action: 'fix'|'ok'|'skip', reason?, matched }。
function planMigrationForBars(storedKline, sourceKline, { matchWindow = MATCH_WINDOW } = {}) {
  const sourceVolByDate = new Map((Array.isArray(sourceKline) ? sourceKline : []).map((b) => [String(b.date), Number(b.volume)]));
  const overlaps = (Array.isArray(storedKline) ? storedKline : [])
    .filter((bar) => {
      const sv = sourceVolByDate.get(String(bar && bar.date));
      return sv > 0 && Number(bar.volume) > 0;
    })
    .slice(-matchWindow);
  if (overlaps.length < MIN_OVERLAP) return { action: 'skip', reason: 'insufficient-overlap', matched: overlaps.length };
  let fix = 0;
  let ok = 0;
  for (const bar of overlaps) {
    const kind = classifyStoredRatio(Number(bar.volume) / sourceVolByDate.get(String(bar.date)));
    if (kind === 'ambiguous') {
      const ratio = Number(bar.volume) / sourceVolByDate.get(String(bar.date));
      return { action: 'skip', reason: `ambiguous-ratio:${Number.isFinite(ratio) ? ratio.toFixed(3) : 'nan'}`, matched: overlaps.length };
    }
    if (kind === 'fix') fix += 1;
    else ok += 1;
  }
  return fix ? { action: 'fix', factor: 100, matched: overlaps.length, matchedFix: fix } : { action: 'ok', matched: overlaps.length };
}

// 纯函数：按源逐柱应用 ×100（只动判定为“手”的柱，其余原样保留）。
function applyMigrationToBars(storedKline, sourceKline) {
  const sourceVolByDate = new Map((Array.isArray(sourceKline) ? sourceKline : []).map((b) => [String(b.date), Number(b.volume)]));
  return (Array.isArray(storedKline) ? storedKline : []).map((bar) => {
    const sv = sourceVolByDate.get(String(bar.date));
    if (sv > 0 && Number(bar.volume) > 0 && Number(bar.volume) / sv <= FIX_MAX_RATIO) {
      return { ...bar, volume: Math.round(Number(bar.volume) * 100) };
    }
    return bar;
  });
}

function backupDbFile(log) {
  try {
    const file = storage.DB_FILE;
    if (fs.existsSync(file)) {
      const target = `${file}.backup-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
      fs.copyFileSync(file, target);
      log(`[kline-volume-migration] 已备份 ${file} -> ${target}`);
    }
  } catch (e) {
    log(`[kline-volume-migration] 备份失败（继续迁移）：${e && e.message || e}`);
  }
}

// 执行迁移。dryRun 只输出计划不写库；force 忽略已应用标记（用于网络失败后的补跑）。
// sourceFetcher 可注入以便测试；默认 fetchKlineRaw（主源腾讯，健康链降级）。
async function run({ dryRun = false, force = false, gapMs = SOURCE_GAP_MS, sourceFetcher, log = () => {} } = {}) {
  if (!dryRun && !force) {
    const appliedAt = await storage.getMigration(MIGRATION_NAME);
    if (appliedAt) return { name: MIGRATION_NAME, ok: true, alreadyApplied: true, appliedAt };
  }
  const codes = await storage.listKlineDates();
  const report = { name: MIGRATION_NAME, dryRun, total: codes.length, fixed: [], ok: 0, skipped: [], changedBars: 0, startedAt: new Date().toISOString(), finishedAt: '' };
  if (!dryRun && codes.length) {
    await storage.flush();
    backupDbFile(log);
  }
  for (const code of codes) {
    const cached = await storage.readKline(code);
    const storedKline = cached && Array.isArray(cached.kline) ? cached.kline : [];
    if (!storedKline.length) { report.skipped.push({ code, reason: 'empty' }); continue; }
    let sourceKline = null;
    try {
      const fetched = sourceFetcher ? await sourceFetcher(code) : await fetchKlineRaw(code, { lmt: 260, prefer: 'tencent' });
      sourceKline = fetched && fetched.kline;
    } catch (e) {
      report.skipped.push({ code, reason: 'source-error:' + String(e && e.message || e).slice(0, 80) });
      continue;
    }
    const plan = planMigrationForBars(storedKline, sourceKline);
    if (plan.action === 'skip') { report.skipped.push({ code, reason: plan.reason }); continue; }
    if (plan.action === 'ok') { report.ok += 1; continue; }
    if (dryRun) { report.fixed.push({ code, bars: storedKline.length }); continue; }
    const fixed = applyMigrationToBars(storedKline, sourceKline);
    const changed = fixed.reduce((n, bar, i) => n + (Number(bar.volume) !== Number(storedKline[i].volume) ? 1 : 0), 0);
    // 保留原“抓取日期”，迁移只改量纲，不改变缓存时效语义。
    const written = await storage.writeKline(code, fixed, cached.date || '');
    if (!written) { report.skipped.push({ code, reason: 'write-failed' }); continue; }
    report.fixed.push({ code, bars: changed });
    report.changedBars += changed;
    log(`[kline-volume-migration] ${code} 修正 ${changed} 根（×100）`);
    if (gapMs) await new Promise((resolve) => setTimeout(resolve, gapMs));
  }
  if (!dryRun) {
    await storage.flush();
    await storage.setMigration(MIGRATION_NAME);
  }
  report.finishedAt = new Date().toISOString();
  return report;
}

// 服务启动钩子：有标记即跳过；异常只记日志，不阻塞启动。
async function maybeRun(options = {}) {
  const log = options && options.log || ((...args) => console.log(...args));
  try {
    const report = await run({ ...options, log });
    if (report.alreadyApplied) return report;
    log(`[kline-volume-migration] 完成：共 ${report.total} 码，修复 ${report.fixed.length}（${report.changedBars} 根），正常 ${report.ok}，跳过 ${report.skipped.length}${report.dryRun ? '（dryRun 未写库）' : ''}`);
    if (report.skipped.length) log(`[kline-volume-migration] 跳过明细：${JSON.stringify(report.skipped.slice(0, 20))}${report.skipped.length > 20 ? ' …' : ''}`);
    return report;
  } catch (e) {
    console.error('[kline-volume-migration] 执行失败：', e && e.message || e);
    return { name: MIGRATION_NAME, ok: false, error: String(e && e.message || e) };
  }
}

module.exports = { MIGRATION_NAME, classifyStoredRatio, planMigrationForBars, applyMigrationToBars, run, maybeRun };
