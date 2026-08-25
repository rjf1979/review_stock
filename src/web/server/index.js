const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const APP_SHELL = '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="行情日报 Windows 桌面版：实时行情、盘面异动和收盘复盘。"><title>行情日报 Desktop</title><link rel="stylesheet" href="/assets/app.css"></head><body><div id="app"></div><script type="module" src="/assets/app.mjs"></script></body></html>';
const MIME_TYPES = {
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function send(res, status, body, type = 'text/html') {
  res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
  res.end(body);
}

function assetPath(urlPath) {
  const relative = decodeURIComponent(urlPath).replace(/^\/assets\//, '');
  const file = path.resolve(PUBLIC_DIR, 'assets', relative);
  const root = path.resolve(PUBLIC_DIR, 'assets');
  return file === root || file.startsWith(root + path.sep) ? file : null;
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed', 'text/plain');
  const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  if (pathname.startsWith('/assets/')) {
    const file = assetPath(pathname);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'Not Found', 'text/plain');
    const type = MIME_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'public, max-age=600' });
    return req.method === 'HEAD' ? res.end() : res.end(fs.readFileSync(file));
  }
  if (pathname === '/' || pathname === '/index.html') return send(res, 200, APP_SHELL);
  return send(res, 404, 'Not Found', 'text/plain');
});

server.listen(PORT, () => console.log(`行情日报官网运行于 http://localhost:${PORT}`));
