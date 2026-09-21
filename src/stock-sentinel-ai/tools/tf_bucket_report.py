# -*- coding: utf-8 -*-
"""从 ``data/backtest.db`` 重算多周期形态批次的分档报表。

为什么不在分片脚本里直接出报表
------------------------------
全量回测按股票池分片并发（每片写自己的库文件），分片级 CSV 无法直接相加
（中位数 / 盈亏比不是可加量）。合成主库后由本脚本**以库为唯一数据源**
重算全部维度，口径与 ``late_buy_next_morning_tf.py`` 完全一致
（复用 ``late_buy_next_morning`` 的 ``BaseAgg/IndexAgg/KeyAgg``）。

输出（默认 ``data/backtest/late-buy-next-morning-tf/``）
--------------------------------------------------------
* ``bucket_overall.csv`` / ``bucket_year.csv`` / ``bucket_board.csv`` / ``bucket_hy.csv``
* ``bucket_day_shape.csv`` / ``bucket_channel.csv`` / ``bucket_ma_align.csv``
* ``bucket_turnover.csv`` / ``bucket_vol_ratio_intraday.csv`` / ``bucket_pos120.csv``
* ``bucket_atr_pct.csv`` / ``bucket_amount_wan.csv`` / ``bucket_float_mcap_yi.csv``
* ``bucket_tf_align.csv`` / ``bucket_tf_align_score.csv``
* ``bucket_tf5|15|30|60.csv``（各周期主形态）、``pattern_period.csv``（形态 × 周期汇总）
* ``summary.json``
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import backtest_store as store                          # noqa: E402
import tf_patterns as tfp                               # noqa: E402
from late_buy_next_morning import (IndexAgg, KeyAgg,    # noqa: E402
                                   bucket_index, bucket_labels, write_csv)

ROOT = os.path.normpath(os.path.join(HERE, '..'))
OUT_DEFAULT = os.path.join(ROOT, 'data', 'backtest', 'late-buy-next-morning-tf')

EDGES = {
    'turnover': np.array([0, 0.3, 0.6, 1.0, 1.5, 2.5, 4.0, 7.0, 12.0, 1e9]),
    'vol_ratio_intraday': np.array([0, 0.5, 0.7, 0.9, 1.1, 1.3, 1.6, 2.2, 3.5, 100]),
    'pos120': np.array([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.65, 0.8, 0.9, 1.0001]),
    'tf_align_score': np.array([-9, -4, -2, -1, 0, 1, 2, 4, 9]),
    'atr_pct': np.array([0, 1, 2, 3, 4, 6, 9, 15, 100]),
    'float_mcap_yi': np.array([0, 20, 50, 100, 200, 500, 1000, 1e9]),
    'amount_wan': np.array([0, 1000, 3000, 6000, 12000, 30000, 80000, 1e9]),
}

TRADE_COLS = ('tradeId', 'code', 'date', 'dayShape', 'channelType', 'board', 'maAlign',
              'tfAlign', 'tfAlignScore', 'turnoverPct', 'volRatioIntraday', 'pos120',
              'atrPct', 'amountWan', 'floatMcapYi', 'retOpen', 'retHigh', 'retClose',
              'limitTouch', 'hit3', 'stratRet')


def _nan(v) -> float:
    return float('nan') if v is None else float(v)


def load_trades(conn: sqlite3.Connection, rid: int) -> dict:
    rows = conn.execute(
        f'SELECT {",".join(TRADE_COLS)} FROM bt_trade WHERE runId=? ORDER BY date, code',
        (rid,)).fetchall()
    out: dict[str, np.ndarray] = {}
    for k, col in enumerate(TRADE_COLS):
        vals = [r[k] for r in rows]
        if col in ('code', 'dayShape', 'channelType', 'board', 'maAlign', 'tfAlign'):
            out[col] = np.array([('' if v is None else str(v)) for v in vals], dtype=object)
        elif col in ('tradeId', 'date', 'limitTouch', 'hit3', 'tfAlignScore'):
            out[col] = np.array([(0 if v is None else int(v)) for v in vals], dtype=np.int64)
        else:
            out[col] = np.array([_nan(v) for v in vals], dtype=np.float64)
    return out


def load_pattern_hits(conn: sqlite3.Connection, rid: int,
                      tids: np.ndarray) -> tuple[dict, dict]:
    """bt_trade_tf → {period: {patternId: bool mask}} 与 {period: 主形态 keys}。"""
    pos = {int(t): i for i, t in enumerate(tids)}
    n = len(tids)
    hits: dict[int, dict[str, np.ndarray]] = {p: {} for p in tfp.PERIODS}
    prim: dict[int, np.ndarray] = {p: np.full(n, '', dtype=object) for p in tfp.PERIODS}
    q = 'SELECT tradeId, period, patterns, primaryPattern FROM bt_trade_tf WHERE runId=?'
    for tid, period, pats, pp in conn.execute(q, (rid,)):
        i = pos.get(int(tid))
        if i is None or int(period) not in hits:
            continue
        p = int(period)
        if pp:
            prim[p][i] = str(pp)
        if not pats:
            continue
        for pid in str(pats).split(','):
            pid = pid.strip()
            if not pid:
                continue
            arr = hits[p].get(pid)
            if arr is None:
                arr = np.zeros(n, dtype=bool)
                hits[p][pid] = arr
            arr[i] = True
    return hits, prim


def main() -> int:
    ap = argparse.ArgumentParser(description='多周期形态批次分档报表（读库重算）')
    ap.add_argument('--db', default=store.DEFAULT_DB)
    ap.add_argument('--out-dir', default=OUT_DEFAULT)
    ap.add_argument('--run-key', default=store.RUN_TF)
    ap.add_argument('--quiet', action='store_true')
    args = ap.parse_args()

    conn = sqlite3.connect(args.db)
    rid = store.run_id(conn, args.run_key)
    t = load_trades(conn, rid)
    n = len(t['tradeId'])
    if not n:
        print(f'[report] runId={rid} 无明细数据')
        return 1
    valid = np.ones(n, dtype=bool)
    ret_open = t['retOpen'] / 100.0
    ret_high = t['retHigh'] / 100.0
    ret_close = t['retClose'] / 100.0
    strat = t['stratRet'] / 100.0
    limit_touch = t['limitTouch'].astype(bool)

    overall = IndexAgg(['分钟精确'])
    overall.add(np.zeros(n, dtype=np.int64), valid, ret_open, ret_high, ret_close,
                limit_touch, strat)
    aggs = {k: IndexAgg(bucket_labels(e)) for k, e in EDGES.items()}
    aggs['year'] = KeyAgg()
    aggs['board'] = KeyAgg()
    aggs['hy'] = KeyAgg()
    aggs['day_shape'] = KeyAgg()
    aggs['channel'] = KeyAgg()
    aggs['ma_align'] = KeyAgg()
    aggs['tf_align'] = KeyAgg()

    def add(key, arr):
        aggs[key].add(arr, valid, ret_open, ret_high, ret_close, limit_touch, strat)

    add('turnover', bucket_index(t['turnoverPct'], EDGES['turnover']))
    add('vol_ratio_intraday', bucket_index(t['volRatioIntraday'],
                                           EDGES['vol_ratio_intraday']))
    add('pos120', bucket_index(t['pos120'], EDGES['pos120']))
    add('tf_align_score', bucket_index(t['tfAlignScore'].astype(float),
                                       EDGES['tf_align_score']))
    add('atr_pct', bucket_index(t['atrPct'], EDGES['atr_pct']))
    add('amount_wan', bucket_index(t['amountWan'], EDGES['amount_wan']))
    add('float_mcap_yi', bucket_index(t['floatMcapYi'], EDGES['float_mcap_yi']))
    add('year', np.array([str(int(d) // 10000) for d in t['date']], dtype=object))
    add('board', t['board'])
    add('day_shape', t['dayShape'])
    add('channel', t['channelType'])
    add('ma_align', t['maAlign'])
    add('tf_align', t['tfAlign'])

    import tdx_sector
    hy_map = tdx_sector.load_industry_map()
    add('hy', np.array([(hy_map.get(c) or {}).get('hy_name', '') for c in t['code']],
                       dtype=object))

    hits, prim = load_pattern_hits(conn, rid, t['tradeId'])
    pat_rows: list[dict] = []
    per_period: dict[int, dict] = {}
    for p in tfp.PERIODS:
        agg = KeyAgg()
        agg.add(prim[p], valid, ret_open, ret_high, ret_close, limit_touch, strat)
        per_period[p] = agg
        for pid, mask in sorted(hits[p].items(), key=lambda kv: -int(kv[1].sum())):
            sub = IndexAgg([pid])
            sub.add(np.zeros(n, dtype=np.int64), mask, ret_open, ret_high, ret_close,
                    limit_touch, strat)
            if not sub.slots:
                continue
            row = sub.rows()[0]
            row['period'] = p
            row['patternId'] = pid
            # 该聚合只喂了命中样本，share 恒为 1；这里改成「占全样本比例」才有意义。
            row['share'] = round(row['n'] / n, 4) if n else 0.0
            pat_rows.append(row)

    os.makedirs(args.out_dir, exist_ok=True)
    for k, agg in aggs.items():
        write_csv(os.path.join(args.out_dir, f'bucket_{k}.csv'), agg.rows())
    for p in tfp.PERIODS:
        write_csv(os.path.join(args.out_dir, f'bucket_tf{p}.csv'), per_period[p].rows())
    if pat_rows:
        cols = ['period', 'patternId'] + [c for c in pat_rows[0]
                                          if c not in ('period', 'patternId')]
        write_csv(os.path.join(args.out_dir, 'pattern_period.csv'),
                  [{c: r.get(c) for c in cols} for r in pat_rows])
    ov = overall.rows()[0]
    summary = {
        'runKey': args.run_key, 'runId': rid, 'trades': n,
        'tfRows': conn.execute('SELECT COUNT(*) FROM bt_trade_tf WHERE runId=?',
                               (rid,)).fetchone()[0],
        'dates': [int(t['date'].min()), int(t['date'].max())],
        'nDates': int(len(np.unique(t['date']))),
        'stocks': int(len(np.unique(t['code']))),
        'overall': ov,
        'caveats': store.GLOBAL_CAVEATS,
    }
    with open(os.path.join(args.out_dir, 'summary.json'), 'w', encoding='utf-8') as fp:
        json.dump(summary, fp, ensure_ascii=False, indent=2)
    if not args.quiet:
        print(f'[report] runId={rid} 明细 {n} 笔 / 快照 {summary["tfRows"]} 行 / '
              f'{summary["nDates"]} 个交易日 / {summary["stocks"]} 只股票')
        print(f'[report] 全样本 ≥3% = {ov.get("ge3_pct")}%  '
              f'（≥1% {ov.get("ge1_pct")}% / ≥5% {ov.get("ge5_pct")}% / '
              f'涨停 {ov.get("limit_pct")}%）')
        print(f'[out] {args.out_dir}')
    conn.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
