# -*- coding: utf-8 -*-
"""
核验 data/hsjday 目录中的通达信日线数据完整性。

只读，不修改任何文件。
检查项：
  1. 目录结构与文件命名是否符合通达信 vipdoc 规范
  2. 每个 .day 文件是否为合法 32 字节定长记录
  3. 日期范围、K线根数分布
  4. 覆盖到 2000 年及更早的股票数量
  5. 最新数据日期（判断是否已更新到最近交易日）
  6. 字段合理性抽样（OHLC 关系、成交量非负）
  7. 区分个股与指数/基金/债券
"""
import os
import struct
import sys
from collections import Counter, defaultdict

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'hsjday')
ROOT = os.path.normpath(ROOT)

REC = 32
# 通达信 .day 定长 32 字节：
#   [0-3]  日期 uint32 YYYYMMDD
#   [4-7]  开盘 uint32  ×100
#   [8-11] 最高 uint32  ×100
#   [12-15]最低 uint32  ×100
#   [16-19]收盘 uint32  ×100
#   [20-23]成交额 float32 元
#   [24-27]成交量 uint32 股
#   [28-31]保留
UNPACK = struct.Struct('<IIIIIfII').unpack_from


def read_day(path):
    """返回 [(date, open, high, low, close, amount, volume), ...]"""
    with open(path, 'rb') as f:
        raw = f.read()
    n = len(raw) // REC
    if n == 0:
        return []
    out = []
    for i in range(n):
        d, o, h, l, c, amt, vol, _ = UNPACK(raw, i * REC)
        out.append((d, o / 100.0, h / 100.0, l / 100.0, c / 100.0, amt, vol))
    return out


def classify(market, code):
    """按沪深代码规则分类。返回 stock / b / fund / bond / index / other"""
    if market == 'sh':
        if code.startswith(('60', '68')):                  # 沪主板 / 科创板
            return 'stock'
        if code.startswith('9'):                           # 沪B
            return 'b'
        if code.startswith('5'):                           # 沪基金/ETF
            return 'fund'
        if code.startswith(('1', '0')):                    # 国债/企业债/指数
            return 'bond' if code.startswith('1') else 'index'
        return 'other'
    # 深市
    if code.startswith(('000', '001', '002', '003', '004', '300', '301')):
        return 'stock'
    if code.startswith('2'):                               # 深B
        return 'b'
    if code.startswith(('15', '16', '18')):                # 深基金/ETF
        return 'fund'
    if code.startswith(('1', '39')):                       # 债券/指数
        return 'bond' if code.startswith('1') else 'index'
    return 'other'


def fmt_date(d):
    s = str(d)
    return f'{s[:4]}-{s[4:6]}-{s[6:]}' if len(s) == 8 else f'BAD({d})'


def main():
    if not os.path.isdir(ROOT):
        print(f'目录不存在: {ROOT}')
        return 1
    print(f'核验目录: {ROOT}\n')

    markets = ['sh', 'sz']
    files = []
    for m in markets:
        d = os.path.join(ROOT, m, 'lday')
        if not os.path.isdir(d):
            print(f'  [缺失] {d}')
            continue
        for fn in os.listdir(d):
            if fn.endswith('.day'):
                files.append((m, fn, os.path.join(d, fn)))
    print(f'发现 .day 文件: {len(files)} 个\n')

    # ---------- 1. 命名规范 ----------
    bad_name = [f for m, f, _ in files if not f.startswith(m)]
    if bad_name:
        print(f'1) 命名规范: {len(bad_name)} 个不符合 <market><code>.day，样例 {bad_name[:3]}')
    else:
        print('1) 命名规范: 全部符合 <market><code>.day')

    # ---------- 2. 分类统计 ----------
    cats = Counter()
    parsed = []
    corrupt = []
    for m, fn, p in files:
        code = fn[len(m):-4]
        cats[classify(m, code)] += 1
        parsed.append((m, code, p))

    print('2) 代码分类:')
    label = {'stock': 'A股个股', 'index': '指数', 'fund': '基金/ETF',
             'bond': '债券', 'b': 'B股', 'other': '其他'}
    for k, v in cats.most_common():
        print(f'     {label.get(k, k):<10} {v:>6}')

    # 只看个股
    stocks = [(m, c, p) for m, c, p in parsed if classify(m, c) == 'stock']
    print(f'\n    → 个股（用于回测）: {len(stocks)} 只\n')

    # ---------- 3. 解析全部个股 ----------
    print('3) 解析中...')
    stat = []
    size_bad = []
    for m, code, p in stocks:
        sz = os.path.getsize(p)
        if sz % REC != 0:
            size_bad.append((code, sz))
        rows = read_day(p)
        if not rows:
            corrupt.append((code, '空文件'))
            continue
        first, last = rows[0][0], rows[-1][0]
        # 校验日期升序
        if first > last:
            corrupt.append((code, f'日期倒序 {first}->{last}'))
            continue
        stat.append({
            'code': f'{m}{code}', 'n': len(rows), 'first': first, 'last': last,
            'rows': rows,
        })

    print(f'   解析成功: {len(stat)}  损坏/异常: {len(corrupt)}'
          f'  非32字节整数倍: {len(size_bad)}')
    if corrupt[:5]:
        print(f'   异常样例: {corrupt[:5]}')
    if size_bad[:5]:
        print(f'   尺寸异常样例: {size_bad[:5]}')

    if not stat:
        print('无有效数据，终止。')
        return 1

    # ---------- 4. 日期覆盖 ----------
    firsts = Counter(s['first'] for s in stat)
    lasts = Counter(s['last'] for s in stat)
    print(f'\n4) 起始日期分布（最早10档）:')
    for d, c in sorted(firsts.items())[:10]:
        print(f'     {fmt_date(d)}  {c:>5} 只')
    print(f'   最新日期分布（最常见5档）:')
    for d, c in lasts.most_common(5):
        print(f'     {fmt_date(d)}  {c:>5} 只')

    n2000 = sum(1 for s in stat if s['first'] <= 20000101)
    n2005 = sum(1 for s in stat if s['first'] <= 20050101)
    print(f'\n   起始 ≤ 2000-01-01: {n2000} 只')
    print(f'   起始 ≤ 2005-01-01: {n2005} 只')

    # ---------- 5. K线根数 ----------
    counts = sorted(s['n'] for s in stat)
    total_bars = sum(counts)
    print(f'\n5) K线根数: 总计 {total_bars:,} 根')
    print(f'   最少 {counts[0]}  中位 {counts[len(counts)//2]}  最多 {counts[-1]}')
    buckets = Counter((n // 1000) for n in counts)
    print('   分档(千根):')
    for k in sorted(buckets):
        print(f'     {k*1000:>5}~{k*1000+999:<5} {buckets[k]:>5} 只')
    ge250 = sum(1 for n in counts if n >= 250)
    print(f'   ≥250 根（回测门槛）: {ge250} 只')

    # ---------- 6. 字段合理性抽样 ----------
    print(f'\n6) 字段合理性（全量校验）:')
    bad_ohlc = bad_neg = bad_date = bad_zero = 0
    for s in stat:
        for d, o, h, l, c, amt, vol in s['rows']:
            if not (19000101 <= d <= 21001231):
                bad_date += 1
            if not (0 < l <= o <= h and 0 < l <= c <= h):
                bad_ohlc += 1
            if o <= 0 or h <= 0 or l <= 0 or c <= 0:
                bad_zero += 1
            if o < 0 or c < 0 or vol < 0 or amt < 0:
                bad_neg += 1
    print(f'   日期越界: {bad_date}')
    print(f'   OHLC 关系异常(非 0<low<=open,close<=high): {bad_ohlc}')
    print(f'   价格非正: {bad_zero}')
    print(f'   负值: {bad_neg}')

    # ---------- 7. 抽样展示 ----------
    print(f'\n7) 抽样:')
    for code in ['sh600519', 'sz000001', 'sh600000', 'sz300059', 'sh601398']:
        s = next((x for x in stat if x['code'] == code), None)
        if not s:
            print(f'   {code}: 未找到')
            continue
        d, o, h, l, c, amt, vol = s['rows'][-1]
        print(f'   {code}  {s["n"]:>5}根  {fmt_date(s["first"])}~{fmt_date(s["last"])}  '
              f'最新: {fmt_date(d)} 开{o:.2f} 高{h:.2f} 低{l:.2f} 收{c:.2f} '
              f'量{vol/100:.0f}手 额{amt/1e8:.2f}亿')

    # ---------- 结论 ----------
    print('\n' + '=' * 60)
    latest = max(s['last'] for s in stat)
    print(f'结论:')
    print(f'  个股 {len(stat)} 只，共 {total_bars:,} 根日K')
    print(f'  覆盖起始: 最早 {fmt_date(min(s["first"] for s in stat))}')
    print(f'  最新日期: {fmt_date(latest)}')
    print(f'  可作为回测数据源: {"是" if ge250 > 3000 and not corrupt else "需确认"}')
    print('=' * 60)
    return 0


if __name__ == '__main__':
    sys.exit(main())
