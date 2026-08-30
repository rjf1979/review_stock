'use strict';
// 股市脉搏 · 云端行情 API（众包采集）
// 两种模式：
//   file  模式（默认）：PC 唯一采集，JSON 落盘 data/，向后兼容旧部署。
//   cloud 模式（MAPI_MODE=cloud）：多用户众包采集，OSS 存对象 + PG 存索引，先采集先共享。
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3102);
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const UPLOAD_TOKEN = process.env.MAPI_UPLOAD_TOKEN || '';
const JWT_SECRET = process.env.MAPI_JWT_SECRET || '';
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_STALE_MS = Number(process.env.MAPI_STALE_MS || 10 * 60 * 1000);
const MODE = process.env.MAPI_MODE === 'cloud' ? 'cloud' : 'file';

const auth = require('./auth');
const keys = require('./keys');
const validate = require('./validate');
const { createRateLimiter } = require('./rateLimit');
const { claimSlotAndWrite, updateHeadAndWrite } = require('./claim');

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

// file 模式旧鉴权：返回 true 表示已发送响应，调用方应立即停止。
function requireToken(req, res) {
  if (!UPLOAD_TOKEN) { send(res, 500, { error: '服务未配置上传 Token' }); return true; }
  if (!authorized(req)) { send(res, 401, { error: '上传 Token 无效' }); return true; }
  return false;
}

function staleMark(payload) {
  if (!payload || !payload.updatedAt) return 'unknown';
  const age = Date.now() - Date.parse(payload.updatedAt);
  return age > MAX_STALE_MS ? 'stale' : 'fresh';
}

const validDate = validate.validDate;

// ── cloud 模式：依赖注入 ──
let cloud = null;
function cloudReady() { return MODE === 'cloud' && cloud != null; }

function pgConfig() {
  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL };
  return {
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
  };
}

async function initCloud() {
  const { createDb } = require('./db');
  const { createOss } = require('./oss');
  const db = createDb(pgConfig());
  await db.ensureSchema();
  const oss = createOss({
    region: process.env.ALIYUN_OSS_REGION,
    accessKeyId: process.env.ALIYUN_OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.ALIYUN_OSS_ACCESS_KEY_SECRET,
    bucket: process.env.ALIYUN_OSS_BUCKET,
    endpoint: process.env.ALIYUN_OSS_ENDPOINT,
    cdnDomain: process.env.MAPI_CDN_DOMAIN || '',
  });
  const limiter = createRateLimiter({
    capacity: Number(process.env.MAPI_RATE_CAPACITY || 30),
    refillPerSec: Number(process.env.MAPI_RATE_REFILL || 1),
  });
  return { db, oss, limiter };
}

function deviceOf(req) {
  if (!JWT_SECRET) return null;
  const h = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) return null;
  return auth.verify(m[1], JWT_SECRET);
}

function writeAuth(req) {
  if (JWT_SECRET) {
    const p = deviceOf(req);
    if (p) return { ok: true, deviceId: p.sub };
  }
  if (authorized(req)) return { ok: true, deviceId: 'legacy' };
  if (!UPLOAD_TOKEN && !JWT_SECRET) return { ok: false, reason: '服务未配置鉴权', status: 500 };
  return { ok: false, reason: '鉴权失败', status: 401 };
}

async function readObjectByKey(objectKey) {
  try {
    const raw = await cloud.oss.getObject(objectKey);
    return { data: JSON.parse(raw), url: cloud.oss.url(objectKey) };
  } catch { return null; }
}

// ── cloud 模式：写入 handler ──
const collectReview = async (body, deviceId) => {
  const v = validate.validateReview(body);
  if (!v.ok) return { status: 400, body: { error: v.error } };
  const date = body.date || body.meta?.trade_date;
  const mode = keys.canonicalMode(body.meta?.report_mode || body.mode || 'close');
  const { slotKey, objectKey } = keys.reviewSlot(date, mode);
  const r = await claimSlotAndWrite({ db: cloud.db, oss: cloud.oss, slotKey, objectKey, deviceId, data: body });
  return { status: 200, body: { ok: true, ...r } };
};

const collectDragon = async (body, deviceId) => {
  const v = validate.validateDragon(body);
  if (!v.ok) return { status: 400, body: { error: v.error } };
  const { slotKey, objectKey } = keys.dragonSlot(body.date);
  const r = await claimSlotAndWrite({ db: cloud.db, oss: cloud.oss, slotKey, objectKey, deviceId, data: body });
  return { status: 200, body: { ok: true, ...r } };
};

const collectKline = async (body, deviceId) => {
  const v = validate.validateKline(body);
  if (!v.ok) return { status: 400, body: { error: v.error } };
  const date = body.tradeDate || body.latestDate || 'latest';
  const { slotKey, objectKey } = keys.klineSlot(body.code, date);
  const r = await claimSlotAndWrite({ db: cloud.db, oss: cloud.oss, slotKey, objectKey, deviceId, data: body });
  return { status: 200, body: { ok: true, ...r } };
};

const collectRealtime = async (body, deviceId) => {
  const v = validate.validateRealtime(body);
  if (!v.ok) return { status: 400, body: { error: v.error } };
  const { date, hhmmss } = keys.timeBucket(body.updatedAt);
  const objectKey = keys.realtimeKey(date, hhmmss);
  const r = await updateHeadAndWrite({ db: cloud.db, oss: cloud.oss, stream: 'realtime', objectKey, updatedAt: body.updatedAt, deviceId, data: body });
  return { status: 200, body: { ok: true, ...r } };
};

const collectQuotes = async (body, deviceId) => {
  const v = validate.validateQuotes(body);
  if (!v.ok) return { status: 400, body: { error: v.error } };
  const { date, hhmmss } = keys.timeBucket(body.updatedAt);
  const objectKey = keys.quotesKey(date, hhmmss);
  const r = await updateHeadAndWrite({ db: cloud.db, oss: cloud.oss, stream: 'quotes', objectKey, updatedAt: body.updatedAt, deviceId, data: body });
  return { status: 200, body: { ok: true, ...r } };
};

const collectHeartbeat = async (body) => {
  writeJson(path.join(DATA_DIR, 'heartbeat.json'), { ...body, receivedAt: new Date().toISOString() });
  return { status: 200, body: { ok: true } };
};

const COLLECT_HANDLERS = {
  review: collectReview, dragon: collectDragon, kline: collectKline,
  realtime: collectRealtime, quotes: collectQuotes, heartbeat: collectHeartbeat,
};

async function handleCollect(req, res, url) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method Not Allowed' });
  const name = url.pathname.slice('/collect/'.length);

  if (cloudReady()) {
    const a = writeAuth(req);
    if (!a.ok) return send(res, a.status, { error: a.reason });
    const handler = COLLECT_HANDLERS[name];
    if (!handler) return send(res, 404, { error: '未知采集接口' });
    if (name !== 'heartbeat' && !cloud.limiter.allow(a.deviceId)) return send(res, 429, { error: '请求过于频繁' });
    const body = await readBody(req);
    const r = await handler(body, a.deviceId);
    return send(res, r.status, r.body);
  }

  // file 模式：保持旧行为
  if (requireToken(req, res)) return;
  const body = await readBody(req);
  if (name === 'realtime') {
    writeJson(path.join(DATA_DIR, 'realtime.json'), { ...body, updatedAt: body.updatedAt || new Date().toISOString() });
    return send(res, 200, { ok: true });
  }
  if (name === 'review') {
    const date = body.date || body.meta?.trade_date;
    if (!validDate(date)) return send(res, 400, { error: 'date 格式应为 YYYY-MM-DD' });
    writeJson(path.join(DATA_DIR, 'reviews', `${date}.json`), body);
    return send(res, 200, { ok: true });
  }
  if (name === 'dragon') {
    if (!validDate(body.date)) return send(res, 400, { error: 'date 格式应为 YYYY-MM-DD' });
    writeJson(path.join(DATA_DIR, 'dragon', `${body.date}.json`), body);
    return send(res, 200, { ok: true });
  }
  if (name === 'quotes') {
    writeJson(path.join(DATA_DIR, 'quotes.json'), { stocks: body.stocks || [], updatedAt: body.updatedAt || new Date().toISOString() });
    return send(res, 200, { ok: true });
  }
  if (name === 'kline') {
    if (!body.code) return send(res, 400, { error: '缺少 code' });
    writeJson(path.join(DATA_DIR, 'kline', `${body.code.replace(/[^A-Za-z0-9]/g, '')}.json`), body);
    return send(res, 200, { ok: true });
  }
  if (name === 'heartbeat') {
    writeJson(path.join(DATA_DIR, 'heartbeat.json'), { ...body, receivedAt: new Date().toISOString() });
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: '未知采集接口' });
}

// ── 读取端 ──
async function handleRead(req, res, url) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Method Not Allowed' });

  if (cloudReady()) {
    if (url.pathname === '/api/realtime') {
      const head = await cloud.db.getHead('realtime');
      if (!head || !head.object_key) return send(res, 503, { status: 'no_data', message: '暂无采集数据' });
      const obj = await readObjectByKey(head.object_key);
      if (!obj) return send(res, 503, { status: 'no_data', message: '数据对象缺失' });
      return send(res, 200, { ...obj.data, status: staleMark(obj.data), fromCloud: true, url: obj.url });
    }
    if (url.pathname === '/api/status') {
      const hb = readJson(path.join(DATA_DIR, 'heartbeat.json'));
      const [rt, qt] = await Promise.all([cloud.db.getHead('realtime'), cloud.db.getHead('quotes')]);
      return send(res, 200, {
        latestFetchAt: hb?.fetchedAt || null,
        version: hb?.version || null,
        quality: hb?.ok ? 'ok' : 'unknown',
        realtimeAt: rt?.updated_at || null,
        quotesAt: qt?.updated_at || null,
        serverTime: new Date().toISOString(),
      });
    }
    if (url.pathname === '/api/review') {
      const date = url.searchParams.get('date');
      if (!validDate(date)) return send(res, 400, { error: '日期格式不正确，应为 YYYY-MM-DD' });
      const obj = (await readObjectByKey(keys.reviewSlot(date, 'close').objectKey))
        || (await readObjectByKey(keys.reviewSlot(date, 'morning').objectKey));
      if (!obj) return send(res, 404, { error: '该日期没有已保存的完整复盘快照' });
      return send(res, 200, { ...obj.data, persisted: true, url: obj.url });
    }
    if (url.pathname === '/api/reviews') {
      const slots = await cloud.db.listSlots('review:', 200);
      const entries = [];
      for (const s of slots) {
        const obj = await readObjectByKey(s.object_key);
        if (!obj) continue;
        const p = obj.data;
        entries.push({
          date: p?.date || s.slot_key.split(':')[1] || null,
          temperature: p?.temperature ?? p?.temperature?.score ?? null,
          reportMode: p?.meta?.report_mode || 'snapshot',
          qualityStatus: p?.quality?.status || null,
          asOf: p?.meta?.as_of || p?.generatedAt || null,
          updatedAt: p?.updatedAt || null,
        });
      }
      return send(res, 200, { entries });
    }
    if (url.pathname === '/api/dragon') {
      const date = url.searchParams.get('date');
      if (!validDate(date)) return send(res, 400, { error: '日期格式不正确，应为 YYYY-MM-DD' });
      const obj = await readObjectByKey(keys.dragonSlot(date).objectKey);
      if (!obj) return send(res, 404, { error: '该日期没有龙虎榜数据' });
      return send(res, 200, { ...obj.data, url: obj.url });
    }
    if (url.pathname === '/api/stocks') {
      const codes = String(url.searchParams.get('codes') || '').split(',').filter(Boolean);
      const head = await cloud.db.getHead('quotes');
      if (!head || !head.object_key) return send(res, 503, { status: 'no_data', message: '暂无自选报价' });
      const obj = await readObjectByKey(head.object_key);
      if (!obj) return send(res, 503, { status: 'no_data', message: '数据对象缺失' });
      const map = new Map((obj.data.stocks || []).map((s) => [String(s.code).toLowerCase(), s]));
      const stocks = codes.map((c) => map.get(c.toLowerCase())).filter(Boolean);
      return send(res, 200, { stocks, updatedAt: obj.data.updatedAt || null, url: obj.url });
    }
    if (url.pathname === '/api/kline') {
      const code = String(url.searchParams.get('code') || '');
      if (!code) return send(res, 400, { error: '缺少 code' });
      const date = url.searchParams.get('date');
      let obj = null;
      if (validDate(date)) {
        obj = await readObjectByKey(keys.klineSlot(code, date).objectKey);
      } else {
        const slots = await cloud.db.listSlots(`kline:${keys.safeCode(code)}:`, 1);
        if (slots.length) obj = await readObjectByKey(slots[0].object_key);
      }
      if (!obj) return send(res, 404, { error: '该代码暂无 K 线数据' });
      return send(res, 200, { ...obj.data, url: obj.url });
    }
    return send(res, 404, { error: 'Not found' });
  }

  // file 模式：保持旧行为
  if (url.pathname === '/api/realtime') {
    const payload = readJson(path.join(DATA_DIR, 'realtime.json'));
    if (payload) return send(res, 200, { ...payload, status: staleMark(payload), fromCloud: true });
    return send(res, 503, { status: 'no_data', message: '暂无采集数据，请确认 PC 端已上传' });
  }
  if (url.pathname === '/api/status') {
    const hb = readJson(path.join(DATA_DIR, 'heartbeat.json'));
    return send(res, 200, {
      latestFetchAt: hb?.fetchedAt || null,
      version: hb?.version || null,
      quality: hb?.ok ? 'ok' : 'unknown',
      serverTime: new Date().toISOString(),
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
            updatedAt: p?.updatedAt || null,
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
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/auth/device') {
      if (req.method !== 'POST') return send(res, 405, { error: 'Method Not Allowed' });
      if (!cloudReady()) return send(res, 404, { error: 'Not found' });
      if (!JWT_SECRET) return send(res, 500, { error: '服务未配置 JWT 密钥' });
      const body = await readBody(req).catch(() => ({}));
      const deviceId = auth.sanitizeDeviceId(body.deviceId);
      await cloud.db.registerDevice(deviceId, 0);
      const token = auth.issueToken(deviceId, JWT_SECRET);
      return send(res, 200, { deviceId, token });
    }
    if (url.pathname.startsWith('/collect/')) return await handleCollect(req, res, url);
    if (url.pathname.startsWith('/api/')) return await handleRead(req, res, url);
    return send(res, 404, { error: 'Not found' });
  } catch (error) {
    return send(res, 500, { error: error.message });
  }
});

const CLAIM_TTL_MS = Number(process.env.MAPI_CLAIM_TTL_MS || 2 * 60 * 1000);
const REAP_INTERVAL_MS = Number(process.env.MAPI_REAP_INTERVAL_MS || 60 * 1000);

function startReaper() {
  const timer = setInterval(async () => {
    try {
      const n = await cloud.db.releaseStaleClaims(new Date(Date.now() - CLAIM_TTL_MS).toISOString());
      if (n > 0) console.log(`[claim] 释放 ${n} 个卡住的槽位`);
    } catch (e) { console.warn('[claim] 清扫失败：', e.message); }
  }, REAP_INTERVAL_MS);
  timer.unref();
}

async function start() {
  ensureDir();
  if (MODE === 'cloud') {
    try { cloud = await initCloud(); }
    catch (e) { console.error('cloud 模式初始化失败：', e.message); process.exit(1); }
    startReaper();
  }
  server.listen(PORT, HOST, () => {
    console.log(`行情 API 运行于 http://${HOST}:${PORT}（模式：${MODE}，写入端需鉴权）`);
  });
}

if (require.main === module) start();

module.exports = { server, start, staleMark };
