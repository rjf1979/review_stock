process.env.VOLUME_INSIGHT_DATA_DIR = require('path').join(require('os').tmpdir(), 'ssai-test-' + Date.now());
const { fetchKline, getLastKlineSource } = require('../data');
const { readKline, klineStats, flush } = require('../storage');

async function main() {
  for (const code of ['600000', '300750']) {
    const rows = await fetchKline(code, { lmt: 5, dataSource: 'live' });
    console.log(code, 'rows=', rows.length, 'src=', getLastKlineSource(), 'first=', rows[0], 'last=', rows[rows.length - 1]);
  }
  // 确认落盘并可回读（断点续抓依赖）
  const cached = await readKline('600000');
  console.log('readKline 600000', cached ? { len: cached.kline.length, date: cached.date } : null);
  const stats = await klineStats();
  console.log('klineStats', stats);
  await flush();
}
main().catch((e) => console.log('ERR', e && e.stack || e));
