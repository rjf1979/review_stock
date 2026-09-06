// 智诊盯盘 · 候选池持久化（data/candidate-pool.json，本地 JSON）。
// 保存扫描命中时的快照字段（价格/涨跌幅/量能分/规则命中线索），便于候选池页直接展示；
// 后续可从候选池一键转入自选盯盘（只取 code/name/market）。
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./storage');

const POOL_FILE = path.join(DATA_DIR, 'candidate-pool.json');

// 只保存扫描结果里的快照字段，避免写入任意大对象。
// 扫描阶段只产生“规则命中（预筛）”，K 线复筛/形态命中结果在补齐后另行回写，
// 因此这里保存 ruleLabel/ruleIds 作为候选线索，pattern 仅为兼容旧数据保留。
const SNAPSHOT_KEYS = ['name', 'market', 'price', 'changePct', 'turnover', 'volumeRatio', 'amountYi', 'mainNetYi', 'score', 'pattern', 'patternScore', 'ruleLabel', 'ruleIds', 'snapshotDate', 'marketRegime', 'themeEvidence', 'scanScope', 'strategyRuleIds', 'deprioritizedRuleIds', 'riskFlags', 'selectionTrace', 'admissionMode'];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function load() {
  try {
    ensureDir(DATA_DIR);
    if (!fs.existsSync(POOL_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(POOL_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(list) {
  try {
    ensureDir(DATA_DIR);
    fs.writeFileSync(POOL_FILE, JSON.stringify(list, null, 2), 'utf8');
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

function pickSnap(item) {
  const out = {};
  for (const k of SNAPSHOT_KEYS) {
    if (item[k] !== undefined && item[k] !== null) out[k] = item[k];
  }
  return out;
}

/**
 * 批量入库（UPSERT）：已存在则刷新快照字段（保持 addedAt 不变），否则新增。
 * @param {{code:string}[]} items
 * @returns {{ok:boolean, added:number, updated:number, total:number, errors:string[]}}
 */
function addMany(itemsInput) {
  const items = Array.isArray(itemsInput) ? itemsInput : [];
  const list = load();
  let added = 0;
  let updated = 0;
  const errors = [];
  for (const raw of items) {
    const item = raw || {};
    const code = String(item.code || '').trim();
    if (!/^\d{6}$/.test(code)) { errors.push(`code 必须为 6 位数字：${code || '(空)'}`); continue; }
    const snap = pickSnap(item);
    const existing = list.find((x) => x.code === code);
    if (existing) {
      Object.assign(existing, snap);
      updated++;
    } else {
      list.push({
        code,
        ...snap,
        addedAt: new Date().toISOString(),
      });
      added++;
    }
  }
  save(list);
  return { ok: true, added, updated, total: list.length, errors };
}

function add(item) {
  return addMany(Array.isArray(item) ? item : [item]);
}

function remove(codeInput) {
  const code = String(codeInput || '').trim();
  const list = load();
  const next = list.filter((x) => x.code !== code);
  if (next.length === list.length) return { ok: false, error: '不在候选池中' };
  save(next);
  return { ok: true };
}

function clear() {
  save([]);
  return { ok: true, total: 0 };
}

module.exports = { POOL_FILE, getList, has, add, addMany, remove, clear };
