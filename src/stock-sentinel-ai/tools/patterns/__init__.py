# -*- coding: utf-8 -*-
"""
形态注册表（插件式）

新增形态只需三步：
1. 在 `xingtaidu.py`（或新建模块）里写一个函数，签名 `fn(ind, params) -> np.ndarray[bool]`
   其中 `ind` 是 `indicators.compute_indicators()` 返回的指标字典，
   返回的布尔数组与 K 线等长，True 表示该 bar **收盘后**确认形态成立。
2. 用 `@register(id, 名称, 分类, 默认参数, 说明)` 装饰。
3. 在本文件底部 `from . import xingtaidu` 处加入新模块。

回测时信号默认在**下一根 K 线开盘**成交，避免未来函数。
"""
from __future__ import annotations

from typing import Callable

import numpy as np

REGISTRY: dict[str, dict] = {}


def register(pid: str, name: str, category: str,
             params: dict | None = None, desc: str = '',
             cross_section: bool = False):
    """
    cross_section=True 表示该形态需要**横截面**信息（当天全市场的排名/分位），
    回测引擎必须在跑之前算好逐日阈值并按日期注入 `ind`，否则形态只会返回全 False。
    """
    def deco(fn: Callable):
        REGISTRY[pid] = {
            'id': pid, 'name': name, 'category': category,
            'params': dict(params or {}), 'desc': desc, 'fn': fn,
            'module': fn.__module__,
            'cross_section': bool(cross_section),
        }
        return fn
    return deco


def get(pid: str) -> dict:
    if pid not in REGISTRY:
        raise KeyError(f'未注册的形态: {pid}；可用: {sorted(REGISTRY)}')
    return REGISTRY[pid]


def ids() -> list[str]:
    return list(REGISTRY)


def by_category() -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for pid, meta in REGISTRY.items():
        out.setdefault(meta['category'], []).append(pid)
    return out


def detect(pid: str, ind: dict, params: dict | None = None) -> np.ndarray:
    """运行单个形态，返回 bool 数组。params 覆盖默认参数。"""
    meta = get(pid)
    p = dict(meta['params'])
    if params:
        p.update(params)
    sig = meta['fn'](ind, p)
    return np.asarray(sig, dtype=bool)


def detect_many(pids: list[str], ind: dict,
                params: dict | None = None) -> dict[str, np.ndarray]:
    return {pid: detect(pid, ind, params) for pid in pids}


from . import xingtaidu  # noqa: E402,F401  —— 内置形态库（量价形态选股图谱）
from . import sequoia_x  # noqa: E402,F401  —— Sequoia-X 六个策略的等价形态定义
