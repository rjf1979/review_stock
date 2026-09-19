// 量能洞察 · 纯函数单元测试（不联网）
const assert = require('assert');
const { AUTO_POOL_MIN_SCORE, meetsAutoPoolGate, autoPoolThresholdFor, shanghaiDate, scoreVolume, volumeProfile, listRules, listEnabledRules, rankThemeLeaders, matchPrefilter, assessLocalKlinePrefilter, LOCAL_KLINE_MIN_BARS, isTradableCode } = require('../screener-core');

function approx(a, b, tol = 1e-6) {
  assert.ok(Math.abs(a - b) <= tol, `expected ${a} to be ~${b}`);
}

// scoreVolume 量比高、换手活跃、主力净流入为正 → 高分
const hot = scoreVolume({ volumeRatio: 3, turnover: 12, mainNet: 3e8, amount: 2e9, changePct: 4 });
// 量比低、缩量、主力净流出、成交少 → 低分
const cold = scoreVolume({ volumeRatio: 0.4, turnover: 0.5, mainNet: -2e8, amount: 2e7, changePct: -3 });
assert.ok(hot > cold, `hot(${hot}) 应大于 cold(${cold})`);
assert.ok(hot >= 0 && hot <= 100, `hot 应在 0~100，实际 ${hot}`);

// volumeProfile 归一化单位
const raw = { code: '600519', name: '贵州茅台', price: 1500, changePct: 2.5, turnover: 0.6, volumeRatio: 1.2, amount: 8.1e9, mainNet: 5.1e7, floatMcap: 1.8e12 };
const profile = volumeProfile(raw);
approx(profile.amountYi, 81);
approx(profile.mainNetYi, 0.51);
approx(profile.floatMcapYi, 18000);
assert.strictEqual(profile.score, scoreVolume(raw));
// 原始字段缺失时不应把整分变成 NaN
assert.ok(Number.isFinite(scoreVolume({ volumeRatio: 1.2, turnover: 0.6, changePct: 2.5 })));

// 默认规则已剔除“量能活跃”，全部为 K 线形态；2026-09-18 起选股默认启用 rsi_low_turn v4 与
// limit_pullback v4 两条超跌修复口径（用户要求对比选股效果），其余 22 条保留定义但默认关闭，
// 可在设置页逐条重新启用。
const defaultRules = listRules();
assert.ok(!defaultRules.some((r) => r.id === 'volume_act'), '默认规则不应再包含 volume_act');
assert.ok(defaultRules.length > 0, '应存在默认规则');
assert.ok(defaultRules.every((r) => r.kind === 'kline'), '默认规则应全部为 kline 形态');
assert.ok(defaultRules.every((r) => r.patternId && (r.prefilter && typeof r.prefilter === 'object')), 'kline 规则应带 patternId 与 prefilter');
const enabledRules = listEnabledRules();
assert.deepStrictEqual(enabledRules.map((r) => r.id), ['limit_pullback', 'rsi_low_turn'], '默认应启用 limit_pullback v4 与 rsi_low_turn v4');
assert.strictEqual(defaultRules.length, 24, '默认规则库应保留 24 条形态定义');
const rsiRule = defaultRules.find((rule) => rule.id === 'rsi_low_turn');
assert.deepStrictEqual(rsiRule.params, { period: 14, low: 18, drop_days: 60, drop_max: -30 }, 'v4 参数应固定为 RSI14 / low18 / 60 日 / -30%（low 于 2026-09-18 由 20 收紧）');
assert.strictEqual(rsiRule.minVolumeScore, 0, 'v4 不设量能分入池门槛（形态自带超跌口径）');
const limitRule = defaultRules.find((rule) => rule.id === 'limit_pullback');
assert.deepStrictEqual(limitRule.params, { window: 15, vol_shrink: 0.9, drop_days: 60, drop_max: -30, rs_days: 20, rs_max: -5 }, 'limit_pullback v4 参数应与回测口径一致');
assert.strictEqual(limitRule.minVolumeScore, 0, 'limit_pullback v4 不设量能分入池门槛');
assert.strictEqual(autoPoolThresholdFor([rsiRule], AUTO_POOL_MIN_SCORE), 0, '规则级门槛覆盖应生效');
assert.strictEqual(autoPoolThresholdFor([{ id: 'x' }], AUTO_POOL_MIN_SCORE), AUTO_POOL_MIN_SCORE, '未声明覆盖时沿用全局门槛');
assert.strictEqual(autoPoolThresholdFor([{ id: 'x', minVolumeScore: 55 }, { id: 'y', minVolumeScore: 80 }], 70), 55, '多条命中取最宽松门槛');
// 扫描响应里的 autoPool.minScore 必须与真实生效门槛一致：默认启用集只有 v4，
// 报出的门槛应是 0 而不是全局 70，否则前端/日志会显示「门槛 70 却全放行」的误导值。
assert.strictEqual(autoPoolThresholdFor(listEnabledRules(), AUTO_POOL_MIN_SCORE), 0, '默认启用集的真实生效门槛应为 0');
const dryBottom = defaultRules.find((rule) => rule.id === 'dry_price_bottom');
assert.deepEqual(dryBottom.prefilter, { minChangePct: -8, maxChangePct: 3, maxVolumeRatio: 1.2 });
assert.equal(matchPrefilter(dryBottom, { changePct: 3, volumeRatio: 1.2 }), true, '地量地价预筛边界值可进入严格复核');
assert.equal(matchPrefilter(dryBottom, { changePct: 3.01, volumeRatio: 0.8 }), false, '上涨超过3%不可能仍贴近20日最低收盘');
assert.equal(matchPrefilter(dryBottom, { changePct: 0, volumeRatio: 1.21 }), false, '明显放量不得标记为地量地价预筛命中');
assert.equal(matchPrefilter(dryBottom, { changePct: -8.01, volumeRatio: 0.8 }), false, '过度下跌继续沿用既有风险边界');

// 自动入池门槛：70 分压缩全市场候选规模；量能分达标且为有限数才算入池资格。
assert.strictEqual(AUTO_POOL_MIN_SCORE, 70, '初始自动入池量能分门槛应为 70');
assert.strictEqual(meetsAutoPoolGate({ score: 70 }), true, 'score=70 应达到门槛');
assert.strictEqual(meetsAutoPoolGate({ score: 69.9 }), false, 'score<70 不应达到门槛');
assert.strictEqual(meetsAutoPoolGate({ score: 100 }), true, 'score=100 应达到门槛');
assert.strictEqual(meetsAutoPoolGate({}), false, '缺失 score 不应达到门槛');
assert.strictEqual(meetsAutoPoolGate(null), false, '空档案不应达到门槛');
assert.strictEqual(meetsAutoPoolGate({ score: 'NaN' }), false, 'NaN score 不应达到门槛');
assert.strictEqual(shanghaiDate('not-a-date'), '', '无效行情源时间应降级为空日期而不是抛错');
assert.strictEqual(shanghaiDate('2026-09-11T07:00:00Z'), '2026-09-11', '行情源时间应转换为上海交易日');

// 题材内龙头按涨停、涨跌幅、主力净流入、量能分依次排序，不跨题材比较成交额。
const leaderEntries = [
  { profile: { code: '000002', isLimitUp: false, changePct: 8, mainNetYi: 5, score: 95 } },
  { profile: { code: '000001', isLimitUp: true, changePct: 6, mainNetYi: 1, score: 80 } },
  { profile: { code: '000003', isLimitUp: false, changePct: 8, mainNetYi: 5, score: 90 } },
];
rankThemeLeaders(leaderEntries, [{ code: 'BK001', name: '测试题材', kind: 'concept' }], new Map([['BK001', new Set(['000001', '000002', '000003'])]]));
assert.strictEqual(leaderEntries[0].profile.code, '000001', '涨停股应优先作为题材龙头');
assert.strictEqual(leaderEntries[0].themeLeaderRanks[0].rank, 1, '题材龙头名次应为 1');
assert.strictEqual(leaderEntries[1].profile.code, '000002', '同等涨幅及资金时量能分更高者应靠前');

const boardEntries = leaderEntries.map((entry) => ({ profile: entry.profile }));
rankThemeLeaders(boardEntries, [{ code: 'BK001', name: '测试题材', kind: 'concept', coverage: 'partial' }], new Map([['BK001', new Set(['000001', '000002', '000003'])]]), 'boardLeaderRanks');
assert.equal(boardEntries[0].boardLeaderRanks[0].coverage, 'partial', '板块排名应携带成分覆盖状态');
assert.ok(boardEntries.every((entry) => Array.isArray(entry.boardLeaderRanks)), '板块排名字段应与候选排名分离');

// 扫描股票只对快照预筛命中的小集合读取本地 K 线：可信且当日完整才给出形态确认。
// 门槛为 150 根：60-99 根分桶在 2026-09-19 复验中 limit_pullback 直接亏钱、rsi_low_turn 盈亏比腰斩，
// 150-249 根才两组形态同时为正；短于该下限的次新/短序列仍应在扫描阶段排除，而不是留作「待补 K 线」。
assert.equal(LOCAL_KLINE_MIN_BARS, 150, '本地K线可复筛下限应与分桶回测支撑结论一致');
const localBars = Array.from({ length: 250 }, (_, index) => ({
  date: index === 249 ? '2026-09-11' : `2026-07-${String((index % 28) + 1).padStart(2, '0')}`,
  open: 10, high: 10.2, low: 9.8, close: 10, volume: 1000,
}));
localBars[249] = { date: '2026-09-11', open: 10, high: 10.1, low: 9, close: 10.05, volume: 1000 };
const longShadowRule = { id: 'long_shadow', label: '长下影企稳', kind: 'kline', patternId: 'long_lower_shadow', params: {} };
const engulfRule = { id: 'engulf', label: '阳包阴', kind: 'kline', patternId: 'yang_engulf', params: {} };
const localEntry = { profile: { code: '600001' }, hitRules: [longShadowRule, engulfRule] };
const trustedCache = { source: 'tencent', adjustmentType: 'qfq', sourceLatestDate: '2026-09-11', tailStatus: 'confirmed', kline: localBars };
const confirmedLocal = assessLocalKlinePrefilter(localEntry, trustedCache, '2026-09-11');
assert.equal(confirmedLocal.status, 'confirmed', '可信腾讯前复权且尾日一致时应执行本地形态确认');
assert.deepEqual(confirmedLocal.confirmedRuleIds, ['long_shadow'], '多条预筛规则只保留实际形态命中的规则证据');
assert.equal(confirmedLocal.entry.patternId, 'long_lower_shadow', '应记录最优已确认形态');

// 通达信本地 gbbq 推导的前复权序列与腾讯 qfqday 同属「可自证前复权」，扫描阶段必须同样放行。
const tdxConfirmed = assessLocalKlinePrefilter(localEntry, { ...trustedCache, source: 'tdx' }, '2026-09-11');
assert.equal(tdxConfirmed.status, 'confirmed', '本地通达信可自证前复权序列不应被来源白名单排除');
assert.deepEqual(tdxConfirmed.confirmedRuleIds, ['long_shadow'], '本来源同样只保留实际命中的形态证据');

const flatBars = localBars.map((bar) => ({ ...bar, open: 10, high: 10.1, low: 9.95, close: 10 }));
const rejectedLocal = assessLocalKlinePrefilter(localEntry, { ...trustedCache, kline: flatBars }, '2026-09-11');
assert.equal(rejectedLocal.status, 'rejected', '本地证据完整但原形态均不命中时应在扫描阶段排除');

for (const [label, cache] of [
  ['无本地K线', null],
  ['尾日陈旧', { ...trustedCache, sourceLatestDate: '2026-09-10', kline: localBars.map((bar, index) => index === 249 ? { ...bar, date: '2026-09-10' } : bar) }],
  ['尾K暂定', { ...trustedCache, tailStatus: 'provisional' }],
]) {
  assert.equal(assessLocalKlinePrefilter(localEntry, cache, '2026-09-11').status, 'pending_kline', `${label}时应保留为待补K线，不能误判形态失败`);
}

// 结构性不可复核必须与「数据还没补齐」分开：前者永远等不到可判定的证据，
// 不能无限占用候选配额，也不能在界面上显示成「待补 K 线复筛」。
for (const [label, cache, expectedReason] of [
  ['来源未知', { ...trustedCache, source: '' }, 'kline_not_verifiable'],
  ['复权未知', { ...trustedCache, adjustmentType: 'unknown' }, 'kline_not_verifiable'],
  ['未复权序列', { ...trustedCache, adjustmentType: 'unadjusted' }, 'kline_not_verifiable'],
  ['非腾讯源', { ...trustedCache, source: 'baidu' }, 'kline_not_verifiable'],
  ['通达信未复权原始价', { ...trustedCache, source: 'tdx', adjustmentType: 'unadjusted' }, 'kline_not_verifiable'],
  ['上市历史不足150根', { ...trustedCache, kline: localBars.slice(-149) }, 'kline_listing_too_short'],
  ['次新股短线序列', { ...trustedCache, kline: localBars.slice(-90) }, 'kline_listing_too_short'],
]) {
  const result = assessLocalKlinePrefilter(localEntry, cache, '2026-09-11');
  assert.equal(result.status, 'unverifiable', `${label}时应在扫描阶段排除，不能留作待补K线`);
  assert.equal(result.exclusionReason, expectedReason, `${label}应给出可追溯的排除原因`);
}

// 恰好满 150 根的短历史序列应能进入形态确认，不再被「上市历史不足」拦下。
const justEnoughLocal = assessLocalKlinePrefilter(localEntry, { ...trustedCache, kline: localBars.slice(-150) }, '2026-09-11');
assert.notEqual(justEnoughLocal.status, 'unverifiable', '满150根不应再按上市历史不足排除');
assert.equal(justEnoughLocal.status, 'confirmed', '满150根且形态命中时应给出确认');

// 可交易范围：上证主板 / 深证主板 / 创业板放行，科创板与北交所排除。
for (const code of ['600519', '601988', '603459', '605555', '000001', '001393', '002594', '003816', '300750', '301677']) {
  assert.ok(isTradableCode(code), `${code} 属于可交易范围`);
}
for (const code of ['688292', '689009', '830799', '871981', '920002', '430047', '110000']) {
  assert.ok(!isTradableCode(code), `${code} 不在可交易范围`);
}

console.log('screener-core.test 通过');
