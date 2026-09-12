<template>
    <div v-if="!appReady" class="startup-overlay" role="status" aria-live="polite"><div class="startup-card"><strong>正在启动本地服务</strong><span>{{ startupMessage }}</span></div></div>
    <a class="skip-link" href="#main">跳到主要内容</a>

    <TopBar />

    <IntegrityBanner />

    <main id="main" tabindex="-1">

    <MarketThemeStrip v-if="mode !== 'settings'" />

    <ScanSection />

    <MonitorSection />

    <PoolSection />

    <SettingsSection />

    </main>

    <DetailModal />

    <BatchConfirmModal />

    <RuleEditorModal />

    <ReturnBaselineModal />
</template>

<script setup>
import { computed, onMounted, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useAppStore } from './stores/app';
import TopBar from './components/TopBar.vue';
import IntegrityBanner from './components/IntegrityBanner.vue';
import MarketThemeStrip from './components/MarketThemeStrip.vue';
import ScanSection from './components/ScanSection.vue';
import MonitorSection from './components/MonitorSection.vue';
import PoolSection from './components/PoolSection.vue';
import SettingsSection from './components/SettingsSection.vue';
import DetailModal from './components/DetailModal.vue';
import BatchConfirmModal from './components/BatchConfirmModal.vue';
import RuleEditorModal from './components/RuleEditorModal.vue';
import ReturnBaselineModal from './components/ReturnBaselineModal.vue';
const app = useAppStore();
const { appReady, startupMessage, mode } = storeToRefs(app);
// 任一弹窗打开时锁定页面级滚动，消除最外层竖向滚轴。
// 上锁前先量出滚动条宽度并补成 body 右内边距，页面内容不会横向跳动。
const anyModalOpen = computed(() => Boolean(
  app.detail.open || app.judgmentConfirm.open || app.ruleEditor.open || app.returnBaselineEditor.open,
));
watch(anyModalOpen, (open) => {
  const root = document.documentElement;
  if (open) {
    const scrollbarWidth = Math.max(0, window.innerWidth - root.clientWidth);
    root.style.setProperty('--scrollbar-w', scrollbarWidth + 'px');
  }
  root.classList.toggle('modal-open', open);
});
onMounted(() => { app.bootstrap(); });
</script>
