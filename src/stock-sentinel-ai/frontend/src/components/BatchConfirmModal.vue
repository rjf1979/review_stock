<template>
    <div v-if="judgmentConfirm.open" class="modal" role="dialog" aria-modal="true" aria-labelledby="batchConfirmTitle" @click.self="closeBatchConfirm">
      <div id="batchConfirmDialog" class="modal-card" style="max-width: 560px;" tabindex="-1" @keydown="handleModalKeydown($event, 'batch')">
        <div class="quote-head" style="grid-template-columns: minmax(0, 1fr) auto; padding: var(--space-4); border-bottom: 1px solid var(--border);">
          <div class="quote-title">
            <h2 id="batchConfirmTitle">批量 AI 研判确认</h2>
            <div class="quote-code">{{ judgmentConfirm.retryOnly ? '只重试失败项' : '候选池全量研判' }}</div>
          </div>
          <button class="close" @click="closeBatchConfirm" aria-label="关闭">×</button>
        </div>
        <div class="modal-body" style="padding: var(--space-4); display: grid; gap: var(--space-4);">
          <div v-if="judgmentConfirm.loading" class="status loading" role="status" aria-live="polite">正在生成研判计划…</div>
          <div v-else-if="judgmentConfirm.error" class="status error" role="status">{{ judgmentConfirm.error }}</div>
          <template v-else>
            <p class="summary">
              本批次：首次研判 {{ judgmentConfirm.categories.first }} 只 · 失败重试 {{ judgmentConfirm.categories.failedRetry }} 只 · 证据更新 {{ judgmentConfirm.categories.evidenceUpdate }} 只；
              预计调用 {{ judgmentConfirm.expectedCalls }} 次。另有无变化 {{ judgmentConfirm.categories.noChange }} 只、未就绪 {{ judgmentConfirm.categories.notReady }} 只将自动跳过。
            </p>
            <p class="summary">费用以你配置的接口计费为准。是否继续？</p>
            <div class="actions">
              <button class="btn" @click="closeBatchConfirm">取消</button>
              <button class="btn primary" :disabled="!judgmentConfirm.expectedCalls || judgmentConfirm.loading" :aria-busy="judgmentConfirm.loading" @click="confirmBatch"><span v-if="judgmentConfirm.loading" class="loading-spinner" aria-hidden="true"></span><span v-else>继续研判</span></button>
            </div>
          </template>
        </div>
      </div>
    </div>
</template>

<script setup>
import { storeToRefs } from 'pinia';
import { useAppStore } from '../stores/app';
const app = useAppStore();
const { judgmentConfirm, status, summary } = storeToRefs(app);
const { closeBatchConfirm, handleModalKeydown, confirmBatch } = app;
</script>
