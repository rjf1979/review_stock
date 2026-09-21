# -*- coding: utf-8 -*-
"""把「市场环境 -> 各目标历史基准」补进 data/backtest/decision_model.json。

为什么需要这个工具：实盘锚定基准必须与模型同口径，而它最早只存在 bt_stat
（dimension='market_regime'）里。一旦旧口径批次被清出，锚定就会静默退化成统一
基准，或按 dimension 取到别的批次的分档。把这块随模型文件固化后，模型自包含，
App 与 Python 打分都只读模型文件。

数据来源（按可用性排序，两者口径一致）：

1. bt_trade：模型 runId 的明细还在库里时直接用（最精确，含 link 回填的 regime）；
2. 磁盘产物：data/backtest/late-buy-next-morning-stock-only/trade_sample.csv
   与 bt_market_day.regime 按日期关联（旧批次已清出时用这条路径）。

用法::

    python tools/attach_regime_bases.py --check      # 只核对，不写文件
    python tools/attach_regime_bases.py              # 写入模型文件
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..'))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from backtest_store import DEFAULT_DB, DAILY_DIR  # noqa: E402

MODEL_PATH = os.path.join(ROOT, 'data', 'backtest', 'decision_model.json')
MODEL_VERSION = 'decision-model-v2'


def log(msg: str) -> None:
    print(msg, flush=True)


def num(v):
    try:
        s = str(v).strip()
        return None if s == '' else float(s)
    except (TypeError, ValueError):
        return None


def ymd(v):
    s = str(v or '').strip().replace('-', '').replace('/', '')
    return int(s) if s.isdigit() else None


def buckets_from_rows(rows) -> dict:
    """rows: 可迭代的 (regime, retHighPercent, limitTouch)。"""
    acc: dict = {}
    for regime, ret_high, limit_touch in rows:
        if not regime:
            continue
        cell = acc.setdefault(str(regime), [0, [0] * 9, 0])
        cell[0] += 1
        for k in range(1, 10):
            if ret_high is not None and ret_high >= k:
                cell[1][k - 1] += 1
        if int(limit_touch or 0) == 1:
            cell[2] += 1
    out = {}
    for regime, (n, hits, limit_hits) in acc.items():
        item = {'sampleCnt': n}
        for k in range(1, 10):
            item['up%d' % k] = round(100.0 * hits[k - 1] / n, 2)
        item['limitUp'] = round(100.0 * limit_hits / n, 2)
        out[regime] = item
    return out


def rows_from_db(conn: sqlite3.Connection, rid: int):
    cur = conn.execute(
        'SELECT marketRegime, retHigh, limitTouch FROM bt_trade WHERE runId=?', (rid,))
    return [tuple(r) for r in cur.fetchall()]


def rows_from_artifact(conn: sqlite3.Connection, csv_path: str):
    regime_by_date = {int(d): r for d, r in
                      conn.execute('SELECT date, regime FROM bt_market_day')}
    out = []
    with open(csv_path, 'r', encoding='utf-8-sig', newline='') as f:
        for row in csv.DictReader(f):
            d = ymd(row.get('date'))
            rh = num(row.get('ret_high'))
            out.append((regime_by_date.get(d),
                        None if rh is None else round(rh * 100.0, 4),
                        row.get('limit_touch')))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description='把市场环境基准固化进决策模型文件')
    ap.add_argument('--model', default=MODEL_PATH)
    ap.add_argument('--db', default=DEFAULT_DB)
    ap.add_argument('--check', action='store_true', help='只核对，不写文件')
    args = ap.parse_args()

    with open(args.model, 'r', encoding='utf-8') as f:
        model = json.load(f)
    rid = int(model.get('runId') or 0)
    sample_n = int(model.get('trainRows') or 0)

    conn = sqlite3.connect('file:%s?mode=ro' % args.db, uri=True)
    try:
        rows = rows_from_db(conn, rid) if rid else []
        src = 'bt_trade runId=%d' % rid
        if len(rows) != sample_n:
            csv_path = os.path.join(DAILY_DIR, 'trade_sample.csv')
            if not os.path.exists(csv_path):
                log('[error] bt_trade 无该批次且缺 %s，无法重算' % csv_path)
                return 2
            rows = rows_from_artifact(conn, csv_path)
            src = '%s + bt_market_day' % os.path.relpath(csv_path, ROOT)
    finally:
        conn.close()

    buckets = buckets_from_rows(rows)
    total = sum(v['sampleCnt'] for v in buckets.values())
    log('[in] 来源 %s：%d 行 / %d 个环境' % (src, total, len(buckets)))
    for b in sorted(buckets):
        v = buckets[b]
        log('  %-14s n=%6d  >=3%%=%.2f%%  >=5%%=%.2f%%  触板=%.2f%%'
            % (b, v['sampleCnt'], v['up3'], v['up5'], v['limitUp']))

    old = ((model.get('regimeBases') or {}).get('buckets') or {})
    if old:
        diff = [b for b in sorted(set(buckets) | set(old)) if buckets.get(b) != old.get(b)]
        log('[check] 与现有 regimeBases %s' % ('一致' if not diff else '不一致：%s' % diff))
        if diff and args.check:
            return 1
    if args.check:
        log('[check] 未写入（--check）')
        return 0

    model['version'] = MODEL_VERSION
    model['regimeBases'] = {
        'dimension': 'market_regime',
        'runId': rid, 'runKey': str(model.get('runKey') or ''),
        'sampleN': total,
        'baseSampleHit3Pct': model.get('baseSampleHit3Pct'),
        'source': src,
        'note': '命中率 = 该环境下「次日早盘最高涨幅 >= 阈值」占比，limitUp = 触及涨停占比；'
                '口径与 bt_stat.dimension=market_regime 一致，随模型固化以免批次清理后锚定失效。',
        'buckets': buckets,
    }
    with open(args.model, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(model, f, ensure_ascii=False, indent=1)
    log('[out] %s（version=%s，regimeBases %d 档）'
        % (args.model, MODEL_VERSION, len(buckets)))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
