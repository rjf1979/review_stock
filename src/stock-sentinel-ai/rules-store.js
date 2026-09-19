// 智诊盯盘 · 选股规则热插拔存储（data/rules.json，gitignore）
// 规则以「可序列化配置」保存（不含函数），运行时由 screener-core 展开成可执行规则。
// 默认规则已剔除「量能活跃」初筛规则；用户可在设置页增删改、启停。
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./storage');

const FILE = path.join(DATA_DIR, 'rules.json');
let cache = null; // 内存缓存；save()/reset() 后重建

// 默认规则：K 线形态复筛规则（24 条）。patternId 与 PATTERNS 键一致，参数可在设置页编辑。
// 2026-09-18 定稿：选股只用 rsi_low_turn v4 与 limit_pullback v4 两条（同属超跌修复口径，
// 用户要求对比选股效果，因此两条同时启用），其余 22 条保留定义但默认 enabled:false，
// 需要时在设置页逐条勾选「启用」并保存即可恢复，不需要改代码。
// minVolumeScore：规则级量能分入池门槛覆盖。v4 是超跌修复口径，命中当天的量能分天然偏低
// （实测当日全市场只有约 2% 的票能达到全局 70 分门槛），因此该规则不设量能分门槛，
// 入池资格由「快照粗筛 + 本地 K 线形态确认」决定；量能分仍照常展示，只是不作为门槛。
const DEFAULT_RULES = [
  { id: 'ma_bullish', label: '均线多头（启动）', kind: 'kline', patternId: 'ma_bullish', enabled: false, params: {}, prefilter: { minChangePct: -2, minVolumeRatio: 0.8 } },
  { id: 'pullback_ma20', label: '回踩20日线（缩量）', kind: 'kline', patternId: 'pullback_ma20', enabled: false, params: {}, prefilter: { maxChangePct: 3, minVolumeRatio: 0.6 } },
  { id: 'macd_water_golden', label: 'MACD水上金叉', kind: 'kline', patternId: 'macd_water_golden', enabled: false, params: {}, prefilter: { minChangePct: 0, minVolumeRatio: 0.9 } },
  { id: 'ma_golden_start', label: '均线金叉启动', kind: 'kline', patternId: 'ma_golden_start', enabled: false, params: {}, prefilter: { minChangePct: -1 } },
  { id: 'volume_breakout', label: '放量突破前高', kind: 'kline', patternId: 'volume_breakout', enabled: false, params: { window: 20, volFactor: 1.5 }, prefilter: { minChangePct: 2, minVolumeRatio: 1.2 } },
  { id: 'shrink_stabilize', label: '缩量企稳（下跌后）', kind: 'kline', patternId: 'shrink_stabilize', enabled: false, params: {}, prefilter: { minChangePct: -6, maxVolumeRatio: 1.5 } },
  { id: 'dry_price_bottom', label: '地量地价', kind: 'kline', patternId: 'dry_price_bottom', enabled: false, params: {}, prefilter: { minChangePct: -8, maxChangePct: 3, maxVolumeRatio: 1.2 } },
  { id: 'consecutive_yang', label: '连阳启动', kind: 'kline', patternId: 'consecutive_yang', enabled: false, params: {}, prefilter: { minChangePct: 0, minVolumeRatio: 0.8 } },
  { id: 'strong_sideways', label: '强势横盘（突破）', kind: 'kline', patternId: 'strong_sideways', enabled: false, params: {}, prefilter: { minChangePct: 1, minVolumeRatio: 1.0 } },
  // limit_pullback v4 口径（2026-09-18 定稿）：近 window(15) 日内有涨停、末根缩量（量 < 5日均量×0.9）、
  // 低点不破区间支撑；再叠加「近 drop_days(60) 日跌幅 ≤ drop_max(-30)%」与
  // 「近 rs_days(20) 日相对沪深300 强度 ≤ rs_max(-5)pp」两条超跌过滤，缺一不可。
  // prefilter 的 maxVolumeRatio=1.5 是「信号日必须缩量」在快照层的弱化护栏：形态本身要求
  // 信号日 `量 / 5日均量 < vol_shrink(0.9)`，1.5 严格宽于它，构造上不可能误杀命中票
  // （2026-09-18 复算：近 250 个交易日 504 次历史命中的信号日量比全部 ≤1.04）。
  // 作用是不让「当天明显放量」的票被标成涨停回踩命中，并省掉无意义的 K 线复筛。
  { id: 'limit_pullback', label: '涨停回踩（超跌 v4）', kind: 'kline', patternId: 'limit_pullback', enabled: true, minVolumeScore: 0, params: { window: 15, vol_shrink: 0.9, drop_days: 60, drop_max: -30, rs_days: 20, rs_max: -5 }, prefilter: { minChangePct: -8, maxChangePct: 8, maxVolumeRatio: 1.5 } },
  { id: 'fake_break_pack', label: '假跌破反包', kind: 'kline', patternId: 'fake_break_pack', enabled: false, params: {}, prefilter: { minChangePct: 1, minVolumeRatio: 1.0 } },
  { id: 'yang_engulf', label: '阳包阴', kind: 'kline', patternId: 'yang_engulf', enabled: false, params: {}, prefilter: { minChangePct: 0 } },
  { id: 'long_lower_shadow', label: '长下影企稳', kind: 'kline', patternId: 'long_lower_shadow', enabled: false, params: {}, prefilter: { minChangePct: -6 } },
  // v4 口径（2026-09-18 定稿，阈值同日收紧到 18）：RSI14 拐头前低于 18，且近 60 个交易日跌幅 ≤ -30%，
  // 只取信号日及以前的数据；prefilter 只是快照粗筛，真正的门槛由 K 线复筛决定。
  // 为什么是 18 而不是 15：全市场 2021-01-01～2026-09-18 回测（退出固定 6R 起跟踪 + 不减仓 + 关测量目标）
  // 显示 low 越低整段盈亏比越高（15→3.4957 / 18→3.2343 / 20→3.0756），但剔除 2024 异常年后
  // low=15 反而是三者里最差（盈亏比 2.1476、PF 1.7577、均值 +3.39%），
  // 而 low=18（2.2087 / 2.4734 / +5.44%）在笔数减少约 30% 的同时全面优于 low=20（2.1405 / 2.4215 / +5.25%）。
  // 证据：data/backtest/xingtaidu/xingtaidu_focus_rsi_low_turn_{low15,low18,v4}_2021_2026.json。
  { id: 'rsi_low_turn', label: 'RSI低位拐头（超跌 v4）', kind: 'kline', patternId: 'rsi_low_turn', enabled: true, minVolumeScore: 0, params: { period: 14, low: 18, drop_days: 60, drop_max: -30 }, prefilter: { minChangePct: -9, maxChangePct: 7 } },
  { id: 'double_bottom', label: '双底（W底）', kind: 'kline', patternId: 'double_bottom', enabled: false, params: {}, prefilter: { minChangePct: 0 } },
  { id: 'second_test', label: '二次探底企稳', kind: 'kline', patternId: 'second_test', enabled: false, params: {}, prefilter: { minChangePct: -6 } },
  { id: 'platform_breakout', label: '平台突破', kind: 'kline', patternId: 'platform_breakout', enabled: false, params: { window: 20 }, prefilter: { minChangePct: 2, minVolumeRatio: 1.2 } },
  { id: 'box_breakout', label: '箱体突破', kind: 'kline', patternId: 'box_breakout', enabled: false, params: { window: 25 }, prefilter: { minChangePct: 2, minVolumeRatio: 1.2 } },
  { id: 'ascending_triangle', label: '上升三角形突破', kind: 'kline', patternId: 'ascending_triangle', enabled: false, params: { window: 20 }, prefilter: { minChangePct: 2, minVolumeRatio: 1.0 } },
  { id: 'gap_breakout', label: '缺口突破', kind: 'kline', patternId: 'gap_breakout', enabled: false, params: {}, prefilter: { minChangePct: 2, minVolumeRatio: 1.0 } },
  { id: 'n_shape', label: 'N字突破', kind: 'kline', patternId: 'n_shape', enabled: false, params: {}, prefilter: { minChangePct: 2, minVolumeRatio: 1.1 } },
  { id: 'trendline_breakout', label: '趋势线突破', kind: 'kline', patternId: 'trendline_breakout', enabled: false, params: { window: 20 }, prefilter: { minChangePct: 2, minVolumeRatio: 1.0 } },
  { id: 'arc_bottom', label: '圆弧底', kind: 'kline', patternId: 'arc_bottom', enabled: false, params: { window: 25 }, prefilter: { minChangePct: 0 } },
  { id: 'head_shoulder_bottom', label: '头肩底', kind: 'kline', patternId: 'head_shoulder_bottom', enabled: false, params: { window: 35 }, prefilter: { minChangePct: 0 } },
];

// 允许在配置中保存为数值的字段（scan 阈值 + kline 形态 / 初筛阈值）。
const NUM_KEYS = [
  'minVolumeRatio', 'maxVolumeRatio', 'minTurnover', 'maxTurnover',
  'minChangePct', 'maxChangePct', 'minMainNetYi', 'minAmountYi',
  'window', 'volFactor', 'period',
  // rsi_low_turn v4：low=RSI 阈值，drop_days/drop_max=前期跌幅窗口与上限（%）
  'low', 'drop_days', 'drop_max',
  // limit_pullback v4：vol_shrink=缩量倍数，rs_days/rs_max=相对沪深300 强度的窗口与上限（百分点）
  'vol_shrink', 'rs_days', 'rs_max',
];

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function sanitizeNum(obj, keys) {
  const src = obj && typeof obj === 'object' ? obj : {};
  const out = {};
  for (const k of keys) {
    const v = src[k];
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

// 规范化一组规则：补 id、label、kind、enabled，去重，净化数值。
function normalize(list) {
  if (!Array.isArray(list)) return clone(DEFAULT_RULES);
  const seen = new Set();
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const src = list[i] && typeof list[i] === 'object' ? list[i] : {};
    let id = String(src.id || '').trim();
    if (!id) id = 'rule_' + Math.random().toString(36).slice(2, 8);
    if (seen.has(id)) id = id + '_' + i;
    seen.add(id);
    const kind = src.kind === 'scan' ? 'scan' : 'kline';
    const rec = {
      id,
      label: (String(src.label || '').trim()) || id,
      kind,
      enabled: src.enabled !== false,
      params: sanitizeNum(src.params, NUM_KEYS),
    };
    // 规则级量能分入池门槛覆盖（可选）：留空则沿用全局 AUTO_POOL_MIN_SCORE。
    const minVolumeScore = Number(src.minVolumeScore);
    if (src.minVolumeScore !== undefined && src.minVolumeScore !== null && src.minVolumeScore !== ''
      && Number.isFinite(minVolumeScore)) {
      rec.minVolumeScore = Math.min(100, Math.max(0, minVolumeScore));
    }
    if (kind === 'kline') {
      rec.patternId = (String(src.patternId || '').trim()) || id;
      rec.prefilter = sanitizeNum(src.prefilter, [
        'minChangePct', 'maxChangePct', 'minVolumeRatio', 'maxVolumeRatio', 'minTurnover', 'maxTurnover',
      ]);
    }
    out.push(rec);
  }
  return out;
}

// 读取规则；文件缺失或损坏时回退默认，绝不抛出。
function load() {
  if (cache) return clone(cache);
  let data = clone(DEFAULT_RULES);
  try {
    if (fs.existsSync(FILE)) {
      const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      if (Array.isArray(parsed)) data = parsed;
      else if (parsed && Array.isArray(parsed.rules)) data = parsed.rules;
    }
  } catch {
    // 损坏文件仅回退默认，保留原文件不覆盖，避免丢配置。
  }
  data = normalize(data);
  cache = data;
  return clone(data);
}

// 保存规则；返回规范化后的完整列表。
function save(list) {
  const data = normalize(Array.isArray(list) ? list : clone(DEFAULT_RULES));
  ensureDir(DATA_DIR);
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
  cache = data;
  return clone(data);
}

// 恢复到默认规则。
function reset() {
  const data = normalize(clone(DEFAULT_RULES));
  ensureDir(DATA_DIR);
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
  cache = data;
  return clone(data);
}

module.exports = { FILE, DEFAULT_RULES, load, save, reset, normalize };
