<template>
    <!-- ══════════ 候选池 ══════════ -->
    <template v-if="mode==='pool'">
      <section class="panel" aria-label="候选池">
        <div class="panel-head">
          <div>
            <h2>候选池</h2>
            <span class="summary">流程：全市扫描 → 候选池补齐数据并复筛 → 批量 AI 研判 → 复核 → 转入自选盯盘</span>
          </div>
          <div class="watch-controls">
            <button class="btn" :disabled="poolPrefetch.running || !pool.length" :aria-busy="poolPrefetch.running" @click="startPoolKline"><span v-if="poolPrefetch.running" class="loading-spinner" aria-hidden="true"></span><span v-else>补齐 250 日 K 线</span></button>
            <button class="btn primary" :disabled="recommendationBatch.running || !pool.length" :aria-busy="recommendationBatch.running" @click="startRecommendations"><span v-if="recommendationBatch.running" class="loading-spinner" aria-hidden="true"></span><span v-else>{{ Object.keys(poolRecommendations).length ? '重新评估盯盘价值' : '评估盯盘价值' }}</span></button>
            <button v-if="recommendationBatch.running" class="btn mini" @click="stopRecommendations">停止评估</button>
            <button class="btn" :disabled="judgmentBatch.running || poolPrefetch.running || !pool.length" :aria-busy="judgmentBatch.running" :title="judgmentBatch.running ? ('批量研判进行中：' + judgmentBatch.done + ' / ' + judgmentBatch.total) : '对候选池发起批量 AI 研判'" @click="openBatchConfirm(false)">{{ judgmentBatch.running ? '研判进行中 ' + judgmentBatch.done + '/' + judgmentBatch.total : '批量 AI 研判' }}</button>
            <button v-if="hasFailedJudgments" class="btn" :disabled="judgmentBatch.running || poolPrefetch.running || !pool.length" @click="openBatchConfirm(true)">重试失败项</button>
            <button class="btn primary" :disabled="poolBusy || !pool.length" @click="moveAllToWatch">批量转入自选</button>
            <button class="btn icon-btn" :disabled="poolBusy" @click="loadPool(true)" title="刷新候选池" aria-label="刷新候选池"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.9-3L3 11m0 0V5m0 6h6M4 13a8 8 0 0 0 14.9 3L21 13m0 0v6m0-6h-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
            <button class="btn" :disabled="poolBusy || !pool.length" :aria-busy="poolBusy" @click="clearPool"><span v-if="poolBusy" class="loading-spinner" aria-hidden="true"></span><span v-else>清空候选池</span></button>
          </div>
        </div>

        <div class="summary" :class="{ err: poolMsgError }" role="status">{{ poolMsg }}</div>
        <div class="toolbar pool-filters" aria-label="候选池筛选">
          <div class="pool-filter-group">
            <span class="pool-filter-label" id="poolTrackFilterLabel">跟踪建议</span>
            <div class="pool-filter-options" role="group" aria-labelledby="poolTrackFilterLabel">
              <button v-for="option in poolTrackFilterOptions" :key="option.value" type="button" class="pool-filter-option" :aria-pressed="poolTrackFilter === option.value" @click="poolTrackFilter = option.value"><span>{{ option.label }}</span><span class="pool-filter-count">{{ option.count }}</span></button>
            </div>
          </div>
          <div class="pool-filter-group">
            <span class="pool-filter-label" id="poolPatternFilterLabel">形态筛选</span>
            <div class="pool-filter-options" role="group" aria-labelledby="poolPatternFilterLabel">
              <button v-for="option in poolPatternFilterOptions" :key="option.value" type="button" class="pool-filter-option" :aria-pressed="poolPatternFilter === option.value" @click="poolPatternFilter = option.value"><span>{{ option.label }}</span><span class="pool-filter-count">{{ option.count }}</span></button>
            </div>
          </div>
        </div>

        <div v-if="judgmentBatch.running || judgmentBatch.finishedAt" class="status" role="status" aria-live="polite">
          <span v-if="judgmentBatch.running">
            <template v-if="judgmentBatch.phase === 'preparing'">正在准备研判证据：{{ judgmentBatch.prepareDone }} / {{ judgmentBatch.prepareTotal || pool.length }} · 当前 {{ judgmentBatch.current }} {{ judgmentBatch.currentName }}</template>
            <template v-else>批量研判中：已处理 {{ judgmentBatch.done }} / {{ judgmentBatch.total }} · 已保存 {{ judgmentBatch.success }} · 失败 {{ judgmentBatch.failed + judgmentBatch.formatError }} · 跳过 {{ judgmentBatch.skipped + judgmentBatch.noChange + judgmentBatch.notReady }} · 正在研判 {{ judgmentBatch.current }} {{ judgmentBatch.currentName }}</template>
          </span>
          <span v-else-if="judgmentBatch.finishedAt && judgmentBatch.done >= judgmentBatch.total">
            批量研判{{ (judgmentBatch.failed + judgmentBatch.formatError) ? '结束' : '完成' }}：已保存 {{ judgmentBatch.success }} · 失败 {{ judgmentBatch.failed + judgmentBatch.formatError }}（超时/接口错误）· 跳过 {{ judgmentBatch.skipped + judgmentBatch.noChange + judgmentBatch.notReady }} · 用时 {{ fmtDuration(judgmentBatch.finishedAt - judgmentBatch.startedAt) }}。
            <template v-if="judgmentBatch.failed + judgmentBatch.formatError">可点「重试失败项」只补跑失败股票…</template>
          </span>
          <span v-else>
            已停止批量研判。已成功的 {{ judgmentBatch.success }} 只结论已保存，其余保持“待研判/研判失败”，可随时续跑。
          </span>
          <button v-if="judgmentBatch.running" class="btn mini" @click="stopBatch">停止</button>
        </div>

        <div v-if="poolPrefetch.running || poolPrefetch.finishedAt" class="summary" role="status">
          补齐 K 线：{{ poolPrefetch.done }} / {{ poolPrefetch.total }}（成功 {{ poolPrefetch.ok }}，跳过 {{ poolPrefetch.skipped }}，失败 {{ poolPrefetch.failed }}）· 当前 {{ poolPrefetch.current || '—' }}
          <button v-if="poolPrefetch.running" class="btn mini" @click="stopPoolKline">停止</button>
        </div>

        <div v-if="pool.length" class="market-stats" aria-label="候选池涨跌统计">
          <div class="stat"><span>候选</span><strong>{{ pool.length }}</strong></div>
          <div class="stat"><span>上涨</span><strong class="pos">{{ poolStats.up }}</strong></div>
          <div class="stat"><span>下跌</span><strong class="neg">{{ poolStats.down }}</strong></div>
          <div class="stat"><span>平盘</span><strong>{{ poolStats.flat }}</strong></div>
          <div class="stat"><span>优先跟踪</span><strong class="pos">{{ poolFilterStats.priority }}</strong></div>
          <div class="stat"><span>形态命中</span><strong class="pos">{{ poolFilterStats.hit }}</strong></div>
        </div>

        <div v-if="!pool.length" class="status empty" role="status">候选池为空：请先到“选股扫描”执行全市扫描，将命中股票纳入候选池；入池后可补齐研判数据并发起批量 AI 研判。</div>

        <div class="table-wrap" v-if="pool.length">
          <table aria-label="候选池列表">
            <thead>
              <tr>
                <th>代码</th><th>名称</th><th>推荐</th><th>状态</th><th class="hide-mobile">市场</th><th>现价</th><th><button type="button" class="sort-head" :class="{ asc: poolSortDir === 1 }" :aria-pressed="poolSort === 'changePct'" @click="togglePoolSort('changePct')">涨跌幅</button></th>
                <th class="hide-mobile">换手%</th><th><button type="button" class="sort-head" :class="{ asc: poolSortDir === 1 }" :aria-pressed="poolSort === 'volumeRatio'" @click="togglePoolSort('volumeRatio')">量比</button></th><th class="hide-mobile">成交额(亿)</th><th class="hide-mobile">主力净流入(亿)</th>
                 <th class="hide-mobile"><button type="button" class="sort-head" :class="{ asc: poolSortDir === 1 }" :aria-pressed="poolSort === 'score'" @click="togglePoolSort('score')">量能评分</button></th><th>形态信号</th><th class="hide-mobile">K线深度</th><th class="hide-mobile">最新K线</th><th class="hide-mobile"><button type="button" class="sort-head" :class="{ asc: poolSortDir === 1 }" :aria-pressed="poolSort === 'addedAt'" @click="togglePoolSort('addedAt')">入池时间</button></th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in sortedPool" :key="r.code" tabindex="0" @click="openDetail(r)" @keydown.enter="openDetail(r)">
                <td class="num">{{ r.code }}</td>
                <td>{{ r.name }}</td>
                <td><span class="workbench-state" :class="recommendationClass(r)">{{ recommendationLabel(r) }}</span></td>
                <td><span class="workbench-state" :class="candidateStateClass(r)">{{ candidateState(r) }}</span></td>
                <td class="hide-mobile">{{ marketLabel(r.market) }}</td>
                <td class="num" :class="r.changePct >= 0 ? 'pos' : 'neg'">{{ fmtNum(r.price) }}</td>
                <td class="num" :class="r.changePct >= 0 ? 'pos' : 'neg'">{{ r.changePct >= 0 ? '+' : '' }}{{ fmtNum(r.changePct) }}%</td>
                <td class="num hide-mobile">{{ fmtNum(r.turnover) }}</td>
                <td class="num">{{ fmtNum(r.volumeRatio) }}</td>
                <td class="num hide-mobile">{{ fmtNum(r.amountYi) }}</td>
                <td class="num hide-mobile" :class="r.mainNetYi >= 0 ? 'pos' : 'neg'">{{ fmtNum(r.mainNetYi) }}</td>
                <td class="num hide-mobile"><strong>{{ r.score }}</strong></td>
                <td class="num pat">{{ poolPatternLabel(r) }}</td>
                 <td class="num hide-mobile">{{ klineDone(r.code) ? klineDone(r.code) + ' 日' : '—' }}</td>
                 <td class="num hide-mobile pool-date-cell" :title="poolKlineLatest(r.code).savedAt || ''"><b>{{ poolKlineLatest(r.code).latestDate || '—' }}</b><small v-if="poolKlineLatest(r.code).savedAt">落盘 {{ fmtClock(poolKlineLatest(r.code).savedAt) }}</small></td>
                <td class="num hide-mobile pool-date-cell" :title="r.addedAt || ''"><b>{{ fmtDateTime(r.addedAt) }}</b></td>
                <td>
                  <div class="pool-row-actions">
                    <button class="watch-remove" :disabled="poolBusy || isPoolItemBusy(r.code)" :aria-busy="isPoolItemBusy(r.code, 'move')" @click.stop="moveToWatch(r)" :aria-label="'转入自选 ' + r.name"><span v-if="isPoolItemBusy(r.code, 'move')" class="loading-spinner" aria-hidden="true"></span><span v-else>＋自选</span></button>
                    <button class="watch-remove" :disabled="poolBusy || isPoolItemBusy(r.code)" :aria-busy="isPoolItemBusy(r.code, 'remove')" @click.stop="removeFromPool(r.code)" :aria-label="'移除 ' + r.name"><span v-if="isPoolItemBusy(r.code, 'remove')" class="loading-spinner" aria-hidden="true"></span><span v-else>移除</span></button>
                  </div>
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
const { mode, pool, summary, poolPrefetch, recommendationBatch, poolRecommendations, judgmentBatch, hasFailedJudgments, poolBusy, poolMsgError, status, poolMsg, poolTrackFilterOptions, poolTrackFilter, poolPatternFilterOptions, poolPatternFilter, poolStats, poolFilterStats, poolSortDir, poolSort, sortedPool } = storeToRefs(app);
const { startPoolKline, startRecommendations, stopRecommendations, openBatchConfirm, moveAllToWatch, loadPool, clearPool, fmtDuration, stopBatch, stopPoolKline, togglePoolSort, openDetail, recommendationClass, recommendationLabel, recommendationReason, candidateStateClass, candidateState, marketLabel, fmtNum, poolPatternLabel, klineDone, poolKlineLatest, fmtClock, fmtDateTime, isPoolItemBusy, moveToWatch, removeFromPool } = app;
</script>
