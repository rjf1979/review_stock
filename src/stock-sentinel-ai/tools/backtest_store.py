#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""尾盘买入回测结果入库（智诊盯盘）。

把已有回测产物统一写入 ``data/backtest.db``（Python 独占写），并输出实盘凭据表
``bt_decision`` 的 DDL（由 App 迁移落到 ``data/kline.db``）。

* ``data/kline.db`` 是 sql.js 全量导出式内存库，禁止本脚本直连写入；
* 回测数据一律落在 ``data/backtest.db``（WAL）；
* 设计文档：``docs/2026-09-21-回测结果入库表结构与字段字典.md``
* 表结构定义：``tools/bt_schema.py``
* 多周期形态：``tools/tf_patterns.py``

常用命令::

    python tools\\backtest_store.py --init
    python tools\\backtest_store.py --check
    python tools\\backtest_store.py --import-daily
    python tools\\backtest_store.py --import-minute
    python tools\\backtest_store.py --import-grid
    python tools\\backtest_store.py --import-market [--max-stocks N]
    python tools\\backtest_store.py --link
    python tools\\backtest_store.py --verify
    python tools\\backtest_store.py --emit-decision-ddl
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import sqlite3
import sys
import time
from datetime import datetime

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..'))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bt_schema                                    # noqa: E402
import tf_patterns as tfp                           # noqa: E402

# ---------------------------------------------------------------- 常量
DATA = os.path.join(ROOT, 'data')
DEFAULT_DB = bt_schema.DEFAULT_DB                # data/backtest.db
KLINE_DB = bt_schema.KLINE_DB                    # data/kline.db
BT_DIR = os.path.join(DATA, 'backtest')
DAILY_DIR = os.path.join(BT_DIR, 'late-buy-next-morning-stock-only')
MINUTE_DIR = os.path.join(BT_DIR, 'late-buy-next-morning-minute-stock-only')
GRID_DIR = os.path.join(BT_DIR, 'late-buy-time-grid')
SNAP_DIR = os.path.join(DATA, 'snapshots')
COV = {1: os.path.join(BT_DIR, 'minute_coverage_1m.json'),
       5: os.path.join(BT_DIR, 'minute_coverage_5m.json')}
DECISION_DDL_PATH = os.path.join(BT_DIR, 'bt_decision.sql')
TF_DIR = os.path.join(BT_DIR, 'late-buy-next-morning-tf')

MARKET_START = 20180101        # 市场温度起始日（日线口径）
DAILY_BASE_HIT3 = 21.15        # 日线全样本 ≥+3% 基准（%）—— v2 特征口径（gbbq 时点换手率 + 触板修正）
DAILY_SAMPLE_N = 5429008       # 日线批次有效样本笔数（v2）
MINUTE_BASE_HIT3 = 22.13       # 分钟精确全样本 ≥+3% 基准（%）
GRID_BASE_HIT3 = 7.49          # 网格样本内最优 ≥+3%（%）仅用于对照

RUN_DAILY = 'daily-20210104-20260917-stockonly-d1'
RUN_MINUTE = 'minute-20260612-20260917-stockonly-d1'
RUN_GRID = 'grid-20260615-20260918-stockonly-d1'
RUN_TF = 'tf-20260612-20260917-stockonly-d1'

# ---- 14:40 分时反推批次（2026-09-21 新口径，当前唯一入库批次）----
REVERSE_DIR = os.path.join(BT_DIR, 'minute-reverse')
REVERSE_SAMPLES = os.path.join(REVERSE_DIR, 'samples.csv')
REVERSE_MODEL_PATH = os.path.join(REVERSE_DIR, 'reverse_model.json')
REVERSE_EXTRACT_META = os.path.join(REVERSE_DIR, 'extract_meta.json')
RUN_REVERSE = 'reverse-20260612-20260917-stockonly-t1440'
REVERSE_MODEL_VERSION = 'minute-reverse-v1'
REVERSE_BASE_HIT3 = 20.081     # 反推全样本 T+1 09:31~10:30 最高涨幅 ≥+3% 基准（%）
REVERSE_BASE_HIT5 = 8.496      # 同上 ≥+5% 基准（%）
REVERSE_SAMPLE_N = 298294      # 反推批次有效样本笔数

ENGINE_VERSION = bt_schema.SCHEMA_VERSION
GENERATOR = bt_schema.GENERATOR

META_NOTE = (
    '回测口径：T 日 14:40 买入（1 分钟收盘价）、T+1 09:31~10:30 卖出窗口；'
    '只含 A 股个股，已剔除银行股、退市股、B 股、ST、科创板、北交所；'
    '标签为「T+1 09:31~10:30 窗口最高涨幅 ≥ X%」，先按标签切样本再反推 T 日尾盘分时；'
    '特征集已剔除全部形态字段，概念题材本期未接入。'
)

REVERSE_NOTE = (
    '14:40 分时反推批次：样本 298,294 笔 / 4,337 只 / 69 个交易日（20260612~20260917）；'
    '无形态特征｜最高十分位样本外策略均值 −0.253%｜未扩窗复核前 usableForDecision=0，'
    '不得作为实盘下单依据。'
)

GLOBAL_CAVEATS = [
    '退市股按 .day 最后交易日剔除（整只剔除，命中率偏乐观）。',
    '名称取自通达信 hq_cache/{shs,szs}.tnf；ST 判定用当前名称回看历史，存在成分漂移。',
    '窗口仅 69 个交易日（20260612~20260917）且落在 2026 年同一段行情，不能外推。',
    '换手率/流通市值走 gbbq 权益事件按买入日时点推导，已消除送转/增发造成的前视。',
    '命中率 ≠ 期望收益：最高十分位样本外策略均值 −0.253%，扣成本后不可直接落地。',
]


# ---------------------------------------------------------------- 小工具
def now_iso() -> str:
    return datetime.now().strftime('%Y-%m-%dT%H:%M:%S')


def connect(path: str = DEFAULT_DB) -> sqlite3.Connection:
    """独占写连接（WAL + NORMAL）。"""
    d = os.path.dirname(os.path.abspath(path))
    if d:
        os.makedirs(d, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA synchronous=NORMAL')
    conn.execute('PRAGMA temp_store=MEMORY')
    conn.execute('PRAGMA cache_size=-262144')
    conn.execute('PRAGMA busy_timeout=30000')
    return conn


def read_csv_rows(path: str) -> list[dict]:
    if not os.path.exists(path):
        return []
    with open(path, 'r', encoding='utf-8-sig', newline='') as f:
        return list(csv.DictReader(f))


def fnum(v):
    """宽松浮点解析；空 / nan / inf → None。"""
    if v is None:
        return None
    s = str(v).strip()
    if s == '' or s.lower() in ('nan', 'none', 'null'):
        return None
    try:
        x = float(s)
    except ValueError:
        return None
    return None if (math.isnan(x) or math.isinf(x)) else x


def inum(v):
    x = fnum(v)
    return None if x is None else int(round(x))


def bnum(v):
    """布尔解析：True/False/1/0/是/否。"""
    if v is None:
        return 0
    s = str(v).strip().lower()
    if s in ('true', '1', 'yes', 'y', '是'):
        return 1
    if s in ('false', '0', 'no', 'n', '否', ''):
        return 0
    x = fnum(v)
    return 0 if x is None else int(x != 0)


def ymd(v) -> int | None:
    if v is None:
        return None
    s = str(v).strip().replace('-', '').replace('/', '')
    if not s or not s.isdigit():
        return None
    return int(s)


def load_json(path: str):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def ci95(hit_pct, n):
    """命中率的 95% 置信区间（正态近似，百分比口径）。"""
    if not n or n <= 0 or hit_pct is None:
        return None, None
    p = min(max(hit_pct / 100.0, 0.0), 1.0)
    se = math.sqrt(max(p * (1.0 - p), 1e-12) / n)
    return (round(max(0.0, p - 1.96 * se) * 100, 4),
            round(min(1.0, p + 1.96 * se) * 100, 4))


def snapshot_records():
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
            data = load_json(os.path.join(SNAP_DIR, fn))
        except (OSError, ValueError):
            continue
        for rec in data.get('records') or []:
            code = str(rec.get('code') or '')
            if not code:
                continue
            out[code] = {
                'name': str(rec.get('name') or ''),
                'price': fnum(rec.get('price')) or 0.0,
                'turnover': fnum(rec.get('turnover')),
                'volumeRatio': fnum(rec.get('volumeRatio')),
                'amount': fnum(rec.get('amount')) or 0.0,
                'floatMcap': fnum(rec.get('floatMcap')) or 0.0,
                'totalMcap': fnum(rec.get('totalMcap')) or 0.0,
            }
    return out, latest


def float_shares_wan(snap: dict | None) -> float | None:
    """（旧口径，仅兜底）流通股本（万股）≈ 快照流通市值 / 快照现价 / 1e4。

    2026-09-21 起换手率主口径改为 ``float_shares.ShareBook`` 的 **买入日时点**
    gbbq 股本事件推导，本函数只在 CSV 缺新列时兜底。
    """
    if not snap:
        return None
    p = snap.get('price') or 0.0
    mc = snap.get('floatMcap') or 0.0
    if p <= 0 or mc <= 0:
        return None
    return round(mc / p / 1e4, 4)


def hhmm(v) -> int | None:
    """'14:30' → 1430；已是整数则原样返回。"""
    if v is None:
        return None
    if isinstance(v, (int, np.integer)):
        return int(v)
    s = str(v).strip()
    if ':' in s:
        a, b = s.split(':')[:2]
        return int(a) * 100 + int(b)
    x = fnum(s)
    return None if x is None else int(x)


def js(obj) -> str | None:
    if obj is None:
        return None
    return json.dumps(obj, ensure_ascii=False, separators=(',', ':'))


def log(msg: str) -> None:
    print(f'[{datetime.now().strftime("%H:%M:%S")}] {msg}', flush=True)


# ---------------------------------------------------------------- 元数据
def dataset_rows() -> list[dict]:
    """bt_dataset：日线 + 5 个分钟周期。"""
    built = now_iso()
    rows: list[dict] = []
    cov1 = load_json(COV[1]) if os.path.exists(COV[1]) else {}
    cov5 = load_json(COV[5]) if os.path.exists(COV[5]) else {}
    rows.append({
        'datasetId': 'kline_day', 'kind': 'day', 'freqMin': None,
        'source': '通达信 lday（D:\\new_tdx\\{sh,sz}\\lday）+ kline-full.db 复权因子',
        'dateMin': 19901219, 'dateMax': 20260918,
        'tradingDays': None, 'codeCount': None, 'barsPerCode': None,
        'missingNote': '个股日线含上市至 2026-09-18 的全历史（不等长）',
        'builtAt': built,
    })
    for freq, cov in ((1, cov1), (5, cov5)):
        days = int(cov.get('distinct_days') or 0)
        codes = int(cov.get('ok') or cov.get('total_codes') or 0)
        if freq == 1:
            src = '通达信本地 .lc1（D:\\new_tdx\\vipdoc\\{sh,sz}\\minline）'
        else:
            src = '通达信本地 .lc5（D:\\new_tdx\\vipdoc\\{sh,sz}\\fzline）'
        rows.append({
            'datasetId': f'minute_{freq}m', 'kind': 'minute', 'freqMin': freq,
            'source': src,
            'dateMin': int(cov.get('date_min') or 0), 'dateMax': int(cov.get('date_max') or 0),
            'tradingDays': days, 'codeCount': codes,
            'barsPerCode': days * (240 if freq == 1 else 48),
            'missingNote': f'覆盖校验 failed={cov.get("failed", "?")}，窗口仅 {days} 个交易日',
            'builtAt': built,
        })
    for freq in (15, 30, 60):
        days = int(cov1.get('distinct_days') or 0)
        rows.append({
            'datasetId': f'minute_{freq}m', 'kind': 'minute', 'freqMin': freq,
            'source': '由 minute_1m 现场聚合（不落盘，逐根与原生 .lc5 校验一致）',
            'dateMin': int(cov1.get('date_min') or 0), 'dateMax': int(cov1.get('date_max') or 0),
            'tradingDays': days, 'codeCount': int(cov1.get('ok') or 0),
            'barsPerCode': days * (240 // freq),
            'missingNote': f'{freq} 分钟由 1 分钟聚合；60 分钟 ma60 需 15 日预热',
            'builtAt': built,
        })
    return rows


def legacy_run_defs() -> list[dict]:
    """旧口径批次定义（日线近似 / 分钟精确 / 时间网格 / 多周期形态）。

    2026-09-21 起旧口径回测结果已从库中清出，本函数只保留定义用于「需要时重新导入」：
    ``--import-daily`` / ``--import-minute`` / ``--import-grid`` / ``--import-tf``
    会先调用 :func:`ensure_run` 把对应批次行补回，再按磁盘产物重新导入。
    """
    created = now_iso()
    common = dict(priceMode='qfq-adjust', costBps=15.0,
                  universeFilter='A股个股（剔除银行/退市/B股/ST/科创板/北交所）',
                  excludeIndustry='银行', keepDelisted=0,
                  exclude='银行股、退市股、B 股、ST、科创板、北交所')
    return [
        dict(runKey=RUN_DAILY, createdAt=created, engineVersion=ENGINE_VERSION,
             priceMode=common['priceMode'], buyTime=1430, sellTimeStart=930, sellTimeEnd=1000,
             costBps=common['costBps'], universeFilter=common['universeFilter'],
             excludeIndustry=common['excludeIndustry'], keepDelisted=0,
             paramsJson=js({
                 'generator': 'tools/late_buy_next_morning.py',
                 'artifact': 'data/backtest/late-buy-next-morning-stock-only',
                 'trades': DAILY_SAMPLE_N, 'dates': '2021-01-04~2026-09-17', 'nDates': 1382,
                 'entryPrice': 'T 日收盘价（14:30 的日线近似）',
                 'sellPrice': 'T+1 开盘价（ret_high 用 T+1 早盘最高价）',
                 'detailSample': 'trade_sample.csv（10.8 万笔分层抽样）已入库',
                 'baseHit3Pct': DAILY_BASE_HIT3,
                 'exclude': common['exclude'],
             }),
             tradeCount=DAILY_SAMPLE_N,
             note='日线近似口径：全历史大样本，≥3% 命中率是上界（高估约 4pp）。'),
        dict(runKey=RUN_MINUTE, createdAt=created, engineVersion=ENGINE_VERSION,
             priceMode=common['priceMode'], buyTime=1430, sellTimeStart=930, sellTimeEnd=1000,
             costBps=common['costBps'], universeFilter=common['universeFilter'],
             excludeIndustry=common['excludeIndustry'], keepDelisted=0,
             paramsJson=js({
                 'generator': 'tools/late_buy_next_morning_minute.py',
                 'artifact': 'data/backtest/late-buy-next-morning-minute-stock-only',
                 'trades': 292685, 'dates': '2026-06-12~2026-09-17', 'nDates': 69,
                 'entryPrice': 'T 日 14:30 分钟线收盘价（真实）',
                 'sellPrice': 'T+1 09:31 开盘价（集合竞价）；早盘最高 = 09:31~11:30 最高',
                 'baseHit3Pct': MINUTE_BASE_HIT3,
                 'exclude': common['exclude'],
             }),
             tradeCount=292685,
             note='分钟精确口径：窗口仅 69 个交易日且落在 2026 强势段，只能做逐月检验。'),
        dict(runKey=RUN_GRID, createdAt=created, engineVersion=ENGINE_VERSION,
             priceMode=common['priceMode'], buyTime=1430, sellTimeStart=930, sellTimeEnd=1000,
             costBps=common['costBps'], universeFilter=common['universeFilter'],
             excludeIndustry=common['excludeIndustry'], keepDelisted=0,
             paramsJson=js({
                 'generator': 'tools/late_buy_time_grid.py',
                 'artifact': 'data/backtest/late-buy-time-grid',
                 'trades': 292685, 'buyGrid': '14:30~14:55', 'sellGrid': '09:30~10:00',
                 'combos': 806,
                 'bestInSample': '14:39→09:56 (+0.0355%)',
                 'refPairs': '1430→0930 -0.1295% / 1430→1000 -0.0328%',
                 'warning': '全样本最优为样本内优，逐月最优方向不一致，不可实盘直接引用',
                 'exclude': common['exclude'],
             }),
             tradeCount=292685,
             note='时间网格：用于确定买入/卖出的合理时点，结论仅作参考。'),
        dict(runKey=RUN_TF, createdAt=created, engineVersion=ENGINE_VERSION,
             priceMode=common['priceMode'], buyTime=1430, sellTimeStart=930, sellTimeEnd=1000,
             costBps=common['costBps'], universeFilter=common['universeFilter'],
             excludeIndustry=common['excludeIndustry'], keepDelisted=0,
             paramsJson=js({
                 'generator': 'tools/late_buy_next_morning_tf.py',
                 'artifact': 'data/backtest/late-buy-next-morning-tf',
                 'trades': 292685, 'dates': '2026-06-12~2026-09-17', 'nDates': 69,
                 'entryPrice': 'T 日 14:30 分钟线收盘价（真实）',
                 'sellPrice': 'T+1 09:31 开盘价（集合竞价）；早盘最高 = 09:31~11:30 最高',
                 'sampleRule': '与 minutes 口径逐笔一致（292,685 笔），仅追加多周期形态快照',
                 'turnoverSource': '截至 14:30 的分钟成交量 ÷ 买入日时点流通股本（gbbq 权益事件推导，无前视）',
                 'extraWarmup': '60 分钟 ma60 需 15 个交易日预热，有效样本自 2026-07-03 起约 55 日',
                 'baseHit3Pct': MINUTE_BASE_HIT3,
                 'exclude': common['exclude'],
             }),
             tradeCount=292685,
             note='多周期形态快照（5/15/30/60 分钟）+ 逐笔明细；分钟窗口仅 69 日且落在强势段，'
                  'usableForDecision=0，不可直接用于实盘决策。'),
    ]


def reverse_run_def() -> dict:
    """bt_run：14:40 分时反推批次（当前唯一入库批次）。"""
    created = now_iso()
    meta = load_json(REVERSE_EXTRACT_META) if os.path.exists(REVERSE_EXTRACT_META) else {}
    model = load_json(REVERSE_MODEL_PATH) if os.path.exists(REVERSE_MODEL_PATH) else {}
    base = (model or {}).get('base') or {}
    params = {
        'generator': meta.get('generator', 'tools/minute_reverse_backtest.py'),
        'analyzer': 'tools/minute_reverse_analyze.py',
        'artifact': 'data/backtest/minute-reverse',
        'samplesCsv': 'data/backtest/minute-reverse/samples.csv',
        'modelFile': 'data/backtest/minute-reverse/reverse_model.json',
        'modelVersion': (model or {}).get('version', REVERSE_MODEL_VERSION),
        'entryTime': 1440, 'entryPrice': 'T 日 14:40 一分钟收盘价（不复权）',
        'label': 'T+1 09:31~10:30 窗口最高涨幅 ≥+3%',
        'labelWindows': '主口径 09:31~10:30；对照 09:31~10:00 / 09:31~11:30 / 全天',
        'sellRule': '触及 +3% 止盈，否则 10:30 收盘卖出',
        'costBps': 15.0, 'trades': REVERSE_SAMPLE_N,
        'dates': '2026-06-12~2026-09-17', 'nDates': int(base.get('days') or 69),
        'codes': int(base.get('codes') or 0),
        'features': 'T 日 ≤14:40 分时 + T-1 日线（含 5/10/20/60/120 日乖离数值）+ T-1 市场/板块温度；无形态字段',
        'lookahead': '分时只用 ≤14:40；日线指标 T-1；市场/板块上下文 T-1',
        'baseHit3Pct': REVERSE_BASE_HIT3, 'baseHit5Pct': REVERSE_BASE_HIT5,
        'skipped': meta.get('skipped') or {},
        'exclude': meta.get('exclude', '银行股、退市股、B 股、ST；科创板排除'),
        'usableForDecision': 0,
        'warning': '仅 69 日同一段行情；最高十分位样本外策略均值 −0.253%，未扩窗复核前不可作实盘下单依据',
    }
    return dict(
        runKey=RUN_REVERSE, createdAt=created, engineVersion=ENGINE_VERSION,
        priceMode='raw-minute', buyTime=1440, sellTimeStart=931, sellTimeEnd=1030,
        costBps=15.0,
        universeFilter='A股个股（剔除银行/退市/B股/ST/科创板/北交所）',
        excludeIndustry='银行', keepDelisted=0,
        paramsJson=js(params), tradeCount=REVERSE_SAMPLE_N, note=REVERSE_NOTE)


def run_defs() -> list[dict]:
    """bt_run：入库批次。当前只写 14:40 分时反推批次。"""
    return [reverse_run_def()]


RUN_DEF_BUILDERS = {
    RUN_REVERSE: reverse_run_def,
}


def ensure_run(conn: sqlite3.Connection, run_key: str) -> None:
    """把某个批次定义补进 bt_run（幂等）：恢复旧口径导入前调用。"""
    if conn.execute('SELECT 1 FROM bt_run WHERE runKey=?', (run_key,)).fetchone():
        return
    defs = {d['runKey']: d for d in legacy_run_defs()}
    builder = RUN_DEF_BUILDERS.get(run_key)
    row = builder() if builder else defs.get(run_key)
    if row is None:
        raise SystemExit(f'未知 runKey={run_key}，无法补建 bt_run 行')
    insert_runs(conn, [row])
    log(f'bt_run 补建：{run_key}')


def insert_runs(conn: sqlite3.Connection, runs: list[dict]) -> None:
    conn.executemany(
        'INSERT INTO bt_run (runKey, createdAt, engineVersion, priceMode, buyTime, '
        'sellTimeStart, sellTimeEnd, costBps, universeFilter, excludeIndustry, '
        'keepDelisted, paramsJson, tradeCount, note) '
        'VALUES (:runKey,:createdAt,:engineVersion,:priceMode,:buyTime,:sellTimeStart,'
        ':sellTimeEnd,:costBps,:universeFilter,:excludeIndustry,:keepDelisted,'
        ':paramsJson,:tradeCount,:note) '
        'ON CONFLICT(runKey) DO UPDATE SET createdAt=excluded.createdAt,'
        'engineVersion=excluded.engineVersion, priceMode=excluded.priceMode,'
        'buyTime=excluded.buyTime, sellTimeStart=excluded.sellTimeStart,'
        'sellTimeEnd=excluded.sellTimeEnd, costBps=excluded.costBps,'
        'universeFilter=excluded.universeFilter, excludeIndustry=excluded.excludeIndustry,'
        'keepDelisted=excluded.keepDelisted, paramsJson=excluded.paramsJson,'
        'tradeCount=excluded.tradeCount, note=excluded.note', runs)


def do_init(conn: sqlite3.Connection) -> None:
    bt_schema.create_schema(conn)
    created = now_iso()
    cov1 = load_json(COV[1]) if os.path.exists(COV[1]) else {}
    meta_in = load_json(REVERSE_EXTRACT_META) if os.path.exists(REVERSE_EXTRACT_META) else {}
    model = load_json(REVERSE_MODEL_PATH) if os.path.exists(REVERSE_MODEL_PATH) else {}
    feats = ((model or {}).get('model') or {}).get('features') or []
    meta = [
        ('schemaVersion', bt_schema.SCHEMA_VERSION),
        ('createdAt', created),
        ('generator', GENERATOR),
        ('buyWindow', '1440'),
        ('sellWindow', '0931-1030'),
        ('tdxMinuteAsOfBars', '1440'),
        ('minuteWindow', f'{meta_in.get("dateMin", cov1.get("date_min", ""))}'
                         f'-{meta_in.get("dateMax", cov1.get("date_max", ""))}'),
        ('dayWindow', '19901219-20260918'),
        ('primaryRun', RUN_REVERSE),
        ('reverseModel', 'data/backtest/minute-reverse/reverse_model.json'),
        ('reverseModelVersion', (model or {}).get('version', REVERSE_MODEL_VERSION)),
        ('reverseSampleN', REVERSE_SAMPLE_N),
        ('reverseBaseHit3Pct', REVERSE_BASE_HIT3),
        ('reverseBaseHit5Pct', REVERSE_BASE_HIT5),
        ('reverseFeatureCnt', len(feats)),
        ('usableForDecision', 0),
        ('note', META_NOTE),
        ('reverseNote', REVERSE_NOTE),
        ('caveats', js(GLOBAL_CAVEATS)),
    ]
    conn.executemany(
        'INSERT INTO bt_meta (key, value, updatedAt) VALUES (?,?,?) '
        'ON CONFLICT(key) DO UPDATE SET value=excluded.value, updatedAt=excluded.updatedAt',
        [(k, str(v), created) for k, v in meta])

    conn.execute('DELETE FROM bt_dataset')
    rows = dataset_rows()
    conn.executemany(
        'INSERT INTO bt_dataset (datasetId, kind, freqMin, source, dateMin, dateMax, '
        'tradingDays, codeCount, barsPerCode, missingNote, builtAt) '
        'VALUES (:datasetId,:kind,:freqMin,:source,:dateMin,:dateMax,:tradingDays,'
        ':codeCount,:barsPerCode,:missingNote,:builtAt)', rows)

    pats = tfp.pattern_def_rows()
    conn.executemany(
        'INSERT INTO bt_pattern_def (patternId, nameCn, scope, periods, sourceModule, '
        'category, direction, weight, priority, bitIndex, ruleExpr, ruleParams, '
        'basisNote, version, usableForDecision, evidenceTradeCnt, evidenceHit3Pct, '
        'evidenceLift, evidenceYears, validatedAt) '
        'VALUES (:patternId,:nameCn,:scope,:periods,:sourceModule,:category,:direction,'
        ':weight,:priority,:bitIndex,:ruleExpr,:ruleParams,:basisNote,:version,'
        '0,NULL,NULL,NULL,NULL,NULL) '
        'ON CONFLICT(patternId) DO UPDATE SET nameCn=excluded.nameCn,'
        'scope=excluded.scope, periods=excluded.periods, category=excluded.category,'
        'direction=excluded.direction, priority=excluded.priority,'
        'bitIndex=excluded.bitIndex, ruleExpr=excluded.ruleExpr,'
        'ruleParams=excluded.ruleParams, basisNote=excluded.basisNote,'
        'version=excluded.version', pats)

    feat_rows = bt_schema.feature_rows()
    conn.executemany(
        'INSERT INTO bt_feature_def (tableName, columnName, nameCn, meaning, unit, '
        'valueScope, source, calcRule, isFeature) VALUES (?,?,?,?,?,?,?,?,?) '
        'ON CONFLICT(tableName, columnName) DO UPDATE SET nameCn=excluded.nameCn,'
        'meaning=excluded.meaning, unit=excluded.unit, valueScope=excluded.valueScope,'
        'source=excluded.source, calcRule=excluded.calcRule, isFeature=excluded.isFeature',
        feat_rows)

    insert_runs(conn, run_defs())

    # bt_reverse_feature：minute-reverse-v1 实际进入模型的特征登记
    conn.execute('DELETE FROM bt_reverse_feature')
    conn.executemany(
        'INSERT INTO bt_reverse_feature (featureKey, nameCn, unit, kind, sourceColumn, '
        'inModel, note) VALUES (:featureKey,:nameCn,:unit,:kind,:sourceColumn,1,:note) '
        'ON CONFLICT(featureKey) DO UPDATE SET nameCn=excluded.nameCn, unit=excluded.unit,'
        'kind=excluded.kind, sourceColumn=excluded.sourceColumn, inModel=excluded.inModel,'
        'note=excluded.note',
        [dict(featureKey=str(f.get('key') or ''),
              nameCn=str(f.get('cn') or ''),
              unit=str(f.get('unit') or ''),
              kind=str(f.get('kind') or 'num'),
              sourceColumn=str(f.get('key') or ''),
              note=f'{REVERSE_MODEL_VERSION} 模型特征；来源列同 bt_reverse_sample')
         for f in feats])
    conn.commit()


def table_counts(conn: sqlite3.Connection) -> dict[str, int]:
    out: dict[str, int] = {}
    for (name,) in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'bt_%' "
            'ORDER BY name'):
        out[name] = int(conn.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0])
    return out


def table_exists(conn: sqlite3.Connection, name: str) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
                        (name,)).fetchone() is not None


def run_id(conn: sqlite3.Connection, run_key: str) -> int:
    row = conn.execute('SELECT runId FROM bt_run WHERE runKey=?', (run_key,)).fetchone()
    if row is None:
        raise SystemExit(f'bt_run 缺少 runKey={run_key}，请先执行 --init')
    return int(row[0])


# ---------------------------------------------------------------- bt_stat
BUCKET_FILES = [
    ('bucket_overall.csv', 'overall'),
    ('bucket_year.csv', 'year'),
    ('bucket_board.csv', 'board'),
    ('bucket_hy.csv', 'industry'),
    ('bucket_hy_pct.csv', 'hy_pct'),
    ('bucket_hy_ret5.csv', 'hy_ret5'),
    ('bucket_hy_ret20.csv', 'hy_ret20'),
    ('bucket_amp.csv', 'amp'),
    ('bucket_amount_wan.csv', 'amount'),
    ('bucket_float_mcap_yi.csv', 'float_mcap'),
    ('bucket_pct.csv', 'pct'),
    ('bucket_close_pos.csv', 'close_pos'),
    ('bucket_bias20.csv', 'bias20'),
    ('bucket_rsi14.csv', 'rsi14'),
    ('bucket_vol_ratio.csv', 'vol_ratio'),
    ('bucket_ret5.csv', 'ret5'),
    ('bucket_ret20.csv', 'ret20'),
    ('bucket_ret60.csv', 'ret60'),
    ('bucket_dist_hh20.csv', 'dist_hh20'),
    ('bucket_list_days.csv', 'list_days'),
    ('bucket_flag.csv', 'flag'),
    ('bucket_bench_pct.csv', 'bench_pct'),
]

# 日线批次额外分档：形态位置三列由 tools/day_shape_scan.py 生成（抽样本 2%）
DAILY_EXTRA_FILES = [
    ('bucket_day_shape.csv', 'day_shape'),
    ('bucket_channel.csv', 'channel'),
    ('bucket_pos120.csv', 'pos120'),
]

# 这三个维度在日线批次里只覆盖 2% 抽样本，备注必须写明，避免与全样本维度混淆
DAILY_DIM_NOTES = {
    'day_shape': '日线均线形态位置（互斥 6 类：上升通道/下降通道/高位横盘/探底形态/'
                 '波动回踩/震荡形态）｜来源：tools/day_shape_scan.py 的日线批次抽样本',
    'channel': '日线通道类型（up/down/box/na）｜来源：日线批次抽样本',
    'pos120': '收盘在 120 日区间中的位置分桶｜来源：日线批次抽样本',
}

DIM_NOTES = {
    'overall': '全样本基准',
    'year': '逐年',
    'date': '逐日',
    'board': '上市板（深主板/创业板/…）',
    'industry': '通达信行业',
    'hy_pct': '所属行业当日涨幅分桶',
    'hy_ret5': '所属行业近 5 日涨幅分桶',
    'hy_ret20': '所属行业近 20 日涨幅分桶',
    'amp': '当日振幅分桶',
    'amount': '当日成交额分桶（万元）',
    'float_mcap': '流通市值分桶（亿元）',
    'pct': '当日涨幅分桶',
    'close_pos': '收盘位置分桶（收盘在当日区间的位置）',
    'bias20': '相对 20 日线乖离分桶',
    'rsi14': 'RSI14 分桶',
    'vol_ratio': '量比分桶（当日量 / 5 日均量）',
    'ret5': '近 5 日涨幅分桶',
    'ret20': '近 20 日涨幅分桶',
    'ret60': '近 60 日涨幅分桶',
    'dist_hh20': '距 20 日最高价距离分桶',
    'list_days': '上市天数分桶',
    'flag': 'T 日盘中触板标记',
    'bench_pct': '沪深300 当日涨幅分桶',
    'vs_daily': '分钟口径 vs 日线口径对照',
    'grid_month': '时间网格逐月结果（样本内）',
    'day_shape': '日线均线形态位置（互斥 6 类：上升通道/下降通道/高位横盘/探底形态/波动回踩/震荡形态）',
    'channel': '日线通道类型（20 根回归 R²≥0.5 判趋势方向，否则箱体：up/down/box/na）',
    'ma_align': '均线多头排列状态',
    'pos120': '收盘在 120 日通道中的位置分桶',
    'turnover': '换手率分桶（成交量 ÷ 买入日时点流通股本 gbbq_pit）',
    'vol_ratio_intraday': '日内量比分桶（截至 14:30 的分钟量 / 同期均量）',
    'atr': 'ATR14 波动率分桶',
    'tf5_pattern': '5 分钟线形态命中分桶（逐形态，可多命中）',
    'tf15_pattern': '15 分钟线形态命中分桶（逐形态，可多命中）',
    'tf30_pattern': '30 分钟线形态命中分桶（逐形态，可多命中）',
    'tf60_pattern': '60 分钟线形态命中分桶（逐形态，可多命中）',
    'tf5_primary': '5 分钟线主形态分桶（每笔取一个主形态，样本不重叠）',
    'tf15_primary': '15 分钟线主形态分桶（每笔取一个主形态，样本不重叠）',
    'tf30_primary': '30 分钟线主形态分桶（每笔取一个主形态，样本不重叠）',
    'tf60_primary': '60 分钟线主形态分桶（每笔取一个主形态，样本不重叠）',
    'tf_align': '多周期形态共振结论分桶（all_bull/partial/…）',
    'tf_align_score': '多周期共振得分分桶',
}

STAT_SQL = (
    'INSERT INTO bt_stat (runId, dimension, bucket, sampleCnt, hit1Pct, hit2Pct, '
    'hit3Pct, hit4Pct, hit5Pct, hit6Pct, hit7Pct, hit8Pct, hit9Pct, limitUpPct, '
    'retOpenMean, retHighMean, retCloseMean, stratMean, winRate, profitFactor, '
    'lift3, ci95Low, ci95High, byYearJson, stability, note) '
    'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
)


def stat_tuple(run_id_: int, dimension: str, row: dict, base_hit3: float,
               note: str = '') -> tuple:
    n = inum(row.get('n')) or 0
    hit3 = fnum(row.get('ge3_pct'))
    lift = round(hit3 / base_hit3, 4) if (hit3 is not None and base_hit3) else None
    lo, hi = ci95(hit3, n)
    stability = 'insufficient' if n < 1000 else 'unverified'
    return (run_id_, dimension, str(row.get('bucket') or ''), n,
            fnum(row.get('ge1_pct')), fnum(row.get('ge2_pct')), hit3,
            fnum(row.get('ge4_pct')), fnum(row.get('ge5_pct')), fnum(row.get('ge6_pct')),
            fnum(row.get('ge7_pct')), fnum(row.get('ge8_pct')), fnum(row.get('ge9_pct')),
            fnum(row.get('limit_pct')), fnum(row.get('avg_ret_open_pct')),
            fnum(row.get('avg_ret_high_pct')), fnum(row.get('avg_ret_close_pct')),
            fnum(row.get('avg_strat_ret_pct')), fnum(row.get('win_rate_true_pct')),
            fnum(row.get('profit_factor')), lift, lo, hi, None, stability,
            note or DIM_NOTES.get(dimension, ''))


def import_stats_from_dir(conn: sqlite3.Connection, rid: int, src_dir: str,
                          base_hit3: float, tag: str = '',
                          dim_notes: dict | None = None) -> int:
    """把 bucket_*.csv + by_date.csv + compare_vs_daily.csv 写入 bt_stat。

    ``dim_notes`` 可按维度覆盖 ``DIM_NOTES``（用于标注该维度的真实样本口径，
    例如日线批次的形态位置维度来自 2% 抽样本而非全样本）。
    """
    if not os.path.isdir(src_dir):
        log(f'跳过（目录不存在）：{src_dir}')
        return 0
    conn.execute('DELETE FROM bt_stat WHERE runId=?', (rid,))
    items = (list(BUCKET_FILES) + list(DAILY_EXTRA_FILES)
             + [('by_date.csv', 'date'), ('compare_vs_daily.csv', 'vs_daily')])
    total = 0
    for fn, dim in items:
        path = os.path.join(src_dir, fn)
        if not os.path.exists(path):
            continue
        rows = read_csv_rows(path)
        note = (dim_notes or {}).get(dim) or DIM_NOTES.get(dim, '')
        if tag:
            note = f'{tag}｜{note}' if note else tag
        tup = [stat_tuple(rid, dim, r, base_hit3, note) for r in rows if r.get('bucket')]
        if not tup:
            continue
        conn.executemany(STAT_SQL, tup)
        total += len(tup)
        log(f'  bt_stat[{dim:>10}] {len(tup):>6} 行  ← {fn}')
    conn.commit()
    return total


# 多周期批次的分档文件 → bt_stat 维度（与 tf_bucket_report.py 的输出一一对应）
TF_BUCKET_FILES = [
    ('bucket_year.csv', 'year'),
    ('bucket_board.csv', 'board'),
    ('bucket_hy.csv', 'industry'),
    ('bucket_amount_wan.csv', 'amount'),
    ('bucket_float_mcap_yi.csv', 'float_mcap'),
    ('bucket_atr_pct.csv', 'atr'),
    ('bucket_turnover.csv', 'turnover'),
    ('bucket_vol_ratio_intraday.csv', 'vol_ratio_intraday'),
    ('bucket_day_shape.csv', 'day_shape'),
    ('bucket_channel.csv', 'channel'),
    ('bucket_ma_align.csv', 'ma_align'),
    ('bucket_pos120.csv', 'pos120'),
    ('bucket_tf5.csv', 'tf5_pattern'),
    ('bucket_tf15.csv', 'tf15_pattern'),
    ('bucket_tf30.csv', 'tf30_pattern'),
    ('bucket_tf60.csv', 'tf60_pattern'),
    ('bucket_tf_align.csv', 'tf_align'),
    ('bucket_tf_align_score.csv', 'tf_align_score'),
]


def import_tf_stats(conn: sqlite3.Connection, rid: int, src_dir: str,
                    base_hit3: float) -> int:
    """把多周期批次的 bucket/主形态/共振分档 + summary.json 写入 bt_stat。

    与日线/分钟口径的区别：

    * ``bucket_tf{p}.csv`` 是**逐形态全命中**（一笔可进多桶）→ 维度 ``tf{p}_pattern``；
    * ``pattern_period.csv`` 是**每笔一个主形态**（样本不重叠）→ 维度 ``tf{p}_primary``；
      两者并存，前者回答"命中该形态时胜率多少"，后者回答"主形态是该形态时占多少样本"。
    """
    if not os.path.isdir(src_dir):
        log(f'跳过（目录不存在）：{src_dir}')
        return 0
    conn.execute('DELETE FROM bt_stat WHERE runId=?', (rid,))
    total = 0

    for fn, dim in TF_BUCKET_FILES:
        path = os.path.join(src_dir, fn)
        if not os.path.exists(path):
            continue
        rows = read_csv_rows(path)
        note = f'多周期（2026-06-12~2026-09-17，69 日）｜{DIM_NOTES.get(dim, "")}'
        tup = [stat_tuple(rid, dim, r, base_hit3, note) for r in rows if r.get('bucket')]
        if not tup:
            continue
        conn.executemany(STAT_SQL, tup)
        total += len(tup)
        log(f'  bt_stat[{dim:>18}] {len(tup):>6} 行  ← {fn}')

    # 主形态（pattern_period.csv：period × patternId）
    pp_path = os.path.join(src_dir, 'pattern_period.csv')
    if os.path.exists(pp_path):
        by_period: dict[str, list] = {}
        for r in read_csv_rows(pp_path):
            p = str(r.get('period') or '').strip()
            if not p or not r.get('bucket'):
                continue
            by_period.setdefault(p, []).append(r)
        for p, rows in sorted(by_period.items()):
            dim = f'tf{p}_primary'
            note = f'多周期（69 日）｜{p} 分钟线主形态（每笔取一个主形态，样本不重叠）'
            tup = [stat_tuple(rid, dim, r, base_hit3, note) for r in rows]
            conn.executemany(STAT_SQL, tup)
            total += len(tup)
            log(f'  bt_stat[{dim:>18}] {len(tup):>6} 行  ← pattern_period.csv(period={p})')

    # 全样本基准（summary.json）
    s_path = os.path.join(src_dir, 'summary.json')
    if os.path.exists(s_path):
        s = load_json(s_path)
        r = s.get('overall') if isinstance(s, dict) else None
        if isinstance(r, dict):
            row = dict(r)
            row['bucket'] = '全样本'
            conn.execute(STAT_SQL, stat_tuple(
                rid, 'overall', row, base_hit3,
                '多周期全样本基准（2026-06-12~2026-09-17，69 个买入日，292,685 笔）'))
            total += 1
            log('  bt_stat[           overall]      1 行  ← summary.json')

    conn.commit()
    return total


# ---------------------------------------------------------------- bt_trade 明细
TRADE_COLS = [
    'runId', 'code', 'name', 'board', 'date', 'entryTime', 'entryPrice', 'close',
    'pct', 'amp', 'closePos', 'upperShadow', 'lowerShadow', 'turnoverPct',
    'turnoverSrc', 'floatSharesWan', 'volRatio', 'volRatioIntraday', 'amountWan',
    'floatMcapYi', 'bias20', 'bias60', 'rsi14', 'atrPct', 'ret5', 'ret20', 'ret60',
    'distHh20', 'listDays', 'ma5Pos', 'ma10Pos', 'ma20Pos', 'ma60Pos', 'ma120Pos',
    'ma5Slope', 'ma10Slope', 'ma20Slope', 'ma60Slope', 'ma120Slope', 'maAlign',
    'dayPatterns', 'dayPatternMask', 'dayCategories', 'dayShape', 'pos120',
    'channelType', 'marketTemp', 'marketRegime', 'sectorPct', 'sectorRet5',
    'sectorRet20', 'sectorHeat', 'sectorUpRatio', 'sectorLimitUpCnt', 'conceptTags',
    'conceptHeat', 'benchPct', 'isLimitUp', 'touchedLimit', 'nextOpen', 'nextHigh',
    'nextClose', 'retOpen', 'retHigh', 'retClose', 'limitTouch', 'hit3', 'stratRet',
    'tf5Pattern', 'tf15Pattern', 'tf30Pattern', 'tf60Pattern', 'tf5Mask', 'tf15Mask',
    'tf30Mask', 'tf60Mask', 'tfAlign', 'tfAlignScore', 'tfCoverage', 'tfQuality',
    'createdAt',
]
assert len(TRADE_COLS) == 81, len(TRADE_COLS)

TRADE_SQL = ('INSERT INTO bt_trade (' + ','.join(TRADE_COLS) + ') VALUES ('
             + ','.join('?' * len(TRADE_COLS)) + ')')


def pct100(v):
    """小数比率 → 百分比（保留 4 位）。bt_trade 的收益/乖离/区间偏离列统一为 %。"""
    x = fnum(v)
    return None if x is None else round(x * 100.0, 4)


def daily_trade_row(row: dict, rid: int, snaps: dict, created: str) -> tuple:
    """日线 trade_sample.csv 单行 → bt_trade 元组。"""
    code = str(row.get('code') or '')
    snap = snaps.get(code) or {}
    fmy = fnum(row.get('float_mcap_yi'))
    amt = fnum(row.get('amount_wan'))
    # 换手率主口径：CSV 里的时点值（gbbq 股本推导）；缺失时回退快照反推近似
    turnover = fnum(row.get('turnover_pct'))
    fsw = fnum(row.get('float_shares_wan'))
    tsrc = str(row.get('float_shares_src') or '').strip()
    if turnover is None:
        if fmy and amt and fmy > 0:
            turnover = round(amt / (fmy * 100.0), 4)
            tsrc = tsrc or 'floatcap_approx'
    if not tsrc:
        tsrc = 'floatcap_approx'
    if fsw is None:
        fsw = float_shares_wan(snap)
    d = {
        'runId': rid, 'code': code, 'name': str(row.get('name') or ''),
        'board': str(row.get('board') or ''), 'date': ymd(row.get('date')),
        # 日线近似口径的「买入」实际是当日收盘价，因此 entryTime 记 1500（非尾盘 14:30）
        'entryTime': 1500, 'entryPrice': fnum(row.get('close')),
        'close': fnum(row.get('close')), 'pct': fnum(row.get('pct')),
        'amp': fnum(row.get('amp')), 'closePos': fnum(row.get('close_pos')),
        'upperShadow': fnum(row.get('upper_shadow')),
        'lowerShadow': fnum(row.get('lower_shadow')),
        'turnoverPct': turnover, 'turnoverSrc': tsrc,
        'floatSharesWan': fsw, 'volRatio': fnum(row.get('vol_ratio')),
        'volRatioIntraday': None, 'amountWan': amt, 'floatMcapYi': fmy,
        'bias20': pct100(row.get('bias20')), 'bias60': pct100(row.get('bias60')),
        'rsi14': fnum(row.get('rsi14')), 'atrPct': fnum(row.get('atr_pct')),
        'ret5': pct100(row.get('ret5')), 'ret20': pct100(row.get('ret20')),
        'ret60': pct100(row.get('ret60')), 'distHh20': pct100(row.get('dist_hh20')),
        'listDays': inum(row.get('list_days')),
        'ma5Pos': None, 'ma10Pos': None, 'ma20Pos': None, 'ma60Pos': None,
        'ma120Pos': None, 'ma5Slope': None, 'ma10Slope': None, 'ma20Slope': None,
        'ma60Slope': None, 'ma120Slope': None, 'maAlign': None,
        'dayPatterns': None, 'dayPatternMask': None, 'dayCategories': None,
        'dayShape': None, 'pos120': None, 'channelType': None,
        'marketTemp': None, 'marketRegime': None,
        'sectorPct': fnum(row.get('hy_pct')), 'sectorRet5': fnum(row.get('hy_ret5')),
        'sectorRet20': fnum(row.get('hy_ret20')), 'sectorHeat': None,
        'sectorUpRatio': None, 'sectorLimitUpCnt': None,
        'conceptTags': None, 'conceptHeat': None, 'benchPct': fnum(row.get('bench_pct')),
        'isLimitUp': bnum(row.get('is_limit_up')),
        'touchedLimit': bnum(row.get('touched_limit')),
        'nextOpen': fnum(row.get('next_open')), 'nextHigh': fnum(row.get('next_high')),
        'nextClose': fnum(row.get('next_close')), 'retOpen': pct100(row.get('ret_open')),
        'retHigh': pct100(row.get('ret_high')), 'retClose': pct100(row.get('ret_close')),
        'limitTouch': bnum(row.get('limit_touch')), 'hit3': bnum(row.get('hit3')),
        'stratRet': pct100(row.get('strat_ret')),
        'tf5Pattern': None, 'tf15Pattern': None, 'tf30Pattern': None,
        'tf60Pattern': None, 'tf5Mask': None, 'tf15Mask': None, 'tf30Mask': None,
        'tf60Mask': None, 'tfAlign': None, 'tfAlignScore': None, 'tfCoverage': None,
        'tfQuality': None, 'createdAt': created,
    }
    return tuple(d[c] for c in TRADE_COLS)


def import_daily_trades(conn: sqlite3.Connection, rid: int,
                        src_dir: str = DAILY_DIR, batch: int = 20000) -> int:
    path = os.path.join(src_dir, 'trade_sample.csv')
    if not os.path.exists(path):
        log(f'跳过（缺少 {path}）')
        return 0
    snaps, snap_date = snapshot_records()
    created = now_iso()
    conn.execute('DELETE FROM bt_trade WHERE runId=?', (rid,))
    conn.commit()
    n = 0
    tup: list[tuple] = []
    with open(path, 'r', encoding='utf-8-sig', newline='') as f:
        for row in csv.DictReader(f):
            tup.append(daily_trade_row(row, rid, snaps, created))
            if len(tup) >= batch:
                conn.executemany(TRADE_SQL, tup)
                n += len(tup)
                tup.clear()
                log(f'  bt_trade 日线明细 {n} 行')
    if tup:
        conn.executemany(TRADE_SQL, tup)
        n += len(tup)
    conn.commit()
    log(f'bt_trade 日线抽样本 {n} 行（快照 {snap_date}）')
    return n


# ---------------------------------------------------------------- bt_rule
def judge_rule(n: int, hit3, lift, years_hit: int, years_total: int,
               base_hit3: float) -> tuple[str, str]:
    """规则结论：采纳 / 观察 / 否决。"""
    if n < 200:
        return '否决', '样本 <200 笔，不足'
    if lift is None or lift < 1.05:
        return '否决', f'lift {lift} <1.05，相对基准无增益'
    if years_total >= 3 and years_hit <= years_total / 2:
        return '观察', f'分年一致性差（{years_hit}/{years_total} 年超基准）'
    if n >= 500 and lift >= 1.5:
        return '采纳', f'n={n}，lift={lift}，分年 {years_hit}/{years_total} 超基准'
    return '观察', f'n={n}，lift={lift}，样本或增益尚未达标'


def import_rules(conn: sqlite3.Connection, rid: int, src_dir: str = DAILY_DIR,
                 base_hit3: float = DAILY_BASE_HIT3) -> int:
    path = os.path.join(src_dir, 'rule_scan.csv')
    if not os.path.exists(path):
        log('跳过（缺少 rule_scan.csv）')
        return 0
    rows = read_csv_rows(path)
    conn.execute('DELETE FROM bt_rule WHERE runId=?', (rid,))
    out = []
    for r in rows:
        name = str(r.get('rule') or '')
        n = inum(r.get('n')) or 0
        hit3 = fnum(r.get('ge3_pct'))
        lift = fnum(r.get('lift_vs_base'))
        by_year = str(r.get('by_year') or '')
        pairs = []
        for tok in by_year.split():
            if ':' in tok:
                y, v = tok.split(':', 1)
                vv = fnum(v)
                if vv is not None:
                    pairs.append({'year': y, 'hit3Pct': vv})
        years_hit = sum(1 for p in pairs if p['hit3Pct'] >= base_hit3)
        verdict, note = judge_rule(n, hit3, lift, years_hit, len(pairs), base_hit3)
        out.append((rid, name, js({'byYear': pairs}),
                    n, hit3, base_hit3, lift, fnum(r.get('avg_strat_ret_pct')),
                    js(pairs), verdict, note))
    conn.executemany(
        'INSERT INTO bt_rule (runId, ruleName, conditionsJson, sampleCnt, hit3Pct, '
        'baseHit3Pct, lift3, stratMean, byYearJson, verdict, note) '
        'VALUES (?,?,?,?,?,?,?,?,?,?,?)', out)
    conn.commit()
    log(f'bt_rule {len(out)} 条规则')
    return len(out)


# ---------------------------------------------------------------- 时间网格
def import_time_grid(conn: sqlite3.Connection, rid: int,
                     grid_dir: str = GRID_DIR) -> int:
    """grid_pairs → bt_time_grid；grid_buy/grid_sell → bt_time_marginal；
    grid_pairs_month → bt_stat(dimension='grid_month')。"""
    pairs = read_csv_rows(os.path.join(grid_dir, 'grid_pairs.csv'))
    if not pairs:
        log('跳过（缺少 grid_pairs.csv）')
        return 0
    conn.execute('DELETE FROM bt_time_grid WHERE runId=?', (rid,))
    conn.execute('DELETE FROM bt_time_marginal WHERE runId=?', (rid,))
    conn.execute("DELETE FROM bt_stat WHERE runId=? AND dimension='grid_month'", (rid,))

    grid_rows = []
    for r in pairs:
        b, s = hhmm(r.get('buy_time')), hhmm(r.get('sell_time'))
        if b is None or s is None:
            continue
        grid_rows.append((rid, b, s, inum(r.get('n')) or 0, fnum(r.get('mean_pct')),
                          fnum(r.get('median_pct')), None, None,
                          fnum(r.get('hit_ge3_pct'))))
    conn.executemany(
        'INSERT OR REPLACE INTO bt_time_grid (runId, buyMinute, sellMinute, sampleCnt, '
        'retMeanPct, retMedPct, winRate, retStdPct, hit3Pct) VALUES (?,?,?,?,?,?,?,?,?)',
        grid_rows)
    log(f'bt_time_grid {len(grid_rows)} 个买卖组合')

    marg = []
    for r in read_csv_rows(os.path.join(grid_dir, 'grid_buy.csv')):
        m = hhmm(r.get('buy_time'))
        if m is None:
            continue
        marg.append((rid, 'buy', m, inum(r.get('n')) or 0,
                     fnum(r.get('ret_1000_pct')), None))
    for r in read_csv_rows(os.path.join(grid_dir, 'grid_sell.csv')):
        m = hhmm(r.get('sell_time'))
        if m is None:
            continue
        marg.append((rid, 'sell', m, inum(r.get('n')) or 0, fnum(r.get('mean_pct')),
                     fnum(r.get('is_window_high_share_pct'))))
    conn.executemany(
        'INSERT OR REPLACE INTO bt_time_marginal (runId, leg, minute, sampleCnt, '
        'retMeanPct, isBestShare) VALUES (?,?,?,?,?,?)', marg)
    log(f'bt_time_marginal {len(marg)} 行（买入腿 26 + 卖出腿 31）')

    months = read_csv_rows(os.path.join(grid_dir, 'grid_pairs_month.csv'))
    st = []
    for r in months:
        b, s = hhmm(r.get('buy_time')), hhmm(r.get('sell_time'))
        if b is None or s is None:
            continue
        bucket = f'{r.get("month")}|{b // 100:02d}:{b % 100:02d}-{s // 100:02d}:{s % 100:02d}'
        st.append((rid, 'grid_month', bucket, inum(r.get('n')) or 0, fnum(r.get('mean_pct')),
                   DIM_NOTES['grid_month']))
    conn.executemany(
        'INSERT INTO bt_stat (runId, dimension, bucket, sampleCnt, retCloseMean, note) '
        'VALUES (?,?,?,?,?,?)', st)
    conn.commit()
    log(f'bt_stat[grid_month] {len(st)} 行')
    return len(grid_rows) + len(marg) + len(st)


# ---------------------------------------------------------------- 全市场温度
def _index_series(code: str):
    """指数 / 板块指数序列 → ({date: close}, [排序后的 date 数组], close 数组)。"""
    import tdx_sector
    bars = tdx_sector.load_board_index(code)
    if bars is None or not len(bars):
        return {}, None, None
    d = np.asarray(bars['date'], dtype=np.int64)
    c = np.asarray(bars['close'], dtype=np.float64)
    order = np.argsort(d)
    d, c = d[order], c[order]
    return {int(k): float(v) for k, v in zip(d, c)}, d, c


def classify_regime(up_ratio, down_ratio, weak_pct, strong_pct, index_mean,
                    lu_cnt, ld_cnt) -> str:
    """简化自 src/market-regime.js 的 classifyMarketRegime（无封板率数据）。"""
    if up_ratio is None:
        return 'rotation'
    if ((ld_cnt or 0) >= 20) or down_ratio >= 0.62 or weak_pct >= 0.035 or \
            (index_mean is not None and index_mean <= -1.2):
        return 'weak'
    if up_ratio >= 0.60 and strong_pct >= 0.03 and (index_mean is None or index_mean >= 0.3):
        return 'strong_trend'
    if up_ratio >= 0.55 and down_ratio < 0.48 and (index_mean is None or index_mean >= -0.25):
        return 'range_strong'
    if weak_pct >= 0.018 and up_ratio >= 0.43 and (index_mean is None or index_mean > -0.8):
        return 'recovery'
    return 'rotation'


def scan_daily(start: int = MARKET_START, max_stocks: int | None = None,
               verbose: bool = True):
    """一次遍历全市场日线，同时产出「市场温度」与「板块温度」的中间累加。"""
    import kdata
    import indicators
    import tdx_sector

    market = kdata.Market(min_bars=1)
    snaps, snap_date = snapshot_records()
    names = {c: (s.get('name') or '') for c, s in snaps.items()}
    market.set_names(names)
    imap = tdx_sector.load_industry_map()
    codes = market.codes(1)
    if max_stocks:
        codes = codes[:max_stocks]
    mkt: dict[int, dict] = {}
    sec: dict[tuple, dict] = {}
    pcts: dict[int, list] = {}
    t0 = time.time()
    done = 0
    for code in codes:
        try:
            bars = market.raw(code)
        except Exception:                                   # noqa: BLE001
            continue
        if not len(bars):
            continue
        d = np.asarray(bars['date'], dtype=np.int64)
        c = np.asarray(bars['close'], dtype=np.float64)
        h = np.asarray(bars['high'], dtype=np.float64)
        lo = np.asarray(bars['low'], dtype=np.float64)
        a = np.asarray(bars['amount'], dtype=np.float64)
        n = len(d)
        pct = np.full(n, np.nan)
        if n > 1:
            prev = c[:-1]
            with np.errstate(invalid='ignore', divide='ignore'):
                pct[1:] = np.where(prev > 0, (c[1:] / prev - 1.0) * 100.0, np.nan)
        lr = indicators.limit_ratio(code, names.get(code, '')) * 100.0
        lu = (pct >= lr - 0.8) & (c >= h - 1e-9)
        ld = (pct <= -(lr - 0.8)) & (c <= lo + 1e-9)
        board = (imap.get(code) or {}).get('board') or ''
        sel = np.nonzero((d >= start) & np.isfinite(pct))[0]
        lu_sel = lu[sel]
        ld_sel = ld[sel]
        for k, j in enumerate(sel):
            dt = int(d[j])
            p = float(pct[j])
            g = mkt.get(dt)
            if g is None:
                g = mkt[dt] = {'n': 0, 'up': 0, 'down': 0, 'flat': 0, 'strong': 0,
                               'weak': 0, 'lu': 0, 'ld': 0, 'amt': 0.0}
            g['n'] += 1
            if p > 0:
                g['up'] += 1
            elif p < 0:
                g['down'] += 1
            else:
                g['flat'] += 1
            if p >= 5.0:
                g['strong'] += 1
            if p <= -5.0:
                g['weak'] += 1
            if lu_sel[k]:
                g['lu'] += 1
            if ld_sel[k]:
                g['ld'] += 1
            g['amt'] += float(a[j])
            pcts.setdefault(dt, []).append(p)
            if board:
                key = (board, dt)
                s = sec.get(key)
                if s is None:
                    s = sec[key] = {'n': 0, 'up': 0, 'lu': 0, 'amt': 0.0}
                s['n'] += 1
                if p > 0:
                    s['up'] += 1
                if lu_sel[k]:
                    s['lu'] += 1
                s['amt'] += float(a[j])
        done += 1
        if verbose and done % 1000 == 0:
            log(f'  扫描日线 {done}/{len(codes)} 只（{time.time() - t0:.0f}s）')

    days: dict[int, dict] = {}
    for dt, g in mkt.items():
        n = g['n']
        arr = np.asarray(pcts.get(dt) or [], dtype=np.float64)
        days[dt] = {
            'date': dt, 'n': n,
            'upRatio': 100.0 * g['up'] / n if n else None,
            'downRatio': g['down'] / n if n else None,
            'up5Ratio': 100.0 * g['strong'] / n if n else None,
            'weakPct': g['weak'] / n if n else None,
            'medianPct': float(np.median(arr)) if len(arr) else None,
            'limitUpCnt': g['lu'], 'limitDownCnt': g['ld'],
            'totalAmountYi': g['amt'] / 1e8,
        }
    return {'snapDate': snap_date, 'days': days, 'sectors': sec,
            'codes': len(codes), 'seconds': round(time.time() - t0, 1)}


def import_market_days(conn: sqlite3.Connection, scan: dict) -> int:
    """全市场温度 → bt_market_day。"""
    days = scan['days']
    if not days:
        log('跳过（无市场数据）')
        return 0
    idx, idates, iclose = _index_series('000300')
    keys = sorted(days)
    amts = np.array([days[k]['totalAmountYi'] for k in keys], dtype=np.float64)
    tscore = np.full(len(keys), np.nan)
    for i, k in enumerate(keys):
        g = days[k]
        amt_ratio = 1.0
        if i >= 5:
            prev = amts[max(0, i - 5):i]
            m = float(prev.mean())
            if m > 0:
                amt_ratio = float(amts[i] / m)
        up_r = (g['upRatio'] or 0.0) / 100.0
        med = g['medianPct'] or 0.0
        tscore[i] = (0.4 * up_r
                     + 0.2 * min(g['limitUpCnt'] / 120.0, 1.5)
                     + 0.2 * min(max((med + 2.0) / 4.0, 0.0), 1.5)
                     + 0.2 * min(amt_ratio, 2.0) / 2.0)
    order = np.argsort(np.argsort(tscore))
    conn.execute('DELETE FROM bt_market_day')
    out = []
    for i, k in enumerate(keys):
        g = days[k]
        ic = idx.get(k)
        ipct = None
        ima20 = None
        if ic is not None and idates is not None:
            pos = int(np.searchsorted(idates, k, side='right')) - 1
            if pos >= 1 and iclose[pos - 1] > 0:
                ipct = round((iclose[pos] / iclose[pos - 1] - 1.0) * 100.0, 4)
            if pos >= 19:
                m20 = float(iclose[pos - 19:pos + 1].mean())
                if m20 > 0:
                    ima20 = round((iclose[pos] / m20 - 1.0) * 100.0, 4)
        amt_ratio = None
        if i >= 5:
            m = float(amts[max(0, i - 5):i].mean())
            if m > 0:
                amt_ratio = round(float(amts[i] / m), 4)
        regime = classify_regime(g['upRatio'], g['downRatio'], g['weakPct'] or 0.0,
                                 (g['up5Ratio'] or 0.0) / 100.0, ipct,
                                 g['limitUpCnt'], g['limitDownCnt'])
        out.append((k, g['upRatio'], g['limitUpCnt'], g['limitDownCnt'],
                    g['up5Ratio'], g['medianPct'], round(g['totalAmountYi'], 4),
                    amt_ratio, ipct, ima20, regime,
                    round(float(tscore[i]), 6), round(100.0 * order[i] / max(len(keys) - 1, 1), 4)))
    conn.executemany(
        'INSERT OR REPLACE INTO bt_market_day (date, upRatio, limitUpCnt, limitDownCnt, '
        'up5Ratio, medianPct, totalAmountYi, amountRatio5, indexPct, indexMa20Pos, '
        'regime, tempScore, tempPct) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', out)
    conn.commit()
    log(f'bt_market_day {len(out)} 个交易日（{keys[0]}~{keys[-1]}）')
    return len(out)


def import_sector_days(conn: sqlite3.Connection, scan: dict) -> int:
    """板块温度 → bt_sector_day（成分广度 + 板块指数 + 热度分/分位/排名）。"""
    import tdx_sector
    sec = scan['sectors']
    if not sec:
        log('跳过（无板块数据）')
        return 0
    boards = sorted({b for b, _ in sec})
    names = tdx_sector.load_board_names()
    series = tdx_sector.load_board_series(boards)
    by_board: dict[str, list] = {}
    for (b, dt), s in sec.items():
        by_board.setdefault(b, []).append((dt, s))
    rows = []
    heat_by_date: dict[int, list] = {}
    for b in boards:
        items = sorted(by_board.get(b) or [])
        if not items:
            continue
        ser = series.get(b) or {}
        sd = ser.get('date')
        sc = ser.get('close')
        bname = (names.get(b) or {}).get('name') or ''
        for dt, s in items:
            n = s['n']
            up_ratio = 100.0 * s['up'] / n if n else None
            pct = None
            ret5 = None
            ret20 = None
            if sd is not None and len(sd):
                pos = int(np.searchsorted(sd, dt, side='right')) - 1
                if pos >= 1 and sc[pos - 1] > 0:
                    pct = round((sc[pos] / sc[pos - 1] - 1.0) * 100.0, 4)
                if pos >= 5 and sc[pos - 5] > 0:
                    ret5 = round((sc[pos] / sc[pos - 5] - 1.0) * 100.0, 4)
                if pos >= 20 and sc[pos - 20] > 0:
                    ret20 = round((sc[pos] / sc[pos - 20] - 1.0) * 100.0, 4)
            heat = None
            if pct is not None and up_ratio is not None:
                heat = round(0.5 * pct + 0.4 * (up_ratio - 50.0) / 50.0 * 2.0
                             + 0.1 * min(s['lu'] / 5.0, 2.0), 6)
                heat_by_date.setdefault(dt, []).append((b, heat))
            rows.append((b, 'industry', dt, bname, pct, ret5, ret20, None,
                         up_ratio, s['lu'], heat))
    heat_pct: dict[tuple, float] = {}
    rank_pct: dict[tuple, float] = {}
    for dt, lst in heat_by_date.items():
        if len(lst) < 2:
            for b, _ in lst:
                heat_pct[(b, dt)] = 100.0
                rank_pct[(b, dt)] = 100.0
            continue
        vals = np.array([v for _, v in lst], dtype=np.float64)
        ordv = np.argsort(np.argsort(vals))
        k = len(lst) - 1
        for i, (b, _) in enumerate(lst):
            heat_pct[(b, dt)] = round(100.0 * ordv[i] / k, 4)
            rank_pct[(b, dt)] = round(100.0 * (k - ordv[i]) / k, 4)
    conn.execute("DELETE FROM bt_sector_day WHERE boardType='industry'")
    full = [r + (heat_pct.get((r[0], r[2])), rank_pct.get((r[0], r[2])))
            for r in rows]
    conn.executemany(
        'INSERT OR REPLACE INTO bt_sector_day (boardId, boardType, date, boardName, '
        'pct, ret5, ret20, amountRatio5, upRatio, limitUpCnt, heatScore, heatPct, '
        'rankPct) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', full)
    conn.commit()
    log(f'bt_sector_day {len(full)} 行 / {len(boards)} 个行业')
    return len(full)


def link_context(conn: sqlite3.Connection, run_keys=None) -> int:
    """把市场温度 / 板块温度回填到 bt_trade，并重建 bt_trade_context。"""
    import tdx_sector
    conn.execute('DROP TABLE IF EXISTS _tmp_code_board')
    conn.execute('CREATE TEMP TABLE _tmp_code_board (code TEXT PRIMARY KEY, '
                 'boardId TEXT, boardName TEXT)')
    imap = tdx_sector.load_industry_map()
    names = tdx_sector.load_board_names()
    tmp = [(c, v.get('board') or '', (names.get(v.get('board') or '') or {}).get('name') or '')
           for c, v in imap.items()]
    conn.executemany('INSERT OR REPLACE INTO _tmp_code_board VALUES (?,?,?)', tmp)
    keys = list(run_keys or [RUN_DAILY, RUN_MINUTE, RUN_GRID, RUN_TF, RUN_REVERSE])
    q = ','.join('?' * len(keys))
    rids = [r[0] for r in conn.execute(
        f'SELECT runId FROM bt_run WHERE runKey IN ({q})', keys)]
    if not rids:
        log('跳过（无对应 run）')
        return 0
    rq = ','.join('?' * len(rids))
    conn.execute(f'''
        UPDATE bt_trade SET
          marketTemp = (SELECT m.tempScore FROM bt_market_day m WHERE m.date = bt_trade.date),
          marketRegime = (SELECT m.regime FROM bt_market_day m WHERE m.date = bt_trade.date),
          sectorPct = COALESCE((SELECT s.pct FROM bt_sector_day s
                                JOIN _tmp_code_board t ON t.boardId = s.boardId
                                WHERE t.code = bt_trade.code AND s.date = bt_trade.date),
                               bt_trade.sectorPct),
          sectorRet5 = COALESCE((SELECT s.ret5 FROM bt_sector_day s
                                JOIN _tmp_code_board t ON t.boardId = s.boardId
                                WHERE t.code = bt_trade.code AND s.date = bt_trade.date),
                               bt_trade.sectorRet5),
          sectorRet20 = COALESCE((SELECT s.ret20 FROM bt_sector_day s
                                JOIN _tmp_code_board t ON t.boardId = s.boardId
                                WHERE t.code = bt_trade.code AND s.date = bt_trade.date),
                               bt_trade.sectorRet20),
          sectorHeat = (SELECT s.heatScore FROM bt_sector_day s
                        JOIN _tmp_code_board t ON t.boardId = s.boardId
                        WHERE t.code = bt_trade.code AND s.date = bt_trade.date),
          sectorUpRatio = (SELECT s.upRatio FROM bt_sector_day s
                           JOIN _tmp_code_board t ON t.boardId = s.boardId
                           WHERE t.code = bt_trade.code AND s.date = bt_trade.date),
          sectorLimitUpCnt = (SELECT s.limitUpCnt FROM bt_sector_day s
                              JOIN _tmp_code_board t ON t.boardId = s.boardId
                              WHERE t.code = bt_trade.code AND s.date = bt_trade.date)
        WHERE runId IN ({rq})
    ''', rids)
    conn.commit()
    conn.execute(f'DELETE FROM bt_trade_context WHERE runId IN ({rq})', rids)
    conn.execute(f'''
        INSERT INTO bt_trade_context (tradeId, runId, marketTemp, marketRegime,
            sectorHeat, sectorUpRatio, conceptHeat, contextJson)
        SELECT t.tradeId, t.runId, t.marketTemp, t.marketRegime, t.sectorHeat,
               t.sectorUpRatio, t.conceptHeat, NULL
        FROM bt_trade t WHERE t.runId IN ({rq})
    ''', rids)
    conn.commit()
    n = int(conn.execute(f'SELECT COUNT(*) FROM bt_trade_context WHERE runId IN ({rq})',
                         rids).fetchone()[0])
    log(f'bt_trade_context {n} 行（已回填市场/板块温度）')
    return n


# ---------------------------------------------------------------- 反推批次导入
# 第三套策略：T 日 14:40 买入 → T+1 09:31~10:30 窗口最高涨幅 ≥3%
# （先按标签切样本，再反推 T 日尾盘分时；无形态字段）。
# 源：data/backtest/minute-reverse/{samples.csv(95 列逐笔), reverse_model.json}
REVERSE_STAT_DIM_NOTES = {
    'overall': '全样本基准（T 日 14:40 买入 → T+1 09:31~10:30 窗口最高涨幅）',
    'month': '逐自然月（窗口仅 4 个月，行情敏感度极大）',
    'board': '上市板',
    'market_regime': 'T-1 市场环境（strong_trend/range_strong/rotation/recovery/weak）',
    'industry': '通达信行业',
    'decile': '预测概率十分位（样本内；D10 = 预测最高）',
    'decile_loo': '预测概率十分位（留一月·样本外；D10 策略均值为负，不得用于下单）',
    'topk': '每日 Top-K（样本内，成交额 ≥1000 万过滤）',
    'topk_loo': '每日 Top-K（留一月·样本外）',
    'model_month': '模型逐月 AUC 与每日 Top-3 命中率',
}


def reverse_sample_types(conn: sqlite3.Connection) -> dict[str, str]:
    """bt_reverse_sample 的「列名 → SQLite 类型（大写）」。"""
    return {str(r[1]): str(r[2] or '').upper()
            for r in conn.execute("PRAGMA table_info('bt_reverse_sample')")}


def _reverse_value(raw, col_type: str):
    """按列类型把 CSV 文本转成写入值：整数列 → int，浮点列 → float，其余原样。"""
    if col_type and 'INT' in col_type:
        return inum(raw)
    if col_type and any(k in col_type for k in ('REAL', 'FLOA', 'DOUB', 'NUM')):
        return fnum(raw)
    return raw if (raw is not None and str(raw).strip() != '') else None


def import_reverse_samples(conn: sqlite3.Connection, path: str = REVERSE_SAMPLES,
                           batch: int = 5000) -> int:
    """把 samples.csv（95 列）整体写入 bt_reverse_sample（先清空再流式插入）。"""
    if not os.path.exists(path):
        raise SystemExit(f'缺少反推采样文件：{path}')
    types = reverse_sample_types(conn)
    cols = list(types)
    sql = (f'INSERT OR REPLACE INTO bt_reverse_sample ({",".join(cols)}) '
           f'VALUES ({",".join("?" * len(cols))})')
    conn.execute('DELETE FROM bt_reverse_sample')
    n = 0
    buf: list[tuple] = []
    with open(path, 'r', encoding='utf-8-sig', newline='') as f:
        rd = csv.reader(f)
        head = next(rd, None)
        if not head:
            raise SystemExit(f'反推采样文件为空：{path}')
        if len(head) != len(cols) or set(head) != set(cols):
            raise SystemExit('samples.csv 列与 bt_reverse_sample 不一致：'
                             f'缺={sorted(set(cols) - set(head))} '
                             f'多={sorted(set(head) - set(cols))}')
        order = [head.index(c) for c in cols]
        ctypes = [types[c] for c in cols]
        for line_no, raw in enumerate(rd, start=2):
            if not raw:
                continue
            if len(raw) != len(head):
                raise SystemExit(f'samples.csv 第 {line_no} 行列数 {len(raw)} ≠ {len(head)}')
            buf.append(tuple(_reverse_value(raw[i], t) for i, t in zip(order, ctypes)))
            n += 1
            if len(buf) >= batch:
                conn.executemany(sql, buf)
                buf.clear()
        if buf:
            conn.executemany(sql, buf)
    conn.commit()
    log(f'bt_reverse_sample {n} 行 ← {os.path.relpath(path, ROOT)}')
    return n


def _hit_map(d: dict) -> dict:
    """把 reverse_model.json 的 up1..up9 / limitUp / ret* 命名映射成 stat_tuple 的入参键。"""
    out: dict = {'n': d.get('n')}
    for i in range(1, 10):
        out[f'ge{i}_pct'] = d.get(f'up{i}Pct')
    out['limit_pct'] = d.get('limitUpPct')
    out['avg_ret_open_pct'] = d.get('retOpenPct')
    out['avg_ret_high_pct'] = d.get('retHighPct')
    out['avg_ret_close_pct'] = d.get('retClosePct')
    out['avg_strat_ret_pct'] = d.get('stratPct')
    out['win_rate_true_pct'] = d.get('winRatePct')
    out['profit_factor'] = d.get('profitFactor')
    return out


def _stat_tuple(rid: int, dim: str, row: dict, note: str,
                by_year=None, stability: str | None = None) -> tuple:
    """stat_tuple + 分年 JSON（第 23 列）+ 稳定性（第 24 列）。"""
    t = list(stat_tuple(rid, dim, row, REVERSE_BASE_HIT3, note))
    t[23] = js(by_year) if by_year else None
    t[24] = stability or t[24]
    return tuple(t)


def import_reverse_stats(conn: sqlite3.Connection, rid: int,
                         path: str = REVERSE_MODEL_PATH) -> int:
    """把 reverse_model.json 的基准 / 分档 / 规则外统计写进 bt_stat。"""
    if not os.path.exists(path):
        raise SystemExit(f'缺少反推模型文件：{path}')
    model = load_json(path)
    base = model.get('base') or {}
    hit = base.get('hitPct') or {}
    means = base.get('means') or {}
    rows: list[tuple] = []

    # 1) 全样本基准
    overall = _hit_map({
        **{f'up{i}Pct': hit.get(f'up{i}') for i in range(1, 10)},
        'limitUpPct': hit.get('limitUp'),
        'n': base.get('rows'),
        'retOpenPct': means.get('retOpenPct'),
        'retHighPct': means.get('retHighPct'),
        'retClosePct': means.get('retClosePct'),
        'stratPct': means.get('stratPct'),
    })
    overall['bucket'] = '全样本'
    rows.append(_stat_tuple(rid, 'overall', overall, REVERSE_STAT_DIM_NOTES['overall'],
                            stability='unverified'))

    # 2) 逐自然月
    for m in base.get('byMonth') or []:
        r = _hit_map({**{f'up{i}Pct': m.get(f'up{i}Pct') for i in range(1, 10)},
                      'limitUpPct': m.get('limitUpPct'), 'n': m.get('n'),
                      'retOpenPct': m.get('retOpenPct'),
                      'retHighPct': m.get('retHighPct'),
                      'stratPct': m.get('stratPct')})
        r['bucket'] = str(m.get('month'))
        rows.append(_stat_tuple(rid, 'month', r, REVERSE_STAT_DIM_NOTES['month']))

    # 3) 分类扫描：上市板 / 市场环境 / 行业
    cat_dim = {'dBoard': 'board', 'marketRegime': 'market_regime', 'industry': 'industry'}
    for cat in model.get('catScan') or []:
        dim = cat_dim.get(str(cat.get('key') or ''), str(cat.get('key') or ''))
        for g in cat.get('groups') or []:
            r = {'bucket': str(g.get('name') or ''), 'n': g.get('n'),
                 'ge3_pct': g.get('hitPct')}
            rows.append(_stat_tuple(rid, dim, r, REVERSE_STAT_DIM_NOTES.get(dim, '')))

    # 4) 单因子十分位（每个数值特征一个 rev_<key> 维度）
    for bs in model.get('bucketScan') or []:
        key = str(bs.get('key') or '')
        cn = str(bs.get('cn') or key)
        unit = str(bs.get('unit') or '')
        dim = f'rev_{key}'
        for b in bs.get('buckets') or []:
            lo, hi = b.get('lo'), b.get('hi')
            span = (f'{"-" if lo is None else round(float(lo), 4)}~'
                    f'{"-" if hi is None else round(float(hi), 4)}')
            note = (f'单因子分档：{cn}{("（" + unit + "）") if unit else ""}｜'
                    f'区间 {span}｜全因子极差 lift '
                    f'{bs.get("spreadLift") if bs.get("spreadLift") is not None else "-"}')
            r = {'bucket': f'D{inum(b.get("bin")) or 0:02d}', 'n': b.get('n'),
                 'ge3_pct': b.get('hitPct')}
            rows.append(_stat_tuple(rid, dim, r, note))

    # 5) 预测概率十分位（样本内 / 留一月样本外）
    for dim, items in (('decile', model.get('deciles') or []),
                       ('decile_loo', model.get('decilesLoo') or [])):
        for d in items:
            r = {'bucket': f'D{inum(d.get("decile")) or 0:02d}', 'n': d.get('n'),
                 'ge3_pct': d.get('actualPct'), 'limit_pct': d.get('limitUpPct'),
                 'avg_ret_open_pct': d.get('retOpenMeanPct'),
                 'avg_ret_high_pct': d.get('retHighMeanPct'),
                 'avg_strat_ret_pct': d.get('stratMeanPct')}
            note = (f'{REVERSE_STAT_DIM_NOTES[dim]}｜预测 {d.get("predPct")}% vs '
                    f'实际 {d.get("actualPct")}%｜lift {d.get("liftVsBase")}')
            rows.append(_stat_tuple(rid, dim, r, note))

    # 6) 每日 Top-K（样本内 / 留一月样本外）
    for dim, items in (('topk', model.get('topk') or {}),
                       ('topk_loo', model.get('topkLoo') or {})):
        for k, d in items.items():
            r = {'bucket': str(k), 'n': d.get('n'), 'ge3_pct': d.get('hit3Pct'),
                 'limit_pct': d.get('limitUpPct'), 'avg_ret_open_pct': d.get('retOpenPct'),
                 'avg_ret_high_pct': d.get('retHighPct'),
                 'avg_strat_ret_pct': d.get('stratPct')}
            note = (f'{REVERSE_STAT_DIM_NOTES[dim]}｜每日取 {d.get("k")} 只｜有效 '
                    f'{d.get("days")} 天｜成交额 ≥1000 万')
            rows.append(_stat_tuple(rid, dim, r, note, by_year=d.get('byYear')))

    # 7) 模型逐月 AUC / Top-3 命中
    for m in model.get('months') or []:
        r = {'bucket': str(m.get('month')), 'n': m.get('n'), 'ge3_pct': m.get('up3Pct')}
        note = (f'{REVERSE_STAT_DIM_NOTES["model_month"]}｜up3 AUC {m.get("auc")}｜'
                f'每日 Top-3 命中 {m.get("top3up3Pct")}%')
        rows.append(_stat_tuple(rid, 'model_month', r, note))

    conn.execute('DELETE FROM bt_stat WHERE runId=?', (rid,))
    conn.executemany(STAT_SQL, rows)
    conn.commit()
    dims: dict[str, int] = {}
    for t in rows:
        dims[t[1]] = dims.get(t[1], 0) + 1
    log(f'bt_stat {len(rows)} 行 / {len(dims)} 个维度（反推批次）：'
        + ', '.join(f'{k}×{v}' for k, v in sorted(dims.items())
                    if not k.startswith('rev_')))
    return len(rows)


RULE_PREFIX = (('singles', 'REV-S'), ('pairs', 'REV-P'), ('triples', 'REV-T'))


def import_reverse_rules(conn: sqlite3.Connection, rid: int,
                         path: str = REVERSE_MODEL_PATH) -> int:
    """把组合规则扫描结果写入 bt_rule（逐日/逐月稳健闸门信息存 conditionsJson）。"""
    model = load_json(path)
    rules = model.get('rules') or {}
    conn.execute('DELETE FROM bt_rule WHERE runId=?', (rid,))
    out: list[tuple] = []
    for kind, prefix in RULE_PREFIX:
        for i, r in enumerate(rules.get(kind) or [], 1):
            cond = js({
                'kind': kind,
                'terms': [r[k] for k in ('a', 'b', 'c') if r.get(k)],
                'text': r.get('text'),
                'gates': {'monthCount': r.get('monthCount'),
                          'dayCount': r.get('dayCount'),
                          'monthLiftMin': r.get('monthLiftMin'),
                          'monthLiftMed': r.get('monthLiftMed'),
                          'dayLiftMin': r.get('dayLiftMin'),
                          'dayLiftMed': r.get('dayLiftMed'),
                          'robust': bool(r.get('robust'))},
            })
            out.append((rid, f'{prefix}{i:02d}', cond, inum(r.get('n')) or 0,
                        fnum(r.get('hitPct')), REVERSE_BASE_HIT3, fnum(r.get('lift')),
                        None, None, '采纳' if r.get('robust') else '观察',
                        r.get('text')))
    conn.executemany(
        'INSERT INTO bt_rule (runId, ruleName, conditionsJson, sampleCnt, hit3Pct, '
        'baseHit3Pct, lift3, stratMean, byYearJson, verdict, note) '
        'VALUES (?,?,?,?,?,?,?,?,?,?,?)', out)
    conn.commit()
    log(f'bt_rule {len(out)} 行（反推批次：单 {len(rules.get("singles") or [])} / '
        f'双 {len(rules.get("pairs") or [])} / 三 {len(rules.get("triples") or [])}）')
    return len(out)


def do_import_reverse(conn: sqlite3.Connection) -> None:
    """导入第三套策略（14:40 分时反推）的全量结果。"""
    ensure_run(conn, RUN_REVERSE)
    rid = run_id(conn, RUN_REVERSE)
    log(f'[14:40 分时反推] runId={rid}  源={REVERSE_DIR}')
    import_reverse_samples(conn)
    import_reverse_stats(conn, rid)
    import_reverse_rules(conn, rid)


# ---------------------------------------------------------------- 旧口径清出
# 2026-09-21：用户要求「原先的回测数据删除掉，重新写入新的回测结果」。
# 清出范围＝全部旧口径结果表 + bt_run + bt_meta；保留市场/板块温度与数据集字典
# （bt_market_day / bt_sector_day / bt_dataset 与具体策略无关，重扫需数分钟）。
PURGE_TABLES = ['bt_trade', 'bt_trade_context', 'bt_trade_tf', 'bt_stat', 'bt_rule',
                'bt_time_grid', 'bt_time_marginal', 'bt_pattern_def', 'bt_feature_def',
                'bt_reverse_sample', 'bt_reverse_feature']
PURGE_KEEP = ['bt_market_day', 'bt_sector_day', 'bt_dataset']


def do_purge_legacy(conn: sqlite3.Connection, vacuum: bool = True) -> None:
    """清出旧口径回测结果（旧批次明细/统计/网格/形态/字段登记 + bt_run + bt_meta）。"""
    before = table_counts(conn)
    for t in PURGE_TABLES + ['bt_run', 'bt_meta']:
        if t in before:
            conn.execute(f'DELETE FROM {t}')
    conn.commit()
    if vacuum:
        log('VACUUM 回收空间…')
        conn.execute('VACUUM')
    after = table_counts(conn)
    log('旧回测结果已清出（保留市场/板块温度与数据集字典）：')
    for t in sorted(before):
        if t in PURGE_KEEP:
            print(f'  保留 {t:<20} {after.get(t, 0):>9}')
        elif before[t]:
            print(f'  删除 {t:<20} {before[t]:>9} → {after.get(t, 0)}')


# ---------------------------------------------------------------- 批次导入
def do_import_daily(conn: sqlite3.Connection) -> None:
    rid = run_id(conn, RUN_DAILY)
    log(f'[日线近似] runId={rid}  源={DAILY_DIR}')
    import_stats_from_dir(conn, rid, DAILY_DIR, DAILY_BASE_HIT3, tag='日线近似',
                          dim_notes=DAILY_DIM_NOTES)
    import_daily_trades(conn, rid)
    import_rules(conn, rid, DAILY_DIR, DAILY_BASE_HIT3)


def do_import_daily_stats(conn: sqlite3.Connection) -> None:
    """只刷新日线批次的分档统计（含形态位置三档）与规则表，不动 bt_trade 明细。

    用在 ``tools/day_shape_scan.py`` / ``tools/day_pattern_scan.py`` 之后：
    这两个脚本会写新的 ``bucket_day_shape.csv`` 等分档文件，但重跑明细会清掉它们
    回填到 bt_trade 的形态列，所以这里只补统计。
    """
    rid = run_id(conn, RUN_DAILY)
    log(f'[日线近似·仅统计] runId={rid}  源={DAILY_DIR}')
    import_stats_from_dir(conn, rid, DAILY_DIR, DAILY_BASE_HIT3, tag='日线近似',
                          dim_notes=DAILY_DIM_NOTES)
    import_rules(conn, rid, DAILY_DIR, DAILY_BASE_HIT3)


def do_import_minute(conn: sqlite3.Connection) -> None:
    rid = run_id(conn, RUN_MINUTE)
    log(f'[分钟精确] runId={rid}  源={MINUTE_DIR}')
    import_stats_from_dir(conn, rid, MINUTE_DIR, MINUTE_BASE_HIT3, tag='分钟精确')
    path = os.path.join(MINUTE_DIR, 'summary.json')
    if os.path.exists(path):
        s = load_json(path)
        rows = []
        for key in ('overall_minute', 'overall_daily_approx'):
            r = s.get(key)
            if isinstance(r, dict):
                rows.append(stat_tuple(
                    rid, 'overall', r, MINUTE_BASE_HIT3,
                    '分钟窗口 2026-06-12~2026-09-17 全样本（69 日）'))
        if rows:
            conn.executemany(STAT_SQL, rows)
            conn.commit()
            log(f'  bt_stat[overall] {len(rows)} 行 ← summary.json')


def do_import_grid(conn: sqlite3.Connection) -> None:
    rid = run_id(conn, RUN_GRID)
    log(f'[时间网格] runId={rid}  源={GRID_DIR}')
    import_stats_from_dir(conn, rid, GRID_DIR, GRID_BASE_HIT3, tag='时间网格')
    import_time_grid(conn, rid, GRID_DIR)


def do_import_tf(conn: sqlite3.Connection) -> None:
    rid = run_id(conn, RUN_TF)
    log(f'[多周期形态] runId={rid}  源={TF_DIR}')
    n = import_tf_stats(conn, rid, TF_DIR, MINUTE_BASE_HIT3)
    log(f'  bt_stat 合计 {n} 行（多周期批次）')


def do_import_market(conn: sqlite3.Connection, max_stocks: int | None = None) -> None:
    log(f'扫描全市场日线（起始 {MARKET_START}'
        + (f'，仅前 {max_stocks} 只' if max_stocks else '') + '）…')
    scan = scan_daily(max_stocks=max_stocks)
    log(f'扫描完成：{scan["codes"]} 只 / {scan["seconds"]}s / {len(scan["days"])} 个交易日')
    import_market_days(conn, scan)
    import_sector_days(conn, scan)


# ---------------------------------------------------------------- 校验
def check_schema(conn: sqlite3.Connection) -> list[str]:
    """bt_feature_def 与真实表结构双向覆盖检查。"""
    issues: list[str] = []
    if not table_exists(conn, 'bt_feature_def'):
        return ['bt_feature_def 不存在，请先执行 --init 建表并灌入字段字典']
    tables = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'bt_%'")]
    have = {}
    for t in tables:
        have[t] = {r[1] for r in conn.execute(f'PRAGMA table_info("{t}")')}
    doc: dict[str, set] = {}
    for t, c in conn.execute('SELECT tableName, columnName FROM bt_feature_def'):
        doc.setdefault(t, set()).add(c)
    for t, cols in sorted(doc.items()):
        if t not in have:
            issues.append(f'bt_feature_def 引用了不存在的表：{t}')
            continue
        miss = cols - have[t]
        extra = have[t] - cols
        for c in sorted(miss):
            issues.append(f'{t}.{c} 有字段字典但表里没有该列')
        for c in sorted(extra):
            issues.append(f'{t}.{c} 表里有列但字段字典未登记')
    for t in sorted(have):
        if t not in doc and t not in ('bt_meta', 'bt_feature_def'):
            issues.append(f'{t} 未登记任何字段字典')
    return issues


# (标签, runKey, dimension, bucket 或 bucket 列表, 指标列, 期望值, 容差)
# 口径：2026-09-21 晚定稿的第三套策略 —— T 日 14:40 买入（1 分钟收盘价）、
# T+1 09:31~10:30 窗口最高涨幅 ≥+3% 为标签，先按标签切样本再反推 T 日尾盘分时；无形态字段。
VERIFY_SPECS = [
    ('反推全样本 ≥3%', RUN_REVERSE, 'overall', ('全样本',), 'hit3Pct', 20.081, 0.02),
    ('反推全样本 ≥1%', RUN_REVERSE, 'overall', ('全样本',), 'hit1Pct', 57.924, 0.02),
    ('反推全样本 ≥5%', RUN_REVERSE, 'overall', ('全样本',), 'hit5Pct', 8.496, 0.02),
    ('反推全样本 触涨停%', RUN_REVERSE, 'overall', ('全样本',), 'limitUpPct', 2.035, 0.02),
    ('反推 202606 ≥3%', RUN_REVERSE, 'month', ('202606',), 'hit3Pct', 23.86, 0.02),
    ('反推 202609 ≥3%', RUN_REVERSE, 'month', ('202609',), 'hit3Pct', 13.4, 0.02),
    ('反推 创业板 ≥3%', RUN_REVERSE, 'board', ('创业板',), 'hit3Pct', 24.19, 0.02),
    ('反推 半导体 ≥3%', RUN_REVERSE, 'industry', ('半导体',), 'hit3Pct', 32.21, 0.02),
    ('反推 证券 ≥3%', RUN_REVERSE, 'industry', ('证券',), 'hit3Pct', 9.02, 0.02),
    ('单因子 日内振幅 D10 ≥3%', RUN_REVERSE, 'rev_mAmp1440', ('D10',), 'hit3Pct', 42.17, 0.02),
    ('单因子 换手率 D10 ≥3%', RUN_REVERSE, 'rev_mTurnover1440', ('D10',), 'hit3Pct', 39.98, 0.02),
    ('十分位 样本内 D10 ≥3%', RUN_REVERSE, 'decile', ('D10',), 'hit3Pct', 51.01, 0.02),
    ('十分位 样本外 D10 ≥3%', RUN_REVERSE, 'decile_loo', ('D10',), 'hit3Pct', 42.32, 0.02),
    ('每日 Top-K 样本内 K=10', RUN_REVERSE, 'topk', ('k10',), 'hit3Pct', 66.23, 0.02),
    ('每日 Top-K 样本外 K=10', RUN_REVERSE, 'topk_loo', ('k10',), 'hit3Pct', 64.35, 0.02),
    ('流动性 Top-10 样本外', RUN_REVERSE, 'topk_loo', ('liq_k10',), 'hit3Pct', 64.49, 0.02),
]


def do_verify(conn: sqlite3.Connection) -> int:
    bad = 0
    if not table_exists(conn, 'bt_reverse_sample') or not table_exists(conn, 'bt_stat'):
        print('== 关键数字核对：跳过（bt_reverse_sample / bt_stat 不存在，请先执行 '
              '--init 与 --import-reverse）')
        return 1

    def show(label, got, want, ok):
        nonlocal bad
        mark = 'OK  ' if ok else 'FAIL'
        if not ok:
            bad += 1
        print(f'  [{mark}] {label:<22} 库内={got}  期望={want}')

    print('== 关键数字核对（第三套：14:40 买入 → 次日 09:31~10:30 最高涨幅 ≥3%）')
    for label, rk, dim, buckets, col, want, tol in VERIFY_SPECS:
        got = None
        for b in buckets:
            row = conn.execute(
                'SELECT s.' + col + ' FROM bt_stat s JOIN bt_run r ON r.runId = s.runId '
                'WHERE r.runKey = ? AND s.dimension = ? AND s.bucket = ?',
                (rk, dim, b)).fetchone()
            if row is not None and row[0] is not None:
                got = row[0]
                break
        ok = got is not None and abs(got - want) <= tol
        show(label, got, want, ok)

    feat_n = 0
    if os.path.exists(REVERSE_MODEL_PATH):
        feat_n = len(((load_json(REVERSE_MODEL_PATH).get('model') or {})
                      .get('features')) or [])
    print('== 逐笔明细与登记（反推批次）')
    for label, sql, want in [
        ('bt_reverse_sample 逐笔行数', 'SELECT COUNT(*) FROM bt_reverse_sample',
         REVERSE_SAMPLE_N),
        ('bt_reverse_sample 列数',
         "SELECT COUNT(*) FROM pragma_table_info('bt_reverse_sample')", 95),
        ('bt_reverse_feature 入模特征', 'SELECT COUNT(*) FROM bt_reverse_feature', feat_n),
        ('bt_rule 组合规则条数', 'SELECT COUNT(*) FROM bt_rule', 30),
        ('bt_feature_def 字段登记', 'SELECT COUNT(*) FROM bt_feature_def', 352),
        ('bt_pattern_def 形态字典', 'SELECT COUNT(*) FROM bt_pattern_def', 139),
        ('bt_trade 旧口径明细（已清出）', 'SELECT COUNT(*) FROM bt_trade', 0),
        ('bt_trade_tf 旧快照（已清出）', 'SELECT COUNT(*) FROM bt_trade_tf', 0),
        ('bt_time_grid 组合（已清出）', 'SELECT COUNT(*) FROM bt_time_grid', 0),
        ('bt_run 批次行数（仅反推）', 'SELECT COUNT(*) FROM bt_run', 1),
        ('bt_sector_day 行业数',
         'SELECT COUNT(DISTINCT boardId) FROM bt_sector_day', 110),
    ]:
        got = conn.execute(sql).fetchone()[0]
        show(label, got, want, got == want)

    got = conn.execute('SELECT COUNT(*) FROM bt_market_day').fetchone()[0]
    show('bt_market_day 交易日数', got, '>=1900', got >= 1900)

    print('== bt_stat 维度覆盖（反推批次）')
    for dim, want_min in (('overall', 1), ('month', 4), ('board', 4), ('market_regime', 5),
                          ('industry', 40), ('decile', 10), ('decile_loo', 10),
                          ('topk', 14), ('topk_loo', 14), ('model_month', 4)):
        got = conn.execute(
            'SELECT COUNT(*) FROM bt_stat s JOIN bt_run r ON r.runId=s.runId '
            'WHERE r.runKey=? AND s.dimension=?', (RUN_REVERSE, dim)).fetchone()[0]
        show(f'bt_stat[{dim}]', got, f'>={want_min}', got >= want_min)
    rev = conn.execute(
        "SELECT COUNT(DISTINCT s.dimension) FROM bt_stat s JOIN bt_run r ON r.runId=s.runId "
        "WHERE r.runKey=? AND s.dimension GLOB 'rev_*'", (RUN_REVERSE,)).fetchone()[0]
    show('bt_stat 单因子维度数', rev, 55, rev == 55)

    print('== 红线（必须随数据一起展示）')
    print('  · 窗口仅 69 个交易日（20260612~20260917）且落在同一段行情，不能外推。')
    print('  · 最高十分位样本外：预测 48.96% vs 实际 42.32%（高估），策略均值 −0.253%。')
    print('  · bt_meta.usableForDecision=0：未扩窗复核前不得作为实盘下单依据。')

    print('== 覆盖度')
    for rk, in conn.execute('SELECT runKey FROM bt_run ORDER BY runId'):
        tid = conn.execute('SELECT COUNT(*) FROM bt_trade t JOIN bt_run r ON r.runId=t.runId '
                           'WHERE r.runKey=?', (rk,)).fetchone()[0]
        ttf = conn.execute('SELECT COUNT(*) FROM bt_trade_tf f JOIN bt_run r ON r.runId=f.runId '
                           'WHERE r.runKey=?', (rk,)).fetchone()[0]
        st = conn.execute('SELECT COUNT(*) FROM bt_stat s JOIN bt_run r ON r.runId=s.runId '
                          'WHERE r.runKey=?', (rk,)).fetchone()[0]
        print(f'  {rk:<42} 明细={tid:>8}  多周期={ttf:>8}  统计={st:>6}')

    print(f'== 结论：{"全部通过" if bad == 0 else str(bad) + " 项不符"}')
    return bad


# ---------------------------------------------------------------- 实盘凭据表
DECISION_DDL = '''-- 智诊盯盘：尾盘选股实盘凭据表
-- 由 tools/backtest_store.py --emit-decision-ddl 生成；落在 data/kline.db。
-- 每个交易日盘后写一份决策，次日盘后回填真实结果，作为可追溯的实盘凭据。

CREATE TABLE IF NOT EXISTS bt_decision (
  decisionId      INTEGER PRIMARY KEY AUTOINCREMENT, -- 主键
  tradeDate       INTEGER NOT NULL,  -- 决策日 T（YYYYMMDD）
  code            TEXT    NOT NULL,  -- 股票代码
  name            TEXT,              -- 股票名称
  runId           INTEGER,           -- 引用的回测批次（backtest.db 的 bt_run.runId）
  runKey          TEXT,              -- 回测批次键（便于跨库追溯）
  score           REAL,              -- 综合评分（0~100）
  up3Prob         REAL,              -- 预测次日早盘最高 ≥+3% 概率 %
  up5Prob         REAL,              -- 预测次日早盘最高 ≥+5% 概率 %
  limitUpProb     REAL,              -- 预测次日封涨停概率 %
  expectedRetHigh REAL,              -- 预期次日早盘最高涨幅 %
  expectedRetOpen REAL,              -- 预期次日开盘卖出收益 %
  suggestedBuyTime  INTEGER,         -- 建议买入时刻 HHMM（当前口径：14:40）
  suggestedSellTime INTEGER,         -- 建议卖出时刻 HHMM（当前口径：09:31~10:30 窗口内）
  marketTemp      REAL,              -- 决策日全市场温度
  marketRegime    TEXT,              -- 决策日市场环境（strong_trend/range_strong/rotation/recovery/weak）
  sectorHeat      REAL,              -- 所属行业热度分
  sectorUpRatio   REAL,              -- 所属行业成分上涨占比 %
  evidenceJson    TEXT,              -- 命中的特征与规则证据（JSON）
  patternJson     TEXT,              -- 多周期形态快照（JSON）
  confidence      TEXT,              -- 置信度 high/medium/low
  source          TEXT,              -- 生成来源（如 backtest-v2）
  reason          TEXT,              -- 入选理由（中文）
  createdAt       TEXT NOT NULL,     -- 写入时间
  actualEntryPrice REAL,             -- 实盘买入价（次日回填）
  actualHigh       REAL,             -- 次日早盘最高价（次日回填）
  actualExitPrice  REAL,             -- 实际卖出价（次日回填）
  actualRetHigh    REAL,             -- 实际早盘最高涨幅 %（次日回填）
  actualRetExit    REAL,             -- 实际卖出收益 %（次日回填）
  hit3             INTEGER,          -- 实际是否达到 ≥+3%（0/1，次日回填）
  settledAt        TEXT,             -- 结果回填时间
  UNIQUE (tradeDate, code)
);

CREATE INDEX IF NOT EXISTS idx_bt_decision_date ON bt_decision (tradeDate);
CREATE INDEX IF NOT EXISTS idx_bt_decision_code ON bt_decision (code, tradeDate);
CREATE INDEX IF NOT EXISTS idx_bt_decision_hit  ON bt_decision (hit3);
'''


def do_emit_ddl(path: str = DECISION_DDL_PATH) -> str:
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(DECISION_DDL)
    log(f'实盘凭据表 DDL 已写出：{path}')
    print(DECISION_DDL)
    return path


FIELD_DICT_PATH = os.path.join(ROOT, 'docs', '2026-09-21-回测字段字典-352字段.md')

TABLE_ORDER = ['bt_meta', 'bt_dataset', 'bt_run', 'bt_reverse_sample',
               'bt_reverse_feature', 'bt_trade', 'bt_trade_tf',
               'bt_pattern_def', 'bt_market_day', 'bt_sector_day',
               'bt_concept_map', 'bt_trade_context', 'bt_stat', 'bt_time_grid',
               'bt_time_marginal', 'bt_rule', 'bt_feature_def']

TABLE_CN = {
    'bt_meta': '库元信息', 'bt_dataset': '数据集覆盖', 'bt_run': '回测批次',
    'bt_reverse_sample': '14:40 反推逐笔原始采样（无形态，95 列）',
    'bt_reverse_feature': '反推模型入模特征（58 条）',
    'bt_trade': '逐笔明细（含尾盘特征与次日结果）',
    'bt_trade_tf': '逐笔多周期形态快照（5/15/30/60 分钟）',
    'bt_pattern_def': '形态字典', 'bt_market_day': '每日全市场温度',
    'bt_sector_day': '行业/板块×日温度', 'bt_concept_map': '个股×概念映射（预留）',
    'bt_trade_context': '逐笔环境快照', 'bt_stat': '统计结果',
    'bt_time_grid': '买卖时点网格', 'bt_time_marginal': '时点边际',
    'bt_rule': '规则扫描', 'bt_feature_def': '字段字典（本表）',
}


def do_emit_field_dict(conn: sqlite3.Connection, path: str = FIELD_DICT_PATH) -> str:
    """把 bt_feature_def 的字段登记渲染成中文 Markdown 字典。"""
    if not table_exists(conn, 'bt_feature_def'):
        log('bt_feature_def 不存在，请先执行 --init')
        return path
    rows = conn.execute(
        'SELECT tableName, columnName, nameCn, meaning, unit, valueScope, source, '
        'calcRule, isFeature FROM bt_feature_def').fetchall()
    by_table: dict[str, dict[str, tuple]] = {}
    for r in rows:
        by_table.setdefault(r[0], {})[r[1]] = r
    order = [t for t in TABLE_ORDER if t in by_table]
    order += [t for t in by_table if t not in order]

    lines = [f'# 智诊盯盘 · 尾盘买入回测库字段字典（{len(rows)} 字段中文注释）', '',
             '由 `python tools/backtest_store.py --emit-field-dict` 从 `bt_feature_def` '
             '自动渲染，字段与表结构一一对应。',
             '', f'共 {len(rows)} 个字段登记，覆盖 {len(order)} 张表。', '']
    for t in order:
        cols = [c[1] for c in conn.execute(f'PRAGMA table_info({t})')]
        d = by_table[t]
        listed = [c for c in cols if c in d] + [c for c in d if c not in cols]
        lines += [f'## {t} · {TABLE_CN.get(t, "")}（{len(listed)} 字段）', '',
                  '| 字段 | 中文名 | 含义 | 单位 | 取值 | 来源 | 是否特征 |',
                  '| --- | --- | --- | --- | --- | --- | --- |']
        for c in listed:
            r = d[c]
            feat = '✔' if r[8] else ''
            lines.append(f'| `{r[1]}` | {r[2] or ""} | {r[3] or ""} | {r[4] or ""} | '
                         f'{r[5] or ""} | {r[6] or ""} | {feat} |')
        lines.append('')
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(lines) + '\n')
    log(f'字段字典已写出：{path}（{len(rows)} 字段 / {len(order)} 表）')
    return path


# ---------------------------------------------------------------- CLI
def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description='尾盘买入回测结果入库（智诊盯盘）')
    ap.add_argument('--db', default=DEFAULT_DB, help='回测结果库（默认 data/backtest.db）')
    ap.add_argument('--init', action='store_true', help='建表 + 灌元数据/形态字典/字段字典')
    ap.add_argument('--check', action='store_true', help='表结构与字段字典一致性检查')
    ap.add_argument('--import-daily', action='store_true', help='导入日线近似批次')
    ap.add_argument('--import-daily-stats', action='store_true',
                    help='只刷新日线批次分档统计与规则表（不动 bt_trade 明细）')
    ap.add_argument('--import-minute', action='store_true', help='导入分钟精确批次')
    ap.add_argument('--import-grid', action='store_true', help='导入时间网格批次')
    ap.add_argument('--import-tf', action='store_true',
                    help='导入多周期（5/15/30/60 分钟）形态批次的统计结果')
    ap.add_argument('--import-market', action='store_true', help='扫描并导入市场/板块温度')
    ap.add_argument('--import-reverse', action='store_true',
                    help='导入第三套策略：14:40 分时反推批次（当前唯一在库批次）')
    ap.add_argument('--purge-legacy', action='store_true',
                    help='清出旧口径回测结果（保留市场/板块温度与数据集字典），随后 VACUUM')
    ap.add_argument('--link', action='store_true', help='把温度回填到 bt_trade 并重建上下文')
    ap.add_argument('--verify', action='store_true', help='关键数字一致性核对')
    ap.add_argument('--max-stocks', type=int, default=None, help='扫描日线时只取前 N 只（冒烟）')
    ap.add_argument('--emit-decision-ddl', nargs='?', const=DECISION_DDL_PATH, default=None,
                    metavar='PATH', help='输出 bt_decision 建表 DDL')
    ap.add_argument('--emit-field-dict', nargs='?', const=FIELD_DICT_PATH, default=None,
                    metavar='PATH', help='输出字段中文名字典（Markdown）')
    args = ap.parse_args(argv)

    if args.emit_decision_ddl:
        do_emit_ddl(args.emit_decision_ddl)
        if not any([args.init, args.check, args.import_daily, args.import_minute,
                    args.import_grid, args.import_tf, args.import_market, args.link,
                    args.verify, args.emit_field_dict, args.import_daily_stats,
                    args.import_reverse, args.purge_legacy]):
            return 0

    conn = connect(args.db)
    try:
        if args.init:
            log(f'建表 / 灌元数据：{args.db}')
            do_init(conn)
            for k, v in table_counts(conn).items():
                print(f'  {k:<20} {v:>8}')
        if args.purge_legacy:
            do_purge_legacy(conn)
        if args.check:
            issues = check_schema(conn)
            if issues:
                print(f'== 结构检查：{len(issues)} 个问题')
                for i in issues:
                    print('  -', i)
            else:
                print('== 结构检查：0 个问题（字段字典与表结构完全一致）')
            if table_exists(conn, 'bt_feature_def'):
                fdict = int(conn.execute('SELECT COUNT(*) FROM bt_feature_def').fetchone()[0])
                print(f'   bt_feature_def 共 {fdict} 个字段登记')
        if args.import_daily:
            do_import_daily(conn)
        if args.import_daily_stats:
            do_import_daily_stats(conn)
        if args.import_minute:
            do_import_minute(conn)
        if args.import_grid:
            do_import_grid(conn)
        if args.import_tf:
            do_import_tf(conn)
        if args.import_market:
            do_import_market(conn, max_stocks=args.max_stocks)
        if args.import_reverse:
            do_import_reverse(conn)
        if args.link:
            link_context(conn)
        if args.emit_field_dict:
            do_emit_field_dict(conn, args.emit_field_dict)
        if args.verify:
            do_verify(conn)
    finally:
        conn.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
