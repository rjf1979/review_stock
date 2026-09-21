# -*- coding: utf-8 -*-
"""通达信本地板块口径：个股 → 行业映射、板块指数历史日线。

全部离线，不联网。数据来源：

* ``{tdx}/T0002/hq_cache/tdxhy.cfg`` 个股「通达信行业」代码（GBK，``0|600000|T...|||X...``）
* ``{tdx}/T0002/hq_cache/tdxzs.cfg`` 板块代码 ↔ 名称 / T 码（行业板块形如 ``煤炭|880301|2|1|0|T0101``）
* ``vipdoc/sh/lday/sh8803xx.day``    板块指数历史日线（指数无需复权）

用法::

    from tdx_sector import load_industry_map, load_board_index

    hy = load_industry_map()             # {'600000': {...'hy_name': '银行', 'board': '8804xx'}}
    bars = load_board_index('880301')    # kdata.BAR_DT 结构化数组

说明：通达信行业分类（申万/通达信自有）比东财概念板块稳定得多，但仍是
**当前快照**；用它回看历史存在轻度“成分漂移 / 前视”偏差，报告中必须标注。
"""
from __future__ import annotations

import os
import re

import numpy as np

from kdata import read_day_file

HERE = os.path.dirname(os.path.abspath(__file__))
DAY_ROOTS = [
    os.path.normpath(os.path.join(HERE, '..', 'data', 'hsjday')),
]
_TCODE_RE = re.compile(r'^T\d{2,}$')


def resolve_tdx_dir(tdx_dir: str | None = None) -> str:
    """通达信安装目录：显式参数 > 环境变量 > 默认 D:\\new_tdx。"""
    if tdx_dir:
        return tdx_dir
    env = os.environ.get('STOCK_SENTINEL_TDX_DIR')
    if env:
        return env
    return r'D:\new_tdx'


def _read_gbk(path: str) -> str:
    with open(path, 'rb') as f:
        return f.read().decode('gbk', 'replace')


def load_board_names(tdx_dir: str | None = None) -> dict[str, dict]:
    """解析 ``tdxzs.cfg``：返回 ``板指代码 -> {'name','tcode','level'}``。"""
    path = os.path.join(resolve_tdx_dir(tdx_dir), 'T0002', 'hq_cache', 'tdxzs.cfg')
    if not os.path.exists(path):
        return {}
    out: dict[str, dict] = {}
    for line in _read_gbk(path).splitlines():
        parts = line.split('|')
        if len(parts) < 6:
            continue
        name, code, kind = parts[0].strip(), parts[1].strip(), parts[2].strip()
        tail = parts[5].strip()
        if not code or not name:
            continue
        out[code] = {
            'name': name,
            'tcode': tail if _TCODE_RE.match(tail) else '',
            'kind': kind,
        }
    return out


def load_industry_map(tdx_dir: str | None = None) -> dict[str, dict]:
    """个股 → 通达信行业。

    返回 ``{code: {'hy_t': T码, 'hy_name': 行业名, 'board': 板块指数代码}}``。
    板块指数代码缺失时 ``board`` 为空串。
    """
    tdir = resolve_tdx_dir(tdx_dir)
    path = os.path.join(tdir, 'T0002', 'hq_cache', 'tdxhy.cfg')
    if not os.path.exists(path):
        return {}
    boards = load_board_names(tdir)
    tcode_to_board = {b['tcode']: code for code, b in boards.items() if b.get('tcode')}
    name_of = {code: b['name'] for code, b in boards.items()}

    out: dict[str, dict] = {}
    for line in _read_gbk(path).splitlines():
        parts = line.split('|')
        if len(parts) < 3:
            continue
        code, tcode = parts[1].strip(), parts[2].strip()
        if not re.fullmatch(r'\d{6}', code):
            continue
        board = tcode_to_board.get(tcode, '')
        out[code] = {
            'hy_t': tcode,
            'hy_name': name_of.get(board, '') if board else '',
            'board': board,
            'sw_code': parts[5].strip() if len(parts) > 5 else '',
        }
    return out


def day_file_candidates(code: str, tdx_dir: str | None = None) -> list[str]:
    """板块指数 / 指数日线文件的候选路径（项目数据优先，其次通达信原始目录）。"""
    # 沪深两市存在同号代码（sh000300 沪深300 / sz000300 不存在，sz000001 平安银行），
    # 单看代码首位不足以判定市场，因此先按推测市场找，再回退到另一个市场。
    primary = 'sh' if code[0] in '5689' else 'sz'
    tdir = resolve_tdx_dir(tdx_dir)
    paths: list[str] = []
    for market in [primary, 'sh' if primary == 'sz' else 'sz']:
        name = f'{market}{code}.day'
        paths.extend(os.path.join(root, market, 'lday', name) for root in DAY_ROOTS)
        paths.append(os.path.join(tdir, 'vipdoc', market, 'lday', name))
    return paths


def load_board_index(code: str, tdx_dir: str | None = None) -> np.ndarray | None:
    """读取板块指数（或任意指数）日线，返回 BAR_DT 数组；找不到返回 None。"""
    for path in day_file_candidates(code, tdx_dir):
        if os.path.exists(path) and os.path.getsize(path) >= 32:
            bars = read_day_file(path)
            if len(bars):
                return bars
    return None


def load_board_series(codes, tdx_dir: str | None = None) -> dict[str, dict]:
    """批量读取板块指数，返回 ``{code: {'date': ndarray, 'close': ndarray}}``。"""
    out: dict[str, dict] = {}
    for code in codes:
        bars = load_board_index(code, tdx_dir)
        if bars is None:
            continue
        out[code] = {
            'date': np.asarray(bars['date'], dtype=np.int64),
            'close': np.asarray(bars['close'], dtype=np.float64),
        }
    return out


def align_series(series: dict, dates: np.ndarray, field: str = 'close') -> np.ndarray:
    """把板块指数序列按日期右对齐到个股日期（缺日用最近一个交易日）。"""
    if not series:
        return np.full(len(dates), np.nan)
    d = series['date']
    v = series[field]
    pos = np.searchsorted(d, np.asarray(dates, dtype=np.int64), side='right') - 1
    out = np.full(len(dates), np.nan)
    ok = pos >= 0
    out[ok] = v[pos[ok]]
    return out
