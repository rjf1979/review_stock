# -*- coding: utf-8 -*-
"""通达信本地分钟线（.lc1 / .lc5）读取。

通达信分钟线定长 32 字节：

``USHORT date; USHORT time; float open, high, low, close, amount; DWORD volume; DWORD reserved``

* ``date`` = ``(year - 2004) * 2048 + month * 100 + day``
* ``time`` = ``hour * 60 + minute``（分钟线为该分钟**结束**时刻）
* 价格是真实成交价（**不复权**），``amount`` 为元，``volume`` 为股

文件位置：``{tdx}/vipdoc/{sh,sz}/minline/{sh,sz}{code}.lc1``（1 分钟）、
``fzline/*.lc5``（5 分钟）。这两类文件只有在本机通达信执行过
「盘后数据下载」后才存在，否则目录为空。

用法::

    from tdx_minute import load_minute, minute_codes, bar_at

    m = load_minute('600000', freq=1)      # {'date','time','open','high','low','close','amount','volume'}
    minute_codes(freq=1)                   # 本机已下载的代码列表
"""
from __future__ import annotations

import os
import struct

import numpy as np

from tdx_sector import resolve_tdx_dir

REC = 32
RAW_DT = np.dtype([
    ('date', '<u2'), ('time', '<u2'),
    ('open', '<f4'), ('high', '<f4'), ('low', '<f4'), ('close', '<f4'),
    ('amount', '<f4'), ('volume', '<u4'), ('reserved', '<u4'),
])

FREQ_DIR = {1: ('minline', '.lc1'), 5: ('fzline', '.lc5')}


def minute_dir(freq: int = 1, tdx_dir: str | None = None) -> str:
    sub = FREQ_DIR.get(freq)
    if not sub:
        raise ValueError(f'不支持的分钟频率: {freq}')
    return os.path.join(resolve_tdx_dir(tdx_dir), 'vipdoc', sub[0])


def minute_path(code: str, freq: int = 1, tdx_dir: str | None = None) -> str:
    sub = FREQ_DIR.get(freq)
    if not sub:
        raise ValueError(f'不支持的分钟频率: {freq}')
    market = 'sh' if code[0] in '5689' else 'sz'
    return os.path.join(resolve_tdx_dir(tdx_dir), 'vipdoc', market,
                        sub[0], f'{market}{code}{sub[1]}')


def has_minute(code: str, freq: int = 1, tdx_dir: str | None = None) -> bool:
    p = minute_path(code, freq, tdx_dir)
    return os.path.exists(p) and os.path.getsize(p) >= REC


def minute_codes(freq: int = 1, tdx_dir: str | None = None) -> list[str]:
    """本机已下载分钟线的代码（沪深两目录合并，仅保留 A 股代码）。"""
    suffix = FREQ_DIR[freq][1]
    out: set[str] = set()
    for market in ('sh', 'sz'):
        d = os.path.join(resolve_tdx_dir(tdx_dir), 'vipdoc', market, FREQ_DIR[freq][0])
        if not os.path.isdir(d):
            continue
        for fn in os.listdir(d):
            if not fn.endswith(suffix):
                continue
            code = fn[len(market):-len(suffix)]
            if len(code) != 6 or not code.isdigit():
                continue
            if market == 'sh' and not code.startswith(('60', '68')):
                continue
            if market == 'sz' and not code.startswith(('000', '001', '002', '003', '004',
                                                       '300', '301')):
                continue
            out.add(code)
    return sorted(out)


def decode_date(a: np.ndarray) -> np.ndarray:
    # 注意：必须先升到 int64，uint16 下 y*10000 会溢出
    a = np.asarray(a, dtype=np.int64)
    y = (a // 2048) + 2004
    rest = a % 2048
    return y * 10000 + (rest // 100) * 100 + (rest % 100)


def decode_time(a: np.ndarray) -> np.ndarray:
    a = np.asarray(a, dtype=np.int64)
    return (a // 60) * 100 + (a % 60)                      # HHMM 整数


def load_minute(code: str, freq: int = 1, tdx_dir: str | None = None,
                start: int | None = None, end: int | None = None) -> dict:
    """读取单只个股分钟线；缺失返回空 dict。``start/end`` 为 YYYYMMDD 整数。"""
    path = minute_path(code, freq, tdx_dir)
    if not os.path.exists(path) or os.path.getsize(path) < REC:
        return {}
    with open(path, 'rb') as f:
        buf = f.read()
    a = np.frombuffer(buf, dtype=RAW_DT, count=len(buf) // REC)
    dates = decode_date(a['date'])
    times = decode_time(a['time'])
    keep = np.ones(len(a), dtype=bool)
    if start is not None:
        keep &= dates >= int(start)
    if end is not None:
        keep &= dates <= int(end)
    if not keep.all():
        a, dates, times = a[keep], dates[keep], times[keep]
    return {
        'code': code, 'freq': freq,
        'date': dates, 'time': times,
        'open': a['open'].astype(np.float64), 'high': a['high'].astype(np.float64),
        'low': a['low'].astype(np.float64), 'close': a['close'].astype(np.float64),
        'amount': a['amount'].astype(np.float64),
        'volume': a['volume'].astype(np.float64),
    }


def mask_at(m: dict, ymd: int, hhmm: int) -> int:
    """返回给定日期/时刻的行下标，找不到返回 -1（分钟线时间戳为该分钟结束）。"""
    if not m:
        return -1
    idx = np.nonzero((m['date'] == ymd) & (m['time'] == hhmm))[0]
    return int(idx[0]) if len(idx) else -1


def mask_range(m: dict, ymd: int, t_from: int, t_to: int) -> np.ndarray:
    """给定日期的 [t_from, t_to] 时间段掩码（HHMM 整数）。"""
    if not m:
        return np.zeros(0, dtype=bool)
    return (m['date'] == ymd) & (m['time'] >= t_from) & (m['time'] <= t_to)
