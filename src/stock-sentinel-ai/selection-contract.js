const crypto = require('crypto');

const SELECTION_CONTRACT_VERSION = 3;

const EVIDENCE_STATUS = Object.freeze({
  COMPLETE: 'complete',
  PARTIAL: 'partial',
  STALE: 'stale',
  MISSING: 'missing',
});

const EXCLUSION_REASONS = Object.freeze({
  ST_OR_SUSPENDED: 'st_or_suspended',
  QUOTE_MISSING: 'quote_missing',
  QUOTE_INCOMPLETE: 'quote_incomplete',
  QUOTE_STALE: 'quote_stale',
  RULE_NOT_MATCHED: 'rule_not_matched',
  SCORE_TOO_LOW: 'score_too_low',
  KLINE_PATTERN_NOT_CONFIRMED: 'kline_pattern_not_confirmed',
});

function createBatchId(kind, at = new Date()) {
  const stamp = at.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `${kind}-${stamp}-${crypto.randomBytes(4).toString('hex')}`;
}

function normalizeEvidence(evidence, fallback = {}) {
  const value = evidence && typeof evidence === 'object' ? evidence : {};
  return {
    status: Object.values(EVIDENCE_STATUS).includes(value.status) ? value.status : (fallback.status || EVIDENCE_STATUS.MISSING),
    source: String(value.source || fallback.source || ''),
    sourceAt: String(value.sourceAt || fallback.sourceAt || ''),
    fetchedAt: String(value.fetchedAt || fallback.fetchedAt || ''),
    requested: Number(value.requested) || Number(fallback.requested) || 0,
    received: Number(value.received) || Number(fallback.received) || 0,
    missingCodes: Array.isArray(value.missingCodes) ? value.missingCodes : (fallback.missingCodes || []),
    reasons: Array.isArray(value.reasons) ? value.reasons : (fallback.reasons || []),
  };
}

function normalizeSelectionRecord(record = {}) {
  return {
    ...record,
    selectionContractVersion: Number(record.selectionContractVersion) || 1,
    selectionBatchId: String(record.selectionBatchId || ''),
    prescanBatchId: String(record.prescanBatchId || ''),
    selectionParameterStatus: String(record.selectionParameterStatus || ''),
    selectionPolicyParams: record.selectionPolicyParams && typeof record.selectionPolicyParams === 'object' ? record.selectionPolicyParams : null,
    selectionRuleEvidence: Array.isArray(record.selectionRuleEvidence) ? record.selectionRuleEvidence : [],
    selectionRulesFingerprint: String(record.selectionRulesFingerprint || ''),
    quoteEvidence: normalizeEvidence(record.quoteEvidence),
    boardLeaderRanks: Array.isArray(record.boardLeaderRanks) ? record.boardLeaderRanks : [],
    candidateThemeRanks: Array.isArray(record.candidateThemeRanks)
      ? record.candidateThemeRanks
      : (Array.isArray(record.themeLeaderRanks) ? record.themeLeaderRanks : []),
  };
}

module.exports = {
  SELECTION_CONTRACT_VERSION,
  EVIDENCE_STATUS,
  EXCLUSION_REASONS,
  createBatchId,
  normalizeEvidence,
  normalizeSelectionRecord,
};
