<template>
  <view class="page">
    <view class="card" v-if="entries.length">
      <view class="h-row" v-for="e in entries" :key="e.date" @tap="open(e.date)">
        <view class="h-left">
          <text class="h-date">{{ e.date }}</text>
          <text class="h-mode pill" :class="e.reportMode === 'close' ? '' : 'pill--muted'">
            {{ e.reportMode === 'close' ? '收盘' : '午间' }}
          </text>
        </view>
        <view class="h-right">
          <text v-if="e.temperature != null" class="h-temp num">{{ Math.round(e.temperature) }}</text>
          <text class="h-arrow muted">›</text>
        </view>
      </view>
    </view>

    <view v-else-if="!loading" class="empty">暂无历史复盘</view>
    <view v-if="loading" class="loading">加载中…</view>
    <text v-if="error" class="empty">{{ error }}</text>
    <view class="disclaimer">历史复盘仅供回顾，不构成买卖建议。</view>
  </view>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import { getReviews } from '@/api/modules'

const loading = ref(false)
const error = ref('')
const entries = ref([])

async function load() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    const data = await getReviews()
    entries.value = Array.isArray(data.entries) ? data.entries : []
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
    uni.stopPullDownRefresh()
  }
}

function open(date) {
  uni.navigateTo({ url: '/pages/review/detail?date=' + encodeURIComponent(date) })
}

onMounted(load)
onShow(load)
onPullDownRefresh(load)
</script>

<style scoped>
.h-row { display: flex; align-items: center; justify-content: space-between; padding: 22rpx 0; border-bottom: 1rpx solid var(--line); }
.h-row:last-child { border-bottom: none; }
.h-left { display: flex; align-items: center; gap: 16rpx; }
.h-date { font-size: 28rpx; font-weight: 600; }
.h-right { display: flex; align-items: center; gap: 12rpx; }
.h-temp { font-size: 30rpx; font-weight: 700; color: var(--brand); }
.h-arrow { font-size: 34rpx; }
</style>
