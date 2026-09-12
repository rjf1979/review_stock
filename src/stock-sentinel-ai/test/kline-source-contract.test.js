// D14-01 / D14-03：数据源能力契约与单源字段映射隔离测试。
// 断言依据来自受控响应结构，不引用请求参数推断复权口径。
const assert = require('node:assert/strict');
const {
  ADJUSTMENT, SOURCE_IDS, SOURCE_CONTRACTS, sourceVolumeScale, normalizeKlineVolumeByContract,
  resolveSourceAdjustment, isAdjustmentCorroborated, decideKlineWrite, canSafelyRebuildUnverifiedSeries, describeSourceCapabilities,
} = require('../kline-source-contract');

// ── 契约声明 ─────────────────────────────
assert.deepEqual([...SOURCE_IDS].sort(), ['baidu', 'em', 'sina', 'sohu', 'tencent']);
for (const id of SOURCE_IDS) {
  const contract = SOURCE_CONTRACTS[id];
  assert.ok([ADJUSTMENT.QFQ, ADJUSTMENT.UNADJUSTED, ADJUSTMENT.UNKNOWN].includes(contract.adjustment.declared), `${id} 必须声明复权口径`);
  assert.ok(['share', 'lot'].includes(contract.volumeUnit), `${id} 必须声明成交量单位`);
  for (const field of ['date', 'open', 'high', 'low', 'close', 'volume']) assert.ok(contract.fields[field], `${id} 缺少 ${field} 字段映射`);
  assert.equal(contract.amountField, null, `${id} 未从响应验证成交额字段时不得声明`);
  assert.equal(contract.covered.includes('amount'), false, `${id} 不得声明未验证的成交额覆盖`);
}
assert.equal(SOURCE_CONTRACTS.tencent.adjustment.declared, ADJUSTMENT.QFQ);
assert.equal(SOURCE_CONTRACTS.tencent.adjustment.verifiedFromResponse, true, '腾讯节点名可验证复权口径');
for (const id of ['baidu', 'sohu', 'em', 'sina']) {
  assert.equal(SOURCE_CONTRACTS[id].adjustment.declared, ADJUSTMENT.UNKNOWN, `${id} 响应无法验证复权口径，必须记 unknown`);
  assert.equal(SOURCE_CONTRACTS[id].adjustment.verifiedFromResponse, false);
}
const capabilities = describeSourceCapabilities();
assert.equal(capabilities.length, 5);
assert.equal(capabilities.filter((item) => item.adjustmentType === 'qfq').map((item) => item.id).join(','), 'tencent');
assert.equal(sourceVolumeScale('tencent'), 100);
assert.equal(sourceVolumeScale('baidu'), 1);
assert.equal(sourceVolumeScale('sohu'), 100);
assert.equal(sourceVolumeScale('em'), 100);
assert.equal(sourceVolumeScale('sina'), 1);
assert.equal(sourceVolumeScale('unknown-source'), 1, '未登记来源按股原样处理');

// ── 复权口径解析 ─────────────────────────────
assert.equal(resolveSourceAdjustment('tencent', { node: 'qfqday' }), ADJUSTMENT.QFQ);
assert.equal(resolveSourceAdjustment('tencent', { node: 'day' }), ADJUSTMENT.UNADJUSTED, '去掉复权参数返回的 day 节点是未复权序列');
assert.equal(resolveSourceAdjustment('tencent', {}), ADJUSTMENT.UNKNOWN, '拿不到节点名时不得冒充 qfq');
assert.equal(resolveSourceAdjustment('tencent', { node: 'qzday' }), ADJUSTMENT.UNKNOWN);
for (const id of ['baidu', 'sohu', 'em', 'sina']) {
  assert.equal(resolveSourceAdjustment(id, { node: 'qfqday', requested: 'qfq' }), ADJUSTMENT.UNKNOWN, `${id} 只有请求参数时必须记 unknown`);
}
assert.equal(isAdjustmentCorroborated('tencent', 'qfq'), true);
assert.equal(isAdjustmentCorroborated('tencent', 'unadjusted'), true, '腾讯 day 节点同样能从响应验证为未复权');
assert.equal(isAdjustmentCorroborated('sina', 'qfq'), false, '旧库把新浪序列写成 qfq 属不可验证口径');

// ── 成交量单位归一 ─────────────────────────────
assert.equal(normalizeKlineVolumeByContract(1000, 'tencent'), 100000);
assert.equal(normalizeKlineVolumeByContract(1000, 'baidu'), 1000);
assert.equal(normalizeKlineVolumeByContract('1000', 'sina'), 1000);
assert.equal(normalizeKlineVolumeByContract(0, 'tencent'), 0, '显式 0 仍保留');
for (const bad of [null, undefined, '', ' ', 'abc', -1]) {
  assert.equal(normalizeKlineVolumeByContract(bad, 'tencent'), null, `空/错误成交量不得填零：${String(bad)}`);
}

// ── 写入相容判定（来源切换 / 复权冲突）────────────────────────────
assert.equal(decideKlineWrite({}).allowed, true);
assert.equal(decideKlineWrite({ stored: { source: 'tencent', adjustmentType: 'qfq' }, source: 'tencent', adjustmentType: 'qfq' }).status, 'compatible');
const legacyStored = decideKlineWrite({ stored: { source: 'sina', adjustmentType: 'qfq' }, source: 'sina', adjustmentType: 'unknown' });
assert.equal(legacyStored.allowed, true, '旧库不可验证口径不得阻断合法更新');
assert.equal(legacyStored.status, 'stored-adjustment-unverifiable');
const sourceSwitch = decideKlineWrite({ stored: { source: 'sina', adjustmentType: 'unknown', kline: [{ date: '2026-09-10' }] }, source: 'tencent', adjustmentType: 'qfq' });
assert.equal(sourceSwitch.allowed, false, '不可验证的旧序列切换来源时必须拒绝增量混写');
assert.equal(sourceSwitch.code, 'KLINE_PROVENANCE_CONFLICT');
assert.equal(sourceSwitch.action, 'rebuild_required');
assert.match(sourceSwitch.reason, /来源切换/);
const missingProvenance = decideKlineWrite({ stored: { source: '', adjustmentType: '', kline: [{ date: '2026-09-10' }] }, source: 'tencent', adjustmentType: 'qfq' });
assert.equal(missingProvenance.allowed, false, '已有数值序列但缺来源时不能增量写入');
assert.equal(missingProvenance.code, 'KLINE_PROVENANCE_MISSING');
assert.equal(missingProvenance.action, 'rebuild_required');
const legacyBars = [{ date: '2026-09-10' }];
const verifiedFullBars = [{ date: '2026-09-09' }, { date: '2026-09-10' }];
assert.equal(canSafelyRebuildUnverifiedSeries({ storedBars: legacyBars, incomingBars: verifiedFullBars, source: 'tencent', adjustmentType: 'qfq', decisionStatus: missingProvenance.status }), true);
assert.equal(canSafelyRebuildUnverifiedSeries({ storedBars: legacyBars, incomingBars: verifiedFullBars, source: 'sina', adjustmentType: 'unknown', decisionStatus: missingProvenance.status }), false, '未知复权来源不得自动重建');
assert.equal(canSafelyRebuildUnverifiedSeries({ storedBars: verifiedFullBars, incomingBars: legacyBars, source: 'tencent', adjustmentType: 'qfq', decisionStatus: missingProvenance.status }), false, '日期或深度缩短不得自动重建');
assert.equal(canSafelyRebuildUnverifiedSeries({ storedBars: legacyBars, incomingBars: verifiedFullBars, source: 'tencent', adjustmentType: 'qfq', decisionStatus: 'adjustment-conflict' }), false, '已验证口径冲突不得走旧库重建豁免');
const unverified = decideKlineWrite({ stored: { source: 'tencent', adjustmentType: 'qfq' }, source: 'sina', adjustmentType: 'unknown' });
assert.equal(unverified.allowed, false);
assert.equal(unverified.code, 'KLINE_ADJUSTMENT_UNVERIFIED');
assert.equal(unverified.action, 'rebuild_required');
const conflict = decideKlineWrite({ stored: { source: 'tencent', adjustmentType: 'qfq' }, source: 'tencent', adjustmentType: 'unadjusted' });
assert.equal(conflict.allowed, false);
assert.equal(conflict.code, 'KLINE_ADJUSTMENT_CONFLICT');
assert.equal(conflict.action, 'rebuild_required');
const reverseConflict = decideKlineWrite({ stored: { source: 'tencent', adjustmentType: 'unadjusted' }, source: 'tencent', adjustmentType: 'qfq' });
assert.equal(reverseConflict.allowed, false, '同源从未复权切回前复权也必须拒绝混写');
assert.equal(reverseConflict.code, 'KLINE_ADJUSTMENT_CONFLICT');

// ── 单源字段映射（受控响应）────────────────────────────
const TENCENT_ROW_QFQ = ['2026-09-11', '10', '10.5', '11', '9.5', '1000'];
const TENCENT_ROW_DAY = ['2026-09-11', '12', '12.5', '13', '11.5', '1000'];
const BAIDU_KEYS = ['timestamp', 'time', 'open', 'close', 'volume', 'high', 'low', 'amount'];
let tencentNode = 'qfqday';
let sinaRows = [{ day: '2026-09-11', open: '10', high: '11', low: '9.5', close: '10.5', volume: '1000' }];
// 只让 `activeSource` 返回数据，其余源抛错，从而把单源字段映射隔离出来。
let activeSource = 'tencent';

global.fetch = async (url) => {
  const value = String(url);
  const host =
    value.includes('ifzq.gtimg.cn') ? 'tencent'
    : value.includes('finance.pae.baidu.com') ? 'baidu'
    : value.includes('q.stock.sohu.com') ? 'sohu'
    : value.includes('push2his.eastmoney.com') ? 'em'
    : value.includes('money.finance.sina.com.cn') ? 'sina'
    : 'other';
  if (host !== activeSource) throw new Error(`源未启用：${host}`);
  if (host === 'tencent') {
    const rows = tencentNode === 'qfqday' ? [TENCENT_ROW_QFQ] : [TENCENT_ROW_DAY];
    return { ok: true, json: async () => ({ data: { sh600519: tencentNode ? { [tencentNode]: rows, qt: {} } : { qt: {} } } }) };
  }
  if (host === 'baidu') {
    return { ok: true, json: async () => ({ Result: { newMarketData: { keys: BAIDU_KEYS, marketData: '0,2026-09-11,10,10.5,1000,11,9.5,5000000' } } }) };
  }
  if (host === 'sohu') {
    return { ok: true, text: async () => JSON.stringify([{ status: 0, hq: [['2026-09-11', 10, 10.5, 0.5, '5%', 9.5, 11, 1000]] }]) };
  }
  if (host === 'em') {
    return { ok: true, json: async () => ({ data: { klines: ['2026-09-11,10,10.5,11,9.5,1000,5000000,5,5,0.5,1'] } }) };
  }
  if (host === 'sina') return { ok: true, json: async () => sinaRows };
  throw new Error(`不应请求其它来源：${value}`);
};

const { fetchKlineRaw } = require('../data');

(async () => {
  const tencent = await fetchKlineRaw('600519', { lmt: 1, prefer: 'tencent' });
  assert.equal(tencent.source, 'tencent');
  assert.equal(tencent.adjustmentType, 'qfq');
  assert.equal(tencent.sourceEvidence.node, 'qfqday');
  assert.deepEqual(tencent.kline[0], { date: '2026-09-11', open: 10, close: 10.5, high: 11, low: 9.5, volume: 100000 });
  assert.equal('amount' in tencent.kline[0], false, '未验证成交额时保持缺失，不填零');
  assert.equal(tencent.sourceLatestDate, '2026-09-11');
  assert.ok(['confirmed', 'provisional'].includes(tencent.tailStatus));

  tencentNode = 'day';
  const tencentDay = await fetchKlineRaw('600519', { lmt: 1, prefer: 'tencent' });
  assert.equal(tencentDay.adjustmentType, 'unadjusted', '返回 day 节点必须判为未复权');
  assert.equal(tencentDay.kline[0].close, 12.5);
  tencentNode = '';
  const tencentNoNode = await fetchKlineRaw('600519', { lmt: 1, prefer: 'tencent' });
  const tencentAttempt = tencentNoNode.sourceAttempts.find((item) => item.source === 'tencent');
  assert.equal(tencentAttempt.outcome, 'empty', '没有 qfqday/day 节点时按空响应处理');
  assert.notEqual(tencentNoNode.source, 'tencent');
  tencentNode = 'qfqday';

  activeSource = 'baidu';
  const baidu = await fetchKlineRaw('600519', { lmt: 1, prefer: 'baidu' });
  assert.deepEqual(baidu.kline[0], { date: '2026-09-11', open: 10, close: 10.5, high: 11, low: 9.5, volume: 1000 });
  assert.equal(baidu.adjustmentType, 'unknown', '百度响应无法验证复权口径');

  activeSource = 'sohu';
  const sohu = await fetchKlineRaw('600519', { lmt: 1, prefer: 'sohu' });
  assert.deepEqual(sohu.kline[0], { date: '2026-09-11', open: 10, close: 10.5, high: 11, low: 9.5, volume: 100000 });
  assert.equal(sohu.adjustmentType, 'unknown');

  activeSource = 'em';
  const em = await fetchKlineRaw('600519', { lmt: 1, prefer: 'em' });
  assert.deepEqual(em.kline[0], { date: '2026-09-11', open: 10, close: 10.5, high: 11, low: 9.5, volume: 100000 });
  assert.equal(em.adjustmentType, 'unknown');

  activeSource = 'sina';
  const sina = await fetchKlineRaw('600519', { lmt: 1, prefer: 'sina' });
  assert.deepEqual(sina.kline[0], { date: '2026-09-11', open: 10, close: 10.5, high: 11, low: 9.5, volume: 1000 });
  assert.equal(sina.adjustmentType, 'unknown');

  // 空字段 / 错误字段：整行判为无效，不得填零后混入序列。
  sinaRows = [{ day: '2026-09-11', open: '10', high: '11', low: '9.5', close: '', volume: '1000' }];
  const sinaEmpty = await fetchKlineRaw('600519', { lmt: 1, prefer: 'sina' });
  assert.equal(sinaEmpty.kline.length, 0, '收盘价空字段的 K 线必须判为无效');
  assert.equal(sinaEmpty.sourceAttempts.find((item) => item.source === 'sina').outcome, 'empty');

  sinaRows = [{ day: '2026-09-11', open: '10', high: 'abc', low: '9.5', close: '10.5', volume: '1000' }];
  const sinaBad = await fetchKlineRaw('600519', { lmt: 1, prefer: 'sina' });
  assert.equal(sinaBad.kline.length, 0, '错误字段的 K 线必须判为无效');

  sinaRows = [{ day: '2026-09-11', open: '10', high: '11', low: '9.5', close: '10.5', volume: '' }];
  const sinaNoVolume = await fetchKlineRaw('600519', { lmt: 1, prefer: 'sina' });
  assert.equal(sinaNoVolume.kline.length, 0, '成交量空字段不得用 0 冒充');

  console.log('kline-source-contract.test 通过');
})().catch((error) => { console.error(error); process.exit(1); });
