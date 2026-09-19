// 详情图 RSI 副图的渲染契约守门（静态源码检查，不启动浏览器）。
//
// 背景：ECharts 的 setOption 默认按索引合并数组型组件。副图开启时是 3 个 grid /
// 3 个 yAxis / 3 个 RSI 系列，关闭后只提交 2 个；合并语义会把多出来的 grid[2]、
// yAxis[2] 和 RSI 系列留在画布上，实测残留在 74%~85% 高度区（70 参考虚线、
// 超卖带底色压在成交量面板上）。修复方式是给 setOption 传 replaceMerge。
//
// 副作用：replaceMerge 会整体替换 series，所以 AI 价格位标注必须由主体自带，
// 否则盘中每次刷新都会把建仓/止损/止盈连线抹掉。下面两条断言分别锁住这两点。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'frontend/src/stores/app.js'), 'utf8');
const modalSource = fs.readFileSync(path.join(root, 'frontend/src/components/DetailModal.vue'), 'utf8');

const chartStart = appSource.indexOf('function renderDetailChart()');
const chartEnd = appSource.indexOf('// RSI 副图开关：只切换详情图布局');
assert.ok(chartStart > 0 && chartEnd > chartStart, '未定位到 renderDetailChart 主体');
const renderSource = appSource.slice(chartStart, chartEnd);

// 1) 主体必须用 replaceMerge 清掉多余的 grid / yAxis / xAxis / series。
const replaceMerge = renderSource.match(/replaceMerge:\s*\[([^\]]*)\]/);
assert.ok(replaceMerge, 'renderDetailChart 的 setOption 缺少 replaceMerge，关闭副图会残留 RSI 图元');
const mergedTypes = replaceMerge[1].split(',').map((x) => x.trim().replace(/^'|'$/g, ''));
['series', 'grid', 'xAxis', 'yAxis'].forEach((type) => {
  assert.ok(mergedTypes.includes(type), `replaceMerge 缺少 ${type}，该类组件仍会被合并保留`);
});

// 2) 价格位标注由主体自带（否则 replaceMerge 会清掉 AI 价格位连线）。
assert.ok(/const levelMarks = priceLevelMarks\(detail\.aiPriceLevels\)/.test(renderSource), '主体未自建价格位标注');
assert.ok(/markArea: \{ silent: true, data: levelMarks\.areaData \}/.test(renderSource), 'candlestick 未带价格位 markArea');
assert.ok(/data: levelMarks\.lineData/.test(renderSource), 'candlestick 未带价格位 markLine');

// 3) 价格位构造只有一份实现，重绘入口与主体共用，避免两处口径漂移。
const markFnStart = appSource.indexOf('function priceLevelMarks(');
assert.ok(markFnStart > 0, '缺少 priceLevelMarks 构造函数');
const repaintStart = appSource.indexOf('function repaintPriceLevels(');
assert.ok(repaintStart > markFnStart, 'repaintPriceLevels 未复用 priceLevelMarks');
assert.ok(
  /const \{ areaData, lineData \} = priceLevelMarks\(levels\)/.test(appSource.slice(repaintStart, repaintStart + 900)),
  'repaintPriceLevels 未复用 priceLevelMarks',
);
// 内联构造价格位（直接把 levels.* 拼成 markLine 数据）只允许出现在 priceLevelMarks 内部。
const inlineCount = appSource.split('(levels.entryTriggers || [])').length - 1;
assert.equal(inlineCount, 1, `价格位内联构造出现 ${inlineCount} 处，应集中在 priceLevelMarks`);

// 4) 副图开关：关闭分支必须真的少给一套 grid / yAxis / 系列，否则 replaceMerge 无从清理。
assert.ok(/const gridIndexes = showRsi \? \[0, 1, 2\] : \[0, 1\]/.test(renderSource), 'grid 数量未随副图开关切换');
assert.ok(/\.\.\.\(showRsi \? \[\{[\s\S]*?RSI/.test(renderSource), 'RSI 系列未随副图开关切换');

// 5) 开关按钮必须带 aria-pressed，键盘与读屏用户才能感知当前状态。
assert.ok(/aria-pressed/.test(modalSource), 'DetailModal 的 RSI 副图开关缺少 aria-pressed');
assert.ok(/RSI14 副图/.test(modalSource), 'DetailModal 工具栏未标注 RSI14 副图');

console.log('详情 RSI 副图渲染契约通过（replaceMerge + 价格位自带 + 开关可切换）');
