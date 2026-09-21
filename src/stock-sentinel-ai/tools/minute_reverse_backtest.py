# -*- coding: utf-8 -*-
"""尾盘 14:40 买入 → 次日早盘触达 ≥+3%：分时反推样本抽取（不使用任何「形态」标签）。

与既有 ``late_buy_next_morning*.py`` 的口径差别
-----------------------------------------------
1. 入场时点 = T 日 **14:40** 的 1 分钟收盘价（不是 14:30、也不是 T 日收盘价）。
2. 标签 = T+1 日 **09:31~10:30** 最高价相对 14:40 入场价的涨幅 ≥ +3%
   （同时输出 09:31~10:00、09:31~11:30 两个对照窗口）。
3. 特征 = T 日 **≤14:40** 的分时结构 + T-1 及以前的日线量价 + T-1 的市场/板块上下文，
   **不含** dayShape / channelType / pos120 / 多周期 K 线形态等任何形态分类
   （均线只保留「价格距均线的数值偏离」，不做震荡/回踩之类的形态命名）。
4. 无前视：分时只用 ≤14:40 的分钟线，日线指标只在 T-1 取值，市场/板块上下文取 T-1；
   所有字段都能在 T 日 14:40 的实盘时点复现。

输出：``data/backtest/minute-reverse/samples.csv`` + ``extract_meta.json``。

用法::

    python tools/minute_reverse_backtest.py
    python tools/minute_reverse_backtest.py --include-star --max-stocks 300   # 冒烟
"""
from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import os
import sqlite3
import time

import numpy as np
import pandas as pd

from float_shares import ShareBook
from indicators import compute_indicators, limit_ratio_series
from kdata import Market, factor_series
from late_buy_next_morning import (filter_stock_universe, load_factors,
                                   load_latest_snapshot, ymd_to_ordinal)
from tdx_minute import load_minute
from tdx_names import load_tdx_names
from tdx_sector import load_industry_map

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..'))
OUT_DIR = os.path.join(ROOT, 'data', 'backtest', 'minute-reverse')
BT_DB = os.path.join(ROOT, 'data', 'backtest.db')

ENTRY_HHMM = 1440          # 买入：T 日 14:40 那根 1 分钟线收盘
AM_OPEN = 931              # T+1 第一根（09:31；时间戳为该分钟结束）
AM_1000, AM_1030, AM_1130 = 1000, 1030, 1130
TARGET = 0.03
COST = 0.0015
HIT_LEVELS = list(range(1, 10))
KLINE_MAX_GAP = 10

# (字段, 中文名, 类型, 单位)
FEATURES = [
    ('mRet10', '尾盘14:30→14:40涨幅', 'num', '%'),
    ('mRet5', '尾盘14:35→14:40涨幅', 'num', '%'),
    ('mRet30', '尾盘14:10→14:40涨幅', 'num', '%'),
    ('mRet60', '尾盘13:40→14:40涨幅', 'num', '%'),
    ('mAccel10', '尾盘动量加速度(最近10分钟-前10分钟)', 'num', '%'),
    ('mTailAmtShare10', '尾盘10分钟成交额占比', 'num', ''),
    ('mTailAmtShare30', '尾盘30分钟成交额占比', 'num', ''),
    ('mTailAmtTempo', '尾盘10分钟量能倍数(对13:31~14:30均值)', 'num', '倍'),
    ('mLastMinAmtShare', '14:40最后一分钟成交额占比', 'num', ''),
    ('mTailMaxDrop', '尾盘30分钟最大回撤', 'num', '%'),
    ('mTailRangePos', '尾盘区间位置(0~1)', 'num', ''),
    ('mTailVwapDev', '14:40价相对尾盘均价偏离', 'num', '%'),
    ('mTailUpMinShare', '尾盘上涨分钟占比', 'num', ''),
    ('mRetClose1440', '14:40价相对昨收涨幅', 'num', '%'),
    ('mRetOpen1440', '14:40价相对今开涨幅', 'num', '%'),
    ('mGapPct', '今日开盘缺口', 'num', '%'),
    ('mAmp1440', '截至14:40日内振幅', 'num', '%'),
    ('mClosePos1440', '截至14:40日内位置(0~1)', 'num', ''),
    ('mVwapDev1440', '14:40价相对当日均价偏离', 'num', '%'),
    ('mVwapSlope20', '尾盘20分钟均价相对14:20前均价偏离', 'num', '%'),
    ('mHiTimeRank', '当日最高点时间位置(0~1)', 'num', ''),
    ('mFirstHourRet', '上午前60分钟涨幅', 'num', '%'),
    ('mNoonRet', '11:30→14:40涨幅', 'num', '%'),
    ('mPmRet', '下午13:00→14:40涨幅', 'num', '%'),
    ('mVolPct1440', '分时波动率(分钟收益标准差)', 'num', '%'),
    ('mUpMinShare', '当日上涨分钟占比', 'num', ''),
    ('mUpDownVolRatio', '上涨/下跌分钟成交量比', 'num', ''),
    ('mAmtRatio2ndHalf', '后半段成交额占比(13:00~14:40)', 'num', ''),
    ('mTurnover1440', '截至14:40换手率', 'num', '%'),
    ('mAmountWan1440', '截至14:40成交额', 'num', '万元'),
    ('mVolRatio1440', '截至14:40量比(对前5日同时段)', 'num', ''),
    ('dPctPrev', '前一日涨幅', 'num', '%'),
    ('dAmpPrev', '前一日振幅', 'num', '%'),
    ('dRet5', '截至前一日5日收益', 'num', '%'),
    ('dRet20', '截至前一日20日收益', 'num', '%'),
    ('dRet60', '截至前一日60日收益', 'num', '%'),
    ('dRsi14', '前一日RSI14', 'num', ''),
    ('dAtrPct', '前一日ATR14波动率', 'num', '%'),
    ('dBias20', '前一日20日乖离', 'num', '%'),
    ('dBias60', '前一日60日乖离', 'num', '%'),
    ('dBias5', '前一日5日乖离', 'num', '%'),
    ('dBias10', '前一日10日乖离', 'num', '%'),
    ('dBias120', '前一日120日乖离', 'num', '%'),
    ('dDistHh20', '前一日距20日新高', 'num', '%'),
    ('dListDays', '上市天数', 'num', '日'),
    ('dFloatMcapYi', '流通市值(按14:40价)', 'num', '亿元'),
    ('dBoard', '上市板', 'cat', ''),
    ('marketTemp', '全市场温度', 'num', '0~1'),
    ('marketUpRatio', '全市场上涨占比', 'num', '%'),
    ('marketLimitUpCnt', '全市场涨停家数', 'num', '家'),
    ('marketRegime', '市场环境', 'cat', ''),
    ('sectorPct', '所属行业前一日涨幅', 'num', '%'),
    ('sectorRet5', '所属行业5日收益', 'num', '%'),
    ('sectorRet20', '所属行业20日收益', 'num', '%'),
    ('sectorHeat', '所属行业热度分', 'num', ''),
    ('sectorUpRatio', '所属行业上涨占比', 'num', '%'),
    ('sectorLimitUpCnt', '所属行业涨停家数', 'num', '家'),
    ('industry', '通达信行业', 'cat', ''),
]
FEATURE_KEYS = [f[0] for f in FEATURES]


def log(msg: str) -> None:
    print(msg, flush=True)


def day_slices(dates: np.ndarray) -> dict:
    """分钟日期数组 → {YYYYMMDD: (start, end)}（左闭右开）。"""
    ud, starts = np.unique(dates, return_index=True)
    ends = np.append(starts[1:], len(dates))
    return {int(d): (int(s), int(e)) for d, s, e in zip(ud, starts, ends)}


def _pos_at_or_before(t: np.ndarray, hhmm: int) -> int:
    return int(np.searchsorted(t, hhmm, side='right')) - 1


def prev_ctx(keys_sorted: np.ndarray, date_int: int):
    """在**升序**日期数组里取严格早于 ``date_int`` 的最近一天（无则 None）。"""
    if keys_sorted is None or not len(keys_sorted):
        return None
    i = int(np.searchsorted(keys_sorted, date_int, side='left')) - 1
    return int(keys_sorted[i]) if i >= 0 else None


def load_context() -> tuple[dict, np.ndarray, dict, dict]:
    """从 backtest.db 读市场/板块上下文。

    ``bt_market_day`` / ``bt_sector_day`` 的当日行是**收盘后**才成立的统计量，
    对 T 日 14:40 的决策属于前视，所以调用方必须用 ``prev_ctx`` 取 T-1 那一天。
    返回 (市场字典, 市场日期升序数组, 板块字典, 各板块日期升序数组)。
    """
    mkt: dict = {}
    sec: dict = {}
    sec_dates: dict = {}
    if not os.path.exists(BT_DB):
        return mkt, np.zeros(0, dtype=np.int64), sec, sec_dates
    conn = sqlite3.connect('file:%s?mode=ro' % BT_DB.replace('\\', '/'), uri=True)
    try:
        for date, upr, luc, regime, temp in conn.execute(
                'SELECT date, upRatio, limitUpCnt, regime, tempScore FROM bt_market_day'):
            mkt[int(date)] = {'marketUpRatio': upr, 'marketLimitUpCnt': luc,
                              'marketRegime': regime, 'marketTemp': temp}
        for bid, btype, date, pct, r5, r20, upr, luc, heat in conn.execute(
                'SELECT boardId, boardType, date, pct, ret5, ret20, upRatio, '
                'limitUpCnt, heatScore FROM bt_sector_day'):
            if btype != 'industry':
                continue
            sec[(str(bid), int(date))] = {
                'sectorPct': pct, 'sectorRet5': r5, 'sectorRet20': r20,
                'sectorUpRatio': upr, 'sectorLimitUpCnt': luc, 'sectorHeat': heat}
    finally:
        conn.close()
    mkt_dates = np.array(sorted(mkt), dtype=np.int64)
    grouped: dict = {}
    for (bid, date) in sec:
        grouped.setdefault(bid, []).append(date)
    for bid, ds in grouped.items():
        sec_dates[bid] = np.array(sorted(ds), dtype=np.int64)
    return mkt, mkt_dates, sec, sec_dates


def minute_features(m: dict, sl: tuple, prev_close: float, limit_px: float,
                    float_shares_wan: float, vol_base: float) -> dict | None:
    """T 日 ≤14:40 的分时特征。数据不足或 14:40 已封板时返回 None。"""
    s, e = sl
    t = np.asarray(m['time'][s:e], dtype=np.int64)
    if not len(t):
        return None
    p = _pos_at_or_before(t, ENTRY_HHMM)
    if p < 5:
        return None
    n = p + 1
    t = t[:n]
    o = np.asarray(m['open'][s:e], dtype=np.float64)[:n]
    h = np.asarray(m['high'][s:e], dtype=np.float64)[:n]
    l = np.asarray(m['low'][s:e], dtype=np.float64)[:n]
    c = np.asarray(m['close'][s:e], dtype=np.float64)[:n]
    amt = np.asarray(m['amount'][s:e], dtype=np.float64)[:n]
    vol = np.asarray(m['volume'][s:e], dtype=np.float64)[:n]
    entry = float(c[-1])
    if not np.isfinite(entry) or entry <= 0 or prev_close <= 0:
        return None
    if limit_px and entry >= limit_px - 1e-9:
        return None

    def px(hhmm: int) -> float:
        i = _pos_at_or_before(t, hhmm)
        return float(c[i]) if i >= 0 else float('nan')

    def span(a: int, b: int) -> np.ndarray:
        return (t > a) & (t <= b)

    hi, lo = float(h.max()), float(l.min())
    amt_sum, vol_sum = float(amt.sum()), float(vol.sum())
    vwap = amt_sum / vol_sum if vol_sum > 0 else float('nan')
    p1430, p1420, p1435 = px(1430), px(1420), px(1435)
    tail, tail30, tail10 = span(1400, 1440), span(1410, 1440), span(1430, 1440)
    r = np.diff(c) / c[:-1] * 100.0
    rt = t[1:]
    tail_hi, tail_lo = float(h[tail30].max()), float(l[tail30].min())
    k_hi = int(np.argmax(h[tail30]))
    tail_drop = ((float(l[tail30][k_hi:].min()) / tail_hi - 1) * 100.0
                 if tail_hi > 0 else np.nan)
    pre = span(1330, 1430)
    tempo_base = float(np.mean(amt[pre])) if pre.any() else np.nan
    amt_tail10 = float(amt[tail10].sum())
    vol_tail = float(vol[tail].sum())
    vwap_tail = float(amt[tail].sum()) / vol_tail if vol_tail > 0 else np.nan
    up_mask, dn_mask = r > 0, r < 0
    early = span(0, 1420)
    vwap_early = (float(amt[early].sum()) / float(vol[early].sum())
                  if early.any() and float(vol[early].sum()) > 0 else np.nan)
    late = span(1420, 1440)
    vol_late = float(vol[late].sum())
    vwap_late = float(amt[late].sum()) / vol_late if vol_late > 0 else np.nan
    out = {
        'mRet10': (entry / p1430 - 1) * 100 if p1430 > 0 else np.nan,
        'mRet5': (entry / p1435 - 1) * 100 if p1435 > 0 else np.nan,
        'mRet30': (entry / px(1410) - 1) * 100 if px(1410) > 0 else np.nan,
        'mRet60': (entry / px(1340) - 1) * 100 if px(1340) > 0 else np.nan,
        'mAccel10': ((entry / p1430 - 1) - (p1430 / p1420 - 1)) * 100
                    if (p1430 > 0 and p1420 > 0) else np.nan,
        'mTailAmtShare10': amt_tail10 / amt_sum if amt_sum > 0 else np.nan,
        'mTailAmtShare30': float(amt[tail30].sum()) / amt_sum if amt_sum > 0 else np.nan,
        'mTailAmtTempo': amt_tail10 / (10.0 * tempo_base)
                         if tempo_base and tempo_base > 0 else np.nan,
        'mLastMinAmtShare': float(amt[-1]) / amt_sum if amt_sum > 0 else np.nan,
        'mTailMaxDrop': tail_drop,
        'mTailRangePos': (entry - tail_lo) / (tail_hi - tail_lo)
                         if tail_hi > tail_lo else np.nan,
        'mTailVwapDev': (entry / vwap_tail - 1) * 100 if vwap_tail and vwap_tail > 0 else np.nan,
        'mTailUpMinShare': float(up_mask[rt > 1400].mean()) if (rt > 1400).any() else np.nan,
        'mRetClose1440': (entry / prev_close - 1) * 100,
        'mRetOpen1440': (entry / float(o[0]) - 1) * 100 if o[0] > 0 else np.nan,
        'mGapPct': (float(o[0]) / prev_close - 1) * 100,
        'mAmp1440': (hi - lo) / prev_close * 100,
        'mClosePos1440': (entry - lo) / (hi - lo) if hi > lo else np.nan,
        'mVwapDev1440': (entry / vwap - 1) * 100 if vwap and vwap > 0 else np.nan,
        'mVwapSlope20': (vwap_late / vwap_early - 1) * 100
                        if (vwap_early and vwap_early > 0 and np.isfinite(vwap_late))
                        else np.nan,
        'mHiTimeRank': int(np.argmax(h)) / max(n - 1, 1),
        'mFirstHourRet': (px(1030) / float(o[0]) - 1) * 100 if o[0] > 0 else np.nan,
        'mNoonRet': (entry / px(1130) - 1) * 100 if px(1130) > 0 else np.nan,
        # 13:00 没有分钟线（下午第一根是 13:01），所以下午基准取 13:01
        'mPmRet': (entry / px(1301) - 1) * 100 if px(1301) > 0 else np.nan,
        'mVolPct1440': float(np.nanstd(r)) if len(r) else np.nan,
        'mUpMinShare': float(up_mask.mean()) if len(r) else np.nan,
        'mUpDownVolRatio': (float(vol[1:][up_mask].sum()) / float(vol[1:][dn_mask].sum())
                            if float(vol[1:][dn_mask].sum()) > 0 else np.nan),
        'mAmtRatio2ndHalf': float(amt[t > 1300].sum()) / amt_sum if amt_sum > 0 else np.nan,
        'mTurnover1440': (vol_sum / (float_shares_wan * 1e4) * 100)
                         if float_shares_wan and float_shares_wan > 0 else np.nan,
        'mAmountWan1440': amt_sum / 1e4,
        'mVolRatio1440': amt_sum / vol_base if vol_base and vol_base > 0 else np.nan,
    }
    return out


def label_features(m: dict, sl1: tuple, entry: float, adj: float,
                   t_close_raw: float, limit_ratio: float) -> dict | None:
    """T+1 早盘：三个窗口的最高涨幅、对应时刻、以及卖出路径所需的价格。"""
    s, e = sl1
    t = np.asarray(m['time'][s:e], dtype=np.int64)
    if not len(t):
        return None
    o = np.asarray(m['open'][s:e], dtype=np.float64)
    h = np.asarray(m['high'][s:e], dtype=np.float64)
    c = np.asarray(m['close'][s:e], dtype=np.float64)
    out: dict = {}
    for name, hhmm in (('1000', AM_1000), ('1030', AM_1030), ('1130', AM_1130)):
        sel = (t >= AM_OPEN) & (t <= hhmm)
        if not sel.any():
            return None
        hh = h[sel]
        k = int(np.argmax(hh))
        out['hi%sPct' % name] = (float(hh[k]) * adj / entry - 1) * 100
        out['hi%sTime' % name] = int(t[sel][k])
    am = t >= AM_OPEN
    out['openPct'] = (float(o[am][0]) * adj / entry - 1) * 100
    for name, hhmm in (('1000', AM_1000), ('1030', AM_1030)):
        i = _pos_at_or_before(t, hhmm)
        out['c%sPct' % name] = (float(c[i]) * adj / entry - 1) * 100 if i >= 0 else np.nan
    out['hiDayPct'] = (float(h[am].max()) * adj / entry - 1) * 100 if am.any() else np.nan
    limit_px = round(t_close_raw * (1 + limit_ratio), 2)
    amwin = (t >= AM_OPEN) & (t <= AM_1030)
    out['limitTouch1030'] = int(bool(amwin.any() and h[amwin].max() >= limit_px - 1e-6))
    out['limitTouchDay'] = int(bool(am.any() and h[am].max() >= limit_px - 1e-6))
    return out


_W: dict = {}


def _worker_init(args) -> None:
    """worker 进程内一次性装配数据源（避免大对象跨进程 pickle）。"""
    _W['args'] = args
    _W['market'] = Market()
    _W['names'] = load_tdx_names()
    _W['hy_map'] = load_industry_map()
    _W['snap'], _W['snap_date'] = load_latest_snapshot()
    _W['factors'] = load_factors()
    _W['shares'] = ShareBook.load()
    _W['mkt'], _W['mkt_dates'], _W['sec'], _W['sec_dates'] = load_context()
    _W['start'] = int(str(args.start).replace('-', ''))
    _W['end'] = int(str(args.end).replace('-', ''))


def compute_stock(code: str) -> tuple[list, dict]:
    """单只股票在 [start, end] 内的全部样本（每个 T 日一行）。"""
    args = _W['args']
    market = _W['market']
    names, hy_map, snap = _W['names'], _W['hy_map'], _W['snap']
    factors, shares = _W['factors'], _W['shares']
    mkt, mkt_dates = _W['mkt'], _W['mkt_dates']
    sec, sec_dates = _W['sec'], _W['sec_dates']
    start_int, end_int = _W['start'], _W['end']
    rows: list = []
    skipped = {'no_minute': 0, 'no_daily': 0, 'short': 0, 'no_next': 0,
               'gap': 0, 'no_entry': 0}
    m = load_minute(code, 1, start=start_int, end=end_int)
    if not m or len(m['date']) == 0:
        skipped['no_minute'] += 1
        return rows, skipped
    try:
        raw = market.load(code, 'raw')
        qfq = market.load(code, 'qfq', factors.get(code))
    except Exception:
        skipped['no_daily'] += 1
        return rows, skipped
    if len(qfq) < args.min_bars + 2:
        skipped['short'] += 1
        return rows, skipped
    name = names.get(code) or (snap.get(code) or {}).get('name', '') or ''
    meta = market.meta(code)
    board = meta.get('board', '')
    hyinfo = hy_map.get(code) or {}
    sec_board = str(hyinfo.get('board') or '')
    d_dates = np.asarray(qfq['date'], dtype=np.int64)
    f_all = factor_series(factors.get(code), d_dates)   # 前复权因子，与日线对齐
    dpos = {int(d): i for i, d in enumerate(d_dates)}
    ind = compute_indicators(qfq, code, name)
    lmt_all = limit_ratio_series(code, raw['high'], raw['low'], raw['close'])
    sl_by_date = day_slices(np.asarray(m['date']))
    days = sorted(d for d in sl_by_date if start_int <= d <= end_int and d in dpos)
    amt1440 = {}
    for d in days:
        s, e = sl_by_date[d]
        sel = np.asarray(m['time'][s:e]) <= ENTRY_HHMM
        amt1440[d] = float(np.asarray(m['amount'][s:e])[sel].sum()) if sel.any() else np.nan
    sec_dates_b = sec_dates.get(sec_board)
    for j, d in enumerate(days):
        i = dpos[d]
        if i < args.min_bars - 1 or i + 1 >= len(d_dates):
            skipped['no_next'] += 1
            continue
        d1 = int(d_dates[i + 1])
        if d1 not in sl_by_date:
            skipped['no_next'] += 1
            continue
        gap = int(ymd_to_ordinal(np.array([d1]))[0] - ymd_to_ordinal(np.array([d]))[0])
        if gap > KLINE_MAX_GAP:
            skipped['gap'] += 1
            continue
        adj = float(f_all[i] / f_all[i + 1])         # T+1 不复权分钟价 → T 日口径
        t_close_raw = float(raw['close'][i])
        limit_ratio = float(lmt_all[i])
        # 昨收（T-1 不复权收盘）换算到 T 日不复权分钟价口径
        prev_close = (float(raw['close'][i - 1]) * f_all[i] / f_all[i - 1]
                      if i >= 1 and f_all[i - 1] > 0 else np.nan)
        if not np.isfinite(prev_close) or prev_close <= 0:
            skipped['no_entry'] += 1
            continue
        base5 = [v for v in (amt1440.get(days[k]) for k in range(max(0, j - 5), j))
                 if v is not None and np.isfinite(v) and v > 0]
        feats = minute_features(
            m, sl_by_date[d], prev_close,
            round(t_close_raw * (1 + limit_ratio), 2),
            shares.shares_wan(code, d) or np.nan,
            float(np.mean(base5)) if base5 else np.nan)
        if not feats:
            skipped['no_entry'] += 1
            continue
        s0, e0 = sl_by_date[d]
        t_arr = np.asarray(m['time'][s0:e0], dtype=np.int64)
        entry = float(np.asarray(m['close'][s0:e0])[_pos_at_or_before(t_arr, ENTRY_HHMM)])
        lab = label_features(m, sl_by_date[d1], entry, adj, t_close_raw, limit_ratio)
        if not lab:
            skipped['no_entry'] += 1
            continue
        j0 = i - 1
        c_prev = float(qfq['close'][j0])
        ma5, ma10 = float(ind['ma5'][j0]), float(ind['ma10'][j0])
        ma20, ma60 = float(ind['ma20'][j0]), float(ind['ma60'][j0])
        ma120 = float(ind['ma120'][j0])
        hh20 = float(ind['hh20'][j0])

        def back(k: int) -> float:
            if j0 - k < 0 or float(qfq['close'][j0 - k]) <= 0:
                return np.nan
            return (c_prev / float(qfq['close'][j0 - k]) - 1) * 100

        # 市场/板块上下文一律取 T-1（当日统计量要收盘后才成立）
        ctx_m = mkt.get(prev_ctx(mkt_dates, d)) or {}
        ctx_s = sec.get((sec_board, prev_ctx(sec_dates_b, d))) or {}
        sh_wan = shares.shares_wan(code, d) or np.nan
        row = {
            'code': code, 'name': name, 'date': d, 'nextDate': d1,
            'board': board, 'industry': hyinfo.get('hy_name', ''),
            'entry1440': round(entry, 4), 'tCloseRaw': round(t_close_raw, 4),
            'dPctPrev': round(float(ind['pct'][j0]), 4),
            'dAmpPrev': round(float(ind['amp'][j0]), 4),
            'dRet5': round(back(4), 4), 'dRet20': round(back(19), 4),
            'dRet60': round(back(59), 4),
            'dRsi14': round(float(ind['rsi14'][j0]), 4),
            'dAtrPct': round(float(ind['atr14'][j0]) / c_prev * 100, 4) if c_prev > 0 else np.nan,
            'dBias5': round((c_prev / ma5 - 1) * 100, 4) if ma5 > 0 else np.nan,
            'dBias10': round((c_prev / ma10 - 1) * 100, 4) if ma10 > 0 else np.nan,
            'dBias20': round((c_prev / ma20 - 1) * 100, 4) if ma20 > 0 else np.nan,
            'dBias60': round((c_prev / ma60 - 1) * 100, 4) if ma60 > 0 else np.nan,
            'dBias120': round((c_prev / ma120 - 1) * 100, 4) if ma120 > 0 else np.nan,
            'dDistHh20': round((c_prev / hh20 - 1) * 100, 4) if hh20 > 0 else np.nan,
            'dListDays': int(i + 1),
            'dFloatMcapYi': round(sh_wan * entry / 1e4, 4) if np.isfinite(sh_wan) else np.nan,
            'dBoard': board,
            'marketTemp': ctx_m.get('marketTemp'),
            'marketUpRatio': ctx_m.get('marketUpRatio'),
            'marketLimitUpCnt': ctx_m.get('marketLimitUpCnt'),
            'marketRegime': ctx_m.get('marketRegime'),
            'sectorPct': ctx_s.get('sectorPct'),
            'sectorRet5': ctx_s.get('sectorRet5'),
            'sectorRet20': ctx_s.get('sectorRet20'),
            'sectorHeat': ctx_s.get('sectorHeat'),
            'sectorUpRatio': ctx_s.get('sectorUpRatio'),
            'sectorLimitUpCnt': ctx_s.get('sectorLimitUpCnt'),
        }
        for k, v in list(feats.items()) + list(lab.items()):
            row[k] = (round(float(v), 6) if isinstance(v, (int, float, np.floating))
                      and np.isfinite(float(v)) else v)
        for lvl in HIT_LEVELS:
            row['hit%d' % lvl] = int(np.isfinite(row['hi1030Pct'])
                                     and row['hi1030Pct'] >= lvl)
            row['hit1000_%d' % lvl] = int(np.isfinite(row['hi1000Pct'])
                                          and row['hi1000Pct'] >= lvl)
        rows.append(row)
    return rows, skipped


def extract(args) -> int:
    start_int = int(str(args.start).replace('-', ''))
    end_int = int(str(args.end).replace('-', ''))
    snap, snap_date = load_latest_snapshot()
    names = load_tdx_names()
    hy_map = load_industry_map()
    market = Market()
    codes, uinfo = filter_stock_universe(
        market.codes(args.min_bars), market, snap, names, hy_map,
        exclude_industry=args.exclude_industry, include_star=args.include_star,
        keep_delisted=args.keep_delisted, delist_grace_days=args.delist_grace_days,
        delist_scope='trade')
    log('[init] 股票池 %d 只（退市 %d / ST %d / 行业 %d）'
        % (len(codes), uinfo['dropped_delisted'], uinfo['st_dropped'], uinfo['ex_hy']))
    if args.max_stocks:
        codes = codes[:args.max_stocks]
        log('[init] 冒烟模式：前 %d 只' % len(codes))
    workers = int(args.workers) if args.workers else min(8, os.cpu_count() or 4)
    workers = max(1, min(workers, len(codes)))
    log('[run] %d 只 / %d 进程 / %s ~ %s' % (len(codes), workers, start_int, end_int))
    t0 = time.time()
    rows: list = []
    skipped = {'no_minute': 0, 'no_daily': 0, 'short': 0, 'no_next': 0,
               'gap': 0, 'no_entry': 0}
    dates_seen: set = set()
    if workers == 1:
        _worker_init(args)
        results = ((c, compute_stock(c)) for c in codes)
        for n_done, (code, (rws, sk)) in enumerate(results, 1):
            rows.extend(rws)
            for k, v in sk.items():
                skipped[k] += v
            dates_seen.update(r['date'] for r in rws)
            if n_done % 300 == 0:
                log('  ... %d/%d 只，样本 %d，用时 %.0fs'
                    % (n_done, len(codes), len(rows), time.time() - t0))
    else:
        with mp.Pool(workers, initializer=_worker_init, initargs=(args,)) as pool:
            for n_done, (rws, sk) in enumerate(
                    pool.imap_unordered(compute_stock, codes, chunksize=8), 1):
                rows.extend(rws)
                for k, v in sk.items():
                    skipped[k] += v
                dates_seen.update(r['date'] for r in rws)
                if n_done % 500 == 0:
                    log('  ... %d/%d 只，样本 %d，用时 %.0fs'
                        % (n_done, len(codes), len(rows), time.time() - t0))
    if not rows:
        log('[fail] 无样本')
        return 1
    os.makedirs(OUT_DIR, exist_ok=True)
    df = pd.DataFrame(rows)
    out_csv = os.path.join(OUT_DIR, args.out or 'samples.csv')
    tmp_csv = out_csv + '.writing'
    if os.path.exists(tmp_csv):
        os.remove(tmp_csv)
    df.to_csv(tmp_csv, index=False, encoding='utf-8-sig')
    os.replace(tmp_csv, out_csv)      # 原子落盘：避免下游读到半截 CSV
    log('[done] 样本 %d 行 / %d 个交易日，用时 %.0fs' % (len(df), len(dates_seen),
                                                      time.time() - t0))
    meta = {
        'generator': 'tools/minute_reverse_backtest.py',
        'entryTime': ENTRY_HHMM, 'targetPct': TARGET * 100, 'cost': COST,
        'amWindow': 'T+1 09:31~10:30（对照 09:31~10:00 / 09:31~11:30）',
        'labelBase': 'T 日 14:40 分钟收盘价',
        'featureCaliber': ('T 日 ≤14:40 分时 + T-1 及以前日线量价（含 5/10/20/60/120 日乖离，'
                           '仅数值不做形态命名）+ T-1 市场/板块温度；无形态字段'),
        'lookahead': ('分时只用 ≤14:40；日线指标取 T-1；市场/板块上下文取 T-1；'
                      '昨收用 T-1 不复权收盘按前复权因子折算到 T 日口径'),
        'workers': workers,
        'stockOnly': True,
        'exclude': '银行股、退市股、B 股、ST；科创板%s'
                   % ('包含' if args.include_star else '排除（与既有分钟口径一致）'),
        'snapshot': snap_date, 'rows': int(len(df)), 'dates': len(dates_seen),
        'dateMin': int(min(dates_seen)), 'dateMax': int(max(dates_seen)),
        'features': [{'key': k, 'cn': cn, 'kind': kd, 'unit': u}
                     for k, cn, kd, u in FEATURES],
        'skipped': skipped,
    }
    with open(os.path.join(OUT_DIR, 'extract_meta.json'), 'w', encoding='utf-8') as fp:
        json.dump(meta, fp, ensure_ascii=False, indent=2)
    log('[out] %s：%d 行 / %d 个交易日' % (out_csv, len(df), len(dates_seen)))
    log('[skip] %s' % skipped)
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--start', default='2026-06-12')
    ap.add_argument('--end', default='2026-09-18')
    ap.add_argument('--min-bars', type=int, default=150)
    ap.add_argument('--exclude-industry', nargs='*', default=['银行'])
    ap.add_argument('--include-star', action='store_true')
    ap.add_argument('--keep-delisted', action='store_true')
    ap.add_argument('--delist-grace-days', type=int, default=90)
    ap.add_argument('--max-stocks', type=int, default=0)
    ap.add_argument('--workers', type=int, default=0,
                    help='并行进程数，0 = 自动（最多 8）')
    ap.add_argument('--out', default='samples.csv')
    args = ap.parse_args(argv)
    return extract(args)


if __name__ == '__main__':
    raise SystemExit(main())
