# -*- coding: utf-8 -*-
"""信号密度阈值的样本外（walk-forward）验证。

``docs/25形态回测报告-2021至2026.md`` 第十二节的结论是：25 形态等权堆仓六年
-56.72%，而「只在信号密集日出手」可以翻正为 +48.32%。但那个分位阈值是用
**全区间**信号数分布算出来的，属于样本内发现，不能直接上线。

本脚本把它改成实盘可执行的口径：

* **密度阈值只用当天之前的历史**估计（滚动窗口或扩展窗口）；当天信号数本身在
  收盘时即可观测，使用它不构成未来数据；
* **形态白名单**由当天之前的历史逐形态 PF 决定（不再用全样本 PF 挑选）；
* **同日多形态的优先级**同样由当天之前的历史 PF 排名决定。

同时保留样本内基线（静态分位 / 静态全信号）做交叉验证，可以直接看出
「样本外」比「样本内」差多少。

用法::

    python tools/xingtaidu_density_oos.py \
        --glob "data/backtest/xingtaidu/xingtaidu_25_pattern_exit_v2_2021_2026.csv" \
        --summary "data/backtest/xingtaidu/xingtaidu_25_pattern_exit_v2_2021_2026.json" \
        --out data/backtest/xingtaidu/portfolio_v2/density_oos.json
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


def to_cal_pos(values, calendar):
    """把 YYYYMMDD 数组映射到交易日历下标，非交易日返回 -1。"""
    cal = np.asarray(calendar, dtype=np.int64)
    v = np.asarray(values, dtype=np.int64)
    pos = np.searchsorted(cal, v)
    ok = (pos < len(cal)) & (cal[np.clip(pos, 0, len(cal) - 1)] == v)
    return np.where(ok, pos, -1).astype(np.int64)


def build_pattern_index(buy_pos, pat_idx, n_patterns):
    """每个形态的成交按买入日排序后的下标数组。"""
    out = []
    for p in range(n_patterns):
        idx = np.flatnonzero(pat_idx == p)
        out.append(idx[np.argsort(buy_pos[idx], kind='stable')])
    return out


def trailing_pf(by_pat, buy_pos, net, dp, lo_pos, n_patterns):
    """只用「买日 < dp 且 >= lo_pos」的成交，算逐形态 PF 与样本数。"""
    pf = np.zeros(n_patterns, dtype=float)
    n = np.zeros(n_patterns, dtype=np.int64)
    for p, idx in enumerate(by_pat):
        bp = buy_pos[idx]
        lo = int(np.searchsorted(bp, lo_pos, 'left'))
        hi = int(np.searchsorted(bp, dp, 'left'))
        if hi <= lo:
            continue
        v = net[idx[lo:hi]]
        win = float(v[v > 0].sum())
        loss = float(-v[v < 0].sum())
        n[p] = hi - lo
        pf[p] = (win / loss) if loss > 0 else (np.inf if win > 0 else 0.0)
    return pf, n


def dedup_dyn(data, mask, pri_trade, min_gap, cal_pos):
    """与 ``portfolio.dedup`` 同规则，但优先级逐笔传入（形态白名单是动态的）。"""
    idx = np.flatnonzero(mask)
    if not len(idx):
        return idx
    code = data['code_idx'][idx]
    buy = data['buy'][idx]
    pri = pri_trade[idx]
    idx = idx[np.lexsort((pri, buy, code))]
    keep = np.zeros(len(idx), dtype=bool)
    last_code, last_buy_pos, last_sell = -1, -10 ** 9, 0
    for k, i in enumerate(idx):
        c = int(data['code_idx'][i])
        b = int(data['buy'][i])
        bp = cal_pos.get(b)
        if bp is None:
            continue
        if c != last_code:
            last_code, last_buy_pos, last_sell = c, -10 ** 9, 0
        if b <= last_sell or bp - last_buy_pos < min_gap:
            continue
        keep[k] = True
        last_buy_pos = bp
        last_sell = int(data['sell'][i])
    return idx[keep]


def day_counts(idx, buy_pos_of):
    """按买入交易日统计信号数（返回升序日期下标与计数）。"""
    dp = np.sort(buy_pos_of[idx])
    return np.unique(dp, return_counts=True)


def static_density(idx, buy_pos_of, floor, pct):
    """原口径：分位数来自全区间信号分布（样本内）。"""
    day, cnt = day_counts(idx, buy_pos_of)
    if not len(day):
        return np.zeros(len(idx), dtype=bool), {'static_threshold': None}
    thr = max(float(floor), float(np.percentile(cnt, pct)) if pct > 0 else 0.0)
    keep = cnt[np.searchsorted(day, buy_pos_of[idx])] >= thr
    return keep, {'static_threshold': round(thr, 2), 'traded_days': int(day.size)}


def oos_density(idx, buy_pos_of, floor, pct, window, min_history_days, expanding):
    """样本外：阈值只用当天之前的历史信号分布估计，历史不足的日子不出手。"""
    day, cnt = day_counts(idx, buy_pos_of)
    keep = np.zeros(len(idx), dtype=bool)
    if not len(day):
        return keep, {'traded_days': 0, 'avg_threshold': None}
    pos = np.searchsorted(day, buy_pos_of[idx])
    thr_all, scored = [], 0
    for k, d in enumerate(day):
        if expanding:
            hist = cnt[:k]
        else:
            lo = int(np.searchsorted(day, d - window, 'left'))
            hist = cnt[lo:k]
        if len(hist) < min_history_days:
            continue
        scored += 1
        thr = max(float(floor), float(np.percentile(hist, pct)) if pct > 0 else 0.0)
        thr_all.append(thr)
        if cnt[k] >= thr:
            keep[pos == k] = True
    traded_days = int(np.unique(pos[keep]).size) if keep.any() else 0
    return keep, {'traded_days': traded_days, 'scored_days': scored,
                  'avg_threshold': round(float(np.mean(thr_all)), 2) if thr_all else None}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--glob', required=True)
    ap.add_argument('--summary', required=True)
    ap.add_argument('--out', default=os.path.join(PF.OUT_DIR, 'portfolio_v2',
                                                  'density_oos.json'))
    ap.add_argument('--min-pf', type=float, default=1.0)
    ap.add_argument('--min-trades', type=int, default=60,
                    help='样本外白名单要求的历史成交笔数')
    ap.add_argument('--window', type=int, default=250, help='滚动窗口长度（交易日）')
    ap.add_argument('--min-history-days', type=int, default=60,
                    help='至少要有多少个「有信号交易日」的历史才允许出手')
    ap.add_argument('--min-gap', type=int, default=10)
    ap.add_argument('--max-positions', type=int, default=10)
    ap.add_argument('--start', default='2021-01-01')
    ap.add_argument('--end', default='2026-09-18')
    ap.add_argument('--priority-from', default='P2021_2023',
                    help='样本内基线的优先级来源；样本外一律用历史 PF 排名')
    a = ap.parse_args(argv)

    data = PF.load_trades(a.glob)
    pats = data['patterns']
    n_pat = len(pats)
    with open(a.summary, encoding='utf-8') as f:
        summ = json.load(f)
    extra = summ.get('extra', {})
    peri = summ.get('periods', {}).get(a.priority_from, {})

    market = Market(min_bars=250)
    factors = __import__('xingtaidu_backtest').load_factors()
    calendar = PF.trading_calendar(market, a.start, a.end)
    marks = PF.Marks(market, factors, calendar)
    buy_pos = to_cal_pos(data['buy'], calendar)
    valid = buy_pos >= 0
    print(f"明细 {len(data['buy'])} 笔，形态 {n_pat} 个，交易日 {len(calendar)} 天")

    # 样本内基线：全样本 PF 选形态 + P2021_2023 PF 定优先级（与第十二节一致）
    pf_all = {p: extra.get(p, {}).get('profit_factor') for p in pats}
    n_all = {p: extra.get(p, {}).get('n', 0) for p in pats}
    pf_pri = {p: (peri.get(p, {}).get('pf') or pf_all[p]) for p in pats}
    rank_static = sorted(pats, key=lambda p: -(pf_pri[p] or 0))
    pri_static_pat = np.array([{p: r for r, p in enumerate(rank_static)}[p] for p in pats],
                              dtype=np.int32)
    chosen_static = [p for p in pats
                     if (pf_all[p] or 0) >= a.min_pf and n_all[p] >= 200]
    static_mask = np.isin(data['pat_idx'],
                          np.array([pats.index(p) for p in chosen_static], dtype=np.int8))
    pri_static_trade = pri_static_pat[data['pat_idx']]
    print('样本内基线形态：' + ', '.join(chosen_static))

    # 样本外：逐日滚动估计 PF 白名单与优先级
    by_pat = build_pattern_index(buy_pos, data['pat_idx'], n_pat)
    net64 = data['net'].astype(np.float64)
    days = np.unique(buy_pos[valid])
    eligible = np.zeros((len(days), n_pat), dtype=bool)
    pri_dyn = np.zeros((len(days), n_pat), dtype=np.int32)
    for k, dp in enumerate(days):
        pf, n = trailing_pf(by_pat, buy_pos, net64, int(dp), int(dp) - a.window, n_pat)
        eligible[k] = (n >= a.min_trades) & (pf >= a.min_pf)
        order = np.argsort(-np.where(np.isfinite(pf), pf, 0.0), kind='stable')
        r = np.empty(n_pat, dtype=np.int32)
        r[order] = np.arange(n_pat, dtype=np.int32)
        pri_dyn[k] = r
    slot = np.where(valid, np.searchsorted(days, buy_pos), 0)
    dyn_mask = eligible[slot, data['pat_idx']] & valid
    pri_dyn_trade = pri_dyn[slot, data['pat_idx']]
    print(f'样本外白名单平均 {eligible.sum(axis=1).mean():.2f} / {n_pat} 个形态；'
          f'通过白名单的信号 {int(dyn_mask.sum())} 笔')

    def run(mask, pri_trade, density, dens_kind):
        idx = dedup_dyn(data, mask, pri_trade, a.min_gap, marks.pos)
        meta = {}
        if dens_kind == 'static':
            keep, meta = static_density(idx, buy_pos, *density)
            idx = idx[keep]
        elif dens_kind == 'oos':
            keep, meta = oos_density(idx, buy_pos, *density)
            idx = idx[keep]
        res = PF.simulate(data, idx, marks, calendar, a.max_positions,
                          1.0 / a.max_positions, 1.0)
        net = [t['net_pct'] for t in res['trades']]
        hold = [t['hold'] for t in res['trades']]
        return {'signals': int(len(idx)),
                'curve': PF.curve_stats(res['equity'], calendar),
                'trades': PF.trade_stats(net, hold),
                'yearly': PF.period_returns(res['equity'], calendar, 'Y'),
                'avg_open_positions': round(float(res['n_open'].mean()), 2),
                'exposure_pct': round(float((res['n_open'] > 0).mean() * 100), 2),
                'meta': meta}, res

    scenarios = {
        'static_all_signals': (static_mask, pri_static_trade, None, None),
        'static_dense_90': (static_mask, pri_static_trade, (0, 90.0), 'static'),
        'static_dense_200_90': (static_mask, pri_static_trade, (200, 90.0), 'static'),
        'oos_all_signals': (dyn_mask, pri_dyn_trade, None, None),
        'oos_roll_90': (dyn_mask, pri_dyn_trade,
                        (0, 90.0, a.window, a.min_history_days, False), 'oos'),
        'oos_roll_100_90': (dyn_mask, pri_dyn_trade,
                            (100, 90.0, a.window, a.min_history_days, False), 'oos'),
        'oos_roll_200_90': (dyn_mask, pri_dyn_trade,
                            (200, 90.0, a.window, a.min_history_days, False), 'oos'),
        'oos_roll_100_80': (dyn_mask, pri_dyn_trade,
                            (100, 80.0, a.window, a.min_history_days, False), 'oos'),
        'oos_expand_100_90': (dyn_mask, pri_dyn_trade,
                              (100, 90.0, a.window, a.min_history_days, True), 'oos'),
    }

    report = {'config': {k: v for k, v in vars(a).items()},
              'patterns': pats, 'chosen_static': chosen_static,
              'avg_eligible_patterns': round(float(eligible.sum(axis=1).mean()), 2),
              'scenarios': {}, 'by_pattern_oos': {}}

    print(f"\n{'情景':<22}{'信号':>8}{'成交':>7}{'总收益%':>10}{'年化%':>9}"
          f"{'回撤%':>9}{'夏普':>7}{'胜率%':>8}{'盈亏比':>8}{'PF':>8}{'暴露%':>8}")
    nan = float('nan')
    for name, (mask, pri, dens, kind) in scenarios.items():
        out, _ = run(mask, pri, dens, kind)
        report['scenarios'][name] = out
        c, t = out['curve'], out['trades']
        print(f"{name:<22}{out['signals']:>8}{t['trades']:>7}{c['total_return_pct']:>10.2f}"
              f"{(c['cagr_pct'] if c['cagr_pct'] is not None else nan):>9.2f}"
              f"{c['max_drawdown_pct']:>9.2f}"
              f"{(c['sharpe'] if c['sharpe'] is not None else nan):>7.2f}"
              f"{(t['win_rate_pct'] or nan):>8.2f}{(t['payoff'] or nan):>8.3f}"
              f"{(t['profit_factor'] or nan):>8.3f}{out['exposure_pct']:>8.1f}")

    print('\n== 逐形态样本外密集日组合（滚动 %d 日 / 90 分位 / 下限 100）==' % a.window)
    print(f"{'形态':<22}{'成交':>7}{'年化%':>9}{'回撤%':>9}{'胜率%':>8}{'PF':>8}")
    for pid in pats:
        m = (data['pat_idx'] == pats.index(pid)) & valid
        if int(m.sum()) < 200:
            continue
        out, _ = run(m, pri_dyn_trade,
                     (100, 90.0, a.window, a.min_history_days, False), 'oos')
        report['by_pattern_oos'][pid] = out
        c, t = out['curve'], out['trades']
        print(f"{pid:<22}{t['trades']:>7}"
              f"{(c['cagr_pct'] if c['cagr_pct'] is not None else nan):>9.2f}"
              f"{c['max_drawdown_pct']:>9.2f}"
              f"{(t['win_rate_pct'] or nan):>8.2f}{(t['profit_factor'] or nan):>8.3f}")

    main_name = 'oos_roll_100_90'
    _, main_res = run(*scenarios[main_name])
    outdir = os.path.dirname(a.out)
    os.makedirs(outdir, exist_ok=True)
    eq_path = os.path.join(outdir, 'equity_oos.csv')
    PF.write_equity_csv(eq_path, calendar, main_res['equity'], main_res['n_open'])
    PF.write_trades_csv(os.path.join(outdir, 'trades_oos.csv'), main_res['trades'])
    print('\n分年收益（%）：')
    for k in ('static_all_signals', 'static_dense_90', 'oos_all_signals', main_name):
        print(f'  {k:<20}' + '  '.join(f'{y}:{v:+.2f}'
                                       for y, v in report['scenarios'][k]['yearly'].items()))
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print('\n输出:', a.out, '|', eq_path)
    return report


if __name__ == '__main__':
    main()
