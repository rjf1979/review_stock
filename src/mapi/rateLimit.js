'use strict';
// 按 key（deviceId）的令牌桶限流，单进程内存实现。mapi 单实例即可满足。

function createRateLimiter({ capacity = 30, refillPerSec = 1 } = {}) {
  const buckets = new Map();
  function bucket(key) {
    let b = buckets.get(key);
    if (!b) { b = { tokens: capacity, at: Date.now() }; buckets.set(key, b); }
    return b;
  }
  function allow(key) {
    const b = bucket(key);
    const now = Date.now();
    const elapsed = (now - b.at) / 1000;
    b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerSec);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
  return { allow };
}

module.exports = { createRateLimiter };
