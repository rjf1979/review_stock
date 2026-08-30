'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRateLimiter } = require('./rateLimit');

test('令牌桶容量耗尽后拒绝', () => {
  const rl = createRateLimiter({ capacity: 3, refillPerSec: 0 });
  assert.equal(rl.allow('a'), true);
  assert.equal(rl.allow('a'), true);
  assert.equal(rl.allow('a'), true);
  assert.equal(rl.allow('a'), false);
  assert.equal(rl.allow('b'), true); // 不同 key 互不影响
});
