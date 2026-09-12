const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { ARCHIVE_DIR } = require('./market-prescan-store');
const { readMarketSentimentEvidence } = require('./storage');

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function safeBatchId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function archiveFileFor(input, archiveDir) {
  const value = String(input || '').trim();
  if (!value) return '';
  if (path.isAbsolute(value) || path.dirname(value) !== '.') return path.resolve(value);
  return path.join(archiveDir, `${safeBatchId(value.replace(/\.json$/i, ''))}.json`);
}

function addIssue(issues, severity, code, message) {
  issues.push({ severity, code, message });
}

function collectHashes(node, values = []) {
  if (Array.isArray(node)) node.forEach((item) => collectHashes(item, values));
  else if (node && typeof node === 'object') {
    if (typeof node.sha256 === 'string' && node.sha256) values.push(node.sha256);
    for (const [key, value] of Object.entries(node)) if (key !== 'sha256') collectHashes(value, values);
  }
  return values.sort();
}

function verifyRawPayloads(node, label, issues, counters) {
  if (Array.isArray(node)) {
    node.forEach((item, index) => verifyRawPayloads(item, `${label}[${index}]`, issues, counters));
    return;
  }
  if (!node || typeof node !== 'object') return;
  if (Object.prototype.hasOwnProperty.call(node, 'rawText')) {
    counters.payloads += 1;
    if (typeof node.rawText !== 'string') addIssue(issues, 'corrupt', 'raw_text_invalid', `${label} 的原始文本不是字符串`);
    else {
      const bytes = Buffer.from(node.rawText, 'utf8');
      if (!node.sha256) addIssue(issues, 'incomplete', 'raw_hash_missing', `${label} 缺少 SHA-256`);
      else if (sha256(bytes) !== node.sha256) addIssue(issues, 'corrupt', 'raw_hash_mismatch', `${label} 的 SHA-256 与正文不一致`);
      if (node.byteLength != null && Number(node.byteLength) !== bytes.length) addIssue(issues, 'corrupt', 'raw_size_mismatch', `${label} 的字节数与正文不一致`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(node, 'rawBase64')) {
    counters.payloads += 1;
    const value = String(node.rawBase64 || '');
    if (!value || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) addIssue(issues, 'corrupt', 'raw_base64_invalid', `${label} 的 Base64 原始字节无效`);
    else {
      const bytes = Buffer.from(value, 'base64');
      if (!node.sha256) addIssue(issues, 'incomplete', 'raw_hash_missing', `${label} 缺少 SHA-256`);
      else if (sha256(bytes) !== node.sha256) addIssue(issues, 'corrupt', 'raw_hash_mismatch', `${label} 的 SHA-256 与原始字节不一致`);
      if (node.byteLength != null && Number(node.byteLength) !== bytes.length) addIssue(issues, 'corrupt', 'raw_size_mismatch', `${label} 的字节数与原始字节不一致`);
    }
  }
  for (const [key, value] of Object.entries(node)) {
    if (key !== 'rawText' && key !== 'rawBase64') verifyRawPayloads(value, `${label}.${key}`, issues, counters);
  }
}

function verifyThemeSources(payload, rawBundle, issues) {
  const prescan = payload.prescan || {};
  if (prescan.scanScope && prescan.scanScope.mode !== 'theme_and_concept_constituents') return;
  const membership = prescan.themeMembership || {};
  for (const [kind, listKey] of [['industry', 'focusThemes'], ['concept', 'focusConcepts']]) {
    const boards = Array.isArray(prescan[listKey]) ? prescan[listKey] : [];
    const sourceKey = `${kind}Constituents`;
    const summaries = prescan.sourceEvidence && prescan.sourceEvidence[sourceKey];
    const rawSources = rawBundle.sources && rawBundle.sources[sourceKey];
    for (const board of boards) {
      const code = String(board && board.code || '');
      if (!code) {
        addIssue(issues, 'incomplete', 'theme_code_missing', `${kind} 重点板块缺少代码`);
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(membership, code)) addIssue(issues, 'incomplete', 'theme_membership_missing', `板块 ${code} 缺少成分股关系`);
      if (!summaries || !Object.prototype.hasOwnProperty.call(summaries, code)) addIssue(issues, 'incomplete', 'theme_summary_missing', `板块 ${code} 缺少成分摘要`);
      if (!rawSources || !Object.prototype.hasOwnProperty.call(rawSources, code)) addIssue(issues, 'incomplete', 'theme_raw_missing', `板块 ${code} 缺少成分原始响应`);
    }
  }
}

async function verifySentiment(prescan, issues, reader) {
  const expected = prescan && prescan.sourceEvidence && prescan.sourceEvidence.sentimentPools;
  const asOf = String(prescan && (prescan.asOf || prescan.snapshotDate) || '');
  if (!expected) {
    addIssue(issues, 'incomplete', 'sentiment_evidence_missing', '预扫描归档缺少情绪池证据摘要');
    return;
  }
  if (!expected.tradeDate) addIssue(issues, 'incomplete', 'sentiment_date_missing', '情绪池证据缺少交易日');
  else if (expected.tradeDate !== asOf) addIssue(issues, 'corrupt', 'sentiment_date_mismatch', '情绪池证据交易日与预扫描交易日不一致');
  if (!expected.quality || !expected.quality.requestedDate) addIssue(issues, 'incomplete', 'sentiment_requested_date_missing', '情绪池证据缺少请求日期');
  else if (expected.quality.requestedDate !== asOf) addIssue(issues, 'corrupt', 'sentiment_requested_date_mismatch', '情绪池请求日期与预扫描交易日不一致');
  const responseDates = Object.values(expected.quality && expected.quality.responseDates || {}).filter(Boolean);
  if (responseDates.some((date) => date !== asOf)) addIssue(issues, 'corrupt', 'sentiment_response_date_conflict', '情绪池响应日期与预扫描交易日冲突');
  if (!expected.available || !expected.quality || expected.quality.complete !== true) addIssue(issues, 'incomplete', 'sentiment_quality_incomplete', '情绪池证据质量不完整');
  if (!expected.sha256 || !(Number(expected.rawBytes) > 0)) addIssue(issues, 'incomplete', 'sentiment_hash_missing', '情绪池原文哈希或字节数缺失');
  const actual = await reader(asOf);
  if (!actual) {
    addIssue(issues, 'incomplete', 'sentiment_raw_missing', 'SQLite 中缺少对应交易日的情绪池原文');
    return;
  }
  if (actual.tradeDate !== asOf) addIssue(issues, 'corrupt', 'sentiment_storage_date_mismatch', 'SQLite 情绪池记录交易日与预扫描交易日不一致');
  if (expected.sha256 && actual.sha256 !== expected.sha256) addIssue(issues, 'corrupt', 'sentiment_hash_mismatch', 'SQLite 情绪池原文与归档摘要哈希不一致');
  if (Number(expected.rawBytes) !== Number(actual.rawBytes)) addIssue(issues, 'corrupt', 'sentiment_size_mismatch', 'SQLite 情绪池原文字节数与归档摘要不一致');
  for (const name of ['limitUp', 'limitDown', 'broken']) {
    const left = expected.pools && expected.pools[name];
    const right = actual.pools && actual.pools[name];
    if (!left || !left.present) addIssue(issues, 'incomplete', 'sentiment_pool_missing', `情绪池 ${name} 原文摘要缺失`);
    else if (!right || left.sha256 !== right.sha256) addIssue(issues, 'corrupt', 'sentiment_pool_hash_mismatch', `情绪池 ${name} 原文哈希不一致`);
  }
}

async function verifyPrescanArchive(input, options = {}) {
  const archiveDir = path.resolve(options.archiveDir || ARCHIVE_DIR);
  const file = archiveFileFor(input, archiveDir);
  const issues = [];
  const result = { status: 'incomplete', batchId: '', file, attachment: '', hashes: {}, counts: { marketPages: 0, sourcePayloads: 0 }, issues };
  if (!file || !fs.existsSync(file)) {
    addIssue(issues, 'incomplete', 'archive_missing', '预扫描主归档不存在');
    return result;
  }
  let payload;
  const mainBytes = fs.readFileSync(file);
  result.hashes.mainSha256 = sha256(mainBytes);
  try { payload = JSON.parse(mainBytes.toString('utf8')); }
  catch {
    addIssue(issues, 'corrupt', 'archive_json_invalid', '预扫描主归档不是有效 JSON');
    return { ...result, status: 'corrupt' };
  }
  const prescan = payload.prescan || {};
  result.batchId = String(prescan.batchId || '');
  if (payload.archiveVersion !== 'market-prescan-archive-v1') addIssue(issues, 'incomplete', 'archive_version_unknown', '预扫描主归档版本缺失或不受支持');
  const requestedId = path.basename(file, '.json');
  if (!result.batchId) addIssue(issues, 'corrupt', 'batch_id_missing', '预扫描主归档缺少批次ID');
  else if (safeBatchId(result.batchId) !== requestedId) addIssue(issues, 'corrupt', 'batch_id_mismatch', '文件名、主归档批次ID不一致');
  const asOf = String(prescan.asOf || '');
  const snapshotDate = String(payload.snapshot && payload.snapshot.snapshotDate || prescan.snapshotDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !snapshotDate) addIssue(issues, 'incomplete', 'trade_date_missing', '预扫描交易日或快照日期缺失');
  else if (asOf !== snapshotDate || prescan.snapshotDate && prescan.snapshotDate !== asOf) addIssue(issues, 'corrupt', 'trade_date_mismatch', '预扫描交易日与快照日期不一致');
  const evidence = payload.rawEvidence || {};
  if (!evidence.file) {
    addIssue(issues, 'incomplete', 'attachment_reference_missing', '主归档缺少原始响应附件引用');
  } else if (path.basename(evidence.file) !== evidence.file) {
    addIssue(issues, 'corrupt', 'attachment_path_invalid', '原始响应附件引用不能跨出归档目录');
  } else {
    const attachment = path.join(path.dirname(file), evidence.file);
    result.attachment = attachment;
    if (!fs.existsSync(attachment)) addIssue(issues, 'incomplete', 'attachment_missing', '原始响应 gzip 附件不存在');
    else {
      const gzipBytes = fs.readFileSync(attachment);
      result.hashes.gzipSha256 = sha256(gzipBytes);
      if (evidence.gzipSha256 && result.hashes.gzipSha256 !== evidence.gzipSha256) addIssue(issues, 'corrupt', 'gzip_hash_mismatch', 'gzip 附件 SHA-256 与主归档不一致');
      if (evidence.compressedBytes != null && Number(evidence.compressedBytes) !== gzipBytes.length) addIssue(issues, 'corrupt', 'gzip_size_mismatch', 'gzip 附件字节数与主归档不一致');
      let rawBytes;
      try { rawBytes = zlib.gunzipSync(gzipBytes); }
      catch { addIssue(issues, 'corrupt', 'gzip_invalid', '原始响应附件无法解压'); }
      if (rawBytes) {
        result.hashes.rawSha256 = sha256(rawBytes);
        if (!evidence.sha256) addIssue(issues, 'incomplete', 'attachment_hash_missing', '主归档缺少解压正文 SHA-256');
        else if (result.hashes.rawSha256 !== evidence.sha256) addIssue(issues, 'corrupt', 'attachment_hash_mismatch', '解压正文 SHA-256 与主归档不一致');
        if (evidence.rawBytes != null && Number(evidence.rawBytes) !== rawBytes.length) addIssue(issues, 'corrupt', 'attachment_size_mismatch', '解压正文字节数与主归档不一致');
        let rawBundle;
        try { rawBundle = JSON.parse(rawBytes.toString('utf8')); }
        catch { addIssue(issues, 'corrupt', 'attachment_json_invalid', '解压正文不是有效 JSON'); }
        if (rawBundle) {
          if (rawBundle.batchId !== result.batchId) addIssue(issues, 'corrupt', 'attachment_batch_mismatch', '原始响应附件批次ID与主归档不一致');
          for (const [market, summary] of Object.entries(evidence.markets || {})) {
            const pages = rawBundle.markets && rawBundle.markets[market];
            if (!Array.isArray(pages)) addIssue(issues, 'incomplete', 'market_pages_missing', `市场 ${market} 缺少原始分页`);
            else {
              result.counts.marketPages += pages.length;
              if (Number(summary.pages) !== pages.length) addIssue(issues, 'corrupt', 'market_page_count_mismatch', `市场 ${market} 的分页数量与主归档不一致`);
            }
          }
          const sourceNames = Array.isArray(evidence.sources) ? evidence.sources : [];
          for (const name of sourceNames) {
            if (!rawBundle.sources || !Object.prototype.hasOwnProperty.call(rawBundle.sources, name)) addIssue(issues, 'incomplete', 'source_raw_missing', `来源 ${name} 缺少原始响应`);
            if (!prescan.sourceEvidence || !Object.prototype.hasOwnProperty.call(prescan.sourceEvidence, name)) addIssue(issues, 'incomplete', 'source_summary_missing', `来源 ${name} 缺少主归档摘要`);
            const rawSource = rawBundle.sources && rawBundle.sources[name];
            const summary = prescan.sourceEvidence && prescan.sourceEvidence[name];
            if (rawSource && summary) {
              const rawHashes = collectHashes(rawSource);
              const summaryHashes = collectHashes(summary);
              if (rawHashes.length && JSON.stringify(rawHashes) !== JSON.stringify(summaryHashes)) addIssue(issues, 'corrupt', 'source_summary_hash_mismatch', `来源 ${name} 的摘要哈希与原始响应不一致`);
            }
          }
          const counters = { payloads: 0 };
          verifyRawPayloads(rawBundle.markets, 'markets', issues, counters);
          verifyRawPayloads(rawBundle.sources, 'sources', issues, counters);
          result.counts.sourcePayloads = counters.payloads;
          verifyThemeSources(payload, rawBundle, issues);
        }
      }
    }
  }
  for (const market of payload.snapshot && payload.snapshot.byMarket || []) {
    if (market.source === 'live' && (!market.quality || market.quality.complete !== true)) addIssue(issues, 'incomplete', 'market_quality_incomplete', `市场 ${market.key || ''} 分页质量不完整`);
  }
  await verifySentiment(prescan, issues, options.sentimentEvidenceReader || readMarketSentimentEvidence);
  result.status = issues.some((item) => item.severity === 'corrupt') ? 'corrupt' : issues.length ? 'incomplete' : 'complete';
  return result;
}

module.exports = { verifyPrescanArchive };
