<template>
  <section v-if="hasThemes" class="market-theme-strip" aria-label="当日市场扫描题材">
    <div class="market-theme-strip-head">
      <strong>{{ title }}</strong>
      <span>{{ scanContext.snapshotDate || '—' }}</span>
    </div>
    <div v-if="industries.length" class="market-theme-strip-row">
      <b>行业</b>
      <span class="market-theme-list">
        <span v-for="theme in industries" :key="theme.code || theme.name" class="market-theme-item">
          <span>{{ theme.name }}</span>
          <em :class="pctClass(theme.changePct)">{{ fmtPct(theme.changePct) }}</em>
        </span>
      </span>
    </div>
    <div v-if="concepts.length" class="market-theme-strip-row">
      <b>概念</b>
      <span class="market-theme-list">
        <span v-for="theme in concepts" :key="theme.code || theme.name" class="market-theme-item">
          <span>{{ theme.name }}</span>
          <em :class="pctClass(theme.changePct)">{{ fmtPct(theme.changePct) }}</em>
        </span>
      </span>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useAppStore } from '../stores/app';

const app = useAppStore();
const { scanContext } = storeToRefs(app);
const sortByRank = (themes) => [...themes].sort((a, b) => (Number(a.rank) || Number.MAX_SAFE_INTEGER) - (Number(b.rank) || Number.MAX_SAFE_INTEGER));
const industries = computed(() => sortByRank(Array.isArray(scanContext.value?.focusThemes) ? scanContext.value.focusThemes : []));
const concepts = computed(() => sortByRank(Array.isArray(scanContext.value?.focusConcepts) ? scanContext.value.focusConcepts : []));
const hasThemes = computed(() => industries.value.length || concepts.value.length);
const title = computed(() => {
  if (!scanContext.value?.validity?.scanEligible) return '最近扫描题材';
  return scanContext.value?.snapshotDate === scanContext.value?.validity?.currentDate ? '当日扫描题材' : '最近收盘题材';
});
const fmtPct = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? `${number >= 0 ? '+' : ''}${number.toFixed(2)}%` : '—';
};
const pctClass = (value) => Number(value) >= 0 ? 'pos' : 'neg';
</script>
