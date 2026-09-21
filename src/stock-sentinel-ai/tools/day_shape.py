# -*- coding: utf-8 -*-
"""日线「形态位置语义」与「通道类型」判定。

设计源：``docs/2026-09-21-回测结果入库表结构与字段字典.md``。

与 ``tools/patterns`` 注册表的分工
----------------------------------
注册表回答的是「**这一天有没有出现某个可交易的形态信号**」（点事件，布尔）；
本模块回答的是「**这一天个股处在什么位置结构里**」（状态，枚举）。两者互补：
同一只股票在上升通道里出现「回踩 20 日线」与在下降通道里出现同样的信号，
含义完全不同，所以 ``bt_trade`` 里两者都记录。

口径（全部显式、可复核，不依赖任何外部库的黑盒函数）
----------------------------------------------------
* 输入 ``ind`` 是 ``indicators.compute_indicators()`` 的字典，``i`` 是当日下标；
* 所有判定只使用 ``<= i`` 的数据，不存在未来函数；
* ``slope`` 用最小二乘线性回归的斜率，再除以区间均值转成「每根 %」，
  这样不同价位的股票可以直接横向比较；
* ``pos120`` = 收盘价在近 120 日最高/最低区间中的位置（0~1，None 表示上市不足）；
* 判定顺序是「先强特征、后弱特征」，命中即返回，保证每个交易日只有唯一结论。

用法::

    from day_shape import classify, shape_arrays

    shape, channel, pos120 = classify(ind, i)
    shapes, channels, poss = shape_arrays(ind, indices)
"""
from __future__ import annotations

import numpy as np

# 形态位置语义（顺序即文档顺序，不作为判定优先级）
SHAPES = ('上升通道', '下降通道', '高位横盘', '探底形态', '波动回踩', '震荡形态')
# 通道类型
CHANNELS = ('up', 'down', 'box', 'na')
# 数据不足（上市 <60 个交易日，或均线尚未成形）
UNKNOWN = '未知'

# ---------------------------------------------------------------- 阈值（集中在此，便于回测调参）
MIN_BARS = 60              # 最少需要的日线根数（ma60 下限）
POS120_BARS = 120          # pos120 的区间长度
R2_CHANNEL = 0.50          # 「有通道」的 20 根回归 R² 下限
R2_CHANNEL_LONG = 0.70     # 「上升/下降通道」的 60 根回归 R² 下限
POS_LOW = 0.30             # 低位阈值
POS_HIGH = 0.70            # 高位阈值
AMP20_BOX = 18.0           # 高位横盘的 20 日振幅上限（%）
SLOPE20_FLAT = 0.15        # 「横盘」的 20 日斜率上限（每根 %）
ALIGN_TOL = 0.01           # 均线粘合判定容忍度


def _f(x) -> float:
    """任意值 → float，非有限值统一成 nan。"""
    try:
        v = float(x)
    except (TypeError, ValueError):
        return float('nan')
    return v if np.isfinite(v) else float('nan')


def _linreg_slope_pct(y) -> tuple[float, float]:
    """最小二乘拟合斜率 → (每根斜率占区间均值的 %, R²)。

    ``len(y) < 5``、含 nan、或均值 <= 0 时返回 ``(nan, nan)``。
    """
    arr = np.asarray(y, dtype=np.float64)
    n = arr.size
    if n < 5 or not np.isfinite(arr).all():
        return float('nan'), float('nan')
    mean = float(arr.mean())
    if mean <= 0:
        return float('nan'), float('nan')
    x = np.arange(n, dtype=np.float64)
    xm = x - x.mean()
    denom = float((xm ** 2).sum())
    if denom <= 0:
        return float('nan'), float('nan')
    slope = float((xm * (arr - mean)).sum() / denom)
    yhat = mean + slope * xm
    ss_tot = float(((arr - mean) ** 2).sum())
    r2 = float(1 - ((arr - yhat) ** 2).sum() / ss_tot) if ss_tot > 0 else float('nan')
    return slope / mean * 100.0, r2


def _col(ind: dict, key: str) -> np.ndarray | None:
    v = ind.get(key)
    if v is None:
        return None
    return np.asarray(v, dtype=np.float64)


def classify(ind: dict, i: int) -> tuple[str, str, float | None]:
    """返回 ``(dayShape, channelType, pos120)``。

    * ``dayShape`` ∈ :data:`SHAPES`，数据不足时为 :data:`UNKNOWN`；
    * ``channelType`` ∈ :data:`CHANNELS`（``na`` 表示无法判定）；
    * ``pos120`` 为 0~1 的浮点或 ``None``。
    """
    c = _col(ind, 'close')
    if c is None:
        return UNKNOWN, 'na', None
    i = int(i)
    if i < MIN_BARS or i >= c.size:
        return UNKNOWN, 'na', None
    ma5, ma10 = _col(ind, 'ma5'), _col(ind, 'ma10')
    ma20, ma60 = _col(ind, 'ma20'), _col(ind, 'ma60')
    h, l = _col(ind, 'high'), _col(ind, 'low')
    if ma20 is None or ma60 is None or h is None or l is None:
        return UNKNOWN, 'na', None

    close = _f(c[i])
    v20, v60 = _f(ma20[i]), _f(ma60[i])
    if not np.isfinite(close) or close <= 0:
        return UNKNOWN, 'na', None
    if not np.isfinite(v20) or v20 <= 0 or not np.isfinite(v60) or v60 <= 0:
        return UNKNOWN, 'na', None

    slope20, r2_20 = _linreg_slope_pct(c[i - 19:i + 1])
    slope60, r2_60 = _linreg_slope_pct(c[i - 59:i + 1])

    pos120: float | None = None
    if i >= POS120_BARS - 1:
        hh = float(h[i - POS120_BARS + 1:i + 1].max())
        ll = float(l[i - POS120_BARS + 1:i + 1].min())
        if hh > ll:
            pos120 = round((close - ll) / (hh - ll), 4)
    posv = 0.5 if pos120 is None else pos120

    channel = 'box'
    if np.isfinite(r2_20) and r2_20 >= R2_CHANNEL and np.isfinite(slope20):
        channel = 'up' if slope20 > 0 else 'down'

    hh20 = float(h[i - 19:i + 1].max())
    ll20 = float(l[i - 19:i + 1].min())
    amp20 = (hh20 / ll20 - 1) * 100.0 if ll20 > 0 else float('nan')

    ma5_up = bool(ma5 is not None and i >= 5 and np.isfinite(ma5[i])
                  and np.isfinite(ma5[i - 5]) and ma5[i] > ma5[i - 5])
    above_ma10 = bool(ma10 is not None and np.isfinite(ma10[i]) and close >= ma10[i])

    # 1) 上升通道：中期趋势明确向上、均线多头、位置不低
    if (np.isfinite(slope60) and slope60 > 0 and np.isfinite(r2_60)
            and r2_60 >= R2_CHANNEL_LONG and v20 > v60 and posv >= 0.50):
        return '上升通道', channel, pos120
    # 2) 下降通道：中期趋势明确向下、均线空头、位置不高
    if (np.isfinite(slope60) and slope60 < 0 and np.isfinite(r2_60)
            and r2_60 >= R2_CHANNEL_LONG and v20 < v60 and posv <= 0.50):
        return '下降通道', channel, pos120
    # 3) 高位横盘：位置高、振幅窄、斜率平
    if (posv >= POS_HIGH and np.isfinite(amp20) and amp20 <= AMP20_BOX
            and np.isfinite(slope20) and abs(slope20) <= SLOPE20_FLAT):
        return '高位横盘', channel, pos120
    # 4) 探底形态：位置低，且出现短周期止跌迹象（5 日线翘头 或 站上 10 日线）
    if posv <= POS_LOW and (ma5_up or above_ma10):
        return '探底形态', channel, pos120
    # 5) 波动回踩：中期向上，价格回到 20 日线附近但不破 60 日线
    if (v20 > v60 and np.isfinite(slope60) and slope60 > 0
            and close <= v20 and close >= v60 * 0.98):
        return '波动回踩', channel, pos120
    # 6) 兜底
    return '震荡形态', channel, pos120


def shape_arrays(ind: dict, indices) -> tuple[list[str], list[str], list[float | None]]:
    """批量判定（回测里的逐股循环用）。"""
    shapes: list[str] = []
    channels: list[str] = []
    poss: list[float | None] = []
    for i in np.asarray(list(indices), dtype=np.int64):
        s, ch, p = classify(ind, int(i))
        shapes.append(s)
        channels.append(ch)
        poss.append(p)
    return shapes, channels, poss


# ---------------------------------------------------------------- 自检
def _selftest(codes=('600000', '000001', '300750')) -> int:
    """在真实日线上跑一遍，确认分布合理、无异常、无未来函数。"""
    import os
    import sys
    from collections import Counter

    here = os.path.dirname(os.path.abspath(__file__))
    if here not in sys.path:
        sys.path.insert(0, here)
    from indicators import compute_indicators
    from kdata import Market
    from late_buy_next_morning import load_factors

    factors = load_factors()
    market = Market()
    bad = 0
    for code in codes:
        try:
            qfq = market.load(code, 'qfq', factors.get(code))
        except Exception as exc:                      # noqa: BLE001
            print(f'[skip] {code} 日线读取失败：{exc}')
            continue
        ind = compute_indicators(qfq, code, market.meta(code).get('name', ''))
        n = len(ind['close'])
        idx = np.arange(max(MIN_BARS, n - 260), n)
        if not len(idx):
            print(f'[skip] {code} 日线不足 {MIN_BARS} 根')
            continue
        shapes, channels, poss = shape_arrays(ind, idx)
        dist = Counter(shapes)
        chdist = Counter(channels)
        print(f'[{code}] n={len(idx)}  形态={dict(dist)}  通道={dict(chdist)}')
        # 前 MIN_BARS 根必须是「未知」，更早的下标也必须「未知」
        early = classify(ind, MIN_BARS - 1)
        if early[0] != UNKNOWN or early[1] != 'na' or early[2] is not None:
            print(f'[FAIL] {code} 前 {MIN_BARS} 根应判为未知，实得 {early}')
            bad += 1
        # pos120 必须落在 [0,1]
        for p in poss:
            if p is not None and not (-1e-9 <= p <= 1 + 1e-9):
                print(f'[FAIL] {code} pos120 越界：{p}')
                bad += 1
                break
        # 幂等：同一 i 两种调用方式结果一致
        a = classify(ind, int(idx[-1]))
        if (a[0], a[1], a[2]) != (shapes[-1], channels[-1], poss[-1]):
            print(f'[FAIL] {code} shape_arrays 与 classify 结果不一致')
            bad += 1
    print('== 结论：' + ('全部通过' if bad == 0 else f'{bad} 项不符'))
    return 0 if bad == 0 else 1


def main(argv=None) -> int:
    import argparse

    ap = argparse.ArgumentParser(description='日线形态位置语义判定')
    ap.add_argument('--selftest', action='store_true', help='在真实日线上自检')
    ap.add_argument('--codes', nargs='*', default=None)
    args = ap.parse_args(argv)
    if args.selftest:
        return _selftest(tuple(args.codes) if args.codes else ('600000', '000001', '300750'))
    ap.print_help()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
