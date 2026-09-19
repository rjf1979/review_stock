# -*- coding: utf-8 -*-
"""高频形态的「前期跌幅 / 相对强度 / 量能」过滤方向扫描。

用途：只回答一个问题——每个过滤维度往哪个方向加才有效。做法是固定一个子样本，
一次只打开一个维度（其余维度关闭），比较该维度各级别的表现。单因子扫描比一次性
搜网格更不容易过拟合，结论也更可解释。

这不是回测产物本身：正式结论由
`tools/run_backtest_parts.ps1 -Config tools/backtest_v3_filters.json`
在**全市场**上重跑得到。本脚本只输出方向性证据（样本内）。

用法：
    python tools/xingtaidu_filter_scan.py --patterns long_lower_shadow,yang_engulf \
        --limit 900 --out data/backtest/xingtaidu/filter_scan/lls_yang.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from indicators import compute_indicators  # noqa: E402
from kdata import Market  # noqa: E402
import patterns  # noqa: E402
from xingtaidu_backtest import (DEFAULT, _align_bench, load_benchmark,  # noqa: E402
                                load_factors, load_names, resolve_exit, simulate_exit)

# 单因子梯度：off 表示该维度关闭（等价于 v2 口径）
LEVELS: dict[str, list[tuple[str, dict | None]]] = {
    'drop': [
        ('off', None),
        ('drop20-8', {'drop_days': 20, 'drop_max': -8.0}),
        ('drop20-15', {'drop_days': 20, 'drop_max': -15.0}),
        ('drop60-20', {'drop_days': 60, 'drop_max': -20.0}),
    ],
    'rs': [
        ('off', None),
        ('rs20>=0pp', {'rs_days': 20, 'rs_min': 0.0}),
        ('rs20>=-10pp', {'rs_days': 20, 'rs_min': -10.0}),
        ('rs20>=+5pp', {'rs_days': 20, 'rs_min': 5.0}),
        ('rs20<=-5pp', {'rs_days': 20, 'rs_max': -5.0}),
        ('rs20<=+5pp', {'rs_days': 20, 'rs_max': 5.0}),
    ],
    'vol': [
        ('off', None),
        ('vol<=1.2x', {'vol_ref': 20, 'vol_max': 1.2}),
        ('vol>=1.0x', {'vol_ref': 20, 'vol_min': 1.0}),
        ('vol<=2.0x', {'vol_ref': 20, 'vol_max': 2.0}),
    ],
    # 组合维度：先看「前期跌幅」再加一个维度，验证两个过滤器是否可叠加
    'combo': [
        ('off', None),
        ('drop60-20', {'drop_days': 60, 'drop_max': -20.0}),
        ('drop60-20+rs<=5', {'drop_days': 60, 'drop_max': -20.0,
                             'rs_days': 20, 'rs_max': 5.0}),
        ('drop60-20+vol<=1.2', {'drop_days': 60, 'drop_max': -20.0,
                                'vol_ref': 20, 'vol_max': 1.2}),
    ],
}


def _stats(vals, holds):
    v = np.asarray(vals, dtype=np.float64)
    if not len(v):
        return {'n': 0}
    wins, losses = v[v > 0], v[v < 0]
    pf = float(wins.sum() / abs(losses.sum())) if len(losses) else None
    ratio = (float(wins.mean() / abs(losses.mean()))
             if len(wins) and len(losses) else None)
    return {
        'n': int(len(v)),
        'win_rate': round(float((v > 0).mean() * 100), 2),
        'avg_pct': round(float(v.mean()), 4),
        'profit_factor': None if pf is None else round(pf, 4),
        'payoff_ratio': None if ratio is None else round(ratio, 4),
        'avg_hold': round(float(np.mean(holds)), 2) if len(holds) else None,
    }


def _trades(ind, bars, pid, params, cfg):
    sig = patterns.detect(pid, ind, params)
    if cfg['onset_only']:
        sig = sig & ~np.r_[False, sig[:-1]]
    s_int = int(cfg['start'].replace('-', ''))
    e_int = int(cfg['end'].replace('-', ''))
    vals, holds = [], []
    n = len(bars)
    for i in np.flatnonzero(sig):
        j = i + 1
        if j >= n or bars['date'][j] < s_int or bars['date'][j] > e_int \
                or i < cfg['min_list_days']:
            continue
        if cfg['skip_limit_up_entry'] and ind['is_limit_up'][j]:
            continue
        buy = ind['open'][j] * (1 + cfg['slippage'])
        if not np.isfinite(buy) or abs(ind['pct'][i]) > cfg['max_bar_move']:
            continue
        res = simulate_exit(ind, j, buy, pid, cfg)
        sell = res['sell_price'] * (1 - cfg['slippage'])
        buy_fee = max(cfg['commission'] * cfg['position'], cfg['min_commission']) / cfg['position']
        sell_fee = max(cfg['commission'] * cfg['position'] * sell / buy,
                       cfg['min_commission']) / cfg['position']
        cost = buy_fee + sell_fee + cfg['stamp_tax']
        vals.append((sell / buy - 1 - cost) * 100)
        holds.append(res['sell_index'] - j)
    return vals, holds


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--patterns', required=True, help='逗号分隔形态ID')
    p.add_argument('--limit', type=int, default=900, help='子样本股票数（按代码排序取前 N）')
    p.add_argument('--dims', default='all', help='all 或逗号分隔维度（drop,rs,vol）')
    p.add_argument('--start', default='2021-01-01')
    p.add_argument('--end', default='2026-09-18')
    p.add_argument('--out', required=True)
    args = p.parse_args(argv)

    cfg = dict(DEFAULT)
    cfg['start'], cfg['end'] = args.start, args.end
    pids = [x.strip() for x in args.patterns.split(',')]
    for pid in pids:
        patterns.get(pid)
    if args.dims == 'all':
        dims = list(LEVELS)
    else:
        dims = [x.strip() for x in args.dims.split(',')]
        for d in dims:
            if d not in LEVELS:
                raise SystemExit(f'未知维度: {d}')
    cfg['_exit_cache'] = {pid: resolve_exit(pid, cfg) for pid in pids}

    mkt = Market(min_bars=250)
    names = load_names()
    mkt.set_names(names)
    factors = load_factors()
    codes = mkt.codes()[:args.limit]
    bench = load_benchmark()
    if bench is None:
        print('警告：未找到沪深300基准，rs 维度将全部不生效', file=sys.stderr)

    # 一次性算好每只股票的指标，之后所有维度/级别复用，扫描才够快
    cache = []
    for code in codes:
        bars = mkt.load(code, cfg['adj'], factors.get(code))
        if len(bars) < cfg['min_list_days'] + 5:
            continue
        ind = compute_indicators(bars, code, names.get(code, ''))
        ind['date'] = bars['date']
        if bench is not None:
            ind['bench_close'] = _align_bench(bench, bars['date'])
        cache.append((code, bars, ind))

    out = {'scope': {'codes': len(cache), 'patterns': pids,
                     'start': args.start, 'end': args.end},
           'bench': 'sh000300' if bench is not None else None,
           'results': {}}
    for pid in pids:
        out['results'][pid] = {'base': {}, 'dims': {}}
        base_vals, base_holds = [], []
        for code, bars, ind in cache:
            v, h = _trades(ind, bars, pid, None, cfg)
            base_vals += v
            base_holds += h
        out['results'][pid]['base'] = _stats(base_vals, base_holds)
        for dim in dims:
            levels = LEVELS[dim]
            rows = {}
            for label, params in levels:
                if params is None:
                    rows[label] = dict(out['results'][pid]['base'])
                    continue
                vals, holds = [], []
                for code, bars, ind in cache:
                    v, h = _trades(ind, bars, pid, params, cfg)
                    vals += v
                    holds += h
                rows[label] = _stats(vals, holds)
            out['results'][pid]['dims'][dim] = rows
            print(f'{pid} {dim} done', file=sys.stderr)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    for pid, res in out['results'].items():
        print(f"== {pid} base n={res['base'].get('n')} PF={res['base'].get('profit_factor')}")
        for dim, rows in res['dims'].items():
            for label, st in rows.items():
                print(f'   {dim:5s} {label:12s} n={st.get("n"):>7} '
                      f'PF={st.get("profit_factor")} 盈亏比={st.get("payoff_ratio")} '
                      f'胜率={st.get("win_rate")} 均值={st.get("avg_pct")}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
