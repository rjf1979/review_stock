// 智诊盯盘 · AI 辅助研判接线（单只个股）
// 读取本地 settings.ai 配置 → 组装「行情快照 + 日 K + 技术指标 + 命中形态」证据 → 调用
// OpenAI Chat Completions 兼容接口，返回研判文本。API Key 只在请求头中瞬时使用，不落日志/不进证据。
const crypto = require('crypto');
const settings = require('./settings');
const { sma, ema, macd, rsi, limitPct } = require('./screener-core');
const indicators = require('./indicators');
const priceLevels = require('./price-levels');

const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_RATE_LIMIT_RETRIES = 3;
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 1500;
const RATE_LIMIT_STATUS = new Set([429, 503]);
const PROMPT_VERSION = 'current';
const JUDGMENT_VERDICTS = ['maintain', 'revise', 'new_evidence', 'insufficient'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ───────────────────────── 配置与前置校验（本地拒绝，不发外网） ─────────────────────────
function configReady(cfg) {
  if (!cfg || cfg.enabled !== true) {
    return { ok: false, code: 'disabled', message: 'AI 辅助研判未启用：请先在设置页勾选“启用 AI 辅助研判”并保存。' };
  }
  if (!cfg.baseURL) return { ok: false, code: 'no_base_url', message: '缺少 Base URL：请在设置页填写接口 Base URL。' };
  if (!cfg.model) return { ok: false, code: 'no_model', message: '缺少模型：请在设置页填写模型名称。' };
  if (!cfg.apiKey) return { ok: false, code: 'no_api_key', message: '缺少 API Key：请在设置页填写 API Key（仅留在本机，不会上传）。' };
  return { ok: true };
}

// 全部接口统一使用 OpenAI Chat Completions 协议，废除旧 Responses 兼容分支。
function chatEndpoint(baseURL) {
  let u = String(baseURL || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  u = u.replace(/\/+$/, '');
  // 允许用户填写 Base URL 或完整接口地址；统一规整为 Chat Completions 端点。
  u = u.replace(/\/(?:responses|chat\/completions)$/i, '');
  if (!/\/v1(?:\/|$)/i.test(u) && !/\/openai(?:\/|$)/i.test(u)) u += '/v1';
  return u + '/chat/completions';
}

// ───────────────────────── 证据组装 ─────────────────────────
const fmtY = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return Math.round(v * 100) / 100;
};

// 最近 N 个最新技术指标值的摘要（去空）。ma/macd/rsi 均为升序数组，取最后 validLen 个非 null。
function recent(array, n = 5) {
  const out = [];
  for (let i = array.length - 1; i >= 0 && out.length < n; i--) {
    const v = array[i];
    if (v != null && Number.isFinite(v)) out.unshift(Math.round(v * 100) / 100);
  }
  return out;
}

// 构建单只个股的证据对象（纯本地计算，不含敏感配置）。
function buildEvidence({ code, name, market, snapshot = {}, kline = [], patterns = [], ruleLabel = '' }) {
  const candles = Array.isArray(kline) ? kline : [];
  const closes = candles.map((c) => c.close);
  const vol = candles.map((c) => c.volume);
  const macdRes = closes.length >= 26 ? macd(candles) : null;
  const rsiArr = closes.length ? rsi(candles) : [];
  const ma = (n) => (closes.length >= n ? sma(closes, n) : []);
  const last = (a) => (a && a.length ? a[a.length - 1] : null);
  const price = snapshot.price != null ? snapshot.price : (candles.length ? candles[candles.length - 1].close : null);

  return {
    code: String(code || ''),
    name: String(name || ''),
    market: String(market || ''),
    queryDate: String(snapshot.date || candles.length ? (candles[candles.length - 1] || {}).date : '') || '',
    snapshot: {
      price: fmtY(price),
      changePct: fmtY(snapshot.changePct),
      // 同时兼容两种来源：正向扫描候选带 amountYi/mainNetYi(亿元)；盯盘/原生 record 带 amount/mainNet(元)。
      amountYi: snapshot.amountYi != null ? fmtY(snapshot.amountYi) : (snapshot.amount != null ? fmtY(Number(snapshot.amount) / 1e8) : null),
      turnoverPct: fmtY(snapshot.turnover),           // 换手率 %
      volumeRatio: fmtY(snapshot.volumeRatio),        // 量比
      mainNetYi: snapshot.mainNetYi != null ? fmtY(snapshot.mainNetYi) : (snapshot.mainNet != null ? fmtY(Number(snapshot.mainNet) / 1e8) : null),
      floatMcapYi: snapshot.floatMcap != null ? fmtY(Number(snapshot.floatMcap) / 1e8) : (snapshot.floatMcapYi != null ? fmtY(snapshot.floatMcapYi) : null),
    },
    kline: {
      bars: candles.length,
      latest: candles.length
        ? {
            date: candles[candles.length - 1].date,
            open: fmtY(candles[candles.length - 1].open),
            close: fmtY(candles[candles.length - 1].close),
            high: fmtY(candles[candles.length - 1].high),
            low: fmtY(candles[candles.length - 1].low),
            volume: candles[candles.length - 1].volume,
          }
        : null,
      // 近 10 根收盘价，给出「读走势」的最小输入。
      recentClose: closes.slice(-10).map(fmtY),
    },
    indicators: {
      MA5: last(ma(5)),
      MA10: last(ma(10)),
      MA20: last(ma(20)),
      MA60: last(ma(60)),
      MACD: macdRes
        ? {
            DIF: macdRes.dif.slice(-5).map(fmtY),
            DEA: macdRes.dea.slice(-5).map(fmtY),
            HIST: macdRes.hist.slice(-5).map(fmtY),
          }
        : null,
      RSI14: closes.length ? recent(rsiArr) : [],
      volMA5: closes.length ? fmtY((vol.slice(-5).reduce((a, b) => a + b, 0) / 5)) : null,
    },
    patterns: Array.isArray(patterns) && patterns.length
      ? patterns.map((p) => ({ label: p.label || p.ruleLabel, matched: !!p.matched, score: p.score, reason: p.reason, detail: p.detail || '' }))
      : [],
    ruleLabel: String(ruleLabel || '').trim(),
  };
}

// 由证据对象生成发送给模型的 prompt 文本（纯文本，无敏感信息）。
function buildPrompt(ev) {
  const lines = [];
  lines.push('你是一名 A 股量价与均线结构的研究助手。请基于下面【仅来自公开行情】的证据做客观研判，只作研究参考，不构成投资建议。');
  lines.push('');
  lines.push(`标的：${ev.name}（${ev.code}，${ev.market || '未知市场'}）；问题发生/证据对应日期：${ev.queryDate || '—'}。当前价 ${ev.snapshot.price ?? '—'}，涨跌幅 ${ev.snapshot.changePct ?? '—'}%。`);
  const s = ev.snapshot;
  lines.push(`快照：成交额约 ${s.amountYi ?? '—'} 亿元，换手率 ${s.turnoverPct ?? '—'}%，量比 ${s.volumeRatio ?? '—'}，主力净流入 ${s.mainNetYi ?? '—'} 亿元${s.floatMcapYi != null ? `，流通市值约 ${s.floatMcapYi} 亿元` : ''}。`);
  const k = ev.kline;
  if (k.latest) {
    lines.push(`最新交易日：${k.latest.date} 开 ${k.latest.open} 高 ${k.latest.high} 低 ${k.latest.low} 收 ${k.latest.close}，成交量 ${k.latest.volume}。近 10 根收盘价序列：${(k.recentClose || []).join(' → ')}。K线总样本 ${k.bars} 根。`);
  }
  const ind = ev.indicators;
  const maLine = ['MA5', 'MA10', 'MA20', 'MA60'].filter((n) => ind[n] != null).map((n) => `${n}=${ind[n]}`).join('　');
  if (maLine) lines.push(`均线：${maLine}；量能均线 VMA5=${ind.volMA5 ?? '—'}。`);
  if (ind.MACD) lines.push(`MACD（近5期）：DIF=${ind.MACD.DIF.join(',')}；DEA=${ind.MACD.DEA.join(',')}；柱=${ind.MACD.HIST.join(',')}。`);
  if (ind.RSI14 && ind.RSI14.length) lines.push(`RSI14（近 ${ind.RSI14.length} 个有效值）：${ind.RSI14.join(', ')}。`);
  const pats = ev.patterns;
  if (pats.length) {
    lines.push('命中形态：');
    for (const p of pats) {
      lines.push(`  - ${p.label}${p.reason ? `：${p.reason}` : ''}${p.detail ? `（细节：${p.detail}）` : ''}`);
    }
  } else if (ev.ruleLabel) {
    lines.push(`命中规则：${ev.ruleLabel}`);
  } else {
    lines.push('（未对外提供形态命中 —— 请主要依据量价、均线与 MACD/RSI 信号从证据判断。）');
  }
  lines.push('');
  lines.push('请输出：1) 简述当前所处趋势与量价状态；2) 列出证据中最值得关注的多空信号与风险点；3) 给出可验证的观察线索与关注要点。语气克制，不输出确定性收益或买卖指令。');
  return lines.join('\n');
}

// ───────────────────────── 发送请求 ─────────────────────────
// 返回 { content, usage, raw }；usage 取接口真实 usage 对象，缺失时为 null（不伪造 token 数）。
// 返回 { content, usage, raw }；usage 取接口真实 usage 对象，缺失时为 null（不伪造 token 数）。
// 429/503 视为接口限流/繁忙：按指数退避重试（最多 maxRetries 次），Retry-After 优先。
async function chatCompletionsDetailed(cfg, messages, { maxRetries = DEFAULT_RATE_LIMIT_RETRIES, backoffBaseMs = DEFAULT_RATE_LIMIT_BACKOFF_MS } = {}) {
  const endpoint = chatEndpoint(cfg.baseURL);
  if (!endpoint) throw new Error('Base URL 为空');
  const maxAttempts = Math.max(1, Math.round(Number(maxRetries) || 0) + 1);
  let lastStatus = 0;
  let lastText = '';
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs || DEFAULT_TIMEOUT_MS);
    try {
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` };
      const maxTokens = cfg.maxTokens != null && Number.isFinite(Number(cfg.maxTokens)) ? Number(cfg.maxTokens) : 2048;
      const temperature = cfg.temperature != null && Number.isFinite(Number(cfg.temperature)) ? Number(cfg.temperature) : null;
      const body = {
        model: cfg.model,
        messages,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        ...(temperature != null ? { temperature } : {}),
      };
      const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
      lastStatus = response.status;
      const text = await response.text();
      lastText = text;
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
      if (RATE_LIMIT_STATUS.has(response.status) && attempt < maxAttempts - 1) {
        const retryAfter = Number((response.headers && response.headers.get && response.headers.get('retry-after')) || 0);
        const wait = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(30000, backoffBaseMs * Math.pow(2, attempt));
        await sleep(wait);
        continue;
      }
      if (!response.ok) {
        const emsg = (data && data.error && (data.error.message || data.error)) || text || `HTTP ${response.status}`;
        throw new Error(`接口返回 ${response.status}：${String(emsg).slice(0, 300)}`);
      }
      const message = data && data.choices && data.choices[0] && data.choices[0].message;
      let content = (data && data.output_text) || (message && (message.content || message.reasoning_content)) || '';
      if (!content && Array.isArray(data && data.output)) {
        content = data.output.flatMap((item) => Array.isArray(item && item.content) ? item.content : [])
          .map((part) => part && (part.text || part.value) || '').join('');
      }
      if (Array.isArray(content)) content = content.map((x) => typeof x === 'string' ? x : (x && (x.text || x.content) || '')).join('');
      if (!content) throw new Error('模型返回为空（choices.message.content 缺失）。');
      const usage = (data && data.usage && typeof data.usage === 'object') ? data.usage : null;
      return { content, usage, raw: data };
    } finally {
      clearTimeout(timer);
    }
  }
  const emsg = lastText ? `接口返回 ${lastStatus}：${String(lastText).slice(0, 300)}` : `接口返回 ${lastStatus}（限流重试耗尽）`;
  throw new Error(emsg);
}

async function chatCompletions(cfg, messages) {
  return (await chatCompletionsDetailed(cfg, messages)).content;
}

// ───────────────────────── 主入口 ─────────────────────────
// 供 server 调用。参数：
//  - snapshot：单只个股的快照记录（归一化后字段），可为 {}/null。
//  - kline：前复权日 K 数组（升序），可为 []。
//  - patterns：命中形态数组（含 label/matched/score/reason/detail）可为 []。
//  - ruleLabel：候选规则标签（可选）。
//  - promptOverride：可选，跳过自动证据拼凑直接传该 prompt（进阶用，不改默认路径）。
async function analyze({
  code = '', name = '', market = '',
  snapshot = null, kline = [], patterns = [], ruleLabel = '', promptOverride = '',
} = {}) {
  const cfg = settings.load().ai || {};
  const ready = configReady(cfg);
  if (!ready.ok) return { ok: false, code: ready.code, message: ready.message };

  const ev = buildEvidence({ code, name, market, snapshot, kline, patterns, ruleLabel });
  const userText = promptOverride || buildPrompt(ev);
  let content;
  try {
    content = await chatCompletions(cfg, [
      { role: 'system', content: '你是智诊盯盘的 AI 辅助研判助手。用户只可能把公开行情与量价形态信号交给你，请据此做克制、客观、可核验的研究分析；绝不能将任何信号或输出表述为确定收益、买卖指令或投资收益承诺。' },
      { role: 'user', content: userText },
    ]);
  } catch (e) {
    const msg = e && e.name === 'AbortError' ? '请求超时（请检查 Base URL 连通性或增大设置里的超时）' : (e && e.message) || '请求失败';
    return { ok: false, code: 'network', message: '调用 AI 接口失败：' + msg, detail: userText };
  }
  return { ok: true, content, evidence: ev, prompt: userText };
}

// ───────────────────────── 结构化研判：证据摘要 / 版本 / Hash / 输出协议 ─────────────────────────
function buildIndicatorSummary(kline) {
  const candles = Array.isArray(kline) ? kline : [];
  return indicators.summarize(candles, { benchCandles: null });
}

// 完整研判证据：在既有 evidence 之上，补齐技术指标摘要、样本状态、前复权版本与证据日期。
// 题材/行业归属只保留可复算字段，剔除缓存标记（cached）等运行时字段，避免相同数据因缓存命中与否产生不同 evidenceHash。
function normalizeTheme(theme) {
  if (!theme || typeof theme !== 'object') return null;
  const boards = Array.isArray(theme.boards)
    ? theme.boards.map((b) => ({
        name: String(b && b.name || ''),
        code: String(b && b.code || ''),
        changePct: Number(b && b.changePct) || 0,
        leadStock: String(b && b.leadStock || ''),
      }))
    : [];
  const conceptTags = Array.isArray(theme.conceptTags) ? theme.conceptTags.map((t) => String(t)) : [];
  return { total: boards.length, boards, conceptTags };
}

function buildJudgmentEvidence({ code, name, market, snapshot = {}, kline = [], patterns = [], ruleLabel = '', dataStatus = 'not_ready', snapshotDate = '', levelsSummary = null, theme = null, themeDate = '', tradingStyle = '' } = {}) {
  const ev = buildEvidence({ code, name, market, snapshot, kline, patterns, ruleLabel });
  const candles = Array.isArray(kline) ? kline : [];
  const klineDate = candles.length ? String(candles[candles.length - 1].date || '') : '';
  const snapDate = String(snapshotDate || snapshot.date || snapshot.snapshotDate || '') || '';
  return {
    ...ev,
    indicatorSummary: buildIndicatorSummary(candles),
    sampleStatus: dataStatus,
    adjustmentType: 'qfq',
    algorithmVersion: PROMPT_VERSION,
    levelsSummary: levelsSummary || priceLevels.levelsSummary(null),
    tradingStyle: ['short', 'medium', 'long'].includes(tradingStyle) ? tradingStyle : 'short',
    theme: normalizeTheme(theme),
    evidenceDates: {
      snapshotDate: snapDate || null,
      klineDate: klineDate || null,
      themeDate: String(themeDate || (theme && theme.fetchedAt) || '') || null,
      eventDate: null,
      marketContextDate: null,
    },
  };
}

// 参与 Hash 的标准化证据：证据内容 + 证据日期 + prompt 版本（不信任模型自报）。
function stableEvidence(ev) {
  return {
    code: ev.code,
    name: ev.name,
    market: ev.market,
    snapshot: ev.snapshot,
    kline: ev.kline,
    indicators: ev.indicators,
    indicatorSummary: ev.indicatorSummary,
    patterns: ev.patterns,
    ruleLabel: ev.ruleLabel,
    sampleStatus: ev.sampleStatus,
    adjustmentType: ev.adjustmentType,
    levelsSummary: ev.levelsSummary,
    tradingStyle: ev.tradingStyle,
    theme: ev.theme || null,
    evidenceDates: ev.evidenceDates,
    promptVersion: PROMPT_VERSION,
  };
}

function computeEvidenceHash(ev) {
  return crypto.createHash('sha256').update(JSON.stringify(stableEvidence(ev))).digest('hex');
}

// 相对上次结论的变化项（本地计算，不依赖模型记忆）。
function diffEvidence(prevEvidence, currentEvidence) {
  const out = [];
  if (prevEvidence && currentEvidence) {
    const pk = prevEvidence.kline && prevEvidence.kline.bars;
    const ck = currentEvidence.kline && currentEvidence.kline.bars;
    if (Number.isFinite(pk) && Number.isFinite(ck) && ck > pk) out.push(`K 线新增 ${ck - pk} 根`);
    else if (Number.isFinite(pk) && Number.isFinite(ck) && ck < pk) out.push(`K 线样本由 ${pk} 变为 ${ck} 根`);
    const ps = prevEvidence.snapshot || {};
    const cs = currentEvidence.snapshot || {};
    if (Number(ps.changePct) !== Number(cs.changePct)) out.push(`涨跌幅由 ${ps.changePct} 变为 ${cs.changePct}`);
    if (Number(ps.volumeRatio) !== Number(cs.volumeRatio)) out.push(`量比由 ${ps.volumeRatio} 变为 ${cs.volumeRatio}`);
    if (Number(ps.turnoverPct) !== Number(cs.turnoverPct)) out.push(`换手率由 ${ps.turnoverPct} 变为 ${cs.turnoverPct}`);
    const pd = prevEvidence.evidenceDates || {};
    const cd = currentEvidence.evidenceDates || {};
    if (pd.klineDate && cd.klineDate && pd.klineDate !== cd.klineDate) out.push(`K 线截止由 ${pd.klineDate} 变为 ${cd.klineDate}`);
    if (pd.snapshotDate && cd.snapshotDate && pd.snapshotDate !== cd.snapshotDate) out.push(`快照日期由 ${pd.snapshotDate} 变为 ${cd.snapshotDate}`);
  }
  return out.length ? out : ['本次证据与上次基本一致（无新增变化项）'];
}

function bannedWordsIn(text) {
  const banned = ['买入', '卖出', '目标价', '胜率', '保证收益', '智能荐股'];
  return banned.filter((w) => text.includes(w));
}

function buildStructuredPrompt(ev, { previous = null, changedItems = [] } = {}) {
  const lines = [];
  lines.push('你是一名严谨、克制的 A 股量价与形态结构研究助手。请只依据下面提供的本机公开行情证据做客观研判。');
  lines.push('你只能输出一个合法 JSON 对象，不要输出解释、Markdown、代码块符号或任何 JSON 之外的内容。');
  lines.push('');
  lines.push(`【研判对象】${ev.name}（${ev.code}，${ev.market || '未知市场'}）`);
  lines.push(`【证据截止】K 线 ${(ev.evidenceDates && ev.evidenceDates.klineDate) || '—'} · 快照 ${(ev.evidenceDates && ev.evidenceDates.snapshotDate) || '—'}`);
  lines.push(`【样本状态】${ev.sampleStatus === 'limited' ? '有限就绪（样本有限）' : ev.sampleStatus === 'full' ? '完整就绪' : '数据未就绪'}`);
  const styleText = { short: '短线（1～5 个交易日，分批建仓、严格止损、分段止盈）', medium: '中线（数周至数月，结合 MA20/MA60 与趋势结构）', long: '长线（数月以上，结合长期趋势和基本面，不因短期波动频繁调整）' }[ev.tradingStyle] || '短线';
  lines.push(`【交易方式】${styleText}`);
  lines.push('');
  lines.push('【本地证据 JSON】');
  lines.push(JSON.stringify(stableEvidence(ev)));
  lines.push('');
  lines.push('【观察价位摘要 JSON】');
  lines.push(JSON.stringify(ev.levelsSummary || null));
  lines.push('');
  if (previous) {
    lines.push('【研判阶段】二次复核研判');
    lines.push('【上次结论摘要】');
    lines.push(`上次研判时间 ${previous.finishedAt ? new Date(previous.finishedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}，倾向 ${previous.modelResult ? previous.modelResult.verdict : '—'}，摘要：${previous.modelResult ? previous.modelResult.summary : '—'}`);
    if (Array.isArray(changedItems) && changedItems.length) {
      lines.push('【本次数据变化】' + changedItems.join('；'));
    }
    lines.push('【二次复核决策规则】先对照上次结论与本次变化；没有趋势、量价、关键价位或数据质量层面的实质变化时，优先 verdict=maintain。仅当新证据削弱或推翻上次核心依据时用 revise；存在独立且显著的新事实、但不足以推翻原结论时用 new_evidence；数据缺失、日期错配或无法有效比较时用 insufficient。不得为了给出新观点而强行修正。');
  } else {
    lines.push('【研判阶段】首次研判');
    lines.push('【首次研判决策规则】仅依据当前证据建立可复核的基线结论，不假定存在历史判断。verdict 只能为 new_evidence（存在足以建立基线的可用证据）或 insufficient（证据不足、缺失或冲突）；不得使用 maintain 或 revise。');
  }
  lines.push('');
  lines.push('【输出协议（优先级最高）】必须严格按如下 JSON 结构返回：');
  lines.push('{"verdict":"maintain|revise|new_evidence|insufficient","summary":"不超过 120 字的结论摘要","changes":["相对上次结论的变化"],"evidence":["支持本次判断的关键证据，最多 3 条"],"risks":["主要风险"],"watchPoints":["后续可验证的跟踪点"]}');
  lines.push('');
  lines.push('硬性要求：不得出现“买入 / 卖出 / 目标价 / 胜率 / 保证收益 / 智能荐股”等词；不得输出确定性收益或买卖指令；只用已提供证据，缺什么就如实说明，不要猜测补全。');
  lines.push('对技术指标只做趋势、波动、相对强弱与量价确认的客观描述，不得解释为确定性信号，不得因指标数量多而重复增强结论。');
  return lines.join('\n');
}

function extractJson(text) {
  if (text == null) return null;
  const s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : s;
  try { return JSON.parse(candidate); } catch { /* fallthrough */ }

  // 部分 OpenAI 兼容网关会把同一份结构化结果重复拼接为 `}{`。
  // 只接受首个对象后余下内容均为完全相同 JSON 的情况；任何说明文字、
  // 不同对象或残缺内容仍视为格式错误，避免放宽结构化协议。
  for (let start = candidate.indexOf('{'); start >= 0; start = candidate.indexOf('{', start + 1)) {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let end = start; end < candidate.length; end += 1) {
      const ch = candidate[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') quoted = false;
        continue;
      }
      if (ch === '"') { quoted = true; continue; }
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth !== 0) continue;
        try {
          const value = JSON.parse(candidate.slice(start, end + 1));
          const tail = candidate.slice(end + 1).trim();
          if (!tail) return value;
          let rest = tail;
          while (rest) {
            if (rest[0] !== '{') return null;
            let duplicateEnd = -1;
            let duplicateDepth = 0;
            let duplicateQuoted = false;
            let duplicateEscaped = false;
            for (let i = 0; i < rest.length; i += 1) {
              const c = rest[i];
              if (duplicateQuoted) {
                if (duplicateEscaped) duplicateEscaped = false;
                else if (c === '\\') duplicateEscaped = true;
                else if (c === '"') duplicateQuoted = false;
              } else if (c === '"') duplicateQuoted = true;
              else if (c === '{') duplicateDepth += 1;
              else if (c === '}' && --duplicateDepth === 0) { duplicateEnd = i; break; }
            }
            if (duplicateEnd < 0) return null;
            const duplicate = JSON.parse(rest.slice(0, duplicateEnd + 1));
            if (JSON.stringify(duplicate) !== JSON.stringify(value)) return null;
            rest = rest.slice(duplicateEnd + 1).trim();
          }
          return value;
        } catch { break; }
      }
    }
  }
  return null;
}

function asStringArray(v, max = 10) {
  return Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean).slice(0, max) : [];
}

// 解析并校验模型输出的结构化结果；失败时返回原始文本供排错。
function parseModelResult(raw) {
  const obj = extractJson(raw);
  if (!obj || typeof obj !== 'object') {
    return { ok: false, reason: '未解析到合法 JSON 结构', raw: String(raw || '') };
  }
  const mr = obj.modelResult && typeof obj.modelResult === 'object' ? obj.modelResult : obj;
  const verdict = String(mr.verdict || '').trim();
  if (!JUDGMENT_VERDICTS.includes(verdict)) {
    return { ok: false, reason: `verdict 枚举非法：${verdict || '(空)'}`, raw: String(raw || '') };
  }
  const summary = String(mr.summary || '').trim();
  if (!summary) {
    return { ok: false, reason: 'summary 为空', raw: String(raw || '') };
  }
  const hitBanned = bannedWordsIn(summary + ' ' + asStringArray(mr.evidence).join(' '));
  if (hitBanned.length) {
    return { ok: false, reason: '结论包含禁用词：' + hitBanned.join('、'), raw: String(raw || '') };
  }
  return {
    ok: true,
    modelResult: {
      verdict,
      summary: summary.slice(0, 240),
      changes: asStringArray(mr.changes),
      evidence: asStringArray(mr.evidence, 3),
      risks: asStringArray(mr.risks),
      watchPoints: asStringArray(mr.watchPoints),
    },
    raw: String(raw || ''),
  };
}

module.exports = {
  analyze,
  configReady,
  buildEvidence,
  buildPrompt,
  buildIndicatorSummary,
  buildJudgmentEvidence,
  stableEvidence,
  computeEvidenceHash,
  diffEvidence,
  buildStructuredPrompt,
  parseModelResult,
  extractJson,
  chatEndpoint,
  chatCompletionsDetailed,
  DEFAULT_RATE_LIMIT_RETRIES,
  DEFAULT_RATE_LIMIT_BACKOFF_MS,
  PROMPT_VERSION,
  JUDGMENT_VERDICTS,
};
