// 智诊盯盘 · 本地设置存储（data/settings.json，已 gitignore，API Key 不落日志/不提交）
// 说明（开发模式约定）：设置统一读写源码项目 src/<app>/data/settings.json，成为唯一配置源，
// 不再跟随 VOLUME_INSIGHT_DATA_DIR(userData)。理由：配置到源码 data 便于开发统一；仅当
// 打包安装版(asar 只读)发行时需重新评估回归 userData 或配置归并。K线库/快照等大文件仍
// 不受影响 —— 它们继续随 storage 的 VOLUME_INSIGHT_DATA_DIR(kline.db / snapshots)。
const fs = require('fs');
const path = require('path');

// 固定写/读源码目录下的 data/settings.json（__dirname 即 src/stock-sentinel-ai）。
const FILE = path.join(__dirname, 'data', 'settings.json');

// 默认值：抓取任务 250 日；AI 研判配置为「OpenAI 兼容」模板，默认关闭且不接线。
const DEFAULTS = {
  fetchDays: 250,
  // 交易时间内统一日 K 自动补全周期（秒），候选池与自选共同使用。
  klineSyncIntervalSec: 300,
  tradingStyle: '',
  ai: {
    enabled: false,
    provider: 'openai-compatible',
    baseURL: '',
    apiKey: '',
    model: '',
    temperature: 0.7,
    maxTokens: 8192,
    concurrency: 3,
    reasoningEffort: 'medium',
    timeoutMs: 180000,
    contextTokens: 1000000,
    first: { provider: 'openai-compatible', baseURL: '', apiKey: '', model: '', temperature: 0.7, maxTokens: 8192, reasoningEffort: 'medium', timeoutMs: 180000, contextTokens: 1000000 },
    second: { provider: 'openai-compatible', baseURL: '', apiKey: '', model: '', temperature: 0.7, maxTokens: 8192, reasoningEffort: 'medium', timeoutMs: 180000, contextTokens: 1000000 },
  },
};

// 用 JSON 深拷贝，避免 structuredClone 在较老 Node 上不可用。
function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

// 把用户输入合并到默认值上，做类型校验并限制合法区间。
function merge(base, next) {
  const out = clone(base);
  const src = next && typeof next === 'object' ? next : {};
  out.fetchDays = Math.round(clampNum(src.fetchDays, 20, 500, base.fetchDays));
  out.klineSyncIntervalSec = Math.round(clampNum(src.klineSyncIntervalSec, 30, 3600, base.klineSyncIntervalSec));
  out.tradingStyle = ['short', 'medium', 'long'].includes(src.tradingStyle) ? src.tradingStyle : '';
  if (src.ai && typeof src.ai === 'object') {
    const a = src.ai;
    out.ai.enabled = a.enabled === true;
    out.ai.provider = typeof a.provider === 'string' && a.provider ? a.provider : base.ai.provider;
    out.ai.baseURL = typeof a.baseURL === 'string' ? a.baseURL.trim() : base.ai.baseURL;
    out.ai.apiKey = typeof a.apiKey === 'string' ? a.apiKey.trim() : base.ai.apiKey;
    out.ai.model = typeof a.model === 'string' ? a.model.trim() : base.ai.model;
    out.ai.temperature = clampNum(a.temperature, 0, 2, base.ai.temperature);
    out.ai.maxTokens = Math.round(clampNum(a.maxTokens, 64, 8192, base.ai.maxTokens));
    out.ai.timeoutMs = Math.round(clampNum(a.timeoutMs, 5000, 900000, base.ai.timeoutMs));
    out.ai.contextTokens = Math.round(clampNum(a.contextTokens, 10000, 10000000, base.ai.contextTokens));
    out.ai.concurrency = Math.round(clampNum(a.concurrency, 1, 5, base.ai.concurrency));
    out.ai.reasoningEffort = ['low', 'medium', 'high', 'xhigh'].includes(a.reasoningEffort) ? a.reasoningEffort : base.ai.reasoningEffort;
    for (const stage of ['first', 'second']) {
      const srcStage = a[stage] && typeof a[stage] === 'object' ? a[stage] : {};
      const fallback = stage === 'first' ? a : (a.first && typeof a.first === 'object' ? a.first : a);
      out.ai[stage] = {
        provider: typeof srcStage.provider === 'string' && srcStage.provider ? srcStage.provider : (fallback.provider || base.ai.provider),
        baseURL: typeof srcStage.baseURL === 'string' ? srcStage.baseURL.trim() : (fallback.baseURL || ''),
        apiKey: typeof srcStage.apiKey === 'string' ? srcStage.apiKey.trim() : (fallback.apiKey || ''),
        model: typeof srcStage.model === 'string' ? srcStage.model.trim() : (fallback.model || ''),
        // 兼容原全局参数：旧设置升级后，两个阶段沿用原有数值。
        temperature: clampNum(srcStage.temperature, 0, 2, clampNum(fallback.temperature, 0, 2, base.ai.temperature)),
        maxTokens: Math.round(clampNum(srcStage.maxTokens, 64, 8192, clampNum(fallback.maxTokens, 64, 8192, base.ai.maxTokens))),
        timeoutMs: Math.round(clampNum(srcStage.timeoutMs, 5000, 900000, clampNum(fallback.timeoutMs, 5000, 900000, base.ai.timeoutMs))),
        contextTokens: Math.round(clampNum(srcStage.contextTokens, 10000, 10000000, clampNum(fallback.contextTokens, 10000, 10000000, base.ai.contextTokens))),
        reasoningEffort: ['low', 'medium', 'high', 'xhigh'].includes(srcStage.reasoningEffort) ? srcStage.reasoningEffort : (fallback.reasoningEffort || base.ai.reasoningEffort),
      };
    }
  }
  return out;
}

// 读取设置；文件缺失或损坏时回退默认值，绝不抛出。
function load() {
  try {
    if (fs.existsSync(FILE)) {
      const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      if (parsed && typeof parsed === 'object') return merge(clone(DEFAULTS), parsed);
    }
  } catch {
    // 损坏文件仅回退默认，保留原文件不覆盖，避免丢配置。
  }
  return clone(DEFAULTS);
}

// 保存设置；返回经过校验合并后的完整对象。
function save(next) {
  const data = merge(clone(DEFAULTS), next || {});
  ensureDir(path.dirname(FILE));
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
  return data;
}

module.exports = { FILE, DEFAULTS, load, save };
