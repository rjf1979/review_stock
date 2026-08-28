// 行情日报 Desktop · 匿名安装与运行错误遥测
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_ENDPOINT = 'https://dailystock.zhicha.io/api/telemetry';
const FLUSH_DELAY_MS = 800;
const RETRY_INTERVAL_MS = 5 * 60 * 1000;
const MAX_QUEUE_SIZE = 250;
const ERROR_DEDUPE_WINDOW_MS = 60 * 1000;

function readQueue(queuePath) {
  try {
    const value = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
    return Array.isArray(value) ? value.slice(0, MAX_QUEUE_SIZE) : [];
  } catch {
    return [];
  }
}

function writeQueue(queuePath, queue) {
  fs.mkdirSync(path.dirname(queuePath), { recursive: true });
  const temporary = `${queuePath}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(queue));
  try { fs.rmSync(queuePath, { force: true }); } catch {}
  fs.renameSync(temporary, queuePath);
}

function trimError(error) {
  const message = String(error?.message || error || '未知错误').replace(/\s+/g, ' ').trim().slice(0, 500) || '未知错误';
  const stack = String(error?.stack || '')
    .split('\n')
    .slice(0, 10)
    .map(line => line.trim().slice(0, 300))
    .join('\n')
    .slice(0, 2500) || message;
  return { message, stack };
}

function eventSignature(event) {
  const marker = String(event?.payload?.message || event?.payload?.signature || '').slice(0, 160);
  return crypto.createHash('sha256').update(`${event.eventType}:${marker}`).digest('hex');
}

function createTelemetry({
  storage,
  queuePath,
  endpoint = process.env.TELEMETRY_ENDPOINT || DEFAULT_ENDPOINT,
  appVersion = '0.0.0',
  arch = process.arch,
  osVersion = `${process.platform} ${os.release()}`,
  locale = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().locale : 'unknown',
  enabled = true,
  now = () => new Date(),
} = {}) {
  const isEnabled = typeof enabled === 'function' ? enabled : () => enabled === true;
  let queue = readQueue(queuePath);
  let flushing = false;
  let flushTimer = null;
  let retryTimer = null;
  let closed = false;
  const lastErrorSent = new Map();

  function persistQueue() {
    try {
      writeQueue(queuePath, queue);
      return true;
    } catch {
      return false;
    }
  }

  function baseEvent(eventType, payload) {
    const installId = storage.getSetting('installId');
    if (!installId) return null;
    return {
      schema: 1,
      installId,
      appVersion,
      arch,
      osVersion,
      locale,
      eventType,
      payload: payload || {},
      timestamp: now().toISOString(),
    };
  }

  async function flush() {
    if (flushing || closed || !queue.length) return false;
    flushing = true;
    try {
      const events = queue.slice(0, MAX_QUEUE_SIZE);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      queue = queue.slice(events.length);
      persistQueue();
      return true;
    } catch {
      // 离线或服务不可用时保留队列，下一次启动或重试定时器继续发送。
      return false;
    } finally {
      flushing = false;
    }
  }

  function scheduleFlush() {
    if (closed || flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush().catch(() => {});
    }, FLUSH_DELAY_MS);
  }

  function ensureInstallId() {
    if (!isEnabled()) return { id: null, created: false };
    const existing = storage.getSetting('installId');
    if (existing) return { id: existing, created: false };
    const id = crypto.randomUUID();
    storage.setSettings({ installId: id });
    return { id, created: true };
  }

  function reportInstall() {
    const { id, created } = ensureInstallId();
    if (!id || !created) return false;
    return record('install', {});
  }

  function reportStartup() {
    return record('startup', {});
  }

  function reportClose() {
    return record('close', {});
  }

  function record(eventType, payload) {
    if (!isEnabled()) return false;
    const event = baseEvent(eventType, payload);
    if (!event) return false;
    if (eventType === 'error') {
      const signature = eventSignature(event);
      const last = lastErrorSent.get(signature) || 0;
      if (Date.now() - last < ERROR_DEDUPE_WINDOW_MS) return false;
      lastErrorSent.set(signature, Date.now());
    }
    queue.push(event);
    if (queue.length > MAX_QUEUE_SIZE) queue = queue.slice(-MAX_QUEUE_SIZE);
    persistQueue();
    scheduleFlush();
    return true;
  }

  function captureError(error, source = 'uncaughtException') {
    return record('error', { source, ...trimError(error) });
  }

  retryTimer = setInterval(() => {
    if (queue.length) flush().catch(() => {});
  }, RETRY_INTERVAL_MS);
  retryTimer.unref?.();

  return {
    get installId() { return storage.getSetting('installId'); },
    ensureInstallId,
    reportInstall,
    reportStartup,
    reportClose,
    record,
    captureError,
    flush,
    close() {
      closed = true;
      if (flushTimer) clearTimeout(flushTimer);
      if (retryTimer) clearInterval(retryTimer);
      return flush();
    },
  };
}

module.exports = { DEFAULT_ENDPOINT, createTelemetry, trimError, eventSignature };
