<template>
  <view class="page">
    <view class="card" v-if="item">
      <view class="kl-head">
        <text class="kl-name">{{ item.code }}</text>
        <text class="pill muted">{{ item.tradeDate }}</text>
      </view>
      <view class="kl-canvas-wrap">
        <canvas canvas-id="kl" id="kl" class="kl-canvas" />
      </view>
      <view class="kl-meta muted num">
        最新 {{ lastClose }} · 区间最高 {{ rangeHigh }} / 最低 {{ rangeLow }}
      </view>
    </view>

    <text v-if="error" class="empty">{{ error }}</text>
    <view v-if="loading" class="loading">加载中…</view>
  </view>
</template>

<script setup>
import { ref, computed, getCurrentInstance, nextTick } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { getKline } from '@/api/modules'

const instance = getCurrentInstance()
const loading = ref(false)
const error = ref('')
const item = ref(null)
const canvasId = 'kl'

const kline = computed(() => (item.value && item.value.kline) || [])
const lastClose = computed(() => {
  const k = kline.value
  return k.length ? k[k.length - 1].close : '--'
})
const rangeHigh = computed(() => {
  const k = kline.value
  return k.length ? Math.max(...k.map((x) => x.high ?? x.close)) : '--'
})
const rangeLow = computed(() => {
  const k = kline.value
  return k.length ? Math.min(...k.map((x) => x.low ?? x.close)) : '--'
})

function draw() {
  const ctx = uni.createCanvasContext(canvasId, instance?.proxy)
  const data = kline.value.map((x) => Number(x.close)).filter((n) => Number.isFinite(n))
  if (!data.length) return
  const width = 340
  const height = 200
  const pad = 24
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const stepX = (width - pad * 2) / (data.length - 1 || 1)
  const pts = data.map((v, i) => [pad + i * stepX, height - pad - ((v - min) / span) * (height - pad * 2)])
  ctx.clearRect(0, 0, width, height)
  ctx.setStrokeStyle('#e4e1da')
  ctx.setLineWidth(1)
  for (let i = 0; i < 4; i++) {
    ctx.beginPath()
    ctx.moveTo(pad, (height - pad * 2) / 3 * i + pad)
    ctx.lineTo(width - pad, (height - pad * 2) / 3 * i + pad)
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.setStrokeStyle('#d23a2f')
  ctx.setLineWidth(2)
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])))
  ctx.stroke()
  ctx.setFillStyle('#6b6a66')
  ctx.setFontSize(10)
  ctx.fillText(String(min), pad, height - pad + 12)
  ctx.fillText(String(max), pad, pad - 8)
  ctx.draw()
}

async function load(code) {
  loading.value = true
  error.value = ''
  try {
    item.value = await getKline(code)
    await nextTick()
    setTimeout(draw, 60)
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

onLoad((options) => {
  load((options && options.code) || '')
})
</script>

<style scoped>
.kl-head { display: flex; align-items: center; gap: 16rpx; margin-bottom: 20rpx; }
.kl-name { font-size: 30rpx; font-weight: 700; }
.kl-canvas-wrap { width: 340px; height: 200px; }
.kl-canvas { width: 100%; height: 100%; }
.kl-meta { margin-top: 16rpx; font-size: 24rpx; }
</style>
