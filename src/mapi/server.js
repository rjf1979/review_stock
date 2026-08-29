// 股市脉搏 · 云端行情 API
// 职责：接收 PC 端采集上传（write），向移动端下发（read）。云不做采集。
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3102);
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const UPLOAD_TOKEN = process.env.MAPI_UPLOAD_TOKEN || '';
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_STALE_MS = Number(process.env.MAPI_STALE_MS || 10 * 60 * 1000);

function ensureDir() {
  fs.mkdirSync(path.join(DATA_DIR, 'reviews'), { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, 'dragon'), { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, 'kline'), { recursive: true });
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (e) { reject(new Error('JSON 解析失败')); }
    });
    req.on('error', reject);
  });
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return fallback; }
}

function authorized(req) {
  return UPLOAD_TOKEN && req.headers['x-upload-token'] === UPLOAD_TOKEN;
}

function requireToken(req, res) {
  // 返回 true 表示已发送响应，调用方应立即停止处理。
  if (!UPLOAD_TOKEN) { send(res, 500, { error: '服务未配置上传 Token' }); return true; }
  if (!authorized(req)) { send(res, 401, { error: '上传 Token 无效' }); return true; }
  return false;
}

function atChar(n, c) {
  return n > c ? '+' : (n < c ? '-' : '');
}

function staleMark(payload) {
  if (!payload || !payload.updatedAt) return 'unknown';
  const age = Date.now() - Date.parse(payload.updatedAt);
  return age > MAX_STALE_MS ? 'stale' : 'fresh';
}

function serveRealtime(res) {
  const payload = readJson(path.join(DATA_DIR, 'realtime.json'));
  if (payload) return send(res, 200, { ...payload, status: staleMark(payload), fromCloud: true });
  return send(res, 503, { status: 'no_data', message: '暂无采集数据，请确认 PC 端已上传' });
}

function validDate(d) { return /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')); }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    // ── 写入端（PC 上传，需 Token）──
    if (url.pathname.startsWith('/collect/')) {
      if (requireToken(req, res)) return;
      if (req.method !== 'POST') return send(res, 405, { error: 'Method Not Allowed' });
      const body = await readBody(req);
      if (url.pathname === '/collect/realtime') {
        writeJson(path.join(DATA_DIR, 'realtime.json'), { ...body, updatedAt: body.updatedAt || new Date().toISOString() });
        return send(res, 200, { ok: true });
      }
      if (url.pathname === '/collect/review') {
        const date = body.date || body.meta?.trade_date;
        if (!validDate(date)) return send(res, 400, { error: 'date 格式应为 YYYY-MM-DD' });
        writeJson(path.join(DATA_DIR, 'reviews', `${date}.json`), body);
        return send(res, 200, { ok: true });
      }
      if (url.pathname === '/collect/dragon') {
        const date = body.date;
        if (!validDate(date)) return send(res, 400, { error: 'date 格式应为 YYYY-MM-DD' });
        writeJson(path.join(DATA_DIR, 'dragon', `${date}.json`), body);
        return send(res, 200, { ok: true });
      }
      if (url.pathname === '/collect/quotes') {
        writeJson(path.join(DATA_DIR, 'quotes.json'), { stocks: body.stocks || [], updatedAt: body.updatedAt || new Date().toISOString() });
        return send(res, 200, { ok: true });
      }
      if (url.pathname === '/collect/kline') {
        const code = body.code;
        if (!code) return send(res, 400, { error: '缺少 code' });
        writeJson(path.join(DATA_DIR, 'kline', `${code.replace(/[^A-Za-z0-9]/g, '')}.json`), body);
        return send(res, 200, { ok: true });
      }
      if (url.pathname === '/collect/heartbeat') {
        writeJson(path.join(DATA_DIR, 'heartbeat.json'), { ...body, receivedAt: new Date().toISOString() });
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: '未知采集接口' });
    }

    // ── 读取端（移动端）──
    if (url.pathname === '/api/realtime') return serveRealtime(res);
    if (url.pathname === '/api/status') {
      const hb = readJson(path.join(DATA_DIR, 'heartbeat.json'));
      return send(res, 200, {
        latestFetchAt: hb?.fetchedAt || null,
        version: hb?.version || null,
        quality: hb?.ok ? 'ok' : 'unknown',
        serverTime: new Date().toISOString()
      });
    }
    if (url.pathname === '/api/reviews') {
      const dir = path.join(DATA_DIR, 'reviews');
      const entries = fs.existsSync(dir)
        ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
            const p = readJson(path.join(dir, f));
            return {
              date: p?.date || f.replace('.json', ''),
              temperature: p?.temperature ?? p?.temperature?.score ?? null,
              reportMode: p?.meta?.report_mode || 'snapshot',
              qualityStatus: p?.quality?.status || null,
              asOf: p?.meta?.as_of || p?.generatedAt || null,
              updatedAt: p?.updatedAt || null
            };
          }).sort((a, b) => (b.date > a.date ? 1 : -1))
        : [];
      return send(res, 200, { entries });
    }
    if (url.pathname === '/api/review') {
      const date = url.searchParams.get('date');
      if (!validDate(date)) return send(res, 400, { error: '日期格式不正确，应为 YYYY-MM-DD' });
      const p = readJson(path.join(DATA_DIR, 'reviews', `${date}.json`));
      if (!p) return send(res, 404, { error: '该日期没有已保存的完整复盘快照' });
      return send(res, 200, { ...p, persisted: true });
    }
    if (url.pathname === '/api/dragon') {
      const date = url.searchParams.get('date');
      if (!validDate(date)) return send(res, 400, { error: '日期格式不正确，应为 YYYY-MM-DD' });
      const p = readJson(path.join(DATA_DIR, 'dragon', `${date}.json`));
      if (!p) return send(res, 404, { error: '该日期没有龙虎榜数据' });
      return send(res, 200, p);
    }
    if (url.pathname === '/api/stocks') {
      const codes = String(url.searchParams.get('codes') || '').split(',').filter(Boolean);
      const quotes = readJson(path.join(DATA_DIR, 'quotes.json'), { stocks: [] });
      const map = new Map((quotes.stocks || []).map((s) => [String(s.code).toLowerCase(), s]));
      const stocks = codes.map((c) => map.get(c.toLowerCase())).filter(Boolean);
      return send(res, 200, { stocks, updatedAt: quotes.updatedAt || null });
    }
    if (url.pathname === '/api/kline') {
      const code = String(url.searchParams.get('code') || '');
      if (!code) return send(res, 400, { error: '缺少 code' });
      const p = readJson(path.join(DATA_DIR, 'kline', `${code.replace(/[^A-Za-z0-9]/g, '')}.json`));
      if (!p) return send(res, 404, { error: '该代码暂无 K 线数据，请确认 PC 端已上传' });
      return send(res, 200, p);
    }
    return send(res, 404, { error: 'Not found' });
  } catch (error) {
    return send(res, 500, { error: error.message });
  }
});

ensureDir();
server.listen(PORT, HOST, () => {
  console.log(`行情 API 运行于 http://${HOST}:${PORT}（写入端需 X-Upload-Token）`);
});

module.exports = { server, staleMark };
