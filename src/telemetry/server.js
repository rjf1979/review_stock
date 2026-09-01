// 股市脉搏 · 匿名安装与错误遥测接收服务
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const PORT = Number(process.env.PORT || 3101);
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const EVENTS_FILE = path.join(DATA_DIR, 'events.ndjson');
const ADMIN_KEY = process.env.TELEMETRY_ADMIN_KEY || '';
const MARKET_API_ORIGIN = process.env.MARKET_API_ORIGIN || 'https://api.dailystock.askcode.cn';

const MAX_BODY_BYTES = 512 * 1024;
const MAX_EVENTS_PER_REQUEST = 250;
const MAX_RECENT_ERRORS = 200;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_COOKIE = 'telemetry_session';
const ALLOWED_EVENT_TYPES = new Set(['install', 'startup', 'close', 'error']);
const INSTALL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const stats = {
  installIds: new Set(),
  uniqueIps: new Set(),
  installEvents: 0,
  startupEvents: 0,
  closeEvents: 0,
  errorEvents: 0,
  totalEvents: 0,
  byVersion: new Map(),
  byArch: new Map(),
  byOsVersion: new Map(),
};
const recentErrors = [];
const sessions = new Map();

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function sendHtml(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(html);
}

function parseCookies(req) {
  const header = String(req.headers.cookie || '');
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

function issueSession(res) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
  return token;
}

function clearSession(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function validSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return false;
  const expiresAt = sessions.get(token);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function shortText(value, max) {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function validateEvent(event) {
  if (!event || typeof event !== 'object') return false;
  if (event.schema !== 1) return false;
  if (!ALLOWED_EVENT_TYPES.has(event.eventType)) return false;
  if (!INSTALL_ID_PATTERN.test(String(event.installId || ''))) return false;
  if (!shortText(event.appVersion, 40)) return false;
  if (!shortText(event.arch, 12)) return false;
  if (!shortText(event.osVersion, 80)) return false;
  if (!shortText(event.locale, 32)) return false;
  if (event.payload == null || typeof event.payload !== 'object' || Array.isArray(event.payload)) return false;
  if (event.eventType === 'error') {
    if (!shortText(event.payload.message, 500)) return false;
    if (!shortText(event.payload.source, 32)) return false;
    if (event.payload.stack !== undefined && !(typeof event.payload.stack === 'string' && event.payload.stack.length <= 2500)) return false;
  }
  return true;
}

function index(event) {
  stats.installIds.add(event.installId);
  if (event.ip) stats.uniqueIps.add(event.ip);
  stats.totalEvents += 1;
  if (event.eventType === 'install') stats.installEvents += 1;
  if (event.eventType === 'startup') stats.startupEvents += 1;
  if (event.eventType === 'close') stats.closeEvents += 1;
  if (event.eventType === 'error') {
    stats.errorEvents += 1;
    recentErrors.push({
      timestamp: event.timestamp,
      installId: event.installId,
      appVersion: event.appVersion,
      arch: event.arch,
      osVersion: event.osVersion,
      ip: event.ip || '',
      source: event.payload.source,
      message: event.payload.message,
      stack: event.payload.stack || '',
    });
    if (recentErrors.length > MAX_RECENT_ERRORS) recentErrors.shift();
  }
  stats.byVersion.set(event.appVersion, (stats.byVersion.get(event.appVersion) || 0) + 1);
  stats.byArch.set(event.arch, (stats.byArch.get(event.arch) || 0) + 1);
  stats.byOsVersion.set(event.osVersion, (stats.byOsVersion.get(event.osVersion) || 0) + 1);
}

function loadEvents() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(EVENTS_FILE)) return;
  const lines = fs.readFileSync(EVENTS_FILE, 'utf8').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (validateEvent(event)) index(event);
    } catch {}
  }
}

function appendEvents(events) {
  if (!events.length) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFileSync(EVENTS_FILE, events.map(event => JSON.stringify(event)).join('\n') + '\n');
  events.forEach(index);
}

function summary() {
  return {
    installs: stats.installIds.size,
    uniqueIps: stats.uniqueIps.size,
    installEvents: stats.installEvents,
    startupEvents: stats.startupEvents,
    closeEvents: stats.closeEvents,
    errorEvents: stats.errorEvents,
    totalEvents: stats.totalEvents,
    byVersion: Object.fromEntries(stats.byVersion),
    byArch: Object.fromEntries(stats.byArch),
    byOsVersion: Object.fromEntries(stats.byOsVersion),
  };
}

function requireAdmin(res, req) {
  if (!ADMIN_KEY) {
    send(res, 503, { error: '未配置遥测管理密钥' });
    return false;
  }
  if (String(req.headers.authorization || '') !== `Bearer ${ADMIN_KEY}`) {
    if (!validSession(req)) {
      send(res, 401, { error: 'Unauthorized' });
      return false;
    }
  }
  return true;
}

function adminPage() {
  return fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
}

// 行情云 API 只读反代：仅在后台登录态下可用，匿名请求一律 401。
function proxyMarketApi(res, url) {
  const target = new URL(url.pathname.replace(/^\/api\/market/, '/api') + url.search, MARKET_API_ORIGIN);
  const transport = target.protocol === 'http:' ? http : https;
  const upstream = transport.request(target, {
    method: 'GET',
    headers: { accept: 'application/json', 'user-agent': 'dailystock-admin/1.0' },
    timeout: 15000,
  }, up => {
    res.writeHead(up.statusCode || 502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    up.pipe(res);
  });
  upstream.on('timeout', () => upstream.destroy(new Error('行情数据上游超时')));
  upstream.on('error', () => {
    if (!res.headersSent) send(res, 502, { error: '行情数据服务暂时不可用' });
  });
  upstream.end();
}

function resolveClientIp(req) {
  const realIp = String(req.headers['x-real-ip'] || '').trim();
  if (realIp) return realIp.slice(0, 64);
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (forwarded) return forwarded.slice(0, 64);
  return String(req.socket.remoteAddress || '').replace(/^::ffff:/, '').slice(0, 64);
}

loadEvents();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  try {
    if (url.pathname === '/healthz') return send(res, 200, { ok: true });

    if ((url.pathname === '/admin' || url.pathname === '/admin/') && req.method === 'GET') {
      try {
        return sendHtml(res, 200, adminPage());
      } catch (error) {
        return send(res, 500, { error: `后台页面加载失败：${error.message}` });
      }
    }

    if (url.pathname === '/api/telemetry' && req.method === 'POST') {
      const raw = await readBody(req);
      let body;
      try { body = JSON.parse(raw); } catch { return send(res, 400, { error: '请求体不是有效 JSON' }); }
      const events = Array.isArray(body?.events) ? body.events.slice(0, MAX_EVENTS_PER_REQUEST) : [];
      const ip = resolveClientIp(req);
      const accepted = events.filter(validateEvent).map(event => ({ ...event, ip }));
      appendEvents(accepted);
      return send(res, 200, { accepted: accepted.length, rejected: events.length - accepted.length });
    }

    if (url.pathname === '/api/telemetry/login' && req.method === 'POST') {
      if (!ADMIN_KEY) return send(res, 503, { error: '未配置遥测管理密钥' });
      const raw = await readBody(req);
      let body;
      try { body = JSON.parse(raw); } catch { return send(res, 400, { error: '请求体不是有效 JSON' }); }
      if (String(body?.key || '') !== ADMIN_KEY) return send(res, 401, { error: '密钥不正确' });
      issueSession(res);
      return send(res, 200, { ok: true });
    }

    if (url.pathname === '/api/telemetry/logout' && req.method === 'POST') {
      const token = parseCookies(req)[SESSION_COOKIE];
      if (token) sessions.delete(token);
      clearSession(res);
      return send(res, 200, { ok: true });
    }

    if (url.pathname === '/api/telemetry/summary' && req.method === 'GET') {
      if (!requireAdmin(res, req)) return;
      return send(res, 200, summary());
    }

    if (url.pathname === '/api/telemetry/errors' && req.method === 'GET') {
      if (!requireAdmin(res, req)) return;
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
      return send(res, 200, { errors: recentErrors.slice(-limit).reverse() });
    }

    if (url.pathname.startsWith('/api/market/')) {
      if (req.method !== 'GET') return send(res, 405, { error: 'Method Not Allowed' });
      if (!requireAdmin(res, req)) return;
      return proxyMarketApi(res, url);
    }

    return send(res, 404, { error: 'Not found' });
  } catch (error) {
    return send(res, 500, { error: String(error?.message || '服务错误') });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => console.log(`股市脉搏遥测服务运行于 http://${HOST}:${PORT}`));
}

module.exports = { server, summary, validateEvent, requireAdmin, adminPage, resolveClientIp, validSession, proxyMarketApi, MARKET_API_ORIGIN };
