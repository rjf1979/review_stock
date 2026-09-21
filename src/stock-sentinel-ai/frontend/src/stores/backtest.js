// 智诊盯盘 · 回测证据层（Pinia store，只读）
//
// 数据来源（全部由 Python 侧写入，前端只读）：
//   * data/backtest.db                 —— tools/backtest_store.py：分档统计 bt_stat、时点网格 bt_time_grid、
//                                         形态字典 bt_pattern_def、字段字典 bt_feature_def、批次 bt_run；
//   * data/backtest/decision_model.json —— tools/bt_decision_engine.py：概率评分模型（分档系数、
//                                         留一年验证、十分位校准、每日 Top-K 模拟、时点建议、风险边界）。
//
// 边界：本层只服务「看得见的证据」。回测结论不作为下单指令，实盘凭据仍写在 data/kline.db 的
// bt_decision 表里，由人工确认后落库。
import { defineStore } from 'pinia';
import { computed, reactive } from 'vue';

const TABS = ['overview', 'model', 'stats', 'timing', 'decisions'];

// 维度中文名与后端 bt_stat.dimension 一一对应；缺省时回退显示原始键，便于排查。
const DIM_CN = {
  overall: '全样本基准', year: '年份', date: '交易日', board: '板块', industry: '行业',
  flag: '形态标记', pct: '当日涨幅', amp: '振幅', close_pos: '收盘位置', turnover: '换手率',
  vol_ratio: '量比', amount: '成交额', float_mcap: '流通市值', rsi14: 'RSI14', atr: 'ATR 波动',
  bias20: '20 日乖离', bias60: '60 日乖离', ret5: '5 日收益', ret20: '20 日收益', ret60: '60 日收益',
  dist_hh20: '距 20 日高点', list_days: '上市天数', market_temp: '市场温度', market_regime: '市场环境',
  bench_pct: '基准涨跌', hy_pct: '行业涨跌', hy_ret5: '行业 5 日收益', hy_ret20: '行业 20 日收益',
  sector_heat: '板块热度', sector_up_ratio: '板块上涨占比', day_shape: '日线形态位置', channel: '通道类型',
  pos120: '120 日位置', vs_daily: '分钟 vs 日线', grid_month: '网格月份', ma_align: '均线排列',
  tf5_pattern: '5 分钟形态', tf5_primary: '5 分钟主形态', tf15_pattern: '15 分钟形态',
  tf15_primary: '15 分钟主形态', tf30_pattern: '30 分钟形态', tf30_primary: '30 分钟主形态',
  tf60_pattern: '60 分钟形态', tf60_primary: '60 分钟主形态', tf_align: '多周期共振',
  tf_align_score: '共振强度', vol_ratio_intraday: '盘中量比',
};

const TOPK_CN = {
  top1: '前 1 只', top2: '前 2 只', top3: '前 3 只', top5: '前 5 只', top8: '前 8 只',
  top10: '前 10 只', top15: '前 15 只', top20: '前 20 只', top30: '前 30 只',
  top10_comboB: '前 10 只 ∩ 组合B（振幅≥6% + 成交额≥5亿 + 创业板/中小板）',
};

const TOPK_ORDER = ['top1', 'top2', 'top3', 'top5', 'top8', 'top10', 'top15', 'top20', 'top30', 'top10_comboB'];

// 1430 → 「14:30」；已经是 'HH:MM' 的字符串原样返回。
export function fmtBacktestMinute(value) {
  if (value === null || value === undefined || value === '') return '—';
  const text = String(value);
  if (text.includes(':')) return text;
  const n = Number(value);
  if (!Number.isFinite(n)) return text;
  const s = String(Math.trunc(n)).padStart(4, '0');
  return `${s.slice(0, 2)}:${s.slice(2)}`;
}

async function getJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (!res.ok) {
    const detail = payload && payload.error;
    const message = detail && typeof detail === 'object' ? detail.message : detail;
    throw new Error(String(message || text || `HTTP ${res.status}`).slice(0, 200));
  }
  if (payload === null) throw new Error('响应不是有效 JSON');
  return payload;
}

export const useBacktestStore = defineStore('backtest', () => {
  const backtest = reactive({
    tab: 'overview',
    loading: false,
    error: '',
    modelError: '',
    loadedAt: '',
    summary: null,
    model: null,
    runId: null,
    dimensions: [],
    stats: [],
    statDimension: '',
    statSort: 'bucket',
    statsLoading: false,
    grid: [],
    gridBuy: '',
    modelTarget: 'up3',
    scorecard: null,
    decisions: [],
    decisionsError: '',
  });

  const runs = computed(() => (backtest.summary && backtest.summary.runs) || []);
  const counts = computed(() => (backtest.summary && backtest.summary.counts) || {});
  const dimensions = computed(() => (backtest.dimensions || [])
    .filter((d) => Number(d.runId) === Number(backtest.runId))
    .map((d) => ({ ...d, cn: DIM_CN[d.dimension] || d.dimension })));
  const statRows = computed(() => {
    const dim = backtest.statDimension;
    const rows = (backtest.stats || []).filter((r) => !dim || r.dimension === dim);
    const copy = rows.slice();
    if (backtest.statSort === 'lift3') copy.sort((a, b) => (Number(b.lift3) || 0) - (Number(a.lift3) || 0));
    return copy;
  });
  const targets = computed(() => {
    const m = backtest.model;
    if (!m) return [];
    const years = Object.keys(m.loo || {}).sort();
    return Object.keys(m.metrics || {}).map((key) => {
      const byYear = years.map((y) => ({ year: y, auc: m.loo[y] && m.loo[y][key] ? m.loo[y][key].auc : null }));
      const aucs = byYear.map((r) => Number(r.auc)).filter((x) => x > 0);
      return {
        key,
        cn: (m.targets && m.targets[key] && m.targets[key].cn) || key,
        basePct: m.targets && m.targets[key] ? m.targets[key].baseHitPct : null,
        aucLoo: aucs.length ? aucs.reduce((a, b) => a + b, 0) / aucs.length : null,
        byYear,
      };
    });
  });
  const deciles = computed(() => {
    const m = backtest.model;
    const t = m && m.calibration ? m.calibration[backtest.modelTarget] : null;
    return (t && t.deciles) || [];
  });
  const topk = computed(() => {
    const m = backtest.model;
    if (!m || !m.topk) return [];
    return TOPK_ORDER.filter((k) => m.topk[k])
      .map((k) => ({ key: k, cn: TOPK_CN[k] || k, ...m.topk[k] }));
  });
  const coefs = computed(() => {
    const m = backtest.model;
    const t = m && m.targets ? m.targets[backtest.modelTarget] : null;
    if (!m || !t || !Array.isArray(t.coef)) return [];
    return (m.features || [])
      .map((f, i) => ({ cn: f.cn, key: f.key, unit: f.unit || '', coef: Number(t.coef[i]) || 0 }))
      .sort((a, b) => Math.abs(b.coef) - Math.abs(a.coef))
      .slice(0, 12);
  });
  const riskNotes = computed(() => (backtest.model && backtest.model.risk) || []);
  const gridBuys = computed(() => Array.from(new Set((backtest.grid || []).map((r) => r.buyMinute))).sort((a, b) => a - b));
  const gridSells = computed(() => (backtest.grid || [])
    .filter((r) => fmtBacktestMinute(r.buyMinute) === backtest.gridBuy)
    .sort((a, b) => a.sellMinute - b.sellMinute));
  const gridTop = computed(() => (backtest.grid || []).slice()
    .sort((a, b) => (Number(b.retMeanPct) || 0) - (Number(a.retMeanPct) || 0))
    .slice(0, 8)
    .map((r) => ({ ...r, buy: fmtBacktestMinute(r.buyMinute), sell: fmtBacktestMinute(r.sellMinute) })));

  function dimLabel(dim) { return DIM_CN[dim] || dim || '—'; }

  async function loadStats() {
    if (backtest.runId === null || backtest.runId === undefined) return;
    backtest.statsLoading = true;
    try {
      const qs = new URLSearchParams({ runId: String(backtest.runId) });
      const data = await getJson(`/api/backtest/stats?${qs.toString()}`);
      backtest.dimensions = (data && data.dimensions) || backtest.dimensions;
      backtest.stats = (data && data.stats) || [];
      // 默认维度优先「日线形态位置」，其次排除交易日/年份/基准——交易日维度上千行，首屏没有信息量。
      const fallback = dimensions.value.find((d) => d.dimension === 'day_shape')
        || dimensions.value.find((d) => !['date', 'year', 'overall'].includes(d.dimension))
        || dimensions.value[0];
      if (!backtest.statDimension && fallback) backtest.statDimension = fallback.dimension;
    } catch {
      backtest.stats = [];
    } finally {
      backtest.statsLoading = false;
    }
  }

  async function loadDecisions() {
    backtest.decisionsError = '';
    try {
      const data = await getJson('/api/decisions');
      backtest.scorecard = (data && data.scorecard) || null;
      backtest.decisions = (data && data.decisions) || [];
    } catch (e) {
      backtest.scorecard = null;
      backtest.decisions = [];
      backtest.decisionsError = '实盘凭据加载失败：' + e.message;
    }
  }

  async function load(force) {
    if (backtest.loading) return;
    if (!force && backtest.summary && backtest.model) return;
    backtest.loading = true;
    backtest.error = '';
    backtest.modelError = '';
    try {
      const [sumRes, modelRes, gridRes] = await Promise.all([
        getJson('/api/backtest/summary').catch((e) => ({ ok: false, error: e.message })),
        getJson('/api/backtest/decision-model').catch((e) => ({ ok: false, error: e.message })),
        getJson('/api/backtest/time-grid').catch(() => ({ ok: false, grid: [] })),
      ]);
      if (sumRes && sumRes.ok) backtest.summary = sumRes;
      else { backtest.summary = null; backtest.error = (sumRes && sumRes.error) || '回测库不可用'; }
      if (modelRes && modelRes.ok) backtest.model = modelRes.model;
      else { backtest.model = null; backtest.modelError = (modelRes && modelRes.error) || '概率模型不可用'; }
      backtest.grid = (gridRes && gridRes.grid) || [];
      if (backtest.runId === null || !runs.value.some((r) => Number(r.runId) === Number(backtest.runId))) {
        const daily = runs.value.find((r) => String(r.runKey || '').startsWith('daily-')) || runs.value[0];
        backtest.runId = daily ? daily.runId : null;
      }
      const timing = backtest.model && backtest.model.timing;
      const preferredBuy = (timing && timing.insampleBest && timing.insampleBest.buy) || '14:30';
      const buyLabels = gridBuys.value.map(fmtBacktestMinute);
      backtest.gridBuy = buyLabels.includes(preferredBuy) ? preferredBuy : (buyLabels[0] || preferredBuy);
      await Promise.all([loadStats(), loadDecisions()]);
      backtest.loadedAt = new Date().toISOString();
    } catch (e) {
      backtest.error = '回测数据加载失败：' + e.message;
    } finally {
      backtest.loading = false;
    }
  }

  function switchTab(tab) {
    backtest.tab = TABS.includes(tab) ? tab : 'overview';
  }

  function selectRun(runId) {
    const next = Number(runId);
    if (Number.isFinite(next) && next !== Number(backtest.runId)) {
      backtest.runId = next;
      backtest.statDimension = '';
      backtest.stats = [];
      loadStats();
    }
  }

  function selectDimension(dim) {
    if (!dim || dim === backtest.statDimension) return;
    backtest.statDimension = dim;
  }

  function selectGridBuy(buy) {
    const next = fmtBacktestMinute(buy);
    if (next && next !== backtest.gridBuy) backtest.gridBuy = next;
  }

  function selectTarget(key) {
    if (key && key !== backtest.modelTarget) backtest.modelTarget = key;
  }

  function setStatSort(sort) {
    backtest.statSort = sort === 'lift3' ? 'lift3' : 'bucket';
  }

  return {
    backtest, runs, counts, dimensions, statRows, targets, deciles, topk, coefs, riskNotes,
    gridBuys, gridSells, gridTop,
    load, loadStats, loadDecisions, switchTab, selectRun, selectDimension, selectGridBuy,
    selectTarget, setStatSort, dimLabel, fmtMinute: fmtBacktestMinute,
  };
});
