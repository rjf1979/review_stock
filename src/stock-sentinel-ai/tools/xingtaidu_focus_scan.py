# -*- coding: utf-8 -*-
"""聚焦扫描：为指定形态寻找「高命中率 + 极致盈亏比」的入场过滤与退出规则组合。

与 `xingtaidu_filter_scan.py` 的分工
-----------------------------------
* `xingtaidu_filter_scan.py`：固定 v2/v3 退出规则，只看**入场过滤**维度往哪个方向加；
* 本脚本：同时扫描**入场过滤**与**退出规则覆盖**（risk_pct / risk_atr /
  target_fraction / no_target / trail_pct / trail_ma / hold_days / 分批 R 值与比例），
  并同时给出命中率、盈亏比、盈利因子，用来回答
  「不求频繁交易，只求极致盈亏比」时该怎么改。

口径与 `xingtaidu_backtest.py` 完全一致（信号收盘确认、次日开盘成交、同样的佣金/
印花税/滑点、同一套 `simulate_exit`），只是把逐笔明细换成按场景聚合的统计量，
以便在可接受的时间内扫完整个网格。

**结论属样本内发现**：正式结论必须再用
`tools/run_backtest_parts.ps1 -Patterns <形态> -Config <候选配置>` 在全市场重跑。

用法：
    python tools/xingtaidu_focus_scan.py --patterns rsi_low_turn,limit_pullback \
        --stage entry --jobs 6 --out data/backtest/xingtaidu/focus/entry.json
    python tools/xingtaidu_focus_scan.py --patterns rsi_low_turn --stage exit \
        --entry '{"drop_days":60,"drop_max":-20.0}' \
        --out data/backtest/xingtaidu/focus/rsi_exit_after_drop60.json
    python tools/xingtaidu_focus_scan.py --patterns rsi_low_turn --stage custom \
        --scenarios tools/focus_rsi_candidates.json --out .../focus/rsi_candidates.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor
from collections import defaultdict

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from indicators import compute_indicators  # noqa: E402
from kdata import Market  # noqa: E402
import patterns  # noqa: E402
from xingtaidu_backtest import (DEFAULT, _align_bench, load_benchmark,  # noqa: E402
                                load_factors, load_names, resolve_exit, simulate_exit)

# 入场过滤梯度（两个形态共用；label 会出现在结果里）
ENTRY_LEVELS: list[tuple[str, dict]] = [
    ('base', {}),
    ('drop20-8', {'drop_days': 20, 'drop_max': -8.0}),
    ('drop20-15', {'drop_days': 20, 'drop_max': -15.0}),
    ('drop60-20', {'drop_days': 60, 'drop_max': -20.0}),
    ('drop60-30', {'drop_days': 60, 'drop_max': -30.0}),
    ('drop120-30', {'drop_days': 120, 'drop_max': -30.0}),
    ('drop250-40', {'drop_days': 250, 'drop_max': -40.0}),
    ('rs20<=-10', {'rs_days': 20, 'rs_max': -10.0}),
    ('rs20<=-5', {'rs_days': 20, 'rs_max': -5.0}),
    ('rs20>=0', {'rs_days': 20, 'rs_min': 0.0}),
    ('rs20>=+5', {'rs_days': 20, 'rs_min': 5.0}),
    ('rs20>=+10', {'rs_days': 20, 'rs_min': 10.0}),
    ('vol<=0.8', {'vol_ref': 20, 'vol_max': 0.8}),
    ('vol<=1.0', {'vol_ref': 20, 'vol_max': 1.0}),
    ('vol<=1.2', {'vol_ref': 20, 'vol_max': 1.2}),
    ('vol>=1.5', {'vol_ref': 20, 'vol_min': 1.5}),
    ('vol>=2.0', {'vol_ref': 20, 'vol_min': 2.0}),
    ('drop60-20+rs<=0', {'drop_days': 60, 'drop_max': -20.0,
                         'rs_days': 20, 'rs_max': 0.0}),
    ('drop60-20+vol<=1.2', {'drop_days': 60, 'drop_max': -20.0,
                            'vol_ref': 20, 'vol_max': 1.2}),
    ('drop60-30+vol<=1.0', {'drop_days': 60, 'drop_max': -30.0,
                            'vol_ref': 20, 'vol_max': 1.0}),
    ('drop120-30+rs<=-5', {'drop_days': 120, 'drop_max': -30.0,
                           'rs_days': 20, 'rs_max': -5.0}),
]

# 形态自身的参数梯度（更深的超卖阈值 / 更短的涨停回踩窗口）
PATTERN_LEVELS: dict[str, list[tuple[str, dict]]] = {
    'rsi_low_turn': [
        ('rsi<25', {'low': 25.0}),
        ('rsi<20', {'low': 20.0}),
        ('rsi<15', {'low': 15.0}),
        ('rsi<25+drop60-20', {'low': 25.0, 'drop_days': 60, 'drop_max': -20.0}),
        ('rsi<20+drop60-20', {'low': 20.0, 'drop_days': 60, 'drop_max': -20.0}),
    ],
    'limit_pullback': [
        ('win10', {'window': 10}),
        ('win20', {'window': 20}),
        ('shrink0.6', {'vol_shrink': 0.6}),
        ('shrink0.8', {'vol_shrink': 0.8}),
        ('win10+drop60-20', {'window': 10, 'drop_days': 60, 'drop_max': -20.0}),
    ],
}

# 退出规则梯度（label -> xingtaidu_backtest.resolve_exit 认得的 cfg 覆盖键）
EXIT_LEVELS: list[tuple[str, dict]] = [
    ('base', {}),
    ('risk3', {'risk_pct': 3.0}),
    ('risk4', {'risk_pct': 4.0}),
    ('risk5', {'risk_pct': 5.0}),
    ('risk6', {'risk_pct': 6.0}),
    ('atr1.0', {'risk_atr': 1.0}),
    ('atr1.5', {'risk_atr': 1.5}),
    ('atr2.5', {'risk_atr': 2.5}),
    ('atr3.0', {'risk_atr': 3.0}),
    ('tgt1.5h', {'target_fraction': 1.5}),
    ('tgt2.0h', {'target_fraction': 2.0}),
    ('tgt3.0h', {'target_fraction': 3.0}),
    ('notarget', {'no_target': True}),
    ('trail5%', {'trail_pct': 0.05}),
    ('trail12%', {'trail_pct': 0.12}),
    ('trail15%', {'trail_pct': 0.15}),
    ('trailma5', {'trail_ma': 5}),
    ('trailma20', {'trail_ma': 20}),
    ('hold10', {'hold_days': 10}),
    ('hold30', {'hold_days': 30}),
    ('hold40', {'hold_days': 40}),
    ('hold60', {'hold_days': 60}),
    ('r1.5', {'first_r_multiple': 1.5}),
    ('r2', {'first_r_multiple': 2.0}),
    ('r3', {'first_r_multiple': 3.0}),
    ('frac0', {'first_exit_fraction': 0.0}),
    ('frac0.3', {'first_exit_fraction': 0.3}),
    ('frac0.7', {'first_exit_fraction': 0.7}),
    ('frac1.0', {'first_exit_fraction': 1.0}),
]

EXIT_KEYS = ('hold_days', 'risk_pct', 'risk_atr', 'first_r_multiple',
             'first_exit_fraction', 'target_fraction', 'no_target',
             'trail_ma', 'trail_pct')

ACC_LEN = 9  # n, 盈利和, 盈利笔数, 亏损和, 亏损笔数, 净收益和, 持有日和, 分批笔数, 最大单笔盈利


def _stats(acc):
    n, wsum, wn, lsum, ln, tot, hold_sum, part_n, best = acc
    if not n:
        return {'n': 0}
    avg_win = wsum / wn if wn else None
    avg_loss = lsum / ln if ln else None
    payoff = (avg_win / abs(avg_loss)) if (avg_win is not None and avg_loss) else None
    pf = (wsum / abs(lsum)) if lsum else None
    return {
        'n': int(n),
        'win_rate': round(wn / n * 100, 2),
        'payoff_ratio': None if payoff is None else round(float(payoff), 4),
        'profit_factor': None if pf is None else round(float(pf), 4),
        'avg_pct': round(float(tot / n), 4),
        'avg_hold': round(float(hold_sum / n), 2),
        'partial_rate': round(float(part_n / n * 100), 2),
        'avg_win': None if avg_win is None else round(float(avg_win), 4),
        'avg_loss': None if avg_loss is None else round(float(avg_loss), 4),
        'best_trade': round(float(best), 4),
    }


def _shard(payload):
    codes, scenarios, opt = payload
    mkt = Market(min_bars=250)
    names = load_names()
    mkt.set_names(names)
    factors = load_factors()
    bench = load_benchmark() if opt['need_bench'] else None
    s_int = int(opt['start'].replace('-', ''))
    e_int = int(opt['end'].replace('-', ''))
    # 每个场景一份 cfg：退出覆盖逐场景生效，其他口径与主引擎完全一致
    cfgs = {}
    for sc in scenarios:
        c = dict(DEFAULT)
        for k in EXIT_KEYS:
            c[k] = None
        c.update(sc.get('exit') or {})
        c['_exit_cache'] = {pid: resolve_exit(pid, c) for pid in opt['patterns']}
        cfgs[sc['label']] = c
    cfg0 = next(iter(cfgs.values()))
    pos, comm, minc, tax, slip = (cfg0['position'], cfg0['commission'], cfg0['min_commission'],
                                  cfg0['stamp_tax'], cfg0['slippage'])
    onset_only = cfg0['onset_only']
    min_list_days = cfg0['min_list_days']
    max_gap = cfg0['max_gap_days']
    max_bar_move = cfg0['max_bar_move']
    skip_lu = cfg0['skip_limit_up_entry']

    all_dates = sorted({int(d) for c in codes for d in mkt.raw(c)['date']})
    dates_index = {d: i for i, d in enumerate(all_dates)}

    acc = {sc['label']: [0, 0.0, 0, 0.0, 0, 0.0, 0.0, 0, -1e9] for sc in scenarios}
    for code in codes:
        bars = mkt.load(code, cfg0['adj'], factors.get(code))
        if len(bars) < min_list_days + 5:
            continue
        ind = compute_indicators(bars, code, names.get(code, ''))
        ind['date'] = bars['date']
        if bench is not None:
            ind['bench_close'] = _align_bench(bench, bars['date'])
        n = len(bars)
        gi = np.array([dates_index.get(int(x), -1) for x in bars['date']])
        sig_cache: dict[tuple, np.ndarray] = {}
        for sc in scenarios:
            pid = sc['pattern']
            key = (pid, sc['entry_key'])
            sig = sig_cache.get(key)
            if sig is None:
                sig = patterns.detect(pid, ind, sc['entry'] or None)
                if onset_only:
                    sig = sig & ~np.r_[False, sig[:-1]]
                sig_cache[key] = sig
            a = acc[sc['label']]
            for i in np.flatnonzero(sig):
                j = i + 1
                if j >= n or bars['date'][j] < s_int or bars['date'][j] > e_int \
                        or i < min_list_days:
                    continue
                if gi[i] < 0 or gi[j] < 0 or gi[j] - gi[i] > max_gap:
                    continue
                if skip_lu and ind['is_limit_up'][j]:
                    continue
                buy = ind['open'][j] * (1 + slip)
                if not np.isfinite(buy) or abs(ind['pct'][i]) > max_bar_move:
                    continue
                res = simulate_exit(ind, j, buy, pid, cfgs[sc['label']])
                sell = res['sell_price'] * (1 - slip)
                buy_fee = max(pos * comm, minc) / pos
                sell_fee = max(pos * sell / buy * comm, minc) / pos
                net = (sell / buy - 1 - (buy_fee + sell_fee + tax)) * 100
                a[0] += 1
                if net > 0:
                    a[1] += net
                    a[2] += 1
                elif net < 0:
                    a[3] += net
                    a[4] += 1
                a[5] += net
                a[6] += res['sell_index'] - j
                if res['partial']:
                    a[7] += 1
                if net > a[8]:
                    a[8] = net
    return acc


def _build_scenarios(patterns_list, stage, entry_base, custom):
    out = []
    if stage in ('entry', 'all'):
        for pid in patterns_list:
            levels = list(ENTRY_LEVELS) + list(PATTERN_LEVELS.get(pid, []))
            for label, params in levels:
                out.append({'pattern': pid, 'label': f'{pid}|entry|{label}',
                            'entry': dict(params), 'entry_key': label, 'exit': {}})
    if stage in ('exit', 'all'):
        for pid in patterns_list:
            for label, cfg in EXIT_LEVELS:
                out.append({'pattern': pid, 'label': f'{pid}|exit|{label}',
                            'entry': dict(entry_base), 'entry_key': '__exitbase__',
                            'exit': dict(cfg)})
    if stage == 'custom':
        for sc in custom:
            pid = sc.get('pattern')
            if pid not in patterns_list:
                continue
            out.append({'pattern': pid, 'label': sc['label'],
                        'entry': dict(sc.get('entry') or {}),
                        'entry_key': json.dumps(sc.get('entry') or {}, sort_keys=True),
                        'exit': dict(sc.get('exit') or {})})
    return out


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--patterns', required=True, help='逗号分隔形态ID')
    p.add_argument('--stage', choices=('entry', 'exit', 'all', 'custom'), default='entry')
    p.add_argument('--entry', default='{}', help='exit/all/custom 阶段的基准入场过滤（JSON）')
    p.add_argument('--scenarios', help='custom 阶段的场景 JSON 文件')
    p.add_argument('--start', default='2021-01-01')
    p.add_argument('--end', default='2026-09-18')
    p.add_argument('--limit', type=int, default=0, help='子样本股票数；0 = 全市场')
    p.add_argument('--jobs', type=int, default=6)
    p.add_argument('--min-trades', type=int, default=200, help='打印排序时要求的最小笔数')
    p.add_argument('--out', required=True)
    args = p.parse_args(argv)

    pids = [x.strip() for x in args.patterns.split(',')]
    for pid in pids:
        patterns.get(pid)
    entry_base = json.loads(args.entry)
    custom = []
    if args.stage == 'custom':
        with open(args.scenarios, encoding='utf-8') as fh:
            custom = json.load(fh)
    scenarios = _build_scenarios(pids, args.stage, entry_base, custom)
    if not scenarios:
        raise SystemExit('没有可执行的场景')

    mkt = Market(min_bars=250)
    mkt.set_names(load_names())
    codes = mkt.codes()
    if args.limit:
        codes = codes[:args.limit]
    need_bench = any(
        ('rs_days' in (sc['entry'] or {})) or ('bench_ma_days' in (sc['entry'] or {}))
        for sc in scenarios
    )
    shards = [codes[i::args.jobs] for i in range(args.jobs)]
    payloads = [(sh, scenarios, {'patterns': pids, 'start': args.start, 'end': args.end,
                                 'need_bench': need_bench})
                for sh in shards if sh]

    print(f'场景 {len(scenarios)} 个 × {len(codes)} 只股票，分片 {len(payloads)}',
          file=sys.stderr)
    total = {sc['label']: [0, 0.0, 0, 0.0, 0, 0.0, 0.0, 0, -1e9] for sc in scenarios}
    with ProcessPoolExecutor(max_workers=args.jobs) as ex:
        futures = [ex.submit(_shard, pl) for pl in payloads]
        for fut in futures:
            part = fut.result()
            for label, a in part.items():
                t = total[label]
                for k in range(ACC_LEN):
                    if k == 8:
                        t[k] = max(t[k], a[k])
                    else:
                        t[k] += a[k]

    results = {sc['label']: _stats(total[sc['label']]) for sc in scenarios}
    meta = {sc['label']: {'pattern': sc['pattern'], 'entry': sc['entry'], 'exit': sc['exit']}
            for sc in scenarios}
    out = {'scope': {'patterns': pids, 'stage': args.stage, 'codes': len(codes),
                     'start': args.start, 'end': args.end, 'scenarios': len(scenarios)},
           'results': {k: {**v, **meta[k]} for k, v in results.items()}}
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)

    for pid in pids:
        rows = [(k, v) for k, v in results.items() if meta[k]['pattern'] == pid]
        ok = [(k, v) for k, v in rows
              if v.get('n', 0) >= args.min_trades and v.get('profit_factor')]
        ok.sort(key=lambda kv: (kv[1]['payoff_ratio'] or -9), reverse=True)
        print(f'\n== {pid}（按盈亏比排序，笔数≥{args.min_trades}，PF 存在）')
        print(f'{"场景":34s} {"笔数":>8} {"胜率%":>7} {"盈亏比":>7} {"PF":>6} '
              f'{"均值%":>8} {"持有":>6} {"分批%":>7}')
        for k, v in ok[:24]:
            print(f'{k:34s} {v["n"]:>8} {v["win_rate"]:>7} '
                  f'{(v["payoff_ratio"] if v["payoff_ratio"] is not None else float("nan")):>7.4f} '
                  f'{(v["profit_factor"] if v["profit_factor"] is not None else float("nan")):>6.4f} '
                  f'{v["avg_pct"]:>8.4f} {v["avg_hold"]:>6} {v["partial_rate"]:>7}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
