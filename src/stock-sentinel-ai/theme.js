// 智诊盯盘 · 题材/行业归属（东财 slist，个股所属板块，零鉴权）
// 按个股抓取所属板块（行业/概念/地域混合），返回板块名、BK 码、当日涨跌幅与龙头股。
// 数据源与 scoring-copy-v1.md 的题材归因共用；只在候选池补齐/研判时按个股抓取，不全市逐只抓。
// 结果按日期缓存在 data/theme-attribution.json，同日不重复请求。
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./storage');
const { emGet, eastmoneySecid, todayStr } = require('./data');

const THEME_FILE = path.join(DATA_DIR, 'theme-attribution.json');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadCache() {
  try {
    ensureDir(DATA_DIR);
    if (!fs.existsSync(THEME_FILE)) return {};
    const parsed = JSON.parse(fs.readFileSync(THEME_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveCache(map) {
  try {
    ensureDir(DATA_DIR);
    fs.writeFileSync(THEME_FILE, JSON.stringify(map, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

function normalizeDiff(diff) {
  const items = Array.isArray(diff) ? diff : (diff && typeof diff === 'object' ? Object.values(diff) : []);
  const boards = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const name = String(it.f14 || '').trim();
    if (!name) continue;
    boards.push({
      name,
      code: String(it.f12 || ''),
      changePct: Number(it.f3) || 0,
      leadStock: String(it.f128 || ''),
    });
  }
  return boards;
}

// 直接抓取（不读缓存、不写缓存）；失败返回空结构，不抛错（题材缺失允许研判降级）。
async function fetchConceptBlocks(codeInput) {
  const code = String(codeInput || '').trim();
  if (!/^\d{6}$/.test(code)) return { code, total: 0, boards: [], conceptTags: [] };
  const url = 'https://push2.eastmoney.com/api/qt/slist/get' +
    '?fltt=2&invt=2&secid=' + encodeURIComponent(eastmoneySecid(code)) +
    '&spt=3&pi=0&pz=200&po=1&fields=f12,f14,f3,f128';
  try {
    const d = await emGet(url, 15000);
    const diff = (d && d.data && d.data.diff) || {};
    const boards = normalizeDiff(diff);
    return {
      code,
      total: boards.length,
      boards,
      conceptTags: boards.map((b) => b.name),
    };
  } catch {
    return { code, total: 0, boards: [], conceptTags: [] };
  }
}

// 缓存优先：当日已抓过则复用，否则联网抓取并写缓存。
async function getAttribution(codeInput, { refresh = false } = {}) {
  const code = String(codeInput || '').trim();
  const today = todayStr();
  const cache = loadCache();
  const hit = cache[code];
  if (!refresh && hit && hit.fetchedAt === today) {
    return {
      code,
      fetchedAt: hit.fetchedAt,
      total: Array.isArray(hit.boards) ? hit.boards.length : 0,
      boards: Array.isArray(hit.boards) ? hit.boards : [],
      conceptTags: Array.isArray(hit.conceptTags) ? hit.conceptTags : [],
      cached: true,
    };
  }
  const fresh = await fetchConceptBlocks(code);
  cache[code] = {
    fetchedAt: today,
    boards: fresh.boards,
    conceptTags: fresh.conceptTags,
  };
  saveCache(cache);
  return { ...fresh, fetchedAt: today, cached: false };
}

module.exports = { fetchConceptBlocks, getAttribution, THEME_FILE };
