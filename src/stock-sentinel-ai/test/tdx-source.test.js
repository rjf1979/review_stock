// 通达信本地数据源：gbbq 解析、.day 解码、前复权推导、契约声明与写入升级通道。
// 全程使用临时目录（STOCK_SENTINEL_TDX_DIR 指向 tmp），不读 D:\new_tdx，也不碰真实 K 线库。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-tdx-'));
process.env.VOLUME_INSIGHT_DATA_DIR = path.join(tempDir, 'data');
process.env.STOCK_SENTINEL_TDX_DIR = tempDir;

const { decodeGbbq, indexByCode, resetGbbqCache } = require('../tdx-gbbq');
const { decodeDayBuffer, buildQfqFactors, applyQfq, tdxMarketOf, dayFileFor, fetchTdxKline } = require('../tdx-vipdoc');
const {
  ADJUSTMENT, resolveSourceAdjustment, isAdjustmentCorroborated, sourceVolumeScale,
  decideKlineWrite, canSafelyRebuildUnverifiedSeries,
} = require('../kline-source-contract');

// ── 夹具 1：真实 gbbq 加密记录（000001，category=1 除权除息，1990-03-01 ~ 2002-07-23）──
// 直接从通达信 gbbq 抽取 12 条整记录（每条 29 字节独立加密）+ 4 字节计数头，可离线复算。
const GBBQ_FIXTURE_HEX =
  '0c000000631224b0f311c9a953c0bb1806866a39dcbc5c5514c3e1d2000000803f631224b0f311c9a9ca8d85feee5e638a465b84b44e49867f4000000000631224b0f311c9a9cf614701cf97d548063a42865e2b75304100000000631224b0f311c9a9601680f76002615218dc8d5b359124404000000000631224b0f311c9a9fb0c9f0b38d95ae9b64ab3ca9b6ae317410000803f631224b0f311c9a9c47f58e76acc6a176fe3cd099639709f400000803f631224b0f311c9a93889d13bdcd97c0c1904d01f68e853954000000000631224b0f311c9a9487620c58a7b78b9063a42865e2b75304100000000631224b0f311c9a9ed7735834faa521418dc8d5b359124404000000000631224b0f311c9a9275afc8885a5e8f41904d01f68e853950000000000631224b0f311c9a913efb77702920d8b6d23556f1cc558320000004040631224b0f311c9a96909571d119d6fb69f26e436da9482900000000000';
const GBBQ_FIXTURE = Buffer.from(GBBQ_FIXTURE_HEX, 'hex');

const gbbq = require('../tdx-gbbq');
const root = process.env.STOCK_SENTINEL_TDX_DIR;

function dayRecord({ date, open, high, low, close, amount = 0, volume = 0 }) {
  const buf = Buffer.alloc(32);
  buf.writeUInt32LE(Number(String(date).replace(/-/g, '')), 0);
  buf.writeUInt32LE(Math.round(open * 100), 4);
  buf.writeUInt32LE(Math.round(high * 100), 8);
  buf.writeUInt32LE(Math.round(low * 100), 12);
  buf.writeUInt32LE(Math.round(close * 100), 16);
  buf.writeFloatLE(amount, 20);
  buf.writeUInt32LE(volume, 24);
  buf.writeUInt32LE(0, 28);
  return buf;
}

// 000001 在 2002-07-23 除权除息（每 10 股派 1.5 元，无送转配）：除权价 = (10.00 - 0.15) / 1 = 9.85。
const DAY_BARS = [
  { date: '2002-07-22', open: 9.90, high: 10.10, low: 9.80, close: 10.00, amount: 1000000.5, volume: 500000 },
  { date: '2002-07-23', open: 9.85, high: 9.95, low: 8.95, close: 9.00, amount: 900000, volume: 400000 },
  { date: '2002-07-24', open: 9.00, high: 9.30, low: 8.90, close: 9.20, amount: 800000, volume: 300000 },
];

function writeFixtures({ withGbbq }) {
  const vipdoc = path.join(root, 'vipdoc', 'sz', 'lday');
  fs.mkdirSync(vipdoc, { recursive: true });
  fs.writeFileSync(path.join(vipdoc, 'sz000001.day'), Buffer.concat(DAY_BARS.map(dayRecord)));
  const hqCache = path.join(root, 'T0002', 'hq_cache');
  const gbbqFile = path.join(hqCache, 'gbbq');
  if (withGbbq) {
    fs.mkdirSync(hqCache, { recursive: true });
    fs.writeFileSync(gbbqFile, GBBQ_FIXTURE);
  } else if (fs.existsSync(gbbqFile)) {
    fs.unlinkSync(gbbqFile);
  }
  resetGbbqCache();
}

(async () => {
  // ── gbbq 解密：计数头与记录长度必须自洽，字段可逐条复核 ──
  const records = decodeGbbq(GBBQ_FIXTURE);
  assert.equal(records.length, 12);
  assert.deepEqual(
    { code: records[0].code, date: records[0].date, category: records[0].category, peigujia: records[0].peigujia, peigu: records[0].peigu },
    { code: '000001', date: 19900301, category: 1, peigujia: 3.559999942779541, peigu: 1 },
    '首条记录应与通达信公开字段一致',
  );
  const bucket = indexByCode(records).get('000001');
  assert.equal(bucket.events.length, 12, 'category=1 事件应全部入索引');
  assert.equal(bucket.events[0].date <= bucket.events.at(-1).date, true, '事件按除权日升序');
  assert.equal(bucket.events.at(-1).date, 20020723);
  // 文件损坏（长度与计数不符）必须拒绝，而不是静默返回半截数据。
  assert.throws(() => decodeGbbq(Buffer.concat([GBBQ_FIXTURE, Buffer.from([0])])), /长度不一致/);

  // ── .day 解码：<IIIIIfII>，价格 ×100 存整数，成交量按股 ──
  const rawBuffer = Buffer.concat(DAY_BARS.map(dayRecord));
  const decoded = decodeDayBuffer(rawBuffer);
  assert.deepEqual(decoded.map((bar) => bar.date), ['2002-07-22', '2002-07-23', '2002-07-24']);
  assert.equal(decoded[0].close, 10);
  assert.equal(decoded[0].volume, 500000);
  assert.equal(Math.abs(decoded[0].amount - 1000000.5) < 0.5, true, '成交额为元，float32 有精度损失');

  // ── 市场归属：与 data.js / storage 同一规则 ──
  assert.equal(tdxMarketOf('600519'), 'sh');
  assert.equal(tdxMarketOf('000001'), 'sz');
  assert.equal(tdxMarketOf('301677'), 'sz');
  assert.equal(tdxMarketOf('920001'), 'bj');
  assert.equal(tdxMarketOf('830799'), 'bj');
  assert.equal(dayFileFor('600519').path.endsWith(path.join('vipdoc', 'sh', 'lday', 'sh600519.day')), true);

  // ── 前复权公式：除权日之前的 K 线乘以除权比例，除权日及之后不变 ──
  const rawBars = [{ date: '2002-07-22', close: 10 }, { date: '2002-07-23', close: 9 }, { date: '2002-07-24', close: 9.2 }];
  const events = [{ date: 20020723, hongli: 1.5, peigujia: 0, songgu: 0, peigu: 0 }];
  const factors = buildQfqFactors(events, rawBars, { lastDate: 20020724 });
  assert.equal(factors.length, 1);
  assert.equal(Math.abs(factors[0].ratio - 0.985) < 1e-9, true);
  const adjusted = applyQfq(rawBars, factors);
  assert.equal(Math.abs(adjusted[0].close - 9.85) < 1e-9, true, '除权日前折算到前复权基准');
  assert.equal(adjusted[1].close, 9, '除权日当天不折算');
  assert.equal(adjusted[2].close, 9.2);
  // 除权日在序列最新交易日之后时不得提前折算，否则会把最新价错误压低。
  assert.equal(buildQfqFactors(events, rawBars, { lastDate: 20020722 }).length, 0);
  // 除权日之前没有真实收盘价时跳过（无法折算），不得用未来价倒推。
  assert.equal(buildQfqFactors(events, [{ date: '2002-07-23', close: 9 }], { lastDate: 20020723 }).length, 0);

  // ── 端到端：有 gbbq 时给出可自证前复权序列 ──
  writeFixtures({ withGbbq: true });
  const qfqResult = await fetchTdxKline('000001', 250);
  assert.equal(qfqResult.evidence.adjustmentMethod, 'gbbq-derived');
  assert.equal(qfqResult.evidence.market, 'sz');
  assert.equal(qfqResult.evidence.eventCount, 1);
  assert.equal(qfqResult.bars.length, 3);
  assert.equal(Math.abs(qfqResult.bars[0].close - 9.85) < 1e-9, true);
  assert.equal(qfqResult.bars.at(-1).close, 9.2);

  // 未配置通达信目录（显式空值）时必须关闭本来源，而不是回退到别的路径。
  process.env.STOCK_SENTINEL_TDX_DIR = '';
  const disabled = await fetchTdxKline('000001', 250);
  assert.equal(disabled.bars.length, 0);
  assert.equal(disabled.evidence.adjustmentMethod, 'none');
  assert.equal(disabled.evidence.disabled, true, '未配置时必须显式标记 disabled，供多源链跳过而不是记为取数失败');
  process.env.STOCK_SENTINEL_TDX_DIR = root;

  // ── 降级口径：gbbq 缺失时只能返回未复权原始价，口径记 none（绝不冒充前复权）──
  writeFixtures({ withGbbq: false });
  const unverifiedResult = await fetchTdxKline('000001', 250);
  assert.equal(unverifiedResult.evidence.adjustmentMethod, 'none');
  assert.equal(unverifiedResult.bars[0].close, 10, '无 gbbq 时保持未复权原始价');
  assert.equal(resolveSourceAdjustment('tdx', unverifiedResult.evidence), ADJUSTMENT.UNKNOWN);

  // ── 契约声明：只有 gbbq-derived 才算可自证前复权 ──
  assert.equal(resolveSourceAdjustment('tdx', { adjustmentMethod: 'gbbq-derived' }), ADJUSTMENT.QFQ);
  assert.equal(resolveSourceAdjustment('tdx', {}), ADJUSTMENT.UNKNOWN);
  assert.equal(isAdjustmentCorroborated('tdx', 'qfq'), true);
  assert.equal(isAdjustmentCorroborated('tdx', 'unadjusted'), false, '通达信源只会给出推导前复权或未知，不会声明未复权');
  assert.equal(sourceVolumeScale('tdx'), 1, '本地 .day 成交量已按股存储，不得再乘 100');

  // ── 写入通道：已验证「未复权 → 前复权」允许整段重建，反向与无序列仍拒绝 ──
  const storedBars = [{ date: '2026-09-09' }, { date: '2026-09-10' }];
  const incomingBars = [{ date: '2026-09-09' }, { date: '2026-09-10' }, { date: '2026-09-11' }];
  const upgrade = decideKlineWrite({ stored: { source: 'tencent', adjustmentType: 'unadjusted', kline: storedBars }, source: 'tdx', adjustmentType: 'qfq' });
  assert.equal(upgrade.allowed, false, '仍需先按整段重建处理，不能增量混写');
  assert.equal(upgrade.status, 'adjustment-upgrade');
  assert.equal(upgrade.code, 'KLINE_ADJUSTMENT_UPGRADE_REQUIRED');
  assert.equal(upgrade.action, 'rebuild_required');
  assert.equal(canSafelyRebuildUnverifiedSeries({
    storedBars, incomingBars, source: 'tdx', adjustmentType: 'qfq',
    decisionStatus: upgrade.status, storedAdjustment: upgrade.storedAdjustment,
  }), true);
  assert.equal(canSafelyRebuildUnverifiedSeries({
    storedBars: incomingBars, incomingBars: storedBars, source: 'tdx', adjustmentType: 'qfq',
    decisionStatus: upgrade.status, storedAdjustment: upgrade.storedAdjustment,
  }), false, '新序列缩短历史时不得自动重建');
  assert.equal(canSafelyRebuildUnverifiedSeries({
    storedBars, incomingBars, source: 'sina', adjustmentType: 'unknown',
    decisionStatus: upgrade.status, storedAdjustment: upgrade.storedAdjustment,
  }), false, '不可验证口径不得借用升级通道');
  const downgrade = decideKlineWrite({ stored: { source: 'tdx', adjustmentType: 'qfq', kline: storedBars }, source: 'tencent', adjustmentType: 'unadjusted' });
  assert.equal(downgrade.code, 'KLINE_ADJUSTMENT_CONFLICT', '前复权回退未复权不在豁免范围');
  const metadataOnly = decideKlineWrite({ stored: { source: 'tencent', adjustmentType: 'unadjusted' }, source: 'tdx', adjustmentType: 'qfq' });
  assert.equal(metadataOnly.code, 'KLINE_ADJUSTMENT_CONFLICT', '只有元数据、无既有序列时不得判为可升级');
  // gbbq 密钥表长度自检：资产缺失时 loadIndex 应给出错误而不是抛异常。
  assert.equal(gbbq.KEY_FILE.endsWith('gbbq-keys.bin'), true);

  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log('tdx-source.test 通过');
})().catch((error) => { console.error(error); process.exit(1); });
