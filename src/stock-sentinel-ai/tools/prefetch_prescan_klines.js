// 收盘后补齐「预筛候选」日 K：把当日 market-prescan.json 的 scopeCodes 交给运行中的
// 智诊盯盘服务（默认 127.0.0.1:3110）的 /api/pool/kline 后台任务，再轮询进度。
//
// 背景：R21 预筛只做快照粗筛，本地真正确认形态需要可信前复权日 K。若本地库没有这些
// 预筛候选的日 K，形态确认会大面积落到 pending_kline，等于选股公式不生效。
//
// 用法：
//   node tools/prefetch_prescan_klines.js --data-dir "%APPDATA%\stock-sentinel-ai"
//   node tools/prefetch_prescan_klines.js --watch          # 只观察正在跑的任务
//   node tools/prefetch_prescan_klines.js --limit 20       # 先用 20 只试跑
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = { base: 'http://127.0.0.1:3110', dataDir: '', lmt: 250, watch: false, limit: 0, intervalMs: 20000, timeoutMin: 240 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--base') out.base = String(argv[++i] || out.base);
    else if (a === '--data-dir') out.dataDir = String(argv[++i] || '');
    else if (a === '--lmt') out.lmt = Number(argv[++i]) || out.lmt;
    else if (a === '--limit') out.limit = Number(argv[++i]) || 0;
    else if (a === '--interval') out.intervalMs = Math.max(2000, Number(argv[++i]) || out.intervalMs);
    else if (a === '--timeout-min') out.timeoutMin = Number(argv[++i]) || out.timeoutMin;
    else if (a === '--watch') out.watch = true;
  }
  return out;
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, json };
}

async function getJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text.slice(0, 300) }; }
}

function stamp() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const dataDir = opts.dataDir ? path.resolve(opts.dataDir) : (process.env.VOLUME_INSIGHT_DATA_DIR
    ? path.resolve(process.env.VOLUME_INSIGHT_DATA_DIR)
    : path.join(__dirname, '..', 'data'));
  console.log(`[${stamp()}] 服务 ${opts.base} · 数据目录 ${dataDir}`);

  if (!opts.watch) {
    const prescanPath = path.join(dataDir, 'market-prescan.json');
    if (!fs.existsSync(prescanPath)) {
      console.error(`未找到预筛文件：${prescanPath}`);
      process.exit(2);
    }
    const prescan = JSON.parse(fs.readFileSync(prescanPath, 'utf8'));
    let codes = (Array.isArray(prescan.scopeCodes) ? prescan.scopeCodes : []).map((c) => String(c).trim()).filter(Boolean);
    codes = [...new Set(codes)];
    if (opts.limit > 0) codes = codes.slice(0, opts.limit);
    console.log(`[${stamp()}] 预筛日 ${prescan.snapshotDate || prescan.date || '未知'} · 候选 ${codes.length} 只 · lmt=${opts.lmt}`);
    if (!codes.length) {
      console.error('预筛候选为空，无需补齐。');
      process.exit(3);
    }
    const started = await postJson(`${opts.base}/api/pool/kline`, { codes, lmt: opts.lmt });
    if (started.status === 409) {
      console.log(`[${stamp()}] 已有补齐任务在跑，改为观察进度。`);
    } else if (started.status !== 200) {
      console.error(`启动失败 HTTP ${started.status}：${JSON.stringify(started.json).slice(0, 300)}`);
      process.exit(4);
    } else {
      console.log(`[${stamp()}] 已启动补齐任务：${JSON.stringify({ total: started.json.total, lmt: started.json.lmt })}`);
    }
  }

  const deadline = Date.now() + opts.timeoutMin * 60 * 1000;
  let lastLine = '';
  for (;;) {
    const st = await getJson(`${opts.base}/api/pool/kline-status`);
    const line = `[${stamp()}] 进度 ${st.done}/${st.total} · 完成 ${st.ok} · 上市不足 ${st.listingComplete} · 策略可用 ${st.strategyReady} · 不足 ${st.incomplete} · 失败 ${st.failed} · 跳过 ${st.skipped} · 当前 ${st.current || '-'}`;
    if (line !== lastLine) {
      console.log(line);
      lastLine = line;
    }
    if (!st.running && st.total > 0 && st.done >= st.total) {
      console.log(`[${stamp()}] 补齐结束。`);
      if (Array.isArray(st.errorsList) && st.errorsList.length) {
        console.log(`前若干失败样例：${JSON.stringify(st.errorsList.slice(0, 10))}`);
      }
      const notComplete = Number(st.incomplete || 0) + Number(st.failed || 0);
      console.log(JSON.stringify({ total: st.total, ok: st.ok, listingComplete: st.listingComplete, strategyReady: st.strategyReady, incomplete: st.incomplete, failed: st.failed, skipped: st.skipped, notComplete }, null, 1));
      process.exit(0);
    }
    if (!st.running && (st.total === 0 || st.done < st.total)) {
      console.error(`[${stamp()}] 任务已停止但未完成：done=${st.done}/${st.total}（可能被中断，重新执行本命令会续跑缺口）`);
      process.exit(5);
    }
    if (Date.now() > deadline) {
      console.error(`[${stamp()}] 等待超时（${opts.timeoutMin} 分钟），任务仍在后台运行，可加 --watch 继续观察。`);
      process.exit(6);
    }
    await sleep(opts.intervalMs);
  }
}

main().catch((e) => {
  console.error(`运行失败：${String((e && e.message) || e)}`);
  process.exit(1);
});
