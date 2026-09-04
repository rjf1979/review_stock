const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const APP_SHELL = '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="股市脉搏 Windows 桌面版：A股实时行情、盘面异动与每日复盘。"><title>股市脉搏 · A股行情与复盘</title><link rel="stylesheet" href="/assets/app.css?v=4"></head><body><div id="app"></div><script type="module" src="/assets/app.js?v=4"></script></body></html>';
const HTML_CACHE = 'public, max-age=30, s-maxage=300, stale-while-revalidate=86400';
const ASSET_CACHE = 'public, max-age=300';
const IMMUTABLE_ASSET_CACHE = 'public, max-age=31536000, immutable';
const MIME_TYPES = {
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.exe': 'application/octet-stream'
};

function send(res, status, body, type = 'text/html', cacheControl = 'no-store') {
  const headers = { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': cacheControl, 'X-Content-Type-Options': 'nosniff' };
  if (cacheControl !== 'no-store') headers['CDN-Cache-Control'] = cacheControl;
  res.writeHead(status, headers);
  res.end(body);
}

function assetPath(urlPath) {
  const relative = decodeURIComponent(urlPath).replace(/^\/assets\//, '');
  const file = path.resolve(PUBLIC_DIR, 'assets', relative);
  const root = path.resolve(PUBLIC_DIR, 'assets');
  return file === root || file.startsWith(root + path.sep) ? file : null;
}

function publicFile(urlPath) {
  const file = path.resolve(PUBLIC_DIR, '.' + decodeURIComponent(urlPath));
  return file !== PUBLIC_DIR && file.startsWith(PUBLIC_DIR + path.sep) ? file : null;
}

function sendFile(req, res, file, cacheControl) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'Not Found', 'text/plain');
  const stat = fs.statSync(file);
  const type = MIME_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Cache-Control': cacheControl, 'X-Content-Type-Options': 'nosniff' });
  return req.method === 'HEAD' ? res.end() : fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed', 'text/plain');
  const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  if (pathname.startsWith('/assets/')) {
    const file = assetPath(pathname);
    const cacheControl = /-[A-Za-z0-9_-]{8}\.\w+$/.test(pathname) ? IMMUTABLE_ASSET_CACHE : ASSET_CACHE;
    return sendFile(req, res, file, cacheControl);
  }
  if (pathname === '/updates/latest.json') return sendFile(req, res, publicFile(pathname), 'no-store');
  if (pathname.startsWith('/updates/files/')) return sendFile(req, res, publicFile(pathname), 'public, max-age=31536000, immutable');
  if (pathname === '/' || pathname === '/index.html') return send(res, 200, APP_SHELL, 'text/html', HTML_CACHE);
  return send(res, 404, 'Not Found', 'text/plain');
});

server.listen(PORT, '127.0.0.1', () => console.log(`股市脉搏官网运行于 http://127.0.0.1:${PORT}`));
