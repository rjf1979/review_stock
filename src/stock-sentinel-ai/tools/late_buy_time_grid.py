# -*- coding: utf-8 -*-
"""尾盘买入时点 × 次日早盘卖出时点：1 分钟网格搜索。

范围（用户口径）
----------------
* 买入：T 日 **14:30 ~ 14:55**，逐分钟一个候选（26 个点）；
  「T 时刻的价格」= 通达信 1 分钟线中标签为该时刻的那根 K 线的收盘价
  （通达信时间戳是该分钟结束时刻，故 1430 那根代表 14:29:00~14:30:00）。
* 卖出：T+1 日 **09:30 ~ 10:00**（31 个点）。通达信当日第一根 1 分钟线标签是 0931，
  故 09:30 用该根的 **开盘价**（= 集合竞价开盘价）表示，09:31~10:00 用各分钟收盘价。

得到 26 × 31 = 806 个 (买时点, 卖时点) 组合的收益分布，并给出：

* 买入时点边际（固定卖出参照点）
* 卖出时点边际（固定 14:30 买入）——即次日早盘的平均价格路径
* 每笔样本在窗口内「最高涨幅」的分档命中（≥1% … ≥9% / 涨停）
* 可执行模型：「09:30~10:00 挂 +3% 限价卖，未成交则 10:00（或 09:31）市价卖」
* 行业 / 板块 / 逐月 / 大盘条件的分解

重要立场
--------
806 个组合里挑「全样本最优」必然虚高（样本内过拟合）。报告只把
**在逐月分解下方向一致** 的时点当作可用结论。

用法::

    # 单进程
    python tools/late_buy_time_grid.py --out-dir data/backtest/late-buy-time-grid
    # 4 分片并行后合并
    python tools/late_buy_time_grid.py --shard 0 --shards 4 --out-dir <dir>
    python tools/late_buy_time_grid.py --merge --out-dir <dir>
"""
from __future__ import annotations

import argparse
import json
import os

import numpy as np

from indicators import compute_indicators, limit_ratio
from kdata import Market, factor_series, int_to_ymd, is_stock, market_of
from late_buy_next_morning import (COST, TARGET, load_factors,
                                   load_latest_snapshot, write_csv, ymd_to_ordinal)
from tdx_minute import load_minute
from tdx_sector import align_series, load_board_series, load_industry_map

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..'))
OUT_DEFAULT = os.path.join(ROOT, 'data', 'backtest', 'late-buy-time-grid')
BENCH_CODE = '000300'

BUY_TIMES = list(range(1430, 1456))            # 26 个买入分钟
SELL_TIMES = [930] + list(range(931, 960)) + [1000]   # 31 个卖出时点（09:30~10:00）
WIN_FROM, WIN_TO = 931, 1000
NB, NS = len(BUY_TIMES), len(SELL_TIMES)
HIT_LEVELS = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09]
RET_LO, RET_HI, NBIN = -0.20, 0.20, 401
BIN_W = (RET_HI - RET_LO) / (NBIN - 1)
MONTHS = ['202606', '202607', '202608', '202609']
# 参照组合：把 14:30/14:55 买、09:30/09:31/10:00 卖拆开看
REF_PAIRS = [(1430, 930), (1430, 931), (1430, 1000), (1455, 930), (1455, 1000)]
FALLBACKS = {'0931': 1, '1000': NS - 1}
FLAT2 = (np.arange(NB, dtype=np.int64)[:, None] * NS
         + np.arange(NS, dtype=np.int64)[None, :])
BOARD_NAMES = ['沪主板', '深主板', '中小板', '创业板', '科创板', '其他']


def board_of(code: str) -> str:
    """与 kdata.Market.meta()['board'] 同口径的板块标签（按代码前缀）。"""
    if code.startswith('68'):
        return '科创板'
    if code.startswith(('300', '301')):
        return '创业板'
    if code.startswith(('002', '003', '004')):
        return '中小板'
    if code.startswith('60'):
        return '沪主板'
    if code.startswith(('000', '001')):
        return '深主板'
    return '其他'


# ---------------------------------------------------------------- 基础工具
def day_slices(dates: np.ndarray) -> dict:
    """分钟日期数组 → {YYYYMMDD: (start, end)}（左闭右开）。"""
    ud, starts = np.unique(dates, return_index=True)
    ends = np.append(starts[1:], len(dates))
    return {int(d): (int(s), int(e)) for d, s, e in zip(ud, starts, ends)}


def exact_vals(t: np.ndarray, arr: np.ndarray, times) -> np.ndarray:
    """取 t 中等于 times 各时刻的值；缺失为 nan。t 需升序。"""
    out = np.full(len(times), np.nan, dtype=np.float64)
    if len(t) == 0:
        return out
    j = np.clip(np.searchsorted(t, np.asarray(times, dtype=np.int64)), 0, len(t) - 1)
    ok = t[j] == np.asarray(times, dtype=np.int64)
    out[ok] = arr[j[ok]]
    return out


def bin_index(x: np.ndarray) -> np.ndarray:
    return np.clip(np.rint((np.asarray(x, dtype=np.float64) - RET_LO) / BIN_W),
                   0, NBIN - 1).astype(np.int64)


def hist_quantile(h: np.ndarray, q: float) -> float:
    c = np.cumsum(h)
    total = int(c[-1]) if len(c) else 0
    if total <= 0:
        return float('nan')
    idx = int(np.searchsorted(c, q * total, side='left'))
    idx = min(idx, NBIN - 1)
    return RET_LO + idx * BIN_W


def hist_mean(h: np.ndarray) -> float:
    total = int(h.sum())
    if total <= 0:
        return float('nan')
    centers = RET_LO + np.arange(NBIN) * BIN_W
    return float((h * centers).sum() / total)


# ---------------------------------------------------------------- 股票池
def build_universe(args):
    snap, snap_date = load_latest_snapshot()
    hy_map = load_industry_map()
    board_series = load_board_series(sorted({v['board'] for v in hy_map.values() if v['board']}))
    bench = load_board_series([BENCH_CODE]).get(BENCH_CODE) or None
    market = Market()
    codes = [c for c in market.codes(args.min_bars) if not c.startswith(('8', '4', '9'))]
    # 显式白名单兜底：只保留 A 股个股，排除 B 股（沪 900xxx、深 200xxx）等非个股代码。
    codes = [c for c in codes if is_stock(market_of(c), c)]
    if not args.include_star:
        codes = [c for c in codes if not c.startswith('68')]
    st_codes = {c for c, mm in snap.items() if 'ST' in (mm['name'] or '').upper()}
    codes = [c for c in codes if c not in st_codes]
    ex_hy: set[str] = set()
    for key in (args.exclude_industry or []):
        if key:
            ex_hy |= {c for c, v in hy_map.items() if key in (v['hy_name'] or '')}
    if ex_hy:
        codes = [c for c in codes if c not in ex_hy]
    dropped = 0
    if not args.keep_delisted:
        before = len(codes)
        codes = [c for c in codes if c in snap]
        dropped = before - len(codes)
    print(f'[init] 排除行业 {len(ex_hy)} 只；剔除退市/无快照 {dropped} 只；'
          f'快照 {snap_date}；股票池 {len(codes)} 只')
    return codes, snap, snap_date, hy_map, board_series, bench, market


# ---------------------------------------------------------------- 累加器
def new_acc(hy_names, board_names):
    z2 = lambda: np.zeros((NB, NS), dtype=np.float64)  # noqa: E731
    return {
        'cnt': np.zeros((NB, NS), dtype=np.int64),
        'sum': z2(),
        'hist': np.zeros(NB * NS * NBIN, dtype=np.int64),
        'hit': {k: z2() for k in HIT_LEVELS},
        'mo_cnt': {m: np.zeros((NB, NS), dtype=np.int64) for m in MONTHS},
        'mo_sum': {m: z2() for m in MONTHS},
        'bk_cnt': np.zeros((2, NB, NS), dtype=np.int64),
        'bk_sum': np.zeros((2, NB, NS), dtype=np.float64),
        'hy_cnt': np.zeros((len(hy_names), NB, NS), dtype=np.int64),
        'hy_sum': np.zeros((len(hy_names), NB, NS), dtype=np.float64),
        'bd_cnt': np.zeros((len(board_names), NB, NS), dtype=np.int64),
        'bd_sum': np.zeros((len(board_names), NB, NS), dtype=np.float64),
        'mcnt': np.zeros(NB, dtype=np.int64),          # 窗口内最高涨幅口径
        'msum': np.zeros(NB, dtype=np.float64),
        'mhist': np.zeros(NB * NBIN, dtype=np.int64),
        'mhit': {k: np.zeros(NB, dtype=np.float64) for k in HIT_LEVELS},
        'mlmt': np.zeros(NB, dtype=np.float64),
        'argc': np.zeros(NS, dtype=np.int64),          # 窗口内最高「收盘价」落在哪个时点
        'so_cnt': np.zeros(NB, dtype=np.int64),        # +3% 限价模型
        'so_sum': {name: np.zeros(NB, dtype=np.float64) for name in FALLBACKS},
        'drift_cnt': np.zeros(NB, dtype=np.int64),     # 14:xx 价 / 14:30 价 - 1
        'drift_sum': np.zeros(NB, dtype=np.float64),
        'n_trades': 0,
        'n_no_minute': 0,
        'n_days': 0,
    }


def acc_save(path: str, acc, hy_names, board_names, extra: dict) -> None:
    flat = {
        'cnt': acc['cnt'], 'sum': acc['sum'], 'hist': acc['hist'],
        'bk_cnt': acc['bk_cnt'], 'bk_sum': acc['bk_sum'],
        'hy_cnt': acc['hy_cnt'], 'hy_sum': acc['hy_sum'],
        'bd_cnt': acc['bd_cnt'], 'bd_sum': acc['bd_sum'],
        'mcnt': acc['mcnt'], 'msum': acc['msum'], 'mhist': acc['mhist'], 'mlmt': acc['mlmt'],
        'argc': acc['argc'], 'so_cnt': acc['so_cnt'],
        'drift_cnt': acc['drift_cnt'], 'drift_sum': acc['drift_sum'],
        'hy_names': np.array(hy_names, dtype=object),
        'board_names': np.array(board_names, dtype=object),
        'meta': np.array(json.dumps(extra, ensure_ascii=False)),
        'n_trades': np.array(acc['n_trades'], dtype=np.int64),
        'n_no_minute': np.array(acc['n_no_minute'], dtype=np.int64),
    }
    for k, v in acc['hit'].items():
        flat[f'hit_{k}'] = v
    for k, v in acc['mhit'].items():
        flat[f'mhit_{k}'] = v
    for m in MONTHS:
        flat[f'mo_cnt_{m}'] = acc['mo_cnt'][m]
        flat[f'mo_sum_{m}'] = acc['mo_sum'][m]
    for name, v in acc['so_sum'].items():
        flat[f'so_sum_{name}'] = v
    np.savez(path, **flat)


# ---------------------------------------------------------------- 主循环
def run_shard(args, part_path: str) -> int:
    start_int = int(args.start.replace('-', ''))
    end_int = int(args.end.replace('-', ''))
    codes, snap, snap_date, hy_map, board_series, bench, market = build_universe(args)
    if args.shards > 1:
        codes = codes[args.shard::args.shards]
        print(f'[shard {args.shard}/{args.shards}] {len(codes)} 只')
    if args.max_stocks:
        codes = codes[:args.max_stocks]

    hy_names = sorted({(v.get('hy_name') or '') for v in hy_map.values()})
    if '' not in hy_names:
        hy_names.append('')
    hy_idx = {n: i for i, n in enumerate(hy_names)}
    board_names = list(BOARD_NAMES)
    board_idx = {b: i for i, b in enumerate(board_names)}
    acc = new_acc(hy_names, board_names)

    factors = load_factors()
    dates_seen: set[int] = set()
    n_done = 0
    for code in codes:
        n_done += 1
        m = load_minute(code, 1, start=start_int - 20000, end=end_int)
        if not m or len(m['date']) == 0:
            acc['n_no_minute'] += 1
            continue
        meta = market.meta(code)
        name = (snap.get(code) or {}).get('name', '')
        lmt = limit_ratio(code, name)
        try:
            raw = market.load(code, 'raw')
            qfq = market.load(code, 'qfq', factors.get(code))
        except Exception:
            continue
        if len(qfq) < args.min_bars + 2:
            continue

        d_dates = np.asarray(qfq['date'], dtype=np.int64)
        f = factor_series(factors.get(code), d_dates)
        ind = compute_indicators(qfq, code, name)
        dpos = {int(d): i for i, d in enumerate(d_dates)}
        slices = day_slices(m['date'])
        cand = sorted(d for d in slices
                      if start_int <= d <= end_int and d in dpos
                      and dpos[d] + 1 < len(d_dates)
                      and int(d_dates[dpos[d] + 1]) in slices
                      and dpos[d] >= args.min_bars - 1)
        if not cand:
            continue
        n = len(cand)

        buy = np.full((n, NB), np.nan)
        sell = np.full((n, NS), np.nan)
        slow = np.full((n, NS), np.nan)
        whi = np.full((n, NB), np.nan)
        for k, d in enumerate(cand):
            d1 = int(d_dates[dpos[d] + 1])
            s0, e0 = slices[d]
            s1, e1 = slices[d1]
            t0, c0 = m['time'][s0:e0], m['close'][s0:e0]
            buy[k] = exact_vals(t0, c0, BUY_TIMES)
            t1 = m['time'][s1:e1]
            o1, c1m = m['open'][s1:e1], m['close'][s1:e1]
            h1m, l1m = m['high'][s1:e1], m['low'][s1:e1]
            if len(t1) and t1[0] == 931:
                sell[k, 0] = o1[0]
                slow[k, 0] = o1[0]
            sell[k, 1:] = exact_vals(t1, c1m, SELL_TIMES[1:])
            slow[k, 1:] = exact_vals(t1, l1m, SELL_TIMES[1:])
            sel = (t1 >= WIN_FROM) & (t1 <= WIN_TO)
            hi = float(h1m[sel].max()) if sel.any() else np.nan
            if np.isfinite(sell[k, 0]):
                hi = sell[k, 0] if not np.isfinite(hi) else max(hi, sell[k, 0])
            whi[k] = hi

        ii = np.array([dpos[d] for d in cand], dtype=np.int64)
        ii1 = ii + 1
        o_raw = raw['open'][ii]
        h_raw, l_raw, c_raw = raw['high'][ii], raw['low'][ii], raw['close'][ii]
        h1_raw = raw['high'][ii1]
        adj = f[ii] / f[ii1]
        one_line = (o_raw == h_raw) & (h_raw == l_raw) & (l_raw == c_raw)
        sealed = (c_raw >= h_raw - 1e-9) & ind['is_limit_up'][ii]
        gap = ymd_to_ordinal(d_dates[ii1]) - ymd_to_ordinal(d_dates[ii])
        valid = (np.isfinite(buy).all(1) & np.isfinite(sell).all(1)
                 & (buy[:, 0] > 0) & (c_raw > 0) & (gap <= args.max_gap) & ~one_line)
        if not args.keep_sealed:
            valid &= ~sealed
        if not valid.any():
            continue
        b = buy[valid]
        s = sell[valid]
        sl = slow[valid]
        w = whi[valid]
        a = adj[valid]
        # 前复权可比价换算：raw 比率 × adj
        ret = s[:, None, :] / b[:, :, None] * a[:, None, None] - 1
        ok = np.isfinite(ret)
        rs = np.where(ok, ret, 0.0).sum(0)
        cs = ok.sum(0)
        acc['sum'] += rs
        acc['cnt'] += cs
        for k in HIT_LEVELS:
            acc['hit'][k] += (ok & (ret >= k)).sum(0)
        bidx = bin_index(np.where(ok, ret, 0.0))
        idx = FLAT2[None, :, :] + bidx * (NB * NS)
        acc['hist'] += np.bincount(idx[ok], minlength=NB * NS * NBIN)

        # 逐月 / 大盘 / 行业 / 板块（同一只股票里的样本共享分组键）
        mo_of = np.asarray(d_dates[ii1[valid]], dtype=np.int64) // 100
        for mi, mkey in enumerate(MONTHS):
            sel_m = mo_of == int(mkey)
            if sel_m.any():
                acc['mo_sum'][mkey] += np.where(ok[sel_m], ret[sel_m], 0.0).sum(0)
                acc['mo_cnt'][mkey] += ok[sel_m].sum(0)
        bench_d = align_series(bench, d_dates[ii[valid]])
        bench_p = align_series(bench, d_dates[ii[valid] - 1])
        bpct = bench_d / bench_p - 1
        for bi, sel_b in ((0, bpct >= 0), (1, bpct < 0)):
            sel_b = sel_b & np.isfinite(bpct)
            if sel_b.any():
                acc['bk_sum'][bi] += np.where(ok[sel_b], ret[sel_b], 0.0).sum(0)
                acc['bk_cnt'][bi] += ok[sel_b].sum(0)
        hi_name = (hy_map.get(code) or {}).get('hy_name') or ''
        bd_name = board_of(code)
        if hi_name in hy_idx:
            h = hy_idx[hi_name]
            acc['hy_sum'][h] += rs
            acc['hy_cnt'][h] += cs
        if bd_name in board_idx:
            bi = board_idx[bd_name]
            acc['bd_sum'][bi] += rs
            acc['bd_cnt'][bi] += cs

        # T+1 窗口内「最高涨幅」（用分钟最高价，含 09:30 开盘价），按买入时点口径
        wmax = w / b * a[:, None] - 1              # (m, NB)
        wok = np.isfinite(wmax)
        acc['mcnt'] += wok.sum(0)
        acc['msum'] += np.where(wok, wmax, 0.0).sum(0)
        for k in HIT_LEVELS:
            acc['mhit'][k] += (wok & (wmax >= k)).sum(0)
        limit_px = np.round(c_raw[valid] * (1 + lmt), 2)
        acc['mlmt'] += (wok & (w >= limit_px[:, None] - 1e-6)).sum(0)
        wb = bin_index(np.where(wok, wmax, 0.0))
        widx = np.arange(NB, dtype=np.int64)[None, :] + wb * NB
        acc['mhist'] += np.bincount(widx[wok], minlength=NB * NBIN)

        # 窗口内最高收盘价落在哪个卖出时点
        sfin = np.where(np.isfinite(s), s, -np.inf)
        jbest = np.argmax(sfin, axis=1)
        acc['argc'] += np.bincount(jbest, minlength=NS)

        # +3% 限价卖模型：09:30 开盘价已 ≥ 目标 → 按开盘价成交；否则窗口内最低价触及目标
        # → 按目标价成交；否则按 fallback 时点市价卖。
        target_px = b * (1 + TARGET)
        open_px = s[:, 0]                          # (m,) 09:30 开盘价
        open_hit = open_px[:, None] >= target_px   # (m, NB)
        low_hit = sl[:, None, 1:] <= target_px[:, :, None]
        any_low = low_hit.any(axis=2)
        acc['so_cnt'] += len(b)
        for name, fb in FALLBACKS.items():
            fill = np.where(open_hit, open_px[:, None],
                            np.where(any_low, target_px, s[:, fb][:, None]))
            re = fill / b * a[:, None] - 1 - COST
            acc['so_sum'][name] += np.where(np.isfinite(re), re, 0.0).sum(0)

        # 14:xx 相对 14:30 的价格漂移
        drift = b / b[:, [0]] - 1
        dok = np.isfinite(drift)
        acc['drift_cnt'] += dok.sum(0)
        acc['drift_sum'] += np.where(dok, drift, 0.0).sum(0)

        acc['n_trades'] += int(valid.sum())
        dates_seen.update(int(d) for d in d_dates[ii1[valid]])
        if n_done % 500 == 0:
            print(f'  ... {n_done}/{len(codes)} 有效 {acc["n_trades"]}', flush=True)

    extra = {
        'snapshot_date': snap_date,
        'dates': sorted(int_to_ymd(d) for d in dates_seen),
        'n_codes': len(codes),
    }
    acc_save(part_path, acc, hy_names, board_names, extra)
    print(f'[shard {args.shard}] 完成：{len(codes)} 只 / 有效 {acc["n_trades"]} 笔 '
          f'/ 无分钟数据 {acc["n_no_minute"]} 只 → {part_path}')
    return 0


# ---------------------------------------------------------------- 合并
def merge_parts(args) -> int:
    paths = [os.path.join(args.out_dir, f'grid_part{i}.npz') for i in range(args.shards)]
    paths = [p for p in paths if os.path.exists(p)]
    if not paths:
        print('[warn] 没有分片文件')
        return 1
    z = np.load(paths[0], allow_pickle=True)
    keys = list(z.files)
    acc = {k: z[k].copy() for k in keys}
    extra = json.loads(str(acc['meta']))
    z.close()
    for p in paths[1:]:
        z = np.load(p, allow_pickle=True)
        for k in keys:
            if k in ('meta', 'hy_names', 'board_names'):
                continue
            acc[k] = acc[k] + z[k]
        e = json.loads(str(z['meta']))
        extra['dates'] = sorted(set(extra['dates']) | set(e['dates']))
        extra['n_codes'] += e['n_codes']
        z.close()
    hy_names = [str(x) for x in acc['hy_names']]
    board_names = [str(x) for x in acc['board_names']]
    return report(args, acc, hy_names, board_names, extra)


# ---------------------------------------------------------------- 报表
def _pair_hist(acc, i, j):
    # 扁平布局为 flat = bin * (NB*NS) + i * NS + j
    return acc['hist'].reshape(NBIN, NB, NS)[:, i, j]


def _buy_hist(acc, i):
    # 扁平布局为 flat = bin * NB + i
    return acc['mhist'].reshape(NBIN, NB)[:, i]


def _pstat(acc, i, j):
    h = _pair_hist(acc, i, j)
    total = int(h.sum())
    if total <= 0:
        return {}
    return {
        'n': total,
        'mean_pct': round(hist_mean(h) * 100, 4),
        'median_pct': round(hist_quantile(h, 0.5) * 100, 4),
        'p10_pct': round(hist_quantile(h, 0.1) * 100, 4),
        'p90_pct': round(hist_quantile(h, 0.9) * 100, 4),
    }


def report(args, acc, hy_names, board_names, extra) -> int:
    os.makedirs(args.out_dir, exist_ok=True)
    cnt = acc['cnt']
    rsum = acc['sum']
    total_trades = int(acc['n_trades'])

    # 1) 买入时点边际
    rows = []
    for i, bt in enumerate(BUY_TIMES):
        st = _pstat(acc, i, NS - 1)
        s1 = _pstat(acc, i, 1)
        s0 = _pstat(acc, i, 0)
        mh = _buy_hist(acc, i)
        msum, mcnt = float(acc['msum'][i]), int(acc['mcnt'][i])
        row = {
            'buy_time': f'{bt // 100:02d}:{bt % 100:02d}',
            'n': st.get('n', 0),
            'ret_0930_pct': s0.get('mean_pct'),
            'ret_0931_pct': s1.get('mean_pct'),
            'ret_1000_pct': st.get('mean_pct'),
            'ret_1000_median_pct': st.get('median_pct'),
            'ret_1000_p10_pct': st.get('p10_pct'),
            'ret_1000_p90_pct': st.get('p90_pct'),
            'drift_vs_1430_pct': round(float(acc['drift_sum'][i]
                                             / max(int(acc['drift_cnt'][i]), 1) * 100), 4),
            'wmax_mean_pct': round(msum / mcnt * 100, 4) if mcnt else None,
            'wmax_median_pct': round(hist_quantile(mh, 0.5) * 100, 4) if mcnt else None,
            'strat3_fb1000_pct': round(float(acc['so_sum_1000'][i]
                                             / max(int(acc['so_cnt'][i]), 1) * 100), 4),
            'strat3_fb0931_pct': round(float(acc['so_sum_0931'][i]
                                             / max(int(acc['so_cnt'][i]), 1) * 100), 4),
        }
        for k in HIT_LEVELS:
            row[f'wmax_ge{int(k * 100)}_pct'] = round(
                float(acc[f'mhit_{k}'][i] / max(mcnt, 1)) * 100, 2)
        row['wmax_limit_pct'] = round(float(acc['mlmt'][i] / max(mcnt, 1)) * 100, 2)
        rows.append(row)
    write_csv(os.path.join(args.out_dir, 'grid_buy.csv'), rows)

    # 2) 卖出时点边际（固定 14:30 买入）
    i0 = 0
    base = None
    srows = []
    for j, stime in enumerate(SELL_TIMES):
        ps = _pstat(acc, i0, j)
        if j == 0:
            base = ps.get('mean_pct')
        srows.append({
            'sell_time': f'{stime // 100:02d}:{stime % 100:02d}',
            'n': ps.get('n', 0),
            'mean_pct': ps.get('mean_pct'),
            'vs_0930_pct': (round(ps.get('mean_pct', 0) - base, 4)
                            if ps and base is not None else None),
            'median_pct': ps.get('median_pct'),
            'p10_pct': ps.get('p10_pct'),
            'p90_pct': ps.get('p90_pct'),
            'is_window_high_share_pct': round(
                float(acc['argc'][j] / max(int(cnt[i0, j]), 1)) * 100, 2),
        })
    write_csv(os.path.join(args.out_dir, 'grid_sell.csv'), srows)

    # 3) 全组合 + 逐月
    prows = []
    mrows = []
    for i, bt in enumerate(BUY_TIMES):
        for j, st in enumerate(SELL_TIMES):
            ps = _pstat(acc, i, j)
            if not ps:
                continue
            row = {'buy_time': f'{bt // 100:02d}:{bt % 100:02d}',
                   'sell_time': f'{st // 100:02d}:{st % 100:02d}'}
            row.update(ps)
            for k in (0.01, 0.02, 0.03, 0.04, 0.05):
                row[f'hit_ge{int(k * 100)}_pct'] = round(
                    float(acc[f'hit_{k}'][i, j] / max(ps['n'], 1)) * 100, 2)
            prows.append(row)
            for mkey in MONTHS:
                n = int(acc[f'mo_cnt_{mkey}'][i, j])
                if n:
                    mrows.append({
                        'buy_time': row['buy_time'], 'sell_time': row['sell_time'],
                        'month': mkey, 'n': n,
                        'mean_pct': round(float(acc[f'mo_sum_{mkey}'][i, j] / n) * 100, 4),
                    })
    prows.sort(key=lambda r: -r['mean_pct'])
    write_csv(os.path.join(args.out_dir, 'grid_pairs.csv'), prows)
    write_csv(os.path.join(args.out_dir, 'grid_pairs_month.csv'), mrows)

    # 4) 行业 / 板块（对照组合）
    for tag, names, c_arr, s_arr in (('hy', hy_names, acc['hy_cnt'], acc['hy_sum']),
                                     ('board', board_names, acc['bd_cnt'], acc['bd_sum'])):
        rows_k = []
        for k, nm in enumerate(names):
            tot = int(c_arr[k, 0, 0])
            if tot <= 0:
                continue
            row = {'name': nm, 'n_samples': tot}
            for bt, st in REF_PAIRS:
                i, j = BUY_TIMES.index(bt), SELL_TIMES.index(st)
                n = int(c_arr[k, i, j])
                row[f'{bt}_{st}_n'] = n
                row[f'{bt}_{st}_mean_pct'] = (
                    round(float(s_arr[k, i, j] / n) * 100, 4) if n else None)
            rows_k.append(row)
        rows_k.sort(key=lambda r: -(r.get('1430_1000_mean_pct') or -99))
        write_csv(os.path.join(args.out_dir, f'grid_{tag}.csv'), rows_k)

    # 5) 逐月最优时点（按固定卖出 10:00 口径）
    month_best = {}
    for mkey in MONTHS:
        n = int(acc[f'mo_cnt_{mkey}'][i0, NS - 1])
        if not n:
            continue
        buy_curve = []
        for i, bt in enumerate(BUY_TIMES):
            nb = int(acc[f'mo_cnt_{mkey}'][i, NS - 1])
            buy_curve.append((f'{bt // 100:02d}:{bt % 100:02d}',
                              round(float(acc[f'mo_sum_{mkey}'][i, NS - 1]
                                          / max(nb, 1)) * 100, 4), nb))
        sell_curve = []
        for j, st in enumerate(SELL_TIMES):
            n2 = int(acc[f'mo_cnt_{mkey}'][i0, j])
            sell_curve.append((f'{st // 100:02d}:{st % 100:02d}',
                               round(float(acc[f'mo_sum_{mkey}'][i0, j]
                                           / max(n2, 1)) * 100, 4), n2))
        month_best[mkey] = {
            'best_buy_1430_1000': max(buy_curve, key=lambda x: x[1]),
            'worst_buy_1430_1000': min(buy_curve, key=lambda x: x[1]),
            'best_sell_1430_buy': max(sell_curve, key=lambda x: x[1]),
            'worst_sell_1430_buy': min(sell_curve, key=lambda x: x[1]),
            'buy_curve': buy_curve, 'sell_curve': sell_curve,
        }

    # 6) 大盘条件
    bench_rows = []
    for bi, lab in ((0, 'hs300_T日>=0'), (1, 'hs300_T日<0')):
        for i, bt in enumerate(BUY_TIMES):
            n = int(acc['bk_cnt'][bi, i, NS - 1])
            if n:
                bench_rows.append({'bucket': lab,
                                   'buy_time': f'{bt // 100:02d}:{bt % 100:02d}',
                                   'n': n,
                                   'ret_1000_pct': round(
                                       float(acc['bk_sum'][bi, i, NS - 1] / n) * 100, 4)})
    write_csv(os.path.join(args.out_dir, 'grid_bench.csv'), bench_rows)

    # 7) 汇总
    best_pair = prows[0]
    ref = {f'{bt}_{st}': _pstat(acc, BUY_TIMES.index(bt), SELL_TIMES.index(st))
           for bt, st in REF_PAIRS}
    summary = {
        'trades': total_trades,
        'n_codes': extra.get('n_codes'),
        'snapshot_date': extra.get('snapshot_date'),
        'dates': extra.get('dates'),
        'n_dates': len(extra.get('dates') or []),
        'buy_grid': [f'{t // 100:02d}:{t % 100:02d}' for t in BUY_TIMES],
        'sell_grid': [f'{t // 100:02d}:{t % 100:02d}' for t in SELL_TIMES],
        'cost': COST, 'target': TARGET,
        'ref_pairs': ref,
        'best_pair_in_sample': best_pair,
        'month_best': {k: {'best_buy_1430_1000': v['best_buy_1430_1000'],
                           'worst_buy_1430_1000': v['worst_buy_1430_1000'],
                           'best_sell_1430_buy': v['best_sell_1430_buy'],
                           'worst_sell_1430_buy': v['worst_sell_1430_buy']}
                       for k, v in month_best.items()},
        'buy_marginal': [{'buy_time': f'{bt // 100:02d}:{bt % 100:02d}',
                          'ret_1000_pct': _pstat(acc, i, NS - 1).get('mean_pct')}
                         for i, bt in enumerate(BUY_TIMES)],
        'sell_marginal': [{'sell_time': f'{st // 100:02d}:{st % 100:02d}',
                           'mean_pct': _pstat(acc, i0, j).get('mean_pct')}
                          for j, st in enumerate(SELL_TIMES)],
        'caveats': [
            '1 分钟数据窗口仅 2026-06-12 ~ 2026-09-18（通达信本地 .lc1 的可用范围），'
            '落在 2026 年强势段，且无法做跨年度稳定性检验，只能做逐月检验。',
            '买入价 = T 日该分钟收盘价；09:30 卖出价用 T+1 第一根 1 分钟线的开盘价（集合竞价价）。',
            '收益用前复权因子换算为可比价；涨跌停 / 封板判定用不复权价。',
            '806 个组合里挑「全样本最优」是样本内优，不代表未来；'
            '只有逐月方向一致的时点才可作为可用结论。',
            '仅含 A 股个股；剔除 ST、一字板、T 日涨停封板、间隔 >10 自然日、'
            '科创板、北交所、B 股、银行股、退市股（引入幸存者偏差）。',
        ],
    }
    with open(os.path.join(args.out_dir, 'summary.json'), 'w', encoding='utf-8') as fp:
        json.dump(summary, fp, ensure_ascii=False, indent=2)
    with open(os.path.join(args.out_dir, 'month_curves.json'), 'w', encoding='utf-8') as fp:
        json.dump(month_best, fp, ensure_ascii=False, indent=2)

    print(json.dumps({
        'trades': total_trades,
        'n_dates': summary['n_dates'],
        'dates': [summary['dates'][0], summary['dates'][-1]] if summary['dates'] else [],
        'ref_pairs': ref,
        'best_pair_in_sample': best_pair,
        'month_best': summary['month_best'],
    }, ensure_ascii=False, indent=2))
    print(f'[out] {args.out_dir}')
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--start', default='2026-06-12')
    ap.add_argument('--end', default='2026-09-18')
    ap.add_argument('--min-bars', type=int, default=150)
    ap.add_argument('--include-star', action='store_true')
    ap.add_argument('--keep-sealed', action='store_true')
    ap.add_argument('--max-gap', type=int, default=10)
    ap.add_argument('--out-dir', default=OUT_DEFAULT)
    ap.add_argument('--max-stocks', type=int, default=0)
    ap.add_argument('--exclude-industry', nargs='*', default=['银行'])
    ap.add_argument('--keep-delisted', action='store_true')
    ap.add_argument('--shard', type=int, default=0)
    ap.add_argument('--shards', type=int, default=1)
    ap.add_argument('--merge', action='store_true')
    args = ap.parse_args()
    os.makedirs(args.out_dir, exist_ok=True)
    if args.merge:
        return merge_parts(args)
    return run_shard(args, os.path.join(args.out_dir, f'grid_part{args.shard}.npz'))


if __name__ == '__main__':
    raise SystemExit(main())
