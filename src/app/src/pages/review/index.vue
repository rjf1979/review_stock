<template>
  <view class="page">
    <view class="card" v-if="review">
      <view class="rev-head">
        <view>
          <text class="rev-date">{{ dateText }}</text>
          <view class="rev-mode">
            <text class="pill" :class="mode === 'close' ? '' : 'pill--muted'">{{ mode === 'close' ? '收盘复盘' : '午间快照' }}</text>
          </view>
        </view>
        <view class="temp">
          <text class="temp-num up num">{{ tempScore }}</text>
          <text class="temp-label">市场温度</text>
        </view>
      </view>

      <view class="temp-bar">
        <view class="temp-fill" :style="{ width: tempScore + '%' }" />
      </view>

      <view class="kv-grid" v-if="summary">
        <view class="kv" v-if="summary.up != null"><text class="kv-v up num">{{ summary.up }}</text><text class="kv-k">上涨</text></view>
        <view class="kv" v-if="summary.down != null"><text class="kv-v down num">{{ summary.down }}</text><text class="kv-k">下跌</text></view>
        <view class="kv" v-if="summary.limitUp != null"><text class="kv-v up num">{{ summary.limitUp }}</text><text class="kv-k">涨停</text></view>
        <view class="kv" v-if="summary.limitDown != null"><text class="kv-v down num">{{ summary.limitDown }}</text><text class="kv-k">跌停</text></view>
      </view>

      <view class="link-row">
        <text class="link" @tap="go('/pages/history/index')">查看历史报告 ›</text>
      </view>
    </view>

    <!-- 报告全文 -->
    <view class="card md-card" v-if="review">
      <view class="section-title">复盘正文</view>
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
import { onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import { getReview, getReviews } from '@/api/modules'
import { useStore } from '@/store'
import { fmtDate } from '@/utils/format'

const store = useStore()
const loading = ref(false)
const error = ref('')
const review = ref(null)

const dateText = computed(() => {
  const d = (review.value && (review.value.date || review.value.meta?.trade_date)) || ''
  return d || '--'
})
const mode = computed(() => (review.value && review.value.meta?.report_mode) || 'snapshot')
const tempScore = computed(() => {
  const s = review.value && review.value.temperature
  let v = typeof s === 'number' ? s : s?.score
  return Number.isFinite(Number(v)) ? Math.round(Number(v)) : '--'
})
const markdown = computed(() => (review.value && review.value.markdown) || '')
const summary = computed(() => {
  const p = review.value && review.value.payload
  if (!p) return {}
  const payload = p.payload || p
  return {
    up: payload.breadth?.up,
    down: payload.breadth?.down,
    limitUp: payload.breadth?.limitUp ?? payload.limitUpCount,
    limitDown: payload.breadth?.limitDown ?? payload.limitDownCount
  }
})

async function resolveLatestDate() {
  try {
    const data = await getReviews()
    const entries = data.entries || []
    return entries.length ? entries[0].date : null
  } catch (e) {
    return null
  }
}

async function load() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    let data
    try {
      data = await getReview()
    } catch (e) {
      const date = await resolveLatestDate()
      if (!date) throw e
      data = await getReview(date)
    }
    review.value = data
    store.cacheReview(dateText.value, data)
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
    uni.stopPullDownRefresh()
  }
}

function go(url) {
  uni.navigateTo({ url })
}

onMounted(load)
onShow(load)
onPullDownRefresh(load)
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
.kv-grid { display: flex; gap: 16rpx; margin-top: 10rpx; }
.kv { flex: 1; text-align: center; background: rgba(210,58,47,0.06); border-radius: 12rpx; padding: 16rpx 0; }
.kv-v { font-size: 34rpx; font-weight: 700; display: block; }
.kv-k { font-size: 22rpx; color: var(--muted); }
.link-row { margin-top: 24rpx; }
.link { color: var(--brand); font-size: 24rpx; }
.md-card {}
.md-scroll { max-height: 50vh; }
.md-text { white-space: pre-wrap; font-size: 26rpx; line-height: 1.7; color: var(--ink); word-break: break-word; }
</style>
