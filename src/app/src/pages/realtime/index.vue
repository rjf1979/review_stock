<template>
  <view class="page">
    <!-- 指数条 -->
    <scroll-view scroll-x class="idx-strip" :show-scrollbar="false">
      <view
        v-for="idx in indices"
        :key="idx.code"
        class="idx-item"
        :class="pctClass(idx.changePct)"
      >
        <text class="idx-name">{{ idx.name }}</text>
        <text class="idx-val num">{{ fmtNum(idx.price, 2) }}</text>
        <text class="idx-pct num">{{ pctText(idx.changePct) }}</text>
      </view>
    </scroll-view>

    <!-- 全市场宽度 -->
    <view class="card">
      <view class="section-title">全市场</view>
      <view class="breadth">
        <view class="b-cell">
          <text class="b-num up num">{{ breadth.up ?? '--' }}</text>
          <text class="b-label">上涨</text>
        </view>
        <view class="b-cell">
          <text class="b-num down num">{{ breadth.down ?? '--' }}</text>
          <text class="b-label">下跌</text>
        </view>
        <view class="b-cell">
          <text class="b-num up num">{{ breadth.limitUp ?? '--' }}</text>
          <text class="b-label">涨停</text>
        </view>
        <view class="b-cell">
          <text class="b-num down num">{{ breadth.limitDown ?? '--' }}</text>
          <text class="b-label">跌停</text>
        </view>
        <view class="b-cell">
          <text class="b-num num">{{ fmtWan(breadth.amount) }}</text>
          <text class="b-label">成交额</text>
        </view>
      </view>
    </view>

    <!-- 涨停池 -->
    <view class="card" v-if="limitUpStocks && limitUpStocks.length">
      <view class="section-title">涨停梯队</view>
      <view class="ladder">
        <view class="ladder-row" v-for="s in limitUpStocks" :key="s.code">
          <text class="ladder-name">{{ s.name }}</text>
          <text class="ladder-streak pill">{{ (s.streak || 1) + '板' }}</text>
          <text class="ladder-pct up num">{{ pctText(s.changePct) }}</text>
        </view>
      </view>
    </view>

    <!-- 板块 / 概念切换 -->
    <view class="card" v-if="sectors && sectors.length">
      <view class="section-title">领涨板块</view>
      <view class="rank-list">
        <view class="rank-row" v-for="s in sectors.slice(0, 6)" :key="s.name">
          <text class="rank-name">{{ s.name }}</text>
          <text class="muted num">{{ fmtWan(s.mainNet) }}</text>
          <text class="pct up num">{{ pctText(s.changePct) }}</text>
        </view>
      </view>
    </view>

    <!-- 盘口异动 -->
    <view class="card" v-if="pankou && pankou.length">
      <view class="section-title">盘口异动</view>
      <view class="pankou">
        <view class="pk-row" v-for="(e, i) in pankou.slice(0, 8)" :key="i">
          <text class="pk-time muted num">{{ fmtTime(e.time || e.t) }}</text>
          <text class="pk-text">{{ e.name || e.code }} {{ e.title || e.event || '' }}</text>
        </view>
      </view>
    </view>

    <view class="quick-links">
      <view class="quick-btn" @tap="go('/pages/overview/index')">大盘概况</view>
      <view class="quick-btn" @tap="go('/pages/dragon/index')">龙虎榜</view>
    </view>

    <view class="disclaimer">数据来自公开行情源，仅供参考，不构成投资建议。红涨绿跌。</view>
    <view class="loading" v-if="loading">加载中…</view>
  </view>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { onShow, onHide, onPullDownRefresh } from '@dcloudio/uni-app'
import { getRealtime } from '@/api/modules'
import { useStore } from '@/store'
import { pctClass, pctText, fmtNum, fmtWan, fmtTime } from '@/utils/format'

const store = useStore()
const loading = ref(false)
const error = ref('')
let timer = null

const realtime = computed(() => store.state.realtime)
const indices = computed(() => (realtime.value && realtime.value.indices) || [])
const breadth = computed(() => (realtime.value && realtime.value.breadth) || {})
const limitUpStocks = computed(() => (realtime.value && realtime.value.limitUpStocks) || [])
const sectors = computed(() => (realtime.value && realtime.value.sectors) || [])
const pankou = computed(() => (realtime.value && realtime.value.pankou) || [])

async function load() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    const data = await getRealtime()
    store.setRealtime(data)
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

function startTimer() {
  stopTimer()
  timer = setInterval(load, 30000)
}
function stopTimer() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

onMounted(() => {
  load()
  startTimer()
})
onShow(load)
onHide(stopTimer)
onUnmounted(stopTimer)
onPullDownRefresh(load)
</script>

<style scoped>
.page { padding-bottom: 40rpx; }
.idx-strip { white-space: nowrap; background: var(--surface); padding: 20rpx 24rpx; border-bottom: 1rpx solid var(--line); }
.idx-item { display: inline-flex; flex-direction: column; gap: 2rpx; margin-right: 36rpx; }
.idx-name { font-size: 24rpx; color: var(--muted); }
.idx-val { font-size: 32rpx; font-weight: 700; }
.idx-pct { font-size: 24rpx; }
.breadth { display: flex; flex-wrap: wrap; gap: 24rpx 0; }
.b-cell { width: 33.3%; text-align: center; }
.b-num { font-size: 34rpx; font-weight: 700; }
.b-label { display: block; font-size: 22rpx; color: var(--muted); margin-top: 4rpx; }
.ladder-row, .rank-row, .pk-row { display: flex; align-items: center; justify-content: space-between; padding: 14rpx 0; border-bottom: 1rpx solid var(--line); }
.ladder-row:last-child, .rank-row:last-child, .pk-row:last-child { border-bottom: none; }
.ladder-name { font-size: 27rpx; }
.ladder-streak { margin-left: auto; margin-right: 20rpx; }
.ladder-pct { min-width: 96rpx; text-align: right; }
.rank-name { font-size: 27rpx; flex: 1; }
.rank-row .muted { min-width: 120rpx; text-align: right; margin: 0 16rpx; }
.rank-row .pct { min-width: 96rpx; text-align: right; }
.pk-time { min-width: 80rpx; }
.pk-text { font-size: 26rpx; }
.quick-links { display: flex; gap: 20rpx; padding: 10rpx 24rpx; }
.quick-btn { flex: 1; text-align: center; padding: 20rpx; background: var(--surface); border-radius: var(--radius); color: var(--ink); font-weight: 600; }
</style>
