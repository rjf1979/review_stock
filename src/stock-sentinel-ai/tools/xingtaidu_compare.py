# -*- coding: utf-8 -*-
"""对比两份 25 形态合并结果（逐笔口径）的逐形态指标。

用法::

    python tools/xingtaidu_compare.py --a <基线的.json> --b <对照的.json> \
        --label-a v2 --label-b v3
"""
from __future__ import annotations

import argparse
import json
import sys


def load(path, label):
    with open(path, encoding='utf-8') as f:
        doc = json.load(f)
    return doc, doc.get('extra', doc.get('summary', {}).get('by_pattern', {})), label


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--a', required=True)
    ap.add_argument('--b', required=True)
    ap.add_argument('--label-a', default='A')
    ap.add_argument('--label-b', default='B')
    ap.add_argument('--by', default='n', choices=('n', 'delta_pf'))
    a = ap.parse_args(argv)
    _, ea, la = load(a.a, a.label_a)
    _, eb, lb = load(a.b, a.label_b)
    pats = sorted(set(ea) | set(eb), key=lambda p: -(ea.get(p, {}).get('n', 0)))
    if a.by == 'delta_pf':
        pats.sort(key=lambda p: -((eb.get(p, {}).get('profit_factor') or 0)
                                  - (ea.get(p, {}).get('profit_factor') or 0)))
    print(f"{'形态':<22}{'n':>9}{la+'胜率':>9}{lb+'胜率':>9}{la+'PF':>9}{lb+'PF':>9}"
          f"{'ΔPF':>9}{la+'盈亏比':>10}{lb+'盈亏比':>10}"
          f"{la+'期望':>9}{lb+'期望':>9}{la+'持有':>8}{lb+'持有':>8}")
    tot_a = tot_b = 0.0
    for p in pats:
        x, y = ea.get(p, {}), eb.get(p, {})
        pfa, pfb = x.get('profit_factor') or 0.0, y.get('profit_factor') or 0.0
        tot_a += pfa
        tot_b += pfb
        same = '' if abs(pfa - pfb) < 1e-9 and x.get('n') == y.get('n') else '  *'
        print(f"{p:<22}{x.get('n', 0):>9}"
              f"{x.get('win_rate') or 0:>9.2f}{y.get('win_rate') or 0:>9.2f}"
              f"{pfa:>9.4f}{pfb:>9.4f}{pfb - pfa:>+8.4f}"
              f"{x.get('payoff') or 0:>10.4f}{y.get('payoff') or 0:>10.4f}"
              f"{x.get('expectancy') or 0:>9.4f}{y.get('expectancy') or 0:>9.4f}"
              f"{x.get('avg_hold') or 0:>8.2f}{y.get('avg_hold') or 0:>8.2f}"
              f"{same}")
    print(f"{'合计PF（25形态求和）':<22}{'':>9}{'':>9}{'':>9}{tot_a:>9.4f}{tot_b:>9.4f}"
          f"{tot_b - tot_a:>+8.4f}")
    print('* = 与基线不一致（其余形态应当逐笔完全相同）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
