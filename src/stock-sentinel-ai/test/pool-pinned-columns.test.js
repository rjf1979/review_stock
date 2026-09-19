// 候选池冻结列（代码 / 名称）静态契约：横向滚动时底色必须不透明，否则后面的列会从下面透出来。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../frontend/src/styles/main.css'), 'utf8');

// 1) 冻结列必须有专属的不透明底色规则，并保留 z-index 以盖住滚动内容。
const pinRule = css.match(/tbody tr td\.pool-pin-code[^{]*\{[^}]*\}/);
assert.ok(pinRule, '冻结列必须有专属背景规则（tbody tr td.pool-pin-code / .pool-pin-name）');
assert.ok(/background:\s*var\(--bg-elevated\)/.test(pinRule[0]), '冻结列底色应为不透明面板色 --bg-elevated');
assert.ok(/z-index:\s*1/.test(pinRule[0]), '冻结列需保留 z-index: 1 才能盖住滚动内容');
assert.ok(/td\.pool-pin-name/.test(pinRule[0]), '名称列必须与代码列同规则处理');

// 2) 偶数行条纹不得再作用于冻结列：这正是“代码/名称列背景透明”的根因。
const stripeRule = css.match(/tbody tr:nth-child\(even\)[^{]*\{[^}]*\}/);
assert.ok(stripeRule, '偶数行条纹规则应保留');
assert.ok(/background:\s*transparent/.test(stripeRule[0]), '偶数行仍以透明继承表格面板底色');
assert.ok(
  /:not\(\.pool-pin-code\)/.test(stripeRule[0]),
  '偶数行条纹必须排除 .pool-pin-code'
);
assert.ok(/:not\(\.pool-pin-name\)/.test(stripeRule[0]), '偶数行条纹必须排除 .pool-pin-name');

// 3) 悬停态同样不能透底：冻结列用不透明强调底色。
const hoverRule = css.match(/tbody tr:hover td\.pool-pin-code[^{]*\{[^}]*\}/);
assert.ok(hoverRule, '冻结列悬停规则应保留');
assert.ok(/background:\s*var\(--accent-soft-solid\)/.test(hoverRule[0]), '冻结列悬停底色应为不透明 token --accent-soft-solid');

// 4) 逐条检查规则体：凡是“直接作用于冻结列”的规则，都不许把底色写回 transparent。
// 注意必须逐条匹配，否则从 .pool-pin-code 跨规则匹配到后面的 :not(...) 规则会误报。
const cssNoComment = css.replace(/\/\*[\s\S]*?\*\//g, '');
const ruleBlocks = cssNoComment.match(/[^{}]+\{[^{}]*\}/g) || [];
const transparentPin = ruleBlocks.filter((block) => {
  const index = block.indexOf('{');
  const selector = block.slice(0, index);
  const body = block.slice(index + 1, -1);
  // 去掉 :not(...) 否定式选择器后，若仍命中冻结列，说明该规则真的作用在冻结列上。
  const targetSelector = selector
    .replace(/:not\(\s*\.pool-pin-code\s*\)/g, '')
    .replace(/:not\(\s*\.pool-pin-name\s*\)/g, '');
  return /\.pool-pin-(code|name)/.test(targetSelector) && /background:\s*transparent/.test(body);
});
assert.equal(
  transparentPin.length,
  0,
  '直接作用于冻结列的规则不得写回 transparent，命中：' + transparentPin.join(' | ')
);

// 5) 用到的 token 必须在深色与浅色两套主题里都有定义。
for (const token of ['--bg-elevated', '--accent-soft-solid']) {
  const count = css.split(new RegExp(token + ':')).length - 1;
  assert.ok(count >= 2, token + ' 必须在深色与浅色主题中都有定义（当前 ' + count + ' 处）');
}

// 6) 冻结列仍然吸左，且第二列偏移由实测宽度变量驱动（避免改底色时误删定位）。
assert.ok(/\.pool-pin-code\s*\{[^}]*position:\s*sticky/.test(css), '代码列需保持 sticky 吸左定位');
assert.ok(/--pool-pin-name-left/.test(css), '名称列偏移应继续支持 --pool-pin-name-left 实测宽度');

console.log('pool-pinned-columns.test 通过（冻结列底色不透明）');
