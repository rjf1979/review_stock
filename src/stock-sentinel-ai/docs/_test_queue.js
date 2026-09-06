const path = require('path');
const os = require('os');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-queue-'));
process.env.VOLUME_INSIGHT_DATA_DIR = tmp;

const { fetchKlineRaw, todayStr } = require('../data');
const { writeKline, readKline, readKlineDates, recentTradingDates, klineGaps, flush, klineStats } = require('../storage');

(async () => {
  const today = todayStr();
  console.log('tmp data dir =', tmp, ' today =', today);

  // 1) 联网取两只（不落盘，走队列入口 fetchKlineRaw）
  for (const code of ['600000', '300750']) {
    const r = await fetchKlineRaw(code, { lmt: 250 });
    console.log('raw', code, 'rows=', r.kline.length, 'source=', r.source);
    // 模拟消费者写库
    const ok = await writeKline(code, r.kline, today);
    console.log('  write', code, 'ok=', ok);
  }
  await flush();

  // 2) 日期索引
  const d1 = await readKlineDates('600000');
  console.log('600000 dates=', d1.length, 'first=', d1[0], 'last=', d1[d1.length - 1]);
  const win = await recentTradingDates(20, { anchor: today });
  console.log('window(20)=', win.length, 'first=', win[0], 'last=', win[win.length - 1]);
  const miss = await klineGaps('600000', win);
  console.log('600000 missing in window=', miss.length);

  // 3) 完整性统计
  const stats = await klineStats();
  console.log('stats=', JSON.stringify(stats));

  // 4) 回读自检
  const back = await readKline('600000');
  console.log('readKline 600000 rows=', back.kline.length, 'date=', back.date);

  console.log('DONE');
})();
