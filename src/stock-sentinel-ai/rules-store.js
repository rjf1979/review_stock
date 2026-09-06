// 智诊盯盘 · 选股规则热插拔存储（data/rules.json，gitignore）
// 规则以「可序列化配置」保存（不含函数），运行时由 screener-core 展开成可执行规则。
// 默认规则已剔除「量能活跃」初筛规则；用户可在设置页增删改、启停。
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./storage');

const FILE = path.join(DATA_DIR, 'rules.json');
let cache = null; // 内存缓存；save()/reset() 后重建

// 默认规则：K 线形态复筛规则（24 条）。patternId 与 PATTERNS 键一致，参数可在设置页编辑。
const DEFAULT_RULES = [
  { id: 'ma_bullish', label: '均线多头（启动）', kind: 'kline', patternId: 'ma_bullish', enabled: true, params: {}, prefilter: { minChangePct: -2, minVolumeRatio: 0.8 } },
  { id: 'pullback_ma20', label: '回踩20日线（缩量）', kind: 'kline', patternId: 'pullback_ma20', enabled: true, params: {}, prefilter: { maxChangePct: 3, minVolumeRatio: 0.6 } },
  { id: 'macd_water_golden', label: 'MACD水上金叉', kind: 'kline', patternId: 'macd_water_golden', enabled: true, params: {}, prefilter: { minChangePct: 0, minVolumeRatio: 0.9 } },
  { id: 'ma_golden_start', label: '均线金叉启动', kind: 'kline', patternId: 'ma_golden_start', enabled: true, params: {}, prefilter: { minChangePct: -1 } },
  { id: 'volume_breakout', label: '放量突破前高', kind: 'kline', patternId: 'volume_breakout', enabled: true, params: { window: 20, volFactor: 1.5 }, prefilter: { minChangePct: 2, minVolumeRatio: 1.2 } },
  { id: 'shrink_stabilize', label: '缩量企稳（下跌后）', kind: 'kline', patternId: 'shrink_stabilize', enabled: true, params: {}, prefilter: { minChangePct: -6, maxVolumeRatio: 1.5 } },
  { id: 'dry_price_bottom', label: '地量地价', kind: 'kline', patternId: 'dry_price_bottom', enabled: true, params: {}, prefilter: { minChangePct: -8 } },
  { id: 'consecutive_yang', label: '连阳启动', kind: 'kline', patternId: 'consecutive_yang', enabled: true, params: {}, prefilter: { minChangePct: 0, minVolumeRatio: 0.8 } },
  { id: 'strong_sideways', label: '强势横盘（突破）', kind: 'kline', patternId: 'strong_sideways', enabled: true, params: {}, prefilter: { minChangePct: 1, minVolumeRatio: 1.0 } },
  { id: 'limit_pullback', label: '涨停回踩（缩量）', kind: 'kline', patternId: 'limit_pullback', enabled: true, params: {}, prefilter: { minChangePct: -8, maxChangePct: 8 } },
  { id: 'fake_break_pack', label: '假跌破反包', kind: 'kline', patternId: 'fake_break_pack', enabled: true, params: {}, prefilter: { minChangePct: 1, minVolumeRatio: 1.0 } },
  { id: 'yang_engulf', label: '阳包阴', kind: 'kline', patternId: 'yang_engulf', enabled: true, params: {}, prefilter: { minChangePct: 0 } },
  { id: 'long_lower_shadow', label: '长下影企稳', kind: 'kline', patternId: 'long_lower_shadow', enabled: true, params: {}, prefilter: { minChangePct: -6 } },
  { id: 'rsi_low_turn', label: 'RSI低位拐头', kind: 'kline', patternId: 'rsi_low_turn', enabled: true, params: { period: 14 }, prefilter: { minChangePct: -9 } },
  { id: 'double_bottom', label: '双底（W底）', kind: 'kline', patternId: 'double_bottom', enabled: true, params: {}, prefilter: { minChangePct: 0 } },
  { id: 'second_test', label: '二次探底企稳', kind: 'kline', patternId: 'second_test', enabled: true, params: {}, prefilter: { minChangePct: -6 } },
  { id: 'platform_breakout', label: '平台突破', kind: 'kline', patternId: 'platform_breakout', enabled: true, params: { window: 20 }, prefilter: { minChangePct: 2, minVolumeRatio: 1.2 } },
  { id: 'box_breakout', label: '箱体突破', kind: 'kline', patternId: 'box_breakout', enabled: true, params: { window: 25 }, prefilter: { minChangePct: 2, minVolumeRatio: 1.2 } },
  { id: 'ascending_triangle', label: '上升三角形突破', kind: 'kline', patternId: 'ascending_triangle', enabled: true, params: { window: 20 }, prefilter: { minChangePct: 2, minVolumeRatio: 1.0 } },
  { id: 'gap_breakout', label: '缺口突破', kind: 'kline', patternId: 'gap_breakout', enabled: true, params: {}, prefilter: { minChangePct: 2, minVolumeRatio: 1.0 } },
  { id: 'n_shape', label: 'N字突破', kind: 'kline', patternId: 'n_shape', enabled: true, params: {}, prefilter: { minChangePct: 2, minVolumeRatio: 1.1 } },
  { id: 'trendline_breakout', label: '趋势线突破', kind: 'kline', patternId: 'trendline_breakout', enabled: true, params: { window: 20 }, prefilter: { minChangePct: 2, minVolumeRatio: 1.0 } },
  { id: 'arc_bottom', label: '圆弧底', kind: 'kline', patternId: 'arc_bottom', enabled: true, params: { window: 25 }, prefilter: { minChangePct: 0 } },
  { id: 'head_shoulder_bottom', label: '头肩底', kind: 'kline', patternId: 'head_shoulder_bottom', enabled: true, params: { window: 35 }, prefilter: { minChangePct: 0 } },
];

// 允许在配置中保存为数值的字段（scan 阈值 + kline 形态 / 初筛阈值）。
const NUM_KEYS = [
  'minVolumeRatio', 'maxVolumeRatio', 'minTurnover', 'maxTurnover',
  'minChangePct', 'maxChangePct', 'minMainNetYi', 'minAmountYi',
  'window', 'volFactor', 'period',
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
