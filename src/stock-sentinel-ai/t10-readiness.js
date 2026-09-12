// T10 样本成熟度门槛：只判断证据链与观察窗口是否具备初步回放条件，不评价参数或收益。
const WINDOWS = [5, 10, 20];
const REGIME_GROUPS = {
  strong_trend: 'strong',
  range_strong: 'strong',
  rotation: 'medium',
  recovery: 'medium',
  weak: 'weak',
};

function unique(values) {
  return [...new Set(values.map((value) => String(value || '')).filter(Boolean))];
}

function regimeGroup(item = {}) {
  const value = item.marketRegime;
  const status = String(value && typeof value === 'object' ? value.status : value || '');
  return REGIME_GROUPS[status] || 'unknown';
}

function futureTradingDates(sample = {}) {
  return unique((Array.isArray(sample.futureCandles) ? sample.futureCandles : []).map((bar) => bar && bar.date))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)))
    .sort();
}

function assessT10Readiness(samples = [], precheck = {}, options = {}) {
  const rows = Array.isArray(samples) ? samples : [];
  const inputSource = String(options.inputSource || (rows.some((sample) => sample && sample.replayArchive) ? 'selection_archives' : 'unknown'));
  const readyIndexes = new Set(Array.isArray(precheck.readyIndexes) ? precheck.readyIndexes : []);
  const ready = rows.filter((sample, index) => readyIndexes.has(index));
  const chains = {
    inputSource,
    samples: rows.length,
    readySamples: ready.length,
    blockedSamples: Math.max(0, rows.length - ready.length),
    selectionBatches: unique(ready.map((sample) => sample.item && sample.item.selectionBatchId)).length,
    prescanBatches: unique(ready.map((sample) => sample.item && sample.item.prescanBatchId)).length,
    klineArchives: unique(ready.map((sample) => sample.replayArchive && sample.replayArchive.archiveId)).length,
    reviewBatches: unique(ready.map((sample) => sample.replayArchive && sample.replayArchive.reviewBatchId)).length,
  };
  const observationWindows = Object.fromEntries(WINDOWS.map((window) => {
    const mature = ready.filter((sample) => futureTradingDates(sample).length >= window);
    return [String(window), {
      tradingDays: window,
      matureSamples: mature.length,
      matureBatches: unique(mature.map((sample) => sample.item && sample.item.selectionBatchId)).length,
    }];
  }));
  const regimeCoverage = { strong: 0, medium: 0, weak: 0, unknown: 0 };
  for (const sample of ready) regimeCoverage[regimeGroup(sample.item)] += 1;

  const checks = {
    hasArchivedSamples: inputSource === 'selection_archives' && rows.length > 0,
    allSamplesPassedPrecheck: rows.length > 0 && ready.length === rows.length,
    hasMature5DayWindow: observationWindows['5'].matureSamples > 0,
    hasMature10DayWindow: observationWindows['10'].matureSamples > 0,
    hasMature20DayWindow: observationWindows['20'].matureSamples > 0,
    coversStrongMarket: regimeCoverage.strong > 0,
    coversMediumMarket: regimeCoverage.medium > 0,
    coversWeakMarket: regimeCoverage.weak > 0,
  };
  const missing = Object.entries(checks).filter(([, passed]) => !passed).map(([code]) => code);
  return {
    readinessVersion: 't10-readiness-v1',
    status: missing.length ? 'awaiting_samples' : 'ready_for_preliminary_replay',
    scope: 'structural_readiness_only',
    disclaimer: '该状态只表示证据链、观察窗口和市场环境类型具备初步回放条件，不代表样本量达到统计有效性，不输出胜率、收益结论或参数建议。',
    chains,
    observationWindows,
    regimeCoverage,
    checks,
    missing,
  };
}

module.exports = { WINDOWS, REGIME_GROUPS, regimeGroup, futureTradingDates, assessT10Readiness };
