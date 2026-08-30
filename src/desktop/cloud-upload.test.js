const assert = require('assert');
const http = require('http');
const cloudUpload = require('./cloud-upload');

function withServer(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
    server.on('error', reject);
  });
}

(async () => {
  const calls = [];
  const { server, base } = await withServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      calls.push({ url: req.url, auth: req.headers.authorization || '', body: body ? JSON.parse(body) : {} });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url === '/auth/device') return res.end(JSON.stringify({ deviceId: 'dev-1', token: 't-1' }));
      return res.end(JSON.stringify({ won: true }));
    });
  });

  // 无 token 且无 deviceToken：首次上传必须走设备注册，再带 Bearer
  cloudUpload.setConfig({ enabled: true, url: base, token: '', deviceId: '', deviceToken: '' });
  const first = await cloudUpload.upload('/collect/realtime', { updatedAt: '2026-08-30T00:00:00Z' });
  assert.deepStrictEqual(first, { ok: true, response: { won: true } });

  // 复用已注册 token：不重复注册，仍带 Bearer 上传
  cloudUpload.setConfig({ enabled: true, url: base, deviceId: 'dev-1', deviceToken: 't-1' });
  await cloudUpload.upload('/collect/realtime', { updatedAt: '2026-08-30T00:00:00Z' });

  assert.strictEqual(calls[0].url, '/auth/device');
  assert.strictEqual(calls[0].auth, '');
  assert.strictEqual(calls[1].url, '/collect/realtime');
  assert.ok(calls[1].auth.startsWith('Bearer '), '第二笔上传应携带设备 Bearer');
  assert.ok(calls[2].auth.startsWith('Bearer '), '复用 token 应携带 Bearer 且不再注册');
  assert.strictEqual(calls.filter((c) => c.url === '/auth/device').length, 1, '设备只注册一次');

  server.close();
  console.log('cloud-upload tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
