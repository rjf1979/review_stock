# -*- coding: utf-8 -*-
"""通达信 gbbq（股本变迁 / 除权除息）解析器。

与 `tdx-gbbq.js` 使用同一套解密实现和同一份密钥表（`assets/gbbq-keys.bin`），
保证 JS 与 Python 两条链路读到的除权事件一致。

记录布局（29 字节定长，解密后明文）
--------------------------------
    0      uint8   market（0=深 1=沪）
    1..7   7 bytes 代码（NUL 截断 ASCII）
    8..11  uint32  日期 YYYYMMDD
    12     uint8   category
    13..16 float   分红（每 10 股现金红利，元）
    17..20 float   配股价（元）
    21..24 float   送转（每 10 股）
    25..28 float   配股（每 10 股）

**gbbq 不直接存流通股本**：单条记录只有上述 4 个 float。因此历史流通股本必须用
「最新快照流通股本 + 送转/配股比例向后回溯」推导，见 `float_shares.py`。
"""
from __future__ import annotations

import os
import struct
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
KEY_FILE = os.path.join(ROOT, 'assets', 'gbbq-keys.bin')
KEY_BYTES = 4176
RECORD_BYTES = 29
DEFAULT_GBBQ = os.path.join(r'D:\new_tdx', 'T0002', 'hq_cache', 'gbbq')

# category 语义（通达信约定，仅 category=1 参与复权与股本回溯）
CATEGORY_NAMES = {
    1: '除权除息',
    2: '送配股上市',
    3: '非流通股上市',
    4: '未知股本变动',
    5: '股本变化',
    6: '增发新股',
    7: '股份回购',
    8: '增发新股上市',
    9: '转配股上市',
    10: '可转债上市',
    11: '扩缩股',
    12: '非流通股缩股',
    13: '送认购权证',
    14: '送认沽权证',
    15: '其他',
}

_key_cache: bytes | None = None


def keys(path: str = KEY_FILE) -> bytes:
    """读取并校验固定密钥表（4176 字节）。"""
    global _key_cache
    if _key_cache is not None:
        return _key_cache
    with open(path, 'rb') as f:
        buf = f.read()
    if len(buf) != KEY_BYTES:
        raise ValueError(f'gbbq 密钥表长度异常：{len(buf)}（应为 {KEY_BYTES}）')
    _key_cache = buf
    return buf


def _u32(buf: bytes, off: int) -> int:
    return struct.unpack_from('<I', buf, off)[0]


def _decode_block(key: bytes, lo: int, hi: int) -> tuple[int, int]:
    """单个 8 字节块的解密，与 tdx-gbbq.js decodeBlock 逐位对齐。"""
    mask = 0xFFFFFFFF
    num = (_u32(key, 0x44) ^ lo) & mask
    numold = hi & mask
    for j in range(0x40, 0x00, -0x04):
        eax = _u32(key, ((num >> 16) & 0xFF) * 4 + 0x448)
        eax = (eax + _u32(key, (num >> 24) * 4 + 0x48)) & mask
        eax = (eax ^ _u32(key, ((num >> 8) & 0xFF) * 4 + 0x848)) & mask
        eax = (eax + _u32(key, (num & 0xFF) * 4 + 0xC48)) & mask
        eax = (eax ^ _u32(key, j)) & mask
        carry = num
        num = (numold ^ eax) & mask
        numold = carry
    numold = (numold ^ _u32(key, 0)) & mask
    return numold, num


def decode_gbbq(path: str = DEFAULT_GBBQ, key_path: str = KEY_FILE) -> list[dict]:
    """解析整个 gbbq 文件；记录数与文件长度必须自洽，否则视为损坏。"""
    key = keys(key_path)
    with open(path, 'rb') as f:
        buf = f.read()
    if len(buf) < 4:
        raise ValueError('gbbq 文件为空')
    count = _u32(buf, 0)
    expected = 4 + count * RECORD_BYTES
    if len(buf) != expected:
        raise ValueError(f'gbbq 记录数与文件长度不一致：count={count} 期望 {expected} 实际 {len(buf)}')
    out: list[dict] = []
    fmt = '<IIIIII'
    for i in range(count):
        off = 4 + i * RECORD_BYTES
        a = _decode_block(key, _u32(buf, off), _u32(buf, off + 4))
        b = _decode_block(key, _u32(buf, off + 8), _u32(buf, off + 12))
        c = _decode_block(key, _u32(buf, off + 16), _u32(buf, off + 20))
        plain = struct.pack(fmt, a[0], a[1], b[0], b[1], c[0], c[1]) + buf[off + 24:off + RECORD_BYTES]
        hongli, peigujia, songgu, peigu = struct.unpack_from('<ffff', plain, 13)
        out.append({
            'market': plain[0],
            'code': plain[1:8].split(b'\x00')[0].decode('utf-8', 'ignore'),
            'date': _u32(plain, 8),
            'category': plain[12],
            'hongli': hongli,
            'peigujia': peigujia,
            'songgu': songgu,
            'peigu': peigu,
        })
    return out


def exdiv_events(records: list[dict]) -> dict[str, list[dict]]:
    """按代码索引 category=1 的除权除息事件，按日期升序去重。"""
    by_code: dict[str, list[dict]] = {}
    seen: dict[str, set] = {}
    for rec in records:
        if int(rec.get('category') or 0) != 1:
            continue
        code = str(rec.get('code') or '')
        if not code:
            continue
        bucket = by_code.setdefault(code, [])
        key = (rec['date'], round(rec['hongli'], 6), round(rec['peigujia'], 6),
               round(rec['songgu'], 6), round(rec['peigu'], 6))
        mark = seen.setdefault(code, set())
        if key in mark:
            continue
        mark.add(key)
        bucket.append(rec)
    for bucket in by_code.values():
        bucket.sort(key=lambda r: r['date'])
    return by_code


def category_histogram(records: list[dict]) -> dict[int, int]:
    return dict(sorted(Counter(int(r.get('category') or 0) for r in records).items()))


def _main() -> int:
    """自检：解析本机 gbbq 并打印规模与类别分布。"""
    path = sys_argv_path()
    records = decode_gbbq(path)
    by_code = exdiv_events(records)
    print(f'gbbq = {path}')
    print(f'记录数 = {len(records)}；代码数 = {len({r["code"] for r in records})}；'
          f'除权除息事件代码数 = {len(by_code)}')
    print('category 分布：')
    for cat, n in category_histogram(records).items():
        print(f'  {cat:>2} {CATEGORY_NAMES.get(cat, "?"):<12} {n}')
    probe = [c for c in ('600519', '000001', '300750') if c in by_code]
    for code in probe:
        rows = by_code[code][-3:]
        print(f'{code} 最近除权事件：'
              + '; '.join(f'{r["date"]} 送转{r["songgu"]:g} 配股{r["peigu"]:g} 红利{r["hongli"]:g}' for r in rows))
    return 0


def sys_argv_path() -> str:
    import sys
    return sys.argv[1] if len(sys.argv) > 1 else DEFAULT_GBBQ


if __name__ == '__main__':
    raise SystemExit(_main())
