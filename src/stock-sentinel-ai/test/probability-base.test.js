// 概率基准锚点自检（decision-model-v2）：
//   1) 基准必须来自模型文件 data/backtest/decision_model.json 的 regimeBases.buckets；
//   2) 不得再按 dimension='market_regime' 去 bt_stat 取行——库里同时存在多个批次时，
//      这样会串到别的批次（历史上取到过 69 日分时反推批的 17.97 / 17.28），
//      于是界面显示的基准和真正算概率用的基准不是同一个数；
//   3) 模型缺失 regimeBases 时才退到模型整体基准 baseSampleHit3Pct，再没有才用常量兜底；
//   4) 模型身份（runId / runKey）必须跟着真实批次走：写死 runId=1 会在旧批次被清出后
//      让实盘凭据指错行。
// 全部在临时目录内构造夹具，不触碰真实 data/。
const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-probbase-'));
const FIXTURE_DB = path.join(TMP, 'backtest.db');
process.env.VOLUME_INSIGHT_DATA_DIR = TMP;
process.env.VOLUME_INSIGHT_KLINE_DB = path.join(TMP, 'kline.db');
process.env.SENTINEL_BACKTEST_DB = FIXTURE_DB;

const initSqlJs = require('sql.js/dist/sql-asm.js').default;

// 生产模型里的环境基准（data/backtest/decision_model.json → regimeBases.buckets），逐位照抄。
const REGIME_BASES = {
  range_strong: { sampleCnt: 12390, up3: 18.64, up5: 7.97, limitUp: 2.2 },
  recovery: { sampleCnt: 5209, up3: 19.93, up5: 8.35, limitUp: 2.55 },
  rotation: { sampleCnt: 15087, up3: 17.97, up5: 7.45, limitUp: 2.19 },
  strong_trend: { sampleCnt: 27985, up3: 21.47, up5: 9.96, limitUp: 2.72 },
  weak: { sampleCnt: 48294, up3: 23.09, up5: 9.99, limitUp: 2.72 },
};
const MODEL_RUN = { runId: 1, runKey: 'daily-20210104-20260917-stockonly-d1' };
const BASE_SAMPLE_HIT3 = 21.306;
const FALLBACK_BASE_HIT3 = 21.31;

// 夹具库里故意写一份「别的批次」的 market_regime 分档（数值越离谱越容易暴露串口径）。
const DECOY_HIT3 = 99.9;

function buildFixture(SQL) {
  const db = new SQL.Database();
  db.run(`CREATE TABLE bt_stat (
    statId INTEGER PRIMARY KEY, runId INTEGER, dimension TEXT, bucket TEXT, sampleCnt INTEGER,
    hit1Pct REAL, hit2Pct REAL, hit3Pct REAL, hit4Pct REAL, hit5Pct REAL, hit6Pct REAL, hit7Pct REAL,
    hit8Pct REAL, hit9Pct REAL, limitUpPct REAL, retOpenMean REAL, retHighMean REAL, retCloseMean REAL,
    stratMean REAL, winRate REAL, profitFactor REAL, lift3 REAL, ci95Low REAL, ci95High REAL,
    byYearJson TEXT, stability TEXT, note TEXT)`);
  // runId=1：日线批次号（数值被污染）；runId=11：69 日分时反推批，正是历史上被误取的那一批。
  for (const runId of [1, 11]) {
    for (const bucket of Object.keys(REGIME_BASES)) {
      db.run('INSERT INTO bt_stat (runId, dimension, bucket, sampleCnt, hit3Pct, lift3) VALUES (?, ?, ?, ?, ?, ?)',
        [runId, 'market_regime', bucket, 100, DECOY_HIT3, 1.0]);
    }
  }
  fs.writeFileSync(FIXTURE_DB, Buffer.from(db.export()));
  db.close();
}

function writeModel(file, extra) {
  fs.writeFileSync(file, JSON.stringify({
    version: 'decision-model-v2',
    targets: { up3: { baseHitPct: BASE_SAMPLE_HIT3, coef: [] } },
    ...extra,
  }), 'utf8');
}

function freshEngine(modelFile) {
  process.env.SENTINEL_DECISION_MODEL = modelFile;
  delete require.cache[require.resolve('../probability-engine')];
  delete require.cache[require.resolve('../backtest-store')];
  return require('../probability-engine');
}

(async () => {
  const SQL = await initSqlJs();
  buildFixture(SQL);

  // ── 1. 模型自带 regimeBases：按环境锚定，忽略 bt_stat ────────────────
  const MODEL_A = path.join(TMP, 'decision_model.json');
  writeModel(MODEL_A, {
    ...MODEL_RUN,
    baseSampleHit3Pct: BASE_SAMPLE_HIT3,
    regimeBases: {
      dimension: 'market_regime',
      ...MODEL_RUN,
      sampleN: 108965,
      baseSampleHit3Pct: BASE_SAMPLE_HIT3,
      buckets: REGIME_BASES,
    },
  });
  const modelBytes = fs.readFileSync(MODEL_A);
  const dbBytes = fs.readFileSync(FIXTURE_DB);

  const engine = freshEngine(MODEL_A);
  for (const [regime, want] of Object.entries(REGIME_BASES)) {
    const got = await engine.baseHit3For(regime);
    assert.strictEqual(got.value, want.up3, `${regime} 的基准应为模型 regimeBases 的 ${want.up3}`);
    assert.strictEqual(got.source, 'model.regimeBases', `${regime} 的基准来源应标为 model.regimeBases`);
  }

  const map = await engine.regimeBaseMap();
  assert.strictEqual(map.size, Object.keys(REGIME_BASES).length, '环境基准档位数应与模型一致');
  assert.ok(![...map.values()].includes(DECOY_HIT3), 'bt_stat 里的分档不得参与基准锚定');
  assert.ok(!map.has('overall'), '只认模型里的环境键');

  const unknown = await engine.baseHit3For('not_a_regime');
  assert.strictEqual(unknown.value, BASE_SAMPLE_HIT3, '模型有整体基准时，未收录环境应退到 baseSampleHit3Pct');
  assert.strictEqual(unknown.source, 'model.baseSampleHit3Pct');
  assert.strictEqual((await engine.baseHit3For('')).source, 'model.baseSampleHit3Pct', '空环境同样走整体基准');

  const identity = await engine.modelIdentity();
  assert.strictEqual(identity.runId, MODEL_RUN.runId, 'runId 必须来自模型文件');
  assert.strictEqual(identity.runKey, MODEL_RUN.runKey, 'runKey 必须来自模型文件');
  assert.strictEqual(identity.version, 'decision-model-v2');

  // ── 2. 模型没有 regimeBases、也没有整体基准：常量兜底（不得回退 bt_stat）──
  const MODEL_B = path.join(TMP, 'decision_model_no_regime.json');
  writeModel(MODEL_B, { ...MODEL_RUN, targets: { up3: { baseHitPct: null, coef: [] } } });
  const engineB = freshEngine(MODEL_B);
  const weakB = await engineB.baseHit3For('weak');
  assert.strictEqual(weakB.value, FALLBACK_BASE_HIT3, '模型无 regimeBases 时应落到常量兜底');
  assert.strictEqual(weakB.source, 'fallback');
  const mapB = JSON.stringify([...await engineB.regimeBaseMap()]);
  assert.ok(!mapB.includes(String(DECOY_HIT3)), '兜底路径同样不得读 bt_stat');

  // ── 3. 模型文件缺失：兜底 + 身份留空（不能伪造成 runId=1）──────────────
  const engineC = freshEngine(path.join(TMP, 'no_such_model.json'));
  const strongC = await engineC.baseHit3For('strong_trend');
  assert.strictEqual(strongC.source, 'fallback');
  assert.strictEqual(strongC.value, FALLBACK_BASE_HIT3);
  const identityC = await engineC.modelIdentity();
  assert.strictEqual(identityC.runId, null, '模型缺失时 runId 应为 null，不得写死批次');
  assert.strictEqual(identityC.runKey, '');

  // ── 4. 只读性：全流程不写模型/回测库，也不产出评分缓存 ────────────────
  assert.ok(modelBytes.equals(fs.readFileSync(MODEL_A)), 'App 侧不得改写模型 JSON');
  assert.ok(dbBytes.equals(fs.readFileSync(FIXTURE_DB)), 'App 侧不得写回测库');
  const stray = fs.readdirSync(TMP).filter((n) => n.startsWith('live_score_'));
  assert.deepStrictEqual(stray, [], '基准查询不应产出打分缓存文件');

  console.log('probability-base.test 通过');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
