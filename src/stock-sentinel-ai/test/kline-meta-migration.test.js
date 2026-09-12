// D14-02 K线元数据迁移 + D14-06 隔离回归：全程使用临时数据目录，不触碰真实 K 线库。
// 必须在任何 require 之前固定 VOLUME_INSIGHT_DATA_DIR。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-kline-meta-'));
process.env.VOLUME_INSIGHT_DATA_DIR = tempDir;

const initSqlJs = require('sql.js/dist/sql-asm.js').default;

const barsOf = (dates, base = 10) => dates.map((date, i) => ({
  date, open: base + i, high: base + i + 0.6, low: base + i - 0.4, close: base + i + 0.3, volume: 10000 + i,
}));

const jsonResponse = (payload) => ({ ok: true, status: 200, json: async () => payload });

// 受控 fetch：只放行当前 activeSource 对应的源，其它源按网络失败处理。
let activeSource = 'tencent';
// 600006 的腾讯节点名可切换，用于模拟「同源换口径」的冲突场景。
let tencentNode600006 = 'qfqday';
const tencentBars = [['2026-09-09', '10', '10.3', '10.6', '9.6', '1000'], ['2026-09-10', '10.3', '10.9', '11.0', '10.1', '1200']];
global.fetch = async (url) => {
  const text = String(url);
  if (text.includes('/api/qt/stock/get')) {
    return jsonResponse({ data: { f57: '301682', f58: '宏明电子', f189: 20260325 } });
  }
  if (text.includes('ifzq.gtimg.cn') && activeSource === 'tencent') {
    const node600006 = tencentNode600006;
    return jsonResponse({
      data: {
        sh600001: { qfqday: [['2026-09-09', '10', '10.3', '10.6', '9.6', '1000'], ['2026-09-10', '10.3', '10.9', '11.0', '10.1', '1200']] },
        sh600003: { qfqday: [['2026-09-09', '10', '10.3', '10.6', '9.6', '1000'], ['2026-09-10', '10.3', '10.9', '11.0', '10.1', '1200']] },
        sh600005: { qfqday: [['2026-09-09', '10', '10.3', '10.6', '9.6', '1000'], ['2026-09-10', '10.3', '10.9', '11.0', '10.1', '1200']] },
        sh600006: { [node600006]: tencentBars },
        sh600007: { qfqday: [['2026-09-09', '10', '10.3', '10.6', '9.6', '1000'], ['2026-09-10', '10.3', '10.9', '11.0', '10.1', '1200']] },
        sh600008: { qfqday: [['2026-09-09', '10', '10.3', '10.6', '9.6', '1000'], ['2026-09-10', '10.3', '10.9', '11.0', '10.1', '1200']] },
      },
    });
  }
  if (text.includes('money.finance.sina.com.cn') && activeSource === 'sina') {
    return jsonResponse([
      { day: '2026-09-09', open: '10', high: '10.6', low: '9.6', close: '10.3', volume: '1000000' },
      { day: '2026-09-10', open: '10.3', high: '11.0', low: '10.1', close: '10.9', volume: '1200000' },
    ]);
  }
  return { ok: false, status: 503, json: async () => ({}) };
};

(async () => {
  // ── 构造 D14-02 之前的旧库：kline_meta 只有 code/date/savedAt/source/adjustmentType ──
  const SQL = await initSqlJs();
  const legacy = new SQL.Database();
  legacy.run(`CREATE TABLE kline (
    code TEXT NOT NULL, date TEXT NOT NULL, open REAL, high REAL, low REAL, close REAL, volume REAL, amount REAL,
    PRIMARY KEY (code, date))`);
  legacy.run(`CREATE TABLE kline_meta (
    code TEXT PRIMARY KEY, date TEXT, savedAt TEXT, source TEXT, adjustmentType TEXT)`);
  legacy.run('INSERT INTO kline VALUES (?,?,?,?,?,?,?,?)', ['600001', '2026-09-10', 10, 10.6, 9.6, 10.3, 10000, null]);
  legacy.run('INSERT INTO kline_meta VALUES (?,?,?,?,?)', ['600001', '2026-09-11', '2026-09-11T07:00:00.000Z', 'sina', 'qfq']);
  fs.writeFileSync(path.join(tempDir, 'kline.db'), Buffer.from(legacy.export()));
  legacy.close();

  const storage = require('../storage');
  const klineSync = require('../kline-sync');
  const { fetchKline, fetchStockListingEvidence, normalizeListingDate } = require('../data');
  const { assessRecommendation } = require('../recommendation-validity');

  // ── D14-02：旧库缺列可读，且不伪造新增元数据 ──
  const legacyRead = await storage.readKline('600001');
  assert.equal(legacyRead.adjustmentType, 'qfq', '旧库已有口径字段应保留原值');
  assert.equal(legacyRead.source, 'sina', '旧库来源应保留');
  assert.equal(legacyRead.sourceLatestDate, '', '旧库不得用序列日期伪造来源最新日期');
  assert.equal(legacyRead.fetchedAt, '', '旧库不得用当前时间伪造抓取时间');
  assert.equal(legacyRead.tailStatus, '', '旧库不得伪造尾K状态');
  assert.equal(legacyRead.tailConfirmedAt, '', '旧库不得伪造尾K确认时间');
  assert.equal(legacyRead.listingDate, '', '旧库不得用首根K线伪造上市日');
  assert.equal(legacyRead.listingSource, '', '旧库不得伪造上市日来源');
  assert.equal(legacyRead.date, '2026-09-11', '抓取日期字段保留');
  assert.equal(legacyRead.kline.length, 1);
  const legacyStats = await storage.readKlineStats(['600001']);
  assert.equal(legacyStats[0].sourceLatestDate, '', '统计接口同样不得伪造来源最新日期');
  assert.equal(legacyStats[0].tailStatus, '', '统计接口同样不得伪造尾K状态');
  assert.equal(legacyStats[0].listingDate, '', '统计接口同样不得伪造上市日');
  assert.equal(legacyStats[0].depth, 1, '旧库序列深度可用');

  // ── writeKline 缺省不冒充复权口径 ──
  await storage.writeKline('600002', barsOf(['2026-09-09', '2026-09-10']), '2026-09-10');
  const plain = await storage.readKline('600002');
  assert.equal(plain.adjustmentType, '', '未提供复权口径时不得默认写 qfq');
  assert.equal(plain.source, '', '未提供来源时保持空');
  assert.equal(plain.tailStatus, '', '未提供尾K状态时保持空');
  assert.equal(plain.sourceLatestDate, '2026-09-10', '来源最新日期可由本地序列尾日推导');
  assert.ok(plain.fetchedAt, '抓取时间应写入');

  // ── 旧库无来源序列：仅允许可验证且完整覆盖的腾讯qfq做原子整段重建 ──
  await storage.writeKline('600008', barsOf(['2026-09-10']), '2026-09-10');
  activeSource = 'tencent';
  const rebuilt = await klineSync.syncOne('600008', { lmt: 2 });
  assert.equal(rebuilt.ok, true);
  assert.equal(rebuilt.rebuilt, true);
  assert.equal(rebuilt.writeDecision, 'full-rebuild-from-verified-source');
  const rebuiltStored = await storage.readKline('600008');
  assert.equal(rebuiltStored.kline.length, 2);
  assert.equal(rebuiltStored.source, 'tencent');
  assert.equal(rebuiltStored.adjustmentType, 'qfq');

  // ── 可验证上市日证据：解析、独立写入与读取统计贯穿 ──
  assert.equal(normalizeListingDate(20260325), '2026-03-25');
  assert.equal(normalizeListingDate('2026-02-30'), '', '非法日期不得落库');
  const listingEvidence = await fetchStockListingEvidence('301682');
  assert.equal(listingEvidence.listingDate, '2026-03-25');
  assert.equal(listingEvidence.listingSource, 'eastmoney_stock_profile');
  assert.ok(listingEvidence.listingFetchedAt);
  assert.equal(await storage.writeKlineListingEvidence('600002', listingEvidence), true);
  const withListing = await storage.readKline('600002');
  assert.equal(withListing.listingDate, '2026-03-25');
  assert.equal(withListing.source, '', '单独写上市日证据不得改写K线来源');
  assert.equal(withListing.adjustmentType, '', '单独写上市日证据不得冒充前复权');
  const [listingStats] = await storage.readKlineStats(['600002']);
  assert.equal(listingStats.listingDate, '2026-03-25');

  // ── 尾K元数据落盘：盘中暂定 → 收盘重新抓取确认 ──
  await storage.writeKline('600004', barsOf(['2026-09-09', '2026-09-10']), '2026-09-10', {
    source: 'tencent', adjustmentType: 'qfq', tailStatus: 'provisional',
  });
  assert.equal((await storage.readKline('600004')).tailStatus, 'provisional', '盘中暂定尾K按暂定落库');
  assert.equal((await storage.readKline('600004')).tailConfirmedAt, '', '暂定状态不得写确认时间');
  await storage.writeKline('600004', barsOf(['2026-09-09', '2026-09-10']), '2026-09-10', {
    source: 'tencent', adjustmentType: 'qfq', tailStatus: 'confirmed', tailConfirmedAt: '2026-09-10T07:05:00.000Z',
  });
  const confirmedMeta = await storage.readKline('600004');
  assert.equal(confirmedMeta.tailStatus, 'confirmed', '收盘后重新抓取可升级为已确认');
  assert.equal(confirmedMeta.tailConfirmedAt, '2026-09-10T07:05:00.000Z', '确认时间沿用来源提供值');
  await storage.writeKline('600004', barsOf(['2026-09-10'], 11), '2026-09-11');
  const preservedMeta = await storage.readKline('600004');
  assert.equal(preservedMeta.source, 'tencent', '旧调用方未传 options 时保留来源');
  assert.equal(preservedMeta.adjustmentType, 'qfq', '旧调用方未传 options 时保留复权口径');
  assert.equal(preservedMeta.tailStatus, 'confirmed', '旧调用方未传 options 时保留尾K状态');
  assert.equal(preservedMeta.tailConfirmedAt, '2026-09-10T07:05:00.000Z', '旧调用方未传 options 时保留确认时间');

  // ── D14-06：新票首次同步（腾讯 qfq，节点名可验证）──
  activeSource = 'tencent';
  const first = await klineSync.syncOne('600003');
  assert.equal(first.ok, true, '新票同步成功');
  assert.equal(first.source, 'tencent');
  assert.equal(first.sourceAdjustmentType, 'qfq', 'qfqday 节点应解析为 qfq');
  assert.equal(first.writeDecision, 'no-stored-series');
  assert.equal(first.tailStatus, 'confirmed', '历史交易日尾K应确认');
  const stored = await storage.readKline('600003');
  assert.equal(stored.adjustmentType, 'qfq');
  assert.equal(stored.sourceLatestDate, '2026-09-10');
  assert.equal(stored.tailStatus, 'confirmed');

  // ── 来源切换：已确认 qfq 的腾讯序列 → 口径无法验证的新浪 → 拒绝混写 ──
  activeSource = 'sina';
  const switchRejected = await klineSync.syncOne('600003');
  assert.equal(switchRejected.ok, false, '未知口径来源不得混写');
  assert.equal(switchRejected.errorCode, 'KLINE_ADJUSTMENT_UNVERIFIED');
  assert.equal(switchRejected.action, 'rebuild_required');
  assert.equal(switchRejected.changed, false);
  const afterReject = await storage.readKline('600003');
  assert.equal(afterReject.adjustmentType, 'qfq', '拒绝写入后本地口径不变');
  assert.equal(afterReject.kline.length, stored.kline.length, '拒绝写入后本地序列不变');

  // ── 复权冲突：同一腾讯源由 qfqday 改为 day（未复权）节点 → 拒绝覆盖同名序列 ──
  activeSource = 'tencent';
  tencentNode600006 = 'qfqday';
  const conflict = await klineSync.syncOne('600006');
  assert.equal(conflict.ok, true, '无本地序列时仍可写入');
  const conflictStored = await storage.readKline('600006');
  assert.equal(conflictStored.adjustmentType, 'qfq', 'qfqday 节点应解析为 qfq');
  tencentNode600006 = 'day';
  const conflictAfter = await klineSync.syncOne('600006');
  assert.equal(conflictAfter.ok, false, '不同复权口径不得覆盖既有序列');
  assert.equal(conflictAfter.errorCode, 'KLINE_ADJUSTMENT_CONFLICT');
  assert.equal(conflictAfter.action, 'rebuild_required');
  assert.equal((await storage.readKline('600006')).adjustmentType, 'qfq', '冲突后本地口径保持为 qfq');

  // ── 兼容 fetchKline 调用方：拒绝落库时只能返回本地序列，不能泄漏冲突源数据 ──
  activeSource = 'tencent';
  const localSeries = await fetchKline('600007', { lmt: 2, dataSource: 'live', prefer: 'tencent' });
  activeSource = 'sina';
  const conflictSeries = await fetchKline('600007', { lmt: 2, dataSource: 'live', prefer: 'sina' });
  assert.deepEqual(conflictSeries, localSeries, '来源/复权冲突拒绝落库后应继续返回已验证本地序列');
  assert.equal((await storage.readKline('600007')).source, 'tencent', '冲突源不得改写本地元数据');

  // ── 旧库口径不可验证 + 来源切换：拒绝增量混写，明确要求整段重建 ──
  activeSource = 'tencent';
  const legacySwitchRejected = await klineSync.syncOne('600001');
  assert.equal(legacySwitchRejected.ok, false, '不可验证的旧序列切换来源时必须拒绝增量混写');
  assert.equal(legacySwitchRejected.writeDecision, 'provenance-conflict');
  assert.equal(legacySwitchRejected.errorCode, 'KLINE_PROVENANCE_CONFLICT');
  assert.equal(legacySwitchRejected.action, 'rebuild_required');
  assert.match(legacySwitchRejected.error, /来源切换/);
  const legacyAfterReject = await storage.readKline('600001');
  assert.equal(legacyAfterReject.source, 'sina', '拒绝后保留旧来源');
  assert.equal(legacyAfterReject.adjustmentType, 'qfq', '拒绝后保留旧库原始口径记录');

  // ── 空响应 / 全部源不可用：保留本地序列并给出可重试错误 ──
  activeSource = 'none';
  const unavailable = await klineSync.syncOne('600003');
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.errorCode, 'KLINE_SOURCE_UNAVAILABLE');
  assert.equal(unavailable.retryable, true);
  assert.equal((await storage.readKline('600003')).kline.length, stored.kline.length, '全部源失败时不得改动本地序列');

  // ── D14-05：暂定尾K必须让推荐失效 ──
  const provisionalAssessment = assessRecommendation(null, { tailStatus: 'provisional' });
  assert.equal(provisionalAssessment.current, false);
  assert.ok(provisionalAssessment.reasons.some((x) => x.includes('尾K尚未收盘确认')), '暂定尾K应写入失效理由');
  const noTailAssessment = assessRecommendation(null, { tailStatus: '' });
  assert.ok(!noTailAssessment.reasons.some((x) => x.includes('尾K尚未收盘确认')), '未提供尾K状态时不额外加理由');

  await storage.flush();
  assert.ok(fs.existsSync(storage.DB_FILE), '临时目录内应生成隔离数据库文件');
  assert.ok(storage.DB_FILE.startsWith(tempDir), '数据库必须落在临时目录，不影响真实 K 线库');

  console.log('kline-meta-migration.test 通过');
})().catch((error) => { console.error(error); process.exitCode = 1; });
