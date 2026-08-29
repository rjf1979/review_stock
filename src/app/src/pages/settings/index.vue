<template>
  <view class="page">
    <view class="card">
      <view class="section-title">数据 API</view>
      <view class="field">
        <text class="field-label">接口地址</text>
        <input v-model="apiBase" class="field-input" placeholder="https://mapi.zhicha.io" @blur="onSaveBase" />
        <text class="field-hint muted">保存后重启页面生效；数据由 PC 端采集上传</text>
      </view>
    </view>

    <view class="card">
      <view class="section-title">服务状态</view>
      <view class="status-row">
        <text class="muted">最近采集</text>
        <text class="num">{{ statusText }}</text>
      </view>
      <view class="status-row">
        <text class="muted">数据版本</text>
        <text class="num">{{ status?.version || '--' }}</text>
      </view>
      <view class="status-row">
        <text class="muted">服务器时间</text>
        <text class="num">{{ formatTime(status?.serverTime) }}</text>
      </view>
      <view class="link-row">
        <text class="link" @tap="probe">重新探测</text>
      </view>
    </view>

    <view class="card">
      <view class="section-title">关于</view>
      <view class="status-row"><text class="muted">App 版本</text><text class="num">0.1.0</text></view>
      <view class="status-row"><text class="muted">框架</text><text class="num">uni-app · Vue3</text></view>
    </view>

    <view class="disclaimer">
      数据来自公开行情源，仅供参考，不构成任何投资建议。
      「市场温度」「情绪指标」均为统计性描述，不代表未来走势。股市有风险，投资需谨慎。
    </view>
  </view>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { getApiBase, setApiBase } from '@/api/config'
import { getStatus } from '@/api/modules'
import { fmtTime } from '@/utils/format'

const apiBase = ref(getApiBase())
const status = ref(null)

const statusText = computed(() => fmtTime(status.value?.latestFetchAt) || '--')
const formatTime = (v) => fmtTime(v)

function onSaveBase() {
  const url = String(apiBase.value || '').trim()
  setApiBase(url)
  uni.showToast({ title: '已保存', icon: 'none' })
}

async function probe() {
  try {
    status.value = await getStatus()
    uni.showToast({ title: '连接正常', icon: 'success' })
  } catch (e) {
    uni.showToast({ title: e.message, icon: 'none' })
  }
}

onMounted(probe)
</script>

<style scoped>
.field { margin-top: 8rpx; }
.field-label { font-size: 26rpx; color: var(--muted); display: block; margin-bottom: 12rpx; }
.field-input { background: var(--bg); border: 1rpx solid var(--line); border-radius: 12rpx; padding: 18rpx 20rpx; font-size: 26rpx; }
.field-hint { display: block; margin-top: 10rpx; font-size: 22rpx; }
.status-row { display: flex; justify-content: space-between; padding: 14rpx 0; border-bottom: 1rpx solid var(--line); font-size: 26rpx; }
.status-row:last-child { border-bottom: none; }
.link-row { margin-top: 20rpx; }
.link { color: var(--brand); font-size: 24rpx; }
</style>
