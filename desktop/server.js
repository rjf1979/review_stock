// 行情日报 Desktop · 本地后端（取数 + 静态前端）
// 数据在用户本地直连腾讯/东财公开接口，不经过任何服务器中转
const http = require('http');
const fs = require('fs');
const path = require('path');
const review = require('./review-core');

const PORT = 3100;
const FRONTEND = path.join(__dirname, 'frontend');

function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}
function todayCompact() { return todayISO().replace(/-/g, ''); }
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}
function fail(res, error) { json(res, 500, { error: String(error?.message || '服务错误') }); }

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00+08:00`));
}

async function buildReviewData(date, codes = review.WATCHLIST) {
  const dateCompact = date.replace(/-/g, '');
  const [indices, limitUp, dragon, global, sectors, fundFlow, tech, news, watchlist] = await Promise.all([
    review.fetchMarketIndices(),
    review.fetchLimitUpPool(dateCompact),
    review.fetchDragonTiger(date),
    review.fetchGlobalIndices(),
    review.fetchSectors(),
    review.fetchSectorFundFlow(),
    review.fetchTechnicalSentiment(date),
    review.fetchNews(date),
    review.fetchStockQuotes(codes),
  ]);
  const temperature = review.computeTemperature(indices, limitUp.count, tech);
  return {
    date,
    indices,
    limitUpCount: limitUp.count,
    limitUpStocks: limitUp.stocks.slice(0, 15),
    dragon,
    global,
    sectors,
    fundFlow,
    news,
    watchlist,
    techScore: tech.scores,
    techDetail: tech.detail,
    temperature,
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname === '/api/realtime') {
      const [indices, limitUp, sectors] = await Promise.all([review.fetchMarketIndices(), review.fetchLimitUpPool(todayCompact()), review.fetchSectors()]);
      return json(res, 200, { indices, limitUpCount: limitUp.count, limitUpStocks: limitUp.stocks.slice(0, 10), sectors, updatedAt: todayISO() });
    }
    if (url.pathname === '/api/review') {
      const date = url.searchParams.get('date') || todayISO();
      if (!validDate(date)) return json(res, 400, { error: '日期格式不正确，应为 YYYY-MM-DD' });
      const codes = url.searchParams.get('codes') || review.WATCHLIST;
      return json(res, 200, await buildReviewData(date, codes));
    }
    if (url.pathname === '/api/dragon') {
      const date = url.searchParams.get('date') || todayISO();
      if (!validDate(date)) return json(res, 400, { error: '日期格式不正确，应为 YYYY-MM-DD' });
      return json(res, 200, { date, list: await review.fetchDragonTiger(date) });
    }
    if (url.pathname === '/api/global') {
      return json(res, 200, { global: await review.fetchGlobalIndices() });
    }
    if (url.pathname === '/api/stocks') {
      const codes = url.searchParams.get('codes') || '';
      return json(res, 200, { stocks: await review.fetchStockQuotes(codes) });
    }
    if (url.pathname === '/api/kline') {
      const code = url.searchParams.get('code') || '';
      const date = url.searchParams.get('date') || todayISO();
      const symbol = review.toTxSymbol ? review.toTxSymbol(code) : '';
      if (!symbol) return json(res, 400, { error: '代码格式不正确' });
      return json(res, 200, { code, kline: await review.fetchDailyKline(symbol, date) });
    }
    // 静态：前端
    const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.join(FRONTEND, requested);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
      return res.end(fs.readFileSync(file));
    }
    return json(res, 404, { error: 'Not found' });
  } catch (error) { return fail(res, error); }
});

server.listen(PORT, () => console.log(`行情日报 Desktop 本地服务运行于 http://localhost:${PORT}`));
