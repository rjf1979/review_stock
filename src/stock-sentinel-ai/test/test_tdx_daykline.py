# -*- coding: utf-8 -*-
"""collect_tdx_daykline 的独立测试（不联网、不读项目行情库）。

    python -m pytest test/test_tdx_daykline.py -q
    python -m unittest test.test_tdx_daykline -v
"""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))

from collect_tdx_daykline import (U32MAX, day_path, pack_day, read_day,  # noqa: E402
                                  to_rows, vol_ok, write_atomic)

TMP_BASE = Path(os.environ.get('TDX_DAYK_TEST_TMP') or ROOT / '.runtime' / 'test-tmp-dayk')


def bar(date, o, h, l, c, vol_lot, amount=1000.0):
    return {'datetime': '%s-01-01 15:00' % date, 'open': o, 'high': h, 'low': l, 'close': c,
            'vol': vol_lot, 'amount': amount, 'year': int(date[:4]), 'month': 1, 'day': 1}


class DayKlineTests(unittest.TestCase):
    def setUp(self):
        TMP_BASE.mkdir(parents=True, exist_ok=True)
        self.root = tempfile.mkdtemp(prefix='dayk-', dir=str(TMP_BASE))

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    # ── 单位与清洗 ──────────────────────────────────────────
    def test_volume_lot_to_share(self):
        rows = to_rows([bar('2026-09-21', 10.0, 10.5, 9.8, 10.2, 12345)], 'sh', '600000')
        self.assertEqual(len(rows), 1)
        date, o, h, l, c, amount, vol, res = rows[0]
        self.assertEqual(date, 20260921)
        self.assertEqual((o, h, l, c), (1000, 1050, 980, 1020))
        self.assertEqual(vol, 12345 * 100, 'vol 源单位是手，落盘必须是股')
        self.assertAlmostEqual(amount, 1000.0)
        self.assertEqual(res, 0)

    def test_amount_keeps_fraction(self):
        # 回归：pack_day 早期版本对 r[1:] 统一 int()，把成交额小数截掉
        rows = to_rows([bar('2026-09-21', 10.0, 10.5, 9.8, 10.2, 1, amount=1234567.75)],
                       'sh', '600000')
        path = day_path(self.root, 'sh', '600000')
        write_atomic(path, pack_day(rows))
        back = read_day(path)
        self.assertAlmostEqual(back[0][5], 1234567.75, places=1)

    def test_skips_invalid_bars(self):
        bad = [
            bar('2026-09-21', 0, 10, 9, 10, 1),          # 价格 0
            bar('2026-09-22', 10, 9, 11, 10, 1),         # high < low
            bar('2026-09-23', 10, 10.1, 9.9, 10.5, 1),   # high < close
            bar('2026-09-24', 10, 10.1, 9.9, 9.5, 1),    # low > close
        ]
        self.assertEqual(to_rows(bad, 'sh', '600000'), [])
        rows = to_rows(bad + [bar('2026-09-25', 10, 10.1, 9.9, 10.0, 1)], 'sh', '600000')
        self.assertEqual([r[0] for r in rows], [20260925])

    def test_dedup_and_sort(self):
        rows = to_rows([bar('2026-09-22', 20, 20.1, 19.9, 20.0, 1),
                        bar('2026-09-21', 10, 10.1, 9.9, 10.0, 1),
                        bar('2026-09-22', 30, 30.1, 29.9, 30.0, 1)], 'sh', '600000')
        self.assertEqual([r[0] for r in rows], [20260921, 20260922])
        self.assertEqual(rows[-1][1], 3000, '同日重复应保留后写入的那条')

    # ── 成交量 u32 上限（.day 容量限制）────────────────────
    def test_volume_clamped_above_u32(self):
        clamped = []
        rows = to_rows([bar('2025-10-14', 2.9, 3.07, 2.88, 2.91, 51712528)], 'sh', '600010',
                       clamped=clamped)
        self.assertEqual(rows[0][6], U32MAX, '超 u32 必须钳到上限，不能回绕')
        self.assertEqual(len(clamped), 1)
        self.assertEqual(clamped[0]['trueShares'], 5171252800)
        self.assertEqual(clamped[0]['code'], 'sh600010')
        # 不越界的根不得被登记
        clamped2 = []
        to_rows([bar('2026-09-21', 2.9, 3.0, 2.8, 2.9, 100)], 'sh', '600010', clamped=clamped2)
        self.assertEqual(clamped2, [])

    def test_pack_day_rejects_out_of_range(self):
        with self.assertRaises(ValueError):
            pack_day([(20260921, 10, 10, 10, 10, 1.0, U32MAX + 1, 0)])

    # ── 量差容差规则 ────────────────────────────────────────
    def test_vol_ok_rule(self):
        self.assertTrue(vol_ok(1_000_000, 1_000_050), '1 手以内截断应通过')
        self.assertTrue(vol_ok(3_607_390_800, 3_607_391_028), '大值走相对容差（float32 精度）')
        self.assertFalse(vol_ok(1_000_000, 1_000_500), '超过 1 手应判不通过')
        self.assertFalse(vol_ok(U32MAX, 51_712_529), '钳制根不算通过')

    # ── 落盘与读取 ──────────────────────────────────────────
    def test_path_layout_and_round_trip(self):
        path = day_path(self.root, 'sh', '600519')
        self.assertEqual(path, os.path.join(self.root, 'sh', 'lday', 'sh600519.day'))
        rows = to_rows([bar('2026-09-21', 1259.0, 1259.95, 1250.8, 1252.57, 25016, 3135910144.0)],
                       'sh', '600519')
        write_atomic(path, pack_day(rows))
        self.assertEqual(os.path.getsize(path), 32)
        back = read_day(path)
        self.assertEqual(len(back), 1)
        self.assertEqual(back[0][:5], (20260921, 125900, 125995, 125080, 125257))
        self.assertEqual(back[0][6], 2501600)

    def test_read_day_missing_and_empty(self):
        self.assertEqual(read_day(os.path.join(self.root, 'nope.day')), [])
        path = day_path(self.root, 'sz', '000001')
        write_atomic(path, b'')
        self.assertEqual(read_day(path), [])

    # ── 结构校验 ────────────────────────────────────────────
    def test_verify_all_structure(self):
        from collect_tdx_daykline import Log, verify_all
        rows = to_rows([bar('2026-09-21', 10, 10.5, 9.5, 10.2, 100),
                        bar('2026-09-22', 10.2, 10.9, 10.0, 10.8, 120)], 'sh', '600001')
        write_atomic(day_path(self.root, 'sh', '600001'), pack_day(rows))
        # 写一个坏文件（长度不是 32 的倍数）
        bad = day_path(self.root, 'sh', '600002')
        write_atomic(bad, pack_day(rows) + b'\x00')
        log = Log()
        code = verify_all(self.root, log, sample=0)
        self.assertEqual(code, 1, '存在结构异常时应返回非 0')

    def test_verify_all_clean(self):
        from collect_tdx_daykline import Log, verify_all
        rows = to_rows([bar('2026-09-21', 10, 10.5, 9.5, 10.2, 100)], 'sz', '000001')
        write_atomic(day_path(self.root, 'sz', '000001'), pack_day(rows))
        self.assertEqual(verify_all(self.root, Log(), sample=0), 0)


if __name__ == '__main__':
    unittest.main()
