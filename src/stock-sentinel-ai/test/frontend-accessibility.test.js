const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isWeekendDate } = require('../server');

const html = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'index.html'), 'utf8');

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
