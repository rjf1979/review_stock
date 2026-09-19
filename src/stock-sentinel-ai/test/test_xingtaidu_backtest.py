import sys
from pathlib import Path
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from xingtaidu_backtest import DEFAULT, _plan, simulate_exit


def ind_for(closes, highs=None, lows=None, opens=None):
    c = np.asarray(closes, dtype=float)
    n = len(c)
    h = np.asarray(highs if highs is not None else c + .1, dtype=float)
    l = np.asarray(lows if lows is not None else c - .1, dtype=float)
    o = np.asarray(opens if opens is not None else c, dtype=float)
    return {
        'close': c, 'high': h, 'low': l, 'open': o,
        'atr14': np.full(n, .2), 'ma10': np.full(n, 10.),
        'ma20': np.full(n, 10.), 'date': np.arange(n),
    }


class ExitTests(unittest.TestCase):
    def cfg(self):
        cfg = dict(DEFAULT)
        cfg.update(hold_days=5, risk_pct=8, risk_atr=2, first_r_multiple=1,
                   first_exit_fraction=.5, target_fraction=1, trail_pct=.08,
                   trail_ma=10, slippage=0, commission=0, min_commission=0,
                   stamp_tax=0, position=100000)
        return cfg

    def test_plan_has_structural_stop_and_one_r(self):
        d = ind_for(np.full(40, 10.))
        d['low'][-10:-1] = 9.5
        plan = _plan(d, 35, 10, 'platform_breakout', self.cfg())
        self.assertLess(plan['stop'], 10)
        self.assertAlmostEqual(plan['first_target'], 10 + (10-plan['stop']))
        self.assertGreater(plan['target'], plan['first_target'])

    def test_partial_one_r_then_trailing_exit(self):
        c = np.full(30, 10.)
        h = np.full(30, 10.1)
        l = np.full(30, 9.9)
        c[25:] = [10.6, 10.4, 10.2, 10.0, 9.9]
        h[25:] = [10.6, 10.5, 10.3, 10.1, 10.0]
        l[25:] = [10.0, 10.3, 10.1, 9.9, 9.8]
        d = ind_for(c, h, l)
        d['ma10'][25:] = [10.1, 10.1, 10.1, 10.1, 10.1]
        result = simulate_exit(d, 25, 10, 'ma_bullish', self.cfg())
        self.assertTrue(result['partial'])
        self.assertEqual(result['events'][0]['reason'], '1R分批止盈')
        self.assertIn(result['reason'], ('跟踪止损', '到期'))

    def test_stop_takes_priority_when_same_bar_hits_target(self):
        c = np.full(30, 10.)
        h = np.full(30, 10.1)
        l = np.full(30, 9.9)
        h[25] = 10.8; l[25] = 9.0
        d = ind_for(c, h, l)
        result = simulate_exit(d, 25, 10, 'ma_bullish', self.cfg())
        self.assertFalse(result['partial'])
        self.assertEqual(result['reason'], '结构止损')

    def test_no_target_removes_measured_target_cap(self):
        """no_target=True 是纯跟踪模式：目标位消失，但不影响止损与 1R 分批。"""
        cfg = self.cfg()
        cfg['no_target'] = True
        d = ind_for(np.full(40, 10.))
        d['low'][-10:-1] = 9.5
        plan = _plan(d, 35, 10, 'platform_breakout', cfg)
        self.assertEqual(plan['target'], np.inf)
        self.assertLess(plan['stop'], 10)
        self.assertAlmostEqual(plan['first_target'], 10 + (10 - plan['stop']))
        # 默认（no_target 缺省）仍保留测量目标，确认该开关默认关闭
        plan_default = _plan(d, 35, 10, 'platform_breakout', self.cfg())
        self.assertTrue(np.isfinite(plan_default['target']))


if __name__ == '__main__':
    unittest.main()
