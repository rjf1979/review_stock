# -*- coding: utf-8 -*-
"""组合层回测：在 25 形态逐笔明细之上做信号去重 + 组合资金曲线与最大回撤。

输入是 ``tools/xingtaidu_backtest.py`` 分片合并后的**逐笔明细 CSV** 与同名 JSON
（只读本地文件，不联网）。逐笔回测回答「单笔平均赚多少」，本脚本回答
「真的按这套信号去做，账户资金曲线长什么样」。

三个层次
--------
1. **形态筛选**：``--pattern-set pf_gt_1``（默认）只保留逐形态
   profit_factor >= ``--min-pf`` 的形态，即「单笔期望为正」的形态；
   ``all`` 用全部 25 个形态做对照，``top5`` 只取 PF 最高的 5 个。
2. **信号去重**：这是逐笔回测与真实交易最大的差距，规则为

   * 同一只股票同一个方向，``--min-gap`` 个交易日内只取第一个信号；
   * 持仓期间（buy_date ~ sell_date）同一只股票不再开新仓；
   * 同一天同一只股票被多个形态命中时，只取优先级最高的一个
     （优先级默认按 ``--priority-from`` 指定区间的逐形态 PF 排序）。

3. **组合模拟**：按交易日推进，``sell_date`` 释放仓位后才可以开新仓，
   最多同时持有 ``--max-positions`` 只，每笔投入 ``--position-pct`` 比例的
   当前权益（默认等权 = 1 / max_positions），用本地 qfq 日线逐日盯市，
   输出资金曲线、最大回撤、年化、夏普、月度/年度收益。

口径说明
--------
* 买入价 = 信号次日开盘 ×(1+滑点)，卖出价 = 退出日价格 ×(1-滑点)，
  净收益直接用逐笔明细里的 ``net_pct``（已含双边手续费、印花税、滑点）。
* 持仓期逐日盯市用的是**前复权收盘价**，与逐笔明细同源，除权不会造成假跳空。
* 停牌日沿用最近一次可用收盘价（前向填充）；同日先卖出释放资金、再开新仓。
* 这是一个「单账户、固定等权、先到先得」的简化组合，不是完整的多因子资产
  管理系统；结果用于比较形态与规则，不构成投资建议。
"""
from __future__ import annotations

import argparse
import array
import csv
import glob
import json
import os
import sys
from collections import defaultdict

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from kdata import Market, int_to_ymd  # noqa: E402

OUT_DIR = os.path.normpath(os.path.join(HERE, '..', 'data', 'backtest', 'xingtaidu'))
CSV_LIMIT = 10 ** 9


# --------------------------------------------------------------------------
# 读取逐笔明细（单遍流式解析成紧凑数组，2.7M 笔约占 50MB）
# --------------------------------------------------------------------------
def load_trades(pattern_glob):
    csv.field_size_limit(CSV_LIMIT)
    codes, pats = {}, {}
    a_code = array.array('i'); a_pat = array.array('b')
    a_buy = array.array('i'); a_sell = array.array('i')
    a_net = array.array('f'); a_hold = array.array('h')
    files = sorted(glob.glob(pattern_glob))
    if not files:
        raise SystemExit(f'没有匹配到明细文件: {pattern_glob}')
    for path in files:
        with open(path, encoding='utf-8-sig', newline='') as f:
            rd = csv.reader(f)
            head = next(rd)
            ix = {k: i for i, k in enumerate(head)}
            ic, ip, ib = ix['code'], ix['pattern'], ix['buy_date']
            isl, inn, ih = ix['sell_date'], ix['net_pct'], ix['hold_days']
            for row in rd:
                c = row[ic]
                ci = codes.get(c)
                if ci is None:
                    ci = codes[c] = len(codes)
                p = row[ip]
                pi = pats.get(p)
                if pi is None:
                    pi = pats[p] = len(pats)
                a_code.append(ci); a_pat.append(pi)
                a_buy.append(int(row[ib].replace('-', '')))
                a_sell.append(int(row[isl].replace('-', '')))
                a_net.append(float(row[inn])); a_hold.append(int(row[ih]))
    inv_codes = [None] * len(codes)
    for c, i in codes.items():
        inv_codes[i] = c
    inv_pats = [None] * len(pats)
    for p, i in pats.items():
        inv_pats[i] = p
    return {
        'code_idx': np.frombuffer(a_code, dtype=np.int32),
        'pat_idx': np.frombuffer(a_pat, dtype=np.int8),
        'buy': np.frombuffer(a_buy, dtype=np.int32),
        'sell': np.frombuffer(a_sell, dtype=np.int32),
        'net': np.frombuffer(a_net, dtype=np.float32),
        'hold': np.frombuffer(a_hold, dtype=np.int16),
        'codes': inv_codes, 'patterns': inv_pats,
    }


def trading_calendar(market, start, end):
    days = set()
    for code in market.codes():
        days.update(int(d) for d in market.raw(code)['date'])
    s, e = int(start.replace('-', '')), int(end.replace('-', ''))
    return np.array(sorted(d for d in days if s <= d <= e), dtype=np.int32)


class Marks:
    """按交易日历对齐的前复权收盘价（停牌前向填充）。"""

    def __init__(self, market, factors, calendar):
        self.market = market
        self.factors = factors
        self.calendar = calendar
        self.pos = {int(d): i for i, d in enumerate(calendar)}
        self.cache = {}

    def series(self, code):
        hit = self.cache.get(code)
        if hit is not None:
            return hit
        bars = self.market.load(code, 'qfq', self.factors.get(code))
        arr = np.full(len(self.calendar), np.nan)
        for d, c in zip(bars['date'], bars['close']):
            j = self.pos.get(int(d))
            if j is not None:
                arr[j] = c
        last = np.nan
        for i in range(len(arr)):
            arr[i] = last if np.isnan(arr[i]) else arr[i]
            last = arr[i]
        self.cache[code] = arr
        return arr


# --------------------------------------------------------------------------
# 信号去重
# --------------------------------------------------------------------------
def dedup(data, mask, priority, min_gap, cal_pos):
    """同一股票：min_gap 个交易日内只留一个信号、持仓期不叠加；同日多形态取优先级最高。"""
    idx = np.flatnonzero(mask)
    if not len(idx):
        return idx
    code = data['code_idx'][idx]
    buy = data['buy'][idx]
    pri = priority[data['pat_idx'][idx]]
    order = np.lexsort((pri, buy, code))
    idx = idx[order]
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


def density_filter(data, idx, cal_pos, min_signals=0, pct=0.0):
    """只保留「当日信号数 ≥ min_signals 且 ≥ 当日信号数分布的第 pct 百分位」的信号。

    逐笔回测显示：rsi_low_turn 的收益高度集中在全市场同时触发（>100 只）的
    恐慌日，普通日基本是负期望。这个过滤把有限仓位留给密集信号日。
    """
    if not len(idx) or (min_signals <= 1 and pct <= 0):
        return np.ones(len(idx), dtype=bool) if len(idx) else np.zeros(0, dtype=bool)
    day = {}
    for i in idx:
        d = int(data['buy'][i])
        day[d] = day.get(d, 0) + 1
    counts = np.array(list(day.values()))
    thr = float(np.percentile(counts, pct)) if pct > 0 else 0.0
    thr = max(thr, float(min_signals))
    return np.array([day[int(data['buy'][i])] >= thr for i in idx], dtype=bool)


# --------------------------------------------------------------------------
# 组合模拟
# --------------------------------------------------------------------------
def simulate(data, idx, marks, calendar, max_positions, position_pct, initial=1.0):
    """按交易日推进的单账户等权组合；返回资金曲线、持仓数与每笔成交。"""
    cal_pos = marks.pos
    by_buy = defaultdict(list)
    for i in idx:
        bp = cal_pos.get(int(data['buy'][i]))
        if bp is not None:
            by_buy[bp].append(int(i))
    open_pos = {}          # key: 序号 -> dict
    cash = initial
    equity = np.empty(len(calendar), dtype=float)
    n_open = np.zeros(len(calendar), dtype=np.int32)
    trades = []
    seq = 0
    for di in range(len(calendar)):
        # 1) 先结算今天该卖的（释放现金与仓位）
        for key in [k for k, p in open_pos.items() if p['sell_pos'] <= di]:
            p = open_pos.pop(key)
            cash += p['alloc'] * (1 + p['net'])
            trades.append(p)
        # 2) 当前权益（现金 + 持仓盯市）
        mv = sum(p['alloc'] * (p['series'][di] / p['buy_px']) for p in open_pos.values())
        eq_now = cash + mv
        # 3) 按剩余仓位开新仓
        for i in by_buy.get(di, ()):
            if len(open_pos) >= max_positions:
                break
            alloc = min(eq_now * position_pct, cash)
            if alloc <= 1e-9:
                continue
            code = data['codes'][int(data['code_idx'][i])]
            sp = cal_pos.get(int(data['sell'][i]))
            if sp is None or sp <= di:
                continue
            series = marks.series(code)
            buy_px = series[di]
            if not np.isfinite(buy_px) or buy_px <= 0:
                continue
            cash -= alloc
            open_pos[seq] = {
                'code': code, 'pattern': data['patterns'][int(data['pat_idx'][i])],
                'buy_date': int_to_ymd(int(data['buy'][i])),
                'sell_date': int_to_ymd(int(data['sell'][i])),
                'buy_pos': di, 'sell_pos': sp, 'alloc': alloc,
                'net': float(data['net'][i]) / 100.0, 'net_pct': float(data['net'][i]),
                'hold': int(data['hold'][i]), 'series': series, 'buy_px': buy_px,
                'buy_idx': int(i),
            }
            seq += 1
        equity[di] = cash + sum(p['alloc'] * (p['series'][di] / p['buy_px'])
                                for p in open_pos.values())
        n_open[di] = len(open_pos)
    return {'equity': equity, 'n_open': n_open, 'trades': trades,
            'open_at_end': len(open_pos)}


def curve_stats(equity, calendar):
    eq = np.asarray(equity, dtype=float)
    peak = np.maximum.accumulate(eq)
    dd = eq / peak - 1.0
    ret = np.diff(eq) / eq[:-1]
    ret = ret[np.isfinite(ret)]
    years = (len(eq) - 1) / 244.0
    total = eq[-1] / eq[0] - 1.0
    cagr = (eq[-1] / eq[0]) ** (1 / years) - 1 if years > 0 and eq[-1] > 0 else None
    sharpe = float(ret.mean() / ret.std(ddof=1) * np.sqrt(244)) \
        if len(ret) > 1 and ret.std(ddof=1) > 0 else None
    down = ret[ret < 0]
    sortino = float(ret.mean() / down.std(ddof=1) * np.sqrt(244)) \
        if len(down) > 1 and down.std(ddof=1) > 0 else None
    mdd_i = int(np.argmin(dd))
    rec = None
    if dd[mdd_i] < 0:
        after = np.flatnonzero(eq[mdd_i:] >= peak[mdd_i])
        if len(after):
            rec = int_to_ymd(int(calendar[mdd_i + int(after[0])]))
    return {
        'final_equity': round(float(eq[-1]), 4),
        'total_return_pct': round(float(total * 100), 2),
        'cagr_pct': None if cagr is None else round(float(cagr * 100), 2),
        'max_drawdown_pct': round(float(dd.min() * 100), 2),
        'max_dd_date': int_to_ymd(int(calendar[mdd_i])),
        'max_dd_recover_date': rec,
        'sharpe': None if sharpe is None else round(sharpe, 2),
        'sortino': None if sortino is None else round(sortino, 2),
        'daily_win_rate_pct': round(float((ret > 0).mean() * 100), 2) if len(ret) else None,
    }


def trade_stats(net, hold):
    v = np.asarray(net, dtype=float)
    if not len(v):
        return {'trades': 0, 'win_rate_pct': None, 'avg_net_pct': None,
                'median_net_pct': None, 'payoff': None, 'profit_factor': None,
                'avg_hold_days': None}
    w, ls = v[v > 0], v[v < 0]
    return {
        'trades': int(len(v)),
        'win_rate_pct': round(float((v > 0).mean() * 100), 2),
        'avg_net_pct': round(float(v.mean()), 4),
        'median_net_pct': round(float(np.median(v)), 4),
        'payoff': round(float(w.mean() / abs(ls.mean())), 4) if len(w) and len(ls) else None,
        'profit_factor': round(float(w.sum() / abs(ls.sum())), 4) if len(w) and len(ls) else None,
        'avg_hold_days': round(float(np.mean(hold)), 2) if len(hold) else None,
    }


def period_returns(equity, calendar, freq):
    """按自然月 / 自然年切段的区间收益率（%）。"""
    key_of = (lambda s: s[:7]) if freq == 'M' else (lambda s: s[:4])
    out, base = {}, equity[0]
    prev = key_of(int_to_ymd(int(calendar[0])))
    for i in range(1, len(equity)):
        key = key_of(int_to_ymd(int(calendar[i])))
        if key != prev:
            out[prev] = round((equity[i - 1] / base - 1) * 100, 2)
            base = equity[i - 1]
            prev = key
    out[prev] = round((equity[-1] / base - 1) * 100, 2)
    return out


def write_equity_csv(path, calendar, equity, n_open):
    peak = np.maximum.accumulate(equity)
    with open(path, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(['date', 'equity', 'drawdown_pct', 'open_positions'])
        for i, d in enumerate(calendar):
            w.writerow([int_to_ymd(int(d)), round(float(equity[i]), 6),
                        round(float(equity[i] / peak[i] - 1) * 100, 4), int(n_open[i])])


def write_trades_csv(path, trades):
    cols = ['code', 'pattern', 'buy_date', 'sell_date', 'hold_days',
            'net_pct', 'alloc_pct_of_equity', 'pnl_pct_of_equity']
    with open(path, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(cols)
        for t in trades:
            w.writerow([t['code'], t['pattern'], t['buy_date'], t['sell_date'],
                        t['hold'], round(t['net_pct'], 4), round(t['alloc'], 6),
                        round(t['alloc'] * t['net'] * 100, 4)])


# --------------------------------------------------------------------------
# 主流程
# --------------------------------------------------------------------------
def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--glob', required=True, help='逐笔明细 CSV 的 glob')
    ap.add_argument('--summary', required=True, help='合并输出的 JSON（取逐形态 PF）')
    ap.add_argument('--outdir', default=os.path.join(OUT_DIR, 'portfolio_v2'))
    ap.add_argument('--pattern-set', default='pf_gt_1', choices=('pf_gt_1', 'all', 'top5'))
    ap.add_argument('--min-pf', type=float, default=1.0)
    ap.add_argument('--min-trades', type=int, default=200)
    ap.add_argument('--priority-from', default='P2021_2023',
                    help='用哪一段的逐形态 PF 决定同日多信号的优先级')
    ap.add_argument('--min-gap', type=int, default=10, help='同一股票两次开仓的最小交易日间隔')
    ap.add_argument('--max-positions', type=int, default=10)
    ap.add_argument('--position-pct', type=float, default=0.0, help='0 = 等权 1/max_positions')
    ap.add_argument('--min-day-signals', type=int, default=100,
                    help='信号密度过滤的绝对下限（当日同批信号数）')
    ap.add_argument('--density-pct', type=float, default=90.0,
                    help='信号密度过滤的相对下限（当日信号数的百分位）')
    ap.add_argument('--start', default='2021-01-01')
    ap.add_argument('--end', default='2026-09-18')
    ap.add_argument('--initial', type=float, default=1.0)
    a = ap.parse_args(argv)

    os.makedirs(a.outdir, exist_ok=True)
    data = load_trades(a.glob)
    n_all = len(data['net'])
    with open(a.summary, encoding='utf-8') as f:
        summ = json.load(f)
    extra = summ.get('extra', {})
    peri = summ.get('periods', {}).get(a.priority_from, {})

    # 逐形态 PF：全区间用于筛选，优先区间用于优先级（避免同日多形态选择时偷看未来）
    pf_all, pf_pri, n_by = {}, {}, {}
    for pid in data['patterns']:
        e = extra.get(pid, {})
        pf_all[pid] = e.get('profit_factor')
        n_by[pid] = e.get('n', 0)
        p = peri.get(pid, {})
        pf_pri[pid] = p.get('pf') if p.get('pf') is not None else pf_all[pid]
    rank = sorted((p for p in data['patterns']),
                  key=lambda p: -(pf_pri[p] if pf_pri[p] is not None else 0))
    pri_of = {p: r for r, p in enumerate(rank)}
    priority = np.array([pri_of[p] for p in data['patterns']], dtype=np.int32)

    if a.pattern_set == 'pf_gt_1':
        chosen = [p for p in data['patterns']
                  if (pf_all[p] or 0) >= a.min_pf and n_by[p] >= a.min_trades]
    elif a.pattern_set == 'top5':
        chosen = rank[:5]
    else:
        chosen = list(data['patterns'])
    chosen = [p for p in chosen]
    pat_mask = np.isin(data['pat_idx'],
                       np.array([data['patterns'].index(p) for p in chosen], dtype=np.int8))

    print(f'明细 {n_all} 笔，形态 {len(data["patterns"])} 个，入选 {len(chosen)} 个: '
          + ', '.join(chosen))
    print(f'优先级（{a.priority_from} PF 降序）: ' + ', '.join(rank[:8]) + ' ...')

    market = Market(min_bars=250)
    factors = {}
    try:
        factors = __import__('xingtaidu_backtest').load_factors()
    except Exception as exc:                     # noqa: BLE001
        print(f'复权因子载入失败，改用不复权口径: {exc}', file=sys.stderr)
    calendar = trading_calendar(market, a.start, a.end)
    marks = Marks(market, factors, calendar)
    cal_pos = marks.pos

    def run_one(mask, min_gap, max_pos, position_pct, density=None):
        idx = dedup(data, mask, priority, min_gap, cal_pos)
        if density:
            idx = idx[density_filter(data, idx, cal_pos, *density)]
        pct = position_pct or (1.0 / max_pos)
        res = simulate(data, idx, marks, calendar, max_pos, pct, a.initial)
        net = [t['net_pct'] for t in res['trades']]
        hold = [t['hold'] for t in res['trades']]
        out = {'grid': {'min_gap': min_gap, 'max_positions': max_pos,
                        'position_pct': round(pct, 4), 'signals': int(len(idx))},
               'curve': curve_stats(res['equity'], calendar),
               'trades': trade_stats(net, hold)}
        out['monthly'] = period_returns(res['equity'], calendar, 'M')
        out['yearly'] = period_returns(res['equity'], calendar, 'Y')
        out['avg_open_positions'] = round(float(res['n_open'].mean()), 2)
        out['exposure_pct'] = round(float((res['n_open'] > 0).mean() * 100), 2)
        return out, res

    dens = (a.min_day_signals, a.density_pct)
    scenarios = {
        'main': (pat_mask, a.min_gap, a.max_positions, a.position_pct),
        'gap5': (pat_mask, 5, a.max_positions, a.position_pct),
        'gap20': (pat_mask, 20, a.max_positions, a.position_pct),
        'pos5': (pat_mask, a.min_gap, 5, a.position_pct),
        'pos20': (pat_mask, a.min_gap, 20, a.position_pct),
        'no_dedup': (pat_mask, 1, a.max_positions, a.position_pct),
        'all25': (np.ones(n_all, dtype=bool), a.min_gap, a.max_positions, a.position_pct),
        'density': (pat_mask, a.min_gap, a.max_positions, a.position_pct),
    }
    if a.pattern_set != 'top5':
        top5_mask = np.isin(data['pat_idx'],
                            np.array([data['patterns'].index(p) for p in rank[:5]], dtype=np.int8))
        scenarios['top5'] = (top5_mask, a.min_gap, a.max_positions, a.position_pct)

    report = {'config': {k: v for k, v in vars(a).items()},
              'universe': {'trades': int(n_all), 'patterns': data['patterns'],
                           'chosen': chosen, 'priority_order': rank,
                           'pf_all': pf_all, 'pf_priority': pf_pri},
              'scenarios': {}, 'by_pattern_portfolio': {}}
    main_res = None
    for name, (mask, gap, mp, pp) in scenarios.items():
        out, res = run_one(mask, gap, mp, pp, dens if name == 'density' else None)
        out['grid']['density'] = list(dens) if name == 'density' else None
        report['scenarios'][name] = out
        if name == 'main':
            main_res = res
        c, t = out['curve'], out['trades']
        print(f"[{name:9s}] 交易 {t.get('trades',0):6d} 笔 收益 {c['total_return_pct']:8.2f}% "
              f"年化 {str(c['cagr_pct']):>7}% 最大回撤 {c['max_drawdown_pct']:7.2f}% "
              f"夏普 {str(c['sharpe']):>5} 胜率 {t.get('win_rate_pct')}% PF {t.get('profit_factor')}")

    # 逐形态单独跑一遍组合（同一去重/仓位规则），看「只做这一个形态」的账户曲线
    for pid in data['patterns']:
        pi = data['patterns'].index(pid)
        mask = data['pat_idx'] == pi
        if int(mask.sum()) < 50:
            continue
        out, _ = run_one(mask, a.min_gap, a.max_positions, a.position_pct)
        # 单形态用相对口径（信号数最多的 10% 交易日），避免稀疏形态被绝对阈值清空
        outd, _ = run_one(mask, a.min_gap, a.max_positions, a.position_pct,
                          (0, a.density_pct))
        report['by_pattern_portfolio'][pid] = {
            'raw': trade_stats(data['net'][mask], data['hold'][mask]),
            'portfolio': {k: out[k] for k in ('curve', 'trades', 'grid',
                                              'avg_open_positions', 'exposure_pct')},
            'portfolio_dense': {k: outd[k] for k in ('curve', 'trades', 'grid',
                                                     'avg_open_positions', 'exposure_pct')},
        }

    write_equity_csv(os.path.join(a.outdir, 'equity_main.csv'), calendar,
                     main_res['equity'], main_res['n_open'])
    write_trades_csv(os.path.join(a.outdir, 'trades_main.csv'), main_res['trades'])
    with open(os.path.join(a.outdir, 'metrics.json'), 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print('\n只做一个形态的组合（min_gap=%d，最多 %d 只）按「密集日组合年化」排序：'
          % (a.min_gap, a.max_positions))
    rows = []
    for pid, v in report['by_pattern_portfolio'].items():
        c = v['portfolio']['curve']; t = v['portfolio']['trades']
        dc = v['portfolio_dense']['curve']; dt = v['portfolio_dense']['trades']
        rows.append((pid, c['cagr_pct'], c['max_drawdown_pct'],
                     dt['trades'], dc['cagr_pct'], dc['max_drawdown_pct'],
                     dt['payoff'], dt['profit_factor'],
                     v['raw']['payoff'], v['raw']['avg_net_pct'], v['raw']['profit_factor']))
    rows.sort(key=lambda r: -((r[4] if r[4] is not None else -999)))
    print(f"{'形态':<22}{'全信号年化%':>11}{'全信号回撤%':>12}{'全信号笔数':>11}"
          f"{'密集日年化%':>12}{'密集日回撤%':>12}{'密集日盈亏比':>13}{'密集日PF':>10}"
          f"{'逐笔盈亏比':>11}{'逐笔均收益':>11}{'逐笔PF':>8}")
    for r in rows:
        nan = float('nan')
        print(f"{r[0]:<22}{(r[1] if r[1] is not None else nan):>11.2f}{r[2]:>12.2f}{r[3]:>11d}"
              f"{(r[4] if r[4] is not None else nan):>12.2f}{r[5]:>12.2f}"
              f"{(r[6] if r[6] else nan):>13.3f}{(r[7] if r[7] else nan):>10.3f}"
              f"{(r[8] if r[8] else nan):>11.3f}{r[9]:>11.3f}{(r[10] if r[10] else nan):>8.3f}")
    print(f"\n输出目录: {a.outdir}")
    return report


if __name__ == '__main__':
    main()
