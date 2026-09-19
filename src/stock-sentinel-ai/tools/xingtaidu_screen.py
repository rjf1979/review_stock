"""25 图形的独立日线筛选器。只读 CSV；不接入或修改线上选股规则。

运行方法与逐图定义见 docs/xingtaidu-python-guide.md。
所有信号是收盘后条件，形态阈值是工程假设，不是图片提供的胜率。
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from itertools import combinations
import json
from pathlib import Path
import sys

import numpy as np
import pandas as pd


NAMES = dict(zip(
    ('ma_bullish pullback_ma20 ma_golden_start trendline_breakout macd_water_golden '
     'volume_breakout shrink_stabilize dry_price_bottom consecutive_yang strong_sideways '
     'limit_pullback fake_break_pack yang_engulf long_lower_shadow rsi_low_turn '
     'double_bottom arc_bottom rising_w_bottom head_shoulder_bottom second_test '
     'platform_breakout box_breakout ascending_triangle gap_breakout n_shape').split(),
    ('均线多头 回踩20日线 金叉启动 趋势线突破 MACD水上金叉 '
     '放量突破 缩量企稳 地量地价 连阳启动 强势横盘 '
     '涨停回踩 假跌破反包 阳包阴 长下影企稳 RSI低位拐头 '
     '双底起涨 圆弧底 W底突破 头肩底 二次探底 '
     '平台突破 箱体突破 上升三角形 缺口突破 N字突破').split()))


@dataclass(frozen=True)
class Config:
    volume_multiple: float = 1.5  # 当日量 / 此前5根均量，不含当日
    break_buffer: float = 0.003
    support_tolerance: float = 0.02
    bottom_tolerance: float = 0.03
    max_extension: float = 0.08  # 距离关键位过远，仅观察
    max_ma20_extension: float = 0.15

    def __post_init__(self):
        if not np.isfinite(list(self.__dict__.values())).all():
            raise ValueError('参数必须为有限数值')
        if self.volume_multiple <= 1:
            raise ValueError('volume_multiple 必须 > 1')
        for key in ('break_buffer', 'support_tolerance', 'bottom_tolerance',
                    'max_extension', 'max_ma20_extension'):
            if not 0 < getattr(self, key) < 1:
                raise ValueError(f'{key} 必须介于0与1之间')


def prepare(frame: pd.DataFrame) -> pd.DataFrame:
    """校验单股票、已收盘、同一复权口径日线；不填缺值或停牌日。"""
    required = ['date', 'open', 'high', 'low', 'close', 'volume']
    missing = set(required) - set(frame.columns)
    if missing:
        raise ValueError(f'缺少字段: {sorted(missing)}')
    d = frame.copy()
    dates = d.date.astype(str).str.replace('-', '', regex=False)
    d['date'] = pd.to_datetime(dates, format='%Y%m%d', errors='raise')
    if d.date.isna().any() or d.date.duplicated().any():
        raise ValueError('日期缺失或重复')
    d = d.sort_values('date').reset_index(drop=True)
    for key in required[1:]:
        d[key] = pd.to_numeric(d[key], errors='raise')
    values = d[required[1:]].to_numpy(dtype=float)
    if not np.isfinite(values).all():
        raise ValueError('OHLCV 包含 NaN/无穷值')
    if (d[['open', 'high', 'low', 'close']] <= 0).any().any() or (d.volume <= 0).any():
        raise ValueError('价格/成交量须为正；请移除停牌占位行并保留真实交易日期')
    if ((d.high < d[['open', 'close', 'low']].max(axis=1)) |
            (d.low > d[['open', 'close', 'high']].min(axis=1))).any():
        raise ValueError('OHLC 高低关系错误')
    if 'limit_up' in d:
        # 由逐日交易所规则计算的事实；禁止按股票代码猜历史涨停幅度。
        text = d.limit_up.astype(str).str.lower()
        if not text.isin(['0', '1', 'true', 'false']).all():
            raise ValueError('limit_up 只能为0/1/true/false，且须覆盖全部输入日期')
        d['limit_up'] = text.isin(['1', 'true'])
    c = d.close
    for n in (5, 10, 20, 60):
        d[f'ma{n}'] = c.rolling(n).mean()
    d['v5'] = d.volume.shift(1).rolling(5).mean()
    d['dif'] = c.ewm(span=12, adjust=False).mean() - c.ewm(span=26, adjust=False).mean()
    d['dea'] = d.dif.ewm(span=9, adjust=False).mean()
    # Wilder RSI：前14个涨跌简单平均作为种子，再递归。
    delta = c.diff().to_numpy()
    rsi = np.full(len(d), np.nan)
    if len(d) > 14:
        up, down = np.maximum(delta, 0), np.maximum(-delta, 0)
        gain, loss = up[1:15].mean(), down[1:15].mean()
        for i in range(14, len(d)):
            if i > 14:
                gain, loss = (gain * 13 + up[i]) / 14, (loss * 13 + down[i]) / 14
            rsi[i] = 50 if gain == loss == 0 else (100 if loss == 0 else 100 - 100 / (1 + gain / loss))
    d['rsi'] = rsi
    return d


def pivots(values, kind='low', radius=2):
    """仅返回已有右侧radius根确认的拐点；平台等值点不算独立拐点。"""
    a = np.asarray(values)
    out = []
    for i in range(radius, len(a) - radius):
        others = np.r_[a[i-radius:i], a[i+1:i+radius+1]]
        if (a[i] < others.min()) if kind == 'low' else (a[i] > others.max()):
            out.append(i)
    return out


def episodes(mask):
    a = np.asarray(mask, dtype=bool)
    return int(np.count_nonzero(a & ~np.r_[False, a[:-1]]))


def detect_at(prepared: pd.DataFrame, index: int | None = None,
              config: Config | None = None) -> list[dict]:
    """返回指定交易日的形态证据。即使传入完整历史，也严格截断于index。"""
    p = config or Config()
    if index is not None and not 0 <= index < len(prepared):
        raise ValueError('index 越界')
    d = prepared.iloc[:index + 1] if index is not None else prepared
    if len(d) < 60:
        return []
    t, prev = d.iloc[-1], d.iloc[-2]
    prior = d.iloc[:-1]
    result = []
    vr = float(t.volume / t.v5)
    bullish = t.close > t.open and t.close > prev.close
    volume = vr >= p.volume_multiple

    def add(pid, condition, level, invalid, reason, stage='confirmed'):
        if not condition:
            return
        extension = t.close / level - 1
        chase = extension > p.max_extension or t.close / t.ma20 - 1 > p.max_ma20_extension
        one_price = t.high == t.low
        result.append(dict(date=t.date.strftime('%Y-%m-%d'), pattern=pid, name=NAMES[pid],
                           stage=stage, eligible=bool(stage == 'confirmed' and not chase and not one_price),
                           close=float(t.close), key_level=float(level), invalidation=float(invalid),
                           volume_ratio=vr, extension=float(extension),
                           reason=reason, caution=('距关键位/MA20过远；' if chase else '') +
                           ('一字K线，成交受限；' if one_price else '')))

    def broke(level, previous_level=None):
        previous_level = level if previous_level is None else previous_level
        return t.close > level * (1 + p.break_buffer) and prev.close <= previous_level * (1 + p.break_buffer)

    # 1. 均线启动：趋势背景、回踩事件、触发动作分开验证。
    old = d.iloc[-6]
    ordered = t.ma5 > t.ma10 > t.ma20
    rising = all(t[f'ma{n}'] > old[f'ma{n}'] for n in (5, 10, 20))
    widening = t.ma5 / t.ma20 > old.ma5 / old.ma20
    recent = prior.tail(3)
    touch10 = ((recent.low <= recent.ma10 * (1+p.support_tolerance)) &
               (recent.close >= recent.ma10)).any()
    add('ma_bullish', ordered and rising and widening and touch10 and bullish and volume,
        t.ma10, recent.low.min(), '多头发散 + 近3日回踩MA10 + 放量再上攻')
    pull = prior.tail(5)
    touched = ((pull.low <= pull.ma20 * (1+p.support_tolerance)) & (pull.close >= pull.ma20)).any()
    support = (pull.low >= pull.ma20 * (1-p.support_tolerance)).all()
    prior_rise = prior.close.iloc[-20:-5].max() / prior.close.iloc[-30] - 1
    add('pullback_ma20', prior_rise >= .08 and t.ma20 > old.ma20 and touched and support and
        pull.volume.mean() < prior.volume.iloc[-15:-5].mean() * .8 and
        t.close >= t.ma20 and bullish, t.ma20, pull.low.min(),
        '前段涨幅≥8%、MA20向上、回踩守住均线、缩量后收阳回升')
    add('ma_golden_start', prev.ma5 <= prev.ma20 and t.ma5 > t.ma20 and
        t.ma20 >= old.ma20 and volume and bullish, t.ma20, prior.low.tail(5).min(),
        'MA5当天上穿MA20 + MA20不下行 + 放量')
    seg = prior.tail(40).reset_index(drop=True)
    hp = pivots(seg.high, 'high')
    if len(hp) >= 2:
        a, b = hp[-2:]
        slope = (seg.high[b] - seg.high[a]) / (b-a)
        line = seg.high[a] + slope * (len(seg)-a)
        fitted = seg.high[a] + slope * (np.arange(a, len(seg))-a)
        respected = np.all(seg.high.iloc[a:].to_numpy() <= fitted * 1.02)
        add('trendline_breakout', b-a >= 5 and slope < 0 and line > 0 and respected and
            broke(line, line-slope) and volume, line, prior.low.tail(5).min(),
            '两个已确认下降摆动高点连线；此前高点未明显越线；当天首次放量突破')
    add('macd_water_golden', prev.dif <= prev.dea and t.dif > t.dea and
        min(t.dif, t.dea) > 0 and volume and bullish, t.ma20, prior.low.tail(5).min(),
        'DIF/DEA均在零轴上，DIF当天上穿DEA并放量收阳')

    # 2. 量价共振。
    top20 = prior.high.tail(20).max()
    add('volume_breakout', broke(top20) and volume, top20, prior.low.tail(5).min(),
        '收盘突破此前20根最高价0.3%以上，量比达标')
    base, before = prior.tail(8), prior.iloc[-28:-8]
    flat = base.high.max() / base.low.min() - 1 <= .08
    falling = before.close.iloc[-1] / before.close.iloc[0] - 1 <= -.08
    dry = base.volume.mean() <= before.volume.mean() * .65
    add('shrink_stabilize', falling and flat and dry and broke(base.high.max()) and volume,
        base.high.max(), base.low.min(), '前段跌≥8%、8日窄幅缩量平台、当天放量突破')
    low_base = prior.tail(59)
    dry_today = t.close <= low_base.close.min() and t.volume <= low_base.volume.mean() * .5
    add('dry_price_bottom', dry_today, t.close, t.low, '59日收盘新低且量≤此前59日均量一半；尚未反转', 'setup')
    dry_recent = prior.tail(5)
    early = prior.iloc[-59:-5]
    seed = (dry_recent.close <= early.close.min() * 1.01) & (dry_recent.volume <= early.volume.mean() * .5)
    add('dry_price_bottom', seed.any() and broke(dry_recent.high.max()) and volume and bullish,
        dry_recent.high.max(), dry_recent.low.min(), '近5日出现地量低价，现放量突破5日高点')
    ys = prior.tail(3)
    small = ((ys.close > ys.open) & ((ys.close / ys.open - 1) <= .035)).all()
    add('consecutive_yang', small and (np.diff(ys.close) > 0).all() and bullish and
        broke(ys.high.max()) and p.volume_multiple <= vr <= 3,
        ys.high.max(), ys.low.min(), '此前3根小阳线收盘递增，今天温和放量突破')
    base, rise = prior.tail(15), prior.iloc[-35:-15]
    add('strong_sideways', rise.close.iloc[-1] / rise.close.iloc[0] >= 1.15 and
        base.high.max()/base.low.min() <= 1.10 and base.low.min() >= rise.close.iloc[-1]*.90 and
        base.volume.mean() <= rise.volume.mean()*.75 and broke(base.high.max()) and volume,
        base.high.max(), base.low.min(), '前段涨≥15%、高位15日振幅≤10%、缩量后突破')

    # 3. 短线启动。涨停必须来自逐日真实规则标记。
    if 'limit_up' in d:
        anchors = np.flatnonzero(prior.limit_up.to_numpy())
        anchors = anchors[(anchors >= len(d)-16) & (anchors <= len(d)-4)]
        if len(anchors):
            j = int(anchors[-1])
            anchor, after = d.iloc[j], d.iloc[j+1:-1]
            support_price = (anchor.open + anchor.close)/2
            add('limit_pullback', anchor.close > anchor.open and len(after) >= 2 and
                after.low.min() >= support_price*(1-p.support_tolerance) and
                after.low.min() <= anchor.close*(1+p.support_tolerance) and
                after.close.min() < anchor.close and
                after.volume.mean() <= anchor.volume*.7 and bullish and
                t.low >= support_price*(1-p.support_tolerance) and t.close > after.high.tail(2).max(),
                anchor.close, support_price*(1-p.support_tolerance),
                '真实涨停后2—14根回踩，守涨停实体中点、缩量后再上攻')
    support20 = d.low.iloc[-22:-2].min()
    engulf = prev.close < prev.open and t.close > t.open and t.open <= prev.close and t.close >= prev.open
    add('fake_break_pack', prev.low < support20 and prev.low >= support20*.95 and
        engulf and t.close > support20 and volume, support20, min(prev.low, t.low),
        '前一阴线跌破既有20日支撑不超5%，当日阳线反包并收回支撑')
    down_context = prev.close < d.close.iloc[-7]
    add('yang_engulf', engulf and volume and down_context, prev.open, min(prev.low, t.low),
        '前段回落、阴线实体被当前放量阳线实体完全覆盖')
    span = t.high-t.low
    lower = min(t.open, t.close)-t.low
    shadow = span > 0 and lower/span >= .5 and abs(t.close-t.open)/span <= .35
    add('long_lower_shadow', shadow and t.close >= t.low+span*.65 and down_context,
        t.close, t.low, '回落背景下长下影≥振幅50%，收盘位于上方35%；待次日确认', 'setup')
    ps = prev.high-prev.low
    prev_shadow = ps > 0 and (min(prev.open, prev.close)-prev.low)/ps >= .5 and abs(prev.close-prev.open)/ps <= .35
    add('long_lower_shadow', prev_shadow and down_context and t.low >= prev.low and
        t.close > prev.high and bullish and volume, prev.high, prev.low, '长下影次日不创新低并放量越过其高点')
    rprev = d.rsi.iloc[-3]
    add('rsi_low_turn', prev.rsi < 30 and prev.rsi <= rprev and t.rsi > prev.rsi,
        t.close, min(t.low, prev.low), 'RSI14在30下方由下降转为上升；仅预警', 'setup')
    add('rsi_low_turn', prev.rsi <= 50 < t.rsi and prior.rsi.tail(10).min() < 30 and bullish and volume,
        t.ma20, prior.low.tail(10).min(), '近10日曾超卖，当前RSI上穿50并放量收阳')

    # 4. 底部结构。已确认拐点全部在当天之前，颈线不包含突破日。
    seg = prior.tail(50).reset_index(drop=True)
    lo, hi = seg.low.to_numpy(), seg.high.to_numpy()
    lp = pivots(lo)
    for a, b in reversed(list(combinations(lp, 2))):
        if not 6 <= b-a <= 35 or len(seg)-1-b > 12:
            continue
        neck = hi[a+1:b].max()
        ratio = lo[b]/lo[a]-1
        depth = neck/max(lo[a], lo[b])-1
        held = lo[b:].min() >= lo[b]*(1-p.support_tolerance)
        prior_down = a >= 3 and seg.close.iloc[max(0, a-12):a].max() >= lo[a]*1.08
        if not (depth >= .05 and held and prior_down):
            continue
        common = broke(neck) and volume
        if abs(ratio) <= p.bottom_tolerance:
            add('double_bottom', common, neck, min(lo[a], lo[b]),
                '两底间隔6—35根、价差≤3%、中间反弹≥5%，放量越颈线')
            add('second_test', len(seg)-1-b <= 5 and bullish and t.close < neck and
                t.close > prior.high.tail(2).max() and t.low >= lo[b]*(1-p.support_tolerance),
                lo[b], min(lo[a], lo[b])*(1-p.support_tolerance),
                '第二底已确认且未破支撑，越过近2日高点但尚未越颈线', 'setup')
        add('rising_w_bottom', .01 <= ratio <= .08 and common, neck, lo[b],
            '第二底较第一底抬高1%—8%，中间反弹≥5%，放量越颈线')
    arc = prior.tail(40)
    y = arc.close.to_numpy()
    x = np.linspace(-1, 1, len(y))
    coef = np.polyfit(x, y, 2)
    fit = np.polyval(coef, x)
    variance = np.sum((y-y.mean())**2)
    r2 = 1-np.sum((y-fit)**2)/variance if variance > 0 else 0
    vertex = -coef[1]/(2*coef[0]) if coef[0] > 0 else 99
    rim = max(arc.high.iloc[:8].max(), arc.high.iloc[-8:].max())
    add('arc_bottom', coef[0] > 0 and -.4 <= vertex <= .4 and r2 >= .75 and
        min(y[:5].mean(), y[-5:].mean()) >= y[16:24].mean()*1.05 and
        np.max(np.abs(np.diff(y)/y[:-1])) <= .08 and broke(rim) and volume,
        rim, arc.low.min(), '40日二次拟合R²≥0.75、谷底在中段、两侧高于中部≥5%，越过杯沿')
    for a, b, c in reversed(list(combinations(lp, 3))):
        if min(b-a, c-b) < 5 or len(seg)-1-c > 12:
            continue
        if not (lo[b] <= min(lo[a], lo[c])*.95 and abs(lo[c]/lo[a]-1) <= .05):
            continue
        u = a+1+int(np.argmax(hi[a+1:b]))
        v = b+1+int(np.argmax(hi[b+1:c]))
        slope = (hi[v]-hi[u])/(v-u)
        neck = hi[u]+slope*(len(seg)-u)
        old_neck = neck-slope
        between = hi[u]+slope*(np.arange(c, len(seg))-u)
        valid_neck = neck > max(lo[a], lo[c])*1.03 and abs(hi[v]/hi[u]-1) <= .10
        add('head_shoulder_bottom', valid_neck and lo[c:].min() >= lo[c]*.98 and
            np.all(seg.close.iloc[c:].to_numpy() <= between*(1+p.break_buffer)) and
            broke(neck, old_neck) and volume, neck, lo[c],
            '三谷中头部低≥5%、肩差≤5%，突破两肩间反弹峰构成的斜颈线')

    # 5. 突破形态。
    platform = prior.tail(20)
    add('platform_breakout', platform.high.max()/platform.low.min() <= 1.12 and
        abs(platform.close.iloc[-1]/platform.close.iloc[0]-1) <= .05 and broke(top20) and volume,
        top20, platform.low.min(), '此前20日振幅≤12%、首尾涨跌≤5%，放量越平台')
    box = prior.tail(25)
    top, bottom = box.high.max(), box.low.min()
    top_hits, bottom_hits = episodes(box.high >= top*.98), episodes(box.low <= bottom*1.02)
    add('box_breakout', .04 <= top/bottom-1 <= .18 and top_hits >= 2 and bottom_hits >= 2 and
        broke(top) and volume, top, bottom, '25日箱体宽4%—18%，上下沿各有≥2次分离触碰后突破')
    triangle = prior.tail(30)
    pieces = [triangle.iloc[i:i+10] for i in (0, 10, 20)]
    hs = np.array([s.high.max() for s in pieces])
    ls = np.array([s.low.min() for s in pieces])
    top = hs.max()
    add('ascending_triangle', hs.max()/hs.min() <= 1.025 and (np.diff(ls) > 0).all() and
        ls[-1]/ls[0] >= 1.04 and hs[-1]-ls[-1] <= (hs[0]-ls[0])*.75 and
        broke(top) and volume, top, ls[-1], '三段高点近水平、低点逐段抬高≥4%、振幅收敛≥25%，放量突破')
    add('gap_breakout', t.low > prev.high*1.005 and t.open > top20 and broke(top20) and volume,
        top20, prev.high, '最低价高于昨日最高价0.5%，开盘越过20日压力且收盘仍突破')
    wave = prior.tail(30).reset_index(drop=True)
    peak = int(np.argmax(wave.high.to_numpy()))
    if 5 <= peak <= len(wave)-4:
        trough = int(np.argmin(wave.low.iloc[:peak].to_numpy()))
        peak_price, start_price = wave.high.iloc[peak], wave.low.iloc[trough]
        retrace = wave.iloc[peak+1:]
        depth = (peak_price-retrace.low.min())/(peak_price-start_price)
        add('n_shape', peak-trough >= 3 and peak_price/start_price >= 1.10 and
            .20 <= depth <= .65 and retrace.volume.mean() <= wave.volume.iloc[trough:peak+1].mean()*.8 and
            broke(peak_price) and volume, peak_price, retrace.low.min(),
            '先涨≥10%、回撤首波20%—65%、回调缩量，当前放量越前高')
    # 多种拐点组合可能指向同一形态，取最近遍历到的首个证据；不累加分数。
    unique = {}
    for row in result:
        unique.setdefault((row['pattern'], row['stage']), row)
    return list(unique.values())


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True, help='单股票CSV或包含CSV的目录（每文件一只）')
    parser.add_argument('--as-of', required=True, help='已收盘交易日 YYYY-MM-DD；不自动改用陈旧尾日')
    parser.add_argument('--price-basis', choices=['qfq', 'hfq'], required=True,
                        help='调用方确认输入OHLC为一致前/后复权，程序不能鉴定来源')
    parser.add_argument('--output', type=Path, required=True, help='新建JSON文件，已有文件拒绝覆盖')
    parser.add_argument('--config', type=Path, help='Config字段的JSON参数覆盖')
    parser.add_argument('--history', action='store_true', help='导出截至指定日的所有历史信号，默认仅尾日')
    args = parser.parse_args(argv)
    try:
        config = Config(**json.loads(args.config.read_text('utf-8'))) if args.config else Config()
        as_of = pd.Timestamp(args.as_of)
        if as_of.tzinfo is not None or as_of != as_of.normalize():
            raise ValueError('as-of必须是无时区的纯日期')
        files = sorted(args.input.glob('*.csv')) if args.input.is_dir() else [args.input]
        if not files or not args.input.exists():
            raise ValueError('输入不存在或目录没有CSV')
        output = dict(as_of=as_of.strftime('%Y-%m-%d'), price_basis=args.price_basis,
                      parameters=config.__dict__, scanned=0, signals=[], skipped=[], notes=[])
        for path in files:
            try:
                raw = pd.read_csv(path, dtype={'date': str, 'code': str})
                if 'code' in raw and (raw.code.isna().any() or raw.code.nunique() != 1):
                    raise ValueError('每个文件只能包含一个非空股票代码')
                symbol = str(raw.code.iloc[0]) if 'code' in raw and len(raw) else path.stem
                # 先按日期裁剪，再校验与计算，未来行不参与历史时点选择。
                date = pd.to_datetime(raw['date'].str.replace('-', '', regex=False), format='%Y%m%d')
                d = prepare(raw.loc[date <= as_of])
                if len(d) < 60:
                    raise ValueError(f'历史不足60根（实际{len(d)}）')
                if d.date.iloc[-1] != as_of:
                    raise ValueError('尾日不等于as-of，可能停牌、缺数据或选择了非交易日')
                if 'limit_up' not in d:
                    output['notes'].append(dict(symbol=symbol, note='缺少limit_up，跳过涨停回踩'))
                output['scanned'] += 1
                indices = range(59, len(d)) if args.history else [len(d)-1]
                for i in indices:
                    for hit in detect_at(d, i, config):
                        output['signals'].append(dict(symbol=symbol, **hit))
            except (ValueError, KeyError, OSError, pd.errors.ParserError) as exc:
                output['skipped'].append(dict(file=path.name, error=str(exc)))
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open('x', encoding='utf-8') as handle:
            json.dump(output, handle, ensure_ascii=False, indent=2, allow_nan=False)
        print(f"已扫描 {output['scanned']} 只，信号 {len(output['signals'])} 条，跳过 {len(output['skipped'])} 只。")
        return 2 if output['skipped'] else 0
    except (ValueError, TypeError, OSError) as exc:
        print(f'错误：{exc}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
