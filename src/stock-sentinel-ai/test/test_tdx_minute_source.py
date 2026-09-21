# -*- coding: utf-8 -*-
"""tdx_minute 双后缀（.lc1/.lc5 与 .01/.5）与格式自检的独立测试。

全部使用临时目录里的合成 32 字节记录，不读取项目行情库、不依赖本机通达信，
因此可以在任何机器上跑：

    python -m pytest test/test_tdx_minute_source.py -q
    python -m unittest test.test_tdx_minute_source -v
"""
from __future__ import annotations

import os
import shutil
import struct
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))

from tdx_minute import (ALL_MARKETS, DEFAULT_MARKETS, REC, code_market,  # noqa: E402
                        load_minute, minute_codes, minute_file_map, minute_paths,
                        has_minute, resolve_minute_file, verify_buffer,
                        verify_minute_file)

# 临时树放在工作区内的 .runtime/（已 gitignore），可用环境变量覆盖。
# 不用系统临时目录：在受限沙箱下那里无法再建子目录。
TMP_BASE = Path(os.environ.get('TDX_MINUTE_TEST_TMP')
                or Path(__file__).resolve().parents[1] / '.runtime' / 'test-tmp')


def rec(ymd: int, hhmm: int, o: float, h: float, low: float, c: float,
        amount: float = 0.0, volume: int = 0) -> bytes:
    """按通达信 32 字节定长格式编码一条分钟线记录（客户端布局：float32 元）。"""
    year, month, day = ymd // 10000, ymd // 100 % 100, ymd % 100
    d = (year - 2004) * 2048 + month * 100 + day
    t = (hhmm // 100) * 60 + hhmm % 100
    return struct.pack('<HHfffffII', d, t, o, h, low, c, amount, volume, 0)


def rec_cent(ymd: int, hhmm: int, o: float, h: float, low: float, c: float,
             amount: float = 0.0, volume: int = 0) -> bytes:
    """编码 datatool 布局的记录：OHLC 为 int32「分」（价格 × 100），其余同上。"""
    year, month, day = ymd // 10000, ymd // 100 % 100, ymd % 100
    d = (year - 2004) * 2048 + month * 100 + day
    t = (hhmm // 100) * 60 + hhmm % 100
    return struct.pack('<HHiiii fII'.replace(' ', ''), d, t,
                       round(o * 100), round(h * 100), round(low * 100), round(c * 100),
                       amount, volume, 0)


def day_bars(ymd: int, minutes=(931, 932, 933), base: float = 10.0) -> bytes:
    out = b''
    for i, hhmm in enumerate(minutes):
        o = base + i * 0.1
        out += rec(ymd, hhmm, o, o + 0.05, o - 0.05, o + 0.02, amount=1000.0, volume=100 + i)
    return out


def day_bars_cent(ymd: int, minutes=(931, 932, 933), base: float = 10.0) -> bytes:
    out = b''
    for i, hhmm in enumerate(minutes):
        o = base + i * 0.1
        out += rec_cent(ymd, hhmm, o, o + 0.05, o - 0.05, o + 0.02, amount=1000.0, volume=100 + i)
    return out


class TdxMinuteSourceTests(unittest.TestCase):
    def setUp(self):
        TMP_BASE.mkdir(parents=True, exist_ok=True)
        self.root = tempfile.mkdtemp(prefix='tdxmin-', dir=str(TMP_BASE))
        self.vip = os.path.join(self.root, 'vipdoc')
        for market in ('sh', 'sz', 'bj'):
            for sub in ('minline', 'fzline'):
                os.makedirs(os.path.join(self.vip, market, sub), exist_ok=True)
        # 基准口径：客户端盘后下载
        self.write('sh', 'minline', 'sh600519.lc1', day_bars(20260918) + day_bars(20260919))
        self.write('sh', 'fzline', 'sh600519.lc5', day_bars(20260918))
        # datatool 口径：分笔转档（int32 分布局）
        self.write('sh', 'minline', 'sh600519.01', day_bars_cent(20260918))
        # 只有 datatool 后缀的代码
        self.write('sz', 'minline', 'sz000001.01', day_bars_cent(20260918))
        # 只有基准后缀的代码
        self.write('sz', 'minline', 'sz000002.lc1', day_bars(20260918))
        # 北交所
        self.write('bj', 'minline', 'bj920002.lc1', day_bars(20260918))
        # 非 A 股代码应被忽略
        self.write('sh', 'minline', 'sh510300.lc1', day_bars(20260918))

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def write(self, market: str, sub: str, name: str, blob: bytes):
        with open(os.path.join(self.vip, market, sub, name), 'wb') as f:
            f.write(blob)

    # ── 市场判定 ──────────────────────────────────────────────
    def test_code_market(self):
        self.assertEqual(code_market('600519'), 'sh')
        self.assertEqual(code_market('688981'), 'sh')
        self.assertEqual(code_market('000001'), 'sz')
        self.assertEqual(code_market('300750'), 'sz')
        self.assertEqual(code_market('920002'), 'bj')
        self.assertEqual(code_market('430047'), 'bj')
        self.assertEqual(code_market('831010'), 'bj')
        self.assertEqual(code_market('873169'), 'bj')
        # 板块指数 88xxxx 与沪 B 股 90xxxx 仍属沪市，不得误判为北交所
        self.assertEqual(code_market('880301'), 'sh')
        self.assertEqual(code_market('900901'), 'sh')

    # ── 路径解析与优先级 ──────────────────────────────────────
    def test_minute_paths_order(self):
        paths = minute_paths('600519', 1, self.root)
        self.assertTrue(paths[0].endswith('.lc1'), paths)
        self.assertTrue(paths[1].endswith('.01'), paths)
        fz = minute_paths('600519', 5, self.root)
        self.assertTrue(fz[0].endswith('.lc5'), fz)
        self.assertTrue(fz[1].endswith('.5'), fz)

    def test_prefers_lc1_then_falls_back_to_01(self):
        path, suffix = resolve_minute_file('600519', 1, self.root)
        self.assertTrue(path.endswith('.lc1'))
        self.assertEqual(suffix, '.lc1')
        path, suffix = resolve_minute_file('000001', 1, self.root)
        self.assertTrue(path.endswith('.01'))
        self.assertEqual(suffix, '.01')
        # 都不存在
        self.assertEqual(resolve_minute_file('601398', 1, self.root), ('', ''))
        self.assertEqual(minute_paths('601398', 1, self.root)[0]
                         , os.path.join(self.vip, 'sh', 'minline', 'sh601398.lc1'))

    def test_short_file_falls_through_to_next_suffix(self):
        # 首选后缀存在但不足一条记录时，应退到下一套可用后缀
        self.write('sz', 'minline', 'sz000002.01', b'\x00' * 4)
        path, suffix = resolve_minute_file('000002', 1, self.root)
        self.assertTrue(path.endswith('.lc1'), path)
        self.assertEqual(suffix, '.lc1')

    def test_has_minute(self):
        self.assertTrue(has_minute('600519', 1, self.root))
        self.assertTrue(has_minute('000001', 1, self.root))
        self.assertFalse(has_minute('601398', 1, self.root))

    # ── 清单与来源标记 ────────────────────────────────────────
    def test_minute_file_map_and_codes(self):
        fmap = minute_file_map(1, self.root)
        self.assertEqual(fmap.get('600519'), '.lc1')
        self.assertEqual(fmap.get('000001'), '.01')
        self.assertEqual(fmap.get('000002'), '.lc1')
        self.assertNotIn('510300', fmap, '非 A 股代码不应进入清单')
        self.assertNotIn('920002', fmap, '默认市场为沪深，北交所不应进入')
        self.assertEqual(minute_codes(1, self.root), ['000001', '000002', '600519'])
        with_bj = minute_codes(1, self.root, ALL_MARKETS)
        self.assertEqual(with_bj, ['000001', '000002', '600519', '920002'])
        self.assertEqual(DEFAULT_MARKETS, ('sh', 'sz'))

    # ── 读取 ─────────────────────────────────────────────────
    def test_load_minute_reports_source_and_filters(self):
        m = load_minute('600519', 1, self.root)
        self.assertEqual(m['source'], '.lc1')
        self.assertEqual(m['origin'], 'tdx-client')
        self.assertEqual(m['priceFormat'], 'float32')
        self.assertTrue(m['path'].endswith('.lc1'))
        self.assertEqual(len(m['date']), 6)          # 两个交易日 × 3 根
        self.assertEqual(list(m['date']), [20260918] * 3 + [20260919] * 3)
        self.assertEqual(list(m['time']), [931, 932, 933] * 2)
        self.assertAlmostEqual(float(m['close'][0]), 10.02, places=4)
        self.assertAlmostEqual(float(m['volume'][0]), 100.0, places=4)

        m = load_minute('000001', 1, self.root)
        self.assertEqual(m['source'], '.01')
        self.assertEqual(m['origin'], 'datatool-tick')
        self.assertEqual(m['priceFormat'], 'int32-cent')
        # int32「分」必须被归一到元，而不是原样输出 1002
        self.assertAlmostEqual(float(m['open'][0]), 10.0, places=6)
        self.assertAlmostEqual(float(m['high'][0]), 10.05, places=6)
        self.assertAlmostEqual(float(m['low'][0]), 9.95, places=6)
        self.assertAlmostEqual(float(m['close'][0]), 10.02, places=6)
        self.assertAlmostEqual(float(m['volume'][0]), 100.0, places=4)

        m = load_minute('600519', 1, self.root, start=20260919)
        self.assertEqual(list(m['date']), [20260919] * 3)
        m = load_minute('600519', 5, self.root)
        self.assertEqual(m['source'], '.lc5')
        self.assertEqual(len(m['date']), 3)

        self.assertEqual(load_minute('601398', 1, self.root), {})

    # ── 价格布局探测（用错布局会静默产出次正规数）───────────
    def test_price_format_detection_both_layouts(self):
        from tdx_minute import detect_price_format, layout_ok_ratio
        fb = day_bars(20260918)
        cb = day_bars_cent(20260918)
        nf, nc = len(fb) // REC, len(cb) // REC
        self.assertEqual(detect_price_format(fb, nf, '.lc1')[0], 'float32')
        self.assertEqual(detect_price_format(cb, nc, '.01')[0], 'int32-cent')
        # 布局与后缀倾向相反时以数据为准
        self.assertEqual(detect_price_format(fb, nf, '.01')[0], 'float32')
        self.assertEqual(detect_price_format(cb, nc, '.lc1')[0], 'int32-cent')
        # 每个文件只应被自己那套布局解释；用错布局必须低分
        self.assertEqual(layout_ok_ratio(fb, nf, 'float32'), 1.0)
        self.assertLess(layout_ok_ratio(fb, nf, 'int32-cent'), 0.99)
        self.assertEqual(layout_ok_ratio(cb, nc, 'int32-cent'), 1.0)
        self.assertLess(layout_ok_ratio(cb, nc, 'float32'), 0.99)

    def test_verify_detects_cent_layout(self):
        rep = verify_minute_file('000001', 1, self.root)
        self.assertTrue(rep['ok'], rep['errors'])
        self.assertEqual(rep['suffix'], '.01')
        self.assertEqual(rep['priceFormat'], 'int32-cent')
        self.assertEqual(rep['priceFormatScores']['int32-cent'], 1.0)

    def test_verify_rejects_file_no_layout_can_explain(self):
        # 回归：把 float32 文件按 float32 解出的价格本身就是次正规数时（例如 OHLC 全 0），
        # 自检必须判不通过，不能因为「量级异常但彼此相等」而误判通过。
        blob = struct.pack('<HHfffffII', 45977, 571, 0.0, 0.0, 0.0, 0.0, 1.0, 5, 0) * 3
        rep = verify_buffer(blob, freq=1, suffix='.01')
        self.assertFalse(rep['ok'])
        self.assertTrue(any('无法用任何已知布局解释' in e for e in rep['errors']), rep['errors'])
        self.assertLess(rep['priceFormatScores']['float32'], 0.99)

    # ── 格式自检 ─────────────────────────────────────────────
    def test_verify_good_file(self):
        rep = verify_minute_file('600519', 1, self.root)
        self.assertTrue(rep['ok'], rep['errors'])
        self.assertEqual(rep['suffix'], '.lc1')
        self.assertEqual(rep['bytes'], 6 * REC)
        self.assertEqual(rep['bars'], 6)
        self.assertEqual(rep['trailing_bytes'], 0)
        self.assertEqual(rep['date_min'], 20260918)
        self.assertEqual(rep['date_max'], 20260919)
        self.assertEqual(rep['days'], 2)
        self.assertEqual(rep['bars_per_day']['mode'], 3)
        self.assertEqual(rep['errors'], [])
        self.assertEqual(rep['candidates'][0][-4:], '.lc1')

    def test_verify_missing_file(self):
        rep = verify_minute_file('601398', 1, self.root)
        self.assertFalse(rep['ok'])
        self.assertIn('未找到任何后缀的分钟线文件', rep['errors'][0])
        self.assertEqual(len(rep['candidates']), 2)

    def test_verify_trailing_bytes(self):
        rep = verify_buffer(day_bars(20260918) + b'\x01\x02\x03', freq=1)
        self.assertFalse(rep['ok'])
        self.assertEqual(rep['trailing_bytes'], 3)
        self.assertTrue(any('整数倍' in e for e in rep['errors']), rep['errors'])

    def test_verify_bad_ohlc_and_sample(self):
        good = rec(20260918, 931, 10.0, 10.2, 9.9, 10.1, 100.0, 10)
        bad = rec(20260918, 932, 10.1, 10.0, 10.3, 10.2, 100.0, 10)   # high < low
        rep = verify_buffer(good + bad, freq=1)
        self.assertFalse(rep['ok'])
        self.assertEqual(rep['counts']['bad_ohlc'], 1)
        self.assertTrue(any('OHLC' in e for e in rep['errors']), rep['errors'])
        self.assertEqual(rep['samples'][0]['rows'][0]['time'], '09:32')

    def test_verify_date_backwards_and_time_backwards(self):
        rep = verify_buffer(day_bars(20260919) + day_bars(20260918), freq=1)
        self.assertFalse(rep['ok'])
        self.assertEqual(rep['counts']['date_backwards'], 1)
        # 同一交易日内时间戳回退
        rep = verify_buffer(rec(20260918, 932, 10, 10, 10, 10, 0, 1)
                            + rec(20260918, 931, 10, 10, 10, 10, 0, 1), freq=1)
        self.assertEqual(rep['counts']['time_backwards'], 1)
        self.assertFalse(rep['ok'])

    def test_verify_off_session_is_warning_only(self):
        # 09:10 早于集合竞价（09:15 起），落在允许区间之外；15:05~15:30 的盘后固定价格
        # 交易属于正常数据，不在此列 → 上界放到 1535。
        self.assertEqual(verify_buffer(day_bars(20260918) + rec(20260918, 1530, 10, 10, 10, 10, 0, 1),
                                       freq=1)['counts'].get('off_session', 0), 0,
                         '15:30 属创业板/科创板盘后交易时段，不应判为越界')
        # 两个交易日根数不同（3 / 2），第二日含一根越界时间戳 → 都只出 warning
        blob = (day_bars(20260918)
                + rec(20260919, 910, 10, 10, 10, 10, 0, 1)
                + day_bars(20260919, minutes=(931,)))
        rep = verify_buffer(blob, freq=1)
        self.assertEqual(rep['counts'].get('off_session'), 1)
        self.assertTrue(any('交易时段' in w for w in rep['warnings']), rep['warnings'])
        self.assertTrue(any('众数' in w for w in rep['warnings']), rep['warnings'])
        self.assertEqual(rep['bars_per_day']['days_off_mode'], 1)
        self.assertTrue(rep['ok'], rep['errors'])

    def test_verify_zero_volume_warning(self):
        rep = verify_buffer(rec(20260918, 931, 10, 10, 10, 10, 0, 0), freq=1)
        self.assertEqual(rep['counts']['zero_volume'], 1)
        self.assertTrue(rep['ok'])

    def test_verify_empty_and_undecodable_date(self):
        rep = verify_buffer(b'', freq=1)
        self.assertFalse(rep['ok'])
        self.assertIn('文件为空', rep['errors'])
        # date 字段 = 0 → 2004 年 0 月 0 日，必须报错
        rep = verify_buffer(struct.pack('<HHfffffII', 0, 570, 10, 10, 10, 10, 1, 1, 0), freq=1)
        self.assertFalse(rep['ok'])
        self.assertEqual(rep['counts']['bad_date'], 1)


if __name__ == '__main__':
    unittest.main()
