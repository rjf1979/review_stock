# -*- coding: utf-8 -*-
"""
向量化技术指标。

设计：一次 `compute_indicators(bars)` 算出所有指标数组，供全部形态复用，
避免每个形态重复计算（EMA 等递归指标无法向量化，重复算代价很高）。
"""
from __future__ import annotations

import numpy as np


# ---------------- 基础 ---------------- #
def sma(x, n: int) -> np.ndarray:
    x = np.asarray(x, dtype=np.float64)
    out = np.full(len(x), np.nan)
    if len(x) < n or n <= 0:
        return out
    cs = np.cumsum(np.insert(x, 0, 0.0))
    out[n - 1:] = (cs[n:] - cs[:-n]) / n
    return out


def ema(x, n: int) -> np.ndarray:
    x = np.asarray(x, dtype=np.float64)
    out = np.full(len(x), np.nan)
    if len(x) < n or n <= 0:
        return out
    k = 2.0 / (n + 1.0)
    out[n - 1] = np.mean(x[:n])
    # 递归部分用局部变量加速
    prev = out[n - 1]
    for i in range(n, len(x)):
        prev = prev + k * (x[i] - prev)
        out[i] = prev
    return out


def _rma(x, n: int) -> np.ndarray:
    """
    Wilder 平滑（RSI/ATR/KDJ 用）。
    自动跳过前导 NaN —— 否则首个均值被 NaN 污染会导致整条曲线全 NaN。
    """
    x = np.asarray(x, dtype=np.float64)
    N = len(x)
    out = np.full(N, np.nan)
    valid = ~np.isnan(x)
    if N < n or not valid.any():
        return out
    s = int(np.argmax(valid))          # 第一个有效位置
    if N - s < n:
        return out
    k = 1.0 / n
    prev = float(np.mean(x[s:s + n]))
    out[s + n - 1] = prev
    for i in range(s + n, N):
        xi = x[i]
        if np.isnan(xi):               # 中间缺值：沿用上一次
            out[i] = prev
            continue
        prev = prev + k * (xi - prev)
        out[i] = prev
    return out


def rolling_max(x, n: int) -> np.ndarray:
    x = np.asarray(x, dtype=np.float64)
    out = np.full(len(x), np.nan)
    if len(x) < n:
        return out
    w = np.lib.stride_tricks.sliding_window_view(x, n)
    out[n - 1:] = np.nanmax(w, axis=1)
    return out


def rolling_min(x, n: int) -> np.ndarray:
    x = np.asarray(x, dtype=np.float64)
    out = np.full(len(x), np.nan)
    if len(x) < n:
        return out
    w = np.lib.stride_tricks.sliding_window_view(x, n)
    out[n - 1:] = np.nanmin(w, axis=1)
    return out


def shift(x, n: int = 1) -> np.ndarray:
    out = np.full(len(x), np.nan)
    if n < len(x):
        out[n:] = np.asarray(x)[:len(x) - n]
    return out


def cross_up(a, b) -> np.ndarray:
    """a 上穿 b（前一日 a<=b，当日 a>b）"""
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    out = np.zeros(len(a), dtype=bool)
    if len(a) < 2:
        return out
    prev_a, prev_b = a[:-1], b[:-1]
    cur_a, cur_b = a[1:], b[1:]
    ok = ~np.isnan(prev_a) & ~np.isnan(prev_b) & ~np.isnan(cur_a) & ~np.isnan(cur_b)
    out[1:] = ok & (prev_a <= prev_b) & (cur_a > cur_b)
    return out


def cross_down(a, b) -> np.ndarray:
    return cross_up(b, a)


# ---------------- 主要指标 ---------------- #
def macd(close, fast=12, slow=26, signal=9):
    dif = ema(close, fast) - ema(close, slow)
    dea = np.full(len(dif), np.nan)
    valid = ~np.isnan(dif)
    if valid.any():
        s = int(np.argmax(valid))
        dea[s:] = ema(dif[s:], signal)    # 只在有效段上算，避免前导 NaN 污染
    return dif, dea, (dif - dea) * 2


def rsi(close, n=14) -> np.ndarray:
    c = np.asarray(close, dtype=np.float64)
    if len(c) == 0:
        return c.copy()
    d = np.diff(c, prepend=c[0])          # d[0] = 0，避免前导 NaN
    gain = np.where(d > 0, d, 0.0)
    loss = np.where(d < 0, -d, 0.0)
    ag, al = _rma(gain, n), _rma(loss, n)
    rs = ag / np.maximum(al, 1e-12)
    out = 100.0 - 100.0 / (1.0 + rs)
    out[:n - 1] = np.nan
    return out


def kdj(high, low, close, n=9, m1=3, m2=3):
    hh = rolling_max(high, n)
    ll = rolling_min(low, n)
    rng = np.maximum(hh - ll, 1e-9)
    rsv = (close - ll) / rng * 100.0      # 前 n-1 个为 NaN（_rma 会自动跳过）
    k = _rma(rsv, m1)
    d = _rma(k, m2)
    return k, d, 3 * k - 2 * d


def boll(close, n=20, k=2.0):
    mid = sma(close, n)
    sd = np.full(len(close), np.nan)
    c = np.asarray(close, dtype=np.float64)
    if len(c) >= n:
        w = np.lib.stride_tricks.sliding_window_view(c, n)
        sd[n - 1:] = np.std(w, axis=1, ddof=0)
    return mid + k * sd, mid, mid - k * sd


def atr(high, low, close, n=14) -> np.ndarray:
    h = np.asarray(high, dtype=np.float64)
    l = np.asarray(low, dtype=np.float64)
    pc = shift(close, 1)
    tr = np.maximum(h - l, np.maximum(np.abs(h - pc), np.abs(l - pc)))
    tr[0] = h[0] - l[0] if len(h) else np.nan
    return _rma(tr, n)


def cci(high, low, close, n=14) -> np.ndarray:
    """
    CCI（通达信口径）：TP=(H+L+C)/3，CCI=(TP-MA(TP,n))/(0.015*AVEDEV(TP,n))。

    AVEDEV 是窗口内 TP 相对其均值（即 MA(TP,n)）的平均绝对偏差，
    与常见「标准差」写法不同，务必保持 TDX 一致，否则数值对不上行情软件。
    """
    tp = (np.asarray(high, dtype=np.float64)
          + np.asarray(low, dtype=np.float64)
          + np.asarray(close, dtype=np.float64)) / 3.0
    N = len(tp)
    out = np.full(N, np.nan)
    if N < n or n <= 0:
        return out
    ma = sma(tp, n)
    w = np.lib.stride_tricks.sliding_window_view(tp, n)
    mad = np.abs(w - ma[n - 1:][:, None]).mean(axis=1)
    denom = 0.015 * mad
    with np.errstate(divide='ignore', invalid='ignore'):
        out[n - 1:] = np.where(denom > 0, (tp[n - 1:] - ma[n - 1:]) / denom, 0.0)
    return out


def limit_ratio(code: str, name: str = '') -> float:
    """涨跌停比例：创业板/科创板 20%，ST 5%，其余 10%"""
    nm = (name or '').upper()
    if 'ST' in nm:
        return 0.05
    if code.startswith(('30', '68')):
        return 0.20
    if code.startswith(('8', '4', '9')):        # 北交所/B股
        return 0.30 if code.startswith(('8', '4')) else 0.10
    return 0.10


# ---------------- 一次性算全套 ---------------- #
def compute_indicators(bars: np.ndarray, code: str = '', name: str = '') -> dict:
    """输入 BAR_DT 结构化数组，返回指标字典。所有数组与 bars 等长。"""
    o = bars['open'].astype(np.float64)
    h = bars['high'].astype(np.float64)
    l = bars['low'].astype(np.float64)
    c = bars['close'].astype(np.float64)
    v = bars['volume'].astype(np.float64)
    n = len(c)
    # 成交额（元）与换手率：BAR_DT 里就有，但只有部分形态（TurtleTrade）需要。
    # 旧调用方可能传入缺少这些字段的数组，缺失时填 NaN，形态侧自行判空。
    fields = bars.dtype.names or ()
    amount = (bars['amount'].astype(np.float64) if 'amount' in fields
              else np.full(n, np.nan))
    turnover = (bars['turnover'].astype(np.float64) if 'turnover' in fields
                else np.full(n, np.nan))

    prev_c = shift(c, 1)
    with np.errstate(divide='ignore', invalid='ignore'):
        pct = np.where(prev_c > 0, (c - prev_c) / prev_c * 100.0, np.nan)
        amp = np.where(prev_c > 0, (h - l) / prev_c * 100.0, np.nan)
    body = np.abs(c - o)
    upper = h - np.maximum(o, c)          # 上影
    lower = np.minimum(o, c) - l          # 下影

    lr = limit_ratio(code, name) * 100.0
    # 涨停/跌停（四舍五入到分位，容忍 0.5% 误差）
    is_yang = c > o
    is_up = np.zeros(n, dtype=bool)
    is_down = np.zeros(n, dtype=bool)
    if n > 1:
        is_up[1:] = (pct[1:] >= lr - 0.8) & (c[1:] >= h[1:] - 1e-9)
        is_down[1:] = (pct[1:] <= -(lr - 0.8)) & (c[1:] <= l[1:] + 1e-9)

    dif, dea, hist = macd(c)
    k, d, j = kdj(h, l, c)
    bu, bm, bl = boll(c)

    return {
        'open': o, 'high': h, 'low': l, 'close': c, 'volume': v,
        'amount': amount, 'turnover': turnover,
        'prev_close': prev_c, 'pct': pct, 'amp': amp,
        'body': body, 'upper': upper, 'lower': lower, 'is_yang': is_yang,
        'is_limit_up': is_up, 'is_limit_down': is_down,
        'ma5': sma(c, 5), 'ma10': sma(c, 10), 'ma20': sma(c, 20),
        'ma30': sma(c, 30), 'ma60': sma(c, 60), 'ma120': sma(c, 120),
        'vma5': sma(v, 5), 'vma10': sma(v, 10), 'vma20': sma(v, 20),
        'vma60': sma(v, 60),
        'dif': dif, 'dea': dea, 'hist': hist,
        'rsi6': rsi(c, 6), 'rsi14': rsi(c, 14),
        'k': k, 'd': d, 'j': j,
        'boll_up': bu, 'boll_mid': bm, 'boll_low': bl,
        'atr14': atr(h, l, c, 14),
        'hh20': rolling_max(h, 20), 'll20': rolling_min(l, 20),
        'hh60': rolling_max(h, 60), 'll60': rolling_min(l, 60),
        'hh120': rolling_max(h, 120), 'll120': rolling_min(l, 120),
    }
