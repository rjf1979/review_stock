const { fork } = require('child_process');
const path = require('path');

let child = null;
let seq = 0;
const pending = new Map();
const listeners = new Set();

function ensureWorker() {
  if (child && !child.killed) return child;
  child = fork(path.join(__dirname, 'judgment-worker.js'), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  child.on('message', (msg) => {
    if (!msg) return;
    if (msg.type === 'event') { for (const fn of listeners) fn(msg); return; }
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
};
