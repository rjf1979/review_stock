# -*- coding: utf-8 -*-
"""Sequoia-X 六个等价形态的单元测试（不联网、不读行情）。

覆盖两点：每个形态的条件分支（含边界）是否按原口径成立；
以及横截面形态在缺少 rps120_p90 时必须返回全 False，而不是伪造信号。
"""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import patterns  # noqa: E402


def base_ind(n, close=10.0):
    c = np.full(n, float(close))
    return {
        'open': c.copy(), 'high': c + 0.1, 'low': c - 0.1, 'close': c.copy(),
        'prev_close': np.r_[c[0], c[:-1]],
        'volume': np.full(n, 100.0), 'amount': np.full(n, 1.0e8),
        'vma20': np.full(n, 100.0), 'vma5': np.full(n, 100.0),
        'ma5': np.full(n, 10.0), 'ma20': np.full(n, 10.0), 'ma60': np.full(n, 10.0),
        'atr14': np.full(n, 0.2),
    }


def detect(pid, ind, params=None):
    return patterns.detect(pid, ind, params)


class MaVolumeTests(unittest.TestCase):
    pid = 'sqxm_ma_volume'

    def test_requires_cross_and_volume(self):
        n = 30
        ind = base_ind(n)
        # 昨日 ma5 < ma20，今日 ma5 > ma20
        ind['ma5'][n-2], ind['ma20'][n-2] = 9.8, 10.0
        ind['ma5'][n-1], ind['ma20'][n-1] = 10.2, 10.0
        ind['volume'][n-1] = 160.0          # 1.6 倍 20 日均量
        sig = detect(self.pid, ind)
        self.assertTrue(bool(sig[n-1]))
        # 量不够 → 不成立
        ind['volume'][n-1] = 140.0
        self.assertFalse(bool(detect(self.pid, ind)[n-1]))
        # 昨日已在均线上方（不是金叉当天） → 不成立
        ind['volume'][n-1] = 160.0
        ind['ma5'][n-2] = 10.1
        self.assertFalse(bool(detect(self.pid, ind)[n-1]))


class TurtleTradeTests(unittest.TestCase):
    pid = 'sqxm_turtle_trade'

    def test_requires_new_high_amount_and_yang(self):
        n = 40
        ind = base_ind(n)
        ind['high'][-25:-1] = 10.05          # 前 20 日最高（不含当日）
        ind['open'][n-1] = 10.0
        ind['close'][n-1] = 10.5
        ind['high'][n-1] = 10.6
        ind['prev_close'][n-1] = 10.0
        ind['amount'][n-1] = 1.2e8
        self.assertTrue(bool(detect(self.pid, ind)[n-1]))
        # 成交额不足 1 亿 → 不成立
        ind['amount'][n-1] = 0.9e8
        self.assertFalse(bool(detect(self.pid, ind)[n-1]))
        # 收阴 → 不成立
        ind['amount'][n-1] = 1.2e8
        ind['close'][n-1] = 9.9
        self.assertFalse(bool(detect(self.pid, ind)[n-1]))
        # 没收在昨收之上 → 不成立
        ind['close'][n-1] = 10.2
        ind['prev_close'][n-1] = 10.3
        self.assertFalse(bool(detect(self.pid, ind)[n-1]))


class HighTightFlagTests(unittest.TestCase):
    pid = 'sqxm_high_tight_flag'

    def test_requires_momentum_tightness_and_shrink(self):
        n = 60
        ind = base_ind(n)
        h, l = ind['high'], ind['low']
        # 旗杆：0~39 从 10.2 涨到 20，最低 9.0（40 日振幅 2.2 倍 > 1.6）
        h[:40] = np.linspace(10.2, 20.0, 40)
        l[:40] = 9.0
        # 旗面：50~59 在 19.6~20.0 窄幅整理（10 日振幅 1.02 < 1.15）
        h[40:60] = np.linspace(19.9, 20.0, 20)
        l[40:60] = 19.6
        ind['close'][-1] = 19.9
        ind['high'][-1] = 20.0
        ind['low'][-1] = 19.7
        ind['vma20'][-1] = 100.0
        ind['volume'][-1] = 50.0             # 0.5 倍 → 缩量成立
        self.assertTrue(bool(detect(self.pid, ind)[n-1]))
        # 不缩量 → 不成立
        ind['volume'][-1] = 80.0
        self.assertFalse(bool(detect(self.pid, ind)[n-1]))

    def test_short_history_returns_all_false(self):
        ind = base_ind(20)
        sig = detect(self.pid, ind)
        self.assertEqual(len(sig), 20)
        self.assertFalse(bool(sig.any()))


class LimitUpShakeoutTests(unittest.TestCase):
    pid = 'sqxm_limit_up_shakeout'

    def test_requires_limit_up_then_shakeout(self):
        n = 10
        ind = base_ind(n)
        ind['close'][n-3], ind['close'][n-2] = 10.0, 11.0      # 昨涨停 +10%
        ind['open'][n-1], ind['close'][n-1] = 11.2, 11.0       # 今日收阴
        ind['volume'][n-2], ind['volume'][n-1] = 100.0, 250.0  # 放量 2.5 倍
        ind['low'][n-1] = 11.0                                 # 最低不破昨收
        self.assertTrue(bool(detect(self.pid, ind)[n-1]))
        # 最低跌破昨收 → 不成立
        ind['low'][n-1] = 10.9
        self.assertFalse(bool(detect(self.pid, ind)[n-1]))
        # 缩量 → 不成立
        ind['low'][n-1] = 11.0
        ind['volume'][n-1] = 150.0
        self.assertFalse(bool(detect(self.pid, ind)[n-1]))
        # 今日收阳 → 不成立
        ind['close'][n-1] = 11.3
        ind['volume'][n-1] = 250.0
        self.assertFalse(bool(detect(self.pid, ind)[n-1]))


class UptrendLimitDownTests(unittest.TestCase):
    pid = 'sqxm_uptrend_limit_down'

    def test_requires_uptrend_then_limit_down_on_volume(self):
        n = 80
        ind = base_ind(n)
        ind['ma20'][:] = 11.0
        ind['ma60'][:] = 10.0
        ind['close'][n-2] = 11.0
        ind['close'][n-1] = 9.9            # -10%
        ind['vma20'][n-1] = 100.0
        ind['volume'][n-1] = 250.0
        self.assertTrue(bool(detect(self.pid, ind)[n-1]))
        # 趋势不在多头（昨日 ma20 < ma60） → 不成立
        ind['ma20'][n-2] = 9.0
        self.assertFalse(bool(detect(self.pid, ind)[n-1]))
        ind['ma20'][n-2] = 11.0
        # 量不够 → 不成立
        ind['volume'][n-1] = 150.0
        self.assertFalse(bool(detect(self.pid, ind)[n-1]))


class RpsBreakoutTests(unittest.TestCase):
    pid = 'sqxm_rps_breakout'

    def test_silent_without_threshold(self):
        n = 200
        ind = base_ind(n)
        ind['hh120'] = np.full(n, 10.0)
        sig = detect(self.pid, ind)
        self.assertFalse(bool(sig.any()))

    def test_requires_market_rank_and_near_high(self):
        n = 200
        ind = base_ind(n)
        c = np.linspace(8.0, 10.0, n)          # 120 日涨幅约 +25%
        ind['close'] = c
        ind['hh120'] = np.full(n, 10.0)
        ind['rps120_p90'] = np.full(n, 0.10)   # 90 分位阈值 10%
        sig = detect(self.pid, ind)
        self.assertTrue(bool(sig[n-1]))        # 涨幅达标且收在 120 日最高的 90% 以上
        # 收在 120 日最高的 90% 以下 → 不成立
        ind['hh120'] = np.full(n, 12.0)        # 10.0 < 12.0×0.9
        self.assertFalse(bool(detect(self.pid, ind)[n-1]))
        # 涨幅低于阈值 → 不成立
        ind['hh120'] = np.full(n, 10.0)
        ind['rps120_p90'] = np.full(n, 0.50)
        self.assertFalse(bool(detect(self.pid, ind)[n-1]))


if __name__ == '__main__':
    unittest.main()
