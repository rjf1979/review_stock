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
              <!-- rsi_low_turn v4：RSI 低位拐头 + 前期超跌，参数与回测口径一一对应。 -->
              <div v-if="ruleEditor.draft.patternId === 'rsi_low_turn'" class="rule-params">
                <div class="field-group"><label for="ruleParamLow">RSI 阈值 low（拐头前须低于）</label><input id="ruleParamLow" type="number" v-model.number="ruleEditor.draft.params.low" min="1" max="99" /></div>
                <div class="field-group"><label for="ruleParamDropDays">跌幅回看天数 drop_days</label><input id="ruleParamDropDays" type="number" v-model.number="ruleEditor.draft.params.drop_days" min="0" /></div>
                <div class="field-group"><label for="ruleParamDropMax">跌幅上限% drop_max（负数）</label><input id="ruleParamDropMax" type="number" v-model.number="ruleEditor.draft.params.drop_max" max="0" step="1" /></div>
              </div>
              <!-- limit_pullback v4：涨停后缩量回踩 + 前期超跌 + 相对沪深300 走弱，参数与回测口径一一对应。 -->
              <div v-if="ruleEditor.draft.patternId === 'limit_pullback'" class="rule-params">
                <div class="field-group"><label for="ruleParamVolShrink">缩量倍数 vol_shrink（量 &lt; 5日均量 ×）</label><input id="ruleParamVolShrink" type="number" v-model.number="ruleEditor.draft.params.vol_shrink" min="0" step="0.05" /></div>
                <div class="field-group"><label for="ruleParamLimitDropDays">跌幅回看天数 drop_days</label><input id="ruleParamLimitDropDays" type="number" v-model.number="ruleEditor.draft.params.drop_days" min="0" /></div>
                <div class="field-group"><label for="ruleParamLimitDropMax">跌幅上限% drop_max（负数）</label><input id="ruleParamLimitDropMax" type="number" v-model.number="ruleEditor.draft.params.drop_max" max="0" step="1" /></div>
                <div class="field-group"><label for="ruleParamRsDays">相对强度天数 rs_days</label><input id="ruleParamRsDays" type="number" v-model.number="ruleEditor.draft.params.rs_days" min="0" /></div>
                <div class="field-group"><label for="ruleParamRsMax">相对强度上限 pp rs_max（负数）</label><input id="ruleParamRsMax" type="number" v-model.number="ruleEditor.draft.params.rs_max" max="0" step="0.5" /></div>
              </div>
              <div class="rule-params">
                <div class="field-group">
                  <label for="ruleMinVolumeScore">量能分入池门槛 minVolumeScore</label>
                  <input id="ruleMinVolumeScore" type="number" v-model.number="ruleEditor.draft.minVolumeScore" min="0" max="100" placeholder="留空沿用全局门槛" />
                </div>
              </div>
              <div v-if="ruleEditor.draft.patternId === 'rsi_low_turn'" class="summary">
                超跌修复口径：命中当天的量能分天然偏低，默认把该规则门槛设为 0，入池由「快照粗筛 + 本地 K 线复筛」决定；量能分仍照常展示。
              </div>
              <div v-if="ruleEditor.draft.patternId === 'limit_pullback'" class="summary">
                超跌修复口径：入场需「涨停后缩量回踩不破支撑」且「近 drop_days 日跌幅 ≤ drop_max%」且「近 rs_days 日相对沪深300 ≤ rs_max pp」三条同时成立；相对强度依赖本地沪深300 基准序列，取不到时该规则不命中。默认门槛设为 0，入池由复筛决定；量能分仍照常展示。
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
