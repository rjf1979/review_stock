#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
全市场 A 股日 K 抓取工具（沪深两市 / 日线 / SQLite / 供回测）

数据源（按 --source 选择，均免费、无需 Token）：
  sohu   搜狐财经 hisHq   —— 默认主源。单次请求返回【全历史】日线（最早可到 1991 年），
                            且自带成交额、换手率、涨跌额、涨跌幅。仅此源能覆盖 2000 年至今。
  sina   新浪 getKLineData —— 备用，单次最多 6000 根（老股票更早部分会被截断）。
  tencent 腾讯 fqkline     —— 前复权（响应节点 qfqday 可验证），但深度上限约 800 根，
                            仅用于给最近 800 根补充前复权价（*_qfq 列）。
  tdx    通达信本地 vipdoc —— 读取 D:\\new_tdx\\vipdoc\\{sh,sz}\\lday\\*.day 二进制，
                            速度最快，但本机数据目前只到 2021-08 起，需在通达信内
                            执行「盘后数据下载 → 日线」补齐历史后才可用作主源。

输出：data/kline-full.db
  stocks  个股维度：代码/名称/市场/板块/起止日期/根数/来源/状态
  kline   日线维度：OHLCV + 成交额 + 换手率 + 涨跌/振幅 + 前复权补充列
  fetch_log 每次运行的逐票结果，便于排查与断点续跑

口径与单位（统一后入库）：
  价格    元（前复权价另存 *_qfq 列，不覆盖主列）
  volume  股（搜狐/通达信原始为手→×100；新浪原始为股→×1）
  amount  元（搜狐原始为万元→×10000；通达信原始为元）
  turnover 百分数（如 1.23 表示 1.23%）
  change/pct_change/amplitude 均由本库主 close 序列推算，保证自洽

用法：
  python tools/kline_full.py --stats              # 查看库中统计
  python tools/kline_full.py --limit 20           # 试跑 20 只
  python tools/kline_full.py                      # 全量/增量（自动判断）
  python tools/kline_full.py --full               # 强制全量重抓
  python tools/kline_full.py --source tdx         # 改用通达信本地数据
  python tools/kline_full.py --no-qfq --workers 24

仅依赖 Python 标准库，无需 pip 安装任何包。
"""

import argparse
import gzip
import json
import os
import re
import sqlite3
import struct
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone

CST = timezone(timedelta(hours=8))
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/122.0 Safari/537.36')

DEFAULT_TDX_ROOT = r'D:\new_tdx\vipdoc'
DEFAULT_DB_NAME = 'kline-full.db'

# 东财全市场列表（clist）—— 沪主板/深主板/创业板/科创板，排除北交所
EM_CLIST = 'https://push2delay.eastmoney.com/api/qt/clist/get'
MARKET_FILTERS = [
    ('SH', '主板', 'm:1+t:2'),
    ('SZ', '主板', 'm:0+t:6'),
    ('SZ', '创业板', 'm:0+t:80'),
    ('SH', '科创板', 'm:1+t:23'),
]

# 代码前缀白名单：只保留沪深 A 股，剔除北交所(4/8/92)与 B 股(900/200)
CODE_RE = re.compile(r'^(60\d{4}|688\d{3}|000\d{3}|001\d{3}|002\d{3}|003\d{3}|300\d{3}|301\d{3})$')


def now_cst():
    return datetime.now(CST)


def today_str():
    return now_cst().strftime('%Y-%m-%d')


def log(msg):
    print(f'[{now_cst().strftime("%H:%M:%S")}] {msg}', flush=True)


# ─────────────────────────── HTTP ───────────────────────────

def http_get(url, headers=None, timeout=25, retries=3, referer=None):
    """GET 并自动解压 gzip；失败按指数退避重试。返回文本。"""
    hdr = {'User-Agent': UA, 'Accept': '*/*'}
    if referer:
        hdr['Referer'] = referer
    hdr.update(headers or {})
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=hdr)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read()
                if resp.headers.get('Content-Encoding') == 'gzip':
                    raw = gzip.decompress(raw)
                return raw.decode('utf-8', 'replace')
        except Exception as e:          # noqa: BLE001
            last = e
            if attempt < retries - 1:
                time.sleep(0.6 * (attempt + 1))
    raise last


# ─────────────────────────── 数据源 ───────────────────────────

def fetch_sohu(code, start_date='20000101', end_date=None):
    """搜狐全历史日线。返回 [{date,open,high,low,close,volume,amount,turnover,change,pct_change}]

    原始行: [日期, 开, 收, 涨跌额, 涨跌幅, 最低, 最高, 成交量(手), 成交额(万元), 换手率]
    """
    end_date = end_date or now_cst().strftime('%Y%m%d')
    url = (f'https://q.stock.sohu.com/hisHq?code=cn_{code}'
           f'&start={start_date}&end={end_date}&stat=1&order=D&period=d')
    text = http_get(url, referer='https://q.stock.sohu.com/')
    payload = json.loads(text)
    rows = (payload[0] if payload else {}).get('hq') or []
    out = []
    for r in rows:
        if len(r) < 8 or not re.match(r'^\d{4}-\d{2}-\d{2}$', str(r[0])):
            continue
        try:
            o, c, low, high = float(r[1]), float(r[2]), float(r[5]), float(r[6])
            vol = float(r[7])
        except (TypeError, ValueError):
            continue
        if not (o > 0 and c > 0 and high > 0 and low > 0):
            continue
        amount = None
        if len(r) > 8 and r[8] not in (None, '', '-'):
            try:
                amount = float(str(r[8]).replace(',', '')) * 10000.0   # 万元 → 元
            except ValueError:
                amount = None
        turnover = None
        if len(r) > 9 and r[9] not in (None, '', '-'):
            try:
                turnover = float(str(r[9]).replace('%', '').replace(',', ''))
            except ValueError:
                turnover = None
        out.append({'date': r[0], 'open': o, 'high': high, 'low': low, 'close': c,
                    'volume': vol * 100.0,      # 手 → 股
                    'amount': amount, 'turnover': turnover})
    out.sort(key=lambda x: x['date'])            # 搜狐为倒序，统一转正序
    return out


def fetch_sina(code, count=6000):
    """新浪日线（未复权，成交量单位为股）。"""
    prefix = 'sh' if code.startswith('6') else 'sz'
    url = ('https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/'
           f'CN_MarketData.getKLineData?symbol={prefix}{code}&scale=240&ma=no&datalen={count}')
    arr = json.loads(http_get(url))
    out = []
    for k in arr or []:
        try:
            o, h, l, c = float(k['open']), float(k['high']), float(k['low']), float(k['close'])
            v = float(k['volume'])
        except (KeyError, TypeError, ValueError):
            continue
        if not (o > 0 and c > 0 and h > 0 and l > 0):
            continue
        out.append({'date': str(k['day'])[:10], 'open': o, 'high': h, 'low': l, 'close': c,
                    'volume': v, 'amount': None, 'turnover': None})
    out.sort(key=lambda x: x['date'])
    return out


def fetch_tencent_qfq(code, count=800):
    """腾讯前复权日线（响应节点 qfqday 可验证口径），成交量单位为手。"""
    prefix = 'sh' if code.startswith('6') else 'sz'
    url = (f'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get'
           f'?param={prefix}{code},day,,,{count},qfq')
    j = json.loads(http_get(url, timeout=15))
    node = (j.get('data') or {}).get(f'{prefix}{code}') or {}
    arr = node.get('qfqday') or []
    out = {}
    for k in arr:
        if len(k) < 6:
            continue
        try:
            out[str(k[0])[:10]] = (float(k[1]), float(k[3]), float(k[4]), float(k[2]))
        except (TypeError, ValueError):
            continue
    return out    # date -> (open, high, low, close)


def read_tdx_day(path):
    """通达信 .day：32 字节/条 —— date,open,high,low,close,amount(float32),volume,reserved"""
    if not os.path.exists(path):
        return []
    with open(path, 'rb') as f:
        raw = f.read()
    out = []
    for i in range(len(raw) // 32):
        d, o, h, l, c = struct.unpack_from('<IIIII', raw, i * 32)
        amount = struct.unpack_from('<f', raw, i * 32 + 20)[0]
        vol = struct.unpack_from('<I', raw, i * 32 + 24)[0]
        ds = str(d)
        if len(ds) != 8 or not (o > 0 and c > 0):
            continue
        out.append({'date': f'{ds[:4]}-{ds[4:6]}-{ds[6:]}',
                    'open': o / 100.0, 'high': h / 100.0, 'low': l / 100.0, 'close': c / 100.0,
                    'volume': float(vol), 'amount': float(amount) if amount > 0 else None,
                    'turnover': None})
    out.sort(key=lambda x: x['date'])
    return out


def fetch_tdx(code, tdx_root):
    market = 'sh' if code.startswith('6') else 'sz'
    return read_tdx_day(os.path.join(tdx_root, market, 'lday', f'{market}{code}.day'))


# ─────────────────────────── 股票池 ───────────────────────────

def fetch_universe(workers=1):
    """东财 clist 分页拉取沪深 A 股（代码+名称），返回 [(code, name, market, board)]"""
    result = {}

    def one(market, board, fs):
        rows = []
        page, page_size = 1, 100
        while True:
            url = (f'{EM_CLIST}?pn={page}&pz={page_size}&po=1&np=1&fltt=2&invt=2'
                   f'&fid=f3&fs={fs}&fields=f12,f14')
            try:
                data = json.loads(http_get(url, timeout=20)).get('data') or {}
            except Exception:                      # noqa: BLE001
                break
            diff = data.get('diff') or []
            if not diff:
                break
            for item in diff:
                code = str(item.get('f12', '')).strip()
                if CODE_RE.match(code):
                    rows.append((code, str(item.get('f14', '')).strip(), market, board))
            total = data.get('total') or 0
            if page * page_size >= total:
                break
            page += 1
            time.sleep(0.12)
        return rows

    with ThreadPoolExecutor(max_workers=max(1, len(MARKET_FILTERS))) as ex:
        futs = [ex.submit(one, m, b, fs) for m, b, fs in MARKET_FILTERS]
        for f in as_completed(futs):
            for code, name, market, board in f.result():
                result[code] = (name, market, board)
    return [(c, v[0], v[1], v[2]) for c, v in sorted(result.items())]


# ─────────────────────────── 数据库 ───────────────────────────

SCHEMA = """
CREATE TABLE IF NOT EXISTS stocks (
  code        TEXT PRIMARY KEY,
  name        TEXT,
  market      TEXT,
  board       TEXT,
  first_date  TEXT,
  last_date   TEXT,
  bar_count   INTEGER DEFAULT 0,
  source      TEXT,
  status      TEXT,
  message     TEXT,
  updated_at  TEXT
);
CREATE TABLE IF NOT EXISTS kline (
  code        TEXT NOT NULL,
  date        TEXT NOT NULL,
  open        REAL, high REAL, low REAL, close REAL,
  prev_close  REAL, change REAL, pct_change REAL, amplitude REAL,
  volume      REAL, amount REAL, turnover REAL,
  open_qfq    REAL, high_qfq REAL, low_qfq REAL, close_qfq REAL,
  source      TEXT, updated_at TEXT,
  PRIMARY KEY (code, date)
);
CREATE INDEX IF NOT EXISTS idx_kline_date ON kline(date);
CREATE TABLE IF NOT EXISTS fetch_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT, code TEXT, status TEXT, bars INTEGER,
  source TEXT, message TEXT, ts TEXT
);
CREATE INDEX IF NOT EXISTS idx_fetch_log_run ON fetch_log(run_id);
"""


def open_db(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path, check_same_thread=False, timeout=60)
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA synchronous=NORMAL')
    conn.execute('PRAGMA temp_store=MEMORY')
    conn.execute('PRAGMA cache_size=-262144')     # 256MB
    conn.executescript(SCHEMA)
    return conn


def derive(rows):
    """按主 close 序列补齐 prev_close/change/pct_change/amplitude（与自身口径自洽）"""
    prev = None
    for r in rows:
        r['prev_close'] = prev
        if prev:
            r['change'] = round(r['close'] - prev, 4)
            r['pct_change'] = round((r['close'] - prev) / prev * 100, 4)
            r['amplitude'] = round((r['high'] - r['low']) / prev * 100, 4)
        else:
            r['change'] = r['pct_change'] = r['amplitude'] = None
        prev = r['close']


def upsert_bars(conn, code, rows, source, lock):
    ts = now_cst().strftime('%Y-%m-%d %H:%M:%S')
    payload = [(code, r['date'], r['open'], r['high'], r['low'], r['close'],
                r.get('prev_close'), r.get('change'), r.get('pct_change'), r.get('amplitude'),
                r.get('volume'), r.get('amount'), r.get('turnover'),
                r.get('open_qfq'), r.get('high_qfq'), r.get('low_qfq'), r.get('close_qfq'),
                source, ts) for r in rows]
    with lock:
        conn.executemany(
            'INSERT INTO kline(code,date,open,high,low,close,prev_close,change,pct_change,'
            'amplitude,volume,amount,turnover,open_qfq,high_qfq,low_qfq,close_qfq,source,updated_at) '
            'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) '
            'ON CONFLICT(code,date) DO UPDATE SET '
            'open=excluded.open,high=excluded.high,low=excluded.low,close=excluded.close,'
            'prev_close=excluded.prev_close,change=excluded.change,pct_change=excluded.pct_change,'
            'amplitude=excluded.amplitude,volume=excluded.volume,amount=excluded.amount,'
            'turnover=excluded.turnover,open_qfq=excluded.open_qfq,high_qfq=excluded.high_qfq,'
            'low_qfq=excluded.low_qfq,close_qfq=excluded.close_qfq,source=excluded.source,'
            'updated_at=excluded.updated_at', payload)
        # 提交交由上层按批次统一执行（频繁 commit 是全量写入的主要开销）


def recompute_derived(conn, code, tail_n, lock):
    """重算尾部若干行的派生列（增量更新后保证 prev_close 链式正确）"""
    with lock:
        rows = conn.execute(
            'SELECT date,high,low,close FROM kline WHERE code=? ORDER BY date DESC LIMIT ?',
            (code, tail_n + 1)).fetchall()
        rows.reverse()
        if not rows:
            return
        prow = conn.execute(
            'SELECT close FROM kline WHERE code=? AND date<? ORDER BY date DESC LIMIT 1',
            (code, rows[0][0])).fetchone()
        prev = prow[0] if prow else None
        updates = []
        for date, high, low, close in rows:
            if prev:
                updates.append((prev, round(close - prev, 4),
                                round((close - prev) / prev * 100, 4),
                                round((high - low) / prev * 100, 4), code, date))
            else:
                updates.append((None, None, None, None, code, date))
            prev = close
        conn.executemany('UPDATE kline SET prev_close=?,change=?,pct_change=?,amplitude=? '
                         'WHERE code=? AND date=?', updates)


def refresh_stock_meta(conn, code, name, market, board, source, status, message, lock):
    with lock:
        agg = conn.execute('SELECT MIN(date),MAX(date),COUNT(*) FROM kline WHERE code=?',
                           (code,)).fetchone()
        first, last, count = (agg if agg else (None, None, 0))
        conn.execute(
            'INSERT INTO stocks(code,name,market,board,first_date,last_date,bar_count,'
            'source,status,message,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) '
            'ON CONFLICT(code) DO UPDATE SET name=excluded.name,market=excluded.market,'
            'board=excluded.board,first_date=excluded.first_date,last_date=excluded.last_date,'
            'bar_count=excluded.bar_count,source=excluded.source,status=excluded.status,'
            'message=excluded.message,updated_at=excluded.updated_at',
            (code, name, market, board, first, last, count or 0, source, status, message,
             now_cst().strftime('%Y-%m-%d %H:%M:%S')))


def write_log(conn, run_id, code, status, bars, source, message, lock):
    with lock:
        conn.execute('INSERT INTO fetch_log(run_id,code,status,bars,source,message,ts) '
                     'VALUES(?,?,?,?,?,?,?)',
                     (run_id, code, status, bars, source, (message or '')[:200],
                      now_cst().strftime('%Y-%m-%d %H:%M:%S')))


# ─────────────────────────── 主流程 ───────────────────────────

class Counter:
    def __init__(self):
        self.lock = threading.Lock()
        self.ok = self.skip = self.fail = 0
        self.bars = 0

    def add(self, ok=0, skip=0, fail=0, bars=0):
        with self.lock:
            self.ok += ok
            self.skip += skip
            self.fail += fail
            self.bars += bars


class QfqBreaker:
    """前复权（腾讯）失败熔断：连续失败过多就整体关闭，避免网络异常拖垮全量任务"""

    def __init__(self, limit=30):
        self.limit = limit
        self.fails = 0
        self.off = False
        self.lock = threading.Lock()

    def ok(self):
        with self.lock:
            if self.off:
                return False
            self.fails = 0
            return True

    def fail(self):
        with self.lock:
            self.fails += 1
            if self.fails >= self.limit:
                self.off = True
                return True          # 刚刚熔断，通知调用方
            return False


QFQ = QfqBreaker()


def process_one(args, conn, lock, counter, run_id, code, name, market, board):
    """抓取单只股票并落库。返回 (status, bars, message)"""
    try:
        with lock:
            row = conn.execute('SELECT last_date FROM stocks WHERE code=?', (code,)).fetchone()
        known_last = row[0] if row else None
        incremental = bool(known_last) and not args.full

        # 1) 主源取数
        if args.source == 'tdx':
            bars = fetch_tdx(code, args.tdx_root)
            src = 'tdx'
        elif args.source == 'sina':
            bars = fetch_sina(code, args.sina_count)
            src = 'sina'
        else:
            start = args.start.replace('-', '')
            if incremental:                       # 增量：只请求尾部一小段
                start = (datetime.strptime(known_last, '%Y-%m-%d')
                         - timedelta(days=7)).strftime('%Y%m%d')
            bars = fetch_sohu(code, start)
            src = 'sohu'
        if not bars:
            return ('empty', 0, '主源无数据')

        # 2) 起始日期过滤
        bars = [b for b in bars if b['date'] >= args.start]
        if not bars:
            return ('empty', 0, '起始日期后无数据')

        # 3) 增量判定：无新增则直接返回，不发网络请求（断点续跑提速关键）
        if incremental:
            new_bars = [b for b in bars if b['date'] > known_last]
            if not new_bars:
                return ('unchanged', 0, '无新增')
        else:
            if len(bars) < args.min_bars:
                return ('insufficient', len(bars), f'仅 {len(bars)} 根 < {args.min_bars}')
            new_bars = bars

        # 4) 前复权补充（腾讯，最近约 800 根）—— 失败熔断，不影响主流程
        if args.qfq and QFQ.ok():
            try:
                qmap = fetch_tencent_qfq(code, args.qfq_bars)
                for b in new_bars:
                    q = qmap.get(b['date'])
                    if q:
                        b['open_qfq'], b['high_qfq'], b['low_qfq'], b['close_qfq'] = q
            except Exception:                          # noqa: BLE001
                if QFQ.fail():
                    log('前复权连续失败，已关闭后续 qfq 补充（主流程不受影响）')

        # 5) 落库
        if incremental:
            upsert_bars(conn, code, new_bars, src, lock)
            recompute_derived(conn, code, len(new_bars) + 1, lock)
            refresh_stock_meta(conn, code, name, market, board, src, 'ok', '增量', lock)
            return ('ok', len(new_bars), '增量')
        derive(new_bars)
        upsert_bars(conn, code, new_bars, src, lock)
        refresh_stock_meta(conn, code, name, market, board, src, 'ok', '', lock)
        return ('ok', len(new_bars), '')
    except Exception as e:                             # noqa: BLE001
        return ('failed', 0, f'{type(e).__name__}: {e}')


def run(args):
    db_path = args.db or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                      'data', DEFAULT_DB_NAME)
    conn = open_db(db_path)
    lock = threading.Lock()
    run_id = now_cst().strftime('%Y%m%d-%H%M%S')

    log(f'数据库: {db_path}')

    if args.stats:
        print_stats(conn)
        return 0

    # 1) 股票池
    if args.codes:
        universe = [(c.strip(), '', 'SH' if c.startswith('6') else 'SZ', '')
                    for c in args.codes.split(',') if c.strip()]
        log(f'指定代码 {len(universe)} 只')
    else:
        log('拉取沪深全市场股票池（东财 clist）...')
        universe = fetch_universe()
        log(f'股票池 {len(universe)} 只')

    # 断点续跑：只处理尚未成功入库的个股
    if args.pending_only:
        with lock:
            done_codes = {r[0] for r in conn.execute(
                "SELECT code FROM stocks WHERE status='ok'")}
        before = len(universe)
        universe = [it for it in universe if it[0] not in done_codes]
        log(f'仅跑未完成：跳过已入库 {before - len(universe)} 只，待处理 {len(universe)} 只')

    if args.limit:
        universe = universe[:args.limit]
        log(f'限制本次处理 {len(universe)} 只')

    counter = Counter()
    started = time.time()

    def worker(item):
        code, name, market, board = item
        if args.delay:
            time.sleep(args.delay * (hash(code) % 100) / 100.0)
        status, bars, msg = process_one(args, conn, lock, counter, run_id,
                                        code, name, market, board)
        write_log(conn, run_id, code, status, bars, args.source, msg, lock)
        if status == 'ok':
            counter.add(ok=1, bars=bars)
        elif status in ('insufficient', 'empty', 'failed'):
            counter.add(fail=1)
        else:
            counter.add(skip=1)
        # 批量提交：既保证崩溃只回退少量，又避免每只 3 次 fsync
        with lock:
            worker.n += 1
            if worker.n % args.commit_every == 0:
                conn.commit()
        return status

    worker.n = 0

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = [ex.submit(worker, it) for it in universe]
        done = 0
        for f in as_completed(futures):
            f.result()
            done += 1
            if done % 500 == 0 or done == len(universe):
                elapsed = time.time() - started
                speed = done / elapsed if elapsed > 0 else 0
                eta = (len(universe) - done) / speed if speed else 0
                log(f'进度 {done}/{len(universe)}  成功{counter.ok} 无新增{counter.skip} '
                    f'异常{counter.fail}  {speed:.1f} 只/秒  预计剩余 {eta/60:.1f} 分钟')
    with lock:
        conn.commit()

    conn.execute('PRAGMA optimize')
    conn.commit()
    elapsed = time.time() - started
    log(f'完成：成功 {counter.ok} / 跳过(无新增或不足) {counter.skip + counter.fail} '
        f'  新增写入 {counter.bars:,} 根  用时 {elapsed/60:.1f} 分钟')
    print_stats(conn)
    conn.close()
    return 0


def check_tdx(tdx_root, min_bars=250):
    """检查通达信本地数据完整度：多少只已覆盖起始年份、多少只够 min_bars"""
    import glob
    import struct as _s
    files = []
    for mkt in ('sh', 'sz'):
        files += glob.glob(os.path.join(tdx_root, mkt, 'lday', f'{mkt}*.day'))
    total = enough = old_enough = 0
    latest = ''
    bars_list = []
    for path in files:
        code = os.path.basename(path)[2:8]
        if not CODE_RE.match(code):
            continue
        total += 1
        size = os.path.getsize(path)
        bars = size // 32
        bars_list.append(bars)
        if bars >= min_bars:
            enough += 1
        try:
            # 只读首/末各 32 字节，避免整文件 IO（9000 个文件累计可达数 GB）
            with open(path, 'rb') as f:
                first = str(_s.unpack_from('<I', f.read(32), 0)[0])
                f.seek(-32, os.SEEK_END)
                last = str(_s.unpack_from('<I', f.read(32), 0)[0])
            if len(first) == 8 and first <= '20010101':
                old_enough += 1
            if len(last) == 8:
                latest = max(latest, f'{last[:4]}-{last[4:6]}-{last[6:]}')
        except Exception:                              # noqa: BLE001
            pass
    print('\n' + '=' * 60)
    print(f'通达信本地数据检查：{tdx_root}')
    print('=' * 60)
    print(f'  沪深 A 股文件数        {total}')
    print(f'  达到 {min_bars} 根的        {enough}')
    print(f'  已回溯到 2001 年前的    {old_enough}')
    print(f'  平均根数               {sum(bars_list) // max(1, len(bars_list))}')
    print(f'  最新日期               {latest}')
    done = old_enough >= total * 0.9 if total else False
    print(f'  结论                   {"历史数据已就绪，可全量导入" if done else "仍在下载，建议完成后再导入"}')
    print('=' * 60 + '\n')
    return 0 if done else 1


def print_stats(conn):
    print('\n' + '=' * 60)
    print('数据库统计')
    print('=' * 60)
    for label, sql in [
        ('个股总数', 'SELECT COUNT(*) FROM stocks'),
        ('合格个股(status=ok)', "SELECT COUNT(*) FROM stocks WHERE status='ok'"),
        ('日K总行数', 'SELECT COUNT(*) FROM kline'),
        ('覆盖交易日数', 'SELECT COUNT(DISTINCT date) FROM kline'),
        ('最早日期', 'SELECT MIN(date) FROM kline'),
        ('最新日期', 'SELECT MAX(date) FROM kline'),
        ('有成交额的行', 'SELECT COUNT(*) FROM kline WHERE amount IS NOT NULL'),
        ('有换手率的行', 'SELECT COUNT(*) FROM kline WHERE turnover IS NOT NULL'),
        ('有前复权的行', 'SELECT COUNT(*) FROM kline WHERE close_qfq IS NOT NULL'),
    ]:
        try:
            val = conn.execute(sql).fetchone()[0]
        except Exception:                              # noqa: BLE001
            val = '-'
        print(f'  {label:<22} {val}')
    print('\n  按板块分布:')
    for market, board, cnt, first in conn.execute(
            'SELECT market,board,COUNT(*),MIN(first_date) FROM stocks '
            "WHERE status='ok' GROUP BY market,board ORDER BY market,board"):
        print(f'    {market} {board:<6} {cnt:>5} 只   最早 {first}')
    print('\n  根数最少/最多（合格个股）:')
    row = conn.execute('SELECT MIN(bar_count),MAX(bar_count),AVG(bar_count) FROM stocks '
                       "WHERE status='ok'").fetchone()
    if row and row[0] is not None:
        print(f'    最少 {row[0]}  最多 {row[1]}  平均 {row[2]:.0f}')
    print('=' * 60 + '\n')


def main():
    p = argparse.ArgumentParser(
        description='全市场沪深 A 股日 K 抓取工具（写入 kline-full.db，供回测）',
        formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    p.add_argument('--db', help='SQLite 路径（默认 data/kline-full.db）')
    p.add_argument('--source', default='sohu', choices=['sohu', 'sina', 'tdx'],
                   help='主数据源：sohu 全历史(默认) / sina 6000根 / tdx 通达信本地')
    p.add_argument('--start', default='2000-01-01', help='数据起始日期')
    p.add_argument('--min-bars', type=int, default=250, help='少于该根数的个股不入库')
    p.add_argument('--workers', type=int, default=24, help='并发线程数')
    p.add_argument('--delay', type=float, default=0.15, help='每线程请求打散延迟(秒)')
    p.add_argument('--commit-every', type=int, default=50, help='每 N 只批量提交一次')
    p.add_argument('--pending-only', action='store_true',
                   help='只处理尚未成功入库的个股（断点续跑）')
    p.add_argument('--limit', type=int, default=0, help='只处理前 N 只（调试用）')
    p.add_argument('--codes', help='只处理指定代码，逗号分隔，如 600519,000001')
    p.add_argument('--full', action='store_true', help='强制全量重抓（忽略已有数据）')
    p.add_argument('--qfq', dest='qfq', action='store_true', default=True,
                   help='补充腾讯前复权价（*_qfq 列）')
    p.add_argument('--no-qfq', dest='qfq', action='store_false', help='不取前复权')
    p.add_argument('--qfq-bars', type=int, default=800, help='前复权补充根数（腾讯上限约800）')
    p.add_argument('--sina-count', type=int, default=6000, help='新浪单次取数根数')
    p.add_argument('--tdx-root', default=DEFAULT_TDX_ROOT, help='通达信 vipdoc 目录')
    p.add_argument('--stats', action='store_true', help='只打印库统计后退出')
    p.add_argument('--check-tdx', action='store_true',
                   help='只检查通达信本地数据完整度后退出')
    args = p.parse_args()
    try:
        if args.check_tdx:
            return check_tdx(args.tdx_root, args.min_bars)
        return run(args)
    except KeyboardInterrupt:
        log('已中断（已写入部分保留，下次运行自动续跑）')
        return 130


if __name__ == '__main__':
    sys.exit(main())
