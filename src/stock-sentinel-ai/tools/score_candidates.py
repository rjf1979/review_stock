# -*- coding: utf-8 -*-
"""尾盘选股概率评分：把「T 日尾盘」个股特征组装成决策模型输入并打分。

口径与回测（``decision_model.json``，v2 起携带 regimeBases）完全对齐：特征顺序、
分档、锚定方式均复用 ``bt_decision_engine.py``，本脚本只负责**组装 31 个特征**。
实盘锚定基准只从模型文件读，不按 runId 去 bt_stat 里取（库中批次可被清出，取错批次会让
界面显示的基准与真正算概率用的基准不一致）。

两种 T 日口径（写入 JSON 的 ``caliber`` 字段，实盘凭据必须携带）：

* ``daily_close``：``data/hsjday`` 已含 T 日日线（通达信盘后下载 + ``extend_hsjday.py``），
  与模型训练口径一致（训练用 T 日收盘价近似 14:30 价，entryTime=1500）。
* ``intraday_snapshot``：T 日日线尚未落盘时，用实时快照合成 T 日伪日线（14:30 盘中价
  或收盘价），属于**口径漂移**，只能作为盘中参考，不得与回测命中率直接比较。

数据来源（全部本地优先，只有候选股行情走东财实时接口）：

* 个股历史日线 / 行业板块指数 / 沪深300：``data/hsjday``（回退通达信 ``vipdoc``）
* 全市场快照（广度、板块聚合）：``data/snapshots/<YYYY-MM-DD>__*.json``
* 盘中环境（情绪、涨停结构）：``data/market-prescan.json``
* 行业分类：``{tdx}/T0002/hq_cache/tdxhy.cfg``
* 历史成交额（amountRatio5）：``data/backtest.db`` 的 ``bt_market_day``

用法::

    python tools/score_candidates.py --codes 600000,000001 --out-json data/backtest/live_score.json
    python tools/score_candidates.py --codes-file codes.txt --date 20260918 --verify-bt
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sqlite3
import sys
import urllib.request
from collections import defaultdict
from types import SimpleNamespace

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..'))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bt_decision_engine as eng  # noqa: E402
import day_shape  # noqa: E402
from float_shares import ShareBook  # noqa: E402
from indicators import compute_indicators, limit_ratio, limit_ratio_series  # noqa: E402
from kdata import BAR_DT, Market, board_of, is_stock, market_of  # noqa: E402
from tdx_names import load_tdx_names  # noqa: E402
from tdx_sector import load_board_names, load_board_series, load_industry_map  # noqa: E402

SNAP_DIR = os.path.join(ROOT, 'data', 'snapshots')
PRESCAN_PATH = os.path.join(ROOT, 'data', 'market-prescan.json')
BT_DB = os.path.join(ROOT, 'data', 'backtest.db')
BT_DIR = os.path.join(ROOT, 'data', 'backtest')
BENCH_CODE = '000300'
EM_QUOTE_BASE = 'https://push2delay.eastmoney.com/api/qt/ulist.np/get'
QUOTE_FIELDS = 'f12,f14,f2,f3,f5,f6,f8,f10,f15,f16,f17,f18,f21,f124'
QUOTE_CHUNK = 50
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) stock-sentinel-ai/1.0'}


def log(msg: str) -> None:
    print(msg, flush=True)


def ymd_to_date(d: int) -> str:
    return '%04d-%02d-%02d' % (d // 10000, d // 100 % 100, d % 100)


def load_model() -> dict:
    with open(eng.MODEL_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)


# ----------------------------------------------------------------- 快照 / 行情
def load_snapshot(date: int) -> tuple[list[dict], list[str]]:
    """读取某交易日的全市场快照记录（分市场文件合并）。"""
    prefix = ymd_to_date(date)
    if not os.path.isdir(SNAP_DIR):
        return [], []
    files = [f for f in sorted(os.listdir(SNAP_DIR)) if f.startswith(prefix)]
    recs: list[dict] = []
    seen: set[str] = set()
    for fn in files:
        try:
            with open(os.path.join(SNAP_DIR, fn), 'r', encoding='utf-8') as f:
                data = json.load(f)
        except (OSError, ValueError):
            continue
        for rec in data.get('records') or []:
            code = str(rec.get('code') or '')
            if code and code not in seen:
                seen.add(code)
                recs.append(rec)
    return recs, files


def _fetch_json(url: str, timeout: float = 15.0) -> dict:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode('utf-8', 'replace'))


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def fetch_quotes(codes: list[str], timeout: float = 15.0) -> tuple[dict[str, dict], list[dict]]:
    """东财实时行情（含开高低收/昨收/成交量额/换手/量比/流通市值）。"""
    codes = [str(c) for c in codes]
    out: dict[str, dict] = {}
    errors: list[dict] = []
    for i in range(0, len(codes), QUOTE_CHUNK):
        chunk = codes[i:i + QUOTE_CHUNK]
        # 沪深300 等沪市指数不走股票前缀规则，单独指定市场
        secids = ','.join(('1.' + c) if c == BENCH_CODE else
                          (('1.' if c[:1] == '6' else '0.') + c) for c in chunk)
        url = ('%s?secids=%s&fields=%s&fltt=2&invt=2&pn=1&pz=%d'
               % (EM_QUOTE_BASE, secids, QUOTE_FIELDS, QUOTE_CHUNK))
        try:
            data = _fetch_json(url, timeout)
        except Exception as exc:                                  # noqa: BLE001
            errors.append({'codes': chunk, 'error': str(exc)[:160]})
            continue
        diff = ((data or {}).get('data') or {}).get('diff') or []
        for d in diff:
            code = str(d.get('f12') or '')
            if not code:
                continue
            vol = _num(d.get('f5'))
            out[code] = {
                'code': code,
                'name': str(d.get('f14') or ''),
                'price': _num(d.get('f2')),
                'changePct': _num(d.get('f3')),
                'volume': None if vol is None else vol * 100.0,   # 手 → 股
                'amount': _num(d.get('f6')),
                'turnover': _num(d.get('f8')),
                'volumeRatio': _num(d.get('f10')),
                'high': _num(d.get('f15')),
                'low': _num(d.get('f16')),
                'open': _num(d.get('f17')),
                'prevClose': _num(d.get('f18')),
                'floatMcap': _num(d.get('f21')),
                'sourceAt': str(d.get('f124') or ''),
            }
    return out, errors


def quote_date(quote: dict) -> str:
    ts = quote.get('sourceAt') or ''
    if ts.isdigit() and len(ts) >= 8:
        return '%s-%s-%s' % (ts[:4], ts[4:6], ts[6:8])
    return ''


# ----------------------------------------------------------------- 市场 / 板块环境
def market_context(recs: list[dict], prescan: dict, date: int) -> dict:
    """全市场温度：与 bt_market_day 的 tempScore / regime 口径一致。"""
    pcts: list[float] = []
    amt = 0.0
    up = down = flat = strong = weak = 0
    lu = ld = 0
    for rec in recs:
        code = str(rec.get('code') or '')
        if not is_stock(market_of(code), code):
            continue
        p = _num(rec.get('changePct'))
        a = _num(rec.get('amount')) or 0.0
        if p is None:
            continue
        pcts.append(p)
        amt += a
        if p > 0:
            up += 1
        elif p < 0:
            down += 1
        else:
            flat += 1
        if p >= 5.0:
            strong += 1
        if p <= -5.0:
            weak += 1
        lr = limit_ratio(code, str(rec.get('name') or '')) * 100.0
        if p >= lr - 0.8:
            lu += 1
        if p <= -(lr - 0.8):
            ld += 1
    n = len(pcts)
    ctx = {
        'universe': n,
        'upRatio': 100.0 * up / n if n else None,
        'downRatio': down / n if n else None,
        'up5Ratio': 100.0 * strong / n if n else None,
        'strongPct': strong / n if n else None,
        'weakPct': weak / n if n else None,
        'medianPct': float(np.median(np.asarray(pcts, dtype=np.float64))) if n else None,
        'limitUpCnt': lu,
        'limitDownCnt': ld,
        'amountYi': amt / 1e8,
        'limitSource': 'snapshot_pct_rule',
    }
    if prescan and int(prescan.get('marketRegime', {}).get('asOf', '0').replace('-', '') or 0) == date:
        b = (prescan.get('marketRegime') or {}).get('evidence', {}).get('breadth') or {}
        ls = (prescan.get('marketRegime') or {}).get('evidence', {}).get('limitStructure') or {}
        if b.get('available'):
            ctx['upRatio'] = 100.0 * float(b.get('upRatio') or 0.0)
            ctx['downRatio'] = float(b.get('downRatio') or 0.0)
            ctx['strongPct'] = float(b.get('strongPct') or 0.0)
            ctx['weakPct'] = float(b.get('weakPct') or 0.0)
            ctx['amountYi'] = float(b.get('amountYi') or ctx['amountYi'])
            ctx['up5Ratio'] = ctx['strongPct'] * 100.0
            ctx['limitSource'] = 'prescan_breadth'
        if ls.get('available'):
            ctx['limitUpCnt'] = int(ls.get('limitUpCount') or ctx['limitUpCnt'])
            ctx['limitDownCnt'] = int(ls.get('limitDownCount') or ctx['limitDownCnt'])
            ctx['limitSource'] = ctx['limitSource'] + '+prescan_limit'
    # amountRatio5：与 bt_market_day 的历史总成交额对齐（同口径 T-1 起 5 日均值）
    ratio = None
    try:
        conn = sqlite3.connect('file:%s?mode=ro' % BT_DB, uri=True)
        try:
            rows = conn.execute(
                'SELECT totalAmountYi FROM bt_market_day WHERE date < ? '
                'ORDER BY date DESC LIMIT 5', (date,)).fetchall()
        finally:
            conn.close()
        prev = [float(r[0]) for r in rows if r[0]]
        if len(prev) >= 5 and float(np.mean(prev)) > 0:
            ratio = ctx['amountYi'] / float(np.mean(prev))
    except sqlite3.Error:
        ratio = None
    ctx['amountRatio5'] = ratio
    up_r = (ctx['upRatio'] or 0.0) / 100.0
    med = ctx['medianPct'] or 0.0
    amt_ratio = 1.0 if ratio is None else ratio
    ctx['tempScore'] = (0.4 * up_r
                        + 0.2 * min(ctx['limitUpCnt'] / 120.0, 1.5)
                        + 0.2 * min(max((med + 2.0) / 4.0, 0.0), 1.5)
                        + 0.2 * min(amt_ratio, 2.0) / 2.0)
    status = ''
    if prescan:
        reg = prescan.get('marketRegime') or {}
        if str(reg.get('asOf') or '') == ymd_to_date(date):
            status = str(reg.get('status') or '')
    if not status:
        from backtest_store import classify_regime
        status = classify_regime(ctx['upRatio'], ctx['downRatio'], ctx['weakPct'] or 0.0,
                                 ctx['strongPct'] or 0.0, None,
                                 ctx['limitUpCnt'], ctx['limitDownCnt'])
        ctx['regimeSource'] = 'computed'
    else:
        ctx['regimeSource'] = 'prescan'
    ctx['regime'] = status
    return ctx


def sector_context(recs: list[dict], hy_map: dict, board_series: dict, date: int) -> dict:
    """板块温度：成分广度用当日快照，板块指数用日线（T 日缺失则用成分加权涨幅合成）。"""
    agg: dict[str, dict] = {}
    for rec in recs:
        code = str(rec.get('code') or '')
        if not is_stock(market_of(code), code):
            continue
        hy = hy_map.get(code) or {}
        board = hy.get('board') or ''
        p = _num(rec.get('changePct'))
        if not board or p is None:
            continue
        s = agg.get(board)
        if s is None:
            s = agg[board] = {'n': 0, 'up': 0, 'lu': 0, 'w': 0.0, 'wp': 0.0,
                              'amt': 0.0, 'name': hy.get('hy_name') or ''}
        s['n'] += 1
        s['amt'] += _num(rec.get('amount')) or 0.0
        if p > 0:
            s['up'] += 1
        lr = limit_ratio(code, str(rec.get('name') or '')) * 100.0
        if p >= lr - 0.8:
            s['lu'] += 1
        w = _num(rec.get('floatMcap')) or 0.0
        s['w'] += w
        s['wp'] += w * p
    boards = sorted(agg)
    names = load_board_names()
    series = load_board_series(boards) if boards else {}
    out: dict[str, dict] = {}
    heat_all: list[tuple[str, float]] = []
    for b in boards:
        s = agg[b]
        up_ratio = 100.0 * s['up'] / s['n'] if s['n'] else None
        pct = (s['wp'] / s['w']) if s['w'] > 0 else None
        ret5 = ret20 = None
        ser = series.get(b) or {}
        sd = ser.get('date')
        sc = ser.get('close')
        if sd is not None and len(sd):
            pos_end = int(np.searchsorted(sd, date, side='right')) - 1
            dates = np.asarray(sd, dtype=np.int64)
            closes = np.asarray(sc, dtype=np.float64)
            if pos_end < len(sd) - 1 and pct is not None:
                # T 日板块指数尚未落盘：用成分加权涨幅合成一根伪 bar（同 000300 的处理）
                base_close = closes[-1]
                dates = np.append(dates, np.int64(date))
                closes = np.append(closes, base_close * (1.0 + pct / 100.0))
                pos_end = len(dates) - 1
            if pos_end >= 1 and closes[pos_end - 1] > 0:
                pct = (closes[pos_end] / closes[pos_end - 1] - 1.0) * 100.0
            if pos_end >= 5 and closes[pos_end - 5] > 0:
                ret5 = (closes[pos_end] / closes[pos_end - 5] - 1.0) * 100.0
            if pos_end >= 20 and closes[pos_end - 20] > 0:
                ret20 = (closes[pos_end] / closes[pos_end - 20] - 1.0) * 100.0
        heat = None
        if pct is not None and up_ratio is not None:
            heat = (0.5 * pct + 0.4 * (up_ratio - 50.0) / 50.0 * 2.0
                    + 0.1 * min(s['lu'] / 5.0, 2.0))
            heat_all.append((b, heat))
        out[b] = {
            'board': b, 'name': (names.get(b) or {}).get('name') or s['name'],
            'constituents': s['n'], 'pct': pct, 'ret5': ret5, 'ret20': ret20,
            'upRatio': up_ratio, 'limitUpCnt': s['lu'], 'heat': heat, 'heatPct': None,
        }
    if len(heat_all) >= 2:
        vals = np.asarray([v for _b, v in heat_all], dtype=np.float64)
        ordv = np.argsort(np.argsort(vals))
        k = len(heat_all) - 1
        for i, (b, _v) in enumerate(heat_all):
            out[b]['heatPct'] = 100.0 * ordv[i] / k
    elif heat_all:
        out[heat_all[0][0]]['heatPct'] = 100.0
    return out


def bench_pct(quotes: dict[str, dict], date: int) -> tuple[float | None, str]:
    """基准涨幅：历史日期必须取指数序列，实时快照只代表「当天」。

    实时行情接口返回的是最新价，回看历史日期时会把今天的涨幅当成 T 日基准，
    与 bt_trade.benchPct（来自 000300 指数序列）产生 1 个百分点级漂移。
    """
    from datetime import datetime
    today = int(datetime.now().strftime('%Y%m%d'))
    q = quotes.get(BENCH_CODE)
    q_pct = float(q['changePct']) if (q and q.get('changePct') is not None) else None

    def _series() -> float | None:
        ser = load_board_series([BENCH_CODE]).get(BENCH_CODE) or {}
        sd = ser.get('date')
        if sd is not None and len(sd):
            pos = int(np.searchsorted(np.asarray(sd, dtype=np.int64), date, side='right')) - 1
            if pos >= 1 and ser['close'][pos - 1] > 0:
                return float(ser['close'][pos] / ser['close'][pos - 1] - 1.0) * 100.0
        return None

    if date >= today:
        if q_pct is not None:
            return q_pct, 'quote'
        v = _series()
        return (v, 'index_series') if v is not None else (None, 'missing')
    v = _series()
    if v is not None:
        return v, 'index_series'
    return (q_pct, 'quote') if q_pct is not None else (None, 'missing')


# ----------------------------------------------------------------- 个股特征
def _clean_feature(v):
    """JSON 输出用：数值保留有限值，字符串（形态/板块/行业/标志）原样透传。"""
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, str):
        return v or None
    try:
        fv = float(v)
    except (TypeError, ValueError):
        return None
    return fv if math.isfinite(fv) else None


def _append_bar(arr: np.ndarray, date: int, o: float, h: float, l: float, c: float,
                volume: float, amount: float) -> np.ndarray:
    bar = np.zeros(1, dtype=BAR_DT)
    bar['date'] = date
    bar['open'], bar['high'], bar['low'], bar['close'] = o, h, l, c
    bar['volume'], bar['amount'], bar['turnover'] = volume, amount, np.nan
    return np.concatenate([arr.astype(BAR_DT), bar])


def build_row(code: str, date: int, market: Market, factors: dict, book: ShareBook,
              names: dict, hy_map: dict, sectors: dict, mkt: dict, bench: float | None,
              quote: dict | None) -> tuple[dict, list[str]]:
    """单只个股 T 日特征（键名与模型一致）。"""
    notes: list[str] = []
    if not market.meta(code):
        # 次新股/未纳入本地日线库的代码：无历史 → 无法按回测口径打分
        return {}, ['无本地日线文件（次新或未覆盖）']
    raw = market.raw(code)
    if raw is None or not len(raw):
        return {}, ['无日线数据']
    qfq_all = market.load(code, 'qfq', factors.get(code))
    raw = raw[raw['date'] <= date].astype(BAR_DT)
    qfq_all = qfq_all[qfq_all['date'] <= date].astype(BAR_DT)
    if not len(raw):
        return {}, ['无 %d 之前的日线' % date]
    if int(raw['date'][-1]) < date:
        if not quote or quote.get('price') in (None, 0):
            return {}, ['T 日日线缺失且无实时行情，无法合成']
        if None in (quote.get('open'), quote.get('high'), quote.get('low')):
            return {}, ['T 日日线缺失且实时行情无开高低，无法合成']
        f_last = (qfq_all['close'][-1] / raw['close'][-1]) if raw['close'][-1] > 0 else 1.0
        raw = _append_bar(raw, date, quote['open'], quote['high'], quote['low'],
                          quote['price'], quote.get('volume') or 0.0,
                          quote.get('amount') or 0.0)
        qfq_all = _append_bar(qfq_all, date, quote['open'] / f_last, quote['high'] / f_last,
                              quote['low'] / f_last, quote['price'] / f_last,
                              quote.get('volume') or 0.0, quote.get('amount') or 0.0)
        notes.append('synthetic_bar')
    elif int(raw['date'][-1]) > date:
        notes.append('truncated_to_target')
    # 复权后与原始等长（截断后重新对齐）
    if len(qfq_all) != len(raw):
        qfq_all = qfq_all[-len(raw):] if len(qfq_all) > len(raw) else qfq_all
    i = len(raw) - 1
    if i < 120:
        return {}, ['历史不足 120 根日线']
    ind = compute_indicators(qfq_all, code, str(names.get(code) or ''))
    c = ind['close'][i]
    if not np.isfinite(c) or c <= 0:
        return {}, ['收盘价异常']
    c_raw = float(raw['close'][i])
    o_raw, h_raw, l_raw = float(raw['open'][i]), float(raw['high'][i]), float(raw['low'][i])
    rng = max(h_raw - l_raw, 1e-9)
    v = ind['volume'][i]
    vma5 = ind['vma5'][i]
    lmt_all = limit_ratio_series(code, raw['high'], raw['low'], raw['close'])
    lmt = float(lmt_all[i])
    shares, share_src = book.shares_series(code, np.asarray(raw['date'], dtype=np.int64))
    sh = float(shares[i]) if len(shares) and np.isfinite(shares[i]) else np.nan
    if not np.isfinite(sh) and quote and quote.get('floatMcap'):
        sh = float(quote['floatMcap']) / c_raw / 1e4
        share_src = 'quote_backout'
    prev_raw = float(raw['close'][i - 1])
    feats = {
        'pct': float(ind['pct'][i]),
        'amp': float(ind['amp'][i]),
        'closePos': (c_raw - l_raw) / rng,
        'turnoverPct': (v / (sh * 1e4) * 100.0) if (np.isfinite(sh) and sh > 0) else np.nan,
        'volRatio': (v / vma5) if (np.isfinite(vma5) and vma5 > 0) else np.nan,
        'amountWan': float(raw['amount'][i]) / 1e4,
        'floatMcapYi': (sh * c_raw / 1e4) if np.isfinite(sh) else np.nan,
        'rsi14': float(ind['rsi14'][i]),
        'atrPct': float(ind['atr14'][i] / c * 100.0),
        # 以下 6 个特征在回测里以**百分数**入库（与模型分档边界一致），不可写成小数
        'bias20': float(c / ind['ma20'][i] - 1.0) * 100.0 if ind['ma20'][i] > 0 else np.nan,
        'bias60': float(c / ind['ma60'][i] - 1.0) * 100.0 if ind['ma60'][i] > 0 else np.nan,
        'ret5': float(c / ind['close'][i - 5] - 1.0) * 100.0 if ind['close'][i - 5] > 0 else np.nan,
        'ret20': float(c / ind['close'][i - 20] - 1.0) * 100.0 if ind['close'][i - 20] > 0 else np.nan,
        'ret60': float(c / ind['close'][i - 60] - 1.0) * 100.0 if ind['close'][i - 60] > 0 else np.nan,
        'distHh20': float(c / ind['hh20'][i] - 1.0) * 100.0 if ind['hh20'][i] > 0 else np.nan,
        'listDays': float(i),
        'marketTemp': float(mkt['tempScore']),
        'benchPct': float(bench) if bench is not None else np.nan,
        'board': board_of(code),
        'industry': (hy_map.get(code) or {}).get('hy_name') or '未知',
        'marketRegime': mkt['regime'],
    }
    touched = (h_raw >= round(prev_raw * (1.0 + lmt), 2) - 1e-6) and not bool(ind['is_limit_up'][i])
    feats['flag'] = 'T日触板未封' if touched else '普通'
    hy = hy_map.get(code) or {}
    sec = sectors.get(hy.get('board') or '')
    if sec:
        feats['sectorPct'] = sec['pct'] if sec['pct'] is not None else np.nan
        feats['sectorRet5'] = sec['ret5'] if sec['ret5'] is not None else np.nan
        feats['sectorRet20'] = sec['ret20'] if sec['ret20'] is not None else np.nan
        feats['sectorHeat'] = sec['heat'] if sec['heat'] is not None else np.nan
        feats['sectorUpRatio'] = sec['upRatio'] if sec['upRatio'] is not None else np.nan
        feats['sectorLimitUpCnt'] = float(sec['limitUpCnt'])
    else:
        for k in ('sectorPct', 'sectorRet5', 'sectorRet20', 'sectorHeat',
                  'sectorUpRatio', 'sectorLimitUpCnt'):
            feats[k] = np.nan
        notes.append('sector_missing')
    shape, channel, pos120 = day_shape.classify(ind, i)
    feats['dayShape'], feats['channelType'] = shape, channel
    feats['pos120'] = pos120 if pos120 is not None else np.nan
    if share_src:
        notes.append('shares:' + str(share_src))
    return feats, notes


# ----------------------------------------------------------------- 打分 / 输出
# 目标 → bt_stat 的基准列。不同目标的自然基准差异极大（up3≈21% / up5≈9% / 涨停≈2.7%），
# 必须逐目标锚定，否则把 up3 的基准套到 up5 上会凭空放大一个 logit 单位。
TARGET_BASE_COL = {
    'up1': 'hit1Pct', 'up2': 'hit2Pct', 'up3': 'hit3Pct', 'up4': 'hit4Pct',
    'up5': 'hit5Pct', 'up6': 'hit6Pct', 'up7': 'hit7Pct', 'up8': 'hit8Pct',
    'up9': 'hit9Pct', 'limitUp': 'limitUpPct',
}


def regime_bases(regime: str, run_id: int | None = None) -> tuple[dict[str, float], str]:
    """取某个市场环境下各目标的历史基准命中率（%），返回 (逐目标基准, 来源)。

    权威来源是模型文件里的 ``regimeBases``：它与训练样本同口径、随模型一起发布，
    不会因为库里批次被清出而失效，也不会串到其它批次的分档上。
    只有模型文件缺这块（v1 模型）时才回退 ``bt_stat.dimension='market_regime'``，
    且用模型文件声明的 runId，最后才用调用方给的 run_id。
    """
    if not regime:
        return {}, ''
    regime = str(regime)
    model: dict = {}
    try:
        model = load_model()
    except (OSError, ValueError):
        model = {}
    block = model.get('regimeBases') or {}
    row = (block.get('buckets') or {}).get(regime)
    if isinstance(row, dict):
        out = {t: float(row[t]) for t in TARGET_BASE_COL
               if isinstance(row.get(t), (int, float))}
        if out:
            return out, 'model.regimeBases'
    rid = block.get('runId') or model.get('runId') or run_id
    if rid is None:
        return {}, ''
    conn = sqlite3.connect('file:%s?mode=ro' % BT_DB, uri=True)
    conn.row_factory = sqlite3.Row
    try:
        r = conn.execute(
            "SELECT * FROM bt_stat WHERE runId=? AND dimension='market_regime' AND bucket=?",
            (int(rid), regime)).fetchone()
        if not r:
            return {}, ''
        keys = r.keys()
        return ({t: float(r[col]) for t, col in TARGET_BASE_COL.items()
                 if col in keys and r[col] is not None},
                'bt_stat.market_regime#runId=%d' % int(rid))
    except sqlite3.Error:
        return {}, ''
    finally:
        conn.close()


def score_targets(csv_path: str, targets: list[str], base: float, out_dir: str,
                  base_by_target: dict | None = None) -> dict:
    out: dict[str, dict] = {}
    for t in targets:
        p = os.path.join(out_dir, 'live_prob_%s.csv' % t)
        b = (base_by_target or {}).get(t)
        eng.do_score(SimpleNamespace(score=csv_path, target=t,
                                     base=(b if b else base), out=p))
        rows = {}
        with open(p, 'r', encoding='utf-8-sig') as f:
            import csv as _csv
            for row in _csv.DictReader(f):
                rows[str(row.get('code') or '')] = row
        out[t] = rows
    return out


def context_from_bt(date: int) -> tuple[dict | None, dict | None]:
    """回放模式：市场/板块环境直接取回测库，隔离「个股特征」这一层做零漂移验证。"""
    conn = sqlite3.connect('file:%s?mode=ro' % BT_DB, uri=True)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute('SELECT * FROM bt_market_day WHERE date=?', (date,)).fetchone()
        if not row:
            return None, None
        mkt = {'universe': None, 'upRatio': row['upRatio'], 'downRatio': None,
               'strongPct': None, 'weakPct': None, 'medianPct': row['medianPct'],
               'limitUpCnt': row['limitUpCnt'], 'limitDownCnt': row['limitDownCnt'],
               'amountYi': row['totalAmountYi'], 'amountRatio5': row['amountRatio5'],
               'tempScore': row['tempScore'], 'regime': row['regime'],
               'regimeSource': 'bt_market_day', 'limitSource': 'bt_market_day'}
        sec: dict[str, dict] = {}
        for r in conn.execute("SELECT * FROM bt_sector_day WHERE date=? AND boardType='industry'",
                              (date,)):
            sec[str(r['boardId'])] = {
                'board': str(r['boardId']), 'name': r['boardName'], 'constituents': None,
                'pct': r['pct'], 'ret5': r['ret5'], 'ret20': r['ret20'],
                'upRatio': r['upRatio'], 'limitUpCnt': r['limitUpCnt'],
                'heat': r['heatScore'], 'heatPct': r['heatPct'],
            }
        return mkt, sec
    except sqlite3.Error:
        return None, None
    finally:
        conn.close()


def verify_against_backtest(rows: list[dict], date: int, run_id: int) -> dict:
    """与 bt_trade 同 (code,date) 行对比，验证特征口径零漂移。"""
    model = load_model()
    keys = [f['key'] for f in model['features']]
    codes = [r['code'] for r in rows]
    if not codes:
        return {'checked': 0}
    conn = sqlite3.connect('file:%s?mode=ro' % BT_DB, uri=True)
    conn.row_factory = sqlite3.Row
    try:
        q = ('SELECT * FROM bt_trade WHERE runId=? AND date=? AND code IN (%s)'
             % ','.join('?' * len(codes)))
        src = {str(r['code']): dict(r) for r in conn.execute(q, [run_id, date] + codes)}
    finally:
        conn.close()
    diffs: dict[str, float] = {}
    n = 0
    for row in rows:
        ref = src.get(row['code'])
        if not ref:
            continue
        n += 1
        for k in keys:
            a, b = row.get(k), ref.get(k)
            if k not in ref:
                continue                      # 派生特征（industry/flag）不在 bt_trade 表内
            if isinstance(a, (int, float)) and isinstance(b, (int, float)):
                d = abs(float(a) - float(b))
                diffs[k] = max(diffs.get(k, 0.0), d)
            elif str(a) != str(b):
                diffs[k] = max(diffs.get(k, 1.0), 1.0)
    tol = 0.0051          # bt_trade 入库时四舍五入到 4 位小数（百分比特征 2 位）
    return {'checked': n, 'tolerance': tol, 'maxAbsDiff': diffs,
            'keysWithDrift': sorted(k for k, v in diffs.items() if v > tol),
            'note': '残差 ≤%.4f 即为 bt_trade 入库四舍五入，非口径差异' % tol}


def main() -> int:
    ap = argparse.ArgumentParser(description='尾盘选股概率评分（回测口径对齐）')
    ap.add_argument('--codes', default='', help='逗号分隔的股票代码')
    ap.add_argument('--codes-file', default='', help='每行一个代码的文件')
    ap.add_argument('--date', type=int, default=0, help='交易日 YYYYMMDD，默认取最新快照')
    ap.add_argument('--run', type=int, default=1)
    ap.add_argument('--targets', default='up3,up5,limitUp')
    ap.add_argument('--base', type=float, default=0.0, help='当日基准命中率（%%），0=用模型基准')
    ap.add_argument('--base-regime', default='',
                    help='按市场环境逐目标锚定基准（如 strong_trend），优先于 --base')
    ap.add_argument('--overlay', default='', help='实时行情 JSON（含 quotes 数组）')
    ap.add_argument('--out-csv', default='', help='特征 CSV 输出路径')
    ap.add_argument('--out-json', default='', help='评分 JSON 输出路径')
    ap.add_argument('--dump-overlay', default='', help='把实时行情写入该路径（供 App 复用）')
    ap.add_argument('--verify-bt', action='store_true', help='与 bt_trade 对比验证口径')
    ap.add_argument('--replay-context', action='store_true',
                    help='市场/板块环境改用回测库（回放校验用）')
    ap.add_argument('--no-score', action='store_true', help='只出特征不打分')
    args = ap.parse_args()

    codes: list[str] = []
    if args.codes:
        codes += [c.strip() for c in args.codes.split(',') if c.strip()]
    if args.codes_file:
        with open(args.codes_file, 'r', encoding='utf-8') as f:
            codes += [ln.strip().lstrip('\ufeff') for ln in f if ln.strip()]
    codes = [c for c in dict.fromkeys(codes) if c.isdigit() and len(c) == 6]
    if not codes:
        log('[err] 需要 --codes 或 --codes-file')
        return 2

    date = args.date
    if not date:
        snaps = sorted(f.split('__')[0] for f in os.listdir(SNAP_DIR)) if os.path.isdir(SNAP_DIR) else []
        date = int((snaps[-1] if snaps else '').replace('-', '') or 0)
    if not date:
        log('[err] 无法确定交易日，请显式传 --date')
        return 2

    prescan = {}
    if os.path.exists(PRESCAN_PATH):
        try:
            with open(PRESCAN_PATH, 'r', encoding='utf-8') as f:
                prescan = json.load(f)
        except (OSError, ValueError):
            prescan = {}

    # 1) 行情：overlay 优先，其次东财实时
    if args.overlay and os.path.exists(args.overlay):
        with open(args.overlay, 'r', encoding='utf-8') as f:
            overlay = json.load(f)
        quotes = {str(q.get('code')): q for q in (overlay.get('quotes') or [])}
        quote_errors: list[dict] = []
        log('[init] 读取 overlay %s：%d 条行情' % (args.overlay, len(quotes)))
    else:
        fetch_codes = codes + [BENCH_CODE]
        quotes, quote_errors = fetch_quotes(fetch_codes)
        log('[init] 实时行情：请求 %d，返回 %d（失败块 %d）'
            % (len(fetch_codes), len(quotes), len(quote_errors)))
    if args.dump_overlay:
        with open(args.dump_overlay, 'w', encoding='utf-8') as f:
            json.dump({'date': date, 'asOf': ymd_to_date(date),
                       'fetchedAt': __import__('datetime').datetime.now().isoformat(timespec='seconds'),
                       'quotes': list(quotes.values())}, f, ensure_ascii=False)
        log('[out] 行情缓存 → %s' % args.dump_overlay)

    # 2) 全市场快照 + 环境
    recs, snap_files = load_snapshot(date)
    log('[init] 全市场快照 %s：%d 只（%d 个文件）' % (ymd_to_date(date), len(recs), len(snap_files)))
    mkt = market_context(recs, prescan, date)
    hy_map = load_industry_map()
    sectors = sector_context(recs, hy_map, None, date)
    if args.replay_context:
        bt_mkt, bt_sec = context_from_bt(date)
        if bt_mkt:
            mkt = bt_mkt
            log('[init] 回放模式：市场环境取 bt_market_day（温度 %.4f / %s）'
                % (mkt['tempScore'], mkt['regime']))
        if bt_sec:
            sectors = bt_sec
            log('[init] 回放模式：板块环境取 bt_sector_day %d 个行业' % len(bt_sec))
    bench, bench_src = bench_pct(quotes, date)
    log('[init] 环境：广度 %.2f%%｜涨停 %d｜中位 %.2f%%｜温度 %.4f｜%s（%s）｜基准 %.2f%%（%s）'
        % (mkt['upRatio'] or 0.0, mkt['limitUpCnt'], mkt['medianPct'] or 0.0,
           mkt['tempScore'], mkt['regime'], mkt['regimeSource'], bench or 0.0, bench_src))

    # 3) 逐股特征
    market = Market()
    names = load_tdx_names()
    market.set_names(names)
    from late_buy_next_morning import load_factors
    factors = load_factors()
    book = ShareBook.load()
    model = load_model()
    keys = [f['key'] for f in model['features']]
    rows: list[dict] = []
    skipped: list[dict] = []
    calibers: set[str] = set()
    for code in codes:
        feats, notes = build_row(code, date, market, factors, book, names, hy_map,
                                 sectors, mkt, bench, quotes.get(code))
        if not feats:
            skipped.append({'code': code, 'reason': '；'.join(notes)})
            continue
        row = {'code': code, 'date': date, 'name': names.get(code) or (quotes.get(code) or {}).get('name') or ''}
        row.update(feats)
        rows.append(row)
        calibers.add('intraday_snapshot' if 'synthetic_bar' in notes else 'daily_close')
        if notes:
            row['_notes'] = ';'.join(notes)
    caliber = 'daily_close' if calibers == {'daily_close'} else (
        'intraday_snapshot' if calibers == {'intraday_snapshot'} else 'mixed')
    # 收盘后用快照合成 T 日日线 ≈ 训练口径（entryTime=1500）；盘中合成才有明显漂移
    from datetime import datetime
    now = datetime.now()
    after_close = (int(now.strftime('%Y%m%d')) > date
                   or (int(now.strftime('%Y%m%d')) == date and now.hour * 60 + now.minute >= 15 * 60))
    if caliber == 'intraday_snapshot' and after_close:
        caliber = 'close_snapshot'
    log('[build] 特征完成 %d 只（跳过 %d）｜口径 %s' % (len(rows), len(skipped), caliber))
    if not rows:
        log('[err] 无可用特征')
        return 3

    out_csv = args.out_csv or os.path.join(BT_DIR, 'live_features_%d.csv' % date)
    cols = ['code', 'date', 'name'] + keys
    import csv as _csv
    with open(out_csv, 'w', encoding='utf-8-sig', newline='') as f:
        w = _csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for row in rows:
            w.writerow({k: row.get(k, '') for k in cols})
    log('[out] 特征 CSV → %s' % out_csv)

    result: dict = {
        'version': 'score-candidates-v1',
        'asOf': ymd_to_date(date),
        'date': date,
        'caliber': caliber,
        'model': {'version': model['version'], 'runId': model['runId'],
                  'trainRows': model['trainRows'], 'baseHit3Pct': model['baseSampleHit3Pct']},
        'market': mkt,
        'bench': {'code': BENCH_CODE, 'pct': bench, 'source': bench_src},
        'sectorPctSource': 'constituent_weighted' if caliber != 'daily_close' else 'board_index',
        'skipped': skipped,
        'quoteErrors': quote_errors,
        'items': [],
    }
    if not args.no_score:
        targets = [t for t in args.targets.split(',') if t]
        base_map: dict[str, float] = {}
        base_src = ''
        if args.base_regime:
            base_map, base_src = regime_bases(args.base_regime, args.run)
            if base_map:
                log('[base] 环境 %s 逐目标基准（%s）：%s' % (
                    args.base_regime,
                    base_src,
                    ', '.join('%s=%.2f%%' % (t, base_map[t]) for t in targets if t in base_map)))
            else:
                log('[base] 环境 %s 无分档统计，退回模型基准' % args.base_regime)
        elif args.base:
            log('[base] 逐目标统一锚定 %.2f%%（注意：不同目标自然基准差异很大）' % args.base)
        scored = score_targets(out_csv, targets, args.base, BT_DIR, base_map)
        result['baseByTarget'] = {t: (base_map.get(t) or args.base or None) for t in targets}
        result['baseRegime'] = args.base_regime or ''
        result['baseSource'] = base_src or ('explicit' if args.base else '')
        # 基准锚点随结果落盘：界面与实盘凭据直接读它，服务重启后仍能追溯
        # 「这条概率是拿哪个基准算出来的」，不必再去 bt_stat 反查（批次可能已被清出）。
        anchor = base_map.get('up3') if base_map else args.base
        result['baseHit3'] = {
            'value': float(anchor) if isinstance(anchor, (int, float)) else None,
            'source': result['baseSource'],
            'regime': result['baseRegime'],
        }
        for row in rows:
            code = row['code']
            item = {'code': code, 'date': date, 'name': row['name'],
                    'features': {k: _clean_feature(row.get(k)) for k in keys},
                    'probs': {}, 'evidence': {}, 'support': {}}
            for t in targets:
                got = scored.get(t, {}).get(code)
                if not got:
                    continue
                item['probs'][t] = float(got['probPct'])
                item['support'][t] = int(float(got['minBucketN']))
                item['evidence'][t] = got['evidence']
            item['sector'] = sectors.get((hy_map.get(code) or {}).get('board') or '')
            result['items'].append(item)
        result['items'].sort(key=lambda x: -(x['probs'].get('up3') or 0.0))
    if args.verify_bt:
        result['verify'] = verify_against_backtest(rows, date, args.run)
        log('[verify] %s' % json.dumps(result['verify'], ensure_ascii=False)[:800])
    out_json = args.out_json or os.path.join(BT_DIR, 'live_score_%d.json' % date)
    with open(out_json, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
    log('[out] 评分 JSON → %s' % out_json)
    if args.no_score:
        return 0
    top = result['items'][:10]
    log('[top] 次日≥+3% 概率前 10：')
    for it in top:
        log('   %s %s  up3=%5.2f%%  up5=%5.2f%%  涨停=%5.2f%%  支撑=%s  %s'
            % (it['code'], it['name'], it['probs'].get('up3') or 0.0,
               it['probs'].get('up5') or 0.0, it['probs'].get('limitUp') or 0.0,
               min(it['support'].values()) if it['support'] else '-',
               (it['evidence'].get('up3') or '')[:70]))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
