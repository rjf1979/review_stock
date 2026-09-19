#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
监听通达信本地数据下载进度，每分钟检查一次，完成后退出（退出码 0）。

判定“下载完成”需同时满足：
  1) 覆盖度：沪深 A 股中，已回溯到 2001-01-01 之前的占比 >= --coverage（默认 0.9）
  2) 静默期：最近 --idle 秒（默认 45）内没有任何 .day 文件被修改

用法：
  python tools/watch_tdx.py                 # 默认每分钟检查，最多等 3 小时
  python tools/watch_tdx.py --interval 60 --max-wait 180
  python tools/watch_tdx.py --once          # 只检查一次并打印状态
"""

import argparse
import glob
import os
import re
import struct
import sys
import time
from datetime import datetime

CODE_RE = re.compile(r'^(60\d{4}|688\d{3}|000\d{3}|001\d{3}|002\d{3}|003\d{3}|300\d{3}|301\d{3})$')
DEFAULT_TDX = r'D:\new_tdx\vipdoc'


def scan(tdx_root):
    files = []
    for mkt in ('sh', 'sz'):
        files += glob.glob(os.path.join(tdx_root, mkt, 'lday', f'{mkt}*.day'))
    total = old_enough = enough = 0
    latest_mtime = 0.0
    latest_date = ''
    for path in files:
        code = os.path.basename(path)[2:8]
        if not CODE_RE.match(code):
            continue
        total += 1
        bars = os.path.getsize(path) // 32
        if bars >= 250:
            enough += 1
        try:
            with open(path, 'rb') as f:
                first = str(struct.unpack_from('<I', f.read(32), 0)[0])
                f.seek(-32, os.SEEK_END)
                last = str(struct.unpack_from('<I', f.read(32), 0)[0])
            if len(first) == 8 and first <= '20010101':
                old_enough += 1
            if len(last) == 8:
                latest_date = max(latest_date, f'{last[:4]}-{last[4:6]}-{last[6:]}')
        except Exception:                              # noqa: BLE001
            pass
        try:
            latest_mtime = max(latest_mtime, os.path.getmtime(path))
        except OSError:
            pass
    coverage = old_enough / total if total else 0.0
    return {'total': total, 'old_enough': old_enough, 'enough': enough,
            'coverage': coverage, 'latest_mtime': latest_mtime, 'latest_date': latest_date}


def main():
    p = argparse.ArgumentParser(description='监听通达信本地数据下载进度')
    p.add_argument('--tdx-root', default=DEFAULT_TDX)
    p.add_argument('--interval', type=int, default=60, help='检查间隔（秒）')
    p.add_argument('--max-wait', type=int, default=180, help='最多等待（分钟）')
    p.add_argument('--coverage', type=float, default=0.9, help='视为完成的覆盖度阈值')
    p.add_argument('--idle', type=int, default=45, help='静默判定秒数')
    p.add_argument('--once', action='store_true', help='只检查一次')
    args = p.parse_args()

    deadline = time.time() + args.max_wait * 60
    round_no = 0
    while True:
        round_no += 1
        s = scan(args.tdx_root)
        now = time.time()
        idle = now - s['latest_mtime'] if s['latest_mtime'] else 999
        done = s['coverage'] >= args.coverage and idle >= args.idle
        stamp = datetime.now().strftime('%H:%M:%S')
        print(f"[{stamp}] 第{round_no}次  A股文件 {s['total']}  "
              f"已回溯2001年前 {s['old_enough']} ({s['coverage']*100:.1f}%)  "
              f"≥250根 {s['enough']}  最新日期 {s['latest_date']}  "
              f"空闲 {idle:.0f}s  → {'已完成' if done else '下载中'}", flush=True)
        if done:
            print('\n>>> 通达信历史数据下载完成，可以开始全量导入。', flush=True)
            return 0
        if args.once or time.time() > deadline:
            print('\n>>> 仍未完成（或已到最长等待时间）。', flush=True)
            return 1
        time.sleep(args.interval)


if __name__ == '__main__':
    sys.exit(main())
