#!/usr/bin/env python
# -*- coding: utf-8 -*-
r"""智诊盯盘：尾盘选股 → 次日早盘卖出的概率评分引擎。

做什么
------
把 ``data/backtest.db`` 里已经算好的「T 日尾盘特征 → T+1 早盘最高涨幅」回测样本，
转成一个**可以逐笔打分**的概率模型：

1. 每个特征分档的 ≥X% 命中率 → 向基准收缩后的 log-lift（朴素贝叶斯权重）；
2. 各维度 log-lift 作为自变量做 L2 逻辑回归，学习维度间权重，避免把高度相关的
   特征（涨幅 / 振幅 / 量比 / 乖离）重复计权；
3. 留一年（leave-one-year-out）验证：AUC / Brier / 概率十分位校准 / 每日选股模拟；
4. 导出 ``data/backtest/decision_model.json``：App 侧只读取该文件即可复算同一概率；
5. 时点建议：从时间网格里挑「月度稳健最优」的买入 / 卖出分钟。

口径
----
* 训练主样本：``bt_trade`` runId=1（日线近似，2% 随机抽样 108,965 笔，2021-01~2026-09）。
* 基准（base）：日线全样本 ≥+3% = 21.15%；2% 抽样（retHigh≥3）= 21.31%
  （bt_trade.hit3 因 retHigh 只存到 2 位小数而少算 44 笔，为 21.27%）。
  两者都随产物导出，所有 lift 都会标注相对哪个基准。
* 本引擎只输出概率与证据，不直接下单；实盘凭据表 ``bt_decision`` 由 App 侧写入。
* 预测引擎未接入 App 前，回测数据不得用于实盘下单（见 .codex/memory/MEMORY.md）。

用法::

    python tools\bt_decision_engine.py --fit            # 拟合 + 留一年验证 + 导出模型
    python tools\bt_decision_engine.py --fit --write-doc # 同时生成校准报告
    python tools\bt_decision_engine.py --write-stat-dims # 补写换手率/温度/行业热度分档
    python tools\bt_decision_engine.py --score data\backtest\candidates.csv
"""
import argparse
import json
import math
import os
import sys
import time

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from backtest_store import (DAILY_BASE_HIT3, DEFAULT_DB, RUN_DAILY, STAT_SQL,  # noqa: E402
                            connect, now_iso, stat_tuple)
from tdx_sector import load_industry_map  # noqa: E402

ROOT = os.path.normpath(os.path.join(HERE, '..'))
BT_DIR = os.path.join(ROOT, 'data', 'backtest')
MODEL_PATH = os.path.join(BT_DIR, 'decision_model.json')
GRID_MONTH_CSV = os.path.join(BT_DIR, 'late-buy-time-grid', 'grid_pairs_month.csv')
DOC_PATH = os.path.join(ROOT, 'docs', '2026-09-21-概率评分引擎与校准报告.md')

MODEL_VERSION = 'decision-model-v2'
BINS = 10               # 数值特征分档数（训练集分位数）
SHRINK_K = 50.0         # 分档命中率的收缩强度（等效先验样本数）
RIDGE_GRID = (3.0, 10.0, 30.0)
TOPK_K = (1, 2, 3, 5, 8, 10, 15, 20, 30)   # 每日选前 K 只的模拟档位（写进模型 JSON）
RISK_NOTES = [
    {'key': 'openNegative',
     'cn': '高分档次日开盘均收为负',
     'text': '概率预测的是「次日早盘最高涨幅」，高分档开盘直接卖出的平均收益为负；'
             '必须配合冲高止盈（如 +3% 挂单或分时走高后了结）才有正期望。'},
    {'key': 'noStrictTiming',
     'cn': '时点无严格稳定点',
     'text': '14:30~14:55 买 / 09:30~10:00 卖的网格里，没有任何组合在 4 个月全部优于基线；'
             '14:39→09:56 只是样本内最优，跨月最差仍低于基线约 0.38pp。'},
    {'key': 'sampleCaliber',
     'cn': '抽样口径',
     'text': '分档与系数来自 2% 随机抽样（约 10.9 万笔），全样本日线 ≥3% 基准为 21.15%，'
             '抽样基准约 21.3%；实盘使用时按当日真实基准做锚定。'},
]

# 决策时点（T 日 14:30 收盘时）可得、且在 bt_trade 里有留痕的特征。
# (字段, 中文名, 类型, 单位, 固定分档边界或 None=按训练集分位数切 10 档)
FEATURES = [
    ('pct', '当日涨幅', 'num', '%', None),
    ('amp', '当日振幅', 'num', '%', None),
    ('closePos', '收盘位置(0~1)', 'num', '', None),
    ('turnoverPct', '换手率', 'num', '%', None),
    ('volRatio', '量比(对5日)', 'num', '', None),
    ('amountWan', '成交额', 'num', '万元', None),
    ('floatMcapYi', '流通市值', 'num', '亿元', None),
    ('rsi14', 'RSI14', 'num', '', None),
    ('atrPct', 'ATR14波动率', 'num', '%', None),
    ('bias20', '20日乖离', 'num', '%', None),
    ('bias60', '60日乖离', 'num', '%', None),
    ('ret5', '5日收益', 'num', '%', None),
    ('ret20', '20日收益', 'num', '%', None),
    ('ret60', '60日收益', 'num', '%', None),
    ('distHh20', '距20日新高', 'num', '%', None),
    ('listDays', '上市天数', 'num', '日', None),
    ('marketTemp', '全市场温度', 'num', '0~1', None),
    ('sectorPct', '所属行业当日涨幅', 'num', '%', None),
    ('sectorRet5', '所属行业5日收益', 'num', '%', None),
    ('sectorRet20', '所属行业20日收益', 'num', '%', None),
    ('sectorHeat', '所属行业热度分', 'num', '', None),
    ('sectorUpRatio', '所属行业上涨占比', 'num', '%', None),
    ('sectorLimitUpCnt', '所属行业涨停家数', 'num', '家', None),
    ('benchPct', '大盘涨跌', 'num', '%', None),
    ('board', '上市板', 'cat', '', None),
    ('industry', '通达信行业', 'cat', '', None),
    ('dayShape', '日线均线形态位置', 'cat', '', None),
    ('channelType', '日线通道类型', 'cat', '', None),
    ('pos120', '120日通道位置(0~1)', 'num', '', [0.2, 0.4, 0.6, 0.8]),
    ('marketRegime', '市场环境', 'cat', '', None),
    ('flag', 'T日盘中触板未封', 'cat', '', None),
]

# 目标：次日早盘最高涨幅 ≥ k%（upN）与次日早盘触及涨停（limitUp）
TARGETS = [('up1', 1), ('up2', 2), ('up3', 3), ('up4', 4), ('up5', 5),
           ('up6', 6), ('up7', 7), ('up8', 8), ('up9', 9)]
TARGET_CN = {'limitUp': '次日早盘触及涨停'}
for _k, _v in TARGETS:
    TARGET_CN[_k] = f'次日早盘最高涨幅 ≥{_v}%'

SQL_COLS = ['tradeId', 'code', 'board', 'date', 'pct', 'amp', 'closePos',
            'turnoverPct', 'volRatio', 'amountWan', 'floatMcapYi', 'rsi14',
            'atrPct', 'bias20', 'bias60', 'ret5', 'ret20', 'ret60', 'distHh20',
            'listDays', 'marketTemp', 'marketRegime', 'sectorPct', 'sectorRet5',
            'sectorRet20', 'sectorHeat', 'sectorUpRatio', 'sectorLimitUpCnt',
            'benchPct', 'dayShape', 'pos120', 'channelType', 'retOpen',
            'retHigh', 'retClose', 'stratRet', 'hit3', 'limitTouch',
            'touchedLimit']


def log(msg: str) -> None:
    print(msg, flush=True)


# ------------------------------------------------------------------ 分档
def _fmt_num(v: float) -> str:
    if not np.isfinite(v):
        return 'nan'
    a = abs(v)
    if a >= 1000:
        return '%.0f' % v
    if a >= 100:
        return '%.1f' % v
    if a >= 10:
        return '%.2f' % v
    return '%.3f' % v


def _cat_labels(series: pd.Series) -> np.ndarray:
    s = series.astype('object').where(series.notna(), '未知')
    return np.array([str(x) if str(x) not in ('', 'None', 'nan') else '未知'
                     for x in s], dtype=object)


def _num_labels(series: pd.Series, edges, labels) -> np.ndarray:
    """按给定边界给数值分档；边界外/缺失落到 '缺失'。"""
    v = pd.to_numeric(series, errors='coerce').to_numpy(dtype=float)
    ok = np.isfinite(v)
    out = np.full(len(v), '缺失', dtype=object)
    if ok.any() and len(edges):
        idx = np.searchsorted(np.asarray(edges, dtype=float), v[ok], side='right')
        labs = np.asarray(labels, dtype=object)
        idx = np.clip(idx, 0, max(len(labs) - 2, 0))
        out[ok] = labs[idx]
    return out


def make_labels(kind: str, series: pd.Series,
                fixed_edges=None) -> tuple[np.ndarray, dict]:
    """返回 (每行分档标签, 分档元信息)。数值特征默认按**训练集**分位数切 10 档。"""
    if kind == 'cat':
        lab = _cat_labels(series)
        return lab, {'kind': 'cat', 'labels': sorted(set(lab.tolist()))}
    v = pd.to_numeric(series, errors='coerce').to_numpy(dtype=float)
    ok = np.isfinite(v)
    if ok.sum() == 0:
        return np.full(len(v), '缺失', dtype=object), {
            'kind': 'num', 'edges': [], 'labels': ['缺失']}
    if fixed_edges is not None:
        edges = np.asarray(fixed_edges, dtype=float)
    else:
        qs = np.linspace(0, 1, BINS + 1)[1:-1]
        edges = np.unique(np.quantile(v[ok], qs))
    labels = []
    for i in range(len(edges) + 1):
        if i == 0:
            labels.append('<%s' % _fmt_num(edges[0]))
        elif i == len(edges):
            labels.append('≥%s' % _fmt_num(edges[-1]))
        else:
            labels.append('%s~%s' % (_fmt_num(edges[i - 1]), _fmt_num(edges[i])))
    labels.append('缺失')
    meta = {'kind': 'num', 'edges': [float(e) for e in edges], 'labels': labels}
    return _num_labels(series, edges, labels), meta


def bin_with_meta(kind: str, series: pd.Series, meta: dict) -> np.ndarray:
    """用训练集边界给新样本分档（留一年验证 / 实盘打分都必须走这条路径）。"""
    if kind == 'cat' or meta.get('kind') == 'cat':
        return _cat_labels(series)
    return _num_labels(series, meta.get('edges') or [], meta.get('labels') or [])


def _factorize(lab) -> tuple[np.ndarray, np.ndarray]:
    c, u = pd.factorize(pd.Series(lab, dtype=object))
    c = np.asarray(c, dtype=np.int64)
    u = np.asarray(u, dtype=object)
    if len(u) == 0:
        return np.zeros(len(c), dtype=np.int64), np.asarray(['缺失'], dtype=object)
    neg = c < 0
    if bool(np.any(neg)):
        u = np.append(u, '未知')
        c = np.where(neg, len(u) - 1, c)
    return c, u


def prepare_codes(df: pd.DataFrame, keys: list) -> tuple[dict, dict]:
    """在训练集上定边界并编码；返回 (每特征 (整数码, 码→标签), 元信息)。"""
    codes, metas = {}, {}
    for key, _cn, kind, _u, fixed in FEATURES:
        lab, meta = make_labels(kind, df[key], fixed)
        codes[key] = _factorize(lab)
        metas[key] = meta
    return {k: codes[k] for k in keys}, metas


def rebin_codes(df: pd.DataFrame, metas: dict, keys: list) -> dict:
    out = {}
    for key, _cn, kind, _u, _fixed in FEATURES:
        out[key] = _factorize(bin_with_meta(kind, df[key], metas[key]))
    return {k: out[k] for k in keys}


def fit_bucket_table(codes: dict, y: np.ndarray, base: float) -> dict:
    """分档命中率 → 收缩后的 log-lift（用整数码做 bincount，避免逐行 Python）。"""
    y = np.asarray(y, dtype=float)
    table = {}
    for key, (c, u) in codes.items():
        cnt = np.bincount(c, minlength=len(u)).astype(float)
        hits = np.bincount(c, weights=y, minlength=len(u))
        buckets = {}
        for i, name in enumerate(u):
            n = int(cnt[i])
            if n == 0:
                continue
            p = (float(hits[i]) + SHRINK_K * base) / (n + SHRINK_K)
            p = min(max(p, 1e-9), 1 - 1e-9)
            buckets[str(name)] = {
                'n': n, 'hits': int(hits[i]), 'p': round(p, 5),
                'rawHitPct': round(100.0 * float(hits[i]) / n, 3),
                'loglift': round(math.log(p / base), 4) if base > 0 else 0.0,
            }
        table[key] = {'buckets': buckets}
    return table


def build_X(codes: dict, table: dict, keys: list) -> tuple[np.ndarray, np.ndarray]:
    """把分档码映射成分档 log-lift 设计矩阵；出现训练集没有的分档按 0 处理。"""
    n = len(codes[keys[0]][0])
    X = np.zeros((n, len(keys)), dtype=float)
    support = np.full(n, np.inf)
    for j, key in enumerate(keys):
        c, u = codes[key]
        buckets = table[key]['buckets']
        lift = np.array([buckets.get(str(x), {}).get('loglift', 0.0) for x in u],
                        dtype=float)
        cnt = np.array([buckets.get(str(x), {}).get('n', 0) for x in u], dtype=float)
        X[:, j] = lift[c]
        support = np.minimum(support, cnt[c])
    support[~np.isfinite(support)] = 0.0
    return X, support


# ------------------------------------------------------------------ 逻辑回归
def fit_logistic(X: np.ndarray, y: np.ndarray, lam: float = 10.0,
                 iters: int = 60, tol: float = 1e-9) -> np.ndarray:
    """带 L2 的 IRLS（牛顿）求解；X 已标准化，截距不惩罚。"""
    n, d = X.shape
    Xb = np.hstack([np.ones((n, 1)), X])
    w = np.zeros(d + 1)
    pen = np.eye(d + 1) * lam
    pen[0, 0] = 0.0
    for _ in range(iters):
        z = np.clip(Xb @ w, -30, 30)
        p = 1.0 / (1.0 + np.exp(-z))
        g = Xb.T @ (p - y) + pen @ w
        wt = p * (1 - p) + 1e-9
        H = (Xb * wt[:, None]).T @ Xb + pen
        try:
            step = np.linalg.solve(H, g)
        except np.linalg.LinAlgError:
            step = np.linalg.lstsq(H, g, rcond=None)[0]
        w -= step
        if np.max(np.abs(step)) < tol:
            break
    return w


def standardize(X: np.ndarray, mu=None, sd=None):
    if mu is None:
        mu = X.mean(axis=0)
    if sd is None:
        sd = X.std(axis=0)
    sd = np.where(sd < 1e-12, 1.0, sd)
    return (X - mu) / sd, mu, sd


def predict_prob(w: np.ndarray, Xs: np.ndarray) -> np.ndarray:
    z = np.clip(np.hstack([np.ones((len(Xs), 1)), Xs]) @ w, -30, 30)
    return 1.0 / (1.0 + np.exp(-z))


def auc_score(y: np.ndarray, score: np.ndarray) -> float:
    y = np.asarray(y, dtype=float)
    n = len(y)
    if n == 0 or y.min() == y.max():
        return float('nan')
    r = pd.Series(score).rank(method='average').to_numpy()
    n1 = float(y.sum())
    n0 = float(n - n1)
    return float((r[y == 1].sum() - n1 * (n1 + 1) / 2) / (n1 * n0))


def brier(y: np.ndarray, p: np.ndarray) -> float:
    return float(np.mean((np.asarray(p, dtype=float) - np.asarray(y, dtype=float)) ** 2))


def logit(x: float) -> float:
    x = min(max(x, 1e-6), 1 - 1e-6)
    return math.log(x / (1 - x))


# ------------------------------------------------------------------ 数据
def load_frame(conn, rid: int) -> pd.DataFrame:
    df = pd.read_sql_query(
        'SELECT %s FROM bt_trade WHERE runId=?' % ','.join(SQL_COLS), conn,
        params=[rid])
    hy = load_industry_map()
    df['industry'] = [((hy.get(str(c)) or {}).get('hy_name') or '未知')
                      for c in df['code']]
    df['flag'] = np.where(pd.to_numeric(df['touchedLimit'], errors='coerce')
                          .fillna(0).astype(int) == 1, 'T日触板未封', '普通')
    for k, _v in TARGETS:
        df[k] = (pd.to_numeric(df['retHigh'], errors='coerce') >= _v).astype(int)
    df['limitUp'] = (pd.to_numeric(df['limitTouch'], errors='coerce')
                     .fillna(0).astype(int) == 1).astype(int)
    df['year'] = pd.to_numeric(df['date'], errors='coerce').fillna(0).astype(int) // 10000
    return df


def target_keys() -> list:
    return [k for k, _v in TARGETS] + ['limitUp']


# ------------------------------------------------------------------ 拟合与验证
def fit_one(df: pd.DataFrame, keys: list, lam: float, target: str,
            with_anchor: bool = False):
    """在给定样本上拟合；返回模型字典（含分档表、系数、标准化参数）。"""
    codes, metas = prepare_codes(df, keys)
    m = fit_codes(codes, df[target].to_numpy(dtype=float), keys, lam)
    m['metas'] = metas
    m['codes'] = codes
    return m


def fit_codes(codes: dict, y: np.ndarray, keys: list, lam: float) -> dict:
    y = np.asarray(y, dtype=float)
    base = float(y.mean()) if len(y) else 0.0
    table = fit_bucket_table(codes, y, base)
    X, support = build_X(codes, table, keys)
    Xs, mu, sd = standardize(X)
    w = fit_logistic(Xs, y, lam=lam)
    return {'base': base, 'table': table, 'w': w, 'mu': mu, 'sd': sd,
            'support': support}


def predict_codes(model: dict, codes: dict, keys: list) -> np.ndarray:
    X, _sup = build_X(codes, model['table'], keys)
    Xs = (X - model['mu']) / model['sd']
    return predict_prob(model['w'], Xs)


def loo_evaluate(df: pd.DataFrame, keys: list, lam: float) -> dict:
    """留一年验证：每年用其余年份拟合（分档边界也只取训练年），预测该年。"""
    years = sorted(int(y) for y in df['year'].unique())
    pred = np.full(len(df), np.nan)
    pred_anchor = np.full(len(df), np.nan)
    per_year = {}
    for y in years:
        te = (df['year'] == y).to_numpy()
        tr = ~te
        if tr.sum() < 1000 or te.sum() < 200:
            continue
        dtr = df[tr]
        dte = df[te]
        codes_tr, metas = prepare_codes(dtr, keys)
        codes_te = rebin_codes(dte, metas, keys)
        out = {}
        for target in target_keys():
            m = fit_codes(codes_tr, dtr[target].to_numpy(dtype=float), keys, lam)
            yte = dte[target].to_numpy(dtype=float)
            base_tr = float(m['base'])
            base_te = float(yte.mean())
            p = predict_codes(m, codes_te, keys)
            p_anchor = 1.0 / (1.0 + np.exp(-(np.log(p / (1 - p))
                                             + logit(base_te) - logit(base_tr))))
            out[target] = {
                'auc': auc_score(yte, p), 'brier': brier(yte, p),
                'brierAnchor': brier(yte, p_anchor),
                'baseTrainPct': round(100 * base_tr, 3),
                'baseTestPct': round(100 * base_te, 3),
                'n': int(te.sum()), 'predPct': round(100 * float(p.mean()), 3),
            }
            if target == 'up3':
                pred[te] = p
                pred_anchor[te] = p_anchor
        per_year[y] = out
        log('  [loo] %d：%s' % (y, ' '.join(
            '%s auc=%.3f' % (t, out[t]['auc']) for t in ('up1', 'up3', 'up5', 'limitUp')
            if t in out)))
    y3 = df['up3'].to_numpy(dtype=float)
    ok = np.isfinite(pred)
    return {'perYear': per_year, 'pred': pred, 'predAnchor': pred_anchor,
            'y': y3, 'ok': ok,
            'aucUp3': auc_score(y3[ok], pred[ok]),
            'brierUp3': brier(y3[ok], pred[ok]),
            'brierUp3Anchor': brier(y3[ok], pred_anchor[ok])}


def decile_table(df: pd.DataFrame, pred: np.ndarray, target: str, base: float) -> list:
    ok = np.isfinite(pred)
    yser = df[target].to_numpy(dtype=float)[ok]
    ps = pred[ok]
    q = pd.qcut(pd.Series(ps), 10, labels=False, duplicates='drop')
    sub = df[ok]
    rows = []
    for d in sorted(pd.Series(q).dropna().unique()):
        m = (q == d).to_numpy() if hasattr(q, 'to_numpy') else (q == d)
        if m.sum() == 0:
            continue
        rows.append({
            'decile': int(d) + 1, 'n': int(m.sum()),
            'predPct': round(100 * float(ps[m].mean()), 2),
            'actualPct': round(100 * float(yser[m].mean()), 2),
            'liftVsBase': round(float(yser[m].mean() / base), 3) if base else None,
            'retHighMeanPct': round(float(sub['retHigh'][m].mean()), 3),
            'retOpenMeanPct': round(float(sub['retOpen'][m].mean()), 3),
            'stratMeanPct': round(float(sub['stratRet'][m].mean()), 3),
            'limitUpPct': round(100 * float(sub['limitTouch'][m].mean()), 2),
        })
    return rows


def daily_topk(df: pd.DataFrame, pred: np.ndarray, k: int, mask=None) -> dict:
    ok = np.isfinite(pred)
    if mask is not None:
        ok = ok & mask
    sub = df[ok].copy()
    sub['_p'] = pred[ok]
    sub = sub.sort_values(['date', '_p'], ascending=[True, False])
    picked = sub.groupby('date').head(k)
    by_year = []
    for y, g in picked.groupby('year'):
        by_year.append({'year': int(y), 'n': int(len(g)),
                        'hit3Pct': round(100 * float(g['up3'].mean()), 2),
                        'retOpenPct': round(float(g['retOpen'].mean()), 3),
                        'retHighPct': round(float(g['retHigh'].mean()), 3),
                        'stratPct': round(float(g['stratRet'].mean()), 3)})
    return {'k': k, 'n': int(len(picked)),
            'days': int(picked['date'].nunique()),
            'hit3Pct': round(100 * float(picked['up3'].mean()), 2),
            'retOpenPct': round(float(picked['retOpen'].mean()), 3),
            'retHighPct': round(float(picked['retHigh'].mean()), 3),
            'stratPct': round(float(picked['stratRet'].mean()), 3),
            'limitUpPct': round(100 * float(picked['limitTouch'].mean()), 2),
            'byYear': by_year}


# ------------------------------------------------------------------ 时点
def recommend_timing() -> dict:
    """从 grid_pairs_month.csv 算买入/卖出分钟建议。

    口径：``mean_pct`` = 该月「买入分钟→卖出分钟」的平均价格变动（%，按笔数加权）。
    月内笔数差异很大（4.6 万~9.7 万），所以先按月聚合再按笔数加权回全样本（pool）。
    稳健性用「相对本月基线（14:30→09:30）的差值」衡量：要求 4 个月全部为正才算稳健。
    """
    if not os.path.exists(GRID_MONTH_CSV):
        return {}
    df = pd.read_csv(GRID_MONTH_CSV)
    df = df[(df['buy_time'] >= '14:30') & (df['buy_time'] <= '14:55')
            & (df['sell_time'] >= '09:30') & (df['sell_time'] <= '10:00')]
    if df.empty:
        return {}
    df = df.copy()
    df['w'] = pd.to_numeric(df['n'], errors='coerce').fillna(0.0)
    base_m = {}
    for m, g in df[(df['buy_time'] == '14:30') & (df['sell_time'] == '09:30')].groupby('month'):
        if float(g['w'].sum()) > 0:
            base_m[int(m)] = float(np.average(g['mean_pct'], weights=g['w']))
    rows = []
    for (bt, st), g in df.groupby(['buy_time', 'sell_time']):
        wsum = float(g['w'].sum())
        if wsum <= 0:
            continue
        pool = float(np.average(g['mean_pct'], weights=g['w']))
        deltas = [float(r['mean_pct']) - base_m[int(r['month'])]
                  for _, r in g.iterrows() if int(r['month']) in base_m]
        rows.append({
            'buy': bt, 'sell': st, 'poolPct': round(pool, 4),
            'poolN': int(wsum), 'months': int(g['month'].nunique()),
            'deltaMinPct': round(min(deltas), 4) if deltas else None,
            'deltaMaxPct': round(max(deltas), 4) if deltas else None,
            'deltaMeanPct': round(float(np.mean(deltas)), 4) if deltas else None,
        })
    dfg = pd.DataFrame(rows)
    best_in = dfg.sort_values('poolPct', ascending=False).iloc[0]
    stable = dfg[dfg['deltaMinPct'].fillna(-9) > 0]
    best_st = (stable.sort_values('poolPct', ascending=False).iloc[0]
               if len(stable) else best_in)
    base_pool = float(np.average(
        df[(df['buy_time'] == '14:30') & (df['sell_time'] == '09:30')]['mean_pct'],
        weights=df[(df['buy_time'] == '14:30') & (df['sell_time'] == '09:30')]['w'])) \
        if base_m else float('nan')
    sell_at_best = dfg[dfg['buy'] == best_in['buy']].sort_values('sell')
    buy_at_best = dfg[dfg['sell'] == best_in['sell']].sort_values('buy')
    return {
        'months': int(df['month'].nunique()),
        'poolN': int(best_in['poolN']),
        'baselinePct': round(base_pool, 4),
        'strictStableExists': bool(len(stable)),
        'insampleBest': {'buy': best_in['buy'], 'sell': best_in['sell'],
                         'poolMeanPct': float(best_in['poolPct']),
                         'vsBaselinePct': round(float(best_in['poolPct']) - base_pool, 4),
                         'monthMinDeltaPct': best_in['deltaMinPct'],
                         'monthMaxDeltaPct': best_in['deltaMaxPct']},
        'stableBest': {'buy': best_st['buy'], 'sell': best_st['sell'],
                       'poolMeanPct': float(best_st['poolPct']),
                       'monthMinDeltaPct': best_st['deltaMinPct'],
                       'monthDeltaMeanPct': best_st['deltaMeanPct']},
        'sellCurve': [{'sell': r['sell'], 'poolPct': r['poolPct']}
                      for _, r in sell_at_best.iterrows()],
        'buyCurve': [{'buy': r['buy'], 'poolPct': r['poolPct']}
                     for _, r in buy_at_best.iterrows()],
    }


def group_hit_stats(df: pd.DataFrame, lab) -> list:
    """按分档标签聚合各目标命中率（%）与收益统计。

    bt_stat 分档与模型文件的 regimeBases 必须同源，否则界面显示的基准和真正算概率
    用的基准会不一致，所以两处都走这一个函数。
    """
    rows = []
    for name in sorted(set(lab.tolist())):
        m = lab == name
        n = int(m.sum())
        if n == 0:
            continue
        sub = df[m]
        rows.append({
            'bucket': name, 'n': n,
            **{'ge%d_pct' % k: round(100 * float(sub['up%d' % k].mean()), 2)
               for k in range(1, 10)},
            'limit_pct': round(100 * float(sub['limitUp'].mean()), 2),
            'avg_ret_open_pct': round(float(sub['retOpen'].mean()), 3),
            'avg_ret_high_pct': round(float(sub['retHigh'].mean()), 3),
            'avg_ret_close_pct': round(float(sub['retClose'].mean()), 3),
            'avg_strat_ret_pct': round(float(sub['stratRet'].mean()), 3),
            'win_rate_true_pct': round(100 * float((sub['stratRet'] > 0).mean()), 2),
            'profit_factor': round(
                float(sub.loc[sub['stratRet'] > 0, 'stratRet'].sum())
                / max(float(-sub.loc[sub['stratRet'] < 0, 'stratRet'].sum()), 1e-9), 3),
        })
    return rows


def write_stat_dims(conn, rid: int, df: pd.DataFrame) -> None:
    """把抽样明细里的换手率 / 温度 / 行业热度等补写进 bt_stat，便于前端按分档展示。"""
    base = 100.0 * float(df['up3'].mean())
    log(f'  [base] 抽样 ≥3% 基准 {base:.3f}%（与 bt_stat.overall 口径一致，单位：百分数）')
    note = '2% 抽样明细重算（tools/bt_decision_engine.py）：命中率为抽样口径。'
    specs = [('turnover', 'turnoverPct'), ('atr', 'atrPct'),
             ('market_temp', 'marketTemp'), ('sector_heat', 'sectorHeat'),
             ('sector_up_ratio', 'sectorUpRatio'), ('bias60', 'bias60'),
             ('ret60', 'ret60'), ('market_regime', 'marketRegime')]
    total = 0
    for dim, col in specs:
        kind = 'cat' if col in ('marketRegime',) else 'num'
        lab, _meta = make_labels(kind, df[col])
        rows = group_hit_stats(df, lab)
        conn.execute('DELETE FROM bt_stat WHERE runId=? AND dimension=?', (rid, dim))
        conn.executemany(STAT_SQL, [stat_tuple(rid, dim, r, base, note) for r in rows])
        total += len(rows)
        log('  bt_stat[%s] %d 档（基准 %.2f%%）' % (dim, len(rows), base))
    conn.commit()
    log(f'[write] 补写 {total} 行分档统计')


def regime_bases_block(df: pd.DataFrame, rid: int, run_key: str) -> dict:
    """市场环境 → 各目标历史基准（%），随模型文件一起固化。

    实盘锚定必须知道「当日市场环境下 ≥3% 的自然命中率」，而这个值来自训练样本。
    如果只存在库里的 bt_stat，一旦旧口径批次被清出，锚定就会静默退化成统一基准
    （或串到别的批次上），所以把它写进 decision_model.json 一起发布。
    """
    lab, _meta = make_labels('cat', df['marketRegime'])
    buckets: dict = {}
    for r in group_hit_stats(df, lab):
        item = {'sampleCnt': int(r['n'])}
        for k in range(1, 10):
            item['up%d' % k] = r['ge%d_pct' % k]
        item['limitUp'] = r['limit_pct']
        buckets[str(r['bucket'])] = item
    return {
        'dimension': 'market_regime',
        'runId': rid, 'runKey': run_key,
        'sampleN': int(len(df)),
        'baseSampleHit3Pct': round(100 * float(df['up3'].mean()), 3),
        'note': '命中率 = 该环境下「次日早盘最高涨幅 ≥ 阈值」占比，limitUp = 触及涨停占比；'
                '口径与 bt_stat.dimension=market_regime 一致。',
        'buckets': buckets,
    }


# ------------------------------------------------------------------ 主流程
def do_fit(args) -> int:
    conn = connect(args.db)
    rid = args.run
    run_row = conn.execute('SELECT runKey FROM bt_run WHERE runId=?', (rid,)).fetchone()
    run_key = run_row[0] if run_row else ''
    t0 = time.time()
    df = load_frame(conn, rid)
    log(f'[in] runId={rid} 明细 {len(df)} 行  日期 '
        f'{int(df["date"].min())}~{int(df["date"].max())}  用时 {time.time() - t0:.0f}s')
    hits = int(df['up3'].sum())
    base_sample = hits / len(df)
    log(f'[base] 抽样 ≥3% = {100 * base_sample:.2f}%（{hits}/{len(df)}）；'
        f'全样本常数 = {DAILY_BASE_HIT3}%')
    if int(df['hit3'].fillna(0).sum()) != hits:
        log(f'[diff] bt_trade.hit3={int(df["hit3"].fillna(0).sum())} vs '
            f'retHigh≥3%={hits}（差 {hits - int(df["hit3"].fillna(0).sum())} 笔，'
            'retHigh 只存 2 位小数导致的边界取整，可忽略；本引擎统一用 retHigh≥X%）')

    keys = [f[0] for f in FEATURES]
    if args.write_stat_dims:
        write_stat_dims(conn, rid, df)

    log('[loo] 留一年验证（每年用其余年份拟合）…')
    lam_best, loo = None, None
    for lam in RIDGE_GRID:
        r = loo_evaluate(df, keys, lam)
        log('  λ=%-5s 平均 AUC(up3)=%.4f  Brier=%.5f（锚定后 %.5f）'
            % (lam, r['aucUp3'], r['brierUp3'], r['brierUp3Anchor']))
        if loo is None or r['aucUp3'] > loo['aucUp3']:
            lam_best, loo = lam, r
    log(f'[loo] 选用 λ={lam_best}  样本内 AUC(up3)={loo["aucUp3"]:.4f}')

    log('[fit] 全样本拟合最终模型…')
    artifacts = {}
    metrics = {}
    codes_all, metas_all = prepare_codes(df, keys)
    for target in target_keys():
        m = fit_codes(codes_all, df[target].to_numpy(dtype=float), keys, lam_best)
        pred = predict_codes(m, codes_all, keys)
        metrics[target] = {
            'baseHitPct': round(100 * m['base'], 3),
            'aucInsample': round(auc_score(df[target].to_numpy(float), pred), 4),
            'brierInsample': round(brier(df[target].to_numpy(float), pred), 5),
        }
        artifacts[target] = {
            'cn': TARGET_CN[target],
            'baseHitPct': round(100 * m['base'], 3),
            'intercept': round(float(m['w'][0]), 5),
            'coef': [round(float(x), 5) for x in m['w'][1:]],
            'mu': [round(float(x), 6) for x in m['mu']],
            'sd': [round(float(x), 6) for x in m['sd']],
        }
        if target == 'up3':
            ref = m
    # 分档表只导出一份（所有目标共用同一批特征分档，仅系数不同）
    features_json = []
    for key, cn, kind, unit, _fixed in FEATURES:
        features_json.append({
            'key': key, 'cn': cn, 'kind': kind, 'unit': unit,
            'edges': metas_all[key].get('edges', []),
            'labels': metas_all[key].get('labels', []),
            'buckets': {k: v for k, v in ref['table'][key]['buckets'].items()
                        if k in set(metas_all[key].get('labels', []))},
        })
    timing = recommend_timing()
    # 校准表与每日选股模拟：一次算完就写进模型 JSON，App 端只读渲染，不重复计算。
    log('')
    log('[calib] 各目标十分位校准 + 每日选股模拟…')
    calibration = {}
    for target in target_keys():
        tbase = float(df[target].to_numpy(dtype=float).mean())
        calibration[target] = {
            'cn': TARGET_CN[target],
            'baseHitPct': round(100 * tbase, 3),
            'deciles': decile_table(df, loo['pred'], target, tbase),
        }
    sims = {}
    for k in TOPK_K:
        sims['top%d' % k] = daily_topk(df, loo['pred'], k)
    mask_b = ((pd.to_numeric(df['amp'], errors='coerce') >= 6)
              & (pd.to_numeric(df['amountWan'], errors='coerce') >= 50000)
              & (df['board'].isin(['创业板', '中小板']))).to_numpy()
    sims['top10_comboB'] = daily_topk(df, loo['pred'], 10, mask=mask_b)
    dec = calibration['up3']['deciles']
    log('  [calib] up3 最高档 预测 %.2f%% / 实际 %.2f%%；top3 ≥3%% = %.2f%%'
        % (dec[-1]['predPct'], dec[-1]['actualPct'], sims['top3']['hit3Pct']))

    model = {
        'version': MODEL_VERSION, 'builtAt': now_iso(),
        'runId': rid, 'runKey': run_key,
        'trainRows': int(len(df)),
        'dateRange': [int(df['date'].min()), int(df['date'].max())],
        'baseSampleHit3Pct': round(100 * base_sample, 3),
        'baseFullHit3Pct': DAILY_BASE_HIT3,
        'shrinkK': SHRINK_K, 'bins': BINS, 'lambda': lam_best,
        'regimeBases': regime_bases_block(df, rid, run_key),
        'features': features_json,
        'targets': artifacts,
        'metrics': metrics,
        'loo': {str(y): loo['perYear'][y] for y in loo['perYear']},
        'timing': timing,
        'calibration': calibration,
        'topk': sims,
        'risk': RISK_NOTES,
        'notes': [
            '概率口径：p = sigmoid(intercept + Σ coef_j × (loglift_j − mu_j)/sd_j)，'
            'loglift_j 取自 features[].buckets[分档].loglift。',
            '实盘锚定：真实基准与训练基准不同时，先算 z，再加 '
            '(logit(baseNow) − logit(baseTrain)) 后再 sigmoid，'
            'baseTrain = targets[].baseHitPct。',
            '环境锚定：当日市场环境的基准取 regimeBases.buckets[环境].up3，'
            '未命中该环境时退回 baseSampleHit3Pct；两者都在本文件内，不查库。',
            '分档边界来自训练集分位数（数值特征 10 档），未知分档按 loglift=0 处理。',
            '样本为 2% 随机抽样（基准 21.27%），不是全样本；全样本日线基准 21.15%。',
        ],
    }
    with open(MODEL_PATH, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(model, f, ensure_ascii=False, indent=1)
    log(f'[out] {MODEL_PATH}')
    for _b, _v in sorted(model['regimeBases']['buckets'].items()):
        log('  [regime] %-14s n=%6d  ≥3%%=%.2f%%' % (_b, _v['sampleCnt'], _v['up3']))

    conn.execute('INSERT OR REPLACE INTO bt_meta(key,value,updatedAt) VALUES(?,?,?)',
                 ('decisionModel', json.dumps({
                     'version': MODEL_VERSION, 'runId': rid,
                     'trainRows': int(len(df)), 'lambda': lam_best,
                     'aucUp3Loo': round(loo['aucUp3'], 4),
                     'brierUp3Loo': round(loo['brierUp3'], 5),
                     'brierUp3LooAnchor': round(loo['brierUp3Anchor'], 5),
                     'baseSampleHit3Pct': round(100 * base_sample, 3),
                     'regimeBasesHit3Pct': {
                         k: v['up3'] for k, v in model['regimeBases']['buckets'].items()},
                     'timingStable': timing.get('stableBest'),
                     'timingInsample': timing.get('insampleBest'),
                 }, ensure_ascii=False), now_iso()))
    conn.commit()

    # ---- 评估报告
    log('')
    log('== 留一年验证（up3，池化）==')
    log('  AUC = %.4f   Brier = %.5f（锚定后 %.5f）'
        % (loo['aucUp3'], loo['brierUp3'], loo['brierUp3Anchor']))
    for target in ('up1', 'up3', 'up5', 'up9', 'limitUp'):
        aucs = [v[target]['auc'] for v in loo['perYear'].values() if target in v]
        brs = [v[target]['brierAnchor'] for v in loo['perYear'].values() if target in v]
        log('  %-8s 分年 AUC %.3f~%.3f（均 %.3f）  Brier(锚定)均 %.5f'
            % (target, min(aucs), max(aucs), float(np.mean(aucs)), float(np.mean(brs))))
    log('')
    log('== up3 概率十分位校准（留一年预测池化）==')
    log('  分位  预测%   实际%   lift   早盘最高均%  开盘均%  止盈模型均%')
    for r in dec:
        log('  %2d    %6.2f  %6.2f  %5.3f  %8.3f  %8.3f  %8.3f'
            % (r['decile'], r['predPct'], r['actualPct'], r['liftVsBase'],
               r['retHighMeanPct'], r['retOpenMeanPct'], r['stratMeanPct']))
    log('')
    log('== 每日选股模拟（按留一年概率取前 K 只）==')
    for k in (3, 5, 10, 20):
        s = sims['top%d' % k]
        log('  前 %-3d只：%d 日  %d 笔  ≥3%%=%.2f%%  开盘均收=%.3f%%  '
            '早盘最高均=%.3f%%  止盈模型均=%.3f%%'
            % (k, s['days'], s['n'], s['hit3Pct'], s['retOpenPct'],
               s['retHighPct'], s['stratPct']))
    s = sims['top10_comboB']
    log('  前 10 只 ∩ 组合B（振幅≥6%%+成交额≥5亿+创业板/中小板）：%d 日 %d 笔  '
        '≥3%%=%.2f%%  开盘均收=%.3f%%' % (s['days'], s['n'], s['hit3Pct'],
                                          s['retOpenPct']))
    log('')
    log('== 时点建议（月度稳健）==')
    log('  基线 14:30→09:30 全样本均值 %.4f%%' % timing['baselinePct'])
    log('  样本内最优 %s→%s（全样本加权均值 %.4f%%，较基线 %+.4fpp，各月 %+.3f~%+.3f）'
        % (timing['insampleBest']['buy'], timing['insampleBest']['sell'],
           timing['insampleBest']['poolMeanPct'], timing['insampleBest']['vsBaselinePct'],
           timing['insampleBest']['monthMinDeltaPct'],
           timing['insampleBest']['monthMaxDeltaPct']))
    tag = '月度稳健' if timing.get('strictStableExists') else '无严格稳定点'
    log('  %s   %s→%s（全样本加权均值 %.4f%%，最差月较基线 %+.4fpp）'
        % (tag, timing['stableBest']['buy'], timing['stableBest']['sell'],
           timing['stableBest']['poolMeanPct'], timing['stableBest']['monthMinDeltaPct']))
    sco = {r['sell']: r['poolPct'] for r in timing.get('sellCurve', [])}
    log('  卖出腿（买 14:39）：09:30 %+.4f%% | 09:40 %+.4f%% | 09:50 %+.4f%% | '
        '09:56 %+.4f%% | 10:00 %+.4f%%'
        % (sco.get('09:30', float('nan')), sco.get('09:40', float('nan')),
           sco.get('09:50', float('nan')), sco.get('09:56', float('nan')),
           sco.get('10:00', float('nan'))))

    if args.write_doc:
        write_doc(model, dec, sims, loo)
    if args.emit_predictions:
        out = df[['tradeId', 'code', 'board', 'date', 'industry']].copy()
        out['up3Prob'] = 100 * loo['pred']
        out.to_csv(args.emit_predictions, index=False, encoding='utf-8-sig')
        log(f'[out] {args.emit_predictions}')
    conn.close()
    return 0


def write_doc(model: dict, dec: list, sims: dict, loo: dict) -> None:
    t = model['timing']
    lines = []
    add = lines.append
    add('# 智诊盯盘：概率评分引擎与校准报告')
    add('')
    add(f'- 模型版本：`{model["version"]}`    构建时间：{model["builtAt"]}')
    add(f'- 训练批次：`{model["runKey"]}`（runId={model["runId"]}）')
    add(f'- 训练样本：{model["trainRows"]:,} 笔（2% 随机抽样，'
        f'{model["dateRange"][0]}~{model["dateRange"][1]}）')
    add(f'- 基准：抽样 ≥+3% = {model["baseSampleHit3Pct"]}%，'
        f'全样本日线 ≥+3% = {model["baseFullHit3Pct"]}%')
    add(f'- 分档：数值特征按训练集分位数切 {model["bins"]} 档；'
        f'命中率收缩强度 k={model["shrinkK"]}；岭回归 λ={model["lambda"]}')
    add(f'- 产物：`data/backtest/decision_model.json`（App 只读复算）；'
        f'`bt_meta.decisionModel` 记摘要')
    add('')
    add('## 1. 模型形式')
    add('')
    add('```')
    add('z = intercept + Σ_j coef_j × (loglift_j(分档) − mu_j) / sd_j')
    add('p = 1 / (1 + exp(−z))')
    add('实盘锚定：z′ = z + logit(baseNow) − logit(baseTrain)，p = sigmoid(z′)')
    add('```')
    add('')
    add('`loglift_j = ln((hits + k·base) / (n + k) / base)`，'
        '即「该分档命中率相对基准的对数倍数」，向基准收缩后再进入线性模型。')
    add('')
    add('## 2. 留一年验证（leave-one-year-out）')
    add('')
    add('| 目标 | 分年 AUC 区间 | AUC 均值 | Brier(锚定) 均值 | 样本基准% |')
    add('| --- | --- | --- | --- | --- |')
    for target in ('up1', 'up2', 'up3', 'up4', 'up5', 'up7', 'up9', 'limitUp'):
        aucs = [v[target]['auc'] for v in loo['perYear'].values() if target in v]
        brs = [v[target]['brierAnchor'] for v in loo['perYear'].values() if target in v]
        bas = [v[target]['baseTestPct'] for v in loo['perYear'].values() if target in v]
        if not aucs:
            continue
        add('| %s | %.3f~%.3f | %.3f | %.5f | %.2f |'
            % (target, min(aucs), max(aucs), float(np.mean(aucs)),
               float(np.mean(brs)), float(np.mean(bas))))
    add('')
    add(f'池化 up3：AUC = **{loo["aucUp3"]:.4f}**，Brier = {loo["brierUp3"]:.5f}，'
        f'加基准锚定后 Brier = **{loo["brierUp3Anchor"]:.5f}**。')
    add('')
    add('分年基准本身就是最大变量（2023 年 14.77% vs 2026 年 24.23%），'
        '所以实盘必须带锚定项，否则概率会整体偏高或偏低。')
    add('')
    add('## 3. up3 概率十分位校准（留一年预测池化）')
    add('')
    add('| 分位 | 笔数 | 预测% | 实际% | lift | 早盘最高均% | 开盘均% | 止盈模型均% | 触板% |')
    add('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
    for r in dec:
        add('| %d | %d | %.2f | %.2f | %.3f | %.3f | %.3f | %.3f | %.2f |'
            % (r['decile'], r['n'], r['predPct'], r['actualPct'], r['liftVsBase'],
               r['retHighMeanPct'], r['retOpenMeanPct'], r['stratMeanPct'],
               r['limitUpPct']))
    add('')
    add('## 4. 每日选股模拟（按留一年概率取前 K 只）')
    add('')
    add('| 取法 | 交易日 | 笔数 | ≥3% | 开盘均收% | 早盘最高均% | 止盈模型均% | 触板% |')
    add('| --- | --- | --- | --- | --- | --- | --- | --- |')
    for key in ('top3', 'top5', 'top10', 'top20', 'top10_comboB'):
        s = sims.get(key)
        if not s:
            continue
        add('| %s | %d | %d | %.2f | %.3f | %.3f | %.3f | %.2f |'
            % (key, s['days'], s['n'], s['hit3Pct'], s['retOpenPct'],
               s['retHighPct'], s['stratPct'], s['limitUpPct']))
    add('')
    add('分年（前 10 只）：')
    add('')
    add('| 年份 | 笔数 | ≥3% | 开盘均收% | 止盈模型均% |')
    add('| --- | --- | --- | --- | --- |')
    for r in sims['top10']['byYear']:
        add('| %d | %d | %.2f | %.3f | %.3f |'
            % (r['year'], r['n'], r['hit3Pct'], r['retOpenPct'], r['stratPct']))
    add('')
    add('## 5. 时点建议')
    add('')
    add(f'- 网格覆盖 {t.get("months")} 个月（2026-06~2026-09），'
        f'每个组合 {t.get("poolN", 0):,} 笔；``mean_pct`` 为「买入分钟→卖出分钟」'
        f'的平均价格变动，按月内均值再按笔数加权回全样本。')
    add(f'- 基线 **14:30 买入 → 09:30 卖出**：全样本均价 {t["baselinePct"]:+.4f}%。')
    add(f'- 样本内最优：**{t["insampleBest"]["buy"]} 买入 → '
        f'{t["insampleBest"]["sell"]} 卖出**（{t["insampleBest"]["poolMeanPct"]:+.4f}%，'
        f'较基线 {t["insampleBest"]["vsBaselinePct"]:+.4f}pp，各月差值 '
        f'{t["insampleBest"]["monthMinDeltaPct"]:+.3f}~'
        f'{t["insampleBest"]["monthMaxDeltaPct"]:+.3f}pp）')
    if t.get('strictStableExists'):
        add(f'- 4 个月相对基线全部为正的稳健点：**{t["stableBest"]["buy"]} 买入 → '
            f'{t["stableBest"]["sell"]} 卖出**（{t["stableBest"]["poolMeanPct"]:+.4f}%，'
            f'最差月仍较基线 {t["stableBest"]["monthMinDeltaPct"]:+.4f}pp）')
    else:
        add(f'- **没有**任何组合能保证 4 个月相对基线全部为正（样本仅 4 个月，'
            f'成立即过度拟合）；因此只给样本内最优 '
            f'（最差月较基线 {t["stableBest"]["monthMinDeltaPct"]:+.4f}pp，'
            f'月间波动比时点差异大一个量级）。')
    add('')
    sco = {r['sell']: r['poolPct'] for r in t.get('sellCurve', [])}
    if sco:
        add('卖出腿（以 14:39 买入计）：')
        add('')
        add('| 卖出时间 | ' + ' | '.join(sco.keys()) + ' |')
        add('| --- |' + ' --- |' * len(sco))
        add('| 均价% | ' + ' | '.join('%+.4f' % v for v in sco.values()) + ' |')
        add('')
    add('> 结论：买入腿 14:30~14:55 之间差异在 ±0.07pp 以内，属噪声，实盘不必卡分钟；'
        '卖出腿 09:31→09:56 单调改善、10:00 回落，**09:56 附近是窗口内最优卖点**。'
        '时点只做微调，不改变选股结论；本段样本仅 4 个月，不可外推。')
    add('')
    add('## 6. 使用边界')
    add('')
    for n in model['notes']:
        add(f'- {n}')
    add('- 预测引擎未接入 App 前，回测数据不得用于实盘下单。')
    add('')
    add('## 7. 复现')
    add('')
    add('```powershell')
    add('$env:PYTHONIOENCODING="utf-8"')
    add('python tools\\bt_decision_engine.py --fit --write-doc')
    add('```')
    add('')
    with open(DOC_PATH, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(lines))
    log(f'[out] {DOC_PATH}')


def do_score(args) -> int:
    with open(MODEL_PATH, 'r', encoding='utf-8') as f:
        model = json.load(f)
    df = pd.read_csv(args.score, encoding='utf-8-sig')
    if 'code' in df.columns:
        # 保留 6 位股票代码的前导零（000007 不能变成 7），否则下游按 code 关联会全部落空
        s = df['code'].astype(str).str.strip().str.replace(r'\.0$', '', regex=True)
        df['code'] = s.where(~s.str.fullmatch(r'\d{1,6}'), s.str.zfill(6))
    target = args.target
    spec = model['targets'][target]
    feat = {f['key']: f for f in model['features']}
    X = np.zeros((len(df), len(model['features'])), dtype=float)
    evidence = [[] for _ in range(len(df))]
    support = np.full(len(df), np.inf)
    for j, f in enumerate(model['features']):
        col = df[f['key']] if f['key'] in df.columns else pd.Series([None] * len(df))
        labs = bin_with_meta(f['kind'], col, {'kind': f['kind'],
                                              'edges': f['edges'],
                                              'labels': f['labels']})
        buckets = f['buckets']
        for i, lab in enumerate(labs):
            b = buckets.get(str(lab))
            if b is None:
                continue
            X[i, j] = b['loglift']
            support[i] = min(support[i], b['n'])
            if b['loglift'] >= 0.2:
                evidence[i].append('%s=%s(%.2f×)' % (f['cn'], lab,
                                                     math.exp(b['loglift'])))
    Xs = (X - np.asarray(spec['mu'], dtype=float)) / np.asarray(spec['sd'], dtype=float)
    z = np.clip(np.asarray(spec['coef'], dtype=float) @ Xs.T + spec['intercept'],
                -30, 30)
    p = 1.0 / (1.0 + np.exp(-z))
    if args.base:
        base_now = float(args.base) / 100.0
        if 0 < base_now < 1:
            z2 = np.log(p / (1 - p)) + logit(base_now) - logit(spec['baseHitPct'] / 100.0)
            p = 1.0 / (1.0 + np.exp(-np.clip(z2, -30, 30)))
    support[~np.isfinite(support)] = 0.0
    base_rate = (float(args.base) / 100.0) if args.base else spec['baseHitPct'] / 100.0
    out = pd.DataFrame({
        'probPct': np.round(100 * p, 3),
        'liftVsBase': np.round(p / base_rate, 3),
        'minBucketN': support.astype(int),
        'evidence': ['; '.join(e[:10]) for e in evidence],
    })
    for col in ('code', 'date', 'name'):
        if col in df.columns:
            out.insert(0, col, df[col].to_numpy())
    out = out.sort_values('probPct', ascending=False)
    outp = args.out or os.path.join(BT_DIR, 'decision_score_%s.csv' % target)
    out.to_csv(outp, index=False, encoding='utf-8-sig')
    log('[score] 目标 %s（%s）基准 %.2f%%；输出 %d 行 → %s'
        % (target, TARGET_CN.get(target, ''), 100 * base_rate, len(out), outp))
    if len(out):
        log('  概率区间 %.2f%%~%.2f%%，中位数 %.2f%%'
            % (out['probPct'].min(), out['probPct'].max(),
               float(out['probPct'].median())))
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description='尾盘选股概率评分引擎')
    ap.add_argument('--db', default=DEFAULT_DB)
    ap.add_argument('--run', type=int, default=1)
    ap.add_argument('--fit', action='store_true')
    ap.add_argument('--write-doc', action='store_true')
    ap.add_argument('--write-stat-dims', action='store_true')
    ap.add_argument('--emit-predictions', default='')
    ap.add_argument('--score', default='', help='待打分 CSV（需含特征同名列）')
    ap.add_argument('--target', default='up3')
    ap.add_argument('--base', type=float, default=0.0,
                    help='打分时用当日实际基准（%%）做锚定，0=不锚定')
    ap.add_argument('--out', default='', help='打分结果输出路径')
    args = ap.parse_args(argv)
    if args.fit:
        return do_fit(args)
    if args.score:
        return do_score(args)
    ap.print_help()
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
