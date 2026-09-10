// 智诊盯盘全局应用状态（Pinia setup store）。
// 由原 index.html 内联 setup() 逐字迁移；onMounted 启动序列改为 bootstrap()，由 App.vue 挂载后调用。
import { defineStore } from 'pinia';
import { ref, reactive, computed, watch, nextTick } from 'vue';
import * as echarts from 'echarts';

export const useAppStore = defineStore('app', () => {
const markets = ref({});
const rules = ref([]);
const selectedMarkets = ref([]);
const ruleId = ref('');
const dataSource = ref('live');
const usedSource = ref('');
const snapshotDate = ref('');
const statusInfo = ref({ snapshotDates: [], klineCount: 0 });
const localStatus = ref({ today: '', okToday: 0, total: 0, allToday: false, lastDate: '', markets: [] });
const rows = ref([]);
const scanContext = ref(null);
const prescanMarketKey = ref('');
const scanning = ref(false);
const summary = ref('');
const status = ref('');
const statusText = ref('');
const detail = reactive({
  open: false, code: '', name: '', loading: false, pattern: '', patternHits: [], checkedPatternRules: 0, error: '', changePct: 0,
  priceText: '—', changeText: '—', openText: '—', highText: '—', lowText: '—',
  volumeText: '—', amountText: '—', turnoverText: '—', volumeRatioText: '—',
  // AI 辅助研判状态
  row: null, kline: [], klineDate: '', evidence: [], aiBusy: false, aiText: '', aiRun: false,
  aiError: false, aiUpdatedAt: '', aiModel: '',
  aiVerdict: '', aiChanges: [], aiEvidence: [], aiRisks: [], aiWatchPoints: [],
  aiLastSuccess: null, aiEvidenceDates: null, aiReasons: [], aiSampleStatus: '', aiPriceLevels: null,
  aiRaw: '', aiErrorText: '', aiTheme: null, aiThemeDate: '',
  aiRecordStatus: 'none', aiRecordAt: null, aiRecordEvidenceDates: null,
});
let klineCache = [];
let detailLiveTimer = null;
let detailLiveTicks = 0;
let detailSessionId = 0;
let detailChart = null;
let detailChartObserver = null;
const resizeDetailChart = () => { if (detailChart) detailChart.resize({ animation: false }); };
function repaintPriceLevels(levels) {
  if (!detailChart || !levels) return;
  const dates = detail.kline || [];
  const first = dates[0] && dates[0].date;
  const last = dates[dates.length - 1] && dates[dates.length - 1].date;
  detailChart.setOption({ graphic: [] });
  const areaData = [], lineData = [];
  (levels.entryTriggers || []).forEach((x) => { const v = Number(x.confirmAbove || (x.zone && x.zone.high) || x.value || x.price); if (Number.isFinite(v)) lineData.push({ yAxis: v, name: '建仓价位', lineStyle: { color: '#f7d451', type: 'dashed' } }); });
  const stop = Number(levels.invalidationLevel && (levels.invalidationLevel.value || levels.invalidationLevel.price));
  if (Number.isFinite(stop)) lineData.push({ yAxis: stop, name: '止损价位', lineStyle: { color: '#ff6262', type: 'dashed' } });
  (levels.exitWatchZones || []).forEach((x) => { const v = Number(x.value || x.price || (x.zone && x.zone.low)); if (Number.isFinite(v)) lineData.push({ yAxis: v, name: '止盈价位', lineStyle: { color: '#62d9d0', type: 'dashed' } }); });
  detailChart.setOption({ series: [{ type: 'candlestick', name: '日K', markArea: { silent: true, data: areaData }, markLine: { silent: true, symbol: ['none', 'none'], data: lineData, label: { show: true, position: 'insideEndTop' } } }] });
}
const prefetch = reactive({ running: false, done: 0, total: 0, fetched: 0, skipped: 0, errors: 0, written: 0, dbSaved: 0, processed: 0, needCount: 0, current: '', startedAt: 0, finishedAt: 0, today: '', markets: [], cooling: false, cooldownMs: 0, completeToday: false, source: '' });
const integrity = reactive({ loading: false, needsData: false, firstRun: false, missing: [], snapshot: {}, kline: {} });
const klineGaps = reactive({ loading: false, total: 0, complete: 0, incomplete: 0, missingRows: 0, windowSize: 0, examples: [], worst: [] });

// 工作模式：候选池 / 盯盘 / 选股扫描 / 设置
const mode = ref((() => {
  try {
    const saved = localStorage.getItem('stock-sentinel-active-mode');
    return ['pool', 'watch', 'scan', 'settings'].includes(saved) ? saved : 'pool';
  } catch { return 'pool'; }
})());
const appReady = ref(false);
const startupMessage = ref('正在连接本地数据服务…');
const watchlist = ref([]);
const pool = ref([]);
const poolSort = ref('score');
const poolSortDir = ref(-1);
const poolTrackFilter = ref('all');
const poolPatternFilter = ref('all');
const poolPatterns = ref({});
const poolKlineDepths = ref({});
const poolKlineLatestDates = ref({});
const poolPrefetch = reactive({ running: false, done: 0, total: 0, ok: 0, failed: 0, skipped: 0, current: '', startedAt: 0, finishedAt: 0, lmt: 250 });
const poolBusy = ref(false);
const poolItemBusy = ref({});
const poolMsg = ref('');
const poolMsgError = ref(false);
const poolJudgments = ref({});
const poolRecommendations = ref({});
const recommendationBatch = reactive({ running: false, done: 0, total: 0, succeeded: 0, failed: 0, finishedAt: 0 });
const judgmentBatch = reactive({ running: false, batchId: '', done: 0, total: 0, success: 0, failed: 0, formatError: 0, skipped: 0, noChange: 0, notReady: 0, current: '', currentName: '', startedAt: 0, finishedAt: 0, retryOnly: false, phase: 'idle', prepareDone: 0, prepareTotal: 0 });
const judgmentConfirm = reactive({ open: false, retryOnly: false, loading: false, error: '', categories: { first: 0, failedRetry: 0, evidenceUpdate: 0, noChange: 0, notReady: 0 }, total: 0, expectedCalls: 0 });
const watchQuotes = ref([]);
const watchDataDate = ref('');
const watchDataSource = ref('');
const watchAlerts = ref([]);
const watchInput = ref('');
const watchAddMsg = ref('');
const watchAddMsgError = ref(false);
const addingWatch = ref(false);
const watchRefreshing = ref(false);
const watchQuotesError = ref('');
const watchAuto = ref(true);
const watchIntervalMs = ref(5000);
const lastUpdate = ref('');
const watchSessionActive = ref(true);
let watchTimer = null;

// A 股盘中判定：交易日 9:15–11:30 / 13:00–15:00（含集合竞价）；午间休市与闭市返回 false。
function cnShanghaiClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).reduce((o, p) => { o[p.type] = p.value; return o; }, {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}
function cnWatchSessionActive(now = new Date()) {
  const clock = cnShanghaiClock(now);
  if (clock.weekday === 'Sat' || clock.weekday === 'Sun') return false;
  return (clock.minutes >= 9 * 60 + 15 && clock.minutes < 11 * 60 + 30) || (clock.minutes >= 13 * 60 && clock.minutes < 15 * 60);
}
function cnAfterMarketClose(now = new Date()) {
  const clock = cnShanghaiClock(now);
  return clock.weekday !== 'Sat' && clock.weekday !== 'Sun' && clock.minutes >= 15 * 60;
}

// 设置：抓取任务天数 + AI 配置（本地持久化于 /api/settings）
 const settings = reactive({ fetchDays: 250, klineSyncIntervalSec: 300, scanMarkets: ['sh_main', 'sz_main', 'chuangye', 'kechuang', 'beijiao'], scanLimit: 500, ai: { enabled: false, provider: 'openai-compatible', baseURL: '', apiKey: '', model: '', temperature: 0.7, maxTokens: 8192, concurrency: 3, reasoningEffort: 'medium', timeoutMs: 180000, contextTokens: 1000000, first: { provider: 'openai-compatible', baseURL: '', apiKey: '', model: '', temperature: 0.7, maxTokens: 8192, reasoningEffort: 'medium', timeoutMs: 180000, contextTokens: 1000000 }, second: { provider: 'openai-compatible', baseURL: '', apiKey: '', model: '', temperature: 0.7, maxTokens: 8192, reasoningEffort: 'medium', timeoutMs: 180000, contextTokens: 1000000 }, prompt: '' } });
 // 先建立两组响应式对象，避免设置接口尚未返回时模板访问 undefined。
 settings.ai.first = settings.ai.first || { provider: 'openai-compatible', baseURL: '', apiKey: '', model: '', temperature: 0.7, maxTokens: 8192, reasoningEffort: 'medium', timeoutMs: 180000, contextTokens: 1000000 };
 settings.ai.second = settings.ai.second || { provider: 'openai-compatible', baseURL: '', apiKey: '', model: '', temperature: 0.7, maxTokens: 8192, reasoningEffort: 'medium', timeoutMs: 180000, contextTokens: 1000000 };
 const showFirstApiKey = ref(false);
 const showSecondApiKey = ref(false);
const savingSettings = ref(false);
const settingsMsg = ref('');
const settingsMsgError = ref(false);
const savingTradingSettings = ref(false);
const tradingSettingsMsg = ref('');
const tradingSettingsMsgError = ref(false);
const savingScanSettings = ref(false);
const scanSettingsMsg = ref('');
const scanSettingsMsgError = ref(false);
const savingScanLimit = ref(false);
const scanLimitMsg = ref('');
const scanLimitMsgError = ref(false);
const aiPrompt = ref('');

// 选股规则热插拔（设置页：增删改 + 启停；扫描按启用规则并集执行）
const savingRules = ref(false);
const rulesMsg = ref('');
const rulesMsgError = ref(false);
const patterns = ref([]);
const ruleEditor = reactive({ open: false, index: -1, draft: null });
const returnBaselineEditor = reactive({ open: false, code: '', name: '', price: '', monitorStartDate: '', saving: false, error: '' });
const dialogReturnFocus = { detail: null, rule: null, baseline: null };
const dialogSelector = {
  detail: '#detailDialog',
  rule: '#ruleDialog',
  baseline: '#returnBaselineDialog',
  batch: '#batchConfirmDialog',
};

// 业务调整：数据来源固定实时拉取，规则固定全部启用并集。
const SOURCE_LABEL = { live: '实时拉取' };
const scanBtnText = '重新预扫描并全市扫描';
const sourceLabel = (k) => SOURCE_LABEL[k] || k;
const marketLabel = (k) => (markets.value[k] ? markets.value[k].label : (k || '—'));
const lastSnapDate = computed(() => (statusInfo.value.snapshotDates && statusInfo.value.snapshotDates[0]) || '');
const dataHealth = computed(() => {
  if (integrity.loading) return { state: 'checking', label: '正在核对数据', detail: '请稍候' };
  if (integrity.needsData) return { state: 'warning', label: '数据待补齐', detail: `${integrity.missing.length} 项待处理` };
  return { state: 'ready', label: '数据就绪', detail: `快照 ${lastSnapDate.value || '—'} · K ${statusInfo.value.klineCount || 0}` };
});
const missingTodayLabels = computed(() => localStatus.value.markets.filter((m) => !m.hasToday).map((m) => m.label).join('、'));
const todayReadySummary = computed(() => localStatus.value.markets.filter((m) => m.hasToday).map((m) => `${m.label} ${m.todayCount} 只`).join(' · '));
const prefetchPercent = computed(() => prefetch.total ? Math.round((prefetch.done / prefetch.total) * 100) : 0);
const enabledRules = computed(() => rules.value.filter((r) => r.enabled !== false));
const patternOptions = computed(() => {
  const fromPatterns = patterns.value.filter(Boolean);
  if (fromPatterns.length) return fromPatterns;
  return [...new Set(rules.value.filter((r) => r.kind === 'kline').map((r) => r.patternId).filter(Boolean))];
});
const prefetchSummary = computed(() => {
  const days = settings.fetchDays || 250;
  if (prefetch.running) return `正在预取 ${days} 日 K 线：${prefetch.done}/${prefetch.total}（${prefetchPercent.value}%）；判定缺日待补 ${prefetch.needCount}，已联网 ${prefetch.fetched}，落库 ${prefetch.dbSaved}/${prefetch.written}，跳过 ${prefetch.skipped}，失败 ${prefetch.errors}；当前 ${prefetch.current}${prefetch.cooling ? '；接口限流，冷却中，将自动继续' : ''}`;
  if (prefetch.completeToday) return `今日 K 线已抓齐（${prefetch.skipped} 只），当天无需重复抓取；下次可点击「启动预取」续抓下一交易日。`;
  if (prefetch.total > 0) {
    const secs = prefetch.finishedAt ? Math.max(0, Math.round((prefetch.finishedAt - prefetch.startedAt) / 1000)) : 0;
    return `预取${prefetch.source ? '（当前平台：' + prefetch.source + '）' : ''}：新增 ${prefetch.fetched}，落库 ${prefetch.dbSaved}，跳过 ${prefetch.skipped}，失败 ${prefetch.errors}，用时 ${Math.floor(secs / 60)}分${secs % 60}秒`;
  }
  return `本地仓库：按所选市场补全 ${days} 日 K 线（已缓存自动跳过，可断点续抓；单平台限流自动切换免费平台）`;
});
const klineGapsSummary = computed(() => {
  if (klineGaps.loading) return '正在核对候选池 K 线日期索引…';
  if (!klineGaps.total) return '候选池为空：先扫描全市并纳入候选池，再回来核对缺失日。';
  return `候选池 ${klineGaps.total} 只中 ${klineGaps.complete} 只已齐（窗口 ${klineGaps.windowSize} 日），${klineGaps.incomplete} 只存在 ${klineGaps.missingRows} 个缺失日；预取只补这些缺失日，已齐不再重扫。`;
});

// 涨跌统计以本地 K 线库尾 bar 为准（与卡片价格同源）；无 K 线的代码不计入。
const boardStats = computed(() => {
  let up = 0; let down = 0; let flat = 0;
  for (const code of watchlist.value.map((item) => String(item && item.code || '')).filter((code) => /^\d{6}$/.test(code))) {
    const bs = (watchKlines.value[code] || {}).bars || [];
    if (bs.length < 2 || !(bs[bs.length - 2].close > 0)) continue;
    const pct = ((bs[bs.length - 1].close - bs[bs.length - 2].close) / bs[bs.length - 2].close) * 100;
    if (pct > 0) up += 1; else if (pct < 0) down += 1; else flat += 1;
  }
  return { up, down, flat };
});
const watchDataLabel = computed(() => {
  if (!watchDataDate.value) return '数据日期待加载';
  return watchDataSource.value === 'local_snapshot' ? `最后交易日收盘数据：${watchDataDate.value}` : `实时行情：${watchDataDate.value}`;
});
function resolveWatchReturnInfo(item, latestClose) {
  if (!item) return null;
  const custom = item.customReturnBaseline;
  const automatic = item.returnBaseline;
  if (custom) {
    const price = Number(custom.price);
    const baselineText = `模拟价 ${fmtPrice(price)} · 自 ${custom.monitorStartDate || '—'} 起监控`;
    if (custom.status !== 'filled') return { state: 'pending_touch', text: `模拟买入待触达 ${fmtPrice(price)}`, tone: '', baselineText, isCustom: true };
    if (!(Number(latestClose) > 0)) return { state: 'unavailable', text: '模拟收益待 K 线加载', tone: '', baselineText: `模拟买入 ${custom.filledDate || '—'} · ${fmtPrice(price)}`, isCustom: true };
    const pct = ((Number(latestClose) - price) / price) * 100;
    return { state: 'custom_filled', pct, text: `模拟收益 ${fmtPct(pct)}`, tone: pct > 0 ? 'pos' : pct < 0 ? 'neg' : '', baselineText: `模拟买入 ${custom.filledDate || '—'} · ${fmtPrice(price)}`, isCustom: true };
  }
  if (!automatic) return { state: 'legacy_unavailable', text: '历史自选未记录收益基准', tone: '', baselineText: '' };
  if (automatic.status !== 'confirmed' || !(Number(automatic.close) > 0)) return { state: 'pending_close', text: '累计收益待当日收盘确认', tone: '', baselineText: automatic.targetDate ? `加入日 ${automatic.targetDate}` : '' };
  if (!(Number(latestClose) > 0)) return { state: 'unavailable', text: '累计收益待 K 线加载', tone: '', baselineText: `基准 ${automatic.targetDate} 收 ${fmtPrice(automatic.close)}` };
  const pct = ((Number(latestClose) - Number(automatic.close)) / Number(automatic.close)) * 100;
  return { state: 'confirmed', pct, text: `累计收益 ${fmtPct(pct)}`, tone: pct > 0 ? 'pos' : pct < 0 ? 'neg' : '', baselineText: `基准 ${automatic.targetDate} 收 ${fmtPrice(automatic.close)}` };
}
const watchReturnByCode = computed(() => Object.fromEntries(watchlist.value.map((item) => {
  const bars = (watchKlines.value[item.code] && watchKlines.value[item.code].bars) || [];
  const last = bars[bars.length - 1];
  return [item.code, resolveWatchReturnInfo(item, last && last.close)];
})));
const detailWatchReturn = computed(() => {
  const item = watchlist.value.find((x) => String(x.code) === detail.code);
  const last = detail.kline[detail.kline.length - 1];
  return resolveWatchReturnInfo(item, last && last.close);
});
const poolStats = computed(() => {
  const up = pool.value.filter((x) => Number(x.changePct) > 0).length;
  const down = pool.value.filter((x) => Number(x.changePct) < 0).length;
  return { up, down, flat: pool.value.length - up - down };
});
const trackRecommendation = (r) => {
  const recommendation = poolRecommendations.value[r.code];
  if (recommendation) return ({ priority: 'priority', confirm: 'observe', not_recommended: 'hold', insufficient: 'exclude' }[recommendation.classification] || 'exclude');
  const st = poolJudgments.value[r.code];
  if (!st || st.dataStatus === 'not_ready' || st.judgmentStatus !== 'success') return 'exclude';
  const verdict = st.lastSuccess && st.lastSuccess.verdict;
  const score = Number(r.score) || 0;
  if (verdict === 'risk' || verdict === 'insufficient') return 'exclude';
  if (score >= 80 && verdict === 'maintain') return 'priority';
  if (score >= 60) return 'observe';
  return 'hold';
};
const patternHitsFor = (r) => {
  const state = poolPatterns.value[r.code];
  return state && Array.isArray(state.hits) ? state.hits : [];
};
const poolPatternLabel = (r) => {
  const hits = patternHitsFor(r);
  return hits.length ? hits.map((x) => `${x.label}（${x.score}）`).join(' / ') : '—';
};
const poolFilterStats = computed(() => {
  const counts = { priority: 0, observe: 0, hold: 0, exclude: 0, hit: 0, none: 0 };
  const patterns = new Map();
  for (const candidate of pool.value) {
    counts[trackRecommendation(candidate)] += 1;
    const hits = patternHitsFor(candidate);
    if (hits.length) counts.hit += 1;
    else counts.none += 1;
    for (const hit of hits) patterns.set(hit.label, (patterns.get(hit.label) || 0) + 1);
  }
  return { ...counts, patterns };
});
const poolTrackFilterOptions = computed(() => [
  { value: 'all', label: '全部股票', count: pool.value.length },
  { value: 'priority', label: '优先跟踪', count: poolFilterStats.value.priority },
  { value: 'observe', label: '观察跟踪', count: poolFilterStats.value.observe },
  { value: 'hold', label: '暂不跟踪', count: poolFilterStats.value.hold },
  { value: 'exclude', label: '排除', count: poolFilterStats.value.exclude },
]);
const poolPatternFilterOptions = computed(() => [
  { value: 'all', label: '全部形态', count: pool.value.length },
  { value: 'hit', label: '已命中形态', count: poolFilterStats.value.hit },
  { value: 'none', label: '未命中形态', count: poolFilterStats.value.none },
  ...[...poolFilterStats.value.patterns.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'zh-CN'))
    .map(([label, count]) => ({ value: label, label, count })),
]);
const sortedPool = computed(() => {
  const key = poolSort.value;
  const dir = poolSortDir.value;
  let list = poolTrackFilter.value === 'all' ? pool.value : pool.value.filter((r) => trackRecommendation(r) === poolTrackFilter.value);
  if (poolPatternFilter.value === 'hit') list = list.filter((r) => patternHitsFor(r).length > 0);
  else if (poolPatternFilter.value === 'none') list = list.filter((r) => patternHitsFor(r).length === 0);
  else if (poolPatternFilter.value !== 'all') list = list.filter((r) => patternHitsFor(r).some((x) => x.label === poolPatternFilter.value));
  return [...list].sort((a, b) => {
    const av = key === 'addedAt' ? Date.parse(a.addedAt || 0) : Number(a[key]) || 0;
    const bv = key === 'addedAt' ? Date.parse(b.addedAt || 0) : Number(b[key]) || 0;
    return (av - bv) * dir;
  });
});
const klineDone = (code) => Number(poolKlineDepths.value[code] || 0);
const poolKlineLatest = (code) => poolKlineLatestDates.value[code] || {};
const isWatched = (code) => watchlist.value.some((w) => w.code === code);
const isInPool = (code) => pool.value.some((x) => x.code === code);
const candidateState = (r) => {
  if (isWatched(r.code)) return '盯盘中';
  const st = poolJudgments.value[r.code];
  if (st) {
    if (st.dataStatus === 'not_ready') return '数据未就绪：' + ((st.reasons && st.reasons[0]) || '样本不足');
    if (st.judgmentStatus === 'failed' || st.judgmentStatus === 'format_error') return '研判失败 · 可重试';
    if (st.judgmentStatus === 'success') {
      const lastDates = (st.lastSuccess && st.lastSuccess.evidenceDates) || {};
      const changed = (lastDates.klineDate && st.klineDate && lastDates.klineDate !== st.klineDate)
        || (lastDates.snapshotDate && st.snapshotDate && lastDates.snapshotDate !== st.snapshotDate);
      if (changed) return '待复核';
      return '已研判 · ' + fmtTime(st.lastSuccess.finishedAt);
    }
    if (st.dataStatus === 'limited') return '待研判 · 样本有限';
  }
  if (klineDone(r.code) >= (settings.fetchDays || 250)) return '待研判';
  return '待补 K 线';
};
const candidateStateClass = (r) => {
  const s = candidateState(r);
  if (s.startsWith('研判失败')) return 'failed';
  if (s.startsWith('数据未就绪') || s === '待补 K 线') return 'pending';
  return 'ready';
};
const hasFailedJudgments = computed(() => Object.values(poolJudgments.value).some((s) => s && (s.judgmentStatus === 'failed' || s.judgmentStatus === 'format_error')));
const recommendationLabel = (r) => ({ priority: '优先盯盘', confirm: '等待确认', not_recommended: '暂不推荐', insufficient: '数据不足' }[(poolRecommendations.value[r.code] || {}).classification] || '待评估');
const recommendationClass = (r) => ({ priority: 'rec-priority', confirm: 'rec-confirm', not_recommended: 'rec-not', insufficient: 'rec-insufficient' }[(poolRecommendations.value[r.code] || {}).classification] || 'rec-none');
const recommendationReason = (r) => {
  const x = poolRecommendations.value[r.code];
  // 存储层解析 JSON 后保留列名（reasonCodesJson/evidenceJson），做兼容读取。
  const reasons = x && (Array.isArray(x.reasonCodesJson) ? x.reasonCodesJson : x.reasonCodes);
  if (!x || !Array.isArray(reasons) || !reasons[0]) return '';
  const base = reasons[0];
  // 弱势市场的全局理由对所有票一致：补充该票自身的形态与量能依据，便于横向比较。
  if (base.startsWith('弱势市场')) {
    const evidence = x.evidenceJson || x.evidence;
    const patterns = evidence && Array.isArray(evidence.patterns) ? evidence.patterns : [];
    const top = patterns[0] ? `${patterns[0].label} ${patterns[0].score}分` : '';
    const vr = Number(r.volumeRatio);
    const parts = [top, Number.isFinite(vr) ? `量比 ${vr.toFixed(2)}` : ''].filter(Boolean);
    return parts.length ? `${base}；${parts.join(' · ')}` : base;
  }
  return base;
};
function togglePoolSort(key) {
  if (poolSort.value === key) poolSortDir.value *= -1;
  else { poolSort.value = key; poolSortDir.value = -1; }
}
const aiSummary = computed(() => {
  const lines = String(detail.aiText || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const summary = lines.slice(0, 3).join('\n');
  return summary.length > 420 ? summary.slice(0, 420) + '…' : summary;
});
const aiVerdictLabel = computed(() => {
  const map = { maintain: '维持', revise: '修正', new_evidence: '新增变化', insufficient: '无法研判' };
  return map[detail.aiVerdict] || detail.aiVerdict || '—';
});
const aiVerdictClass = computed(() => ({
  maintain: 'signal-positive',
  new_evidence: 'signal-positive',
  revise: 'signal-watch',
  insufficient: 'signal-risk',
}[detail.aiVerdict] || ''));
const aiSampleLabel = computed(() => {
  const map = { full: '完整就绪', limited: '有限就绪（样本有限）', not_ready: '数据未就绪' };
  return map[detail.aiSampleStatus] || '未研判';
});
const aiKlineDate = computed(() => (detail.aiEvidenceDates && detail.aiEvidenceDates.klineDate) || detail.klineDate || '—');
const aiSnapshotDate = computed(() => (detail.aiEvidenceDates && detail.aiEvidenceDates.snapshotDate) || '—');
const aiDateMismatch = computed(() => {
  const k = (detail.aiEvidenceDates && detail.aiEvidenceDates.klineDate) || '';
  const s = (detail.aiEvidenceDates && detail.aiEvidenceDates.snapshotDate) || '';
  return !!(k && s && k !== s);
});
const aiThemeNames = computed(() => {
  const t = detail.aiTheme;
  if (!t || !Array.isArray(t.boards) || !t.boards.length) return [];
  return t.boards.map((b) => String(b && b.name || '').trim()).filter(Boolean).slice(0, 12);
});
const aiThemeSummary = computed(() => {
  const names = aiThemeNames.value;
  if (!names.length) return '暂无行业/题材数据';
  const date = detail.aiThemeDate || (detail.aiTheme && detail.aiTheme.fetchedAt) || '';
  return `${names.join('、')}${date ? ' · ' + date : ''}`;
});
const aiBtnLabel = computed(() => {
  if (detail.aiBusy) return 'AI 研判中…';
  if (detail.aiRecordStatus === 'failed' || detail.aiRecordStatus === 'format_error') return '重试研判';
  if (detail.aiRun || detail.aiRecordStatus === 'success') return '二次研判（增量复核）';
  return 'AI 辅助研判';
});
const fmtDuration = (ms) => {
  const n = Math.max(0, Number(ms) || 0) / 1000;
  const m = Math.floor(n / 60);
  const s = (n % 60).toFixed(3).replace(/\.?(0+)$/, '');
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
};
const zoneRange = (z) => (z && z.low != null && z.high != null) ? `${z.low}~${z.high}` : '—';
const entryTriggerLabel = (t) => {
  if (!t) return '—';
  const kind = t.type === 'pullback' ? '首次买入' : t.type === 'breakout' ? '突破买入' : String(t.type || '入场观察');
  const st = t.status === 'achieved' ? '已达成' : t.status === 'confirmed' ? '已突破' : t.type === 'breakout' ? '待突破' : '待确认';
  let s = `${kind} · ${st}`;
  if (t.confirmAbove != null) s += `（确认价 ${t.confirmAbove}）`;
  return s;
};
const exitWatchLabel = (z) => {
  if (!z) return '—';
  if (z.type === 'trailing') return z.value != null ? `移动保护线 ${z.value}` : '移动保护线';
  return zoneRange(z);
};
const fmtTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};
const fmtClock = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
};
const fmtDateTime = (iso) => fmtTime(iso);
const detailAiState = computed(() => {
  if (detail.aiRecordStatus === 'success') {
    const d = detail.aiRecordEvidenceDates || {};
    const curK = detail.klineDate || '';
    const curSnap = (detail.row && detail.row.snapshotDate) || '';
    const changed = !!(d.klineDate && curK && d.klineDate !== curK)
      || !!(d.snapshotDate && curSnap && d.snapshotDate !== curSnap);
    if (changed) return '待复核';
    return '已研判 · ' + fmtTime(detail.aiRecordAt);
  }
  if (detail.aiRecordStatus === 'failed' || detail.aiRecordStatus === 'format_error') return '研判失败 · 可重试';
  return '待研判';
});
const detailAiStateClass = computed(() => {
  const s = detailAiState.value;
  if (s.indexOf('研判失败') === 0) return 'failed';
  if (s === '待复核') return 'pending';
  if (s === '待研判') return 'pending';
  return 'ready';
});
const fmtVolume = (v) => {
  const n = Number(v) || 0;
  if (n >= 1e8) return (n / 1e8).toFixed(2) + '亿股';
  if (n >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, '') + '万股';
  return Math.round(n) + '股';
};
const fmtPrice = (v) => Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v).toFixed(2) : '—';
const fmtPct = (v) => (v == null || !Number.isFinite(Number(v))) ? '—' : `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`;
const fmtNum = (v, d = 2) => Number.isFinite(Number(v)) ? Number(v).toFixed(d) : '—';
const fmtAmount = (v) => Number.isFinite(Number(v)) && Number(v) > 0 ? `${(Number(v) / 1e8).toFixed(2)}亿` : '—';
const fmtRatio = (v, suffix = '') => Number.isFinite(Number(v)) && Number(v) > 0 ? `${Number(v).toFixed(2)}${suffix}` : '—';

function toggleMarket(key) {
  const idx = selectedMarkets.value.indexOf(key);
  if (idx >= 0) selectedMarkets.value.splice(idx, 1);
  else selectedMarkets.value.push(key);
}

function toggleSettingsMarket(key) {
  const idx = settings.scanMarkets.indexOf(key);
  if (idx >= 0) settings.scanMarkets.splice(idx, 1);
  else settings.scanMarkets.push(key);
}
settings.toggleScanMarket = toggleSettingsMarket;

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { /* 保留非 JSON 响应的状态码 */ }
  if (!res.ok) {
    const detail = payload && payload.error;
    const message = detail && typeof detail === 'object' ? detail.message : detail;
    const error = new Error(String(message || text || `HTTP ${res.status}`).slice(0, 240));
    error.status = res.status;
    error.code = detail && typeof detail === 'object' ? detail.code : undefined;
    error.retryable = detail && typeof detail === 'object' ? detail.retryable : undefined;
    error.payload = payload;
    throw error;
  }
  if (payload !== null) return payload;
  throw new Error('响应不是有效 JSON');
}

async function loadLocalStatus() {
  try {
    const q = new URLSearchParams({ markets: selectedMarkets.value.join(',') });
    localStatus.value = (await fetchJson('/api/local-status?' + q.toString())) || localStatus.value;
  } catch { /* 后端未就绪时不阻塞 */ }
}

function applyPrescan(prescan) {
  scanContext.value = {
    marketRegime: prescan.marketRegime || { label: '未判定', confidence: 'unavailable' },
    strategy: prescan.strategy || { label: '未取得', enabledRuleIds: [] },
    focusThemes: Array.isArray(prescan.focusThemes) ? prescan.focusThemes : [],
    focusConcepts: Array.isArray(prescan.focusConcepts) ? prescan.focusConcepts : [],
    scanScope: prescan.scanScope || { stockCount: 0 },
    limitStructure: prescan.marketRegime && prescan.marketRegime.evidence && prescan.marketRegime.evidence.limitStructure || { available: false, reason: '数据不可用' },
    snapshotDate: prescan.snapshotDate || '', fetchedAt: prescan.fetchedAt || '',
    isFinal: Boolean(prescan.isFinal), reused: Boolean(prescan.reused),
  };
}

async function preScan({ keepBusy = false, force = false } = {}) {
  if (!selectedMarkets.value.length) { status.value = 'error'; statusText.value = '请至少选择一个市场。'; return null; }
  if (!keepBusy) scanning.value = true;
  status.value = 'loading'; statusText.value = '正在预扫描市场环境、重点行业和可关注概念…';
  try {
    const q = new URLSearchParams({ markets: selectedMarkets.value.join(',') });
    if (force) q.set('force', '1');
    const prescan = await fetchJson('/api/market-prescan?' + q.toString());
    applyPrescan(prescan);
    prescanMarketKey.value = [...selectedMarkets.value].sort().join(',');
    status.value = ''; statusText.value = prescan.reused ? '已复用最近闭市预扫描结果。' : '市场预扫描完成，结果已落地。';
    return prescan;
  } catch (e) { status.value = 'error'; statusText.value = '预扫描失败：' + e.message; return null; }
  finally { if (!keepBusy) scanning.value = false; }
}

async function scan() {
  if (!selectedMarkets.value.length) { status.value = 'error'; statusText.value = '请至少选择一个市场。'; return; }
  if (!hasValidPrescan.value) { status.value = 'error'; statusText.value = '请先完成市场预扫描，再进行针对性选股扫描。'; return; }
  scanning.value = true; status.value = 'loading';
  statusText.value = '正在按已预扫描的市场环境、重点行业和可关注概念扫描候选股票…';
  try {
    const q = new URLSearchParams({
      markets: selectedMarkets.value.join(','),
      limit: String(settings.scanLimit),
      force: '1',
    });
    const data = await fetchJson('/api/scan?' + q.toString());
    rows.value = data.candidates || [];
    scanContext.value = {
      ...scanContext.value,
      marketRegime: data.marketRegime || scanContext.value.marketRegime,
      strategy: data.strategy || scanContext.value.strategy,
      focusThemes: Array.isArray(data.focusThemes) ? data.focusThemes : scanContext.value.focusThemes,
      focusConcepts: Array.isArray(data.focusConcepts) ? data.focusConcepts : scanContext.value.focusConcepts,
      scanScope: data.scanScope || scanContext.value.scanScope,
    snapshotDate: data.snapshotDate || scanContext.value.snapshotDate,
      prefilter: data.prefilter || { matched: 0, confirmed: 0, klineMissing: 0 },
    };
    usedSource.value = data.dataSource || 'live';
    snapshotDate.value = data.snapshotDate || '';
    if (cnWatchSessionActive() || cnAfterMarketClose()) requestKlineSync('scan', rows.value.map((row) => row.code));
    const marketNote = data.marketLabel && data.marketLabel.length ? '（' + data.marketLabel.join('、') + '）' : '';
    const byMarketText = (data.byMarket || []).map((m) => `${m.label} 实时 ${m.count} 只`).join(' · ');
    const hitTotal = data.autoPool && Number(data.autoPool.hitTotal) || 0;
    const eligible = data.autoPool && Number(data.autoPool.eligible) || 0;
    const prefilter = data.prefilter || {};
    const gateText = `，可纳入候选池补 K 线 ${eligible} 只`;
    const scopeText = data.scanScope && data.scanScope.mode === 'theme_and_concept_constituents' ? '重点行业与概念成分股' : '全市场回退';
    summary.value = '来源 ' + sourceLabel(data.dataSource) + ' · ' + scopeText + '扫描 ' + data.totalScanned + ' 只' + marketNote + '，快照预筛命中 ' + hitTotal + ' 只' + gateText + '，展示 ' + rows.value.length + ' 只，耗时 ' + (data.ms / 1000).toFixed(1) + 's' + (byMarketText ? '；各市场：' + byMarketText : '');
    if (!rows.value.length) {
      status.value = 'empty';
      statusText.value = hitTotal > 0
        ? `快照预筛命中 ${hitTotal} 只，但当前扫描数量上限未展示任何结果。`
        : '当前市场环境和重点行业范围内没有通过量价预筛的股票。';
    } else {
      status.value = '';
      statusText.value = '';
    }
  } catch (e) {
    status.value = 'error'; statusText.value = '扫描失败：' + e.message;
  } finally {
    scanning.value = false;
  }
}


  // 详情图渲染：openDetail 首次绘制与盘中实时刷新共用同一入口（数据源 klineCache）。
  function renderDetailChart() {
    if (!detailChart) return;
    const kline = klineCache;
    if (!kline.length) return;
    const lastK = kline[kline.length - 1];
const UP = '#ff4545', DOWN = '#20b7c7';
const AXIS = '#9b9b9b', BORDER = '#505050', GRIDL = '#363636';
function ma(list, n) {
  const out = []; let sum = 0;
  for (let i = 0; i < list.length; i++) {
    sum += list[i].close;
    if (i >= n) sum -= list[i - n].close;
    out.push(i >= n - 1 ? +(sum / n).toFixed(2) : null);
  }
  return out;
}
function mav(list, n) {
  const out = []; let sum = 0;
  for (let i = 0; i < list.length; i++) {
    sum += list[i].volume;
    if (i >= n) sum -= list[i - n].volume;
    out.push(i >= n - 1 ? Math.round(sum / n) : null);
  }
  return out;
}
const dates = kline.map(k => k.date);
const ma5 = ma(kline, 5), ma10 = ma(kline, 10), ma20 = ma(kline, 20), ma60 = ma(kline, 60);
const vma5 = mav(kline, 5), vma10 = mav(kline, 10);
const lastVal = (arr) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i]; return '-'; };
const maLatest = { MA5: lastVal(ma5), MA10: lastVal(ma10), MA20: lastVal(ma20), MA60: lastVal(ma60) };
detail.klineDate = lastK.date || '';
detail.evidence = [
  { label: '最新日 K', value: `${lastK.date || '—'} · 收 ${fmtPrice(lastK.close)}`, tone: Number(lastK.close) >= Number(lastK.open) ? 'pos' : 'neg' },
  { label: '均线结构', value: `MA5 ${maLatest.MA5} · MA20 ${maLatest.MA20}` },
  { label: '量比 / 换手', value: `${detail.volumeRatioText} / ${detail.turnoverText}` },
  { label: 'K 线样本', value: `${kline.length} 根前复权日 K` },
];
const volData = kline.map(k => ({ value: k.volume, itemStyle: { color: k.close >= k.open ? UP : DOWN } }));
const ln = (c) => ({ color: c, width: 1.2, opacity: 0.9 });
detailChart.setOption({
  backgroundColor: '#202020',
  animation: false,
  legend: {
    top: 4, left: 10,
    itemWidth: 14, itemHeight: 2,
    textStyle: { color: AXIS, fontSize: 11 },
    data: ['MA5', 'MA10', 'MA20', 'MA60'],
    formatter: (name) => `${name}:${maLatest[name]}`,
  },
  tooltip: {
    trigger: 'axis', axisPointer: { type: 'cross', label: { backgroundColor: '#2a313d' } },
    backgroundColor: 'rgba(20,22,28,0.96)', borderColor: BORDER, textStyle: { color: '#e6e8eb', fontSize: 12 },
    formatter: (params) => {
      const index = params[0] && params[0].dataIndex;
      const item = kline[index];
      if (!item) return '';
      const change = item.open ? ((item.close - item.open) / item.open) * 100 : 0;
      const fv = (x) => (x == null ? '—' : fmtVolume(x));
      return `${item.date}<br/>开 ${fmtPrice(item.open)}　高 ${fmtPrice(item.high)}　低 ${fmtPrice(item.low)}　收 <b>${fmtPrice(item.close)}</b><br/>涨幅 <b style="color:${change >= 0 ? UP : DOWN}">${fmtPct(change)}</b>　成交量 ${fmtVolume(item.volume)}<br/>量能　VMA5 ${fv(vma5[index])}　VMA10 ${fv(vma10[index])}`;
    },
  },
  axisPointer: { link: [{ xAxisIndex: 'all' }], lineStyle: { color: '#7a8390' } },
  grid: [{ left: 54, right: 18, top: 34, height: '55%' }, { left: 54, right: 18, top: '74%', height: '14%' }],
  xAxis: [
    { type: 'category', data: dates, boundaryGap: false, axisLine: { lineStyle: { color: BORDER } }, axisLabel: { color: AXIS, fontSize: 11 }, axisTick: { show: false } },
    { type: 'category', gridIndex: 1, data: dates, boundaryGap: false, axisLabel: { show: false }, axisLine: { lineStyle: { color: BORDER } }, axisTick: { show: false } },
  ],
  yAxis: [
    { scale: true, splitLine: { lineStyle: { color: GRIDL } }, axisLabel: { color: AXIS, fontSize: 11 }, axisLine: { show: false }, axisTick: { show: false } },
    { gridIndex: 1, name: '成交量（股）', nameTextStyle: { color: AXIS, fontSize: 10, padding: [0, 0, 0, -4] }, splitLine: { show: false }, axisLabel: { color: AXIS, fontSize: 10, formatter: (value) => fmtVolume(value) }, axisLine: { show: false }, axisTick: { show: false } },
  ],
  dataZoom: [
    // moveOnMouseMove 关闭：窗口右缘恒定钉在最新 K 线（见 detailChart dataZoom 监听），拖动平移无意义。
    { type: 'inside', xAxisIndex: [0, 1], start: 58, end: 100, zoomOnMouseWheel: true, moveOnMouseMove: false },
    { type: 'slider', xAxisIndex: [0, 1], start: 58, end: 100, bottom: 8, height: 18, borderColor: BORDER, fillerColor: 'rgba(174,182,189,0.18)', handleStyle: { color: '#aeb6bd' }, textStyle: { color: AXIS } },
  ],
  series: [
    { type: 'candlestick', name: '日K', data: kline.map(k => [k.open, k.close, k.low, k.high]), itemStyle: { color: UP, color0: DOWN, borderColor: UP, borderColor0: DOWN } },
    { type: 'line', name: 'MA5', data: ma5, smooth: true, symbol: 'none', connectNulls: false, lineStyle: ln('#f7d451'), emphasis: { disabled: true } },
    { type: 'line', name: 'MA10', data: ma10, smooth: true, symbol: 'none', connectNulls: false, lineStyle: ln('#ff8ab0'), emphasis: { disabled: true } },
    { type: 'line', name: 'MA20', data: ma20, smooth: true, symbol: 'none', connectNulls: false, lineStyle: ln('#66d9ff'), emphasis: { disabled: true } },
    { type: 'line', name: 'MA60', data: ma60, smooth: true, symbol: 'none', connectNulls: false, lineStyle: ln('#ffa94d'), emphasis: { disabled: true } },
    { type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: volData, barWidth: '60%' },
    { type: 'line', xAxisIndex: 1, yAxisIndex: 1, name: 'VMA5', data: vma5, smooth: true, symbol: 'none', connectNulls: false, lineStyle: ln('rgba(247,212,81,0.8)') },
    { type: 'line', xAxisIndex: 1, yAxisIndex: 1, name: 'VMA10', data: vma10, smooth: true, symbol: 'none', connectNulls: false, lineStyle: ln('rgba(255,138,176,0.8)') },
  ],
});
detailChart.resize();
  }

  // 盘中实时刷新详情头部报价文本（现价/涨跌幅等）；K 线数据永远以本地 K 线库为准，不用报价改写。
  // 首个周期必刷拿到最新报价，其后仅盘中轮询（午间休市与闭市暂停）。
  function applyDetailQuoteTexts(quote) {
    if (!detail.open || !quote || String(quote.code || '') !== detail.code) return;
    if (Number.isFinite(Number(quote.price)) && Number(quote.price) > 0) detail.priceText = fmtPrice(quote.price);
    if (Number.isFinite(Number(quote.changePct))) { detail.changePct = Number(quote.changePct); detail.changeText = fmtPct(quote.changePct); }
    if (Number.isFinite(Number(quote.open))) detail.openText = fmtPrice(quote.open);
    if (Number.isFinite(Number(quote.high))) detail.highText = fmtPrice(quote.high);
    if (Number.isFinite(Number(quote.low))) detail.lowText = fmtPrice(quote.low);
    if (Number.isFinite(Number(quote.volume))) detail.volumeText = fmtVolume(quote.volume);
    if (Number.isFinite(Number(quote.amount))) detail.amountText = fmtAmount(quote.amount);
    if (Number.isFinite(Number(quote.turnover))) detail.turnoverText = fmtRatio(quote.turnover, '%');
    if (Number.isFinite(Number(quote.volumeRatio))) detail.volumeRatioText = fmtRatio(quote.volumeRatio);
  }

  function ensureDetailLive() {
    if (detailLiveTimer) return;
    detailLiveTimer = setInterval(async () => {
      if (!detail.open || !klineCache.length) return;
      detailLiveTicks += 1;
      if (detailLiveTicks > 1 && !cnWatchSessionActive()) return;
      try {
        const data = await fetchJson('/api/watchlist/quotes?codes=' + encodeURIComponent(detail.code));
        const quote = data && data.quotes && data.quotes[0];
        if (quote) applyDetailQuoteTexts(quote);
      } catch { /* 忽略单次实时刷新失败 */ }
    }, 5000);
  }
  function stopDetailLive() {
    if (detailLiveTimer) { clearInterval(detailLiveTimer); detailLiveTimer = null; }
  }

async function openDetail(r) {
  const sessionId = ++detailSessionId;
  dialogReturnFocus.detail = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  detail.open = true; detail.code = r.code; detail.name = r.name;
  detail.row = r;
  detail.kline = [];
  detail.klineDate = '';
  detail.evidence = [];
  detail.patternHits = [];
  detail.checkedPatternRules = 0;
  klineCache = [];
  detailLiveTicks = 0;
  detail.aiBusy = false; detail.aiText = ''; detail.aiRun = false; detail.aiError = false; detail.aiUpdatedAt = ''; detail.aiModel = '';
  detail.aiVerdict = ''; detail.aiChanges = []; detail.aiEvidence = []; detail.aiRisks = []; detail.aiWatchPoints = [];
  detail.aiLastSuccess = null; detail.aiEvidenceDates = null; detail.aiReasons = []; detail.aiSampleStatus = ''; detail.aiPriceLevels = null;
  detail.aiRaw = ''; detail.aiErrorText = ''; detail.aiTheme = null; detail.aiThemeDate = '';
  detail.aiRecordStatus = 'none'; detail.aiRecordAt = null; detail.aiRecordEvidenceDates = null;
  detail.loading = true;
  detail.pattern = r.pattern || '';
  if (cnWatchSessionActive() || cnAfterMarketClose()) requestKlineSync('detail', [r.code]);
  detail.error = '';
  detail.changePct = Number(r.changePct) || 0;
  detail.priceText = fmtPrice(r.price);
  detail.changeText = fmtPct(r.changePct);
  detail.openText = fmtPrice(r.open);
  detail.highText = fmtPrice(r.high);
  detail.lowText = fmtPrice(r.low);
  detail.volumeText = fmtVolume(r.volume);
  detail.amountText = fmtAmount(r.amount || (Number(r.amountYi) || 0) * 1e8);
  detail.turnoverText = fmtRatio(r.turnover, '%');
  detail.volumeRatioText = fmtRatio(r.volumeRatio);
  await nextTick();
  focusDialog('detail');
  let kline = [];
  try {
    // 本地已有数据时统一复用 SQLite，避免批量研判期间实时源限流导致弹框空数据。
    const q = new URLSearchParams({ code: r.code, dataSource: 'local' });
    kline = (await fetchJson('/api/kline?' + q.toString())).kline || [];
  } catch (e) {
    if (sessionId !== detailSessionId) return;
    detail.loading = false;
    detail.error = 'K 线加载失败，请稍后重试。';
    return;
  }
  if (sessionId !== detailSessionId) return;
  detail.loading = false;
  if (kline.length) {
    detail.kline = kline; klineCache = kline;
  }
  if (!kline.length) {
    detail.error = '暂无可用的日 K 数据。';
    return;
  }

  // 详情页使用刚加载的同一份 K 线复核形态，避免与候选池展示脱节。
  try {
    const patterns = await fetchJson('/api/kline/patterns', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: r.code, kline }),
    });
    detail.patternHits = Array.isArray(patterns.hits) ? patterns.hits : [];
    detail.checkedPatternRules = Number(patterns.checkedRules) || 0;
    detail.pattern = detail.patternHits.map((x) => x.label).join('、');
  } catch { /* 形态检测失败不阻断 K 线展示 */ }

  const lastK = kline[kline.length - 1];
  const prevK = kline.length > 1 ? kline[kline.length - 2] : null;
  // 头部价格与涨跌幅以本地 K 线库为准（与图表同源同值），成交额优先用 K 线当日值。
  detail.priceText = fmtPrice(lastK.close);
  detail.openText = fmtPrice(lastK.open);
  detail.highText = fmtPrice(lastK.high);
  detail.lowText = fmtPrice(lastK.low);
  detail.volumeText = fmtVolume(lastK.volume);
  if (lastK.amount) detail.amountText = fmtAmount(lastK.amount);
  if (prevK && Number(prevK.close) > 0) {
    detail.changePct = ((lastK.close - prevK.close) / prevK.close) * 100;
    detail.changeText = fmtPct(detail.changePct);
  }
  await nextTick();
  const el = document.getElementById('chart');
  if (!el) return;
  if (detailChart) detailChart.dispose();
  detailChart = echarts.init(el);
  // 数据窗口右缘恒定钉在最新一根 K 线：滚轮缩放 / 滑杆调整只保留窗口宽度，
  // end 一律归位 100，避免“先放大再缩小”后最新 K 线被推出右侧可视区。
  detailChart.on('dataZoom', () => {
    const dzs = detailChart.getOption().dataZoom;
    const dz = dzs && dzs[0];
    if (!dz) return;
    const start = Number(dz.start ?? 0);
    const end = Number(dz.end ?? 100);
    const span = Math.max(1, Math.min(100, end - start));
    const pinnedStart = 100 - span;
    if (Math.abs(end - 100) > 0.01 || Math.abs(start - pinnedStart) > 0.01) {
      detailChart.dispatchAction({ type: 'dataZoom', start: pinnedStart, end: 100 });
    }
  });
  window.addEventListener('resize', resizeDetailChart, { passive: true });
  if (window.ResizeObserver) {
    detailChartObserver = new ResizeObserver(() => resizeDetailChart());
    detailChartObserver.observe(el);
  }
  renderDetailChart();
  ensureDetailLive();
  // 二次打开详情：读回本地 SQLite 中最近一次研判记录，直接展示历史结论。
  try {
    const hist = await fetchJson('/api/ai/record?code=' + encodeURIComponent(detail.code));
    if (hist && hist.ok) {
      if (hist.record && typeof hist.record === 'object') {
        applyStoredJudgment(hist.record, {
          levels: hist.levels || null,
          prevSuccess: (hist.prevSuccess && typeof hist.prevSuccess === 'object') ? hist.prevSuccess : null,
          errorMessage: hist.errorMessage,
        });
        detail.aiRecordStatus = String(hist.status || hist.record.judgmentStatus || 'success');
      } else if (hist.lastFailed && typeof hist.lastFailed === 'object') {
        applyStoredJudgment(hist.lastFailed, { errorMessage: hist.errorMessage || null });
      } else {
        detail.aiRecordStatus = 'none';
        detail.aiRecordAt = null;
        detail.aiRecordEvidenceDates = null;
      }
    }
  } catch { /* 本地历史接口未就绪时忽略，不阻断 K 线展示 */ }
  // 价位（建仓/止损/止盈）每次打开必现：优先读已落库价位集，缺失时按当前 K 线现算并持久化。
  try {
    const lv = await fetchJson('/api/kline/levels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: detail.code }) });
    if (lv && lv.ok && lv.levels) {
      detail.aiPriceLevels = normalizeLevelsUi(lv.levels);
      repaintPriceLevels(detail.aiPriceLevels);
    }
  } catch { /* 价位计算失败不阻断 K 线展示 */ }
}

function normalizeLevelsUi(levels) {
  if (!levels || typeof levels !== 'object') return null;
  if (typeof levels.available === 'boolean') return levels;
  const hasContent = (Array.isArray(levels.supportZones) && levels.supportZones.length)
    || (Array.isArray(levels.resistanceZones) && levels.resistanceZones.length)
    || (Array.isArray(levels.entryTriggers) && levels.entryTriggers.length)
    || (Array.isArray(levels.exitWatchZones) && levels.exitWatchZones.length);
  return { ...levels, available: hasContent, algorithmVersion: String(levels.algorithmVersion || 'levels-v1') };
}

// 将 SQLite 落库记录回填到详情弹框（二次打开/研判成功后共用同一字段口径）。
function applyStoredJudgment(rec, opts = {}) {
  const mr = rec && rec.modelResult && typeof rec.modelResult === 'object' ? rec.modelResult : null;
  const ev = rec && rec.evidence && typeof rec.evidence === 'object' ? rec.evidence : null;
  const dates = ev && ev.evidenceDates && typeof ev.evidenceDates === 'object' ? ev.evidenceDates : null;
  const success = rec && rec.judgmentStatus === 'success' && mr;
  detail.aiRun = true;
  detail.aiModel = String((rec && rec.model) || settings.ai.model || '');
  detail.aiRecordStatus = String((rec && rec.judgmentStatus) || (success ? 'success' : 'failed'));
  detail.aiRecordAt = Number((rec && rec.finishedAt) || 0) || Date.now();
  detail.aiRecordEvidenceDates = dates || {};
  detail.aiUpdatedAt = fmtTime(detail.aiRecordAt);
  detail.aiLastSuccess = opts.prevSuccess || null;
  detail.aiEvidenceDates = dates;
  detail.aiTheme = (ev && ev.theme && typeof ev.theme === 'object') ? ev.theme : null;
  detail.aiThemeDate = (dates && dates.themeDate) || '';
  detail.aiPriceLevels = normalizeLevelsUi(opts.levels || null);
  detail.aiSampleStatus = String((rec && rec.dataStatus) || opts.sampleStatus || '');
  if (success) {
    detail.aiError = false;
    detail.aiErrorText = '';
    detail.aiText = String(mr.summary || '').trim();
    detail.aiVerdict = String(mr.verdict || '');
    detail.aiChanges = Array.isArray(mr.changes) ? mr.changes : [];
    detail.aiEvidence = Array.isArray(mr.evidence) ? mr.evidence : [];
    detail.aiRisks = Array.isArray(mr.risks) ? mr.risks : [];
    detail.aiWatchPoints = Array.isArray(mr.watchPoints) ? mr.watchPoints : [];
    detail.aiRaw = String((rec && (rec.rawContent || rec.rawText)) || '');
  } else {
    detail.aiError = true;
    detail.aiErrorText = String((rec && (rec.errorMessage || rec.error)) || opts.errorMessage || '上次研判失败，可点击按钮重试。');
    detail.aiText = '';
    detail.aiVerdict = '';
    detail.aiChanges = [];
    detail.aiEvidence = [];
    detail.aiRisks = [];
    detail.aiWatchPoints = [];
    detail.aiRaw = '';
  }
}

async function runAiDetail() {
  if (!detail.code || !detail.kline || !detail.kline.length) {
    detail.aiErrorText = '请先加载 K 线数据后再发起 AI 研判。';
    detail.aiError = true;
    detail.aiRun = true;
    return;
  }
  if (detail.aiBusy) return;
  detail.aiBusy = true;
  detail.aiError = false;
  detail.aiErrorText = '';
  try {
    const res = await fetchJson('/api/ai/judge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: detail.code }),
    });
    const rec = (res && res.record && typeof res.record === 'object') ? res.record : null;
    const mr = rec && rec.modelResult && typeof rec.modelResult === 'object' ? rec.modelResult : null;
    if (res && res.ok && rec && mr) {
      applyStoredJudgment(rec, {
        levels: (res.levels && typeof res.levels === 'object') ? res.levels : null,
        prevSuccess: (res.lastSuccess && typeof res.lastSuccess === 'object') ? res.lastSuccess : null,
        sampleStatus: res.sampleStatus,
      });
      detail.aiReasons = Array.isArray(res.reasons) ? res.reasons : [];
      const evDates = (res.evidenceDates && typeof res.evidenceDates === 'object') ? res.evidenceDates : null;
      if (evDates) {
        detail.aiEvidenceDates = evDates;
        detail.aiRecordEvidenceDates = evDates;
      }
      repaintPriceLevels(detail.aiPriceLevels);
      loadPoolJudgments();
    } else {
      detail.aiRun = true;
      const message = (res && res.message) || (res && res.error) || 'AI 研判失败，请检查设置页配置或稍后重试。';
      if (res && res.judgmentStatus === 'no_change') {
        detail.aiError = false;
        detail.aiErrorText = '';
        detail.aiText = '无新增证据，上次判断保持不变。';
        detail.aiLastSuccess = (res.lastSuccess && typeof res.lastSuccess === 'object') ? res.lastSuccess : null;
        detail.aiEvidenceDates = (res.evidenceDates && typeof res.evidenceDates === 'object') ? res.evidenceDates : null;
        detail.aiSampleStatus = String(res.sampleStatus || '');
        detail.aiReasons = Array.isArray(res.reasons) ? res.reasons : [];
        detail.aiPriceLevels = (res.levels && typeof res.levels === 'object') ? res.levels : null;
        detail.aiTheme = (res.theme && typeof res.theme === 'object') ? res.theme : null;
        detail.aiThemeDate = (res.evidenceDates && res.evidenceDates.themeDate) || (res.theme && res.theme.fetchedAt) || '';
        const last = (res.lastSuccess && typeof res.lastSuccess === 'object') ? res.lastSuccess : null;
        const evDates = (res.evidenceDates && typeof res.evidenceDates === 'object') ? res.evidenceDates : (last && last.evidenceDates) || null;
        detail.aiRecordStatus = 'success';
        detail.aiRecordAt = Number((last && last.finishedAt) || res.finishedAt || 0) || Date.now();
        detail.aiRecordEvidenceDates = evDates || {};
        detail.aiUpdatedAt = fmtTime(detail.aiRecordAt);
        repaintPriceLevels(detail.aiPriceLevels);
        loadPoolJudgments();
        return;
      }
      detail.aiError = true;
      if (detail.aiRecordStatus !== 'success') {
        detail.aiRecordStatus = 'failed';
        detail.aiRecordAt = Date.now();
        detail.aiRecordEvidenceDates = null;
      }
      if (detail.aiRun && (detail.aiVerdict || detail.aiText)) {
        detail.aiErrorText = '本次研判失败，上次结论保留如下：' + message;
      } else {
        detail.aiErrorText = message;
        detail.aiText = '';
        detail.aiVerdict = '';
        detail.aiChanges = [];
        detail.aiEvidence = [];
        detail.aiRisks = [];
        detail.aiWatchPoints = [];
        detail.aiRaw = '';
      }
      detail.aiUpdatedAt = new Date().toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    }
  } catch (e) {
    detail.aiRun = true;
    detail.aiError = true;
    detail.aiErrorText = 'AI 研判请求失败：' + (e && e.message || '网络错误');
    if (detail.aiRecordStatus !== 'success') {
      detail.aiRecordStatus = 'failed';
      detail.aiRecordAt = Date.now();
      detail.aiRecordEvidenceDates = null;
    }
    detail.aiUpdatedAt = new Date().toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } finally {
    detail.aiBusy = false;
  }
}

async function refreshDetail() {
  if (!detail.row || detail.loading) return;
  const aiState = {
    text: detail.aiText, run: detail.aiRun, error: detail.aiError, updatedAt: detail.aiUpdatedAt, model: detail.aiModel,
    verdict: detail.aiVerdict, changes: detail.aiChanges, evidence: detail.aiEvidence, risks: detail.aiRisks, watchPoints: detail.aiWatchPoints,
    lastSuccess: detail.aiLastSuccess, evidenceDates: detail.aiEvidenceDates, reasons: detail.aiReasons, sampleStatus: detail.aiSampleStatus,
    priceLevels: detail.aiPriceLevels, raw: detail.aiRaw, errorText: detail.aiErrorText, theme: detail.aiTheme, themeDate: detail.aiThemeDate,
    recordStatus: detail.aiRecordStatus, recordAt: detail.aiRecordAt, recordEvidenceDates: detail.aiRecordEvidenceDates,
  };
  await openDetail(detail.row);
  Object.assign(detail, {
    aiText: aiState.text, aiRun: aiState.run, aiError: aiState.error, aiUpdatedAt: aiState.updatedAt, aiModel: aiState.model,
    aiVerdict: aiState.verdict, aiChanges: aiState.changes, aiEvidence: aiState.evidence, aiRisks: aiState.risks, aiWatchPoints: aiState.watchPoints,
    aiLastSuccess: aiState.lastSuccess, aiEvidenceDates: aiState.evidenceDates, aiReasons: aiState.reasons, aiSampleStatus: aiState.sampleStatus,
    aiPriceLevels: aiState.priceLevels, aiRaw: aiState.raw, aiErrorText: aiState.errorText, aiTheme: aiState.theme, aiThemeDate: aiState.themeDate,
    aiRecordStatus: aiState.recordStatus, aiRecordAt: aiState.recordAt, aiRecordEvidenceDates: aiState.recordEvidenceDates,
  });
}

function closeDetail() {
  detailSessionId += 1;
  detail.open = false;
  stopDetailLive();
  if (detailChartObserver) { detailChartObserver.disconnect(); detailChartObserver = null; }
  window.removeEventListener('resize', resizeDetailChart);
  if (detailChart) { detailChart.dispose(); detailChart = null; }
  restoreDialogFocus('detail');
}

// ══════════ 自选盯盘 ══════════
async function loadWatchlist() {
  try {
    const data = await fetchJson('/api/watchlist');
    // 置顶股票优先展示；兼容旧数据：手工添加记录默认视为置顶。
    watchlist.value = ((data && data.watchlist) || []).slice().sort((a, b) => {
      const ap = a && (a.pinned === true || (a.pinned == null && a.source === 'manual')) ? 1 : 0;
      const bp = b && (b.pinned === true || (b.pinned == null && b.source === 'manual')) ? 1 : 0;
      return bp - ap;
    });
    const activeCodes = new Set(watchlist.value.map((item) => String(item && item.code || '')).filter((code) => /^\d{6}$/.test(code)));
    watchKlines.value = Object.fromEntries(Object.entries(watchKlines.value).filter(([code]) => activeCodes.has(code)));
    watchLevels.value = Object.fromEntries(Object.entries(watchLevels.value).filter(([code]) => activeCodes.has(code)));
  } catch { /* 后端未就绪忽略 */ }
  await loadWatchKlines();
  loadWatchLevels();
  completeWatchKlines();
}

// 盯盘页 K 线卡片：按自选代码批量拉取本地日 K（60 秒缓存，避免轮询期间反复全量拉取）。
const watchKlines = ref({});
let watchKlineSeq = 0;
async function loadWatchKlines(force = false, onlyCodes = null) {
  const allow = onlyCodes ? new Set((Array.isArray(onlyCodes) ? onlyCodes : []).map(String)) : null;
  const codes = watchlist.value.map((w) => String(w.code || '')).filter((c) => /^\d{6}$/.test(c) && (!allow || allow.has(c)));
  const seq = ++watchKlineSeq;
  for (const code of codes) {
    if (seq !== watchKlineSeq) return; // 名单变化时中止过期批次
    const cached = watchKlines.value[code];
    if (!force && cached && !cached.loading && !cached.error && Date.now() - (cached.updatedAt || 0) < 60000) continue;
    watchKlines.value = { ...watchKlines.value, [code]: { ...(cached || {}), loading: true, error: '' } };
    try {
      const data = await fetchJson('/api/kline?code=' + code + '&dataSource=local');
      if (seq !== watchKlineSeq) return;
      watchKlines.value = { ...watchKlines.value, [code]: { bars: (data && data.kline) || [], loading: false, error: '', updatedAt: Date.now() } };
    } catch (e) {
      if (seq !== watchKlineSeq) return;
      watchKlines.value = { ...watchKlines.value, [code]: { ...(watchKlines.value[code] || {}), loading: false, error: 'K 线加载失败' } };
    }
  }
}

// 实时行情回写当日 K 线：自动刷新拿到 live 报价后，把每只票的最后一根日 K
// 就地更新为当日实时值（收盘=最新价、高低点扩展、量能替换），图表随轮询跳动。
// 仅在数据源为 live_quote（盘中）时生效；闭市快照不合成 K 线，避免伪造非交易日数据。
function cnToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
// 日 K 同步由应用全局协调：自选、候选池、扫描结果和已打开详情共用同一服务。
const watchCompleting = ref(false);
const klineSyncBusy = ref(false);
let klineSyncTimer = null;
let klineSyncQueuedCodes = new Set();
let klineSyncQueuedReason = '';
let lastPostCloseSyncDate = '';

function collectKlineSyncCodes(extraCodes = []) {
  return [...new Set([
    ...watchlist.value.map((x) => x && x.code),
    ...pool.value.map((x) => x && x.code),
    ...rows.value.map((x) => x && x.code),
    detail.open ? detail.code : '',
    ...(Array.isArray(extraCodes) ? extraCodes : []),
  ].map((x) => String(x || '').trim()).filter((x) => /^\d{6}$/.test(x)))];
}

async function reloadDetailMarketData() {
  if (!detail.open || !detail.code) return;
  const code = detail.code;
  try {
    const kline = (await fetchJson('/api/kline?code=' + encodeURIComponent(code) + '&dataSource=local')).kline || [];
    if (!detail.open || detail.code !== code || !kline.length) return;
    detail.kline = kline; klineCache = kline;
    const last = kline[kline.length - 1], prev = kline[kline.length - 2];
    detail.klineDate = last.date || '';
    detail.priceText = fmtPrice(last.close); detail.openText = fmtPrice(last.open); detail.highText = fmtPrice(last.high); detail.lowText = fmtPrice(last.low);
    detail.volumeText = fmtVolume(last.volume); if (last.amount) detail.amountText = fmtAmount(last.amount);
    if (prev && Number(prev.close) > 0) { detail.changePct = ((last.close - prev.close) / prev.close) * 100; detail.changeText = fmtPct(detail.changePct); }
    const patterns = await fetchJson('/api/kline/patterns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, kline }) });
    if (!detail.open || detail.code !== code) return;
    detail.patternHits = Array.isArray(patterns.hits) ? patterns.hits : [];
    detail.checkedPatternRules = Number(patterns.checkedRules) || 0;
    detail.pattern = detail.patternHits.map((x) => x.label).join('、');
    renderDetailChart();
    const levels = await fetchJson('/api/kline/levels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    if (detail.open && detail.code === code && levels && levels.ok && levels.levels) { detail.aiPriceLevels = normalizeLevelsUi(levels.levels); repaintPriceLevels(detail.aiPriceLevels); }
  } catch { /* 单次市场数据刷新失败不影响保留的详情与 AI 记录 */ }
}

async function handleKlineSyncChanged(changedCodes, summaries = {}) {
  const changed = [...new Set((Array.isArray(changedCodes) ? changedCodes : []).map(String))];
  if (!changed.length) return;
  const set = new Set(changed);
  await loadWatchlist();
  await loadWatchKlines(true, changed);
  await loadWatchLevels();
  if (changed.some((code) => pool.value.some((item) => String(item.code) === code))) await loadPool(true);
  rows.value = rows.value.map((row) => {
    const summary = summaries[row.code];
    return summary ? { ...row, price: summary.price, changePct: summary.changePct } : row;
  });
  if (detail.open && set.has(detail.code)) await reloadDetailMarketData();
}

async function requestKlineSync(reason = 'manual', extraCodes = [], force = false, scope = 'managed') {
  const requestedCodes = scope === 'watch'
    ? watchlist.value.map((x) => x && x.code).filter((x) => /^\d{6}$/.test(String(x || '')))
    : collectKlineSyncCodes(extraCodes);
  requestedCodes.forEach((code) => klineSyncQueuedCodes.add(code));
  klineSyncQueuedReason = reason || klineSyncQueuedReason || 'manual';
  if (klineSyncBusy.value) return;
  const codes = [...klineSyncQueuedCodes];
  klineSyncQueuedCodes = new Set();
  const requestReason = klineSyncQueuedReason;
  klineSyncQueuedReason = '';
  if (!codes.length) return;
  klineSyncBusy.value = true;
  if (force) watchCompleting.value = true;
  try {
    const result = await fetchJson('/api/kline/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codes, reason: requestReason, force, scope }) });
    if (result && result.queued) {
      if (force) { watchAddMsg.value = '已有 K 线同步任务正在运行，已加入等待队列。'; watchAddMsgError.value = false; }
      return;
    }
    if (result && !result.running) await handleKlineSyncChanged(result.changedCodes, result.summaries || {});
    if (force) {
      const failed = (result && result.results || []).filter((x) => x.error).length;
      const changed = (result && result.changedCodes || []).length;
      const firstFailure = (result && result.results || []).find((x) => x.error);
      const reason = firstFailure ? `（${firstFailure.code}：${firstFailure.error}）` : '';
      watchAddMsg.value = `K 线补全完成：检查 ${(result && result.checked) || 0} 只，更新 ${changed} 只` + (failed ? `，失败 ${failed} 只${reason}` : '');
      watchAddMsgError.value = failed > 0;
    }
  } catch (e) {
    if (force) { watchAddMsg.value = 'K 线补全失败：' + e.message; watchAddMsgError.value = true; }
  } finally {
    klineSyncBusy.value = false;
    watchCompleting.value = false;
    if (klineSyncQueuedCodes.size) requestKlineSync('queued');
  }
}

function stopKlineSyncScheduler() { if (klineSyncTimer) { clearInterval(klineSyncTimer); klineSyncTimer = null; } }
function startKlineSyncScheduler() {
  stopKlineSyncScheduler();
  const seconds = Math.min(Math.max(Math.round(Number(settings.klineSyncIntervalSec) || 300), 30), 3600);
  klineSyncTimer = setInterval(() => {
    if (document.hidden) return;
    if (cnWatchSessionActive()) requestKlineSync('interval');
    else if (cnAfterMarketClose() && lastPostCloseSyncDate !== cnShanghaiClock().date) {
      lastPostCloseSyncDate = cnShanghaiClock().date;
      requestKlineSync('post-close');
    }
  }, seconds * 1000);
  if (cnAfterMarketClose()) { lastPostCloseSyncDate = cnShanghaiClock().date; requestKlineSync('post-close'); }
}
function restartKlineSyncScheduler() { startKlineSyncScheduler(); }
async function completeWatchKlines(force = false) { return requestKlineSync(force ? 'manual' : 'watch', [], force, force ? 'watch' : 'managed'); }

// 盯盘卡片的价位文本（建仓/止损/止盈）：逐票读取已落库价位集（缺失时服务端现算并持久化）。
const watchLevels = ref({});
let watchLevelsSeq = 0;
async function loadWatchLevels() {
  const codes = watchlist.value.map((w) => String(w.code || '')).filter((c) => /^\d{6}$/.test(c));
  const seq = ++watchLevelsSeq;
  await Promise.all(codes.map(async (code) => {
    try {
      const r = await fetchJson('/api/kline/levels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      if (seq !== watchLevelsSeq) return;
      if (r && r.ok && r.levels) watchLevels.value = { ...watchLevels.value, [code]: r.levels };
    } catch { /* 忽略单票失败 */ }
  }));
}

async function refreshWatch() {
  if (!watchlist.value.length) { watchQuotes.value = []; return; }
  watchRefreshing.value = true; watchQuotesError.value = '';
  const q = new URLSearchParams({ codes: watchlist.value.map((w) => w.code).join(',') });
  try {
    const data = await fetchJson('/api/watchlist/quotes?' + q.toString());
    watchQuotes.value = (data && data.quotes) || [];
    // 实时源可能缺 changePct：用现价与昨收补算，涨跌统计与卡片着色都依赖它。
    for (const quote of watchQuotes.value) {
      if (quote.changePct == null) {
        const price = Number(quote.price);
        const prevClose = Number(quote.prevClose);
        if (Number.isFinite(price) && Number.isFinite(prevClose) && prevClose > 0) {
          quote.changePct = ((price - prevClose) / prevClose) * 100;
        }
      }
    }
    watchDataDate.value = (data && data.asOf) || '';
    watchDataSource.value = (data && data.source) || '';
    settings.watchDataLabel = watchDataLabel.value;
    watchAlerts.value = (data && data.alerts) || [];
    lastUpdate.value = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  } catch (e) {
    watchQuotesError.value = '行情刷新失败：' + e.message;
  } finally {
    watchRefreshing.value = false;
  }
}

async function addWatch() {
  const code = watchInput.value.trim();
  if (!/^\d{6}$/.test(code)) { watchAddMsg.value = '请输入 6 位股票代码'; watchAddMsgError.value = true; return; }
  addingWatch.value = true; watchAddMsg.value = ''; watchAddMsgError.value = false;
  try {
    const r = await fetchJson('/api/watchlist?code=' + encodeURIComponent(code) + '&source=manual', { method: 'POST' });
    if (r.ok === true) {
      watchAddMsg.value = '已添加 ' + (r.name || code);
      watchInput.value = '';
      watchCompleteAt = 0;
      await loadWatchlist();
      await refreshWatch();
    } else {
      watchAddMsg.value = r.error || '添加失败';
      watchAddMsgError.value = true;
    }
  } catch (e) {
    watchAddMsg.value = '添加失败：' + e.message;
    watchAddMsgError.value = true;
  } finally {
    addingWatch.value = false;
  }
}

async function removeWatch(code) {
  try {
    await fetchJson('/api/watchlist?code=' + encodeURIComponent(code), { method: 'DELETE' });
    watchAddMsg.value = '';
    watchAddMsgError.value = false;
    await loadWatchlist();
    await refreshWatch();
  } catch (e) {
    watchAddMsg.value = '移除失败：' + e.message;
    watchAddMsgError.value = true;
  }
}

const isWatchPinned = (code) => {
  const item = watchlist.value.find((x) => String(x.code) === String(code));
  return !!(item && (item.pinned === true || (item.pinned == null && item.source === 'manual')));
};

async function toggleWatchPin(code) {
  const item = watchlist.value.find((x) => String(x.code) === String(code));
  if (!item) return;
  try {
    const result = await fetchJson('/api/watchlist?code=' + encodeURIComponent(code), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinned: !isWatchPinned(code) }) });
    if (!result || !result.ok) throw new Error((result && result.error) || '置顶操作失败');
    await loadWatchlist();
    await refreshWatch();
  } catch (e) {
    watchAddMsg.value = '置顶操作失败：' + e.message;
    watchAddMsgError.value = true;
  }
}

async function toggleWatchFromScan(r) {
  if (isWatched(r.code)) { await removeWatch(r.code); return; }
  try {
    const q = new URLSearchParams({ code: r.code, name: r.name, market: r.market });
    await fetchJson('/api/watchlist?' + q.toString(), { method: 'POST' });
    await loadWatchlist();
    await refreshWatch();
  } catch (e) {
    watchAddMsg.value = '添加失败：' + e.message;
    watchAddMsgError.value = true;
  }
}

// ══════════ 候选池 ══════════
function poolSnapshot(r) {
  return {
    code: r.code,
    name: r.name,
    market: r.market,
    price: r.price,
    changePct: r.changePct,
    turnover: r.turnover,
    volumeRatio: r.volumeRatio,
    amountYi: r.amountYi,
    mainNetYi: r.mainNetYi,
    score: r.score,
    pattern: r.pattern,
    patternScore: r.patternScore,
    ruleLabel: r.ruleLabel || '',
    ruleIds: Array.isArray(r.ruleIds) ? r.ruleIds : [],
    snapshotDate: r.snapshotDate || snapshotDate.value || (statusInfo.value.snapshotDates && statusInfo.value.snapshotDates[0]) || '',
    marketRegime: r.marketRegime || null,
    themeEvidence: Array.isArray(r.themeEvidence) ? r.themeEvidence : [],
    scanScope: r.scanScope || null,
    strategyRuleIds: Array.isArray(r.strategyRuleIds) ? r.strategyRuleIds : [],
    deprioritizedRuleIds: Array.isArray(r.deprioritizedRuleIds) ? r.deprioritizedRuleIds : [],
    riskFlags: Array.isArray(r.riskFlags) ? r.riskFlags : [],
    selectionTrace: Array.isArray(r.selectionTrace) ? r.selectionTrace : [],
  };
}

let poolLoadedAt = 0;
async function loadPool(force = false) {
  if (!force && poolLoadedAt && Date.now() - poolLoadedAt < 5000 && pool.value.length) return;
  try {
    const data = await fetchJson('/api/pool');
    pool.value = (data && data.pool) || [];
    poolLoadedAt = Date.now();
    // 首次加载候选池时同步取得研判状态，避免列表先显示“待研判”再逐行跳变。
    await loadPoolJudgments();
    await loadPoolRecommendations();
    loadPoolPatterns();
    const st = data && data.klineState ? data.klineState : {};
    poolPrefetch.running = !!st.running;
    poolPrefetch.done = Number(st.done) || 0;
    poolPrefetch.total = Number(st.total) || 0;
    poolPrefetch.ok = Number(st.ok) || 0;
    poolPrefetch.skipped = Number(st.skipped) || 0;
    poolPrefetch.failed = Number(st.failed) || 0;
    poolPrefetch.current = st.current || '';
    poolPrefetch.startedAt = Number(st.startedAt) || 0;
    poolPrefetch.finishedAt = Number(st.finishedAt) || 0;
    poolPrefetch.lmt = Number(st.lmt) || 250;
    // 批量补 K 线深度：候选池多为几十~几百只，逐只实时读取本地库深度。
    const codes = pool.value.map((x) => x.code).filter(Boolean);
    if (codes.length) {
      const depthData = (await fetchJson('/api/kline-depths', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes }),
      })).depths || [];
      const m = {};
      const latest = {};
      for (const x of depthData) { m[x.code] = x.depth; latest[x.code] = { latestDate: x.latestDate || '', savedAt: x.savedAt || '' }; }
      poolKlineDepths.value = m;
      poolKlineLatestDates.value = latest;
    } else {
      poolKlineDepths.value = {};
      poolKlineLatestDates.value = {};
    }
  } catch { /* 后端未就绪忽略 */ }
}

async function loadPoolJudgments() {
  try {
    const data = await fetchJson('/api/pool/judgments');
    poolJudgments.value = (data && data.judgments) || {};
  } catch {
    poolJudgments.value = {};
  }
}

async function loadBatchStatus() {
  try {
    Object.assign(judgmentBatch, await fetchJson('/api/ai/batch-status'));
  } catch { /* 后端未就绪忽略 */ }
  return { ...judgmentBatch };
}

async function openBatchConfirm(retryOnly = false) {
  judgmentConfirm.open = true;
  judgmentConfirm.loading = true;
  judgmentConfirm.error = '';
  judgmentConfirm.retryOnly = !!retryOnly;
  Object.assign(judgmentConfirm.categories, { first: 0, failedRetry: 0, evidenceUpdate: 0, noChange: 0, notReady: 0 });
  judgmentConfirm.total = 0;
  judgmentConfirm.expectedCalls = 0;
  dialogReturnFocus.batch = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  nextTick(() => focusDialog('batch'));
  try {
    const data = await fetchJson('/api/ai/batch-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retryOnly: !!retryOnly }),
    });
    if (data && data.ok) {
      judgmentConfirm.categories = data.categories || judgmentConfirm.categories;
      judgmentConfirm.total = Number(data.total) || 0;
      judgmentConfirm.expectedCalls = Number(data.expectedCalls) || 0;
      judgmentConfirm.error = '';
    } else {
      judgmentConfirm.error = (data && data.message) || '无法生成研判计划，请先完成 AI 连接配置。';
    }
  } catch (e) {
    judgmentConfirm.error = '获取研判计划失败：' + e.message;
  } finally {
    judgmentConfirm.loading = false;
  }
}

function closeBatchConfirm() {
  judgmentConfirm.open = false;
  judgmentConfirm.loading = false;
  judgmentConfirm.error = '';
  restoreDialogFocus('batch');
}

async function confirmBatch() {
  if (!judgmentConfirm.expectedCalls) return;
  judgmentConfirm.error = '';
  try {
    const res = await fetchJson('/api/ai/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retryOnly: !!judgmentConfirm.retryOnly, concurrency: Number(settings.ai.concurrency) || 3 }),
    });
    Object.assign(judgmentBatch, res);
    judgmentConfirm.open = false;
    ensureBatchPolling();
    poolMsg.value = res && res.started ? '批量 AI 研判已启动，正在逐只研判并落库。' : (res && res.reason === 'running' ? '批量研判已在运行。' : '启动失败');
    poolMsgError.value = !(res && res.started);
  } catch (e) {
    judgmentConfirm.error = '启动批量研判失败：' + e.message;
  }
}

async function stopBatch() {
  try {
    Object.assign(judgmentBatch, await fetchJson('/api/ai/batch', { method: 'DELETE' }));
    await loadPool();
    poolMsg.value = '已停止批量研判，已成功的结论已保存。';
    poolMsgError.value = false;
  } catch (e) {
    poolMsg.value = '停止批量研判失败：' + e.message;
    poolMsgError.value = true;
  }
}

let batchTimer = null;
let batchEvents = null;
let poolJudgmentRefreshTimer = null;
let poolJudgmentRefreshPending = false;
function schedulePoolJudgmentRefresh(immediate = false) {
  poolJudgmentRefreshPending = true;
  if (immediate) {
    if (poolJudgmentRefreshTimer) { clearTimeout(poolJudgmentRefreshTimer); poolJudgmentRefreshTimer = null; }
    poolJudgmentRefreshPending = false;
    loadPoolJudgments();
    return;
  }
  if (poolJudgmentRefreshTimer) return;
  poolJudgmentRefreshTimer = setTimeout(() => {
    poolJudgmentRefreshTimer = null;
    if (poolJudgmentRefreshPending) { poolJudgmentRefreshPending = false; loadPoolJudgments(); }
  }, 3000);
}
function ensureBatchEvents() {
  if (batchEvents || !window.EventSource) return;
  batchEvents = new EventSource('/api/ai/batch-events');
  batchEvents.addEventListener('batch.status', async (ev) => {
    try { Object.assign(judgmentBatch, JSON.parse(ev.data)); schedulePoolJudgmentRefresh(!judgmentBatch.running); } catch { /* 轮询兜底 */ }
  });
  batchEvents.onerror = () => { batchEvents.close(); batchEvents = null; };
}
function ensureBatchPolling() {
  ensureBatchEvents();
  if (batchTimer || !judgmentBatch.running) return;
  batchTimer = setInterval(async () => {
    await loadBatchStatus();
    if (!judgmentBatch.running) {
      clearInterval(batchTimer);
      batchTimer = null;
      await Promise.all([loadPool(true), loadPoolJudgments()]);
    } else {
      schedulePoolJudgmentRefresh();
    }
  }, 1500);
}
function stopBatchPolling() {
  if (batchTimer) { clearInterval(batchTimer); batchTimer = null; }
}

async function loadPoolKlineState() {
  try {
    const st = (await fetchJson('/api/pool/kline-status')) || {};
    poolPrefetch.running = !!st.running;
    poolPrefetch.done = Number(st.done) || 0;
    poolPrefetch.total = Number(st.total) || 0;
    poolPrefetch.ok = Number(st.ok) || 0;
    poolPrefetch.skipped = Number(st.skipped) || 0;
    poolPrefetch.failed = Number(st.failed) || 0;
    poolPrefetch.current = st.current || '';
    poolPrefetch.startedAt = Number(st.startedAt) || 0;
    poolPrefetch.finishedAt = Number(st.finishedAt) || 0;
    poolPrefetch.lmt = Number(st.lmt) || 250;
  } catch { /* 未就绪忽略 */ }
}

async function startPoolKline() {
  poolMsg.value = ''; poolMsgError.value = false;
  try {
    const codes = pool.value.map((x) => x.code).filter(Boolean);
    const res = await fetchJson('/api/pool/kline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes, lmt: settings.fetchDays || 250 }),
    });
    poolMsg.value = res.started ? '已启动候选池 K 线补齐，正在逐只拉取并落库…' : '候选池 K 线补齐已在运行。';
    await loadPoolKlineState();
    ensurePoolKlinePolling();
  } catch (e) {
    poolMsg.value = '启动补齐失败：' + e.message;
    poolMsgError.value = true;
  }
}

async function stopPoolKline() {
  try {
    await fetchJson('/api/pool/kline', { method: 'DELETE' });
    await loadPoolKlineState();
    poolMsg.value = '已停止候选池 K 线补齐。';
  } catch (e) {
    poolMsg.value = '停止失败：' + e.message;
    poolMsgError.value = true;
  }
}

async function postPool(items) {
  poolBusy.value = true; poolMsg.value = ''; poolMsgError.value = false;
  try {
    const res = await fetchJson('/api/pool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    await loadPool();
    const extra = res && res.updated ? `，更新 ${res.updated}` : '';
    poolMsg.value = `已纳入候选池（新增 ${res ? res.added : 0}${extra}，当前 ${pool.value.length}）`;
    return res;
  } catch (e) {
    poolMsg.value = '纳入候选池失败：' + e.message;
    poolMsgError.value = true;
  } finally {
    poolBusy.value = false;
  }
}

async function addToPool(r) {
  if (r.autoPool === false) { poolMsg.value = '弱势退潮结果仅作观察，不能直接纳入候选池'; return; }
  if (isInPool(r.code)) { poolMsg.value = r.name ? r.name + ' 已在候选池' : '该股票已在候选池'; return; }
  return postPool([poolSnapshot(r)]);
}

async function addAllToPool() {
  if (!rows.value.length) return;
  const items = rows.value.filter((row) => row.autoPool !== false).map(poolSnapshot);
  return postPool(items);
}

const isPoolItemBusy = (code, action) => action ? poolItemBusy.value[code] === action : Boolean(poolItemBusy.value[code]);
async function withPoolItemBusy(code, action, task) {
  poolItemBusy.value = { ...poolItemBusy.value, [code]: action };
  try {
    return await task();
  } finally {
    const next = { ...poolItemBusy.value };
    delete next[code];
    poolItemBusy.value = next;
  }
}
async function loadPoolRecommendations() {
  try {
    const data = await fetchJson('/api/pool/recommendations');
    poolRecommendations.value = (data && data.recommendations) || {};
    Object.assign(recommendationBatch, (data && data.status) || {});
  } catch { poolRecommendations.value = {}; }
}
let recommendationTimer = null;
function ensureRecommendationPolling() {
  if (recommendationTimer || !recommendationBatch.running) return;
  recommendationTimer = setInterval(async () => {
    await loadPoolRecommendations();
    if (!recommendationBatch.running) {
      clearInterval(recommendationTimer);
      recommendationTimer = null;
      // 完成提示给出分类分布；弱势市场下规则不产生优先盯盘，需明确告知而不是只报“已保存”。
      const counts = { priority: 0, confirm: 0, not_recommended: 0, insufficient: 0 };
      for (const item of pool.value) {
        const x = poolRecommendations.value[item.code];
        if (x && counts[x.classification] != null) counts[x.classification] += 1;
      }
      const regime = pool.value.length && pool.value[0].marketRegime ? pool.value[0].marketRegime : null;
      const weakNote = regime && regime.status === 'weak' && counts.priority === 0 && counts.confirm > 0
        ? `市场处于「${regime.label}」，规则不产生优先盯盘，全部保留等待确认；可按形态评分与量比择优人工复核。`
        : '';
      poolMsg.value = `盯盘价值评估完成：优先盯盘 ${counts.priority} · 等待确认 ${counts.confirm} · 暂不推荐 ${counts.not_recommended} · 数据不足 ${counts.insufficient}。${weakNote}`;
    }
  }, 800);
}
async function startRecommendations() {
  poolMsg.value = ''; poolMsgError.value = false;
  try { const result = await fetchJson('/api/pool/recommendations', { method: 'POST' }); Object.assign(recommendationBatch, result); poolMsg.value = '已启动候选池盯盘价值评估，结论仅供人工复核。'; ensureRecommendationPolling(); }
  catch (e) { poolMsg.value = '启动评估失败：' + e.message; poolMsgError.value = true; }
}
async function stopRecommendations() { try { await fetchJson('/api/pool/recommendations', { method: 'DELETE' }); poolMsg.value = '正在停止评估，已完成结果会保留。'; } catch (e) { poolMsg.value = '停止评估失败：' + e.message; poolMsgError.value = true; } }

async function deletePoolItem(code) {
  await fetchJson('/api/pool?code=' + encodeURIComponent(code), { method: 'DELETE' });
  // 局部更新：删除成功后立即从当前列表移除，不重新拉取整池和深度数据。
  pool.value = pool.value.filter((item) => item.code !== code);
  const nextJudgments = { ...poolJudgments.value };
  delete nextJudgments[code];
  poolJudgments.value = nextJudgments;
  delete poolKlineDepths.value[code];
  delete poolKlineLatestDates.value[code];
  poolLoadedAt = Date.now();
}

async function removeFromPool(code) {
  return withPoolItemBusy(code, 'remove', async () => {
    try {
      await deletePoolItem(code);
      poolMsg.value = '已从候选池移除';
      poolMsgError.value = false;
    } catch (e) {
      poolMsg.value = '移除失败：' + e.message;
      poolMsgError.value = true;
    }
  });
}

async function clearPool() {
  poolBusy.value = true;
  try {
    await fetchJson('/api/pool?all=1', { method: 'DELETE' });
    pool.value = [];
    poolJudgments.value = {};
      poolKlineDepths.value = {};
      poolKlineLatestDates.value = {};
    poolLoadedAt = Date.now();
    poolMsg.value = '候选池已清空';
    poolMsgError.value = false;
  } catch (e) {
    poolMsg.value = '清空失败：' + e.message;
    poolMsgError.value = true;
  } finally {
    poolBusy.value = false;
  }
}

async function moveToWatch(r) {
  return withPoolItemBusy(r.code, 'move', async () => {
    if (isWatched(r.code)) {
      try {
        await deletePoolItem(r.code);
        poolMsg.value = (r.name || r.code) + ' 已在自选中，已移出候选池';
        poolMsgError.value = false;
      } catch (e) {
        poolMsg.value = '移除失败：' + e.message;
        poolMsgError.value = true;
      }
      return;
    }
    poolMsg.value = ''; poolMsgError.value = false;
    try {
      const q = new URLSearchParams({ code: r.code, name: r.name || '', market: r.market || '' });
      const res = await fetchJson('/api/watchlist?' + q.toString(), { method: 'POST' });
      if (res && res.ok) {
        await deletePoolItem(r.code);
        await loadWatchlist();
        await refreshWatch();
        poolMsg.value = '已转入自选：' + (r.name || r.code);
      } else {
        poolMsg.value = (res && res.error) || '转入自选失败';
        poolMsgError.value = true;
      }
    } catch (e) {
      poolMsg.value = '转入自选失败：' + e.message;
      poolMsgError.value = true;
    }
  });
}

async function moveAllToWatch() {
  poolBusy.value = true; poolMsg.value = ''; poolMsgError.value = false;
  let done = 0; let skipped = 0;
  try {
    for (const r of [...pool.value]) {
      if (isWatched(r.code)) { skipped++; continue; }
      const q = new URLSearchParams({ code: r.code, name: r.name || '', market: r.market || '' });
      const res = await fetchJson('/api/watchlist?' + q.toString(), { method: 'POST' });
      if (res && res.ok) done++; else skipped++;
    }
    await loadPool();
    await loadWatchlist();
    await refreshWatch();
    poolMsg.value = `已转入自选 ${done} 只，跳过 ${skipped} 只；候选池剩余 ${pool.value.length} 只`;
  } catch (e) {
    poolMsg.value = '批量转入失败：' + e.message;
    poolMsgError.value = true;
  } finally {
    poolBusy.value = false;
  }
}

function stopWatchPolling() {
  if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
}
function startWatchPolling() {
  stopWatchPolling();
  watchSessionActive.value = cnWatchSessionActive();
  if (mode.value !== 'watch' || !watchAuto.value || watchIntervalMs.value <= 0) return;
  watchTimer = setInterval(() => {
    // 午间休市与闭市时段行情不变化：跳过拉取，仅更新时段状态（开盘后下一个周期自动恢复刷新）。
    watchSessionActive.value = cnWatchSessionActive();
    if (document.hidden || !watchSessionActive.value) return;
    refreshWatch();
  }, watchIntervalMs.value);
}
function restartWatchPolling() { startWatchPolling(); }
function switchMode(next) {
  if (!['pool', 'watch', 'scan', 'settings'].includes(next)) next = 'pool';
  mode.value = next;
  try { localStorage.setItem('stock-sentinel-active-mode', next); } catch { /* 浏览器存储不可用时不影响切换 */ }
  if (next === 'pool') {
    loadPool(); loadPoolKlineState(); ensurePoolKlinePolling();
    loadBatchStatus().then(ensureBatchPolling);
  } else {
    stopPoolKlinePolling();
    stopBatchPolling();
  }
  if (next === 'watch') {
    watchSessionActive.value = cnWatchSessionActive();
    loadWatchlist().then(() => { refreshWatch(); startWatchPolling(); });
  } else {
    stopWatchPolling();
  }
  if (next === 'settings') { loadSettings(); loadIntegrity(); loadKlineGaps(false); }
}

let poolKlineTimer = null;
function ensurePoolKlinePolling() {
  if (poolKlineTimer || !poolPrefetch.running) return;
  poolKlineTimer = setInterval(async () => {
    await loadPoolKlineState();
    if (!poolPrefetch.running) {
      clearInterval(poolKlineTimer);
      poolKlineTimer = null;
      await loadPool(); // 补完后刷新 K 线深度列
    }
  }, 1500);
}
function stopPoolKlinePolling() {
  if (poolKlineTimer) { clearInterval(poolKlineTimer); poolKlineTimer = null; }
}

let klineGapsLoadedAt = 0;
async function loadKlineGaps(force = false) {
  if (!force && klineGapsLoadedAt && Date.now() - klineGapsLoadedAt < 30000) return;
  klineGaps.loading = true;
  try {
    const lmt = Math.min(Math.max(Math.round(Number(settings.fetchDays) || 250), 20), 500);
    const data = await fetchJson('/api/kline-gaps?lmt=' + lmt);
    Object.assign(klineGaps, {
      loading: false,
      total: data.total || 0,
      complete: data.complete || 0,
      incomplete: data.incomplete || 0,
      missingRows: data.missingRows || 0,
      windowSize: data.windowSize || 0,
      examples: Array.isArray(data.examples) ? data.examples : [],
      worst: Array.isArray(data.worst) ? data.worst : [],
    });
    klineGapsLoadedAt = Date.now();
  } catch {
    Object.assign(klineGaps, { loading: false, total: 0, complete: 0, incomplete: 0, missingRows: 0, windowSize: 0, examples: [], worst: [] });
  }
}

async function loadIntegrity() {
  integrity.loading = true;
  try {
    const data = await fetchJson('/api/data-integrity');
    Object.assign(integrity, {
      needsData: data.needsData === true,
      firstRun: data.firstRun === true,
      missing: Array.isArray(data.missing) ? data.missing : [],
      snapshot: data.snapshot || {},
      kline: data.kline || {},
    });
  } catch { /* 后端未就绪时保持默认 */ }
  finally { integrity.loading = false; }
}
function goPrefetch() {
  switchMode('settings');
  loadPrefetchStatus();
}
function openDataHealth() {
  if (integrity.needsData) return goPrefetch();
  switchMode('settings');
}

let prefetchTimer = null;
async function loadPrefetchStatus() {
  try { Object.assign(prefetch, await fetchJson('/api/prefetch-status')); } catch { /* 后端未就绪忽略 */ }
}
function ensurePrefetchPolling() {
  if (prefetchTimer || !prefetch.running) return;
  prefetchTimer = setInterval(async () => {
    await loadPrefetchStatus();
    if (!prefetch.running) { clearInterval(prefetchTimer); prefetchTimer = null; }
  }, 1500);
}
async function startPrefetch() {
  const lmt = Math.min(Math.max(Math.round(Number(settings.fetchDays) || 250), 20), 500);
  try {
    const q = new URLSearchParams({ markets: selectedMarkets.value.join(','), lmt: String(lmt) });
    const r = await fetchJson('/api/prefetch-kline?' + q.toString());
    Object.assign(prefetch, r);
    ensurePrefetchPolling();
    settingsMsg.value = ''; settingsMsgError.value = false;
  } catch (e) {
    settingsMsg.value = '启动预取失败：' + e.message; settingsMsgError.value = true;
  }
}
async function stopPrefetch() {
  try {
    const r = await fetchJson('/api/prefetch-stop');
    Object.assign(prefetch, r);
    if (prefetchTimer) { clearInterval(prefetchTimer); prefetchTimer = null; }
    settingsMsg.value = '已停止预取。'; settingsMsgError.value = false;
  } catch (e) {
    settingsMsg.value = '停止失败：' + e.message; settingsMsgError.value = true;
  }
}

// ── 设置：读取 / 保存（本地）──
function normalizeSettings(s) {
  const src = s && typeof s === 'object' ? s : {};
  const ai = src.ai && typeof src.ai === 'object' ? src.ai : {};
  const stageConfig = (x) => ({
    provider: typeof x?.provider === 'string' && x.provider ? x.provider : (typeof ai.provider === 'string' && ai.provider ? ai.provider : 'openai-compatible'),
    baseURL: typeof x?.baseURL === 'string' ? x.baseURL : (ai.baseURL || ''),
    apiKey: typeof x?.apiKey === 'string' ? x.apiKey : (ai.apiKey || ''),
    model: typeof x?.model === 'string' ? x.model : (ai.model || ''),
    temperature: Number.isFinite(Number(x?.temperature)) ? Math.min(Math.max(Number(x.temperature), 0), 2) : (Number.isFinite(Number(ai.temperature)) ? Math.min(Math.max(Number(ai.temperature), 0), 2) : 0.7),
    maxTokens: Number.isFinite(Number(x?.maxTokens)) ? Math.min(Math.max(Math.round(Number(x.maxTokens)), 64), 8192) : (Number.isFinite(Number(ai.maxTokens)) ? Math.min(Math.max(Math.round(Number(ai.maxTokens)), 64), 8192) : 8192),
    reasoningEffort: ['low', 'medium', 'high', 'xhigh'].includes(x?.reasoningEffort) ? x.reasoningEffort : (['low', 'medium', 'high', 'xhigh'].includes(ai.reasoningEffort) ? ai.reasoningEffort : 'medium'),
  });
  return {
    fetchDays: Math.min(Math.max(Math.round(Number(src.fetchDays) || 250), 20), 500),
    klineSyncIntervalSec: Math.min(Math.max(Math.round(Number(src.klineSyncIntervalSec) || 300), 30), 3600),
    tradingStyle: ['short', 'medium', 'long'].includes(src.tradingStyle) ? src.tradingStyle : '',
    scanMarkets: [...new Set((Array.isArray(src.scanMarkets) ? src.scanMarkets : []).filter((x) => typeof x === 'string' && x))],
    scanLimit: Math.min(Math.max(Math.round(Number(src.scanLimit) || 500), 1), 500),
    ai: {
      enabled: ai.enabled === true,
      provider: typeof ai.provider === 'string' && ai.provider ? ai.provider : 'openai-compatible',
      baseURL: typeof ai.baseURL === 'string' ? ai.baseURL : '',
      apiKey: typeof ai.apiKey === 'string' ? ai.apiKey : '',
      model: typeof ai.model === 'string' ? ai.model : '',
      temperature: Number.isFinite(Number(ai.temperature)) ? Number(ai.temperature) : 0.7,
      maxTokens: Number.isFinite(Number(ai.maxTokens)) ? Math.min(Math.max(Math.round(Number(ai.maxTokens)), 64), 8192) : 8192,
      concurrency: Number.isFinite(Number(ai.concurrency)) ? Math.min(Math.max(Math.round(Number(ai.concurrency)), 1), 5) : 3,
      reasoningEffort: ['low', 'medium', 'high', 'xhigh'].includes(ai.reasoningEffort) ? ai.reasoningEffort : 'medium',
      first: stageConfig(ai.first), second: stageConfig(ai.second),
    },
  };
}
async function loadSettings() {
  try {
    const data = await fetchJson('/api/settings');
    Object.assign(settings, normalizeSettings(data));
    selectedMarkets.value = settings.scanMarkets.slice();
  } catch { /* 后端未就绪忽略 */ }
  // Prompt 是独立的 SQLite 数据，先清空内置初始值，禁止旧 fallback 泄漏到文本框。
  settings.ai.prompt = '';
  try {
    const promptData = await fetchJson('/api/ai/prompt?_=' + Date.now());
    const promptValue = promptData && promptData.prompt;
    const savedPrompt = (typeof promptValue === 'string' ? promptValue : (promptValue && typeof promptValue.prompt === 'string' ? promptValue.prompt : '')).trim();
    if (savedPrompt) settings.ai.prompt = savedPrompt;
  } catch {
    settingsMsg.value = '专业操盘 Prompt 读取失败，请检查 3110 服务。';
    settingsMsgError.value = true;
  }
}

async function loadPoolPatterns() {
  try {
    const data = await fetchJson('/api/pool/patterns');
    poolPatterns.value = (data && data.patterns) || {};
  } catch {
    poolPatterns.value = {};
  }
}
async function saveSettings() {
  savingSettings.value = true; settingsMsg.value = ''; settingsMsgError.value = false;
  try {
    if (!settings.tradingStyle) throw new Error('请先选择交易方式');
    if (!settings.scanMarkets.length) throw new Error('请至少预选一个扫描市场');
    // normalizeSettings 不包含 Prompt（避免它进入普通设置及 API Key 设置载荷），先保存副本。
    const promptToSave = String(settings.ai.prompt || '').trim();
    if (!promptToSave) throw new Error('专业操盘 Prompt 不能为空');
    const data = await fetchJson('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalizeSettings(settings)),
    });
    if (data && data.ok) {
      Object.assign(settings, normalizeSettings(data.settings || settings));
      selectedMarkets.value = settings.scanMarkets.slice();
      restartKlineSyncScheduler();
      scanContext.value = null; prescanMarketKey.value = ''; rows.value = []; summary.value = '';
      settings.ai.prompt = promptToSave;
      const promptResult = await fetchJson('/api/ai/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptToSave, version: 'current' }),
      });
      if (!promptResult || !promptResult.ok) throw new Error((promptResult && promptResult.error) || '专业操盘 Prompt 保存失败');
      klineGapsLoadedAt = 0;
      settingsMsg.value = '设置已保存（仅本机，已忽略上传）。';
    } else {
      settingsMsg.value = '保存失败：' + ((data && data.error) || '未知错误');
      settingsMsgError.value = true;
    }
  } catch (e) {
    settingsMsg.value = '保存失败：' + e.message;
    settingsMsgError.value = true;
  } finally {
    savingSettings.value = false;
  }
}

function resetScanResults() {
  selectedMarkets.value = settings.scanMarkets.slice();
  scanContext.value = null; prescanMarketKey.value = ''; rows.value = []; summary.value = '';
}
async function saveTradingSettings() {
  savingTradingSettings.value = true; tradingSettingsMsg.value = ''; tradingSettingsMsgError.value = false;
  try {
    if (!settings.tradingStyle) throw new Error('请先选择交易方式');
    const data = await fetchJson('/api/settings/trading', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tradingStyle: settings.tradingStyle }),
    });
    if (!data || !data.ok) throw new Error((data && data.error) || '保存失败');
    Object.assign(settings, normalizeSettings(data.settings || settings));
    tradingSettingsMsg.value = '交易方式已保存。';
  } catch (e) { tradingSettingsMsg.value = '保存失败：' + e.message; tradingSettingsMsgError.value = true; }
  finally { savingTradingSettings.value = false; }
}
async function saveScanPreferences({ scope = 'markets' } = {}) {
  const busy = scope === 'limit' ? savingScanLimit : savingScanSettings;
  const message = scope === 'limit' ? scanLimitMsg : scanSettingsMsg;
  const error = scope === 'limit' ? scanLimitMsgError : scanSettingsMsgError;
  busy.value = true; message.value = ''; error.value = false;
  try {
    if (!settings.scanMarkets.length) throw new Error('请至少预选一个扫描市场');
    const data = await fetchJson('/api/settings/scan-preferences', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scanMarkets: settings.scanMarkets, scanLimit: settings.scanLimit }),
    });
    if (!data || !data.ok) throw new Error((data && data.error) || '保存失败');
    settings.scanMarkets = data.scanPreferences.markets;
    settings.scanLimit = data.scanPreferences.scanLimit;
    resetScanResults();
    message.value = scope === 'limit' ? '扫描股数已保存；请重新预扫描市场。' : '市场类型已保存；请重新预扫描市场。';
  } catch (e) { message.value = '保存失败：' + e.message; error.value = true; }
  finally { busy.value = false; }
}
settings.saveTradingSettings = saveTradingSettings;
settings.saveScanPreferences = () => saveScanPreferences({ scope: 'markets' });
settings.saveScanLimit = () => saveScanPreferences({ scope: 'limit' });

// ── 选股规则热插拔：读取 / 新增 / 编辑 / 删除 / 启停 / 保存 ──
function cloneRule(src) { return JSON.parse(JSON.stringify(src)); }
function freshRule() {
  const pid = patternOptions.value[0] || 'ma_bullish';
  return {
    id: 'rule_' + Math.random().toString(36).slice(2, 8),
    label: '新规则',
    kind: 'kline',
    patternId: pid,
    enabled: true,
    params: {},
    prefilter: { minChangePct: 0, minVolumeRatio: 1 },
  };
}
async function loadRules() {
  try {
    const data = await fetchJson('/api/rules');
    rules.value = (data && data.rules) || [];
    const p = await fetchJson('/api/patterns');
    patterns.value = (p && p.patterns) || [];
  } catch { /* 后端未就绪时不阻塞 */ }
}
function addRule() {
  const r = freshRule();
  rules.value.push(r);
  openRuleEditor(rules.value.length - 1);
  rulesMsg.value = ''; rulesMsgError.value = false;
}
function openRuleEditor(idx) {
  const src = rules.value[idx];
  if (!src) return;
  dialogReturnFocus.rule = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  ruleEditor.index = idx;
  ruleEditor.draft = cloneRule(src);
  ruleEditor.open = true;
  nextTick(() => focusDialog('rule'));
}
function closeRuleEditor() {
  ruleEditor.open = false; ruleEditor.index = -1; ruleEditor.draft = null;
  restoreDialogFocus('rule');
}
function focusDialog(kind) {
  const dialog = document.querySelector(dialogSelector[kind]);
  if (!dialog) return;
  const first = dialog.querySelector('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
  (first || dialog).focus();
}
function restoreDialogFocus(kind) {
  const target = dialogReturnFocus[kind];
  dialogReturnFocus[kind] = null;
  nextTick(() => {
    if (target && document.contains(target)) target.focus();
  });
}
function handleModalKeydown(event, kind) {
  if (event.key === 'Escape') {
    event.preventDefault();
    if (kind === 'detail') closeDetail();
    else if (kind === 'rule') closeRuleEditor();
    else if (kind === 'baseline') closeReturnBaselineEditor();
    else closeBatchConfirm();
    return;
  }
  if (event.key !== 'Tab') return;
  const dialog = event.currentTarget;
  const focusable = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.hidden && el.getClientRects().length);
  if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
function defaultMonitorStartDate() {
  const d = new Date();
  const clock = cnShanghaiClock(d);
  const utc = new Date(Date.UTC(Number(clock.date.slice(0, 4)), Number(clock.date.slice(5, 7)) - 1, Number(clock.date.slice(8, 10)) + 1));
  return utc.toISOString().slice(0, 10);
}
function openReturnBaselineEditor() {
  const item = watchlist.value.find((x) => String(x.code) === detail.code);
  if (!item) return;
  const custom = item.customReturnBaseline || {};
  dialogReturnFocus.baseline = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  Object.assign(returnBaselineEditor, { open: true, code: item.code, name: item.name || detail.name, price: custom.price == null ? '' : String(custom.price), monitorStartDate: custom.monitorStartDate || defaultMonitorStartDate(), saving: false, error: '' });
  nextTick(() => focusDialog('baseline'));
}
function closeReturnBaselineEditor() {
  returnBaselineEditor.open = false;
  returnBaselineEditor.error = '';
  restoreDialogFocus('baseline');
}
async function saveCustomReturnBaseline() {
  const price = Number(returnBaselineEditor.price);
  if (!Number.isFinite(price) || price <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(returnBaselineEditor.monitorStartDate)) { returnBaselineEditor.error = '请输入有效的模拟买入价和开始监控日期'; return; }
  returnBaselineEditor.saving = true; returnBaselineEditor.error = '';
  try {
    const result = await fetchJson('/api/watchlist?code=' + encodeURIComponent(returnBaselineEditor.code), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customReturnBaselinePrice: returnBaselineEditor.price, customReturnBaselineMonitorStartDate: returnBaselineEditor.monitorStartDate }) });
    if (!result || !result.ok) throw new Error((result && result.error) || '保存失败');
    await loadWatchlist();
    closeReturnBaselineEditor();
  } catch (e) { returnBaselineEditor.error = '保存失败：' + e.message; }
  finally { returnBaselineEditor.saving = false; }
}
async function clearCustomReturnBaseline() {
  returnBaselineEditor.saving = true; returnBaselineEditor.error = '';
  try {
    const result = await fetchJson('/api/watchlist?code=' + encodeURIComponent(returnBaselineEditor.code), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customReturnBaselinePrice: null }) });
    if (!result || !result.ok) throw new Error((result && result.error) || '清除失败');
    await loadWatchlist();
    closeReturnBaselineEditor();
  } catch (e) { returnBaselineEditor.error = '清除失败：' + e.message; }
  finally { returnBaselineEditor.saving = false; }
}

function saveRuleDraft() {
  const d = ruleEditor.draft;
  if (!d || ruleEditor.index < 0) return;
  if (!d.label || !String(d.label).trim()) d.label = d.id;
  if (d.kind === 'kline' && !d.patternId) {
    rulesMsg.value = '形态规则需选择形态（patternId）。'; rulesMsgError.value = true; return;
  }
  rules.value[ruleEditor.index] = cloneRule(d);
  closeRuleEditor();
  rulesMsg.value = '已修改当前规则，记得点击「保存规则」写入本地。'; rulesMsgError.value = false;
}
function removeRule(idx) {
  const r = rules.value[idx];
  if (!r) return;
  if (!window.confirm('删除规则「' + (r.label || r.id) + '」？')) return;
  rules.value.splice(idx, 1);
  rulesMsg.value = '已删除当前规则，点击「保存规则」生效。'; rulesMsgError.value = false;
}
async function resetRules() {
  try {
    const data = await fetchJson('/api/rules/reset', { method: 'POST' });
    rules.value = (data && data.rules) || rules.value;
    rulesMsg.value = '已恢复默认规则（已剔除「量能活跃」）。'; rulesMsgError.value = false;
  } catch (e) {
    rulesMsg.value = '恢复失败：' + e.message; rulesMsgError.value = true;
  }
}
async function saveRules() {
  savingRules.value = true; rulesMsg.value = ''; rulesMsgError.value = false;
  try {
    const data = await fetchJson('/api/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: rules.value }),
    });
    if (data && data.ok) {
      rules.value = (data.rules) || rules.value;
      rulesMsg.value = '规则已保存；扫描按「全部启用规则并集」执行。'; rulesMsgError.value = false;
    } else {
      rulesMsg.value = '保存失败：' + ((data && data.error) || '未知错误'); rulesMsgError.value = true;
    }
  } catch (e) {
    rulesMsg.value = '保存失败：' + e.message; rulesMsgError.value = true;
  } finally {
    savingRules.value = false;
  }
}
const hasValidPrescan = computed(() => Boolean(scanContext.value) && prescanMarketKey.value === [...selectedMarkets.value].sort().join(','));
watch([() => selectedMarkets.value.join(','), dataSource], loadLocalStatus);

  async function bootstrap() {
try {
  startupMessage.value = '正在加载本地配置与候选池…';
  markets.value = (await fetchJson('/api/markets')).markets || {};
  await Promise.all([loadRules(), loadSettings(), loadWatchlist(), loadPool(), loadBatchStatus()]);
  await Promise.all([loadLocalStatus(), loadPrefetchStatus(), loadIntegrity(), fetchJson('/api/status').then((x) => { statusInfo.value = x || { snapshotDates: [], klineCount: 0 }; })]);
  ensurePrefetchPolling();
  ensureBatchPolling();
  startKlineSyncScheduler();
  if (cnWatchSessionActive() || cnAfterMarketClose()) requestKlineSync('bootstrap');
  // 刷新后按恢复的模式补发首屏数据：mode 从 localStorage 恢复时不会经过 switchMode，
  // 盯盘行情与候选池 K 线轮询需要在这里显式启动。
  if (mode.value === 'watch') { watchSessionActive.value = cnWatchSessionActive(); await refreshWatch(); startWatchPolling(); completeWatchKlines(); }
  else if (mode.value === 'pool') { loadPoolKlineState(); ensurePoolKlinePolling(); }
  appReady.value = true;
} catch { startupMessage.value = '本地服务正在准备，请稍候…'; setTimeout(() => location.reload(), 3000); }
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    if (mode.value === 'watch') refreshWatch();
    if (cnWatchSessionActive() || cnAfterMarketClose()) requestKlineSync('visible');
  }
});
  }

  return { bootstrap, watchKlines, watchLevels, watchReturnByCode, detailWatchReturn, returnBaselineEditor, loadWatchKlines, loadWatchLevels, completeWatchKlines, watchCompleting, watchSessionActive, markets, rules, enabledRules, patterns, patternOptions, selectedMarkets, ruleId, dataSource, usedSource, snapshotDate, statusInfo, localStatus, rows, scanContext, prescanMarketKey, hasValidPrescan, scanning, summary, status, statusText, detail, aiSummary, aiVerdictLabel, aiVerdictClass, aiSampleLabel, aiKlineDate, aiSnapshotDate, aiDateMismatch, aiThemeNames, aiThemeSummary, aiBtnLabel, detailAiState, detailAiStateClass, fmtDuration, fmtClock, fmtDateTime, zoneRange, entryTriggerLabel, exitWatchLabel, appReady, startupMessage, prefetch, prefetchPercent, prefetchSummary, klineGaps, klineGapsSummary, integrity, dataHealth, scanBtnText, sourceLabel, marketLabel, todayReadySummary, missingTodayLabels, lastSnapDate, boardStats, mode, watchlist, watchQuotes, watchAlerts, watchInput, watchAddMsg, watchAddMsgError, watchRefreshing, watchQuotesError, watchAuto, watchIntervalMs, lastUpdate, isWatched, isInPool, isWatchPinned, toggleWatchPin, fmtNum, fmtTime, fmtPrice, fmtPct, fmtAmount, fmtRatio, fmtVolume, loadLocalStatus, toggleMarket, preScan, scan, openDetail, refreshDetail, runAiDetail, closeDetail, handleModalKeydown, startPrefetch, stopPrefetch, loadPrefetchStatus, loadIntegrity, loadKlineGaps, goPrefetch, openDataHealth, switchMode, loadWatchlist, refreshWatch, addWatch, removeWatch, toggleWatchFromScan, openReturnBaselineEditor, closeReturnBaselineEditor, saveCustomReturnBaseline, clearCustomReturnBaseline, restartWatchPolling, startWatchPolling, stopWatchPolling, settings, showFirstApiKey, showSecondApiKey, savingSettings, settingsMsg, settingsMsgError, loadSettings, saveSettings, savingRules, rulesMsg, rulesMsgError, ruleEditor, loadRules, addRule, openRuleEditor, closeRuleEditor, saveRuleDraft, removeRule, resetRules, saveRules, pool, sortedPool, poolSort, poolSortDir, poolTrackFilter, poolPatternFilter, poolTrackFilterOptions, poolPatternFilterOptions, poolPatternLabel, trackRecommendation, togglePoolSort, poolBusy, poolMsg, poolMsgError, poolStats, poolFilterStats, isPoolItemBusy, klineDone, poolKlineLatest, candidateState, candidateStateClass, poolJudgments, poolPatterns, poolRecommendations, recommendationBatch, recommendationLabel, recommendationClass, recommendationReason, startRecommendations, stopRecommendations, hasFailedJudgments, judgmentBatch, judgmentConfirm, poolPrefetch, loadPool, loadPoolJudgments, loadPoolRecommendations, loadPoolPatterns, loadBatchStatus, openBatchConfirm, closeBatchConfirm, confirmBatch, stopBatch, addToPool, addAllToPool, removeFromPool, clearPool, moveToWatch, moveAllToWatch, startPoolKline, stopPoolKline, loadPoolKlineState };
});
