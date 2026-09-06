// SQLite 研判记录与价位集合自检：验证追加记录、成功幂等、失败保留、价位版本 upsert。
const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFileSync } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-judgment-'));
process.env.VOLUME_INSIGHT_DATA_DIR = TMP;
process.env.VOLUME_INSIGHT_KLINE_DB = path.join(TMP, 'kline.db');

const storage = require('../storage');

(async () => {
  assert.strictEqual(await storage.getAiPrompt(), null, '空库不应虚构专业操盘 Prompt');
  const prompt1 = await storage.saveAiPrompt('优先核查量价结构。', 'custom-v1');
  assert.strictEqual(prompt1.ok, true);
  assert.deepStrictEqual(await storage.getAiPrompt(), { prompt: '优先核查量价结构。', version: 'custom-v1', updatedAt: prompt1.updatedAt });
  const prompt2 = await storage.saveAiPrompt('优先核查量价与阶段变化。', 'custom-v2');
  assert.strictEqual(prompt2.ok, true);
  const savedPrompt = await storage.getAiPrompt();
  assert.strictEqual(savedPrompt.prompt, '优先核查量价与阶段变化。');
  assert.strictEqual(savedPrompt.version, 'custom-v2');
  const blankPrompt = await storage.saveAiPrompt('   ', 'custom-v3');
  assert.strictEqual(blankPrompt.ok, false, '空 Prompt 应被拒绝');
  assert.strictEqual((await storage.getAiPrompt()).prompt, '优先核查量价与阶段变化。', '空 Prompt 不得覆盖已有配置');

  const key = { code: '600001', evidenceHash: 'hash-1', promptVersion: 'judgment-v1', model: 'gpt-test' };
  const failed = {
    code: key.code, evidenceHash: key.evidenceHash, promptVersion: key.promptVersion, model: key.model,
    batchId: 'b1', tradeDate: '2026-09-03', marketPhase: 'closed', isFinal: false,
    dataStatus: 'full', judgmentStatus: 'failed', scoreStatus: 'none', attempt: 0,
    startedAt: 1, finishedAt: 2, durationMs: 1, errorCode: 'timeout', errorMessage: '超时',
    modelResult: null, rawContent: 'x', usage: null, evidence: { code: key.code },
  };
  const w1 = await storage.writeJudgmentRecord(failed);
  assert.strictEqual(w1.ok, true, '失败尝试应写入');
  assert.strictEqual(w1.skipped, false);
  assert.strictEqual((await storage.listJudgmentAttempts(key.code)).length, 1);
  assert.strictEqual(await storage.getLastSuccessJudgment(key.code), null, '失败不应产生成功记录');

  const success = { ...failed, judgmentStatus: 'success', errorCode: null, errorMessage: null, attempt: 1, modelResult: { verdict: 'new_evidence', summary: '结论' } };
  const w2 = await storage.writeJudgmentRecord(success);
  assert.strictEqual(w2.ok, true);
  assert.strictEqual(w2.skipped, false);
  assert.ok(w2.id != null);
  const last = await storage.getLastSuccessJudgment(key.code);
  assert.ok(last, '应读到最近成功');
  assert.strictEqual(last.verdict || (last.modelResult && last.modelResult.verdict), 'new_evidence');

  const dup = { ...success, attempt: 2 };
  const w3 = await storage.writeJudgmentRecord(dup);
  assert.strictEqual(w3.skipped, true, '相同成功幂等键应跳过');
  const attempts = await storage.listJudgmentAttempts(key.code);
  assert.ok(attempts.length >= 2, '失败与成功尝试都应保留');

  const levels = {
    code: key.code, tradeDate: '2026-09-03', evidenceHash: key.evidenceHash,
    algorithmVersion: 'levels-v1', adjustmentType: 'qfq', klineDate: '2026-09-03', snapshotAt: '2026-09-03',
    supportZones: [{ low: 9.8, high: 10.1, strength: 70, sources: ['swingLow'] }],
    resistanceZones: [{ low: 11.0, high: 11.3, strength: 65, sources: ['swingHigh'] }],
    entryTriggers: [], invalidationLevel: { value: 9.5 }, exitWatchZones: [], riskReward: { value: null, state: null, available: false },
    evidence: { code: key.code },
  };
  const l1 = await storage.writePriceLevelSet(levels);
  assert.strictEqual(l1.ok, true);
  const l2 = await storage.writePriceLevelSet(levels);
  assert.strictEqual(l2.skipped, true, '同证据同算法版本应复用价位集合');
  const got = await storage.getPriceLevelSet(key.code, key.evidenceHash, 'levels-v1');
  assert.ok(got, '应读回价位集合');
  assert.deepStrictEqual(got.supportZones, levels.supportZones);

  // 同日不同证据再次研判：成功结论覆盖当日旧成功，失败尝试保留，仍只留一份成功。
  const success2 = { ...success, evidenceHash: 'hash-2', attempt: 3, modelResult: { verdict: 'revise', summary: '当日更新结论' } };
  const w4 = await storage.writeJudgmentRecord(success2);
  assert.strictEqual(w4.ok, true);
  assert.strictEqual(w4.skipped, false, '同日不同证据应覆盖当日旧成功');
  const attemptsAfter = await storage.listJudgmentAttempts(key.code);
  const successes = attemptsAfter.filter((a) => a.judgmentStatus === 'success');
  assert.strictEqual(successes.length, 1, '同一 tradeDate 只保留一份成功结论');
  assert.strictEqual(successes[0].modelResult.verdict, 'revise');
  assert.strictEqual(attemptsAfter.filter((a) => a.judgmentStatus === 'failed').length, 1, '失败尝试不应被覆盖');

  // 下一交易日新增成功：允许保留「每交易日一份」的跨日历史。
  const successNext = { ...success2, tradeDate: '2026-09-04', attempt: 4, evidenceHash: 'hash-3' };
  const w5 = await storage.writeJudgmentRecord(successNext);
  assert.strictEqual(w5.ok, true);
  assert.strictEqual(
    (await storage.listJudgmentAttempts(key.code)).filter((a) => a.judgmentStatus === 'success').length,
    2,
    '跨日成功记录应各自保留一份'
  );

  // 模拟批量 Worker 在另一个 Node 进程落库：主进程须主动重载 sql.js 内存库。
  const externalCode = '600002';
  const childScript = `
    const storage = require(${JSON.stringify(path.join(__dirname, '..', 'storage'))});
    storage.writeJudgmentRecord(${JSON.stringify({
      ...successNext,
      code: externalCode,
      evidenceHash: 'external-hash',
      tradeDate: '2026-09-05',
      modelResult: { verdict: 'new_evidence', summary: 'Worker 写入' },
    })}).then(() => process.exit(0)).catch(() => process.exit(1));
  `;
  execFileSync(process.execPath, ['-e', childScript], { env: process.env, stdio: 'pipe' });
  assert.strictEqual(await storage.getLastSuccessJudgment(externalCode), null, '重载前不应伪造 Worker 写入结果');
  assert.strictEqual(await storage.reloadDbFromDisk(), true, '应重载 Worker 已落盘的数据');
  assert.strictEqual((await storage.getLastSuccessJudgment(externalCode)).modelResult.summary, 'Worker 写入');

  await storage.flush();
  console.log('judgment sqlite ok', TMP);
})().catch((e) => { console.error(e); process.exit(1); });
