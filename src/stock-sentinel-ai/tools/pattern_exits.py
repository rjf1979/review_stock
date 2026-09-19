# -*- coding: utf-8 -*-
"""25 个形态各自的退出规则表（结构止损 + 分形态止盈 + 分形态跟踪）。

设计原则
--------
1. **能用结构算的都用结构**：关键位、失效位、形态高度全部由形态自己的窗口
   推导，回测只用信号日及以前的数据（窗口一律右开区间，不含信号日）。
2. **只保留少量约定参数**：ATR 倍数、风险上限、跟踪回撤、最长持有日按形态
   类别给出，不逐形态暴力寻优，避免 25×N 参数在单段历史上过拟合。
3. 每个形态一条显式记录，便于单独修改和单独解释，不做隐式分组默认值。

字段说明
--------
atr_mode  'wider'（默认）= 结构位与 买入价−atr_mult×ATR 取更低者（更宽的止损）；
          'structural' = 只用结构位，ATR 不参与放宽（缺口回补这类定义式失效位）
key       关键位：突破位 / 颈线 / 均线 / 前高的来源
invalid   失效参考位（结构止损的锚）
height    形态高度的来源：'struct' 表示 key - invalid，('range', n) 表示前 n 根振幅
stop_buf  结构位下方缓冲（百分比，0.01 = 1%）
atr_mult  买入价 - atr_mult × ATR14 的备用止损距离
risk_cap  单笔最大风险（百分比），止损不得高于买入价 ×(1 - risk_cap)
partial   (R 倍数, 减仓比例)：第一次止盈
target    None = 无固定目标只做跟踪；('measured', f) = 关键位 + f × 形态高度；
          ('level', 原语) = 到该结构位离场
trail_ma  余仓跟踪用的均线（用前一根已知值）
trail_pct 最高价回撤比例
close_below_ma  收盘跌破该均线即离场（None = 不启用）
close_below_ma_buf  该规则的价格缓冲（0.025 = 要跌破均线的 97.5% 才算数），
                    用来过滤「贴着均线震荡」的噪声
close_below_confirm 需要连续几根收盘确认跌破（1 = 当天即算，2 = 连续两日）
max_hold  最长持有交易日（时间止损）

原语（全部右开区间，不含信号日）
--------------------------------
('low', n) 前 n 根最低价；('high', n) 前 n 根最高价；
('ma', n) 前一根 MA_n；('close', 1) 前一根收盘；('open', 1) 前一根开盘
"""
from __future__ import annotations


def _spec(key, invalid, stop_buf=0.01, atr_mult=2.0, risk_cap=8.0,
          partial=(1.0, 0.5), target=None, height='struct', trail_ma=10,
          trail_pct=0.08, close_below_ma=None, close_below_ma_buf=0.0,
          close_below_confirm=1, max_hold=40, reason='', atr_mode='wider'):
    return {
        'key': key, 'invalid': invalid, 'height': height, 'stop_buf': stop_buf,
        'atr_mult': atr_mult, 'risk_cap': risk_cap, 'partial': partial,
        'target': target, 'trail_ma': trail_ma, 'trail_pct': trail_pct,
        'close_below_ma': close_below_ma, 'close_below_ma_buf': close_below_ma_buf,
        'close_below_confirm': close_below_confirm, 'max_hold': max_hold,
        'reason': reason, 'atr_mode': atr_mode,
    }


EXIT_SPECS: dict[str, dict] = {
    # ---------------- 均线启动类：回踩均线，跌破均线或趋势线走坏离场 ----------------
    'ma_bullish': _spec(
        ('ma', 10), ('low', 5), stop_buf=0.01, atr_mult=2.0, risk_cap=8.0,
        partial=(1.0, 0.5), target=None, trail_ma=10, trail_pct=0.06, max_hold=60,
        reason='均线多头是持仓成本抬升的趋势状态：失效位=近5根低点，'
               '1R 减半后余仓用前一根 MA10 下方 6% 与最高价回撤 6% 跟踪，'
               '给趋势 60 日时间，不用固定目标封顶'),
    'pullback_ma20': _spec(
        ('ma', 20), ('low', 5), stop_buf=0.015, atr_mult=2.0, risk_cap=8.0,
        partial=(1.0, 0.5), target=None, trail_ma=20, trail_pct=0.08,
        close_below_ma=20, close_below_ma_buf=0.025, close_below_confirm=2,
        max_hold=40,
        reason='回踩20日线的持有前提是 MA20 仍为支撑，但「收盘价刚好低于 MA20」'
               '只是贴着均线的噪声：v1 有 72.8% 的交易死在这条线上、平均只持有 4.2 天。'
               'v2 要求收盘价连续 2 日跌破 MA20 的 97.5%（下方 2.5% 缓冲）才离场，'
               '余仓仍用 MA20 下方 8% 与最高价回撤 8% 跟踪'),
    'ma_golden_start': _spec(
        ('ma', 20), ('low', 5), stop_buf=0.015, atr_mult=2.0, risk_cap=8.0,
        partial=(1.0, 0.5), target=None, trail_ma=10, trail_pct=0.08, max_hold=40,
        reason='金叉启动的失效位是金叉附近的 MA20 与前5根低点；'
               '金叉后回到 MA10 下方 8% 视为启动失败'),
    'trendline_breakout': _spec(
        ('high', 5), ('low', 5), stop_buf=0.01, atr_mult=2.0, risk_cap=8.0,
        partial=(1.0, 0.5), target=('measured', 0.8), height=('range', 40),
        trail_ma=10, trail_pct=0.08, max_hold=40,
        reason='趋势线突破取前5根高点为突破位近似，形态高度用前40根振幅的0.8倍，'
               '跌回突破位（前5根低点下方）即结构失败'),
    'macd_water_golden': _spec(
        ('ma', 20), ('low', 10), stop_buf=0.01, atr_mult=2.0, risk_cap=8.0,
        partial=(1.0, 0.5), target=None, trail_ma=10, trail_pct=0.10, max_hold=50,
        reason='水上金叉代表调整结束但无固定终点：失效位为 MA20 与前5根低点，'
               '指标信号滞后，回撤容忍放宽到 10%、最长持有 50 日，'
               '余仓用 MA10 下方 10% 与最高价回撤 10% 跟踪'),

    # ---------------- 量价共振类：量能确认后再跟踪 ----------------
    'volume_breakout': _spec(
        ('high', 20), ('low', 10), stop_buf=0.01, atr_mult=2.0, risk_cap=8.0,
        partial=(1.0, 0.5), target=('measured', 0.8), height=('range', 20),
        trail_ma=10, trail_pct=0.08, max_hold=30,
        reason='放量突破通用性最强、结构最弱：止损贴突破位（前20根高点）下方1%，'
               '目标只给前20根振幅的0.8倍，跌回旧压力区即离场'),
    'shrink_stabilize': _spec(
        ('high', 8), ('low', 8), stop_buf=0.01, atr_mult=2.0, risk_cap=8.0,
        partial=(1.0, 0.5), target=('measured', 1.0), height=('range', 8),
        trail_ma=10, trail_pct=0.08, max_hold=30,
        reason='缩量企稳是「先跌—缩量—止跌—启动」：止损用8根小平台下沿，'
               '目标用平台高度1倍，跌回平台内即离场'),
    'dry_price_bottom': _spec(
        ('high', 5), ('low', 5), stop_buf=0.01, atr_mult=1.5, risk_cap=10.0,
        partial=(1.0, 0.33), target=('measured', 0.6), height=('range', 59),
        trail_ma=10, trail_pct=0.10, max_hold=40,
        reason='地量地价底部未确认，风险上限放宽到10%、ATR用1.5倍，'
               '1R 先减 1/3，目标只取前59根振幅的0.6倍，回撤容忍10%'),
    'consecutive_yang': _spec(
        ('high', 4), ('low', 4), stop_buf=0.01, atr_mult=2.0, risk_cap=7.0,
        partial=(1.0, 0.5), target=('measured', 1.0), height=('range', 4),
        trail_ma=5, trail_pct=0.06, max_hold=20,
        reason='连阳启动是短脉冲：风险上限压到7%，用 MA5 与6%回撤跟踪，'
               '20 日不走出趋势即按时间止损'),
    'strong_sideways': _spec(
        ('high', 15), ('low', 15), stop_buf=0.01, atr_mult=2.0, risk_cap=8.0,
        partial=(1.0, 0.5), target=('measured', 0.8), height=('range', 15),
        trail_ma=10, trail_pct=0.08, max_hold=40,
        reason='强势横盘是高位换手平台：止损用15根横盘下沿，'
               '目标给横盘高度的0.8倍（高位派发风险故不打满1倍）'),

    # ---------------- 短线启动类：目标就是最近的阻力位 ----------------
    'limit_pullback': _spec(
        ('close', 1), ('low', 8), stop_buf=0.02, atr_mult=2.0, risk_cap=8.0,
        partial=(1.0, 0.5), target=('level', ('high', 20)), trail_ma=5,
        trail_pct=0.06, max_hold=20,
        reason='涨停回踩的支撑是涨停收盘与前低：止损取前8根低点下方2%，'
               '目标位是前20根高点（涨停后前高阻力），跌破 MA5 即走'),
    'fake_break_pack': _spec(
        ('low', 20), ('low', 2), stop_buf=0.01, atr_mult=2.0, risk_cap=8.0,
        partial=(1.0, 0.5), target=('level', ('high', 20)), trail_ma=5,
        trail_pct=0.06, max_hold=20,
        reason='假跌破反包是抢原支撑：止损就是两根最低被有效跌破，'
               '目标为前20根高点，1R 减半后 MA5 跟踪'),
    'yang_engulf': _spec(
        ('open', 1), ('low', 2), stop_buf=0.01, atr_mult=2.0, risk_cap=7.0,
        partial=(1.0, 0.5), target=('level', ('high', 15)), trail_ma=5,
        trail_pct=0.06, max_hold=15,
        reason='阳包阴是单根反转：失效位=两根最低，目标=前15根高点，'
               '风险上限7%、15 日时间止损，因为单根K线证据最短'),
    'long_lower_shadow': _spec(
        ('open', 1), ('low', 2), stop_buf=0.01, atr_mult=2.0, risk_cap=8.0,
        partial=(1.0, 0.5), target=('level', ('high', 20)), trail_ma=10,
        trail_pct=0.08, max_hold=20,
        reason='长下影只证明下方有承接、不证明反转：失效位仍是前两根最低，'
               '但 v2 把风险上限从 8% 压到 6%、持有压到 10 日，等于在'
               '「承接有效」之前就被时间与窄止损清仓（v2 平均只持有 5.90 日、'
               'PF 0.8496）。v3 恢复到 8% 风险上限与 20 日持有量级，目标改为'
               '前20根高点（与 rsi_low_turn 同量级的第一压力位），'
               '余仓用 MA10 下方 8% 与最高价回撤 8% 跟踪'),
    'rsi_low_turn': _spec(
        ('ma', 20), ('low', 10), stop_buf=0.01, atr_mult=2.0, risk_cap=8.0,
        partial=(1.0, 0.5), target=('level', ('high', 20)), trail_ma=10,
        trail_pct=0.08, max_hold=20,
        reason='RSI低位拐头只是动能信号：止损用前10根低点，'
               '目标为前20根高点（MA20 上方的第一压力），不追满仓'),

    # ---------------- 底部反转类：几何测量目标 + 慢跟踪 ----------------
    # v2（2026-09-18 修订，即当前规则）：失效位从「形态区间最低点」（第一底/头部）
    # 改为锚定「第二底 / 右肩 / 碗型右侧」的近端结构（('low', 8~12) 下方 1%~1.2%），
    # 风险上限从 10% 压到 8%（rising_w_bottom 7%）。
    # v1 的 10% 风险上限 + 30/45 根区间最低点，等于把止损放在正常回撤也够不到的位置，
    # 过半交易吃满最大止损（双底/头肩底中位数净收益 -10.19%）。
    # 中间方案 v2a（锚到颈线下方 3%）被否决：颈线是刚被突破的位置，回抽极易打掉，
    # 四个底部形态 PF 全部更差，产物留档 xingtaidu_25_pattern_exit_v2a_neckline_*。
    'double_bottom': _spec(
        ('high', 30), ('low', 10), stop_buf=0.012, atr_mult=2.0, risk_cap=8.0,
        partial=(1.0, 0.5), target=('measured', 1.0), height=('range', 30),
        trail_ma=20, trail_pct=0.08, max_hold=60,
        reason='双底：关键位=30根颈线，失效位=近10根低点（第二底）下方 1.2%——'
               '跌破第二底双底结构才算真的做废；v1 锚在第一底（30根最低点）离买点'
               '太远、被 10% 风险上限顶死，v2a 锚在颈线下方又太容易被突破回抽打掉。'
               'ATR 只用于把过近的结构位放宽，形态高度用30根振幅，'
               '目标=颈线 + 1倍高度，余仓 MA20 下方 8% 跟踪'),
    'rising_w_bottom': _spec(
        ('high', 30), ('low', 8), stop_buf=0.01, atr_mult=2.0, risk_cap=7.0,
        partial=(1.0, 0.5), target=('measured', 1.0), height=('range', 20),
        trail_ma=20, trail_pct=0.075, max_hold=60,
        reason='抬高W底：第二底抬高是形态成立的前提，所以失效位=近8根低点'
               '（第二底）下方 1%，跌破就说明「抬高」不成立；'
               '形态高度用更近的20根振幅，风险上限 7%，余仓 MA20 下方 7.5% 跟踪'),
    'arc_bottom': _spec(
        ('high', 40), ('low', 12), stop_buf=0.012, atr_mult=2.0, risk_cap=8.0,
        partial=(1.0, 0.5), target=('measured', 0.8), height=('range', 40),
        trail_ma=20, trail_pct=0.08, max_hold=60,
        reason='圆弧底：关键位=杯沿（前40根高点），失效位=近12根低点（碗型右侧低点）'
               '下方 1.2%，形态高度用40根振幅；圆弧底演化慢，目标只取 0.8 倍高度，'
               '风险上限 8%、余仓 MA20 下方 8% 跟踪'),
    'head_shoulder_bottom': _spec(
        ('high', 45), ('low', 12), stop_buf=0.012, atr_mult=2.0, risk_cap=8.0,
        partial=(1.0, 0.5), target=('measured', 1.0), height=('range', 45),
        trail_ma=20, trail_pct=0.08, max_hold=60,
        reason='头肩底：关键位=45根颈线，失效位=近12根低点（右肩）下方 1.2%——'
               '右肩失守头肩底形态作废；v1 锚在45根最低点=头部最低，'
               '止损几乎不可能被正常触发。形态高度用45根振幅，'
               '目标=颈线 + 1倍高度，风险上限 8%'),
    'second_test': _spec(
        ('high', 30), ('low', 16), stop_buf=0.01, atr_mult=2.0, risk_cap=8.0,
        partial=(1.0, 0.5), target=('level', ('high', 30)), trail_ma=10,
        trail_pct=0.08, max_hold=30,
        reason='二次探底是确认更早的 setup：止损用第二底（前16根最低），'
               '目标只到30根颈线（尚未突破），不做几何外推'),

    # ---------------- 突破爆发类：形态高度测量 ----------------
    'platform_breakout': _spec(
        ('high', 20), ('low', 20), stop_buf=0.01, atr_mult=2.0, risk_cap=8.0,
        partial=(1.0, 0.5), target=('measured', 1.0), height=('range', 20),
        trail_ma=10, trail_pct=0.08, max_hold=30,
        reason='平台突破：关键位=20根平台上沿，失效=平台下沿，'
               '目标=平台上沿 + 1倍平台高度，跌回平台即离场'),
    'box_breakout': _spec(
        ('high', 25), ('low', 25), stop_buf=0.01, atr_mult=2.0, risk_cap=8.0,
        partial=(1.0, 0.5), target=('measured', 1.0), height=('range', 25),
        trail_ma=10, trail_pct=0.08, max_hold=30,
        reason='箱体突破：箱顶/箱底为关键位与失效位，'
               '目标=箱顶 + 1倍箱体高度'),
    'ascending_triangle': _spec(
        ('high', 15), ('low', 10), stop_buf=0.01, atr_mult=2.0, risk_cap=8.0,
        partial=(1.0, 0.5), target=('measured', 1.0), height=('range', 30),
        trail_ma=10, trail_pct=0.08, max_hold=30,
        reason='上升三角形：关键位=水平压力（前15根高点），失效=最近上升下沿'
               '（前10根低点），目标=三角形高度1倍'),
    'gap_breakout': _spec(
        ('high', 1), ('high', 1), stop_buf=0.01, atr_mult=2.0, risk_cap=8.0,
        partial=(1.0, 0.5), target=('measured', 0.5), height=('range', 20),
        trail_ma=10, trail_pct=0.08, max_hold=30, atr_mode='structural',
        reason='缺口突破：缺口下沿（前一根最高）就是失效位，回补缺口即止损；'
               '目标只取前20根振幅的0.5倍，缺口行情兑现快'),
    'n_shape': _spec(
        ('high', 24), ('low', 10), stop_buf=0.01, atr_mult=2.0, risk_cap=8.0,
        partial=(1.0, 0.5), target=('measured', 1.0), height='struct',
        trail_ma=10, trail_pct=0.08, max_hold=40,
        reason='N字突破：关键位=前高（前24根最高），失效=回调低点（前10根最低），'
               '目标=前高 + 1倍N字高度（等长上攻）'),
}


def spec(pid: str) -> dict:
    """返回某形态的退出规则副本。"""
    if pid not in EXIT_SPECS:
        raise KeyError(f'未定义退出规则的形态: {pid}')
    return dict(EXIT_SPECS[pid])


def ids() -> list[str]:
    return list(EXIT_SPECS)
