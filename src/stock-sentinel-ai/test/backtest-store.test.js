// 回测库只读层 + 实盘凭据表自检：
//   1) data/backtest.db 只读（字段字典/形态字典/分档统计/时点网格），不在回测库里写任何东西；
//   2) data/kline.db 的 bt_decision 建表、幂等写入、次日回填与命中率口径。
// 全部在临时目录内构造夹具，不触碰真实 data/。
const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-backtest-'));
const FIXTURE_DB = path.join(TMP, 'backtest.db');
process.env.VOLUME_INSIGHT_DATA_DIR = TMP;
process.env.VOLUME_INSIGHT_KLINE_DB = path.join(TMP, 'kline.db');
process.env.SENTINEL_BACKTEST_DB = FIXTURE_DB;

const initSqlJs = require('sql.js/dist/sql-asm.js').default;
const backtestStore = require('../backtest-store');
const storage = require('../storage');

// decisionId..settledAt 共 31 列（与 tools/backtest_store.py 的 DECISION_DDL、
// data/backtest/bt_decision.sql、storage.js 的建表语句三处同源）。
const BT_DECISION_COLUMN_COUNT = 31;

function buildFixture(SQL) {
  const db = new SQL.Database();
  db.run('CREATE TABLE bt_meta (key TEXT PRIMARY KEY, value TEXT, updatedAt TEXT)');
  db.run("INSERT INTO bt_meta VALUES ('schemaVersion', 'bt-schema-v2', '2026-09-21T09:14:05')");
  db.run(`CREATE TABLE bt_run (
    runId INTEGER PRIMARY KEY, runKey TEXT, createdAt TEXT, engineVersion TEXT, priceMode TEXT,
    buyTime INTEGER, sellTimeStart INTEGER, sellTimeEnd INTEGER, costBps REAL, universeFilter TEXT,
    excludeIndustry TEXT, keepDelisted INTEGER, paramsJson TEXT, tradeCount INTEGER, note TEXT)`);
  db.run("INSERT INTO bt_run VALUES (1, 'daily-20210104-20260917-stockonly-d1', '2026-09-21T09:14:05', 'bt-schema-v2', 'qfq-adjust',"
    + " 1430, 930, 1000, 15.0, 'A股个股', '银行', 0, '{}', 5406890, '日线近似口径')");
  db.run(`CREATE TABLE bt_stat (
    statId INTEGER PRIMARY KEY, runId INTEGER, dimension TEXT, bucket TEXT, sampleCnt INTEGER,
    hit1Pct REAL, hit2Pct REAL, hit3Pct REAL, hit4Pct REAL, hit5Pct REAL, hit6Pct REAL, hit7Pct REAL,
    hit8Pct REAL, hit9Pct REAL, limitUpPct REAL, retOpenMean REAL, retHighMean REAL, retCloseMean REAL,
    stratMean REAL, winRate REAL, profitFactor REAL, lift3 REAL, ci95Low REAL, ci95High REAL,
    byYearJson TEXT, stability TEXT, note TEXT)`);
  db.run("INSERT INTO bt_stat VALUES (1, 1, 'day_shape', '上升通道', 8596, 60, 40, 29.08, 20, 14, 10, 8, 6, 5, 2,"
    + " -0.1, 2.5, 0.1, 0.3, 55, 1.6, 1.401, 27.0, 31.0, '{}', 'stable', '日线批次')");
  db.run(`CREATE TABLE bt_pattern_def (
    patternId TEXT PRIMARY KEY, nameCn TEXT, scope TEXT, periods TEXT, sourceModule TEXT, category TEXT,
    direction TEXT, weight INTEGER, priority INTEGER, bitIndex INTEGER, ruleExpr TEXT, ruleParams TEXT,
    basisNote TEXT, version TEXT, usableForDecision INTEGER, evidenceTradeCnt INTEGER,
    evidenceHit3Pct REAL, evidenceLift REAL, evidenceYears TEXT, validatedAt TEXT)`);
  db.run("INSERT INTO bt_pattern_def VALUES ('limit_pullback', '涨停回踩', 'day', 'day', 'registry:xingtaidu', '短线', 'bull',"
    + " 1, 210, 10, '近 N 日有涨停', '{}', '日线窗口按日计', 'registry-2026-09-18', 1, 6820, 30.748, 1.4849, '{}', '')");
  db.run("INSERT INTO bt_pattern_def VALUES ('tf5_box', '5分钟箱体', 'intraday', '5', 'registry:xingtaidu', '震荡', 'neutral',"
    + " 1, 300, 20, '箱体突破', '{}', '分钟窗口按根计', 'registry-2026-09-18', 0, 120, 22.1, 1.0, '{}', '')");
  db.run(`CREATE TABLE bt_feature_def (
    tableName TEXT, columnName TEXT, nameCn TEXT, meaning TEXT, unit TEXT, valueScope TEXT,
    source TEXT, calcRule TEXT, isFeature INTEGER)`);
  db.run("INSERT INTO bt_feature_def VALUES ('bt_trade', 'turnoverPct', '换手率', '当日成交量占流通股本比例', '%', '0~100',"
    + " 'floatcap_approx', '成交量 ÷ 流通股本', 1)");
  db.run("INSERT INTO bt_feature_def VALUES ('bt_trade', 'dayShape', '日线形态位置', '互斥 6 类形态位置', '枚举', '6 类',"
    + " 'tools/day_shape.py', '均线结构 + 通道回归', 1)");
  db.run(`CREATE TABLE bt_time_grid (
    runId INTEGER, buyMinute INTEGER, sellMinute INTEGER, sampleCnt INTEGER, retMeanPct REAL,
    retMedPct REAL, winRate REAL, retStdPct REAL, hit3Pct REAL)`);
  db.run('INSERT INTO bt_time_grid VALUES (3, 1430, 930, 292685, -0.1295, 0, NULL, NULL, 7.5)');
  db.run('INSERT INTO bt_time_grid VALUES (3, 1439, 956, 292685, 0.0355, 0, NULL, NULL, 7.49)');
  fs.writeFileSync(FIXTURE_DB, Buffer.from(db.export()));
  db.close();
}

async function readKlineTableNames(SQL) {
  const db = new SQL.Database(fs.readFileSync(process.env.VOLUME_INSIGHT_KLINE_DB));
  const res = db.exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
  const names = res.length ? res[0].values.map((r) => String(r[0])) : [];
  db.close();
  return names;
}

(async () => {
  const SQL = await initSqlJs();

  // ── 1. 回测库只读层 ────────────────────────────────────────────
  assert.strictEqual(backtestStore.available(), false, '未建夹具前应判定为不可用');
  const missing = await backtestStore.summary();
  assert.strictEqual(missing.ok, false);
  assert.strictEqual(missing.available, false);
  assert.deepStrictEqual(await backtestStore.featureDict(), [], '库缺失时字段字典应为空数组而不是抛错');
  assert.deepStrictEqual(await backtestStore.patternDefs(), []);
  assert.deepStrictEqual(await backtestStore.statRows(), []);
  assert.deepStrictEqual(await backtestStore.timeGrid(), []);
  assert.deepStrictEqual(await backtestStore.statDimensions(), []);
  const missingModel = await backtestStore.decisionModel();
  assert.strictEqual(missingModel.ok, false, '模型文件缺失时应返回 ok=false');
  assert.strictEqual(missingModel.available, false);
  assert.ok(String(missingModel.modelFile).endsWith('decision_model.json'), '应给出模型期望路径便于排查');

  buildFixture(SQL);
  assert.strictEqual(backtestStore.available(), true);

  const summary = await backtestStore.summary();
  assert.strictEqual(summary.ok, true);
  assert.strictEqual(summary.meta.schemaVersion, 'bt-schema-v2');
  assert.strictEqual(summary.runs.length, 1);
  assert.strictEqual(summary.runs[0].buyTime, 1430, '买入时刻应为 14:30');
  assert.strictEqual(summary.runs[0].sellTimeEnd, 1000, '卖出窗口应止于 10:00');
  assert.strictEqual(summary.counts.bt_trade, undefined, '夹具无 bt_trade 表时不应虚构计数');
  assert.ok(summary.tables.includes('bt_stat'));

  const dict = await backtestStore.featureDict();
  assert.strictEqual(dict.length, 2);
  assert.ok(dict.every((row) => row.nameCn && row.nameCn.length), '每条字段登记都要有中文名');
  assert.strictEqual((await backtestStore.featureDict({ tableName: 'bt_trade' })).length, 2);
  assert.strictEqual((await backtestStore.featureDict({ tableName: 'bt_run' })).length, 0);

  const patterns = await backtestStore.patternDefs();
  assert.strictEqual(patterns.length, 2);
  assert.strictEqual(patterns[0].scope, 'day', '日线形态应排在分钟形态之前');
  const usable = await backtestStore.patternDefs({ usableOnly: true });
  assert.strictEqual(usable.length, 1);
  assert.strictEqual(usable[0].patternId, 'limit_pullback');
  assert.strictEqual((await backtestStore.patternDefs({ scope: 'intraday' })).length, 1);

  const stats = await backtestStore.statRows({ runId: 1, dimension: 'day_shape' });
  assert.strictEqual(stats.length, 1);
  assert.strictEqual(stats[0].bucket, '上升通道');
  assert.strictEqual(stats[0].hit3Pct, 29.08);
  assert.strictEqual(stats[0].sampleCnt, 8596);
  const dims = await backtestStore.statDimensions();
  assert.strictEqual(dims.length, 1);
  assert.strictEqual(dims[0].bucketCnt, 1);

  const grid = await backtestStore.timeGrid({ runId: 3 });
  assert.strictEqual(grid.length, 2);
  assert.strictEqual(grid[0].buyMinute, 1430, '时点网格应按买入时刻升序');
  assert.strictEqual(grid[0].retMeanPct, -0.1295);

  // 概率评分模型：只读解析 + mtime 缓存 + 不写文件。
  const MODEL_FILE = path.join(TMP, 'decision_model.json');
  fs.writeFileSync(MODEL_FILE, JSON.stringify({
    version: 'decision-model-v1', runId: 1, shrinkageK: 50,
    targets: { up3: { baseHitPct: 21.3, coef: [] } },
    calibration: { up3: { deciles: [{ decile: 10, predPct: 45.0, actualPct: 44.5 }] } },
    topk: { top3: { k: 3, days: 1382, hit3Pct: 44.67 } },
    risk: [{ key: 'openNegative' }],
  }), 'utf8');
  const modelBefore = fs.readFileSync(MODEL_FILE);
  const loaded = await backtestStore.decisionModel();
  assert.strictEqual(loaded.ok, true);
  assert.strictEqual(loaded.model.version, 'decision-model-v1');
  assert.strictEqual(loaded.model.topk.top3.hit3Pct, 44.67);
  await backtestStore.decisionModel();
  assert.ok(modelBefore.equals(fs.readFileSync(MODEL_FILE)), 'App 侧不得改写模型 JSON');
  fs.writeFileSync(MODEL_FILE, '{ 这不是 JSON', 'utf8');
  const broken = await backtestStore.decisionModel();
  assert.strictEqual(broken.ok, false, '模型损坏时应返回 ok=false 而不是抛错');
  assert.strictEqual(broken.available, true, '文件存在但不可解析时 available 仍为 true');

  // 只读性：全流程结束后回测库文件字节不得变化。
  const before = fs.readFileSync(FIXTURE_DB);
  await backtestStore.summary();
  await backtestStore.featureDict();
  await backtestStore.statRows();
  assert.ok(before.equals(fs.readFileSync(FIXTURE_DB)), 'App 侧不得写回测库');

  // ── 2. 实盘凭据表（kline.db）────────────────────────────────────
  const emptyScorecard = await storage.btDecisionScorecard();
  assert.deepStrictEqual(emptyScorecard, { total: 0, settled: 0, hits: 0, hit3Pct: null, avgExitRet: null, firstDate: null, lastDate: null, bySource: [] });
  assert.deepStrictEqual(await storage.listBtDecisions(), []);

  const saved = await storage.saveBtDecisions([
    { tradeDate: 20260921, code: '600001', name: '样例一', runId: 10, runKey: 'tf-...', score: 88.5, up3Prob: 62.4, marketRegime: 'range_strong' },
    { tradeDate: '20260921', code: '300001', name: '样例二', runId: 10, score: 71.2, up3Prob: 41.0 },
    { tradeDate: 20260921, code: 'BAD', name: '代码非法应跳过' },
    { code: '600002', name: '缺决策日应跳过' },
  ]);
  assert.strictEqual(saved.ok, true);
  assert.strictEqual(saved.saved, 2);
  assert.strictEqual(saved.skipped, 2, '非法行必须被跳过而不是写坏库');

  const today = await storage.listBtDecisions({ tradeDate: 20260921 });
  assert.strictEqual(today.length, 2);
  assert.strictEqual(today[0].code, '600001', '同日内应按评分倒序');
  assert.strictEqual(today[0].up3Prob, 62.4);
  assert.strictEqual(today[0].createdAt.length > 0, true, '写入时应补 createdAt');

  // 幂等：同一 (tradeDate, code) 覆盖，不产生重复行。
  await storage.saveBtDecisions([{ tradeDate: 20260921, code: '600001', name: '样例一（改）', score: 90 }]);
  const afterUpsert = await storage.listBtDecisions({ tradeDate: 20260921 });
  assert.strictEqual(afterUpsert.length, 2, '重复写入不得产生第二行');
  assert.strictEqual(afterUpsert[0].score, 90);
  assert.strictEqual(afterUpsert[0].name, '样例一（改）');

  // 次日回填：只更新实际列，并进入命中率口径。
  const settled = await storage.settleBtDecision({ tradeDate: 20260921, code: '600001', actualEntryPrice: 10.2, actualHigh: 10.9, actualExitPrice: 10.8, actualRetHigh: 6.86, actualRetExit: 5.88, hit3: 1 });
  assert.strictEqual(settled.ok, true);
  const badSettle = await storage.settleBtDecision({ tradeDate: 20260921, code: 'X' });
  assert.strictEqual(badSettle.ok, false);
  const scorecard = await storage.btDecisionScorecard();
  assert.strictEqual(scorecard.total, 2);
  assert.strictEqual(scorecard.settled, 1, '未回填的记录不进命中率分母');
  assert.strictEqual(scorecard.hits, 1);
  assert.strictEqual(scorecard.hit3Pct, 100);
  assert.strictEqual(scorecard.avgExitRet, 5.88);
  assert.strictEqual(scorecard.firstDate, 20260921);
  assert.deepStrictEqual(scorecard.bySource, [{
    source: 'unknown', total: 2, settled: 1, hits: 1, hit3Pct: 100,
    avgExitRet: 5.88, firstDate: 20260921, lastDate: 20260921,
  }], '未标注 source 的记录归入 unknown 通道');

  // 通道拆分：候选池与尾盘 14:40 反推的风险边界不同，命中率必须分通道统计。
  await storage.saveBtDecisions([
    { tradeDate: 20260921, code: '600001', name: '样例一', source: 'reverse-1440', score: 80 },
    { tradeDate: 20260921, code: '301001', name: '样例三', source: 'pool', score: 70 },
  ]);
  await storage.settleBtDecision({ tradeDate: 20260921, code: '600001', actualRetExit: 2.5, hit3: 0 });
  const bySource = (await storage.btDecisionScorecard()).bySource;
  assert.strictEqual(bySource.length, 3, '应按通道拆成 3 组');
  const channel = Object.fromEntries(bySource.map((r) => [r.source, r]));
  assert.strictEqual(channel['reverse-1440'].total, 1);
  assert.strictEqual(channel['reverse-1440'].settled, 1);
  assert.strictEqual(channel['reverse-1440'].hit3Pct, 0);
  assert.strictEqual(channel['reverse-1440'].avgExitRet, 2.5);
  assert.strictEqual(channel.pool.total, 1);
  assert.strictEqual(channel.pool.settled, 0, '未回填的通道不进命中率分母');
  assert.strictEqual(channel.pool.hit3Pct, null);
  assert.strictEqual(channel.unknown.total, 1, '600001 改标通道后 unknown 只剩 300001');

  // 落盘检查：kline.db 里确有 bt_decision，且列数与 DDL 一致（32 列）。
  await storage.flush();
  const tableNames = await readKlineTableNames(SQL);
  assert.ok(tableNames.includes('bt_decision'), `kline.db 应含 bt_decision，实际 ${tableNames.join(',')}`);
  assert.ok(tableNames.includes('kline'), '原有 kline 表不得被影响');
  const klineDb = new SQL.Database(fs.readFileSync(process.env.VOLUME_INSIGHT_KLINE_DB));
  const info = klineDb.exec('PRAGMA table_info(bt_decision)');
  klineDb.close();
  assert.strictEqual(info[0].values.length, BT_DECISION_COLUMN_COUNT, 'bt_decision 列数应与 DDL 一致');

  console.log('backtest-store.test.js 全部通过');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
