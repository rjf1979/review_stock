const assert = require('node:assert/strict');
const { normalizeKlineVolumeSeries, normalizeQuote, normalizeKlineVolume } = require('../data');
const { classifyStoredRatio, planMigrationForBars, applyMigrationToBars } = require('../kline-volume-migration');

// 构造 n 根日 K（日期升序、volume 全部可指定）。
function mkBars(volumes, startDay = 1) {
  return volumes.map((v, i) => {
    const day = String(startDay + i).padStart(2, '0');
    return { date: `2026-06-${day}`, open: 10, high: 11, low: 9, close: 10.5, volume: v };
  });
}
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)];

// ── 读侧兜底 normalizeKlineVolumeSeries ──────────────────────────
{
  // 历史为手（~1000）、末尾连续 3 根为股（~100000）：边界前 ×100。
  const vols = Array.from({ length: 30 }, () => 1000).concat([95000, 103000, 98000]);
  const out = normalizeKlineVolumeSeries(mkBars(vols));
  assert.equal(med(out.slice(0, 30).map((b) => b.volume)), 100000, '历史手数应整体 ×100');
  assert.equal(out[31].volume, 103000, '尾部股数柱保持不变');

  // 单根暴量（真实放量/复牌）不得触发：只有最后 1 根高量。
  const single = Array.from({ length: 30 }, () => 1000).concat([40000]);
  assert.equal(normalizeKlineVolumeSeries(mkBars(single))[0].volume, 1000, '单根高量不触发兜底');

  // 均匀序列原样保留（无法内部判定单位，交给迁移）。
  const uniform = Array.from({ length: 40 }, (_, i) => 5000 + i);
  assert.deepEqual(normalizeKlineVolumeSeries(mkBars(uniform)).map((b) => b.volume), uniform, '均匀序列不缩放');

  // 10 倍真实放量不触发（阈值 20×）。
  const surge = Array.from({ length: 30 }, () => 1000).concat([8000, 9000, 8500]);
  assert.equal(normalizeKlineVolumeSeries(mkBars(surge))[0].volume, 1000, '10 倍放量不触发');

  // 样本不足不判。
  assert.equal(normalizeKlineVolumeSeries(mkBars([10, 20, 30]))[0].volume, 10, '短序列不缩放');

  // 高量簇过长（>10 根）视为真实行情，不缩放。
  const longRun = Array.from({ length: 30 }, () => 1000).concat(Array.from({ length: 12 }, () => 98000));
  assert.equal(normalizeKlineVolumeSeries(mkBars(longRun))[0].volume, 1000, '持续高量行情不视为单位边界');
}

// ── 快照量归一 normalizeQuote（东财 f5 手 → 股）──────────────────
{
  const q = normalizeQuote({ f12: '002602', f14: '世纪华通', f2: 15.9, f5: 1082099, f6: 1716117396, f8: 3.2, f10: 1.8 });
  assert.equal(q.volume, 108209900, '快照手数应归一为股数');
  assert.equal(q.turnover, 3.2, '换手率不受影响');
  assert.equal(q.volumeRatio, 1.8, '量比不受影响');
  const closed = normalizeQuote({ f12: '002602', f14: '停牌', f18: 10 });
  assert.equal(closed.volume, null, '停牌无成交量时保持 null');
  assert.equal(normalizeKlineVolume(464263, 'tencent'), 46426300, '腾讯 K 线手数归一');
}

// ── 迁移：比值分类 ────────────────────────────────────────────────
{
  assert.equal(classifyStoredRatio(0.01), 'fix');
  assert.equal(classifyStoredRatio(1), 'ok');
  assert.equal(classifyStoredRatio(0.1), 'ambiguous', '灰色地带宁跳过不盲修');
  assert.equal(classifyStoredRatio(0), 'ambiguous');
  assert.equal(classifyStoredRatio(NaN), 'ambiguous');
}

// ── 迁移：整段计划 planMigrationForBars ──────────────────────────
{
  const source = mkBars(Array.from({ length: 30 }, (_, i) => 1000000 + i * 1000)); // 源已归一为股

  // 存储为手 → fix。
  const storedLots = mkBars(Array.from({ length: 30 }, (_, i) => 10000 + Math.floor(i / 10)));
  assert.equal(planMigrationForBars(storedLots, source).action, 'fix', '手存储应给出 fix 计划');

  // 存储为股 → ok。
  const storedShares = mkBars(Array.from({ length: 30 }, (_, i) => 1000000 + i * 1000));
  assert.equal(planMigrationForBars(storedShares, source).action, 'ok', '股存储无需修复');

  // 混合（历史手 + 尾部股）→ 仍为 fix，逐柱比值判定不误伤尾柱。
  const mixed = mkBars(Array.from({ length: 29 }, () => 10000).concat([1000000]));
  const mixedPlan = planMigrationForBars(mixed, source);
  assert.equal(mixedPlan.action, 'fix', '混合序列可修复');

  // 灰色地带比值 → skip。
  const weird = mkBars(Array.from({ length: 30 }, () => 100000));
  assert.equal(planMigrationForBars(weird, source).action, 'skip', '0.1 倍比值应跳过');

  // 重叠不足 → skip。
  assert.equal(planMigrationForBars(storedShares.slice(0, 2), source).action, 'skip', '重叠日不足应跳过');
}

// ── 迁移：逐柱应用 applyMigrationToBars ──────────────────────────
{
  const source = mkBars(Array.from({ length: 5 }, () => 1000000));
  const stored = [
    { date: '2026-06-01', open: 10, high: 11, low: 9, close: 10.5, volume: 10000 },
    { date: '2026-06-02', open: 10, high: 11, low: 9, close: 10.5, volume: 1000000, amount: 5 },
    { date: '2026-06-03', open: 10, high: 11, low: 9, close: 10.5, volume: 9800 },
  ];
  const out = applyMigrationToBars(stored, source);
  assert.equal(out[0].volume, 1000000, '手柱 ×100');
  assert.equal(out[1].volume, 1000000, '股柱保持不变');
  assert.equal(out[1].amount, 5, 'amount 等其他字段保留');
  assert.equal(out[2].volume, 980000, '混合序列逐柱修正');
  assert.equal(stored[0].volume, 10000, '不改写入参');
}

console.log('kline-volume.test 通过');
