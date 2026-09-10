<template>
    <!-- ══════════ 设置 ══════════ -->
    <template v-if="mode==='settings'">
      <section class="panel" aria-label="设置">
        <div class="panel-head">
          <div>
            <h2>设置</h2>
            <span class="summary">全市场 K 线抓取任务的天数与动作，以及 AI 辅助研判配置；配置仅保存在本机，不会上传。</span>
          </div>
        </div>

        <details class="settings-section" open>
          <summary>交易方式与风险框架</summary>
          <div class="settings-section-body settings-grid">
            <div class="field-group">
              <label for="tradingStyle">交易方式</label>
              <select id="tradingStyle" v-model="settings.tradingStyle" required>
                <option disabled value="">首次使用请选择</option>
                <option value="short">短线交易（1～5 个交易日）</option>
                <option value="medium">中线交易（数周至数月）</option>
                <option value="long">长线交易（数月以上）</option>
              </select>
              <span class="summary">影响 AI 对建仓、止损、止盈和仓位节奏的解释；以后可在此调整。</span>
            </div>
            <div class="settings-save-row">
              <span class="summary" :class="{ err: tradingSettingsMsgError }" role="status">{{ tradingSettingsMsg }}</span>
              <button class="btn primary" :disabled="savingTradingSettings" :aria-busy="savingTradingSettings" @click="settings.saveTradingSettings()">保存</button>
            </div>
          </div>
        </details>

        <details class="settings-section" open>
          <summary>扫描市场预选</summary>
          <div class="settings-section-body settings-grid">
            <div class="field-group scan-market-field">
              <label>市场类型</label>
              <div class="chips" role="group" aria-label="扫描市场预选">
                <button v-for="(m, key) in markets" :key="key" type="button" class="chip" :class="{ warn: m.needsVerify }"
                  :aria-pressed="settings.scanMarkets.includes(key)" @click="settings.toggleScanMarket(key)"
                >{{ m.label }}<span v-if="m.needsVerify" class="muted">(待校验)</span></button>
              </div>
              <span class="summary">保存后应用到市场预扫描、全市快照、题材范围和候选扫描；变更会使当前预扫描结果失效。</span>
            </div>
            <div class="settings-save-row">
              <span class="summary" :class="{ err: scanSettingsMsgError }" role="status">{{ scanSettingsMsg }}</span>
              <button class="btn primary" :disabled="savingScanSettings" :aria-busy="savingScanSettings" @click="settings.saveScanPreferences()">保存</button>
            </div>
          </div>
        </details>

        <details class="settings-section" open>
          <summary>扫描股数</summary>
          <div class="settings-section-body settings-grid">
            <div class="field-group">
              <label for="scanLimit">最多扫描</label>
              <input id="scanLimit" type="number" v-model.number="settings.scanLimit" min="1" max="500" step="1" />
              <span class="summary">每次选股扫描最多保留 1～500 只 K 线确认后的候选，默认 500。</span>
            </div>
            <div class="settings-save-row">
              <span class="summary" :class="{ err: scanLimitMsgError }" role="status">{{ scanLimitMsg }}</span>
              <button class="btn primary" :disabled="savingScanLimit" :aria-busy="savingScanLimit" @click="settings.saveScanLimit()">保存</button>
            </div>
          </div>
        </details>

        <details class="settings-section" :open="integrity.needsData || prefetch.running">
          <summary>数据维护与 K 线完整性</summary>
          <div class="settings-section-body">
        <div class="toolbar" aria-label="抓取任务">
          <div class="field-group">
            <label for="fetchDays">抓取天数</label>
            <input id="fetchDays" type="number" v-model.number="settings.fetchDays" min="20" max="500" step="10" />
            <span class="summary">每次预取/断点续传按此天数补齐所选市场的前复权日 K（20～500 日，默认 250）</span>
          </div>
          <div class="field-group">
            <label for="klineSyncIntervalSec">交易时间内自动补全间隔（秒）</label>
            <input id="klineSyncIntervalSec" type="number" v-model.number="settings.klineSyncIntervalSec" min="30" max="3600" step="30" />
            <span class="summary">自选与候选池统一检查并补齐日 K；午休暂停，闭市后首次打开会校验最后有效日 K（30～3600 秒，默认 300）。</span>
          </div>
          <div class="actions">
            <button class="btn primary" :disabled="prefetch.running || scanning || prefetch.completeToday" @click="startPrefetch">{{ prefetch.completeToday ? '今日已抓齐' : '启动 / 续抓预取' }}</button>
            <button class="btn" :disabled="!prefetch.running" @click="stopPrefetch">停止预取</button>
            <span class="summary" role="status">{{ prefetchSummary }}</span>
          </div>
          <div v-if="prefetch.running">
            <div class="progress-bar-wrap" role="progressbar" :aria-valuemin="0" :aria-valuemax="prefetch.total || 1" :aria-valuenow="prefetch.done">
              <div class="progress-bar" :style="{ width: prefetchPercent + '%' }"></div>
            </div>
          <div class="progress-label">
            {{ prefetch.done }} / {{ prefetch.total }} · {{ prefetchPercent }}% · 当前 {{ prefetch.current }}
            <span v-if="prefetch.cooling" class="c-warn">· 接口限流，冷却中 {{ Math.ceil((prefetch.cooldownMs || 0) / 1000) }}s</span>
          </div>
        </div>
          <div class="summary" :class="{ err: settingsMsgError }" role="status">{{ settingsMsg }}</div>
        </div>

        <div class="toolbar" aria-label="候选池 K线缺失核对">
          <div class="field-group">
            <label for="klineGapsSummary">数据完整性 · K线日期索引（候选池）</label>
            <span class="summary" id="klineGapsSummary" role="status">{{ klineGapsSummary }}</span>
            <button class="btn mini" :disabled="klineGaps.loading" @click="loadKlineGaps">核对数据</button>
          </div>
          <div v-if="klineGaps.worst.length" class="summary">
            缺失最多：{{ klineGaps.worst.slice(0, 6).map((x) => x.code + '（缺' + x.missing + '）').join('、') }}…
          </div>
        </div>
          </div>
        </details>

        <details class="settings-section" :open="settings.ai.enabled">
          <summary>AI 连接配置</summary>
          <div class="settings-section-body">
        <div class="toolbar" aria-label="AI 辅助研判配置">
          <div class="field-group">
            <label class="toggle"><input type="checkbox" v-model="settings.ai.enabled" /> 启用 AI 辅助研判</label>
            <span class="summary">启用后在候选池支持批量 AI 研判、在个股详情支持二次研判。API Key 仅存储在本机，调用时用于向你配置的接口完成认证；不会写入研判证据、日志或候选记录。</span>
          </div>
          <div class="settings-grid">
              <div class="field-group ai-config-group" style="grid-column: 1 / -1">
              <label>首次研判 / 二次研判 AI 配置</label>
              <div class="ai-stage-grid">
              <section class="ai-stage-card" aria-labelledby="firstAiTitle"><h3 id="firstAiTitle">首次研判</h3>
              <div class="field-group"><label for="firstAiProvider">接口类型</label><select id="firstAiProvider" v-model="settings.ai.first.provider">
                <option value="openai-compatible">OpenAI 兼容</option>
                <option value="openai">OpenAI</option>
                <option value="deepseek">DeepSeek</option>
              </select></div>
              <div class="field-group"><label for="firstAiBaseURL">Base URL</label><input id="firstAiBaseURL" v-model="settings.ai.first.baseURL" placeholder="https://api.example.com/v1" autocomplete="off" /></div>
              <div class="field-group"><label for="firstAiModel">模型</label><input id="firstAiModel" v-model="settings.ai.first.model" placeholder="模型名称" autocomplete="off" /></div>
              <div class="field-group"><label for="firstAiKey">API Key</label><div class="api-key-wrap"><input id="firstAiKey" :type="showFirstApiKey ? 'text' : 'password'" v-model="settings.ai.first.apiKey" placeholder="仅存本机" autocomplete="off" />
                <button type="button" class="btn mini" @click="showFirstApiKey = !showFirstApiKey">{{ showFirstApiKey ? '隐藏' : '显示' }}</button>
                </div></div>
              <div class="field-group"><label for="firstAiEffort">推理强度</label><select id="firstAiEffort" v-model="settings.ai.first.reasoningEffort"><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="xhigh">xhigh</option></select></div>
              <div class="field-group"><label for="firstAiTemperature">Temperature</label><div class="range-control"><input id="firstAiTemperature" type="range" v-model.number="settings.ai.first.temperature" min="0" max="2" step="0.1" /><output :value="Number(settings.ai.first.temperature).toFixed(1)">{{ Number(settings.ai.first.temperature).toFixed(1) }}</output></div></div>
              <div class="field-group"><label for="firstAiMaxTokens">最大输出 tokens</label><input id="firstAiMaxTokens" type="number" v-model.number="settings.ai.first.maxTokens" min="64" max="8192" step="256" /></div>
               </section>
              <section class="ai-stage-card" aria-labelledby="secondAiTitle"><h3 id="secondAiTitle">二次研判</h3>
              <div class="field-group"><label for="secondAiProvider">接口类型</label><select id="secondAiProvider" v-model="settings.ai.second.provider">
                <option value="openai-compatible">OpenAI 兼容</option><option value="openai">OpenAI</option><option value="deepseek">DeepSeek</option>
              </select></div>
              <div class="field-group"><label for="secondAiBaseURL">Base URL</label><input id="secondAiBaseURL" v-model="settings.ai.second.baseURL" placeholder="https://api.example.com/v1" autocomplete="off" /></div>
              <div class="field-group"><label for="secondAiModel">模型</label><input id="secondAiModel" v-model="settings.ai.second.model" placeholder="模型名称" autocomplete="off" /></div>
              <div class="field-group"><label for="secondAiKey">API Key</label><div class="api-key-wrap"><input id="secondAiKey" :type="showSecondApiKey ? 'text' : 'password'" v-model="settings.ai.second.apiKey" placeholder="仅存本机" autocomplete="off" /><button type="button" class="btn mini" @click="showSecondApiKey = !showSecondApiKey">{{ showSecondApiKey ? '隐藏' : '显示' }}</button></div></div>
              <div class="field-group"><label for="secondAiEffort">推理强度</label><select id="secondAiEffort" v-model="settings.ai.second.reasoningEffort"><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="xhigh">xhigh</option></select></div>
              <div class="field-group"><label for="secondAiTemperature">Temperature</label><div class="range-control"><input id="secondAiTemperature" type="range" v-model.number="settings.ai.second.temperature" min="0" max="2" step="0.1" /><output :value="Number(settings.ai.second.temperature).toFixed(1)">{{ Number(settings.ai.second.temperature).toFixed(1) }}</output></div></div>
              <div class="field-group"><label for="secondAiMaxTokens">最大输出 tokens</label><input id="secondAiMaxTokens" type="number" v-model.number="settings.ai.second.maxTokens" min="64" max="8192" step="256" /></div>
               </section></div>
            </div>
            <p class="summary settings-note" role="note">两组配置分别发送 reasoning.effort，需模型和接口支持</p>
          </div>
          <section class="ai-settings-block" aria-labelledby="aiExecutionTitle">
            <h3 id="aiExecutionTitle">执行设置</h3>
            <span class="summary">仅影响批量研判的并行请求数量，不改变任一模型的研判规则或输出内容。</span>
            <div class="ai-execution-field">
              <label for="aiConcurrency">研判并发数</label>
              <select id="aiConcurrency" v-model.number="settings.ai.concurrency">
                <option v-for="n in [1, 2, 3, 4, 5]" :key="n" :value="n">{{ n }} 路</option>
              </select>
              <span class="summary">1～5 路，默认 3 路</span>
            </div>
          </section>
          <section class="ai-settings-block" aria-labelledby="aiPromptTitle">
            <h3 id="aiPromptTitle">专业操盘 Prompt</h3>
            <span class="summary">用于约束两类研判的研究角度、风险边界与输出要求。</span>
            <div class="ai-prompt-field">
              <label for="aiPrompt">研判规则</label>
              <textarea id="aiPrompt" v-model="settings.ai.prompt" rows="8" placeholder="输入研判规则、风险约束和输出要求"></textarea>
            </div>
          </section>
          <div class="actions">
            <button class="btn primary" :disabled="savingSettings" :aria-busy="savingSettings" @click="saveSettings"><span v-if="savingSettings" class="loading-spinner" aria-hidden="true"></span><span v-else>保存设置</span></button>
            <span class="summary" :class="{ err: settingsMsgError }" role="status">{{ settingsMsg }}</span>
          </div>
          <div class="summary ai-note">说明：AI 研判依据本机补齐的行情、K 线结构摘要与形态证据发送到你配置的接口；题材、事件等证据接线后再补充说明。当前交易阶段判定为本地启发式，未接入交易所交易日历，页面不会把结果标注为“收盘定稿”。</div>
        </div>
          </div>
        </details>

        <details class="settings-section">
          <summary>选股规则库 <span class="muted" style="margin-left: var(--space-2); font-weight: 400;">{{ enabledRules.length }} 项启用</span></summary>
          <div class="settings-section-body">
        <div class="toolbar" aria-label="选股规则管理">
          <div class="panel-head">
            <div>
              <h2>选股规则</h2>
              <span class="summary">热插拔规则：可新增、编辑、删除、启停；扫描按全部启用规则并集预筛，量能分独立参与初筛与入池门槛。</span>
            </div>
            <div class="actions">
              <button class="btn" @click="addRule">＋ 新增规则</button>
              <button class="btn" @click="resetRules">恢复默认</button>
            </div>
          </div>
          <div v-if="!rules.length" class="rule-empty">暂无规则，点击「新增规则」或「恢复默认」。</div>
          <div v-else class="rules-list">
            <div v-for="(r, i) in rules" :key="r.id" class="rule-card" :class="{ disabled: r.enabled === false }">
              <div class="rule-head">
                <label class="toggle"><input type="checkbox" v-model="r.enabled" /> 启用</label>
                <span class="kind-badge" :class="r.kind">{{ r.kind === 'scan' ? '快照' : '形态' }}</span>
                <input class="rule-label-input" v-model="r.label" :placeholder="r.id" />
                <button class="btn mini" @click="openRuleEditor(i)">编辑</button>
                <button class="btn mini danger" @click="removeRule(i)">删除</button>
              </div>
              <div class="summary">
                <template v-if="r.kind === 'kline'">形态 {{ r.patternId }}<template v-if="r.params && r.params.window"> · 窗口 {{ r.params.window }}</template> · 快照粗筛后入池复筛</template>
                <template v-if="mode==='settings'">快照阈值规则，参与全市扫描预筛</template>
              </div>
            </div>
          </div>
          <div class="actions">
            <button class="btn primary" :disabled="savingRules" @click="saveRules">保存规则</button>
            <span class="summary" :class="{ err: rulesMsgError }" role="status">{{ rulesMsg }}</span>
          </div>
        </div>
          </div>
        </details>
      </section>
    </template>
</template>

<script setup>
import { storeToRefs } from 'pinia';
import { useAppStore } from '../stores/app';
const app = useAppStore();
const { mode, summary, settings, status, markets, integrity, prefetch, scanning, prefetchSummary, prefetchPercent, settingsMsgError, settingsMsg, klineGapsSummary, klineGaps, showFirstApiKey, showSecondApiKey, rows, savingSettings, enabledRules, rules, savingRules, rulesMsgError, rulesMsg } = storeToRefs(app);
const { scan, startPrefetch, stopPrefetch, loadKlineGaps, saveSettings, addRule, resetRules, openRuleEditor, removeRule, saveRules } = app;
</script>
