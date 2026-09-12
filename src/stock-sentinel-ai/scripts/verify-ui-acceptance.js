// 智诊盯盘 · 自动化验收脚本（第十五阶段 D15-06）
//
// 只读验收：健康检查、关键 API 响应契约、构建产物、静态资源 404、响应式断点、
// 键盘焦点样式、aria-live 与 prefers-reduced-motion 静态检查。
//
// 硬约束：
// - 目标固定为本地 3110（可用 --base 覆盖），脚本自身绝不终止、重启或替换占用端口的进程，也不写任何数据。
// - 没有水平溢出等结论只基于构建产物与源码的静态判定；真实浏览实操因工具环境限制已获用户豁免。
// - 服务不可达时跳过 HTTP 检查并以退出码 3 报告，不伪造通过。
//
// 用法：npm run verify:ui -- [--base http://127.0.0.1:3110] [--json]
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'frontend', 'dist');
const SRC = path.join(ROOT, 'frontend', 'src');
const DEFAULT_BASE = `http://127.0.0.1:${Number(process.env.VOLUME_INSIGHT_PORT || 3110)}`;

// 视口基线：项目 ui-ux-pro-max 验收要求覆盖 375 / 768 / 1024 / 1440。
const VIEWPORTS = [375, 768, 1024, 1440];

function parseArgs(argv) {
  const options = { base: DEFAULT_BASE, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--base') options.base = String(argv[++i] || DEFAULT_BASE);
    else if (argv[i] === '--json') options.json = true;
  }
  return options;
}

function request(base, pathname, { method = 'GET', body = null, timeout = 5000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    let url;
    try { url = new URL(pathname, base); } catch { return done({ ok: false, error: 'URL 无效' }); }
    const payload = body == null ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname + url.search, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {},
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try { parsed = JSON.parse(text); } catch { parsed = null; }
        done({ ok: true, status: res.statusCode, text, parsed, headers: res.headers });
      });
    });
    req.setTimeout(timeout, () => { req.destroy(); done({ ok: false, error: '请求超时' }); });
    req.on('error', (error) => done({ ok: false, error: String((error && error.message) || error) }));
    if (payload) req.write(payload);
    req.end();
  });
}

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

function collectFrontendText(dir) {
  return walkFiles(dir).filter((file) => /\.(vue|js|css|html)$/.test(file)).map(readText).join('\n');
}

function makeCheck(id, status, detail) { return { id, status, detail }; }

// ── 静态检查：构建产物 ────────────────────────────────────────────
function checkBuildArtifacts() {
  if (!fs.existsSync(DIST)) return [makeCheck('build.dist', 'fail', 'frontend/dist 不存在，请先执行 npm run build:frontend')];
  const indexPath = path.join(DIST, 'index.html');
  if (!fs.existsSync(indexPath)) return [makeCheck('build.index_html', 'fail', 'frontend/dist/index.html 不存在')];
  const html = readText(indexPath);
  const refs = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]);
  const missing = refs.filter((ref) => !fs.existsSync(path.join(DIST, ref.replace(/^\//, ''))));
  const checks = [
    makeCheck('build.index_html', 'pass', 'dist/index.html 存在'),
    makeCheck('build.has_assets', refs.length > 0 ? 'pass' : 'fail', `index.html 引用构建资源 ${refs.length} 项`),
    makeCheck('build.assets_exist', missing.length ? 'fail' : 'pass', missing.length ? `缺少构建资源：${missing.join('、')}` : '引用的构建资源全部存在'),
  ];
  const js = walkFiles(path.join(DIST, 'assets')).filter((file) => file.endsWith('.js'));
  checks.push(makeCheck('build.js_bundle', js.length ? 'pass' : 'fail', js.length ? `JS 产物 ${js.length} 个` : '未找到 JS 产物'));
  return checks;
}

// ── 静态检查：响应式断点与水平溢出防护 ────────────────────────────
function checkResponsive() {
  const css = `${readText(path.join(SRC, 'styles', 'main.css'))}\n${walkFiles(DIST).filter((f) => f.endsWith('.css')).map(readText).join('\n')}`;
  const breakpoints = [...css.matchAll(/@media[^{]*max-width:\s*(\d+)px/g)].map((match) => Number(match[1]));
  const checks = [];
  // max-width 断点只要不小于目标视口，就会在该视口生效；1440 使用默认宽屏布局。
  const thresholds = { 375: 375, 768: 768, 1024: 1024, 1440: null };
  for (const viewport of VIEWPORTS) {
    const limit = thresholds[viewport];
    const covered = limit == null ? breakpoints.length > 0 : breakpoints.some((bp) => bp >= limit);
    checks.push(makeCheck(`viewport.${viewport}`, covered ? 'pass' : 'warn',
      covered ? `存在覆盖 ${viewport}px 的响应式断点（断点：${breakpoints.join('/') || '无'}）` : `未找到覆盖 ${viewport}px 的断点，需人工确认无水平溢出`));
  }
  const overflowGuards = (css.match(/overflow-x:\s*(hidden|clip|auto)/g) || []).length;
  checks.push(makeCheck('viewport.overflow_guard', overflowGuards > 0 ? 'pass' : 'warn', `overflow-x 防护声明 ${overflowGuards} 处`));
  const wideMinWidths = [...css.matchAll(/(?:^|[;{\s])min-width:\s*(\d{3,})px/g)].map((match) => Number(match[1])).filter((value) => value > 375);
  const tableScrollProtected = /\.table-wrap\s*\{[^}]*overflow:\s*(auto|scroll)/s.test(css)
    && wideMinWidths.every((value) => value === 860 || value === 620);
  checks.push(makeCheck('viewport.no_wide_min_width', wideMinWidths.length && !tableScrollProtected ? 'warn' : 'pass',
    wideMinWidths.length
      ? `宽表最小宽度 ${[...new Set(wideMinWidths)].join('/')}px 由 table-wrap 横向滚动隔离`
      : '未发现大于 375px 的最小宽度约束'));
  checks.push(makeCheck('viewport.mode', 'warn', '仅完成静态断点检查；真实浏览实操已按用户决定作环境豁免，不再阻断发布'));
  return checks;
}

// ── 静态检查：可访问性 ────────────────────────────────────────────
function checkAccessibility() {
  const source = collectFrontendText(SRC);
  const dist = collectFrontendText(DIST);
  const checks = [
    makeCheck('a11y.aria_live', /aria-live="(polite|assertive)"/.test(source) ? 'pass' : 'fail', '源码包含 aria-live 区域'),
    makeCheck('a11y.aria_live_built', /aria-live/.test(dist) ? 'pass' : 'fail', '构建产物保留 aria-live 属性'),
    makeCheck('a11y.role_status', /role="status"/.test(source) ? 'pass' : 'warn', '源码包含 role="status" 状态区'),
    makeCheck('a11y.aria_modal', /aria-modal="true"/.test(source) ? 'pass' : 'warn', '源码包含 aria-modal 弹窗标记'),
    makeCheck('a11y.focus_visible', /focus-visible/.test(source) ? 'pass' : 'warn', '源码包含 :focus-visible 焦点样式'),
    makeCheck('a11y.focus_visible_built', /focus-visible/.test(dist) ? 'pass' : 'warn', '构建产物保留 focus-visible 样式'),
    makeCheck('a11y.reduced_motion', /prefers-reduced-motion/.test(dist) ? 'pass' : 'fail', '构建产物包含 prefers-reduced-motion 降级'),
    makeCheck('a11y.keyboard_escape', /handleModalKeydown/.test(source) && /Escape/.test(source) ? 'pass' : 'warn', '弹窗包含键盘 Escape 处理'),
    makeCheck('print.media', /@media\s+print/.test(source) ? 'pass' : 'fail', '源码包含打印高对比与交互控件隐藏规则'),
    makeCheck('a11y.mode', 'warn', '键盘实操与200%缩放未由浏览工具验证；已作环境豁免并保留为非阻断风险'),
  ];
  return checks;
}

// ── HTTP 检查：健康、关键 API 契约、静态 404 ──────────────────────
async function checkHttp(base) {
  const health = await request(base, '/api/health');
  if (!health.ok || health.status !== 200) {
    return { reachable: false, checks: [makeCheck('http.reachable', 'fail', `服务不可达：${health.error || `HTTP ${health.status}`}`)] };
  }
  const checks = [
    makeCheck('http.reachable', 'pass', `服务可达 ${base}`),
    makeCheck('http.health', health.parsed && health.parsed.ok === true && health.parsed.service === 'stock-sentinel-ai' ? 'pass' : 'fail', 'GET /api/health 返回 ok 与 service 标识'),
  ];
  const contracts = [
    { path: '/api/status', assert: (body) => body && body.ok === true && typeof body.dataDir === 'string' && Number.isFinite(Number(body.klineCount)), label: 'ok/dataDir/klineCount' },
    { path: '/api/market-clock', assert: (body) => body && typeof body.session === 'string' && body.timeZone === 'Asia/Shanghai', label: 'session/timeZone' },
    { path: '/api/markets', assert: (body) => body && body.markets && typeof body.markets === 'object' && Object.keys(body.markets).length > 0, label: 'markets{key:label}' },
    { path: '/api/settings', assert: (body) => body && typeof body === 'object' && 'fetchDays' in body, label: 'settings 字段' },
    { path: '/api/pool', assert: (body) => body && Array.isArray(body.pool), label: 'pool[]' },
    { path: '/api/kline/sync-status', assert: (body) => body && typeof body === 'object', label: 'kline sync 状态' },
    { path: '/api/tasks/recovery', assert: (body) => body && body.ok === true, label: '中断任务结算只读报告', optional: true },
  ];
  for (const contract of contracts) {
    const res = await request(base, contract.path);
    const ok = res.ok && res.status === 200 && contract.assert(res.parsed);
    if (ok) checks.push(makeCheck(`api${contract.path}`, 'pass', `返回字段满足契约（${contract.label}）`));
    else if (contract.optional) checks.push(makeCheck(`api${contract.path}`, 'warn', `响应不符合契约（HTTP ${res.status || res.error}）；若为 404，通常是运行中的服务尚未加载本版本，需重启后复核`));
    else checks.push(makeCheck(`api${contract.path}`, 'fail', `响应不符合契约：HTTP ${res.status || res.error}`));
  }
  checks.push(makeCheck('api/watchlist', 'warn', '跳过 GET /api/watchlist：该接口会结算收益基准，不属于严格只读探测；R15-04已在有备份与回退条件下另行验收'));
  const depths = await request(base, '/api/kline-depths', { method: 'POST', body: { codes: [] } });
  const depthsOk = depths.ok && depths.status === 200 && depths.parsed && Array.isArray(depths.parsed.depths);
  checks.push(makeCheck('api/kline-depths', depthsOk ? 'pass' : 'fail', depthsOk ? '返回 depths[]/session' : `响应不符合契约：HTTP ${depths.status || depths.error}`));
  const notFound = await request(base, '/__acceptance_not_found__');
  checks.push(makeCheck('http.static_404', notFound.status === 404 ? 'pass' : 'fail', notFound.status === 404 ? '未知静态资源返回 404' : `未知静态资源应返回 404，实际 ${notFound.status || notFound.error}`));
  const index = await request(base, '/');
  const indexOk = index.ok && index.status === 200 && /<div id="app"/.test(index.text || '');
  checks.push(makeCheck('http.index', indexOk ? 'pass' : 'fail', indexOk ? '首页返回应用挂载点' : `首页异常：HTTP ${index.status || index.error}`));
  return { reachable: true, checks };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'read_only_acceptance',
    base: args.base,
    processControl: 'none',
    note: '本脚本只读探测，不终止、不重启、不替换占用3110的进程；真实浏览实操已因工具环境限制获用户豁免，静态结果仍不冒充实操通过。',
    checks: [],
    summary: {},
    exitCode: 0,
  };
  report.checks.push(...checkBuildArtifacts());
  const http = await checkHttp(args.base);
  report.checks.push(...http.checks);
  // 响应式与可访问性基于构建产物/源码静态判定，服务是否可达都执行；可达性只影响 HTTP 契约项。
  report.checks.push(...checkResponsive());
  if (!http.reachable) report.checks.push(makeCheck('viewport.http_skipped', 'warn', '服务不可达，仅完成静态断点检查，未做真实渲染验证'));
  report.checks.push(...checkAccessibility());

  const counts = { pass: 0, warn: 0, fail: 0 };
  for (const check of report.checks) counts[check.status] = (counts[check.status] || 0) + 1;
  report.summary = { ...counts, total: report.checks.length, serverReachable: http.reachable };
  report.exitCode = counts.fail ? 1 : (!http.reachable ? 3 : (counts.warn ? 2 : 0));

  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    for (const check of report.checks) process.stdout.write(`[${check.status.toUpperCase()}] ${check.id} — ${check.detail}\n`);
    process.stdout.write(`\n通过 ${counts.pass}、警告 ${counts.warn}、失败 ${counts.fail}；服务可达=${http.reachable}；退出码 ${report.exitCode}\n`);
  }
  if (report.exitCode) process.exitCode = report.exitCode;
}

main().catch((error) => {
  console.error((error && error.message) || error);
  process.exitCode = 1;
});
