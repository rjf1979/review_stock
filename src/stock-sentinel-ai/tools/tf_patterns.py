# -*- coding: utf-8 -*-
"""多周期（5/15/30/60 分钟）K 线聚合 + 形态快照。

设计源：``docs/2026-09-21-回测结果入库表结构与字段字典.md`` §2 / §5。

口径要点
--------
1. 通达信 1 分钟线时间戳 = 该分钟**结束**时刻（``1430`` 代表 14:29:00–14:30:00）。
   聚合按「结束时刻归桶」，已实测：``sh600000`` 1 分钟聚 5 分钟与原生 ``.lc5``
   **3360/3360 根逐根一致**（OHLC + 成交量零差异）。15/30/60 分钟沿用同一规则。
2. 决策时刻固定 ``asOf=1430``：**只使用 endTime <= asOf 的已收盘 bar**。
   60 分钟周期在 14:30 的最后一根已完成 bar 天然是 14:00（周期决定，非数据缺失）。
3. 形态复用 ``tools/patterns`` 注册表，不新造口径；分钟级把「日」窗口换算成「根」窗口：

   * A 类（原样复用）：纯价量/均线/量能逻辑，与周期无关，窗口本来就是「根」；
   * B 类（需放大窗口）：日内根数不够成形（W 底/头肩底/平台…），窗口按
     ``base_window * barsPerDay / SCALE_DIVISOR`` 放大（SCALE_DIVISOR=6，
     即 30 日窗口 → 5 个交易日的根数，与设计文档示例一致）；
   * C 类（不生成）：依赖涨停判定或全市场横截面排名的形态，在分钟序列上语义失效，
     直接跳过，不写伪造字段。
4. 所有形态函数只依赖 ``bar <= i`` 的数据，因此「在完整序列上算指标、取第 i 根」
   不存在未来函数；B 类窗口跨日属于设计意图（放大的窗口本身就要跨日）。

用法::

    python tools/tf_patterns.py --selftest          # 聚合校验 + 形态命中回归
    python tools/tf_patterns.py --dump-defs out.csv # 导出 bt_pattern_def 种子
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import patterns as patterns_pkg                      # noqa: E402
from indicators import compute_indicators, sma        # noqa: E402

PERIODS = (5, 15, 30, 60)
BARS_PER_DAY = {5: 48, 15: 16, 30: 8, 60: 4}
MASK_BITS = 63

# 与 ``kdata.BAR_DT`` 完全一致的结构化 dtype：``indicators.compute_indicators``
# 只接受结构化数组，而 ``tdx_minute.load_minute`` / ``aggregate_minute`` 返回 dict，
# 因此这里做一次显式转换（turnover 分钟线上无数据，固定 NaN）。
BAR_DT = np.dtype([('date', '<i4'),
                   ('open', '<f8'), ('high', '<f8'), ('low', '<f8'), ('close', '<f8'),
                   ('volume', '<f8'),     # 股
                   ('amount', '<f8'),     # 元
                   ('turnover', '<f8')])  # 换手率 %，分钟线无此字段

# 「日」窗口 → 「根」窗口的换算分母：30 日窗口在 5/15/30/60 分钟上分别放大到
# 240/80/40/20 根（≈5 个交易日），与设计文档 §5.2 的示例一致。
SCALE_DIVISOR = 6.0

# C 类：分钟序列上语义失效，不生成（不写伪造字段）
C_CLASS = (
    'limit_pullback',              # 依赖「近 N 日有涨停」，单根分钟线不可能 10%
    'sqxm_limit_up_shakeout',      # 依赖昨日涨停
    'sqxm_uptrend_limit_down',     # 依赖跌停
    'sqxm_rps_breakout',           # 依赖全市场横截面分位
)

# B 类：需要跨日放大的窗口（值 = 日线默认窗口），按周期换算成根数
B_CLASS_WINDOW = {
    'double_bottom': 30, 'rising_w_bottom': 30, 'arc_bottom': 40,
    'head_shoulder_bottom': 45, 'second_test': 30, 'platform_breakout': 20,
    'box_breakout': 25, 'ascending_triangle': 30,
}

# 形态方向：注册表里除「上升趋势放量跌停」（错杀观察）外均为看多形态
NEUTRAL_IDS = ('sqxm_limit_up_shakeout', 'sqxm_uptrend_limit_down')

# 主形态优先级：数字越小越优先（同类内按注册表顺序）
CATEGORY_PRIORITY = {
    '突破爆发类': 1, '短线强势启动': 2, '底部反转类': 3,
    '均线启动类': 4, '量价共振类': 5,
}


# ------------------------------------------------------------------ 时间口径
def hhmm_to_min(a) -> np.ndarray:
    a = np.asarray(a, dtype=np.int64)
    return (a // 100) * 60 + (a % 100)


def min_to_hhmm(m) -> np.ndarray:
    m = np.asarray(m, dtype=np.int64)
    return (m // 60) * 100 + (m % 60)


def trading_seq(hhmm) -> np.ndarray:
    """HHMM → 当日交易分钟序号 1..240（上午 09:31–11:30 = 1..120，下午 13:01–15:00 = 121..240）。

    非法/非交易时段返回 0，调用方应丢弃。
    """
    m = hhmm_to_min(hhmm)
    am = (m > 570) & (m <= 690)
    pm = (m > 780) & (m <= 900)
    out = np.zeros(len(m), dtype=np.int64)
    out[am] = m[am] - 570
    out[pm] = m[pm] - 780 + 120
    return out


def bucket_index(seq: np.ndarray, period: int) -> np.ndarray:
    return (np.asarray(seq, dtype=np.int64) + period - 1) // period


def bucket_end_hhmm(period: int) -> np.ndarray:
    bseq = np.arange(1, 240 // period + 1, dtype=np.int64) * period
    m = np.where(bseq <= 120, bseq + 570, bseq - 120 + 780)
    return min_to_hhmm(m)


def aggregate_minute(m: dict, period: int) -> dict:
    """1 分钟 bars → 目标周期 bars（结束时刻归桶，不跨日拼接）。"""
    if period == 1:
        return {k: m[k] for k in ('date', 'time', 'open', 'high', 'low',
                                  'close', 'amount', 'volume')}
    seq = trading_seq(m['time'])
    keep = seq > 0
    if not keep.any():
        return {k: np.zeros(0) for k in ('date', 'time', 'open', 'high', 'low',
                                         'close', 'amount', 'volume')}
    date = np.asarray(m['date'], dtype=np.int64)[keep]
    bkt = bucket_index(seq[keep], period)
    key = date * 1000 + bkt                      # bars 已按 (date,time) 升序
    _, starts = np.unique(key, return_index=True)
    starts = np.asarray(sorted(int(s) for s in starts), dtype=np.int64)
    o = np.asarray(m['open'], dtype=np.float64)[keep]
    h = np.asarray(m['high'], dtype=np.float64)[keep]
    l = np.asarray(m['low'], dtype=np.float64)[keep]
    c = np.asarray(m['close'], dtype=np.float64)[keep]
    amt = np.asarray(m['amount'], dtype=np.float64)[keep]
    vol = np.asarray(m['volume'], dtype=np.float64)[keep]
    ends = np.append(starts[1:] - 1, len(key) - 1)
    end_time = bucket_end_hhmm(period)[bkt[starts] - 1]
    return {
        'date': date[starts],
        'time': end_time,
        'open': o[starts],
        'high': np.maximum.reduceat(h, starts),
        'low': np.minimum.reduceat(l, starts),
        'close': c[ends],
        'amount': np.add.reduceat(amt, starts),
        'volume': np.add.reduceat(vol, starts),
    }


# ------------------------------------------------------------------ 形态适配
def to_bar_dt(bars: dict) -> np.ndarray:
    """分钟 dict → ``BAR_DT`` 结构化数组（供 ``compute_indicators`` 使用）。"""
    n = len(bars['date'])
    out = np.zeros(n, dtype=BAR_DT)
    if not n:
        return out
    out['date'] = np.asarray(bars['date'], dtype=np.int64)
    for f in ('open', 'high', 'low', 'close', 'amount', 'volume'):
        out[f] = np.asarray(bars[f], dtype=np.float64)
    out['turnover'] = np.nan
    return out


def intraday_ids() -> list[str]:
    """分钟层适用的形态 ID（注册表 − C 类），保持注册表顺序。"""
    return [pid for pid in patterns_pkg.ids() if pid not in C_CLASS]


def period_params(period: int) -> dict:
    """B 类形态在该周期的窗口参数覆盖；A 类不动。"""
    bpd = BARS_PER_DAY[period]
    out: dict[str, dict] = {}
    for pid, win in B_CLASS_WINDOW.items():
        out[pid] = {'window': max(6, int(round(win * bpd / SCALE_DIVISOR)))}
    # 海龟突破的 1 亿成交额是「日」量级阈值，分钟 bar 按周期比例缩放，
    # 否则在分钟序列上恒为 False（静默失效）。
    out['sqxm_turtle_trade'] = {'min_amount': 1.0e8 * period / 240.0}
    return out


def period_warmup(period: int) -> int:
    """该周期「全部形态都有足够历史」所需的最小根数。"""
    bpd = BARS_PER_DAY[period]
    need = max(int(round(w * bpd / SCALE_DIVISOR)) for w in B_CLASS_WINDOW.values())
    return max(60, need)          # 60 = ma60 / vma60 的下限


def pattern_bit_index() -> dict[str, int]:
    return {pid: i for i, pid in enumerate(intraday_ids())}


def detect_period(ind: dict, period: int, ids: list[str] | None = None) -> dict[str, np.ndarray]:
    """在某个周期的指标字典上跑全部适用形态。"""
    ids = ids or intraday_ids()
    pp = period_params(period)
    out = {}
    for pid in ids:
        out[pid] = patterns_pkg.detect(pid, ind, pp.get(pid))
    return out


def _mask_of(hit: dict[str, np.ndarray], i: int, bits: dict[str, int]) -> tuple[int, list[str]]:
    mask = 0
    names: list[str] = []
    for pid, arr in hit.items():
        if bool(arr[i]):
            names.append(pid)
            mask |= 1 << bits[pid]
    return mask, names


def _primary(names: list[str]) -> str | None:
    if not names:
        return None
    def key(pid: str):
        meta = patterns_pkg.get(pid)
        pri = CATEGORY_PRIORITY.get(meta['category'], 9)
        return (pri, patterns_pkg.ids().index(pid))
    return sorted(names, key=key)[0]


def _align(ma5, ma10, ma20, ma60, i: int) -> str:
    v5, v10, v20, v60 = ma5[i], ma10[i], ma20[i], ma60[i]
    vals = [v5, v10, v20, v60]
    if any(not np.isfinite(v) or v <= 0 for v in vals):
        return 'na'
    if v5 > v10 > v20 > v60:
        return 'bull_align'
    if v5 < v10 < v20 < v60:
        return 'bear_align'
    if (max(vals) - min(vals)) / (sum(vals) / 4.0) < 0.01:
        return 'converge'
    return 'mixed'


def _linreg(x: np.ndarray, y: np.ndarray) -> tuple[float, float]:
    xm = x - x.mean()
    denom = float((xm ** 2).sum())
    if denom <= 0:
        return float('nan'), float('nan')
    slope = float((xm * (y - y.mean())).sum() / denom)
    yhat = y.mean() + slope * xm
    ss_tot = float(((y - y.mean()) ** 2).sum())
    r2 = float(1 - ((y - yhat) ** 2).sum() / ss_tot) if ss_tot > 0 else float('nan')
    return slope, r2


def snapshot_at(ind: dict, bars: dict, period: int, ymd: int,
                as_of: int = 1430, ids: list[str] | None = None,
                bits: dict[str, int] | None = None,
                hit: dict[str, np.ndarray] | None = None) -> dict | None:
    """取某交易日 asOf 时刻的多周期快照（只用已收盘 bar）。

    ``hit`` 可传入同一周期、同一指标序列上预计算好的形态命中数组（
    ``detect_period`` 的结果）。批量取多个交易日时**必须**传入，否则每个
    交易日都会把 27 条形态在整个序列上重算一遍（69 日 × 4 周期 = 7452 次）。
    """
    ids = ids or intraday_ids()
    bits = bits or pattern_bit_index()
    date = np.asarray(bars['date'], dtype=np.int64)
    time = np.asarray(bars['time'], dtype=np.int64)
    pos = np.nonzero((date == ymd) & (time <= as_of))[0]
    if not len(pos):
        return None
    i = int(pos[-1])
    bars_today = int(((date == ymd)).sum())
    bar_count = i + 1

    c = ind['close']
    close = float(c[i])
    if not np.isfinite(close) or close <= 0:
        return None
    v = np.asarray(ind['volume'], dtype=np.float64)
    h = np.asarray(ind['high'], dtype=np.float64)
    l = np.asarray(ind['low'], dtype=np.float64)
    if hit is None:
        hit = detect_period(ind, period, ids)
    mask, names = _mask_of(hit, i, bits)

    def _dev(ma) -> float:
        val = float(np.asarray(ma, dtype=np.float64)[i])
        return round((close / val - 1) * 100, 4) if np.isfinite(val) and val > 0 else None

    ma5 = np.asarray(ind['ma5'], dtype=np.float64)
    ma10 = np.asarray(ind['ma10'], dtype=np.float64)
    ma20 = np.asarray(ind['ma20'], dtype=np.float64)
    ma60 = np.asarray(ind['ma60'], dtype=np.float64)
    slope5 = None
    if i >= 5 and np.isfinite(ma5[i]) and np.isfinite(ma5[i - 5]) and ma5[i - 5] > 0:
        slope5 = round((ma5[i] / ma5[i - 5] - 1) * 100, 4)

    def _pos(n: int) -> float | None:
        if i + 1 < n:
            return None
        hh = float(h[i - n + 1:i + 1].max())
        ll = float(l[i - n + 1:i + 1].min())
        return round((close - ll) / (hh - ll), 4) if hh > ll else None

    def _range_amp(n: int) -> float | None:
        if i + 1 < n:
            return None
        hh = float(h[i - n + 1:i + 1].max())
        ll = float(l[i - n + 1:i + 1].min())
        return round((hh / ll - 1) * 100, 4) if ll > 0 else None

    vol_ratio20 = None
    if i >= 20:
        ref = float(v[i - 20:i].mean())
        if ref > 0:
            vol_ratio20 = round(float(v[i]) / ref, 4)

    def _ret(n: int) -> float | None:
        if i < n or not np.isfinite(c[i - n]) or c[i - n] <= 0:
            return None
        return round((close / float(c[i - n]) - 1) * 100, 4)

    atr14 = float(np.asarray(ind['atr14'], dtype=np.float64)[i])
    hist = float(np.asarray(ind['hist'], dtype=np.float64)[i])
    rsi14 = float(np.asarray(ind['rsi14'], dtype=np.float64)[i])
    slope, r2 = (float('nan'), float('nan'))
    if i >= 19:
        slope, r2 = _linreg(np.arange(20, dtype=np.float64), c[i - 19:i + 1])

    quality: list[str] = []
    if bar_count < period_warmup(period):
        quality.append('warmup')
    if bars_today < BARS_PER_DAY[period]:
        quality.append('gap')
    bias_score = sum(1 for n in names if n not in NEUTRAL_IDS) - \
        sum(1 for n in names if n in NEUTRAL_IDS)

    return {
        'period': period,
        'asOf': int(as_of),
        'lastBarTime': int(time[i]),
        'barCount': bar_count,
        'barsToday': bars_today,
        'closeVsMa5Pct': _dev(ma5),
        'closeVsMa10Pct': _dev(ma10),
        'closeVsMa20Pct': _dev(ma20),
        'closeVsMa60Pct': _dev(ma60),
        'ma5SlopePct': slope5,
        'maAlign': _align(ma5, ma10, ma20, ma60, i),
        'posInRange20': _pos(20),
        'posInRange60': _pos(60),
        'rangeAmp20Pct': _range_amp(20),
        'volRatio20': vol_ratio20,
        'atrPct14': round(atr14 / close * 100, 4) if np.isfinite(atr14) else None,
        'rsi14': round(rsi14, 4) if np.isfinite(rsi14) else None,
        'macdHistPct': round(hist / close * 100, 4) if np.isfinite(hist) else None,
        'ret1Pct': _ret(1),
        'ret5Pct': _ret(5),
        'trendSlopePct': (round(slope / float(c[i - 19:i + 1].mean()) * 100, 4)
                          if np.isfinite(slope) and c[i - 19:i + 1].mean() > 0 else None),
        'trendR2': round(r2, 4) if np.isfinite(r2) else None,
        'patterns': names,
        'patternMask': mask,
        'primaryPattern': _primary(names),
        'patternBias': 'bull' if bias_score > 0 else ('bear' if bias_score < 0 else 'neutral'),
        'biasScore': int(bias_score),
        'qualityFlags': '+'.join(quality) if quality else 'ok',
        '_index': i,
    }


def tf_snapshot(m1: dict, code: str, name: str, dates, as_of: int = 1430,
                periods=PERIODS) -> dict:
    """一批交易日 × 4 周期的多周期快照 → {YYYYMMDD: {period: row}}。"""
    out: dict[int, dict] = {int(d): {} for d in dates}
    if not m1 or not len(m1.get('date', [])):
        return out
    ids = intraday_ids()
    bits = pattern_bit_index()
    for period in periods:
        bars = aggregate_minute(m1, period)
        if not len(bars['date']):
            continue
        ind = compute_indicators(to_bar_dt(bars), code, name)
        # 形态命中在整个序列上只算一次（与具体交易日无关），再逐日取下标。
        hit = detect_period(ind, period, ids)
        for d in out:
            row = snapshot_at(ind, bars, period, d, as_of, ids, bits, hit)
            if row is not None:
                out[d][period] = row
    return out


def align_summary(rows: dict) -> tuple[str, int, int, str]:
    """4 周期快照 → (tfAlign, tfAlignScore, tfCoverage, tfQuality)。"""
    got = {p: r for p, r in rows.items() if r}
    if not got:
        return 'na', 0, 0, 'missing'
    bias = [r['patternBias'] for r in got.values()]
    score = int(sum(max(-2, min(2, r['biasScore'])) for r in got.values()))
    if all(b == 'bull' for b in bias):
        align = 'all_bull'
    elif all(b == 'bear' for b in bias):
        align = 'all_bear'
    elif 'bull' in bias and 'bear' in bias:
        align = 'mixed'
    else:
        align = 'partial'
    flags = {r['qualityFlags'] for r in got.values()}
    quality = 'ok' if flags == {'ok'} else ('warmup' if flags <= {'ok', 'warmup'}
                                            else '+'.join(sorted(flags)))
    return align, score, len(got), quality


# ------------------------------------------------------------------ 形态字典种子
def pattern_def_rows() -> list[dict]:
    """bt_pattern_def 的种子行：日线 31 条 + 分钟 27 条 × 4 周期。"""
    reg_order = patterns_pkg.ids()
    intraday = intraday_ids()
    rows: list[dict] = []
    for pid in reg_order:
        meta = patterns_pkg.get(pid)
        if pid in C_CLASS:
            scope = 'day'
        elif pid in B_CLASS_WINDOW:
            scope = 'both'
        else:
            scope = 'both'
        rows.append({
            'patternId': pid,
            'nameCn': meta['name'],
            'scope': scope,
            'periods': 'day',
            'sourceModule': 'registry:' + meta['module'].split('.')[-1],
            'category': meta['category'],
            'direction': 'neutral' if pid in NEUTRAL_IDS else 'bull',
            'weight': 1,
            'priority': CATEGORY_PRIORITY.get(meta['category'], 9) * 100 + reg_order.index(pid),
            'bitIndex': reg_order.index(pid),
            'ruleExpr': meta['desc'],
            'ruleParams': json.dumps(meta['params'], ensure_ascii=False),
            'basisNote': '注册表默认参数；日线窗口按「日」计',
            'version': 'registry-2026-09-18',
        })
    for pid in intraday:
        meta = patterns_pkg.get(pid)
        if pid in C_CLASS:
            continue
        for period in PERIODS:
            pp = period_params(period).get(pid)
            params = dict(meta['params'])
            params.update(pp or {})
            note = ('原样复用注册表（窗口按根计，与周期无关）'
                    if pid not in B_CLASS_WINDOW else
                    f'B 类放大窗口：日线 {B_CLASS_WINDOW[pid]} → {params["window"]} 根'
                    f'（barsPerDay {BARS_PER_DAY[period]} / {SCALE_DIVISOR:g}）')
            if pid == 'sqxm_turtle_trade':
                note = (f'成交额阈值按周期缩放：1 亿 × {period}/240 = '
                        f'{params["min_amount"]:,.0f} 元/根')
            rows.append({
                'patternId': f'{pid}@{period}',
                'nameCn': f'{meta["name"]}（{period}分钟）',
                'scope': 'intraday',
                'periods': str(period),
                'sourceModule': 'registry:' + meta['module'].split('.')[-1],
                'category': meta['category'],
                'direction': 'neutral' if pid in NEUTRAL_IDS else 'bull',
                'weight': 1,
                'priority': CATEGORY_PRIORITY.get(meta['category'], 9) * 100 + intraday.index(pid),
                'bitIndex': intraday.index(pid),
                'ruleExpr': meta['desc'],
                'ruleParams': json.dumps(params, ensure_ascii=False),
                'basisNote': note,
                'version': f'registry-2026-09-18@{period}m',
            })
    return rows


# ------------------------------------------------------------------ 自检
def _selftest(sample_codes=('600000', '000001', '300750'), as_of=1430) -> int:
    from tdx_minute import load_minute
    from kdata import Market

    ok_all = True
    market = Market()
    report = {'aggregate': [], 'patterns': {}, 'warmup': {}, 'ids': len(intraday_ids())}

    for code in sample_codes:
        m1 = load_minute(code, 1)
        if not m1 or not len(m1['date']):
            print(f'[skip] {code} 无 1 分钟数据')
            continue
        m5_native = load_minute(code, 5)
        m5_agg = aggregate_minute(m1, 5)
        same = 0
        total = int(len(m5_native['date'])) if m5_native else 0
        mismatch = 0
        if total:
            key_n = {int(d) * 10000 + int(t): k for k, (d, t) in
                     enumerate(zip(m5_native['date'], m5_native['time']))}
            for k in range(len(m5_agg['date'])):
                key = int(m5_agg['date'][k]) * 10000 + int(m5_agg['time'][k])
                j = key_n.get(key)
                if j is None:
                    mismatch += 1
                    continue
                if (abs(m5_agg['open'][k] - m5_native['open'][j]) < 1e-4
                        and abs(m5_agg['high'][k] - m5_native['high'][j]) < 1e-4
                        and abs(m5_agg['low'][k] - m5_native['low'][j]) < 1e-4
                        and abs(m5_agg['close'][k] - m5_native['close'][j]) < 1e-4
                        and abs(m5_agg['volume'][k] - m5_native['volume'][j]) < 1e-3):
                    same += 1
                else:
                    mismatch += 1
        report['aggregate'].append({'code': code, 'native': total, 'agg': int(len(m5_agg['date'])),
                                    'matched': same, 'mismatch': mismatch})
        print(f'[agg] {code}: 原生 {total} 根 / 聚合 {len(m5_agg["date"])} 根 / 逐根一致 {same} / 不一致 {mismatch}')
        if total and (same != total or len(m5_agg['date']) != total):
            ok_all = False

        meta = market.meta(code)
        dates = np.unique(np.asarray(m1['date'], dtype=np.int64))
        snap = tf_snapshot(m1, code, meta.get('name', ''), dates[-3:], as_of)
        for d, rows in snap.items():
            for period, row in rows.items():
                key = f'{period}'
                report['patterns'].setdefault(key, {})
                for pid in row['patterns']:
                    report['patterns'][key][pid] = report['patterns'][key].get(pid, 0) + 1
                report['warmup'][key] = report['warmup'].get(key, 0) + \
                    (1 if row['qualityFlags'] != 'ok' else 0)
        last = sorted(snap)[-1]
        print(f'[tf] {code} {last}: ' + ' | '.join(
            f'{p}m lastBar={r["lastBarTime"]} bars={r["barCount"]} '
            f'prim={r["primaryPattern"]} flags={r["qualityFlags"]}'
            for p, r in sorted(snap[last].items())))

    print('[report] ' + json.dumps(report, ensure_ascii=False))
    return 0 if ok_all else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--selftest', action='store_true')
    ap.add_argument('--dump-defs', default='')
    ap.add_argument('--codes', nargs='*', default=None)
    args = ap.parse_args()
    if args.dump_defs:
        rows = pattern_def_rows()
        with open(args.dump_defs, 'w', encoding='utf-8') as f:
            json.dump(rows, f, ensure_ascii=False, indent=1)
        print(f'[out] {args.dump_defs} {len(rows)} 行')
        return 0
    if args.selftest:
        return _selftest(args.codes or ('600000', '000001', '300750'))
    ap.print_help()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
