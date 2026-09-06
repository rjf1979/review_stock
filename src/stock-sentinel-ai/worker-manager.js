const { fork } = require('child_process');
const path = require('path');
const storage = require('./storage');

let child = null;
let seq = 0;
const pending = new Map();
const listeners = new Set();

// 主进程是 kline.db 的唯一写入者。研判 Worker 把落库请求经 IPC 转交到这里，
// 由主进程在自己的 sql.js 内存库中执行并入队落盘，杜绝双内存副本互相覆盖。
const dbWriteHandlers = {
  writeJudgmentRecord: (record) => storage.writeJudgmentRecord(record),
  writePriceLevelSet: (record) => storage.writePriceLevelSet(record),
  saveStockRiskPlan: (opts) => storage.saveStockRiskPlan(opts),
};

function applyDbWrite(fnName, args = []) {
  const handler = dbWriteHandlers[String(fnName || '')];
  if (!handler) return Promise.reject(new Error(`未知写入委托: ${fnName}`));
  return Promise.resolve().then(() => handler(...args));
}

function ensureWorker() {
  if (child && !child.killed) return child;
  child = fork(path.join(__dirname, 'judgment-worker.js'), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  child.on('message', (msg) => {
    if (!msg) return;
    if (msg.type === 'event') { for (const fn of listeners) fn(msg); return; }
    if (msg.type === 'dbwrite') {
      applyDbWrite(msg.fn, msg.args)
        .then((result) => { if (child) child.send({ type: 'dbwrite-reply', id: msg.id, result }); })
        .catch((e) => { if (child) child.send({ type: 'dbwrite-reply', id: msg.id, error: e.message || String(e) }); });
      return;
    }
    if (msg.type !== 'reply') return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    p.resolve(msg.data);
  });
  child.on('exit', () => {
    for (const p of pending.values()) p.resolve({ ok: false, error: '研判 Worker 已退出' });
    pending.clear();
    child = null;
  });
  return child;
}

function call(action, options = {}) {
  const c = ensureWorker();
  const id = `w${Date.now()}_${++seq}`;
  return new Promise((resolve) => {
    pending.set(id, { resolve });
    c.send({ id, action, options });
  });
}

module.exports = {
  start: (options) => call('start', options),
  stop: () => call('stop'),
  status: () => call('status'),
  preview: (options) => call('preview', options),
  onEvent: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  applyDbWrite,
};
