#!/usr/bin/env python
# -*- coding: utf-8 -*-
r"""修正 bt_trade.touchedLimit（T 日盘中触板未封）并重建 bt_stat[dimension='flag']。

背景（2026-09-21 发现）
-----------------------
``tools/late_buy_next_morning.py`` 旧版把**不复权最高价**与**前复权前收盘价**
相比来判断「T 日盘中触及涨停」：

    touched_limit = raw['high'] >= round(ind['prev_close'] * (1 + lmt), 2)

复权因子大于 1 的股票会被系统性误判（万科 A 复权因子 ~1.05 → 31% 的交易日
「触板」；工商银行 ~1.17 → 65%，实际应为 0）。2021-01~2026-09 的 2% 抽样本里
有 26.6% 落在「触板未封」分档，明显失真。

修正口径：raw 最高价 vs **raw 前收盘价**（同标度、按 0.01 元最小变动价位取整），
并与 ``~is_limit_up``（当日已封板）取交集，与 ``late_buy_next_morning_tf.py``
的口径一致。

本脚本不需要重跑整条回测链，只做两件事：

1. 按 (code, date) 重算 runId 对应明细行的 ``touchedLimit``；
2. 用修正后的明细重建 ``bt_stat[dimension='flag']``（2% 抽样口径，注明来源）。

用法::

    python tools\fix_touched_limit.py --run 1 --dry-run
    python tools\fix_touched_limit.py --run 1
"""
import argparse
import json
import os
import sqlite3
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from backtest_store import (DAILY_BASE_HIT3, DEFAULT_DB, STAT_SQL, connect,  # noqa: E402
                            now_iso, stat_tuple)
from indicators import compute_indicators, limit_ratio_series  # noqa: E402
from kdata import Market  # noqa: E402
from late_buy_next_morning import KeyAgg, load_factors  # noqa: E402

NOTE = ('2% 抽样明细重算（tools/fix_touched_limit.py）：T 日盘中触板未封 = '
        'raw 最高价 ≥ round(raw 前收盘 ×(1+涨跌停比例), 2) 且当日未封板。')
CACHE = os.path.join(os.path.dirname(os.path.abspath(DEFAULT_DB)), 'backtest',
                     '_cache', 'touched-limit-fix.json')


def log(msg: str) -> None:
    print(msg, flush=True)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description='修正 touchedLimit 并重建 flag 分档')
    ap.add_argument('--db', default=DEFAULT_DB)
    ap.add_argument('--run', type=int, default=1, help='runId（默认 1=日线近似）')
    ap.add_argument('--dry-run', action='store_true', help='只统计不写库')
    ap.add_argument('--cache', default=CACHE, help='(tradeId → 新值) 缓存路径')
    ap.add_argument('--no-cache', action='store_true', help='忽略缓存强制重算')
    args = ap.parse_args(argv)

    conn = connect(args.db)
    rows = conn.execute(
        'SELECT tradeId, code, date, touchedLimit, isLimitUp, retHigh, retOpen, '
        'retClose, stratRet, limitTouch FROM bt_trade WHERE runId=?',
        (args.run,)).fetchall()
    if not rows:
        log(f'[skip] runId={args.run} 没有明细行')
        return 1
    by_code: dict[str, list[tuple]] = {}
    for r in rows:
        by_code.setdefault(str(r[1]), []).append(r)
    log(f'[in] runId={args.run} 明细 {len(rows)} 行 / {len(by_code)} 只代码')

    updates: list[tuple] = []
    changed = 0
    t0 = time.time()
    cache: dict[str, int] = {}
    if args.cache and not args.no_cache and os.path.exists(args.cache):
        with open(args.cache, encoding='utf-8') as fh:
            cache = {str(k): int(v) for k, v in json.load(fh).items()}
        log(f'[cache] 命中 {len(cache)} 条 {args.cache}')
    if len(cache) < len(rows):
        market = Market()
        factors = load_factors()
        order = sorted(by_code)
        for k, code in enumerate(order):
            items = by_code[code]
            try:
                raw = market.load(code, 'raw')
                qfq = market.load(code, 'qfq', factors.get(code))
            except Exception as exc:  # noqa: BLE001
                log(f'  [warn] {code} 读取失败：{exc}')
                continue
            ind = compute_indicators(qfq, code)
            dates = raw['date'].astype(np.int64)
            pos = {int(d): i for i, d in enumerate(dates)}
            lmt = limit_ratio_series(code, raw['high'], raw['low'],
                                     raw['close'].astype(np.float64))
            for trade_id, _code, date, old, *_ in items:
                i = pos.get(int(date))
                if i is None or i == 0:
                    continue
                pc_raw = float(raw['close'][i - 1])
                if not np.isfinite(pc_raw) or pc_raw <= 0:
                    continue
                hit = float(raw['high'][i]) >= np.round(pc_raw * (1 + float(lmt[i])), 2) - 1e-6
                sealed = bool(ind['is_limit_up'][i])
                cache[str(int(trade_id))] = 1 if (hit and not sealed) else 0
            if (k + 1) % 500 == 0:
                log(f'  ... {k + 1}/{len(order)} 只  用时 {time.time() - t0:.0f}s')
        if args.cache:
            os.makedirs(os.path.dirname(args.cache), exist_ok=True)
            with open(args.cache, 'w', encoding='utf-8') as fh:
                json.dump(cache, fh)
            log(f'[cache] 写入 {len(cache)} 条 {args.cache}')
    for r in rows:
        tid = int(r[0])
        if str(tid) not in cache:
            continue
        new = cache[str(tid)]
        if int(r[3] or 0) != new:
            changed += 1
        updates.append((new, tid))
    log(f'[scan] 需改写 {changed} 行 / 共 {len(updates)} 行  用时 {time.time() - t0:.0f}s')

    base = DAILY_BASE_HIT3
    overall = conn.execute(
        "SELECT hit3Pct FROM bt_stat WHERE runId=? AND dimension='overall' LIMIT 1",
        (args.run,)).fetchone()
    if overall and overall[0]:
        base = float(overall[0])

    # 用修正后的明细重建 flag 分档
    fix = {tid: new for new, tid in updates}
    agg = KeyAgg()
    keys: list[str] = []
    arrays: dict[str, list[float]] = {
        'ret_open': [], 'ret_high': [], 'ret_close': [], 'strat': [], 'limit': []}
    for r in rows:
        tid = int(r[0])
        new = fix.get(tid, int(r[3] or 0))
        keys.append('T日盘中触板未封' if new else '普通')
        # 注意 SELECT 顺序：0 tradeId / 1 code / 2 date / 3 touchedLimit /
        # 4 isLimitUp / 5 retHigh / 6 retOpen / 7 retClose / 8 stratRet / 9 limitTouch
        arrays['ret_high'].append(float(r[5] or 0.0) / 100.0)
        arrays['ret_open'].append(float(r[6] or 0.0) / 100.0)
        arrays['ret_close'].append(float(r[7] or 0.0) / 100.0)
        arrays['strat'].append(float(r[8] or 0.0) / 100.0)
        arrays['limit'].append(float(r[9] or 0))
    valid = np.ones(len(rows), dtype=bool)
    arr = {k: np.asarray(v, dtype=float) for k, v in arrays.items()}
    agg.add(np.asarray(keys, dtype=object), valid, arr['ret_open'], arr['ret_high'],
            arr['ret_close'], arr['limit'], arr['strat'])
    stat_rows = agg.rows()
    log('[flag] 修正后分档：')
    for r in stat_rows:
        log('  %-14s n=%-8s ≥3%%=%-7s 涨停%%=%-6s' % (
            r['bucket'], r['n'], r['ge3_pct'], r['limit_pct']))

    if args.dry_run:
        log('[dry-run] 未写库')
        conn.close()
        return 0

    conn.executemany('UPDATE bt_trade SET touchedLimit=? WHERE tradeId=?', updates)
    conn.execute("DELETE FROM bt_stat WHERE runId=? AND dimension='flag'", (args.run,))
    conn.executemany(STAT_SQL, [stat_tuple(args.run, 'flag', r, base, NOTE)
                                for r in stat_rows])
    conn.execute('INSERT OR REPLACE INTO bt_meta(key,value,updatedAt) VALUES(?,?,?)',
                 ('touchedLimitFix', '{"runId":%d,"fixedRows":%d,"base":%s,"note":"%s"}'
                  % (args.run, changed, base, NOTE), now_iso()))
    conn.commit()
    log(f'[write] bt_trade 改写 {len(updates)} 行；bt_stat flag {len(stat_rows)} 档'
        f'（基准 {base}%）')
    conn.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
