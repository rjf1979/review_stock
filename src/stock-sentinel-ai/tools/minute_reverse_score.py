# -*- coding: utf-8 -*-
"""尾盘 14:40 分时反推模型：单日实盘打分（generate）与次日结算（settle）。

与训练口径严格同源
------------------
* 分时特征 31 项：``minute_reverse_backtest.minute_features``（只用 <=14:40 的 1 分钟线）
* 日线特征 16 项：``minute_reverse_backtest.daily_features``（T-1 口径）
* 上下文 11 项：``bt_market_day`` / ``bt_sector_day`` 一律取 T-1
* 分档：``model.metas`` 的训练集分位边界（落训练集没出现过的档位 -> log-lift 记 0）
* 打分：``sigmoid(w*[1,(X-mu)/sd])``，``z`` 截断 +/-30，目标 ``up1..up9``、``limitUp``

数据源硬要求
------------
``load_minute()`` 必须返回 ``source == '.lc1'`` 且 ``origin == 'tdx-client'``；
``.01`` 是分笔转档、取不到分钟内极值，命中即报错退出，不做降级。

用法::

    python tools/minute_reverse_score.py --stage generate --date 20260921 --dry-run
    python tools/minute_reverse_score.py --stage generate --date 20260921 --out out.json
    python tools/minute_reverse_score.py --stage settle --date 20260921 --codes 600519,000001

本工具只读 `data/backtest.db`、`D:\\new_tdx` 与模型文件，不写 `data/kline.db`
（那个库由 3110 的 sql.js 内存副本整文件写回，外部进程直接写会被覆盖）。
"""
from __future__ import annotations

import argparse
import json
import math
import multiprocessing as mp
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bt_decision_engine as eng  # noqa: E402
from float_shares import ShareBook  # noqa: E402
from indicators import compute_indicators, limit_ratio_series  # noqa: E402
from kdata import Market, factor_series  # noqa: E402
from late_buy_next_morning import (filter_stock_universe, load_factors,  # noqa: E402
                                   load_latest_snapshot, shift_ymd,
                                   ymd_to_ordinal)
from minute_reverse_backtest import (AM_1030, COST, ENTRY_HHMM, KLINE_MAX_GAP,  # noqa: E402
                                     OUT_DIR, _pos_at_or_before, daily_features,
                                     day_slices, label_features, load_context,
                                     minute_features, prev_ctx)
from tdx_minute import load_minute  # noqa: E402
from tdx_names import load_tdx_names  # noqa: E402
from tdx_sector import load_industry_map  # noqa: E402

ROOT = os.path.normpath(os.path.join(HERE, '..'))
DEFAULT_MODEL = os.path.join(OUT_DIR, 'reverse_model.json')
PAPER_DIR = os.path.join(OUT_DIR, 'paper')

MODEL_VERSION = 'minute-reverse-v1'
SOURCE_TAG = 'reverse-1440'
SUGGESTED_BUY = ENTRY_HHMM          # 1440
SUGGESTED_SELL = AM_1030            # 1030
REQUIRED_SOURCE = '.lc1'
REQUIRED_ORIGIN = 'tdx-client'
MIN_AMT_WAN = 1000.0                # 流动性门槛：截至 14:40 成交额 >=1000 万
SETTLE_WINDOWS = (('1030', AM_1030),)   # 结算只等 09:31~10:30，不等 11:30
# 日线新鲜度探针：这几个票在所有 .day 文件里都最全，用来判断 data/hsjday 是否已含 T 日。
DAILY_PROBE = ('600519', '000001', '300750', '601318', '000858')


def log(msg: str) -> None:
    print(msg, flush=True)


def ymd(s: str) -> int:
    return int(str(s).replace('-', '').replace('/', ''))


def iso_now() -> str:
    return time.strftime('%Y-%m-%dT%H:%M:%S')


# ------------------------------------------------------------------ 分档
def label_num(meta: dict, v) -> str:
    """数值特征分档：与 ``bt_decision_engine._num_labels`` 同语义（边界外/缺失 -> 缺失）。"""
    labels = meta.get('labels') or ['缺失']
    edges = meta.get('edges') or []
    if v is None or not edges:
        return labels[-1]
    try:
        x = float(v)
    except (TypeError, ValueError):
        return labels[-1]
    if not np.isfinite(x):
        return labels[-1]
    idx = int(np.searchsorted(np.asarray(edges, dtype=float), x, side='right'))
    idx = min(max(idx, 0), max(len(labels) - 2, 0))
    return labels[idx]


def label_cat(_meta: dict, v) -> str:
    """分类特征分档：与 ``bt_decision_engine._cat_labels`` 同语义（空/nan -> 未知）。"""
    s = '未知' if v is None else str(v)
    return '未知' if s in ('', 'None', 'nan', 'NaN') else s


def _finite(v) -> bool:
    if v is None or isinstance(v, (str, bool)):
        return False
    try:
        return bool(np.isfinite(float(v)))
    except (TypeError, ValueError):
        return False


# ------------------------------------------------------------------ 打分器
class Scorer:
    """纯函数式打分器：58 特征 -> 10 个目标概率（%）+ 规则命中。"""

    def __init__(self, model: dict):
        block = model.get('model') or {}
        feats = block.get('features') or []
        self.keys = [f['key'] for f in feats]
        self.kind = {f['key']: f.get('kind', 'num') for f in feats}
        self.metas = block.get('metas') or {}
        self.tables = block.get('tables') or {}
        self.weights = block.get('weights') or {}
        self.mu = block.get('mu') or {}
        self.sd = block.get('sd') or {}
        self.targets = eng.target_keys()
        self.rule_set = block.get('ruleSet') or {}
        self.identity = model.get('modelIdentity') or {}
        self.base = model.get('base') or {}
        missing = [k for k in self.keys if k not in self.metas]
        if missing:
            raise SystemExit('[fail] model.metas 缺特征：%s（先跑 reverse_model_finalize.py）'
                             % missing[:5])

    def labels(self, feats: dict) -> dict:
        return {k: (label_cat(self.metas[k], feats.get(k))
                    if self.kind[k] == 'cat' else label_num(self.metas[k], feats.get(k)))
                for k in self.keys}

    def score(self, feats: dict) -> tuple[dict, dict]:
        lab = self.labels(feats)
        probs = {}
        for t in self.targets:
            table = self.tables.get(t) or {}
            w, mu, sd = self.weights.get(t), self.mu.get(t), self.sd.get(t)
            if w is None or mu is None or sd is None:
                raise SystemExit('[fail] 模型缺目标 %s 的参数' % t)
            x = np.array([((table.get(k) or {}).get('buckets') or {})
                          .get(lab[k], {}).get('loglift', 0.0) for k in self.keys],
                         dtype=float)
            xs = (x - np.asarray(mu, dtype=float)) / np.asarray(sd, dtype=float)
            z = float(np.clip(float(w[0]) + float(np.dot(np.asarray(w[1:], dtype=float), xs)),
                              -30.0, 30.0))
            p = 100.0 / (1.0 + math.exp(-z))
            if not np.isfinite(p):
                raise SystemExit('[fail] 目标 %s 概率非有限值' % t)
            probs[t] = p
        return probs, lab

    def rule_hits(self, feats: dict) -> list:
        """规则命中：条件值必须有限（缺失不算命中），与 ``cand_mask`` 同语义。"""
        hits = []
        for r in self.rule_set.get('rules') or []:
            ok = True
            for c in r['conds']:
                v = feats.get(c['key'])
                if not _finite(v):
                    ok = False
                    break
                x = float(v)
                if c['op'] == '>=':
                    if not x >= c['v']:
                        ok = False
                        break
                elif not x <= c['v']:
                    ok = False
                    break
            if ok:
                hits.append({'level': r['level'], 'levelName': r['levelName'],
                             'text': r['text'], 'stat': r.get('stat') or {}})
        return hits

    def expected_high(self, probs: dict) -> float:
        """用存活阶梯估正部期望：sum_{k=1..9} P(最高涨幅 >= k)（%，下界性质）。"""
        return float(sum(probs.get('up%d' % k, 0.0) for k in range(1, 10)))


def load_model(path: str) -> dict:
    with open(path, 'r', encoding='utf-8') as fp:
        model = json.load(fp)
    if model.get('version') != MODEL_VERSION:
        raise SystemExit('[fail] 模型版本 %r != %r' % (model.get('version'), MODEL_VERSION))
    return model


def redline(model: dict) -> dict:
    """口径红线：模型自报不可下单时必须显式带在输出里，界面/凭据都要能看见。"""
    ident = model.get('modelIdentity') or {}
    base = model.get('base') or {}
    return {
        'usableForDecision': 0,
        'days': base.get('days'),
        'dateRange': ident.get('dateRange'),
        'rows': ident.get('rows'),
        'note': (ident.get('runNote') or '')[:200],
        'strategyMeanPct': (base.get('means') or {}).get('stratPct'),
        'baseHit3Pct': (base.get('hitPct') or {}).get('up3'),
        'policy': '仅纸面跟踪：未扩窗复核前不得作为实盘下单依据',
    }


# ------------------------------------------------------------------ 数据装配
_W: dict = {}


def _worker_init(args, model_path: str, trade_date=None) -> None:
    _W['args'] = args
    # Windows 是 spawn：子进程拿不到父进程的 _W，决策日必须显式传进来
    if trade_date is not None:
        _W['T'] = int(trade_date)
    elif getattr(args, 'date', ''):
        _W['T'] = ymd(args.date)
    model = load_model(model_path)
    _W['model'] = model
    _W['scorer'] = Scorer(model)
    _W['market'] = Market()
    _W['names'] = load_tdx_names()
    _W['hy_map'] = load_industry_map()
    _W['snap'], _W['snap_date'] = load_latest_snapshot()
    _W['factors'] = load_factors()
    _W['shares'] = ShareBook.load()
    _W['mkt'], _W['mkt_dates'], _W['sec'], _W['sec_dates'] = load_context()


def daily_latest() -> int:
    """data/hsjday 里探针票的最新日线日期；0 表示完全读不到。

    T 日生成候选需要 T 日的不复权收盘与涨停价比对（``prev_close``/``limit_px``），
    日线缓存落后时整批样本都会落进 ``no_entry``，所以这里硬前置检查，
    宁可整轮跳过也不写出半截候选。
    """
    market = _W['market']
    best = 0
    for code in DAILY_PROBE:
        try:
            arr = market.load(code, 'raw')
        except Exception:
            continue
        if len(arr):
            best = max(best, int(arr['date'][-1]))
    return best


def _stock_context(code: str, T: int, min_bars: int):
    """装配单只股票在 T 日 14:40 可复现的全部输入；不可用返回 (None, 原因)。"""
    market = _W['market']
    m = load_minute(code, 1, start=shift_ymd(T, -20), end=shift_ymd(T, 45))
    if not m or len(m.get('date', ())) == 0:
        return None, 'no_minute'
    if m.get('source') != REQUIRED_SOURCE or m.get('origin') != REQUIRED_ORIGIN:
        raise SystemExit('[fail] %s 分钟源不合格：source=%r origin=%r path=%s'
                         % (code, m.get('source'), m.get('origin'), m.get('path')))
    try:
        raw = market.load(code, 'raw')
        qfq = market.load(code, 'qfq', _W['factors'].get(code))
    except Exception:
        return None, 'no_daily'
    if len(qfq) < min_bars + 2:
        return None, 'short'
    d_dates = np.asarray(qfq['date'], dtype=np.int64)
    dpos = {int(d): i for i, d in enumerate(d_dates)}
    i = dpos.get(int(T))
    if i is None or i < min_bars - 1 or i < 1:
        return None, 'no_entry'
    sl_by_date = day_slices(np.asarray(m['date']))
    if int(T) not in sl_by_date:
        return None, 'no_minute'
    return {'m': m, 'raw': raw, 'qfq': qfq, 'd_dates': d_dates, 'dpos': dpos, 'i': i,
            'sl_by_date': sl_by_date}, ''


def _market_sector_ctx(code: str, T: int) -> dict:
    hy = (_W['hy_map'].get(code) or {}) if code else {}
    sec_board = str(hy.get('board') or '')
    ctx_m = _W['mkt'].get(prev_ctx(_W['mkt_dates'], T)) or {}
    ctx_s = _W['sec'].get((sec_board, prev_ctx(_W['sec_dates'].get(sec_board), T))) or {}
    return {
        'marketTemp': ctx_m.get('marketTemp'),
        'marketUpRatio': ctx_m.get('marketUpRatio'),
        'marketLimitUpCnt': ctx_m.get('marketLimitUpCnt'),
        'marketRegime': ctx_m.get('marketRegime'),
        'sectorPct': ctx_s.get('sectorPct'),
        'sectorRet5': ctx_s.get('sectorRet5'),
        'sectorRet20': ctx_s.get('sectorRet20'),
        'sectorHeat': ctx_s.get('sectorHeat'),
        'sectorUpRatio': ctx_s.get('sectorUpRatio'),
        'sectorLimitUpCnt': ctx_s.get('sectorLimitUpCnt'),
    }


def _entry_at_1440(m: dict, sl: tuple) -> tuple[float, int]:
    """T 日 14:40 的 1 分钟收盘价与它在当日切片里的下标。"""
    s, e = sl
    t = np.asarray(m['time'][s:e], dtype=np.int64)
    p = _pos_at_or_before(t, ENTRY_HHMM)
    if p < 0:
        return float('nan'), -1
    return float(np.asarray(m['close'][s:e])[p]), p


def code_candidate(code: str) -> tuple:
    """T 日 14:40 的单只候选：58 特征 + 10 个目标概率 + 规则命中。"""
    args = _W['args']
    T = _W['T']
    ctx, err = _stock_context(code, T, args.min_bars)
    if ctx is None:
        return None, err
    m, raw, qfq = ctx['m'], ctx['raw'], ctx['qfq']
    i, d_dates, sl_by_date = ctx['i'], ctx['d_dates'], ctx['sl_by_date']
    f_all = factor_series(_W['factors'].get(code), d_dates)
    if i - 1 < 0 or f_all[i - 1] <= 0 or f_all[i] <= 0:
        return None, 'no_entry'
    ind = compute_indicators(qfq, code, _W['names'].get(code) or '')
    lmt_all = limit_ratio_series(code, raw['high'], raw['low'], raw['close'])
    prev_close = float(raw['close'][i - 1]) * f_all[i] / f_all[i - 1]
    t_close_raw = float(raw['close'][i])
    limit_px = round(t_close_raw * (1 + float(lmt_all[i])), 2)
    if not np.isfinite(prev_close) or prev_close <= 0:
        return None, 'no_entry'
    sel = sl_by_date[int(T)]
    entry, p = _entry_at_1440(m, sel)
    if p < 5 or not np.isfinite(entry) or entry <= 0 or entry >= limit_px - 1e-9:
        return None, 'no_entry'          # 14:40 已封板：买不到
    # 量能基准：前 5 个交易日的「截至 14:40 成交额」均值
    base5 = []
    for k in range(max(0, i - 5), i):
        d_prev = int(d_dates[k])
        if d_prev not in sl_by_date:
            continue
        s2, e2 = sl_by_date[d_prev]
        s_sel = np.asarray(m['time'][s2:e2]) <= ENTRY_HHMM
        if s_sel.any():
            v = float(np.asarray(m['amount'][s2:e2])[s_sel].sum())
            if np.isfinite(v) and v > 0:
                base5.append(v)
    sh_wan = (_W['shares'].shares_wan(code, int(T)) or np.nan)
    feats = minute_features(m, sel, prev_close, limit_px, sh_wan,
                            float(np.mean(base5)) if base5 else np.nan)
    if not feats:
        return None, 'no_entry'
    board = _W['market'].meta(code).get('board', '')
    hy = _W['hy_map'].get(code) or {}
    feats.update(daily_features(qfq, ind, i - 1, entry, sh_wan, board, i + 1))
    feats.update(_market_sector_ctx(code, int(T)))
    probs, lab = _W['scorer'].score(feats)
    hits = _W['scorer'].rule_hits(feats)
    name = _W['names'].get(code) or (_W['snap'].get(code) or {}).get('name', '') or ''
    return {
        'code': code, 'name': name, 'board': board,
        'industry': hy.get('hy_name', ''),
        'entry1440': round(entry, 4),
        'contextDate': int(d_dates[i - 1]),
        'probs': {k: round(v, 4) for k, v in probs.items()},
        'labels': lab,
        'features': {k: (None if not _finite(v) else round(float(v), 6))
                     for k, v in feats.items()},
        'ruleHits': hits,
        'expectedRetHigh': round(_W['scorer'].expected_high(probs), 4),
        'marketTemp': feats.get('marketTemp'),
        'marketRegime': feats.get('marketRegime'),
        'sectorHeat': feats.get('sectorHeat'),
        'sectorUpRatio': feats.get('sectorUpRatio'),
        'amountWan1440': feats.get('mAmountWan1440'),
        'turnover1440': feats.get('mTurnover1440'),
    }, ''


def code_settlement(code: str) -> tuple:
    """T 日 14:40 买入 -> T+1 09:31~10:30 的真实结果（与回测 stratRet 公式同源）。"""
    args = _W['args']
    T = _W['T']
    ctx, err = _stock_context(code, T, args.min_bars)
    if ctx is None:
        return None, err
    m, raw, qfq = ctx['m'], ctx['raw'], ctx['qfq']
    i, d_dates, sl_by_date = ctx['i'], ctx['d_dates'], ctx['sl_by_date']
    f_all = factor_series(_W['factors'].get(code), d_dates)
    if i - 1 < 0 or f_all[i - 1] <= 0 or f_all[i] <= 0 or i + 1 >= len(d_dates):
        return None, 'no_next'
    d1 = int(d_dates[i + 1])
    if d1 not in sl_by_date:
        return None, 'no_next'
    gap = int(ymd_to_ordinal(np.array([d1]))[0] - ymd_to_ordinal(np.array([int(T)]))[0])
    if gap > KLINE_MAX_GAP:
        return None, 'gap'
    adj = float(f_all[i] / f_all[i + 1])
    entry, p = _entry_at_1440(m, sl_by_date[int(T)])
    if p < 5 or not np.isfinite(entry) or entry <= 0:
        return None, 'no_entry'
    t_close_raw = float(raw['close'][i])
    limit_ratio = float(limit_ratio_series(code, raw['high'], raw['low'], raw['close'])[i])
    lab = label_features(m, sl_by_date[d1], entry, adj, t_close_raw, limit_ratio,
                         windows=SETTLE_WINDOWS)
    if not lab or not _finite(lab.get('hi1030Pct')):
        return None, 'no_label'          # 次日 09:31~10:30 窗口还没走完
    hi_pct = float(lab['hi1030Pct'])
    open_pct = float(lab['openPct'])
    close_pct = float(lab['c1030Pct'])
    hit3 = bool(hi_pct >= 3.0)
    # 与 minute_reverse_analyze.load_samples 的 stratRet 同一公式：
    #   冲高 -> max(+3%, 开盘涨幅) 了结；未冲高 -> 10:30 收盘了结；再扣 0.15% 摩擦
    exit_pct = max(3.0, open_pct) if hit3 else close_pct
    return {
        'code': code,
        'tradeDate': int(T),
        'nextDate': d1,
        'actualEntryPrice': round(entry, 4),
        'actualHigh': round(entry * (1 + hi_pct / 100.0), 4),
        'actualRetHigh': round(hi_pct, 4),
        'actualExitPrice': round(entry * (1 + exit_pct / 100.0), 4),
        'actualRetExit': round(exit_pct - COST * 100.0, 4),
        'hit3': 1 if hit3 else 0,
        'openPct': round(open_pct, 4),
        'c1030Pct': round(close_pct, 4),
        'hi1030Time': int(lab.get('hi1030Time') or 0),
        'limitTouch1030': int(lab.get('limitTouch1030') or 0),
        'settledAt': iso_now(),
    }, ''


def universe() -> list:
    args = _W['args']
    market = _W['market']
    codes, _uinfo = filter_stock_universe(
        market.codes(args.min_bars), market, _W['snap'], _W['names'], _W['hy_map'],
        exclude_industry=args.exclude_industry, include_star=args.include_star,
        keep_delisted=False, delist_grace_days=90, delist_scope='trade')
    return codes


def run_pool(func, codes: list, workers: int) -> tuple:
    rows, errs = [], {}
    if workers <= 1:
        for code in codes:
            row, err = func(code)
            if row:
                rows.append(row)
            elif err:
                errs[err] = errs.get(err, 0) + 1
    else:
        # Windows 是 spawn：子进程必须重新装配数据源与模型（不能靠父进程的全局 _W）
        with mp.Pool(workers, initializer=_worker_init,
                     initargs=(_W['args'], _W['model_path'], _W.get('T'))) as pool:
            for row, err in pool.imap_unordered(func, codes, chunksize=16):
                if row:
                    rows.append(row)
                elif err:
                    errs[err] = errs.get(err, 0) + 1
    return rows, errs


# ------------------------------------------------------------------ 决策载荷
def _json_default(o):
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.floating):
        return float(o)
    if isinstance(o, np.bool_):
        return bool(o)
    return str(o)


def decision_row(row: dict, model: dict, market_temp, market_regime) -> dict:
    """组装 bt_decision 的业务列（与 storage.js 的 BT_DECISION_COLUMNS 对齐）。"""
    ident = model.get('modelIdentity') or {}
    base = model.get('base') or {}
    probs = row['probs']
    up3 = probs['up3']
    base_up3 = float((base.get('hitPct') or {}).get('up3') or 0.0)
    # 未扩窗复核前不给 high：概率再高也只标 medium，避免凭据看起来像"已验证"
    confidence = 'medium' if (up3 >= 30 or (base_up3 and up3 >= base_up3 * 2)) else 'low'
    tol = float((base.get('means') or {}).get('stratPct') or 0.0)
    reason = ('14:40 分时反推：次日早盘≥+3%% 概率 %.2f%%（样本基准 %.2f%%），'
              '≥+5%% %.2f%%，涨停 %.2f%%；命中规则 %d 条；'
              '仅纸面跟踪（usableForDecision=0，样本外策略均值 %.3f%%），'
              '未扩窗复核前不得作为实盘下单依据。'
              % (up3, base_up3, probs['up5'], probs['limitUp'], len(row['ruleHits']), tol))
    evidence = {
        'caliber': 'T日14:40一分钟收盘买入 -> T+1 09:31~10:30 卖出（触及+3%止盈）',
        'source': SOURCE_TAG,
        'modelVersion': model.get('version'),
        'modelIdentity': {'runId': ident.get('runId'), 'runKey': ident.get('runKey'),
                          'dateRange': ident.get('dateRange'), 'bins': ident.get('bins'),
                          'rows': ident.get('rows')},
        'contextDate': row.get('contextDate'),
        'contextNote': '市场/行业上下文一律取 T-1（当日统计量收盘后才成立）',
        'entry1440': row['entry1440'],
        'amountWan1440': row.get('amountWan1440'),
        'turnover1440': row.get('turnover1440'),
        'probabilities': probs,
        'features': row['features'],
        'labels': row['labels'],
        'ruleHits': [h['text'] for h in row['ruleHits']],
        'redline': redline(model),
    }
    return {
        'tradeDate': int(_W['T']),
        'code': row['code'],
        'name': row['name'],
        'runId': ident.get('runId'),
        'runKey': ident.get('runKey'),
        'score': round(up3, 4),
        'up3Prob': round(up3, 4),
        'up5Prob': round(probs['up5'], 4),
        'limitUpProb': round(probs['limitUp'], 4),
        'expectedRetHigh': row['expectedRetHigh'],
        'expectedRetOpen': None,
        'suggestedBuyTime': SUGGESTED_BUY,
        'suggestedSellTime': SUGGESTED_SELL,
        'marketTemp': market_temp,
        'marketRegime': market_regime,
        'sectorHeat': row.get('sectorHeat'),
        'sectorUpRatio': row.get('sectorUpRatio'),
        'evidenceJson': json.dumps(evidence, ensure_ascii=False, default=_json_default),
        'patternJson': '{}',            # 本通道刻意不使用任何形态字段
        'confidence': confidence,
        'source': SOURCE_TAG,
        'reason': reason,
    }


# ------------------------------------------------------------------ 主流程
def _emit(args, out: dict, tag: str, summary: str) -> int:
    os.makedirs(PAPER_DIR, exist_ok=True)
    path = args.out or os.path.join(PAPER_DIR, '%s.json' % tag)
    if args.dry_run:
        log('[dry] %s（未写盘）' % summary)
        log('[dry] 摘要：%s' % json.dumps(
            {k: out[k] for k in ('stage', 'tradeDate', 'scanned', 'scored', 'eligible',
                                 'counts') if k in out}, ensure_ascii=False))
        for r in (out.get('rows') or [])[:5]:
            if out['stage'] == 'generate':
                log('[dry]   %s %s up3=%.2f%% up5=%.2f%% amt=%.0f万 规则 %d 条'
                    % (r['code'], r['name'], r['probs']['up3'], r['probs']['up5'],
                       r.get('amountWan1440') or 0, len(r['ruleHits'])))
            else:
                log('[dry]   %s entry=%.3f high=%.3f 最高%+.2f%% 卖出%+.2f%% hit3=%d'
                    % (r['code'], r['actualEntryPrice'], r['actualHigh'],
                       r['actualRetHigh'], r['actualRetExit'], r['hit3']))
        return 0
    tmp = path + '.writing'
    with open(tmp, 'w', encoding='utf-8') as fp:
        json.dump(out, fp, ensure_ascii=False, indent=1, default=_json_default)
    os.replace(tmp, path)
    log('[out] %s：%s' % (path, summary))
    return 0


def stage_generate(args) -> int:
    T = ymd(args.date)
    _W['T'] = T
    latest = daily_latest()
    if latest < T:
        log('[fail] T=%d 的日线还没到位：data/hsjday 最新只到 %s。'
            '先在通达信「盘后下载日线」（或跑同步）把 %d 的日线补上，再重跑本阶段；'
            '分钟线（.lc1）是否已有 T 日不影响这条前置条件。'
            % (T, latest or '无', T))
        return 1
    codes = universe()
    if args.codes:
        want = [c.strip() for c in args.codes.split(',') if c.strip()]
        in_pool = {c for c in codes}
        codes = [c for c in want if c in in_pool] or want
    log('[gen] T=%d 股票池 %d 只 / %d 进程' % (T, len(codes), args.workers))
    t0 = time.time()
    rows, errs = run_pool(code_candidate, codes, args.workers)
    rows.sort(key=lambda r: -r['probs']['up3'])
    kept = [r for r in rows if _finite(r.get('amountWan1440'))
            and float(r['amountWan1440']) >= args.min_amt_wan]
    log('[gen] 命中特征 %d 只（跳过：%s）/ 过流动性门槛 %d 只 / 用时 %.0fs'
        % (len(rows), errs or '无', len(kept), time.time() - t0))
    picked = kept if args.top <= 0 else kept[:args.top]
    model = _W['model']
    ctx_T = _market_sector_ctx('', T)
    decisions = [decision_row(r, model, ctx_T.get('marketTemp'),
                              ctx_T.get('marketRegime')) for r in picked]
    out = {
        'ok': True, 'stage': 'generate', 'tradeDate': T, 'generatedAt': iso_now(),
        'modelVersion': model.get('version'), 'modelIdentity': model.get('modelIdentity'),
        'caliber': {'entry': 'T 日 14:40 一分钟收盘', 'sell': 'T+1 09:31~10:30',
                    'target': '+3% 止盈，否则 10:30 收盘卖出',
                    'costPct': COST * 100, 'source': SOURCE_TAG,
                    'liquidityFilterWan': args.min_amt_wan,
                    'universe': '个股（剔 B 股/科创/ST/银行/退市）'},
        'redline': redline(model),
        'scanned': len(codes), 'scored': len(rows), 'eligible': len(kept),
        'skipped': errs, 'rows': picked, 'decisions': decisions,
    }
    return _emit(args, out, '%d-candidates' % T,
                 '候选 %d 只（过门槛 %d，取前 %d）' % (len(picked), len(kept), len(picked)))


def stage_settle(args) -> int:
    T = ymd(args.date)
    _W['T'] = T
    codes = [c.strip() for c in (args.codes or '').split(',') if c.strip()]
    if not codes:
        log('[fail] settle 必须给 --codes')
        return 1
    log('[set] T=%d 结算 %d 只' % (T, len(codes)))
    t0 = time.time()
    rows, errs = run_pool(code_settlement, codes, args.workers)
    rows.sort(key=lambda r: -r['actualRetHigh'])
    hit = sum(r['hit3'] for r in rows)
    avg = (round(float(np.mean([r['actualRetExit'] for r in rows])), 4) if rows else None)
    log('[set] 结算 %d 只 / 命中≥3%% %d 只 / 平均卖出收益 %s / 跳过：%s / 用时 %.0fs'
        % (len(rows), hit, avg, errs or '无', time.time() - t0))
    out = {
        'ok': True, 'stage': 'settle', 'tradeDate': T, 'settledAt': iso_now(),
        'source': SOURCE_TAG,
        'counts': {'requested': len(codes), 'settled': len(rows), 'hit3': hit,
                   'skipped': sum(errs.values())},
        'avgRetExit': avg,
        'skipped': errs, 'rows': rows,
        'settlements': [{k: r[k] for k in
                         ('tradeDate', 'code', 'actualEntryPrice', 'actualHigh',
                          'actualExitPrice', 'actualRetHigh', 'actualRetExit', 'hit3',
                          'settledAt')} for r in rows],
    }
    return _emit(args, out, '%d-settle' % T,
                 '结算 %d 只（命中 %d，平均 %s%%）' % (len(rows), hit, avg))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--stage', choices=('generate', 'settle'), default='generate')
    ap.add_argument('--date', required=True, help='决策日 T，YYYYMMDD 或 YYYY-MM-DD')
    ap.add_argument('--codes', default='', help='逗号分隔代码；generate 为冒烟限定，settle 必填')
    ap.add_argument('--top', type=int, default=30, help='写入候选数，0 = 全部')
    ap.add_argument('--min-amt-wan', type=float, default=MIN_AMT_WAN)
    ap.add_argument('--min-bars', type=int, default=150)
    ap.add_argument('--exclude-industry', nargs='*', default=['银行'])
    ap.add_argument('--include-star', action='store_true')
    ap.add_argument('--model', default=DEFAULT_MODEL)
    ap.add_argument('--out', default='')
    ap.add_argument('--workers', type=int, default=0, help='0 = 自动（最多 8）')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args(argv)
    workers = int(args.workers) if args.workers else min(8, os.cpu_count() or 4)
    args.workers = max(1, workers)
    if not os.path.exists(args.model):
        log('[fail] 模型不存在：%s' % args.model)
        return 1
    t0 = time.time()
    _W['model_path'] = args.model
    _worker_init(args, args.model)
    ident = _W['model'].get('modelIdentity') or {}
    log('[in] 模型 %s（runId=%s / %s / 样本 %s 行 / %s）'
        % (os.path.basename(args.model), ident.get('runId'), ident.get('runKey'),
           ident.get('rows'), ident.get('dateRange')))
    rule_set = (_W['model'].get('model') or {}).get('ruleSet') or {}
    log('[in] 规则集 %d 条 / 分档特征 %d 个 / 分钟源要求 %s + %s'
        % (len(rule_set.get('rules') or []), len(_W['scorer'].keys),
           REQUIRED_SOURCE, REQUIRED_ORIGIN))
    log('[in] 日线缓存（data/hsjday）最新 %d' % daily_latest())
    rc = stage_generate(args) if args.stage == 'generate' else stage_settle(args)
    if rc == 0 and not args.dry_run:
        log('[done] 用时 %.0fs' % (time.time() - t0))
    return rc


if __name__ == '__main__':
    raise SystemExit(main())
