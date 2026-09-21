# -*- coding: utf-8 -*-
"""通达信本地分钟线读取（``.lc1``/``.lc5`` 与 ``.01``/``.5`` 双后缀）+ 格式自检。

分钟线定长 32 字节，头两个字段固定：

* ``date`` (u16) = ``(year - 2004) * 2048 + month * 100 + day``
* ``time`` (u16) = ``hour * 60 + minute``（分钟线为该分钟**结束**时刻）
* 价格是真实成交价（**不复权**），``amount`` 为元（float32），``volume`` 为股（u32）

**但 OHLC 四个字段的编码有两套，必须按文件判定，不能按后缀想当然**：

=========================  ==========================================================
布局                       含义
=========================  ==========================================================
``float32``                直接是元。客户端 ``.lc1``/``.lc5`` 用这套。
``int32-cent``             整数「分」（价格 × 100）。datatool 的 ``.01``/``.5`` 用这套：
                           实测 ``sh600519.01`` 首根 = ``cc eb 01 00`` = 125900 分 = 1259.00 元。
=========================  ==========================================================

用错布局不会报错、只会静默产出天文/次正规数（例如 float32 读成 ``1.76e-40``），
因此 ``load_minute`` 与 ``verify_minute_file`` 都会**逐文件探测布局**（按价格量级与
OHLC 自洽性打分，后缀只作为同分时的倾向），并把结果回传在 ``priceFormat`` 字段里。
探测不出任何自洽布局时自检直接判不通过，不允许静默通过。

文件位置：``{tdx}/vipdoc/{sh,sz,bj}/{minline,fzline}/{market}{code}{suffix}``

后缀有两套，**来源不同，不得静默混用**：

============  ===============  ==================================================
后缀          目录             来源与精度
============  ===============  ==================================================
``.lc1``      ``minline``      通达信客户端「盘后数据下载」。open/high/low 来自
``.lc5``      ``fzline``       交易所分钟真值，是目前的基准口径。
``.01``       ``minline``      「通达信行情数据处理工具」（datatool，官方数据服务）
``.5``        ``fzline``       由**分笔**转档而来；分笔是 3 秒快照（≈20 笔/分钟），
                               分钟内极值可能取不到，high/low 与基准口径会有微小偏差。
============  ===============  ==================================================

因此本模块：同一代码同时存在两套文件时，按 ``FREQ_SUFFIXES`` 的优先级取第一个
（默认 ``.lc1``/``.lc5`` 优先，即基准口径优先），并把实际命中的后缀回传在
``load_minute`` 的 ``source`` 字段里。**跨来源比对必须显式检查该字段**，
不能用 ``load_minute`` 的结果无声地混两套数据。

用法::

    from tdx_minute import (load_minute, minute_codes, minute_file_map,
                            resolve_minute_file, verify_minute_file)

    m = load_minute('600000', freq=1)       # 见返回值说明
    m['source']                             # '.lc1' 或 '.01' —— 取到的是哪一套
    m['priceFormat']                        # 'float32' 或 'int32-cent'
    minute_file_map(freq=1)                 # {'600000': '.lc1', ...} 逐代码命中后缀
    minute_codes(freq=1)                    # 已下载的代码列表（两套后缀合并去重）
    verify_minute_file('600000', freq=1)    # 格式自检报告

``load_minute`` 返回 dict：``code``、``freq``、``date``、``time``、``open``、``high``、
``low``、``close``、``amount``、``volume``（价格一律已归一到**元**），另加
``source``（命中的后缀）、``origin``（``tdx-client`` / ``datatool-tick``）、
``priceFormat``（探测到的价格布局）、``path``（实际文件路径）。
``source`` 为空串表示该代码没有任何分钟线文件。

命令行自检::

    python tools/tdx_minute.py verify --code 600519 --freq 1
    python tools/tdx_minute.py verify --all --freq 1 --sample 50
    python tools/tdx_minute.py verify --code 600519 --tdx-dir "D:\\迅雷下载\\datatool\\data"
    python tools/tdx_minute.py list --freq 1 --markets sh,sz,bj
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys

import numpy as np

from tdx_sector import resolve_tdx_dir

REC = 32

# 布局 1：OHLC 为 float32（单位：元）—— 通达信客户端的 .lc1/.lc5
RAW_DT = np.dtype([
    ('date', '<u2'), ('time', '<u2'),
    ('open', '<f4'), ('high', '<f4'), ('low', '<f4'), ('close', '<f4'),
    ('amount', '<f4'), ('volume', '<u4'), ('reserved', '<u4'),
])
RAW_DT_FLOAT = RAW_DT

# 布局 2：OHLC 为 int32（单位：分，即价格 × 100）—— datatool 的 .01/.5
# amount 仍为 float32（元）、volume 仍为 u32（股），只有 OHLC 四个字段不同。
RAW_DT_CENT = np.dtype([
    ('date', '<u2'), ('time', '<u2'),
    ('open', '<i4'), ('high', '<i4'), ('low', '<i4'), ('close', '<i4'),
    ('amount', '<f4'), ('volume', '<u4'), ('reserved', '<u4'),
])

PRICE_FORMATS = {
    'float32': RAW_DT_FLOAT,
    'int32-cent': RAW_DT_CENT,
}
# 后缀 → 布局倾向。**只用于打分并列时决定取舍**，不作为事实依据：
# 文件实际是什么布局由 detect_price_format 逐文件判定。
PRICE_FORMAT_HINT = {
    '.lc1': 'float32', '.lc5': 'float32',
    '.01': 'int32-cent', '.5': 'int32-cent',
}

# A 股价格合理区间（元）。用来把「用错布局」解出的次正规数/天文数字判死。
PRICE_MIN, PRICE_MAX = 0.01, 200000.0
# 自检要求的布局自洽比例下限：低于此值视为「没有任何已知布局能解释该文件」
LAYOUT_OK_MIN_RATIO = 0.99

# 频次 -> 目录名
FREQ_DIRS = {1: 'minline', 5: 'fzline'}

# 频次 -> 允许的后缀，**按优先级排序**（同一代码多套文件时取第一个）
FREQ_SUFFIXES = {1: ('.lc1', '.01'), 5: ('.lc5', '.5')}

# 后缀 -> 来源标签
SUFFIX_ORIGIN = {
    '.lc1': 'tdx-client', '.lc5': 'tdx-client',
    '.01': 'datatool-tick', '.5': 'datatool-tick',
}

# 后缀 -> 来源中文说明（报告用）
SUFFIX_ORIGIN_LABEL = {
    'tdx-client': '通达信客户端盘后下载（交易所分钟真值）',
    'datatool-tick': 'datatool 由 3 秒快照分笔转档聚合',
}

# 默认扫描的市场：与本次改动前的行为保持一致（只扫沪深），
# 北交所需显式传 markets=('sh','sz','bj')，避免悄悄改变既有回测的样本口径。
DEFAULT_MARKETS = ('sh', 'sz')
ALL_MARKETS = ('sh', 'sz', 'bj')

# 市场 -> A 股代码前缀白名单
A_SHARE_PREFIX = {
    'sh': ('60', '68'),
    'sz': ('000', '001', '002', '003', '004', '300', '301'),
    'bj': ('43', '83', '87', '92'),
}

# 北交所代码前缀。注意 '88' 是沪深板块指数、'90' 是沪 B 股，都不在此列。
BJ_PREFIXES = ('43', '83', '87', '92')

# 允许的时间戳区间（HHMM）。上界放到 15:35 以容纳创业板/科创板的盘后固定价格交易，
# 超出该区间的只记为 warning，不算结构性错误。
SESSION_MIN, SESSION_MAX = 915, 1535


def _dir_of(freq: int) -> str:
    sub = FREQ_DIRS.get(freq)
    if not sub:
        raise ValueError(f'不支持的分钟频率: {freq}')
    return sub


def _suffixes_of(freq: int) -> tuple[str, ...]:
    suffixes = FREQ_SUFFIXES.get(freq)
    if not suffixes:
        raise ValueError(f'不支持的分钟频率: {freq}')
    return suffixes


def code_market(code: str) -> str:
    """代码 -> 市场目录名。北交所前缀优先判定，其余按首位数字分沪深。"""
    c = str(code)
    if len(c) >= 2 and c[:2] in BJ_PREFIXES:
        return 'bj'
    return 'sh' if c[:1] in '5689' else 'sz'


def _is_a_share(market: str, code: str) -> bool:
    prefixes = A_SHARE_PREFIX.get(market)
    return bool(prefixes) and code.startswith(prefixes)


def minute_dir(freq: int = 1, tdx_dir: str | None = None, market: str = '') -> str:
    """分钟线目录。``market`` 为空时返回 ``vipdoc`` 下的父目录级路径拼接前的通用目录。"""
    root = os.path.join(resolve_tdx_dir(tdx_dir), 'vipdoc')
    if market:
        return os.path.join(root, market, _dir_of(freq))
    return os.path.join(root, '{sh,sz,bj}', _dir_of(freq))


def minute_paths(code: str, freq: int = 1, tdx_dir: str | None = None) -> list[str]:
    """该代码所有候选文件路径，按 ``FREQ_SUFFIXES`` 优先级排序。"""
    root = os.path.join(resolve_tdx_dir(tdx_dir), 'vipdoc', code_market(code), _dir_of(freq))
    return [os.path.join(root, f'{code_market(code)}{code}{s}') for s in _suffixes_of(freq)]


def resolve_minute_file(code: str, freq: int = 1,
                        tdx_dir: str | None = None) -> tuple[str, str]:
    """返回 ``(path, suffix)``：按优先级取第一个**存在且长度可用**的文件。

    优先级里的文件都存在但都不可用时，返回第一个存在的（便于报错定位）；
    一个都没有则返回 ``('', '')``。
    """
    fallback = ('', '')
    for path, suffix in zip(minute_paths(code, freq, tdx_dir), _suffixes_of(freq)):
        if not os.path.exists(path):
            continue
        if os.path.getsize(path) >= REC:
            return path, suffix
        if not fallback[0]:
            fallback = (path, suffix)
    return fallback


def minute_path(code: str, freq: int = 1, tdx_dir: str | None = None) -> str:
    """兼容旧接口：返回优先命中的文件路径；都没有时返回首选后缀的候选路径。"""
    path, _ = resolve_minute_file(code, freq, tdx_dir)
    return path or minute_paths(code, freq, tdx_dir)[0]


def has_minute(code: str, freq: int = 1, tdx_dir: str | None = None) -> bool:
    path, _ = resolve_minute_file(code, freq, tdx_dir)
    return bool(path) and os.path.getsize(path) >= REC


def minute_file_map(freq: int = 1, tdx_dir: str | None = None,
                    markets: tuple[str, ...] = DEFAULT_MARKETS) -> dict[str, str]:
    """``{代码: 命中的后缀}``。同一代码多套后缀时按优先级取第一个。"""
    out: dict[str, str] = {}
    suffixes = _suffixes_of(freq)
    for market in markets:
        d = os.path.join(resolve_tdx_dir(tdx_dir), 'vipdoc', market, _dir_of(freq))
        if not os.path.isdir(d):
            continue
        for fn in os.listdir(d):
            hit = next((s for s in suffixes if fn.endswith(s)), '')
            if not hit:
                continue
            code = fn[len(market):-len(hit)]
            if len(code) != 6 or not code.isdigit() or not _is_a_share(market, code):
                continue
            prev = out.get(code)
            if prev is None or suffixes.index(hit) < suffixes.index(prev):
                out[code] = hit
    return out


def minute_codes(freq: int = 1, tdx_dir: str | None = None,
                 markets: tuple[str, ...] = DEFAULT_MARKETS) -> list[str]:
    """本机已下载分钟线的代码（两套后缀合并去重，仅保留 A 股代码）。

    ``markets`` 默认 ``('sh','sz')``，与本次改动前一致；要含北交所请显式传
    ``('sh','sz','bj')``（会改变样本口径，报告里需注明）。
    """
    return sorted(minute_file_map(freq, tdx_dir, markets))


def decode_date(a: np.ndarray) -> np.ndarray:
    # 注意：必须先升到 int64，uint16 下 y*10000 会溢出
    a = np.asarray(a, dtype=np.int64)
    y = (a // 2048) + 2004
    rest = a % 2048
    return y * 10000 + (rest // 100) * 100 + (rest % 100)


def decode_time(a: np.ndarray) -> np.ndarray:
    a = np.asarray(a, dtype=np.int64)
    return (a // 60) * 100 + (a % 60)                      # HHMM 整数


# ─────────────────── 价格布局探测（float32 元 / int32 分） ───────────────────

def _price_arrays(a: np.ndarray, fmt: str) -> tuple[np.ndarray, ...]:
    """按布局解出 (open, high, low, close)，价格一律归一到**元**。"""
    div = 100.0 if fmt == 'int32-cent' else 1.0
    return tuple(a[k].astype(np.float64) / div
                 for k in ('open', 'high', 'low', 'close'))


def _parse_records(buf: bytes, n: int, fmt: str,
                   sample_max: int = 0) -> np.ndarray:
    """按指定布局解析记录。``sample_max`` > 0 时等距抽样（布局与记录无关）。"""
    arr = np.frombuffer(buf[:n * REC], dtype=PRICE_FORMATS[fmt], count=n)
    if sample_max and n > sample_max:
        arr = arr[::max(1, n // sample_max)]
    return arr


def layout_ok_ratio(buf: bytes, n: int, fmt: str, sample_max: int = 20000) -> float:
    """该布局下自洽的记录占比：价格落在合理区间，且 OHLC 互相包住。

    入参是原始字节而非已解析数组——避免「数组 dtype 与待评估布局错配」导致
    把一个布局的失败样本误判成另一个布局的通过样本。
    """
    arr = _parse_records(buf, n, fmt, sample_max)
    if len(arr) == 0:
        return 0.0
    o, h, lo, c = _price_arrays(arr, fmt)
    good = ((o >= PRICE_MIN) & (o <= PRICE_MAX)
            & (h >= PRICE_MIN) & (h <= PRICE_MAX)
            & (lo >= PRICE_MIN) & (lo <= PRICE_MAX)
            & (c >= PRICE_MIN) & (c <= PRICE_MAX))
    good &= (h >= lo - 1e-6) & (h >= np.maximum(o, c) - 1e-6) & (lo <= np.minimum(o, c) + 1e-6)
    return float(np.count_nonzero(good)) / len(arr)


def detect_price_format(buf: bytes, n: int, suffix: str = '',
                        sample_max: int = 20000) -> tuple[str, dict[str, float]]:
    """逐文件探测 OHLC 布局，返回 ``(format, scores)``。

    用错布局只会产出次正规数/天文数字而不报错，所以必须按数据判定，不能按后缀认定。
    记录数很大时抽样打分（布局与记录无关，抽样足够）。
    """
    hint = PRICE_FORMAT_HINT.get(suffix, '')
    if n == 0:
        return (hint or 'float32'), {fmt: 0.0 for fmt in PRICE_FORMATS}
    scores = {fmt: layout_ok_ratio(buf, n, fmt, sample_max) for fmt in PRICE_FORMATS}
    best = max(scores, key=lambda f: (round(scores[f], 6), f == hint))
    return best, scores


def load_minute(code: str, freq: int = 1, tdx_dir: str | None = None,
                start: int | None = None, end: int | None = None) -> dict:
    """读取单只个股分钟线；缺失返回空 dict。``start/end`` 为 YYYYMMDD 整数。

    价格一律归一到**元**。返回 dict 含 ``source``（命中的后缀）、``origin``
    （``tdx-client`` / ``datatool-tick``）与 ``priceFormat``（探测到的价格布局）。
    两套后缀同时存在时取 ``FREQ_SUFFIXES`` 里更靠前的那套（默认 ``.lc1``/``.lc5``）。
    """
    path, suffix = resolve_minute_file(code, freq, tdx_dir)
    if not path or os.path.getsize(path) < REC:
        return {}
    with open(path, 'rb') as f:
        buf = f.read()
    n = len(buf) // REC
    fmt, _ = detect_price_format(buf, n, suffix)
    a = np.frombuffer(buf, dtype=PRICE_FORMATS[fmt], count=n)
    dates = decode_date(a['date'])
    times = decode_time(a['time'])
    keep = np.ones(n, dtype=bool)
    if start is not None:
        keep &= dates >= int(start)
    if end is not None:
        keep &= dates <= int(end)
    o, h, lo, c = _price_arrays(a, fmt)
    return {
        'code': code, 'freq': freq,
        'date': dates[keep], 'time': times[keep],
        'open': o[keep], 'high': h[keep], 'low': lo[keep], 'close': c[keep],
        'amount': a['amount'].astype(np.float64)[keep],
        'volume': a['volume'].astype(np.float64)[keep],
        'source': suffix,
        'origin': SUFFIX_ORIGIN.get(suffix, ''),
        'priceFormat': fmt,
        'path': path,
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


# ─────────────────────────── 格式自检 ───────────────────────────

def _sample_rows(idx: np.ndarray, ymd: np.ndarray, hhmm: np.ndarray,
                 ohlc: dict, limit: int) -> list[dict]:
    out = []
    for k in idx[:limit]:
        k = int(k)
        out.append({
            'index': k,
            'date': int(ymd[k]),
            'time': f'{int(hhmm[k]) // 100:02d}:{int(hhmm[k]) % 100:02d}',
            'open': round(float(ohlc['open'][k]), 3),
            'high': round(float(ohlc['high'][k]), 3),
            'low': round(float(ohlc['low'][k]), 3),
            'close': round(float(ohlc['close'][k]), 3),
            'volume': float(ohlc['volume'][k]),
        })
    return out


def verify_buffer(buf: bytes, *, code: str = '', freq: int = 1, suffix: str = '',
                  path: str = '', sample: int = 5) -> dict:
    """对已读入内存的分钟线做结构与取值自检，返回结构化报告。

    ``errors`` 为结构性错误（``ok=False``）；``warnings`` 为可疑但不致命的偏差
    （例如某日根数偏离众数、时间戳落在盘中区间之外）。
    """
    errors: list[str] = []
    warnings: list[str] = []
    counts: dict[str, int] = {}
    report: dict = {
        'code': code, 'freq': freq, 'suffix': suffix,
        'origin': SUFFIX_ORIGIN.get(suffix, ''),
        'originLabel': SUFFIX_ORIGIN_LABEL.get(SUFFIX_ORIGIN.get(suffix, ''), ''),
        'path': path, 'bytes': len(buf), 'bars': 0, 'trailing_bytes': 0,
        'priceFormat': '', 'priceFormatScores': {},
        'date_min': None, 'date_max': None, 'days': 0,
        'bars_per_day': {}, 'counts': counts,
        'errors': errors, 'warnings': warnings, 'samples': [], 'ok': False,
    }
    if not buf:
        errors.append('文件为空')
        return report

    trailing = len(buf) % REC
    report['trailing_bytes'] = trailing
    if trailing:
        errors.append(f'文件长度 {len(buf)} 不是 {REC} 的整数倍（余 {trailing} 字节），记录可能被截断')
    n = len(buf) // REC
    report['bars'] = n
    if n == 0:
        return report

    # 先定价格布局：用错布局会静默产出次正规数，后面的取值检查就会全部失真。
    fmt, scores = detect_price_format(buf, n, suffix)
    report['priceFormat'] = fmt
    report['priceFormatScores'] = {k: round(v, 6) for k, v in scores.items()}
    if scores[fmt] < LAYOUT_OK_MIN_RATIO:
        errors.append(
            '价格字段无法用任何已知布局解释：'
            + '，'.join(f'{k} 自洽 {v:.4%}' for k, v in scores.items())
            + f'（要求 ≥{LAYOUT_OK_MIN_RATIO:.0%}）')

    a = np.frombuffer(buf[:n * REC], dtype=PRICE_FORMATS[fmt], count=n)
    d = a['date'].astype(np.int64)
    year = d // 2048 + 2004
    rest = d % 2048
    month = rest // 100
    day = rest % 100
    ymd = year * 10000 + month * 100 + day
    t = a['time'].astype(np.int64)
    hhmm = (t // 60) * 100 + t % 60
    o, h, lo, c = _price_arrays(a, fmt)
    vol = a['volume'].astype(np.float64)
    amt = a['amount'].astype(np.float64)
    ohlc = {'open': o, 'high': h, 'low': lo, 'close': c, 'volume': vol}

    report['date_min'] = int(ymd.min())
    report['date_max'] = int(ymd.max())
    report['days'] = int(np.unique(ymd).size)

    def flag(mask: np.ndarray, key: str, message: str, *, hard: bool = True) -> None:
        bad = int(np.count_nonzero(mask))
        counts[key] = bad
        if bad:
            (errors if hard else warnings).append(f'{message}：{bad} 根 / 共 {n} 根')

    bad_date = (month < 1) | (month > 12) | (day < 1) | (day > 31) | (year < 1990) | (year > 2100)
    flag(bad_date, 'bad_date', '日期字段无法解码为合法年月日')
    bad_time = (t // 60 > 23) | (t % 60 > 59)
    flag(bad_time, 'bad_time', '时间字段无法解码为合法时分')
    flag((hhmm < SESSION_MIN) | (hhmm > SESSION_MAX), 'off_session',
         f'时间戳落在 A 股交易时段 {SESSION_MIN // 100:02d}:{SESSION_MIN % 100:02d}'
         f'~{SESSION_MAX // 100:02d}:{SESSION_MAX % 100:02d} 之外', hard=False)
    bad_price = (o <= 0) | (h <= 0) | (lo <= 0) | (c <= 0)
    flag(bad_price, 'bad_price', '价格字段出现 0 或负值')
    # high/low 必须包住 open/close（1e-4 容差吸收 float32 误差）
    bad_ohlc = (h < lo - 1e-4) | (h < np.maximum(o, c) - 1e-4) | (lo > np.minimum(o, c) + 1e-4)
    flag(bad_ohlc, 'bad_ohlc', 'OHLC 不满足 low ≤ min(open,close) 且 max(open,close) ≤ high')
    flag(vol < 0, 'bad_volume', '成交量为负')
    flag(amt < 0, 'bad_amount', '成交额为负')
    zero_idx = np.nonzero(vol == 0)[0]
    counts['zero_volume'] = int(zero_idx.size)
    if zero_idx.size:
        # 通达信把集合竞价的成交量并进相邻 bar（开盘并进 09:31、收盘并进 15:00），
        # 所以 14:58/14:59 常为 0 量。这是正常产物，不是数据缺口，故只做提示。
        times_u, times_c = np.unique(hhmm[zero_idx], return_counts=True)
        order = np.argsort(times_c)[::-1][:3]
        hint = '、'.join(f'{int(times_u[i]) // 100:02d}:{int(times_u[i]) % 100:02d}×{int(times_c[i])}'
                        for i in order)
        warnings.append(f'成交量为 0 的根数：{counts["zero_volume"]} / {n}（集中在 {hint}；'
                        '通达信会把集合竞价量并进相邻 bar，属正常）')

    # 单调性：日期不得回退；同一交易日内时间戳必须严格递增
    non_mono_date = int(np.count_nonzero(np.diff(ymd) < 0))
    counts['date_backwards'] = non_mono_date
    if non_mono_date:
        errors.append(f'日期出现回退：{non_mono_date} 处（文件应按时间升序）')
    same_day = np.diff(ymd) == 0
    time_back = int(np.count_nonzero((np.diff(hhmm) <= 0) & same_day))
    counts['time_backwards'] = time_back
    if time_back:
        errors.append(f'同一交易日内时间戳未严格递增：{time_back} 处')

    # 每个交易日的根数分布：偏离众数的日子记为 warning（常见于下载被截断）
    uniq, cnt = np.unique(ymd, return_counts=True)
    mode = int(np.bincount(cnt).argmax())
    off = cnt != mode
    report['bars_per_day'] = {
        'min': int(cnt.min()), 'max': int(cnt.max()), 'mode': mode,
        'days_off_mode': int(np.count_nonzero(off)),
        'off_mode_examples': [int(d) for d in uniq[off][:5]],
    }
    if report['bars_per_day']['days_off_mode']:
        warnings.append(
            f'有 {report["bars_per_day"]["days_off_mode"]} 个交易日根数不等于众数 {mode}'
            f'（最少 {int(cnt.min())}，最多 {int(cnt.max())}）')

    for mask, label in ((bad_date, '日期'), (bad_time, '时间'), (bad_price, '价格'),
                        (bad_ohlc, 'OHLC'), (vol < 0, '成交量')):
        bad = np.nonzero(mask)[0]
        if bad.size:
            report['samples'].append({'field': label, 'rows': _sample_rows(bad, ymd, hhmm, ohlc, sample)})
            break

    report['ok'] = not errors
    return report


def verify_minute_file(code: str = '', freq: int = 1, tdx_dir: str | None = None,
                       path: str | None = None, sample: int = 5) -> dict:
    """对单个文件做格式自检。``path`` 为空时按代码 + 频率自动定位。"""
    suffix = ''
    if not path:
        path, suffix = resolve_minute_file(code, freq, tdx_dir)
        if not path:
            return {
                'code': code, 'freq': freq, 'suffix': '', 'path': '',
                'candidates': minute_paths(code, freq, tdx_dir),
                'bytes': 0, 'bars': 0, 'trailing_bytes': 0,
                'priceFormat': '', 'priceFormatScores': {},
                'date_min': None, 'date_max': None, 'days': 0, 'bars_per_day': {},
                'errors': ['未找到任何后缀的分钟线文件'],
                'warnings': [], 'counts': {}, 'samples': [], 'ok': False,
            }
    if not suffix:
        suffix = os.path.splitext(path)[1]
    with open(path, 'rb') as f:
        buf = f.read()
    report = verify_buffer(buf, code=code, freq=freq, suffix=suffix, path=path, sample=sample)
    report['candidates'] = minute_paths(code, freq, tdx_dir) if code else []
    return report


# ─────────────────────────── 命令行 ───────────────────────────

def _print_report(rep: dict) -> None:
    head = ' '.join(x for x in (
        rep.get('code') or '(未指定代码)', f"freq={rep.get('freq')}",
        f"suffix={rep.get('suffix') or '-'}", rep.get('origin') or '-',
        f"price={rep.get('priceFormat') or '-'}") if x)
    print(f'── {head}')
    if rep.get('path'):
        print(f'   文件 {rep["path"]}')
    print(f'   记录 {rep.get("bars")} 根 / {rep.get("bytes")} 字节'
          + (f'（尾部余 {rep["trailing_bytes"]} 字节）' if rep.get('trailing_bytes') else ''))
    if rep.get('days'):
        bpd = rep.get('bars_per_day') or {}
        print(f'   日期 {rep.get("date_min")} ~ {rep.get("date_max")}，共 {rep.get("days")} 个交易日'
              f'，每日根数 {bpd.get("min")}~{bpd.get("max")}（众数 {bpd.get("mode")}）')
    if rep.get('candidates'):
        print('   候选路径：')
        for cand in rep['candidates']:
            print(f'     {"存在" if os.path.exists(cand) else "缺失"}  {cand}')
    for msg in rep.get('errors') or []:
        print(f'   [错误] {msg}')
    for msg in rep.get('warnings') or []:
        print(f'   [提示] {msg}')
    for group in rep.get('samples') or []:
        print(f'   {group["field"]} 异常样例：')
        for row in group['rows']:
            print(f'     #{row["index"]} {row["date"]} {row["time"]} '
                  f'O{row["open"]} H{row["high"]} L{row["low"]} C{row["close"]} V{row["volume"]:.0f}')
    print(f'   结论：{"通过" if rep.get("ok") else "不通过"}')


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description='通达信分钟线（.lc1/.lc5 与 .01/.5）读取与格式自检')
    sub = ap.add_subparsers(dest='cmd', required=True)

    v = sub.add_parser('verify', help='格式自检')
    v.add_argument('--code', action='append', default=[], help='股票代码，可重复或逗号分隔')
    v.add_argument('--all', action='store_true', help='抽查全部已下载代码')
    v.add_argument('--freq', type=int, default=1, choices=(1, 5))
    v.add_argument('--sample', type=int, default=20, help='--all 时抽查多少只')
    v.add_argument('--tdx-dir', default='', help='通达信安装目录（其下应有 vipdoc）；'
                                                 r'datatool 输出填 …\datatool\data')
    v.add_argument('--markets', default='sh,sz', help='扫描市场，如 sh,sz,bj')
    v.add_argument('--json', action='store_true', help='输出 JSON')

    ls = sub.add_parser('list', help='列出代码与命中的后缀')
    ls.add_argument('--freq', type=int, default=1, choices=(1, 5))
    ls.add_argument('--tdx-dir', default='')
    ls.add_argument('--markets', default='sh,sz')
    ls.add_argument('--source', default='', help="只看某个来源：tdx-client / datatool-tick")

    args = ap.parse_args(argv)
    tdx_dir = args.tdx_dir or None
    markets = tuple(m for m in args.markets.split(',') if m)

    if args.cmd == 'list':
        fmap = minute_file_map(args.freq, tdx_dir, markets)
        if args.source:
            fmap = {k: s for k, s in fmap.items()
                    if SUFFIX_ORIGIN.get(s) == args.source}
        by_suffix: dict[str, int] = {}
        for s in fmap.values():
            by_suffix[s] = by_suffix.get(s, 0) + 1
        print(f'freq={args.freq} 代码数={len(fmap)}  按后缀：{by_suffix}')
        for code in sorted(fmap):
            print(f'  {code} {fmap[code]} {SUFFIX_ORIGIN.get(fmap[code], "")}')
        return 0

    codes: list[str] = []
    for item in args.code:
        codes.extend(c.strip() for c in item.split(',') if c.strip())
    if args.all:
        pool = minute_codes(args.freq, tdx_dir, markets)
        if args.sample and args.sample < len(pool):
            pool = random.Random(20260921).sample(pool, args.sample)
        codes = pool
    if not codes:
        print('未指定 --code 或 --all', file=sys.stderr)
        return 2

    reports = [verify_minute_file(code, args.freq, tdx_dir) for code in codes]
    if args.json:
        print(json.dumps(reports, ensure_ascii=False, indent=2))
    else:
        for rep in reports:
            _print_report(rep)
        bad = [r for r in reports if not r.get('ok')]
        print(f'\n合计 {len(reports)} 个文件：通过 {len(reports) - len(bad)}，不通过 {len(bad)}')
    return 1 if any(not r.get('ok') for r in reports) else 0


if __name__ == '__main__':
    sys.exit(main())
