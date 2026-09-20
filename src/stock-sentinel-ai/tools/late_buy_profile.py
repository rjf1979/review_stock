# -*- coding: utf-8 -*-
"""把 late-buy-next-morning 回测产物汇总成一份 Markdown 画像报告。

输入是 ``late_buy_next_morning.py --dump-raw`` 分片合并后的目录（或单进程直接产出的目录），
输出总体 / 分年 / 板块 / 行业 / 特征分档 lift / 命中与未命中样本对照。

用法::

    python tools/late_buy_profile.py --in-dir data/backtest/late-buy-next-morning \
        --out data/backtest/late-buy-next-morning/profile.md
"""
from __future__ import annotations

import argparse
import csv
import math
import os
from collections import defaultdict

GE_COLS = [f'ge{i}_pct' for i in range(1, 10)]
BASE_COLS = ['n'] + GE_COLS + [
    'limit_pct', 'avg_ret_open_pct', 'avg_ret_high_pct', 'avg_ret_close_pct',
    'avg_strat_ret_pct', 'win_rate_true_pct', 'avg_pos_contrib_pct',
    'avg_neg_contrib_pct', 'profit_factor',
]

# 旧版把「每笔平均盈利贡献」错标成 win_rate_pct；读到旧文件时按真实含义改名
LEGACY_RENAME = {'win_rate_pct': 'avg_pos_contrib_pct'}

FEATURE_FILES = [
    ('pct', '当日涨跌幅 %'),
    ('close_pos', '收盘位置（0=最低 1=最高）'),
    ('amp', '当日振幅 %'),
    ('vol_ratio', '量比（vs 5 日均量）'),
    ('bias20', '20 日乖离率'),
    ('bias60', '60 日乖离率'),
    ('rsi14', 'RSI14'),
    ('ret5', '5 日涨幅'),
    ('ret20', '20 日涨幅'),
    ('ret60', '60 日涨幅'),
    ('dist_hh20', '距 20 日最高（负=回撤）'),
    ('amount_wan', '成交额（万元）'),
    ('float_mcap_yi', '流通市值（亿元）'),
    ('list_days', '上市天数'),
    ('hy_pct', '所属行业当日涨幅 %'),
    ('hy_ret5', '所属行业 5 日涨幅'),
    ('hy_ret20', '所属行业 20 日涨幅'),
    ('bench_pct', '沪深300 当日涨幅 %'),
]

CONTRAST_COLS = [
    ('pct', '当日涨跌幅%'), ('amp', '振幅%'), ('close_pos', '收盘位置'),
    ('upper_shadow', '上影线'), ('lower_shadow', '下影线'), ('vol_ratio', '量比'),
    ('amount_wan', '成交额万元'), ('float_mcap_yi', '流通市值亿'),
    ('bias20', '20日乖离'), ('bias60', '60日乖离'), ('rsi14', 'RSI14'),
    ('atr_pct', 'ATR%'), ('ret5', '5日涨幅'), ('ret20', '20日涨幅'),
    ('ret60', '60日涨幅'), ('dist_hh20', '距20日高'),
    ('list_days', '上市天数'), ('hy_pct', '行业涨幅%'),
    ('hy_ret5', '行业5日'), ('hy_ret20', '行业20日'), ('bench_pct', '沪深300%'),
]


def read_csv(path: str) -> list[dict]:
    if not os.path.exists(path):
        return []
    with open(path, 'r', encoding='utf-8-sig', newline='') as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        for old, new in LEGACY_RENAME.items():
            if old in r and new not in r:
                r[new] = r.pop(old)
    return rows


def num(v, default=0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def is_num(v) -> bool:
    if v is None or v == '':
        return False
    try:
        float(v)
        return True
    except (TypeError, ValueError):
        return False


def fmt(v, nd: int = 2) -> str:
    if v is None or v == '':
        return '-'
    if isinstance(v, str) and not is_num(v):
        return v
    x = float(v)
    if abs(x) >= 1e7:
        return f'{x / 1e6:.1f}M'
    return f'{x:.{nd}f}'


def md_table(headers: list[str], rows: list[list[str]]) -> list[str]:
    if not rows:
        return ['（无数据）', '']
    out = ['| ' + ' | '.join(headers) + ' |',
           '|' + '|'.join([' --- '] * len(headers)) + '|']
    for r in rows:
        out.append('| ' + ' | '.join(r) + ' |')
    out.append('')
    return out


def cell(col: str, v) -> str:
    if col == 'n':
        return f'{int(num(v)):,}'
    return fmt(v)


def ge_row(row: dict, lift_base: float | None = None, with_lift: bool = False) -> list[str]:
    cells = [str(row.get('bucket', ''))] + [cell(c, row.get(c)) for c in BASE_COLS]
    if with_lift and lift_base:
        cells.append(f'{num(row.get("ge3_pct")) / lift_base:.2f}')
    return cells


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--in-dir', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--min-bucket-share', type=float, default=0.002,
                    help='特征分档至少占全样本的比例才展示')
    ap.add_argument('--min-hy-n', type=int, default=3000, help='行业排名的最小样本量')
    ap.add_argument('--min-code-n', type=int, default=40,
                    help='个股排名的最小样本量（基于 trade_sample 抽样）')
    ap.add_argument('--top', type=int, default=20)
    args = ap.parse_args()

    d = args.in_dir
    overall_rows = read_csv(os.path.join(d, 'bucket_overall.csv'))
    if not overall_rows:
        # 单进程直跑时没有 bucket_overall.csv，退回 summary.json
        summary = {}
        sp = os.path.join(d, 'summary.json')
        if os.path.exists(sp):
            import json
            with open(sp, 'r', encoding='utf-8') as f:
                summary = json.load(f)
        if summary.get('overall'):
            overall_rows = [dict(summary['overall'])]
    if not overall_rows:
        print(f'[error] 缺少 {d}/bucket_overall.csv 且 summary.json 无 overall')
        return 1
    overall = overall_rows[0]
    total_n = int(num(overall.get('n')))
    base3 = num(overall.get('ge3_pct')) or 1.0
    min_bucket_n = max(1, int(total_n * args.min_bucket_share))

    L: list[str] = []
    L.append('# 尾盘买入 → 次日早盘卖出：数据画像')
    L.append('')
    L.append(f'- 样本量：**{total_n:,}** 笔（每笔 = 一只股票的一个交易日）')
    L.append(f'- ≥3% 命中率基准：**{base3:.2f}%**')
    L.append(f'- 特征分档展示门槛：样本 ≥ {min_bucket_n:,}')
    L.append('')

    # ---------------------------------------------------------------- 总体
    L.append('## 一、总体命中分布')
    L.append('')
    hdr = ['分档', '样本', '≥1%', '≥2%', '≥3%', '≥4%', '≥5%', '≥6%', '≥7%', '≥8%', '≥9%',
           '涨停', '次日开盘均收 %', '次日最高均收 %', '次日收盘均收 %', '止盈模型均收 %',
           '真实胜率 %', '平均盈利/笔 %', '平均亏损/笔 %', '盈亏比']
    L += md_table(hdr, [[str(overall.get('bucket', '全样本'))] +
                        [cell(c, overall.get(c)) for c in BASE_COLS]])

    year_rows = sorted(read_csv(os.path.join(d, 'bucket_year.csv')), key=lambda r: r.get('bucket', ''))
    if year_rows:
        L.append('## 二、分年稳定性')
        L.append('')
        L += md_table(hdr, [ge_row(r) for r in year_rows])

    flag_rows = read_csv(os.path.join(d, 'bucket_flag.csv'))
    if flag_rows:
        L.append('## 三、按 T 日盘中形态分组')
        L.append('')
        L += md_table(hdr, [ge_row(r) for r in flag_rows])

    board_rows = sorted(read_csv(os.path.join(d, 'bucket_board.csv')),
                        key=lambda r: -int(num(r.get('n'))))
    if board_rows:
        L.append('## 四、上市板分布')
        L.append('')
        L += md_table(hdr, [ge_row(r) for r in board_rows])

    # ---------------------------------------------------------------- 行业
    hy_rows = [r for r in read_csv(os.path.join(d, 'bucket_hy.csv'))
               if int(num(r.get('n'))) >= args.min_hy_n]
    if hy_rows:
        L.append('## 五、通达信行业（板块）情况')
        L.append('')
        L.append(f'共 {len(hy_rows)} 个行业样本 ≥ {args.min_hy_n} 笔。按 ≥3% 命中率排序：')
        L.append('')
        by_hit = sorted(hy_rows, key=lambda r: -num(r.get('ge3_pct')))
        hdr_hy = ['行业', '样本', '≥1%', '≥2%', '≥3%', '≥5%', '≥9%', '涨停',
                  '次日开盘均收 %', '次日最高均收 %', '止盈模型均收 %',
                  '真实胜率 %', '平均盈利/笔 %', '盈亏比']
        cols_hy = ['bucket', 'n', 'ge1_pct', 'ge2_pct', 'ge3_pct', 'ge5_pct', 'ge9_pct',
                   'limit_pct', 'avg_ret_open_pct', 'avg_ret_high_pct',
                   'avg_strat_ret_pct', 'win_rate_true_pct', 'avg_pos_contrib_pct',
                   'profit_factor']
        L.append(f'### 5.1 命中率最高 {args.top} 个行业')
        L.append('')
        L += md_table(hdr_hy, [[r.get(c, '') if c == 'bucket' else cell(c, r.get(c))
                                for c in cols_hy] for r in by_hit[:args.top]])
        L.append(f'### 5.2 命中率最低 {args.top} 个行业')
        L.append('')
        L += md_table(hdr_hy, [[r.get(c, '') if c == 'bucket' else cell(c, r.get(c))
                                for c in cols_hy] for r in by_hit[-args.top:]])
        by_strat = sorted(hy_rows, key=lambda r: -num(r.get('avg_strat_ret_pct')))
        L.append(f'### 5.3 止盈模型收益最好 / 最差各 {args.top} 个行业')
        L.append('')
        L += md_table(hdr_hy, [[r.get(c, '') if c == 'bucket' else cell(c, r.get(c))
                                for c in cols_hy]
                               for r in by_strat[:args.top] + by_strat[-args.top:]])

    # ---------------------------------------------------------------- 特征
    L.append('## 六、个股特征分档（lift = 该档 ≥3% 命中率 / 全样本）')
    L.append('')
    hdr_f = ['特征分档', '样本', '≥1%', '≥2%', '≥3%', '≥4%', '≥5%', '≥6%', '≥7%', '≥8%',
             '≥9%', '涨停', '次日开盘均收 %', '次日最高均收 %', '次日收盘均收 %',
             '止盈模型均收 %', '真实胜率 %', '平均盈利/笔 %', '平均亏损/笔 %', '盈亏比', 'lift']
    seen_dirs = set()
    for key, title in FEATURE_FILES:
        path = os.path.join(d, f'bucket_{key}.csv')
        if not os.path.exists(path) or path in seen_dirs:
            continue
        seen_dirs.add(path)
        rows = [r for r in read_csv(path) if int(num(r.get('n'))) >= min_bucket_n]
        if not rows:
            continue
        L.append(f'### 6.{len(seen_dirs)} {title} `{key}`')
        L.append('')
        L += md_table(hdr_f, [ge_row(r, base3, True) for r in rows])

    # ---------------------------------------------------------- 命中 vs 未命中
    sample = read_csv(os.path.join(d, 'trade_sample.csv'))
    if sample:
        L.append('## 七、命中（次日最高 ≥3%）与未命中：特征均值对照')
        L.append('')
        L.append(f'样本来源：`trade_sample.csv`，共 {len(sample):,} 笔随机抽样。')
        L.append('')
        hit = [r for r in sample if r.get('hit3') in ('1', 'True', 'true')]
        miss = [r for r in sample if r.get('hit3') not in ('1', 'True', 'true')]
        rows = []
        for col, label in CONTRAST_COLS:
            hv = [x for x in (num(r.get(col)) for r in hit if is_num(r.get(col)))
                  if math.isfinite(x)]
            mv = [x for x in (num(r.get(col)) for r in miss if is_num(r.get(col)))
                  if math.isfinite(x)]
            if not hv or not mv:
                continue
            h, m = sum(hv) / len(hv), sum(mv) / len(mv)
            diff = h - m
            # 均值接近 0 时比值没有意义（会放大成几百个百分点），只保留绝对差值
            ratio = f'{(h / m - 1) * 100:+.1f}%' if m > 0.2 else '-'
            rows.append([label, f'{h:.3f}', f'{m:.3f}',
                         f'{diff:+.3f}', ratio])
        L += md_table(['特征', f'命中均值 (n={len(hit):,})', f'未命中均值 (n={len(miss):,})',
                       '差值', '相对差'], rows)

        # 个股层面
        agg: dict[tuple, list[int]] = defaultdict(lambda: [0, 0, 0.0])
        for r in sample:
            k = (r.get('code', ''), r.get('name', ''), r.get('hy_name', ''))
            a = agg[k]
            a[0] += 1
            if r.get('hit3') in ('1', 'True', 'true'):
                a[1] += 1
            a[2] += num(r.get('strat_ret'))
        codes = [(k, v) for k, v in agg.items() if v[0] >= args.min_code_n]
        if codes:
            L.append(f'### 7.1 个股层面（样本 ≥ {args.min_code_n} 笔，按 ≥3% 命中率排序）')
            L.append('')
            top = sorted(codes, key=lambda kv: -kv[1][1] / kv[1][0])
            rows = [[k[0], k[1], k[2], str(v[0]), f'{100.0 * v[1] / v[0]:.1f}',
                     f'{100.0 * v[2] / v[0]:.3f}']
                    for k, v in top[:args.top]]
            bot = [[k[0], k[1], k[2], str(v[0]), f'{100.0 * v[1] / v[0]:.1f}',
                    f'{100.0 * v[2] / v[0]:.3f}']
                   for k, v in top[-args.top:]]
            body = rows + [['...', '...', '...', '...', '...', '...']] + bot
            L += md_table(['代码', '名称', '行业', '样本', '≥3% 命中率 %', '止盈模型均收 %'], body)

    # ---------------------------------------------------------------- 月度
    date_rows = read_csv(os.path.join(d, 'by_date.csv'))
    if date_rows:
        mon: dict[str, list[float]] = defaultdict(lambda: [0, 0, 0, 0.0])
        for r in date_rows:
            ds = str(r.get('bucket', ''))
            if len(ds) != 8:
                continue
            m = mon[ds[:6]]
            m[0] += int(num(r.get('n')))
            m[1] += round(num(r.get('ge3_pct')) * num(r.get('n')) / 100.0)
            m[2] += round(num(r.get('limit_pct')) * num(r.get('n')) / 100.0)
            m[3] += num(r.get('avg_strat_ret_pct')) * num(r.get('n'))
        L.append('## 八、月度节奏')
        L.append('')
        rows = []
        for k in sorted(mon):
            n, g3, lim, s = mon[k]
            if n == 0:
                continue
            rows.append([f'{k[:4]}-{k[4:]}', f'{n:,}', f'{100.0 * g3 / n:.2f}',
                         f'{100.0 * lim / n:.2f}', f'{s / n:.3f}'])
        L += md_table(['月份', '样本', '≥3% %', '涨停 %', '止盈模型均收 %'], rows)

    text = '\n'.join(L).rstrip() + '\n'
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, 'w', encoding='utf-8') as f:
        f.write(text)
    print(f'[out] {args.out}  {len(text):,} 字符 / {len(L)} 行')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
