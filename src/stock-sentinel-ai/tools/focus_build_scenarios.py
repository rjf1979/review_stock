"""生成 rsi_low_turn / limit_pullback 的聚焦优化网格（入场过滤 x 退出规则）。

输出可直接喂给 `tools/xingtaidu_focus_scan.py --stage custom --scenarios <file>`。
网格只覆盖两个"高盈亏比"候选形态，参数含义与 `tools/xingtaidu_backtest.resolve_exit` 一致：

- first_r_multiple     首次止盈目标 = 买价 + N x 初始风险 R
- first_exit_fraction  首次止盈减仓比例（0 = 不减仓，直接进入跟踪）
- trail_pct            跟踪止盈回撤幅度
- hold_days            最长持有交易日
- no_target            关闭形态自带的测量目标，只用 R 目标 + 跟踪

用法：
    python tools/focus_build_scenarios.py
    python tools/xingtaidu_focus_scan.py --patterns rsi_low_turn --stage custom \
        --scenarios data/backtest/xingtaidu/focus/grid_rsi_low_turn.json \
        --limit 300 --jobs 6 --out data/backtest/xingtaidu/focus/grid_rsi_smoke.json
"""
from __future__ import annotations

import argparse
import json
import os


ENTRIES: dict[str, list[tuple[str, dict]]] = {
    'rsi_low_turn': [
        ('low25+d20', {'low': 25.0, 'drop_days': 60, 'drop_max': -20.0}),
        ('low20+d20', {'low': 20.0, 'drop_days': 60, 'drop_max': -20.0}),
        ('low20+d30', {'low': 20.0, 'drop_days': 60, 'drop_max': -30.0}),
        ('low15+d20', {'low': 15.0, 'drop_days': 60, 'drop_max': -20.0}),
        ('low20+d20+rs0', {'low': 20.0, 'drop_days': 60, 'drop_max': -20.0,
                           'rs_days': 20, 'rs_max': 0.0}),
    ],
    'limit_pullback': [
        ('d30', {'drop_days': 60, 'drop_max': -30.0}),
        ('d20', {'drop_days': 60, 'drop_max': -20.0}),
        ('d30+v1.0', {'drop_days': 60, 'drop_max': -30.0, 'vol_ref': 20, 'vol_max': 1.0}),
        ('win10+d20', {'window': 10, 'drop_days': 60, 'drop_max': -20.0}),
        ('d120-30', {'drop_days': 120, 'drop_max': -30.0}),
    ],
}

EXITS: list[tuple[str, dict]] = [
    ('r2', {'first_r_multiple': 2.0}),
    ('r3', {'first_r_multiple': 3.0}),
    ('r4', {'first_r_multiple': 4.0}),
    ('f0', {'first_exit_fraction': 0.0}),
    ('r2f0', {'first_r_multiple': 2.0, 'first_exit_fraction': 0.0}),
    ('r3f0', {'first_r_multiple': 3.0, 'first_exit_fraction': 0.0}),
    ('r3f0h40', {'first_r_multiple': 3.0, 'first_exit_fraction': 0.0, 'hold_days': 40}),
    ('r3f0nt', {'first_r_multiple': 3.0, 'first_exit_fraction': 0.0, 'no_target': True}),
    ('r3f0t15', {'first_r_multiple': 3.0, 'first_exit_fraction': 0.0, 'trail_pct': 0.15}),
    ('r3f0t12h40', {'first_r_multiple': 3.0, 'first_exit_fraction': 0.0,
                    'trail_pct': 0.12, 'hold_days': 40}),
    ('r3nt', {'first_r_multiple': 3.0, 'no_target': True}),
    ('r4f0nt', {'first_r_multiple': 4.0, 'first_exit_fraction': 0.0, 'no_target': True}),
]

# "让利润奔跑"方向的深度网格：更高的首个 R 目标、更宽的跟踪、更长的持有上限。
EXITS_DEEP: list[tuple[str, dict]] = [
    ('r4f0', {'first_r_multiple': 4.0, 'first_exit_fraction': 0.0}),
    ('r5', {'first_r_multiple': 5.0}),
    ('r5f0', {'first_r_multiple': 5.0, 'first_exit_fraction': 0.0}),
    ('r5f0nt', {'first_r_multiple': 5.0, 'first_exit_fraction': 0.0, 'no_target': True}),
    ('r6f0nt', {'first_r_multiple': 6.0, 'first_exit_fraction': 0.0, 'no_target': True}),
    ('r4f0h60', {'first_r_multiple': 4.0, 'first_exit_fraction': 0.0, 'hold_days': 60}),
    ('r4f0t12h40', {'first_r_multiple': 4.0, 'first_exit_fraction': 0.0,
                    'trail_pct': 0.12, 'hold_days': 40}),
    ('r4f0t15h60', {'first_r_multiple': 4.0, 'first_exit_fraction': 0.0,
                    'trail_pct': 0.15, 'hold_days': 60}),
    ('r4f0t18h60', {'first_r_multiple': 4.0, 'first_exit_fraction': 0.0,
                    'trail_pct': 0.18, 'hold_days': 60}),
    ('r3f0t12h60', {'first_r_multiple': 3.0, 'first_exit_fraction': 0.0,
                    'trail_pct': 0.12, 'hold_days': 60}),
]

EXIT_SETS = {'base': EXITS, 'deep': EXITS_DEEP}

# 阈值敏感性：固定"让利润奔跑"的退出规则，只上下挪动入场阈值，检查边缘是否平滑。
SENS_EXIT = {'first_r_multiple': 6.0, 'first_exit_fraction': 0.0, 'no_target': True}
SENS: dict[str, list[tuple[str, dict]]] = {
    'rsi_low_turn': [
        ('low25+d20', {'low': 25.0, 'drop_days': 60, 'drop_max': -20.0}),
        ('low25+d30', {'low': 25.0, 'drop_days': 60, 'drop_max': -30.0}),
        ('low22+d30', {'low': 22.0, 'drop_days': 60, 'drop_max': -30.0}),
        ('low18+d30', {'low': 18.0, 'drop_days': 60, 'drop_max': -30.0}),
        ('low15+d30', {'low': 15.0, 'drop_days': 60, 'drop_max': -30.0}),
        ('low20+d25', {'low': 20.0, 'drop_days': 60, 'drop_max': -25.0}),
        ('low20+d35', {'low': 20.0, 'drop_days': 60, 'drop_max': -35.0}),
        ('low20+d40', {'low': 20.0, 'drop_days': 60, 'drop_max': -40.0}),
        ('low20+d30+vol1.2', {'low': 20.0, 'drop_days': 60, 'drop_max': -30.0,
                              'vol_ref': 20, 'vol_max': 1.2}),
        ('low20+d30+rs0', {'low': 20.0, 'drop_days': 60, 'drop_max': -30.0,
                           'rs_days': 20, 'rs_max': 0.0}),
        ('low20+d30+rs-5', {'low': 20.0, 'drop_days': 60, 'drop_max': -30.0,
                            'rs_days': 20, 'rs_max': -5.0}),
    ],
    'limit_pullback': [
        ('d20', {'drop_days': 60, 'drop_max': -20.0}),
        ('d25', {'drop_days': 60, 'drop_max': -25.0}),
        ('d35', {'drop_days': 60, 'drop_max': -35.0}),
        ('d40', {'drop_days': 60, 'drop_max': -40.0}),
        ('d120-30', {'drop_days': 120, 'drop_max': -30.0}),
        ('d250-40', {'drop_days': 250, 'drop_max': -40.0}),
        ('win10+d30', {'window': 10, 'drop_days': 60, 'drop_max': -30.0}),
        ('d30+v1.0', {'drop_days': 60, 'drop_max': -30.0, 'vol_ref': 20, 'vol_max': 1.0}),
        ('d30+rs-5', {'drop_days': 60, 'drop_max': -30.0, 'rs_days': 20, 'rs_max': -5.0}),
        ('shrink0.7+d30', {'vol_shrink': 0.7, 'drop_days': 60, 'drop_max': -30.0}),
    ],
}

# 决赛候选：全市场 + 分段样本外验证用的固定清单。
# 第 1 条是各形态的原始基准（空 entry / 空 exit），用于核对扫描器与正式回测口径一致。
FINALISTS: list[dict] = [
    {'pattern': 'rsi_low_turn', 'label': 'rsi|base', 'entry': {}, 'exit': {}},
    {'pattern': 'rsi_low_turn', 'label': 'rsi|low20d30|r6f0nt',
     'entry': {'low': 20.0, 'drop_days': 60, 'drop_max': -30.0},
     'exit': {'first_r_multiple': 6.0, 'first_exit_fraction': 0.0, 'no_target': True}},
    {'pattern': 'rsi_low_turn', 'label': 'rsi|low20d30|r5',
     'entry': {'low': 20.0, 'drop_days': 60, 'drop_max': -30.0},
     'exit': {'first_r_multiple': 5.0}},
    {'pattern': 'rsi_low_turn', 'label': 'rsi|low20d20|r4f0nt',
     'entry': {'low': 20.0, 'drop_days': 60, 'drop_max': -20.0},
     'exit': {'first_r_multiple': 4.0, 'first_exit_fraction': 0.0, 'no_target': True}},
    {'pattern': 'rsi_low_turn', 'label': 'rsi|low25d20|r4f0t12h40',
     'entry': {'low': 25.0, 'drop_days': 60, 'drop_max': -20.0},
     'exit': {'first_r_multiple': 4.0, 'first_exit_fraction': 0.0,
              'trail_pct': 0.12, 'hold_days': 40}},
    {'pattern': 'rsi_low_turn', 'label': 'rsi|low20d20|base',
     'entry': {'low': 20.0, 'drop_days': 60, 'drop_max': -20.0}, 'exit': {}},
    {'pattern': 'limit_pullback', 'label': 'lp|base', 'entry': {}, 'exit': {}},
    {'pattern': 'limit_pullback', 'label': 'lp|d30|r5',
     'entry': {'drop_days': 60, 'drop_max': -30.0},
     'exit': {'first_r_multiple': 5.0}},
    {'pattern': 'limit_pullback', 'label': 'lp|d30|r6f0nt',
     'entry': {'drop_days': 60, 'drop_max': -30.0},
     'exit': {'first_r_multiple': 6.0, 'first_exit_fraction': 0.0, 'no_target': True}},
    {'pattern': 'limit_pullback', 'label': 'lp|d120-30|r4f0t15h60',
     'entry': {'drop_days': 120, 'drop_max': -30.0},
     'exit': {'first_r_multiple': 4.0, 'first_exit_fraction': 0.0,
              'trail_pct': 0.15, 'hold_days': 60}},
    {'pattern': 'limit_pullback', 'label': 'lp|d30|base',
     'entry': {'drop_days': 60, 'drop_max': -30.0}, 'exit': {}},
]

# 归因对照：保持原始入场（不加过滤），只替换退出规则，衡量"退出规则本身"的贡献。
PROMOTE: list[dict] = [
    {'pattern': 'rsi_low_turn', 'label': 'rsi|base|exitbase', 'entry': {}, 'exit': {}},
    {'pattern': 'rsi_low_turn', 'label': 'rsi|base|r6f0nt', 'entry': {},
     'exit': {'first_r_multiple': 6.0, 'first_exit_fraction': 0.0, 'no_target': True}},
    {'pattern': 'rsi_low_turn', 'label': 'rsi|base|r3', 'entry': {},
     'exit': {'first_r_multiple': 3.0}},
    {'pattern': 'rsi_low_turn', 'label': 'rsi|low20|exitbase',
     'entry': {'low': 20.0}, 'exit': {}},
    {'pattern': 'rsi_low_turn', 'label': 'rsi|d30|exitbase',
     'entry': {'drop_days': 60, 'drop_max': -30.0}, 'exit': {}},
    {'pattern': 'limit_pullback', 'label': 'lp|base|exitbase', 'entry': {}, 'exit': {}},
    {'pattern': 'limit_pullback', 'label': 'lp|base|r6f0nt', 'entry': {},
     'exit': {'first_r_multiple': 6.0, 'first_exit_fraction': 0.0, 'no_target': True}},
    {'pattern': 'limit_pullback', 'label': 'lp|base|r3', 'entry': {},
     'exit': {'first_r_multiple': 3.0}},
]


def build(pids: list[str], exits: list[tuple[str, dict]]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for pid in pids:
        rows = []
        for elabel, entry in ENTRIES[pid]:
            for xlabel, exit_rule in exits:
                rows.append({
                    'pattern': pid,
                    'label': f'{pid}|{elabel}|{xlabel}',
                    'entry': dict(entry),
                    'exit': dict(exit_rule),
                })
        out[pid] = rows
    return out


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--patterns', default='rsi_low_turn,limit_pullback')
    p.add_argument('--exit-set', choices=sorted(EXIT_SETS) + ['final', 'sens', 'promote'],
                   default='base')
    p.add_argument('--outdir', default='data/backtest/xingtaidu/focus')
    args = p.parse_args(argv)
    os.makedirs(args.outdir, exist_ok=True)
    pids = [x.strip() for x in args.patterns.split(',') if x.strip()]
    if args.exit_set == 'final':
        path = os.path.join(args.outdir, 'finalists.json')
        rows = [row for row in FINALISTS if row['pattern'] in pids]
        with open(path, 'w', encoding='utf-8') as fh:
            json.dump(rows, fh, ensure_ascii=False, indent=1)
        print(f'{path}: {len(rows)} 个场景')
        return 0
    if args.exit_set == 'sens':
        combined = []
        for pid in pids:
            rows = [{'pattern': pid, 'label': f'{pid}|{label}',
                     'entry': dict(entry), 'exit': dict(SENS_EXIT)}
                    for label, entry in SENS[pid]]
            combined += rows
            path = os.path.join(args.outdir, f'sens_{pid}.json')
            with open(path, 'w', encoding='utf-8') as fh:
                json.dump(rows, fh, ensure_ascii=False, indent=1)
            print(f'{path}: {len(rows)} 个场景')
        allpath = os.path.join(args.outdir, 'sens_all.json')
        with open(allpath, 'w', encoding='utf-8') as fh:
            json.dump(combined, fh, ensure_ascii=False, indent=1)
        print(f'{allpath}: {len(combined)} 个场景')
        return 0
    if args.exit_set == 'promote':
        path = os.path.join(args.outdir, 'promote.json')
        rows = [row for row in PROMOTE if row['pattern'] in pids]
        with open(path, 'w', encoding='utf-8') as fh:
            json.dump(rows, fh, ensure_ascii=False, indent=1)
        print(f'{path}: {len(rows)} 个场景')
        return 0
    suffix = '' if args.exit_set == 'base' else f'_{args.exit_set}'
    for pid, rows in build(pids, EXIT_SETS[args.exit_set]).items():
        path = os.path.join(args.outdir, f'grid_{pid}{suffix}.json')
        with open(path, 'w', encoding='utf-8') as fh:
            json.dump(rows, fh, ensure_ascii=False, indent=1)
        print(f'{path}: {len(rows)} 个场景')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
