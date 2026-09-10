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
          <button class="btn" :disabled="scanning" @click="preScan({ force: true })">{{ hasValidPrescan ? '重新预扫描市场' : '预扫描市场' }}</button>
          <button class="btn primary" :disabled="scanning || !hasValidPrescan" @click="scan">重新预扫描并全市扫描</button>
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
        <div class="summary" role="note">
          重点行业：{{ scanContext.focusThemes.length ? scanContext.focusThemes.map(x => x.name).join('、') : '未取得，已按全市场回退' }}；
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

      <section v-if="rows.length" class="panel" aria-label="全市扫描结果">
        <div class="panel-head">
          <div>
            <h2>全市扫描结果</h2>
            <span class="summary">已展示 {{ rows.length }} 只快照命中股票，纳入候选池后补齐 K 线复筛。</span>
          </div>
        </div>
        <div class="table-wrap">
        <table aria-label="扫描结果">
          <thead>
            <tr>
              <th scope="col">代码</th><th scope="col">名称</th><th scope="col" class="hide-mobile">市场</th><th scope="col">现价</th>
              <th scope="col">涨跌幅</th><th scope="col" class="hide-mobile">换手%</th><th scope="col">量比</th>
              <th scope="col" class="hide-mobile">成交额(亿)</th><th scope="col" class="hide-mobile">主力净流入(亿)</th><th scope="col" class="hide-mobile">量能分</th>
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
import { storeToRefs } from 'pinia';
import { useAppStore } from '../stores/app';
const app = useAppStore();
const { mode, statusInfo, lastSnapDate, localStatus, selectedMarkets, settings, summary, scanning, hasValidPrescan, rows, poolBusy, status, statusText, scanContext } = storeToRefs(app);
const { scan, marketLabel, preScan, addAllToPool, fmtPct, fmtDateTime, openDetail, isInPool, addToPool, isWatched, toggleWatchFromScan } = app;
</script>
