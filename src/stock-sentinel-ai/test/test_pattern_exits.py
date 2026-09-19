# -*- coding: utf-8 -*-
"""25 形态退出规则表与回测退出机制的单元测试（不联网、不读行情）。"""
import json
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import pattern_exits  # noqa: E402
import patterns  # noqa: E402
from xingtaidu_backtest import DEFAULT, _plan, resolve_exit, simulate_exit  # noqa: E402


def ctx_ind(closes, volumes=None, bench=None, n=60):
    """构造一个够长的指标字典，用于测试信号上下文过滤。"""
    c = np.asarray(closes, dtype=float)
    n = len(c)
    d = {
        'open': c.copy(), 'close': c.copy(),
        'high': c + 0.2, 'low': c - 0.2,
        'prev_close': np.r_[c[0], c[:-1]],
        'body': np.zeros(n), 'lower': np.full(n, 0.3), 'upper': np.zeros(n),
        'volume': np.asarray(volumes if volumes is not None else np.full(n, 100.0),
                             dtype=float),
        'vma20': np.full(n, 100.0), 'vma5': np.full(n, 100.0),
        'atr14': np.full(n, 0.2), 'ma60': np.full(n, 1.0),
    }
    if bench is not None:
        d['bench_close'] = np.asarray(bench, dtype=float)
    return d


class ContextFilterTests(unittest.TestCase):
    """「前期跌幅 / 相对强度 / 量能」过滤：默认关闭，显式传参才生效。"""

    def _sig(self, n=60, idx=59):
        s = np.zeros(n, dtype=bool)
        s[idx] = True
        return s

    def test_default_detection_is_unchanged(self):
        # 参数缺省 / 传空 dict 时，过滤必须完全不生效
        ind = ctx_ind(np.linspace(10.0, 8.0, 60))
        self.assertTrue(np.array_equal(
            patterns.detect('long_lower_shadow', ind, None),
            patterns.detect('long_lower_shadow', ind, {})))

    def test_drop_filter_requires_prior_decline(self):
        sig = self._sig()
        down = ctx_ind(np.linspace(10.0, 6.0, 60))      # 近20日约 -18%
        flat = ctx_ind(np.linspace(10.0, 10.0, 60))
        f = {'drop_days': 20, 'drop_max': -8.0}
        keep = patterns.xingtaidu._ctx_filter
        self.assertTrue(bool(keep(sig, down, f)[59]))
        self.assertFalse(bool(keep(sig, flat, f)[59]))

    def test_drop_filter_passes_when_history_too_short(self):
        sig = np.zeros(5, dtype=bool); sig[4] = True
        ind = ctx_ind(np.linspace(10.0, 9.0, 5))
        self.assertTrue(bool(patterns.xingtaidu._ctx_filter(
            sig, ind, {'drop_days': 20, 'drop_max': -8.0})[4]))

    def test_rs_filter_uses_benchmark_series(self):
        sig = self._sig()
        stock = ctx_ind(np.linspace(10.0, 12.0, 60))     # 近20日约 +6%
        bench_flat = np.full(60, 100.0)                  # 基准近20日 0%
        bench_up = np.linspace(100.0, 140.0, 60)         # 基准近20日约 +11%
        stock['bench_close'] = bench_flat
        self.assertTrue(bool(patterns.xingtaidu._ctx_filter(
            sig, stock, {'rs_days': 20, 'rs_min': 5.0})[59]))
        stock['bench_close'] = bench_up
        self.assertFalse(bool(patterns.xingtaidu._ctx_filter(
            sig, stock, {'rs_days': 20, 'rs_min': 5.0})[59]))

    def test_rs_filter_silent_without_benchmark(self):
        sig = self._sig()
        ind = ctx_ind(np.linspace(10.0, 11.0, 60))
        self.assertTrue(bool(patterns.xingtaidu._ctx_filter(
            sig, ind, {'rs_days': 20, 'rs_min': 50.0})[59]))

    def test_rs_filter_can_require_relative_weakness(self):
        sig = self._sig()
        stock = ctx_ind(np.linspace(10.0, 11.0, 60))     # 近20日约 +3%
        stock['bench_close'] = np.linspace(100.0, 130.0, 60)   # 基准约 +8%
        f = {'rs_days': 20}
        self.assertTrue(bool(patterns.xingtaidu._ctx_filter(
            sig, stock, {**f, 'rs_max': 0.0})[59]))      # 相对走弱 → 保留
        self.assertFalse(bool(patterns.xingtaidu._ctx_filter(
            sig, stock, {**f, 'rs_max': -10.0})[59]))    # 要求弱 10pp 以上 → 剔除

    def test_volume_filter_bounds(self):
        sig = self._sig()
        v = np.full(60, 100.0); v[59] = 150.0            # 触发日 = 1.5 倍 20 日均量
        ind = ctx_ind(np.linspace(10.0, 10.5, 60), volumes=v)
        self.assertTrue(bool(patterns.xingtaidu._ctx_filter(
            sig, ind, {'vol_ref': 20, 'vol_max': 2.0})[59]))
        self.assertFalse(bool(patterns.xingtaidu._ctx_filter(
            sig, ind, {'vol_ref': 20, 'vol_max': 1.2})[59]))
        self.assertTrue(bool(patterns.xingtaidu._ctx_filter(
            sig, ind, {'vol_ref': 20, 'vol_min': 1.2})[59]))
        self.assertFalse(bool(patterns.xingtaidu._ctx_filter(
            sig, ind, {'vol_ref': 20, 'vol_min': 2.0})[59]))

    def test_bench_ma_filter_needs_index_above_its_average(self):
        sig = self._sig()
        above = ctx_ind(np.linspace(10.0, 10.5, 60))          # 个股无要求，只看基准
        above['bench_close'] = np.linspace(100.0, 130.0, 60)  # 指数持续上行 → 在均线上方
        self.assertTrue(bool(patterns.xingtaidu._ctx_filter(
            sig, above, {'bench_ma_days': 20})[59]))
        self.assertFalse(bool(patterns.xingtaidu._ctx_filter(
            sig, above, {'bench_ma_days': 20, 'bench_ma_mode': 'below'})[59]))
        below = ctx_ind(np.linspace(10.0, 10.5, 60))
        below['bench_close'] = np.linspace(130.0, 100.0, 60)  # 指数持续下行 → 在均线下方
        self.assertFalse(bool(patterns.xingtaidu._ctx_filter(
            sig, below, {'bench_ma_days': 20})[59]))
        self.assertTrue(bool(patterns.xingtaidu._ctx_filter(
            sig, below, {'bench_ma_days': 20, 'bench_ma_mode': 'below'})[59]))

    def test_bench_ma_filter_survives_leading_missing_benchmark(self):
        # 个股上市早于基准序列起点时，对齐结果前面整段是 NaN；
        # 这种情况下过滤必须仍然生效，不能静默放行。
        sig = self._sig()
        b = np.full(60, np.nan)
        b[40:] = np.linspace(130.0, 100.0, 20)               # 后 20 根才有基准，且在均线下
        ind = ctx_ind(np.linspace(10.0, 10.5, 60), bench=b)
        self.assertFalse(bool(patterns.xingtaidu._ctx_filter(
            sig, ind, {'bench_ma_days': 20})[59]))

    def test_bench_ma_filter_silent_without_benchmark(self):
        sig = self._sig()
        ind = ctx_ind(np.linspace(10.0, 11.0, 60))
        self.assertTrue(bool(patterns.xingtaidu._ctx_filter(
            sig, ind, {'bench_ma_days': 20})[59]))


def ind_for(closes, highs=None, lows=None, opens=None, ma10=None, ma20=None, atr=.2):
    c = np.asarray(closes, dtype=float)
    n = len(c)
    h = np.asarray(highs if highs is not None else c + .1, dtype=float)
    l = np.asarray(lows if lows is not None else c - .1, dtype=float)
    o = np.asarray(opens if opens is not None else c, dtype=float)
    return {
        'close': c, 'high': h, 'low': l, 'open': o,
        'atr14': np.full(n, atr), 'ma5': np.full(n, 10.),
        'ma10': np.full(n, 10.) if ma10 is None else np.asarray(ma10, dtype=float),
        'ma20': np.full(n, 10.) if ma20 is None else np.asarray(ma20, dtype=float),
        'date': np.arange(n),
    }


class SpecTableTests(unittest.TestCase):
    def test_every_pattern_has_its_own_spec(self):
        self.assertEqual(set(pattern_exits.ids()), set(patterns.ids()))
        self.assertEqual(len(pattern_exits.ids()), 25)

    def test_specs_are_not_duplicated(self):
        seen = {}
        for pid in pattern_exits.ids():
            sig = json.dumps({k: v for k, v in pattern_exits.spec(pid).items()
                              if k != 'reason'}, sort_keys=True, ensure_ascii=False)
            self.assertNotIn(sig, seen, f'{pid} 与 {seen.get(sig)} 的退出参数完全相同')
            seen[sig] = pid

    def test_spec_values_are_sane(self):
        for pid in pattern_exits.ids():
            s = pattern_exits.spec(pid)
            self.assertIn(s['key'][0], ('low', 'high', 'ma', 'close', 'open'))
            self.assertIn(s['invalid'][0], ('low', 'high', 'ma', 'close', 'open'))
            self.assertGreaterEqual(s['stop_buf'], 0.0)
            self.assertGreater(s['atr_mult'], 0)
            self.assertTrue(0 < s['risk_cap'] <= 12)
            r, frac = s['partial']
            self.assertGreater(r, 0)
            self.assertTrue(0 < frac < 1)
            self.assertTrue(s['target'] is None or s['target'][0] in ('measured', 'level'))
            self.assertGreater(s['trail_pct'], 0)
            self.assertGreaterEqual(s['trail_ma'], 5)
            self.assertGreaterEqual(s['max_hold'], 5)
            self.assertTrue(0 <= s['close_below_ma_buf'] < 0.1)
            self.assertGreaterEqual(s['close_below_confirm'], 1)
            self.assertTrue(s['reason'].strip())


class PatternPlanTests(unittest.TestCase):
    def cfg(self, **kw):
        cfg = dict(DEFAULT)
        cfg['exit_mode'] = 'pattern'
        cfg.update(kw)
        return cfg

    def test_plan_uses_pattern_hold_and_invalid_level(self):
        d = ind_for(np.full(60, 10.))
        d['low'][40:45] = 9.2
        d['low'][20:30] = 8.0
        plan = _plan(d, 45, 10, 'gap_breakout', self.cfg())
        self.assertAlmostEqual(plan['stop'], 10.1 * 0.99, places=6)
        self.assertEqual(plan['max_hold'], pattern_exits.spec('gap_breakout')['max_hold'])
        plan2 = _plan(d, 45, 10, 'dry_price_bottom', self.cfg())
        self.assertEqual(plan2['partial_frac'], 0.33)
        self.assertEqual(plan2['max_hold'], 40)
        # v3：长下影从 v2 的 6% 风险上限 / 10 日持有，恢复到 8% / 20 日量级
        self.assertEqual(_plan(d, 45, 10, 'long_lower_shadow', self.cfg())['max_hold'], 20)

    def test_measured_target_uses_pattern_height(self):
        d = ind_for(np.full(60, 10.))
        d['high'][30:50] = 10.5
        d['low'][30:50] = 9.5
        plan = _plan(d, 50, 10.5, 'platform_breakout', self.cfg())
        self.assertAlmostEqual(plan['key'], 10.5, places=6)
        self.assertAlmostEqual(plan['height'], 1.0, places=6)
        self.assertAlmostEqual(plan['target'], 11.5, places=6)
        self.assertGreater(plan['target'], plan['first_target'])

    def test_trend_patterns_have_no_measured_target(self):
        d = ind_for(np.full(60, 10.))
        for pid in ('ma_bullish', 'pullback_ma20', 'ma_golden_start', 'macd_water_golden'):
            plan = _plan(d, 50, 10, pid, self.cfg())
            self.assertFalse(np.isfinite(plan['target']), pid)

    def _pullback_ind(self, closes, lows, ma20=10.0):
        c = np.full(40, 10.0); h = np.full(40, 10.1); l = np.full(40, 9.9)
        l[18:24] = 9.0                     # 结构锚：信号日之前的低点
        for i, v in closes.items():
            c[i] = v; h[i] = v + 0.1
        for i, v in lows.items():
            l[i] = v
        return ind_for(c, h, l, ma20=np.full(40, ma20))

    def test_close_below_ma20_requires_two_confirmations(self):
        # MA20=10，阈值 10×0.975=9.75；9.70 连续两日跌破才离场
        d = self._pullback_ind({26: 9.70, 27: 9.70}, {26: 9.60, 27: 9.60})
        res = simulate_exit(d, 25, 10, 'pullback_ma20', self.cfg())
        self.assertEqual(res['reason'], '收盘跌破MA20')
        self.assertAlmostEqual(res['events'][-1]['price'], 9.70, places=6)
        self.assertFalse(res['partial'])

    def test_close_below_ma20_buffer_ignores_marginal_break(self):
        # 9.80 只比 MA20 低 2%，在 2.5% 缓冲内，不算跌破 → 一直持有到期
        d = self._pullback_ind({i: 9.80 for i in range(26, 40)},
                               {i: 9.70 for i in range(26, 40)})
        res = simulate_exit(d, 25, 10, 'pullback_ma20', self.cfg())
        self.assertEqual(res['reason'], '到期')

    def test_close_below_ma20_ignores_single_day_break(self):
        # 只有一天收盘 9.70，第二根收回 10.0 → 不触发
        d = self._pullback_ind({26: 9.70, 27: 10.0, 28: 10.0},
                               {26: 9.60, 27: 9.90, 28: 9.90})
        res = simulate_exit(d, 25, 10, 'pullback_ma20', self.cfg())
        self.assertNotEqual(res['reason'], '收盘跌破MA20')

    def test_plan_does_not_use_bars_after_signal(self):
        c = np.full(60, 10.)
        h = np.full(60, 10.2); l = np.full(60, 9.8)
        h[50:] = 20.0; l[50:] = 5.0
        full = ind_for(c, h, l)
        trunc = {k: (v[:51] if isinstance(v, np.ndarray) else v) for k, v in full.items()}
        for pid in patterns.ids():
            a = _plan(full, 50, 10, pid, self.cfg())
            b = _plan(trunc, 50, 10, pid, self.cfg())
            for k in ('stop', 'first_target', 'target', 'key', 'structural'):
                self.assertAlmostEqual(float(a[k]), float(b[k]), places=6,
                                       msg=f'{pid}.{k} 使用了信号日之后的数据')

    def test_explicit_overrides_beat_pattern_spec(self):
        d = ind_for(np.full(40, 10.))
        plan = _plan(d, 30, 10, 'long_lower_shadow',
                     self.cfg(hold_days=7, risk_pct=3.0, trail_pct=0.02))
        self.assertEqual(plan['max_hold'], 7)
        self.assertAlmostEqual(plan['stop'], 9.7, places=6)

    def test_uniform_mode_reproduces_old_defaults(self):
        d = ind_for(np.full(40, 10.))
        cfg = self.cfg(exit_mode='uniform')
        cfg.update({'hold_days': 40, 'risk_pct': 8.0, 'risk_atr': 2.0,
                    'first_r_multiple': 1.0, 'first_exit_fraction': 0.5,
                    'target_fraction': 1.0, 'trail_ma': 10, 'trail_pct': 0.08})
        plan = _plan(d, 30, 10, 'ma_bullish', cfg)
        self.assertEqual(plan['mode'], 'uniform')
        self.assertEqual(plan['max_hold'], 40)
        self.assertFalse(np.isfinite(plan['target']))
        plan2 = _plan(d, 30, 10, 'platform_breakout', cfg)
        self.assertEqual(plan2['mode'], 'uniform')
        self.assertTrue(np.isfinite(plan2['target']))

    def test_resolve_exit_covers_all_patterns(self):
        cfg = self.cfg()
        for pid in patterns.ids():
            sp = resolve_exit(pid, cfg)
            self.assertIn('risk_cap', sp)


if __name__ == '__main__':
    unittest.main()
