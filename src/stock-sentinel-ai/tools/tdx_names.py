# -*- coding: utf-8 -*-
"""通达信本地证券名称表（含科创板）：``{tdx}/T0002/hq_cache/{shs,szs}.tnf``。

为什么需要它
-----------
回测原先只用东财快照取名称，而快照只采集了 ``sh_main / sz_main / chuangye`` 三类，
**科创板 688/689 一只都没有**；此外还有少量在交易但未被快照收录的主板个股。
缺少名称会连带导致涨停比例、ST 判定、报表可读性全部失真。

文件格式（已实测确认）
---------------------
* 头部 50 字节；
* 之后为 360 字节定长记录：``[0:6]`` 证券代码（ASCII）、``[31:47]`` 名称（GBK，NUL 结尾）。

注意：名称仍是**当前**名称（含当前 ST 标记），存在「用当前口径看历史」的残留偏差；
需要用历史时点 ST 判定时，走 ``indicators.limit_ratio_series`` 的时点自校准。

用法::

    from tdx_names import load_tdx_names
    names = load_tdx_names()      # {'600519': '贵州茅台', ...}
"""
from __future__ import annotations

import os

HERE = os.path.dirname(os.path.abspath(__file__))
HEAD = 50
REC = 360
CODE_OFF = 0
NAME_OFF = 31
NAME_LEN = 16


def resolve_tdx_dir(tdx_dir: str | None = None) -> str:
    if tdx_dir:
        return tdx_dir
    env = os.environ.get('STOCK_SENTINEL_TDX_DIR')
    if env:
        return env
    return r'D:\new_tdx'


def parse_tnf(path: str) -> dict[str, str]:
    """解析单个 .tnf 文件 → {code: name}。"""
    size = os.path.getsize(path)
    if size <= HEAD or (size - HEAD) % REC:
        return {}
    out: dict[str, str] = {}
    with open(path, 'rb') as f:
        f.seek(HEAD)
        buf = f.read(size - HEAD)
    for i in range(len(buf) // REC):
        b = buf[i * REC:(i + 1) * REC]
        code = b[CODE_OFF:CODE_OFF + 6].decode('ascii', 'ignore').strip()
        if not code or not code.isdigit():
            continue
        raw = b[NAME_OFF:NAME_OFF + NAME_LEN].split(b'\x00')[0]
        if not raw:
            continue
        name = raw.decode('gbk', 'replace').strip()
        if name:
            out[code] = name
    return out


def load_tdx_names(tdx_dir: str | None = None) -> dict[str, str]:
    """合并沪深两张名称表；找不到文件时返回空字典（调用方需容忍）。"""
    root = os.path.join(resolve_tdx_dir(tdx_dir), 'T0002', 'hq_cache')
    out: dict[str, str] = {}
    for fn in ('shs.tnf', 'szs.tnf'):
        p = os.path.join(root, fn)
        if os.path.exists(p):
            out.update(parse_tnf(p))
    return out


if __name__ == '__main__':
    import sys

    ns = load_tdx_names()
    print(f'名称表条目 = {len(ns)}')
    for c in ('600519', '688001', '688981', '601995', '000016', '300750', '000001'):
        print(f'  {c} -> {ns.get(c, "(缺)")}')
    if '--check' in sys.argv:
        sys.path.insert(0, HERE)
        from kdata import is_stock, market_of  # noqa: E402
        import numpy as np  # noqa: E402
        try:
            import struct
            root = os.path.normpath(os.path.join(HERE, '..', 'data', 'hsjday'))
            codes: dict[str, int] = {}
            for m in ('sh', 'sz'):
                d = os.path.join(root, m, 'lday')
                if not os.path.isdir(d):
                    continue
                for fn in os.listdir(d):
                    if not fn.endswith('.day'):
                        continue
                    c = fn[len(m):-4]
                    if not is_stock(m, c):
                        continue
                    p = os.path.join(d, fn)
                    with open(p, 'rb') as f:
                        sz = os.path.getsize(p)
                        f.seek(sz - 32)
                        codes[c] = int(struct.unpack('<i', f.read(4))[0])
            hit = sum(1 for c in codes if c in ns)
            act = {c: d for c, d in codes.items() if d >= 20260901}
            print(f'[check] is_stock 代码 {len(codes)}；有名称 {hit} '
                  f'({hit / max(len(codes), 1) * 100:.1f}%)')
            print(f'[check] 仍在交易(>=20260901) {len(act)}；其中有名称 '
                  f'{sum(1 for c in act if c in ns)}')
            miss = sorted(c for c in act if c not in ns)
            print(f'[check] 仍在交易但无名称 {len(miss)}：{miss[:20]}')
            arr = np.array([codes[c] for c in act])
            print(f'[check] 仍在交易最后交易日中位 {int(np.median(arr))}')
        except Exception as exc:                       # noqa: BLE001
            print(f'[check] 跳过：{exc}')
