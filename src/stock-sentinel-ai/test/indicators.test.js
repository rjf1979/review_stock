// 指标层合成数据自检（开发期验证，可并入 test 脚本）
const assert = require('assert');
const ind = require('../indicators');

function mk(len, fn) {
  const out = [];
  for (let i = 0; i < len; i++) out.push(fn(i, out));
  return out;
}

// 1) 平盘：价格 10.00，高低固定，成交量 1000 → BOLL 带宽接近 0，percentB 接近 0.5。
const flat = mk(60, () => ({ date: '2026-01-01', open: 10, high: 10.2, low: 9.8, close: 10, volume: 1000, amount: 10000 }));
{
  const b = ind.bollSummary(flat);
  assert.strictEqual(b.boll20.available, true);
  assert.ok(Math.abs(b.boll20.bandwidth) < 0.2, '平盘带宽应接近 0，实际 ' + b.boll20.bandwidth);
  // 零带宽时 percentB 分母为 0，按口径返回 null。
  assert.strictEqual(b.boll20.percentB, null, '平盘零带宽 percentB 应为 null');
  const a = ind.atrSummary(flat);
  assert.strictEqual(a.atr14Pct.available, true);
  // 真实波幅取 0.4（高低差）与相对前收的 0.2 取最大 = 0.4，ATR14Pct ≈ 4%
  assert.ok(a.atr14Pct.value > 3 && a.atr14Pct.value < 5, 'ATR14Pct 应约 4%，实际 ' + a.atr14Pct.value);
  console.log('flat boll', b, 'atr', a);
}

// 2) 上升趋势：连续阳线，OBV 应 rising；ADX 应形成趋势方向 positive。
{
  const up = mk(80, (i) => {
    const close = 10 + i * 0.1;
    const open = close - 0.05;
    return { date: `2026-01-${String(i + 1).padStart(2, '0')}`, open, high: close + 0.05, low: open - 0.03, close, volume: 1000 + i * 10, amount: (1000 + i * 10) * close };
  });
  const o = ind.obvSummary(up);
  assert.strictEqual(o.obv.available, true);
  assert.strictEqual(o.obv.trend, 'rising', '上升趋势 OBV 应为 rising');
  const d = ind.adxSummary(up);
  assert.strictEqual(d.adx14.available, true);
  assert.strictEqual(d.adx14.direction, 'positive', '单边上涨 DI+ 应大于 DI-');
  assert.ok(d.adx14.value > 20, '强趋势 ADX 应 >20，实际 ' + d.adx14.value);
  const v = ind.volumePercentileSummary(up);
  assert.strictEqual(v.volumePercentile.available, true);
  console.log('up obv', o, 'adx', d, 'volpct', v);
}

// 3) 下降趋势：OBV falling，ADX direction negative。
{
  const down = mk(80, (i) => {
    const close = 20 - i * 0.1;
    const open = close + 0.05;
    return { date: `2026-02-${String(i + 1).padStart(2, '0')}`, open, high: open + 0.03, low: close - 0.05, close, volume: 900 - i * 5, amount: (900 - i * 5) * close };
  });
  const o = ind.obvSummary(down);
  assert.strictEqual(o.obv.trend, 'falling');
  const d = ind.adxSummary(down);
  assert.strictEqual(d.adx14.direction, 'negative');
  console.log('down obv', o, 'adx', d);
}

// 4) relativeStrength：共同交易日对齐，个股跑赢基准 → 正值。
{
  const stock = mk(61, (i) => ({ date: `2026-03-${String(i + 1).padStart(2, '0')}`, close: 10 + i * 0.2 }));
  const bench = mk(61, (i) => ({ date: `2026-03-${String(i + 1).padStart(2, '0')}`, close: 10 + i * 0.1 }));
  const rs = ind.relativeStrength(stock, bench, 60);
  assert.ok(rs > 0, '跑赢基准应 >0，实际 ' + rs);
  // 基准错位一天 → 共同样本不足 61 → null。
  const bench2 = mk(61, (i) => ({ date: `2026-03-${String(i).padStart(2, '0')}`, close: 10 + i * 0.1 }));
  assert.strictEqual(ind.relativeStrength(stock, bench2, 60), null);
  console.log('rs', rs);
}

console.log('indicators.test.js 全部通过');
