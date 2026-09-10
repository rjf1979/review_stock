<template>
  <article class="watch-card" :class="{ pinned }" tabindex="0" :aria-label="quote.name + ' 日 K 与盯盘建议'" @click="$emit('open')" @keydown.enter="$emit('open')">
    <header class="watch-card-head">
      <div class="watch-card-title">
        <b>{{ quote.name }}</b>
        <span class="num">{{ quote.code }}</span>
      </div>
      <div class="watch-card-price">
        <strong :class="priceInfo.cls">{{ priceInfo.price }}</strong>
        <strong class="watch-card-pct" :class="priceInfo.cls">{{ priceInfo.pct }}</strong>
      </div>
      <button type="button" class="watch-card-pin" :class="{ active: pinned }" @click.stop="$emit('toggle-pin')" :aria-pressed="pinned" :aria-label="pinned ? '取消置顶 ' + quote.name : '置顶 ' + quote.name" :title="pinned ? '取消置顶' : '置顶'">{{ pinned ? '已置顶' : '置顶' }}</button>
      <button class="watch-card-remove" @click.stop="$emit('remove')" :aria-label="'移除 ' + quote.name">×</button>
    </header>
    <p v-if="entryStatus" class="watch-card-entry-status" :title="entryStatus.title" :aria-label="entryStatus.ariaLabel">{{ entryStatus.text }}</p>
    <p v-if="returnInfo" class="watch-card-return" :class="returnInfo.tone" role="status" :title="returnInfo.baselineText || returnInfo.text">
      <b>{{ returnInfo.text }}</b><span v-if="returnInfo.baselineText">{{ returnInfo.baselineText }}</span>
    </p>
    <div class="watch-card-chart">
      <div v-if="hasChart" ref="chartEl" class="watch-card-chart-inner"></div>
      <div v-if="hasChart && loading" class="watch-card-state">K 线更新中…</div>
      <div v-else-if="!hasChart" class="watch-card-state" :class="{ error: !!error }">{{ loading ? 'K 线加载中…' : (error || '暂无日 K 数据') }}</div>
    </div>
    <p v-if="reason" class="watch-card-reason" :title="reason">{{ reason }}</p>
  </article>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as echarts from 'echarts';
import { useAppStore } from '../stores/app';

const props = defineProps({
  quote: { type: Object, required: true },
  klineState: { type: Object, default: null },
  returnInfo: { type: Object, default: null },
  recommendation: { type: Object, default: null },
  levels: { type: Object, default: null },
  pinned: { type: Boolean, default: false },
});
defineEmits(['open', 'remove', 'toggle-pin']);

const app = useAppStore();
const chartEl = ref(null);
let chart = null;
let resizeHandler = null;

const UP = '#ff4545';
const DOWN = '#20b7c7';
const AXIS = '#9b9b9b';
const BORDER = '#505050';
const GRIDL = '#363636';

const loading = computed(() => !props.klineState || !!props.klineState.loading);
const error = computed(() => (props.klineState && props.klineState.error) || '');
const bars = computed(() => (props.klineState && Array.isArray(props.klineState.bars) ? props.klineState.bars : []));
// 缓存 bar 在后台刷新时仍保留图表宿主，避免 ECharts 绑定到已销毁的 DOM。
const hasChart = computed(() => bars.value.length > 0);
const reason = computed(() => (props.recommendation ? app.recommendationReason(props.quote) : ''));
  // 价位文字：建仓（首个触发确认价）/ 止损（失效价）/ 止盈（首个止盈观察价）
  const entryTriggers = computed(() => {
    const lv = props.levels;
    if (!lv || lv.available === false) return [];
    const seen = new Set();
    return (lv.entryTriggers || []).map((trigger) => {
      const value = Number(trigger && (trigger.confirmAbove || (trigger.zone && trigger.zone.high) || trigger.value || trigger.price));
      return { value, type: trigger && trigger.type, status: trigger && trigger.status };
    }).filter((trigger) => Number.isFinite(trigger.value) && trigger.value > 0 && !seen.has(trigger.value) && (seen.add(trigger.value) || true));
  });
  // 价格与涨幅以本地 K 线库尾 bar 为准（与图表同源同值）；K 线不足两根时回退实时报价。
  const currentPrice = computed(() => {
    const last = bars.value[bars.value.length - 1];
    const local = Number(last && last.close);
    const quote = Number(props.quote.price);
    return Number.isFinite(local) && local > 0 ? local : (Number.isFinite(quote) && quote > 0 ? quote : null);
  });
  const priceInfo = computed(() => {
    const bs = bars.value;
    const qPrice = currentPrice.value;
    const qPct = props.quote.changePct;
    if (bs.length < 2) {
      return { price: app.fmtPrice(qPrice), pct: qPct == null ? '—' : (qPct >= 0 ? '+' : '') + app.fmtNum(qPct) + '%', cls: qPct == null ? '' : (qPct >= 0 ? 'pos' : 'neg') };
    }
    const last = bs[bs.length - 1];
    const prev = bs[bs.length - 2];
    const pct = prev.close > 0 ? ((last.close - prev.close) / prev.close) * 100 : null;
    return { price: app.fmtPrice(last.close), pct: pct == null ? '—' : (pct >= 0 ? '+' : '') + app.fmtNum(pct) + '%', cls: pct == null ? '' : (pct >= 0 ? 'pos' : 'neg') };
  });
  const entryStatus = computed(() => {
    const price = currentPrice.value;
    const triggers = entryTriggers.value;
    if (!triggers.length) return null;
    if (!Number.isFinite(price)) return { text: triggers.map((item) => `建仓 ${app.fmtPrice(item.value)}`).join(' / '), title: '建仓价位：' + triggers.map((item) => app.fmtPrice(item.value)).join('、'), ariaLabel: '建仓价位：' + triggers.map((item) => app.fmtPrice(item.value)).join('、') };
    const details = triggers.map((trigger, index) => {
      const gap = trigger.value - price;
      const pct = gap > 0 ? (gap / price) * 100 : 0;
      const reached = trigger.status === 'achieved' || trigger.status === 'confirmed' || gap <= 0;
      const label = trigger.type === 'breakout' ? '突破' : '首次';
      return { ...trigger, index, reached, gap, pct, label };
    });
    const text = details.map((item) => item.reached
      ? `建仓 ${app.fmtPrice(item.value)}`
      : `建仓 ${app.fmtPrice(item.value)} · 距 ${app.fmtPrice(item.gap)}（${app.fmtNum(item.pct)}%）`).join(' / ');
    const title = details.map((item) => item.reached
      ? `${item.label}建仓 ${app.fmtPrice(item.value)}：已达成`
      : `${item.label}建仓 ${app.fmtPrice(item.value)}：距 ${app.fmtPrice(item.gap)}（${app.fmtNum(item.pct)}%）`).join('；');
    return { text, title, ariaLabel: `建仓状态：${title}` };
  });
// 头部以涨跌幅为视觉主色：红涨青跌，价格与涨幅同色；无涨跌幅数据时中性灰。
const pctClass = computed(() => (props.quote.changePct == null ? '' : (props.quote.changePct >= 0 ? 'pos' : 'neg')));
const pctText = computed(() => (props.quote.changePct == null ? '—' : (props.quote.changePct >= 0 ? '+' : '') + app.fmtNum(props.quote.changePct) + '%'));

function maLine(list, n) {
  const out = []; let sum = 0;
  for (let i = 0; i < list.length; i++) { sum += list[i].close; if (i >= n) sum -= list[i - n].close; out.push(i >= n - 1 ? +(sum / n).toFixed(2) : null); }
  return out;
}

function render() {
  if (!chart || !hasChart.value) return;
  const list = bars.value;
  // 迷你图固定展示最近 60 根：不接滚轮缩放（缩放只在个股详情弹框里），
  // MA 先按完整历史计算再截窗，保证窗口边缘的均线数值准确。
  const view = list.slice(-60);
  const dates = view.map((k) => k.date);
  const maWindow = (n) => maLine(list, n).slice(-view.length);
  const ma5 = maWindow(5), ma10 = maWindow(10), ma20 = maWindow(20);
  const volData = view.map((k) => ({ value: k.volume, itemStyle: { color: k.close >= k.open ? UP : DOWN } }));
  const ln = (c) => ({ color: c, width: 1, opacity: 0.9 });
  chart.setOption({
    backgroundColor: 'transparent',
    animation: false,
    grid: [{ left: 6, right: 6, top: 8, height: '62%' }, { left: 6, right: 6, top: '76%', height: '18%' }],
    xAxis: [
      { type: 'category', data: dates, boundaryGap: false, axisLine: { lineStyle: { color: BORDER } }, axisLabel: { show: false }, axisTick: { show: false } },
      { type: 'category', gridIndex: 1, data: dates, boundaryGap: false, axisLine: { lineStyle: { color: BORDER } }, axisLabel: { show: false }, axisTick: { show: false } },
    ],
    yAxis: [
      { scale: true, splitLine: { lineStyle: { color: GRIDL } }, axisLabel: { show: false }, axisTick: { show: false } },
      { gridIndex: 1, splitLine: { show: false }, axisLabel: { show: false }, axisTick: { show: false } },
    ],
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'cross', label: { backgroundColor: '#2a313d' } },
      backgroundColor: 'rgba(20,22,28,0.96)', borderColor: BORDER, textStyle: { color: '#e6e8eb', fontSize: 12 },
      formatter: (params) => {
        const idx = params[0] && params[0].dataIndex;
        const item = view[idx];
        if (!item) return '';
        const chg = item.open ? ((item.close - item.open) / item.open) * 100 : 0;
        return `${item.date}<br/>开 ${app.fmtPrice(item.open)}　高 ${app.fmtPrice(item.high)}　低 ${app.fmtPrice(item.low)}　收 <b>${app.fmtPrice(item.close)}</b><br/>涨幅 <b style="color:${chg >= 0 ? UP : DOWN}">${app.fmtPct(chg)}</b>`;
      },
    },
    series: [
      {
        type: 'candlestick', data: view.map((k) => [k.open, k.close, k.low, k.high]), itemStyle: { color: UP, color0: DOWN, borderColor: UP, borderColor0: DOWN },
      },
      { type: 'line', name: 'MA5', data: ma5, smooth: true, symbol: 'none', connectNulls: false, lineStyle: ln('#f7d451') },
      { type: 'line', name: 'MA10', data: ma10, smooth: true, symbol: 'none', connectNulls: false, lineStyle: ln('#ff8ab0') },
      { type: 'line', name: 'MA20', data: ma20, smooth: true, symbol: 'none', connectNulls: false, lineStyle: ln('#66d9ff') },
      { type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: volData, barWidth: '62%' },
    ],
  });
}

onMounted(() => {
  resizeHandler = () => chart && chart.resize();
  window.addEventListener('resize', resizeHandler, { passive: true });
});

function disposeChart() {
  if (chart) { chart.dispose(); chart = null; }
}

watch(hasChart, async (v) => {
  if (!v) { disposeChart(); return; }
  await nextTick();
  if (!chartEl.value) return;
  if (chart && chart.getDom() !== chartEl.value) disposeChart();
  if (!chart) chart = echarts.init(chartEl.value);
  render();
  chart.resize();
}, { immediate: true });

watch(() => props.klineState, () => { if (chart) render(); }, { deep: true });
onBeforeUnmount(() => {
  if (resizeHandler) window.removeEventListener('resize', resizeHandler);
  disposeChart();
});
</script>
