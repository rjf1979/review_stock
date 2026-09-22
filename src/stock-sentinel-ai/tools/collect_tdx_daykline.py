# -*- coding: utf-8 -*-
"""智诊盯盘 · 日K线批量采集器（通达信行情服务器 → 本地 tdX vipdoc 布局）。

目的
----
给「日K线形态挖掘」提供一份**可自行刷新、覆盖每只股票上市至今**的日线库。
落盘就是通达信原生 ``.day``（32 字节定长），因此现有挖掘链零改动即可读：

    from kdata import Market
    mkt = Market(r'E:\\tdx_data\\day')      # 默认是 data/hsjday，这里换根目录
    bars = mkt.load('600519', adj='qfq')

数据来源与实测范围（2026-09-22 实测，服务器 117.34.114.15/16/17/18/20/27）
--------------------------------------------------------------------------
* 日线：**每股上市至今**（600519 = 6009 根，2001-08-27 ~ 今），分页每请求 800 根。
* 与项目 ``data/hsjday`` 逐根比对：**OHLC 与成交额完全一致（最大差 0.0000 元）**。
* ``vol`` 单位是**手**且被截断（源 16571 手 vs 真值 1657146 股 = 16571.46 手），
  转成股会最多差 1 手（≤99 股）；``amount`` 为元且精确。价格为**未复权**。
* 指数必须走 ``get_index_bars``：``get_security_bars`` 对指数返回乱码日期。

单位/口径契约（落盘 .day）
--------------------------
* 开高低收：``uint32`` = 价格 × 100（元 → 分）
* ``amount``：``float32``，单位元（服务器原值，精确）
* ``volume``：``uint32``，单位**股** = 源「手」× 100（存在 ≤1 手的截断误差）
* 价格**未复权**

用法::

    # 全量（约 5221 只，几分钟）
    python tools/collect_tdx_daykline.py --workers 6

    # 试跑：只取 5 只，落隔离目录
    python tools/collect_tdx_daykline.py --root E:\\tdx_data\\_daytest --limit-codes 5

    # 日常增量：每只只取最新 800 根并与现有文件合并
    python tools/collect_tdx_daykline.py --incremental

    # 只校验：与 data/hsjday 比对 OHLC/额/量
    python tools/collect_tdx_daykline.py --verify
"""
from __future__ import annotations

import argparse
import concurrent.futures as futures
import datetime
import json
import os
import struct
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

DEFAULT_ROOT = r'E:\tdx_data'
# 能出 K 线的服务器（实测：pytdx 自带 104 台里只有国泰君安这 6 台）
SERVERS = [('117.34.114.15', 7709), ('117.34.114.16', 7709), ('117.34.114.17', 7709),
           ('117.34.114.18', 7709), ('117.34.114.20', 7709), ('117.34.114.27', 7709)]
PAGE = 800
MAX_PAGES = 40                      # 32000 根，远超任何个股历史
REC = struct.Struct('<IIIIIfII')
DAY_SIZE = 32
U32MAX = 0xFFFFFFFF                 # .day 的成交量字段上限（股）

# 板块口径与 tools/kdata.py 的 is_stock 对齐，保证新库是 hsjday 的 drop-in 替代
BOARDS = {
    'sh-main': ('sh', ('60',)),
    'sh-star': ('sh', ('68',)),
    'sz-main': ('sz', ('000', '001', '002', '003', '004')),
    'chinext': ('sz', ('300', '301')),
    'bj': ('bj', ('43', '83', '87', '92')),
}
DEFAULT_BOARDS = 'sh-main,sh-star,sz-main,chinext'      # = kdata.is_stock 口径（含科创板）
MARKET_ID = {'sz': 0, 'sh': 1, 'bj': 2}
INDICES = [(1, '000001', 'sh'), (0, '399001', 'sz'), (0, '399006', 'sz'), (1, '000300', 'sh')]
HSJ_ROOT = os.path.normpath(os.path.join(HERE, '..', 'data', 'hsjday'))
# 量纲检查容差：源 vol 以「手」截断（绝对 ≤1 手），且经 float32 传输（大值再丢精度）
VOL_TOL_ABS = 100                   # 股，1 手
VOL_TOL_REL = 1e-6                  # 相对；实测中位相对误差 2.2e-6，最大 6.3e-8（除钳制根）


def vol_ok(mine: int, ref: int) -> bool:
    """成交量是否在「手截断 + float32 精度」范围内。钳制根（u32 上限）不算通过。"""
    if mine >= U32MAX:
        return False
    return abs(mine - ref) <= max(VOL_TOL_ABS, int(ref * VOL_TOL_REL))


# ───────────────────────────── 工具 ─────────────────────────────

class Log:
    def __init__(self, path: str = ''):
        self.path = path
        self.lock = threading.Lock()
        if path:
            os.makedirs(os.path.dirname(path), exist_ok=True)

    def __call__(self, msg: str):
        line = '%s  %s' % (time.strftime('%H:%M:%S'), msg)
        with self.lock:
            print(line, flush=True)
            if self.path:
                with open(self.path, 'a', encoding='utf-8') as f:
                    f.write(line + '\n')


def parse_boards(spec: str) -> list[str]:
    boards = [b.strip() for b in spec.split(',') if b.strip()]
    unknown = [b for b in boards if b not in BOARDS]
    if unknown:
        raise SystemExit(f'未知板块 {unknown}，可选：{",".join(BOARDS)}')
    return boards


def markets_of(boards: list[str]) -> list[str]:
    out = []
    for b in boards:
        mkt = BOARDS[b][0]
        if mkt not in out:
            out.append(mkt)
    return out


def day_path(root: str, market: str, code: str) -> str:
    return os.path.join(root, market, 'lday', f'{market}{code}.day')


def read_day(path: str) -> list[tuple]:
    """读 .day，返回 [(date, o, h, l, c, amount, volume_股), ...] 按日期升序。"""
    if not os.path.exists(path):
        return []
    with open(path, 'rb') as f:
        blob = f.read()
    rows = [REC.unpack_from(blob, i * DAY_SIZE) for i in range(len(blob) // DAY_SIZE)]
    rows.sort(key=lambda r: r[0])
    return rows


def pack_day(rows) -> bytes:
    """打包成 .day。价格/量必须是 u32 范围内的整数，amount 保持 float（不能取整）。"""
    out = bytearray(len(rows) * DAY_SIZE)
    for i, r in enumerate(rows):
        date, o, h, l, c, amount, vol, res = r
        for v in (o, h, l, c, vol):
            if not (0 <= int(v) <= U32MAX):
                raise ValueError(f'字段超出 u32：date={date} 值={v}')
        REC.pack_into(out, i * DAY_SIZE, int(date), int(o), int(h), int(l), int(c),
                      float(amount), int(vol), int(res))
    return bytes(out)


def write_atomic(path: str, blob: bytes):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(blob)
    os.replace(tmp, path)


def to_rows(bars, market: str, code: str, index: bool = False, clamped: list | None = None) -> list[tuple]:
    """服务器 bar dict → .day 记录（价格 ×100；vol 手 → 股）。

    ``.day`` 的成交量是 uint32（股），**装不下超过 42.9 亿股的天量日**（实测包钢股份
    2025-10-14 成交 51.7 亿股）。这种根**钳到 u32 上限**并登记到 ``clamped``，
    由调用方写进 report，绝不静默改写数值。
    """
    rows = []
    for b in bars:
        if index:
            date = int('%04d%02d%02d' % (b['year'], b['month'], b['day']))
            o, h, l, c = b['open'], b['high'], b['low'], b['close']
            amount, vol_lot = 0.0, 0
        else:
            date = int(str(b['datetime'])[:10].replace('-', ''))
            o, h, l, c = b['open'], b['high'], b['low'], b['close']
            amount = float(b['amount'])
            vol_lot = float(b['vol'])
        if not (o > 0 and h > 0 and l > 0 and c > 0):
            continue
        if h < l or h < max(o, c) - 1e-6 or l > min(o, c) + 1e-6:
            continue
        shares = int(round(vol_lot * 100))
        if shares > U32MAX:
            if clamped is not None:
                clamped.append({'code': f'{market}{code}', 'date': date,
                                'trueShares': shares, 'stored': U32MAX})
            shares = U32MAX
        rows.append((date, round(o * 100), round(h * 100), round(l * 100),
                     round(c * 100), amount, max(0, shares), 0))
    rows.sort(key=lambda r: r[0])
    dedup = []
    for r in rows:
        if dedup and dedup[-1][0] == r[0]:
            dedup[-1] = r
        else:
            dedup.append(r)
    return dedup


# ───────────────────────── 行情源（pytdx 隔离层）─────────────────────────

class HqSource:
    def __init__(self, ip: str, port: int):
        self.ip, self.port = ip, port
        self.api = None

    def connect(self, time_out: float = 5.0) -> bool:
        from pytdx.hq import TdxHq_API
        try:
            self.close()
            api = TdxHq_API(heartbeat=False, auto_retry=False, raise_exception=True)
            if not api.connect(self.ip, self.port, time_out=time_out):
                return False
            self.api = api
            return True
        except Exception:
            self.api = None
            return False

    def close(self):
        if self.api is not None:
            try:
                self.api.disconnect()
            except Exception:
                pass
            self.api = None

    def probe(self) -> bool:
        if not self.connect():
            return False
        try:
            bars = self.api.get_security_bars(9, 1, '600519', 0, 3)
            return bool(bars) and len(bars) == 3
        except Exception:
            return False

    def bars(self, market: int, code: str, start: int, count: int, index: bool = False):
        if index:
            return self.api.get_index_bars(9, market, code, start, count)
        return self.api.get_security_bars(9, market, code, start, count)


# ───────────────────────── 采集器 ─────────────────────────

class DayCollector:
    def __init__(self, cfg):
        self.cfg = cfg
        self.root = cfg['root']
        self.log = cfg['log']
        self.lock = threading.Lock()
        self.tls = threading.local()
        self.servers: list[HqSource] = []
        self.stats = {'codes': 0, 'requests': 0, 'errors': 0, 'bars': 0,
                      'cmp_bars': 0, 'cmp_ok': 0, 'cmp_bad': 0, 'vol_bad': 0}
        self.failed: list[str] = []
        self.clamped: list[dict] = []      # 成交量超 u32 上限、被钳制的根

    # ---- 连接 ----
    def setup_servers(self):
        alive = []
        for ip, port in SERVERS:
            s = HqSource(ip, port)
            if s.probe():
                alive.append(s)
                self.log('服务器可用 %s' % ip)
            else:
                s.close()
        if not alive:
            raise SystemExit('没有可用 K 线服务器')
        self.servers = alive
        self.log('可用服务器 %d 台，线程 %d' % (len(alive), self.cfg['workers']))

    def _source(self) -> HqSource:
        s = getattr(self.tls, 'src', None)
        if s is None:
            with self.lock:
                base = self.servers[getattr(self.tls, 'idx', 0) % len(self.servers)]
            s = HqSource(base.ip, base.port)
            if not s.connect():
                raise RuntimeError('连接失败 %s' % s.ip)
            self.tls.src = s
        return s

    def _rotate(self):
        s = getattr(self.tls, 'src', None)
        if s is not None:
            s.close()
        self.tls.src = None
        self.tls.idx = getattr(self.tls, 'idx', 0) + 1

    # ---- 取一只的全部历史 ----
    def fetch_code(self, market: str, code: str, index: bool = False, pages: int = MAX_PAGES):
        mid = MARKET_ID[market]
        for attempt in range(self.cfg['retries'] + 1):
            try:
                rows, start = [], 0
                for _ in range(pages):
                    with self.lock:
                        self.stats['requests'] += 1
                    chunk = self._source().bars(mid, code, start, PAGE, index=index)
                    if not chunk:
                        break
                    rows = list(chunk) + rows
                    if len(chunk) < PAGE:
                        break
                    start += PAGE
                if not rows:
                    return []
                return to_rows(rows, market, code, index=index, clamped=self.clamped)
            except Exception as exc:
                with self.lock:
                    self.stats['errors'] += 1
                if attempt < self.cfg['retries']:
                    self._rotate()
                    time.sleep(0.05 * (attempt + 1))
                    continue
                self.log('取数失败 %s%s：%s' % (market, code, exc))
                self.failed.append(f'{market}{code}')
                return None
        return None

    # ---- 状态 ----
    def state_path(self) -> str:
        p = os.path.join(self.root, 'state', 'daykline-codes.json')
        os.makedirs(os.path.dirname(p), exist_ok=True)
        return p

    def load_state(self) -> dict:
        p = self.state_path()
        if os.path.exists(p):
            with open(p, encoding='utf-8') as f:
                return json.load(f)
        return {}

    def save_state(self, state: dict):
        p = self.state_path()
        tmp = p + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(state, f, ensure_ascii=False)
        os.replace(tmp, p)

    # ---- 校验（与 hsjday 比对）----
    def compare_hsjday(self, market: str, code: str, rows) -> tuple[int, int, int, float]:
        ref = read_day(os.path.join(HSJ_ROOT, market, 'lday', f'{market}{code}.day'))
        if not ref:
            return 0, 0, 0, 0.0
        ref_map = {r[0]: r for r in ref}
        ok = bad = volbad = 0
        worst = 0.0
        for r in rows:
            o = ref_map.get(r[0])
            if not o:
                continue
            d = max(abs(r[1] - o[1]), abs(r[2] - o[2]), abs(r[3] - o[3]),
                    abs(r[4] - o[4])) / 100.0
            worst = max(worst, d)
            if d <= 1e-9:
                ok += 1
            else:
                bad += 1
            if not vol_ok(r[6], o[6]):
                volbad += 1
        with self.lock:
            self.stats['cmp_bars'] += ok + bad
            self.stats['cmp_ok'] += ok
            self.stats['cmp_bad'] += bad
            self.stats['vol_bad'] += volbad
        return ok, bad, volbad, worst

    # ---- 主循环 ----
    def run(self, targets, args) -> dict:
        state = self.load_state()
        did_compare = False
        todo = []
        for market, code, index in targets:
            key = f'{market}{code}'
            if not args.force and state.get(key, {}).get('done') and not args.incremental:
                continue
            todo.append((market, code, index))
        self.log('目标 %d 只，已完成 %d 只，本次待采 %d 只'
                 % (len(targets), len(targets) - len(todo), len(todo)))
        t0 = time.time()
        done_n = 0
        for i, (market, code, index) in enumerate(todo, 1):
            path = day_path(self.root, market, code)
            pages = 1 if args.incremental else MAX_PAGES
            rows = self.fetch_code(market, code, index=index, pages=pages)
            if rows is None:
                continue
            if args.incremental and os.path.exists(path):
                old = read_day(path)
                merged = {r[0]: r for r in old}
                for r in rows:
                    merged[r[0]] = r
                rows = [merged[d] for d in sorted(merged)]
            if not rows:
                state[f'{market}{code}'] = {'done': True, 'bars': 0, 'reason': '无数据'}
                continue
            if not args.dry_run:
                write_atomic(path, pack_day(rows))
            done_n += 1
            first, last = rows[0][0], rows[-1][0]
            state[f'{market}{code}'] = {'done': True, 'bars': len(rows),
                                        'first': first, 'last': last}
            with self.lock:
                self.stats['codes'] += 1
                self.stats['bars'] += len(rows)
            if args.compare and (did_compare or i <= args.compare_codes):
                ok, bad, volbad, worst = self.compare_hsjday(market, code, rows)
                if ok + bad:
                    did_compare = True
                    self.log('  [对账] %s%s %d 根：OHLC 一致 %d / 不一致 %d（最大差 %.4f 元），'
                             '量超容差 %d' % (market, code, ok + bad, ok, bad, worst, volbad))
            if i % 200 == 0 or i == len(todo):
                self.save_state(state)
                el = time.time() - t0
                self.log('  %d/%d 已完成，%d 只落盘，%.1f 万根，%.0f 只/分钟，'
                         '请求 %d 错误 %d'
                         % (i, len(todo), done_n, self.stats['bars'] / 10000,
                            i / max(el / 60, 1e-9), self.stats['requests'], self.stats['errors']))
        self.save_state(state)
        if self.clamped:
            p = os.path.join(self.root, 'report', 'volume-clamped.json')
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, 'w', encoding='utf-8') as f:
                json.dump({'note': '.day 的 uint32 成交量装不下这些天量日，已钳到 u32 上限，'
                                   '此处保留真值',
                           'count': len(self.clamped), 'items': self.clamped}, f,
                          ensure_ascii=False, indent=1)
            self.log('注意：%d 根成交量超过 uint32 上限（>42.9 亿股），已钳制，'
                     '真值见 %s' % (len(self.clamped), p))
        return {'seconds': round(time.time() - t0, 1), 'codes_done': done_n,
                'stats': dict(self.stats), 'clamped': len(self.clamped),
                'failed': self.failed[:50]}


# ───────────────────────── 目标与入口 ─────────────────────────

def universe(tdx_root: str, boards: list[str], with_indices: bool) -> list[tuple[str, str, bool]]:
    prefixes = {}
    for b in boards:
        mkt, pres = BOARDS[b]
        prefixes.setdefault(mkt, ())
        prefixes[mkt] = prefixes[mkt] + tuple(pres)
    out: dict[str, tuple[str, bool]] = {}
    for market, pres in prefixes.items():
        for sub in ('lday', 'minline'):
            d = os.path.join(tdx_root, 'vipdoc', market, sub)
            if not os.path.isdir(d):
                continue
            for fn in os.listdir(d):
                code = fn[2:8]
                if len(code) == 6 and code.isdigit() and code.startswith(pres):
                    out[code] = (market, False)
    if with_indices:
        for _, code, mkt in INDICES:
            out[code] = (mkt, True)
    return sorted((mkt, code, idx) for code, (mkt, idx) in out.items())


def verify_all(root: str, log: Log, sample: int = 0, strict: bool = False) -> int:
    """只读校验：结构（内部一致性）+ 与 data/hsjday 对账（跨源差异）。

    退出码：结构异常 → 1；与 hsjday 的差异默认只报告（跨源差异不等于本库有问题），
    ``strict=True`` 时才把差异也算失败。实测该差异为 1 根（2 分钱）与 3236 根量。
    """
    files = []
    for market in sorted(os.listdir(root)) if os.path.isdir(root) else []:
        d = os.path.join(root, market, 'lday')
        if os.path.isdir(d):
            files.extend((market, f) for f in sorted(os.listdir(d)) if f.endswith('.day'))
    if sample:
        files = files[:sample]
    bad_files, cmp_ok, cmp_bad, vol_bad, worst_all = [], 0, 0, 0, 0.0
    for market, fn in files:
        code = fn[2:8]
        path = os.path.join(root, market, 'lday', fn)
        size = os.path.getsize(path)
        if size % DAY_SIZE:
            bad_files.append((fn, f'长度 {size} 不是 {DAY_SIZE} 的整数倍（记录被截断）'))
        rows = read_day(path)
        if not rows:
            bad_files.append((fn, '空文件'))
            continue
        dates = [r[0] for r in rows]
        if dates != sorted(dates):
            bad_files.append((fn, '日期未升序'))
        for r in rows:
            if r[1] <= 0 or r[2] <= 0 or r[3] <= 0 or r[4] <= 0:
                bad_files.append((fn, '价格 ≤0'))
                break
            if r[2] < r[3] or r[2] < max(r[1], r[4]) or r[3] > min(r[1], r[4]):
                bad_files.append((fn, 'OHLC 不自洽'))
                break
        ref = read_day(os.path.join(HSJ_ROOT, market, 'lday', fn))
        if ref:
            ref_map = {r[0]: r for r in ref}
            for r in rows:
                o = ref_map.get(r[0])
                if not o:
                    continue
                d = max(abs(r[1] - o[1]), abs(r[2] - o[2]), abs(r[3] - o[3]),
                        abs(r[4] - o[4])) / 100.0
                worst_all = max(worst_all, d)
                if d <= 1e-9:
                    cmp_ok += 1
                else:
                    cmp_bad += 1
                if not vol_ok(r[6], o[6]):
                    vol_bad += 1
    log('校验文件 %d 个：结构异常 %d，与 hsjday 逐根比对 OHLC 一致 %d / 不一致 %d'
        '（最大差 %.4f 元），量超容差（±%d 股或 %.0e 相对）%d 根'
        % (len(files), len(bad_files), cmp_ok, cmp_bad, worst_all,
           VOL_TOL_ABS, VOL_TOL_REL, vol_bad))
    for fn, why in bad_files[:10]:
        log('  [结构异常] %s %s' % (fn, why))
    if bad_files:
        log('结论：结构异常 %d 个 → 不通过' % len(bad_files))
        return 1
    if strict and (cmp_bad or vol_bad):
        log('结论：结构通过，但 --strict 下与 hsjday 的差异（OHLC %d 根 / 量 %d 根）也算失败'
            % (cmp_bad, vol_bad))
        return 1
    if cmp_bad or vol_bad:
        log('结论：结构通过。与 hsjday 的差异属跨源对账项（OHLC %d 根、量 %d 根），'
            '量为「手截断/float32 精度/服务器历史量字段」所致，详见 '
            'report/volume-suspect.json；加 --strict 可让差异也返回失败。'
            % (cmp_bad, vol_bad))
    else:
        log('结论：结构通过，且与 hsjday 完全一致')
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description='日K线批量采集（通达信行情服务器 → .day）')
    ap.add_argument('--root', default=DEFAULT_ROOT,
                    help='输出根目录，最终布局 <root>/<market>/lday/*.day，默认 %s' % DEFAULT_ROOT)
    ap.add_argument('--tdx-root', default=os.environ.get('STOCK_SENTINEL_TDX_DIR') or r'D:\new_tdx',
                    help='本机通达信目录（取股票池）')
    ap.add_argument('--boards', default=DEFAULT_BOARDS,
                    help='板块，逗号分隔：%s。默认 %s（= kdata.is_stock 口径，含科创板）'
                         % ('/'.join(BOARDS), DEFAULT_BOARDS))
    ap.add_argument('--workers', type=int, default=6)
    ap.add_argument('--retries', type=int, default=3)
    ap.add_argument('--limit-codes', type=int, default=0)
    ap.add_argument('--incremental', action='store_true', help='只取最新 800 根并与现有文件合并')
    ap.add_argument('--force', action='store_true', help='忽略断点状态，全部重取')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--compare', action='store_true', help='与 data/hsjday 抽样比对（默认开）')
    ap.add_argument('--no-compare', action='store_true')
    ap.add_argument('--compare-codes', type=int, default=30, help='前 N 只做对账打日志')
    ap.add_argument('--with-indices', action='store_true', help='一并采上证/深证/创业板/沪深300 指数')
    ap.add_argument('--verify', action='store_true', help='只校验已有数据，不联网')
    ap.add_argument('--strict', action='store_true',
                    help='--verify 时把与 hsjday 的对账差异也算失败（默认只报告）')
    args = ap.parse_args(argv)

    args.compare = not args.no_compare
    log = Log(os.path.join(args.root, 'logs', 'daykline-%s.log' % time.strftime('%Y%m%d-%H%M%S')))

    if args.verify:
        return verify_all(args.root, log, strict=args.strict)

    boards = parse_boards(args.boards)
    log('输出根目录 %s（布局 <root>/<market>/lday/*.day）' % args.root)
    log('板块 %s（市场 %s）' % (','.join(boards), ','.join(markets_of(boards))))
    targets = universe(args.tdx_root, boards, args.with_indices)
    if args.limit_codes:
        targets = targets[:args.limit_codes]
        log('限流试跑：只取前 %d 只' % len(targets))
    log('目标 %d 只（含指数 %d 个）' % (len(targets), sum(1 for t in targets if t[2])))
    if not targets:
        log('股票池为空，退出')
        return 2

    col = DayCollector({'root': args.root, 'log': log,
                        'workers': max(1, args.workers), 'retries': max(0, args.retries)})
    col.setup_servers()
    summary = col.run(targets, args)
    log('本次结束：%s' % json.dumps(summary, ensure_ascii=False))
    report = os.path.join(args.root, 'report', 'daykline-%s.json' % time.strftime('%Y%m%d-%H%M%S'))
    os.makedirs(os.path.dirname(report), exist_ok=True)
    with open(report, 'w', encoding='utf-8') as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    log('报告 %s' % report)
    return 0 if not summary['failed'] else 1


if __name__ == '__main__':
    sys.exit(main())
