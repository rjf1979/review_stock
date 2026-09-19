# -*- coding: utf-8 -*-
"""60 根口径回测支撑验证。

问题：用户可交易范围为沪主板 / 深主板 / 创业板，希望把上市历史门槛从 250 根
放宽到 60 根。需要先确认"满 60 根即可入选"是否有回测支撑。

做法：复用生产同一套引擎 tools/xingtaidu_backtest.py，把 min_list_days 放宽到 60，
逐笔记录信号当日已存在的历史根数 hist，再按 hist 分桶对比 v4 两组形态的统计量。
"""
import argparse
import csv
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..'))
sys.path.insert(0, os.path.join(ROOT, 'tools'))

import kdata  # noqa: E402
import xingtaidu_backtest as bt  # noqa: E402

MIN_LIST = 60
START = '2021-01-01'
END = '2026-09-18'
BLOCK_SH = ('68',)  # 科创板，不在可交易范围
BUCKETS = ((60, 100, '60-99'), (100, 150, '100-149'), (150, 250, '150-249'),
           (250, 10 ** 9, '>=250'))

_orig_is_stock = kdata.is_stock


def _is_stock_filtered(market, code):
    if market == 'sh' and code.startswith(BLOCK_SH):
        return False
    return _orig_is_stock(market, code)


kdata.is_stock = _is_stock_filtered


def _market_factory(*args, **kwargs):
    kwargs['min_bars'] = MIN_LIST
    return kdata.Market(*args, **kwargs)


bt.Market = _market_factory


def bucket_of(hist):
    for lo, hi, name in BUCKETS:
        if lo <= hist < hi:
            return name
    return '?'


def stats(xs):
    if not xs:
        return {'n': 0}
    v = np.array([x['net_pct'] for x in xs], dtype=float)
    w = v[v > 0]
    l = v[v < 0]
    aw = float(w.mean()) if len(w) else 0.0
    al = float(abs(l.mean())) if len(l) else 0.0
    gw = float(w.sum())
    gl = float(abs(l.sum()))
    return {'n': len(v), 'win_rate': round(float((v > 0).mean() * 100), 2),
            'avg_pct': round(float(v.mean()), 4),
            'avg_win': round(aw, 4), 'avg_loss': round(al, 4),
            'rr': round(aw / al, 4) if al else None,
            'pf': round(gw / gl, 4) if gl else None,
            'avg_hold': round(float(np.mean([x['hold_days'] for x in xs])), 2)}


def annotate(trades, mkt):
    # 日期轴与复权无关，直接取原始日线日期，避免重复计算复权因子
    cache = {}
    for t in trades:
        code = t['code']
        if code not in cache:
            cache[code] = mkt.raw(code)['date']
        d = int(t['signal_date'].replace('-', ''))
        t['hist'] = int(np.searchsorted(cache[code], d, side='left')) + 1
        t['bucket'] = bucket_of(t['hist'])
    return trades


def group(trades, key):
    out = {}
    for t in trades:
        out.setdefault(t[key], []).append(t)
    return out


def run_one(cfg_name, start, end, limit=0, codes=None, min_list=MIN_LIST):
    with open(os.path.join(ROOT, 'tools', cfg_name), encoding='utf-8') as fh:
        cfg = json.load(fh)
    base = dict(bt.DEFAULT)
    base.update(cfg)
    base['start'] = start
    base['end'] = end
    base['min_list_days'] = min_list
    global MIN_LIST
    MIN_LIST = min_list
    if codes:
        base['codes'] = codes
    if limit:
        base['limit'] = limit
    trades, _ = bt.run(base)
    annotate(trades, bt._WORK_MARKET)
    return base, trades


def report(base, trades, name):
    by_pat = group(trades, 'pattern')
    out = {'config': {k: v for k, v in base.items() if not k.startswith('_')},
           'universe': {'market_filter': 'sh 60/601/603/605 + sz 000/001/002/003/300/301',
                        'blocked': 'sh 68*（科创板）',
                        'codes_scanned': len(bt._WORK_MARKET.codes())},
           'overall': stats(trades), 'by_pattern': {}}
    for pid, xs in sorted(by_pat.items()):
        b = group(xs, 'bucket')
        out['by_pattern'][pid] = {'overall': stats(xs),
                                  'by_bucket': {k: stats(v) for k, v in sorted(b.items())}}
    outdir = os.path.join(ROOT, 'data', 'backtest', 'xingtaidu', 'bt60')
    os.makedirs(outdir, exist_ok=True)
    with open(os.path.join(outdir, name + '.json'), 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)
    fields = ['code', 'pattern', 'hist', 'bucket', 'signal_date', 'buy_date', 'sell_date',
              'buy_price', 'sell_price', 'hold_days', 'net_pct', 'reason', 'exit_mode']
    with open(os.path.join(outdir, name + '.csv'), 'w', encoding='utf-8-sig', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=fields, extrasaction='ignore')
        w.writeheader()
        for t in trades:
            w.writerow(t)
    return out


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument('--config', default='backtest_focus_rsi_low_turn.json')
    p.add_argument('--out', default='rsi_low_turn_v4')
    p.add_argument('--start', default=START)
    p.add_argument('--end', default=END)
    p.add_argument('--limit', type=int, default=0)
    p.add_argument('--codes', default=None)
    p.add_argument('--min-list', type=int, default=MIN_LIST)
    p.add_argument('--raw', action='store_true', help='只打印汇总，不写文件')
    args = p.parse_args(argv)
    base, trades = run_one(args.config, args.start, args.end, args.limit, args.codes,
                           args.min_list)
    if args.raw:
        print(json.dumps(stats(trades), ensure_ascii=False, indent=2))
        return 0
    out = report(base, trades, args.out)
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
