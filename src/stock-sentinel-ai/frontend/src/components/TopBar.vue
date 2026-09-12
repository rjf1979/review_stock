<template>
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M5 16.5v2M12 11.5v2M19 6.5v2" stroke="#4c9aff" stroke-width="1.6" stroke-linecap="round"/>
            <path d="M5 18.8a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h0a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1Z" fill="#ff4545"/>
            <path d="M12 13.8a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h0a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1Z" fill="#20b7c7"/>
            <path d="M19 8.8a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h0a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1Z" fill="#ff4545"/>
          </svg>
        </span>
        <div class="brand-text">
          <h1>智诊盯盘</h1>
          <p>量能初筛 · 形态复核 · AI 辅助研判</p>
        </div>
      </div>
      <div class="market-clock" :title="marketClock.synced ? '由本地服务校时，每 5 分钟自动纠正' : '正在等待本地服务校时'" :aria-label="`北京时间 ${marketClock.time}，${marketClock.sessionLabel}，${marketClock.countdownLabel} ${marketClock.countdown}`">
        <span class="market-clock-time">{{ marketClock.time }}</span>
        <span class="market-clock-status">{{ marketClock.sessionLabel }}</span>
        <span class="market-clock-countdown">{{ marketClock.countdownLabel }} <b>{{ marketClock.countdown }}</b></span>
      </div>
      <div class="topbar-actions">
        <nav class="mode-switch" role="tablist" aria-label="工作模式">
          <button type="button" role="tab" id="tab-pool" :aria-selected="mode==='pool'" @click="switchMode('pool')">候选池 <span class="num">{{ pool.length }}</span></button>
          <button type="button" role="tab" id="tab-watch" :aria-selected="mode==='watch'" @click="switchMode('watch')">盯盘 <span class="num">{{ watchlist.length }}</span></button>
          <button type="button" role="tab" id="tab-scan" :aria-selected="mode==='scan'" @click="switchMode('scan')">扫股</button>
          <button type="button" role="tab" id="tab-settings" :aria-selected="mode==='settings'" @click="switchMode('settings')">设置</button>
        </nav>
        <button type="button" class="data-health" :class="dataHealth.state" @click="openDataHealth" :aria-label="dataHealth.label + '，' + dataHealth.detail">
          <span class="health-dot" aria-hidden="true"></span>
          <strong>{{ dataHealth.label }}</strong>
          <span class="health-detail">{{ dataHealth.detail }}</span>
        </button>
      </div>
    </header>
</template>

<script setup>
import { storeToRefs } from 'pinia';
import { useAppStore } from '../stores/app';
const app = useAppStore();
const { mode, pool, watchlist, settings, dataHealth, detail, marketClock } = storeToRefs(app);
const { switchMode, scan, openDataHealth } = app;
</script>
