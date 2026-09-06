// 批量研判独立进程。API 主进程通过 IPC 调用，避免研判计算阻塞页面请求。
const judgmentBatch = require('./judgment-batch');
const judgmentStore = require('./judgment-store');
const storage = require('./storage');
judgmentBatch.setEventSink((status) => { if (process.send) process.send({ type: 'event', event: 'batch.status', status }); });

// 写入委托桥：Worker 不直接写 kline.db（全量导出语义下双进程写入会互相覆盖），
// 全部落库请求转交主进程执行并等待回执。自身内存库只作为批量开始时的只读基线。
const pendingDbWrites = new Map();
let dbWriteSeq = 0;

if (process.send) {
  storage.setWriteDelegate((fn, args) => new Promise((resolve, reject) => {
    const id = `dbw_${Date.now().toString(36)}_${++dbWriteSeq}`;
    pendingDbWrites.set(id, { resolve, reject });
    process.send({ type: 'dbwrite', id, fn, args });
  }));
}

function settleDbWrite(msg) {
  const p = pendingDbWrites.get(msg.id);
  if (!p) return;
  pendingDbWrites.delete(msg.id);
  if (msg.error) p.reject(new Error(msg.error));
  else p.resolve(msg.result);
}

function reply(id, data) {
  if (process.send) process.send({ type: 'reply', id, data });
}

process.on('message', async (msg) => {
  if (msg && msg.type === 'dbwrite-reply') { settleDbWrite(msg); return; }
  if (!msg || !msg.id) return;
  try {
    if (msg.action === 'start') {
      // 写入已收敛到主进程，Worker 内存库不再随研判更新；每批开始前从磁盘重载基线，
      // 让 classify 读到上一批的研判结果，避免同数据被重复研判。
      await storage.reloadDbFromDisk();
      reply(msg.id, await judgmentBatch.start(msg.options || {}));
    } else if (msg.action === 'stop') {
      reply(msg.id, judgmentBatch.stop());
    } else if (msg.action === 'status') {
      reply(msg.id, judgmentBatch.getStatus());
    } else if (msg.action === 'preview') {
      await storage.reloadDbFromDisk();
      reply(msg.id, await judgmentBatch.preview(msg.options || {}));
    } else if (msg.action === 'verify-dbwrite') {
      // 自检：按生产顺序走完整委托链路（价位集 → 风险计划 → 研判记录），供集成测试与在线诊断。
      const payload = msg.options || {};
      const levels = await storage.writePriceLevelSet(payload.priceLevelSet);
      const priceLevelSetId = levels && levels.id != null ? levels.id : null;
      const plan = await storage.saveStockRiskPlan({ ...(payload.riskPlan || {}), sourceLevelSetId: priceLevelSetId });
      const record = await storage.writeJudgmentRecord({ ...(payload.judgmentRecord || {}), priceLevelSetId });
      reply(msg.id, { ok: true, levels, plan, record });
    } else {
      reply(msg.id, { ok: false, error: '未知 Worker 操作' });
    }
  } catch (e) {
    reply(msg.id, { ok: false, error: e.message || String(e) });
  }
});

if (process.send) {
  process.send({ type: 'ready' });
  // 主进程退出后 IPC 通道关闭：拒绝悬挂中的写入委托并退出，避免孤儿 Worker 继续调用 AI。
  process.on('disconnect', () => {
    for (const p of pendingDbWrites.values()) p.reject(new Error('主进程已退出，写入委托中断'));
    pendingDbWrites.clear();
    process.exit(1);
  });
  // API/Worker 重启后，自动恢复上次异常中断的 running 批次；幂等判断会跳过已保存结果。
  const last = judgmentStore.listBatches()[0];
  if (last && last.reason === 'running' && !judgmentBatch.getStatus().running) {
    setImmediate(() => judgmentBatch.start({ retryOnly: false, gapMs: last.gapMs, concurrency: last.concurrency }).catch(() => {}));
  }
}
