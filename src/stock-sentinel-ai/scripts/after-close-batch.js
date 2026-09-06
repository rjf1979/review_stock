// 一次性收盘批量研判触发器：等待收盘数据就绪后调用本地服务。
const http = require('http');

const PORT = Number(process.env.STOCK_SENTINEL_PORT || 3110);
const POLL_MS = 30 * 1000;
const CUTOFF = 1502;

function chinaNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { date: `${v.year}-${v.month}-${v.day}`, hhmm: Number(v.hour + v.minute) };
}

function request(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path, method, headers: { 'Content-Type': 'application/json' } }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body || '{}') }); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function tick() {
  const now = chinaNow();
  if (now.hhmm < CUTOFF) return false;
  const [status, batch] = await Promise.all([request('/api/status'), request('/api/ai/batch-status')]);
  if (!status.data.ok || batch.data.running) return false;
  const dates = Array.isArray(status.data.snapshotDates) ? status.data.snapshotDates : [];
  if (!dates.includes(now.date)) return false;
  const started = await request('/api/ai/batch', 'POST');
  if (started.status !== 200 || !started.data.started) throw new Error(started.data.message || started.data.reason || '无法启动批量研判');
  console.log(`收盘批量研判已启动：${now.date}，批次 ${started.data.batchId || '—'}`);
  return true;
}

(async () => {
  console.log('收盘批量研判等待中。');
  while (true) {
    try {
      if (await tick()) process.exit(0);
    } catch (e) {
      console.error('收盘任务检查失败：' + e.message);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
})();
