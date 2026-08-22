const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const PROJECT_ROOT = path.resolve(__dirname, '..');

if (fs.existsSync(path.join(PROJECT_ROOT, '.env'))) {
  for (const line of fs.readFileSync(path.join(PROJECT_ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}
const { emptyState, initializeDatabase, loadState, saveState, loadAppConfig, saveAppConfig } = require('./db');
const { runDailyReview } = require('./review');
const PORT = Number(process.env.PORT || 3000);
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
const ADMIN_KEY = process.env.ADMIN_KEY || 'local-admin-key';
const APP_SHELL = '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>行情日报</title><link rel="stylesheet" href="/assets/app.css"></head><body><div id="app"></div><script type="module" src="/assets/app.mjs"></script></body></html>';

let store = emptyState();
let appConfig = null;
let lastAutoReviewDate = null;
let saveQueue = Promise.resolve();
function persist() { saveQueue = saveQueue.then(() => saveState(store)); return saveQueue; }
function id(bytes = 18) { return crypto.randomBytes(bytes).toString('hex'); }
function cookieValue(req, name) { const raw = req.headers.cookie || ''; const part = raw.split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`)); return part ? decodeURIComponent(part.slice(name.length + 1)) : ''; }
function adminAuthenticated(req) { if (req.headers['x-admin-key'] === ADMIN_KEY) return true; const token = cookieValue(req, 'admin_sid'); return store.adminSessions?.some(session => session.token === token && session.expiresAt > Date.now()) || false; }
function generateUploadKey() { return crypto.randomBytes(32).toString('base64url'); }
function uploadAuthenticated(req) {
  const key = appConfig?.uploadKey;
  if (!key) return null;
  const expected = Buffer.from(key, 'utf8');
  const actual = Buffer.from(String(req.headers['x-upload-key'] || ''), 'utf8');
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}
function todayKey() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()); }
function chinaClock() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return { date: todayKey(), weekday: values.weekday, hour: Number(values.hour), minute: Number(values.minute) };
}
function ensureTradingDay(date = todayKey()) {
  let day = store.tradingDays.find(item => item.date === date);
  if (!day) {
    day = { date, marketStatus: 'closed', lhbStatus: 'pending', analysisStatus: 'waiting_market', reportPath: null, analysis: null, analysisTask: { status: 'waiting', trigger: null }, updatedAt: new Date().toISOString() };
    store.tradingDays.push(day); persist();
  }
  return day;
}
function publicDay(day) { return { date: day.date, marketStatus: day.marketStatus, lhbStatus: day.lhbStatus, analysisStatus: day.analysisStatus, reportPath: day.reportPath, analysis: day.analysis, updatedAt: day.updatedAt }; }
function latestAnalyzedDay() {
  const latest = store.tradingDays.filter(day => day.analysisStatus === 'analyzed' && day.reportPath).sort((a, b) => b.date.localeCompare(a.date));
  return latest[0] || null;
}
function adminStats() {
  const byDate = {};
  for (const user of store.users) { const date = String(user.createdAt || '').slice(0, 10) || 'unknown'; byDate[date] = (byDate[date] || 0) + 1; }
  const dailyProgress = store.tradingDays.slice().sort((a, b) => b.date.localeCompare(a.date)).map(day => ({ date: day.date, analysisStatus: day.analysisStatus, status: 'disabled', expected: 0, sent: 0, failed: 0, pending: 0 }));
  const reportList = store.tradingDays.slice().sort((a, b) => b.date.localeCompare(a.date)).map(day => ({ date: day.date, reportPath: day.reportPath, analysisStatus: day.analysisStatus, renderStatus: day.analysisTask?.status || null, analysis: day.analysis || null, sendStatus: 'disabled', sent: 0, failed: 0 }));
  return { registrations: { total: store.users.length, verified: store.users.filter(user => user.verified).length, unverified: store.users.filter(user => !user.verified).length, byDate: Object.entries(byDate).sort((a, b) => b[0].localeCompare(a[0])).map(([date, count]) => ({ date, count })) }, dailyProgress, reportList, analysisTasks: store.tradingDays.slice().sort((a, b) => b.date.localeCompare(a.date)).map(day => ({ date: day.date, status: day.analysisTask?.status || day.analysisStatus, trigger: day.analysisTask?.trigger || 'unknown', startedAt: day.analysisTask?.startedAt || null, completedAt: day.analysisTask?.completedAt || null, skills: day.analysisTask?.skills || [] })) };
}
function send(res, status, body, type = 'application/json') { res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' }); res.end(type === 'application/json' ? JSON.stringify(body) : body); }
function redirect(res, location) { res.writeHead(302, { Location: location }); res.end(); }
function readBody(req, maxBytes = 1e6) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;
    req.on('data', chunk => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > maxBytes) {
        tooLarge = true;
        body = '';
        req.pause();
        reject(Object.assign(new Error('请求体过大。'), { statusCode: 413 }));
      }
    });
    req.on('end', () => {
      if (tooLarge) return;
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}
function maskSecret(value) { const source = String(value || ''); return source ? `${source.slice(0, 3)}${'*'.repeat(Math.max(4, source.length - 6))}${source.slice(-3)}` : ''; }
function publicSettings() {
  const config = appConfig || {};
  return {
    upload: { key: config.uploadKey || '', keyMasked: maskSecret(config.uploadKey), updatedAt: config.updatedAt || null },
    ai: { provider: config.provider || 'OpenAI Compatible', protocol: config.protocol || 'openai_responses', baseUrl: config.baseUrl || '', apiKey: config.apiKey || '', apiKeyMasked: maskSecret(config.apiKey), model: config.model || '', timeoutSeconds: config.timeoutSeconds || 300, enabled: config.aiEnabled !== false }
  };
}
function validHttpUrl(value) { try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:'; } catch { return false; } }
function reportMeta() { const day = ensureTradingDay(); return { date: day.date, title: day.analysis?.title || '今日行情分析准备中', temperature: day.analysis?.temperature ?? null, summary: day.analysis?.summary || '等待外部分析报告上传。', analysisStatus: day.analysisStatus, reportPath: day.reportPath }; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }
function extractReportMeta(markdown) {
  const source = String(markdown || '').replace(/^﻿/, '');
  let body = source;
  const frontmatter = {};
  const headerMatch = source.match(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/);
  if (headerMatch) {
    for (const line of headerMatch[0].split(/\r?\n/).slice(1, -1)) {
      const match = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
      if (match) frontmatter[match[1].toLowerCase()] = String(match[2]).trim().replace(/^['"]|['"]$/g, '');
    }
    body = source.slice(headerMatch[0].length).replace(/^\s*\r?\n/, '');
  }
  const stripInline = text => String(text).replace(/`{1,3}[^`]*`{1,3}/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_~]{1,2}([^*_~]+)[*_~]{1,2}/g, '$1').trim();
  let title = frontmatter.title;
  if (!title) {
    const heading = body.match(/^#\s+(.+)$/m);
    if (heading) title = heading[1].trim();
  }
  let summary = frontmatter.summary;
  if (!summary) {
    let inCode = false;
    for (const rawLine of body.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (/^```/.test(line)) { inCode = !inCode; continue; }
      if (inCode || !line || /^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|\||-{3,}|\*{3,}|_{3,})/.test(line)) continue;
      const cleaned = stripInline(line);
      if (cleaned) { summary = cleaned; break; }
    }
  }
  return { title: (title || '').trim().slice(0, 100), summary: (summary || '').trim().slice(0, 500), body };
}
function normalizeReportDate(text, date) {
  return String(text || '').replace(/(\d{4})[-年/.](\d{1,2})[-月/. ](\d{1,2})/g, (match, year, month, day) => {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return iso === date ? iso : date;
  });
}
let markedPromise;
function loadMarked() {
  if (!markedPromise) markedPromise = import('marked').then(module => module.marked);
  return markedPromise;
}
async function renderMdReport(date, markdown) {
  const { title: rawTitle, summary: rawSummary, body } = extractReportMeta(markdown);
  const title = rawTitle || `${date} A股收盘复盘`;
  const summary = rawSummary || '外部分析报告。';
  const marked = await loadMarked();
  const contentHtml = marked.parse(body, { gfm: true });
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(title)}</title><style>:root{--bg:#f3f5f8;--surface:#fff;--ink:#18202c;--muted:#697484;--line:#dce2e9;--rise:#df3043;--rise-soft:#fff1f3;--fall:#0b9871;--fall-soft:#eaf8f3;--amber:#b16d0a;--amber-soft:#fff6e6;--blue:#386ec5;--radius:8px;--page:1160px}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;min-width:320px;background:var(--bg);color:var(--ink);font:16px/1.6 "Microsoft YaHei UI","PingFang SC",system-ui,sans-serif;letter-spacing:0}a{color:var(--blue)}a:focus-visible,button:focus-visible{outline:3px solid rgba(56,110,197,.45);outline-offset:3px}.skip{position:fixed;top:12px;left:16px;z-index:9;padding:9px 12px;background:#18202c;color:#fff;transform:translateY(-160%)}.skip:focus{transform:translateY(0)}.page{width:min(calc(100% - 32px),var(--page));margin:24px auto 48px}.shell{overflow:hidden;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);box-shadow:0 12px 32px rgba(21,34,50,.08)}.top{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:15px 26px;border-bottom:1px solid var(--line)}.brand{font-weight:800}.meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;color:var(--muted);font-size:.82rem}.badge{display:inline-flex;align-items:center;min-height:28px;padding:4px 8px;border:1px solid var(--line);border-radius:999px;background:#f8fafc;font-weight:700}.badge.ok{color:var(--fall);border-color:#bde5d7;background:var(--fall-soft)}.print{min-height:40px;padding:0 12px;border:1px solid #c7cfda;border-radius:5px;background:#fff;color:var(--ink);cursor:pointer;font-weight:700}.print:hover{background:#f6f8fa}.md-body{max-width:min(100%,920px);margin:0 auto;padding:32px 40px 40px}.md-body h1,.md-body h2,.md-body h3,.md-body h4{margin:1.6em 0 .6em;line-height:1.3}.md-body h1{font-size:2rem}.md-body h2{font-size:1.4rem;padding-bottom:.35em;border-bottom:1px solid var(--line)}.md-body h3{font-size:1.12rem}.md-body p{margin:.7em 0;color:#3c4856}.md-body ul,.md-body ol{margin:.7em 0;padding-left:1.5em;color:#3c4856}.md-body li{margin:.28em 0}.md-body blockquote{margin:1em 0;padding:.6em 1em;border-left:4px solid var(--amber);background:var(--amber-soft);border-radius:0 var(--radius) var(--radius) 0;color:#4e5a69}.md-body pre{margin:1em 0;padding:14px 16px;overflow-x:auto;background:#18202c;color:#e6edf3;border-radius:var(--radius);font-size:.9rem;line-height:1.5}.md-body code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.9em}.md-body :not(pre)>code{padding:2px 6px;border:1px solid var(--line);border-radius:4px;background:#f4f6f8;color:#b02a37}.md-body table{display:block;width:max-content;max-width:100%;margin:1em 0;overflow-x:auto;border-collapse:collapse;font-variant-numeric:tabular-nums}.md-body th,.md-body td{padding:9px 12px;border:1px solid var(--line);text-align:left}.md-body th{background:#f4f6f8;font-weight:700}.md-body tr:nth-child(even) td{background:#fafbfd}.md-body img{max-width:100%;height:auto;border-radius:var(--radius)}.md-body hr{margin:2em 0;border:0;border-top:1px solid var(--line)}footer{padding:24px 26px;background:#fafbfd}.disclaimer{margin:0;color:var(--muted);font-size:.76rem;text-align:center}@media(max-width:560px){body{font-size:15.5px}.page{width:100%;margin:0}.shell{border:0;border-radius:0}.top{padding:10px 16px}.md-body{padding:24px 20px 28px}}@media print{@page{size:A4;margin:10mm}body{background:#fff!important;color:#18202c!important;font-size:10.5px}.page{width:100%;margin:0}.shell{border:0;box-shadow:none}.top,.md-body,footer{background:#fff!important;color:#18202c!important;border-color:#aeb8c5!important}.print,.skip{display:none!important}.md-body{padding:12px 0}}</style></head><body><a class="skip" href="#report">跳到报告主体</a><div class="page"><div class="shell"><header class="top"><div class="brand">A股收盘 · 主线与情绪复盘</div><div class="meta"><span class="badge">${escapeHtml(date)}</span><span class="badge ok">外部分析报告</span><button class="print" type="button" onclick="window.print()">打印报告</button></div></header><main id="report"><article class="md-body">${contentHtml}</article></main><footer><p class="disclaimer">数据截至 ${escapeHtml(date)}｜仅供研究复盘，不构成投资建议。</p></footer></div></div></body></html>`;
  return { html, title, summary };
}
async function callAiModel({ system, user, config, maxTokens = 8192 }) {
  const base = String(config.baseUrl || '').replace(/\/+$/, '');
  const headers = { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' };
  const timeout = AbortSignal.timeout(Number(config.timeoutSeconds || 300) * 1000);
  if (config.protocol === 'anthropic_messages') {
    headers['anthropic-version'] = '2023-06-01';
    const response = await fetch(`${base}/messages`, { method: 'POST', headers, signal: timeout, body: JSON.stringify({ model: config.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }) });
    if (!response.ok) throw new Error(`AI 服务返回 ${response.status}`);
    const data = await response.json();
    return (data.content || []).map(part => part.text || '').join('');
  }
  const response = await fetch(`${base}/responses`, { method: 'POST', headers, signal: timeout, body: JSON.stringify({ model: config.model, instructions: system, input: user }) });
  if (!response.ok) throw new Error(`AI 服务返回 ${response.status}`);
  const data = await response.json();
  return (data.output || []).map(item => (item.content || []).map(part => part.text || '').join('')).join('');
}
function extractHtml(text) {
  let html = String(text || '');
  const fenced = html.match(/```(?:html)?\s*([\s\S]*?)```/);
  if (fenced) html = fenced[1];
  html = html.trim();
  const start = html.search(/<!doctype html/i);
  if (start > 0) html = html.slice(start);
  return /^<!doctype html/i.test(html) ? html : null;
}
function sanitizeReportData(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const str = (value, max) => { const s = String(value ?? '').trim(); return s ? s.slice(0, max) : null; };
  const num = value => { const n = Number(value); return Number.isFinite(n) ? n : null; };
  const int = value => { const n = num(value); return n === null ? null : Math.round(n); };
  const strings = (arr, max, len) => Array.isArray(arr) ? arr.slice(0, max).map(item => String(item ?? '').trim().slice(0, len)).filter(Boolean) : [];
  let temperature = null;
  if (raw.temperature !== null && raw.temperature !== undefined && raw.temperature !== '') {
    const t = num(raw.temperature);
    if (t !== null) temperature = Math.max(0, Math.min(100, Math.round(t)));
  }
  const indices = Array.isArray(raw.indices)
    ? raw.indices.slice(0, 8).map(ix => ({ name: str(ix?.name, 24) || '', value: str(ix?.value, 20), change: str(ix?.change, 20) })).filter(ix => ix.name)
    : [];
  const b = raw.breadth && typeof raw.breadth === 'object' ? raw.breadth : {};
  const breadth = { up: int(b.up), down: int(b.down), limitUp: int(b.limitUp), limitDown: int(b.limitDown), streak: int(b.streak), turnover: str(b.turnover, 30) };
  const mainline = strings(raw.mainline, 8, 40);
  const leadingStocks = Array.isArray(raw.leadingStocks)
    ? raw.leadingStocks.slice(0, 12).map(s => ({ level: str(s?.level, 12), name: str(s?.name, 24) || '', sector: str(s?.sector, 24) })).filter(s => s.name)
    : [];
  const nextFocus = strings(raw.nextFocus, 8, 120);
  const warnings = strings(raw.warnings, 6, 120);
  const title = str(raw.title, 100);
  const summary = str(raw.summary, 500);
  const data = { title, summary, temperature, indices, breadth, mainline, leadingStocks, nextFocus, warnings };
  const usable = !!(title || summary) || temperature !== null || indices.length || mainline.length || leadingStocks.length || nextFocus.length || warnings.length || Object.values(breadth).some(value => value !== null && value !== '');
  return usable ? data : null;
}
function extractReportData(html) {
  const match = String(html || '').match(/<script[^>]*id=["']report-data["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try { return sanitizeReportData(JSON.parse(match[1].trim())); } catch { return null; }
}
async function requestAiHtml({ date, title, markdown, config }) {
  const system = '你是资深 A 股收盘复盘报告排版设计师。把用户提供的 Markdown 行情复盘内容，排版成一份全新的、美观的、自包含的单文件 HTML 报告。不要参考任何旧报告，从零设计。\n\n【视觉规范】\n- 浅色纸张质感背景、白色卡片、细腻边框与轻阴影；克制的金融编辑风格，信息密度高但不杂乱。\n- A 股颜色惯例：上涨用红色（--rise）、下跌用绿色（--fall）；所有涨跌数值必须同时用 +- 文字表达，不能只靠颜色。\n- 版式自上而下：顶部信息条（报告名/日期/打印按钮）→ 首屏标题与摘要 + 市场温度（0-100，可缺省）→ 主要指数卡片 → 市场广度统计网格（上涨/下跌/涨停/跌停/连板/成交额）→ 主线板块卡片 → 连板梯队表格 → 明日观察要点 → 底部免责声明。\n- 自包含：<style> 内联，定义 :root 设计变量（--bg/--surface/--ink/--muted/--line/--rise/--fall/--amber/--radius），body 内直接用变量排版。\n- 全响应式：375/768/1024/1440 无横向溢出；移动端单列、按钮触控目标 ≥44px；数字用等宽数字（tabular-nums）。\n- 打印样式：高对比浅色、隐藏打印按钮、区块避免跨页断裂。\n- 语义化标题与可见键盘焦点；正文对比度 ≥4.5:1；尊重 prefers-reduced-motion。\n\n【硬性要求】\n1) 内容严格来自提供的 Markdown，禁止编造具体行情数字；Markdown 中缺失的字段显示"待补充"或留空，不要硬填。\n2) 只输出一个完整自包含 HTML，以 <!doctype html> 开头；不要输出代码块围栏、解释文字或 Markdown。\n3) 在 </body> 之前嵌入 <script type="application/json" id="report-data">，内容为按下面 JSON Schema 从 Markdown 提炼的结构化数据。JSON 必须严格合法（无注释、无尾逗号）。\n4) 日期一致性：报告中所有出现在标题、顶部信息条、日期徽标、章节小标题、底部"数据截至"等位置的具体日期，必须与「报告日期」完全一致，且统一使用 YYYY-MM-DD 格式；严禁展示任何其他日期（如生成时间、撰写时间、数据采集时间等，一律省略或替换为报告日期）；报告标题格式统一为「报告日期 + A股收盘复盘」，若标题含其他日期必须改为报告日期。\n\n【report-data JSON Schema】（缺失用 null 或空数组，禁止伪造）\n{\n  "title": "string 报告标题",\n  "summary": "string 一句话摘要",\n  "temperature": "0-100 的整数，或 null（无法判定时用 null）",\n  "indices": [{ "name": "string 指数名", "value": "string 收盘点位，可省略", "change": "带符号字符串，如 +0.62 或 -0.93，可含 %" }],\n  "breadth": { "up": "数字", "down": "数字", "limitUp": "数字", "limitDown": "数字", "streak": "数字 连板家数", "turnover": "string 成交额，如 1.72 万亿" },\n  "mainline": ["string 主线方向名称"],\n  "leadingStocks": [{ "level": "string 如 5 连板", "name": "string 个股", "sector": "string 板块" }],\n  "nextFocus": ["string 明日可验证观察点"],\n  "warnings": ["string 风险提示"]\n}';
  const user = `报告日期：${date}\n报告标题：${title}\n\n需要排版并提取结构化数据的 Markdown 行情复盘内容：\n\n${markdown}`;
  const html = extractHtml(await callAiModel({ system, user, config, maxTokens: 32768 }));
  if (!html) throw new Error('AI 未返回有效 HTML。');
  return html;
}
async function applyReport(body) {
  const markdown = typeof body.markdown === 'string' ? body.markdown.trim() : '';
  if (!markdown) { const error = new Error('缺少 markdown 内容。'); error.statusCode = 400; throw error; }
  const date = String(body.date || '').trim();
  if (!date) { const error = new Error('缺少行情日期 date，请以 YYYY-MM-DD 传入行情所属交易日。'); error.statusCode = 400; throw error; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { const error = new Error('请输入 YYYY-MM-DD 格式的交易日。'); error.statusCode = 400; throw error; }
  if (date > todayKey()) { const error = new Error('不能上传未来日期的报告。'); error.statusCode = 400; throw error; }
  const { title: rawTitle, summary: rawSummary, body: mdBody } = extractReportMeta(markdown);
  const title = rawTitle ? normalizeReportDate(rawTitle, date) : `${date} A股收盘复盘`;
  const summary = rawSummary || '外部分析报告。';
  const relativePath = `/reports/${date}/${date}-analysis.html`;
  const reportFile = path.join(PROJECT_ROOT, relativePath.replace(/^\//, ''));
  const mdFile = path.join(PROJECT_ROOT, `reports/${date}/${date}-analysis.md`);
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  // API 仅接收并保存数据（触发点）：MD 立即落盘，基础渲染 HTML 立即可用；AI 排版由后台独立任务异步升级
  fs.writeFileSync(mdFile, markdown, 'utf8');
  const { html } = await renderMdReport(date, markdown);
  fs.writeFileSync(reportFile, html, 'utf8');
  const completedAt = new Date().toISOString();
  const day = ensureTradingDay(date);
  day.analysisStatus = 'analyzed';
  day.reportPath = relativePath;
  day.analysis = { title, summary, source: 'upload', uploadedAt: completedAt, temperature: null };
  const aiConfigured = appConfig?.aiEnabled !== false && appConfig?.apiKey && appConfig?.baseUrl;
  day.analysisTask = aiConfigured ? { status: 'running', trigger: 'upload', startedAt: completedAt, source: 'upload' } : { status: 'completed', trigger: 'upload', startedAt: completedAt, completedAt, source: 'upload' };
  if (!day.marketStatus) day.marketStatus = 'closed';
  day.updatedAt = completedAt;
  await persist();
  scheduleAiRender(date, mdBody, title, summary);
  return { date, reportPath: relativePath, title, summary, day: publicDay(day) };
}
function scheduleAiRender(date, markdown, title, summary) {
  const aiConfig = appConfig || {};
  if (aiConfig.aiEnabled === false || !aiConfig.apiKey || !aiConfig.baseUrl) return;
  setTimeout(async () => {
    try {
      const aiHtml = await requestAiHtml({ date, title, markdown, config: aiConfig });
      const reportFile = path.join(PROJECT_ROOT, `reports/${date}/${date}-analysis.html`);
      fs.writeFileSync(reportFile, aiHtml, 'utf8');
      const day = ensureTradingDay(date);
      const reportData = extractReportData(aiHtml);
      if (reportData) {
        const { title: _analysisTitle, ...reportFields } = reportData;
        Object.assign(day.analysis, reportFields);
        if (!day.analysis.summary || /^[-*_]{2,}\s*$/.test(day.analysis.summary)) day.analysis.summary = summary;
      }
      if (typeof day.analysis.temperature !== 'number' || Number.isNaN(day.analysis.temperature)) day.analysis.temperature = null;
      day.analysisTask = { status: 'completed', trigger: 'upload', startedAt: day.analysis?.uploadedAt || new Date().toISOString(), completedAt: new Date().toISOString(), source: 'upload' };
      day.updatedAt = new Date().toISOString();
      await persist();
      console.log(`[AI 排版完成] ${date}`);
    } catch (error) {
      try {
        const day = ensureTradingDay(date);
        day.analysisTask = { status: 'failed', trigger: 'upload', startedAt: day.analysisTask?.startedAt || new Date().toISOString(), completedAt: new Date().toISOString(), source: 'upload' };
        day.updatedAt = new Date().toISOString();
        await persist();
      } catch { /* 忽略状态回写失败 */ }
      console.error(`[AI 排版失败，保留基础渲染] ${date}:`, error.message);
    }
  }, 0);
}
async function regenerateReport(date) {
  const mdFile = path.join(PROJECT_ROOT, `reports/${date}/${date}-analysis.md`);
  if (!fs.existsSync(mdFile)) { const error = new Error('该日没有可重新生成的 Markdown 源文件，请先上传报告。'); error.statusCode = 400; throw error; }
  const markdown = fs.readFileSync(mdFile, 'utf8');
  const { title: rawTitle, summary: rawSummary, body } = extractReportMeta(markdown);
  const title = rawTitle ? normalizeReportDate(rawTitle, date) : `${date} A股收盘复盘`;
  const summary = rawSummary || '外部分析报告。';
  const day = ensureTradingDay(date);
  day.analysisTask = { status: 'running', trigger: 'manual', startedAt: new Date().toISOString(), completedAt: null, source: 'upload' };
  await persist();
  scheduleAiRender(date, body, title, summary);
  return { ok: true, date, status: 'rendering' };
}
function sendReportError(res, error) {
  if (error?.statusCode === 413) return send(res, 413, { error: '请求体过大，markdown 需在 5MB 以内。' });
  if (error?.statusCode === 400) return send(res, 400, { error: error.message });
  if (String(error?.message).includes('invalid json')) return send(res, 400, { error: '请求格式不正确。' });
  return send(res, 500, { error: String(error?.message || '报告写入失败。').slice(0, 240) });
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, APP_URL);
  const disabledEmailPaths = new Set(['/api/me', '/api/register', '/api/verify', '/api/login', '/api/logout', '/api/subscribe', '/api/unsubscribe']);
  if (disabledEmailPaths.has(url.pathname)) return send(res, 410, { error: '邮件订阅功能已停用。', code: 'email_subscription_disabled' });
  if (req.method === 'GET' && url.pathname === '/api/today') { const latest = latestAnalyzedDay(); return send(res, 200, { ...publicDay(ensureTradingDay()), latestAnalyzed: latest ? publicDay(latest) : null }); }
  if (req.method === 'POST' && url.pathname === '/api/admin/login') { try { const body = await readBody(req); if (String(body.key || '') !== ADMIN_KEY) return send(res, 403, { error: '授权密码不正确。' }); const token = id(24); store.adminSessions = (store.adminSessions || []).filter(session => session.expiresAt > Date.now()); store.adminSessions.push({ token, expiresAt: Date.now() + 1000 * 60 * 60 * 8 }); persist(); res.setHeader('Set-Cookie', `admin_sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`); return send(res, 200, { ok: true, expiresAt: Date.now() + 1000 * 60 * 60 * 8 }); } catch { return send(res, 400, { error: '请求格式不正确。' }); } }
  if (req.method === 'GET' && url.pathname === '/api/admin/session') return send(res, 200, { authenticated: adminAuthenticated(req) });
  if (req.method === 'POST' && url.pathname === '/api/admin/logout') { const token = cookieValue(req, 'admin_sid'); store.adminSessions = (store.adminSessions || []).filter(session => session.token !== token); persist(); res.setHeader('Set-Cookie', 'admin_sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'); return send(res, 200, { ok: true }); }
  if (req.method === 'GET' && url.pathname === '/api/admin/overview') { if (!adminAuthenticated(req)) return send(res, 403, { error: 'Forbidden' }); const day = ensureTradingDay(); return send(res, 200, { today: publicDay(day), users: store.users.map(user => ({ id: user.id, email: user.email, verified: user.verified, subscriptions: user.subscriptions, createdAt: user.createdAt })), deliveries: store.deliveries.slice(-50).reverse(), tradingDays: store.tradingDays.slice().sort((a, b) => b.date.localeCompare(a.date)), ...adminStats() }); }
  if (req.method === 'GET' && url.pathname === '/api/admin/settings') { if (!adminAuthenticated(req)) return send(res, 403, { error: 'Forbidden' }); return send(res, 200, publicSettings()); }
  if (req.method === 'PUT' && url.pathname === '/api/admin/settings/email') { if (!adminAuthenticated(req)) return send(res, 403, { error: 'Forbidden' }); return send(res, 410, { error: '邮件订阅功能已停用。', code: 'email_subscription_disabled' }); }
  if (req.method === 'PUT' && url.pathname === '/api/admin/settings/ai') {
    if (!adminAuthenticated(req)) return send(res, 403, { error: 'Forbidden' });
    try {
      const body = await readBody(req); const patch = {};
      if (typeof body.provider === 'string') patch.provider = body.provider.trim().slice(0, 80) || 'OpenAI Compatible';
      if (body.protocol === 'anthropic_messages' || body.protocol === 'openai_responses') patch.protocol = body.protocol;
      if (typeof body.baseUrl === 'string') { const baseUrl = body.baseUrl.trim().slice(0, 300); if (baseUrl && !validHttpUrl(baseUrl)) return send(res, 400, { error: 'Base URL 必须是合法的 http(s) 地址。' }); patch.baseUrl = baseUrl; }
      if (typeof body.model === 'string') patch.model = body.model.trim().slice(0, 200);
      if (typeof body.timeoutSeconds === 'number') patch.timeoutSeconds = Math.min(3600, Math.max(30, Math.round(body.timeoutSeconds)));
      if ('enabled' in body) patch.aiEnabled = body.enabled !== false;
      const apiKey = String(body.apiKey || '').trim(); if (apiKey) patch.apiKey = apiKey;
      if (!Object.keys(patch).length) return send(res, 400, { error: '没有可保存的 AI 配置。' });
      appConfig = await saveAppConfig(patch); return send(res, 200, { ok: true, settings: publicSettings().ai });
    } catch { return send(res, 400, { error: 'AI 配置保存失败。' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/settings/ai/test') {
    if (!adminAuthenticated(req)) return send(res, 403, { error: 'Forbidden' });
    const config = appConfig || {};
    if (config.aiEnabled === false) return send(res, 400, { error: 'AI 排版未启用。' });
    if (!config.apiKey || !config.baseUrl || !config.model) return send(res, 400, { error: '请先配置 Base URL、API Key 与模型。' });
    try {
      const startedAt = Date.now();
      const reply = await callAiModel({ system: '只回复 OK。', user: '连接测试', config, maxTokens: 64 });
      if (!/ok/i.test(reply)) throw new Error(reply ? `AI 回复异常：${reply.slice(0, 120)}` : 'AI 无响应。');
      return send(res, 200, { ok: true, message: `AI 服务连接正常，耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s。` });
    } catch (error) {
      console.error('[AI 检测失败]', error.message);
      return send(res, 502, { error: String(error.message || 'AI 服务连接失败。').slice(0, 200) });
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/api-manual') {
    if (!adminAuthenticated(req)) return send(res, 403, { error: 'Forbidden' });
    try {
      const manualPath = path.join(PROJECT_ROOT, '..', 'docs', 'api-integration-manual.md');
      if (!fs.existsSync(manualPath)) return send(res, 404, { error: '对接手册不存在。' });
      const uploadKey = appConfig?.uploadKey || '';
      const manual = fs.readFileSync(manualPath, 'utf8')
        .replace(/\{BASE\}/g, APP_URL)
        .replace(/\{UPLOAD_KEY\}/g, uploadKey);
      return send(res, 200, { ok: true, manual, baseUrl: APP_URL, uploadKey });
    } catch (error) { return send(res, 500, { error: String(error.message || '读取对接手册失败。').slice(0, 200) }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/upload/report') {
    try {
      const authed = uploadAuthenticated(req);
      if (authed === null) return send(res, 503, { error: '上传密钥尚未生成，请重启服务或到后台“上传密钥”页面设置。' });
      if (!authed) return send(res, 401, { error: '上传密钥无效。' });
      return send(res, 201, { ok: true, ...(await applyReport(await readBody(req, 5e6))) });
    } catch (error) { return sendReportError(res, error); }
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/reports/upload') {
    if (!adminAuthenticated(req)) return send(res, 403, { error: 'Forbidden' });
    try {
      return send(res, 201, { ok: true, ...(await applyReport(await readBody(req, 5e6))) });
    } catch (error) { return sendReportError(res, error); }
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/reports/reset') {
    if (!adminAuthenticated(req)) return send(res, 403, { error: 'Forbidden' });
    try {
      const { date } = await readBody(req);
      const resetDate = String(date || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(resetDate)) return send(res, 400, { error: '请输入 YYYY-MM-DD 格式的交易日。' });
      for (const name of [`${resetDate}-analysis.html`, `${resetDate}-analysis.md`]) {
        const file = path.join(PROJECT_ROOT, 'reports', resetDate, name);
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
      const reportDir = path.join(PROJECT_ROOT, 'reports', resetDate);
      if (fs.existsSync(reportDir) && !fs.readdirSync(reportDir).length) fs.rmdirSync(reportDir);
      const day = ensureTradingDay(resetDate);
      day.analysisStatus = 'waiting_market';
      day.reportPath = null;
      day.analysis = null;
      day.analysisTask = { status: 'waiting', trigger: null };
      day.updatedAt = new Date().toISOString();
      await persist();
      return send(res, 200, { ok: true, day: publicDay(day) });
    } catch (error) { return send(res, 400, { error: String(error?.message || '报告重置失败。').slice(0, 200) }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/reports/regenerate') {
    if (!adminAuthenticated(req)) return send(res, 403, { error: 'Forbidden' });
    try {
      const { date } = await readBody(req);
      const regenDate = String(date || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(regenDate)) return send(res, 400, { error: '请输入 YYYY-MM-DD 格式的交易日。' });
      return send(res, 200, await regenerateReport(regenDate));
    } catch (error) { return send(res, error.statusCode === 400 ? 400 : 500, { error: String(error?.message || '报告重新生成失败。').slice(0, 200) }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/review/run') {
    if (!adminAuthenticated(req)) return send(res, 403, { error: 'Forbidden' });
    try {
      const { date } = await readBody(req);
      const reviewDate = String(date || '').trim() || todayKey();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewDate)) return send(res, 400, { error: '请输入 YYYY-MM-DD 格式的交易日。' });
      const result = await runDailyReview(reviewDate);
      const applied = await applyReport({ date: reviewDate, markdown: result.markdown });
      return send(res, 200, { ok: true, stats: { indices: result.indices, limitUp: result.limitUpCount, dragon: result.dragonCount, temperature: result.temperature }, ...applied });
    } catch (error) { return send(res, 500, { error: String(error?.message || '复盘任务执行失败。').slice(0, 240) }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/trading-days') { if (!adminAuthenticated(req)) return send(res, 403, { error: 'Forbidden' }); try { const body = await readBody(req); const date = String(body.date || '').trim(); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return send(res, 400, { error: '请输入 YYYY-MM-DD 交易日。' }); const day = ensureTradingDay(date); day.marketStatus = body.marketStatus || day.marketStatus; day.updatedAt = new Date().toISOString(); persist(); return send(res, 201, publicDay(day)); } catch { return send(res, 400, { error: '请求格式不正确。' }); } }
  if (req.method === 'POST' && url.pathname === '/api/admin/send-daily') { if (!adminAuthenticated(req)) return send(res, 403, { error: 'Forbidden' }); return send(res, 410, { error: '邮件订阅功能已停用，不能发送日报。', code: 'email_subscription_disabled' }); }
  if (req.method === 'GET' && url.pathname === '/api/report') return redirect(res, ensureTradingDay().reportPath || latestAnalyzedDay()?.reportPath || '/');
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/admin' || /^\/admin\/(today|report-upload|reports|analysis|progress|users|ai|email|api-manual)$/.test(url.pathname))) return send(res, 200, APP_SHELL, 'text/html');
  if (req.method === 'GET') {
    const requested = decodeURIComponent(url.pathname);
    const root = requested.startsWith('/assets/') ? path.join(PUBLIC_DIR, 'assets') : PROJECT_ROOT;
    const relative = requested.startsWith('/assets/') ? requested.slice('/assets/'.length) : requested.replace(/^\/+/, '');
    const file = path.resolve(root, relative);
    const rootPath = path.resolve(root);
    const insideRoot = file === rootPath || file.startsWith(rootPath + path.sep);
    if (insideRoot && (requested.startsWith('/assets/') || requested.startsWith('/reports/')) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      const ext = path.extname(file).toLowerCase();
      const type = ext === '.html' ? 'text/html' : ext === '.css' ? 'text/css' : ext === '.mjs' || ext === '.js' ? 'text/javascript' : ext === '.md' ? 'text/markdown' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.svg' ? 'image/svg+xml' : 'application/octet-stream';
      const stat = fs.statSync(file);
      const lastModified = stat.mtime.toUTCString();
      if (requested.startsWith('/assets/')) {
        const ims = req.headers['if-modified-since'];
        if (ims && new Date(ims).getTime() >= Math.floor(stat.mtime.getTime() / 1000) * 1000) {
          res.writeHead(304, { 'Cache-Control': 'public, max-age=600', 'Last-Modified': lastModified });
          return res.end();
        }
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'public, max-age=600', 'Last-Modified': lastModified });
        return res.end(fs.readFileSync(file));
      }
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(file));
    }
  }
  send(res, 404, { error: 'Not found' });
});
async function start() {
  await initializeDatabase();
  store = await loadState();
  store.sessions = (store.sessions || []).filter(session => session.expiresAt > Date.now());
  store.adminSessions = (store.adminSessions || []).filter(session => session.expiresAt > Date.now());
  appConfig = await loadAppConfig();
  if (!appConfig.uploadKey) appConfig = await saveAppConfig({ uploadKey: generateUploadKey() });
  await persist();
  server.listen(PORT, () => console.log('行情日报服务运行于 ' + APP_URL));
}
start().catch(error => { console.error('PostgreSQL 初始化失败：', error.message); process.exit(1); });
setInterval(async () => {
  const now = chinaClock();
  const day = now.date;
  // 内置复盘：收盘后（15:35 起）若当日尚未生成报告，自动取数生成
  if (lastAutoReviewDate !== day && !['Sat', 'Sun'].includes(now.weekday) && (now.hour > 15 || (now.hour === 15 && now.minute >= 35))) {
    const today = ensureTradingDay(day);
    lastAutoReviewDate = day;
    if (today.analysisStatus === 'waiting_market') {
      console.log(`[内置复盘] ${day} 自动开始…`);
      try { await applyReport({ date: day, markdown: (await runDailyReview(day)).markdown }); console.log(`[内置复盘] ${day} 完成`); }
      catch (error) { console.error(`[内置复盘] ${day} 失败：`, error.message); }
    }
  }
}, 60 * 1000);
