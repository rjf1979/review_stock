# -*- coding: utf-8 -*-
"""给日线批次的 ``bt_trade`` 抽样本补算「日线均线形态位置」三列，并生成对应分档 CSV。

背景
----
``bt_trade`` 的日线批次（``daily-20210104-20260917-stockonly-d1``）在导入时
``dayShape`` / ``channelType`` / ``pos120`` 三列留空（见 ``backtest_store.daily_trade_row``），
而用户明确要求逐笔记录「5/10/20/60/120 日线形态位置（震荡/探底/回踩/上升通道…）」。
本工具在本地通达信日线上按 :mod:`day_shape` 的口径重算这三列：

* 回填 ``bt_trade.dayShape / channelType / pos120``；
* 产出 ``bucket_day_shape.csv`` / ``bucket_channel.csv`` / ``bucket_pos120.csv``
  （格式与 ``late_buy_next_morning.py`` 输出的其它 ``bucket_*.csv`` 完全一致，
  因此 ``backtest_store.import_stats_from_dir`` 可直接导入）；
* 落一份缓存 ``day_shape_sample.csv``，供 ``--from-cache`` 秒级重建
  （``backtest_store.py --import-daily`` 会 DELETE 后重插 ``bt_trade``，
  重插后必须再用本工具回填三列，走缓存即可）。

口径与局限
----------
* 形态判定只使用 ``<= i`` 的数据，无未来函数（见 ``day_shape.py``）；
* 分档统计建立在**日线批次抽样本**（2%，108,479 笔）上，不是 5,406,890 笔全样本，
  因此 ``bt_stat`` 的备注里显式标注来源，不与同批次的全样本维度混淆；
* 抽样本基准 ≥+3% ≈ 20.7%，与全样本 21.14% 一致，偏差在抽样误差内。

用法::

    python tools/day_shape_scan.py --dry-run --limit-codes 120   # 先小样验证
    python tools/day_shape_scan.py                               # 全量 + 回填 + 出 CSV
    python tools/day_shape_scan.py --from-cache                  # 只按缓存回填 bt_trade
"""
from __future__ import annotations

import argparse
import csv
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

from day_shape import UNKNOWN, classify                       # noqa: E402
from indicators import compute_indicators                     # noqa: E402
from kdata import Market                                      # noqa: E402
from late_buy_next_morning import KeyAgg, load_factors, write_csv  # noqa: E402

DEFAULT_DB = os.path.join(ROOT, 'data', 'backtest.db')
DAILY_DIR = os.path.join(ROOT, 'data', 'backtest', 'late-buy-next-morning-stock-only')
RUN_DAILY = 'daily-20210104-20260917-stockonly-d1'
CACHE_CSV = 'day_shape_sample.csv'

# pos120 分桶（0~1 → 五档）；不入档的 None 记 ''，KeyAgg/IndexAgg 会自动跳过
POS_LABELS = ['0~20%', '20~40%', '40~60%', '60~80%', '80~100%']
POS_EDGES = np.array([0.0, 0.2, 0.4, 0.6, 0.8, 1.0001])


def log(msg: str) -> None:
    print(msg, flush=True)


def pos_bucket(p) -> str:
    """pos120 → 分档标签；None/越界返回 ''。"""
    if p is None:
        return ''
    v = float(p)
    if not np.isfinite(v):
        return ''
    i = int(np.digitize(v, POS_EDGES) - 1)
    i = min(max(i, 0), len(POS_LABELS) - 1)
    return POS_LABELS[i]


def _pos_of(v):
    try:
        return None if v in (None, '', 'None') else float(v)
    except ValueError:
        return None


def _read_cache_raw(path: str) -> tuple[list[str], list[dict]]:
    if not os.path.exists(path):
        return [], []
    with open(path, 'r', encoding='utf-8-sig', newline='') as f:
        rd = csv.DictReader(f)
        return list(rd.fieldnames or []), list(rd)


def _write_cache(path: str, rows: list[tuple]) -> None:
    """rows = (code, date, dayShape, channelType, pos120)。"""
    with open(path, 'w', encoding='utf-8-sig', newline='') as f:
        f.write('code,date,dayShape,channelType,pos120\n')
        for c, d, s, ch, p in rows:
            f.write(f'{c},{d},{s},{ch},{"" if p is None else p}\n')


def read_cache(path: str, con: sqlite3.Connection | None = None,
               rid: int | None = None) -> list[tuple]:
    """缓存 → [(code, date, dayShape, channelType, pos120)]。

    兼容老格式（只有 `tradeId` 列）：当传入 ``con``/``rid`` 时用 ``bt_trade`` 反查
    ``code``/``date`` 并原地升级文件——因为 ``--import-daily`` 会 DELETE 后重插，
    ``tradeId`` 会变，缓存必须按 ``(code, date)`` 索引才可复用。
    """
    cols, rows = _read_cache_raw(path)
    if not rows:
        return []
    if 'code' in cols and 'date' in cols:
        return [(r['code'], int(r['date']), r.get('dayShape') or UNKNOWN,
                 r.get('channelType') or 'na', _pos_of(r.get('pos120')))
                for r in rows]
    if con is None or rid is None:
        raise SystemExit(f'{path} 是 tradeId 键的老格式缓存，请传入 --db 以便升级')
    key = {}
    for tid, code, date in con.execute(
            'SELECT tradeId, code, date FROM bt_trade WHERE runId=?', (rid,)):
        key[int(tid)] = (str(code), int(date))
    out = []
    for r in rows:
        try:
            k = key[int(r['tradeId'])]
        except (KeyError, TypeError, ValueError):
            continue
        out.append((k[0], k[1], r.get('dayShape') or UNKNOWN,
                    r.get('channelType') or 'na', _pos_of(r.get('pos120'))))
    _write_cache(path, out)
    log(f'[cache] 升级为 (code,date) 键：{path}（{len(out)} 行）')
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description='日线均线形态位置补算（bt_trade + 分档 CSV）')
    ap.add_argument('--db', default=DEFAULT_DB)
    ap.add_argument('--run', default=RUN_DAILY, help='bt_run.runKey')
    ap.add_argument('--out-dir', default=DAILY_DIR)
    ap.add_argument('--workers', type=int, default=4)
    ap.add_argument('--limit-codes', type=int, default=0)
    ap.add_argument('--dry-run', action='store_true', help='只统计，不写库、不出 CSV')
    ap.add_argument('--no-buckets', action='store_true', help='不写 bucket_*.csv')
    ap.add_argument('--from-cache', action='store_true',
                    help='跳过重算，直接用 day_shape_sample.csv 回填 bt_trade')
    args = ap.parse_args(argv)

    con = sqlite3.connect(args.db)
    row = con.execute('SELECT runId FROM bt_run WHERE runKey=?', (args.run,)).fetchone()
    if row is None:
        log(f'[err] bt_run 缺少 runKey={args.run}')
        return 1
    rid = int(row[0])
    cache_path = os.path.join(args.out_dir, CACHE_CSV)
    stamp = con.execute(
        "SELECT strftime('%Y-%m-%dT%H:%M:%S','now','localtime')").fetchone()[0]

    # ---------------------------------------------------------- 只按缓存回填
    if args.from_cache:
        cache = read_cache(cache_path, con, rid)
        if not cache:
            log(f'[err] 缓存不存在或为空：{cache_path}')
            return 1
        ups = [(s, ch, p, rid, c, d) for c, d, s, ch, p in cache]
        con.executemany('UPDATE bt_trade SET dayShape=?, channelType=?, pos120=? '
                        'WHERE runId=? AND code=? AND date=?', ups)
        con.commit()
        miss = con.execute('SELECT COUNT(*) FROM bt_trade WHERE runId=? AND dayShape IS NULL',
                           (rid,)).fetchone()[0]
        log(f'[write] 按缓存回填 bt_trade {len(ups)} 行；runId={rid} 仍有 {miss} 行 dayShape 为空')
        con.close()
        return 0 if miss == 0 else 1

    # ---------------------------------------------------------- 读抽样本
    rows = con.execute(
        'SELECT tradeId, code, date, retOpen, retHigh, retClose, limitTouch, stratRet '
        'FROM bt_trade WHERE runId=? AND retHigh IS NOT NULL', (rid,)).fetchall()
    if not rows:
        log(f'[err] runId={rid} 没有可用抽样本')
        return 1
    by_code: dict[str, list[tuple]] = defaultdict(list)
    for tid, code, date, ro, rh, rc, lt, sr in rows:
        by_code[str(code)].append((int(tid), int(date),
                                   (ro or 0.0) / 100.0, (rh or 0.0) / 100.0,
                                   (rc if rc is not None else 0.0) / 100.0,
                                   int(lt or 0), (sr if sr is not None else 0.0) / 100.0))
    codes = sorted(by_code)
    if args.limit_codes:
        codes = codes[:args.limit_codes]
    log(f'[in] runId={rid} 抽样本 {len(rows)} 笔 / {len(by_code)} 只；本次处理 {len(codes)} 只')

    market = Market()
    factors = load_factors()

    def scan_code(code: str):
        """→ (code, [(tid, date, shape, chan, p120, ro, rh, rc, lt, sr)], err)"""
        rec = market.meta(code) or {}
        name = rec.get('name', '')
        try:
            bars = market.load(code, 'qfq', factors.get(code))
        except Exception as exc:                                  # noqa: BLE001
            return code, [], f'载入失败：{exc}'
        market._cache.pop(code, None)                             # 控制内存
        if len(bars) < 130:
            return code, [], '日线不足 130 根'
        ind = compute_indicators(bars, code, name)
        date_arr = np.asarray(bars['date'], dtype=np.int64)
        pos = {int(d): i for i, d in enumerate(date_arr)}
        out = []
        for tid, date, ro, rh, rc, lt, sr in by_code[code]:
            i = pos.get(date)
            if i is None:
                out.append((tid, date, UNKNOWN, 'na', None, ro, rh, rc, lt, sr))
                continue
            shape, chan, p120 = classify(ind, int(i))
            out.append((tid, date, shape, chan, p120, ro, rh, rc, lt, sr))
        return code, out, None

    agg_shape = KeyAgg()
    agg_chan = KeyAgg()
    agg_pos = KeyAgg()
    shape_hit: dict[str, int] = defaultdict(int)
    shape_n: dict[str, int] = defaultdict(int)
    updates: list[tuple] = []
    cache_rows: list[tuple] = []
    n_done = 0
    t0 = time.time()

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as ex:
        for code, out, err in ex.map(scan_code, codes):
            n_done += 1
            if err:
                log(f'  [warn] {code} {err}')
            if not out:
                continue
            n = len(out)
            ks = np.array([r[2] for r in out], dtype=object)
            cs = np.array([r[3] for r in out], dtype=object)
            ps = np.array([pos_bucket(r[4]) for r in out], dtype=object)
            ro = np.array([r[5] for r in out], dtype=np.float64)
            rh = np.array([r[6] for r in out], dtype=np.float64)
            rc = np.array([r[7] for r in out], dtype=np.float64)
            lt = np.array([r[8] for r in out], dtype=bool)
            sr = np.array([r[9] for r in out], dtype=np.float64)
            ok = np.ones(n, dtype=bool)
            agg_shape.add(ks, ok, ro, rh, rc, lt, sr)
            agg_chan.add(cs, ok, ro, rh, rc, lt, sr)
            agg_pos.add(ps, ok, ro, rh, rc, lt, sr)
            for r in out:
                updates.append((r[2], r[3], r[4], r[0]))
                cache_rows.append((code, r[1], r[2], r[3], r[4]))
                shape_n[r[2]] += 1
                shape_hit[r[2]] += int(r[6] >= 0.03)
            if n_done % 400 == 0:
                log(f'  ... {n_done}/{len(codes)} 只  已算 {len(updates)} 笔  '
                    f'用时 {time.time() - t0:.0f}s')

    log(f'[scan] 完成 {n_done} 只 / {len(updates)} 笔 / 用时 {time.time() - t0:.0f}s')

    rows_shape = agg_shape.rows()
    rows_chan = agg_chan.rows()
    rows_pos = agg_pos.rows()
    total = sum(shape_n.values())
    base = sum(shape_hit.values()) / total * 100 if total else 0.0
    log('')
    log(f'{"dayShape":<12}{"样本":>9}{"占比%":>8}{"≥3%":>8}{"lift":>8}')
    for k in sorted(shape_n, key=lambda x: -shape_n[x]):
        r = shape_hit[k] / shape_n[k] * 100
        log(f'{k:<12}{shape_n[k]:>9}{shape_n[k] / total * 100:>8.2f}{r:>8.2f}'
            f'{r / base:>8.3f}')
    log(f'  基准 ≥+3% = {base:.2f}%（{total} 笔）')

    if args.dry_run:
        log('[dry-run] 未写库、未出 CSV')
        con.close()
        return 0

    if not args.no_buckets:
        os.makedirs(args.out_dir, exist_ok=True)
        for fn, rs in (('bucket_day_shape.csv', rows_shape),
                       ('bucket_channel.csv', rows_chan),
                       ('bucket_pos120.csv', rows_pos)):
            write_csv(os.path.join(args.out_dir, fn), rs)
            log(f'[out] {os.path.join(args.out_dir, fn)}（{len(rs)} 档）')
        _write_cache(cache_path, cache_rows)
        log(f'[out] {cache_path}（{len(cache_rows)} 行缓存）')

    con.executemany('UPDATE bt_trade SET dayShape=?, channelType=?, pos120=? '
                    'WHERE tradeId=?', updates)
    con.execute('INSERT OR REPLACE INTO bt_meta(key,value,updatedAt) VALUES(?,?,?)',
                ('dayShapeDaily', json.dumps(
                    {'runId': rid, 'sampleN': total, 'baseHit3Pct': round(base, 3),
                     'source': 'tools/day_shape_scan.py', 'dimensions':
                         ['day_shape', 'channel', 'pos120']}, ensure_ascii=False),
                 stamp))
    con.commit()
    miss = con.execute('SELECT COUNT(*) FROM bt_trade WHERE runId=? AND dayShape IS NULL',
                       (rid,)).fetchone()[0]
    log(f'[write] bt_trade 回填 {len(updates)} 行；仍为空的 {miss} 行（validatedAt={stamp}）')
    con.close()
    return 0 if miss == 0 else 1


if __name__ == '__main__':
    raise SystemExit(main())
