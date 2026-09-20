# -*- coding: utf-8 -*-
"""
RPS 横截面分位阈值预计算（Sequoia-X 的 RpsBreakout 策略需要）。

为什么要单独算
--------------
Sequoia-X 的 RPS 策略是横截面口径：拿最后一个交易日全市场的「近 120 日涨幅」排名，
取百分位 >= 90 的股票，再看它是否站上 120 日最高的 90%。本项目回测引擎
（tools/xingtaidu_backtest.py）是逐只股票处理的，单只股票看不到其他股票，所以这里把
「每个交易日全市场的 90 分位阈值」离线算好并缓存，回测时按日期对齐注入。

口径
----
* 复权：与回测一致，用 data/kline-full.db 的 qfq 因子（前复权）。
* 股票池：本地通达信日线中上市满 MIN_BARS(250) 根的沪深个股（与回测候选池一致）。
* 阈值：每个交易日全市场「近 period(120) 日涨幅」的 QUANTILE(90) 分位（小数）。
* 与 pandas rank(pct=True)*100 >= 90 的差异：这里用 numpy 线性插值分位，并列值情形下
  最多差 1 个名次，不影响结论（已在 docs 中标注）。

用法
----
    python tools/rps_threshold.py --start 2021-01-01 --end 2026-09-18
缓存文件：data/backtest/xingtaidu/rps/rps120_p90_<start>_<end>.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from kdata import Market, int_to_ymd, ymd_to_int  # noqa: E402

PERIOD = 120
QUANTILE = 90.0
MIN_BARS = 250
CACHE_DIR = os.path.normpath(os.path.join(
    HERE, '..', 'data', 'backtest', 'xingtaidu', 'rps'))


def cache_path(start_int: int, end_int: int,
               period: int = PERIOD, quantile: float = QUANTILE) -> str:
    return os.path.join(CACHE_DIR, f'rps{int(period)}_p{int(quantile)}_{start_int}_{end_int}.json')


def build(market, factors, start_int: int, end_int: int,
          period: int = PERIOD, quantile: float = QUANTILE,
          codes=None, progress: bool = False) -> dict:
    """计算 [start_int, end_int] 内每个交易日的横截面分位阈值。"""
    codes = list(codes) if codes else market.codes(min_bars=MIN_BARS)
    d_chunks, r_chunks = [], []
    for no, code in enumerate(codes, 1):
        bars = market.load(code, 'qfq', (factors or {}).get(code))
        if len(bars) <= period:
            continue
        c = np.asarray(bars['close'], dtype=np.float64)
        d = np.asarray(bars['date'], dtype=np.int64)[period:]
        with np.errstate(invalid='ignore', divide='ignore'):
            ret = c[period:] / c[:-period] - 1.0
        keep = (d >= start_int) & (d <= end_int) & np.isfinite(ret)
        if keep.any():
            d_chunks.append(d[keep])
            r_chunks.append(ret[keep])
        if progress and no % 1000 == 0:
            print(f'  已扫描 {no}/{len(codes)} 只', file=sys.stderr)
    if not d_chunks:
        return {'period': int(period), 'quantile': float(quantile),
                'start': int(start_int), 'end': int(end_int),
                'universe': f'qfq_min_bars_{MIN_BARS}',
                'dates': [], 'values': [], 'counts': []}
    d_all = np.concatenate(d_chunks)
    r_all = np.concatenate(r_chunks)
    order = np.argsort(d_all, kind='stable')
    d_sorted, r_sorted = d_all[order], r_all[order]
    uniq, starts = np.unique(d_sorted, return_index=True)
    bounds = np.append(starts, len(d_sorted))
    values = np.empty(len(uniq), dtype=np.float64)
    counts = np.empty(len(uniq), dtype=np.int64)
    for i in range(len(uniq)):
        seg = r_sorted[bounds[i]:bounds[i + 1]]
        values[i] = np.percentile(seg, quantile)
        counts[i] = len(seg)
    return {'period': int(period), 'quantile': float(quantile),
            'start': int(start_int), 'end': int(end_int),
            'universe': f'qfq_min_bars_{MIN_BARS}',
            'dates': [int(x) for x in uniq],
            'values': [round(float(x), 6) for x in values],
            'counts': [int(x) for x in counts]}


def save(table: dict, path: str) -> str:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(table, f, ensure_ascii=False)
    os.replace(tmp, path)          # 原子替换：并行分片同时写也不会读到半个文件
    return path


def load(path: str):
    with open(path, encoding='utf-8') as f:
        t = json.load(f)
    return (np.asarray(t['dates'], dtype=np.int64),
            np.asarray(t['values'], dtype=np.float64))


def load_or_build(market, factors, start_int: int, end_int: int,
                  period: int = PERIOD, quantile: float = QUANTILE,
                  path: str | None = None, rebuild: bool = False):
    """返回 (dates, values)；缓存存在则直接读，不存在则算完写缓存。"""
    path = path or cache_path(start_int, end_int, period, quantile)
    if os.path.exists(path) and not rebuild:
        try:
            return load(path)
        except (json.JSONDecodeError, KeyError, ValueError):
            pass                                   # 缓存损坏 → 重算
    table = build(market, factors, start_int, end_int, period, quantile,
                  progress=True)
    save(table, path)
    if not table['dates']:
        raise RuntimeError(f'RPS 阈值表为空（{start_int}~{end_int}）：请检查行情数据')
    return (np.asarray(table['dates'], dtype=np.int64),
            np.asarray(table['values'], dtype=np.float64))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--start', default='2021-01-01')
    ap.add_argument('--end', default='2026-09-18')
    ap.add_argument('--period', type=int, default=PERIOD)
    ap.add_argument('--quantile', type=float, default=QUANTILE)
    ap.add_argument('--rebuild', action='store_true')
    a = ap.parse_args(argv)
    mkt = Market(min_bars=MIN_BARS)
    factors = {}
    db = os.path.normpath(os.path.join(HERE, '..', 'data', 'kline-full.db'))
    if os.path.exists(db):
        import sqlite3
        from collections import defaultdict
        conn = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
        acc = defaultdict(list)
        for code, ex_date, factor in conn.execute(
                'SELECT code, ex_date, factor FROM adj_factors'):
            acc[code].append((ex_date, factor))
        conn.close()
        factors = dict(acc)
    start_int, end_int = ymd_to_int(a.start), ymd_to_int(a.end)
    path = cache_path(start_int, end_int, a.period, a.quantile)
    if os.path.exists(path) and not a.rebuild:
        dates, _ = load(path)
        print(f'缓存已存在：{path}（{len(dates)} 个交易日，'
              f'{int_to_ymd(int(dates[0]))}~{int_to_ymd(int(dates[-1]))}）')
        return 0
    table = build(mkt, factors, start_int, end_int, a.period, a.quantile, progress=True)
    save(table, path)
    dates = table['dates']
    print(f'已生成 {path}：{len(dates)} 个交易日，'
          f'股票池 {len(mkt.codes(min_bars=MIN_BARS))} 只，'
          f'单日参与排名最多 {max(table["counts"]) if dates else 0} 只')
    if dates:
        print(f'区间 {int_to_ymd(dates[0])} ~ {int_to_ymd(dates[-1])}，'
              f'阈值区间 {min(table["values"]):.4f} ~ {max(table["values"]):.4f}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
