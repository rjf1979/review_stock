const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { babelParse } = require('@vue/compiler-sfc');

// 执行真实 store 中的集中风险计算：computed 用恒等函数替代，只验证计算口径本身。
const source = fs.readFileSync(path.join(__dirname, '../frontend/src/stores/app.js'), 'utf8');
const ast = babelParse(source, { sourceType: 'module' });
const store = ast.program.body.find((node) => node.type === 'ExportNamedDeclaration');
const body = store.declaration.declarations[0].init.arguments[1].body.body;
const names = ['primaryThemeName', 'isSelectedRecommendation', 'concentrationPreview'];
const declarations = body.filter((node) => names.includes(node.id?.name)
  || node.declarations?.some((decl) => names.includes(decl.id.name)));
assert.equal(declarations.length, names.length, '集中风险计算依赖的函数/常量必须都能从 store 中取出');

const context = vm.createContext({
  computed: (fn) => fn,
  watchlist: { value: [] },
  pool: { value: [] },
  poolRecommendations: { value: {} },
});
vm.runInContext(declarations.map((node) => source.slice(node.start, node.end)).join('\n'), context);
// computed 在 store 里是 const 声明，不会挂到 vm 全局对象上；统一用表达式取值并序列化回宿主，规避跨 realm 原型差异。
const preview = () => JSON.parse(vm.runInContext('JSON.stringify(concentrationPreview())', context));

// 选中态：复核成功、结论有效、通过且已入选本批精选。
const markSelected = (codes) => {
  context.poolRecommendations.value = Object.fromEntries(codes.map((code) => [code, {
    status: 'success', classification: 'passed', validity: { current: true }, evidenceJson: { selected: true },
  }]));
};

// 1) 宽口径概念标签（QFII重仓）不是主要题材时，正常持仓不得被判成题材集中。
const broadTagRows = [1, 2, 3].map((index) => ({
  code: `60010${index}`,
  name: `样本${index}`,
  themeEvidence: [{ code: `BK10${index}`, name: `行业${index}`, rank: 1 }, { code: 'BK0535', name: 'QFII重仓', rank: 9 }],
}));
context.pool.value = broadTagRows;
markSelected(broadTagRows.map((row) => row.code));
assert.deepEqual(preview(), [], '主要题材各不相同，附带 QFII重仓 标签不得触发集中告警');

// 2) 主要题材确实是 QFII重仓 时仍必须告警，避免为了消除误报而漏报。
const realQfiiRows = [1, 2, 3].map((index) => ({
  code: `60020${index}`,
  name: `样本${index}`,
  themeEvidence: [{ code: 'BK0535', name: 'QFII重仓', rank: 1 }, { code: `BK20${index}`, name: `行业${index}`, rank: 2 }],
}));
context.pool.value = realQfiiRows;
markSelected(realQfiiRows.map((row) => row.code));
const warned = preview();
assert.equal(warned.length, 1, '主要题材同为 QFII重仓 的 3 只候选必须告警');
assert.match(warned[0], /QFII重仓预计3只/, '告警必须给出题材与只数');
assert.match(warned[0], /自选0 \+ 本批转入3/, '告警必须区分存量自选与本批转入');

// 3) 自选存量本身已超线时，文案必须说明是已有持仓，不冒充本批复核结果。
context.pool.value = [];
markSelected([]);
context.watchlist.value = [1, 2, 3].map((index) => ({ code: `60030${index}`, themeEvidence: [{ code: 'BK300', name: '长江三角', rank: 1 }] }));
const existing = preview();
assert.equal(existing.length, 1);
assert.match(existing[0], /长江三角已有3只自选，超过建议线2只/);

// 4) 建议线 2 只（含）以内不告警。
context.watchlist.value = context.watchlist.value.slice(0, 2);
assert.deepEqual(preview(), []);

console.log('frontend-concentration.test 通过');
