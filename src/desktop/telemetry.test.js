const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { createTelemetry, trimError } = require('./telemetry');

function makeStorage() {
  const values = new Map();
  return {
    getSetting(key) { return values.get(key) || null; },
    setSettings(patch) { Object.entries(patch).forEach(([key, value]) => values.set(key, value)); },
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function fixedClock() {
  return new Date('2026-08-28T08:00:00.000Z');
}

const trimmed = trimError(new Error('boom\nnext'));
assert.strictEqual(trimmed.message, 'boom next');
assert.ok(trimmed.stack.includes('boom'));

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hangqing-telemetry-test-'));
  const queuePath = path.join(directory, 'telemetry-queue.json');
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      received.push(JSON.parse(body));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  const port = await listen(server);
  const storage = makeStorage();
  const telemetry = createTelemetry({
    storage,
    queuePath,
    endpoint: `http://127.0.0.1:${port}/api/telemetry`,
    appVersion: '0.2.6',
    arch: 'x64',
    enabled: () => true,
    now: fixedClock,
  });

  try {
    assert.strictEqual(telemetry.reportInstall(), true);
    assert.strictEqual(telemetry.reportInstall(), false);
    assert.match(telemetry.installId, /^[0-9a-f-]{36}$/);
    assert.strictEqual(telemetry.captureError(new Error('测试错误'), 'uncaughtException'), true);
    assert.strictEqual(telemetry.captureError(new Error('测试错误'), 'uncaughtException'), false);
    assert.strictEqual(telemetry.reportStartup(), true);
    assert.strictEqual(telemetry.reportClose(), true);
    assert.strictEqual(await telemetry.flush(), true);
    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].events.length, 4);
    assert.deepStrictEqual(received[0].events.map(event => event.eventType), ['install', 'error', 'startup', 'close']);
    assert.strictEqual(received[0].events[1].payload.message, '测试错误');
    assert.strictEqual(fs.readFileSync(queuePath, 'utf8'), '[]');
  } finally {
    telemetry.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }

  const disabledStorage = makeStorage();
  const disabled = createTelemetry({
    storage: disabledStorage,
    queuePath: path.join(directory, 'disabled.json'),
    endpoint: `http://127.0.0.1:${port}/api/telemetry`,
    enabled: () => false,
  });
  assert.strictEqual(disabled.reportInstall(), false);
  assert.strictEqual(disabled.captureError(new Error('不应上报'), 'console'), false);
  assert.strictEqual(disabledStorage.getSetting('installId'), null);
  disabled.close();
}

main().then(() => console.log('telemetry tests passed')).catch(error => { console.error(error); process.exitCode = 1; });
