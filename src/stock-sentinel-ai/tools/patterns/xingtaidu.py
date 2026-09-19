# -*- coding: utf-8 -*-
"""
量价形态选股图谱（25 个形态）—— 来源 docs/xingtaidu-patterns.md

每个形态函数签名:  fn(ind: dict, p: dict) -> np.ndarray[bool]
  ind —— indicators.compute_indicators() 的指标字典
  返回 —— 与 K 线等长的 bool 数组，True = 该 bar **收盘后**形态成立

约定：信号在下一根 K 线开盘成交（由回测引擎保证），杜绝未来函数。
复杂窗口形态采用「预筛 + 候选点循环」实现，兼顾正确性与性能。
"""
from __future__ import annotations

import numpy as np

from indicators import cross_up, rolling_max, rolling_min, sma
from . import register

# 便捷别名
def _nan(x):
    return np.asarray(x, dtype=np.float64)


def _win(a, n):
    """滑动窗口视图，shape (len-n+1, n)"""
    return np.lib.stride_tricks.sliding_window_view(np.asarray(a, dtype=np.float64), n)


def _vol_ok(ind, mult, n=5):
    """量能 ≥ n 日均量 × mult"""
    vma = ind['vma5'] if n == 5 else ind['vma20']
    return ind['volume'] > vma * mult


def _ret_pct(c, n):
    """近 n 日涨跌幅（%）。前 n 根无参照 → NaN。"""
    c = np.asarray(c, dtype=np.float64)
    ref = np.full(len(c), np.nan)
    if len(c) > n:
        ref[n:] = c[:-n]
    with np.errstate(invalid='ignore', divide='ignore'):
        return (c / ref - 1.0) * 100.0


def _ctx_filter(sig, ind, p):
    """
    可选的信号上下文过滤（**默认全部关闭**：参数缺省时返回原信号，
    因此 v2 基线与旧口径的形态命中集合完全不变）。

    四个维度（都由调用方按形态显式传参，通常走回测的 --config params）：

    * 前期跌幅 ``drop_days`` / ``drop_max``：要求近 drop_days 日涨跌幅 ≤ drop_max(%)，
      即「先跌够了」，用于底部/承接类形态。
    * 相对强度 ``rs_days`` / ``rs_min`` / ``rs_max``：要求「个股近 rs_days 日涨幅
      − 沪深300 同期涨幅」落在 [rs_min, rs_max]（百分点，可只给一侧；rs_max 用负值
      表示「要求相对走弱」）。基准序列由回测引擎注入 ``ind['bench_close']``
      （与个股 K 线按日期对齐）；基准缺失时该项自动不生效。
    * 量能 ``vol_ref``(默认20) / ``vol_min`` / ``vol_max``：要求触发日
      ``volume / vma{vol_ref}`` 落在区间内（缩量用 vol_max，放量确认用 vol_min）。
    * 大盘环境 ``bench_ma_days`` / ``bench_ma_mode``：要求信号当日基准指数收盘价
      相对其 ``bench_ma_days`` 日均线在指定一侧（``above`` 默认 = 指数在均线上方，
      用于只做"大盘不在下跌段"里的信号；``below`` 反之）。基准序列由回测引擎注入
      ``ind['bench_close']``（与个股 K 线按日期对齐）；基准缺失时该项自动不生效。

    数据均取自信号 bar 及其之前，不含未来信息；无法计算（NaN）时该项放行，
    避免因数据长度不足静默丢弃信号。
    """
    sig = np.asarray(sig, dtype=bool)
    c = ind['close']

    d = p.get('drop_days')
    if d and p.get('drop_max') is not None:
        r = _ret_pct(c, int(d))
        sig = sig & (~np.isfinite(r) | (r <= float(p['drop_max'])))

    rd = p.get('rs_days')
    if rd and (p.get('rs_min') is not None or p.get('rs_max') is not None) \
            and ind.get('bench_close') is not None:
        b = np.asarray(ind['bench_close'], dtype=np.float64)
        if len(b) == len(c):
            rs = _ret_pct(c, int(rd)) - _ret_pct(b, int(rd))
            ok = np.isfinite(rs)
            if p.get('rs_min') is not None:
                ok = ok & (rs >= float(p['rs_min']))
            if p.get('rs_max') is not None:
                ok = ok & (rs <= float(p['rs_max']))
            sig = sig & ok

    if p.get('vol_min') is not None or p.get('vol_max') is not None:
        vma = ind.get(f"vma{int(p.get('vol_ref', 20))}")
        if vma is not None:
            with np.errstate(invalid='ignore', divide='ignore'):
                ratio = ind['volume'] / np.asarray(vma, dtype=np.float64)
            ok = np.isfinite(ratio)
            if p.get('vol_min') is not None:
                ok = ok & (ratio >= float(p['vol_min']))
            if p.get('vol_max') is not None:
                ok = ok & (ratio <= float(p['vol_max']))
            sig = sig & ok

    bmd = p.get('bench_ma_days')
    if bmd and ind.get('bench_close') is not None:
        b = np.asarray(ind['bench_close'], dtype=np.float64)
        if len(b) == len(c):
            finite = np.isfinite(b)
            if finite.any():
                # 基准序列在个股上市早期可能整段缺失，先用首个有效值前向填充，
                # 否则 cumsum 会把均线整条 NaNs 化，过滤条件静默失效。
                b = b.copy()
                b[:int(np.argmax(finite))] = b[finite][0]
                bma = sma(b, int(bmd))
                mode = str(p.get('bench_ma_mode') or 'above')
                ok = ~np.isfinite(bma)
                if mode == 'below':
                    ok = ok | (b <= bma)
                else:
                    ok = ok | (b >= bma)
                sig = sig & ok
    return sig


# ==================================================================== #
#  第 1 图：均线启动类
# ==================================================================== #
@register('ma_bullish', '均线多头', '均线启动类',
          {'diverge_days': 5},
          'MA5>MA10>MA20 且近 N 日向上发散')
def ma_bullish(ind, p):
    ma5, ma10, ma20 = ind['ma5'], ind['ma10'], ind['ma20']
    base = (ma5 > ma10) & (ma10 > ma20)
    d = p['diverge_days']
    sa5 = np.lib.stride_tricks.sliding_window_view(ma5, d)
    up = np.full(len(ma5), False)
    if len(ma5) >= d:
        up[d - 1:] = np.all(np.diff(sa5, axis=1) > 0, axis=1)
    return _ctx_filter(base & up & (ma20 > ind['ma60']), ind, p)


@register('pullback_ma20', '回踩20日线', '均线启动类',
          {'gain': 5.0, 'vol_shrink': 0.8},
          '近20日涨幅>N%、收在MA20上、回踩缩量、末根企稳')
def pullback_ma20(ind, p):
    c, ma20, v, vma20 = ind['close'], ind['ma20'], ind['volume'], ind['vma20']
    gain20 = (c / np.maximum(_nan(np.roll(c, 20)), 1e-9) - 1) * 100
    gain20[:20] = np.nan
    touched = ind['low'] <= ma20 * 1.02          # 曾回踩到 MA20 附近
    hold = c > ma20                               # 收在 MA20 上方
    shrink = v < vma20 * p['vol_shrink']
    stable = ind['close'] >= ind['open']          # 末根企稳（收≥开）
    return (gain20 > p['gain']) & touched & hold & shrink & stable


@register('ma_golden_start', '金叉启动', '均线启动类',
          {'vol_mult': 1.5},
          'MA5 上穿 MA20 且 MA20>MA60，放量')
def ma_golden_start(ind, p):
    return cross_up(ind['ma5'], ind['ma20']) & (ind['ma20'] > ind['ma60']) \
        & _vol_ok(ind, p['vol_mult'])


@register('trendline_breakout', '趋势线突破', '均线启动类',
          {'window': 40, 'vol_mult': 1.3},
          '突破下降趋势线（近段低点最小二乘）且放量')
def trendline_breakout(ind, p):
    n = p['window']
    c, v = ind['close'], ind['volume']
    N = len(c)
    out = np.zeros(N, dtype=bool)
    if N < n:
        return out
    lows = _win(ind['low'], n)
    x = np.arange(n, dtype=np.float64)
    xm = x - x.mean()
    denom = (xm ** 2).sum()
    slopes = (lows * xm).sum(axis=1) / denom
    # 趋势线在窗口末端的值
    line = lows.mean(axis=1) + slopes * (n - 1 - x.mean())
    start = np.arange(n - 1, N)
    down = slopes < 0                              # 必须是下降趋势线
    prev_c = np.roll(c, 1)
    idx = start                                    # 窗口结束位置（数组索引）
    out[idx] = down & (c[idx] > line) & (prev_c[idx] <= line) \
        & (v[idx] > ind['vma5'][idx] * p['vol_mult'])
    return out


@register('macd_water_golden', 'MACD水上金叉', '均线启动类',
          {'vol_mult': 1.2},
          'DIF>0 且 DEA>0，DIF 上穿 DEA，放量')
def macd_water_golden(ind, p):
    return (ind['dif'] > 0) & (ind['dea'] > 0) \
        & cross_up(ind['dif'], ind['dea']) & _vol_ok(ind, p['vol_mult'])


# ==================================================================== #
#  第 2 图：量价共振类
# ==================================================================== #
@register('volume_breakout', '放量突破', '量价共振类',
          {'window': 20, 'vol_mult': 1.5},
          '收盘创 N 日新高且量能≥5日均量×M')
def volume_breakout(ind, p):
    n = p['window']
    prev_hh = np.roll(ind['hh20'] if n == 20 else
                      np.concatenate([[np.nan] * (n - 1),
                                      np.nanmax(_win(ind['high'], n), axis=1)]), 1)
    return (ind['close'] > prev_hh) & _vol_ok(ind, p['vol_mult'])


@register('shrink_stabilize', '缩量企稳', '量价共振类',
          {'days': 8, 'ratio': 0.8, 'flat': 8.0},
          '近 N 日量 < 20日均量×R 且横盘，末根放量阳线')
def shrink_stabilize(ind, p):
    d, r, flat = p['days'], p['ratio'], p['flat']
    v, vma20, c, o = ind['volume'], ind['vma20'], ind['close'], ind['open']
    N = len(c)
    out = np.zeros(N, dtype=bool)
    if N < d + 1:
        return out
    # 窗口取「不含当前 bar」的前 d 日；bar i 对应窗口索引 j = i-d（该窗口结束于 i-1）
    wv = _win(v, d)
    wc = _win(c, d)
    shrunk = np.all(wv < (vma20[d - 1:] * r)[:, None], axis=1)
    rng = (wc.max(axis=1) - wc.min(axis=1)) / np.maximum(wc.mean(axis=1), 1e-9) * 100
    flat_ok = rng < flat
    i = np.arange(d, N)
    j = i - d
    out[i] = shrunk[j] & flat_ok[j] & (v[i] > vma20[i] * 1.2) & (c[i] > o[i])
    return out


@register('dry_price_bottom', '地量地价', '量价共振类',
          {'window': 20, 'vol_ratio': 0.6},
          '收盘创 N 日新低且量 < 60日均量×R')
def dry_price_bottom(ind, p):
    n = p['window']
    ll = np.concatenate([[np.nan] * (n - 1), np.nanmin(_win(ind['close'], n), axis=1)])
    new_low = ind['close'] <= ll
    sig = new_low & (ind['volume'] < ind['vma60'] * p['vol_ratio'])
    return _ctx_filter(sig, ind, p)


@register('consecutive_yang', '连阳启动', '量价共振类',
          {'days': 3, 'vol_mult': 1.2},
          '≥N 连阳且收盘递增，末根温和放量')
def consecutive_yang(ind, p):
    d = p['days']
    c, o, v = ind['close'], ind['open'], ind['volume']
    N = len(c)
    out = np.zeros(N, dtype=bool)
    if N < d:
        return out
    wc = _win(c, d)
    wo = _win(o, d)
    yang = np.all(wc > wo, axis=1)
    rising = np.all(np.diff(wc, axis=1) > 0, axis=1)
    start = d - 1
    out[start:] = yang & rising & (v[start:] > ind['vma5'][start:] * p['vol_mult'])
    return _ctx_filter(out, ind, p)


@register('strong_sideways', '强势横盘', '量价共振类',
          {'window': 15, 'amp': 12.0, 'vol_mult': 1.5},
          '近 N 日振幅<A% 且缩量，末根放量突破横盘上沿')
def strong_sideways(ind, p):
    n, amp, vm = p['window'], p['amp'], p['vol_mult']
    h, l, c, v = ind['high'], ind['low'], ind['close'], ind['volume']
    N = len(c)
    out = np.zeros(N, dtype=bool)
    if N < n + 1:
        return out
    wh = _win(h, n)
    wl = _win(l, n)
    rng = (wh.max(axis=1) - wl.min(axis=1)) / np.maximum(wl.min(axis=1), 1e-9) * 100
    top = wh.max(axis=1)
    vw = _win(v, n)
    shrink = vw.mean(axis=1) < ind['vma20'][n - 1:]
    start = n
    prev = slice(n - 1, N - 1)
    out[start:] = (rng[:-1] < amp) & shrink[:-1] & (c[start:] > top[:-1]) \
        & (v[start:] > ind['vma5'][start:] * vm)
    return out


# ==================================================================== #
#  第 3 图：短线强势启动信号
# ==================================================================== #
@register('limit_pullback', '涨停回踩', '短线强势启动',
          {'window': 15, 'vol_shrink': 0.9},
          '近 N 日有涨停，随后缩量回踩不破区间支撑')
def limit_pullback(ind, p):
    n = p['window']
    lu = ind['is_limit_up']
    N = len(lu)
    out = np.zeros(N, dtype=bool)
    if N < n:
        return out
    w = _win(lu.astype(np.float64), n)
    had = w[:, :-1].max(axis=1) > 0.5            # 窗口内（不含末根）有涨停
    start = n - 1
    support = np.nanmin(_win(ind['low'], n), axis=1)
    out[start:] = had & (ind['volume'][start:] < ind['vma5'][start:] * p['vol_shrink']) \
        & (ind['low'][start:] >= support * 0.98)
    return _ctx_filter(out, ind, p)


@register('fake_break_pack', '假跌破反包', '短线强势启动',
          {'vol_mult': 1.3},
          '前根跌破前低后收回，末根放量阳线反包')
def fake_break_pack(ind, p):
    o, c, h, l, v = ind['open'], ind['close'], ind['high'], ind['low'], ind['volume']
    N = len(c)
    out = np.zeros(N, dtype=bool)
    if N < 12:
        return out
    prev_low = np.roll(ind['ll20'], 1)
    fake = l <= prev_low                          # 曾跌破
    recover = c > l                               # 收回
    for i in range(21, N):
        j = i - 1
        if fake[j] and recover[j]:
            out[i] = (c[i] > o[j]) and (c[i] > h[j]) and \
                     (v[i] > ind['vma5'][i] * p['vol_mult'])
    return out


@register('yang_engulf', '阳包阴', '短线强势启动',
          {'vol_mult': 1.2},
          '末根阳线实体完全覆盖前一根阴线实体，放量')
def yang_engulf(ind, p):
    o, c, v = ind['open'], ind['close'], ind['volume']
    N = len(c)
    out = np.zeros(N, dtype=bool)
    if N < 2:
        return out
    po, pc = o[:-1], c[:-1]
    prev_yin = pc < po
    engulf = (c[1:] > o[1:]) & (o[1:] <= pc) & (c[1:] >= po)
    out[1:] = prev_yin & engulf & (v[1:] > ind['vma5'][1:] * p['vol_mult'])
    return _ctx_filter(out, ind, p)


@register('long_lower_shadow', '长下影企稳', '短线强势启动',
          {'shadow_ratio': 0.5, 'max_body': 3.0},
          '下影/振幅 ≥R，实体不过大，收盘居中上')
def long_lower_shadow(ind, p):
    rng = ind['high'] - ind['low']
    ok_rng = rng > 0
    ratio = np.where(ok_rng, ind['lower'] / np.maximum(rng, 1e-9), 0.0)
    body_pct = np.where(ind['prev_close'] > 0,
                        ind['body'] / np.maximum(ind['prev_close'], 1e-9) * 100, 0.0)
    mid_up = ind['close'] > (ind['low'] + rng * 0.5)
    sig = (ratio >= p['shadow_ratio']) & (body_pct <= p['max_body']) & mid_up
    return _ctx_filter(sig, ind, p)


@register('rsi_low_turn', 'RSI低位拐头', '短线强势启动',
          {'low': 30.0},
          'RSI 前值低于阈值且当前拐头向上')
def rsi_low_turn(ind, p):
    r = ind['rsi14']
    prev = np.roll(r, 1)
    prev[0] = np.nan
    # 与其余短线形态一致，支持可选的 drop/rs/vol 上下文过滤（参数缺省时不改变信号）
    return _ctx_filter((prev < p['low']) & (r > prev), ind, p)


# ==================================================================== #
#  第 4 图：底部反转类
# ==================================================================== #
@register('double_bottom', '双底(W底)', '底部反转类',
          {'window': 30, 'tolerance': 0.03, 'vol_mult': 1.5},
          '近 N 日两个低点相近（第二底不破/抬高），放量突破颈线')
def double_bottom(ind, p):
    n, tol, vm = p['window'], p['tolerance'], p['vol_mult']
    lo, hi, c, v = ind['low'], ind['high'], ind['close'], ind['volume']
    N = len(c)
    out = np.zeros(N, dtype=bool)
    if N < n:
        return out
    half = n // 2
    # 预筛：末根放量且创近 n 日新高 → 大幅减少循环量
    cand = np.where((v > ind['vma5'] * vm) & (c >= rolling_max(hi, n)))[0]
    for i in cand:
        if i < n - 1:
            continue
        s = i - n + 1
        l1 = lo[s:s + half].min()
        l2 = lo[s + half:i + 1].min()
        if not np.isfinite(l1) or not np.isfinite(l2):
            continue
        if abs(l2 - l1) / max(l1, 1e-9) > tol and l2 < l1:
            continue                                   # 第二底显著更低 → 不算 W 底
        i1 = s + int(np.argmin(lo[s:s + half]))
        i2 = s + half + int(np.argmin(lo[s + half:i + 1]))
        neck = hi[i1:i2 + 1].max() if i2 > i1 else hi[i1]
        out[i] = c[i] > neck
    return out


@register('rising_w_bottom', 'W底突破（第二底抬高）', '底部反转类',
          {'window': 30, 'tolerance': 0.08, 'vol_mult': 1.5},
          '第二底较第一底抬高，放量突破颈线')
def rising_w_bottom(ind, p):
    """双底的抬高版本；突破日不把当天高点当作颈线证据。"""
    n, tol, vm = p['window'], p['tolerance'], p['vol_mult']
    lo, hi, c, v = ind['low'], ind['high'], ind['close'], ind['volume']
    out = np.zeros(len(c), dtype=bool)
    if len(c) < n:
        return out
    half = n // 2
    for i in np.where((v > ind['vma5'] * vm) & (c > np.roll(rolling_max(hi, n), 1)))[0]:
        if i < n or not np.isfinite(c[i]):
            continue
        s = i - n + 1
        l1 = lo[s:s+half].min(); l2 = lo[s+half:i].min()
        if not (l2 > l1 * (1 + 0.01) and l2 <= l1 * (1 + tol)):
            continue
        i1 = s + int(np.argmin(lo[s:s+half])); i2 = s + half + int(np.argmin(lo[s+half:i]))
        neck = hi[i1:i2+1].max() if i2 > i1 else hi[i1]
        out[i] = c[i] > neck
    return out


@register('arc_bottom', '圆弧底', '底部反转类',
          {'window': 40, 'vol_mult': 1.5},
          '最低点位于窗口中段呈下凹，末根放量突破右肩高点')
def arc_bottom(ind, p):
    n, vm = p['window'], p['vol_mult']
    lo, hi, c, v = ind['low'], ind['high'], ind['close'], ind['volume']
    N = len(c)
    out = np.zeros(N, dtype=bool)
    if N < n:
        return out
    start = n - 1
    wl = _win(lo, n)
    imin = np.argmin(wl, axis=1)                   # 最低点在窗口内的位置
    mid_lo, mid_hi = int(n * 0.3), int(n * 0.7)
    in_mid = (imin >= mid_lo) & (imin <= mid_hi)
    right = hi[start:]
    out[start:] = in_mid & (c[start:] > np.roll(hi, 1)[start:]) \
        & (v[start:] > ind['vma5'][start:] * vm)
    return out


@register('head_shoulder_bottom', '头肩底', '底部反转类',
          {'window': 45, 'vol_mult': 1.5},
          '头部为窗口最低点，左右肩高于头部，放量突破颈线')
def head_shoulder_bottom(ind, p):
    n, vm = p['window'], p['vol_mult']
    lo, hi, c, v = ind['low'], ind['high'], ind['close'], ind['volume']
    N = len(c)
    out = np.zeros(N, dtype=bool)
    if N < n:
        return out
    third = n // 3
    cand = np.where((v > ind['vma5'] * vm) & (c >= rolling_max(hi, n)))[0]
    for i in cand:
        if i < n - 1:
            continue
        s = i - n + 1
        seg = lo[s:i + 1]
        ih_rel = int(np.argmin(seg))
        ih = s + ih_rel
        if not (third <= ih_rel <= n - third):
            continue                       # 头部需位于中段
        head = seg[ih_rel]
        if seg[:third].min() <= head or seg[-third:].min() <= head:
            continue                       # 两肩必须高于头部
        # 颈线 = 左肩峰与右肩峰的较高者，**不含突破日 i 本身**
        neck = max(hi[s:ih].max(), hi[ih:i].max())
        out[i] = c[i] > neck
    return out


@register('second_test', '二次探底', '底部反转类',
          {'window': 30, 'tolerance': 0.03},
          '第一底后反弹，第二底回踩不破，末根企稳反弹')
def second_test(ind, p):
    n, tol = p['window'], p['tolerance']
    lo, c, v = ind['low'], ind['close'], ind['volume']
    N = len(c)
    out = np.zeros(N, dtype=bool)
    if N < n:
        return out
    half = n // 2
    for i in range(n - 1, N):
        s = i - n + 1
        b1 = lo[s:s + half].min()
        b2 = lo[s + half:i + 1].min()
        if not (np.isfinite(b1) and np.isfinite(b2)):
            continue
        # 第一次探底后需有反弹（窗口中部出现高于 b1 的高点）
        rebound = hi_mid = lo[s + half // 2:s + half].max() > b1 * 1.05
        if rebound and abs(b2 - b1) / max(b1, 1e-9) <= tol \
                and c[i] > c[i - 1] and v[i] > v[i - 1]:
            out[i] = True
    return _ctx_filter(out, ind, p)


# ==================================================================== #
#  第 5 图：突破爆发类
# ==================================================================== #
@register('platform_breakout', '平台突破', '突破爆发类',
          {'window': 20, 'amp': 15.0, 'vol_mult': 1.5},
          '近 N 日振幅<A%，放量突破平台上沿')
def platform_breakout(ind, p):
    n, amp, vm = p['window'], p['amp'], p['vol_mult']
    h, l, c, v = ind['high'], ind['low'], ind['close'], ind['volume']
    N = len(c)
    out = np.zeros(N, dtype=bool)
    if N < n + 1:
        return out
    wh = _win(h, n)
    wl = _win(l, n)
    rng = (wh.max(axis=1) - wl.min(axis=1)) / np.maximum(wl.min(axis=1), 1e-9) * 100
    top = wh.max(axis=1)
    start = n
    out[start:] = (rng[:-1] < amp) & (c[start:] > top[:-1]) \
        & (v[start:] > ind['vma5'][start:] * vm)
    return out


@register('box_breakout', '箱体突破', '突破爆发类',
          {'window': 25, 'touches': 2, 'vol_mult': 1.5},
          '近 N 日多次触及箱顶，放量突破上沿')
def box_breakout(ind, p):
    n, vm = p['window'], p['vol_mult']
    h, c, v = ind['high'], ind['close'], ind['volume']
    N = len(c)
    out = np.zeros(N, dtype=bool)
    if N < n + 1:
        return out
    wh = _win(h, n)
    top = wh.max(axis=1)
    near = wh > (top[:, None] * 0.98)
    touches = near.sum(axis=1) >= p['touches']
    start = n
    out[start:] = touches[:-1] & (c[start:] > top[:-1]) \
        & (v[start:] > ind['vma5'][start:] * vm)
    return out


@register('ascending_triangle', '上升三角形', '突破爆发类',
          {'window': 30, 'vol_mult': 1.5},
          '后半段低点高于前半段、振幅收敛，放量突破水平压力')
def ascending_triangle(ind, p):
    n, vm = p['window'], p['vol_mult']
    h, l, c, v = ind['high'], ind['low'], ind['close'], ind['volume']
    N = len(c)
    out = np.zeros(N, dtype=bool)
    if N < n + 1:
        return out
    half = n // 2
    wl = _win(l, n)
    wh = _win(h, n)
    l1 = wl[:, :half].min(axis=1)
    l2 = wl[:, half:].min(axis=1)
    rising = l2 > l1                                   # 支撑上移
    rng1 = (wh[:, :half].max(axis=1) - wl[:, :half].min(axis=1))
    rng2 = (wh[:, half:].max(axis=1) - wl[:, half:].min(axis=1))
    converge = rng2 < rng1                             # 振幅收敛
    top = wh[:, :half].max(axis=1)
    start = n
    out[start:] = (rising & converge)[:-1] & (c[start:] > top[:-1]) \
        & (v[start:] > ind['vma5'][start:] * vm)
    return out


@register('gap_breakout', '缺口突破', '突破爆发类',
          {'vol_mult': 1.5, 'min_gap': 0.5},
          '当日开盘高于前日最高且未回补，放量')
def gap_breakout(ind, p):
    o, h, l, c, v = ind['open'], ind['high'], ind['low'], ind['close'], ind['volume']
    N = len(c)
    out = np.zeros(N, dtype=bool)
    if N < 2:
        return out
    ph = h[:-1]
    gap_pct = (o[1:] - ph) / np.maximum(ph, 1e-9) * 100
    not_filled = l[1:] >= ph                           # 当日未回补缺口
    out[1:] = (gap_pct >= p['min_gap']) & not_filled \
        & (v[1:] > ind['vma5'][1:] * p['vol_mult'])
    return out


@register('n_shape', 'N字突破', '突破爆发类',
          {'window': 25, 'vol_mult': 1.5},
          '近 N 日快速拉高→缩量回调→末根放量创新高')
def n_shape(ind, p):
    n, vm = p['window'], p['vol_mult']
    h, c, v = ind['high'], ind['close'], ind['volume']
    N = len(c)
    out = np.zeros(N, dtype=bool)
    if N < n:
        return out
    # 前高 = 前 n-1 根（不含当前）的最高价
    prev_max = np.roll(rolling_max(h, n - 1), 1)
    prev_max[0] = np.nan
    cand = np.where((c > prev_max) & (v > ind['vma5'] * vm))[0]
    for i in cand:
        if i < n - 1:
            continue
        s = i - n + 1
        ih = s + int(np.argmax(h[s:i]))                # 前高位置
        if ih >= i - 2:
            continue                                    # 前高不能就是最近
        pullback_v = v[ih:i].mean()
        rise_v = v[s:ih + 1].mean()
        if pullback_v < rise_v and c[i] > h[s:i].max():
            out[i] = True
    return out
