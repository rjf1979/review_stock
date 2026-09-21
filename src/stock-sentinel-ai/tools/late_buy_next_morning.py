# -*- coding: utf-8 -*-
"""尾盘买入（14:30 近似）→ 次日早盘卖出：全市场回测与分层统计。

策略口径
--------
* 入场：T 日尾盘买入（**以 T 日收盘价近似 14:30 价**）。
* 出场：T+1 日卖出。主口径 = T+1 开盘价；同时统计 T+1 最高价对应的「次日最高涨幅」，
  并给出「挂 +3% 止盈、未触发则开盘卖」的可执行收益模型。

**数据口径限制（报告中必须如实标注，勿粉饰）**

本工具是**日线近似口径**（精确口径见 ``late_buy_next_morning_minute.py``）：

* 「14:30 价」用 T 日**收盘价**近似，14:30→15:00 的漂移未建模；
* 「次日上午最高涨幅」用 T+1 日**全天最高价**近似，是上午最高涨幅的**上界**，
  系统性偏高（真实上午最高只会 ≤ 该值）。

标的池：**只含个股**（``kdata.is_stock`` 限定沪市 60/68、深市 000/001/002/003/004/300/301），
指数、ETF/LOF、可转债、B 股、北交所均不在池内；默认进一步剔除 ST、科创板（``--include-star``
可放开）、**银行股**（``--exclude-industry`` 可调整）与**退市股**。

退市判定按 ``.day`` **最后交易日**（``--delist-grace-days`` 默认 90 自然日），
不再等价于「不在最新东财快照里」——旧口径会误伤 600+ 只在交易的科创板个股。
``--delist-scope stock``（默认，符合「剔除退市股」的口径）整只剔除该股全部历史，
统计上偏乐观；``--delist-scope trade`` 只剔除其停牌前 grace 天内的成交，无幸存者偏差；
``--keep-delisted`` 完全不剔除。板块指数与沪深 300 只作为**特征输入**，不是回测标的。

收益率一律用**前复权**价计算（除权除息不产生假跳空）；涨跌停、封板判定用
**不复权**原始价。

**特征层口径（2026-09-21 修正，消除前视）**

* 名称：``tdx_names``（通达信 ``hq_cache/{shs,szs}.tnf``，含科创板，快照未覆盖的
  在交易个股也能拿到名称）。
* 流通股本 / 流通市值：``float_shares.ShareBook`` 按 **买入日时点**取 gbbq 股本事件
  推导的历史股本（``float_shares_wan``、``float_shares_src`` 逐笔留痕），
  不再把最新快照的流通市值当常量套用整段历史。
* 换手率：``turnover_pct`` = 当日成交量（股）÷ **时点**流通股本 × 100。
* 涨跌停比例：``indicators.limit_ratio_series`` 用时点自校准（识别 ST 期间的 5%），
  不再用「当前名称里有没有 ST」回看历史。

**仍未消除的偏差（必须在报告中同时标注）**：默认剔除退市股（幸存者偏差，偏乐观）、
ST 个股按**当前** ST 标记整段剔除、行业分类为通达信当前分类。需要「无幸存者偏差」
的全样本口径时用 ``--delist-scope trade`` 重跑并对比。

用法::

    python tools/late_buy_next_morning.py --start 2021-01-01
    python tools/late_buy_next_morning.py --focus tools/focus_tail_strong.json
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import struct
import sys
from collections import defaultdict
from datetime import date, timedelta

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from float_shares import ShareBook  # noqa: E402
from indicators import compute_indicators, limit_ratio, limit_ratio_series  # noqa: E402
from kdata import Market, int_to_ymd, is_stock, market_of  # noqa: E402
from tdx_sector import align_series, load_board_series, load_industry_map  # noqa: E402
from tdx_names import load_tdx_names  # noqa: E402

ROOT = os.path.normpath(os.path.join(HERE, '..'))
OUT_DEFAULT = os.path.join(ROOT, 'data', 'backtest', 'late-buy-next-morning')
SNAP_DIR = os.path.join(ROOT, 'data', 'snapshots')
BENCH_CODE = '000300'

THRESHOLDS = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09]
TARGET = 0.03                     # 策略止盈档：次日最高涨幅 ≥ 3%
COST = 0.0015                     # 单边摩擦成本合计（佣金+印花税+滑点，宽松估计）
HIST_EDGES = np.arange(-0.15, 0.2501, 0.005)
HIST_N = len(HIST_EDGES) - 1
ZERO_BIN = int(np.searchsorted(HIST_EDGES, 0.0, side='left'))

DETAIL_COLS = [
    'code', 'name', 'board', 'hy_name', 'date', 'close', 'pct', 'amp', 'close_pos',
    'upper_shadow', 'lower_shadow', 'vol_ratio', 'amount_wan', 'float_mcap_yi',
    'turnover_pct', 'float_shares_wan', 'float_shares_src',
    'bias20', 'bias60', 'rsi14', 'atr_pct', 'ret5', 'ret20', 'ret60', 'dist_hh20',
    'list_days', 'hy_pct', 'hy_ret5', 'hy_ret20', 'bench_pct', 'is_limit_up',
    'touched_limit', 'next_open', 'next_high', 'next_close', 'ret_open', 'ret_high',
    'ret_close', 'limit_touch', 'hit3', 'strat_ret',
]


def dump_agg_raw(agg, path: str) -> None:
    """把聚合器内部原始累加量落盘，便于多进程分片后合并。"""
    slots = {}
    for k, s in agg.slots.items():
        slots[str(k)] = {
            'n': int(s['n']), 'limit': int(s['limit']),
            'ge': [int(x) for x in s['ge']],
            'sums': [float(s[x]) for x in
                     ('sum_open', 'sum_high', 'sum_close', 'sum_strat', 'sum_pos', 'sum_neg')],
            'hist_high': [int(x) for x in s['hist_high']],
            'hist_open': [int(x) for x in s['hist_open']],
            'hist_strat': [int(x) for x in s['hist_strat']],
        }
    with open(path, 'w', encoding='utf-8') as f:
        json.dump({'labels': list(getattr(agg, 'labels', [])), 'slots': slots},
                  f, ensure_ascii=False)


# ------------------------------------------------------------------ 工具
def load_latest_snapshot():
    """最近一份东财快照 → ({code: {...}}, 快照日期)。"""
    if not os.path.isdir(SNAP_DIR):
        return {}, ''
    files = sorted(f for f in os.listdir(SNAP_DIR) if f.endswith('.json'))
    if not files:
        return {}, ''
    latest = files[-1].split('__')[0]
    out: dict[str, dict] = {}
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
            if code:
                out[code] = {
                    'name': str(rec.get('name') or ''),
                    'float_mcap': float(rec.get('floatMcap') or 0.0),
                }
    return out, latest


def load_factors():
    db = os.path.join(ROOT, 'data', 'kline-full.db')
    if not os.path.exists(db):
        return {}
    out: dict[str, list] = defaultdict(list)
    conn = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
    try:
        for code, date, factor in conn.execute('SELECT code, ex_date, factor FROM adj_factors'):
            out[code].append((date, factor))
    finally:
        conn.close()
    return dict(out)


def last_bar_date(path: str) -> int:
    """读取 .day 文件最后一根 K 线的日期（YYYYMMDD）；文件异常时返回 0。"""
    try:
        size = os.path.getsize(path)
    except OSError:
        return 0
    if size < 32:
        return 0
    with open(path, 'rb') as f:
        f.seek(size - 32)
        return int(struct.unpack('<i', f.read(4))[0])


def shift_ymd(d: int, days: int) -> int:
    """YYYYMMDD 整型日期加减自然日。"""
    dt = date(d // 10000, d // 100 % 100, d % 100) + timedelta(days=days)
    return dt.year * 10000 + dt.month * 100 + dt.day


def bucket_index(values: np.ndarray, edges: np.ndarray) -> np.ndarray:
    idx = np.full(len(values), -1, dtype=np.int64)
    ok = np.isfinite(values)
    if ok.any():
        idx[ok] = np.clip(np.digitize(values[ok], edges) - 1, 0, len(edges) - 2)
    return idx


_MONTH_CUM = np.array([0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334])


def ymd_to_ordinal(d: np.ndarray) -> np.ndarray:
    """YYYYMMDD → 连续天序号（可直接相减得到自然日间隔），向量化且精确。"""
    d = np.asarray(d, dtype=np.int64)
    y, m, dd = d // 10000, (d // 100) % 100, d % 100
    leap = ((y % 4 == 0) & (y % 100 != 0)) | (y % 400 == 0)
    month_idx = np.clip(m, 1, 12) - 1
    doy = _MONTH_CUM[month_idx] + dd + (leap & (m > 2)).astype(np.int64)
    return y * 365 + y // 4 - y // 100 + y // 400 + doy


def filter_stock_universe(codes, market, snap, names, hy_map,
                          exclude_industry=('银行',), include_star=False,
                          keep_delisted=False, delist_grace_days=90,
                          delist_scope='stock'):
    """统一的「只含个股」股票池过滤，四个回测脚本共用，避免口径漂移。

    顺序：代码白名单（剔 B 股/北交所/指数/ETF）→ 科创板 → ST → 行业 → 退市。

    退市/长期停牌判定按 ``.day`` **最后交易日**（``delist_grace_days`` 自然日），
    不再等价于「不在最新东财快照里」——旧口径会误伤 600+ 只在交易的科创板个股。
    ``delist_scope='stock'`` 整只剔除该股全部历史（偏乐观）；``'trade'`` 保留历史，
    由调用方只剔除停牌前 grace 天内的成交（无幸存者偏差）。
    """
    codes = [c for c in codes if not c.startswith(('8', '4', '9'))]
    codes = [c for c in codes if is_stock(market_of(c), c)]
    if not include_star:
        codes = [c for c in codes if not c.startswith('68')]
    nm = {c: (names.get(c) or (snap.get(c) or {}).get('name', '') or '') for c in codes}
    st_codes = {c for c in codes if 'ST' in nm[c].upper()}
    codes = [c for c in codes if c not in st_codes]
    ex_hy: set[str] = set()
    for key in (exclude_industry or ()):
        if key:
            ex_hy |= {c for c, v in hy_map.items() if key in (v['hy_name'] or '')}
    if ex_hy:
        codes = [c for c in codes if c not in ex_hy]
    lasts: dict[str, int] = {}
    stale: set[str] = set()
    live_cutoff = 0
    if not keep_delisted:
        lasts = {c: last_bar_date(market.path(c)) for c in codes}
        newest = max(lasts.values()) if lasts else 0
        live_cutoff = shift_ymd(newest, -delist_grace_days)
        stale = {c for c, v in lasts.items() if v < live_cutoff}
        if delist_scope == 'stock':
            codes = [c for c in codes if c not in stale]
    info = {'st_dropped': len(st_codes), 'dropped_delisted': len(stale),
            'delist_cutoff': live_cutoff, 'ex_hy': len(ex_hy),
            'lasts': lasts, 'stale': stale, 'names': nm}
    return codes, info


def bucket_labels(edges: np.ndarray) -> list[str]:
    return [f'[{edges[i]:g},{edges[i + 1]:g})' for i in range(len(edges) - 1)]


class BaseAgg:
    """累加字段（子类负责维护 key → 下标）：样本数、≥1~9%/涨停、收益和、直方图。"""

    def _new(self):
        return {
            'n': 0,
            'ge': np.zeros(len(THRESHOLDS), dtype=np.int64),
            'limit': 0,
            'sum_open': 0.0, 'sum_high': 0.0, 'sum_close': 0.0,
            'sum_strat': 0.0, 'sum_pos': 0.0, 'sum_neg': 0.0,
            'hist_high': np.zeros(HIST_N, dtype=np.int64),
            'hist_open': np.zeros(HIST_N, dtype=np.int64),
            'hist_strat': np.zeros(HIST_N, dtype=np.int64),
        }

    def __init__(self):
        self.slots: dict = {}

    def _slot(self, key):
        s = self.slots.get(key)
        if s is None:
            s = self._new()
            self.slots[key] = s
        return s

    def _hist(self, arr):
        return np.clip(np.digitize(arr, HIST_EDGES) - 1, 0, HIST_N - 1)

    def _accumulate(self, slot, ret_open, ret_high, ret_close, limit_touch, strat_ret):
        n = len(ret_open)
        if n == 0:
            return
        slot['n'] += n
        for k, th in enumerate(THRESHOLDS):
            slot['ge'][k] += int((ret_high >= th).sum())
        slot['limit'] += int(limit_touch.sum())
        slot['sum_open'] += float(ret_open.sum())
        slot['sum_high'] += float(ret_high.sum())
        slot['sum_close'] += float(ret_close.sum())
        slot['sum_strat'] += float(strat_ret.sum())
        pos = strat_ret[strat_ret > 0]
        neg = strat_ret[strat_ret < 0]
        slot['sum_pos'] += float(pos.sum())
        slot['sum_neg'] += float(-neg.sum())
        slot['hist_high'] += np.bincount(self._hist(ret_high), minlength=HIST_N)
        slot['hist_open'] += np.bincount(self._hist(ret_open), minlength=HIST_N)
        slot['hist_strat'] += np.bincount(self._hist(strat_ret), minlength=HIST_N)

    @staticmethod
    def _quantile(hist, n, q):
        if n <= 0:
            return float('nan')
        i = int(np.searchsorted(np.cumsum(hist), q * n, side='left'))
        i = min(max(i, 0), HIST_N - 1)
        return float(HIST_EDGES[i] + (HIST_EDGES[1] - HIST_EDGES[0]) / 2)

    @staticmethod
    def _share_pos(hist, n) -> float:
        """strat_ret > 0 的占比（按 0.5% 宽的直方图近似，正区间从 ZERO_BIN 起）。"""
        if n <= 0:
            return float('nan')
        return float(np.asarray(hist)[ZERO_BIN:].sum()) / n

    def rows(self) -> list[dict]:
        total = sum(s['n'] for s in self.slots.values())
        out = []
        for key in self._sort_keys():
            s = self.slots[key]
            n = s['n']
            if n == 0:
                continue
            row = {'bucket': key, 'n': n,
                   'share': round(n / total, 4) if total else 0.0}
            for k, th in enumerate(THRESHOLDS):
                row[f'ge{int(round(th * 100))}_pct'] = round(100.0 * s['ge'][k] / n, 2)
            row['limit_pct'] = round(100.0 * s['limit'] / n, 2)
            row['avg_ret_open_pct'] = round(100.0 * s['sum_open'] / n, 3)
            row['avg_ret_high_pct'] = round(100.0 * s['sum_high'] / n, 3)
            row['avg_ret_close_pct'] = round(100.0 * s['sum_close'] / n, 3)
            row['avg_strat_ret_pct'] = round(100.0 * s['sum_strat'] / n, 3)
            # 注意：sum_pos/sum_neg 是**金额累加**不是笔数，这里给出的是每笔平均盈亏贡献；
            # 真实胜率由 strat_ret 直方图统计（0.5% 分箱近似）。
            row['avg_pos_contrib_pct'] = round(100.0 * s['sum_pos'] / n, 3)
            row['avg_neg_contrib_pct'] = round(100.0 * s['sum_neg'] / n, 3)
            row['win_rate_true_pct'] = round(100.0 * self._share_pos(s['hist_strat'], n), 2)
            pf = s['sum_pos'] / s['sum_neg'] if s['sum_neg'] > 0 else float('inf')
            row['profit_factor'] = round(pf, 3) if np.isfinite(pf) else 'inf'
            row['med_ret_high_pct'] = round(100.0 * self._quantile(s['hist_high'], n, 0.5), 3)
            row['p90_ret_high_pct'] = round(100.0 * self._quantile(s['hist_high'], n, 0.9), 3)
            row['med_ret_open_pct'] = round(100.0 * self._quantile(s['hist_open'], n, 0.5), 3)
            out.append(row)
        return out

    def _sort_keys(self):
        raise NotImplementedError


class IndexAgg(BaseAgg):
    """固定分档聚合（特征分箱）。"""

    def __init__(self, labels):
        super().__init__()
        self.labels = list(labels)
        self.slots = {i: self._new() for i in range(len(labels))}

    def add(self, idx, mask, ret_open, ret_high, ret_close, limit_touch, strat_ret):
        sel = mask & (idx >= 0)
        if not sel.any():
            return
        for i in np.unique(idx[sel]):
            sub = sel & (idx == i)
            self._accumulate(self.slots[int(i)], ret_open[sub], ret_high[sub],
                             ret_close[sub], limit_touch[sub], strat_ret[sub])

    def _sort_keys(self):
        return range(len(self.labels))

    def rows(self):
        out = super().rows()
        rename = {i: self.labels[i] for i in range(len(self.labels))}
        for r in out:
            r['bucket'] = rename[r['bucket']]
        return out


class KeyAgg(BaseAgg):
    """按字符串键聚合（日期 / 行业 / 板块 / 年份）。"""

    def add(self, keys, mask, ret_open, ret_high, ret_close, limit_touch, strat_ret):
        sel = mask & (keys != '')
        if not sel.any():
            return
        for key in np.unique(keys[sel]):
            sub = sel & (keys == key)
            self._accumulate(self._slot(str(key)), ret_open[sub], ret_high[sub],
                             ret_close[sub], limit_touch[sub], strat_ret[sub])

    def _sort_keys(self):
        return sorted(self.slots)


def write_csv(path: str, rows: list[dict]) -> None:
    if not rows:
        return
    cols: list[str] = []
    for r in rows:
        for k in r:
            if k not in cols:
                cols.append(k)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8-sig', newline='') as f:
        f.write(','.join(cols) + '\n')
        for r in rows:
            f.write(','.join(_fmt(r.get(c, '')) for c in cols) + '\n')


def _fmt(v) -> str:
    if isinstance(v, float):
        return f'{v:.4f}'
    if isinstance(v, (int, np.integer)):
        return str(int(v))
    if isinstance(v, (bool, np.bool_)):
        return '1' if v else '0'
    s = str(v)
    return f'"{s}"' if (',' in s or '"' in s) else s


EDGES = {
    'pct': np.array([-20, -9.5, -7, -5, -3, -1, 0, 1, 3, 5, 7, 9.5, 12, 20]),
    'close_pos': np.array([0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0001]),
    'vol_ratio': np.array([0, 0.5, 0.8, 1.0, 1.2, 1.5, 2.0, 3.0, 5.0, 100]),
    'bias20': np.array([-1, -0.15, -0.05, 0, 0.03, 0.08, 0.15, 0.3, 3]),
    'rsi14': np.array([0, 20, 30, 40, 50, 60, 70, 80, 100]),
    'amp': np.array([0, 2, 4, 6, 8, 12, 20, 100]),
    'ret20': np.array([-1, -0.3, -0.15, -0.05, 0, 0.05, 0.15, 0.3, 1, 20]),
    'ret5': np.array([-1, -0.15, -0.05, 0, 0.05, 0.1, 0.2, 1, 20]),
    'dist_hh20': np.array([-1, -0.2, -0.1, -0.05, -0.02, 0, 0.05, 2]),
    'amount_wan': np.array([0, 3000, 5000, 10000, 20000, 50000, 100000, 1e9]),
    'float_mcap_yi': np.array([0, 20, 50, 100, 200, 500, 1000, 1e9]),
    'turnover_pct': np.array([0, 0.5, 1, 2, 3, 5, 8, 12, 20, 1e9]),
    'hy_pct': np.array([-20, -3, -1, 0, 1, 3, 5, 20]),
    'hy_ret5': np.array([-1, -0.05, -0.02, 0, 0.02, 0.05, 0.1, 1]),
    'hy_ret20': np.array([-1, -0.1, -0.03, 0, 0.03, 0.1, 0.2, 1]),
    'bench_pct': np.array([-20, -3, -1, 0, 1, 3, 20]),
    'list_days': np.array([0, 150, 250, 500, 1000, 2000, 5000, 20000]),
}


def apply_filter(mask, feats, conds):
    for cond in conds:
        arr = feats.get(cond['field'])
        if arr is None:
            mask &= False
            continue
        if 'min' in cond:
            mask &= arr >= cond['min']
        if 'max' in cond:
            mask &= arr <= cond['max']
        if 'eq' in cond:
            mask &= arr == cond['eq']
    return mask


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--start', default='2021-01-01')
    ap.add_argument('--end', default='2099-12-31')
    ap.add_argument('--min-bars', type=int, default=150)
    ap.add_argument('--include-star', action='store_true')
    ap.add_argument('--keep-sealed', action='store_true')
    ap.add_argument('--max-gap', type=int, default=10)
    ap.add_argument('--out-dir', default=OUT_DEFAULT)
    ap.add_argument('--focus', default='')
    ap.add_argument('--dump-hit-sample', type=float, default=0.0)
    ap.add_argument('--dump-all-sample', type=float, default=0.0,
                    help='随机抽样导出的全部成交（含未命中），用于命中/未命中特征对照')
    ap.add_argument('--codes-file', default='', help='只用文件里的代码（每行一个，分片用）')
    ap.add_argument('--dump-codes', default='', help='把过滤后的股票池写到该文件后退出（分片用）')
    ap.add_argument('--dump-raw', action='store_true', help='额外导出原始累加量，便于分片合并')
    ap.add_argument('--max-stocks', type=int, default=0)
    ap.add_argument('--seed', type=int, default=20260920)
    ap.add_argument('--no-date-agg', action='store_true')
    ap.add_argument('--exclude-industry', nargs='*', default=['银行'],
                    help='按通达信行业名包含匹配排除，默认排除「银行」；传空串可关闭')
    ap.add_argument('--keep-delisted', action='store_true',
                    help='保留退市/长期停牌股；默认剔除（会引入幸存者偏差，偏乐观）')
    ap.add_argument('--delist-scope', choices=['stock', 'trade'], default='stock',
                    help='stock=整只剔除该股全部历史（用户口径，有幸存者偏差）；'
                         'trade=只剔除其最后停牌前 grace 天的成交（无幸存者偏差）')
    ap.add_argument('--delist-grace-days', type=int, default=90,
                    help='最后交易日距今超过该自然日数视为退市/长期停牌')
    args = ap.parse_args()

    start_int = int(args.start.replace('-', ''))
    end_int = int(args.end.replace('-', ''))
    rng_s = np.random.default_rng(args.seed)      # 注意：循环内 rng 被当日振幅占用

    snap, snap_date = load_latest_snapshot()
    names = load_tdx_names()
    book = ShareBook.load()
    print(f'[init] 东财快照 {snap_date}：{len(snap)} 只（仅 sh_main/sz_main/chuangye）')
    print(f'[init] 通达信名称 {len(names)} 条；时点股本时间线 {len(book.timeline)} 只'
          f'（快照常量兜底 {len(book.snap_shares)} 只）')
    hy_map = load_industry_map()
    board_codes = sorted({v['board'] for v in hy_map.values() if v['board']})
    board_series = load_board_series(board_codes)
    bench_series = load_board_series([BENCH_CODE]).get(BENCH_CODE) or {}
    print(f'[init] 通达信行业 {len({v["hy_name"] for v in hy_map.values()})} 个；'
          f'板块指数 {len(board_series)} 条')

    market = Market()
    codes = list(market.codes(args.min_bars))
    # 统一股票池过滤（名称/ST/行业/退市口径与分钟、网格、多周期脚本共用）
    codes, uinfo = filter_stock_universe(
        codes, market, snap, names, hy_map,
        exclude_industry=args.exclude_industry, include_star=args.include_star,
        keep_delisted=args.keep_delisted, delist_grace_days=args.delist_grace_days,
        delist_scope=args.delist_scope)
    lasts, stale = uinfo['lasts'], uinfo['stale']
    live_cutoff, st_codes, ex_hy = (uinfo['delist_cutoff'], uinfo['st_dropped'],
                                    uinfo['ex_hy'])

    def _nm(c: str) -> str:
        return names.get(c) or (snap.get(c) or {}).get('name', '') or ''

    print(f'[init] 排除行业 {sorted(k for k in (args.exclude_industry or []) if k)}：{ex_hy} 只；'
          f'剔除退市/长期停牌（最后交易日 < {live_cutoff}）：{len(stale)} 只')
    if args.codes_file:
        with open(args.codes_file, 'r', encoding='utf-8') as f:
            want = {ln.strip().lstrip('\ufeff') for ln in f if ln.strip()}
        codes = [c for c in codes if c in want]
    if args.max_stocks:
        codes = codes[:args.max_stocks]
    print(f'[init] 股票池 {len(codes)} 只（剔除 ST {st_codes} 只）')
    if args.dump_codes:
        with open(args.dump_codes, 'w', encoding='utf-8') as f:
            f.write('\n'.join(codes) + '\n')
        print(f'[out] 股票池 {len(codes)} 只 → {args.dump_codes}')
        return 0

    factors = load_factors()
    aggs: dict[str, BaseAgg] = {k: IndexAgg(bucket_labels(e)) for k, e in EDGES.items()}
    aggs['board'] = KeyAgg()
    aggs['hy'] = KeyAgg()
    aggs['year'] = KeyAgg()
    aggs['flag'] = KeyAgg()
    date_agg = None if args.no_date_agg else KeyAgg()
    overall = IndexAgg(['全样本'])

    focus_spec = None
    if args.focus:
        with open(args.focus, 'r', encoding='utf-8') as f:
            focus_spec = json.load(f)
        print(f'[init] 焦点：{focus_spec.get("name")} {focus_spec.get("all")}')
    focus_rows: list[dict] = []
    sample_rows: list[dict] = []
    all_rows: list[dict] = []
    trades = 0
    src_count: dict[str, int] = {}
    delist_trade_dropped = 0

    for n_done, code in enumerate(codes, 1):
        meta = market.meta(code)
        name = _nm(code)
        try:
            raw = market.load(code, 'raw')
            qfq = market.load(code, 'qfq', factors.get(code))
        except Exception:
            continue
        n = len(qfq)
        if n < args.min_bars + 2:
            continue
        ind = compute_indicators(qfq, code, name)
        dates = np.asarray(qfq['date'], dtype=np.int64)

        # ---- 时点股本 / 流通市值 / 换手率 / 涨跌停比例（全部逐日，无前视）----
        shares_all, share_src = book.shares_series(code, dates)       # 流通股本（万股）
        src_count[share_src] = src_count.get(share_src, 0) + 1
        raw_close_all = raw['close']
        fmy_all = shares_all * raw_close_all / 1e4                    # 流通市值（亿元）
        with np.errstate(invalid='ignore', divide='ignore'):
            to_all = np.where(shares_all > 0,
                              raw['volume'] / (shares_all * 1e4) * 100.0, np.nan)
        lmt_all = limit_ratio_series(code, raw['high'], raw['low'], raw_close_all)

        hyinfo = hy_map.get(code) or {}
        bser = board_series.get(hyinfo.get('board', '')) or {}
        hy_close = align_series(bser, dates)
        bench_close = align_series(bench_series, dates)

        i_start = max(args.min_bars - 1, int(np.searchsorted(dates, start_int, 'left')))
        i_end = min(int(np.searchsorted(dates, end_int, 'right')) - 1, n - 2)
        if i_end < i_start:
            continue
        ii = np.arange(i_start, i_end + 1)

        c = ind['close'][ii]
        o_raw, h_raw, l_raw, c_raw = (raw['open'][ii], raw['high'][ii],
                                      raw['low'][ii], raw['close'][ii])
        lmt = lmt_all[ii]
        share_src_code = share_src
        h1_raw = raw['high'][ii + 1]
        o1, h1, c1 = ind['open'][ii + 1], ind['high'][ii + 1], ind['close'][ii + 1]
        v = ind['volume'][ii]
        vma5, ma20, ma60 = ind['vma5'][ii], ind['ma20'][ii], ind['ma60'][ii]
        hh20, rng = ind['hh20'][ii], np.maximum(h_raw - l_raw, 1e-9)
        prev_hy = np.roll(hy_close, 1)
        prev_hy[0] = np.nan
        prev_bench = np.roll(bench_close, 1)
        prev_bench[0] = np.nan

        feats = {
            'pct': ind['pct'][ii],
            'amp': ind['amp'][ii],
            'close_pos': np.where(rng > 0, (c_raw - l_raw) / rng, np.nan),
            'upper_shadow': np.where(c > 0, (h_raw - np.maximum(o_raw, c_raw)) / c_raw, np.nan),
            'lower_shadow': np.where(c > 0, (np.minimum(o_raw, c_raw) - l_raw) / c_raw, np.nan),
            'vol_ratio': np.where(vma5 > 0, v / vma5, np.nan),
            'amount_wan': ind['amount'][ii] / 1e4,
            'float_mcap_yi': fmy_all[ii],
            'turnover_pct': to_all[ii],
            'float_shares_wan': shares_all[ii],
            'bias20': np.where(ma20 > 0, c / ma20 - 1, np.nan),
            'bias60': np.where(ma60 > 0, c / ma60 - 1, np.nan),
            'rsi14': ind['rsi14'][ii],
            'atr_pct': np.where(c > 0, ind['atr14'][ii] / c * 100, np.nan),
            'ret5': np.where(ii >= 5, c / ind['close'][np.maximum(ii - 5, 0)] - 1, np.nan),
            'ret20': np.where(ii >= 20, c / ind['close'][np.maximum(ii - 20, 0)] - 1, np.nan),
            'ret60': np.where(ii >= 60, c / ind['close'][np.maximum(ii - 60, 0)] - 1, np.nan),
            'dist_hh20': np.where(hh20 > 0, c / hh20 - 1, np.nan),
            'list_days': ii.astype(float),
            'hy_pct': np.where(prev_hy[ii] > 0, hy_close[ii] / prev_hy[ii] - 1, np.nan) * 100,
            'hy_ret5': np.where(ii >= 5, hy_close[ii] / hy_close[np.maximum(ii - 5, 0)] - 1, np.nan),
            'hy_ret20': np.where(ii >= 20, hy_close[ii] / hy_close[np.maximum(ii - 20, 0)] - 1, np.nan),
            'bench_pct': np.where(prev_bench[ii] > 0, bench_close[ii] / prev_bench[ii] - 1, np.nan) * 100,
            'is_limit_up': ind['is_limit_up'][ii].astype(float),
            # 触板判断必须同标度比较：raw 最高价 vs raw 前收盘价。
            # （旧版误用 ind['prev_close']（前复权）与 raw 最高价比较，复权因子越大越容易假触板，
            #   曾把工商银行判成 65% 的交易日触板。）
            'touched_limit': ((h_raw >= np.round(raw['close'][np.maximum(ii - 1, 0)] * (1 + lmt), 2) - 1e-6)
                              & ~ind['is_limit_up'][ii]).astype(float),
        }

        ordinals = ymd_to_ordinal(dates)
        days, days1 = ordinals[ii], ordinals[ii + 1]
        one_line = (o_raw == h_raw) & (h_raw == l_raw) & (l_raw == c_raw)
        sealed = (c_raw >= h_raw - 1e-9) & ind['is_limit_up'][ii]
        valid = (v > 0) & (c > 0) & ((days1 - days) <= args.max_gap) & ~one_line
        if not args.keep_sealed:
            valid &= ~sealed
        if args.delist_scope == 'trade' and code in stale:
            # 无幸存者偏差口径：只掐掉该股停牌/退市前 grace 天内的成交，保留其更早历史
            alive_before = dates[ii] < shift_ymd(lasts[code], -args.delist_grace_days)
            delist_trade_dropped += int((valid & ~alive_before).sum())
            valid &= alive_before

        buy = c
        ret_open = o1 / buy - 1
        ret_high = h1 / buy - 1
        ret_close = c1 / buy - 1
        limit_touch = h1_raw >= np.round(c_raw * (1 + lmt), 2) - 1e-6
        hit3 = ret_high >= TARGET
        strat_ret = np.where(hit3, np.maximum(TARGET, ret_open), ret_open) - COST

        board_keys = np.full(len(ii), meta.get('board', ''), dtype=object)
        hy_keys = np.full(len(ii), hyinfo.get('hy_name', ''), dtype=object)
        year_keys = np.array([str(int(d // 10000)) for d in dates[ii]], dtype=object)
        flag_keys = np.where(feats['touched_limit'] > 0, 'T日盘中触板未封', '普通')

        for k, e in EDGES.items():
            aggs[k].add(bucket_index(feats[k], e), valid, ret_open, ret_high,
                        ret_close, limit_touch, strat_ret)
        overall.add(np.zeros(len(ii), dtype=np.int64), valid, ret_open, ret_high,
                    ret_close, limit_touch, strat_ret)
        aggs['board'].add(board_keys, valid, ret_open, ret_high, ret_close, limit_touch, strat_ret)
        aggs['hy'].add(hy_keys, valid, ret_open, ret_high, ret_close, limit_touch, strat_ret)
        aggs['year'].add(year_keys, valid, ret_open, ret_high, ret_close, limit_touch, strat_ret)
        aggs['flag'].add(flag_keys, valid, ret_open, ret_high, ret_close, limit_touch, strat_ret)
        if date_agg is not None:
            date_keys = np.array([int_to_ymd(int(d)) for d in dates[ii]], dtype=object)
            date_agg.add(date_keys, valid, ret_open, ret_high, ret_close, limit_touch, strat_ret)

        trades += int(valid.sum())

        if focus_spec:
            fmask = valid.copy()
            fmask = apply_filter(fmask, feats, focus_spec.get('all', []))
            groups = focus_spec.get('any_of') or []
            if groups:
                anymask = np.zeros(len(ii), dtype=bool)
                for grp in groups:
                    sub = np.ones(len(ii), dtype=bool)
                    sub = apply_filter(sub, feats, grp)
                    anymask |= sub
                fmask &= anymask
            fmask = apply_filter(fmask, feats, focus_spec.get('not', []))
            for j in np.nonzero(fmask)[0]:
                focus_rows.append(_detail(
                    code, name, meta, hyinfo, int(dates[ii[j]]), feats, int(j),
                    buy, o1, h1, c1, ret_open, ret_high, ret_close,
                    limit_touch, ind['is_limit_up'][ii], strat_ret, share_src_code))

        if args.dump_hit_sample > 0:
            keep = rng_s.random(len(ii)) < args.dump_hit_sample
            for j in np.nonzero(valid & hit3 & keep)[0]:
                sample_rows.append(_detail(
                    code, name, meta, hyinfo, int(dates[ii[j]]), feats, int(j),
                    buy, o1, h1, c1, ret_open, ret_high, ret_close,
                    limit_touch, ind['is_limit_up'][ii], strat_ret, share_src_code))

        if args.dump_all_sample > 0:
            keep = rng_s.random(len(ii)) < args.dump_all_sample
            for j in np.nonzero(valid & keep)[0]:
                all_rows.append(_detail(
                    code, name, meta, hyinfo, int(dates[ii[j]]), feats, int(j),
                    buy, o1, h1, c1, ret_open, ret_high, ret_close,
                    limit_touch, ind['is_limit_up'][ii], strat_ret, share_src_code))

        if n_done % 500 == 0:
            print(f'  ... {n_done}/{len(codes)}  累计有效 {trades}')

    print(f'[done] 有效样本 {trades}')

    os.makedirs(args.out_dir, exist_ok=True)
    for k, agg in aggs.items():
        write_csv(os.path.join(args.out_dir, f'bucket_{k}.csv'), agg.rows())
    if date_agg is not None:
        write_csv(os.path.join(args.out_dir, 'by_date.csv'), date_agg.rows())
    if focus_rows:
        write_csv(os.path.join(args.out_dir, 'focus_picks.csv'), focus_rows)
        print(f'[out] focus_picks.csv {len(focus_rows)} 行')
    if sample_rows:
        write_csv(os.path.join(args.out_dir, 'hit_sample.csv'), sample_rows)
        print(f'[out] hit_sample.csv {len(sample_rows)} 行')
    if all_rows:
        write_csv(os.path.join(args.out_dir, 'trade_sample.csv'), all_rows)
        print(f'[out] trade_sample.csv {len(all_rows)} 行')
    if args.dump_raw:
        for k, agg in aggs.items():
            dump_agg_raw(agg, os.path.join(args.out_dir, f'raw_{k}.json'))
        if date_agg is not None:
            dump_agg_raw(date_agg, os.path.join(args.out_dir, 'raw_date.json'))
        dump_agg_raw(overall, os.path.join(args.out_dir, 'raw_overall.json'))
        print('[out] raw_*.json')

    summary = {
        'start': args.start, 'end': args.end, 'trades': trades,
        'universe': ('沪深 A 股个股（沪 60/68、深 000/001/002/003/004/300/301）；'
                     '剔除 B 股、北交所、ST'
                     + ('' if args.include_star else '、科创板')
                     + '，银行股与退市/长期停牌另按下方计数剔除'),
        'snapshot_date': snap_date,
        'universe_size': len(codes),
        'delist_scope': ('none' if args.keep_delisted else args.delist_scope),
        'delisted_dropped': len(stale),
        'delisted_trades_dropped': delist_trade_dropped,
        'delist_cutoff': live_cutoff,
        'delist_grace_days': args.delist_grace_days,
        'st_dropped': st_codes,
        'excluded_industry': [k for k in (args.exclude_industry or []) if k],
        'excluded_industry_size': ex_hy,
        'float_shares_src': dict(sorted(src_count.items())),
        'target': TARGET, 'cost': COST,
        'overall': (overall.rows() or [{}])[0],
        'by_year': aggs['year'].rows(),
        'by_flag': aggs['flag'].rows(),
        'caveats': [
            '14:30 价用当日收盘价近似，未建模 14:30→15:00 漂移',
            '「次日上午最高涨幅」用次日全天最高价近似，是上界、系统性偏高',
            '流通股本/流通市值/换手率按买入日时点 gbbq 股本事件推导（无前视）；'
            '缺时间线时退回 2026-09-18 快照常量（float_shares_src 逐笔留痕）',
            'ST 判定用通达信当前名称，历史 ST/摘帽状态未还原',
            '涨跌停比例按个股近 250 日触板命中次数时点自校准，非当前名称回看',
            '退市/长期停牌按 .day 最后交易日剔除（幸存者偏差，偏乐观）',
            '行业为通达信当前分类，板块指数为通达信自编板块指数',
            '成交假设：T 日收盘买入、T+1 开盘卖出；涨停封板与一字板已剔除',
        ],
    }
    with open(os.path.join(args.out_dir, 'summary.json'), 'w', encoding='utf-8') as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    print(f'[out] {args.out_dir}')
    return 0


def _detail(code, name, meta, hyinfo, date_int, feats, j, buy, o1, h1, c1,
            ret_open, ret_high, ret_close, limit_touch, is_limit_up, strat_ret,
            share_src=''):
    """单笔明细（j 为该股票 K 线数组中的下标）。"""
    row = {'code': code, 'name': name, 'board': meta.get('board', ''),
           'hy_name': hyinfo.get('hy_name', ''), 'date': int_to_ymd(date_int),
           'float_shares_src': share_src}
    for k, arr in feats.items():
        v = float(arr[j])
        row[k] = round(v, 4) if np.isfinite(v) else ''
    for k, v in (('close', buy), ('next_open', o1), ('next_high', h1), ('next_close', c1),
                 ('ret_open', ret_open), ('ret_high', ret_high), ('ret_close', ret_close),
                 ('strat_ret', strat_ret)):
        row[k] = round(float(v[j]), 4)
    row['limit_touch'] = bool(limit_touch[j])
    row['is_limit_up'] = bool(is_limit_up[j])
    row['hit3'] = bool(ret_high[j] >= TARGET)
    ordered = {k: row[k] for k in DETAIL_COLS if k in row}
    for k in row:
        ordered.setdefault(k, row[k])
    return ordered


if __name__ == '__main__':
    raise SystemExit(main())
