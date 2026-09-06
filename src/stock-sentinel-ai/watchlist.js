// 量能洞察 · 自选股持久化（data/watchlist.json，本地 JSON）。
// 只存 code/name/market/addedAt；实时行情由 data.fetchQuotes 拉取，不落盘。
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./storage');

const WATCHLIST_FILE = path.join(DATA_DIR, 'watchlist.json');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function load() {
  try {
    ensureDir(DATA_DIR);
    if (!fs.existsSync(WATCHLIST_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(list) {
  try {
    ensureDir(DATA_DIR);
    fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(list, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

function getList() {
  return load();
}

function has(codeInput) {
  const code = String(codeInput || '').trim();
  return load().some((x) => x.code === code);
}

function add(codeInput, info = {}) {
  const code = String(codeInput || '').trim();
  if (!/^\d{6}$/.test(code)) return { ok: false, error: 'code 必须为 6 位数字' };
  const list = load();
  if (list.some((x) => x.code === code)) return { ok: false, error: '已在自选中' };
  list.push({
    code,
    name: String(info.name || '').slice(0, 24),
    market: String(info.market || '').slice(0, 24),
    addedAt: new Date().toISOString(),
  });
  save(list);
  return { ok: true, code };
}

function remove(codeInput) {
  const code = String(codeInput || '').trim();
  const list = load();
  const next = list.filter((x) => x.code !== code);
  if (next.length === list.length) return { ok: false, error: '不在自选中' };
  save(next);
  return { ok: true };
}

module.exports = { WATCHLIST_FILE, getList, has, add, remove };
