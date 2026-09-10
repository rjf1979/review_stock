<template>
    <div v-if="!appReady" class="startup-overlay" role="status" aria-live="polite"><div class="startup-card"><strong>正在启动本地服务</strong><span>{{ startupMessage }}</span></div></div>
    <a class="skip-link" href="#main">跳到主要内容</a>

    <TopBar />

    <IntegrityBanner />

    <main id="main" tabindex="-1">

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
import { onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useAppStore } from './stores/app';
import TopBar from './components/TopBar.vue';
import IntegrityBanner from './components/IntegrityBanner.vue';
import ScanSection from './components/ScanSection.vue';
import MonitorSection from './components/MonitorSection.vue';
import PoolSection from './components/PoolSection.vue';
import SettingsSection from './components/SettingsSection.vue';
import DetailModal from './components/DetailModal.vue';
import BatchConfirmModal from './components/BatchConfirmModal.vue';
import RuleEditorModal from './components/RuleEditorModal.vue';
import ReturnBaselineModal from './components/ReturnBaselineModal.vue';
const app = useAppStore();
const { appReady, startupMessage } = storeToRefs(app);
onMounted(() => { app.bootstrap(); });
</script>
