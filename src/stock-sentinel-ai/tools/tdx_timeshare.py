# -*- coding: utf-8 -*-
"""通达信「历史分时」数据集：格式定义、读写与自检。

数据落在 ``E:\\tdx_data``（可用环境变量 ``TDX_TIMESHARE_ROOT`` 覆盖）。

为什么单独立一套格式，而不复用 ``.lc1``
----------------------------------------
分时接口每天只返回 240 个 ``{price, vol}``：**没有 open/high/low/amount，也没有时间字段**。
若写成 ``.lc1`` 布局，下游会当成分钟 K 线用（本项目刚在「用错布局静默产出错误数值」上
栽过一次），因此：

* 独立后缀 ``.fs``、独立 16 字节记录；
* 字段契约写死在 ``meta.json``，读取端只认这个契约；
* 自检里显式区分「点数不对」「时间网格不符」「价格不在 0.01 网格」等结构性错误。

记录格式（16 字节，小端，定长）
-------------------------------
``<u32 date> <u16 time> <i16 reserved> <i32 price_cent> <u32 volume>``

=============  ==================================================================
字段            含义
=============  ==================================================================
``date``       YYYYMMDD
``time``       HHMM，该分钟**结束**时刻。隐含固定网格 ``0931..1130 + 1301..1500``
               共 240 槽——分时响应里没有时间字段，这是接口约定，必须靠槽位对齐。
``price_cent`` 价格 × 100（整数「分」）。A 股报价最小变动 0.01 元，实测分时价格
               全部落在 0.01 网格上，用整数分存储可避免 float32 往返误差。
``volume``     该分钟成交量，单位 **手**（×100 = 股）。
``reserved``   固定 0，留给将来扩展。
=============  ==================================================================

价格**未复权**。

目录结构
--------
::

    E:\\tdx_data\\
      meta.json                 字段契约、采集窗口、来源与参数
      calendar.txt              实际采集到的交易日（YYYYMMDD，按序一行一个）
      fs\\sh\\sh600519.fs         每股一文件，按日期升序、日 240 条
      state\\days.json           逐日完成状态（断点续爬依据）
      state\\gaps.json           无法补齐的 (代码, 日期) 缺口
      logs\\collect-*.log
      report\\coverage-*.json

用法::

    from tdx_timeshare import load_file, verify_file, grid_times, REC

    m = load_file(r'E:\\tdx_data\\fs\\sh\\sh600519.fs')
    m['date'], m['time'], m['price'], m['volume']     # 四个 numpy 数组
    verify_file(path)                                 # 结构自检报告

命令行::

    python tools/tdx_timeshare.py info   --root E:\\tdx_data
    python tools/tdx_timeshare.py verify --root E:\\tdx_data
    python tools/tdx_timeshare.py day    --root E:\\tdx_data --code 600519 --date 20210104
"""
from __future__ import annotations

import argparse
import json
import os
import struct
import sys

import numpy as np

ROOT_ENV = 'TDX_TIMESHARE_ROOT'
DEFAULT_ROOT = r'E:\tdx_data'

#: 每分钟一个槽，共 240 槽。索引 i ↔ 时间网格第 i 个时刻（该分钟结束）。
SLOTS = 240
REC = struct.Struct('<IHHiI')
REC_SIZE = REC.size           # 16

RAW_DT = np.dtype([
    ('date', '<u4'), ('time', '<u2'), ('reserved', '<i2'),
    ('price_cent', '<i4'), ('volume', '<u4'),
])

#: 隐含时间网格：上午 09:31~11:30，下午 13:01~15:00（各 120 槽）
GRID = tuple(
    [h * 100 + m for h in (9,) for m in range(31, 60)]
    + [10 * 100 + m for m in range(0, 60)]
    + [11 * 100 + m for m in range(0, 31)]
    + [13 * 100 + m for m in range(1, 60)]
    + [14 * 100 + m for m in range(0, 60)]
    + [1500]
)
assert len(GRID) == SLOTS, len(GRID)

FREQ_LABEL = 'per-minute close + volume (time-share, 分时)'
PRICE_FORMAT = 'int32-cent'
VOLUME_UNIT = 'lot'
ADJUSTMENT = 'unadjusted'


def root_dir(root: str | None = None) -> str:
    return root or os.environ.get(ROOT_ENV) or DEFAULT_ROOT


def market_of(code: str) -> str:
    c = str(code)
    if len(c) >= 2 and c[:2] in ('43', '83', '87', '92'):
        return 'bj'
    return 'sh' if c[:1] in '5689' else 'sz'


def file_for(code: str, root: str | None = None, market: str | None = None) -> str:
    mkt = market or market_of(code)
    return os.path.join(root_dir(root), 'fs', mkt, f'{mkt}{code}.fs')


def grid_times() -> tuple[int, ...]:
    return GRID


def pack_day(date: int, prices, volumes) -> bytes:
    """把一天的 240 个点打包成定长记录；长度不符或价格不在 0.01 网格上直接报错。"""
    if len(prices) != SLOTS or len(volumes) != SLOTS:
        raise ValueError(f'点数不是 {SLOTS}：price={len(prices)} volume={len(volumes)}')
    out = bytearray(SLOTS * REC_SIZE)
    for i in range(SLOTS):
        cent = int(round(float(prices[i]) * 100))
        if abs(float(prices[i]) * 100 - cent) > 1e-6:
            raise ValueError(f'价格不在 0.01 网格上：{prices[i]}')
        REC.pack_into(out, i * REC_SIZE, int(date), GRID[i], 0, cent, int(volumes[i]))
    return bytes(out)


def append_day(path: str, date: int, prices, volumes) -> int:
    """按日期升序追加一天。已存在更晚的日期则拒绝（保证文件内有序、可按日续爬）。"""
    last = last_date(path)
    if last and int(date) <= last:
        raise ValueError(f'{path} 已有 {last}，拒绝追加 {date}（必须按日期升序）')
    blob = pack_day(date, prices, volumes)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'ab') as f:
        f.write(blob)
    return len(blob)


def last_date(path: str) -> int:
    """文件里最后一条记录的日期；文件不存在或为空返回 0。"""
    if not os.path.exists(path):
        return 0
    size = os.path.getsize(path)
    if size < REC_SIZE:
        return 0
    with open(path, 'rb') as f:
        f.seek(((size // REC_SIZE) - 1) * REC_SIZE)
        return int(REC.unpack(f.read(REC_SIZE))[0])


def dates_in_file(path: str) -> list[int]:
    if not os.path.exists(path) or os.path.getsize(path) < REC_SIZE:
        return []
    with open(path, 'rb') as f:
        a = np.frombuffer(f.read(), dtype=RAW_DT)
    return [int(x) for x in np.unique(a['date'])]


def load_file(path: str) -> dict:
    """读整个 .fs 文件，价格换算回元。文件不存在返回空 dict。"""
    if not os.path.exists(path) or os.path.getsize(path) < REC_SIZE:
        return {}
    with open(path, 'rb') as f:
        buf = f.read()
    n = len(buf) // REC_SIZE
    a = np.frombuffer(buf[:n * REC_SIZE], dtype=RAW_DT, count=n)
    return {
        'code': os.path.splitext(os.path.basename(path))[0][2:],
        'path': path,
        'date': a['date'].astype(np.int64),
        'time': a['time'].astype(np.int64),
        'price': a['price_cent'].astype(np.float64) / 100.0,
        'volume': a['volume'].astype(np.float64),
    }


def load_day(path: str, date: int) -> dict:
    """取某一天的 240 槽（按网格对齐）。该日无数据返回空 dict。"""
    m = load_file(path)
    if not m:
        return {}
    keep = m['date'] == int(date)
    if not keep.any():
        return {}
    times = [int(t) for t in m['time'][keep]]
    order = np.argsort(times)
    return {
        'date': int(date),
        'time': [times[i] for i in order],
        'price': m['price'][keep][order],
        'volume': m['volume'][keep][order],
    }


def verify_file(path: str, expected_days: list[int] | None = None,
                max_report: int = 5) -> dict:
    """结构自检：长度、时间网格、日期有序、价格网格、成交量非负、每日槽数。"""
    errors: list[str] = []
    warnings: list[str] = []
    counts: dict[str, int] = {}
    rep = {
        'path': path, 'exists': os.path.exists(path), 'bytes': 0, 'records': 0,
        'trailing_bytes': 0, 'days': 0, 'date_min': None, 'date_max': None, 'grid': 'ok',
        'counts': counts, 'errors': errors, 'warnings': warnings, 'ok': False,
    }
    if not rep['exists']:
        errors.append('文件不存在')
        return rep
    size = os.path.getsize(path)
    rep['bytes'] = size
    rep['trailing_bytes'] = size % REC_SIZE
    if size % REC_SIZE:
        errors.append(f'长度 {size} 不是 {REC_SIZE} 的整数倍（余 {size % REC_SIZE} 字节）')
    n = size // REC_SIZE
    rep['records'] = n
    if n == 0:
        errors.append('文件为空')
        return rep
    m = load_file(path)
    dates, times = m['date'], m['time']
    rep['date_min'] = int(dates.min())
    rep['date_max'] = int(dates.max())
    uniq, cnt = np.unique(dates, return_counts=True)
    rep['days'] = int(uniq.size)

    bad_grid = int(np.count_nonzero(times != np.array(GRID * uniq.size, dtype=np.int64)[:n])) \
        if n == uniq.size * SLOTS else -1
    # 逐日校验网格与槽数（比上面的向量化更直白，且能给出具体日期）
    off_grid_days = []
    bad_slot_days = []
    cursor = 0
    order = np.argsort(dates, kind='stable')
    dates_sorted = dates[order]
    times_sorted = times[order]
    for d in uniq:
        block_t = times_sorted[dates_sorted == d]
        if block_t.size != SLOTS:
            bad_slot_days.append((int(d), int(block_t.size)))
        elif list(block_t) != list(GRID):
            off_grid_days.append(int(d))
    counts['slot_mismatch_days'] = len(bad_slot_days)
    counts['grid_mismatch_days'] = len(off_grid_days)
    rep['grid'] = 'ok' if not (bad_slot_days or off_grid_days) else 'bad'
    if bad_slot_days:
        errors.append(f'{len(bad_slot_days)} 个交易日的槽数不是 {SLOTS}：{bad_slot_days[:max_report]}')
    if off_grid_days:
        errors.append(f'{len(off_grid_days)} 个交易日的时间网格不符：{off_grid_days[:max_report]}')
    counts['date_backwards'] = int(np.count_nonzero(np.diff(dates_sorted) < 0))
    if counts['date_backwards']:
        errors.append(f'日期出现回退 {counts["date_backwards"]} 处')
    bad_price = int(np.count_nonzero(m['price'] <= 0))
    counts['bad_price'] = bad_price
    if bad_price:
        errors.append(f'价格 ≤0 的记录 {bad_price} 条')
    bad_vol = int(np.count_nonzero(m['volume'] < 0))
    counts['bad_volume'] = bad_vol
    if bad_vol:
        errors.append(f'成交量为负的记录 {bad_vol} 条')
    counts['zero_volume'] = int(np.count_nonzero(m['volume'] == 0))
    if counts['zero_volume']:
        warnings.append(f'成交量为 0 的记录 {counts["zero_volume"]} 条'
                        '（14:58/14:59 等集合竞价槽属正常）')

    if expected_days:
        have = {int(d) for d in uniq}
        missing = [int(d) for d in expected_days if int(d) not in have]
        counts['missing_days'] = len(missing)
        if missing:
            warnings.append(f'相对交易日历缺 {len(missing)} 天（停牌/未上市/采集缺口）：'
                            f'{missing[:max_report]}')
    rep['ok'] = not errors
    return rep


def dataset_summary(root: str | None = None) -> dict:
    base = root_dir(root)
    cal = os.path.join(base, 'calendar.txt')
    days = []
    if os.path.exists(cal):
        with open(cal, encoding='utf-8') as f:
            days = [int(x) for x in (line.strip() for line in f) if x]
    by_market: dict[str, int] = {}
    fs_root = os.path.join(base, 'fs')
    for market in sorted(os.listdir(fs_root)) if os.path.isdir(fs_root) else []:
        d = os.path.join(fs_root, market)
        if os.path.isdir(d):
            by_market[market] = len([f for f in os.listdir(d) if f.endswith('.fs')])
    meta = {}
    meta_path = os.path.join(base, 'meta.json')
    if os.path.exists(meta_path):
        with open(meta_path, encoding='utf-8') as f:
            meta = json.load(f)
    total_bytes = 0
    for market, _ in by_market.items():
        d = os.path.join(fs_root, market)
        for f in os.listdir(d):
            total_bytes += os.path.getsize(os.path.join(d, f))
    return {
        'root': base, 'calendar_days': len(days),
        'date_min': min(days) if days else None, 'date_max': max(days) if days else None,
        'codes_by_market': by_market, 'code_files': sum(by_market.values()),
        'bytes': total_bytes, 'gb': round(total_bytes / 1024 ** 3, 2), 'meta': meta,
    }


def _main(argv=None) -> int:
    ap = argparse.ArgumentParser(description='通达信历史分时数据集（.fs）读取与自检')
    ap.add_argument('--root', default='', help=f'数据集根目录，默认 {DEFAULT_ROOT}')
    sub = ap.add_subparsers(dest='cmd', required=True)

    sub.add_parser('info', help='数据集概览')

    v = sub.add_parser('verify', help='结构自检')
    v.add_argument('--code', default='', help='只查一只；留空查全部')
    v.add_argument('--limit', type=int, default=0, help='最多查多少只（0=全部）')
    v.add_argument('--json', action='store_true')

    d = sub.add_parser('day', help='打印某只某天的 240 槽')
    d.add_argument('--code', required=True)
    d.add_argument('--date', type=int, required=True)
    d.add_argument('--head', type=int, default=6)

    args = ap.parse_args(argv)
    root = args.root or None

    if args.cmd == 'info':
        print(json.dumps(dataset_summary(root), ensure_ascii=False, indent=2))
        return 0

    if args.cmd == 'day':
        path = file_for(args.code, root)
        m = load_day(path, args.date)
        if not m:
            print(f'{path} 无 {args.date} 数据')
            return 1
        print(f'{args.code} {args.date}：{len(m["price"])} 槽')
        for i in range(min(args.head, len(m['price']))):
            print(f'   {m["time"][i]:04d}  price={m["price"][i]:.2f}  vol={int(m["volume"][i])}')
        print(f'   ... 末槽 {m["time"][-1]:04d}  price={m["price"][-1]:.2f}'
              f'  vol={int(m["volume"][-1])}')
        return 0

    if args.code:
        files = [file_for(args.code, root)]
    else:
        base = os.path.join(root_dir(root), 'fs')
        files = []
        for market in sorted(os.listdir(base)) if os.path.isdir(base) else []:
            d = os.path.join(base, market)
            if os.path.isdir(d):
                files.extend(os.path.join(d, f) for f in sorted(os.listdir(d)) if f.endswith('.fs'))
        if args.limit:
            files = files[:args.limit]
    reports = [verify_file(p) for p in files]
    if args.json:
        print(json.dumps(reports, ensure_ascii=False, indent=2))
    else:
        bad = [r for r in reports if not r['ok']]
        for r in bad[:10]:
            print(f'[不通过] {r["path"]}')
            for e in r['errors']:
                print(f'         {e}')
        print(f'合计 {len(reports)} 个文件：通过 {len(reports) - len(bad)}，不通过 {len(bad)}')
        if reports and not bad:
            r = reports[0]
            print(f'示例：{r["path"]} 记录 {r["records"]}，{r["days"]} 个交易日，'
                  f'{r["date_min"]}~{r["date_max"]}')
    return 1 if any(not r['ok'] for r in reports) else 0


if __name__ == '__main__':
    sys.exit(_main())
