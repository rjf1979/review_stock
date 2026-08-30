'use strict';
// 设备鉴权：首次注册换 device_id + 签名 token。
// 采用 HMAC-SHA256 签名（等价 JWT HS256，但零依赖、仅用内置 crypto）。
const crypto = require('crypto');

function sign(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token, secret) {
  if (typeof token !== 'string' || !secret) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expect = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp * 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

function newDeviceId() {
  return 'dev_' + crypto.randomBytes(16).toString('hex');
}

const DEVICE_ID_RE = /^[A-Za-z0-9_-]{3,64}$/;
// 归一化客户端提供的 deviceId：非法/缺失则生成新 id，稳定设备可复用同一 id（幂等注册）。
function sanitizeDeviceId(input) {
  return typeof input === 'string' && DEVICE_ID_RE.test(input) ? input : newDeviceId();
}

// ttlSeconds<=0 表示长期有效（客户端长期持有）。
function issueToken(deviceId, secret, ttlSeconds = 0) {
  const payload = { sub: deviceId, iat: Math.floor(Date.now() / 1000) };
  if (ttlSeconds > 0) payload.exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return sign(payload, secret);
}

module.exports = { sign, verify, newDeviceId, sanitizeDeviceId, issueToken };
