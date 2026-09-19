// 智诊盯盘 · 本地设置存储（settings.json，已 gitignore，API Key 不落日志/不提交）
// 路径规则与 storage 一致：优先 VOLUME_INSIGHT_DATA_DIR（Electron 打包后为可写 userData），
// 开发/Web 调试模式未设置该变量时落到源码 <项目>/data/settings.json，保持开发期唯一配置源。
// 禁止写 __dirname（打包后即只读 app.asar，写盘会报 ENOTDIR）。
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.VOLUME_INSIGHT_DATA_DIR
  ? path.resolve(process.env.VOLUME_INSIGHT_DATA_DIR)
  : path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'settings.json');

// 默认值：抓取任务 250 日；AI 研判配置为「OpenAI 兼容」模板，默认关闭且不接线。
const DEFAULTS = {
  fetchDays: 250,
  // 交易时间内统一日 K 自动补全周期（秒），候选池与自选共同使用。
  klineSyncIntervalSec: 300,
  // 通达信本地数据目录：留空表示关闭本地日线来源，只走联网源。
  // 默认不写死盘符，避免开发/测试环境在未配置时真读本地磁盘。
  tdxDir: '',
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
  out.tdxDir = typeof src.tdxDir === 'string' ? src.tdxDir.trim() : base.tdxDir;
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

// 保存设置；返回经过校验合并后的完整对象。写盘失败时补上落盘路径，便于定位只读/非目录问题。
function save(next) {
  const data = merge(clone(DEFAULTS), next || {});
  try {
    ensureDir(path.dirname(FILE));
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    const detail = e && e.message ? e.message : String(e);
    const err = new Error(`设置写入失败（${FILE}）：${detail}`);
    if (e && e.code) err.code = e.code;
    throw err;
  }
  return data;
}

module.exports = { FILE, DATA_DIR, DEFAULTS, load, save };
