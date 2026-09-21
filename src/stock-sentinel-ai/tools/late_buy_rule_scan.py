# -*- coding: utf-8 -*-
"""尾盘买入 → 次日早盘卖出：过滤条件扫描（用主回测导出的随机抽样本评估）。

样本来源是 ``tools/late_buy_next_morning.py --dump-all-sample`` 导出的
``trade_sample.csv``（全市场随机抽样，默认 2%）。因为每笔交易的:

- 尾盘特征（T 日 14:30 前即可得）
- 次日结果（``ret_open`` / ``ret_high`` / ``hit3`` / ``strat_ret``）

都已经在样本里，所以可以**离线**评估任意「特征阈值组合」的命中率，
不需要重跑分钟级回测。注意：所有数字都是**抽样估计**，不是全样本真值。

用法::

    python tools/late_buy_rule_scan.py --sample data/backtest/late-buy-next-morning-stock-only/trade_sample.csv
"""
from __future__ import annotations

import argparse
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def _stats(d: pd.DataFrame) -> dict:
    n = len(d)
    if not n:
        return {'n': 0}
    hit = d['hit3'].astype(float)
    pos = d['strat_ret'][d['strat_ret'] > 0].sum()
    neg = -d['strat_ret'][d['strat_ret'] < 0].sum()
    return {
        'n': n,
        'ge3_pct': round(hit.mean() * 100, 2),
        'ge5_pct': round((d['ret_high'] >= 0.05).mean() * 100, 2),
        'limit_pct': round((d['limit_touch'] == 1).mean() * 100, 2),
        'avg_ret_open_pct': round(d['ret_open'].mean() * 100, 3),
        'avg_ret_high_pct': round(d['ret_high'].mean() * 100, 3),
        'avg_strat_ret_pct': round(d['strat_ret'].mean() * 100, 3),
        'win_rate_pct': round((d['strat_ret'] > 0).mean() * 100, 2),
        'profit_factor': round(float(pos / neg), 3) if neg > 0 else None,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--sample', default='data/backtest/late-buy-next-morning-stock-only/trade_sample.csv')
    ap.add_argument('--min-n', type=int, default=800, help='低于该样本量的组合不打印')
    args = ap.parse_args()

    df = pd.read_csv(args.sample, dtype={'code': str})
    df['date'] = pd.to_datetime(df['date'])
    df['year'] = df['date'].dt.year
    print(f'[in] {args.sample}: {len(df)} 笔（随机抽样）')

    base = _stats(df)
    print(f'[base] {base}')

    o = df['ret_open'] * 100
    base_ge3 = base['ge3_pct']

    rules: list[tuple[str, pd.Series]] = []

    def add(name: str, mask: pd.Series) -> None:
        rules.append((name, mask.fillna(False)))

    # ---- 单条件：T 日盘中形态 ----
    add('振幅 ≥ 4%', df['amp'] >= 4)
    add('振幅 ≥ 6%', df['amp'] >= 6)
    add('振幅 ≥ 8%', df['amp'] >= 8)
    add('成交额 ≥ 2 亿', df['amount_wan'] >= 20000)
    add('成交额 ≥ 5 亿', df['amount_wan'] >= 50000)
    add('成交额 ≥ 10 亿', df['amount_wan'] >= 100000)
    add('T 日跌幅 3~9.5%', (df['pct'] <= -3) & (df['pct'] > -9.5))
    add('T 日跌幅 ≥ 5%', df['pct'] <= -5)
    add('T 日涨幅 3~7%', (df['pct'] >= 3) & (df['pct'] < 7))
    add('T 日涨幅 ≥ 5%', df['pct'] >= 5)
    add('收盘位置 ≤ 0.1', df['close_pos'] <= 0.1)
    add('收盘位置 ≥ 0.9', df['close_pos'] >= 0.9)
    add('量比 ≥ 1.5', df['vol_ratio'] >= 1.5)
    add('量比 ≥ 2.5', df['vol_ratio'] >= 2.5)
    add('ATR% ≥ 5', df['atr_pct'] >= 5)
    add('流通市值 ≤ 50 亿', df['float_mcap_yi'] <= 50)
    add('流通市值 ≥ 200 亿', df['float_mcap_yi'] >= 200)
    add('上市天数 ≤ 1500', df['list_days'] <= 1500)
    add('RPS 强（60 日涨幅 ≥ 30%）', df['ret60'] >= 0.30)

    # ---- 单条件：板块/大盘环境 ----
    add('沪深300 当日 ≥ +1%', df['bench_pct'] >= 1)
    add('沪深300 当日 ≥ +3%', df['bench_pct'] >= 3)
    add('沪深300 当日跌 1~3%', (df['bench_pct'] <= -1) & (df['bench_pct'] > -3))
    add('沪深300 当日跌 ≥ 3%', df['bench_pct'] <= -3)
    add('所属行业当日 ≥ +3%', df['hy_pct'] >= 3)
    add('所属行业当日跌 ≤ -3%', df['hy_pct'] <= -3)
    add('所属行业 20 日 ≥ +10%', df['hy_ret20'] >= 0.10)

    # ---- 组合条件 ----
    add('组合A: 振幅≥6% 且 成交额≥5亿',
        (df['amp'] >= 6) & (df['amount_wan'] >= 50000))
    add('组合B: 振幅≥6% 且 成交额≥5亿 且 创业板/中小板',
        (df['amp'] >= 6) & (df['amount_wan'] >= 50000) & df['board'].isin(['创业板', '中小板']))
    add('组合C: 振幅≥6% 且 成交额≥5亿 且 沪深300≥+1%',
        (df['amp'] >= 6) & (df['amount_wan'] >= 50000) & (df['bench_pct'] >= 1))
    add('组合D: 振幅≥6% 且 成交额≥5亿 且 沪深300≥+1% 且 创业板/中小板',
        (df['amp'] >= 6) & (df['amount_wan'] >= 50000) & (df['bench_pct'] >= 1)
        & df['board'].isin(['创业板', '中小板']))
    add('组合E: 振幅≥4% 且 成交额≥2亿 且 量比≥1.2',
        (df['amp'] >= 4) & (df['amount_wan'] >= 20000) & (df['vol_ratio'] >= 1.2))
    add('组合F: 振幅≥6% 且 成交额≥5亿 且 量比≥1.2 且 沪深300≥+1%',
        (df['amp'] >= 6) & (df['amount_wan'] >= 50000) & (df['vol_ratio'] >= 1.2)
        & (df['bench_pct'] >= 1))
    add('组合G: T日跌幅≥5% 且 振幅≥6% 且 成交额≥2亿',
        (df['pct'] <= -5) & (df['amp'] >= 6) & (df['amount_wan'] >= 20000))
    add('组合H: 组合C 且 所属行业当日涨幅≥0',
        (df['amp'] >= 6) & (df['amount_wan'] >= 50000) & (df['bench_pct'] >= 1)
        & (df['hy_pct'] >= 0))

    rows = []
    for name, mask in rules:
        sub = df[mask]
        st = _stats(sub)
        if st['n'] < args.min_n:
            continue
        st['rule'] = name
        st['share_of_sample'] = round(st['n'] / len(df) * 100, 2)
        st['lift_vs_base'] = round(st['ge3_pct'] / base_ge3, 3)
        # 逐年（用于判断是否只靠某一年）
        yr = []
        for y, g in sub.groupby('year'):
            if len(g) >= 200:
                yr.append(f'{y}:{g["hit3"].mean() * 100:.1f}')
        st['by_year'] = ' '.join(yr)
        rows.append(st)

    out = pd.DataFrame(rows)[[
        'rule', 'n', 'share_of_sample', 'ge3_pct', 'lift_vs_base', 'ge5_pct', 'limit_pct',
        'avg_ret_open_pct', 'avg_ret_high_pct', 'avg_strat_ret_pct', 'win_rate_pct',
        'profit_factor', 'by_year']]
    out = out.sort_values('ge3_pct', ascending=False)
    out.to_csv('data/backtest/late-buy-next-morning-stock-only/rule_scan.csv',
               index=False, encoding='utf-8-sig')
    print()
    print(out.to_string(index=False))
    print()
    print('[out] data/backtest/late-buy-next-morning-stock-only/rule_scan.csv')


if __name__ == '__main__':
    main()
