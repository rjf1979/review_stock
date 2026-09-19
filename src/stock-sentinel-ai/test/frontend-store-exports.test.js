const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { babelParse } = require('@vue/compiler-sfc');

// 回归防护：组件通过 storeToRefs(app)/解构 app 取值时，store 必须真的导出同名成员。
// 漏导出的成员在模板里会取到 undefined（例如 undefined.length），整个候选池组件渲染失败、
// 表格直接消失，而且控制台只报一句无法定位的 TypeError。此测试把这类漏导出挡在构建前。

const storePath = path.join(__dirname, '../frontend/src/stores/app.js');
const source = fs.readFileSync(storePath, 'utf8');
const ast = babelParse(source, { sourceType: 'module' });
const store = ast.program.body.find((node) => node.type === 'ExportNamedDeclaration');
const body = store.declaration.declarations[0].init.arguments[1].body.body;
const returned = body.find((node) => node.type === 'ReturnStatement').argument;
assert.equal(returned.type, 'ObjectExpression', 'store 必须以对象字面量形式导出成员');
const exported = new Set(returned.properties.map((prop) => String(prop.key.name || prop.key.value)));
assert.ok(exported.size > 150, `store 导出成员数量异常：${exported.size}`);

const componentsDir = path.join(__dirname, '../frontend/src/components');
const componentFiles = fs.readdirSync(componentsDir).filter((name) => name.endsWith('.vue'));
assert.ok(componentFiles.length > 5, '未找到组件文件');

const patterns = [/\{\s*([^}]*)\}\s*=\s*storeToRefs\(app\)/g, /\{\s*([^}]*)\}\s*=\s*app\s*;/g];
let checked = 0;
const missing = [];
for (const file of componentFiles) {
  const text = fs.readFileSync(path.join(componentsDir, file), 'utf8');
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      for (const raw of match[1].split(',')) {
        const name = raw.trim();
        if (!name || name.startsWith('...')) continue;
        checked += 1;
        if (!exported.has(name)) missing.push(`${file}: ${name} 未从 store 导出`);
      }
    }
  }
}

assert.ok(checked > 50, `组件解构出来的 store 成员太少（${checked}），检查解析是否正确`);
assert.deepEqual(missing, [], `组件引用了 store 未导出的成员：\n${missing.join('\n')}`);

// 本轮修复点必须保持在导出列表中，避免再次被去重改动误删。
for (const name of ['concentrationPreview', 'quoteExpiredPoolItems', 'quoteExpiredPoolSummary', 'klineUnverifiedPoolItems', 'klineUnverifiedPoolSummary']) {
  assert.ok(exported.has(name), `store 必须导出 ${name}`);
}

console.log(`frontend-store-exports.test 通过（校验 ${checked} 个组件解构项）`);
