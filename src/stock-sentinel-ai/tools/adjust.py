# -*- coding: utf-8 -*-
"""
前复权因子管理（回测数据准备的第一步）

因子来源优先级
--------------
1. **新浪 qfq.js**（主）：每只股票一个 1~3KB 的 JSON，直接给出全历史除权除息日与
   累计因子，权威且完整（茅台 33 次除权事件全部列出）。
2. **本地检测**（兜底）：新浪取不到时（退市股、网络失败），按「除权日开盘价 / 前收盘」
   的跳空比例推算。**注意：停牌很久后复牌的股票会失真**（期间真实涨跌被算进因子），
   因此结果标记为 low_confidence。

因子语义（已实测验证）
----------------------
    前复权价 = 不复权价 / f
    后复权价 = 不复权价 * f
    f 为「后复权因子」，最新区间恒为 1.0，越早越大。
    验证：茅台 2006-05-25(10送10) 不复权 91.41→39.59(-56.7%)，
          前复权后 20.27→20.66(+1.9%)，跳空消除。

存储
----
    data/kline-full.db
        stocks(code PK, name, market, board, first_date, last_date, bar_count, ...)
        adj_factors(code, ex_date, factor, source, PK(code, ex_date))
        adj_status(code PK, source, factor_count, confidence, status, message, updated_at)

用法
----
    python tools/adjust.py --fetch                 # 抓取全市场因子（首次约 3~6 分钟）
    python tools/adjust.py --fetch --codes 600519,000001
    python tools/adjust.py --verify                # 抽样验证复权效果
    python tools/adjust.py --stats                 # 因子库统计
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kdata import Market, int_to_ymd, ymd_to_int  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.normpath(os.path.join(HERE, '..', 'data', 'kline-full.db'))
CST = timezone(timedelta(hours=8))
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      'Referer': 'https://finance.sina.com.cn/'}

SINA_QFQ = 'https://finance.sina.com.cn/realstock/company/{sym}/qfq.js'


def log(msg: str) -> None:
    print(f'[{datetime.now(CST):%H:%M:%S}] {msg}', flush=True)


def now_str() -> str:
    return datetime.now(CST).strftime('%Y-%m-%d %H:%M:%S')


# ==================================================================== #
#  1. 新浪因子抓取
# ==================================================================== #
def fetch_sina(sym: str, retries: int = 3, timeout: int = 20):
    """返回 [(ex_date 'YYYY-MM-DD', factor), ...] 按日期降序；失败返回 None。"""
    url = SINA_QFQ.format(sym=sym)
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            raw = urllib.request.urlopen(req, timeout=timeout).read().decode('gbk', 'ignore')
            m = re.search(r'=\s*(\{.*\})', raw, re.S)
            if not m:
                return None
            data = json.loads(m.group(1)).get('data') or []
            out = [(x['d'], float(x['f'])) for x in data if x.get('d') and x.get('f')]
            return out or None
        except Exception as e:                              # noqa: BLE001
            last = e
            time.sleep(0.4 * (i + 1))
    log(f'    {sym} 抓取失败: {type(last).__name__}: {last}')
    return None


# ==================================================================== #
#  2. 本地检测兜底
# ==================================================================== #
def detect_local(bars: np.ndarray, limit: float = 0.12):
    """
    从 K 线自身推算除权事件。返回 [(ex_date, factor), ...] 降序，含 1900-01-01 哨兵。

    原理：除权日 open/prev_close 会显著偏离 1（远超涨跌停），据此识别。
    局限：停牌多日后复牌，期间真实涨跌会被并入因子 → 偏差。故标记 low_confidence。
    """
    n = len(bars)
    if n < 2:
        return []
    opens, closes = bars['open'], bars['close']
    f = np.ones(n, dtype=np.float64)
    for i in range(n - 1, 0, -1):
        pc = closes[i - 1]
        if pc > 0:
            r = opens[i] / pc
            if 0.2 < r < 5.0 and abs(r - 1.0) > limit:
                f[i - 1] = f[i] / r
                continue
        f[i - 1] = f[i]
    events = []
    for i in range(n - 1, 0, -1):
        if abs(f[i - 1] - f[i]) > 1e-9:
            events.append((int_to_ymd(int(bars['date'][i])), float(f[i])))
    events.append(('1900-01-01', float(f[0])))
    return events


# ==================================================================== #
#  3. SQLite 存储
# ==================================================================== #
DROP_SCHEMA = """
DROP TABLE IF EXISTS stocks;
DROP TABLE IF EXISTS adj_factors;
DROP TABLE IF EXISTS adj_status;
"""

SCHEMA = """
CREATE TABLE IF NOT EXISTS stocks(
    code       TEXT PRIMARY KEY,
    name       TEXT,
    market     TEXT,
    board      TEXT,
    first_date TEXT,
    last_date  TEXT,
    bar_count  INTEGER,
    updated_at TEXT
);
CREATE TABLE IF NOT EXISTS adj_factors(
    code    TEXT NOT NULL,
    ex_date TEXT NOT NULL,
    factor  REAL NOT NULL,
    source  TEXT NOT NULL,
    PRIMARY KEY(code, ex_date)
);
CREATE TABLE IF NOT EXISTS adj_status(
    code          TEXT PRIMARY KEY,
    source        TEXT,
    factor_count  INTEGER,
    confidence    TEXT,
    status        TEXT,
    message       TEXT,
    updated_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_af_code ON adj_factors(code);
"""


def init_db(path: str = DB_PATH, reset: bool = True) -> sqlite3.Connection:
    # check_same_thread=False：写入统一由 _wlock 串行保护
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA synchronous=NORMAL')
    if reset:
        conn.executescript(DROP_SCHEMA)
    conn.executescript(SCHEMA)
    conn.commit()
    return conn


def write_stocks(conn, market: Market) -> int:
    rows = []
    for code in market.codes(min_bars=0):
        m = market.meta(code)
        bars = market.raw(code)
        first = int_to_ymd(int(bars['date'][0])) if len(bars) else ''
        last = int_to_ymd(int(bars['date'][-1])) if len(bars) else ''
        rows.append((code, m.get('name', ''), m.get('market', ''), m.get('board', ''),
                     first, last, m.get('bar_count', 0), now_str()))
    conn.executemany('INSERT OR REPLACE INTO stocks VALUES(?,?,?,?,?,?,?,?)', rows)
    conn.commit()
    return len(rows)


# ==================================================================== #
#  4. 主流程
# ==================================================================== #
_wlock = threading.Lock()


def cmd_fetch(args):
    mkt = Market(min_bars=args.min_bars)
    codes = [c.strip() for c in args.codes.split(',')] if args.codes else mkt.codes()
    log(f'本地日线: {mkt.root}')
    log(f'待处理 {len(codes)} 只（≥{args.min_bars} 根），并发 {args.workers}')

    conn = init_db(reset=args.reset)
    n = write_stocks(conn, mkt)
    log(f'已写入 stocks 元数据 {n} 只')

    if args.only_missing:
        have = {r[0] for r in conn.execute(
            "SELECT code FROM adj_status WHERE source='sina' AND status='ok'")}
        codes = [c for c in codes if c not in have]
        log(f'仅补抓未成功的代码：{len(codes)} 只')

    if args.local:
        log('模式：仅本地检测（不联网）')
    else:
        log('模式：新浪因子为主，失败时回落本地检测')

    done = {'sina': 0, 'local': 0, 'fail': 0}
    started = time.time()

    def one(code):
        sym = ('sh' if code[0] in '56' else 'sz') + code
        fac = None
        src = 'local'
        conf = 'low_confidence'
        msg = ''
        if not args.local:
            fac = fetch_sina(sym)
            if fac:
                src, conf = 'sina', 'high'
        if not fac:
            try:
                fac = detect_local(mkt.raw(code))
                msg = '新浪无数据，本地检测兜底'
            except Exception as e:                          # noqa: BLE001
                fac, msg = None, f'{type(e).__name__}: {e}'
        with _wlock:
            if fac:
                conn.executemany(
                    'INSERT OR REPLACE INTO adj_factors VALUES(?,?,?,?)',
                    [(code, d, f, src) for d, f in fac])
                conn.execute(
                    'INSERT OR REPLACE INTO adj_status VALUES(?,?,?,?,?,?,?)',
                    (code, src, len(fac), conf, 'ok', msg, now_str()))
                done[src] += 1
            else:
                conn.execute(
                    'INSERT OR REPLACE INTO adj_status VALUES(?,?,?,?,?,?,?)',
                    (code, 'none', 0, 'none', 'failed', msg[:200], now_str()))
                done['fail'] += 1
        return code

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = [ex.submit(one, c) for c in codes]
        for i, f in enumerate(as_completed(futs), 1):
            f.result()
            if i % 500 == 0 or i == len(codes):
                conn.commit()
                el = time.time() - started
                log(f'进度 {i}/{len(codes)}  新浪{done["sina"]} 本地{done["local"]} '
                    f'失败{done["fail"]}  {i/el:.1f} 只/秒  剩余 {(len(codes)-i)/(i/el):.0f}s')
    conn.commit()
    log(f'完成：新浪 {done["sina"]} / 本地 {done["local"]} / 失败 {done["fail"]}')


def load_all_factors(conn, source: str | None = None) -> dict[str, list]:
    out: dict[str, list] = {}
    if source:
        q = ('SELECT f.code, f.ex_date, f.factor FROM adj_factors f '
             'JOIN adj_status s ON s.code=f.code WHERE s.source=? '
             'ORDER BY f.code, f.ex_date DESC')
        rows = conn.execute(q, (source,)).fetchall()
    else:
        rows = conn.execute('SELECT code, ex_date, factor FROM adj_factors '
                            'ORDER BY code, ex_date DESC').fetchall()
    for c, d, f in rows:
        out.setdefault(c, []).append((d, f))
    return out


def cmd_verify(args):
    """抽样验证：复权前后跳空对比。"""
    mkt = Market(min_bars=args.min_bars)
    conn = sqlite3.connect(f'file:{DB_PATH}?mode=ro', uri=True)
    facs = load_all_factors(conn)
    if not facs:
        log('因子库为空，请先 --fetch')
        return 1

    codes = [c.strip() for c in args.codes.split(',')] if args.codes \
        else sorted(facs.keys())[:args.limit]
    log(f'验证 {len(codes)} 只股票')

    def worst(close: np.ndarray, dates: np.ndarray):
        """返回 (最大相邻跳空幅度, 发生日期 YYYYMMDD)"""
        if len(close) < 2:
            return 0.0, 0
        r = close[1:] / np.maximum(close[:-1], 1e-9)
        i = int(np.argmax(np.abs(r - 1.0)))
        return float(abs(r[i] - 1.0)), int(dates[i + 1])

    rows = []
    for c in codes:
        bars = mkt.raw(c)
        if len(bars) < 2 or c not in facs:
            continue
        q = mkt.load(c, 'qfq', facs[c])
        rj, rd = worst(bars['close'], bars['date'])
        qj, qd = worst(q['close'], q['date'])
        rows.append((c, len(bars), rj, rd, qj, qd,
                     float(bars['close'][-1]), float(q['close'][-1])))

    if not rows:
        log('无可验证数据')
        return 1
    raw_bad = sum(1 for r in rows if r[2] > 0.25)
    qfq_bad = sum(1 for r in rows if r[4] > 0.25)
    # 前复权后仍 >25% 的，按年份归类（1997 年前无涨跌停制度，属真实波动）
    from collections import Counter
    yrs = Counter(int(str(r[5])[:4]) for r in rows if r[4] > 0.25)
    print('\n  code     根数   不复权最大跳空      前复权最大跳空        最新价一致性')
    print('  ' + '-' * 76)
    for r in rows[:20]:
        print(f'  {r[0]}  {r[1]:>6}  {r[2]*100:>7.1f}%({r[3]})  '
              f'{r[4]*100:>8.1f}%({r[5]})  {r[6]:>9.2f} → {r[7]:>9.2f}')
    print(f'\n  最大跳空 >25% 的个股：不复权 {raw_bad} 只  →  前复权 {qfq_bad} 只')
    if yrs:
        pre97 = sum(v for y, v in yrs.items() if y < 1997)
        print(f'  残余跳空的年份分布: {dict(sorted(yrs.items()))}')
        print(f'    其中 1997 年前（无涨跌停制度，属真实行情）: {pre97} 只；'
              f'1997 年后: {qfq_bad - pre97} 只')
    print(f'  最新价一致性（前复权最新价应等于不复权最新价）：'
          f'{sum(1 for r in rows if abs(r[6]-r[7]) < 0.011)}/{len(rows)} 只吻合')
    return 0


def cmd_stats(args):
    if not os.path.exists(DB_PATH):
        log('库不存在'); return 1
    conn = sqlite3.connect(f'file:{DB_PATH}?mode=ro', uri=True)
    print('\n' + '=' * 60)
    print('因子库统计')
    print('=' * 60)
    for t in ('stocks', 'adj_factors', 'adj_status'):
        try:
            print(f'  {t:<14} {conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]:>8,} 行')
        except sqlite3.Error:
            print(f'  {t:<14} 表不存在')
    print('\n  因子来源分布:')
    for s, n in conn.execute('SELECT source, COUNT(*) FROM adj_status GROUP BY source'):
        print(f'    {s:<10} {n:>6}')
    print('\n  除权事件数 TOP5:')
    for c, n in conn.execute('SELECT code, factor_count FROM adj_status '
                             'ORDER BY factor_count DESC LIMIT 5'):
        print(f'    {c}  {n} 次')
    print(f'\n  库文件: {os.path.getsize(DB_PATH)/1e6:.1f} MB')
    print('=' * 60)
    return 0


def main():
    import argparse
    p = argparse.ArgumentParser(description='前复权因子抓取与管理')
    p.add_argument('--fetch', action='store_true', help='抓取复权因子')
    p.add_argument('--verify', action='store_true', help='验证复权效果')
    p.add_argument('--stats', action='store_true', help='因子库统计')
    p.add_argument('--codes', help='指定代码，逗号分隔')
    p.add_argument('--limit', type=int, default=300, help='验证抽样只数')
    p.add_argument('--workers', type=int, default=16, help='并发数')
    p.add_argument('--min-bars', type=int, default=250, help='最少K线根数门槛')
    p.add_argument('--local', action='store_true', help='仅用本地检测，不联网')
    p.add_argument('--only-missing', action='store_true',
                   help='只补抓尚未成功（非 sina/ok）的代码')
    p.add_argument('--no-reset', dest='reset', action='store_false', help='不重建表')
    p.set_defaults(reset=True)
    args = p.parse_args()

    if args.fetch:
        cmd_fetch(args)
    elif args.verify:
        return cmd_verify(args)
    elif args.stats:
        return cmd_stats(args)
    else:
        p.print_help()
    return 0


if __name__ == '__main__':
    sys.exit(main())
