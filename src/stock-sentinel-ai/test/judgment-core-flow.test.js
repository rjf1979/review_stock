// judgment-core 端到端自检：本地冻结证据 + 价位持久化 + 单只研判（AI 调用桩，不联网）。
const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-judgment-flow-'));
process.env.VOLUME_INSIGHT_DATA_DIR = TMP;
process.env.VOLUME_INSIGHT_KLINE_DB = path.join(TMP, 'kline.db');

const storage = require('../storage');
const aiAssist = require('../ai-assist');
const judgmentCore = require('../judgment-core');
const candidatePool = require('../candidate-pool');
const settings = require('../settings');
const themeModule = require('../theme');

// 冻结证据依赖候选池快照，测试中固定快照，不读真实 data/candidate-pool.json。
candidatePool.getList = () => [{
  code: '600001', name: '样例', market: 'sh_main', price: 12.5, changePct: 2.3,
  turnover: 4.5, volumeRatio: 1.8, amountYi: 3.2, mainNetYi: 0.8,
  snapshotDate: '2026-09-04',
}];
settings.load = () => ({
  fetchDays: 250,
  tradingStyle: 'short',
  ai: {
    enabled: true,
    provider: 'openai-compatible',
    baseURL: 'https://example.test/v1',
    apiKey: 'test-key',
    model: 'gpt-test',
    temperature: 0.7,
    maxTokens: 2048,
  },
});

// 桩模型：返回协议 JSON，无禁用词；验证 usage 取真实返回。
let calls = 0;
let lastMessages = null;
aiAssist.chatCompletionsDetailed = async (cfg, messages) => {
  calls += 1;
  lastMessages = messages;
  assert.ok(cfg && cfg.apiKey === 'test-key');
  return {
    content: JSON.stringify({ verdict: 'new_evidence', summary: '量价结构偏强，需观察能否站稳压力区。', changes: [], evidence: ['量能放大'], risks: ['冲高回落'], watchPoints: ['次日是否放量'] }),
    usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
  };
};
// 题材归属不联网：桩返回空结构，验证研判链路可正常冻结证据。
themeModule.getAttribution = async (code) => ({
  code: String(code),
  fetchedAt: '2026-09-04',
  total: 0,
  boards: [],
  conceptTags: [],
  cached: true,
});

(async () => {
  // 60+ 根连续前复权日 K，写入临时 SQLite。
  const dates = [];
  const d0 = new Date('2026-06-01T00:00:00Z');
  for (let i = 0; i < 120; i++) {
    const dd = new Date(d0);
    dd.setUTCDate(d0.getUTCDate() + i);
    dates.push(dd.toISOString().slice(0, 10));
  }
  const kline = dates.map((date, i) => {
    const close = 10 + i * 0.04;
    return { date, open: close - 0.1, high: close + 0.2, low: close - 0.25, close, volume: 1000 + i * 10, amount: (1000 + i * 10) * close };
  });
  await storage.writeKline('600001', kline, '2026-09-04');
  await storage.saveAiPrompt('【用户研究偏好】优先核查趋势、量价与关键价位。', 'custom-test-v1');
  await storage.flush();

  const res = await judgmentCore.judgeOne('600001', { fetchDays: 250 });
  assert.strictEqual(calls, 1, '模型应只调用一次');
  const firstPrompt = lastMessages[1].content;
  assert.ok(firstPrompt.startsWith('【用户研究偏好】优先核查趋势、量价与关键价位。'), 'SQLite 用户 Prompt 应前置');
  assert.ok(firstPrompt.includes('【系统指令边界】'), '用户 Prompt 后应声明系统固定协议优先');
  assert.ok(firstPrompt.includes('【研判阶段】首次研判'), '首次研判应携带显式阶段');
  assert.ok(firstPrompt.includes('verdict 只能为 new_evidence 或 insufficient'), '首次研判应限制结论枚举');
  assert.ok(firstPrompt.includes('不得使用 maintain 或 revise'), '首次研判应禁止维持/修正结论');
  assert.ok(firstPrompt.includes('【输出协议（优先级最高）】'), '固定输出协议必须后置');
  assert.strictEqual(res.ok, true, '研判应成功');
  assert.strictEqual(res.judgmentStatus, 'success');
  assert.strictEqual(res.record.modelResult.verdict, 'new_evidence');
  assert.ok(res.record.priceLevelSetId != null, '记录应关联价位集合 ID');
  assert.strictEqual(res.record.usage.total_tokens, 18, 'usage 应取真实返回');

  const last = await storage.getLastSuccessJudgment('600001');
  assert.ok(last && last.modelResult, 'SQLite 应读回成功记录');
  assert.ok(last.priceLevelSetId != null);
  const levels = await storage.getPriceLevelSet('600001', last.evidenceHash, 'levels-v1');
  assert.ok(levels, '应读回观察价位集合');
  assert.ok(Array.isArray(levels.supportZones));

  // 相同证据再研判：不应再次调用模型。
  const res2 = await judgmentCore.judgeOne('600001', { fetchDays: 250 });
  assert.strictEqual(calls, 1, '相同证据不得重复计费');
  assert.strictEqual(res2.code, 'no_change');

  await storage.saveAiPrompt('【用户研究偏好】优先核查趋势、量价、关键价位与证据变化。', 'custom-test-v2');
  const res3 = await judgmentCore.judgeOne('600001', { fetchDays: 250 });
  assert.strictEqual(calls, 2, '用户 Prompt 版本变更后应重新研判');
  assert.strictEqual(res3.ok, true);
  const secondPrompt = lastMessages[1].content;
  assert.ok(secondPrompt.includes('【研判阶段】二次复核研判'), '二次研判应携带显式阶段');
  assert.ok(secondPrompt.includes('【上次结论摘要】'), '二次研判应携带上次结论');
  assert.ok(secondPrompt.includes('【本次数据变化】'), '二次研判应携带证据变化');
  assert.ok(secondPrompt.includes('【二次复核决策规则】'), '二次研判应携带复核决策规则');
  assert.ok(res3.record.promptVersion.startsWith(aiAssist.PROMPT_VERSION + '-'), '记录应带固定协议的 Prompt 版本前缀');
  assert.notStrictEqual(res3.record.promptVersion, res.record.promptVersion, '用户 Prompt 内容变更后幂等版本应随之变化');

  // rsi_low_turn v4 接入：命中该形态时，研判证据必须改用 v4 退出计划（结构止损 + 6R 跟踪启动线）。
  const v4Bars = [];
  let v4Day = 0;
  const pushV4 = (close, { open = close + 0.5, volume = 1000 } = {}) => {
    v4Day += 1;
    const dd = new Date(Date.UTC(2026, 0, 1));
    dd.setUTCDate(dd.getUTCDate() + v4Day);
    v4Bars.push({
      date: dd.toISOString().slice(0, 10),
      open,
      high: Math.max(open, close) + 0.2,
      low: Math.min(open, close) - 0.2,
      close,
      volume,
    });
  };
  for (let k = 0; k < 20; k++) pushV4(100, { open: 100 });
  for (let k = 1; k <= 40; k++) pushV4(100 - k * 1.035, { open: 100 - (k - 1) * 1.035 });
  for (let k = 1; k <= 3; k++) pushV4(58.6 + k * 0.6, { open: 58.6 + (k - 1) * 0.6, volume: 1300 });
  await storage.writeKline('000592', v4Bars, v4Bars[v4Bars.length - 1].date);
  const v4Prep = await judgmentCore.prepareCode('000592', { fetchDays: 250 });
  assert.ok(v4Prep.patterns.some((p) => p.patternId === 'rsi_low_turn'), 'v4 形态应被本地复筛命中');
  assert.ok(v4Prep.rsiLowTurnPlan, '命中 v4 时应返回形态退出计划');
  assert.strictEqual(v4Prep.rsiLowTurnPlan.algorithmVersion, 'rsi-low-turn-v4');
  assert.strictEqual(v4Prep.rsiLowTurnPlan.exitRule.maxHoldDays, 20, 'v4 最长持有 20 个交易日');
  assert.strictEqual(v4Prep.rsiLowTurnPlan.exitRule.partialExitFraction, 0, 'v4 不做 1R 减仓');
  assert.strictEqual(v4Prep.rsiLowTurnPlan.takeProfit[0].type, 'trail_activation', '6R 只是跟踪启动线');
  assert.ok(String(v4Prep.rsiLowTurnPlan.stopLoss.source).includes('8%'), '结构止损应带 8% 风险上限');
  assert.ok(JSON.stringify(v4Prep.evidence).includes('rsi-low-turn-v4'), '研判证据应带上 v4 退出口径版本');
  console.log('judgment core v4 分支 ok', v4Prep.rsiLowTurnPlan.algorithmVersion, v4Prep.rsiLowTurnPlan.price, v4Prep.rsiLowTurnPlan.stopLoss.value);

  // limit_pullback v4 接入：涨停后缩量回踩 + 超跌 + 相对沪深300 走弱，研判证据必须改用 limit-pullback-v4 退出计划。
  // 该形态需要基准序列做相对强度核对，测试写入临时缓存文件（与真实 data/bench-sh000300.json 同结构）。
  const limitBars = [];
  let limitDay = 0;
  const pushLimit = (close, { open = close + 0.2, high = null, low = null, volume = 1000 } = {}) => {
    limitDay += 1;
    const dd = new Date(Date.UTC(2026, 0, 1));
    dd.setUTCDate(dd.getUTCDate() + limitDay);
    limitBars.push({
      date: dd.toISOString().slice(0, 10),
      open,
      high: high == null ? Math.max(open, close) + 0.2 : high,
      low: low == null ? Math.min(open, close) - 0.2 : low,
      close,
      volume,
    });
  };
  for (let k = 0; k < 70; k++) pushLimit(100, { open: 100, high: 100.5, low: 99.5 });
  for (let k = 0; k < 40; k++) {
    const close = 100 - 0.85 * (k + 1);
    pushLimit(close, { open: close + 0.4, high: close + 0.6, low: close - 0.3 });
  }
  const limitUpClose = 66 * 1.1;
  pushLimit(limitUpClose, { open: 66.6, high: limitUpClose, low: 66.2, volume: 3000 }); // 涨停：+10% 且收盘封在最高
  pushLimit(limitUpClose * 0.985, { open: limitUpClose * 0.992, high: limitUpClose * 0.995, low: limitUpClose * 0.978, volume: 1600 });
  pushLimit(limitUpClose * 0.970, { open: limitUpClose * 0.983, high: limitUpClose * 0.985, low: limitUpClose * 0.964, volume: 1200 });
  pushLimit(limitUpClose * 0.950, { open: limitUpClose * 0.967, high: limitUpClose * 0.972, low: limitUpClose * 0.945, volume: 700 });
  fs.writeFileSync(path.join(storage.DATA_DIR, 'bench-sh000300.json'), JSON.stringify({
    code: 'sh000300',
    name: '沪深300',
    source: 'test-fixture',
    fetchedAt: new Date().toISOString(),
    bars: limitBars.map((bar) => ({ date: bar.date, close: 100 })), // 基准平盘：个股 20 日 -13% 即为相对走弱
  }), 'utf8');
  require('../bench-series').resetBenchCache();
  await storage.writeKline('600519', limitBars, limitBars[limitBars.length - 1].date);
  const limitPrep = await judgmentCore.prepareCode('600519', { fetchDays: 250 });
  assert.ok(limitPrep.patterns.some((p) => p.patternId === 'limit_pullback'), 'limit_pullback 形态应被本地复筛命中');
  assert.ok(limitPrep.limitPullbackPlan, '命中 limit_pullback 时应返回形态退出计划');
  assert.strictEqual(limitPrep.limitPullbackPlan.algorithmVersion, 'limit-pullback-v4');
  assert.strictEqual(limitPrep.limitPullbackPlan.exitRule.maxHoldDays, 20, 'v4 最长持有 20 个交易日');
  assert.strictEqual(limitPrep.limitPullbackPlan.exitRule.partialExitFraction, 0, 'v4 不做 1R 减仓');
  assert.strictEqual(limitPrep.limitPullbackPlan.exitRule.trailMa, 5);
  assert.strictEqual(limitPrep.limitPullbackPlan.takeProfit[0].type, 'trail_activation', '6R 只是跟踪启动线');
  assert.ok(String(limitPrep.limitPullbackPlan.stopLoss.source).includes('8%'), '结构止损应带 8% 风险上限');
  assert.ok(limitPrep.limitPullbackPlan.evidence.rsPct <= -5, '相对强度应弱于沪深300 5 个百分点以上');
  assert.ok(JSON.stringify(limitPrep.evidence).includes('limit-pullback-v4'), '研判证据应带上 limit_pullback v4 退出口径版本');
  console.log('judgment core limit_pullback v4 分支 ok', limitPrep.limitPullbackPlan.algorithmVersion, limitPrep.limitPullbackPlan.price, limitPrep.limitPullbackPlan.stopLoss.value, 'rs', limitPrep.limitPullbackPlan.evidence.rsPct);

  console.log('judgment core flow ok', { id: res.record.id, priceLevelSetId: res.record.priceLevelSetId });
})().catch((e) => { console.error(e); process.exit(1); });
