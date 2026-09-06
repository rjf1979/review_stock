// 批量研判独立进程。API 主进程通过 IPC 调用，避免研判计算阻塞页面请求。
const judgmentBatch = require('./judgment-batch');
const judgmentStore = require('./judgment-store');
judgmentBatch.setEventSink((status) => { if (process.send) process.send({ type: 'event', event: 'batch.status', status }); });

function reply(id, data) {
  if (process.send) process.send({ type: 'reply', id, data });
}

process.on('message', async (msg) => {
  if (!msg || !msg.id) return;
  try {
    if (msg.action === 'start') {
      reply(msg.id, await judgmentBatch.start(msg.options || {}));
    } else if (msg.action === 'stop') {
      reply(msg.id, judgmentBatch.stop());
    } else if (msg.action === 'status') {
      reply(msg.id, judgmentBatch.getStatus());
    } else if (msg.action === 'preview') {
      reply(msg.id, await judgmentBatch.preview(msg.options || {}));
    } else {
      reply(msg.id, { ok: false, error: '未知 Worker 操作' });
    }
  } catch (e) {
    reply(msg.id, { ok: false, error: e.message || String(e) });
  }
});

if (process.send) {
  process.send({ type: 'ready' });
  // API/Worker 重启后，自动恢复上次异常中断的 running 批次；幂等判断会跳过已保存结果。
  const last = judgmentStore.listBatches()[0];
  if (last && last.reason === 'running' && !judgmentBatch.getStatus().running) {
    setImmediate(() => judgmentBatch.start({ retryOnly: false, gapMs: last.gapMs, concurrency: last.concurrency }).catch(() => {}));
  }
}
