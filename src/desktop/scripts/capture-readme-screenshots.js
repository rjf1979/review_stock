const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const { startServer } = require('../server');

const PORT = 3198;
const outputDir = path.resolve(__dirname, '..', '..', '..', 'docs', 'screenshots', 'desktop');
const pages = [
  ['实时行情', 'realtime.png'],
  ['自选股', 'watchlist.png'],
  ['每日复盘', 'daily-review.png'],
  ['龙虎榜', 'dragon-tiger.png'],
  ['历史报告', 'history.png'],
];

async function waitForSettled(window, timeout = 120000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const loading = await window.webContents.executeJavaScript("Boolean(document.querySelector('.loading-overlay'))");
    if (!loading) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

async function waitForPage(window, label, timeout = 120000) {
  const startedAt = Date.now();
  let readySince = 0;
  while (Date.now() - startedAt < timeout) {
    const ready = await window.webContents.executeJavaScript(`(() => {
      const active = document.querySelector('nav button.active')?.textContent.trim();
      const refreshing = [...document.querySelectorAll('nav button')].some(button => button.textContent.includes('刷新中'));
      return active === ${JSON.stringify(label)} && !refreshing && !document.querySelector('.loading-overlay');
    })()`);
    if (ready) {
      if (!readySince) readySince = Date.now();
      if (Date.now() - readySince >= 2000) return;
    } else {
      readySince = 0;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`页面等待超时：${label}`);
}

app.whenReady().then(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const server = await startServer({ port: PORT });
  await fetch(`http://127.0.0.1:${PORT}/api/watchlist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ watchlist: ['600519', '000001', '300750', '601318', '600036', '000858'] }),
  });
  const window = new BrowserWindow({ width: 1440, height: 900, show: true, webPreferences: { backgroundThrottling: false } });
  await window.loadURL(`http://127.0.0.1:${PORT}`);
  await waitForSettled(window);
  await new Promise(resolve => setTimeout(resolve, 1500));
  await window.webContents.executeJavaScript("document.getElementById('boot-screen')?.remove()");

  for (const [label, filename] of pages) {
    await window.webContents.executeJavaScript("if(document.body.classList.contains('dark'))document.querySelector('.theme-toggle')?.click()");
    await new Promise(resolve => setTimeout(resolve, 250));
    await window.webContents.executeJavaScript(`(() => { const button = [...document.querySelectorAll('nav button')].find(item => item.textContent.trim() === ${JSON.stringify(label)}); if (!button) throw new Error('未找到页面：${label}'); button.click(); document.querySelector('main').scrollTop = 0; })()`);
    await new Promise(resolve => setTimeout(resolve, 500));
    await waitForPage(window, label);
    const image = await window.webContents.capturePage();
    fs.writeFileSync(path.join(outputDir, filename), image.toPNG());
    console.log(`已生成 ${label}: ${filename}`);
  }

  window.destroy();
  await new Promise(resolve => server.close(resolve));
  app.quit();
}).catch(error => {
  console.error(error);
  app.exit(1);
});
