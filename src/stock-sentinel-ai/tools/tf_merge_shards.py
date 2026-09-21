# -*- coding: utf-8 -*-
"""把多周期形态分片库合并回主库 ``data/backtest.db``。

背景
----
SQLite 不支持多写入者并发写同一个库文件（同一时刻只允许一个写事务，
第二个写入者会直接拿到 ``database is locked``）。因此全量回测按股票池
分片、**每片写自己的库文件**，最后用本脚本合并。

合并口径
--------
* ``bt_trade`` 的 ``tradeId`` 是自增代理键，各分片会重复；
  合并时**不复制原 tradeId**，由主库重新分配；
* ``bt_trade_tf`` 通过 ``(runId, code, date)`` 关联回主库新分配的
  ``tradeId`` —— 一个批次内 (股票, 交易日) 唯一，故关联是确定的；
* 合并后逐项校验：行数、唯一性、孤儿引用。

用法::

    python tools\\tf_merge_shards.py --db data\\backtest.db \\
        --shard data\\backtest\\_shard_tf_0.db --shard data\\backtest\\_shard_tf_1.db
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import backtest_store as store                          # noqa: E402

RUN_TF = store.RUN_TF


def columns(conn: sqlite3.Connection, table: str) -> list[str]:
    return [r[1] for r in conn.execute(f'PRAGMA table_info("{table}")')]


def main() -> int:
    ap = argparse.ArgumentParser(description='合并多周期形态分片库')
    ap.add_argument('--db', default=store.DEFAULT_DB)
    ap.add_argument('--shard', action='append', default=[])
    ap.add_argument('--keep-shards', action='store_true', help='合并后保留分片库')
    args = ap.parse_args()
    if not args.shard:
        print('未提供 --shard')
        return 2

    conn = store.connect(args.db)
    rid = store.run_id(conn, RUN_TF)
    conn.execute('DELETE FROM bt_trade_tf WHERE runId=?', (rid,))
    conn.execute('DELETE FROM bt_trade WHERE runId=?', (rid,))
    conn.commit()
    print(f'[merge] 主库 {args.db} runId={rid}（{RUN_TF}）已清空同批次明细', flush=True)

    tcols = [c for c in columns(conn, 'bt_trade') if c != 'tradeId']
    fcols = [c for c in columns(conn, 'bt_trade_tf') if c != 'tradeId']
    print(f'[merge] bt_trade {len(tcols) + 1} 列 / bt_trade_tf {len(fcols) + 1} 列')

    want_trades = 0
    want_tf = 0
    for i, path in enumerate(args.shard):
        if not os.path.exists(path):
            print(f'[merge] 跳过（不存在）{path}')
            continue
        alias = f's{i}'
        conn.execute(f'ATTACH DATABASE ? AS {alias}', (os.path.abspath(path),))
        n_t = conn.execute(f'SELECT COUNT(*) FROM {alias}.bt_trade WHERE runId=?',
                           (rid,)).fetchone()[0]
        n_f = conn.execute(f'SELECT COUNT(*) FROM {alias}.bt_trade_tf WHERE runId=?',
                           (rid,)).fetchone()[0]
        conn.execute(
            f'INSERT INTO bt_trade ({",".join(tcols)}) '
            f'SELECT {",".join(tcols)} FROM {alias}.bt_trade WHERE runId=?', (rid,))
        conn.execute(
            f'INSERT INTO bt_trade_tf (tradeId,{",".join(fcols)}) '
            f'SELECT t.tradeId,{",".join("f." + c for c in fcols)} '
            f'FROM {alias}.bt_trade_tf f JOIN bt_trade t '
            f'  ON t.runId=f.runId AND t.code=f.code AND t.date=f.date '
            f'WHERE f.runId=?', (rid,))
        conn.commit()
        conn.execute(f'DETACH DATABASE {alias}')
        want_trades += n_t
        want_tf += n_f
        print(f'[merge] {os.path.basename(path)}: 明细 {n_t} 笔 / 快照 {n_f} 行', flush=True)

    got_t = conn.execute('SELECT COUNT(*) FROM bt_trade WHERE runId=?', (rid,)).fetchone()[0]
    got_f = conn.execute('SELECT COUNT(*) FROM bt_trade_tf WHERE runId=?', (rid,)).fetchone()[0]
    dup = conn.execute('SELECT COUNT(*) - COUNT(DISTINCT code || "|" || date) '
                       'FROM bt_trade WHERE runId=?', (rid,)).fetchone()[0]
    orphan = conn.execute('SELECT COUNT(*) FROM bt_trade_tf f LEFT JOIN bt_trade t '
                          'ON t.tradeId=f.tradeId WHERE f.runId=? AND t.tradeId IS NULL',
                          (rid,)).fetchone()[0]
    miss = conn.execute('SELECT COUNT(*) FROM bt_trade t WHERE t.runId=? AND NOT EXISTS '
                        '(SELECT 1 FROM bt_trade_tf f WHERE f.tradeId=t.tradeId)',
                        (rid,)).fetchone()[0]

    def show(label, got, want, ok):
        print(f'  [{"OK  " if ok else "FAIL"}] {label:<24} 实际={got}  期望={want}')
        return 0 if ok else 1

    bad = 0
    print('== 合并校验')
    bad += show('bt_trade 行数', got_t, want_trades, got_t == want_trades)
    bad += show('bt_trade_tf 行数', got_f, want_tf, got_f == want_tf)
    bad += show('(code,date) 唯一', dup, 0, dup == 0)
    bad += show('bt_trade_tf 孤儿行', orphan, 0, orphan == 0)
    bad += show('无快照的明细行', miss, 0, miss == 0)
    ratio = round(got_f / got_t, 4) if got_t else 0
    print(f'  [info] 每笔平均周期快照数 {ratio}（4 周期齐备时应等于 4）')
    perm = conn.execute('SELECT COUNT(DISTINCT code) FROM bt_trade_tf '
                        'WHERE runId=? AND period=5', (rid,)).fetchone()[0]
    print(f'  [info] 覆盖股票 {perm} 只')

    if bad == 0 and not args.keep_shards:
        conn.commit()
        conn.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        conn.close()
        for path in args.shard:
            for suffix in ('', '-wal', '-shm'):
                p = path + suffix
                if os.path.exists(p):
                    os.remove(p)
        print('[merge] 已删除分片库')
    else:
        conn.close()
    print(f'== 结论：{"全部通过" if bad == 0 else str(bad) + " 项不符"}')
    return bad


if __name__ == '__main__':
    raise SystemExit(main())
