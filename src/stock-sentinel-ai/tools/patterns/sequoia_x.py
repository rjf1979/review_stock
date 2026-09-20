# -*- coding: utf-8 -*-
"""
Sequoia-X 六个内置策略的等价形态定义（智诊盯盘回测口径）。

来源与边界
----------
* 规则口径来自开源项目 sngyai/Sequoia-X（Python；仓库根目录没有 LICENSE 文件，
  只有 README 声明 MIT）。本文件不复制其源码，只按公开的策略条件描述，在本项目
  的指标字典上重写为等价的向量化布尔序列，语义保持「信号在当根 K 线收盘确认」。
* 数据口径不同：Sequoia-X 用 baostock 复权日线存 SQLite，本项目用本地通达信日线
  （data/hsjday）+ data/kline-full.db 的 qfq 因子。因此命中股票与原项目不会逐只
  一致，可比的只有「条件本身」与「同一套退出规则下的统计量」。
* 这六个形态默认不进入任何选股链路：这里只做注册，让 tools/xingtaidu_backtest.py
  能把它们放进与现有 25 形态完全相同的结构止损 / 分批止盈 / 跟踪退出 / 成本口径里
  回测。是否提升为 rules-store.js 的正式规则由回测结果决定，见 docs/。

原口径对照（逐条与源码一致）
----------------------------
* sqxm_ma_volume：MA5 上穿 MA20（昨 ma5<ma20、今 ma5>ma20）且当日量 > 20 日均量×1.5
* sqxm_turtle_trade：收盘 > 前 20 日最高，且成交额 > 1 亿，且阳线，且收盘 > 昨收
* sqxm_high_tight_flag：40 日 high/low > 1.6，10 日 high/low < 1.15，
  10 日最低 >= 40 日最高×0.8，当日量 < 前 20 日均量×0.6
* sqxm_limit_up_shakeout：昨日 close >= 前日 close×1.095，今日收阴，
  今日量 > 昨日量×2，今日最低 >= 昨日收盘
* sqxm_uptrend_limit_down：昨日 MA20 > 昨日 MA60，今日 close <= 昨收×0.905，
  今日量 > 20 日均量×2
* sqxm_rps_breakout：120 日涨幅全市场百分位 >= 90，且 close >= 120 日最高×0.90

可选上下文过滤（默认关闭）
--------------------------
六个形态都接入项目共享的 ``_ctx_filter``：参数缺省时命中集合与原口径完全一致
（P1 基线可复现）；只有回测 ``--config params`` 显式传入 ``drop_days`` / ``drop_max`` /
``rs_days`` / ``rs_min`` / ``rs_max`` / ``vol_ref`` / ``vol_min`` / ``vol_max`` /
``bench_ma_days`` / ``bench_ma_mode`` 时才生效，口径与其余 25 个形态完全一致。
"""
from __future__ import annotations

import numpy as np

from indicators import rolling_max, rolling_min
from . import register
from .xingtaidu import _ctx_filter


def _zeros(n):
    return np.zeros(n, dtype=bool)


def _shift(a, n=1):
    """右移 n 位（前 n 根填 NaN），用于「昨日 / 前 N 日」口径。"""
    a = np.asarray(a, dtype=np.float64)
    out = np.full(len(a), np.nan)
    if len(a) > n:
        out[n:] = a[:-n]
    return out


@register('sqxm_ma_volume', '均线放量金叉(Sequoia-X)', '均线启动类',
          {'vol_mult': 1.5, 'vol_ref': 20},
          'MA5 上穿 MA20（昨日 ma5<ma20、今日 ma5>ma20）且当日量 > 20 日均量×1.5')
def sqxm_ma_volume(ind, p):
    ma5, ma20 = ind['ma5'], ind['ma20']
    cross = (_shift(ma5) < _shift(ma20)) & (ma5 > ma20)
    vma = ind.get(f"vma{int(p.get('vol_ref', 20))}")
    if vma is None:
        return _zeros(len(ind['close']))
    sig = cross & (ind['volume'] > np.asarray(vma, dtype=np.float64) * p['vol_mult'])
    return _ctx_filter(sig, ind, p)


@register('sqxm_turtle_trade', '海龟20日新高(Sequoia-X)', '突破爆发类',
          {'window': 20, 'min_amount': 1.0e8},
          '收盘 > 前 N 日最高，且成交额 > 1 亿，且收盘>开盘、收盘>昨收（防诱多）')
def sqxm_turtle_trade(ind, p):
    c, h = ind['close'], ind['high']
    amount = np.asarray(ind.get('amount', np.full(len(c), np.nan)), dtype=np.float64)
    prev_high = _shift(rolling_max(h, int(p['window'])))   # 前 n 日最高（不含当日）
    sig = ((c > prev_high) & (amount > float(p['min_amount']))
           & (c > ind['open']) & (c > ind['prev_close']))
    return _ctx_filter(sig, ind, p)


@register('sqxm_high_tight_flag', '高旗形缩量整理(Sequoia-X)', '突破爆发类',
          {'long': 40, 'tight': 10, 'momentum': 1.6, 'tight_ratio': 1.15,
           'hold_frac': 0.8, 'vol_shrink': 0.6, 'vol_ref': 20},
          '40 日振幅>60% 之后，近 10 日振幅<15% 且贴近高位，当日缩量到前 20 日均量 0.6 倍以下')
def sqxm_high_tight_flag(ind, p):
    h, l, v = ind['high'], ind['low'], ind['volume']
    n = len(h)
    n_long, n_tight, n_ref = int(p['long']), int(p['tight']), int(p['vol_ref'])
    if n < max(n_long, n_tight) + 1:
        return _zeros(n)
    hi_long, lo_long = rolling_max(h, n_long), rolling_min(l, n_long)
    hi_tight, lo_tight = rolling_max(h, n_tight), rolling_min(l, n_tight)
    vma = ind.get(f'vma{n_ref}')
    if vma is None:
        return _zeros(n)
    with np.errstate(invalid='ignore', divide='ignore'):
        momentum = (hi_long / lo_long) > float(p['momentum'])
        tight = (hi_tight / lo_tight) < float(p['tight_ratio'])
        high_level = lo_tight >= hi_long * float(p['hold_frac'])
        shrink = v < _shift(np.asarray(vma, dtype=np.float64)) * float(p['vol_shrink'])
    ok = np.isfinite(lo_long) & (lo_long > 0) & np.isfinite(lo_tight) & (lo_tight > 0)
    return _ctx_filter(ok & momentum & tight & high_level & shrink, ind, p)


@register('sqxm_limit_up_shakeout', '涨停洗盘不破昨收(Sequoia-X)', '短线强势启动',
          {'limit_pct': 9.5, 'vol_mult': 2.0},
          '昨日涨停（>= 前日收盘×1.095），今日收阴且放量 2 倍以上，最低价不破昨日收盘')
def sqxm_limit_up_shakeout(ind, p):
    c, o, l, v = ind['close'], ind['open'], ind['low'], ind['volume']
    n = len(c)
    out = _zeros(n)
    if n < 3:
        return out
    prev2_c, y_c, y_v = c[:-2], c[1:-1], v[1:-1]
    limit_up_yesterday = y_c >= prev2_c * (1.0 + float(p['limit_pct']) / 100.0)
    out[2:] = (limit_up_yesterday & (c[2:] < o[2:])
               & (v[2:] > y_v * float(p['vol_mult'])) & (l[2:] >= y_c))
    return _ctx_filter(out, ind, p)


@register('sqxm_uptrend_limit_down', '上升趋势放量跌停(Sequoia-X)', '底部反转类',
          {'drop_pct': 9.5, 'vol_mult': 2.0},
          '昨日 MA20 > MA60，今日收盘 <= 昨收×0.905 且量 > 当日 20 日均量×2（错杀观察）')
def sqxm_uptrend_limit_down(ind, p):
    c, v = ind['close'], ind['volume']
    n = len(c)
    out = _zeros(n)
    if n < 2:
        return out
    ma20, ma60 = np.asarray(ind['ma20'], np.float64), np.asarray(ind['ma60'], np.float64)
    vma20 = np.asarray(ind['vma20'], np.float64)
    uptrend_yesterday = _shift(ma20) > _shift(ma60)
    limit_down = c[1:] <= c[:-1] * (1.0 - float(p['drop_pct']) / 100.0)
    volume_surge = v[1:] > vma20[1:] * float(p['vol_mult'])
    out[1:] = uptrend_yesterday[1:] & limit_down & volume_surge
    return _ctx_filter(out, ind, p)


@register('sqxm_rps_breakout', 'RPS极强动量突破(Sequoia-X)', '突破爆发类',
          {'period': 120, 'break_frac': 0.90},
          '近 120 日涨幅处于全市场前 10%（横截面分位）且收盘 >= 120 日最高×0.90',
          cross_section=True)
def sqxm_rps_breakout(ind, p):
    """
    横截面形态：ind['rps120_p90'] 由回测引擎按日期注入，元素是「该交易日全市场近
    120 日涨幅的 90 分位阈值」（小数）。引擎没注入时返回全 False——调用方必须先用
    tools/rps_threshold.py 或 xingtaidu_backtest.py --patterns sqxm_rps_breakout
    准备好这张表。
    """
    c = ind['close']
    n = len(c)
    out = _zeros(n)
    thr = ind.get('rps120_p90')
    period = int(p['period'])
    if thr is None or n <= period:
        return out
    thr = np.asarray(thr, dtype=np.float64)
    if len(thr) != n:
        return out
    hh = ind['hh120'] if period == 120 else rolling_max(ind['high'], period)
    hh = np.asarray(hh, dtype=np.float64)
    with np.errstate(invalid='ignore', divide='ignore'):
        ret = c[period:] / c[:-period] - 1.0
        ok = np.isfinite(ret) & np.isfinite(thr[period:]) & np.isfinite(hh[period:])
        out[period:] = ok & (ret >= thr[period:]) & (c[period:] >= hh[period:] * p['break_frac'])
    return _ctx_filter(out, ind, p)
