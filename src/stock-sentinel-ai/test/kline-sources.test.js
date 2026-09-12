const assert = require('node:assert/strict');

const days = Array.from({ length: 10 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
const baiduRows = days.map((date, i) => `${i},${date},10,${10 + i},${1000 + i},${11 + i},9,${100000 + i}`).join(';');
const sohuRows = [...days].reverse().map((date, i) => [date, 10, 10 + i, 0, '0%', 9, 11 + i, 1000 + i]);

global.fetch = async (url) => {
  const value = String(url);
  if (value.includes('ifzq.gtimg.cn')) return { ok: true, json: async () => ({ data: { sh600519: {} } }) };
  if (value.includes('finance.pae.baidu.com')) {
    return { ok: true, json: async () => ({ Result: { newMarketData: { keys: ['timestamp', 'time', 'open', 'close', 'volume', 'high', 'low', 'amount'], marketData: baiduRows } } }) };
  }
  if (value.includes('q.stock.sohu.com')) return { ok: true, text: async () => JSON.stringify([{ status: 0, hq: sohuRows }]) };
  throw new Error(`不应请求其他来源：${value}`);
};

const { fetchKlineRaw, normalizeKlineVolume } = require('../data');

(async () => {
  const baidu = await fetchKlineRaw('600519', { lmt: 10 });
  assert.equal(baidu.source, 'baidu', '腾讯空数据时应回退百度股市通');
  assert.equal(baidu.kline.length, 10);
  assert.equal(baidu.kline[0].volume, 1000, '百度成交量已是股，不应重复乘 100');

  const sohu = await fetchKlineRaw('600519', { lmt: 10, prefer: 'sohu' });
  assert.equal(sohu.source, 'sohu', '可显式优先搜狐财经');
  assert.equal(sohu.kline.length, 10);
  assert.equal(sohu.kline[0].volume, 100900, '搜狐成交量应从手换算为股');
  assert.equal(normalizeKlineVolume(1000, 'sohu'), 100000);
  console.log('kline-sources.test 通过');
})().catch((error) => { console.error(error); process.exit(1); });
