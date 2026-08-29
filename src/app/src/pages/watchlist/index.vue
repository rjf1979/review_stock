<template>
  <view class="page">
    <view class="add-bar">
      <input
        v-model="codeInput"
        class="add-input"
        placeholder="输入代码，如 sh600519 / 600519"
        placeholder-class="ph"
        @confirm="onAdd"
      />
      <button class="add-btn" size="mini" @tap="onAdd">添加</button>
    </view>

    <view class="card" v-if="quotes.length">
      <view class="w-row" v-for="q in quotes" :key="q.code" @tap="openKline(q.code)">
        <view class="w-left">
          <text class="w-name">{{ q.name }}</text>
          <text class="w-code muted num">{{ q.code }}</text>
        </view>
        <view class="w-mid">
          <text class="w-price num" :class="pctClass(q.changePct)">{{ fmtNum(q.price, 2) }}</text>
          <text class="w-pct num" :class="pctClass(q.changePct)">{{ pctText(q.changePct) }}</text>
        </view>
        <view class="w-del" @tap.stop="remove(q.code)">✕</view>
      </view>
      <view class="empty" v-if="quotes.length===0">没有可展示的报价</view>
    </view>

    <view v-else class="empty">暂无自选，输入代码添加</view>

    <text v-if="error" class="empty">{{ error }}</text>
    <view v-if="loading" class="loading">加载中…</view>
    <view class="disclaimer">自选保存在本机；报价来自公开行情源，仅供参考。</view>
  </view>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { getStocks } from '@/api/modules'
import { useStore } from '@/store'
import { pctClass, pctText, fmtNum } from '@/utils/format'

const store = useStore()
const codeInput = ref('')
const quotes = ref([])
const loading = ref(false)
const error = ref('')

const watchlist = computed(() => store.state.watchlist)

function normalizeCode(raw) {
  let c = String(raw || '').trim().toLowerCase()
  if (!c) return null
  // 兼容 600519 / sh600519
  if (/^(sh|sz|bj)\d{6}$/.test(c)) return c
  if (/^\d{6}$/.test(c)) {
    if (c.startsWith('6')) return 'sh' + c
    if (c.startsWith('8') || c.startsWith('4')) return 'bj' + c
    return 'sz' + c
  }
  return null
}

async function loadQuotes() {
  const list = watchlist.value
  if (!list.length) {
    quotes.value = []
    return
  }
  loading.value = true
  error.value = ''
  try {
    const data = await getStocks(list.join(','))
    quotes.value = Array.isArray(data.stocks) ? data.stocks : []
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function onAdd() {
  const code = normalizeCode(codeInput.value)
  if (!code) {
    uni.showToast({ title: '代码不合法', icon: 'none' })
    return
  }
  const list = watchlist.value
  if (!list.includes(code)) {
    store.setWatchlist([...list, code])
    loadQuotes()
  }
  codeInput.value = ''
}

function remove(code) {
  store.setWatchlist(watchlist.value.filter((c) => c !== code))
  loadQuotes()
}

function openKline(code) {
  uni.navigateTo({ url: '/pages/kline/index?code=' + encodeURIComponent(code) })
}

onMounted(loadQuotes)
onShow(loadQuotes)
</script>

<style scoped>
.add-bar { display: flex; gap: 16rpx; padding: 20rpx 24rpx; align-items: center; }
.add-input { flex: 1; background: var(--surface); border-radius: 12rpx; padding: 18rpx 22rpx; font-size: 26rpx; border: 1rpx solid var(--line); }
.ph { color: var(--muted); }
.add-btn { background: var(--brand); color: #fff; }
.w-row { display: flex; align-items: center; padding: 18rpx 0; border-bottom: 1rpx solid var(--line); }
.w-row:last-child { border-bottom: none; }
.w-left { flex: 1; }
.w-name { display: block; font-size: 28rpx; font-weight: 600; }
.w-code { font-size: 22rpx; }
.w-mid { display: flex; align-items: baseline; gap: 16rpx; }
.w-price { font-size: 30rpx; font-weight: 700; }
.w-pct { font-size: 24rpx; min-width: 110rpx; text-align: right; }
.w-del { padding: 0 8rpx 0 20rpx; color: var(--muted); font-size: 28rpx; }
</style>
