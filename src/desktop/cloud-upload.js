// 股市脉搏 · PC 端采集上传模块
// 职责：把桌面端已采集的实时快照/复盘/龙虎榜/自选报价/K线上传到云端行情 API。
// 说明：该模块不主动采集，也不阻塞本地 UI；失败重试（指数退避），不抛到主流程。
const http = require('http');
const https = require('https');

const MAX_RETRY = 5;
const TIME_OUT = 12000;

let config = {
  enabled: false,
  url: process.env.MAPI_URL || '',
  token: process.env.MAPI_TOKEN || '',
  deviceId: '',
  deviceToken: '',
};
let onDevice = null;

function setConfig(next) {
  const { onDevice: cb, ...rest } = next || {};
  if (typeof cb === 'function') onDevice = cb;
  config = { ...config, ...rest };
}

function getConfig() {
  return { ...config };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function authHeaders(body) {
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  };
  if (config.token) headers['X-Upload-Token'] = config.token;
  if (config.deviceToken) headers['Authorization'] = 'Bearer ' + config.deviceToken;
  return headers;
}

let devicePromise = null;
async function registerDevice() {
  const response = await postJson('/auth/device', config.deviceId ? { deviceId: config.deviceId } : {});
  config.deviceId = response.deviceId || config.deviceId;
  config.deviceToken = response.token || '';
  if (onDevice) { try { onDevice({ deviceId: config.deviceId, deviceToken: config.deviceToken }); } catch {} }
  return { deviceId: config.deviceId, token: config.deviceToken };
}
function ensureDevice() {
  if (config.deviceToken) return Promise.resolve({ deviceId: config.deviceId, token: config.deviceToken });
  if (devicePromise) return devicePromise;
  devicePromise = registerDevice().catch((e) => { devicePromise = null; throw e; });
  return devicePromise;
}

function postJson(endpoint, data, { timeout = TIME_OUT } = {}) {
  return new Promise((resolve, reject) => {
    const base = new URL(config.url);
    const pathname = (base.pathname || '/').replace(/\/$/, '');
    const target = new URL(pathname + endpoint, base);
    const body = JSON.stringify(data);
    const lib = target.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: target.pathname + target.search,
      method: 'POST',
      headers: authHeaders(body)
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { return resolve(text ? JSON.parse(text) : {}); }
          catch (e) { return resolve({}); }
        }
        let msg = `上传失败（${res.statusCode}）`;
        try { const parsed = JSON.parse(text); if (parsed.error) msg = parsed.error; } catch (e) { /* ignore */ }
        reject(new Error(msg));
      });
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => req.destroy(new Error('上传超时')));
    req.write(body);
    req.end();
  });
}

async function upload(endpoint, data) {
  if (!config.enabled) return { skipped: true };
  if (!config.url) throw new Error('未配置云端 API 地址');
  if (!config.token && !config.deviceToken) await ensureDevice();
  let lastErr;
  for (let i = 0; i < MAX_RETRY; i++) {
    try {
      const response = await postJson(endpoint, data);
      return { ok: true, response };
    } catch (e) {
      lastErr = e;
      await sleep(Math.min(1000 * Math.pow(2, i), 15000));
    }
  }
  throw lastErr;
}

// ── 各业务上传入口（data 即桌面端已采集的结果集）──
function uploadRealtime(payload) {
  return upload('/collect/realtime', payload);
}

function uploadReview(payload) {
  return upload('/collect/review', payload);
}

function uploadDragon(payload) {
  return upload('/collect/dragon', payload);
}

function uploadQuotes(payload) {
  return upload('/collect/quotes', payload);
}

function uploadKline(payload) {
  return upload('/collect/kline', payload);
}

function heartbeat(payload) {
  return upload('/collect/heartbeat', payload);
}

module.exports = {
  setConfig,
  getConfig,
  upload,
  uploadRealtime,
  uploadReview,
  uploadDragon,
  uploadQuotes,
  uploadKline,
  heartbeat
};
