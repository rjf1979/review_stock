# -*- coding: utf-8 -*-
"""组合层稳健性检验：信号密度阈值网格 + 分段（2021-2023 / 2024-2026）复算。

组合层回测发现「信号密度」是决定成败的变量：同一天同时触发的股票越多，
后续收益越好（全市场同时超卖）。这个脚本回答两个问题：

1. 换一个密度阈值，结论会不会翻？——阈值网格（绝对下限 × 分位下限）。
2. 效果是不是只来自某一段？——按 2021-2023 / 2024-2026 分别独立复算资金曲线。

用法::

    python tools/xingtaidu_portfolio_sensitivity.py \
        --glob "data/backtest/xingtaidu/xingtaidu_25_pattern_exit_v2_2021_2026.csv" \
        --summary "data/backtest/xingtaidu/xingtaidu_25_pattern_exit_v2_2021_2026.json" \
        --out data/backtest/xingtaidu/portfolio_v2/density_sensitivity.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import xingtaidu_portfolio as PF  # noqa: E402
from kdata import Market  # noqa: E402

GRID = [(0, 80.0), (50, 90.0), (100, 90.0), (150, 90.0), (100, 80.0), (200, 90.0)]
SPLITS = {'P2021_2023': ('2021-01-01', '2023-12-31'),
          'P2024_2026': ('2024-01-01', '2026-09-18')}


def run_window(data, idx, market, factors, start, end, max_pos, min_gap, dens,
               priority, initial=1.0):
    """在 [start,end] 内独立复算：只保留完整落在窗口内的交易，权益从 1.0 重新起算。"""
    s, e = int(start.replace('-', '')), int(end.replace('-', ''))
    keep = np.array([s <= int(data['buy'][i]) and int(data['sell'][i]) <= e for i in idx],
                    dtype=bool)
    sub = idx[keep]
    if not len(sub):
        return None
    calendar = PF.trading_calendar(market, start, end)
    marks = PF.Marks(market, factors, calendar)
    if dens:
        sub = sub[PF.density_filter(data, sub, marks.pos, *dens)]
        if not len(sub):
            return None
    res = PF.simulate(data, sub, marks, calendar, max_pos, 1.0 / max_pos, initial)
    net = [t['net_pct'] for t in res['trades']]
    hold = [t['hold'] for t in res['trades']]
    return {'curve': PF.curve_stats(res['equity'], calendar),
            'trades': PF.trade_stats(net, hold),
            'signals': int(len(sub))}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--glob', required=True)
    ap.add_argument('--summary', required=True)
    ap.add_argument('--out', default=os.path.join(PF.OUT_DIR, 'portfolio_v2',
                                                  'density_sensitivity.json'))
    ap.add_argument('--min-pf', type=float, default=1.0)
    ap.add_argument('--min-trades', type=int, default=200)
    ap.add_argument('--priority-from', default='P2021_2023')
    ap.add_argument('--min-gap', type=int, default=10)
    ap.add_argument('--max-positions', type=int, default=10)
    ap.add_argument('--start', default='2021-01-01')
    ap.add_argument('--end', default='2026-09-18')
    a = ap.parse_args(argv)

    data = PF.load_trades(a.glob)
    summ = json.load(open(a.summary, encoding='utf-8'))
    extra = summ['extra']
    peri = summ.get('periods', {}).get(a.priority_from, {})
    pf_all = {p: extra.get(p, {}).get('profit_factor') for p in data['patterns']}
    n_all = {p: extra.get(p, {}).get('n', 0) for p in data['patterns']}
    pf_pri = {p: (peri.get(p, {}).get('pf') or pf_all[p]) for p in data['patterns']}
    rank = sorted(data['patterns'], key=lambda p: -(pf_pri[p] or 0))
    priority = np.array([{p: r for r, p in enumerate(rank)}[p] for p in data['patterns']],
                        dtype=np.int32)
    chosen = [p for p in data['patterns'] if (pf_all[p] or 0) >= a.min_pf
              and n_all[p] >= a.min_trades]
    pi = np.array([data['patterns'].index(p) for p in chosen], dtype=np.int8)
    pat_mask = np.isin(data['pat_idx'], pi)

    market = Market(min_bars=250)
    factors = __import__('xingtaidu_backtest').load_factors()
    calendar = PF.trading_calendar(market, a.start, a.end)
    marks = PF.Marks(market, factors, calendar)
    base_idx = PF.dedup(data, pat_mask, priority, a.min_gap, marks.pos)
    print(f'入选形态 {chosen}；去重后信号 {len(base_idx)} 笔')

    out = {'chosen': chosen, 'grid': {}, 'splits': {}, 'by_pattern_dense': {}}

    print('\n== 密度阈值网格（全区间组合，最多 %d 只）==' % a.max_positions)
    print(f"{'绝对下限':>8}{'分位下限':>9}{'信号数':>9}{'成交数':>8}{'年化%':>9}"
          f"{'最大回撤%':>11}{'夏普':>8}{'胜率%':>8}{'PF':>8}")
    for min_signals, pct in GRID:
        sub = base_idx[PF.density_filter(data, base_idx, marks.pos, min_signals, pct)]
        res = PF.simulate(data, sub, marks, calendar, a.max_positions,
                          1.0 / a.max_positions, 1.0)
        net = [t['net_pct'] for t in res['trades']]
        hold = [t['hold'] for t in res['trades']]
        c = PF.curve_stats(res['equity'], calendar)
        t = PF.trade_stats(net, hold)
        out['grid'][f'{min_signals}_{pct:g}'] = {'curve': c, 'trades': t,
                                                 'signals': int(len(sub))}
        print(f'{min_signals:>8}{pct:>9.0f}{len(sub):>9}{t["trades"]:>8}'
              f'{c["cagr_pct"]:>9.2f}{c["max_drawdown_pct"]:>11.2f}'
              f'{c["sharpe"]:>8.2f}{t["win_rate_pct"]:>8.2f}{t["profit_factor"]:>8.3f}')

    print('\n== 分段独立复算（默认阈值 100 只 / 90 分位）==')
    for name, (s, e) in SPLITS.items():
        for tag, dens in (('全部信号', None), ('密集日', (100, 90.0))):
            r = run_window(data, base_idx, market, factors, s, e, a.max_positions,
                           a.min_gap, dens, priority)
            if not r:
                print(f'{name} {tag}: 样本不足')
                continue
            c, t = r['curve'], r['trades']
            out['splits'][f'{name}|{tag}'] = r
            print(f'{name} {tag:5s} 成交{t["trades"]:5d} 收益{c["total_return_pct"]:8.2f}% '
                  f'年化{c["cagr_pct"]:7.2f}% 回撤{c["max_drawdown_pct"]:8.2f}% '
                  f'胜率{t["win_rate_pct"]:6.2f}% PF{t["profit_factor"]:6.3f}')

    print('\n== 逐形态密集日组合（同一分位阈值，最多 %d 只）==' % a.max_positions)
    print(f"{'形态':<22}{'密集日数':>9}{'成交数':>8}{'年化%':>9}{'最大回撤%':>11}"
          f"{'胜率%':>8}{'PF':>8}{'逐笔PF':>8}")
    rows = []
    for pid in data['patterns']:
        m = data['pat_idx'] == data['patterns'].index(pid)
        idx = PF.dedup(data, m, priority, a.min_gap, marks.pos)
        dense = 0
        best = None
        for min_signals, pct in ((0, 90.0), (100, 90.0)):
            sub = idx[PF.density_filter(data, idx, marks.pos, min_signals, pct)]
            if not len(sub):
                continue
            r = run_window(data, sub, market, factors, a.start, a.end, a.max_positions,
                           a.min_gap, None, priority)
            if not r:
                continue
            dense = max(dense, len({int(data['buy'][i]) for i in sub}))
            if min_signals == 0:
                best = r
        if not best:
            continue
        c, t = best['curve'], best['trades']
        rows.append((pid, dense, t['trades'], c['cagr_pct'], c['max_drawdown_pct'],
                     t['win_rate_pct'], t['profit_factor'], pf_all[pid]))
        out['by_pattern_dense'][pid] = {'curve': c, 'trades': t, 'dense_days': dense}
    rows.sort(key=lambda r: -(r[3] if r[3] is not None else -999))
    for r in rows:
        print(f'{r[0]:<22}{r[1]:>9}{r[2]:>8}{(r[3] or float("nan")):>9.2f}'
              f'{r[4]:>11.2f}{r[5]:>8.2f}{(r[6] or float("nan")):>8.3f}'
              f'{(r[7] or float("nan")):>8.3f}')

    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print('\n输出:', a.out)
    return out


if __name__ == '__main__':
    main()
