const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isWeekendDate } = require('../server');

// 前端已拆分为 Vite + SFC 多文件结构：拼接全部源文件（壳 + 样式 + store + 组件）后做静态契约检查。
function collectFrontendSources() {
  const root = path.join(__dirname, '..', 'frontend');
  const out = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      if (name === 'dist' || name === 'node_modules') continue; // 只检查源码
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(root);
  // js/css 文件内容包进 script 块，让标签平衡检查按原 index.html 的口径剥离脚本内容
  return out.sort()
    .map((f) => {
      const c = fs.readFileSync(f, 'utf8');
      return /\.js$|\.css$/.test(f) ? '<script>' + c + '</script>' : c;
    })
    .join('\n');
}
const html = collectFrontendSources();

function assertStaticMarkupIsBalanced(source) {
  const markup = source.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const stack = [];
  const tagPattern = /<!--[\s\S]*?-->|<![^>]*>|<\/?\s*([a-zA-Z][\w:-]*)\b[^>]*>/g;
  let match;

  while ((match = tagPattern.exec(markup))) {
    const raw = match[0];
    if (!match[1] || raw.startsWith('<!--') || raw.startsWith('<!')) continue;
    const tag = match[1].toLowerCase();
    const isClosing = /^<\//.test(raw);
    const isSelfClosing = /\/\s*>$/.test(raw) || voidTags.has(tag);
    if (!isClosing && !isSelfClosing) {
      stack.push({ tag, index: match.index });
      continue;
    }
    if (isClosing) {
      const opened = stack.pop();
      assert.ok(opened && opened.tag === tag, `标签错配：${opened ? `<${opened.tag}>` : '无开始标签'} 被 </${tag}> 关闭（字符 ${match.index}）`);
    }
  }

  assert.equal(stack.length, 0, `未关闭标签：${stack.map((item) => `<${item.tag}>`).join('、')}`);
}

assertStaticMarkupIsBalanced(html);
assert.match(html, /header\.topbar \{[\s\S]*?flex-wrap: nowrap;/);
assert.match(html, /\.topbar-actions \{[\s\S]*?margin-left: auto;[\s\S]*?flex: 0 0 auto;/);
assert.match(html, /<div class="topbar-actions">[\s\S]*?<nav class="mode-switch"[\s\S]*?<button[^>]*id="tab-pool"/);

assert.match(html, /aria-modal="true" aria-labelledby="detailDialogTitle"/);
assert.match(html, /aria-modal="true" aria-labelledby="ruleDialogTitle"/);
assert.match(html, /aria-modal="true" aria-labelledby="batchConfirmTitle"/);
assert.match(html, /@keydown="handleModalKeydown\(\$event, 'detail'\)"/);
assert.match(html, /@keydown="handleModalKeydown\(\$event, 'rule'\)"/);
assert.match(html, /@keydown="handleModalKeydown\(\$event, 'batch'\)"/);
assert.match(html, /@click="openBatchConfirm\(false\)"/);
assert.match(html, /@click="openBatchConfirm\(true\)"/);
assert.match(html, /<summary>个股数据 <span class="muted">K 线、指标与形态<\/span><\/summary>/);
assert.match(html, /<summary>AI 研判 <span class="muted">\{\{ detailAiState \}\}<\/span><\/summary>/);
assert.doesNotMatch(html, /<span>入池规则<b>/);
assert.match(html, /入池预筛线索/);
assert.match(html, /数据基准<b>K线 \{\{ detail\.klineDate \|\| '—' \}\} · 快照/);
assert.match(html, /:class="aiVerdictClass"/);
assert.match(html, /class="ai-field-block risks"/);
assert.match(html, /class="ai-field-block evidence"/);
assert.match(html, /saveRuleDraft, removeRule, resetRules, saveRules/);
assert.match(html, /class="pool-filter-options" role="group" aria-labelledby="poolTrackFilterLabel"/);
assert.match(html, /v-for="option in poolTrackFilterOptions"/);
assert.match(html, /v-for="option in poolPatternFilterOptions"/);
assert.match(html, /const poolFilterStats = computed/);
assert.match(html, /优先跟踪<\/span><strong class="pos">\{\{ poolFilterStats\.priority \}\}<\/strong>/);
assert.match(html, /形态命中<\/span><strong class="pos">\{\{ poolFilterStats\.hit \}\}<\/strong>/);
assert.match(html, /const isPoolItemBusy = \(code, action\) => action \? poolItemBusy\.value\[code\] === action : Boolean\(poolItemBusy\.value\[code\]\)/);
assert.match(html, /:aria-busy="isPoolItemBusy\(r\.code, 'move'\)"/);
assert.match(html, /:aria-busy="isPoolItemBusy\(r\.code, 'remove'\)"/);
assert.match(html, /class="pool-row-actions"/);
assert.match(html, />＋自选<\/span>/);
assert.match(html, /function loadPoolPatterns\(\)/);
assert.match(html, /poolPatternFilter\.value === 'hit'/);
assert.match(html, /\.insight-panel \{ min-width: 0; height: calc\(92vh - 150px\);/);
assert.match(html, /\.insight-section \{ flex: 0 0 auto; min-height: 46px;/);
assert.doesNotMatch(html, /lineData\.push\(\{ yAxis: v, name: '退出观察'/);
assert.doesNotMatch(html, /formatter: '退出 \{c\}'/);
assert.match(html, /role="status"\s+aria-live="polite"/);
assert.match(html, /aria-label="本次扫描策略上下文"/);
assert.match(html, /\/api\/market-prescan\?/);
assert.match(html, /已复用闭市结果/);
assert.match(html, /扫描市场预选/);
assert.match(html, /请前往设置预选市场/);
assert.doesNotMatch(html, /@click="toggleMarket\(key\)"/);
assert.match(html, /扫描股数/);
assert.match(html, /id="scanLimit"/);
assert.match(html, /id="klineSyncIntervalSec"/);
assert.match(html, /交易时间内自动补全间隔（秒）/);
assert.match(html, /function applyDetailQuoteTexts\(quote\)/);
assert.match(html, /name: '成交量（股）'/);
assert.match(html, /formatter: \(value\) => fmtVolume\(value\)/);
assert.match(html, /累计收益按加入日最终收盘价计算/);
assert.match(html, /累计收益待当日收盘确认/);
assert.match(html, /历史自选未记录收益基准/);
assert.match(html, /id="returnBaselineDialog"/);
assert.match(html, /模拟买入待触达/);
assert.match(html, /开始监控日期/);
assert.match(html, /清除模拟价，恢复自动基准/);
assert.match(html, /handleModalKeydown\(\$event, 'baseline'\)/);
assert.match(html, /\/api\/kline\/sync/);
assert.match(html, /force \? 'watch' : 'managed'/);
assert.match(html, /已有 K 线同步任务正在运行，已加入等待队列/);
assert.match(html, /watchSessionActive, watchCompleting \} = storeToRefs\(app\)/);
assert.doesNotMatch(html, /v-else-if="watchAlerts\.length"/);
assert.doesNotMatch(html, /levelsText/);
assert.match(html, /const hasChart = computed\(\(\) => bars\.value\.length > 0\)/);
assert.match(html, /if \(chart && chart\.getDom\(\) !== chartEl\.value\) disposeChart\(\)/);
assert.match(html, /const entryTriggers = computed/);
assert.match(html, /confirmAbove \|\| \(trigger\.zone && trigger\.zone\.high\) \|\| trigger\.value \|\| trigger\.price/);
assert.match(html, /const entryStatus = computed/);
assert.match(html, /已达成/);
assert.match(html, /建仓 \$\{app\.fmtPrice\(item\.value\)\}/);
assert.match(html, /class="watch-card-entry-status"/);
assert.doesNotMatch(html, /markLine: \{ silent: true, symbol: \['none', 'none'\], data: entryLines \}/);
assert.match(html, /watchKlines\.value = Object\.fromEntries\(Object\.entries\(watchKlines\.value\)\.filter/);
assert.match(html, /await loadWatchKlines\(\);/);
assert.match(html, /filter\(\(c\) => \/\^\\d\{6\}\$\/\.test\(c\)\)/);
assert.match(html, /settings\.saveTradingSettings\(\)/);
assert.match(html, /settings\.saveScanPreferences\(\)/);
assert.match(html, /settings\.saveScanLimit\(\)/);
assert.match(html, /\.scan-market-field \.chips \{ flex-wrap: nowrap;/);
assert.doesNotMatch(html, /HQ_STAGE_RULES START/);
assert.match(html, /header\.topbar \{[\s\S]*?position: sticky;[\s\S]*?top: 0;/);
assert.match(html, /<div class="k">扫描上限<\/div><div class="v">\{\{ settings\.scanLimit \}\}<\/div>/);
assert.match(html, /<div class="k">快照命中<\/div>/);
assert.match(html, /待 K 线复筛/);
assert.match(html, /stock-sentinel-active-mode/);
assert.match(html, /localStorage\.setItem\('stock-sentinel-active-mode', next\)/);
assert.match(html, /scanContext\.scanScope\.stockCount/);
assert.match(html, /scanContext\.strategy\.enabledRuleIds/);
assert.match(html, /function handleModalKeydown\(event, kind\)/);
assert.match(html, /function restoreDialogFocus\(kind\)/);
assert.match(html, /正在预取 \$\{days\} 日 K 线：\$\{prefetch\.done\}\/\$\{prefetch\.total\}（\$\{prefetchPercent\.value\}%）/);
assert.doesNotMatch(html, /正在预取 \$\{days\} 日 K 线：[\s\S]{0,160}\$\{prefetchPercent\}%/);
assert.strictEqual(isWeekendDate('2026-09-05'), true, '周六应使用最近交易日快照基准');
assert.strictEqual(isWeekendDate('2026-09-04'), false, '工作日仍应检查当日快照');

console.log('frontend accessibility contract passed');
