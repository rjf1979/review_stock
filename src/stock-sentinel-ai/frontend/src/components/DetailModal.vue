<template>
    <div v-if="detail.open" class="modal" role="dialog" aria-modal="true" aria-labelledby="detailDialogTitle" @click.self="closeDetail">
      <div id="detailDialog" class="modal-card" tabindex="-1" @keydown="handleModalKeydown($event, 'detail')">
        <div class="detail-close-bar" aria-hidden="true"><button class="close detail-close" @click="closeDetail" aria-label="关闭个股详情">×</button></div>
        <div class="quote-head">
          <div class="quote-title">
            <h2 id="detailDialogTitle">{{ detail.name }}</h2>
            <div class="quote-code">{{ detail.code }} · 前复权日 K</div>
            <div v-if="detail.row && poolRecommendations[detail.row.code]" class="quote-rec" aria-label="盯盘建议">
              <span class="workbench-state" :class="recommendationClass(detail.row)">{{ recommendationLabel(detail.row) }}</span>
              <span v-if="recommendationReason(detail.row)" class="quote-rec-reason">{{ recommendationReason(detail.row) }}</span>
            </div>
            <div class="quote-price" :class="detail.changePct >= 0 ? 'pos' : 'neg'">
              <strong>{{ detail.priceText }}</strong><span>{{ detail.changeText }}</span>
            </div>
          </div>
          <div class="quote-stats" aria-label="个股行情摘要">
            <div class="quote-row">
              <div class="quote-stat"><span>今开</span><b>{{ detail.openText }}</b></div>
              <div class="quote-stat"><span>最高</span><b class="pos">{{ detail.highText }}</b></div>
              <div class="quote-stat"><span>最低</span><b class="neg">{{ detail.lowText }}</b></div>
              <div class="quote-stat"><span>成交量</span><b>{{ detail.volumeText }}</b></div>
              <div class="quote-stat"><span>成交额</span><b>{{ detail.amountText }}</b></div>
              <div class="quote-stat"><span>换手 / 量比</span><b>{{ detail.turnoverText }} / {{ detail.volumeRatioText }}</b></div>
            </div>
            <div v-if="detailWatchReturn" class="quote-row quote-return" :class="detailWatchReturn.tone" :title="detailWatchReturn.baselineText || detailWatchReturn.text">
              <div class="quote-stat"><span>{{ detailWatchReturn.isCustom ? '模拟收益' : '累计收益' }}</span><b>{{ detailWatchReturn.text }}</b></div>
              <small v-if="detailWatchReturn.baselineText">{{ detailWatchReturn.baselineText }}</small>
              <button type="button" class="btn mini" @click="openReturnBaselineEditor">{{ detailWatchReturn.isCustom ? '编辑模拟价' : '设置模拟价' }}</button>
            </div>
          </div>
        </div>
        <div class="detail-workspace">
          <section class="detail-chart-panel" aria-label="行情与 K 线证据">
            <div class="chart-toolbar"><b>日 K · MA5 / 10 / 20 / 60</b></div>
            <div v-if="detail.loading" class="status loading" aria-live="polite">正在加载 K 线…</div>
            <div v-else-if="detail.error" class="status error" role="status">{{ detail.error }}</div>
            <div v-else class="chart-wrap"><div id="chart"></div></div>
            <p class="detail-note">拖动底部滑块查看历史区间；悬停 K 线可查看当日开高低收与成交量。数据来自公开行情，仅作研究参考。</p>
          </section>
          <aside class="insight-panel" aria-label="个股数据与 AI 辅助研判">
            <div class="insight-head">
              <div class="insight-title">
                <h3>个股研判</h3>
                <span class="workbench-state" :class="detailAiStateClass" role="status">{{ detailAiState }}</span>
              </div>
              <button type="button" class="btn mini" :disabled="detail.loading" @click="refreshDetail">刷新数据</button>
            </div>
            <details class="insight-section" open>
              <summary>个股数据 <span class="muted">K 线、指标与形态</span></summary>
              <div class="insight-section-body">
                <div class="insight-meta" aria-label="个股数据摘要">
                  <span class="wide">数据基准<b>K线 {{ detail.klineDate || '—' }} · 快照 {{ detail.row && detail.row.snapshotDate || '—' }} · {{ detail.kline.length ? detail.kline.length + ' 根日 K' : '加载中' }}</b></span>
                </div>
                <div class="evidence-list" aria-label="本地证据摘要">
                  <div v-for="item in detail.evidence" :key="item.label" class="evidence-item"><span>{{ item.label }}</span><b :class="item.tone || ''">{{ item.value }}</b></div>
                </div>
                <div class="pattern-hits" aria-label="形态信号">
                  <div v-if="detail.patternHits.length" v-for="hit in detail.patternHits" :key="hit.patternId" class="pattern-hit">
                    <b>{{ hit.label }}</b><em class="pattern-score">{{ hit.score }} 分</em><span>{{ hit.reason }}</span>
                  </div>
                  <p v-else class="ai-empty">已按当前 K 线复核 {{ detail.checkedPatternRules }} 条启用形态规则，暂无命中。</p>
                  <p v-if="detail.row && detail.row.ruleLabel" class="pattern-context"><b>入池预筛线索：</b>{{ detail.row.ruleLabel }}</p>
                </div>
              </div>
            </details>
            <details class="insight-section" :open="detail.aiRun || detail.aiBusy">
              <summary>AI 研判 <span class="muted">{{ detailAiState }}</span></summary>
              <div class="insight-section-body">
                <div class="insight-meta" aria-label="研判元信息">
                  <span>研判时间<b>{{ detail.aiUpdatedAt || '未研判' }}</b></span>
                  <span>上次研判<b>{{ detail.aiLastSuccess ? fmtTime(detail.aiLastSuccess.finishedAt) : '—' }}</b></span>
                  <span>模型<b>{{ detail.aiModel || '未调用' }}</b></span>
                  <span>数据状态<b>{{ aiSampleLabel }}</b></span>
                </div>
                <div class="ai-theme-line" aria-label="行业与题材"><span>行业 / 题材</span><b>{{ aiThemeSummary }}</b></div>
                <div class="ai-actions">
                  <button type="button" class="btn primary" :disabled="detail.aiBusy || detail.loading || !!detail.error" @click="runAiDetail">{{ aiBtnLabel }}</button>
                  <span class="summary">证据变化后，携带上次结论与本次数据变化发送至已配置接口做增量复核</span>
                </div>
                <div v-if="detail.aiBusy" class="status loading" aria-live="polite">正在向 AI 研判接口请求，请稍候…</div>
                <div v-else-if="detail.aiRun">
              <div v-if="detail.aiError" class="status error" role="status">{{ detail.aiErrorText || '本次研判失败' }}</div>
              <div v-if="detail.aiVerdict" class="ai-verdict-line" :class="aiVerdictClass"><span>结论倾向</span><b>{{ aiVerdictLabel }}</b></div>
              <p v-if="detail.aiText" class="ai-summary">{{ aiSummary }}</p>
              <div v-if="detail.aiChanges.length" class="ai-field-block">
                <h4>结论变化</h4>
                <ul><li v-for="(c, i) in detail.aiChanges" :key="'c' + i">{{ c }}</li></ul>
              </div>
              <div v-if="detail.aiEvidence.length" class="ai-field-block evidence">
                <h4>关键证据</h4>
                <ul><li v-for="(e, i) in detail.aiEvidence" :key="'e' + i">{{ e }}</li></ul>
              </div>
              <div v-if="detail.aiRisks.length" class="ai-field-block risks">
                <h4>主要风险</h4>
                <ul><li v-for="(x, i) in detail.aiRisks" :key="'r' + i">{{ x }}</li></ul>
              </div>
              <div v-if="detail.aiWatchPoints.length" class="ai-field-block watch">
                <h4>后续跟踪点</h4>
                <ul><li v-for="(x, i) in detail.aiWatchPoints" :key="'w' + i">{{ x }}</li></ul>
              </div>
              <div v-if="detail.aiPriceLevels && detail.aiPriceLevels.available" class="ai-price-levels">
                <h4>仓位与风险价位</h4>
                <div class="price-level-grid">
                  <div v-if="detail.aiPriceLevels.entryTriggers.length"><span>建仓价位</span><b>{{ detail.aiPriceLevels.entryTriggers.map(entryTriggerLabel).join('；') }}</b></div>
                  <div v-if="detail.aiPriceLevels.invalidationLevel"><span>止损价位</span><b>{{ detail.aiPriceLevels.invalidationLevel.label || detail.aiPriceLevels.invalidationLevel.value || '—' }}</b></div>
                  <div v-if="detail.aiPriceLevels.exitWatchZones.length"><span>止盈价位</span><b>{{ detail.aiPriceLevels.exitWatchZones.map(exitWatchLabel).join('、') }}</b></div>
                </div>
                <p class="summary">基于本地 K 线支撑、阻力与失效结构，仅作研究参考，不构成交易指令。</p>
              </div>
                <details v-if="detail.aiRaw" class="ai-raw">
                <summary>查看完整研判原文</summary>
                <div class="ai-result"><pre>{{ detail.aiRaw }}</pre></div>
                </details>
                </div>
                <p v-else class="ai-empty">尚未生成研判。请先完成候选池数据补齐并确认 AI 连接配置。</p>
              </div>
            </details>
          </aside>
        </div>
      </div>
    </div>
</template>

<script setup>
import { storeToRefs } from 'pinia';
import { useAppStore } from '../stores/app';
const app = useAppStore();
const { detail, status, detailAiStateClass, detailAiState, detailWatchReturn, summary, aiSampleLabel, aiThemeSummary, aiBtnLabel, aiVerdictClass, aiVerdictLabel, aiSummary, poolRecommendations } = storeToRefs(app);
const { closeDetail, handleModalKeydown, refreshDetail, fmtTime, runAiDetail, entryTriggerLabel, exitWatchLabel, recommendationClass, recommendationLabel, recommendationReason, openReturnBaselineEditor } = app;
</script>
