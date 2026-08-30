'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const auth = require('./auth');

const SECRET = 'test-secret';

test('sign/verify 往返', () => {
  const token = auth.issueToken('dev_abc', SECRET);
  const payload = auth.verify(token, SECRET);
  assert.equal(payload.sub, 'dev_abc');
});

test('篡改签名被拒绝', () => {
  const token = auth.issueToken('dev_abc', SECRET);
  const bad = token.slice(0, -2) + 'xx';
  assert.equal(auth.verify(bad, SECRET), null);
});

test('错误密钥被拒绝', () => {
  const token = auth.issueToken('dev_abc', SECRET);
  assert.equal(auth.verify(token, 'wrong-secret'), null);
});

test('过期 token 被拒绝', () => {
  const expired = auth.sign({ sub: 'dev_abc', exp: Math.floor(Date.now() / 1000) - 10 }, SECRET);
  assert.equal(auth.verify(expired, SECRET), null);
});

test('newDeviceId 格式', () => {
  assert.match(auth.newDeviceId(), /^dev_[0-9a-f]{32}$/);
});

test('sanitizeDeviceId 接受合法 id、拒绝非法', () => {
  assert.equal(auth.sanitizeDeviceId('dev_abc123'), 'dev_abc123');
  assert.match(auth.sanitizeDeviceId('bad id!'), /^dev_[0-9a-f]{32}$/);
  assert.match(auth.sanitizeDeviceId(null), /^dev_[0-9a-f]{32}$/);
});
