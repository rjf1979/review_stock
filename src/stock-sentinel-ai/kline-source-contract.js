// 智诊盯盘 · 数据源能力契约（第十四阶段 D14-01）
//
// 每个日 K 取数源在此显式声明：复权口径、成交量单位、日期字段、已覆盖字段。
// 硬约束：复权口径只有「响应本身可验证」时才允许声明；仅凭请求参数或历史注释推断的
// 一律记 `unknown`，不得统一写成 `qfq`。存储层、同步链与推荐证据都以本契约为唯一口径来源。
//
// 声明依据（2026-09-12 受控探测，逐条可复核）：
// - 腾讯 fqkline：请求 `param=<code>,day,,,<lmt>,qfq`；`qfq` 请求的数据节点名为 `qfqday`，
//   去掉复权参数后节点名为 `day`。同一票同一区间两者并存且 300 根里 244 根 OHLC 不同
//   （如 600519 2025-06-24 qfq 收 1357.619 / day 收 1437.200），即节点名本身可验证口径。
//   因此 `qfqday` ⇒ `qfq`，仅返回 `day` ⇒ `unadjusted`（接口的原始未复权序列）。
// - 百度股市通：响应只有 keys/marketData 数值列，不含复权标记；本轮受控探测被风控拦截（403），
//   无法从响应验证 ⇒ `unknown`。
// - 搜狐 hisHq：响应只有 hq 二维数组，不含复权标记 ⇒ `unknown`。
// - 东财 kline/get：`fqt=1` 只是请求参数，响应字段 f51..f61 不含复权标记；本轮本机探测
//   `push2his` 不可达（UND_ERR_SOCKET），无法从响应验证 ⇒ `unknown`。
// - 新浪 getKLineData：响应只有 day/open/high/low/close/volume，不含复权标记 ⇒ `unknown`。
//   代码注释曾写「返回未复权日K」，属于无法从响应验证的推断，按规则不写入契约。

const ADJUSTMENT = { QFQ: 'qfq', UNADJUSTED: 'unadjusted', UNKNOWN: 'unknown' };
const ADJUSTMENT_LABEL = { qfq: '前复权', unadjusted: '未复权', unknown: '口径未知' };

function normalizeAdjustment(value) {
  const text = String(value || '').trim();
  return text === ADJUSTMENT.QFQ || text === ADJUSTMENT.UNADJUSTED ? text : ADJUSTMENT.UNKNOWN;
}

function adjustmentLabel(value) {
  return ADJUSTMENT_LABEL[normalizeAdjustment(value)] || ADJUSTMENT_LABEL.unknown;
}

// 逐源能力表。fields 用源响应的原始字段路径声明，volumeUnit 为源边界原始单位。
const SOURCE_CONTRACTS = {
  tencent: {
    id: 'tencent',
    label: '腾讯 fqkline',
    endpoint: 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get',
    requestSignature: 'param=<prefix><code>,day,,,<lmt>,qfq',
    responseShape: 'data.<prefix><code>.[qfqday|day][]',
    dateField: 'k[0]',
    fields: { date: 'k[0]', open: 'k[1]', close: 'k[2]', high: 'k[3]', low: 'k[4]', volume: 'k[5]' },
    amountField: null,
    covered: ['date', 'open', 'high', 'low', 'close', 'volume'],
    volumeUnit: 'lot',
    volumeScale: 100,
    dateFormat: 'YYYY-MM-DD',
    adjustment: {
      declared: ADJUSTMENT.QFQ,
      corroborated: [ADJUSTMENT.QFQ, ADJUSTMENT.UNADJUSTED],
      verifiedFromResponse: true,
      evidence: '数据节点名 data.<symbol>.qfqday（前复权序列）/ day（原始未复权序列）',
      fallback: ADJUSTMENT.UNKNOWN,
      // 由取数边界回传的节点名判定；无法判定时退回 unknown。
      resolve: (evidence) => {
        const node = String((evidence && evidence.node) || '');
        if (node === 'qfqday') return ADJUSTMENT.QFQ;
        if (node === 'day') return ADJUSTMENT.UNADJUSTED;
        return ADJUSTMENT.UNKNOWN;
      },
    },
  },
  baidu: {
    id: 'baidu',
    label: '百度股市通',
    endpoint: 'https://finance.pae.baidu.com/selfselect/getstockquotation',
    requestSignature: 'group=quotation_kline_ab&ktype=1&newFormat=1',
    responseShape: 'Result.newMarketData.keys[] + marketData(; 分隔行)',
    dateField: 'row[keys.time]',
    fields: { date: 'row[keys.time]', open: 'row[keys.open]', close: 'row[keys.close]', high: 'row[keys.high]', low: 'row[keys.low]', volume: 'row[keys.volume]' },
    amountField: null,
    covered: ['date', 'open', 'high', 'low', 'close', 'volume'],
    volumeUnit: 'share',
    volumeScale: 1,
    dateFormat: 'YYYY-MM-DD',
    adjustment: {
      declared: ADJUSTMENT.UNKNOWN,
      verifiedFromResponse: false,
      evidence: '响应只有 keys/marketData 数值列，无复权标记；本轮受控探测被风控拦截',
      fallback: ADJUSTMENT.UNKNOWN,
      requested: null,
    },
  },
  sohu: {
    id: 'sohu',
    label: '搜狐财经 hisHq',
    endpoint: 'https://q.stock.sohu.com/hisHq',
    requestSignature: 'code=cn_<code>&period=d&order=D',
    responseShape: '[{ hq: [[date,open,close,change,changePct,low,high,volume,...]] }]',
    dateField: 'row[0]',
    fields: { date: 'row[0]', open: 'row[1]', close: 'row[2]', high: 'row[6]', low: 'row[5]', volume: 'row[7]' },
    amountField: null,
    covered: ['date', 'open', 'high', 'low', 'close', 'volume'],
    volumeUnit: 'lot',
    volumeScale: 100,
    dateFormat: 'YYYY-MM-DD',
    adjustment: {
      declared: ADJUSTMENT.UNKNOWN,
      verifiedFromResponse: false,
      evidence: '响应只有 hq 二维数组，无复权标记',
      fallback: ADJUSTMENT.UNKNOWN,
      requested: null,
    },
  },
  em: {
    id: 'em',
    label: '东财日K',
    endpoint: 'https://push2his.eastmoney.com/api/qt/stock/kline/get',
    requestSignature: 'klt=101&fqt=1&fields2=f51..f61',
    responseShape: 'data.klines[](逗号分隔字符串)',
    dateField: 'p[0]',
    fields: { date: 'p[0]', open: 'p[1]', close: 'p[2]', high: 'p[3]', low: 'p[4]', volume: 'p[5]' },
    amountField: null,
    covered: ['date', 'open', 'high', 'low', 'close', 'volume'],
    volumeUnit: 'lot',
    volumeScale: 100,
    dateFormat: 'YYYY-MM-DD',
    adjustment: {
      declared: ADJUSTMENT.UNKNOWN,
      verifiedFromResponse: false,
      evidence: 'fqt=1 仅为请求参数，响应字段 f51..f61 不含复权标记',
      requested: 'qfq (fqt=1)',
      fallback: ADJUSTMENT.UNKNOWN,
    },
  },
  sina: {
    id: 'sina',
    label: '新浪日K',
    endpoint: 'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData',
    requestSignature: 'scale=240&ma=no&datalen=<lmt>',
    responseShape: '[{ day, open, high, low, close, volume }]',
    dateField: 'day',
    fields: { date: 'day', open: 'open', high: 'high', low: 'low', close: 'close', volume: 'volume' },
    amountField: null,
    covered: ['date', 'open', 'high', 'low', 'close', 'volume'],
    volumeUnit: 'share',
    volumeScale: 1,
    dateFormat: 'YYYY-MM-DD',
    adjustment: {
      declared: ADJUSTMENT.UNKNOWN,
      verifiedFromResponse: false,
      evidence: '响应只有 day/open/high/low/close/volume，无复权标记（历史注释称未复权，属不可验证推断）',
      fallback: ADJUSTMENT.UNKNOWN,
      requested: null,
    },
  },
};

const SOURCE_IDS = Object.keys(SOURCE_CONTRACTS);

function sourceContract(source) {
  return SOURCE_CONTRACTS[String(source || '')] || null;
}

// 源原始成交量的换算系数：契约未登记的来源按「股」原样处理（与 kline-data-standard §2 一致）。
function sourceVolumeScale(source) {
  const contract = sourceContract(source);
  return contract && Number.isFinite(Number(contract.volumeScale)) ? Number(contract.volumeScale) : 1;
}

function normalizeKlineVolumeByContract(rawVolume, source) {
  // 空字段/错误字段保持缺失（null），不用 0 冒充真实成交量；显式的 0 仍按 0 保留。
  if (rawVolume == null || String(rawVolume).trim() === '') return null;
  const volume = Number(rawVolume);
  if (!Number.isFinite(volume) || volume < 0) return null;
  return volume * sourceVolumeScale(source);
}

// 复权口径解析：只有契约声明「可从响应验证」且取数边界回传了证据时才给出具体口径。
function resolveSourceAdjustment(source, evidence) {
  const contract = sourceContract(source);
  if (!contract || !contract.adjustment) return ADJUSTMENT.UNKNOWN;
  const adjustment = contract.adjustment;
  if (adjustment.verifiedFromResponse && typeof adjustment.resolve === 'function') {
    return normalizeAdjustment(adjustment.resolve(evidence));
  }
  return normalizeAdjustment(adjustment.declared);
}

// 已落地序列的复权口径是否可信：口径必须与该来源的契约声明一致，且该声明可从响应验证。
// 旧库默认写死的 `qfq`（例如实际来自新浪却标 qfq）在此判定为不可信，按 unknown 处理。
function isAdjustmentCorroborated(source, adjustmentType) {
  const contract = sourceContract(source);
  if (!contract || !contract.adjustment) return false;
  const value = normalizeAdjustment(adjustmentType);
  const corroborated = Array.isArray(contract.adjustment.corroborated)
    ? contract.adjustment.corroborated.map(normalizeAdjustment)
    : [normalizeAdjustment(contract.adjustment.declared)];
  return value !== ADJUSTMENT.UNKNOWN
    && corroborated.includes(value)
    && contract.adjustment.verifiedFromResponse === true;
}

// 写入前的复权相容性判定（D14-06 来源切换 / 复权冲突）。
// 返回 { allowed, status, code, reason, action, retryable }；拒绝时不得改写既有 K 线序列。
function decideKlineWrite({ stored = null, source = '', adjustmentType = '' } = {}) {
  const incoming = normalizeAdjustment(adjustmentType);
  const incomingSource = String(source || '');
  const storedSource = String((stored && stored.source) || '');
  const storedAdjustment = normalizeAdjustment(stored && stored.adjustmentType);
  const hasStoredBars = Boolean(stored && Array.isArray(stored.kline) && stored.kline.length);
  const hasStoredSeries = Boolean(stored && (hasStoredBars || storedSource || stored.adjustmentType));
  const sourceChanged = Boolean(storedSource && incomingSource && storedSource !== incomingSource);
  const switchNote = sourceChanged ? `来源切换（${storedSource} → ${incomingSource || '未知'}）` : '';
  if (!hasStoredSeries) {
    return { allowed: true, status: 'no-stored-series', code: '', reason: '', action: '', retryable: false, storedAdjustment: '', storedSource: '' };
  }
  // 已有数值序列却缺少来源，无法证明增量写入与历史同口径；必须显式重建整段序列。
  if (hasStoredBars && (!storedSource || !incomingSource)) {
    return {
      allowed: false,
      status: 'provenance-missing',
      code: 'KLINE_PROVENANCE_MISSING',
      reason: '本地K线已有历史数据但缺少可核对来源，拒绝增量混写，需重建该股完整K线',
      action: 'rebuild_required', retryable: false,
      storedAdjustment, storedSource, incomingAdjustment: incoming, incomingSource,
    };
  }
  // 旧库/不可验证来源写下的口径不作为权威（不得据此拒绝合法更新，也不得冒充已验证口径）。
  const authoritative = isAdjustmentCorroborated(storedSource, storedAdjustment) ? storedAdjustment : ADJUSTMENT.UNKNOWN;
  if (authoritative === ADJUSTMENT.UNKNOWN) {
    const notices = [];
    if (storedAdjustment !== ADJUSTMENT.UNKNOWN) {
      notices.push(`旧库记录的复权口径（${adjustmentLabel(storedAdjustment)}）无法从来源 ${storedSource || '未知'} 响应验证，本次写入按未验证口径处理`);
    }
    if (sourceChanged && hasStoredBars) {
      return {
        allowed: false,
        status: 'provenance-conflict',
        code: 'KLINE_PROVENANCE_CONFLICT',
        reason: `本地K线来源/复权证据不可验证，${switchNote}不能以增量方式覆盖历史，需重建该股完整K线`,
        action: 'rebuild_required', retryable: false,
        storedAdjustment, storedSource, incomingAdjustment: incoming, incomingSource,
      };
    }
    return {
      allowed: true,
      status: storedAdjustment === ADJUSTMENT.UNKNOWN ? 'stored-unverified' : 'stored-adjustment-unverifiable',
      code: '',
      reason: '',
      action: '',
      retryable: false,
      storedAdjustment,
      storedSource,
      incomingSource,
      warning: notices.join('；'),
    };
  }
  if (incoming === ADJUSTMENT.UNKNOWN) {
    return {
      allowed: false,
      status: 'unverified-incoming',
      code: 'KLINE_ADJUSTMENT_UNVERIFIED',
      reason: `本地K线复权口径为${adjustmentLabel(authoritative)}（来源 ${storedSource || '未知'}），本次来源 ${incomingSource || '未知'} 的复权口径无法从响应验证，拒绝混写`,
      action: 'rebuild_required',
      retryable: false,
      storedAdjustment: authoritative,
      storedSource,
      incomingAdjustment: incoming,
      incomingSource,
    };
  }
  if (incoming !== authoritative) {
    return {
      allowed: false,
      status: 'adjustment-conflict',
      code: 'KLINE_ADJUSTMENT_CONFLICT',
      reason: `本地K线复权口径为${adjustmentLabel(authoritative)}（来源 ${storedSource || '未知'}），本次来源 ${incomingSource || '未知'} 返回${adjustmentLabel(incoming)}，口径冲突，拒绝覆盖历史并要求重建该股K线`,
      action: 'rebuild_required',
      retryable: false,
      storedAdjustment: authoritative,
      storedSource,
      incomingAdjustment: incoming,
      incomingSource,
    };
  }
  return {
    allowed: true, status: 'compatible', code: '', reason: '', action: '', retryable: false,
    storedAdjustment: authoritative, storedSource, incomingAdjustment: incoming,
    warning: incomingSource !== storedSource ? `来源切换（${storedSource || '未知'} → ${incomingSource || '未知'}），复权口径一致（${adjustmentLabel(incoming)}）` : '',
  };
}

// 旧序列没有来源证据时，只允许用可验证的完整前复权序列做原子整段替换。
// 新序列不得缩短日期边界或有效交易日数量，避免把局部窗口误当成完整重建。
function canSafelyRebuildUnverifiedSeries({ storedBars = [], incomingBars = [], source = '', adjustmentType = '', decisionStatus = '' } = {}) {
  if (decisionStatus !== 'provenance-missing') return false;
  if (normalizeAdjustment(adjustmentType) !== ADJUSTMENT.QFQ || !isAdjustmentCorroborated(source, adjustmentType)) return false;
  const stored = Array.isArray(storedBars) ? storedBars.filter((bar) => bar && /^\d{4}-\d{2}-\d{2}$/.test(String(bar.date || ''))) : [];
  const incoming = Array.isArray(incomingBars) ? incomingBars.filter((bar) => bar && /^\d{4}-\d{2}-\d{2}$/.test(String(bar.date || ''))) : [];
  if (!stored.length || incoming.length < stored.length) return false;
  const storedDates = stored.map((bar) => String(bar.date)).sort();
  const incomingDates = incoming.map((bar) => String(bar.date)).sort();
  return incomingDates[0] <= storedDates[0] && incomingDates.at(-1) >= storedDates.at(-1);
}

// 只读摘要：供接口/文档/测试核对各源声明，不参与取数。
function describeSourceCapabilities() {
  return SOURCE_IDS.map((id) => {
    const contract = SOURCE_CONTRACTS[id];
    return {
      id,
      label: contract.label,
      endpoint: contract.endpoint,
      adjustmentType: normalizeAdjustment(contract.adjustment && contract.adjustment.declared),
      adjustmentVerifiedFromResponse: Boolean(contract.adjustment && contract.adjustment.verifiedFromResponse),
      adjustmentEvidence: String((contract.adjustment && contract.adjustment.evidence) || ''),
      volumeUnit: contract.volumeUnit,
      volumeScale: contract.volumeScale,
      dateField: contract.dateField,
      fields: { ...contract.fields },
      amountField: contract.amountField,
      covered: contract.covered.slice(),
    };
  });
}

module.exports = {
  ADJUSTMENT,
  ADJUSTMENT_LABEL,
  SOURCE_IDS,
  SOURCE_CONTRACTS,
  adjustmentLabel,
  normalizeAdjustment,
  sourceContract,
  sourceVolumeScale,
  normalizeKlineVolumeByContract,
  resolveSourceAdjustment,
  isAdjustmentCorroborated,
  decideKlineWrite,
  canSafelyRebuildUnverifiedSeries,
  describeSourceCapabilities,
};
