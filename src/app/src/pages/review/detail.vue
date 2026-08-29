<template>
  <view class="page">
    <view class="card" v-if="review">
      <view class="rev-head">
        <view>
          <text class="rev-date">{{ date }}</text>
          <view class="rev-mode">
            <text class="pill" :class="mode === 'close' ? '' : 'pill--muted'">{{ mode === 'close' ? '收盘复盘' : '午间快照' }}</text>
          </view>
        </view>
        <view class="temp">
          <text class="temp-num up num">{{ tempScore }}</text>
          <text class="temp-label">市场温度</text>
        </view>
      </view>
      <view class="temp-bar"><view class="temp-fill" :style="{ width: tempScore + '%' }" /></view>
    </view>

    <view class="card md-card" v-if="review">
      <view class="section-title">复盘全文</view>
      <scroll-view scroll-y class="md-scroll">
        <text user-select class="md-text">{{ markdown || '暂无正文' }}</text>
      </scroll-view>
    </view>

    <text v-if="error" class="empty">{{ error }}</text>
    <view v-if="loading" class="loading">加载中…</view>
    <view class="disclaimer">复盘为统计性描述，不代表未来走势，不构成买卖建议。</view>
  </view>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { getReview } from '@/api/modules'

const loading = ref(false)
const error = ref('')
const review = ref(null)
const date = ref('')

const mode = computed(() => (review.value && review.value.meta?.report_mode) || 'snapshot')
const tempScore = computed(() => {
  const s = review.value && review.value.temperature
  const v = typeof s === 'number' ? s : s?.score
  return Number.isFinite(Number(v)) ? Math.round(Number(v)) : '--'
})
const markdown = computed(() => (review.value && review.value.markdown) || '')

async function load(d) {
  loading.value = true
  error.value = ''
  try {
    review.value = await getReview(d)
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

onLoad((options) => {
  const d = (options && options.date) || ''
  date.value = d
  load(d)
})
</script>

<style scoped>
.rev-head { display: flex; justify-content: space-between; align-items: flex-start; }
.rev-date { font-size: 32rpx; font-weight: 700; }
.rev-mode { margin-top: 10rpx; }
.temp { text-align: right; }
.temp-num { font-size: 56rpx; font-weight: 800; line-height: 1; }
.temp-label { display: block; font-size: 22rpx; color: var(--muted); margin-top: 8rpx; }
.temp-bar { height: 14rpx; border-radius: 999rpx; background: var(--line); margin: 28rpx 0; overflow: hidden; }
.temp-fill { height: 100%; background: linear-gradient(90deg, var(--up), var(--brand)); border-radius: 999rpx; }
.md-scroll { max-height: 60vh; }
.md-text { white-space: pre-wrap; font-size: 26rpx; line-height: 1.7; color: var(--ink); word-break: break-word; }
</style>
