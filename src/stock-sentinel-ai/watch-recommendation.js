// 候选池到盯盘的规则推荐。结论仅辅助人工复核，绝不自动交易或迁移名单。
const crypto = require('crypto');
const { readKline, saveWatchRecommendationBatch, saveWatchRecommendation, latestWatchRecommendations } = require('./storage');
const { detectSinglePatterns } = require('./screener-core');
const priceLevels = require('./price-levels');
const rulesStore = require('./rules-store');
const { evaluateTailStatus, effectiveTailStatus, TAIL_STATUS } = require('./kline-tail-status');
const { reviewCandidate, finalizeSelections, REVIEW_VERSION } = require('./candidate-review');
const { rulesFingerprint, klineFingerprint } = require('./recommendation-validity');
const klineArchive = require('./kline-archive');
const RULE_VERSION = REVIEW_VERSION;
const ARCHIVE_MAX_RECORDS = 300;
let active = null;
let pendingItems = new Map();
let lastStatus = { running: false };
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);

async function evaluate(item, adapters = {}) {
  const loadKline = adapters.readKline || readKline;
  const detectPatterns = adapters.detectSinglePatterns || detectSinglePatterns;
  const computeLevels = adapters.computeLevels || priceLevels.computeLevels;
  const loadRules = adapters.loadRules || rulesStore.load;
  const now = adapters.now ? adapters.now() : new Date();
  const code = String(item.code || ''); const rec = await loadKline(code); const bars = (rec && rec.kline) || [];
  const latest = bars[bars.length - 1] || {};
  const rules = JSON.parse(JSON.stringify(loadRules()));
  const patterns = bars.length >= 2 ? detectPatterns(bars, { code, rules }).hits : [];
  const levels = computeLevels(bars, { code });
  const snapshotDate = String(item.snapshotDate || '');
  const storedTailStatus = (rec && rec.tailStatus) || '';
  // 暂定尾K不能生成“收盘确认通过”：必须同时满足收盘时段 + 尾K已确认。
  // 已落库为暂定的尾K保留暂定语义，直到用收盘数据重新抓取（fetchKlineRaw → writeKline）。
  const currentTailStatus = effectiveTailStatus({ storedTailStatus, barDate: latest.date || '', now });
  const tail = evaluateTailStatus({
    bar: latest, now, targetDate: snapshotDate,
    storedTailStatus: currentTailStatus === TAIL_STATUS.PROVISIONAL ? TAIL_STATUS.PROVISIONAL : '',
  });
  // 非交易日或次日盘前仍可复核最近已完成交易日；最终态以候选日期和已确认尾K对齐为准。
  const isFinal = snapshotDate === String(latest.date || '')
    && currentTailStatus === TAIL_STATUS.CONFIRMED
    && tail.status === TAIL_STATUS.CONFIRMED;
  const review = reviewCandidate({ item, candles: bars, klineMeta: rec || {}, patterns, rules, levels, isFinal });
  const klineMetaIssues = [];
  if (!rec || !rec.source) klineMetaIssues.push('K线来源证据缺失');
  if (!rec || rec.adjustmentType !== 'qfq') klineMetaIssues.push('K线前复权口径未验证');
  if (storedTailStatus !== TAIL_STATUS.CONFIRMED || !rec.tailConfirmedAt) klineMetaIssues.push('尾K尚未获得可核对的收盘确认');
  if (klineMetaIssues.length) {
    review.classification = 'insufficient';
    for (const issue of klineMetaIssues) {
      if (!review.missing.includes(issue)) review.missing.push(issue);
      if (!review.reasons.includes(issue)) review.reasons.push(issue);
    }
  }
  if (!require('./market-prescan-store').isQuoteFresh(item.quoteEvidence?.sourceAt, snapshotDate, now)) {
    review.classification = 'insufficient';
    review.missing.push('候选行情已过期，请重新扫描股票更新行情');
    review.reasons.push('候选行情已过期，请重新扫描股票更新行情');
  }
  const primaryTheme = [...(item.themeEvidence || [])].sort((a, b) => Number(a.rank) - Number(b.rank))[0] || null;
  const conditions = {
    trigger: review.riskReward.entry != null ? `收盘确认站稳入场观察价 ${Number(review.riskReward.entry).toFixed(2)}` : '等待形成可追溯的入场触发价',
    invalidation: review.riskReward.invalidation != null ? `结构失效价 ${Number(review.riskReward.invalidation).toFixed(2)}` : '未形成有效结构失效价',
    target: review.riskReward.target != null ? `第一压力目标 ${Number(review.riskReward.target).toFixed(2)}` : '未形成有效第一目标价',
    basis: '程序硬门槛结论，AI不能覆盖',
  };
  const evidence = {
    snapshotDate: item.snapshotDate || '', quoteSourceAt: item.quoteEvidence?.sourceAt || '', klineDate: latest.date || '', klineHash: klineFingerprint(bars), bars: bars.length,
    klineSource: (rec && rec.source) || '', klineAdjustmentType: (rec && rec.adjustmentType) || '',
    klineSourceLatestDate: (rec && rec.sourceLatestDate) || '', tailStatus: storedTailStatus, tailConfirmedAt: (rec && rec.tailConfirmedAt) || '',
    patterns: patterns.map((x) => ({ ruleId: x.ruleId, patternId: x.patternId, label: x.label, score: x.score })),
    originalRuleIds: review.originalRuleIds, matchedOriginalRuleIds: review.matchedOriginalRuleIds,
    opposingEvidence: review.opposingEvidence, metrics: review.metrics, riskReward: review.riskReward,
    marketRegime: item.marketRegime || null, reviewVersion: review.reviewVersion, parameterStatus: review.parameterStatus, rulesFingerprint: rulesFingerprint(rules),
    selectionBatchId: item.selectionBatchId || '', selectionPolicyVersion: item.selectionPolicyVersion || '',
    selectionParameterStatus: item.selectionParameterStatus || '', selectionPolicyParams: item.selectionPolicyParams || null,
    selectionRulesFingerprint: item.selectionRulesFingerprint || '',
  };
  // 直接冻结本次复核实际读取的序列。不能在批次结束后重新读取本地库，否则并发同步可能
  // 让归档正文与本次决策使用的 klineHash 不再是同一版本。
  const klineArchiveRecord = klineArchive.buildRecord({
    code,
    bars,
    meta: {
      source: (rec && rec.source) || '',
      adjustmentType: (rec && rec.adjustmentType) || '',
      sourceLatestDate: (rec && rec.sourceLatestDate) || '',
      fetchedAt: (rec && rec.fetchedAt) || '',
      savedAt: (rec && rec.savedAt) || '',
      tailStatus: storedTailStatus,
      tailConfirmedAt: (rec && rec.tailConfirmedAt) || '',
    },
    evidenceAt: (rec && (rec.fetchedAt || rec.savedAt)) || '',
  });
  return {
    code,
    classification: review.classification,
    selected: false,
    selectionReason: '',
    primaryThemeCode: primaryTheme && primaryTheme.code || '',
    patternScore: patterns.length ? Number(patterns[0].score) || 0 : 0,
    score: Number(item.score) || 0,
    riskReward: review.riskReward,
    reasonCodes: review.reasons,
    evidence,
    klineArchiveRecord,
    conditions,
    missing: review.missing,
    ruleVersion: RULE_VERSION,
    evidenceHash: hash({ item, evidence }),
    status: 'success',
    createdAt: Date.now(),
  };
}
async function start(items, adapters = {}) {
  const snapshot = JSON.parse(JSON.stringify((Array.isArray(items) ? items : []).filter((x) => /^\d{6}$/.test(String(x && x.code)))));
  if (active) {
    snapshot.forEach((item) => pendingItems.set(String(item.code), item));
    return { started: false, reason: 'queued', queued: pendingItems.size, ...active.status };
  }
  const saveBatch = adapters.saveBatch || saveWatchRecommendationBatch;
  const saveResult = adapters.saveResult || saveWatchRecommendation;
  const runEvaluate = adapters.evaluate || evaluate;
  const frozenRules = JSON.parse(JSON.stringify((adapters.loadRules || rulesStore.load)()));
  const batchId = `rec-${Date.now()}`;
  const status = { batchId, running: true, status: 'running', total: snapshot.length, done: 0, succeeded: 0, failed: 0, startedAt: Date.now(), finishedAt: 0 };
  const job = { status, cancelled: false };
  active = job; lastStatus = status;
  const checkedSave = async (fn, value) => {
    const result = await fn(value);
    if (result === false || result?.ok === false) throw new Error('复核结果持久化失败');
  };
  const finish = async () => {
    status.running = false; status.finishedAt = Date.now();
    try { await checkedSave(saveBatch, { ...status, snapshot }); }
    catch (error) { status.status = 'failed'; status.error = String(error.message || error); }
    finally { lastStatus = { ...status }; if (active === job) active = null; }
  };
  try { await checkedSave(saveBatch, { ...status, snapshot }); }
  catch (error) {
    status.status = 'failed'; status.error = String(error.message || error);
    await finish();
    pendingItems.clear();
    return { started: false, ...status };
  }
  (async () => {
    try {
      const evaluated = [];
      for (const item of snapshot) {
        if (job.cancelled) break;
        try {
          evaluated.push(await runEvaluate(item, { ...adapters, loadRules: () => JSON.parse(JSON.stringify(frozenRules)) }));
          status.succeeded++;
        } catch (error) {
          status.failed++;
          evaluated.push({
            code: String(item.code), classification: 'insufficient', selected: false, status: 'failed',
            reasonCodes: ['复核执行失败：' + String(error.message || error)],
            evidence: { selectionBatchId: item.selectionBatchId || '', snapshotDate: item.snapshotDate || '' },
            conditions: {}, missing: ['复核执行失败，可重试'], ruleVersion: RULE_VERSION,
            evidenceHash: hash({ code: item.code, error: String(error.message || error), at: Date.now() }), createdAt: Date.now(),
          });
        }
        status.done++;
        await checkedSave(saveBatch, { ...status, snapshot });
      }
      // 取消的部分批次不能产生“本批精选”。
      const finalized = job.cancelled ? evaluated.map((row) => ({ ...row, selected: false })) : finalizeSelections(evaluated);
      for (const result of finalized) {
        if (job.cancelled) result.selected = false;
        result.batchId = batchId;
        result.evidence = { ...result.evidence, selected: result.selected, selectionReason: result.selectionReason || '' };
        await checkedSave(saveResult, result);
      }
      status.status = job.cancelled ? 'cancelled' : 'completed';
      // D15-01：批次成功后把该批实际使用的 K 线版本冻结归档（不可变、不覆盖、不回填）。
      // 归档失败只记录，不影响已完成的复核结论与批次状态。
      if (!job.cancelled) {
        try {
          status.klineArchive = await archiveUsedKlineVersions(finalized, batchId, adapters);
        } catch (error) {
          status.klineArchive = { ok: false, error: String(error.message || error) };
        }
      }
    } catch (error) {
      status.status = 'failed'; status.error = String(error.message || error);
    } finally {
      await finish();
      if (job.cancelled || status.status === 'failed') pendingItems.clear();
      else if (pendingItems.size) {
        const queued = [...pendingItems.values()]; pendingItems.clear();
        start(queued, adapters).catch((error) => { lastStatus = { running: false, status: 'failed', error: String(error.message || error) }; });
      }
    }
  })();
  return { started: true, ...status };
}
function getStatus() { return active ? { ...active.status } : { ...lastStatus }; }
function stop() { if (!active) return { running: false }; active.cancelled = true; return { ...active.status, stopping: true }; }

// D15-01：按「候选批次 + 复核批次」把该批实际使用的 K 线版本冻结归档。
// 只有带真实 K 线证据（klineHash + klineDate）的记录才允许归档；缺证据的记录不得凭当前 K 线补造历史版本。
async function archiveUsedKlineVersions(finalized, reviewBatchId, adapters = {}) {
  const groups = new Map();
  const missing = [];
  for (const row of Array.isArray(finalized) ? finalized : []) {
    const evidence = (row && row.evidence) || {};
    const code = String((row && row.code) || '');
    if (!/^\d{6}$/.test(code) || !evidence.klineHash || !evidence.klineDate) continue;
    const key = String(evidence.selectionBatchId || '');
    const record = row.klineArchiveRecord;
    if (!record || !Array.isArray(record.bars)) {
      missing.push({ code, reason: 'review_kline_snapshot_missing' });
      continue;
    }
    if (record.contentHash !== evidence.klineHash || record.latestDate !== evidence.klineDate) {
      missing.push({ code, reason: 'review_kline_snapshot_mismatch' });
      continue;
    }
    if (!groups.has(key)) groups.set(key, []);
    if (!groups.get(key).some((item) => item.code === code)) {
      groups.get(key).push({ code, record, tradeDate: String(evidence.snapshotDate || '') });
    }
  }
  if (!groups.size) {
    return { ok: missing.length === 0, skipped: true, reason: missing.length ? 'no_frozen_kline_evidence' : 'no_kline_evidence', archives: [], missing };
  }
  if (typeof adapters.archiveKlineVersions === 'function') {
    return adapters.archiveKlineVersions({ groups, reviewBatchId, missing });
  }
  const archive = adapters.archiveKlineVersion || klineArchive.archiveKlineVersion;
  const archives = [];
  for (const [selectionBatchId, group] of groups) {
    const items = group.slice(0, ARCHIVE_MAX_RECORDS);
    const codes = items.map((item) => item.code);
    const tradeDates = [...new Set(items.map((item) => item.tradeDate).filter(Boolean))];
    const archiveId = selectionBatchId ? `${selectionBatchId}__${reviewBatchId}` : reviewBatchId;
    let result;
    if (!selectionBatchId) {
      result = { ok: false, error: '缺少候选批次ID，拒绝建立无法回链的K线归档' };
    } else if (tradeDates.length !== 1) {
      result = { ok: false, error: '同一候选批次包含不一致的交易日，拒绝归档' };
    } else try {
      result = await archive({
        archiveId,
        selectionBatchId,
        reviewBatchId,
        tradeDate: tradeDates[0],
        records: items.map((item) => item.record),
      });
    } catch (error) {
      result = { ok: false, error: String(error.message || error) };
    }
    archives.push({ archiveId, selectionBatchId, codes: codes.length, ...(result || {}) });
  }
  return { ok: missing.length === 0 && archives.every((item) => item.ok !== false), archives, missing };
}

module.exports = { start, getStatus, stop, latest: latestWatchRecommendations, evaluate, archiveUsedKlineVersions, RULE_VERSION };
