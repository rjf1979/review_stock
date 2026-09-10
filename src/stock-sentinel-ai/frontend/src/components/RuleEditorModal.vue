<template>
    <div v-if="ruleEditor.open" class="modal" role="dialog" aria-modal="true" aria-labelledby="ruleDialogTitle" @click.self="closeRuleEditor">
      <div id="ruleDialog" class="modal-card" tabindex="-1" @keydown="handleModalKeydown($event, 'rule')">
        <div class="quote-head" style="grid-template-columns: minmax(0, 1fr) auto; padding: var(--space-4); border-bottom: 1px solid var(--border);">
          <div class="quote-title">
            <h2 id="ruleDialogTitle">编辑规则</h2>
            <div class="quote-code">{{ ruleEditor.draft ? ruleEditor.draft.id : '' }}</div>
          </div>
          <button class="close" @click="closeRuleEditor" aria-label="关闭">×</button>
        </div>
        <div class="modal-body" style="padding: var(--space-4); display: grid; gap: var(--space-4);">
          <template v-if="ruleEditor.draft">
            <div class="field-group">
              <label for="ruleLabel">规则名称</label>
              <input id="ruleLabel" v-model="ruleEditor.draft.label" />
            </div>
            <div class="field-group">
              <label>类型</label>
              <select v-model="ruleEditor.draft.kind">
                <option value="kline">形态规则（需历史 K 线）</option>
                <option value="scan">快照阈值规则（参与全市扫描预筛）</option>
              </select>
            </div>
            <template v-if="ruleEditor.draft.kind === 'kline'">
              <div class="field-group">
                <label for="rulePattern">形态（patternId）</label>
                <select id="rulePattern" v-model="ruleEditor.draft.patternId">
                  <option v-for="p in patternOptions" :key="p" :value="p">{{ p }}</option>
                </select>
              </div>
              <div class="rule-params">
                <div class="field-group"><label>窗口 window</label><input type="number" v-model.number="ruleEditor.draft.params.window" min="0" /></div>
                <div class="field-group"><label>放量倍数 volFactor</label><input type="number" v-model.number="ruleEditor.draft.params.volFactor" min="0" step="0.1" /></div>
                <div class="field-group"><label>周期 period</label><input type="number" v-model.number="ruleEditor.draft.params.period" min="0" /></div>
              </div>
              <div class="rule-params">
                <div class="field-group"><label>粗筛 最小涨%</label><input type="number" v-model.number="ruleEditor.draft.prefilter.minChangePct" /></div>
                <div class="field-group"><label>粗筛 最大涨%</label><input type="number" v-model.number="ruleEditor.draft.prefilter.maxChangePct" /></div>
                <div class="field-group"><label>粗筛 最小量比</label><input type="number" v-model.number="ruleEditor.draft.prefilter.minVolumeRatio" /></div>
                <div class="field-group"><label>粗筛 最大量比</label><input type="number" v-model.number="ruleEditor.draft.prefilter.maxVolumeRatio" /></div>
              </div>
            </template>
            <template v-else>
              <div class="rule-params">
                <div class="field-group"><label>最小量比</label><input type="number" v-model.number="ruleEditor.draft.params.minVolumeRatio" /></div>
                <div class="field-group"><label>最小换手%</label><input type="number" v-model.number="ruleEditor.draft.params.minTurnover" /></div>
                <div class="field-group"><label>最大换手%</label><input type="number" v-model.number="ruleEditor.draft.params.maxTurnover" /></div>
                <div class="field-group"><label>主力净流入(亿)</label><input type="number" v-model.number="ruleEditor.draft.params.minMainNetYi" /></div>
                <div class="field-group"><label>最小成交额(亿)</label><input type="number" v-model.number="ruleEditor.draft.params.minAmountYi" /></div>
              </div>
            </template>
            <div class="actions">
              <button class="btn primary" @click="saveRuleDraft">应用修改</button>
              <button class="btn" @click="closeRuleEditor">取消</button>
              <span class="summary">应用后写入内存，需在设置页点击「保存规则」持久化到本地。</span>
            </div>
          </template>
        </div>
      </div>
    </div>

    <footer>数据来自公开行情接口，研判由 AI 依据本地补齐的行情与形态证据生成，仅供研究参考，不构成投资建议。</footer>
</template>

<script setup>
import { storeToRefs } from 'pinia';
import { useAppStore } from '../stores/app';
const app = useAppStore();
const { ruleEditor, patternOptions, summary } = storeToRefs(app);
const { closeRuleEditor, handleModalKeydown, scan, saveRuleDraft } = app;
</script>
