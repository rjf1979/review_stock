# -*- coding: utf-8 -*-
"""25 形态专用回测：每个形态一套结构止损、分批止盈与跟踪退出。

信号在收盘确认，下一根开盘成交。日内同时触发止损和止盈时，采用保守的止损优先口径。

退出机制有两种模式：

* ``--exit-mode pattern``（默认）：按 ``tools/pattern_exits.py`` 中 25 个形态各自的
  关键位/失效位/形态高度、ATR 倍数、风险上限、分批止盈 R 值、目标规则、跟踪均线
  与最长持有日退出。
* ``--exit-mode uniform``：2026-09-18 之前的统一口径（结构位与 2×ATR 取较低、
  固定 1R 减半、趋势形态只跟踪、统一 40 日），用于与旧结果对照复现。

两种模式下显式传入的 ``risk_pct`` / ``risk_atr`` / ``first_r_multiple`` /
``first_exit_fraction`` / ``target_fraction`` / ``trail_ma`` / ``trail_pct`` /
``hold_days`` 都会覆盖形态自带参数。
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from indicators import compute_indicators  # noqa: E402
from kdata import Market, int_to_ymd, read_day_file  # noqa: E402
import patterns  # noqa: E402
import pattern_exits  # noqa: E402

DB_PATH = os.path.normpath(os.path.join(HERE, '..', 'data', 'kline-full.db'))
OUT_DIR = os.path.normpath(os.path.join(HERE, '..', 'data', 'backtest', 'xingtaidu'))
# 相对强度基准（沪深300 本地日线；通达信把指数也存在 sh/lday 下）。
# 只有配置里出现 rs_days 过滤时才加载，非过滤回测完全不受影响。
BENCH_FILE = os.path.normpath(os.path.join(
    HERE, '..', 'data', 'hsjday', 'sh', 'lday', 'sh000300.day'))

TREND = {'ma_bullish', 'pullback_ma20', 'ma_golden_start', 'macd_water_golden',
         'consecutive_yang', 'strong_sideways', 'limit_pullback', 'n_shape'}
BREAKOUT = {'trendline_breakout', 'volume_breakout', 'shrink_stabilize',
            'double_bottom', 'arc_bottom', 'rising_w_bottom', 'head_shoulder_bottom',
            'platform_breakout', 'box_breakout', 'ascending_triangle', 'gap_breakout'}
REVERSAL = {'dry_price_bottom', 'fake_break_pack', 'yang_engulf', 'long_lower_shadow',
            'rsi_low_turn', 'second_test'}

DEFAULT = {
    'patterns': patterns.ids(), 'start': '2000-01-01', 'end': '2099-12-31',
    'exit_mode': 'pattern',
    # None = 使用 pattern_exits.py 中该形态自己的参数；显式赋值则覆盖全部形态
    'hold_days': None, 'risk_pct': None, 'risk_atr': None,
    'first_r_multiple': None, 'first_exit_fraction': None,
    'target_fraction': None, 'trail_ma': None, 'trail_pct': None,
    'commission': 0.00025, 'min_commission': 5.0, 'stamp_tax': 0.0005,
    'slippage': 0.001, 'position': 100000.0, 'min_list_days': 250,
    'max_gap_days': 5, 'max_bar_move': 21.0, 'skip_limit_up_entry': True,
    'adj': 'qfq', 'onset_only': True, 'workers': 1,
}

# 旧统一口径（--exit-mode uniform），保留用于与历史结果逐笔复现对照
UNIFORM = {
    'hold_days': 40, 'risk_pct': 8.0, 'risk_atr': 2.0,
    'first_r_multiple': 1.0, 'first_exit_fraction': 0.50,
    'target_fraction': 1.0, 'trail_ma': 10, 'trail_pct': 0.08,
}


def load_factors(db=DB_PATH):
    if not os.path.exists(db):
        return {}
    conn = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
    out = defaultdict(list)
    for code, date, factor in conn.execute('SELECT code, ex_date, factor FROM adj_factors'):
        out[code].append((date, factor))
    conn.close()
    return dict(out)


def load_names(db=DB_PATH):
    if not os.path.exists(db):
        return {}
    conn = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
    try:
        return dict(conn.execute('SELECT code, name FROM stocks').fetchall())
    except sqlite3.Error:
        return {}
    finally:
        conn.close()


def load_benchmark(path=BENCH_FILE):
    """加载相对强度基准（沪深300）本地日线，返回 (date_int_array, close_array)。"""
    if not os.path.exists(path):
        return None
    bars = read_day_file(path)
    if not len(bars):
        return None
    return np.asarray(bars['date'], dtype=np.int64), np.asarray(bars['close'], dtype=np.float64)


def _align_bench(bench, dates):
    """把基准收盘价对齐到个股 K 线日期；基准当日缺失时沿用最近一个交易日。"""
    bd, bc = bench
    pos = np.searchsorted(bd, np.asarray(dates, dtype=np.int64), side='right') - 1
    out = np.full(len(dates), np.nan)
    ok = pos >= 0
    out[ok] = bc[pos[ok]]
    return out


def _category(pid):
    if pid in TREND:
        return 'trend'
    if pid in BREAKOUT:
        return 'breakout'
    if pid in REVERSAL:
        return 'reversal'
    return 'trend'


def _range_level(ind, i, pid):
    """返回 (关键位, 结构止损参考, 形态高度)，所有窗口均不含入场日。"""
    h, l, c = ind['high'], ind['low'], ind['close']
    prior = max(0, i - 30)
    if pid in {'platform_breakout', 'strong_sideways'}:
        lo, hi = l[max(0, i-20):i].min(), h[max(0, i-20):i].max()
        return hi, lo, hi - lo
    if pid in {'box_breakout', 'volume_breakout', 'gap_breakout', 'ascending_triangle'}:
        lo, hi = l[max(0, i-25):i].min(), h[max(0, i-25):i].max()
        return hi, lo, hi - lo
    if pid in {'double_bottom', 'rising_w_bottom', 'head_shoulder_bottom', 'second_test', 'arc_bottom'}:
        lo, hi = l[max(0, i-50):i].min(), h[max(0, i-50):i].max()
        neck = h[max(0, i-30):i].max()
        return neck, lo, neck - lo
    if pid == 'trendline_breakout':
        hi = h[max(0, i-40):i].max()
        lo = l[max(0, i-20):i].min()
        return hi, lo, hi - lo
    if pid == 'n_shape':
        lo, hi = l[max(0, i-30):i].min(), h[max(0, i-30):i].max()
        return hi, lo, hi - lo
    if pid in {'pullback_ma20', 'ma_bullish', 'ma_golden_start', 'macd_water_golden'}:
        key = ind['ma20'][i-1] if np.isfinite(ind['ma20'][i-1]) else c[i-1]
        return key, l[max(0, i-10):i].min(), key - l[max(0, i-10):i].min()
    if pid == 'limit_pullback':
        key, lo = c[i-1], l[max(0, i-15):i].min()
        return key, lo, key-lo
    key, lo = c[i-1], l[max(0, i-10):i].min()
    return key, lo, key-lo


def _plan_uniform(ind, signal_i, buy, pid, cfg):
    """2026-09-18 之前的统一口径（--exit-mode uniform）。"""
    key, structural, height = _range_level(ind, signal_i, pid)
    atr = ind['atr14'][signal_i-1] if signal_i > 0 else np.nan
    if not np.isfinite(atr):
        atr = buy * 0.03
    # 初始止损优先采用结构位；距离过宽时收紧到风险上限，避免一个错误结构吞掉整笔交易。
    structural_stop = min(structural, buy - cfg['risk_atr'] * atr)
    cap_stop = buy * (1 - cfg['risk_pct'] / 100)
    stop = max(structural_stop, cap_stop)
    if stop >= buy:
        stop = cap_stop
    risk = buy - stop
    target = key + max(height, risk) * cfg['target_fraction']
    first = buy + risk * cfg['first_r_multiple']
    # 趋势延续没有可靠固定目标：1R先兑现，余仓由均线/回撤跟踪。
    if _category(pid) == 'trend':
        target = np.inf
    return {'mode': 'uniform', 'stop': float(stop), 'risk': float(risk),
            'first_target': float(first), 'target': float(target),
            'key': float(key), 'structural': float(structural),
            'height': float(max(height, 0.0)),
            'partial_r': float(cfg['first_r_multiple']),
            'partial_frac': float(cfg['first_exit_fraction']),
            'trail_ma': int(cfg['trail_ma']), 'trail_pct': float(cfg['trail_pct']),
            'close_below_ma': None, 'max_hold': int(cfg['hold_days'])}


def _primitive(ind, i, node):
    """取形态退出用的结构原语，窗口右开、不含信号日。"""
    kind, n = node
    if kind == 'low':
        return float(ind['low'][max(0, i - n):i].min())
    if kind == 'high':
        return float(ind['high'][max(0, i - n):i].max())
    if kind == 'ma':
        v = ind[f'ma{int(n)}'][i - 1] if i > 0 else np.nan
        return float(v) if np.isfinite(v) else float(ind['close'][i - 1])
    if kind == 'close':
        return float(ind['close'][i - 1])
    if kind == 'open':
        return float(ind['open'][i - 1])
    raise ValueError(f'未知原语: {node}')


def resolve_exit(pid, cfg):
    """形态自带退出规则 + 显式覆盖。返回可直接用于计划的参数。"""
    sp = pattern_exits.spec(pid)
    if cfg.get('risk_pct') is not None:
        sp['risk_cap'] = float(cfg['risk_pct'])
    if cfg.get('risk_atr') is not None:
        sp['atr_mult'] = float(cfg['risk_atr'])
    r, frac = sp['partial']
    if cfg.get('first_r_multiple') is not None:
        r = float(cfg['first_r_multiple'])
    if cfg.get('first_exit_fraction') is not None:
        frac = float(cfg['first_exit_fraction'])
    sp['partial'] = (r, frac)
    if cfg.get('target_fraction') is not None:
        # 显式给出 target_fraction 时，统一改为「关键位 + f×形态高度」的测量目标
        sp['target'] = ('measured', float(cfg['target_fraction']))
    if cfg.get('no_target'):
        # 纯跟踪模式：不给固定目标封顶，全部交给 1R 分批 + 均线/回撤跟踪（默认关闭）
        sp['target'] = None
    if cfg.get('trail_ma') is not None:
        sp['trail_ma'] = int(cfg['trail_ma'])
    if cfg.get('trail_pct') is not None:
        sp['trail_pct'] = float(cfg['trail_pct'])
    if cfg.get('hold_days') is not None:
        sp['max_hold'] = int(cfg['hold_days'])
    return sp


def _plan_pattern(ind, signal_i, buy, pid, cfg):
    """按形态自己的退出规则生成计划。"""
    sp = cfg.get('_exit_cache', {}).get(pid) or resolve_exit(pid, cfg)
    key = _primitive(ind, signal_i, sp['key'])
    invalid = _primitive(ind, signal_i, sp['invalid'])
    if sp['height'] == 'struct':
        height = key - invalid
    else:
        n = sp['height'][1]
        height = float(ind['high'][max(0, signal_i - n):signal_i].max()
                       - ind['low'][max(0, signal_i - n):signal_i].min())
    atr = ind['atr14'][signal_i-1] if signal_i > 0 else np.nan
    if not np.isfinite(atr) or atr <= 0:
        atr = buy * 0.03
    structural = invalid * (1 - sp['stop_buf'])
    floor_stop = buy - sp['atr_mult'] * atr
    cap_stop = buy * (1 - sp['risk_cap'] / 100)
    ref = structural if sp.get('atr_mode') == 'structural' else min(structural, floor_stop)
    stop = max(ref, cap_stop)
    if stop >= buy:
        stop = cap_stop
    risk = buy - stop
    first = buy + risk * sp['partial'][0]
    tgt = sp['target']
    if tgt is None:
        target = np.inf
    elif tgt[0] == 'measured':
        target = key + max(height, 0.0) * tgt[1]
    else:
        target = _primitive(ind, signal_i, tgt[1])
    if np.isfinite(target) and target <= first:
        target = np.inf  # 目标近于 1R：直接交给 1R 与跟踪处理
    return {'mode': 'pattern', 'stop': float(stop), 'risk': float(risk),
            'first_target': float(first), 'target': float(target),
            'key': float(key), 'structural': float(structural),
            'height': float(max(height, 0.0)),
            'partial_r': float(sp['partial'][0]), 'partial_frac': float(sp['partial'][1]),
            'trail_ma': int(sp['trail_ma']), 'trail_pct': float(sp['trail_pct']),
            'close_below_ma': sp['close_below_ma'],
            'close_below_ma_buf': float(sp.get('close_below_ma_buf') or 0.0),
            'close_below_confirm': int(sp.get('close_below_confirm') or 1),
            'max_hold': int(sp['max_hold'])}


def close_below_triggered(ind, k, plan):
    """判断第 k 根是否满足「收盘跌破均线」离场（含缓冲与连续确认）。"""
    ma_n = plan.get('close_below_ma')
    if not ma_n:
        return False
    need = max(1, int(plan.get('close_below_confirm') or 1))
    buf = float(plan.get('close_below_ma_buf') or 0.0)
    c = ind['close']
    for m in range(k - need + 1, k + 1):
        if m < 1:
            return False
        ma_v = ind[f'ma{int(ma_n)}'][m - 1]
        if not np.isfinite(ma_v) or c[m] >= ma_v * (1 - buf):
            return False
    return True


def _plan(ind, signal_i, buy, pid, cfg):
    if cfg.get('exit_mode', 'pattern') == 'uniform':
        return _plan_uniform(ind, signal_i, buy, pid, cfg)
    return _plan_pattern(ind, signal_i, buy, pid, cfg)


def simulate_exit(ind, entry_i, buy, pid, cfg):
    """返回一笔含分批成交明细的交易；可直接被单元测试调用。"""
    plan = _plan(ind, entry_i - 1, buy, pid, cfg)
    c, h, l = ind['close'], ind['high'], ind['low']
    end = min(entry_i + int(plan['max_hold']), len(c)-1)
    remaining = 1.0
    realized = 0.0
    events = []
    peak = buy
    reason = '到期'
    final_price = c[end]
    final_i = end
    first_done = False
    for k in range(entry_i, end + 1):
        # 当天开盘跳空直接越过止损，按开盘价成交；否则按止损价成交。
        stop = plan['stop']
        if first_done:
            ma = ind[f"ma{int(plan['trail_ma'])}"][k-1] if k > 0 else np.nan
            if np.isfinite(ma):
                stop = max(stop, ma * (1 - plan['trail_pct']))
            stop = max(stop, buy)  # 第一段止盈后余仓至少保本（扣费前）
            peak = max(peak, h[k])
            stop = max(stop, peak * (1 - plan['trail_pct']))
        if l[k] <= stop:
            open_px = ind['open'][k]
            px = open_px if open_px < stop else stop
            realized += remaining * px
            events.append({'date': int(ind.get('date', np.array([0]))[k]) if 'date' in ind else k,
                           'fraction': remaining, 'price': float(px), 'reason': '止损/跟踪'})
            remaining = 0.0; final_price = px; final_i = k
            reason = '跟踪止损' if first_done else '结构止损'
            break
        if not first_done and h[k] >= plan['first_target']:
            fraction = float(plan['partial_frac'])
            px = plan['first_target']
            realized += fraction * px
            remaining -= fraction
            events.append({'date': k, 'fraction': fraction, 'price': float(px), 'reason': '1R分批止盈'})
            first_done = True
        if remaining and np.isfinite(plan['target']) and h[k] >= plan['target']:
            realized += remaining * plan['target']
            events.append({'date': k, 'fraction': remaining, 'price': plan['target'], 'reason': '测量目标止盈'})
            final_price = plan['target']; final_i = k; remaining = 0.0; reason = '测量目标止盈'
            break
        if remaining and close_below_triggered(ind, k, plan):
            realized += remaining * c[k]
            events.append({'date': k, 'fraction': remaining, 'price': float(c[k]),
                           'reason': f"收盘跌破MA{int(plan['close_below_ma'])}"})
            final_price = c[k]; final_i = k; remaining = 0.0
            reason = f"收盘跌破MA{int(plan['close_below_ma'])}"
            break
        if k == end and remaining:
            realized += remaining * c[k]
            events.append({'date': k, 'fraction': remaining, 'price': float(c[k]), 'reason': '到期'})
            final_price = c[k]
    avg = realized
    return {'sell_price': float(avg), 'sell_index': int(final_i), 'reason': reason,
            'events': events, 'plan': plan, 'partial': bool(first_done)}


def _work_one(code, cfg, factors, dates_index, names):
    mkt = _WORK_MARKET
    bars = mkt.load(code, cfg['adj'], factors)
    if len(bars) < cfg['min_list_days'] + 5:
        return []
    ind = compute_indicators(bars, code, names.get(code, ''))
    ind['date'] = bars['date']
    bench = cfg.get('_bench')
    if bench is not None:
        ind['bench_close'] = _align_bench(bench, bars['date'])
    n = len(bars); s_int = int(cfg['start'].replace('-', '')); e_int = int(cfg['end'].replace('-', ''))
    gi = np.array([dates_index.get(int(x), -1) for x in bars['date']])
    out = []
    for pid in cfg['patterns']:
        sig = patterns.detect(pid, ind, cfg.get('params', {}).get(pid))
        if cfg['onset_only']:
            sig = sig & ~np.r_[False, sig[:-1]]
        for i in np.flatnonzero(sig):
            j = i + 1
            if j >= n or bars['date'][j] < s_int or bars['date'][j] > e_int or i < cfg['min_list_days']:
                continue
            if gi[i] < 0 or gi[j] < 0 or gi[j] - gi[i] > cfg['max_gap_days']:
                continue
            if cfg['skip_limit_up_entry'] and ind['is_limit_up'][j]:
                continue
            buy = ind['open'][j] * (1 + cfg['slippage'])
            if not np.isfinite(buy) or abs(ind['pct'][i]) > cfg['max_bar_move']:
                continue
            result = simulate_exit(ind, j, buy, pid, cfg)
            sell = result['sell_price'] * (1 - cfg['slippage'])
            gross = sell / buy - 1
            buy_fee = max(cfg['position'] * cfg['commission'], cfg['min_commission']) / cfg['position']
            sell_fee = max(cfg['position'] * sell / buy * cfg['commission'], cfg['min_commission']) / cfg['position']
            cost = buy_fee + sell_fee + cfg['stamp_tax']
            out.append({'code': code, 'pattern': pid, 'signal_date': int_to_ymd(int(bars['date'][i])),
                        'buy_date': int_to_ymd(int(bars['date'][j])), 'sell_date': int_to_ymd(int(bars['date'][result['sell_index']])),
                        'buy_price': round(float(buy), 6), 'sell_price': round(float(sell), 6),
                        'hold_days': int(result['sell_index']-j), 'gross_pct': round(gross*100, 4),
                        'cost_pct': round(cost*100, 4), 'net_pct': round((gross-cost)*100, 4),
                        'reason': result['reason'], 'partial_exit': result['partial'],
                        'initial_stop': round(result['plan']['stop'], 6), 'first_target': round(result['plan']['first_target'], 6),
                        'measured_target': None if not np.isfinite(result['plan']['target']) else round(result['plan']['target'], 6),
                        'key_level': round(result['plan']['key'], 6), 'structure_low': round(result['plan']['structural'], 6),
                        'exit_mode': result['plan']['mode'], 'max_hold': int(result['plan']['max_hold']),
                        'events': result['events']})
    return out


_WORK_MARKET = None


def summarize(trades):
    if not trades:
        return {'total': 0}
    by = defaultdict(list)
    for t in trades:
        by[t['pattern']].append(t)
    def one(xs):
        vals = np.array([x['net_pct'] for x in xs]); wins = vals[vals > 0]; losses = vals[vals < 0]
        return {'n': len(xs), 'win_rate': round(float((vals > 0).mean()*100), 2),
                'avg_pct': round(float(vals.mean()), 4), 'median_pct': round(float(np.median(vals)), 4),
                'profit_factor': None if not len(losses) else round(float(wins.sum()/abs(losses.sum())), 4),
                'avg_hold_days': round(float(np.mean([x['hold_days'] for x in xs])), 2),
                'partial_rate': round(float(np.mean([x['partial_exit'] for x in xs])*100), 2)}
    return {'total': len(trades), 'by_pattern': {k: one(v) for k, v in sorted(by.items())}, **one(trades)}


def write_csv(trades, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fields = sorted({k for t in trades for k in t if k != 'events'})
    with open(path, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=fields); w.writeheader()
        for t in trades: w.writerow({k: t.get(k) for k in fields})


def run(cfg):
    global _WORK_MARKET
    _WORK_MARKET = Market(min_bars=250)
    names = load_names(); _WORK_MARKET.set_names(names); factors = load_factors()
    codes = _WORK_MARKET.codes()
    if cfg.get('codes'):
        wanted = set(cfg['codes'].split(',')); codes = [c for c in codes if c in wanted]
    elif cfg.get('limit'):
        codes = codes[:cfg['limit']]
    all_dates = sorted({int(d) for c in codes for d in _WORK_MARKET.raw(c)['date']})
    dates_index = {d: i for i, d in enumerate(all_dates)}
    cfg['_exit_cache'] = {pid: resolve_exit(pid, cfg) for pid in cfg['patterns']}
    need_bench = any(
        ('rs_days' in (v or {})) or ('bench_ma_days' in (v or {}))
        for v in (cfg.get('params') or {}).values()
    )
    cfg['_bench'] = load_benchmark() if need_bench else None
    if need_bench and cfg['_bench'] is None:
        print('警告：未找到沪深300基准文件，相对强度/大盘环境过滤将不生效', file=sys.stderr)
    trades = []
    for no, code in enumerate(codes, 1):
        try: trades.extend(_work_one(code, cfg, factors.get(code), dates_index, names))
        except Exception as exc: print(f'跳过 {code}: {type(exc).__name__}: {exc}', file=sys.stderr)
        if no % 500 == 0: print(f'已处理 {no}/{len(codes)}，交易 {len(trades)}')
    return trades, summarize(trades)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--patterns', default='all', help='all 或逗号分隔形态ID')
    p.add_argument('--codes'); p.add_argument('--limit', type=int, default=0)
    p.add_argument('--start'); p.add_argument('--end')
    p.add_argument('--hold', type=int, help='统一覆盖所有形态的最长持有日；不传则用形态自带值')
    p.add_argument('--exit-mode', choices=('pattern', 'uniform'), default=None,
                   help='pattern=每个形态自己的止盈止损（默认）；uniform=旧统一口径')
    p.add_argument('--workers', type=int, help='保留兼容参数；当前单进程确保结果可复核')
    p.add_argument('--list', action='store_true'); p.add_argument('--out', required=False)
    p.add_argument('--config', help='JSON 配置路径；显式按 UTF-8 读取')
    args = p.parse_args(argv)
    if args.list:
        for pid in patterns.ids(): print(pid, patterns.get(pid)['name'])
        return 0
    cfg = dict(DEFAULT)
    if args.config:
        with open(args.config, encoding='utf-8') as fh:
            cfg.update(json.load(fh))
    if args.exit_mode: cfg['exit_mode'] = args.exit_mode
    if cfg.get('exit_mode') == 'uniform':
        # uniform 模式下未显式给出的退出参数回落到旧统一口径
        for k, v in UNIFORM.items():
            if cfg.get(k) is None:
                cfg[k] = v
    if args.patterns != 'all': cfg['patterns'] = [x.strip() for x in args.patterns.split(',')]
    for pid in cfg['patterns']: patterns.get(pid)
    for key, val in [('start', args.start), ('end', args.end), ('hold_days', args.hold)]:
        if val is not None: cfg[key] = val
    if args.codes: cfg['codes'] = args.codes
    if args.limit: cfg['limit'] = args.limit
    trades, summary = run(cfg)
    prefix = args.out or 'xingtaidu_25_pattern_backtest'
    os.makedirs(OUT_DIR, exist_ok=True)
    write_csv(trades, os.path.join(OUT_DIR, prefix + '.csv'))
    with open(os.path.join(OUT_DIR, prefix + '.json'), 'w', encoding='utf-8') as f:
        json.dump({'config': {k: v for k, v in cfg.items() if not k.startswith('_')},
                   'summary': summary, 'exit_specs':
                   {pid: resolve_exit(pid, cfg) for pid in cfg['patterns']}
                   if cfg.get('exit_mode') != 'uniform' else None},
                  f, ensure_ascii=False, indent=2)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
