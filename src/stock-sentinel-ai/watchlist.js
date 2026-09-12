// 量能洞察 · 自选股持久化（data/watchlist.json，本地 JSON）。
// 只存 code/name/market/addedAt/source 和加入日收盘收益基准；实时行情由 data.fetchQuotes 拉取，不落盘。
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

function get(codeInput) {
  const code = String(codeInput || '').trim();
  return load().find((x) => x.code === code) || null;
}

function normalizeThemeEvidence(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).map((item) => {
    const name = String(item && item.name || '').trim().slice(0, 40);
    const kind = item && item.kind === 'industry' ? 'industry' : 'concept';
    const code = String(item && item.code || '').trim().slice(0, 24);
    const normalized = { name, kind, code };
    for (const key of ['rank', 'asOf', 'changePct', 'mainNet', 'limitUpCount', 'advanceRatio', 'coverage']) {
      if (item && item[key] !== undefined && item[key] !== null) normalized[key] = item[key];
    }
    return normalized;
  }).filter((item) => item.name && !seen.has(`${item.kind}:${item.code || item.name}`) && (seen.add(`${item.kind}:${item.code || item.name}`) || true)).slice(0, 12);
}

function normalizeSelectionEvidence(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    mode: source.mode === 'observation' ? 'observation' : 'selected',
    transferredAt: String(source.transferredAt || new Date().toISOString()),
    selectionBatchId: String(source.selectionBatchId || ''),
    selectionPolicyVersion: String(source.selectionPolicyVersion || ''),
    selectionParameterStatus: String(source.selectionParameterStatus || ''),
    selectionPolicyParams: source.selectionPolicyParams && typeof source.selectionPolicyParams === 'object' ? source.selectionPolicyParams : null,
    selectionRuleEvidence: Array.isArray(source.selectionRuleEvidence) ? source.selectionRuleEvidence : [],
    selectionRulesFingerprint: String(source.selectionRulesFingerprint || ''),
    selectionContractVersion: Number(source.selectionContractVersion) || 0,
    snapshotDate: String(source.snapshotDate || ''),
    ruleIds: Array.isArray(source.ruleIds) ? source.ruleIds.map(String) : [],
    themeEvidence: normalizeThemeEvidence(source.themeEvidence),
    boardLeaderRanks: Array.isArray(source.boardLeaderRanks) ? source.boardLeaderRanks : [],
    candidateThemeRanks: Array.isArray(source.candidateThemeRanks) ? source.candidateThemeRanks : [],
    initialAssessment: source.initialAssessment || null,
    riskFlags: Array.isArray(source.riskFlags) ? source.riskFlags : [],
    recommendation: source.recommendation && typeof source.recommendation === 'object' ? source.recommendation : null,
  };
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
    source: String(info.source || 'pool').slice(0, 16),
    themeEvidence: normalizeThemeEvidence(info.themeEvidence),
    // 手工添加的股票保持历史行为默认置顶；其余股票可在盯盘页单独切换。
    pinned: info.pinned === true || String(info.source || '') === 'manual',
    addedAt: new Date().toISOString(),
    // 只记录加入日最终日 K 收盘价，不用实时价或盘中暂定 K 线作为收益基准。
    returnBaseline: {
      targetDate: String(info.baselineTargetDate || ''),
      close: null,
      status: 'pending_close',
      confirmedAt: null,
      source: 'local_daily_kline_close',
    },
  });
  if (!save(list)) return { ok: false, error: '自选列表保存失败，请检查数据目录权限或文件是否被占用' };
  return { ok: true, code };
}

function upsertFromPool(candidate = {}, selectionEvidence = {}, info = {}) {
  const code = String(candidate.code || '').trim();
  if (!/^\d{6}$/.test(code)) return { ok: false, error: 'code 必须为 6 位数字' };
  const list = load();
  const evidence = normalizeSelectionEvidence({
    ...selectionEvidence,
    selectionBatchId: candidate.selectionBatchId,
    selectionPolicyVersion: candidate.selectionPolicyVersion,
    selectionParameterStatus: candidate.selectionParameterStatus,
    selectionPolicyParams: candidate.selectionPolicyParams,
    selectionRuleEvidence: candidate.selectionRuleEvidence,
    selectionRulesFingerprint: candidate.selectionRulesFingerprint,
    selectionContractVersion: candidate.selectionContractVersion,
    snapshotDate: candidate.snapshotDate,
    ruleIds: candidate.ruleIds,
    themeEvidence: candidate.themeEvidence,
    boardLeaderRanks: candidate.boardLeaderRanks,
    candidateThemeRanks: candidate.candidateThemeRanks,
    initialAssessment: candidate.initialAssessment,
    riskFlags: candidate.riskFlags,
  });
  const existing = list.find((item) => item.code === code);
  if (existing) {
    existing.selectionEvidence = evidence;
    if (evidence.themeEvidence.length) existing.themeEvidence = evidence.themeEvidence;
    if (!save(list)) return { ok: false, error: '自选列表保存失败，候选记录已保留' };
    return { ok: true, code, unchanged: true, item: existing };
  }
  const source = evidence.mode === 'observation' ? 'pool_observation' : 'pool_selected';
  const record = {
    code,
    name: String(candidate.name || '').slice(0, 24),
    market: String(candidate.market || '').slice(0, 24),
    source,
    themeEvidence: evidence.themeEvidence,
    selectionEvidence: evidence,
    pinned: false,
    addedAt: new Date().toISOString(),
    returnBaseline: {
      targetDate: String(info.baselineTargetDate || ''), close: null, status: 'pending_close', confirmedAt: null,
      source: 'local_daily_kline_close',
    },
  };
  list.push(record);
  if (!save(list)) return { ok: false, error: '自选列表保存失败，候选记录已保留' };
  return { ok: true, code, unchanged: false, item: record };
}

function setPinned(codeInput, pinned) {
  const code = String(codeInput || '').trim();
  if (!/^\d{6}$/.test(code)) return { ok: false, error: 'code 必须为 6 位数字' };
  const list = load();
  const item = list.find((x) => x.code === code);
  if (!item) return { ok: false, error: '不在自选中' };
  item.pinned = pinned === true;
  save(list);
  return { ok: true, item };
}

function setThemeEvidence(codeInput, evidence) {
  const code = String(codeInput || '').trim();
  if (!/^\d{6}$/.test(code)) return { ok: false, error: 'code 必须为 6 位数字' };
  const list = load();
  const item = list.find((x) => x.code === code);
  if (!item) return { ok: false, error: '不在自选中' };
  item.themeEvidence = normalizeThemeEvidence(evidence);
  save(list);
  return { ok: true, item };
}

function confirmReturnBaseline(codeInput, { targetDate, close, confirmedAt = new Date().toISOString() } = {}) {
  const code = String(codeInput || '').trim();
  const price = Number(close);
  if (!/^\d{6}$/.test(code) || !/^\d{4}-\d{2}-\d{2}$/.test(String(targetDate || '')) || !Number.isFinite(price) || price <= 0) return { ok: false, error: '收益基准参数无效' };
  const list = load();
  const item = list.find((x) => x.code === code);
  if (!item) return { ok: false, error: '不在自选中' };
  const baseline = item.returnBaseline;
  if (!baseline) return { ok: false, error: '历史自选未记录收益基准' };
  if (baseline.status === 'confirmed') return { ok: true, unchanged: true, item };
  if (String(baseline.targetDate || '') !== String(targetDate)) return { ok: false, error: '收益基准日期不匹配' };
  item.returnBaseline = { ...baseline, close: price, status: 'confirmed', confirmedAt: String(confirmedAt), source: 'local_daily_kline_close' };
  save(list);
  return { ok: true, unchanged: false, item };
}

function validMonitorDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function normalizeCustomPrice(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!/^\d+(?:\.\d{1,4})?$/.test(raw)) return null;
  const price = Number(raw);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function setCustomReturnBaseline(codeInput, priceInput, { monitorStartDate, now = new Date().toISOString() } = {}) {
  const code = String(codeInput || '').trim();
  const price = normalizeCustomPrice(priceInput);
  if (!/^\d{6}$/.test(code) || price == null || !validMonitorDate(monitorStartDate)) return { ok: false, error: '模拟买入价或开始监控日期无效' };
  const list = load();
  const item = list.find((x) => x.code === code);
  if (!item) return { ok: false, error: '不在自选中' };
  item.customReturnBaseline = {
    price,
    status: 'pending_touch',
    monitorStartDate: String(monitorStartDate),
    createdAt: String(now),
    updatedAt: String(now),
    filledDate: null,
    filledAt: null,
    source: 'manual_simulated_price',
  };
  save(list);
  return { ok: true, item };
}

function findFirstSimulatedFill(bars, priceInput, monitorStartDate) {
  const price = normalizeCustomPrice(priceInput);
  if (price == null || !validMonitorDate(monitorStartDate)) return null;
  return (Array.isArray(bars) ? bars : []).slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))).find((bar) => {
    const date = String(bar && bar.date || '');
    const low = Number(bar && bar.low), high = Number(bar && bar.high);
    return date >= monitorStartDate && validMonitorDate(date) && Number.isFinite(low) && Number.isFinite(high) && low <= price && price <= high;
  }) || null;
}

function markCustomReturnBaselineFilled(codeInput, { expectedUpdatedAt, filledDate, filledAt = new Date().toISOString() } = {}) {
  const code = String(codeInput || '').trim();
  if (!/^\d{6}$/.test(code) || !validMonitorDate(filledDate)) return { ok: false, error: '模拟买入成交信息无效' };
  const list = load();
  const item = list.find((x) => x.code === code);
  const baseline = item && item.customReturnBaseline;
  if (!item) return { ok: false, error: '不在自选中' };
  if (!baseline || baseline.status === 'filled') return { ok: true, unchanged: true, item };
  if (baseline.status !== 'pending_touch' || String(baseline.updatedAt || '') !== String(expectedUpdatedAt || '') || String(filledDate) < String(baseline.monitorStartDate || '')) return { ok: false, error: '模拟买入状态已变化' };
  item.customReturnBaseline = { ...baseline, status: 'filled', filledDate: String(filledDate), filledAt: String(filledAt) };
  save(list);
  return { ok: true, unchanged: false, item };
}

function clearCustomReturnBaseline(codeInput) {
  const code = String(codeInput || '').trim();
  if (!/^\d{6}$/.test(code)) return { ok: false, error: 'code 必须为 6 位数字' };
  const list = load();
  const item = list.find((x) => x.code === code);
  if (!item) return { ok: false, error: '不在自选中' };
  if (!item.customReturnBaseline) return { ok: true, unchanged: true, item };
  delete item.customReturnBaseline;
  save(list);
  return { ok: true, unchanged: false, item };
}

function remove(codeInput) {
  const code = String(codeInput || '').trim();
  const list = load();
  const next = list.filter((x) => x.code !== code);
  if (next.length === list.length) return { ok: false, error: '不在自选中' };
  save(next);
  return { ok: true };
}

module.exports = { WATCHLIST_FILE, getList, get, has, add, upsertFromPool, normalizeThemeEvidence, normalizeSelectionEvidence, setPinned, setThemeEvidence, confirmReturnBaseline, setCustomReturnBaseline, findFirstSimulatedFill, markCustomReturnBaselineFilled, clearCustomReturnBaseline, remove };
