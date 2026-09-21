# -*- coding: utf-8 -*-
"""智诊盯盘 · 通达信历史分时（分时图数据）批量采集器。

背景
----
客户端「盘后数据下载」的分钟数据只有最近约 100 天，datatool 的分笔包又只有 2024-01 起、
且转档只有 GUI 会做。而行情服务器的历史分时/分笔实测可回溯到 **2020-01-02**，
所以长历史只能自采。本脚本采集 **历史分时**（每分钟 close + volume），
按 (股票 × 交易日) 一次请求，落盘到 ``E:\\tdx_data``（见 ``tools/tdx_timeshare.py`` 的格式定义）。

它采什么、不采什么
------------------
* 采：每交易日 240 槽的 ``price``（元，0.01 网格）与 ``volume``（手）。**未复权**。
* 不采：open/high/low/amount（分时接口不提供）。需要分钟内极值请走分笔路线（另一支脚本）。
  正因如此，本数据集**不能**当分钟 K 线用，读取端要按 ``.fs`` 契约来。

可靠性设计
----------
* 多服务器轮换：启动时对候选服务器做健康检查，每个工作线程独占一条连接。
* 断点续爬：``state/days.json`` 记录逐日完成状态，重跑自动跳过已完成交易日。
* 逐日校验：槽数必须 = 240、价格必须落在 0.01 网格；每日抽样与本地 ``.day`` 收盘价对账。
* 不静默：拿不到的 (代码, 日期) 记进 ``state/gaps.json``，并在报告里列出，绝不冒充停牌。
* 按日升序追加：单只文件内日期有序，可用 ``--repair`` 回补缺口后重建。

用法::

    # 试跑：20 只 × 3 天，只取数校验、不落盘
    python tools/collect_tdx_timeshare.py --dry-run --limit-codes 20 --limit-days 3

    # 正式采集 2021-01-01 ~ 2022-12-31
    python tools/collect_tdx_timeshare.py --start 20210101 --end 20221231 --workers 8

    # 回补 gaps.json 里记录的缺口
    python tools/collect_tdx_timeshare.py --repair

依赖：pytdx（本机已装）。协议细节被隔离在 ``HqSource`` 里，将来可替换为自实现。
"""
from __future__ import annotations

import argparse
import concurrent.futures as futures
import datetime
import hashlib
import json
import os
import random
import struct
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from tdx_timeshare import (GRID, REC_SIZE, SLOTS, append_day, file_for,  # noqa: E402
                           load_file, market_of, pack_day, root_dir)

# 候选行情服务器（实测可达的那批；启动时逐个健康检查）
SERVERS = [
    ('119.97.185.59', 7709), ('124.70.133.119', 7709), ('116.205.183.150', 7709),
    ('123.60.73.44', 7709), ('116.205.163.254', 7709), ('121.36.225.169', 7709),
    ('123.60.70.228', 7709), ('124.71.9.153', 7709), ('110.41.147.114', 7709),
    ('124.71.187.122', 7709), ('180.153.18.170', 7709), ('60.191.117.167', 7709),
    ('115.238.56.198', 7709), ('115.238.90.165', 7709), ('218.75.126.9', 7709),
    ('60.12.136.250', 7709),
]
MARKET_ID = {'sz': 0, 'sh': 1, 'bj': 2}

# 板块 -> (市场, 代码前缀)。采集范围按板块显式声明，避免"整市场"这种含糊口径。
BOARDS = {
    'sh-main': ('sh', ('60',)),                        # 上证主板
    'sh-star': ('sh', ('68',)),                        # 科创板
    'sz-main': ('sz', ('000', '001', '002', '003', '004')),   # 深证主板（含原中小板）
    'chinext': ('sz', ('300', '301')),                 # 创业板
    'bj': ('bj', ('43', '83', '87', '92')),            # 北交所
}
# 默认只要 上证主板 + 深证主板 + 创业板
DEFAULT_BOARDS = 'sh-main,sz-main,chinext'
# 需要一并采集的指数（分时可用，供大盘/基准的日内口径使用）
INDICES = [(1, '000001'), (0, '399001'), (0, '399006'), (1, '000300')]
# 健康检查用的样本：(market_id, code)
HEALTH_CHECK = [(1, '600519'), (0, '000001')]

DAY_REC = struct.Struct('<IIIIIfII')      # 本地 .day：date,o,h,l,c,amount,vol,reserved


# ───────────────────────────── 日志 ─────────────────────────────

class Log:
    def __init__(self, path: str):
        self.path = path
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.lock = threading.Lock()

    def __call__(self, msg: str):
        line = '%s  %s' % (time.strftime('%H:%M:%S'), msg)
        with self.lock:
            print(line, flush=True)
            with open(self.path, 'a', encoding='utf-8') as f:
                f.write(line + '\n')


# ───────────────────────── 行情源（pytdx 隔离层）─────────────────────────

class HqSource:
    """一个服务器连接。协议细节都关在这里，换实现只动这个类。"""

    def __init__(self, ip: str, port: int):
        self.ip = ip
        self.port = port
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
            for market, code in HEALTH_CHECK:
                r = self.api.get_history_minute_time_data(market, code, 20221230)
                if not r or len(r) != SLOTS:
                    return False
            return True
        except Exception:
            return False

    def timeshare(self, market: int, code: str, ymd: int):
        """返回 (prices, volumes)；无数据返回 (None, None)。出错抛异常。"""
        r = self.api.get_history_minute_time_data(market, code, int(ymd))
        if not r:
            return None, None
        return ([float(x['price']) for x in r], [int(x['vol']) for x in r])


# ───────────────────────── 本地 .day（交易日历 + 对账 oracle）─────────────────────────

def _read_day_records(path: str) -> dict[int, int]:
    """{YYYYMMDD: close_cent}；close 为 ×100 整数（本地 .day 未复权）。"""
    if not os.path.exists(path):
        return {}
    with open(path, 'rb') as f:
        buf = f.read()
    n = len(buf) // 32
    out = {}
    for i in range(n):
        d, _o, _h, _l, c, _amt, _vol, _r = DAY_REC.unpack_from(buf, i * 32)
        out[int(d)] = int(c)
    return out


def day_close_cent(tdx_root: str, market: str, code: str, ymd: int) -> int | None:
    return _read_day_records(os.path.join(tdx_root, 'vipdoc', market, 'lday',
                                          f'{market}{code}.day')).get(int(ymd))


def trading_days_local(tdx_root: str, markets: list[str], start: int, end: int) -> list[int]:
    """本机 .day 里出现的日期（仅用于审计比对）。

    **不能**拿它当采集日历：实测本机 ``vipdoc/*/lday/*.day`` 缺 2021-01-04~2021-07-30
    （2021 年只有 103 条，正常约 243 条），用它当日历会静默漏采半年。
    真正的日历由 ``calendar_from_server`` 向服务器逐日探测得到。
    """
    pool = set()
    for market, code in (('sh', '000001'), ('sz', '399001')):
        if market not in markets:
            continue
        pool |= set(_read_day_records(
            os.path.join(tdx_root, 'vipdoc', market, 'lday', f'{market}{code}.day')))
    if not pool:
        for market in markets:
            d = os.path.join(tdx_root, 'vipdoc', market, 'lday')
            if not os.path.isdir(d):
                continue
            for fn in sorted(os.listdir(d))[:500]:
                pool |= set(_read_day_records(os.path.join(d, fn)))
    return [d for d in sorted(pool) if start <= d <= end]


def parse_boards(spec: str) -> list[str]:
    boards = [b.strip() for b in spec.split(',') if b.strip()]
    unknown = [b for b in boards if b not in BOARDS]
    if unknown:
        raise SystemExit(f'未知板块 {unknown}，可选：{",".join(BOARDS)}')
    return boards


def markets_of(boards: list[str]) -> list[str]:
    seen = []
    for b in boards:
        mkt = BOARDS[b][0]
        if mkt not in seen:
            seen.append(mkt)
    return seen


def universe(tdx_root: str, boards: list[str], with_indices: bool) -> list[tuple[str, str]]:
    """股票池 = 本地 lday ∪ minline 里落在指定板块的代码（含已退市，降低幸存者偏差）。"""
    prefixes = {mkt: tuple(p for b in boards if BOARDS[b][0] == mkt for p in BOARDS[b][1])
                for mkt in markets_of(boards)}
    out: dict[str, str] = {}
    for market, pres in prefixes.items():
        for sub in ('lday', 'minline'):
            d = os.path.join(tdx_root, 'vipdoc', market, sub)
            if not os.path.isdir(d):
                continue
            for fn in os.listdir(d):
                code = fn[2:8]
                if len(code) != 6 or not code.isdigit():
                    continue
                if not code.startswith(pres):
                    continue
                out[code] = market
    if with_indices:
        for market_id, code in INDICES:
            mkt = 'sh' if market_id == 1 else 'sz'
            if mkt in prefixes:
                out.setdefault(code, mkt)
    # 返回 (市场, 代码)，与下游 fetch/collect_day 的参数顺序一致
    return sorted((mkt, code) for code, mkt in out.items())


# ───────────────────────── 采集 ─────────────────────────

class Collector:
    def __init__(self, cfg):
        self.cfg = cfg
        self.log = cfg['log']
        self.root = root_dir(cfg['root'])
        self.tdx_root = cfg['tdx_root']
        self.lock = threading.Lock()
        self.tls = threading.local()
        self.servers: list[HqSource] = []
        self.stats = {'requests': 0, 'nodata': 0, 'errors': 0, 'retries': 0,
                      'written_records': 0, 'check_ok': 0, 'check_bad': 0}
        self.gaps: dict[str, list[int]] = {}

    # ---- 连接管理 ----
    def setup_servers(self):
        alive = []
        for ip, port in SERVERS:
            s = HqSource(ip, port)
            if s.probe():
                alive.append(s)
                self.log('服务器可用 %s' % ip)
            else:
                s.close()
            if len(alive) >= max(1, self.cfg['workers']):
                break
        if not alive:
            raise SystemExit('没有可用行情服务器')
        self.servers = alive
        self.log('可用服务器 %d 台，工作线程 %d' % (len(alive), self.cfg['workers']))

    def _source(self) -> HqSource:
        s = getattr(self.tls, 'src', None)
        if s is None:
            with self.lock:
                s = self.servers[getattr(self.tls, 'idx', 0) % len(self.servers)]
            s = HqSource(s.ip, s.port)
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

    # ---- 单只取数 ----
    def fetch(self, market: str, code: str, ymd: int):
        mid = MARKET_ID[market]
        for attempt in range(self.cfg['retries'] + 1):
            try:
                with self.lock:
                    self.stats['requests'] += 1
                prices, volumes = self._source().timeshare(mid, code, ymd)
                if prices is None:
                    with self.lock:
                        self.stats['nodata'] += 1
                    return None
                if len(prices) != SLOTS:
                    raise RuntimeError(f'点数异常 {len(prices)}')
                for p in prices:
                    if abs(p * 100 - round(p * 100)) > 1e-6:
                        raise RuntimeError(f'价格不在 0.01 网格 {p}')
                if any(v < 0 for v in volumes):
                    raise RuntimeError('成交量为负')
                return prices, volumes
            except Exception as exc:
                with self.lock:
                    self.stats['errors'] += 1
                    if attempt < self.cfg['retries']:
                        self.stats['retries'] += 1
                if attempt < self.cfg['retries']:
                    self._rotate()
                    time.sleep(0.05 * (attempt + 1))
                    continue
                self.log('取数失败 %s %s @%d：%s' % (market, code, ymd, exc))
                return 'ERROR'
        return 'ERROR'

    # ---- 一天 ----
    def collect_day(self, ymd: int, codes: list[tuple[str, str]]) -> tuple[dict, dict]:
        """返回 (当日小结, {(market, code): (prices, volumes) | None})。"""
        results: dict[tuple[str, str], tuple | None] = {}
        failed: list[tuple[str, str]] = []
        t0 = time.time()
        with futures.ThreadPoolExecutor(max_workers=self.cfg['workers']) as ex:
            futs = {ex.submit(self.fetch, m, c, ymd): (m, c) for m, c in codes}
            for fut in futures.as_completed(futs):
                key = futs[fut]
                val = fut.result()
                if val == 'ERROR':
                    failed.append(key)
                else:
                    results[key] = val
        elapsed = time.time() - t0
        got = sum(1 for v in results.values() if v)
        rate = len(codes) / elapsed if elapsed > 0 else 0
        self.log('  %d 完成：%d 只有数据 / %d 只无数据 / %d 只失败，%.1fs（%.0f 请求/秒）'
                 % (ymd, got, len(results) - got, len(failed), elapsed, rate))
        summary = {'date': ymd, 'total': len(codes), 'with_data': got,
                   'nodata': len(results) - got, 'failed': [f'{m}{c}' for m, c in failed],
                   'seconds': round(elapsed, 1)}
        return summary, results

    def check_day(self, ymd: int, results, sample: int) -> dict:
        """抽样与本地 .day 收盘价对账：分时末槽(15:00) 应等于当日收盘。"""
        if not sample:
            return {'sample': 0, 'ok': 0, 'bad': 0, 'skipped': 0, 'examples': []}
        pool = [(m, c) for (m, c), v in results.items() if v]
        if not pool:
            return {'sample': 0, 'ok': 0, 'bad': 0, 'skipped': 0, 'examples': []}
        picked = random.Random(ymd).sample(pool, min(sample, len(pool)))
        ok = bad = skipped = 0
        examples = []
        for market, code in picked:
            prices, _vols = results[(market, code)]
            ref = day_close_cent(self.tdx_root, market, code, ymd)
            if ref is None:
                skipped += 1        # 本机 .day 没有该日（例如 2021 上半年缺口）
                continue
            mine = int(round(prices[-1] * 100))
            if mine == ref:
                ok += 1
            else:
                bad += 1
                if len(examples) < 5:
                    examples.append({'code': code, 'date': ymd, 'timeshare_tail': mine,
                                     'day_close': ref, 'diff_cent': mine - ref})
        with self.lock:
            self.stats['check_ok'] += ok
            self.stats['check_bad'] += bad
        if bad:
            self.log('  %d 对账异常：%d/%d 只末槽价与 .day 收盘不符 %s'
                     % (ymd, bad, ok + bad, examples[:2]))
        return {'sample': ok + bad, 'ok': ok, 'bad': bad, 'skipped': skipped,
                'examples': examples}

    def write_day(self, ymd: int, results):
        written = 0
        for (market, code), val in results.items():
            if not val:
                continue
            prices, volumes = val
            append_day(file_for(code, self.root, market), ymd, prices, volumes)
            written += 1
        with self.lock:
            self.stats['written_records'] += written * SLOTS
        return written

    # ---- 状态 ----
    def state_path(self, name: str) -> str:
        p = os.path.join(self.root, 'state', name)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        return p

    def load_state(self) -> dict:
        p = self.state_path('days.json')
        if os.path.exists(p):
            with open(p, encoding='utf-8') as f:
                return json.load(f)
        return {}

    def save_state(self, state: dict):
        p = self.state_path('days.json')
        tmp = p + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(state, f, ensure_ascii=False, indent=1)
        os.replace(tmp, p)

    def save_gaps(self):
        p = self.state_path('gaps.json')
        existing = {}
        if os.path.exists(p):
            with open(p, encoding='utf-8') as f:
                existing = json.load(f)
        for code_key, days in self.gaps.items():
            merged = sorted(set(existing.get(code_key, [])) | set(days))
            existing[code_key] = merged
        with open(p, 'w', encoding='utf-8') as f:
            json.dump(existing, f, ensure_ascii=False, indent=1)

    def write_meta(self, days: list[int], codes, args):
        meta = {
            'dataset': 'tdx-hist-timeshare',
            'root': self.root,
            'createdAt': time.strftime('%Y-%m-%dT%H:%M:%S'),
            'window': {'start': args.start, 'end': args.end,
                       'tradingDays': len(days),
                       'first': days[0] if days else None, 'last': days[-1] if days else None},
            'universe': {'boards': list(self.cfg['boards']), 'markets': list(self.cfg['markets']),
                         'codes': len(codes), 'withIndices': not args.no_indices},
            'contract': {
                'file': 'fs/<market>/<market><code>.fs',
                'recordBytes': REC_SIZE,
                'layout': '<u32 date><u16 time><i16 reserved><i32 price_cent><u32 volume>',
                'slotsPerDay': SLOTS,
                'timeGrid': '0931..1130 + 1301..1500（该分钟结束时刻，接口不返回时间字段）',
                'priceFormat': 'int32-cent（价格×100，元为单位的 0.01 网格）',
                'volumeUnit': 'lot（手），×100 = 股',
                'adjustment': 'unadjusted（未复权）',
                'hasOHLC': False,
                'note': '分时只有 close+volume，没有 open/high/low/amount；不得当作分钟 K 线使用',
            },
            'source': {'protocol': 'tdx hq get_history_minute_time_data',
                       'serverCandidates': [ip for ip, _ in SERVERS]},
        }
        p = os.path.join(self.root, 'meta.json')
        with open(p, 'w', encoding='utf-8') as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)
        cal = os.path.join(self.root, 'calendar.txt')
        with open(cal, 'w', encoding='utf-8') as f:
            f.write('\n'.join(str(d) for d in sorted(days)) + '\n')
        return meta

    # ---- 交易日历（向服务器探测，不信任本机 .day）----
    def probe_day(self, market: int, code: str, ymd: int) -> bool:
        """单次轻量探测：该日是否有 240 点数据。失败返回 False（不重试、不计入主统计）。"""
        try:
            prices, _ = self._source().timeshare(market, code, ymd)
            return bool(prices) and len(prices) == SLOTS
        except Exception as exc:
            # 不静默：第一次失败就把原因打出来，否则「日历为空」这种事故无从定位
            self._probe_errors = getattr(self, '_probe_errors', 0) + 1
            if self._probe_errors <= 3:
                self.log('  日历探测失败 %s @%d：%s' % (code, ymd, exc))
            self._rotate()
            return False

    def calendar_from_server(self, start: int, end: int, refresh: bool = False) -> list[int]:
        """区间内逐工作日探测上证指数分时：240 点 = 交易日。

        结果写 ``calendar.txt``（给人看的交易日清单）与 ``state/calendar.json``
        （记录这次探测覆盖的区间）。只有后者覆盖得住请求窗口时才复用缓存，
        否则换个更宽的窗口会静默拿到一张更窄的日历。
        """
        cal = os.path.join(self.root, 'calendar.txt')
        cstate = os.path.join(self.root, 'state', 'calendar.json')
        cached: list[int] = []
        covered = False
        if not refresh and os.path.exists(cal) and os.path.exists(cstate):
            try:
                with open(cstate, encoding='utf-8') as f:
                    info = json.load(f)
                covered = int(info.get('start', 0)) <= start and int(info.get('end', 0)) >= end
            except Exception:
                covered = False
            if covered:
                with open(cal, encoding='utf-8') as f:
                    cached = [int(x) for x in (line.strip() for line in f) if x]
        if covered and cached:
            days = [d for d in cached if start <= d <= end]
            self.log('交易日历用缓存 calendar.txt：%d 天（覆盖 %d~%d）' % (len(days), start, end))
            return days
        d = datetime.date(start // 10000, start // 100 % 100, start % 100)
        stop = datetime.date(end // 10000, end // 100 % 100, end % 100)
        days = []
        probed = 0
        t0 = time.time()
        while d <= stop:
            if d.weekday() < 5:
                ymd = d.year * 10000 + d.month * 100 + d.day
                probed += 1
                if self.probe_day(1, '000001', ymd):
                    days.append(ymd)
            d += datetime.timedelta(days=1)
        self.log('交易日历探测完成：工作日 %d 个，其中交易日 %d 个，耗时 %.1fs'
                 % (probed, len(days), time.time() - t0))
        os.makedirs(self.root, exist_ok=True)
        os.makedirs(os.path.dirname(cstate), exist_ok=True)
        with open(cal, 'w', encoding='utf-8') as f:
            f.write('\n'.join(str(x) for x in days) + '\n')
        with open(cstate, 'w', encoding='utf-8') as f:
            json.dump({'start': start, 'end': end, 'probedWeekdays': probed,
                       'tradingDays': len(days)}, f, ensure_ascii=False, indent=1)
        # 与本机 .day 比对，把本地缺口显式报出来（本次实测缺 2021 上半年）
        local = set(trading_days_local(self.tdx_root, ['sh', 'sz'], start, end))
        missing_local = [x for x in days if x not in local]
        if missing_local:
            self.log('注意：本机 .day 缺 %d 个交易日（首个 %d）。这些日期没有本地收盘价可对账，'
                     '也不应作为日历来源。' % (len(missing_local), missing_local[0]))
        return days


    def universe_state_path(self) -> str:
        return self.state_path('universe.json')

    def guard_universe(self, codes, boards, args) -> bool:
        """股票池变了就不许续爬，否则新板块的股票会被「该日已完成」静默跳过。

        返回 True 表示可以继续。
        """
        sig = {'boards': list(boards), 'codes': len(codes),
               'codeHash': hashlib.sha1(
                   ','.join(f'{m}{c}' for m, c in codes).encode()).hexdigest()[:16],
               'window': [args.start, args.end]}
        p = self.universe_state_path()
        if not os.path.exists(p):
            with open(p, 'w', encoding='utf-8') as f:
                json.dump(sig, f, ensure_ascii=False, indent=1)
            if self.load_state():
                self.log('股票池签名已补记（本次 %d 只 / %s）。若这次与之前采的不是同一批股票，'
                         '请换 --root 重采，否则覆盖面会不完整。' % (len(codes), ','.join(boards)))
            return True
        with open(p, encoding='utf-8') as f:
            old = json.load(f)
        if old.get('codeHash') == sig['codeHash'] and old.get('boards') == sig['boards']:
            return True
        self.log('拒绝续爬：股票池与上次不同')
        self.log('  上次：%s / %s 只 / hash %s'
                 % (','.join(old.get('boards', [])), old.get('codes', 0), old.get('codeHash')))
        self.log('  本次：%s / %s 只 / hash %s'
                 % (','.join(boards), len(codes), sig['codeHash']))
        self.log('  days.json 记的是「该日已按旧股票池采完」，直接续爬会让新增股票永远采不到，'
                 '而表面上显示为已完成。')
        self.log('  处理办法：①换一个 --root 重采（最干净）；②确认要换池则删除 state/days.json '
                 '后重采（已落盘文件会拒绝重复追加，需先清理）；'
                 '③确有必要时加 --ignore-universe-change 强行续爬，并接受新增股票无数据。')
        if args.ignore_universe_change:
            self.log('  已按 --ignore-universe-change 强行续爬。')
            return True
        return False

    def run(self, days: list[int], codes, args) -> dict:
        state = self.load_state()
        todo = [d for d in days if not state.get(str(d), {}).get('done')]
        self.log('交易日 %d 天，已完成 %d 天，本次待采 %d 天'
                 % (len(days), len(days) - len(todo), len(todo)))
        if args.limit_days:
            todo = todo[:args.limit_days]
        t0 = time.time()
        for i, ymd in enumerate(todo, 1):
            self.log('[%d/%d] %d 开始（%d 只）' % (i, len(todo), ymd, len(codes)))
            day, results = self.collect_day(ymd, codes)
            check = self.check_day(ymd, results, args.check_sample)
            written = 0
            if not args.dry_run:
                if args.allow_partial_day or not day['failed']:
                    written = self.write_day(ymd, results)
                else:
                    self.log('  %d 有 %d 只失败，按严格模式整日不落盘'
                             % (ymd, len(day['failed'])))
                    for key in day['failed']:
                        self.gaps.setdefault(key, []).append(ymd)
                    continue
            record = {
                'done': bool(not day['failed']) or bool(args.allow_partial_day),
                'total': day['total'], 'with_data': day['with_data'],
                'nodata': day['nodata'], 'failed': len(day['failed']),
                'written': written, 'check': check, 'seconds': day['seconds'],
            }
            if day['failed']:
                for key in day['failed']:
                    self.gaps.setdefault(key, []).append(ymd)
            if not args.dry_run:
                state[str(ymd)] = record
                self.save_state(state)
                if self.gaps:
                    self.save_gaps()
            self.log('  %d 落盘 %d 只（累计 %.1f 万条记录），对账 %d/%d（%d 只无本地参照）'
                     % (ymd, written, self.stats['written_records'] / 10000,
                        check['ok'], check['ok'] + check['bad'], check.get('skipped', 0)))
        elapsed = time.time() - t0
        return {'days_done': len(todo), 'seconds': round(elapsed, 1),
                'stats': dict(self.stats), 'gaps': len(self.gaps)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description='通达信历史分时批量采集')
    ap.add_argument('--root', default='', help=f'数据集根目录，默认 {root_dir()}')
    ap.add_argument('--tdx-root', default=os.environ.get('STOCK_SENTINEL_TDX_DIR') or r'D:\new_tdx',
                    help='本机通达信目录（交易日历与对账 oracle）')
    ap.add_argument('--start', type=int, default=20210101)
    ap.add_argument('--end', type=int, default=20221231)
    ap.add_argument('--boards', default=DEFAULT_BOARDS,
                    help='采集板块，逗号分隔；可选 %s。默认 %s（不含科创板与北交所）'
                         % ('/'.join(BOARDS), DEFAULT_BOARDS))
    ap.add_argument('--workers', type=int, default=8)
    ap.add_argument('--retries', type=int, default=3)
    ap.add_argument('--check-sample', type=int, default=40, help='每日抽样对账只数，0 关闭')
    ap.add_argument('--limit-codes', type=int, default=0)
    ap.add_argument('--limit-days', type=int, default=0)
    ap.add_argument('--dry-run', action='store_true', help='只取数与校验，不落盘')
    ap.add_argument('--allow-partial-day', action='store_true',
                    help='某日部分股票失败时仍落盘（失败项记 gaps.json）')
    ap.add_argument('--repair', action='store_true', help='按 gaps.json 回补并重建受影响文件')
    ap.add_argument('--refresh-calendar', action='store_true',
                    help='忽略 calendar.txt 缓存，重新向服务器探测交易日')
    ap.add_argument('--no-indices', action='store_true', help='不采指数')
    ap.add_argument('--ignore-universe-change', action='store_true',
                    help='股票池与上次不同时仍强行续爬（新增股票将没有数据，慎用）')
    args = ap.parse_args(argv)

    root = root_dir(args.root or None)
    boards = parse_boards(args.boards)
    markets = markets_of(boards)
    log = Log(os.path.join(root, 'logs', 'collect-%s.log' % time.strftime('%Y%m%d-%H%M%S')))
    log('数据集根目录 %s' % root)
    log('本机通达信 %s' % args.tdx_root)
    log('采集板块 %s（市场 %s）' % (','.join(boards), ','.join(markets)))
    if 'bj' in boards:
        log('注意：北交所 43/83/87 段历史分时实测取不到，若全为 0 点请从 --boards 去掉 bj')

    codes = universe(args.tdx_root, boards, not args.no_indices)
    if args.limit_codes:
        codes = codes[:args.limit_codes]
        log('限流试跑：只取前 %d 只' % len(codes))
    if not codes:
        log('股票池为空，退出')
        return 2

    cfg = {'root': root, 'tdx_root': args.tdx_root, 'log': log,
           'boards': boards, 'markets': markets,
           'workers': max(1, args.workers), 'retries': max(0, args.retries)}
    col = Collector(cfg)
    col.setup_servers()

    if args.repair:
        return repair(col, args)

    days = col.calendar_from_server(args.start, args.end, args.refresh_calendar)
    log('股票池 %d 只，窗口 %d~%d 共 %d 个交易日'
        % (len(codes), args.start, args.end, len(days)))
    if not days:
        log('交易日历为空，退出')
        return 2

    if not col.guard_universe(codes, boards, args):
        return 3
    if not args.dry_run:
        col.write_meta(days, codes, args)
    summary = col.run(days, codes, args)
    log('本次结束：%s' % json.dumps(summary, ensure_ascii=False))
    if not args.dry_run:
        report = os.path.join(root, 'report',
                              'coverage-%s.json' % time.strftime('%Y%m%d-%H%M%S'))
        os.makedirs(os.path.dirname(report), exist_ok=True)
        with open(report, 'w', encoding='utf-8') as f:
            json.dump(summary, f, ensure_ascii=False, indent=2)
        log('报告 %s' % report)
    for s in col.servers:
        s.close()
    return 0


def repair(col: 'Collector', args) -> int:
    """按 gaps.json 回补缺口，并把受影响文件按日期重排重建。"""
    gap_path = os.path.join(col.root, 'state', 'gaps.json')
    if not os.path.exists(gap_path):
        col.log('没有 gaps.json，无需回补')
        return 0
    with open(gap_path, encoding='utf-8') as f:
        gaps = json.load(f)
    col.log('待回补 %d 只 / %d 个 (代码,日期)' % (len(gaps), sum(len(v) for v in gaps.values())))
    remaining = {}
    fixed_records = 0
    for code_key, days in sorted(gaps.items()):
        market, code = code_key[:2], code_key[2:]
        if not code.isdigit():
            continue
        path = file_for(code, col.root, market)
        m = load_file(path)
        have = {}
        if m:
            for d, t, p, v in zip(m['date'], m['time'], m['price'], m['volume']):
                have.setdefault(int(d), {})[int(t)] = (float(p), int(v))
        still = []
        for ymd in days:
            val = col.fetch(market, code, int(ymd))
            if val == 'ERROR':
                still.append(int(ymd))
                continue
            if val is None:
                continue          # 该日确实无数据（停牌/未上市），不算缺口
            prices, volumes = val
            have[int(ymd)] = {GRID[i]: (prices[i], volumes[i]) for i in range(SLOTS)}
            fixed_records += SLOTS
        if still:
            remaining[code_key] = still
        # 重建：按 (日期, 时间) 排序写回
        buf = bytearray()
        for d in sorted(have):
            slots = have[d]
            for t in GRID:
                if t not in slots:
                    continue
                p, v = slots[t]
                buf += struct.pack('<IHHiI', d, t, 0, int(round(p * 100)), int(v))
        tmp = path + '.tmp'
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(tmp, 'wb') as f:
            f.write(bytes(buf))
        os.replace(tmp, path)
        col.log('  重建 %s：%d 天' % (os.path.basename(path), len(have)))
    with open(gap_path, 'w', encoding='utf-8') as f:
        json.dump(remaining, f, ensure_ascii=False, indent=1)
    col.log('回补结束：写入 %d 条记录，仍余 %d 只未补齐' % (fixed_records, len(remaining)))
    return 0 if not remaining else 1


if __name__ == '__main__':
    sys.exit(main())
