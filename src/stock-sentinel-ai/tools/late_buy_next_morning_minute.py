# -*- coding: utf-8 -*-
"""尾盘买入 → 次日早盘卖出：1 分钟精确口径回测（并与日线近似口径对照）。

精确口径
--------
* 入场价 = T 日 14:30 那一根 1 分钟 K 线的收盘价（通达信时间戳为该分钟结束时刻）；
* 「次日上午最高涨幅」= T+1 日 09:31~11:30 的最高价 / 入场价 - 1；
* 同时给出 T+1 日全天最高涨幅，用于量化「全天最高 ≈ 上午最高」这一近似的高估幅度；
* 卖出收益主口径仍为 T+1 开盘价（最保守可执行）；另给「上午触及 +3% 即止盈，
  否则开盘卖」的可执行模型。

同一批 T 日样本会同时跑一遍日线近似口径（入场＝T 日收盘价、最高＝T+1 全天最高），
逐项对照，量化近似的偏差方向与幅度。

价格用前复权口径计算收益（用日线复权因子把分钟不复权价换算成可比价），
涨跌停/封板判定用不复权原始价。

用法::

    python tools/late_buy_next_morning_minute.py --out-dir data/backtest/late-buy-next-morning-minute
"""
from __future__ import annotations

import argparse
import json
import os

import numpy as np

from indicators import compute_indicators, limit_ratio
from kdata import Market, factor_series, int_to_ymd
from late_buy_next_morning import (COST, EDGES, TARGET, IndexAgg, KeyAgg,
                                   bucket_labels, load_factors,
                                   load_latest_snapshot, write_csv, ymd_to_ordinal)
from tdx_minute import load_minute
from tdx_sector import load_board_series, load_industry_map

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..'))
OUT_DEFAULT = os.path.join(ROOT, 'data', 'backtest', 'late-buy-next-morning-minute')
BENCH_CODE = '000300'
AM_START, AM_END = 931, 1130
ENTRY_HHMM = 1430


def day_slices(dates: np.ndarray) -> dict:
    """分钟日期数组 → {YYYYMMDD: (start, end)}（左闭右开）。"""
    ud, starts = np.unique(dates, return_index=True)
    ends = np.append(starts[1:], len(dates))
    return {int(d): (int(s), int(e)) for d, s, e in zip(ud, starts, ends)}


def minute_entry(m: dict, sl) -> float:
    """T 日 14:30 分钟收盘价；该分钟缺失则回退到当日 14:30 前最后一根。"""
    s, e = sl
    t = m['time'][s:e]
    pos = int(np.searchsorted(t, ENTRY_HHMM, side='right')) - 1
    if pos < 0:
        return float('nan')
    return float(m['close'][s + pos])


def minute_high(m: dict, sl, t_from: int, t_to: int):
    """区间最高价与对应时刻；无数据返回 (nan, nan)。"""
    s, e = sl
    t = m['time'][s:e]
    sel = (t >= t_from) & (t <= t_to)
    if not sel.any():
        return float('nan'), float('nan')
    h = m['high'][s:e][sel]
    k = int(np.argmax(h))
    return float(h[k]), float(t[sel][k])


def pct_stats(values: np.ndarray) -> dict:
    v = np.asarray(values, dtype=np.float64)
    v = v[np.isfinite(v)]
    if not len(v):
        return {}
    return {
        'n': int(len(v)),
        'mean_pct': round(float(v.mean()) * 100, 4),
        'median_pct': round(float(np.median(v)) * 100, 4),
        'p10_pct': round(float(np.percentile(v, 10)) * 100, 4),
        'p90_pct': round(float(np.percentile(v, 90)) * 100, 4),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--start', default='1990-01-01')
    ap.add_argument('--end', default='2099-12-31')
    ap.add_argument('--min-bars', type=int, default=150)
    ap.add_argument('--include-star', action='store_true')
    ap.add_argument('--keep-sealed', action='store_true')
    ap.add_argument('--max-gap', type=int, default=10)
    ap.add_argument('--out-dir', default=OUT_DEFAULT)
    ap.add_argument('--max-stocks', type=int, default=0)
    ap.add_argument('--dump-detail', action='store_true')
    args = ap.parse_args()

    start_int = int(args.start.replace('-', ''))
    end_int = int(args.end.replace('-', ''))

    snap, snap_date = load_latest_snapshot()
    hy_map = load_industry_map()
    board_series = load_board_series(sorted({v['board'] for v in hy_map.values() if v['board']}))
    bench_series = load_board_series([BENCH_CODE]).get(BENCH_CODE) or {}

    market = Market()
    codes = [c for c in market.codes(args.min_bars) if not c.startswith(('8', '4', '9'))]
    if not args.include_star:
        codes = [c for c in codes if not c.startswith('68')]
    st_codes = {c for c, mm in snap.items() if 'ST' in (mm['name'] or '').upper()}
    codes = [c for c in codes if c not in st_codes]
    if args.max_stocks:
        codes = codes[:args.max_stocks]
    print(f'[init] 快照 {snap_date}；行业映射 {len(hy_map)}；板块指数 {len(board_series)}；'
          f'股票池 {len(codes)} 只')

    factors = load_factors()
    aggs = {k: IndexAgg(bucket_labels(e)) for k, e in EDGES.items()}
    aggs['board'] = KeyAgg()
    aggs['hy'] = KeyAgg()
    overall = IndexAgg(['分钟精确'])
    overall_day = IndexAgg(['日线近似'])
    cmp_minute = IndexAgg(['分钟精确'])
    cmp_daily = IndexAgg(['日线近似'])

    drift_1430_close = []
    am_vs_day = []
    am_is_day_high = []
    minute_dates_seen = set()
    detail_rows = []
    trades = 0
    no_minute = 0

    for n_done, code in enumerate(codes, 1):
        m = load_minute(code, 1, start=start_int - 20000, end=end_int)
        if not m or len(m['date']) == 0:
            no_minute += 1
            continue
        meta = market.meta(code)
        name = (snap.get(code) or {}).get('name', '')
        lmt = limit_ratio(code, name)
        try:
            raw = market.load(code, 'raw')
            qfq = market.load(code, 'qfq', factors.get(code))
        except Exception:
            continue
        if len(qfq) < args.min_bars + 2:
            continue

        d_dates = np.asarray(qfq['date'], dtype=np.int64)
        f = factor_series(factors.get(code), d_dates)
        ind = compute_indicators(qfq, code, name)
        dpos = {int(d): i for i, d in enumerate(d_dates)}
        slices = day_slices(m['date'])

        cand = sorted(d for d in slices
                      if start_int <= d <= end_int and d in dpos
                      and dpos[d] + 1 < len(d_dates)
                      and int(d_dates[dpos[d] + 1]) in slices
                      and dpos[d] >= args.min_bars - 1)
        if not cand:
            continue
        ii = np.array([dpos[d] for d in cand], dtype=np.int64)
        ii1 = ii + 1
        minute_dates_seen.update(cand)
        n = len(cand)

        entry_am = np.full(n, np.nan)
        hi_am = np.full(n, np.nan)
        tm_am = np.full(n, np.nan)
        hi_day_min = np.full(n, np.nan)
        for k, d in enumerate(cand):
            d1 = int(d_dates[ii[k] + 1])
            entry_am[k] = minute_entry(m, slices[d])
            h, tm = minute_high(m, slices[d1], AM_START, AM_END)
            hi_am[k] = h
            tm_am[k] = tm
            hi_day_min[k] = minute_high(m, slices[d1], 0, 2400)[0]

        o_raw = raw['open'][ii]
        h_raw, l_raw, c_raw = raw['high'][ii], raw['low'][ii], raw['close'][ii]
        h1_raw = raw['high'][ii1]
        o1, h1, c1 = qfq['open'][ii1], qfq['high'][ii1], qfq['close'][ii1]
        adj = f[ii] / f[ii1]
        c_close = qfq['close'][ii]

        one_line = (o_raw == h_raw) & (h_raw == l_raw) & (l_raw == c_raw)
        sealed = (c_raw >= h_raw - 1e-9) & ind['is_limit_up'][ii]
        gap = ymd_to_ordinal(d_dates[ii1]) - ymd_to_ordinal(d_dates[ii])
        valid = (np.isfinite(entry_am) & np.isfinite(hi_am) & np.isfinite(hi_day_min)
                 & (entry_am > 0) & (c_close > 0) & (gap <= args.max_gap) & ~one_line)
        if not args.keep_sealed:
            valid &= ~sealed
        if not valid.any():
            continue

        buy_am = entry_am
        ret_high_am = hi_am / buy_am * adj - 1
        ret_high_day_min = hi_day_min / buy_am * adj - 1
        ret_open = o1 / buy_am * adj - 1
        ret_close = c1 / buy_am * adj - 1
        limit_px = np.round(c_raw * (1 + lmt), 2)
        limit_touch = hi_am >= limit_px - 1e-6
        hit3 = ret_high_am >= TARGET
        strat_ret = np.where(hit3, np.maximum(TARGET, ret_open), ret_open) - COST

        buy_d = c_close
        ret_high_d = h1 / buy_d - 1
        limit_touch_d = h1_raw >= limit_px - 1e-6
        hit3_d = ret_high_d >= TARGET
        strat_ret_d = np.where(hit3_d, np.maximum(TARGET, ret_open), ret_open) - COST

        zeros = np.zeros(n, dtype=np.int64)
        overall.add(zeros, valid, ret_open, ret_high_am, ret_close, limit_touch, strat_ret)
        overall_day.add(zeros, valid, ret_open, ret_high_d, ret_close, limit_touch_d, strat_ret_d)
        cmp_minute.add(zeros, valid, ret_open, ret_high_am, ret_close, limit_touch, strat_ret)
        cmp_daily.add(zeros, valid, ret_open, ret_high_d, ret_close, limit_touch_d, strat_ret_d)

        hyinfo = hy_map.get(code) or {}
        aggs['board'].add(np.full(n, meta.get('board', ''), dtype=object), valid,
                          ret_open, ret_high_am, ret_close, limit_touch, strat_ret)
        aggs['hy'].add(np.full(n, hyinfo.get('hy_name', ''), dtype=object), valid,
                       ret_open, ret_high_am, ret_close, limit_touch, strat_ret)

        drift = c_close / (buy_am / f[ii]) - 1
        drift_1430_close.extend(drift[valid].tolist())
        am_vs_day.extend((ret_high_am - ret_high_day_min)[valid].tolist())
        am_is_day_high.extend(
            (ret_high_am[valid] >= ret_high_day_min[valid] - 1e-9).astype(int).tolist())

        if args.dump_detail:
            for j in np.nonzero(valid)[0]:
                detail_rows.append({
                    'code': code, 'name': name, 'board': meta.get('board', ''),
                    'hy': hyinfo.get('hy_name', ''), 'date': int_to_ymd(int(d_dates[ii[j]])),
                    'entry_1430': round(float(entry_am[j]), 3),
                    'close': round(float(c_raw[j]), 3),
                    'next_date': int_to_ymd(int(d_dates[ii1[j]])),
                    'am_high_time': int(tm_am[j]),
                    'ret_high_am_pct': round(float(ret_high_am[j]) * 100, 3),
                    'ret_high_fullday_pct': round(float(ret_high_day_min[j]) * 100, 3),
                    'ret_high_daily_pct': round(float(ret_high_d[j]) * 100, 3),
                    'ret_open_pct': round(float(ret_open[j]) * 100, 3),
                })

        trades += int(valid.sum())
        if n_done % 500 == 0:
            print(f'  ... {n_done}/{len(codes)} 有效 {trades}')

    print(f'[done] 无分钟数据 {no_minute} 只；有效样本 {trades}')
    if not trades:
        print('[warn] 无有效样本，检查分钟数据覆盖范围')
        return 1

    os.makedirs(args.out_dir, exist_ok=True)
    for k, agg in aggs.items():
        write_csv(os.path.join(args.out_dir, f'bucket_{k}.csv'), agg.rows())
    write_csv(os.path.join(args.out_dir, 'compare_vs_daily.csv'),
              cmp_daily.rows() + cmp_minute.rows())
    if detail_rows:
        write_csv(os.path.join(args.out_dir, 'minute_detail.csv'), detail_rows)

    drift_arr = np.asarray(drift_1430_close, dtype=np.float64)
    amd_arr = np.asarray(am_vs_day, dtype=np.float64)
    summary = {
        'trades': trades,
        'minute_dates': sorted(int_to_ymd(d) for d in minute_dates_seen),
        'snapshot_date': snap_date,
        'target': TARGET, 'cost': COST,
        'overall_minute': (overall.rows() or [{}])[0],
        'overall_daily_approx': (overall_day.rows() or [{}])[0],
        'validation': {
            'drift_1430_to_close': pct_stats(drift_arr),
            'morning_high_minus_fullday_high': pct_stats(amd_arr),
            'share_morning_is_day_high': round(float(np.mean(am_is_day_high)) * 100, 2),
            'abs_drift_over_1pct_share': round(
                float(np.mean(np.abs(drift_arr) > 0.01)) * 100, 2),
        },
        'caveats': [
            '分钟数据为通达信本地 .lc1（1 分钟），可用窗口就是 minute_dates 列出的交易日',
            '入场价 = T 日 14:30 分钟收盘价；卖出主口径 = T+1 开盘价',
            '收益用前复权因子换算为可比价；涨跌停判定用不复权价',
            '名称/流通市值/ST 取最近快照（当前口径看历史）',
        ],
    }
    with open(os.path.join(args.out_dir, 'summary.json'), 'w', encoding='utf-8') as fp:
        json.dump(summary, fp, ensure_ascii=False, indent=2)
    print(json.dumps({
        'overall_minute': summary['overall_minute'],
        'overall_daily_approx': summary['overall_daily_approx'],
        'validation': summary['validation'],
        'minute_dates': [summary['minute_dates'][0], summary['minute_dates'][-1]],
        'n_dates': len(summary['minute_dates']),
    }, ensure_ascii=False, indent=2))
    print(f'[out] {args.out_dir}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
