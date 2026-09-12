<template>
    <!-- ══════════ 选股扫描 ══════════ -->
    <template v-if="mode==='scan'">
      <section class="overview" aria-label="本地数据总览">
        <div class="card"><div class="k">K线库（只）</div><div class="v">{{ statusInfo.klineCount || '—' }}</div></div>
        <div class="card"><div class="k">今日快照</div><div class="v">{{ lastSnapDate || '—' }}</div></div>
        <div class="card"><div class="k">本地市场就绪</div><div class="v small">{{ localStatus.okToday || 0 }} / {{ localStatus.total || 0 }}</div></div>
        <div class="card"><div class="k">预选市场</div><div class="v small">{{ selectedMarkets.length }} 个</div></div>
        <div class="card"><div class="k">扫描上限</div><div class="v">{{ settings.scanLimit }}</div></div>
      </section>

      <section class="toolbar" aria-label="选股条件">
        <div class="field-group">
          <label>扫描市场</label>
          <span class="summary">{{ selectedMarkets.map(marketLabel).join('、') || '请前往设置预选市场' }}</span>
        </div>
        <div class="actions">
          <button class="btn" :disabled="scanning" @click="preScan({ force: true })">扫描市场</button>
          <button class="btn primary" :disabled="scanning || !hasValidPrescan" @click="scan">扫描股票</button>
          <button class="btn" :disabled="scanning || !rows.filter(x => x.autoPool !== false).length || poolBusy" @click="addAllToPool">纳入可入池候选</button>
          <span class="summary">{{ summary }}</span>
        </div>
      </section>

      <div v-if="status" class="status" :class="status" role="status" aria-live="polite">{{ statusText }}</div>

      <section v-if="scanContext" class="panel" aria-label="本次扫描策略上下文">
        <div class="panel-head">
          <div><h2>市场预扫描</h2><span class="summary">{{ scanContext.snapshotDate || '—' }} · {{ scanContext.marketRegime.label }} · {{ scanContext.marketRegime.confidence === 'confirmed' ? '证据完整' : '部分证据' }} · {{ scanContext.isFinal ? '闭市数据' : '盘中数据' }}</span></div>
        </div>

        <div class="overview">
          <div class="card"><div class="k">市场环境</div><div class="v small">{{ scanContext.marketRegime.label }}</div></div>
          <div class="card"><div class="k">扫描策略</div><div class="v small">{{ scanContext.strategy.label }}</div></div>
          <div class="card"><div class="k">重点行业</div><div class="v small">{{ scanContext.focusThemes.length }} 个</div></div>
          <div class="card"><div class="k">可关注概念</div><div class="v small">{{ scanContext.focusConcepts.length }} 个</div></div>
          <div class="card"><div class="k">实际范围</div><div class="v small">{{ scanContext.scanScope.stockCount }} 只</div></div>
          <div class="card"><div class="k">快照命中</div><div class="v small">{{ scanContext.prefilter ? scanContext.prefilter.matched + ' 只待 K 线复筛' : '待扫描' }}</div></div>
          <div class="card"><div class="k">涨停 / 跌停</div><div class="v small">{{ scanContext.limitStructure.available ? scanContext.limitStructure.limitUpCount + ' / ' + scanContext.limitStructure.limitDownCount : '不可用' }}</div></div>
          <div class="card"><div class="k">炸板 / 封板率</div><div class="v small">{{ scanContext.limitStructure.available ? scanContext.limitStructure.brokenCount + ' / ' + fmtPct(scanContext.limitStructure.sealRate * 100) : '不可用' }}</div></div>
          <div class="card"><div class="k">连板高度</div><div class="v small">{{ scanContext.limitStructure.available ? scanContext.limitStructure.maxBoardHeight + ' 板' : '不可用' }}</div></div>
        </div>
        <div class="theme-detail" aria-labelledby="themeDetailTitle">
          <div class="theme-detail-head">
            <h3 id="themeDetailTitle">强势题材明细</h3>
            <span class="summary">按涨停数、主力资金及涨跌幅综合排序</span>
          </div>
          <div v-if="focusBoards.length" class="table-wrap theme-table-wrap">
            <table aria-label="强势题材明细">
              <thead>
                <tr>
                  <th scope="col">类别</th><th scope="col">排名</th><th scope="col">题材</th><th scope="col">涨跌幅</th>
                  <th scope="col" class="hide-mobile">主力净流入</th><th scope="col" class="hide-mobile">领涨股</th>
                  <th scope="col" class="hide-mobile">上涨 / 下跌</th><th scope="col" class="hide-mobile">涨停数</th><th scope="col">覆盖股票</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="board in focusBoards" :key="board.kind + board.code">
                  <td><span class="theme-kind">{{ board.kind === 'industry' ? '行业' : '概念' }}</span></td>
                  <td class="num">{{ board.rank }}</td>
                  <td>{{ board.name }}</td>
                  <td class="num" :class="board.changePct >= 0 ? 'pos' : 'neg'">{{ fmtPct(board.changePct) }}</td>
                  <td class="num hide-mobile" :class="board.mainNet >= 0 ? 'pos' : 'neg'">{{ fmtBoardAmount(board.mainNet) }}</td>
                  <td class="hide-mobile">{{ board.leader || '—' }}</td>
                  <td class="num hide-mobile">{{ fmtBoardBreadth(board) }}</td>
                  <td class="num hide-mobile">{{ board.kind === 'industry' ? board.limitUpCount : '—' }}</td>
                  <td class="num">{{ board.constituentCount || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="summary theme-detail-empty" role="note">未取得强势题材明细；{{ scanContext.scanScope.reason || '当前按全市场范围扫描。' }}</p>
        </div>
        <div class="summary" role="note">
          重点行业：{{ scanContext.focusThemes.length ? scanContext.focusThemes.map(x => x.name).join('、') : '未取得' }}；
          <span>可关注概念：{{ scanContext.focusConcepts.length ? scanContext.focusConcepts.map(x => x.name).join('、') : '未取得' }}。</span>
          启用形态：{{ scanContext.strategy.enabledRuleIds.join('、') || '—' }}。
          <span>预扫描时间：{{ fmtDateTime(scanContext.fetchedAt) }}<template v-if="scanContext.reused">（已复用闭市结果）</template>。</span>
          <span v-if="scanContext.prefilter">扫描结果入候选池后补齐 K 线，再进行形态复筛。</span>
          <span v-if="scanContext.scanScope.reason">{{ scanContext.scanScope.reason }}</span>
          <span v-if="!scanContext.limitStructure.available">情绪结构：{{ scanContext.limitStructure.reason || '数据不可用' }}</span>
        </div>
      </section>

      <div v-if="rows.length" class="summary scan-rule-note" role="note">
        扫描口径：全市扫描只做快照预筛；命中股票可纳入候选池，补齐 K 线后再复筛形态并进入 AI 研判。
      </div>

      <section v-if="scanContext?.funnel" class="panel scan-funnel" aria-label="选股扫描漏斗">
        <div class="panel-head"><div><h2>本次扫描漏斗</h2><span class="summary">各阶段按股票代码去重，门槛不因目标数量自动放宽</span></div></div>
        <div class="market-stats">
          <div class="stat"><span>题材范围</span><strong>{{ scanContext.funnel.scope }}</strong></div>
          <div class="stat"><span>有效行情</span><strong>{{ scanContext.funnel.validQuotes }}</strong></div>
          <div class="stat"><span>预筛命中</span><strong>{{ scanContext.funnel.prefilterMatched }}</strong></div>
          <div class="stat"><span>潜力候选</span><strong class="pos">{{ scanContext.funnel.potential }}</strong></div>
          <div class="stat"><span>强势观察</span><strong>{{ scanContext.funnel.strongWatch }}</strong></div>
          <div class="stat"><span>超配额</span><strong>{{ scanContext.funnel.overQuota }}</strong></div>
          <div class="stat"><span>数据不足</span><strong class="neg">{{ scanContext.funnel.dataInsufficient }}</strong></div>
        </div>
      </section>

      <section v-if="scanContext?.strongWatch?.length" class="panel" aria-label="强势观察名单">
        <div class="panel-head"><div><h2>强势观察</h2><span class="summary">用于观察题材强度，因涨停或涨幅过高不进入默认潜力候选</span></div></div>
        <div class="table-wrap">
          <table aria-label="强势观察股票">
            <thead><tr><th>代码</th><th>名称</th><th>现价</th><th>涨跌幅</th><th>分流原因</th><th>题材</th></tr></thead>
            <tbody><tr v-for="r in scanContext.strongWatch" :key="r.code" tabindex="0" @click="openDetail(r)" @keydown.enter="openDetail(r)">
              <td class="num">{{ r.code }}</td><td>{{ r.name }}</td><td class="num">{{ fmtNum(r.price) }}</td>
              <td class="num pos">+{{ fmtNum(r.changePct) }}%</td>
              <td>{{ r.initialAssessment?.reasons?.join('；') || '涨幅过高' }}</td>
              <td>{{ (r.themeEvidence || []).map(x => x.name).join(' / ') || '—' }}</td>
            </tr></tbody>
          </table>
        </div>
      </section>

      <section v-if="rows.length" class="panel" aria-label="题材内强势股扫描结果">
        <div class="panel-head">
          <div>
            <h2>题材内强势股</h2>
            <span class="summary">仅在已预扫描题材成分股中筛选；题材内按涨停、涨跌幅、主力净流入和量能分排序。</span>
          </div>
        </div>
        <div class="table-wrap">
        <table aria-label="扫描结果">
          <thead>
            <tr>
              <th scope="col">代码</th><th scope="col">名称</th><th scope="col" class="hide-mobile">市场</th><th scope="col">现价</th>
              <th scope="col">涨跌幅</th><th scope="col" class="hide-mobile">换手%</th><th scope="col">量比</th>
              <th scope="col" class="hide-mobile">成交额(亿)</th><th scope="col" class="hide-mobile">主力净流入(亿)</th><th scope="col" class="hide-mobile">量能分</th>
              <th scope="col">板块 / 候选排名</th>
              <th scope="col">当前阶段</th><th scope="col" class="hide-mobile">风险提示</th><th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.code" tabindex="0" @click="openDetail(r)" @keydown.enter="openDetail(r)">
              <td class="num">{{ r.code }}</td>
              <td>{{ r.name }}</td>
              <td class="hide-mobile">{{ marketLabel(r.market) }}</td>
              <td class="num" :class="r.changePct >= 0 ? 'pos' : 'neg'">{{ r.price.toFixed(2) }}</td>
              <td class="num" :class="r.changePct >= 0 ? 'pos' : 'neg'">{{ r.changePct.toFixed(2) }}%</td>
              <td class="num hide-mobile">{{ r.turnover.toFixed(2) }}</td>
              <td class="num">{{ r.volumeRatio.toFixed(2) }}</td>
              <td class="num hide-mobile">{{ r.amountYi.toFixed(2) }}</td>
              <td class="num hide-mobile" :class="r.mainNetYi >= 0 ? 'pos' : 'neg'">{{ r.mainNetYi.toFixed(2) }}</td>
              <td class="num hide-mobile"><strong>{{ r.score }}</strong></td>
              <td class="pat theme-leader" :class="{ leader: r.isBoardLeader }" :title="themeLeaderText(r)">{{ themeLeaderText(r) }}</td>
              <td class="pat" :title="r.ruleLabel || ''">待补 K 线复筛</td>
              <td class="hide-mobile" :title="(r.riskFlags || []).map(x => x.label).join('；')">{{ (r.riskFlags || []).length ? (r.riskFlags || []).map(x => x.label).join('；') : '—' }}</td>
              <td>
                <button class="watch-remove" :class="{ added: isInPool(r.code) }" :disabled="r.autoPool === false" :aria-pressed="isInPool(r.code)" @click.stop="addToPool(r)">{{ r.autoPool === false ? '仅观察' : (isInPool(r.code) ? '✓ 在池' : '＋ 候选') }}</button>
                <button class="watch-remove" :class="{ added: isWatched(r.code) }" :aria-pressed="isWatched(r.code)" @click.stop="toggleWatchFromScan(r)">{{ isWatched(r.code) ? '★ 已加' : '＋ 自选' }}</button>
              </td>
            </tr>
          </tbody>
        </table>
        </div>
      </section>
    </template>
</template>

<script setup>
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useAppStore } from '../stores/app';
const app = useAppStore();
const { mode, statusInfo, lastSnapDate, localStatus, selectedMarkets, settings, summary, scanning, hasValidPrescan, rows, poolBusy, status, statusText, scanContext } = storeToRefs(app);
const { scan, marketLabel, preScan, addAllToPool, fmtPct, fmtNum, fmtDateTime, openDetail, isInPool, addToPool, isWatched, toggleWatchFromScan } = app;
const focusBoards = computed(() => [
  ...(scanContext.value?.focusThemes || []),
  ...(scanContext.value?.focusConcepts || []),
]);
const fmtBoardAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? `${(amount / 1e8).toFixed(2)}亿` : '—';
};
const fmtBoardBreadth = (board) => {
  const advance = Number(board.advanceCount);
  const decline = Number(board.declineCount);
  return Number.isFinite(advance) && Number.isFinite(decline) ? `${advance} / ${decline}` : '—';
};
const themeLeaderText = (row) => {
  const candidates = new Map((row.candidateThemeRanks || row.themeLeaderRanks || []).map((item) => [item.code, item]));
  return (row.boardLeaderRanks || []).map((item) => {
    const candidate = candidates.get(item.code);
    const coverage = item.coverage === 'complete' ? '' : '（部分覆盖）';
    return `${item.name} 板#${item.rank}${candidate ? ` / 候#${candidate.rank}` : ''}${coverage}`;
  }).join('；') || '—';
};
</script>
