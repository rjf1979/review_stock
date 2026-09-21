// 纸面跟踪调度器自检（scripts/paper-track.js）：
//   1) 14:40 不触发 / 14:41 触发生成 / 10:31 起触发结算，且下午两个阶段都要跑；
//   2) 非交易日与非交易时段不得动作；
//   3) 同 (tradeDate, code) 只写一条：pool 通道占用的代码必须跳过；
//   4) 结算只挑「本通道 + 决策日早于今天 + 未回填」的记录，patch 字段与
//      storage.settleBtDecision 的六个 actual 列一致。
// 纯函数级自检，不启动 3110、不调 Python、不触碰 data/。
const assert = require('node:assert/strict');

const track = require('../scripts/paper-track');
const { shanghaiClock } = require('../market-session');

// 2026-09-21 是周一，2026-09-19 是周六。
function clockAt(dateStr, hhmm) {
  const h = String(Math.floor(hhmm / 100)).padStart(2, '0');
  const m = String(hhmm % 100).padStart(2, '0');
  const synthetic = track.nowClock({ synthTime: `${dateStr.replace(/-/g, '')}T${h}${m}` });
  assert.equal(synthetic.date, dateStr, '合成时钟的日期要落在上海时区');
  // clock.minutes 是「零点起的分钟数」，1441 这种 HHMM 标记要换算后再比
  assert.equal(synthetic.minutes, Math.floor(hhmm / 100) * 60 + (hhmm % 100));
  return synthetic;
}

const opts = () => ({ date: '', force: '' });

// ── 1. 时点分流 ────────────────────────────────────────────────
// 两个门槛不同：10:31 起就能结算（等的是前一日数据），14:41 起才生成（等当日 14:40 分钟线）。
const before = track.planTick(clockAt('2026-09-21', 1020), opts(), {});
assert.equal(before.actions.length, 0, '10:20 两个阶段都还没到');
assert.match(before.reason, /未到触发时点/);

const at1440 = track.planTick(clockAt('2026-09-21', 1440), opts(), {});
assert.deepEqual(at1440.actions.map((a) => a.phase), ['settle'],
  '14:40 还没到生成时点，但可以继续结算未回填记录');

const atGen = track.planTick(clockAt('2026-09-21', 1441), opts(), {});
assert.deepEqual(atGen.actions.map((a) => a.phase), ['settle', 'generate'],
  '14:41 既要结算上一决策日，也要生成当日候选');
assert.deepEqual(atGen.actions.map((a) => a.tradeDate), ['20260921', '20260921']);
assert.ok(atGen.actions.every((a) => a.reason));

// 已生成过的决策日不再重复生成，但结算阶段照跑（幂等 + 不空转）
const again = track.planTick(clockAt('2026-09-21', 1500), opts(), { synthDate: '20260921' });
assert.deepEqual(again.actions.map((a) => a.phase), ['settle']);

const atSettle = track.planTick(clockAt('2026-09-22', 1030), opts(), {});
assert.equal(atSettle.actions.length, 0, '10:30 尚未收盘，不结算');
assert.deepEqual(track.planTick(clockAt('2026-09-22', 1031), opts(), {})
  .actions.map((a) => a.phase), ['settle'], '10:31 起先结算再等下午生成');

// 上午不该生成（14:40 的分钟线还没有）
assert.ok(track.planTick(clockAt('2026-09-22', 1100), opts(), {})
  .actions.every((a) => a.phase === 'settle'));

// ── 2. 非交易日 ───────────────────────────────────────────────
const weekend = track.planTick(clockAt('2026-09-19', 1441), opts(), {});
assert.equal(weekend.actions.length, 0, '周六不生成也不结算');
assert.match(weekend.reason, /非交易日/);
// 真实时钟（非合成）也要能把周六判掉
assert.equal(track.planTick(shanghaiClock(new Date('2026-09-19T06:41:00Z')), opts(), {})
  .actions.length, 0, '真实时钟的周六同样不动作');

// --force 用于人工补跑：绕过时点，但仍受交易日与幂等约束
const forced = track.planTick(clockAt('2026-09-21', 900), { date: '', force: 'generate' }, {});
assert.deepEqual(forced.actions.map((a) => a.phase), ['generate']);
assert.equal(track.planTick(clockAt('2026-09-19', 1441), { date: '', force: 'generate' }, {})
  .actions.length, 0, '强制补跑也不得在非交易日写数据');

// ── 3. pool 通道冲突 ─────────────────────────────────────────
const rows = [{ code: '600519' }, { code: '000001' }, { code: '300750' }];
const existing = [
  { code: '600519', source: 'pool' },
  { code: '300750', source: 'reverse-1440' },          // 本通道旧记录：允许覆盖
  { code: '601318', source: 'pool' },                  // 不在候选里，不影响结果
];
const split = track.splitPoolConflicts(rows, existing);
assert.deepEqual(split.kept.map((r) => r.code), ['000001', '300750']);
assert.deepEqual(split.skipped, ['600519']);
assert.deepEqual(track.splitPoolConflicts(rows, []).kept.length, 3, '无既有记录时全部保留');

// ── 4. 待结算筛选与回填载荷 ────────────────────────────────────
const listed = [
  { tradeDate: 20260918, code: '600519', source: 'reverse-1440', settledAt: '' },        // 该结算
  { tradeDate: 20260918, code: '300750', source: 'reverse-1440', settledAt: '2026-09-21T10:31:00' }, // 已回填
  { tradeDate: 20260921, code: '000001', source: 'reverse-1440', settledAt: '' },        // 今天的，不结算
  { tradeDate: 20260918, code: '000002', source: 'pool', settledAt: '' },                // 别的通道
];
const pending = track.pendingSettleRows(listed, '20260921');
assert.deepEqual(pending.map((r) => r.code), ['600519']);
assert.deepEqual(track.pendingSettleRows(listed, '20260918').map((r) => r.code), [],
  '决策日当天不得结算');

const patch = track.buildSettlePatch({
  tradeDate: 20260918, code: '600519', actualEntryPrice: 1264.58, actualHigh: 1265.88,
  actualExitPrice: 1258.7, actualRetHigh: 0.1028, actualRetExit: -0.46, hit3: 0,
  settledAt: '',
}, '2026-09-21T10:31:07');
assert.deepEqual(Object.keys(patch).sort(), ['actualEntryPrice', 'actualExitPrice', 'actualHigh',
  'actualRetExit', 'actualRetHigh', 'code', 'hit3', 'settledAt', 'tradeDate'].sort());
assert.equal(patch.tradeDate, 20260918);
assert.equal(patch.code, '600519');
assert.equal(patch.settledAt, '2026-09-21T10:31:07');
assert.deepEqual(track.SETTLE_FIELDS, ['actualEntryPrice', 'actualHigh', 'actualExitPrice',
  'actualRetHigh', 'actualRetExit', 'hit3'], '回填列必须与 storage.settleBtDecision 一致');
// 缺字段写 null 而不是 undefined，避免 sql.js 报错
assert.equal(track.buildSettlePatch({ tradeDate: 20260918, code: '000001' }).hit3, null);

// ── 5. 参数解析 ───────────────────────────────────────────────
const parsed = track.parseArgs(['--dry-run', '--once', '--top', '12', '--port', '3222',
  '--date', '2026-09-22', '--python', 'py']);
assert.equal(parsed.dryRun, true);
assert.equal(parsed.once, true);
assert.equal(parsed.top, 12);
assert.equal(parsed.port, 3222);
assert.equal(parsed.date, '20260922');
assert.equal(parsed.python, 'py');
assert.equal(track.parseArgs([]).port, 3110, '端口固定 3110，不得静默漂移');
assert.equal(track.SOURCE, 'reverse-1440');
// 常量是「零点起的分钟数」：14:41 -> 881，10:31 -> 631
assert.equal(track.GEN_AT, 14 * 60 + 41);
assert.equal(track.SETTLE_AT, 10 * 60 + 31);

console.log('paper-track.test 通过');
