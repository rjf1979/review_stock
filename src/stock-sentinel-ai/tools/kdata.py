# -*- coding: utf-8 -*-
"""
数据层：直接读取通达信本地日线（data/hsjday），输出 numpy 结构化数组。

设计要点
--------
* 主数据源是通达信二进制（32 字节定长），**不是** SQLite。
  实测：TDX→numpy 全市场 1786 万根 1.9s；SQLite 全表 fetchall 841 万根 17.7s（约慢 20 倍）。
* 输出统一的 numpy 结构化 dtype BAR_DT，便于向量化计算形态。
* 支持一次性载入全市场到内存（约 0.93 GB），后续形态计算与参数寻优全在内存完成。
* SQLite 只存「元数据 + 复权因子 + 回测结果」，不存 K 线主体。

用法
----
    from kdata import Market
    mkt = Market()                 # 扫描 hsjday
    bars = mkt.load('600519')      # 单只，不复权
    bars = mkt.load('600519', adj='qfq')   # 前复权
    allb = mkt.load_all(adj='qfq') # 全市场 dict
"""
from __future__ import annotations

import os
import struct
import threading
from concurrent.futures import ThreadPoolExecutor

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ROOT = os.path.normpath(os.path.join(HERE, '..', 'data', 'hsjday'))

REC = 32
# 通达信 .day 定长 32 字节：
#   [0-3]  日期 uint32 YYYYMMDD
#   [4-7]  开盘 uint32 ×100      [8-11] 最高 uint32 ×100
#   [12-15]最低 uint32 ×100      [16-19]收盘 uint32 ×100
#   [20-23]成交额 float32 元      [24-27]成交量 uint32 股      [28-31]保留
RAW_DT = np.dtype([('d', '<i4'), ('o', '<u4'), ('h', '<u4'), ('l', '<u4'),
                   ('c', '<u4'), ('a', '<f4'), ('v', '<u4'), ('r', '<u4')])

# 统一对外输出的 dtype
BAR_DT = np.dtype([('date', '<i4'),      # YYYYMMDD
                   ('open', '<f8'), ('high', '<f8'), ('low', '<f8'), ('close', '<f8'),
                   ('volume', '<f8'),    # 股
                   ('amount', '<f8'),    # 元
                   ('turnover', '<f8')])  # 换手率%，无则为 nan

_SH = ('60', '68')
_SZ = ('000', '001', '002', '003', '004', '300', '301')


def is_stock(market: str, code: str) -> bool:
    return (market == 'sh' and code.startswith(_SH)) or \
           (market == 'sz' and code.startswith(_SZ))


def market_of(code: str) -> str:
    return 'sh' if code[0] in '56' else 'sz'


def board_of(code: str) -> str:
    if code.startswith('68'):
        return '科创板'
    if code.startswith('30'):
        return '创业板'
    if code.startswith(('000', '001')):
        return '深主板'
    if code.startswith(('002', '003', '004')):
        return '中小板'
    if code.startswith('60'):
        return '沪主板'
    return '其他'


def ymd_to_int(date_str: str) -> int:
    return int(date_str.replace('-', ''))


def int_to_ymd(d: int) -> str:
    s = str(int(d))
    return f'{s[:4]}-{s[4:6]}-{s[6:]}'


def read_day_file(path: str) -> np.ndarray:
    """读取单个 .day 文件，返回 BAR_DT 结构化数组（不复权，按日期升序）。"""
    with open(path, 'rb') as f:
        raw = f.read()
    if len(raw) < REC:
        return np.empty(0, dtype=BAR_DT)
    a = np.frombuffer(raw, dtype=RAW_DT, count=len(raw) // REC)
    out = np.empty(len(a), dtype=BAR_DT)
    out['date'] = a['d']
    out['open'] = a['o'] / 100.0
    out['high'] = a['h'] / 100.0
    out['low'] = a['l'] / 100.0
    out['close'] = a['c'] / 100.0
    out['volume'] = a['v'].astype(np.float64)
    out['amount'] = a['a'].astype(np.float64)
    out['turnover'] = np.nan
    return out


class Market:
    """通达信本地日线市场数据访问器。"""

    def __init__(self, root: str = DEFAULT_ROOT, min_bars: int = 250):
        self.root = root
        self.min_bars = min_bars
        self._files: dict[str, str] = {}
        self._names: dict[str, str] = {}
        self._meta: dict[str, dict] = {}
        self._cache: dict[str, np.ndarray] = {}
        self._lock = threading.Lock()
        self.scan()

    # ---------- 扫描 ----------
    def scan(self) -> None:
        if not os.path.isdir(self.root):
            raise FileNotFoundError(f'本地日线目录不存在: {self.root}')
        for m in ('sh', 'sz'):
            d = os.path.join(self.root, m, 'lday')
            if not os.path.isdir(d):
                continue
            for fn in os.listdir(d):
                if not fn.endswith('.day'):
                    continue
                code = fn[len(m):-4]
                if not is_stock(m, code):
                    continue
                self._files[code] = os.path.join(d, fn)
        self._load_meta()

    def _load_meta(self) -> None:
        """从库或通达信名称文件补充股票名称；失败则留空代码。"""
        for code, path in self._files.items():
            n = os.path.getsize(path) // REC
            self._meta[code] = {
                'code': code,
                'market': market_of(code).upper(),
                'board': board_of(code),
                'bar_count': n,
                'name': self._names.get(code, ''),
                'path': path,
            }

    def set_names(self, names: dict[str, str]) -> None:
        self._names.update(names)
        for code, meta in self._meta.items():
            meta['name'] = self._names.get(code, '')

    # ---------- 访问 ----------
    def __len__(self) -> int:
        return len(self._files)

    def codes(self, min_bars: int | None = None) -> list[str]:
        mb = self.min_bars if min_bars is None else min_bars
        return sorted(c for c, m in self._meta.items() if m['bar_count'] >= mb)

    def meta(self, code: str) -> dict:
        return self._meta.get(code, {})

    def path(self, code: str) -> str:
        return self._files[code]

    def raw(self, code: str, use_cache: bool = True) -> np.ndarray:
        """不复权原始日线（真实成交价）。"""
        if use_cache:
            with self._lock:
                hit = self._cache.get(code)
            if hit is not None:
                return hit
        arr = read_day_file(self._files[code])
        if use_cache:
            with self._lock:
                self._cache[code] = arr
        return arr

    # ---------- 复权 ----------
    def load(self, code: str, adj: str = 'raw', factors=None) -> np.ndarray:
        """adj: raw / qfq(前复权) / hfq(后复权)"""
        bars = self.raw(code).copy()
        if adj == 'raw' or factors is None:
            return bars
        f = factor_series(factors, bars['date'])      # 与 bars 等长
        if adj == 'qfq':
            for k in ('open', 'high', 'low', 'close'):
                bars[k] = bars[k] / f
        elif adj == 'hfq':
            for k in ('open', 'high', 'low', 'close'):
                bars[k] = bars[k] * f
        else:
            raise ValueError(f'未知复权方式: {adj}')
        return bars

    # ---------- 批量 ----------
    def load_all(self, adj: str = 'raw', factors: dict | None = None,
                 codes: list[str] | None = None, workers: int = 8,
                 use_cache: bool = True) -> dict[str, np.ndarray]:
        codes = codes or self.codes()
        out: dict[str, np.ndarray] = {}

        def one(c):
            try:
                return c, self.load(c, adj, (factors or {}).get(c))
            except Exception:
                return c, None

        with ThreadPoolExecutor(max_workers=workers) as ex:
            for c, arr in ex.map(one, codes):
                if arr is not None and len(arr):
                    out[c] = arr
        return out

    def summary(self) -> dict:
        counts = [m['bar_count'] for m in self._meta.values()]
        if not counts:
            return {}
        a = np.array(counts)
        return {
            'stocks': len(counts),
            'total_bars': int(a.sum()),
            'min': int(a.min()), 'median': int(np.median(a)), 'max': int(a.max()),
            'ge_250': int((a >= 250).sum()),
        }


def factor_series(factors, dates: np.ndarray) -> np.ndarray:
    """
    factors: [(ex_date_str 'YYYY-MM-DD' 或 int YYYYMMDD, factor), ...] 按日期**降序**
             语义与新浪 qfq.js 一致：f 为「后复权因子」，前复权价 = 原始价 / f；
             最新区间 f == 1.0，越早越大。
    返回与 dates 等长的因子数组。
    """
    if not factors:
        return np.ones(len(dates), dtype=np.float64)
    fs = sorted(((ymd_to_int(str(d)) if isinstance(d, str) else int(d)), float(f))
                for d, f in factors)
    d_arr = np.array([x[0] for x in fs], dtype=np.int64)
    f_arr = np.array([x[1] for x in fs], dtype=np.float64)
    # searchsorted: 取最后一个 d <= date
    idx = np.searchsorted(d_arr, dates.astype(np.int64), side='right') - 1
    idx = np.clip(idx, 0, len(f_arr) - 1)
    return f_arr[idx]


def to_records(bars: np.ndarray) -> list[dict]:
    """转成 dict 列表（少量数据时用，批量场景请直接用 numpy）。"""
    return [{k: (int(v) if k == 'date' else float(v)) for k, v in zip(bars.dtype.names, row)}
            for row in bars]
