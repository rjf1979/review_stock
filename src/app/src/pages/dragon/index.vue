<template>
  <view class="page">
    <view class="card" v-if="list.length">
      <view class="d-th">
        <text class="c-name">个股</text>
        <text class="c-v">涨跌幅</text>
        <text class="c-v">净买入</text>
      </view>
      <view class="d-tr" v-for="d in list" :key="d.code">
        <view class="c-name">
          <text class="d-name">{{ d.name }}</text>
          <text class="d-code muted num">{{ d.code }}</text>
        </view>
        <text class="c-v num" :class="pctClass(d.changePct)">{{ pctText(d.changePct) }}</text>
        <text class="c-v num" :class="pctClass(d.netBuy)">{{ fmtWan(d.netBuy) }}</text>
      </view>
    </view>

    <view class="card" v-if="list.length">
      <view class="section-title">上榜原因</view>
      <view class="reason-row" v-for="d in list.slice(0, 10)" :key="d.code">
        <text class="reason-name">{{ d.name }}</text>
        <text class="reason-body muted">{{ d.reason || '—' }}</text>
      </view>
    </view>

    <text v-if="error" class="empty">{{ error }}</text>
    <view v-if="loading" class="loading">加载中…</view>
    <view class="disclaimer">龙虎榜为交易所公开数据，仅供参考，不构成买卖建议。</view>
  </view>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import { getDragon, getReviews } from '@/api/modules'
import { pctClass, pctText, fmtWan } from '@/utils/format'

const loading = ref(false)
const error = ref('')
const list = ref([])

async function resolveDate() {
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
      data = await getDragon()
    } catch (e) {
      const date = await resolveDate()
      if (!date) throw e
      data = await getDragon(date)
    }
    list.value = Array.isArray(data.list) ? data.list : []
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
    uni.stopPullDownRefresh()
  }
}

onMounted(load)
onShow(load)
onPullDownRefresh(load)
</script>

<style scoped>
.d-th, .d-tr { display: flex; align-items: center; padding: 14rpx 0; border-bottom: 1rpx solid var(--line); }
.d-tr:last-child { border-bottom: none; }
.d-th { color: var(--muted); font-size: 22rpx; }
.c-name { flex: 1.5; }
.c-v { flex: 1; text-align: right; font-size: 27rpx; }
.d-name { display: block; font-weight: 600; font-size: 28rpx; }
.d-code { font-size: 22rpx; }
.reason-row { display: flex; gap: 20rpx; align-items: flex-start; padding: 12rpx 0; border-bottom: 1rpx solid var(--line); }
.reason-row:last-child { border-bottom: none; }
.reason-name { width: 140rpx; font-weight: 600; font-size: 26rpx; flex-shrink: 0; }
.reason-body { flex: 1; font-size: 24rpx; line-height: 1.5; }
</style>
