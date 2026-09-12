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
const names = ['startRecommendations', 'moveAllToWatch', 'isSelectedRecommendation'];
const declarations = body.filter((node) => names.includes(node.id?.name)
  || node.declarations?.some((decl) => names.includes(decl.id.name)));
assert.equal(declarations.length, names.length);
const returned = body.find((node) => node.type === 'ReturnStatement').argument.properties.map((node) => node.key.name);
assert.ok(returned.includes('clearPool') && returned.includes('removeFromPool'), '页面使用的移除与清空操作必须暴露');
const requests = [], migrations = [];
const context = vm.createContext({
  poolMsg: { value: '' }, poolMsgError: { value: false }, poolBusy: { value: false },
  recommendationBatch: {}, ensureRecommendationPolling() {},
  fetchJson: async (_url, options) => { requests.push(JSON.parse(options.body)); return {}; },
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
  await context.startRecommendations(true);
  assert.deepEqual(requests, [{ retryOnly: false }, { retryOnly: false }, { retryOnly: true }]);
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
