// 全市场扫描的市场环境与策略层。只处理已验证的快照/指数数据，保持无网络、可测试。

const REGIMES = {
  strong_trend: { label: '强势主升', strategyLabel: '突破与趋势跟随', ruleIds: ['volume_breakout', 'platform_breakout', 'box_breakout', 'ascending_triangle', 'n_shape', 'strong_sideways'] },
  range_strong: { label: '震荡偏强', strategyLabel: '回踩确认与趋势转强', ruleIds: ['pullback_ma20', 'ma_bullish', 'ma_golden_start', 'limit_pullback', 'second_test'] },
  rotation: { label: '轮动震荡', strategyLabel: '板块轮动与低位启动', ruleIds: ['ma_golden_start', 'yang_engulf', 'platform_breakout'] },
  recovery: { label: '恐慌修复', strategyLabel: '超跌修复与反包确认', ruleIds: ['fake_break_pack', 'long_lower_shadow', 'double_bottom', 'second_test', 'rsi_low_turn'] },
  weak: { label: '弱势退潮', strategyLabel: '防守观察，降低自动入池', ruleIds: ['dry_price_bottom', 'shrink_stabilize'] },
};

function finite(value) { return Number.isFinite(Number(value)) ? Number(value) : null; }
function ratio(part, total) { return total > 0 ? part / total : null; }

function summarizeSnapshot(records) {
  const rows = Array.isArray(records) ? records.filter((r) => r && finite(r.price) != null) : [];
  if (rows.length < 1000) {
    return { available: false, total: rows.length, reason: '有效股票少于 1,000，只能展示快照，不能计算全市场广度' };
  }
  let advanceCount = 0; let declineCount = 0; let flatCount = 0; let strongCount = 0; let weakCount = 0; let amount = 0;
  for (const row of rows) {
    const pct = finite(row.changePct) || 0;
    if (pct > 0) advanceCount++; else if (pct < 0) declineCount++; else flatCount++;
    if (pct >= 5) strongCount++;
    if (pct <= -5) weakCount++;
    amount += finite(row.amount) || 0;
  }
  return {
    available: true,
    total: rows.length,
    advanceCount,
    declineCount,
    flatCount,
    upRatio: ratio(advanceCount, rows.length),
    downRatio: ratio(declineCount, rows.length),
    strongPct: ratio(strongCount, rows.length),
    weakPct: ratio(weakCount, rows.length),
    amountYi: Math.round(amount / 1e8),
  };
}

function classifyMarketRegime({ breadth, indices = [], asOf = '', limitStructure = null } = {}) {
  const b = breadth && breadth.available ? breadth : null;
  const validIndices = (Array.isArray(indices) ? indices : []).filter((x) => finite(x.changePct) != null);
  const indexMean = validIndices.length ? validIndices.reduce((sum, x) => sum + Number(x.changePct), 0) / validIndices.length : null;
  const ls = limitStructure && limitStructure.available ? limitStructure : null;
  const board2Plus = ls ? Object.entries(ls.heightDistribution || {}).reduce((sum, [height, count]) => sum + (Number(height) >= 2 ? Number(count) || 0 : 0), 0) : 0;
  const sentimentRisk = !!(ls && (ls.limitDownCount >= 20 || (ls.sealRate != null && ls.sealRate < 0.55) || (ls.limitUpCount <= 25 && ls.maxBoardHeight <= 2)));
  const sentimentStrong = !!(ls && ls.limitUpCount >= 60 && ls.sealRate >= 0.75 && ls.maxBoardHeight >= 3 && board2Plus >= 5);
  let status = 'rotation';
  if (!b) status = 'rotation';
  else if (sentimentRisk || b.downRatio >= 0.62 || b.weakPct >= 0.035 || (indexMean != null && indexMean <= -1.2)) status = 'weak';
  else if ((!ls || sentimentStrong) && b.upRatio >= 0.6 && b.strongPct >= 0.03 && (indexMean == null || indexMean >= 0.3)) status = 'strong_trend';
  else if (b.upRatio >= 0.55 && b.downRatio < 0.48 && (indexMean == null || indexMean >= -0.25)) status = 'range_strong';
  else if (b.weakPct >= 0.018 && b.upRatio >= 0.43 && (indexMean == null || indexMean > -0.8) && (!ls || ls.sealRate == null || ls.sealRate >= 0.6)) status = 'recovery';
  const missing = !b || !validIndices.length || !ls || !(ls.quality && ls.quality.complete);
  const confidence = !b ? 'unavailable' : (missing ? 'partial' : 'confirmed');
  return {
    status,
    label: REGIMES[status].label,
    confidence,
    asOf: String(asOf || ''),
    evidence: {
      breadth: b || { available: false, reason: breadth && breadth.reason ? breadth.reason : '快照不可用' },
      indices: validIndices,
      limitStructure: ls || { available: false, reason: limitStructure && limitStructure.reason ? limitStructure.reason : '涨跌停与炸板结构不可用' },
    },
    fallback: !b ? { reason: '市场快照不完整，策略按中性轮动模式降级', mode: 'all_market_fallback' } : null,
  };
}

function strategyForRegime(status, enabledRules) {
  const regime = REGIMES[status] || REGIMES.rotation;
  const enabled = Array.isArray(enabledRules) ? enabledRules.filter((r) => r && r.enabled !== false) : [];
  const selected = enabled.filter((r) => regime.ruleIds.includes(r.id));
  // 规则配置被用户调整时，保持可解释性：没有可用映射就回退至所有启用规则。
  const active = selected.length ? selected : enabled;
  return {
    label: regime.strategyLabel,
    enabledRuleIds: active.map((r) => r.id),
    deprioritizedRuleIds: enabled.filter((r) => !active.some((x) => x.id === r.id)).map((r) => r.id),
    fallback: !selected.length && enabled.length > 0,
  };
}

function riskFlagsForCandidate(profile, context = {}) {
  const flags = [];
  const pct = finite(profile && profile.changePct);
  const mainNet = finite(profile && profile.mainNetYi);
  const vr = finite(profile && profile.volumeRatio);
  if (pct != null && pct >= 8) flags.push({ key: 'extended_gain', label: '当日涨幅偏高，留意追高风险' });
  if (pct != null && pct > 0 && mainNet != null && mainNet < 0) flags.push({ key: 'flow_divergence', label: '上涨但主力净流出' });
  if (vr != null && vr < 1) flags.push({ key: 'low_volume_ratio', label: '量比不足 1，量能未确认' });
  if (context.marketStatus === 'weak') flags.push({ key: 'weak_market', label: '市场处于弱势退潮，仅作防守观察' });
  const ls = context.limitStructure;
  if (ls && ls.available && ls.sealRate != null && ls.sealRate < 0.6) flags.push({ key: 'low_seal_rate', label: '市场封板率偏低，突破延续风险较高' });
  return flags;
}

module.exports = { REGIMES, summarizeSnapshot, classifyMarketRegime, strategyForRegime, riskFlagsForCandidate };
