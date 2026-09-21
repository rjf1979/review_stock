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
DAILY_BASE_HIT3 = 21.14        # 日线全样本 ≥+3% 基准（%）
MINUTE_BASE_HIT3 = 22.13       # 分钟精确全样本 ≥+3% 基准（%）
GRID_BASE_HIT3 = 7.49          # 网格样本内最优 ≥+3%（%）仅用于对照

RUN_DAILY = 'daily-20210104-20260917-stockonly-d1'
RUN_MINUTE = 'minute-20260612-20260917-stockonly-d1'
RUN_GRID = 'grid-20260615-20260918-stockonly-d1'
RUN_TF = 'tf-20260612-20260917-stockonly-d1'

ENGINE_VERSION = bt_schema.SCHEMA_VERSION
GENERATOR = bt_schema.GENERATOR

META_NOTE = (
    '回测口径：T 日尾盘 14:30~14:55 买入、T+1 09:30~10:00 卖出；'
    '只含 A 股个股，已剔除银行股、退市股、B 股、ST、科创板、北交所；'
    '统计目标为「次日早盘最高涨幅 ≥ X%」；概念题材本期未接入。'
)

GLOBAL_CAVEATS = [
    '剔除退市股引入幸存者偏差（342 只退市样本里 283 只已停止更新），命中率偏乐观。',
    '名称 / 流通市值 / ST 判定取 2026-09-18 快照回看历史，存在成分漂移。',
    '日线近似口径是上界：同日线近似 ≥3% = 26.09%，分钟精确 = 22.13%，高估约 4pp。',
    '分钟窗口仅 69~70 个交易日且落在 2026 年强势段，不能外推。',
    '换手率用当前流通股本回看历史，存在前视偏差（送转 / 增发失真）。',
    '多周期（5/15/30/60 分钟）形态只在分钟窗口内存在；60 分钟 ma60 需 15 日预热，'
    '有效样本从 2026-07-03 起（约 55 日），本期一律标记 usableForDecision=0。',
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
    """流通股本（万股）≈ 流通市值 / 现价 / 1e4。"""
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


def run_defs() -> list[dict]:
    """bt_run：4 个批次（日线近似 / 分钟精确 / 时间网格 / 多周期形态明细）。"""
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
                 'trades': 5406890, 'dates': '2021-01-04~2026-09-17', 'nDates': 1382,
                 'entryPrice': 'T 日收盘价（14:30 的日线近似）',
                 'sellPrice': 'T+1 开盘价（ret_high 用 T+1 早盘最高价）',
                 'detailSample': 'trade_sample.csv（10.8 万笔分层抽样）已入库',
                 'baseHit3Pct': DAILY_BASE_HIT3,
                 'exclude': common['exclude'],
             }),
             tradeCount=5406890,
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
                 'turnoverSource': '截至 14:30 的分钟成交量 ÷ 流通股本（股本由 2026-09-18 快照反推，前视）',
                 'extraWarmup': '60 分钟 ma60 需 15 个交易日预热，有效样本自 2026-07-03 起约 55 日',
                 'baseHit3Pct': MINUTE_BASE_HIT3,
                 'exclude': common['exclude'],
             }),
             tradeCount=292685,
             note='多周期形态快照（5/15/30/60 分钟）+ 逐笔明细；分钟窗口仅 69 日且落在强势段，'
                  'usableForDecision=0，不可直接用于实盘决策。'),
    ]


def do_init(conn: sqlite3.Connection) -> None:
    bt_schema.create_schema(conn)
    created = now_iso()
    cov1 = load_json(COV[1]) if os.path.exists(COV[1]) else {}
    meta = [
        ('schemaVersion', bt_schema.SCHEMA_VERSION),
        ('createdAt', created),
        ('generator', GENERATOR),
        ('buyWindow', '1430-1455'),
        ('sellWindow', '0930-1000'),
        ('tdxMinuteAsOfBars', '1430'),
        ('minuteWindow', f'{cov1.get("date_min", "")}-{cov1.get("date_max", "")}'),
        ('dayWindow', '19901219-20260918'),
        ('note', META_NOTE),
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

    feats = bt_schema.feature_rows()
    conn.executemany(
        'INSERT INTO bt_feature_def (tableName, columnName, nameCn, meaning, unit, '
        'valueScope, source, calcRule, isFeature) VALUES (?,?,?,?,?,?,?,?,?) '
        'ON CONFLICT(tableName, columnName) DO UPDATE SET nameCn=excluded.nameCn,'
        'meaning=excluded.meaning, unit=excluded.unit, valueScope=excluded.valueScope,'
        'source=excluded.source, calcRule=excluded.calcRule, isFeature=excluded.isFeature',
        feats)

    runs = run_defs()
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
    conn.commit()


def table_counts(conn: sqlite3.Connection) -> dict[str, int]:
    out: dict[str, int] = {}
    for (name,) in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'bt_%' "
            'ORDER BY name'):
        out[name] = int(conn.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0])
    return out


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
    'turnover': '换手率分桶（成交量 ÷ 流通股本，floatcap_approx 前视口径）',
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
    turnover = None
    if fmy and amt and fmy > 0:
        turnover = round(amt / (fmy * 100.0), 4)
    d = {
        'runId': rid, 'code': code, 'name': str(row.get('name') or ''),
        'board': str(row.get('board') or ''), 'date': ymd(row.get('date')),
        # 日线近似口径的「买入」实际是当日收盘价，因此 entryTime 记 1500（非尾盘 14:30）
        'entryTime': 1500, 'entryPrice': fnum(row.get('close')),
        'close': fnum(row.get('close')), 'pct': fnum(row.get('pct')),
        'amp': fnum(row.get('amp')), 'closePos': fnum(row.get('close_pos')),
        'upperShadow': fnum(row.get('upper_shadow')),
        'lowerShadow': fnum(row.get('lower_shadow')),
        'turnoverPct': turnover, 'turnoverSrc': 'floatcap_approx',
        'floatSharesWan': float_shares_wan(snap), 'volRatio': fnum(row.get('vol_ratio')),
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
    keys = list(run_keys or [RUN_DAILY, RUN_MINUTE, RUN_GRID, RUN_TF])
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


# ---------------------------------------------------------------- 批次导入
def do_import_daily(conn: sqlite3.Connection) -> None:
    rid = run_id(conn, RUN_DAILY)
    log(f'[日线近似] runId={rid}  源={DAILY_DIR}')
    import_stats_from_dir(conn, rid, DAILY_DIR, DAILY_BASE_HIT3, tag='日线近似',
                          dim_notes=DAILY_DIM_NOTES)
    import_daily_trades(conn, rid)
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
VERIFY_SPECS = [
    ('日线全样本 ≥3%', RUN_DAILY, 'overall', ('全样本',), 'hit3Pct', 21.14, 0.02),
    ('日线全样本 ≥1%', RUN_DAILY, 'overall', ('全样本',), 'hit1Pct', 57.98, 0.02),
    ('日线全样本 触涨停%', RUN_DAILY, 'overall', ('全样本',), 'limitUpPct', 1.56, 0.05),
    ('日线 2023 年 ≥3%', RUN_DAILY, 'year', ('2023',), 'hit3Pct', 14.76, 0.05),
    ('日线 2021 年 ≥3%', RUN_DAILY, 'year', ('2021',), 'hit3Pct', 23.05, 0.05),
    ('日线 2022 年 ≥3%', RUN_DAILY, 'year', ('2022',), 'hit3Pct', 22.42, 0.05),
    ('日线 2024 年 ≥3%', RUN_DAILY, 'year', ('2024',), 'hit3Pct', 24.03, 0.05),
    ('日线 2025 年 ≥3%', RUN_DAILY, 'year', ('2025',), 'hit3Pct', 19.44, 0.05),
    ('日线 2026 年 ≥3%', RUN_DAILY, 'year', ('2026',), 'hit3Pct', 24.22, 0.05),
    ('分钟精确全样本 ≥3%', RUN_MINUTE, 'overall', ('分钟精确',), 'hit3Pct', 22.13, 0.02),
    ('分钟精确全样本 ≥5%', RUN_MINUTE, 'overall', ('分钟精确',), 'hit5Pct', 9.51, 0.05),
    ('分钟对照 日线近似 ≥3%', RUN_MINUTE, 'overall', ('日线近似',), 'hit3Pct', 26.09, 0.02),
    ('多周期全样本 ≥3%', RUN_TF, 'overall', ('全样本',), 'hit3Pct', 22.14, 0.05),
    ('多周期创业板 ≥3%', RUN_TF, 'board', ('创业板',), 'hit3Pct', 26.87, 0.05),
    ('多周期 tf_align=partial ≥3%', RUN_TF, 'tf_align', ('partial',), 'hit3Pct', 22.18, 0.05),
    ('多周期 60m 主形态 rsi_low_turn ≥3%', RUN_TF, 'tf60_primary', ('rsi_low_turn',),
     'hit3Pct', 32.93, 0.05),
]


def do_verify(conn: sqlite3.Connection) -> int:
    bad = 0

    def show(label, got, want, ok):
        nonlocal bad
        mark = 'OK  ' if ok else 'FAIL'
        if not ok:
            bad += 1
        print(f'  [{mark}] {label:<22} 库内={got}  期望={want}')

    print('== 关键数字核对')
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

    d = conn.execute('SELECT COUNT(*) FROM bt_trade t JOIN bt_run r ON r.runId=t.runId '
                     'WHERE r.runKey=?', (RUN_DAILY,)).fetchone()[0]
    show('日线明细入样行数', d, 108479, d == 108479)

    blank_day = conn.execute(
        'SELECT COUNT(*) FROM bt_trade t JOIN bt_run r ON r.runId=t.runId '
        'WHERE r.runKey=? AND (t.dayShape IS NULL OR t.channelType IS NULL)',
        (RUN_DAILY,)).fetchone()[0]
    show('日线形态位置空值行', blank_day, 0, blank_day == 0)
    for dim, want in (('day_shape', 6), ('channel', 3), ('pos120', 5)):
        got = conn.execute(
            'SELECT COUNT(*) FROM bt_stat s JOIN bt_run r ON r.runId=s.runId '
            'WHERE r.runKey=? AND s.dimension=?', (RUN_DAILY, dim)).fetchone()[0]
        show(f'日线 bt_stat[{dim}] 档数', got, f'>={want}', got >= want)

    row = conn.execute(
        'SELECT COUNT(*) FROM bt_trade t JOIN bt_run r ON r.runId=t.runId '
        'WHERE r.runKey=?', (RUN_TF,)).fetchone()[0]
    if row:
        show('多周期明细笔数', row, 292685, abs(row - 292685) <= 5)
        ttf = conn.execute(
            'SELECT COUNT(*) FROM bt_trade_tf f JOIN bt_run r ON r.runId=f.runId '
            'WHERE r.runKey=?', (RUN_TF,)).fetchone()[0]
        show('多周期快照行数', ttf, row * 4, ttf == row * 4)
        blank = conn.execute(
            'SELECT COUNT(*) FROM bt_trade t JOIN bt_run r ON r.runId=t.runId '
            'WHERE r.runKey=? AND (t.tfAlign IS NULL OR t.dayShape IS NULL '
            'OR t.turnoverPct IS NULL OR t.nextHigh IS NULL)', (RUN_TF,)).fetchone()[0]
        show('多周期字段空值行', blank, 0, blank == 0)

    for label, sql, want, tol in [
        ('bt_pattern_def 条数', 'SELECT COUNT(*) FROM bt_pattern_def', 139, 0),
        ('bt_feature_def 条数', 'SELECT COUNT(*) FROM bt_feature_def', 250, 0),
        ('bt_time_grid 组合数', 'SELECT COUNT(*) FROM bt_time_grid', 806, 0),
        ('bt_sector_day 行业数',
         'SELECT COUNT(DISTINCT boardId) FROM bt_sector_day', 110, 0),
    ]:
        got = conn.execute(sql).fetchone()[0]
        ok = (abs(got - want) <= tol) if tol else (got == want)
        show(label, got, want, ok)

    got = conn.execute('SELECT COUNT(*) FROM bt_market_day').fetchone()[0]
    show('bt_market_day 交易日数', got, '>=1900', got >= 1900)

    for b, s, want in ((1430, 930, -0.1295), (1430, 1000, -0.0328)):
        row = conn.execute(
            'SELECT g.retMeanPct FROM bt_time_grid g JOIN bt_run r ON r.runId=g.runId '
            'WHERE r.runKey=? AND g.buyMinute=? AND g.sellMinute=?',
            (RUN_GRID, b, s)).fetchone()
        got = None if row is None else row[0]
        ok = got is not None and abs(got - want) <= 0.001
        show(f'网格 {b}→{s} 均收%', got, want, ok)

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
  suggestedBuyTime  INTEGER,         -- 建议买入时刻 HHMM（14:30~14:55）
  suggestedSellTime INTEGER,         -- 建议卖出时刻 HHMM（09:30~10:00）
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


FIELD_DICT_PATH = os.path.join(ROOT, 'docs', '2026-09-21-回测字段字典-250字段.md')

TABLE_ORDER = ['bt_meta', 'bt_dataset', 'bt_run', 'bt_trade', 'bt_trade_tf',
               'bt_pattern_def', 'bt_market_day', 'bt_sector_day',
               'bt_concept_map', 'bt_trade_context', 'bt_stat', 'bt_time_grid',
               'bt_time_marginal', 'bt_rule', 'bt_feature_def']

TABLE_CN = {
    'bt_meta': '库元信息', 'bt_dataset': '数据集覆盖', 'bt_run': '回测批次',
    'bt_trade': '逐笔明细（含尾盘特征与次日结果）',
    'bt_trade_tf': '逐笔多周期形态快照（5/15/30/60 分钟）',
    'bt_pattern_def': '形态字典', 'bt_market_day': '每日全市场温度',
    'bt_sector_day': '行业/板块×日温度', 'bt_concept_map': '个股×概念映射（预留）',
    'bt_trade_context': '逐笔环境快照', 'bt_stat': '统计结果',
    'bt_time_grid': '买卖时点网格', 'bt_time_marginal': '时点边际',
    'bt_rule': '规则扫描', 'bt_feature_def': '字段字典（本表）',
}


def do_emit_field_dict(conn: sqlite3.Connection, path: str = FIELD_DICT_PATH) -> str:
    """把 bt_feature_def 的 250 条字段登记渲染成中文 Markdown 字典。"""
    rows = conn.execute(
        'SELECT tableName, columnName, nameCn, meaning, unit, valueScope, source, '
        'calcRule, isFeature FROM bt_feature_def').fetchall()
    by_table: dict[str, dict[str, tuple]] = {}
    for r in rows:
        by_table.setdefault(r[0], {})[r[1]] = r
    order = [t for t in TABLE_ORDER if t in by_table]
    order += [t for t in by_table if t not in order]

    lines = ['# 智诊盯盘 · 尾盘买入回测库字段字典（250 字段中文注释）', '',
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
    ap.add_argument('--import-minute', action='store_true', help='导入分钟精确批次')
    ap.add_argument('--import-grid', action='store_true', help='导入时间网格批次')
    ap.add_argument('--import-tf', action='store_true',
                    help='导入多周期（5/15/30/60 分钟）形态批次的统计结果')
    ap.add_argument('--import-market', action='store_true', help='扫描并导入市场/板块温度')
    ap.add_argument('--link', action='store_true', help='把温度回填到 bt_trade 并重建上下文')
    ap.add_argument('--verify', action='store_true', help='关键数字一致性核对')
    ap.add_argument('--max-stocks', type=int, default=None, help='扫描日线时只取前 N 只（冒烟）')
    ap.add_argument('--emit-decision-ddl', nargs='?', const=DECISION_DDL_PATH, default=None,
                    metavar='PATH', help='输出 bt_decision 建表 DDL')
    ap.add_argument('--emit-field-dict', nargs='?', const=FIELD_DICT_PATH, default=None,
                    metavar='PATH', help='输出 250 字段中文名字典（Markdown）')
    args = ap.parse_args(argv)

    if args.emit_decision_ddl:
        do_emit_ddl(args.emit_decision_ddl)
        if not any([args.init, args.check, args.import_daily, args.import_minute,
                    args.import_grid, args.import_tf, args.import_market, args.link,
                    args.verify, args.emit_field_dict]):
            return 0

    conn = connect(args.db)
    try:
        if args.init:
            log(f'建表 / 灌元数据：{args.db}')
            do_init(conn)
            for k, v in table_counts(conn).items():
                print(f'  {k:<20} {v:>8}')
        if args.check:
            issues = check_schema(conn)
            if issues:
                print(f'== 结构检查：{len(issues)} 个问题')
                for i in issues:
                    print('  -', i)
            else:
                print('== 结构检查：0 个问题（字段字典与表结构完全一致）')
            fdict = int(conn.execute('SELECT COUNT(*) FROM bt_feature_def').fetchone()[0])
            print(f'   bt_feature_def 共 {fdict} 个字段登记')
        if args.import_daily:
            do_import_daily(conn)
        if args.import_minute:
            do_import_minute(conn)
        if args.import_grid:
            do_import_grid(conn)
        if args.import_tf:
            do_import_tf(conn)
        if args.import_market:
            do_import_market(conn, max_stocks=args.max_stocks)
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
