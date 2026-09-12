// 智诊盯盘 · 回放输入预检（第十五阶段 D15-04）
//
// 目标：回放/参数比较开始之前，先证明「输入证据在回放日当时确实可得且版本一致」。
// 任何一项不成立都阻止该样本进入参数比较，并逐项保留原因（机器可读）。
//
// 检查范围：批次ID、交易日、入池规则指纹、行情源时间、题材成分、K线版本（内容哈希）、
// 复权口径、尾K最终状态，以及任何晚于回放日的未来数据。
// 只读：不写库、不改归档、不修补证据。
const fs = require('fs');
const path = require('path');
const { historicalEvidenceIssues, dateOnly } = require('./selection-replay');
const { rulesFingerprint, klineFingerprint } = require('./recommendation-validity');
const { isAdjustmentCorroborated, normalizeAdjustment, adjustmentLabel } = require('./kline-source-contract');
const { normalizeTailStatus, TAIL_STATUS } = require('./kline-tail-status');
const { listKlineVersionArchives, verifyKlineVersionArchive, normalizeBars, ARCHIVE_DIR } = require('./kline-archive');
const { ARCHIVE_DIR: PRESCAN_ARCHIVE_DIR } = require('./market-prescan-store');
const { verifyPrescanArchive } = require('./market-prescan-integrity');

const STRATEGY_MIN_BARS = 60;

// 返回合法日期字符串（kline-quality.validDate 返回布尔值，这里需要的文本本身）。
function validDateText(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  const time = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === text ? text : '';
}

function shanghaiDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(date);
}

// 行情源时间必须是回放日当天的采集时间，且不得晚于回放日（未来数据一律拦截）。
function assessQuoteSourceTime(sourceAt, asOf) {
  const text = String(sourceAt || '');
  const time = Date.parse(text);
  if (!text || !Number.isFinite(time)) return { ok: false, code: 'quote_source_time_missing', message: '缺少行情源时间', date: '' };
  const date = shanghaiDate(text);
  if (!date) return { ok: false, code: 'quote_source_time_missing', message: '行情源时间无法解析', date: '' };
  if (asOf && date > asOf) return { ok: false, code: 'quote_source_future', message: `行情源日期${date}晚于回放日${asOf}`, date };
  if (asOf && date !== asOf) return { ok: false, code: 'quote_source_date_mismatch', message: `行情源日期${date}与回放日${asOf}不一致`, date };
  return { ok: true, code: '', message: '', date };
}

function addBlocker(blockers, code, message, extra = {}) { blockers.push({ code, message, ...extra }); }

// 单样本预检。返回 { code, asOf, ready, blockers, warnings, checks }。
function precheckSample(sample = {}, options = {}) {
  const item = (sample && sample.item) || {};
  const asOf = dateOnly(options.asOf || item.snapshotDate);
  const blockers = [];
  const warnings = [];
  const candles = Array.isArray(sample.candles) ? sample.candles : [];
  const meta = (sample.klineMeta && typeof sample.klineMeta === 'object') ? sample.klineMeta : {};

  // 1) 批次与交易日
  const selectionBatchId = String(item.selectionBatchId || '');
  const prescanBatchId = String(item.prescanBatchId || '');
  if (!selectionBatchId) addBlocker(blockers, 'batch_id_missing', '缺少候选批次ID，无法关联归档证据');
  if (!prescanBatchId) addBlocker(blockers, 'prescan_batch_id_missing', '缺少市场预扫描批次ID，无法核对题材成分范围');
  if (!asOf) addBlocker(blockers, 'as_of_missing', '缺少有效回放日期');
  if (asOf && String(item.snapshotDate || '') !== asOf) addBlocker(blockers, 'snapshot_date_mismatch', '候选行情交易日与回放日不一致');
  if (Number(item.selectionContractVersion) !== 3) addBlocker(blockers, 'contract_version_unsupported', '不是可回放的 v3 候选契约');

  // 2) 入池规则指纹
  const ruleEvidence = Array.isArray(item.selectionRuleEvidence) ? item.selectionRuleEvidence : null;
  if (!ruleEvidence || !ruleEvidence.length) addBlocker(blockers, 'rules_snapshot_missing', '缺少入池规则配置快照');
  else {
    if (!item.selectionRulesFingerprint) addBlocker(blockers, 'rules_fingerprint_missing', '缺少入池规则指纹');
    else if (rulesFingerprint(ruleEvidence) !== item.selectionRulesFingerprint) addBlocker(blockers, 'rules_fingerprint_mismatch', '入池规则配置快照与指纹不一致');
  }

  // 3) 行情源时间
  const quote = assessQuoteSourceTime(item.quoteEvidence && item.quoteEvidence.sourceAt, asOf);
  if (!quote.ok) addBlocker(blockers, quote.code, quote.message);

  // 4) 题材成分范围（含证据日期不得晚于回放日）
  const themes = Array.isArray(item.themeEvidence) ? item.themeEvidence : [];
  if (!themes.length) addBlocker(blockers, 'theme_evidence_missing', '缺少历史题材证据，无法还原当时成分范围');
  for (const theme of themes) {
    const label = String((theme && (theme.name || theme.code)) || '未知');
    const themeDate = dateOnly(theme && theme.asOf);
    if (!themeDate) addBlocker(blockers, 'theme_date_missing', `题材${label}缺少证据日期`);
    else if (asOf && themeDate > asOf) addBlocker(blockers, 'theme_future', `题材${label}证据日期${themeDate}晚于回放日${asOf}`);
    else if (asOf && themeDate !== asOf) addBlocker(blockers, 'theme_date_mismatch', `题材${label}证据已跨交易日`);
  }
  const resolvePrescan = options.prescanEvidenceFor || sample.prescanEvidenceFor;
  const prescan = typeof resolvePrescan === 'function' ? resolvePrescan({ prescanBatchId, code: String(item.code || '') }) : null;
  if (prescanBatchId && !prescan) addBlocker(blockers, 'prescan_archive_missing', '缺少对应市场预扫描归档');
  else if (prescan) {
    if (prescan.status !== 'complete') addBlocker(blockers, 'prescan_archive_not_complete', `市场预扫描归档校验状态为 ${prescan.status || 'unknown'}`);
    if (asOf && prescan.tradeDate !== asOf) addBlocker(blockers, 'prescan_trade_date_mismatch', '市场预扫描归档交易日与回放日不一致');
    for (const theme of themes) {
      const themeCode = String((theme && theme.code) || '');
      const members = prescan.themeMembership && prescan.themeMembership[themeCode];
      if (!Array.isArray(members) || !members.includes(String(item.code || ''))) {
        addBlocker(blockers, 'theme_membership_unverified', `股票不在预扫描归档的题材 ${themeCode || '未知'} 成分中`);
      }
    }
  }

  // 5) K线版本 / 复权口径 / 尾K最终状态
  const normalized = normalizeBars(candles);
  const sorted = normalized.bars;
  if (!sorted.length) addBlocker(blockers, 'kline_missing', '本地没有可用K线，无法复核');
  if (normalized.duplicates) addBlocker(blockers, 'kline_duplicate_dates', `K线存在重复交易日：${normalized.duplicates}根`);
  if (normalized.invalid) addBlocker(blockers, 'kline_invalid_bars', `K线存在日期或OHLCV无效的数据：${normalized.invalid}根`);
  const latestDate = sorted.length ? sorted[sorted.length - 1].date : '';
  if (asOf && latestDate && latestDate > asOf) addBlocker(blockers, 'kline_latest_after_as_of', `K线最新日期${latestDate}晚于回放日${asOf}，存在未来数据`);
  if (sorted.length && sorted.length < STRATEGY_MIN_BARS) warnings.push({ code: 'kline_shallow', message: `K线深度仅${sorted.length}根，低于策略最小样本量${STRATEGY_MIN_BARS}` });

  if (!Object.keys(meta).length) addBlocker(blockers, 'kline_final_evidence_missing', '缺少K线来源/复权/尾K元数据，无法证明版本与最终状态');
  else {
    if (!String(meta.source || '')) addBlocker(blockers, 'kline_source_missing', '缺少K线来源证据');
    const adjustment = normalizeAdjustment(meta.adjustmentType);
    if (!isAdjustmentCorroborated(meta.source, adjustment)) addBlocker(blockers, 'kline_adjustment_unverified', `K线复权口径${adjustmentLabel(adjustment)}无法从来源响应验证`);
    if (normalizeTailStatus(meta.tailStatus) !== TAIL_STATUS.CONFIRMED) addBlocker(blockers, 'kline_tail_not_confirmed', '回放所用尾K不是已收盘确认版本');
    else if (!meta.tailConfirmedAt) addBlocker(blockers, 'kline_tail_confirmed_at_missing', '缺少尾K确认时间');
    const sourceLatestDate = validDateText(meta.sourceLatestDate);
    if (!sourceLatestDate) addBlocker(blockers, 'kline_source_latest_date_missing', '缺少有效来源最新日期');
    else if (latestDate && sourceLatestDate !== latestDate) addBlocker(blockers, 'kline_source_latest_date_mismatch', '来源最新日期与回放K线尾日不一致');
    const fetchedDate = shanghaiDate(meta.fetchedAt);
    if (!fetchedDate) addBlocker(blockers, 'kline_fetched_at_missing', '缺少有效K线抓取时间');
    else if (asOf && fetchedDate > asOf) addBlocker(blockers, 'kline_fetched_at_future', 'K线抓取时间晚于回放日');
    const confirmedDate = shanghaiDate(meta.tailConfirmedAt);
    if (meta.tailConfirmedAt && !confirmedDate) addBlocker(blockers, 'kline_tail_confirmed_at_invalid', '尾K确认时间无法解析');
    else if (asOf && confirmedDate > asOf) addBlocker(blockers, 'kline_tail_confirmed_at_future', '尾K确认时间晚于回放日');
  }

  // 6) K线版本归档核对（内容哈希必须与归档一致）
  // 归档引用可由批次统一注入（options），也可由样本自带（sample.archivedVersionFor）。
  const computedHash = sorted.length ? klineFingerprint(sorted) : '';
  const resolveArchived = options.archivedVersionFor || sample.archivedVersionFor;
  const archived = typeof resolveArchived === 'function'
    ? resolveArchived({
      code: String(item.code || ''), selectionBatchId, asOf,
      archiveId: String(sample.replayArchive && sample.replayArchive.archiveId || ''),
    })
    : null;
  if (!archived) addBlocker(blockers, 'kline_archive_missing', '缺少对应批次的K线版本归档，无法证明回放所用K线版本');
  else if (!archived.contentHash) addBlocker(blockers, 'kline_archive_hash_missing', 'K线版本归档缺少内容哈希');
  else if (computedHash && archived.contentHash !== computedHash) addBlocker(blockers, 'kline_hash_mismatch', 'K线内容与归档版本不一致');
  if (archived && archived.status !== 'complete') {
    addBlocker(blockers, 'kline_archive_not_complete', `K线版本归档校验状态为 ${archived.status || 'unknown'}，不能作为参数比较证据`);
  }

  // 7) 历史证据一致性兜底：与既有回放口径的结果对照，防止两套判定发散。
  const legacy = historicalEvidenceIssues(item, asOf);
  for (const text of legacy.futureDated) {
    if (!blockers.some((entry) => entry.message.includes(text))) addBlocker(blockers, 'future_data_detected', text);
  }
  for (const text of legacy.missing) warnings.push({ code: 'historical_evidence_note', message: text });

  return {
    code: String(item.code || ''),
    asOf,
    selectionBatchId,
    ready: blockers.length === 0,
    blockers,
    warnings,
    checks: {
      contractVersion: Number(item.selectionContractVersion) || 0,
      snapshotDate: String(item.snapshotDate || ''),
      quoteSourceDate: quote.date,
      themeCount: themes.length,
      evidenceBars: sorted.length,
      latestEvidenceDate: latestDate,
      computedKlineHash: computedHash,
      archivedKlineHash: archived ? String(archived.contentHash || '') : '',
      archivedArchiveId: archived ? String(archived.archiveId || '') : '',
      archivedStatus: archived ? String(archived.status || '') : '',
      prescanBatchId,
      prescanStatus: prescan ? String(prescan.status || '') : '',
      klineSource: String(meta.source || ''),
      adjustmentType: normalizeAdjustment(meta.adjustmentType),
      tailStatus: normalizeTailStatus(meta.tailStatus),
    },
  };
}

async function buildPrescanIndex(archiveDir = PRESCAN_ARCHIVE_DIR, options = {}) {
  const index = new Map();
  if (!fs.existsSync(archiveDir)) return index;
  const files = fs.readdirSync(archiveDir).filter((name) => name.endsWith('.json') && !name.endsWith('.tmp')).sort();
  for (const name of files) {
    const file = path.join(archiveDir, name);
    let payload;
    try { payload = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    const prescan = payload && payload.prescan || {};
    const batchId = String(prescan.batchId || '');
    if (!batchId) continue;
    const verification = await verifyPrescanArchive(file, options.prescanVerifyOptions || {});
    index.set(batchId, {
      batchId,
      status: verification.status,
      tradeDate: String(prescan.asOf || prescan.snapshotDate || ''),
      themeMembership: prescan.themeMembership && typeof prescan.themeMembership === 'object' ? prescan.themeMembership : {},
    });
  }
  return index;
}

// 索引K线版本归档：按 (selectionBatchId, code) 提供内容哈希与批次校验状态。
async function buildArchiveIndex(archiveDir, { verify = true, reviewBatchReader = null, selectionArchiveDir = '' } = {}) {
  const entries = listKlineVersionArchives({ archiveDir: archiveDir || ARCHIVE_DIR });
  const index = new Map();
  for (const entry of entries) {
    const verification = verify
      ? await verifyKlineVersionArchive(entry.file, { archiveDir: archiveDir || ARCHIVE_DIR, reviewBatchReader, selectionArchiveDir: selectionArchiveDir || undefined })
      : null;
    for (const code of entry.recordCodes || []) {
      const key = `${entry.selectionBatchId}|${code}`;
      const value = {
        archiveId: entry.archiveId,
        selectionBatchId: entry.selectionBatchId,
        reviewBatchId: entry.reviewBatchId,
        contentHash: (entry.contentHashes || {})[code] || '',
        status: verification ? verification.status : (entry.readOk ? 'unverified' : 'corrupt'),
      };
      const versions = index.get(key) || [];
      versions.push(value);
      index.set(key, versions);
    }
  }
  return { size: entries.length, index, verify };
}

// 批次预检：先建归档索引，再一次判定所有样本。返回 ok=false 时调用方必须阻止参数比较。
async function precheckReplayInputs(samples, options = {}) {
  const index = options.archiveIndex || await buildArchiveIndex(options.klineArchiveDir || ARCHIVE_DIR, {
    verify: options.verifyKlineArchive !== false,
    reviewBatchReader: options.reviewBatchReader || null,
    selectionArchiveDir: options.selectionArchiveDir || '',
  });
  const prescanIndex = options.prescanIndex || await buildPrescanIndex(options.prescanArchiveDir || PRESCAN_ARCHIVE_DIR, options);
  const indexLookup = options.archivedVersionFor
    || (({ code, selectionBatchId, archiveId }) => {
      const versions = index.index.get(`${selectionBatchId}|${code}`) || [];
      if (archiveId) return versions.find((entry) => entry.archiveId === archiveId) || null;
      return versions.find((entry) => entry.status === 'complete') || versions[0] || null;
    });
  // 优先用归档索引；索引未命中时退回样本自带的版本引用，两者都缺才判为缺少K线版本归档。
  const items = (Array.isArray(samples) ? samples : []).map((sample) => precheckSample(sample, {
    ...options,
    archivedVersionFor: (query) => indexLookup(query) || (typeof sample.archivedVersionFor === 'function' ? sample.archivedVersionFor(query) : null),
    prescanEvidenceFor: (query) => (typeof options.prescanEvidenceFor === 'function' ? options.prescanEvidenceFor(query) : prescanIndex.get(query.prescanBatchId))
      || (typeof sample.prescanEvidenceFor === 'function' ? sample.prescanEvidenceFor(query) : null),
  }));
  const byCode = {};
  const byCategory = {};
  for (const entry of items) {
    for (const blocker of entry.blockers) {
      byCode[entry.code || '(空)'] = (byCode[entry.code || '(空)'] || 0) + 1;
      const category = String(blocker.code || '').split('_')[0] || 'other';
      byCategory[category] = (byCategory[category] || 0) + 1;
    }
  }
  const ready = items.filter((entry) => entry.ready);
  return {
    precheckVersion: 'replay-precheck-v1',
    checkedAt: new Date().toISOString(),
    sampleCount: items.length,
    readyCount: ready.length,
    blockedCount: items.length - ready.length,
    ok: items.length > 0 && ready.length === items.length,
    parameterComparisonAllowed: ready.length > 0,
    archiveIndex: { archives: index.size },
    blockingReasons: [...new Set(items.flatMap((entry) => entry.blockers.map((blocker) => blocker.code)))].sort(),
    byCode,
    byCategory,
    items,
    readySamples: ready.map((entry) => entry.code),
    readyIndexes: items.map((entry, index) => entry.ready ? index : -1).filter((index) => index >= 0),
  };
}

module.exports = {
  STRATEGY_MIN_BARS,
  assessQuoteSourceTime,
  buildArchiveIndex,
  buildPrescanIndex,
  precheckSample,
  precheckReplayInputs,
};
