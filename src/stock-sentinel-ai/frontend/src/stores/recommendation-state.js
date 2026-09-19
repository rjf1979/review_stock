// 复核结论失效的原因判定：三种原因的处理方式完全不同，界面与复核流程必须共用同一套判定，
// 否则会出现「点了重新严格复核却永远停在同一结论」的假死状态。

// 入池时点的行情快照已过期：重新严格复核无法恢复，只能重新扫描刷新行情或移除候选。
export const isQuoteExpiredRecommendation = (recommendation) => Boolean(recommendation
  && recommendation.validity
  && recommendation.validity.current === false
  && (recommendation.validity.reasons || []).some((reason) => String(reason).includes('过期')));

// 本地 K 线的来源或前复权口径不可核对（补齐时退化到无法验证口径的来源）。
// 这一类可被修复：补齐流程会按可验证来源（腾讯前复权）整段重取该票序列。
export const KLINE_META_UNVERIFIED_REASONS = ['K线前复权口径未验证', 'K线来源证据缺失'];
export const isKlineMetaUnverifiedRecommendation = (recommendation) => Boolean(recommendation
  && recommendation.validity
  && recommendation.validity.current === false
  && (recommendation.validity.reasons || []).some((reason) => KLINE_META_UNVERIFIED_REASONS.includes(String(reason))));
