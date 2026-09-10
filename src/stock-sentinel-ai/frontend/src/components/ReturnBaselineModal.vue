<template>
  <div v-if="returnBaselineEditor.open" class="modal" role="dialog" aria-modal="true" aria-labelledby="returnBaselineDialogTitle" @click.self="closeReturnBaselineEditor">
    <div id="returnBaselineDialog" class="modal-card return-baseline-modal" tabindex="-1" @keydown="handleModalKeydown($event, 'baseline')">
      <div class="quote-head return-baseline-head">
        <div class="quote-title"><h2 id="returnBaselineDialogTitle">{{ isEditing ? '编辑模拟买入价' : '设置模拟买入价' }}</h2><div class="quote-code">{{ returnBaselineEditor.name }} · {{ returnBaselineEditor.code }}</div></div>
        <button class="close" @click="closeReturnBaselineEditor" :disabled="returnBaselineEditor.saving" aria-label="关闭模拟买入价编辑">×</button>
      </div>
      <div class="modal-body return-baseline-body">
        <p class="summary">模拟买入只按日 K 的高低区间判断是否触达；从所选日期起，首次触达才开始计算模拟收益。不记录持仓、数量或金额。</p>
        <div class="field-group"><label for="simulatedBuyPrice">模拟买入价</label><input id="simulatedBuyPrice" v-model="returnBaselineEditor.price" type="number" min="0.0001" step="0.01" inputmode="decimal" :disabled="returnBaselineEditor.saving" /></div>
        <div class="field-group"><label for="monitorStartDate">开始监控日期</label><input id="monitorStartDate" v-model="returnBaselineEditor.monitorStartDate" type="date" :disabled="returnBaselineEditor.saving" /><span class="summary">选择该日后开始检查；若当天非交易日，则从之后首根日 K 开始。</span></div>
        <p v-if="returnBaselineEditor.error" class="summary err" role="status" aria-live="polite">{{ returnBaselineEditor.error }}</p>
        <div class="actions">
          <button class="btn primary" :disabled="returnBaselineEditor.saving" @click="saveCustomReturnBaseline">{{ isEditing ? '更新模拟价' : '保存模拟价' }}</button>
          <button class="btn" :disabled="returnBaselineEditor.saving" @click="closeReturnBaselineEditor">取消</button>
          <button v-if="isEditing" class="btn danger" :disabled="returnBaselineEditor.saving" @click="clearCustomReturnBaseline">清除模拟价，恢复自动基准</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useAppStore } from '../stores/app';
const app = useAppStore();
const { returnBaselineEditor, watchlist } = storeToRefs(app);
const isEditing = computed(() => Boolean((watchlist.value.find((x) => String(x.code) === returnBaselineEditor.code) || {}).customReturnBaseline));
const { closeReturnBaselineEditor, handleModalKeydown, saveCustomReturnBaseline, clearCustomReturnBaseline } = app;
</script>
