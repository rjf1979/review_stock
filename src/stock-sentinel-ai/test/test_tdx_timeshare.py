# -*- coding: utf-8 -*-
"""tdx_timeshare（历史分时 .fs 数据集）的独立测试。

全部用合成数据，不联网、不读项目行情库：

    python -m pytest test/test_tdx_timeshare.py -q
    python -m unittest test.test_tdx_timeshare -v
"""
from __future__ import annotations

import os
import shutil
import tempfile
import unittest
from pathlib import Path

sys_path_root = Path(__file__).resolve().parents[1]
import sys  # noqa: E402

sys.path.insert(0, str(sys_path_root / 'tools'))

from tdx_timeshare import (GRID, REC_SIZE, SLOTS, append_day, dataset_summary,  # noqa: E402
                           dates_in_file, file_for, grid_times, last_date, load_day,
                           load_file, market_of, pack_day, verify_file)

# 临时树放工作区内（.runtime 已 gitignore）：受限沙箱下系统临时目录无法再建子目录
TMP_BASE = Path(os.environ.get('TDX_TIMESHARE_TEST_TMP')
                or sys_path_root / '.runtime' / 'test-tmp-timeshare')


def prices_at(base: float = 10.0):
    return [round(base + i * 0.01, 2) for i in range(SLOTS)]


def volumes_at(start: int = 100):
    return [start + (i % 50) for i in range(SLOTS)]


class TimeshareFormatTests(unittest.TestCase):
    def setUp(self):
        TMP_BASE.mkdir(parents=True, exist_ok=True)
        self.root = tempfile.mkdtemp(prefix='ts-', dir=str(TMP_BASE))

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    # ── 网格与常量 ──────────────────────────────────────────
    def test_grid_shape(self):
        self.assertEqual(len(GRID), SLOTS)
        self.assertEqual(grid_times(), GRID)
        self.assertEqual(GRID[0], 931)
        self.assertEqual(GRID[119], 1130)      # 上午最后一槽
        self.assertEqual(GRID[120], 1301)      # 下午第一槽
        self.assertEqual(GRID[-1], 1500)
        self.assertEqual(list(GRID), sorted(GRID), '网格必须严格递增')
        self.assertEqual(REC_SIZE, 16)

    def test_market_of(self):
        self.assertEqual(market_of('600519'), 'sh')
        self.assertEqual(market_of('000001'), 'sz')
        self.assertEqual(market_of('300750'), 'sz')
        self.assertEqual(market_of('920002'), 'bj')
        self.assertEqual(market_of('430047'), 'bj')

    # ── 打包/追加/读取 ──────────────────────────────────────
    def test_pack_day_layout(self):
        blob = pack_day(20210104, prices_at(10.0), volumes_at(100))
        self.assertEqual(len(blob), SLOTS * REC_SIZE)
        import struct
        d, t, _r, cent, vol = struct.unpack_from('<IHHiI', blob, 0)
        self.assertEqual((d, t, cent, vol), (20210104, 931, 1000, 100))
        d2, t2, _r2, cent2, _v2 = struct.unpack_from('<IHHiI', blob, REC_SIZE)
        self.assertEqual((d2, t2, cent2), (20210104, 932, 1001))

    def test_pack_day_rejects_bad_input(self):
        with self.assertRaises(ValueError):
            pack_day(20210104, prices_at()[:-1], volumes_at())
        with self.assertRaises(ValueError):
            pack_day(20210104, [10.005] + prices_at()[1:], volumes_at())   # 不在 0.01 网格

    def test_append_and_read_round_trip(self):
        path = file_for('600519', self.root)
        append_day(path, 20210104, prices_at(10.0), volumes_at(100))
        append_day(path, 20210105, prices_at(20.0), volumes_at(200))
        self.assertEqual(last_date(path), 20210105)
        self.assertEqual(dates_in_file(path), [20210104, 20210105])

        m = load_file(path)
        self.assertEqual(len(m['date']), SLOTS * 2)
        self.assertEqual(m['path'], path)
        self.assertEqual(m['code'], '600519')
        self.assertAlmostEqual(float(m['price'][0]), 10.0, places=6)
        self.assertAlmostEqual(float(m['price'][SLOTS]), 20.0, places=6)
        self.assertAlmostEqual(float(m['volume'][-1]), float(volumes_at(200)[-1]), places=6)

        d = load_day(path, 20210105)
        self.assertEqual(len(d['price']), SLOTS)
        self.assertEqual(list(d['time']), list(GRID))
        self.assertAlmostEqual(float(d['price'][0]), 20.0, places=6)
        self.assertEqual(load_day(path, 20210106), {})
        self.assertEqual(load_file(os.path.join(self.root, 'nope.fs')), {})

    def test_append_rejects_out_of_order(self):
        path = file_for('600519', self.root)
        append_day(path, 20210105, prices_at(), volumes_at())
        with self.assertRaises(ValueError):
            append_day(path, 20210104, prices_at(), volumes_at())
        with self.assertRaises(ValueError):
            append_day(path, 20210105, prices_at(), volumes_at())

    def test_market_directory_layout(self):
        self.assertEqual(file_for('600519', self.root),
                         os.path.join(self.root, 'fs', 'sh', 'sh600519.fs'))
        self.assertEqual(file_for('300750', self.root),
                         os.path.join(self.root, 'fs', 'sz', 'sz300750.fs'))

    # ── 自检 ────────────────────────────────────────────────
    def test_verify_good_file(self):
        path = file_for('600519', self.root)
        append_day(path, 20210104, prices_at(), volumes_at())
        append_day(path, 20210105, prices_at(), volumes_at())
        rep = verify_file(path)
        self.assertTrue(rep['ok'], rep['errors'])
        self.assertEqual(rep['records'], SLOTS * 2)
        self.assertEqual(rep['days'], 2)
        self.assertEqual((rep['date_min'], rep['date_max']), (20210104, 20210105))
        self.assertEqual(rep['counts']['grid_mismatch_days'], 0)
        self.assertEqual(rep['counts']['bad_price'], 0)

    def test_verify_detects_structural_errors(self):
        # 长度非 16 整数倍
        path = os.path.join(self.root, 'fs', 'sh', 'sh600001.fs')
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'wb') as f:
            f.write(pack_day(20210104, prices_at(), volumes_at()) + b'\x00\x01\x02')
        rep = verify_file(path)
        self.assertFalse(rep['ok'])
        self.assertEqual(rep['trailing_bytes'], 3)
        self.assertTrue(any('整数倍' in e for e in rep['errors']), rep['errors'])

        # 时间网格不符（把第二槽的 time 字段改掉；布局 date(4) time(2) reserved(2) price(4) vol(4)）
        import struct
        path2 = os.path.join(self.root, 'fs', 'sh', 'sh600002.fs')
        blob = bytearray(pack_day(20210104, prices_at(), volumes_at()))
        struct.pack_into('<H', blob, REC_SIZE + 4, 1234)
        with open(path2, 'wb') as f:
            f.write(bytes(blob))
        rep2 = verify_file(path2)
        self.assertFalse(rep2['ok'])
        self.assertEqual(rep2['counts']['grid_mismatch_days'], 1)

        # 槽数不足（只写 239 条）
        path3 = os.path.join(self.root, 'fs', 'sh', 'sh600003.fs')
        blob3 = pack_day(20210104, prices_at(), volumes_at())[:REC_SIZE * (SLOTS - 1)]
        with open(path3, 'wb') as f:
            f.write(blob3)
        rep3 = verify_file(path3)
        self.assertFalse(rep3['ok'])
        self.assertEqual(rep3['counts']['slot_mismatch_days'], 1)

        # 价格不在网格（直接构造 0 价格）
        path4 = os.path.join(self.root, 'fs', 'sh', 'sh600004.fs')
        blob4 = bytearray(pack_day(20210104, prices_at(), volumes_at()))
        struct.pack_into('<i', blob4, 8, 0)
        with open(path4, 'wb') as f:
            f.write(bytes(blob4))
        rep4 = verify_file(path4)
        self.assertFalse(rep4['ok'])
        self.assertEqual(rep4['counts']['bad_price'], 1)

    def test_verify_missing_and_days_check(self):
        rep = verify_file(file_for('601398', self.root))
        self.assertFalse(rep['ok'])
        self.assertIn('文件不存在', rep['errors'])

        path = file_for('600519', self.root)
        append_day(path, 20210104, prices_at(), volumes_at())
        rep2 = verify_file(path, expected_days=[20210104, 20210105])
        self.assertTrue(rep2['ok'], rep2['errors'])
        self.assertEqual(rep2['counts']['missing_days'], 1)
        self.assertTrue(any('缺 1 天' in w for w in rep2['warnings']), rep2['warnings'])

    def test_zero_volume_is_warning_only(self):
        vols = volumes_at()
        vols[239] = 0        # 15:00 集合竞价槽常态为 0
        path = file_for('600519', self.root)
        append_day(path, 20210104, prices_at(), vols)
        rep = verify_file(path)
        self.assertTrue(rep['ok'], rep['errors'])
        self.assertEqual(rep['counts']['zero_volume'], 1)
        self.assertTrue(any('集合竞价' in w for w in rep['warnings']), rep['warnings'])

    # ── 数据集概览 ──────────────────────────────────────────
    def test_dataset_summary(self):
        for code in ('600519', '600000'):
            append_day(file_for(code, self.root), 20210104, prices_at(), volumes_at())
        append_day(file_for('300750', self.root), 20210104, prices_at(), volumes_at())
        (Path(self.root) / 'calendar.txt').write_text('20210104\n20210105\n', encoding='utf-8')
        s = dataset_summary(self.root)
        self.assertEqual(s['calendar_days'], 2)
        self.assertEqual(s['date_min'], 20210104)
        self.assertEqual(s['codes_by_market'], {'sh': 2, 'sz': 1})
        self.assertEqual(s['code_files'], 3)
        self.assertEqual(s['bytes'], REC_SIZE * SLOTS * 3)


if __name__ == '__main__':
    unittest.main()
