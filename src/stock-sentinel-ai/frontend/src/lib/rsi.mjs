// 智诊盯盘 · 前端指标计算（纯函数，无 DOM、无框架依赖）。
//
// 副图必须画「后端选股实际使用的那一个 RSI」：口径一旦分叉，图上看到的拐头和
// 选股/回测结果就会互相矛盾，形态自查失去意义。因此这里的 Wilder RSI 与
// screener-core.js 的 rsi()/rsiLowTurnEvidence() 保持逐行同口径，
// 并由 test/rsi-chart-parity.test.js 用同一份 K 线逐点比对前后端实现。

// Wilder 平滑 RSI：与 screener-core.js rsi() 一致 —— 前 period 个涨跌幅取简单均值做种子，
// 其后按 (prev*(n-1)+cur)/n 平滑；样本不足 period 根时返回 null，不用 0 顶替。
export function wilderRsi(candles, period = 14) {
  const list = Array.isArray(candles) ? candles : [];
  const n = Number(period) || 14;
  const closes = list.map((c) => (c ? c.close : undefined));
  const out = new Array(closes.length).fill(null);
  let gain = 0;
  let loss = 0;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const g = Math.max(ch, 0);
    const l = Math.max(-ch, 0);
    if (i <= n) {
      gain += g;
      loss += l;
      if (i === n) {
        avgGain = gain / n;
        avgLoss = loss / n;
        out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
      }
    } else {
      avgGain = (avgGain * (n - 1) + g) / n;
      avgLoss = (avgLoss * (n - 1) + l) / n;
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
  }
  return out;
}

// rsi_low_turn v4 扫描：返回整条 RSI 序列 + 低位拐头点（turns）+ 完整命中点（hits）。
// 判定与 screener-core.js rsiLowTurnEvidence()/patterns.rsi_low_turn 一致：
//   拐头 = 前值 < low 且当前值 > 前值；命中 = 拐头 + 样本量足 + 前期跌幅 ≤ drop_max。
// 母样本量不足时不产出命中，避免图上标出后端不会认的信号。
export function rsiLowTurnScan(candles, params = {}) {
  const arr = Array.isArray(candles) ? candles : [];
  const period = Math.max(2, Math.round(Number(params.period) || 14));
  const low = Number.isFinite(Number(params.low)) ? Number(params.low) : 30;
  const dropDays = Number.isFinite(Number(params.drop_days)) ? Math.round(Number(params.drop_days)) : 0;
  const dropMax = Number.isFinite(Number(params.drop_max)) ? Number(params.drop_max) : null;
  const needDrop = dropDays > 0 && dropMax != null;
  const minBars = Math.max(30, period + 2, needDrop ? dropDays + 1 : 0);
  const values = wilderRsi(arr, period);
  const turns = [];
  const hits = [];
  for (let i = 1; i < arr.length; i++) {
    const cur = Number(values[i]);
    const prev = Number(values[i - 1]);
    if (!Number.isFinite(cur) || !Number.isFinite(prev)) continue;
    if (!(prev < low && cur > prev)) continue;
    let dropPct = null;
    if (needDrop && i - dropDays >= 0) {
      const base = Number(arr[i - dropDays] && arr[i - dropDays].close);
      const nowClose = Number(arr[i] && arr[i].close);
      if (base > 0 && Number.isFinite(nowClose)) dropPct = (nowClose / base - 1) * 100;
    }
    const point = { index: i, date: String((arr[i] && arr[i].date) || ''), rsi: cur, prevRsi: prev, dropPct };
    turns.push(point);
    // 样本量按「截至信号日」计（i+1 根），与后端把 K 线截到信号日再判定完全一致。
    if (i + 1 >= minBars && (!needDrop || (dropPct != null && dropPct <= dropMax))) hits.push(point);
  }
  const latestIndex = arr.length - 1;
  return {
    period, low, dropDays, dropMax, needDrop, minBars,
    values,
    turns,
    hits,
    latest: latestIndex >= 0 ? values[latestIndex] : null,
    latestPrev: latestIndex >= 1 ? values[latestIndex - 1] : null,
  };
}

// RSI 所处区间文案：与副图红线（low 超卖阈值）和 70 高位线保持同一套话术。
export function rsiZoneLabel(value, low = 30) {
  // Number(null) === 0，会把「没有样本」误判成「极度超卖」，先显式挡掉空值。
  if (value === null || value === undefined || value === '') return 'RSI 未形成';
  const v = Number(value);
  const threshold = Number.isFinite(Number(low)) ? Number(low) : 30;
  if (!Number.isFinite(v)) return 'RSI 未形成';
  if (v < threshold) return `超卖区（<${threshold}）`;
  if (v >= 70) return '高位区（≥70）';
  if (v >= 50) return '中性偏强';
  return '中性偏弱';
}
