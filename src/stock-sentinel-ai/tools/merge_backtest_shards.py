# -*- coding: utf-8 -*-
"""合并 late_buy_next_morning.py 的分片结果（--dump-raw 产出的 raw_*.json）。

用法::

    python tools/merge_backtest_shards.py --shards data/backtest/shard0 data/backtest/shard1 --out-dir data/backtest/late-buy-next-morning
"""
from __future__ import annotations

import argparse
import json
import os

import numpy as np

from late_buy_next_morning import IndexAgg, KeyAgg, write_csv

SUM_KEYS = ('sum_open', 'sum_high', 'sum_close', 'sum_strat', 'sum_pos', 'sum_neg')
CONCAT_FILES = ('trade_sample.csv', 'hit_sample.csv', 'focus_picks.csv')
## 分片间「同一全股票池口径」的字段：各分片取值相同，合并时取首个非空值
POOL_KEYS = ('universe', 'snapshot_date', 'delist_scope', 'delist_cutoff',
             'delist_grace_days', 'delisted_dropped', 'st_dropped',
             'excluded_industry', 'excluded_industry_size', 'target', 'cost')
## 分片间需要累加的字段
SUM_INT_KEYS = ('delisted_trades_dropped',)
SUM_DICT_KEYS = ('float_shares_src',)


def new_slot() -> dict:
    return IndexAgg([])._new()


def merge_raw(paths: list) -> tuple:
    labels: list = []
    merged: dict = {}
    for p in paths:
        with open(p, 'r', encoding='utf-8') as f:
            raw = json.load(f)
        if not labels:
            labels = raw.get('labels') or []
        for key, s in raw['slots'].items():
            t = merged.get(key)
            if t is None:
                t = new_slot()
                merged[key] = t
            t['n'] += int(s['n'])
            t['limit'] += int(s['limit'])
            t['ge'] += np.asarray(s['ge'], dtype=np.int64)
            for name, val in zip(SUM_KEYS, s['sums']):
                t[name] += float(val)
            t['hist_high'] += np.asarray(s['hist_high'], dtype=np.int64)
            t['hist_open'] += np.asarray(s['hist_open'], dtype=np.int64)
            t['hist_strat'] += np.asarray(s.get('hist_strat') or np.zeros_like(t['hist_high']),
                                          dtype=np.int64)
    return labels, merged


def out_name(key: str) -> str:
    if key == 'date':
        return 'by_date.csv'
    if key == 'overall':
        return 'bucket_overall.csv'
    return 'bucket_' + key + '.csv'


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--shards', nargs='+', required=True)
    ap.add_argument('--out-dir', required=True)
    args = ap.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    names = sorted(n[4:-5] for n in os.listdir(args.shards[0])
                   if n.startswith('raw_') and n.endswith('.json'))
    if not names:
        print('[error] 分片目录里没有 raw_*.json')
        return 1

    aggs: dict = {}
    for name in names:
        paths = [os.path.join(d, 'raw_' + name + '.json') for d in args.shards]
        missing = [p for p in paths if not os.path.exists(p)]
        if missing:
            print('[warn] 缺少分片文件，跳过 ' + name + ': ' + str(missing))
            continue
        labels, merged = merge_raw(paths)
        if labels:
            agg = IndexAgg(labels)
            agg.slots = {int(k): v for k, v in merged.items()}
        else:
            agg = KeyAgg()
            agg.slots = merged
        aggs[name] = agg
        write_csv(os.path.join(args.out_dir, out_name(name)), agg.rows())

    trades = 0
    snap_date = ''
    pool: dict = {}
    int_sums: dict = {k: 0 for k in SUM_INT_KEYS}
    dict_sums: dict = {k: {} for k in SUM_DICT_KEYS}
    for d in args.shards:
        p = os.path.join(d, 'summary.json')
        if os.path.exists(p):
            with open(p, 'r', encoding='utf-8') as f:
                s = json.load(f)
            trades += int(s.get('trades') or 0)
            snap_date = snap_date or s.get('snapshot_date', '')
            for k in POOL_KEYS:
                if k not in pool and s.get(k) is not None:
                    pool[k] = s[k]
            for k in SUM_INT_KEYS:
                int_sums[k] += int(s.get(k) or 0)
            for k in SUM_DICT_KEYS:
                for kk, vv in (s.get(k) or {}).items():
                    dict_sums[k][kk] = dict_sums[k].get(kk, 0) + int(vv)

    for fn in CONCAT_FILES:
        parts: list = []
        header = None
        for d in args.shards:
            p = os.path.join(d, fn)
            if not os.path.exists(p):
                continue
            with open(p, 'r', encoding='utf-8-sig') as f:
                lines = f.read().rstrip('\n').split('\n')
            if not lines:
                continue
            if header is None:
                header = lines[0]
            parts.extend(lines[1:])
        if header is not None and parts:
            with open(os.path.join(args.out_dir, fn), 'w', encoding='utf-8-sig',
                      newline='') as f:
                f.write(header + '\n' + '\n'.join(parts) + '\n')
            print('[out] ' + fn + ' ' + str(len(parts)) + ' 行')

    summary = {
        'trades': trades,
        'snapshot_date': snap_date,
        'shards': list(args.shards),
        'overall': (aggs['overall'].rows() or [{}])[0] if 'overall' in aggs else {},
        'by_year': aggs['year'].rows() if 'year' in aggs else [],
        'by_flag': aggs['flag'].rows() if 'flag' in aggs else [],
    }
    for k, v in pool.items():
        summary.setdefault(k, v)
    summary['snapshot_date'] = snap_date
    for k in SUM_INT_KEYS:
        summary[k] = int_sums[k]
    for k in SUM_DICT_KEYS:
        summary[k] = dict_sums[k]
    with open(os.path.join(args.out_dir, 'summary.json'), 'w', encoding='utf-8') as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    print('[done] 合并 ' + str(len(args.shards)) + ' 个分片，有效样本 ' + str(trades))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
