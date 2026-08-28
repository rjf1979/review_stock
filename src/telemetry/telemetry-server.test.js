const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hangqing-telemetry-server-test-'));
process.env.DATA_DIR = directory;
process.env.TELEMETRY_ADMIN_KEY = 'test-admin-key';

const { server, summary } = require('./server');

function request(port, method, pathname, { body, authorization, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = require('http').request({
      host: '127.0.0.1',
      port,
      path: pathname,
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
        ...(authorization ? { Authorization: authorization } : {}),
        ...headers,
      },
    }, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let body = {};
        try { body = JSON.parse(raw || '{}'); } catch {}
        resolve({ status: res.statusCode, body, text: raw, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const validEvent = {
  schema: 1,
  installId: '11111111-1111-4111-8111-111111111111',
  appVersion: '0.2.6',
  arch: 'x64',
  osVersion: 'win32 10.0.19045',
  locale: 'zh-CN',
  eventType: 'install',
  payload: {},
  timestamp: '2026-08-28T08:00:00.000Z',
};

const validError = {
  ...validEvent,
  eventType: 'error',
  payload: { source: 'uncaughtException', message: 'boom', stack: 'Error: boom\n at main' },
};

const invalidEvent = { ...validEvent, installId: 'not-a-uuid' };

const validStartup = { ...validEvent, eventType: 'startup', payload: {} };
const validClose = { ...validEvent, eventType: 'close', payload: {} };

async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const accepted = await request(port, 'POST', '/api/telemetry', {
      body: JSON.stringify({ events: [validEvent, validError, invalidEvent] }),
    });
    assert.strictEqual(accepted.status, 200);
    assert.strictEqual(accepted.body.accepted, 2);
    assert.strictEqual(accepted.body.rejected, 1);

    const secondInstall = await request(port, 'POST', '/api/telemetry', {
      body: JSON.stringify({ events: [validEvent] }),
    });
    assert.strictEqual(secondInstall.body.accepted, 1);

    const lifecycle = await request(port, 'POST', '/api/telemetry', {
      body: JSON.stringify({ events: [validStartup, validClose] }),
      headers: { 'X-Real-IP': '203.0.113.7' },
    });
    assert.strictEqual(lifecycle.body.accepted, 2);

    const unauthorized = await request(port, 'GET', '/api/telemetry/summary');
    assert.strictEqual(unauthorized.status, 401);

    const wrongKey = await request(port, 'GET', '/api/telemetry/summary', { authorization: 'Bearer wrong' });
    assert.strictEqual(wrongKey.status, 401);

    const result = await request(port, 'GET', '/api/telemetry/summary', { authorization: 'Bearer test-admin-key' });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.body.installs, 1);
    assert.strictEqual(result.body.uniqueIps, 2);
    assert.strictEqual(result.body.installEvents, 2);
    assert.strictEqual(result.body.startupEvents, 1);
    assert.strictEqual(result.body.closeEvents, 1);
    assert.strictEqual(result.body.errorEvents, 1);
    assert.strictEqual(result.body.byVersion['0.2.6'], 5);
    assert.ok(fs.existsSync(path.join(directory, 'events.ndjson')));

    const admin = await request(port, 'GET', '/admin');
    assert.strictEqual(admin.status, 200);
    assert.ok(admin.text.includes('遥测后台'));

    const errorsUnauthorized = await request(port, 'GET', '/api/telemetry/errors');
    assert.strictEqual(errorsUnauthorized.status, 401);

    const errors = await request(port, 'GET', '/api/telemetry/errors?limit=10', { authorization: 'Bearer test-admin-key' });
    assert.strictEqual(errors.status, 200);
    assert.strictEqual(errors.body.errors.length, 1);
    assert.strictEqual(errors.body.errors[0].message, 'boom');
    assert.strictEqual(errors.body.errors[0].source, 'uncaughtException');
    assert.strictEqual(errors.body.errors[0].stack, 'Error: boom\n at main');
    assert.strictEqual(errors.body.errors[0].ip, '127.0.0.1');

    const badLogin = await request(port, 'POST', '/api/telemetry/login', { body: JSON.stringify({ key: 'wrong' }) });
    assert.strictEqual(badLogin.status, 401);

    const login = await request(port, 'POST', '/api/telemetry/login', { body: JSON.stringify({ key: 'test-admin-key' }) });
    assert.strictEqual(login.status, 200);
    assert.ok(login.headers['set-cookie']);
    const cookie = login.headers['set-cookie'][0].split(';')[0];

    const sessionSummary = await request(port, 'GET', '/api/telemetry/summary', { headers: { Cookie: cookie } });
    assert.strictEqual(sessionSummary.status, 200);

    const logout = await request(port, 'POST', '/api/telemetry/logout', { headers: { Cookie: cookie } });
    assert.strictEqual(logout.status, 200);

    const afterLogout = await request(port, 'GET', '/api/telemetry/summary', { headers: { Cookie: cookie } });
    assert.strictEqual(afterLogout.status, 401);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().then(() => console.log('telemetry-server tests passed')).catch(error => { console.error(error); process.exitCode = 1; });
