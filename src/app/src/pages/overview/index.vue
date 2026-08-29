<template>
  <view class="page">
    <view class="card">
      <view class="section-title">主要指数</view>
      <view class="idx-table">
        <view class="idx-th">
          <text class="c-name">指数</text>
          <text class="c-v">现价</text>
          <text class="c-v">涨跌幅</text>
          <text class="c-v">成交额</text>
        </view>
        <view class="idx-tr" v-for="idx in indices" :key="idx.code">
          <text class="c-name">{{ idx.name }}</text>
          <text class="c-v up num" :class="pctClass(idx.changePct)">{{ fmtNum(idx.price, 2) }}</text>
          <text class="c-v num" :class="pctClass(idx.changePct)">{{ pctText(idx.changePct) }}</text>
          <text class="c-v muted num">{{ fmtWan(idx.amount) }}</text>
        </view>
      </view>
    </view>

    <view class="card">
      <view class="section-title">行业板块涨幅</view>
      <view class="sector-row" v-for="s in sectors.slice(0, 8)" :key="s.name">
        <text class="sector-name">{{ s.name }}</text>
        <text class="sector-flow muted num">{{ fmtWan(s.mainNet) }}</text>
        <text class="sector-pct up num" :class="pctClass(s.changePct)">{{ pctText(s.changePct) }}</text>
      </view>
      <view class="empty" v-if="!sectors.length">暂无板块数据</view>
    </view>

    <view class="card" v-if="amountText">
      <text class="muted">两市成交额</text>
      <text class="amount num">{{ amountText }}</text>
    </view>

    <text v-if="error" class="empty">{{ error }}</text>
    <view class="disclaimer">以上为统计性数据展示，仅供参考，不构成投资建议。</view>
  </view>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { getRealtime } from '@/api/modules'
import { useStore } from '@/store'
import { pctClass, pctText, fmtNum, fmtWan } from '@/utils/format'

const store = useStore()
const error = ref('')
const realtime = computed(() => store.state.realtime)
const indices = computed(() => (realtime.value && realtime.value.indices) || [])
const sectors = computed(() => (realtime.value && realtime.value.sectors) || [])
const amountText = computed(() => fmtWan(realtime.value?.breadth?.amount))

async function load() {
  try {
    store.setRealtime(await getRealtime())
  } catch (e) {
    error.value = e.message
  }
}

onMounted(load)
onShow(load)
</script>

<style scoped>
.idx-table { }
.idx-th, .idx-tr { display: flex; padding: 12rpx 0; border-bottom: 1rpx solid var(--line); }
.idx-tr:last-child { border-bottom: none; }
.idx-th { color: var(--muted); font-size: 22rpx; }
.c-name { flex: 1.4; font-size: 26rpx; }
.c-v { flex: 1; text-align: right; font-size: 26rpx; }
.sector-row { display: flex; align-items: center; padding: 14rpx 0; border-bottom: 1rpx solid var(--line); }
.sector-row:last-child { border-bottom: none; }
.sector-name { flex: 1.4; font-size: 27rpx; }
.sector-flow { flex: 1; text-align: right; font-size: 24rpx; margin-right: 16rpx; }
.sector-pct { flex: 1; text-align: right; }
.amount { display: block; font-size: 40rpx; font-weight: 700; margin-top: 8rpx; }
</style>
