# -*- coding: utf-8 -*-
"""形态证据回填：把回测样本上的形态表现写回 ``bt_pattern_def.evidence*``。

数据源是同一个回测库：

* 日线口径 → ``bt_trade``（``runId`` 为日线批次，2% 随机抽样本，2021~2026）；
* 分钟口径 → ``bt_trade_tf``（多周期批次，全样本，仅 69 个交易日）。

统计口径：

* 基准 = 该批次全部样本「次日早盘最高 ≥+3%」的命中率 %；
* 形态命中 = ``patternMask`` 位掩码命中（日线用 ``dayPatternMask``）；
* ``lift`` = 形态命中样本命中率 ÷ 基准命中率；
* 分年命中率按自然年统计，样本 < ``--min-year-n`` 的年份不写入；
* ``usableForDecision``：只有日线口径、样本 ≥1000、lift ≥1.15、覆盖 ≥4 个年份、
  且最差年份不低于基准 90% 的形态才标记为 1。分钟口径样本期只有 69 日且落在
  单边强势段，一律 0（结论与 ``bt_run.note`` 的声明一致）。

用法::

    python tools/bt_pattern_validate.py            # 回填并导出 CSV
    python tools/bt_pattern_validate.py --dry-run   # 只看统计，不写库
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..'))
sys.path.insert(0, HERE)

DEFAULT_DB = os.path.join(ROOT, 'data', 'backtest.db')
DEFAULT_CSV = os.path.join(ROOT, 'data', 'backtest', 'late-buy-next-morning-tf',
                           'pattern_evidence.csv')

RUN_DAILY = 'daily-20210104-20260917-stockonly-d1'
RUN_TF = 'tf-20260612-20260917-stockonly-d1'
PERIODS = (5, 15, 30, 60)


def log(msg: str) -> None:
    print(msg, flush=True)


def run_id(con: sqlite3.Connection, key: str):
    row = con.execute('SELECT runId FROM bt_run WHERE runKey=?', (key,)).fetchone()
    return row[0] if row else None


def load_defs(con: sqlite3.Connection) -> list[dict]:
    cols = ('patternId', 'nameCn', 'scope', 'periods', 'bitIndex', 'direction',
            'priority', 'category')
    rows = con.execute(f'SELECT {", ".join(cols)} FROM bt_pattern_def').fetchall()
    return [dict(zip(cols, r)) for r in rows]


def accumulate(rows, bits_ok: set, min_year_n: int):
    """单遍扫描 (date, mask, hit3)，按 bitIndex 聚合。"""
    cnt: dict = defaultdict(int)
    hit: dict = defaultdict(int)
    yr_n: dict = defaultdict(lambda: defaultdict(int))
    yr_hit: dict = defaultdict(lambda: defaultdict(int))
    for date, mask, h in rows:
        if not mask:
            continue
        m = int(mask)
        year = str(date // 10000)
        h = int(h)
        while m:
            low = m & -m
            bit = low.bit_length() - 1
            m ^= low
            if bit not in bits_ok:
                continue
            cnt[bit] += 1
            hit[bit] += h
            yr_n[bit][year] += 1
            yr_hit[bit][year] += h
    years = {}
    for bit in cnt:
        years[bit] = {y: yr_hit[bit][y] / yr_n[bit][y] * 100
                      for y in sorted(yr_n[bit]) if yr_n[bit][y] >= min_year_n}
    return cnt, hit, years


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description='形态证据回填 bt_pattern_def')
    ap.add_argument('--db', default=DEFAULT_DB)
    ap.add_argument('--csv', default=DEFAULT_CSV)
    ap.add_argument('--min-year-n', type=int, default=100,
                    help='分年统计的最小样本量（默认 100）')
    ap.add_argument('--dry-run', action='store_true', help='不写库，只打印统计')
    args = ap.parse_args(argv)

    con = sqlite3.connect(args.db)
    defs = load_defs(con)
    daily = [d for d in defs if d['periods'] == 'day']
    log(f'[def] 形态字典 {len(defs)} 条，其中日线口径 {len(daily)} 条')

    out_rows: list[dict] = []
    updates: list[tuple] = []
    base_note: dict = {}

    # ---------------------------------------------------------- 日线口径
    rid = run_id(con, RUN_DAILY)
    if rid is None:
        log(f'[warn] 缺少日线批次 {RUN_DAILY}')
    else:
        rows = con.execute(
            'SELECT date, dayPatternMask, hit3 FROM bt_trade '
            'WHERE runId=? AND hit3 IS NOT NULL', (rid,)).fetchall()
        base = sum(int(r[2]) for r in rows) / len(rows) * 100
        log(f'[day] 批次 runId={rid} 样本 {len(rows)} 笔，基准 ≥+3% 命中 {base:.2f}%')
        base_note['day'] = {'runId': rid, 'n': len(rows), 'baseHit3Pct': round(base, 3)}
        bits_ok = {d['bitIndex'] for d in daily if d['bitIndex'] is not None}
        cnt, hit, years = accumulate(rows, bits_ok, args.min_year_n)
        for d in sorted(daily, key=lambda x: x['priority']):
            bit = d['bitIndex']
            n = cnt.get(bit, 0)
            if not n:
                log(f'  [skip] {d["patternId"]:<24} 样本 0')
                continue
            rate = hit[bit] / n * 100
            lift = rate / base
            ys = years.get(bit, {})
            usable = 1 if (n >= 1000 and lift >= 1.15 and len(ys) >= 4
                           and min(ys.values()) >= base * 0.9) else 0
            out_rows.append({
                'scope': 'day', 'period': 'day', 'patternId': d['patternId'],
                'nameCn': d['nameCn'], 'direction': d['direction'],
                'n': n, 'baseHit3Pct': round(base, 2), 'hit3Pct': round(rate, 2),
                'lift': round(lift, 3), 'years': len(ys), 'usable': usable,
                'byYear': json.dumps({k: round(v, 2) for k, v in ys.items()},
                                     ensure_ascii=False),
            })
            updates.append((n, round(rate, 3), round(lift, 4),
                            json.dumps({k: round(v, 2) for k, v in ys.items()},
                                       ensure_ascii=False), usable, d['patternId']))

    # ------------------------------------------------------------ 分钟口径
    rid_tf = run_id(con, RUN_TF)
    tf_rows_total = 0
    if rid_tf is not None:
        tf_rows_total = con.execute(
            'SELECT COUNT(*) FROM bt_trade_tf WHERE runId=?', (rid_tf,)).fetchone()[0]
    if not tf_rows_total:
        log(f'[warn] 多周期批次 {RUN_TF} 暂无明细（分片尚未合并），分钟形态证据本轮跳过')
    else:
        base_rows = con.execute(
            'SELECT date, hit3 FROM bt_trade WHERE runId=? AND hit3 IS NOT NULL',
            (rid_tf,)).fetchall()
        base_tf = sum(int(r[1]) for r in base_rows) / len(base_rows) * 100
        log(f'[intraday] 批次 runId={rid_tf} 明细 {tf_rows_total} 行，'
            f'基准 ≥+3% 命中 {base_tf:.2f}%（{len(base_rows)} 笔）')
        base_note['intraday'] = {'runId': rid_tf, 'n': len(base_rows),
                                 'baseHit3Pct': round(base_tf, 3)}
        for p in PERIODS:
            rows = con.execute(
                'SELECT t.date, f.patternMask, t.hit3 FROM bt_trade_tf f '
                'JOIN bt_trade t ON t.tradeId=f.tradeId '
                'WHERE f.runId=? AND f.period=? AND t.hit3 IS NOT NULL',
                (rid_tf, p)).fetchall()
            if not rows:
                log(f'  [skip] {p} 分钟：无明细')
                continue
            period_defs = [d for d in defs if d['periods'] == str(p)]
            bits_ok = {d['bitIndex'] for d in period_defs if d['bitIndex'] is not None}
            cnt, hit, years = accumulate(rows, bits_ok, args.min_year_n)
            covered = sum(1 for d in period_defs if cnt.get(d['bitIndex'], 0) > 0)
            log(f'  [{p}m] 明细 {len(rows)} 行，形态 {covered}/{len(period_defs)} 条有命中')
            for d in sorted(period_defs, key=lambda x: x['priority']):
                bit = d['bitIndex']
                n = cnt.get(bit, 0)
                if not n:
                    continue
                rate = hit[bit] / n * 100
                lift = rate / base_tf
                out_rows.append({
                    'scope': 'intraday', 'period': f'{p}m', 'patternId': d['patternId'],
                    'nameCn': d['nameCn'], 'direction': d['direction'],
                    'n': n, 'baseHit3Pct': round(base_tf, 2), 'hit3Pct': round(rate, 2),
                    'lift': round(lift, 3), 'years': 0, 'usable': 0, 'byYear': '',
                })
                updates.append((n, round(rate, 3), round(lift, 4), None, 0,
                                d['patternId']))

    # --------------------------------------------------------------- 落库
    if not args.dry_run and updates:
        stamp = con.execute("SELECT strftime('%Y-%m-%dT%H:%M:%S','now','localtime')"
                            ).fetchone()[0]
        con.executemany(
            'UPDATE bt_pattern_def SET evidenceTradeCnt=?, evidenceHit3Pct=?, '
            'evidenceLift=?, evidenceYears=?, usableForDecision=?, validatedAt=? '
            'WHERE patternId=?',
            [(u[0], u[1], u[2], u[3], u[4], stamp, u[5]) for u in updates])
        con.execute('INSERT OR REPLACE INTO bt_meta(key,value,updatedAt) VALUES(?,?,?)',
                    ('patternEvidenceNote',
                     json.dumps(base_note, ensure_ascii=False), stamp))
        con.commit()
        log(f'[write] bt_pattern_def 已回填 {len(updates)} 条证据（validatedAt={stamp}）')

    # ------------------------------------------------------------- 报表
    os.makedirs(os.path.dirname(args.csv), exist_ok=True)
    cols = ['scope', 'period', 'patternId', 'nameCn', 'direction', 'n',
            'baseHit3Pct', 'hit3Pct', 'lift', 'years', 'usable', 'byYear']
    with open(args.csv, 'w', encoding='utf-8-sig', newline='') as f:
        f.write(','.join(cols) + '\n')
        for r in sorted(out_rows, key=lambda x: (x['scope'], x['period'],
                                                 -(x['lift'] or 0))):
            f.write(','.join(
                f'"{r[c]}"' if isinstance(r[c], str) and ',' in str(r[c]) else str(r[c])
                for c in cols) + '\n')
    log(f'[out] {args.csv}（{len(out_rows)} 行）')

    show = [r for r in out_rows if r['scope'] == 'day']
    if show:
        log('')
        log('日线口径形态表现（按 lift 降序）：')
        log(f'{"形态":<26}{"样本":>8}{"≥3%":>8}{"lift":>8}{"年数":>6}{"可用":>6}')
        for r in sorted(show, key=lambda x: -(x['lift'] or 0)):
            log(f'{r["nameCn"]:<26}{r["n"]:>8}{r["hit3Pct"]:>8.2f}'
                f'{r["lift"]:>8.3f}{r["years"]:>6}{r["usable"]:>6}')
    con.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
