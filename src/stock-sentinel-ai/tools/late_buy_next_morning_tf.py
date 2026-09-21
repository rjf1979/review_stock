# -*- coding: utf-8 -*-
"""尾盘买入 → 次日早盘卖出：逐笔明细 + 多周期（5/15/30/60 分钟）形态入库。

与 ``late_buy_next_morning_minute.py`` 的关系
--------------------------------------------
* **样本口径完全一致**：股票池过滤、有效样本判定、买入价（T 日 14:30 分钟收盘价）、
  卖出价（T+1 09:31 集合竞价开盘）全部直接复用该模块的函数与常量，
  因此本脚本的有效样本数必须**逐笔等于 292,685**（回归校验项）。
* 本脚本不产出新的统计口径，只做两件事：
  1. 把每笔交易的日线特征、日线形态位置、4 个分钟周期的形态快照写成
     ``bt_trade`` + ``bt_trade_tf``（写入 ``data/backtest.db``）；
  2. 顺手把「形态 × 收益」的分档结果导出成 CSV，供人工复核。

数据口径要点
------------
* 入场时刻固定 ``asOf=1430``：分钟形态只用 ``endTime <= 1430`` 的已收盘 bar；
* 换手率 = 截至 14:30 的分钟成交量 ÷ 流通股本（流通股本由 2026-09-18 快照的
  流通市值 ÷ 现价反推，存在前视偏差，已在 ``bt_run.note`` 中声明）；
* 「分时量比」= 当日截至 14:30 累计量 ÷ 前 5 个交易日同刻累计量均值；
* 所有收益列统一为百分比（×100），与 ``bt_trade`` 字段字典一致；
* 日线形态位置语义 ``dayShape`` 由 ``tools/day_shape.py`` 判定（自建口径）；
* 分钟形态复用 ``tools/patterns`` 注册表，不新造规则。

用法::

    python tools\\late_buy_next_morning_tf.py --max-stocks 50      # 冒烟
    python tools\\late_buy_next_morning_tf.py                     # 全量入库
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import backtest_store as store                          # noqa: E402
import day_shape                                        # noqa: E402
import patterns as patterns_pkg                         # noqa: E402
import tf_patterns as tfp                               # noqa: E402
from indicators import compute_indicators, limit_ratio   # noqa: E402
from kdata import (Market, factor_series, int_to_ymd, is_stock,   # noqa: E402
                   market_of)
from late_buy_next_morning import (COST, TARGET, BaseAgg, IndexAgg,  # noqa: E402
                                   KeyAgg, bucket_index, bucket_labels, load_factors,
                                   write_csv, ymd_to_ordinal)
from late_buy_next_morning_minute import (AM_END, AM_START,  # noqa: E402
                                          BENCH_CODE, ENTRY_HHMM,
                                          day_slices, minute_entry,
                                          minute_high)
from tdx_minute import load_minute                       # noqa: E402
from tdx_sector import (align_series, load_board_series,  # noqa: E402
                        load_industry_map)

ROOT = os.path.normpath(os.path.join(HERE, '..'))
OUT_DEFAULT = os.path.join(ROOT, 'data', 'backtest', 'late-buy-next-morning-tf')

RUN_TF = 'tf-20260612-20260917-stockonly-d1'
EXPECTED_TRADES = 292685

FLUSH_TRADES = 2000        # 每多少笔提交一次（含 4 倍 bt_trade_tf 行）

# bt_trade_tf 的列（与 tools/bt_schema.py 的 DDL 顺序一致）
TF_COLS = [
    'tradeId', 'runId', 'period', 'code', 'date', 'asOf', 'lastBarTime', 'barCount',
    'barsToday', 'closeVsMa5Pct', 'closeVsMa10Pct', 'closeVsMa20Pct', 'closeVsMa60Pct',
    'ma5SlopePct', 'maAlign', 'posInRange20', 'posInRange60', 'rangeAmp20Pct',
    'volRatio20', 'atrPct14', 'rsi14', 'macdHistPct', 'ret1Pct', 'ret5Pct',
    'trendSlopePct', 'trendR2', 'patterns', 'patternMask', 'primaryPattern',
    'patternBias', 'biasScore', 'engineVersion', 'qualityFlags', 'createdAt',
]
TF_SQL = ('INSERT OR REPLACE INTO bt_trade_tf (' + ','.join(TF_COLS) + ') VALUES ('
          + ','.join('?' * len(TF_COLS)) + ')')

# 本脚本额外新增的分档维度（turnoverPct / 分时量比 / pos120 / 周期共振分）
EDGES_EXTRA = {
    'turnover': np.array([0, 0.3, 0.6, 1.0, 1.5, 2.5, 4.0, 7.0, 12.0, 1e9]),
    'vol_ratio_intraday': np.array([0, 0.5, 0.7, 0.9, 1.1, 1.3, 1.6, 2.2, 3.5, 100]),
    'pos120': np.array([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.65, 0.8, 0.9, 1.0001]),
    'tf_align_score': np.array([-9, -4, -2, -1, 0, 1, 2, 4, 9]),
    'atr_pct': np.array([0, 1, 2, 3, 4, 6, 9, 15, 100]),
    'float_mcap_yi': np.array([0, 20, 50, 100, 200, 500, 1000, 1e9]),
    'amount_wan': np.array([0, 1000, 3000, 6000, 12000, 30000, 80000, 1e9]),
}


# ---------------------------------------------------------------- 小工具
def _r(v, nd: int = 4):
    """浮点安全化：None / nan / inf → None，其余四舍五入。"""
    if v is None:
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(x):
        return None
    return round(x, nd)


def _ri(v):
    if v is None:
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return int(x) if math.isfinite(x) else None


def _pct(cur, base) -> float:
    """(cur/base - 1) * 100，base <= 0 或非有限时返回 nan。"""
    if not (math.isfinite(cur) and math.isfinite(base)) or base <= 0:
        return float('nan')
    return (cur / base - 1.0) * 100.0


class PatternAgg(BaseAgg):
    """按形态命中聚合（一笔交易可命中多个形态，会重复计入各自形态的样本）。"""

    def add(self, pid: str, sel, ret_open, ret_high, ret_close, limit_touch, strat_ret):
        if not sel.any():
            return
        self._accumulate(self._slot(pid), ret_open[sel], ret_high[sel],
                         ret_close[sel], limit_touch[sel], strat_ret[sel])

    def _sort_keys(self):
        return sorted(self.slots)


def cum_upto(m1: dict, hhmm: int = ENTRY_HHMM) -> tuple[dict, dict]:
    """分钟序列 → 每日「截至 hhmm 的累计成交量 / 成交额」。"""
    date = np.asarray(m1['date'], dtype=np.int64)
    sel = np.asarray(m1['time'], dtype=np.int64) <= int(hhmm)
    if not sel.any():
        return {}, {}
    d = date[sel]
    vol = np.asarray(m1['volume'], dtype=np.float64)[sel]
    amt = np.asarray(m1['amount'], dtype=np.float64)[sel]
    uniq, starts = np.unique(d, return_index=True)
    starts = np.asarray(sorted(int(s) for s in starts), dtype=np.int64)
    vols = np.add.reduceat(vol, starts)
    amts = np.add.reduceat(amt, starts)
    return ({int(u): float(x) for u, x in zip(uniq, vols)},
            {int(u): float(x) for u, x in zip(uniq, amts)})


def day_totals(m1: dict) -> dict:
    """分钟序列 → 每日全天成交量（股）。"""
    date = np.asarray(m1['date'], dtype=np.int64)
    vol = np.asarray(m1['volume'], dtype=np.float64)
    uniq, starts = np.unique(date, return_index=True)
    starts = np.asarray(sorted(int(s) for s in starts), dtype=np.int64)
    return {int(u): float(x) for u, x in zip(uniq, np.add.reduceat(vol, starts))}


def am_extremes(m: dict, sl, hhmm: int = ENTRY_HHMM) -> tuple[float, float, float]:
    """T 日截至 hhmm 的最高价、最低价、当日第一根 bar 的开盘价（均为不复权）。"""
    s, e = sl
    t = m['time'][s:e]
    sel = t <= int(hhmm)
    if not sel.any():
        return float('nan'), float('nan'), float('nan')
    h = np.asarray(m['high'][s:e], dtype=np.float64)[sel]
    l = np.asarray(m['low'][s:e], dtype=np.float64)[sel]
    o = float(np.asarray(m['open'][s:e], dtype=np.float64)[0])
    return float(h.max()), float(l.min()), o


def _mean5(seq: list, idx: int) -> float:
    """前 5 期均值（不足则用已有的、至少 1 期）。"""
    lo = max(0, idx - 5)
    vals = [v for v in seq[lo:idx] if v is not None and math.isfinite(v) and v > 0]
    return float(np.mean(vals)) if vals else float('nan')


def build_universe(args, snap: dict, hy_map: dict,
                   market: Market) -> tuple[list[str], dict]:
    """与 minute 脚本逐条一致的股票池过滤。"""
    codes = [c for c in market.codes(args.min_bars) if not c.startswith(('8', '4', '9'))]
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
    if args.codes_file:
        with open(args.codes_file, 'r', encoding='utf-8') as f:
            want = {ln.strip().lstrip('\ufeff') for ln in f if ln.strip()}
        codes = [c for c in codes if c in want]
    if args.max_stocks:
        codes = codes[:args.max_stocks]
    info = {'ex_hy': len(ex_hy), 'dropped_delisted': dropped, 'st': len(st_codes)}
    return codes, info


def main() -> int:
    ap = argparse.ArgumentParser(description='尾盘买入回测：多周期形态入库')
    ap.add_argument('--start', default='1990-01-01')
    ap.add_argument('--end', default='2099-12-31')
    ap.add_argument('--min-bars', type=int, default=150)
    ap.add_argument('--include-star', action='store_true')
    ap.add_argument('--keep-sealed', action='store_true')
    ap.add_argument('--max-gap', type=int, default=10)
    ap.add_argument('--out-dir', default=OUT_DEFAULT)
    ap.add_argument('--db', default=store.DEFAULT_DB)
    ap.add_argument('--max-stocks', type=int, default=0)
    ap.add_argument('--codes-file', default='')
    ap.add_argument('--dry-run', action='store_true', help='只统计不写库')
    ap.add_argument('--no-purge', action='store_true',
                    help='启动时不清理同批次明细（分片并发写入同一库时必须开启）')
    ap.add_argument('--dump-codes', default='',
                    help='把过滤后的股票池写到该文件后退出（用于分片）')
    ap.add_argument('--exclude-industry', nargs='*', default=['银行'],
                    help='按通达信行业名包含匹配排除，默认排除「银行」；传空串可关闭')
    ap.add_argument('--keep-delisted', action='store_true',
                    help='保留退市股；默认剔除不在最新快照中的代码（会引入幸存者偏差）')
    args = ap.parse_args()

    t_all = time.time()
    start_int = int(args.start.replace('-', ''))
    end_int = int(args.end.replace('-', ''))

    snaps, snap_date = store.snapshot_records()
    hy_map = load_industry_map()
    board_series = load_board_series(
        sorted({v['board'] for v in hy_map.values() if v['board']}))
    bench_series = load_board_series([BENCH_CODE]).get(BENCH_CODE) or {}
    market = Market()
    codes, info = build_universe(args, snaps, hy_map, market)
    meta_map = {c: market.meta(c) for c in codes}
    print(f'[init] 快照 {snap_date}；排除行业 {info["ex_hy"]} 只；'
          f'剔除退市/无快照 {info["dropped_delisted"]} 只；股票池 {len(codes)} 只',
          flush=True)
    if args.dump_codes:
        with open(args.dump_codes, 'w', encoding='utf-8') as fp:
            fp.write('\n'.join(codes) + '\n')
        print(f'[init] 股票池已写出 {args.dump_codes}（{len(codes)} 只）', flush=True)
        return 0

    factors = load_factors()
    day_ids = list(patterns_pkg.ids())
    day_bits = {pid: i for i, pid in enumerate(day_ids)}
    day_cat = {pid: patterns_pkg.get(pid)['category'] for pid in day_ids}
    intra_ids = tfp.intraday_ids()

    # ---- 聚合器（导出 CSV 用，口径与 minute 脚本一致）
    aggs: dict[str, BaseAgg] = {k: IndexAgg(bucket_labels(e))
                                for k, e in EDGES_EXTRA.items()}
    aggs['year'] = KeyAgg()
    aggs['board'] = KeyAgg()
    aggs['hy'] = KeyAgg()
    aggs['day_shape'] = KeyAgg()
    aggs['ma_align'] = KeyAgg()
    aggs['tf_align'] = KeyAgg()
    aggs['tf_primary'] = KeyAgg()
    pat_aggs = {p: PatternAgg() for p in tfp.PERIODS}
    overall = IndexAgg(['分钟精确'])

    conn = None if args.dry_run else store.connect(args.db)
    rid = None
    if conn is not None:
        rid = store.run_id(conn, RUN_TF)
        if not args.no_purge:
            conn.execute('DELETE FROM bt_trade_tf WHERE runId=?', (rid,))
            conn.execute('DELETE FROM bt_trade WHERE runId=?', (rid,))
            conn.commit()
        print(f'[init] 写入 {args.db}  runId={rid} ({RUN_TF})；'
              f'purge={"off" if args.no_purge else "on"}', flush=True)

    created = store.now_iso()
    cur = conn.cursor() if conn is not None else None
    tf_buf: list[tuple] = []
    n_trades = 0
    n_tf = 0
    n_no_minute = 0
    n_done = 0
    dates_seen: set[int] = set()

    for code in codes:
        n_done += 1
        m = load_minute(code, 1, start=start_int - 20000, end=end_int)
        if not m or len(m['date']) == 0:
            n_no_minute += 1
            continue
        rec = snaps.get(code) or {}
        name = rec.get('name', '')
        board_name = (meta_map.get(code) or {}).get('board', '') or ''
        fsw = store.float_shares_wan(rec)
        lmt = limit_ratio(code, name)
        try:
            raw = market.load(code, 'raw')
            qfq = market.load(code, 'qfq', factors.get(code))
        except Exception:                                   # noqa: BLE001
            continue
        if len(qfq) < args.min_bars + 2:
            continue
        d_dates = np.asarray(qfq['date'], dtype=np.int64)
        f = factor_series(factors.get(code), d_dates)
        ind_d = compute_indicators(qfq, code, name)
        dpos = {int(d): i for i, d in enumerate(d_dates)}
        slices = day_slices(m['date'])

        cand = sorted(d for d in slices
                      if start_int <= d <= end_int and d in dpos
                      and dpos[d] + 1 < len(d_dates)
                      and int(d_dates[dpos[d] + 1]) in slices
                      and dpos[d] >= args.min_bars - 1)
        if not cand:
            continue
        ii = np.array([dpos[d] for d in cand], dtype=np.int64)
        ii1 = ii + 1
        n = len(cand)

        entry_am = np.full(n, np.nan)
        hi_am = np.full(n, np.nan)
        hi_day_min = np.full(n, np.nan)
        hh_am = np.full(n, np.nan)
        ll_am = np.full(n, np.nan)
        op_am = np.full(n, np.nan)
        for k, d in enumerate(cand):
            d1 = int(d_dates[ii[k] + 1])
            entry_am[k] = minute_entry(m, slices[d])
            h, _ = minute_high(m, slices[d1], AM_START, AM_END)
            hi_am[k] = h
            hi_day_min[k] = minute_high(m, slices[d1], 0, 2400)[0]
            hh_am[k], ll_am[k], op_am[k] = am_extremes(m, slices[d], ENTRY_HHMM)

        o_raw = raw['open'][ii]
        h_raw, l_raw, c_raw = raw['high'][ii], raw['low'][ii], raw['close'][ii]
        h1_raw = raw['high'][ii1]
        o1, c1 = qfq['open'][ii1], qfq['close'][ii1]
        adj = f[ii] / f[ii1]
        c_close = qfq['close'][ii]

        one_line = (o_raw == h_raw) & (h_raw == l_raw) & (l_raw == c_raw)
        sealed = (c_raw >= h_raw - 1e-9) & ind_d['is_limit_up'][ii]
        gap = ymd_to_ordinal(d_dates[ii1]) - ymd_to_ordinal(d_dates[ii])
        valid = (np.isfinite(entry_am) & np.isfinite(hi_am) & np.isfinite(hi_day_min)
                 & (entry_am > 0) & (c_close > 0) & (gap <= args.max_gap) & ~one_line)
        if not args.keep_sealed:
            valid &= ~sealed
        if not valid.any():
            continue

        ret_high_am = hi_am / entry_am * adj - 1
        ret_open = o1 / entry_am * adj - 1
        ret_close = c1 / entry_am * adj - 1
        limit_px = np.round(c_raw * (1 + lmt), 2)
        limit_touch = hi_am >= limit_px - 1e-6
        hit3 = ret_high_am >= TARGET
        strat_ret = np.where(hit3, np.maximum(TARGET, ret_open), ret_open) - COST

        # ---- 多周期形态快照（每个周期一次，逐日取下标）
        tf_snap = tfp.tf_snapshot(m, code, name, cand, as_of=ENTRY_HHMM)
        hit_mat = {p: np.zeros((len(intra_ids), n), dtype=bool) for p in tfp.PERIODS}
        prim_arr = {p: np.full(n, '', dtype=object) for p in tfp.PERIODS}
        for k, d in enumerate(cand):
            for p in tfp.PERIODS:
                row = (tf_snap.get(int(d)) or {}).get(p)
                if not row:
                    continue
                for pid in row['patterns']:
                    j = intra_ids.index(pid) if pid in intra_ids else -1
                    if j >= 0:
                        hit_mat[p][j, k] = True
                if row['primaryPattern']:
                    prim_arr[p][k] = row['primaryPattern']

        # ---- 日线形态命中（一次算全序列）
        day_hits = {pid: patterns_pkg.detect(pid, ind_d) for pid in day_ids}

        # ---- 日线形态位置语义
        dshape = [day_shape.UNKNOWN] * n
        dchan = ['na'] * n
        dpos = [None] * n
        for k in range(n):
            dshape[k], dchan[k], dpos[k] = day_shape.classify(ind_d, int(ii[k]))

        # ---- 分钟量能（截至 14:30）
        cum_vol, cum_amt = cum_upto(m, ENTRY_HHMM)
        all_day_vol = day_totals(m)
        day_list = sorted(slices)
        day_pos = {d: k for k, d in enumerate(day_list)}
        cv_seq = [cum_vol.get(d) for d in day_list]
        dv_seq = [all_day_vol.get(d) for d in day_list]

        hy_close = align_series(board_series.get((hy_map.get(code) or {}).get('board', ''))
                                or {}, d_dates)
        bench_close = align_series(bench_series, d_dates)
        prev_hy = np.roll(hy_close, 1)
        prev_hy[0] = np.nan
        prev_bench = np.roll(bench_close, 1)
        prev_bench[0] = np.nan

        ma5, ma10, ma20 = ind_d['ma5'], ind_d['ma10'], ind_d['ma20']
        ma60, ma120 = ind_d['ma60'], ind_d['ma120']
        ma_pack = ((5, ma5), (10, ma10), (20, ma20), (60, ma60), (120, ma120))

        zeros = np.zeros(n, dtype=np.int64)
        overall.add(zeros, valid, ret_open, ret_high_am, ret_close, limit_touch, strat_ret)

        # ---- 逐笔
        for j in np.nonzero(valid)[0]:
            j = int(j)
            i = int(ii[j])
            i1 = int(ii1[j])
            d = int(d_dates[i])
            entry_q = float(entry_am[j]) / float(f[i])
            prev_c = float(ind_d['prev_close'][i])
            # 触板判断统一用「原始价 vs 原始前收盘」，与日线脚本 touched_limit 口径一致
            pc_raw = float(raw['close'][i - 1]) if i >= 1 else float('nan')
            hhq, llq, opq = (float(hh_am[j]) / float(f[i]), float(ll_am[j]) / float(f[i]),
                             float(op_am[j]) / float(f[i]))
            rng = hhq - llq
            cum_v = cum_vol.get(d)
            cum_a = cum_amt.get(d)
            k_d = day_pos.get(d)
            ref_intra = _mean5(cv_seq, k_d) if k_d is not None else float('nan')
            ref_day = _mean5(dv_seq, k_d) if k_d is not None else float('nan')

            ma_pos = {}
            ma_slope = {}
            for nd_, arr in ma_pack:
                mv = float(arr[i]) if np.isfinite(arr[i]) else float('nan')
                ma_pos[nd_] = _pct(entry_q, mv)
                ma_slope[nd_] = (_pct(float(arr[i]), float(arr[i - nd_]))
                                 if i >= nd_ and np.isfinite(arr[i - nd_]) else float('nan'))
            malign = tfp._align(ma5, ma10, ma20, ma60, i)

            dnames = [pid for pid in day_ids if bool(day_hits[pid][i])]
            dmask = 0
            for pid in dnames:
                dmask |= 1 << day_bits[pid]
            dcats = sorted({day_cat[pid] for pid in dnames})

            row = {
                'runId': rid, 'code': code, 'name': name,
                'board': board_name, 'date': d,
                'entryTime': ENTRY_HHMM, 'entryPrice': _r(entry_q),
                'close': _r(c_close[j]), 'pct': _r(_pct(entry_q, prev_c)),
                'amp': _r((hhq - llq) / prev_c * 100.0 if prev_c > 0 else float('nan')),
                'closePos': _r((entry_q - llq) / rng if rng > 0 else float('nan')),
                'upperShadow': _r((hhq - max(opq, entry_q)) / entry_q if entry_q > 0
                                  else float('nan')),
                'lowerShadow': _r((min(opq, entry_q) - llq) / entry_q if entry_q > 0
                                  else float('nan')),
                'turnoverPct': _r(cum_v / (fsw * 100.0) if (cum_v and fsw) else None),
                'turnoverSrc': 'intraday_minute',
                'floatSharesWan': _r(fsw),
                'volRatio': _r(cum_v / ref_day if (cum_v and math.isfinite(ref_day)
                                                   and ref_day > 0) else None),
                'volRatioIntraday': _r(cum_v / ref_intra if (cum_v
                                                             and math.isfinite(ref_intra)
                                                             and ref_intra > 0) else None),
                'amountWan': _r(cum_a / 1e4 if cum_a else None),
                'floatMcapYi': _r(fsw * float(entry_am[j]) / 1e4 if fsw else None),
                'bias20': _r(_pct(entry_q, float(ma20[i]))),
                'bias60': _r(_pct(entry_q, float(ma60[i]))),
                'rsi14': _r(ind_d['rsi14'][i]),
                'atrPct': _r(float(ind_d['atr14'][i]) / entry_q * 100 if entry_q > 0
                             else None),
                'ret5': _r(_pct(float(c_close[j]), float(ind_d['close'][max(i - 5, 0)]))
                           if i >= 5 else None),
                'ret20': _r(_pct(float(c_close[j]), float(ind_d['close'][max(i - 20, 0)]))
                            if i >= 20 else None),
                'ret60': _r(_pct(float(c_close[j]), float(ind_d['close'][max(i - 60, 0)]))
                            if i >= 60 else None),
                'distHh20': _r(_pct(entry_q, float(ind_d['hh20'][i]))),
                'listDays': i,
                'ma5Pos': _r(ma_pos[5]), 'ma10Pos': _r(ma_pos[10]),
                'ma20Pos': _r(ma_pos[20]), 'ma60Pos': _r(ma_pos[60]),
                'ma120Pos': _r(ma_pos[120]),
                'ma5Slope': _r(ma_slope[5]), 'ma10Slope': _r(ma_slope[10]),
                'ma20Slope': _r(ma_slope[20]), 'ma60Slope': _r(ma_slope[60]),
                'ma120Slope': _r(ma_slope[120]), 'maAlign': malign,
                'dayPatterns': ','.join(dnames) if dnames else None,
                'dayPatternMask': dmask,
                'dayCategories': ','.join(dcats) if dcats else None,
                'dayShape': dshape[j], 'pos120': _r(dpos[j]),
                'channelType': dchan[j],
                'marketTemp': None, 'marketRegime': None,
                'sectorPct': _r(_pct(float(hy_close[i]), float(prev_hy[i]))),
                'sectorRet5': _r(_pct(float(hy_close[i]), float(hy_close[i - 5]))
                                 if i >= 5 else None),
                'sectorRet20': _r(_pct(float(hy_close[i]), float(hy_close[i - 20]))
                                  if i >= 20 else None),
                'sectorHeat': None, 'sectorUpRatio': None, 'sectorLimitUpCnt': None,
                'conceptTags': None, 'conceptHeat': None,
                'benchPct': _r(_pct(float(bench_close[i]), float(prev_bench[i]))),
                'isLimitUp': int(bool(ind_d['is_limit_up'][i])),
                'touchedLimit': int(bool(pc_raw > 0
                                         and float(h_raw[j])
                                         >= round(pc_raw * (1 + lmt), 2) - 1e-6
                                         and not ind_d['is_limit_up'][i])),
                'nextOpen': _r(o1[j]), 'nextHigh': _r(float(hi_am[j]) / float(f[i1])),
                'nextClose': _r(c1[j]),
                'retOpen': _r(float(ret_open[j]) * 100),
                'retHigh': _r(float(ret_high_am[j]) * 100),
                'retClose': _r(float(ret_close[j]) * 100),
                'limitTouch': int(bool(limit_touch[j])),
                'hit3': int(bool(hit3[j])),
                'stratRet': _r(float(strat_ret[j]) * 100),
                'createdAt': created,
            }
            tf_align, tf_score, tf_cov, tf_qual = tfp.align_summary(tf_snap.get(d) or {})
            row['tfAlign'] = tf_align
            row['tfAlignScore'] = tf_score
            row['tfCoverage'] = tf_cov
            row['tfQuality'] = tf_qual
            for p in tfp.PERIODS:
                srow = (tf_snap.get(d) or {}).get(p)
                row[f'tf{p}Pattern'] = srow['primaryPattern'] if srow else None
                row[f'tf{p}Mask'] = _ri(srow['patternMask']) if srow else 0

            if cur is not None:
                cur.execute(store.TRADE_SQL, tuple(row[c] for c in store.TRADE_COLS))
                tid = cur.lastrowid
                for p in tfp.PERIODS:
                    srow = (tf_snap.get(d) or {}).get(p)
                    if not srow:
                        continue
                    tf_buf.append((
                        tid, rid, p, code, d, srow['asOf'], srow['lastBarTime'],
                        srow['barCount'], srow['barsToday'], srow['closeVsMa5Pct'],
                        srow['closeVsMa10Pct'], srow['closeVsMa20Pct'],
                        srow['closeVsMa60Pct'], srow['ma5SlopePct'], srow['maAlign'],
                        srow['posInRange20'], srow['posInRange60'], srow['rangeAmp20Pct'],
                        srow['volRatio20'], srow['atrPct14'], srow['rsi14'],
                        srow['macdHistPct'], srow['ret1Pct'], srow['ret5Pct'],
                        srow['trendSlopePct'], srow['trendR2'],
                        ','.join(srow['patterns']) if srow['patterns'] else None,
                        srow['patternMask'], srow['primaryPattern'], srow['patternBias'],
                        srow['biasScore'], store.ENGINE_VERSION, srow['qualityFlags'],
                        created))

            n_trades += 1
            dates_seen.add(d)
            if n_trades % FLUSH_TRADES == 0 and conn is not None:
                if tf_buf:
                    cur.executemany(TF_SQL, tf_buf)
                    n_tf += len(tf_buf)
                    tf_buf.clear()
                conn.commit()

        # ---- 分档聚合（在 valid 掩码上）
        to_arr = np.array([(cum_vol.get(int(d)) or float('nan')) / (fsw * 100.0)
                           if fsw else float('nan') for d in cand])
        vr_arr = np.array([(cum_vol.get(int(d)) or float('nan')) /
                           (_mean5(cv_seq, day_pos[int(d)]) if day_pos.get(int(d)) is not None
                            else float('nan')) for d in cand])
        pos_arr = np.array([(float(v) if v is not None else float('nan')) for v in dpos])
        amt_arr = np.array([(cum_amt.get(int(d)) or float('nan')) / 1e4 for d in cand])
        # 流通市值逐日计算：流通股本(万股) × 当日 14:30 原始价(元) ÷ 1e4 = 亿元
        mcap_arr = np.array([float(fsw) * float(entry_am[k]) / 1e4 if fsw
                             else float('nan') for k in range(n)])
        atr_arr = np.asarray(ind_d['atr14'][ii], dtype=np.float64) / np.where(
            entry_am > 0, entry_am / f[ii], np.nan) * 100
        score_arr = np.array([tfp.align_summary(tf_snap.get(int(d)) or {})[1]
                              for d in cand], dtype=np.float64)
        aggs['turnover'].add(bucket_index(to_arr, EDGES_EXTRA['turnover']), valid,
                             ret_open, ret_high_am, ret_close, limit_touch, strat_ret)
        aggs['vol_ratio_intraday'].add(
            bucket_index(vr_arr, EDGES_EXTRA['vol_ratio_intraday']), valid,
            ret_open, ret_high_am, ret_close, limit_touch, strat_ret)
        aggs['pos120'].add(bucket_index(pos_arr, EDGES_EXTRA['pos120']), valid,
                           ret_open, ret_high_am, ret_close, limit_touch, strat_ret)
        aggs['tf_align_score'].add(
            bucket_index(score_arr, EDGES_EXTRA['tf_align_score']), valid,
            ret_open, ret_high_am, ret_close, limit_touch, strat_ret)
        aggs['atr_pct'].add(bucket_index(atr_arr, EDGES_EXTRA['atr_pct']), valid,
                            ret_open, ret_high_am, ret_close, limit_touch, strat_ret)
        aggs['amount_wan'].add(bucket_index(amt_arr, EDGES_EXTRA['amount_wan']), valid,
                               ret_open, ret_high_am, ret_close, limit_touch, strat_ret)
        aggs['float_mcap_yi'].add(
            bucket_index(mcap_arr, EDGES_EXTRA['float_mcap_yi']), valid,
            ret_open, ret_high_am, ret_close, limit_touch, strat_ret)

        aggs['year'].add(np.array([str(d // 10000) for d in cand], dtype=object), valid,
                         ret_open, ret_high_am, ret_close, limit_touch, strat_ret)
        aggs['board'].add(np.full(n, board_name, dtype=object), valid,
                          ret_open, ret_high_am, ret_close, limit_touch, strat_ret)
        aggs['hy'].add(np.full(n, (hy_map.get(code) or {}).get('hy_name', ''), dtype=object),
                       valid, ret_open, ret_high_am, ret_close, limit_touch, strat_ret)
        aggs['day_shape'].add(np.array(dshape, dtype=object), valid, ret_open,
                              ret_high_am, ret_close, limit_touch, strat_ret)
        aggs['ma_align'].add(
            np.array([tfp._align(ma5, ma10, ma20, ma60, int(i)) for i in ii],
                     dtype=object), valid, ret_open, ret_high_am, ret_close,
            limit_touch, strat_ret)
        aggs['tf_align'].add(
            np.array([tfp.align_summary(tf_snap.get(int(d)) or {})[0] for d in cand],
                     dtype=object), valid, ret_open, ret_high_am, ret_close,
            limit_touch, strat_ret)
        for p in tfp.PERIODS:
            aggs['tf_primary'].add(prim_arr[p], valid, ret_open, ret_high_am,
                                   ret_close, limit_touch, strat_ret)
            for t, pid in enumerate(intra_ids):
                pat_aggs[p].add(f'{pid}@{p}', valid & hit_mat[p][t], ret_open,
                                ret_high_am, ret_close, limit_touch, strat_ret)

        if n_done % 200 == 0:
            el = time.time() - t_all
            print(f'  ... {n_done}/{len(codes)} 只  有效 {n_trades} 笔  '
                  f'用时 {el:.0f}s', flush=True)

    if conn is not None:
        if tf_buf:
            cur.executemany(TF_SQL, tf_buf)
            n_tf += len(tf_buf)
            tf_buf.clear()
        conn.commit()

    print(f'[done] 无分钟数据 {n_no_minute} 只；有效样本 {n_trades} 笔；'
          f'bt_trade_tf {n_tf} 行；交易日 {len(dates_seen)} 个；'
          f'用时 {time.time() - t_all:.0f}s', flush=True)
    if n_trades != EXPECTED_TRADES and not args.max_stocks and not args.codes_file:
        print(f'[warn] 有效样本 {n_trades} ≠ 期望 {EXPECTED_TRADES}（分钟口径对照）')

    os.makedirs(args.out_dir, exist_ok=True)
    for p in tfp.PERIODS:
        write_csv(os.path.join(args.out_dir, f'bucket_tf{p}.csv'), pat_aggs[p].rows())
    for k, agg in aggs.items():
        write_csv(os.path.join(args.out_dir, f'bucket_{k}.csv'), agg.rows())
    overall_rows = overall.rows()
    if overall_rows:
        write_csv(os.path.join(args.out_dir, 'bucket_overall.csv'), overall_rows)

    summary = {
        'runKey': RUN_TF, 'runId': rid, 'trades': n_trades,
        'expectedTrades': EXPECTED_TRADES, 'tfRows': n_tf,
        'snapshotDate': snap_date, 'universe': len(codes),
        'dates': [int_to_ymd(min(dates_seen)) if dates_seen else None,
                  int_to_ymd(max(dates_seen)) if dates_seen else None],
        'nDates': len(dates_seen),
        'noMinuteStocks': n_no_minute,
        'entryTime': ENTRY_HHMM, 'asOf': ENTRY_HHMM,
        'overall': overall_rows[0] if overall_rows else {},
        'caveats': store.GLOBAL_CAVEATS,
    }
    with open(os.path.join(args.out_dir, 'summary.json'), 'w', encoding='utf-8') as fp:
        json.dump(summary, fp, ensure_ascii=False, indent=2)
    print(f'[out] {args.out_dir}')
    if conn is not None:
        conn.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
