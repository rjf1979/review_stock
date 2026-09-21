# -*- coding: utf-8 -*-
"""尾盘 14:40 买入（分时反推口径）回测分析：统计 + 概率模型 + 报告。

口径（与 ``tools/minute_reverse_backtest.py`` 抽取出的样本一致）
--------------------------------------------------------------
* 买入：T 日 **14:40** 的 1 分钟收盘价；
* 标签：T+1 日 **09:31~10:30** 最高价相对买入价 ≥ +3%（同步统计 +1%~+9% 与涨停）；
* 特征：T 日 ≤14:40 分时结构 + T-1 日线量价 + T-1 市场/板块上下文，
  **不含**任何形态分类字段（均线只保留数值偏离）。

分析顺序刻意与「形态决定概率」相反：
1. 先按标签把样本切开（T+1 触达 ≥3% / 未触达），
2. 再反推两组在 T 日尾盘分时上的差异（分位数、效应量、分档命中率），
3. 用这些反推出来的分时特征建概率模型，做留一月验证与每日 Top-K 模拟。

用法::

    python tools/minute_reverse_analyze.py
    python tools/minute_reverse_analyze.py --csv samples_smoke.csv --tag smoke
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bt_decision_engine as eng  # noqa: E402
from minute_reverse_backtest import COST, FEATURES, OUT_DIR, TARGET  # noqa: E402

ROOT = os.path.normpath(os.path.join(HERE, '..'))
DOC_PATH = os.path.join(ROOT, 'docs', '2026-09-21-尾盘14点40分时反推回测报告.md')
COST_PCT = COST * 100.0          # 0.15 个百分点（单边摩擦，沿用既有口径）
TOPK = (1, 2, 3, 5, 8, 10, 20)
MIN_AMT_WAN = 1000.0             # Top-K 模拟的流动性门槛：截至 14:40 成交额 ≥1000 万

FEATURE_KEYS = [f[0] for f in FEATURES]
FEATURE_CN = {f[0]: f[1] for f in FEATURES}
FEATURE_UNIT = {f[0]: f[3] for f in FEATURES}
NUM_KEYS = [f[0] for f in FEATURES if f[2] == 'num']
CAT_KEYS = [f[0] for f in FEATURES if f[2] == 'cat']

ENG_FEATURES = [(f[0], f[1], f[2], f[3], None) for f in FEATURES]


def log(msg: str) -> None:
    print(msg, flush=True)


def load_samples(path: str) -> pd.DataFrame:
    """读抽取样本并派生标签、卖出路径与分组键。"""
    df = pd.read_csv(path, low_memory=False)
    for k in ('hi1000Pct', 'hi1030Pct', 'hi1130Pct', 'openPct', 'c1000Pct',
              'c1030Pct', 'hiDayPct'):
        df[k] = pd.to_numeric(df[k], errors='coerce')
    # 标签：T+1 09:31~10:30 最高涨幅档位（用户口径）
    hi = df['hi1030Pct'].to_numpy(dtype=float)
    op = df['openPct'].to_numpy(dtype=float)
    cl = df['c1030Pct'].to_numpy(dtype=float)
    lt = (pd.to_numeric(df['limitTouch1030'], errors='coerce')
          .fillna(0).to_numpy(dtype=int))
    add = {}
    for lvl in range(1, 10):
        add['up%d' % lvl] = (hi >= lvl).astype(int)
    add['limitUp'] = lt
    add['retHigh'] = hi
    add['retOpen'] = op
    add['retClose'] = cl
    touch = add['up3'].astype(bool)
    # 策略：早盘触及 +3% → 按 max(3%, 开盘) 了结；否则按 10:30 收盘价了结
    add['stratRet'] = np.where(touch, np.maximum(TARGET * 100, op), cl) - COST_PCT
    # 更保守的对照：没冲高就直接按开盘价走
    add['stratOpen'] = np.where(touch, np.maximum(TARGET * 100, op), op) - COST_PCT
    add['limitTouch'] = lt
    add['year'] = (df['date'] // 100).astype(int)    # 留一月验证 / 月度分解分组键
    add['month'] = add['year']
    return pd.concat([df, pd.DataFrame(add, index=df.index)], axis=1)


def base_table(df: pd.DataFrame) -> dict:
    """样本基准：各档命中率、月度基准、均值收益。"""
    out = {
        'rows': int(len(df)), 'days': int(df['date'].nunique()),
        'codes': int(df['code'].nunique()),
        'dateMin': int(df['date'].min()), 'dateMax': int(df['date'].max()),
        'hitPct': {}, 'byMonth': [], 'means': {},
    }
    for lvl in range(1, 10):
        out['hitPct']['up%d' % lvl] = round(100 * float(df['up%d' % lvl].mean()), 3)
    out['hitPct']['limitUp'] = round(100 * float(df['limitUp'].mean()), 3)
    for m, g in df.groupby('month'):
        out['byMonth'].append({
            'month': int(m), 'days': int(g['date'].nunique()), 'n': int(len(g)),
            'up1Pct': round(100 * float(g['up1'].mean()), 2),
            'up3Pct': round(100 * float(g['up3'].mean()), 2),
            'up5Pct': round(100 * float(g['up5'].mean()), 2),
            'up9Pct': round(100 * float(g['up9'].mean()), 2),
            'limitUpPct': round(100 * float(g['limitUp'].mean()), 2),
            'retOpenPct': round(float(g['retOpen'].mean()), 3),
            'retHighPct': round(float(g['retHigh'].mean()), 3),
            'stratPct': round(float(g['stratRet'].mean()), 3),
        })
    out['means'] = {
        'retOpenPct': round(float(df['retOpen'].mean()), 3),
        'retClosePct': round(float(df['retClose'].mean()), 3),
        'retHighPct': round(float(df['retHigh'].mean()), 3),
        'stratPct': round(float(df['stratRet'].mean()), 3),
        'stratOpenPct': round(float(df['stratOpen'].mean()), 3),
    }
    return out


def reverse_profile(df: pd.DataFrame, keys: list, y: np.ndarray) -> list:
    """命中组 vs 未命中组：分位数 + 标准化均值差（Smd），按 |Smd| 排序。"""
    rows = []
    for k in keys:
        v = pd.to_numeric(df[k], errors='coerce').to_numpy(dtype=float)
        ok = np.isfinite(v)
        if ok.sum() < 1000:
            continue
        g1, g0 = v[ok & (y == 1)], v[ok & (y == 0)]
        if len(g1) < 100 or len(g0) < 100:
            continue
        sd = float(np.std(v[ok]))
        smd = (float(np.mean(g1)) - float(np.mean(g0))) / sd if sd > 0 else 0.0
        rows.append({
            'key': k, 'cn': FEATURE_CN.get(k, k), 'unit': FEATURE_UNIT.get(k, ''),
            'nHit': int(len(g1)), 'nMiss': int(len(g0)),
            'medHit': round(float(np.median(g1)), 4),
            'medMiss': round(float(np.median(g0)), 4),
            'p25Hit': round(float(np.percentile(g1, 25)), 4),
            'p75Hit': round(float(np.percentile(g1, 75)), 4),
            'p25Miss': round(float(np.percentile(g0, 25)), 4),
            'p75Miss': round(float(np.percentile(g0, 75)), 4),
            'meanHit': round(float(np.mean(g1)), 4),
            'meanMiss': round(float(np.mean(g0)), 4),
            'smd': round(float(smd), 4),
        })
    rows.sort(key=lambda r: -abs(r['smd']))
    return rows


def bucket_scan(df: pd.DataFrame, keys: list, y: np.ndarray, base: float,
                bins: int = 10, min_n: int = 2000) -> list:
    """每个特征按全样本分位切 bins 档，输出各档命中率与 lift。"""
    out = []
    for k in keys:
        v = pd.to_numeric(df[k], errors='coerce').to_numpy(dtype=float)
        ok = np.isfinite(v)
        if ok.sum() < min_n * bins:
            continue
        edges = np.unique(np.quantile(v[ok], np.linspace(0, 1, bins + 1)[1:-1]))
        idx = np.clip(np.searchsorted(edges, v, side='right'), 0, len(edges))
        buckets = []
        for b in range(len(edges) + 1):
            sel = ok & (idx == b)
            n = int(sel.sum())
            if n < min_n:
                continue
            hit = float(y[sel].mean())
            lo = edges[b - 1] if b > 0 else -np.inf
            hi = edges[b] if b < len(edges) else np.inf
            buckets.append({
                'bin': b + 1, 'n': n,
                'lo': None if not np.isfinite(lo) else round(float(lo), 4),
                'hi': None if not np.isfinite(hi) else round(float(hi), 4),
                'hitPct': round(100 * hit, 2), 'lift': round(hit / base, 3),
            })
        if len(buckets) < 3:
            continue
        lo_b = min(buckets, key=lambda r: r['lift'])
        hi_b = max(buckets, key=lambda r: r['lift'])
        out.append({
            'key': k, 'cn': FEATURE_CN.get(k, k), 'unit': FEATURE_UNIT.get(k, ''),
            'buckets': buckets, 'best': hi_b, 'worst': lo_b,
            'spreadLift': round(hi_b['lift'] - lo_b['lift'], 3),
        })
    out.sort(key=lambda r: -r['spreadLift'])
    return out


def cat_scan(df: pd.DataFrame, keys: list, y: np.ndarray, base: float,
             min_n: int = 2000) -> list:
    """分类字段（上市板 / 行业）各取值的命中率。"""
    out = []
    for k in keys:
        lab = df[k].astype('object').where(df[k].notna(), '未知').astype(str)
        rows = []
        for name, g in df.groupby(lab):
            n = len(g)
            if n < min_n:
                continue
            hit = float(y[g.index.to_numpy()].mean())
            rows.append({'name': str(name), 'n': int(n), 'hitPct': round(100 * hit, 2),
                         'lift': round(hit / base, 3)})
        rows.sort(key=lambda r: -r['lift'])
        if len(rows) >= 2:
            out.append({'key': k, 'cn': FEATURE_CN.get(k, k), 'groups': rows})
    return out


def make_candidates(df: pd.DataFrame, keys: list,
                    cuts=(0.1, 0.25, 0.75, 0.9)) -> list:
    """候选规则条件：每个数值特征在 4 个分位点上取 <= / >= 两个方向。"""
    cands = []
    for k in keys:
        v = pd.to_numeric(df[k], errors='coerce').to_numpy(dtype=float)
        ok = np.isfinite(v)
        if ok.sum() < 5000:
            continue
        for q in cuts:
            qv = float(np.quantile(v[ok], q))
            for op, sel in (('<=', v <= qv), ('>=', v >= qv)):
                cands.append({'key': k, 'op': op, 'v': round(qv, 4), 'q': q,
                              'mask': ok & sel})
    return cands


def cand_mask(df: pd.DataFrame, e: dict) -> np.ndarray:
    v = pd.to_numeric(df[e['key']], errors='coerce').to_numpy(dtype=float)
    ok = np.isfinite(v)
    return ok & ((v >= e['v']) if e['op'] == '>=' else (v <= e['v']))


def make_ctx(df: pd.DataFrame, y: np.ndarray) -> dict:
    """逐日/逐月分组的预算结果，供 rule_stat 快速算稳健性（避免 O(规则数×行数) 重扫）。"""
    month = df['month'].to_numpy()
    _um, month_codes = np.unique(month, return_inverse=True)
    day = df['date'].to_numpy()
    _ud, day_codes = np.unique(day, return_inverse=True)
    return {'month': month, 'monthCodes': month_codes.astype(np.int64),
            'dayCodes': day_codes.astype(np.int64),
            'nMonth': len(_um), 'nDay': len(_ud), 'y': y}


def _group_lift(mask: np.ndarray, codes: np.ndarray, n_groups: int, y: np.ndarray,
                min_per_group: int) -> tuple[int, float, float]:
    """分组命中率相对组内基准的 lift：返回（有效组数, 最小 lift, 中位 lift）。"""
    sel = codes[mask]
    if sel.size == 0:
        return 0, float('nan'), float('nan')
    cnt = np.bincount(sel, minlength=n_groups).astype(float)
    pos = np.bincount(sel, weights=y[mask], minlength=n_groups)
    ok = cnt >= min_per_group
    if not ok.any():
        return 0, float('nan'), float('nan')
    hit = pos[ok] / cnt[ok]
    all_cnt = np.bincount(codes, minlength=n_groups).astype(float)
    all_pos = np.bincount(codes, weights=y, minlength=n_groups)
    base_g = all_pos[ok] / np.maximum(all_cnt[ok], 1.0)
    good = base_g > 0
    if not good.any():
        return 0, float('nan'), float('nan')
    lifts = hit[good] / base_g[good]
    return int(lifts.size), float(np.min(lifts)), float(np.median(lifts))


def rule_stat(mask: np.ndarray, y: np.ndarray, base: float, ctx: dict,
              min_n: int = 1500, min_days: int = 12,
              min_per_day: int = 20) -> dict | None:
    """规则统计：样本数、命中率、lift，以及逐月/逐日 lift（防单日偶然）。"""
    n = int(mask.sum())
    if n < min_n:
        return None
    hit = float(y[mask].mean())
    stat = {'n': n, 'hitPct': round(100 * hit, 2), 'lift': round(hit / base, 3)}
    nm, mmin, mmed = _group_lift(mask, ctx['monthCodes'], ctx['nMonth'], y, 200)
    if nm:
        stat['monthLiftMin'] = round(mmin, 3)
        stat['monthLiftMed'] = round(mmed, 3)
        stat['monthCount'] = nm
    nd, dmin, dmed = _group_lift(mask, ctx['dayCodes'], ctx['nDay'], y, min_per_day)
    stat['dayCount'] = nd
    if nd:
        stat['dayLiftMin'] = round(dmin, 3)
        stat['dayLiftMed'] = round(dmed, 3)
    stat['robust'] = bool(nd >= min_days)
    return stat


def rule_sort_key(r: dict):
    """稳健优先：逐日中位 lift → 逐月最小 lift → 整体 lift。"""
    return (-(r.get('dayLiftMed') if r.get('dayLiftMed') is not None else -9),
            -(r.get('monthLiftMin') if r.get('monthLiftMin') is not None else -9),
            -r['lift'])


def rule_text(rule: dict) -> str:
    parts = []
    for tag in ('a', 'b', 'c'):
        e = rule.get(tag)
        if not e:
            continue
        parts.append('%s %s %s%s' % (FEATURE_CN.get(e['key'], e['key']), e['op'],
                                     round(e['v'], 3), FEATURE_UNIT.get(e['key'], '')))
    return ' 且 '.join(parts)


def rule_scan(df: pd.DataFrame, keys: list, y: np.ndarray, base: float,
              top_each: int = 10) -> dict:
    """贪心组合：单条件 → 双条件 → 三条件；先过逐日稳健闸门，再按 lift 排序。"""
    cands = make_candidates(df, keys)
    ctx = make_ctx(df, y)
    singles = []
    for c in cands:
        st = rule_stat(c['mask'], y, base, ctx)
        if st and st['lift'] > 1.15 and st['robust']:
            singles.append({'a': {k: c[k] for k in ('key', 'op', 'v', 'q')}, **st})
    for r in singles:
        r['text'] = rule_text(r)
    singles.sort(key=rule_sort_key)

    pairs = []
    seeds = [(r['a'], cand_mask(df, r['a'])) for r in singles[:top_each]]
    for ea, ma in seeds:
        for c in cands:
            if c['key'] == ea['key']:
                continue
            st = rule_stat(ma & c['mask'], y, base, ctx)
            if not st or not st['robust']:
                continue
            r = {'a': ea, 'b': {k: c[k] for k in ('key', 'op', 'v', 'q')}, **st}
            r['text'] = rule_text(r)
            pairs.append(r)
    pairs.sort(key=rule_sort_key)

    triples = []
    for p in pairs[:top_each]:
        mab = cand_mask(df, p['a']) & cand_mask(df, p['b'])
        for c in cands:
            if c['key'] in (p['a']['key'], p['b']['key']):
                continue
            st = rule_stat(mab & c['mask'], y, base, ctx)
            if not st or not st['robust']:
                continue
            r = {'a': p['a'], 'b': p['b'],
                 'c': {k: c[k] for k in ('key', 'op', 'v', 'q')}, **st}
            r['text'] = rule_text(r)
            triples.append(r)
    triples.sort(key=rule_sort_key)
    return {'nCandidates': len(cands), 'singles': singles[:top_each],
            'pairs': pairs[:top_each], 'triples': triples[:top_each]}


def fit_and_validate(df: pd.DataFrame, keys: list, lam: float) -> dict:
    """分档 log-lift + 岭逻辑回归；留一月验证复用既有引擎。"""
    eng.FEATURES = ENG_FEATURES
    codes_all, metas_all = eng.prepare_codes(df, keys)
    models, metrics = {}, {}
    pred3 = None
    for target in eng.target_keys():
        m = eng.fit_codes(codes_all, df[target].to_numpy(dtype=float), keys, lam)
        p = eng.predict_codes(m, codes_all, keys)
        y = df[target].to_numpy(dtype=float)
        metrics[target] = {
            'baseHitPct': round(100 * float(m['base']), 3),
            'aucInSample': round(eng.auc_score(y, p), 4),
            'brierInSample': round(eng.brier(y, p), 5),
        }
        models[target] = m
        if target == 'up3':
            pred3 = p
    loo = eng.loo_evaluate(df, keys, lam)
    return {'models': models, 'metrics': metrics, 'pred': pred3,
            'metas': metas_all, 'loo': loo, 'lam': lam,
            'base': float(df['up3'].mean())}


def month_breakdown(df: pd.DataFrame, pred: np.ndarray) -> list:
    """逐月：基准命中率、模型 Top3 命中率、当月 AUC。"""
    ok = np.isfinite(pred)
    sub = df[ok].copy()
    sub['_p'] = pred[ok]
    out = []
    for m, g in sub.groupby('month'):
        top = g.sort_values('_p', ascending=False).head(3)
        out.append({
            'month': int(m), 'n': int(len(g)),
            'up3Pct': round(100 * float(g['up3'].mean()), 2),
            'top3up3Pct': round(100 * float(top['up3'].mean()), 2),
            'auc': round(eng.auc_score(g['up3'].to_numpy(dtype=float),
                                       g['_p'].to_numpy(dtype=float)), 4),
        })
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--csv', default='samples.csv')
    ap.add_argument('--tag', default='')
    ap.add_argument('--lam', type=float, default=10.0)
    args = ap.parse_args(argv)

    path = args.csv if os.path.isabs(args.csv) else os.path.join(OUT_DIR, args.csv)
    df = load_samples(path)
    keys = [k for k in FEATURE_KEYS if k in df.columns]
    log('[in] %s：%d 行 / %d 只 / %d 个交易日'
        % (os.path.basename(path), len(df), df['code'].nunique(), df['date'].nunique()))
    base = base_table(df)
    for lvl in range(1, 10):
        log('  up%d 基准 = %.2f%%' % (lvl, base['hitPct']['up%d' % lvl]))
    log('  涨停基准 = %.2f%%' % base['hitPct']['limitUp'])
    log('  均值：开盘 %+.3f%% / 10:30 %+.3f%% / 最高 %+.3f%% / 策略 %+.3f%%'
        % (base['means']['retOpenPct'], base['means']['retClosePct'],
           base['means']['retHighPct'], base['means']['stratPct']))

    y = df['up3'].to_numpy(dtype=float)
    prof = reverse_profile(df, keys, y)
    log('[反推] 命中/未命中 差异最大的 12 个特征：')
    for r in prof[:12]:
        log('  %-22s 命中中位 %9.3f vs 未命中 %9.3f   Smd %+0.3f'
            % (r['cn'], r['medHit'], r['medMiss'], r['smd']))
    scan = bucket_scan(df, keys, y, base['hitPct']['up3'] / 100.0)
    log('[分档] lift 极差最大的 12 个特征：')
    for r in scan[:12]:
        log('  %-24s 最高档 %5.2f%%(lift %.2f, n=%d) 最低档 lift %.2f'
            % (r['cn'], r['best']['hitPct'], r['best']['lift'],
               r['best']['n'], r['worst']['lift']))
    cats = cat_scan(df, CAT_KEYS, y, base['hitPct']['up3'] / 100.0)
    for c in cats:
        log('[分类] %s：%s' % (c['cn'], ' / '.join(
            '%s %.2f%%(n=%d)' % (g['name'], g['hitPct'], g['n'])
            for g in c['groups'][:6])))
    rules = rule_scan(df, keys, y, base['hitPct']['up3'] / 100.0)
    log('[规则] 候选 %d；过逐日稳健闸门后：单条件 %d / 双条件 %d / 三条件 %d'
        % (rules['nCandidates'], len(rules['singles']), len(rules['pairs']),
           len(rules['triples'])))
    for r in rules['triples'][:5]:
        log('  %s → %.2f%%（n=%d, lift %.2f, 有效日 %d, 最差日 lift %.2f）'
            % (r['text'], r['hitPct'], r['n'], r['lift'],
               r.get('dayCount') or 0,
               r.get('dayLiftMin') if r.get('dayLiftMin') is not None else float('nan')))
    for r in rules['singles'][:5]:
        log('  [单] %s → %.2f%%（n=%d, lift %.2f, 有效日 %d, 最差日 lift %.2f）'
            % (r['text'], r['hitPct'], r['n'], r['lift'], r.get('dayCount') or 0,
               r.get('dayLiftMin') if r.get('dayLiftMin') is not None else float('nan')))

    fit = fit_and_validate(df, keys, args.lam)
    metrics, loo = fit['metrics'], fit['loo']
    loo_avg = {}
    for t in eng.target_keys():
        au = [v[t]['auc'] for v in loo['perYear'].values() if t in v]
        loo_avg[t] = round(float(np.mean(au)), 4) if au else None
    log('[模型] λ=%.0f' % args.lam)
    for t in ('up1', 'up3', 'up5', 'up9', 'limitUp'):
        log('  %-8s 样本内 AUC %.4f / 留一月 AUC %.4f'
            % (t, metrics[t]['aucInSample'], loo_avg[t] if loo_avg[t] else float('nan')))
    log('  留一月整体 AUC(up3) = %.4f  Brier %.5f（锚定后 %.5f）'
        % (loo['aucUp3'], loo['brierUp3'], loo['brierUp3Anchor']))
    dec = eng.decile_table(df, fit['pred'], 'up3', fit['base'])
    log('[十分位] up3：')
    for r in dec:
        log('  D%-2d n=%-6d 预测 %5.2f%% 实际 %5.2f%% lift %.2f 策略 %+.3f%%'
            % (r['decile'], r['n'], r['predPct'], r['actualPct'],
               r['liftVsBase'] or 0, r['stratMeanPct']))
    mask_liq = (pd.to_numeric(df['mAmountWan1440'], errors='coerce')
                .to_numpy(dtype=float) >= MIN_AMT_WAN)
    sims = {}
    for k in TOPK:
        sims['k%d' % k] = eng.daily_topk(df, fit['pred'], k)
        sims['liq_k%d' % k] = eng.daily_topk(df, fit['pred'], k, mask=mask_liq)
    log('[模拟] 每日 Top-K（流动性门槛 ≥%.0f 万）：' % MIN_AMT_WAN)
    for k in TOPK:
        s = sims['liq_k%d' % k]
        log('  K=%-2d 命中 %5.2f%% / 开盘 %+.3f%% / 最高 %+.3f%% / 策略 %+.3f%%'
            % (k, s['hit3Pct'], s['retOpenPct'], s['retHighPct'], s['stratPct']))
    # 样本外（留一月）表现：只有这里能当实盘参考
    loo_pred = fit['loo']['pred']
    dec_loo = eng.decile_table(df, loo_pred, 'up3', fit['base'])
    log('[十分位·样本外] up3：')
    for r in dec_loo:
        log('  D%-2d n=%-6d 预测 %5.2f%% 实际 %5.2f%% lift %.2f 策略 %+.3f%%'
            % (r['decile'], r['n'], r['predPct'], r['actualPct'],
               r['liftVsBase'] or 0, r['stratMeanPct']))
    sims_loo = {}
    for k in TOPK:
        sims_loo['k%d' % k] = eng.daily_topk(df, loo_pred, k)
        sims_loo['liq_k%d' % k] = eng.daily_topk(df, loo_pred, k, mask=mask_liq)
    log('[模拟·样本外] 每日 Top-K（流动性门槛 ≥%.0f 万，留一月预测）：' % MIN_AMT_WAN)
    for k in TOPK:
        s = sims_loo['liq_k%d' % k]
        log('  K=%-2d 命中 %5.2f%% / 开盘 %+.3f%% / 最高 %+.3f%% / 策略 %+.3f%%'
            % (k, s['hit3Pct'], s['retOpenPct'], s['retHighPct'], s['stratPct']))
    months = month_breakdown(df, fit['pred'])
    for m in months:
        log('  %d 月：基准 %.2f%% / Top3 %.2f%% / AUC %.3f'
            % (m['month'], m['up3Pct'], m['top3up3Pct'], m['auc']))

    out = {
        'version': 'minute-reverse-v1',
        'caliber': {
            'entry': 'T 日 14:40 一分钟收盘价',
            'label': 'T+1 09:31~10:30 最高涨幅 ≥3%',
            'features': 'T 日 ≤14:40 分时 + T-1 日线 + T-1 市场/板块；无形态字段',
            'cost': COST, 'strategy': '触及 +3% 止盈，否则 10:30 收盘卖出',
            'source': os.path.basename(path),
            'liquidityFilterWan': MIN_AMT_WAN,
        },
        'base': base,
        'reverseProfile': prof,
        'bucketScan': scan,
        'catScan': cats,
        'rules': rules,
        'model': {
            'lam': fit['lam'], 'metrics': metrics, 'looAuc': loo_avg,
            'loo': {k: v for k, v in loo.items()
                    if k not in ('pred', 'predAnchor', 'y', 'ok')},
            'tables': {t: fit['models'][t]['table'] for t in fit['models']},
            'weights': {t: [float(x) for x in fit['models'][t]['w']] for t in fit['models']},
            'mu': {t: [float(x) for x in fit['models'][t]['mu']] for t in fit['models']},
            'sd': {t: [float(x) for x in fit['models'][t]['sd']] for t in fit['models']},
            'features': [{'key': k, 'cn': FEATURE_CN[k], 'unit': FEATURE_UNIT[k],
                          'kind': 'num' if k in NUM_KEYS else 'cat'} for k in keys],
        },
        'deciles': dec, 'topk': sims,
        'decilesLoo': dec_loo, 'topkLoo': sims_loo, 'months': months,
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    name = 'reverse_model%s.json' % (('-' + args.tag) if args.tag else '')
    with open(os.path.join(OUT_DIR, name), 'w', encoding='utf-8') as fp:
        json.dump(out, fp, ensure_ascii=False, indent=2)
    log('[out] %s' % os.path.join(OUT_DIR, name))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
