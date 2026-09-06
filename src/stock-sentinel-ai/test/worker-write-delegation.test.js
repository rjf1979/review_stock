// 智诊盯盘 · 研判 Worker 写入委托集成测试：
// Worker 进程不直接写 kline.db，所有落库经 IPC 转交主进程执行并立即落盘，
// 保证同一时刻只有一个进程持有 SQLite 写入权（防止陈旧内存副本整体覆盖磁盘）。
const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { fork } = require('child_process');

// 必须在 require 业务模块之前设置数据目录，指向临时目录（fork 的 Worker 继承该环境变量）。
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-delegate-'));
process.env.VOLUME_INSIGHT_DATA_DIR = TMP;

const storage = require('../storage');
const { applyDbWrite } = require('../worker-manager');

const priceLevelSet = {
  code: '600001', tradeDate: '2026-09-04', evidenceHash: 'hash-delegate-1',
  algorithmVersion: 'levels-v1', adjustmentType: 'qfq',
  klineDate: '2026-09-04', snapshotAt: '2026-09-04',
  supportZones: [{ low: 9.9, high: 10.1 }], resistanceZones: [{ low: 11, high: 11.2 }],
  entryTriggers: ['回踩企稳'], invalidationLevel: 9.5, exitWatchZones: [{ low: 11.5, high: 12 }],
  riskReward: { value: 2.5, state: 'ok', available: true },
  evidence: { evidenceDates: { klineDate: '2026-09-04', snapshotDate: '2026-09-04' } },
};
const judgmentRecord = {
  code: '600001', batchId: 'batch_test_delegate', tradeDate: '2026-09-04',
  evidenceHash: 'hash-delegate-1', promptVersion: 'judgment-v2-test', model: 'test-model',
  dataStatus: 'full', judgmentStatus: 'success',
  startedAt: Date.now(), finishedAt: Date.now(),
  evidence: { evidenceDates: { klineDate: '2026-09-04', snapshotDate: '2026-09-04' } },
};
const riskPlan = { code: '600001', tradingStyle: 'short', evidenceHash: 'hash-delegate-1', entryTriggers: ['回踩企稳'], stopLoss: 9.5, takeProfit: [] };

(async () => {
  const child = fork(path.join(__dirname, '..', 'judgment-worker.js'), [], {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    env: { ...process.env, VOLUME_INSIGHT_DATA_DIR: TMP },
  });
  const pending = new Map();
  let seq = 0;
  child.on('message', async (msg) => {
    if (!msg) return;
    if (msg.type === 'dbwrite') {
      // 测试进程扮演主进程：委托写入落到本进程的临时数据库。
      try {
        const result = await applyDbWrite(msg.fn, msg.args);
        child.send({ type: 'dbwrite-reply', id: msg.id, result });
      } catch (e) {
        child.send({ type: 'dbwrite-reply', id: msg.id, error: e.message || String(e) });
      }
      return;
    }
    if (msg.type === 'reply') {
      const p = pending.get(msg.id);
      if (p) { pending.delete(msg.id); p(msg.data); }
    }
  });

  const call = (action, options) => new Promise((resolve, reject) => {
    const id = `t${++seq}`;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC 超时: ${action}`)); }, 20000);
    pending.set(id, (data) => { clearTimeout(timer); resolve(data); });
    child.send({ id, action, options });
  });

  const r = await call('verify-dbwrite', { priceLevelSet, judgmentRecord, riskPlan });
  assert.ok(r && r.ok, 'verify-dbwrite 应成功');
  assert.ok(r.levels && r.levels.ok && r.levels.id != null, '价位集应经委托写入并获得 id');
  assert.ok(r.plan === true || (r.plan && r.plan.ok !== false), '风险计划应经委托写入');
  assert.ok(r.record && r.record.ok && r.record.id != null, '研判记录应经委托写入并获得 id');

  // 主进程内存立即可读回（含证据日期与价位集引用，供闭市分类规则使用）
  const lastSuccess = await storage.getLastSuccessJudgment('600001');
  assert.ok(lastSuccess, '主进程内存应读回成功记录');
  assert.strictEqual(String(lastSuccess.tradeDate || ''), '2026-09-04');
  assert.strictEqual(lastSuccess.evidence.evidenceDates.klineDate, '2026-09-04');
  assert.strictEqual(Number(lastSuccess.priceLevelSetId), r.levels.id, '研判记录应引用价位集 id');

  // 磁盘文件同步校验：writeJudgmentRecord 事务提交后立即刷盘，新开 sql.js 实例应能读到
  const initSqlJs = require('sql.js/dist/sql-asm.js').default;
  const SQL = await initSqlJs();
  const fresh = new SQL.Database(fs.readFileSync(storage.DB_FILE));
  const q = (sql) => { const x = fresh.exec(sql); return x.length ? x[0].values : []; };
  assert.strictEqual(q(`SELECT COUNT(*) FROM judgment_records WHERE batchId = 'batch_test_delegate'`)[0][0], 1, '研判记录应已落盘');
  assert.strictEqual(q(`SELECT COUNT(*) FROM price_level_sets WHERE code = '600001' AND evidenceHash = 'hash-delegate-1'`)[0][0], 1, '价位集应已落盘');
  assert.strictEqual(q(`SELECT COUNT(*) FROM stock_risk_plans WHERE code = '600001'`)[0][0], 1, '风险计划应已落盘');
  fresh.close();

  // 未知写入委托必须拒绝，而不是静默丢弃
  await assert.rejects(() => applyDbWrite('notAWriteFunction', []), /未知写入委托/);

  child.kill();
  console.log('worker write delegation passed');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
