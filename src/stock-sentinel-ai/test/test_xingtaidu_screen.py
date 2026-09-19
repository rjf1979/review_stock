"""独立合成数据测试；不读写项目行情库，不宣称验证收益。"""
import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from xingtaidu_screen import Config, NAMES, detect_at, main, pivots, prepare


def bars(close, volume=None):
    c = np.asarray(close, dtype=float)
    return pd.DataFrame(dict(date=pd.bdate_range('2025-01-01', periods=len(c)).strftime('%Y-%m-%d'),
                             open=c-.04, high=c+.10, low=c-.10, close=c,
                             volume=np.full(len(c), 100.) if volume is None else volume))


def hits(d):
    return {r['pattern']: r for r in detect_at(prepare(d))}


class PatternTests(unittest.TestCase):
    def test_25_names_and_short_history(self):
        self.assertEqual(len(NAMES), 25)
        for n in (0, 1, 20, 59):
            self.assertEqual(detect_at(prepare(bars(np.full(n, 10)))), [])

    def test_invalid_data(self):
        base = bars(np.full(60, 10))
        for column, value in [('volume', 0), ('close', np.nan), ('high', 9), ('low', 11)]:
            bad = base.copy()
            bad.loc[20, column] = value
            with self.subTest(column=column), self.assertRaises(ValueError):
                prepare(bad)
        with self.assertRaises(ValueError):
            prepare(pd.concat([base, base.iloc[-1:]]))
        with self.assertRaises(ValueError):
            prepare(base.assign(limit_up='unknown'))
        with self.assertRaises(ValueError):
            Config(volume_multiple=.5)

    def test_breakout_excludes_today_high_and_volume(self):
        d = bars(np.r_[np.full(65, 10.), 10.5])
        d.loc[65, ['high', 'volume']] = [11, 150]
        result = hits(d)
        self.assertIn('volume_breakout', result)
        self.assertIn('platform_breakout', result)
        self.assertEqual(result['volume_breakout']['volume_ratio'], 1.5)
        self.assertAlmostEqual(result['volume_breakout']['key_level'], 10.1)
        d.loc[65, 'volume'] = 149
        self.assertNotIn('volume_breakout', hits(d))

    def test_breakout_cannot_use_wick_alone(self):
        d = bars(np.r_[np.full(65, 10.), 10.0])
        d.loc[65, ['high', 'volume']] = [12, 200]
        self.assertNotIn('volume_breakout', hits(d))

    def test_gap_requires_unfilled_gap_and_resistance(self):
        d = bars(np.r_[np.full(65, 10.), 10.5])
        d.loc[65, 'volume'] = 200
        self.assertIn('gap_breakout', hits(d))
        d.loc[65, 'low'] = 10.1
        self.assertNotIn('gap_breakout', hits(d))

    def test_engulf_needs_full_real_body(self):
        d = bars(np.linspace(12, 10, 70))
        d.loc[68, ['open', 'high', 'low', 'close']] = [10.3, 10.4, 9.9, 10]
        d.loc[69, ['open', 'high', 'low', 'close', 'volume']] = [9.98, 10.6, 9.9, 10.5, 200]
        self.assertIn('yang_engulf', hits(d))
        d.loc[69, 'open'] = 10.1
        self.assertNotIn('yang_engulf', hits(d))

    def test_shadow_setup_and_confirmation(self):
        d = bars(np.linspace(12, 10, 70))
        d.loc[69, ['open', 'high', 'low', 'close']] = [9.95, 10.1, 9.2, 10]
        result = hits(d)['long_lower_shadow']
        self.assertEqual(result['stage'], 'setup')
        self.assertFalse(result['eligible'])
        extra = bars([10.3]).assign(date='2025-06-01', volume=200)
        self.assertEqual(hits(pd.concat([d, extra]))['long_lower_shadow']['stage'], 'confirmed')

    def test_dry_new_low_is_not_entry(self):
        d = bars(np.linspace(12, 10, 70))
        d.loc[69, 'volume'] = 30
        result = hits(d)['dry_price_bottom']
        self.assertEqual(result['stage'], 'setup')
        self.assertFalse(result['eligible'])

    def test_double_bottom_with_upper_wick_and_rising_variant(self):
        # 预热后：下跌、第一底、反弹、第二底、越颈线。
        for second, pid in [(9.05, 'double_bottom'), (9.4, 'rising_w_bottom')]:
            shape = np.interp(np.arange(40), [0, 9, 19, 29, 38, 39], [12, 9, 11, second, 10.9, 11.5])
            d = bars(np.r_[np.full(30, 12), shape])
            d.loc[len(d)-1, 'volume'] = 200
            self.assertIn(pid, hits(d))
            d.loc[len(d)-1, 'close'] = 10.9
            d.loc[len(d)-1, 'open'] = 10.8
            d.loc[len(d)-1, 'low'] = 10.7
            self.assertNotIn(pid, hits(d))

    def test_arc_fit_not_just_middle_low(self):
        x = np.linspace(-1, 1, 40)
        d = bars(np.r_[np.full(30, 12), 10+2*x*x, 12.4])
        d.loc[len(d)-1, 'volume'] = 200
        self.assertIn('arc_bottom', hits(d))
        v_shape = 10+2*np.abs(x)
        # 陡峭的单日尖底，使平滑拟合质量不足。
        v_shape[15:25] = np.where(np.arange(10) % 2, 11.9, 9)
        noisy = bars(np.r_[np.full(30, 12), v_shape, 12.4])
        noisy.loc[len(noisy)-1, 'volume'] = 200
        self.assertNotIn('arc_bottom', hits(noisy))

    def test_head_shoulders_uses_internal_neckline(self):
        shape = np.interp(np.arange(50), [0, 8, 15, 24, 32, 40, 49], [12, 10, 11.5, 9, 11.5, 10.1, 11.4])
        d = bars(np.r_[np.full(20, 12), shape, 11.9])
        d.loc[len(d)-1, 'volume'] = 200
        self.assertIn('head_shoulder_bottom', hits(d))

    def test_trendline_is_resistance_through_highs(self):
        shape = np.interp(np.arange(40), [0, 7, 12, 20, 27, 34, 39], [12, 10.5, 11.5, 9.8, 10.7, 9.4, 9.8])
        d = bars(np.r_[np.full(30, 12), shape, 10.5])
        d.loc[len(d)-1, 'volume'] = 200
        self.assertIn('trendline_breakout', hits(d))

    def test_limit_pullback_requires_authoritative_anchor_and_support(self):
        d = bars(np.r_[np.full(62, 10), 11, 10.9, 10.7, 10.8, 11.1])
        d.loc[62, ['open', 'low', 'volume']] = [10, 9.95, 300]
        self.assertNotIn('limit_pullback', hits(d))
        d['limit_up'] = 0
        d.loc[62, 'limit_up'] = 1
        self.assertIn('limit_pullback', hits(d))
        d.loc[64, 'low'] = 9.5
        self.assertNotIn('limit_pullback', hits(d))

    def test_n_shape_needs_rise_and_shrinking_retrace(self):
        shape = np.interp(np.arange(30), [0, 12, 22, 29], [10, 12, 11, 11.8])
        d = bars(np.r_[np.full(35, 10), shape, 12.4])
        d.loc[35:47, 'volume'] = 200
        d.loc[65, 'volume'] = 200
        self.assertIn('n_shape', hits(d))

    def test_pivots_delay_confirmation(self):
        self.assertEqual(pivots([5, 4, 1, 3]), [])
        self.assertEqual(pivots([5, 4, 1, 3, 4]), [2])

    def test_all_rules_are_prefix_invariant(self):
        rng = np.random.default_rng(7)
        c = 20*np.exp(np.cumsum(rng.normal(0, .023, 130)))
        raw = bars(c, rng.uniform(60, 220, len(c)))
        full = prepare(raw)
        for i in (59, 70, 90, 110):
            self.assertEqual(detect_at(full, i), detect_at(prepare(raw.iloc[:i+1])))
        # 极端未来价格不得反向改变历史信号。
        changed = raw.copy()
        changed.loc[91:, ['open', 'high', 'low', 'close']] *= 10
        self.assertEqual(detect_at(full, 90), detect_at(prepare(changed), 90))

    def test_flat_market_and_rsi_boundaries(self):
        flat = prepare(bars(np.full(70, 10)))
        self.assertEqual(flat.rsi.iloc[-1], 50)
        self.assertEqual(detect_at(flat), [])
        self.assertEqual(prepare(bars(np.arange(1, 71))).rsi.iloc[-1], 100)
        self.assertEqual(prepare(bars(np.arange(70, 0, -1))).rsi.iloc[-1], 0)

    def test_cli_outputs_skips_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder = root/'input'
            folder.mkdir()
            d = bars(np.r_[np.full(65, 10), 10.5])
            d.loc[65, 'volume'] = 200
            d.to_csv(folder/'000001.csv', index=False)
            d.iloc[:-1].to_csv(folder/'stale.csv', index=False)
            out = root/'signals.json'
            argv = ['--input', str(folder), '--as-of', d.date.iloc[-1], '--price-basis', 'qfq', '--output', str(out)]
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(main(argv), 2)
                before = out.read_bytes()
                self.assertEqual(main(argv), 2)
                self.assertEqual(out.read_bytes(), before)
            result = json.loads(out.read_text('utf-8'))
            self.assertEqual(result['scanned'], 1)
            self.assertEqual(len(result['skipped']), 1)
            self.assertEqual(result['signals'][0]['symbol'], '000001')


if __name__ == '__main__':
    unittest.main()
