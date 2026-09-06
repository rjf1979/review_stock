// 智诊盯盘 · 闭市期间同数据只研判一次的分类规则单测（不依赖真实行情与 AI）。
const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

// 必须在 require 业务模块之前设置数据目录，指向临时目录。
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-closed-'));
process.env.VOLUME_INSIGHT_DATA_DIR = TMP;

const { closedMarketAlreadyJudged } = require('../judgment-batch');

const prepared = (klineDate, snapshotDate) => ({ read: { klineDate }, snapshotDate });
const last = (klineDate, snapshotDate) => ({ evidence: { evidenceDates: { klineDate, snapshotDate } } });

// 闭市（收盘后/周末/节假日）：同一份快照 + K 线数据只研判一次
assert.strictEqual(
  closedMarketAlreadyJudged(last('2026-09-04', '2026-09-04'), prepared('2026-09-04', '2026-09-04'), 'closed'),
  true, '收盘后同数据应判定为已研判'
);
assert.strictEqual(
  closedMarketAlreadyJudged(last('2026-09-04', '2026-09-04'), prepared('2026-09-04', '2026-09-04'), 'non_trading'),
  true, '周末同数据应判定为已研判'
);

// 交易日不适用该规则：盘中数据仍在变化，交由证据哈希判断
assert.strictEqual(
  closedMarketAlreadyJudged(last('2026-09-04', '2026-09-04'), prepared('2026-09-04', '2026-09-04'), 'trading'),
  false, '盘中不得凭数据日期跳过'
);

// 数据日期推进（新快照/新 K 线）→ 必须重新研判
assert.strictEqual(
  closedMarketAlreadyJudged(last('2026-09-04', '2026-09-04'), prepared('2026-09-07', '2026-09-07'), 'closed'),
  false, 'K 线日期推进应重新研判'
);
assert.strictEqual(
  closedMarketAlreadyJudged(last('2026-09-04', '2026-09-04'), prepared('2026-09-04', '2026-09-07'), 'non_trading'),
  false, '快照日期推进应重新研判'
);

// 旧记录缺少证据日期（历史版本写入）→ 不判定为已研判，回落到哈希/证据更新路径
assert.strictEqual(
  closedMarketAlreadyJudged({}, prepared('2026-09-04', '2026-09-04'), 'closed'),
  false, '无证据日期的旧记录不得跳过'
);
assert.strictEqual(
  closedMarketAlreadyJudged(null, prepared('2026-09-04', '2026-09-04'), 'closed'),
  false, '无上次成功记录时不得跳过'
);

// 日期全缺失时防御
assert.strictEqual(
  closedMarketAlreadyJudged(last('', ''), prepared('', ''), 'closed'),
  false, '数据日期全缺失时不得跳过'
);

console.log('judgment-batch closed-market rule passed');
