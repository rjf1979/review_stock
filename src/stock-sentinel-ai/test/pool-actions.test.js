const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { babelParse } = require('@vue/compiler-sfc');

// 执行真实 store 中的操作函数，网络和响应式状态用隔离适配器替代。
const source = fs.readFileSync(path.join(__dirname, '../frontend/src/stores/app.js'), 'utf8');
const ast = babelParse(source, { sourceType: 'module' });
const store = ast.program.body.find((node) => node.type === 'ExportNamedDeclaration');
const body = store.declaration.declarations[0].init.arguments[1].body.body;
const names = ['startRecommendations', 'moveAllToWatch', 'isSelectedRecommendation', 'repairKlineMetaForReview'];
const declarations = body.filter((node) => names.includes(node.id?.name)
  || node.declarations?.some((decl) => names.includes(decl.id.name)));
assert.equal(declarations.length, names.length);
const returned = body.find((node) => node.type === 'ReturnStatement').argument.properties.map((node) => node.key.name);
assert.ok(returned.includes('clearPool') && returned.includes('removeFromPool'), '页面使用的移除与清空操作必须暴露');
const requests = [], migrations = [], jobs = [];
// 补齐任务状态由桩函数推进：进入端点即视为任务立即结束，并把「口径已可核对」写回状态表。
const poolPrefetch = { running: false, statusByCode: {} };
const context = vm.createContext({
  poolMsg: { value: '' }, poolMsgError: { value: false }, poolBusy: { value: false },
  recommendationBatch: {}, ensureRecommendationPolling() {},
  setTimeout,
  settings: { fetchDays: 250 },
  poolPrefetch,
  loadPool: async () => {},
  loadPoolKlineState: async () => { poolPrefetch.running = false; poolPrefetch.statusByCode = { stale: { metaReviewable: true } }; },
  // 「待重新复核」中属于 K 线口径不可核对的那一只：复核前必须先按可验证来源重取。
  klineUnverifiedPoolItems: { value: [{ code: 'stale' }] },
  fetchJson: async (url, options) => {
    const body = JSON.parse(options.body);
    jobs.push({ url, body });
    if (url === '/api/pool/recommendations') requests.push(body);
    return url === '/api/pool/kline' ? { started: true } : {};
  },
  pool: { value: [{ code: 'valid' }, { code: 'stale' }, { code: 'unknown' }] },
  poolRecommendations: { value: Object.fromEntries(['valid', 'stale', 'unknown'].map((code) => [code, {
    status: 'success', classification: 'passed', evidenceJson: { selected: true },
    ...(code === 'unknown' ? {} : { validity: { current: code === 'valid' } }),
  }])) },
  migratePoolItems: async (codes, mode) => { migrations.push({ codes: Array.from(codes), mode }); },
});
vm.runInContext(declarations.map((node) => source.slice(node.start, node.end)).join('\n'), context);
(async () => {
  await context.startRecommendations({ type: 'click' });
  await context.startRecommendations();
  assert.ok(context.poolMsg.value.includes('已按可验证来源重取 1 只候选K线'), '界面必须如实说明复核前重取了哪些票');
  await context.startRecommendations(true);
  assert.deepEqual(requests, [{ retryOnly: false }, { retryOnly: false }, { retryOnly: true }]);
  // 「重新严格复核」必须先把口径不可核对的候选按可验证来源整段重取，否则点多少次都停在同一结论。
  assert.equal(jobs[0].url, '/api/pool/kline', '重取 K 线必须先于严格复核发生');
  assert.deepEqual(jobs.filter((job) => job.url === '/api/pool/kline').map((job) => job.body.codes), [['stale'], ['stale']], '每次非重试复核都要为口径不可核对的候选重取 K 线');
  assert.deepEqual(jobs.filter((job) => job.url === '/api/pool/kline').map((job) => job.body.lmt), [250, 250]);
  context.klineUnverifiedPoolItems.value = [];
  await context.startRecommendations();
  assert.equal(jobs.filter((job) => job.url === '/api/pool/kline').length, 2, '没有口径不可核对的候选时不得多发一次取数请求');
  await context.moveAllToWatch();
  assert.deepEqual(migrations, [{ codes: ['valid'], mode: 'selected' }]);
  context.pool.value = [];
  await context.moveAllToWatch();
  assert.deepEqual(migrations[1], { codes: [], mode: 'selected' });
  context.migratePoolItems = async () => { throw new Error('模拟请求失败'); };
  await assert.rejects(context.moveAllToWatch(), /模拟请求失败/);
  assert.equal(context.poolBusy.value, false, '失败后释放忙碌状态');
  console.log('pool-actions.test 通过');
})().catch((error) => { console.error(error); process.exitCode = 1; });
