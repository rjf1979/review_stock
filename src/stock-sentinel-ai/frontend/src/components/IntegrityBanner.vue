<template>
    <!-- ══════════ 数据完整性提示（全局） ══════════ -->
    <div v-if="integrity.needsData" class="integrity-banner" role="status" aria-live="polite">
      <div class="integrity-text">
        <strong>{{ integrity.firstRun ? '首次运行，数据尚未就绪' : '本地数据不完整' }}</strong>
        <span>（{{ integrity.missing.length }} 项）：<template v-for="m in integrity.missing" :key="m.key">{{ m.text }}；</template></span>
      </div>
      <button type="button" class="btn mini" @click="goPrefetch">前往设置预取数据</button>
    </div>
</template>

<script setup>
import { storeToRefs } from 'pinia';
import { useAppStore } from '../stores/app';
const app = useAppStore();
const { integrity, status } = storeToRefs(app);
const { goPrefetch } = app;
</script>
