const assert = require('node:assert/strict');

global.fetch = async (url) => {
  const requested = new URL(String(url)).searchParams.get('secids').split(',');
  if (requested.some((value) => value.endsWith('000051'))) return { ok: false, status: 503, json: async () => ({}) };
  return {
    ok: true,
    json: async () => ({
      data: {
        diff: requested.map((secid) => ({
          f12: secid.split('.')[1], f14: '测试', f2: 10, f3: 1, f4: 0.1, f5: 100,
          f6: 100000, f8: 2, f10: 1.5, f15: 10.2, f16: 9.8, f17: 9.9, f18: 9.9,
          f124: 1789113600,
        })),
      },
    }),
  };
};

const { fetchQuotesDetailed, normalizeQuote } = require('../data');

(async () => {
  const normalized = normalizeQuote({ f12: '600000', f14: '测试', f2: 10, f18: 9, f124: 1789113600 });
  assert.equal(normalized.sourceAt, '2026-09-11T08:00:00.000Z');
  const codes = Array.from({ length: 51 }, (_, index) => String(index + 1).padStart(6, '0'));
  const result = await fetchQuotesDetailed(codes, { timeoutMs: 100 });
  assert.equal(result.requested, 51);
  assert.equal(result.received, 50, '一个分块失败不应丢弃已成功分块');
  assert.equal(result.errors.length, 1);
  assert.deepEqual(result.missingCodes, ['000051']);
  console.log('quote-batch.test 通过');
})().catch((error) => { console.error(error); process.exit(1); });
