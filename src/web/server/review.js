// 内置 A 股每日复盘：腾讯（首选，不封IP）+ 东方财富（深度数据）取数 → 温度 → 生成复盘 Markdown
// 由 server/index.js 定时调度，生成结果走 applyReport（AI 排版 + 首页提炼）
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const REQUEST_GAP_MS = 1100; // 东财 2025 起风控加强：所有东财请求串行限流 ≥1s

async function emJson(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Referer: 'https://quote.eastmoney.com/' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

// ── 腾讯行情（首选，单次可拿多标的） ──────────────
const TX_SYMBOLS = {
  'sh000001': '上证指数', 'sz399001': '深证成指', 'sz399006': '创业板指', 'sh000688': '科创50',
  'sh000300': '沪深300', 'sh000905': '中证500', 'sh000852': '中证1000',
  'hkHSI': '恒生指数', 'hkHSTECH': '恒生科技',
  'usIXIC': '纳斯达克', 'usINX': '标普500', 'usDJI': '道琼斯',
};
async function fetchTencentQuotes(symbols) {
  const response = await fetch(`https://qt.gtimg.cn/q=${symbols.join(',')}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) });
  const buf = Buffer.from(await response.arrayBuffer());
  const decoded = new TextDecoder('gbk').decode(buf);
  const out = {};
  for (const line of decoded.split(';')) {
    const m = line.match(/v_(\w+)="([^"]*)"/);
    if (!m) continue;
    const f = m[2].split('~');
    if (f.length < 6) continue;
    out[m[1]] = { name: f[1], latest: Number(f[3]), prevClose: Number(f[4]) || Number(f[3]), open: Number(f[5]) || null, volume: Number(f[6]) || 0, amountWan: Number(f[37]) || 0, pe: Number(f[39]) || null };
  }
  return out;
}

// ── A 块 · 大盘指数（腾讯首选，东财兜底） ─────────
const INDICES = ['sh000001', 'sz399001', 'sz399006', 'sh000688', 'sh000300', 'sh000905', 'sh000852'];
const EM_INDEX_FALLBACK = { sh000001: [1, '000001'], sz399001: [0, '399001'], sz399006: [0, '399006'], sh000688: [1, '000688'], sh000300: [1, '000300'], sh000905: [1, '000905'], sh000852: [1, '000852'] };
async function fetchIndexEm(market, code) {
  const fields = 'f43,f57,f58,f170,f169,f47,f48';
  const d = await emJson(`https://push2delay.eastmoney.com/api/qt/stock/get?secid=${market}.${code}&fields=${fields}`);
  const row = d?.data;
  if (!row) throw new Error(`${code} 无数据`);
  return { name: String(row.f58 || ''), close: Number(row.f43) / 100, change: Number(row.f169) / 100, changePct: Number(row.f170) / 100, amountYi: Math.round((Number(row.f48) || 0) / 1e8 * 100) / 100, volume: Number(row.f47) || 0 };
}
async function fetchMarketIndices() {
  let quotes;
  try { quotes = await fetchTencentQuotes(INDICES); }
  catch { quotes = null; }
  const indices = [];
  for (const sym of INDICES) {
    const name = TX_SYMBOLS[sym];
    if (quotes && quotes[sym] && quotes[sym].latest > 0) {
      const q = quotes[sym];
      indices.push({ name, close: q.latest, change: Math.round((q.latest - q.prevClose) * 100) / 100, changePct: Math.round((q.latest - q.prevClose) / q.prevClose * 10000) / 100, amountYi: q.amountWan ? Math.round(q.amountWan / 10000 * 100) / 100 : null, volume: q.volume, pe: q.pe });
    } else {
      try {
        const [mkt, code] = EM_INDEX_FALLBACK[sym];
        const r = await fetchIndexEm(mkt, code);
        if (r && r.name) indices.push({ ...r, name });
      } catch (error) { console.error(`[复盘] 指数 ${sym} 兜底失败：`, error.message); }
      await sleep(REQUEST_GAP_MS);
    }
  }
  return indices;
}

// ── E 块 · 行业板块涨幅（东财 push2delay，f62=主力净流入） ──
async function fetchSectors() {
  try {
    const d = await emJson('https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=5&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:2&fields=f12,f14,f3,f62');
    const rows = d?.data?.diff || [];
    return rows.map(r => ({ name: String(r.f14 || ''), changePct: Number(r.f3) || 0, inflowYi: Math.round((Number(r.f62) || 0) / 1e8 * 100) / 100 })).filter(r => r.name);
  } catch (error) { console.error('[复盘] 行业板块失败：', error.message); return []; }
}

// ── D 块 · 板块主力资金净流入 Top 5（东财 push2delay，fid=f62） ──
async function fetchSectorFundFlow() {
  try {
    const d = await emJson('https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=5&po=1&np=1&fltt=2&invt=2&fid=f62&fs=m:90+t:2&fields=f12,f14,f3,f62');
    const rows = d?.data?.diff || [];
    return rows.map(r => ({ name: String(r.f14 || ''), changePct: Number(r.f3) || 0, inflowYi: Math.round((Number(r.f62) || 0) / 1e8 * 100) / 100 })).filter(r => r.name && r.inflowYi > 0);
  } catch (error) { console.error('[复盘] 板块资金流失败：', error.message); return []; }
}

// ── H 块 · 今日要闻（东财快讯，JSONP 需去前缀） ────
async function fetchNews(date) {
  try {
    const response = await fetch('https://newsapi.eastmoney.com/kuaixun/v1/getlist_102_ajaxResult_50_1_.html', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Referer: 'https://kuaixun.eastmoney.com/' },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const json = JSON.parse(text.replace(/^var\s+\w+\s*=\s*/, '').replace(/;\s*$/, ''));
    const list = json?.LivesList || [];
    return list
      .filter(n => n.showtime && n.showtime.slice(0, 10) === date)
      .map(n => ({ time: String(n.showtime).slice(11, 16), title: String(n.title || '').trim(), digest: String(n.digest || '').trim() }))
      .filter(n => n.title)
      .slice(0, 8);
  } catch (error) { console.error('[复盘] 今日要闻失败：', error.message); return []; }
}

// ── G 块 · 港股/美股（腾讯） ────────────────────
async function fetchGlobalIndices() {
  const syms = ['hkHSI', 'hkHSTECH', 'usIXIC', 'usINX', 'usDJI'];
  try {
    const quotes = await fetchTencentQuotes(syms);
    return syms.map(s => { const q = quotes[s]; return q && q.latest > 0 ? { name: TX_SYMBOLS[s], close: q.latest, change: Math.round((q.latest - q.prevClose) * 100) / 100, changePct: Math.round((q.latest - q.prevClose) / q.prevClose * 10000) / 100 } : null; }).filter(Boolean);
  } catch (error) { console.error('[复盘] 港美股失败：', error.message); return []; }
}

// ── B 块 · 涨停池（连板梯队） ─────────────────────
async function fetchLimitUpPool(dateYYYYMMDD) {
  const d = await emJson(`https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=60&sort=fbt%3Aasc&date=${dateYYYYMMDD}`);
  const pool = d?.data?.pool || [];
  const stocks = pool.map(p => ({ code: p.c, name: p.n, changePct: p.zdp, streak: p.lbc, sector: p.hybk || '' }));
  return { count: pool.length, stocks };
}

// ── F 块 · 龙虎榜（datacenter，稳定） ────────────
async function fetchDragonTiger(date) {
  const filter = encodeURIComponent(`(TRADE_DATE>='${date}')(TRADE_DATE<='${date}')`);
  const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_DAILYBILLBOARD_DETAILSNEW&columns=SECURITY_CODE,SECURITY_NAME_ABBR,TRADE_DATE,EXPLANATION,CLOSE_PRICE,CHANGE_RATE,BILLBOARD_NET_AMT,BILLBOARD_BUY_AMT,BILLBOARD_SELL_AMT,TURNOVERRATE&filter=${filter}&pageNumber=1&pageSize=20&sortColumns=BILLBOARD_NET_AMT&sortTypes=-1&source=WEB&client=WEB`;
  const d = await emJson(url);
  const rows = d?.result?.data || [];
  return rows.map(r => ({
    name: String(r.SECURITY_NAME_ABBR || ''), code: String(r.SECURITY_CODE || ''),
    changePct: Number(r.CHANGE_RATE || 0), netBuy: Math.round((Number(r.BILLBOARD_NET_AMT) || 0) / 1e8 * 100) / 100,
    buy: Math.round((Number(r.BILLBOARD_BUY_AMT) || 0) / 1e8 * 100) / 100,
    sell: Math.round((Number(r.BILLBOARD_SELL_AMT) || 0) / 1e8 * 100) / 100,
    reason: String(r.EXPLANATION || ''),
  })).filter(r => r.name);
}

// ── C 块 · 技术指标（东财 push2his 日K 计算） ───
async function fetchDailyKline(symbol, date, lmt = 60) {
  const start = addDays(date, -120); // 提前 ~120 天，保证够 40+ 根日K
  const response = await fetch(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,${start},${date},${lmt},qfq`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) });
  const d = await response.json();
  const node = d?.data?.[symbol];
  const arr = node?.qfqday || node?.day || [];
  return arr.filter(k => k[0] <= date).map(k => ({ date: k[0], open: Number(k[1]), close: Number(k[2]), high: Number(k[3]), low: Number(k[4]) }));
}
function addDays(iso, days) {
  const d = new Date(iso + 'T00:00:00+08:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function ema(values, n) { const k = 2 / (n + 1); let out = [values[0]]; for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[i - 1] * (1 - k)); return out; }
function rsi(closes, period = 6) {
  let gain = 0, loss = 0;
  for (let i = 1; i <= period && i < closes.length; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) gain += d; else loss -= d; }
  if (loss === 0) return 100;
  const rs = (gain / period) / (loss / period);
  return 100 - 100 / (1 + rs);
}
function macd(closes) {
  const e12 = ema(closes, 12), e26 = ema(closes, 26);
  const dif = closes.map((_, i) => e12[i] - e26[i]);
  const dea = ema(dif, 9);
  const hist = dif.map((v, i) => 2 * (v - dea[i]));
  return { dif: dif[dif.length - 1], dea: dea[dea.length - 1], hist: hist[hist.length - 1], histPrev: hist[hist.length - 2] };
}
function kdj(kl) {
  const n = kl.length; const k = kl.slice(n - 9);
  const high9 = Math.max(...k.map(x => x.high)), low9 = Math.min(...k.map(x => x.low));
  const c = kl[n - 1].close;
  const rsv = high9 === low9 ? 50 : (c - low9) / (high9 - low9) * 100;
  const K = rsv * 1 / 3 + 50 * 2 / 3, D = K * 1 / 3 + 50 * 2 / 3, J = 3 * K - 2 * D;
  return { K, D, J };
}
function technicalScore(kl) {
  if (kl.length < 30) return null;
  const closes = kl.map(x => x.close);
  const m = macd(closes), r = rsi(closes, 6), k = kdj(kl);
  let score = 0;
  // MACD 10
  if (m.dif > m.dea && m.hist > m.histPrev) score += 10; else if (m.dif > m.dea) score += 7; else if (m.hist < m.histPrev) score += 0; else score += 3;
  // RSI6 10
  if (r > 80) score += 10; else if (r > 65) score += 8; else if (r > 50) score += 6; else if (r > 35) score += 4; else if (r > 20) score += 2;
  // KDJ 5
  if (k.K > k.D && k.J > 80) score += 5; else if (k.K > k.D) score += 3;
  return { score, macd: m.dif > m.dea ? '多头' : '空头', rsi6: Math.round(r), kdj: `${k.K > k.D ? 'K>D' : 'K≤D'} J=${Math.round(k.J)}` };
}
async function fetchTechnicalSentiment(date) {
  const targets = [['sh000001', '上证指数'], ['sz399006', '创业板指']];
  const out = { scores: [], detail: [] };
  for (const [symbol, name] of targets) {
    try {
      const kl = await fetchDailyKline(symbol, date);
      const ts = technicalScore(kl);
      if (ts) { out.scores.push(ts.score); out.detail.push(`${name} ${ts.macd} RSI${ts.rsi6} ${ts.kdj}（${ts.score}/25）`); }
    } catch (error) { console.error(`[复盘] 技术面 ${symbol} 失败：`, error.message); }
    await sleep(300);
  }
  return out;
}

// ── 温度（量价 50 + 技术面 50） ─────────────────
function computeTemperature(indices, limitUpCount, tech = null) {
  let vp = 0; // 量价 0-50
  const ups = indices.filter(i => i.changePct > 0).length;
  vp += indices.length ? (ups / indices.length) * 20 : 10;              // 上涨占比 20
  vp += limitUpCount > 0 ? Math.min(15, 5 + limitUpCount / 10) : 0;      // 涨停情绪 15
  const totalAmount = indices.reduce((s, i) => s + (i.amountYi || 0), 0);
  vp += totalAmount > 0 ? Math.min(15, 5 + totalAmount / 3000) : 0;      // 成交额分 15
  const techTotal = tech?.scores?.length ? tech.scores.reduce((a, b) => a + b, 0) : null;
  const score = Math.round(vp + (techTotal ?? 0));
  return { score, vp: Math.round(vp), tech: techTotal, level: score >= 80 ? '过热 🔥' : score >= 60 ? '偏暖 🌤️' : score >= 40 ? '中性 ☁️' : score >= 20 ? '偏冷 🌧️' : '冰冻 ❄️' };
}

// ── 报告生成 ─────────────────────────────────────
function truncate(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }
function buildMarkdown(date, data) {
  const { indices, limitUp, dragon, global, sectors, fundFlow, tech, temperature, news, watchlist } = data;
  const sectorRows = (sectors || []).map((s, i) => `| ${i + 1} | **${s.name}** | ${s.changePct >= 0 ? '+' : ''}${s.changePct.toFixed(2)}% | ${s.inflowYi >= 0 ? '+' : ''}${s.inflowYi.toFixed(2)} |`).join('\n');
  const flowRows = (fundFlow || []).map((s, i) => `| ${i + 1} | **${s.name}** | ${s.changePct >= 0 ? '+' : ''}${s.changePct.toFixed(2)}% | ${s.inflowYi >= 0 ? '+' : ''}${s.inflowYi.toFixed(2)} |`).join('\n');
  const rows = indices.map(i =>
    `| ${i.name} | ${i.close.toFixed(2)} | ${i.change >= 0 ? '+' : ''}${i.change.toFixed(2)} | ${i.changePct >= 0 ? '+' : ''}${i.changePct.toFixed(2)}% | ${i.amountYi != null ? i.amountYi.toFixed(0) : '-'} | ${i.pe != null ? i.pe.toFixed(1) : '-'} |`
  ).join('\n');
  const topUp = indices.filter(i => i.changePct > 0).sort((a, b) => b.changePct - a.changePct).slice(0, 3).map(i => `${i.name} ${i.changePct.toFixed(2)}%`).join('、');
  const ladder = limitUp.stocks.slice(0, 10).map(s => `| ${s.streak} 连板 | ${s.name} | ${s.sector} |`).join('\n');
  const lhbRows = dragon.slice(0, 10).map(r => `| ${r.name} | ${r.changePct >= 0 ? '+' : ''}${r.changePct.toFixed(2)}% | ${r.netBuy.toFixed(2)} | ${r.reason} |`).join('\n');
  const globalRows = (global || []).map(g => `| ${g.name.includes('恒生') ? '港股' : g.name.includes('纳') || g.name.includes('标普') || g.name.includes('道') ? '美股' : '-'} | ${g.name} | ${g.close.toFixed(2)} | ${g.change >= 0 ? '+' : ''}${g.change.toFixed(2)} | ${g.changePct >= 0 ? '+' : ''}${g.changePct.toFixed(2)}% |`).join('\n');
  const newsRows = (news || []).map(n => `- **${n.time}** ${n.title}${n.digest ? `　— ${truncate(n.digest, 60)}` : ''}`).join('\n');
  const watchRows = (watchlist || []).map(s => `| ${s.name} | ${s.latest.toFixed(2)} | ${s.change >= 0 ? '+' : ''}${s.change.toFixed(2)} | ${s.changePct >= 0 ? '+' : ''}${s.changePct.toFixed(2)}% |`).join('\n');
  const techLine = (tech && tech.detail && tech.detail.length) ? tech.detail.join('；') : '数据暂缺';
  const inflowTop = (fundFlow && fundFlow[0]) ? `${fundFlow[0].name}（主力净流入 ${fundFlow[0].inflowYi.toFixed(2)} 亿）` : '—';
  const topNews = (news && news[0]) ? `关注「${news[0].title}」等消息面扰动` : '关注消息面变化';

  return `# 📈 ${date} A 股每日行情复盘

> 生成时间：${new Date().toISOString().slice(0, 16).replace('T', ' ')} | 数据来源：东方财富公开接口

---

## 一、市场温度 🌡️

| 指标 | 数值 | 说明 |
|------|------|------|
| **市场温度评分** | **${temperature.score} / 100** | 量价 ${temperature.vp} + 技术面 ${temperature.tech ?? '暂缺'} |
| 温度等级 | ${temperature.level} | |

### 评分细则
- 量价情绪分：${temperature.vp}/50（指数上涨占比 + 涨停家数 + 成交额）
- 技术面情绪分：${temperature.tech ?? '数据暂缺'}/50（${techLine}）

---

## 二、A 股大盘概览

| 指数 | 收盘 | 涨跌 | 涨跌幅 | 成交额(亿) | PE-TTM |
|------|------|------|--------|-----------|--------|
${rows}

### 关键解读
- 今日 ${upsLabel(indices)}，领涨 ${topUp || '—'}。

---

## 三、强势板块与资金流 🔥

### 今日领涨板块 Top 5

| 排名 | 板块名称 | 涨跌幅 | 主力净流入(亿) |
|------|----------|--------|---------------|
${sectorRows || '| - | - | - | - |'}

### 板块主力资金净流入 Top 5

| 排名 | 板块名称 | 涨跌幅 | 主力净流入(亿) |
|------|----------|--------|---------------|
${flowRows || '| - | - | - | - |'}

### 涨停与连板梯队

- 涨停家数：${limitUp.count} 家

| 连板 | 个股 | 板块 |
| --- | --- | --- |
${ladder || '| - | - | - |'}

---

## 四、龙虎榜

| 个股 | 涨跌幅 | 净买入(亿) | 上榜原因 |
| --- | --- | --- | --- |
${lhbRows || '| - | - | - |'}

---

## 五、亚太及海外市场

| 市场 | 指数 | 收盘 | 涨跌 | 涨跌幅 |
| --- | --- | --- | --- | --- |
${globalRows || '| - | - | - | - | - |'}

---

## 六、今日要闻 📰

${newsRows || '- 暂无今日要闻'}

---

## 七、自选股观察

| 个股 | 现价 | 涨跌 | 涨跌幅 |
| --- | --- | --- | --- |
${watchRows || '| - | - | - | - |'}

---

## 八、明日关注

- **指数**：${upsLabel(indices)}${topUp ? `，领涨 ${topUp}` : ''}。
- **资金**：主力资金净流入居前的是 ${inflowTop}，关注资金能否延续。
- **技术面**：${techLine}。
- **消息面**：${topNews}。
- 关注领涨板块持续性及量能变化。

---

*本报告由行情日报平台自动生成（东方财富公开数据），仅供参考，不构成投资建议。*`;
}
function upsLabel(indices) {
  const up = indices.filter(i => i.changePct > 0).length;
  const down = indices.filter(i => i.changePct < 0).length;
  return up > down ? '主要指数多数收涨' : '主要指数多数收跌';
}

// ── 主入口：抓数据 → 生成 Markdown ─────────────
async function runDailyReview(date) {
  const dateCompact = date.replace(/-/g, '');
  const [indices, limitUp, dragon, global, sectors, fundFlow, tech, news, watchlist] = await Promise.all([
    fetchMarketIndices(),
    fetchLimitUpPool(dateCompact),
    fetchDragonTiger(date),
    fetchGlobalIndices(),
    fetchSectors(),
    fetchSectorFundFlow(),
    fetchTechnicalSentiment(date),
    fetchNews(date),
    fetchStockQuotes(WATCHLIST),
  ]);
  const temperature = computeTemperature(indices, limitUp.count, tech);
  const markdown = buildMarkdown(date, { indices, limitUp, dragon, global, sectors, fundFlow, tech, temperature, news, watchlist });
  return { markdown, indices: indices.length, limitUpCount: limitUp.count, dragonCount: dragon.length, global: global.length, sectors: sectors.length, fundFlow: fundFlow.length, tech: tech.scores, temperature: temperature.score, news: news.length, watchlist: watchlist.length };
}

// ── I 块 · 自选股（默认列表，可在此调整） ────────
const WATCHLIST = '600519,300750,601318,600036,000858,002594,601899,600900'; // 茅台/宁德/平安/招行/五粮液/比亚迪/紫金/长电

// ── 个股（自选股） ─────────────────────────────
function toTxSymbol(code) {
  const c = String(code || '').trim().toLowerCase().replace(/\..+$/, '');
  if (!/^\d{6}$/.test(c)) return '';
  if (/^(6|68|9)/.test(c)) return 'sh' + c;
  return 'sz' + c;
}
async function fetchStockQuotes(codes) {
  const syms = String(codes).split(',').map(s => toTxSymbol(s)).filter(Boolean);
  if (!syms.length) return [];
  const quotes = await fetchTencentQuotes(syms);
  return syms.map(s => {
    const q = quotes[s];
    return q && q.latest > 0 ? { symbol: s, name: q.name.replace(/\s+/g, ''), code: s.slice(2), latest: q.latest, prevClose: q.prevClose, open: q.open, change: Math.round((q.latest - q.prevClose) * 100) / 100, changePct: Math.round((q.latest - q.prevClose) / q.prevClose * 10000) / 100 } : null;
  }).filter(Boolean);
}

module.exports = { runDailyReview, fetchMarketIndices, fetchLimitUpPool, fetchDragonTiger, fetchGlobalIndices, fetchSectors, fetchSectorFundFlow, fetchNews, fetchTechnicalSentiment, fetchTencentQuotes, fetchDailyKline, fetchStockQuotes, toTxSymbol, computeTemperature, WATCHLIST };
