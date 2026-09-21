# -*- coding: utf-8 -*-
"""把 ``data/hsjday`` 的尾部缺口用通达信本地日线补齐（只追加，不覆盖、不截断）。

背景
----
``data/hsjday`` 的历史比通达信本地 ``lday`` 深（sh600000 有 6388 根 vs 3104 根），
但最近几天可能滞后。抽样比对证实两者在重叠区间逐根一致（收盘价零差异、成交量一致），
属于同一口径（通达信原始未复权），因此可以用通达信 ``vipdoc`` 的尾部补上。

规则
----
* 只处理 ``hsjday/{sh,sz}/lday/*.day`` 中、且通达信目录里也存在同名文件的代码；
* 只追加日期严格大于 hsjday 现有最大日期的 K 线，绝不修改或删除已有记录；
* ``--dry-run`` 只统计不写盘。

用法::

    python tools/extend_hsjday.py --dry-run
    python tools/extend_hsjday.py
"""

from __future__ import annotations

import argparse
import os
import struct
from collections import Counter

REC = 32
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..'))
HSJDAY_DEFAULT = os.path.join(ROOT, 'data', 'hsjday')
TDX_DEFAULT = r'D:\new_tdx\vipdoc'


def last_date(path: str) -> int:
    size = os.path.getsize(path)
    if size < REC:
        return 0
    with open(path, 'rb') as f:
        f.seek(size - REC)
        return struct.unpack('<I', f.read(4))[0]


def tail_records(path: str, after_date: int) -> list[bytes]:
    """返回该文件中日期严格大于 after_date 的原始记录（按原顺序）。"""
    out: list[bytes] = []
    with open(path, 'rb') as f:
        while True:
            rec = f.read(REC)
            if len(rec) < REC:
                break
            if struct.unpack('<I', rec[:4])[0] > after_date:
                out.append(rec)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--hsjday', default=HSJDAY_DEFAULT)
    ap.add_argument('--tdx-root', default=TDX_DEFAULT)
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--limit', type=int, default=0, help='只处理前 N 个文件（调试用）')
    args = ap.parse_args()

    scanned = extended = skipped_missing = unchanged = 0
    total_bars = 0
    new_max: Counter[int] = Counter()
    examples: list[str] = []

    for market in ('sh', 'sz'):
        src_dir = os.path.join(args.hsjday, market, 'lday')
        tdx_dir = os.path.join(args.tdx_root, market, 'lday')
        if not os.path.isdir(src_dir):
            print(f'[skip] 目录不存在: {src_dir}')
            continue
        names = sorted(n for n in os.listdir(src_dir) if n.endswith('.day'))
        if args.limit:
            names = names[:args.limit]
        for name in names:
            scanned += 1
            dst = os.path.join(src_dir, name)
            tdx = os.path.join(tdx_dir, name)
            if not os.path.exists(tdx):
                skipped_missing += 1
                continue
            cur_max = last_date(dst)
            if last_date(tdx) <= cur_max:
                unchanged += 1
                continue
            recs = tail_records(tdx, cur_max)
            if not recs:
                unchanged += 1
                continue
            dates = [struct.unpack('<I', r[:4])[0] for r in recs]
            if dates != sorted(dates):
                print(f'[warn] {name} 追加记录非升序，跳过')
                continue
            if not args.dry_run:
                with open(dst, 'ab') as f:
                    f.write(b''.join(recs))
            extended += 1
            total_bars += len(recs)
            new_max[dates[-1]] += 1
            if len(examples) < 5:
                examples.append(f'{name}: {cur_max} -> {dates[-1]} (+{len(recs)})')

    mode = '[dry-run]' if args.dry_run else '[写入]'
    print(f'{mode} 扫描 {scanned}；补齐 {extended}；已最新 {unchanged}；通达信无对应文件 {skipped_missing}')
    print(f'追加 K 线合计 {total_bars} 根')
    if new_max:
        print('补齐后最新日期分布:', dict(sorted(new_max.items())))
    for e in examples:
        print('  例:', e)


if __name__ == '__main__':
    main()
