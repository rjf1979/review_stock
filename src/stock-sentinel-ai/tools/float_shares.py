# -*- coding: utf-8 -*-
"""历史时点流通股本 / 总股本（万股）——消除「用当前快照回看历史」造成的前视。

为什么需要它
-----------
回测原先用「最新东财快照的流通市值 ÷ 快照日收盘价」反推流通股本，再把它当成
**常量**套用到 2021~2026 每一天。这是前视：股本在区间内会因送转、增发、回购而
变化，凡是后来发生过大比例送转的股票，其历史换手率会被系统性低估。

数据来源
-------
通达信 gbbq 的 category≠1 记录（`股本变化`/`送配股上市`/`非流通股上市`/`增发新股上市`
等）携带 4 个 float，经与最新快照交叉验证后确认语义为：

    f1 = 变更前流通股本（万股）      f2 = 变更前总股本（万股）
    f3 = 变更后流通股本（万股）      f4 = 变更后总股本（万股）

验证结论（2026-09-18 快照，4592 只可比样本）：总股本精确吻合；流通股本相对误差
中位 0.00%、p99 0.09%、99.6% 的样本误差 ≤1%。残余误差来自「限售股解禁」这类
不产生 gbbq 事件的流通股增加。

用法
----
    from float_shares import ShareBook
    book = ShareBook.load()
    book.shares_wan('600519', 20240628)
    book.shares_series('600519', dates_array)
"""
from __future__ import annotations

import json
import os

import numpy as np

from gbbq import DEFAULT_GBBQ, decode_gbbq

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SNAP_DIR = os.path.join(ROOT, 'data', 'snapshots')
CACHE_DIR = os.path.join(ROOT, 'data', 'backtest', '_cache')
CACHE_FILE = os.path.join(CACHE_DIR, 'gbbq-share-timeline.json')

# category=1 是除权除息，4 个 float 的语义完全不同（分红/配股价/送股/配股），必须排除。
EXDIV_CATEGORY = 1
# 股本规模合理区间（万股）：100 万股 ~ 50 亿股，用来剔除脏记录。
MIN_SHARES_WAN = 100.0
MAX_SHARES_WAN = 5.0e7

SOURCE_GBBQ = 'gbbq_pit'            # 逐日时点股本，无前视
SOURCE_SNAPSHOT = 'snapshot_const'  # 无 gbbq 记录，退回当前快照常量（有前视）
SOURCE_MISSING = 'missing'


def _valid(f3: float, f4: float) -> bool:
    return (MIN_SHARES_WAN <= f3 <= MAX_SHARES_WAN) and (MIN_SHARES_WAN <= f4 <= MAX_SHARES_WAN)


def build_timeline(records: list[dict]) -> dict[str, list[list[float]]]:
    """gbbq 记录 → {code: [[date, 流通股本, 总股本], ...] 升序}。

    首项固定为 {date: 0} 哨兵，承载「最早一次变更之前」的股本，
    保证任何早于首个变更日的交易日也能取到值。
    """
    raw: dict[str, list[list[float]]] = {}
    for rec in records:
        if int(rec.get('category') or 0) == EXDIV_CATEGORY:
            continue
        code = str(rec.get('code') or '')
        if not code:
            continue
        before_fs, before_ts = float(rec['hongli']), float(rec['peigujia'])
        after_fs, after_ts = float(rec['songgu']), float(rec['peigu'])
        if not _valid(after_fs, after_ts):
            continue
        raw.setdefault(code, []).append([int(rec['date']), after_fs, after_ts, before_fs, before_ts])
    out: dict[str, list[list[float]]] = {}
    for code, rows in raw.items():
        rows.sort(key=lambda r: r[0])
        seq: list[list[float]] = []
        head = rows[0]
        if _valid(head[3], head[4]):
            seq.append([0.0, head[3], head[4]])
        for r in rows:
            seq.append([float(r[0]), r[1], r[2]])
        out[code] = seq
    return out


def load_snapshot_shares() -> tuple[dict[str, float], str]:
    """最新快照 → ({code: 流通股本（万股）}, 快照日)。"""
    if not os.path.isdir(SNAP_DIR):
        return {}, ''
    files = sorted(f for f in os.listdir(SNAP_DIR) if f.endswith('.json'))
    if not files:
        return {}, ''
    latest = files[-1].split('__')[0]
    out: dict[str, float] = {}
    for fn in files:
        if not fn.startswith(latest):
            continue
        try:
            with open(os.path.join(SNAP_DIR, fn), 'r', encoding='utf-8') as f:
                data = json.load(f)
        except (OSError, ValueError):
            continue
        for rec in data.get('records') or []:
            code = str(rec.get('code') or '')
            price = float(rec.get('price') or 0.0)
            mcap = float(rec.get('floatMcap') or 0.0)
            if code and price > 0 and mcap > 0:
                out[code] = mcap / price / 1e4
    return out, latest


class ShareBook:
    """按 (code, date) 提供历史时点流通股本 / 总股本（万股）。"""

    def __init__(self, timeline: dict[str, list], snap_shares: dict[str, float],
                 snap_date: str = '', gbbq_meta: dict | None = None):
        self.timeline = timeline
        self.snap_shares = snap_shares
        self.snap_date = snap_date
        self.gbbq_meta = gbbq_meta or {}
        self._dates: dict[str, np.ndarray] = {}
        self._fs: dict[str, np.ndarray] = {}
        self._ts: dict[str, np.ndarray] = {}
        for code, seq in timeline.items():
            arr = np.asarray(seq, dtype=np.float64)
            self._dates[code] = arr[:, 0]
            self._fs[code] = arr[:, 1]
            self._ts[code] = arr[:, 2]

    # ------------------------------------------------------------- 构造
    @classmethod
    def load(cls, gbbq_path: str = DEFAULT_GBBQ, use_cache: bool = True) -> 'ShareBook':
        snap_shares, snap_date = load_snapshot_shares()
        meta = _file_meta(gbbq_path)
        if use_cache:
            cached = _read_cache(meta)
            if cached is not None:
                return cls(cached, snap_shares, snap_date, meta)
        timeline = build_timeline(decode_gbbq(gbbq_path))
        if use_cache and timeline:
            _write_cache(meta, timeline)
        return cls(timeline, snap_shares, snap_date, meta)

    # ------------------------------------------------------------- 查询
    def shares_wan(self, code: str, date_int: int) -> float | None:
        """历史时点流通股本（万股）；无 gbbq 记录时退回快照常量。"""
        code = str(code)
        dates = self._dates.get(code)
        if dates is None or not len(dates):
            return self.snap_shares.get(code) or None
        i = int(np.searchsorted(dates, float(date_int), side='right')) - 1
        if i < 0:
            return None
        return float(self._fs[code][i])

    def total_shares_wan(self, code: str, date_int: int) -> float | None:
        code = str(code)
        dates = self._dates.get(code)
        if dates is None or not len(dates):
            return None
        i = int(np.searchsorted(dates, float(date_int), side='right')) - 1
        if i < 0:
            return None
        return float(self._ts[code][i])

    def source(self, code: str) -> str:
        code = str(code)
        if code in self.timeline:
            return SOURCE_GBBQ
        if code in self.snap_shares:
            return SOURCE_SNAPSHOT
        return SOURCE_MISSING

    def shares_series(self, code: str, dates: np.ndarray) -> tuple[np.ndarray, str]:
        """把流通股本对齐到给定 YYYYMMDD 数组；返回 (股本数组（万股）, 口径)。"""
        dates = np.asarray(dates, dtype=np.int64)
        code = str(code)
        ev_dates = self._dates.get(code)
        if ev_dates is None or not len(ev_dates):
            const = self.snap_shares.get(code)
            if const:
                return np.full(len(dates), const, dtype=np.float64), SOURCE_SNAPSHOT
            return np.full(len(dates), np.nan, dtype=np.float64), SOURCE_MISSING
        idx = np.searchsorted(ev_dates, dates.astype(np.float64), side='right') - 1
        out = np.full(len(dates), np.nan, dtype=np.float64)
        ok = idx >= 0
        out[ok] = self._fs[code][idx[ok]]
        return out, SOURCE_GBBQ

    @staticmethod
    def turnover_pct(volume_shares: np.ndarray, float_shares_wan: np.ndarray) -> np.ndarray:
        """换手率 % = 成交量（股）÷ 流通股本（股）× 100。"""
        with np.errstate(invalid='ignore', divide='ignore'):
            return np.where(float_shares_wan > 0,
                            volume_shares / (float_shares_wan * 1e4) * 100.0, np.nan)


def _file_meta(path: str) -> dict:
    try:
        st = os.stat(path)
        return {'path': os.path.abspath(path), 'size': int(st.st_size), 'mtime': int(st.st_mtime)}
    except OSError:
        return {'path': os.path.abspath(path), 'size': 0, 'mtime': 0}


def _read_cache(meta: dict):
    if not meta.get('size'):
        return None
    try:
        with open(CACHE_FILE, 'r', encoding='utf-8') as f:
            payload = json.load(f)
    except (OSError, ValueError):
        return None
    if payload.get('source') != {'size': meta['size'], 'mtime': meta['mtime']}:
        return None
    return payload.get('timeline')


def _write_cache(meta: dict, timeline: dict) -> None:
    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
        tmp = CACHE_FILE + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump({'source': {'size': meta['size'], 'mtime': meta['mtime']},
                       'gbbq': meta['path'], 'timeline': timeline}, f)
        os.replace(tmp, CACHE_FILE)
    except OSError:
        pass


def _main() -> int:
    import sys
    book = ShareBook.load()
    print(f'gbbq = {book.gbbq_meta.get("path")}（{book.gbbq_meta.get("size", 0)} 字节）')
    print(f'时间线代码数 = {len(book.timeline)}；快照 {book.snap_date} 覆盖 {len(book.snap_shares)} 只')
    for code, date in (('600519', 20200630), ('600519', 20240628),
                       ('300750', 20240628), ('000001', 20240628)):
        fs = book.shares_wan(code, date)
        ts = book.total_shares_wan(code, date)
        print(f'  {code} @{date}: 流通 {fs:.0f} 万股 / 总 {ts:.0f} 万股（{book.source(code)}）'
              if fs and ts else f'  {code} @{date}: 无数据')
    if len(sys.argv) > 1 and sys.argv[1] == '--verify':
        return _verify(book)
    return 0


def _verify(book: 'ShareBook') -> int:
    """用最新快照交叉验证时点股本。"""
    files = sorted(f for f in os.listdir(SNAP_DIR) if f.endswith('.json'))
    if not files:
        print('无快照')
        return 1
    latest = files[-1].split('__')[0]
    snap_int = int(latest.replace('-', ''))
    rows: list[tuple[float, str]] = []
    for fn in files:
        if not fn.startswith(latest):
            continue
        with open(os.path.join(SNAP_DIR, fn), 'r', encoding='utf-8') as f:
            data = json.load(f)
        for rec in data.get('records') or []:
            code = str(rec.get('code') or '')
            price = float(rec.get('price') or 0)
            fm = float(rec.get('floatMcap') or 0)
            if price <= 0 or fm <= 0:
                continue
            got = book.shares_wan(code, snap_int)
            if not got:
                continue
            rows.append((abs(got / (fm / price / 1e4) - 1.0), code))
    rows.sort()
    if not rows:
        print('无可比样本')
        return 1
    for q, label in ((0.5, '中位'), (0.9, 'p90'), (0.99, 'p99')):
        i = min(int(len(rows) * q), len(rows) - 1)
        print(f'  相对误差 {label} = {rows[i][0] * 100:.2f}%')
    print(f'  <=1%: {sum(1 for r in rows if r[0] <= 0.01) / len(rows) * 100:.1f}%'
          f'  <=3%: {sum(1 for r in rows if r[0] <= 0.03) / len(rows) * 100:.1f}%（n={len(rows)}）')
    return 0


if __name__ == '__main__':
    raise SystemExit(_main())
