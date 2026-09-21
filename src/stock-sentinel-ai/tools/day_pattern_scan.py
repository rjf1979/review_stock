# -*- coding: utf-8 -*-
"""日线形态证据扫描：给日线回测抽样本补算 31 条日线形态，并回填证据。

背景：``bt_trade`` 的日线批次（``daily-20210104-20260917-stockonly-d1``）只有
特征与次日结果，**没有** ``dayPatternMask`` / ``dayPatterns``（日线导入时留空），
所以形态证据不能直接从表里读，必须在本地通达信日线上重算一遍。

本工具做的事：

1. 读 ``bt_trade`` 抽样本的 ``(tradeId, code, date, hit3)``；
2. 逐只股票用 ``kdata.Market`` 载入前复权日线 → ``compute_indicators`` →
   ``patterns`` 注册表逐条 ``detect``（与多周期脚本口径完全一致）；
3. 统计每条形态的样本量、≥+3% 命中率、相对基准的 lift、分年命中率；
4. 回填 ``bt_pattern_def.evidence*``（日线口径）与 ``bt_trade.dayPatternMask``；
5. 导出 ``day_pattern_evidence.csv``。

用法::

    python tools/day_pattern_scan.py              # 全量扫描并回填
    python tools/day_pattern_scan.py --dry-run    # 只统计，不写库
    python tools/day_pattern_scan.py --limit-codes 200
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..'))
sys.path.insert(0, HERE)

import patterns as patterns_pkg                      # noqa: E402
from indicators import compute_indicators            # noqa: E402
from kdata import Market                             # noqa: E402
from late_buy_next_morning import load_factors       # noqa: E402

DEFAULT_DB = os.path.join(ROOT, 'data', 'backtest.db')
DEFAULT_CSV = os.path.join(ROOT, 'data', 'backtest', 'late-buy-next-morning-stock-only',
                           'day_pattern_evidence.csv')
RUN_DAILY = 'daily-20210104-20260917-stockonly-d1'


def log(msg: str) -> None:
    print(msg, flush=True)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description='日线形态证据扫描（回填 bt_pattern_def）')
    ap.add_argument('--db', default=DEFAULT_DB)
    ap.add_argument('--csv', default=DEFAULT_CSV)
    ap.add_argument('--limit-codes', type=int, default=0)
    ap.add_argument('--min-year-n', type=int, default=100)
    ap.add_argument('--workers', type=int, default=4,
                    help='并发线程数（形态库是纯 numpy，线程池可显著提速）')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args(argv)

    con = sqlite3.connect(args.db)
    rid = con.execute('SELECT runId FROM bt_run WHERE runKey=?', (RUN_DAILY,)).fetchone()
    if not rid:
        log(f'[err] 缺少日线批次 {RUN_DAILY}')
        return 1
    rid = rid[0]

    day_ids = list(patterns_pkg.ids())
    db_rows = con.execute(
        "SELECT patternId, bitIndex, category FROM bt_pattern_def WHERE periods='day' "
        "ORDER BY bitIndex").fetchall()
    db_bit = {pid: bit for pid, bit, _ in db_rows}
    db_cat = {pid: cat or '' for pid, _, cat in db_rows}
    if [pid for pid, _, _ in db_rows] != day_ids:
        log('[warn] bt_pattern_def 的位掩码顺序与注册表顺序不一致，'
            '位掩码按注册表顺序写，证据按 patternId 写')
    bit_of = {pid: i for i, pid in enumerate(day_ids)}
    cat_of = {pid: (patterns_pkg.get(pid).get('category') or '') for pid in day_ids}

    rows = con.execute(
        'SELECT tradeId, code, date, hit3 FROM bt_trade WHERE runId=? '
        'AND hit3 IS NOT NULL', (rid,)).fetchall()
    base = sum(int(r[3]) for r in rows) / len(rows) * 100
    log(f'[in] 日线批次 runId={rid}：{len(rows)} 笔抽样本，基准 ≥+3% = {base:.2f}%')

    by_code: dict[str, list[tuple]] = defaultdict(list)
    for trade_id, code, date, hit3 in rows:
        by_code[code].append((trade_id, int(date), int(hit3)))
    codes = sorted(by_code)
    if args.limit_codes:
        codes = codes[:args.limit_codes]
        keep = set(codes)
        by_code = {c: by_code[c] for c in codes}
        n_keep = sum(len(v) for v in by_code.values())
        log(f'[in] --limit-codes={args.limit_codes}：股票 {len(codes)} 只，'
            f'样本 {n_keep} 笔（全量比值 {n_keep / len(rows):.3f}）')

    market = Market()
    factors = load_factors()

    def scan_code(code: str):
        """返回 (code, [(tradeId, date, hit3, mask, patterns, categories)], 是否有日线)。"""
        rec = market.meta(code) or {}
        name = rec.get('name', '')
        try:
            bars = market.load(code, 'qfq', factors.get(code))
        except Exception as exc:                          # noqa: BLE001
            return code, [], f'载入失败：{exc}'
        market._cache.pop(code, None)                     # 控制内存
        if len(bars) < 130:
            return code, [], '日线不足 130 根'
        ind = compute_indicators(bars, code, name)
        date_arr = np.asarray(bars['date'], dtype=np.int64)
        pos = {int(d): i for i, d in enumerate(date_arr)}
        sigs = {}
        for pid in day_ids:
            try:
                sigs[pid] = patterns_pkg.detect(pid, ind)
            except Exception:                             # noqa: BLE001
                sigs[pid] = np.zeros(len(date_arr), dtype=bool)
        rows_out = []
        for trade_id, date, h in by_code[code]:
            i = pos.get(date)
            if i is None:
                continue
            mask = 0
            hits: list[str] = []
            cats: list[str] = []
            for pid in day_ids:
                if sigs[pid][i]:
                    mask |= 1 << bit_of[pid]
                    hits.append(pid)
                    cats.append(cat_of[pid])
            rows_out.append((trade_id, date, h, mask,
                             ','.join(hits), ','.join(sorted(set(
                                 c for c in cats if c)))))
        return code, rows_out, None

    cnt: dict = defaultdict(int)
    hit: dict = defaultdict(int)
    yr_n: dict = defaultdict(lambda: defaultdict(int))
    yr_hit: dict = defaultdict(lambda: defaultdict(int))

    mask_updates: list[tuple] = []
    n_rows_done = 0
    n_hit_total = 0
    n_codes_done = 0
    n_no_bars = 0
    t0 = time.time()

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as ex:
        for code, rows_out, err in ex.map(scan_code, codes):
            n_codes_done += 1
            if err:
                n_no_bars += 1
                log(f'  [warn] {code} {err}')
            for trade_id, date, h, mask, hits, cats in rows_out:
                n_rows_done += 1
                n_hit_total += h
                year = str(date // 10000)
                if hits:
                    for pid in hits.split(','):
                        cnt[pid] += 1
                        hit[pid] += h
                        yr_n[pid][year] += 1
                        yr_hit[pid][year] += h
                mask_updates.append((mask or None, hits or None, cats or None,
                                     trade_id))
            if n_codes_done % 400 == 0:
                log(f'  ... {n_codes_done}/{len(codes)} 只  已扫 {n_rows_done} 笔  '
                    f'用时 {time.time() - t0:.0f}s')

    log(f'[scan] 扫描完成：{n_codes_done} 只（无日线 {n_no_bars} 只），'
        f'覆盖样本 {n_rows_done} 笔，用时 {time.time() - t0:.0f}s')
    if not n_rows_done:
        log('[err] 没有可统计的样本')
        return 1

    base = n_hit_total / n_rows_done * 100
    log(f'[scan] 扫描样本基准 ≥+3% = {base:.2f}%（{n_rows_done} 笔）')

    out: list[dict] = []
    for pid in sorted(day_ids, key=lambda p: -(cnt.get(p, 0))):
        n = cnt.get(pid, 0)
        if not n:
            log(f'  [skip] {pid:<24} 样本 0')
            continue
        rate = hit[pid] / n * 100
        lift = rate / base
        ys = {y: yr_hit[pid][y] / yr_n[pid][y] * 100
              for y in sorted(yr_n[pid]) if yr_n[pid][y] >= args.min_year_n}
        usable = 1 if (n >= 1000 and lift >= 1.15 and len(ys) >= 4
                       and min(ys.values()) >= base * 0.9) else 0
        out.append({'patternId': pid, 'nameCn': patterns_pkg.get(pid)['name'],
                    'category': cat_of.get(pid, ''), 'n': n,
                    'sharePct': round(n / n_rows_done * 100, 2),
                    'baseHit3Pct': round(base, 2), 'hit3Pct': round(rate, 2),
                    'lift': round(lift, 3), 'years': len(ys), 'usable': usable,
                    'byYear': json.dumps({k: round(v, 2) for k, v in ys.items()},
                                         ensure_ascii=False)})

    os.makedirs(os.path.dirname(args.csv), exist_ok=True)
    cols = ['patternId', 'nameCn', 'category', 'n', 'sharePct', 'baseHit3Pct',
            'hit3Pct', 'lift', 'years', 'usable', 'byYear']
    with open(args.csv, 'w', encoding='utf-8-sig', newline='') as f:
        f.write(','.join(cols) + '\n')
        for r in out:
            f.write(','.join(f'"{r[c]}"' if ',' in str(r[c]) else str(r[c])
                             for c in cols) + '\n')
    log(f'[out] {args.csv}（{len(out)} 条形态）')

    log('')
    log(f'{"形态":<26}{"样本":>9}{"占比%":>8}{"≥3%":>8}{"lift":>8}{"年数":>6}{"可用":>6}')
    for r in out:
        log(f'{r["nameCn"][:12]:<26}{r["n"]:>9}{r["sharePct"]:>8.2f}'
            f'{r["hit3Pct"]:>8.2f}{r["lift"]:>8.3f}{r["years"]:>6}{r["usable"]:>6}')

    if args.dry_run:
        log('[dry-run] 未写库')
        con.close()
        return 0

    stamp = con.execute(
        "SELECT strftime('%Y-%m-%dT%H:%M:%S','now','localtime')").fetchone()[0]
    con.executemany(
        'UPDATE bt_pattern_def SET evidenceTradeCnt=?, evidenceHit3Pct=?, '
        'evidenceLift=?, evidenceYears=?, usableForDecision=?, validatedAt=? '
        'WHERE patternId=?',
        [(r['n'], r['hit3Pct'], r['lift'], r['byYear'], r['usable'],
          stamp, r['patternId']) for r in out])
    con.executemany(
        'UPDATE bt_trade SET dayPatternMask=?, dayPatterns=?, dayCategories=? '
        'WHERE tradeId=?', mask_updates)
    con.execute('INSERT OR REPLACE INTO bt_meta(key,value,updatedAt) VALUES(?,?,?)',
                ('patternEvidenceDay',
                 json.dumps({'runId': rid, 'sampleN': n_rows_done, 'baseHit3Pct':
                             round(base, 3), 'scannedCodes': n_codes_done,
                             'source': 'tools/day_pattern_scan.py'}, ensure_ascii=False),
                 stamp))
    con.commit()
    log(f'[write] bt_pattern_def 回填 {len(out)} 条；'
        f'bt_trade 补 dayPatternMask {len(mask_updates)} 行（validatedAt={stamp}）')
    con.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
