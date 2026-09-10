<template>
    <!-- ══════════ 自选盯盘 ══════════ -->
    <template v-if="mode==='watch'">
      <section class="panel" aria-label="自选盯盘">
        <div class="panel-head">
          <div class="panel-title">
            <h2>自选盯盘</h2>
            <p class="summary">
              {{ settings.watchDataLabel || '数据日期待加载' }} · 累计收益按加入日最终收盘价计算 · 点击卡片查看 K 线详情
              <span v-if="!watchSessionActive" class="session-hint">｜午间休市 / 已收盘 · 自动刷新暂停，开盘后自动恢复</span>
            </p>
          </div>
          <div class="watch-toolbar">
            <div class="watch-add">
              <input id="watchInput" type="text" v-model="watchInput" placeholder="添加 6 位代码，如 600185" inputmode="numeric" autocomplete="off" @keyup.enter="addWatch" aria-label="添加自选代码" />
              <button class="btn primary" :disabled="addingWatch" @click="addWatch">添加</button>
            </div>
            <div class="watch-controls" role="group" aria-label="刷新控制">
              <label class="field-group">
                <select v-model.number="watchIntervalMs" @change="restartWatchPolling" aria-label="自动刷新周期">
                  <option :value="3000">3s</option>
                  <option :value="5000">5s</option>
                  <option :value="10000">10s</option>
                  <option :value="30000">30s</option>
                  <option :value="0">手动</option>
                </select>
              </label>
              <label class="toggle"><input type="checkbox" v-model="watchAuto" @change="restartWatchPolling" /> 自动刷新</label>
              <button class="btn" :disabled="watchCompleting || !watchlist.length" @click="completeWatchKlines(true)" title="从实时源补齐自选股缺失的日 K 数据">补全 K 线</button>
              <button class="btn icon-btn" :disabled="watchRefreshing" @click="refreshWatch" title="立即刷新行情" aria-label="立即刷新行情"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.9-3L3 11m0 0V5m0 6h6M4 13a8 8 0 0 0 14.9 3L21 13m0 0v6m0-6h-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
            </div>
          </div>
        </div>
        <p v-if="watchAddMsg" class="summary watch-add-msg" :class="{ err: watchAddMsgError }" role="status" aria-live="polite">{{ watchAddMsg }}</p>

        <div v-if="watchQuotes.length" class="market-stats" aria-label="自选涨跌统计">
          <div class="stat"><span>上涨</span><strong class="pos">{{ boardStats.up }}</strong></div>
          <div class="stat"><span>下跌</span><strong class="neg">{{ boardStats.down }}</strong></div>
          <div class="stat"><span>平盘</span><strong>{{ boardStats.flat }}</strong></div>
          <div class="stat"><span>更新</span><strong class="time">{{ lastUpdate || '—' }}</strong></div>
        </div>

        <div v-if="watchQuotesError" class="status error" role="status">{{ watchQuotesError }}</div>
        <div v-else-if="watchRefreshing && !watchQuotes.length" class="status loading" role="status">正在加载自选行情…</div>
        <div v-else-if="!watchlist.length" class="status empty" role="status">自选为空，添加股票开始盯盘。</div>
        <div v-else-if="!watchQuotes.length" class="status empty" role="status">暂未取得行情，请点击“立即刷新”。</div>

        <div class="watch-grid" v-if="watchQuotes.length">
          <WatchKlineCard v-for="q in watchQuotes" :key="q.code" :quote="q" :kline-state="watchKlines[q.code]" :return-info="watchReturnByCode[q.code]" :recommendation="poolRecommendations[q.code]" :levels="watchLevels[q.code]" :pinned="isWatchPinned(q.code)" @open="openDetail(q)" @remove="removeWatch(q.code)" @toggle-pin="toggleWatchPin(q.code)" />
        </div>
      </section>
    </template>
</template>

<script setup>
import { storeToRefs } from 'pinia';
import { useAppStore } from '../stores/app';
import WatchKlineCard from './WatchKlineCard.vue';
const app = useAppStore();
const { mode, summary, settings, watchIntervalMs, watchAuto, watchRefreshing, watchInput, watchAddMsgError, status, watchAddMsg, watchQuotes, boardStats, lastUpdate, watchQuotesError, watchAlerts, watchlist, watchReturnByCode, poolRecommendations, watchKlines, watchLevels, watchSessionActive, watchCompleting } = storeToRefs(app);
const { restartWatchPolling, refreshWatch, addWatch, openDetail, fmtNum, removeWatch, toggleWatchPin, isWatchPinned, recommendationClass, recommendationLabel, recommendationReason, completeWatchKlines } = app;
</script>
