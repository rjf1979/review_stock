# -*- coding: utf-8 -*-
"""尾盘买入回测入库：表结构（DDL）+ 中文字段字典。

设计源：``docs/2026-09-21-回测结果入库表结构与字段字典.md``（v2）。

* SQLite 不保存列注释，所以中文名有两条落地路径：
  1. 本文件的 DDL 里用 ``--`` 写注释（供人读、可导出建表语句）；
  2. ``bt_feature_def`` 表（供 App 读取显示）。
* 本模块只放结构与字典，不含导入逻辑（见 ``backtest_store.py``）。
"""
from __future__ import annotations

import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..'))

# 独立回测库：Python 独占写，WAL。**不要**写进 data/kline.db
# （那是 sql.js 全量导出式内存库，App 进程持有内存副本会覆盖外部写入）。
DEFAULT_DB = os.path.join(ROOT, 'data', 'backtest.db')
KLINE_DB = os.path.join(ROOT, 'data', 'kline.db')

SCHEMA_VERSION = 'bt-schema-v3'
GENERATOR = 'tools/backtest_store.py'


SCHEMA_SQL = """
-- =====================================================================
-- 尾盘（14:30~14:55）买入 → 次日早盘（09:30~10:00）卖出 回测结果库
-- schema v2：含多周期（5/15/30/60 分钟）K 线形态快照
-- =====================================================================

CREATE TABLE IF NOT EXISTS bt_meta (
  key         TEXT PRIMARY KEY,  -- 配置项名称
  value       TEXT NOT NULL,     -- 配置项取值
  updatedAt   TEXT NOT NULL      -- 更新时间（ISO8601）
);
-- 固定键：schemaVersion / createdAt / generator / tdxMinuteAsOfBars / note

CREATE TABLE IF NOT EXISTS bt_dataset (
  datasetId     TEXT PRIMARY KEY, -- 数据集标识（如 kline_day / minute_1m / minute_5m）
  kind          TEXT NOT NULL,    -- 类型：day / minute
  freqMin       INTEGER,          -- 频率（分钟）：日线为 NULL，分钟为 1/5/15/30/60
  source        TEXT NOT NULL,    -- 数据来源（tdx fzline / tdx minline / tdx lday）
  dateMin       INTEGER,          -- 起始交易日 YYYYMMDD
  dateMax       INTEGER,          -- 结束交易日 YYYYMMDD
  tradingDays   INTEGER,          -- 覆盖交易日数
  codeCount     INTEGER,          -- 覆盖股票数
  barsPerCode   INTEGER,          -- 每只股票平均 K 线根数
  missingNote   TEXT,             -- 缺失与空洞说明
  builtAt       TEXT              -- 采集/统计时间
);

CREATE TABLE IF NOT EXISTS bt_run (
  runId           INTEGER PRIMARY KEY AUTOINCREMENT, -- 批次号
  runKey          TEXT NOT NULL UNIQUE,              -- 批次可读标识（含日期与口径摘要）
  createdAt       TEXT NOT NULL,                     -- 创建时间
  engineVersion   TEXT NOT NULL,                     -- 回测程序版本
  priceMode       TEXT NOT NULL,                     -- 价格口径：raw(不复权) / qfq / hfq
  buyTime         INTEGER NOT NULL,                  -- 基准买入时刻 HHMM（1430）
  sellTimeStart   INTEGER NOT NULL,                  -- 卖出窗口开始 HHMM（0930）
  sellTimeEnd     INTEGER NOT NULL,                  -- 卖出窗口结束 HHMM（1000）
  costBps         REAL NOT NULL,                     -- 双边成本（0.15 表示 0.15%）
  universeFilter  TEXT NOT NULL,                     -- 股票池过滤说明（个股白名单/排除银行/退市/B股/ST）
  excludeIndustry TEXT,                              -- 排除行业清单（JSON）
  keepDelisted    INTEGER NOT NULL DEFAULT 0,        -- 是否保留退市股（0/1，默认 0）
  paramsJson      TEXT NOT NULL,                     -- 全部口径参数（含时间戳口径说明）
  tradeCount      INTEGER,                           -- 入库笔数
  note            TEXT                               -- 备注
);

CREATE TABLE IF NOT EXISTS bt_trade (
  tradeId        INTEGER PRIMARY KEY AUTOINCREMENT, -- 逐笔主键
  runId          INTEGER NOT NULL,   -- 关联 bt_run.runId
  code           TEXT    NOT NULL,   -- 股票代码（6 位）
  name           TEXT,               -- 股票名称（快照）
  board          TEXT,               -- 上市板：沪主板/深主板/创业板
  date           INTEGER NOT NULL,   -- 交易日 YYYYMMDD
  entryTime      INTEGER,            -- 买入时刻 HHMM（1430=尾盘分钟口径 / 1500=日线收盘口径）
  entryPrice     REAL,               -- 买入价（14:30 分钟收盘价 或 当日收盘价）
  close          REAL,               -- 买入日收盘价
  pct            REAL,               -- 买入时刻涨跌幅 %（14:30 相对昨收）
  amp            REAL,               -- 日内振幅 %（截至买入时刻）
  closePos       REAL,               -- 买入时价在当日高低区间的位置 0~1
  upperShadow    REAL,               -- 上影线长度 / 买入时价
  lowerShadow    REAL,               -- 下影线长度 / 买入时价
  turnoverPct    REAL,               -- 换手率 % = 截至买入时刻成交量 ÷ 买入日时点流通股本 × 100
  turnoverSrc    TEXT,               -- 换手率口径：gbbq_pit（时点股本）/ intraday_minute（分钟真实量）/ snapshot_const（快照常量）/ floatcap_approx（旧近似）
  floatSharesWan REAL,               -- 参与计算的流通股本（万股）= 买入日时点 gbbq 股本事件推导
  volRatio       REAL,               -- 量比（当日量 ÷ 前 5 日均量）
  volRatioIntraday REAL,             -- 分时量比（同刻累计量 ÷ 近 5 日同刻均量）
  amountWan      REAL,               -- 成交额（万元，截至买入时刻累计）
  floatMcapYi    REAL,               -- 流通市值（亿元，按买入时价重算）
  bias20         REAL,               -- 20 日乖离率 %
  bias60         REAL,               -- 60 日乖离率 %
  rsi14          REAL,               -- 日线 RSI14
  atrPct         REAL,               -- 日线 ATR14 / 买入时价 %
  ret5           REAL,               -- 近 5 日收益 %
  ret20          REAL,               -- 近 20 日收益 %
  ret60          REAL,               -- 近 60 日收益 %
  distHh20       REAL,               -- 距 20 日最高价 %
  listDays       INTEGER,            -- 上市交易日数
  ma5Pos         REAL,               -- 收盘相对 5 日均线偏离 %
  ma10Pos        REAL,               -- 收盘相对 10 日均线偏离 %
  ma20Pos        REAL,               -- 收盘相对 20 日均线偏离 %
  ma60Pos        REAL,               -- 收盘相对 60 日均线偏离 %
  ma120Pos       REAL,               -- 收盘相对 120 日均线偏离 %
  ma5Slope       REAL,               -- 5 日均线斜率（近 5 日 %）
  ma10Slope      REAL,               -- 10 日均线斜率
  ma20Slope      REAL,               -- 20 日均线斜率
  ma60Slope      REAL,               -- 60 日均线斜率
  ma120Slope     REAL,               -- 120 日均线斜率
  maAlign        TEXT,               -- 均线排列：bull_align/bear_align/converge/mixed
  dayPatterns    TEXT,               -- 日线命中形态 ID 列表（复用注册表，逗号分隔，可多命中）
  dayPatternMask INTEGER,            -- 日线命中形态位掩码
  dayCategories  TEXT,               -- 日线命中形态分类集合（如 均线启动类,突破爆发类）
  dayShape       TEXT,               -- 日线形态位置语义：震荡形态/探底形态/波动回踩/上升通道/下降通道/高位横盘
  pos120         REAL,               -- 120 日区间位置 0~1
  channelType    TEXT,               -- 通道类型：up/down/box
  marketTemp     REAL,               -- 全市场温度分位 0~1
  marketRegime   TEXT,               -- 市场状态：强势主升/震荡偏强/轮动震荡/恐慌修复/弱势退潮
  sectorPct      REAL,               -- 所属行业指数当日涨跌幅 %
  sectorRet5     REAL,               -- 行业指数近 5 日收益 %
  sectorRet20    REAL,               -- 行业指数近 20 日收益 %
  sectorHeat     REAL,               -- 行业热度分位 0~1
  sectorUpRatio  REAL,               -- 行业成分上涨家数占比 %
  sectorLimitUpCnt INTEGER,          -- 行业成分涨停家数
  conceptTags    TEXT,               -- 概念标签（快照，逗号分隔）—— 本版预留，暂为 NULL
  conceptHeat    REAL,               -- 龙头概念热度分位 0~1 —— 本版预留，暂为 NULL
  benchPct       REAL,               -- 基准指数（沪深300）当日涨跌幅 %
  isLimitUp      INTEGER,            -- 买入日是否涨停收盘（0/1）
  touchedLimit   INTEGER,            -- 买入日是否触板（0/1）
  nextOpen       REAL,               -- 次日开盘价
  nextHigh       REAL,               -- 次日早盘最高价
  nextClose      REAL,               -- 次日早盘卖出价（按卖出规则）
  retOpen        REAL,               -- 次日开盘收益 %（毛）
  retHigh        REAL,               -- 次日早盘最高收益 %（毛）
  retClose       REAL,               -- 次日早盘卖出收益 %（毛）
  limitTouch     INTEGER,            -- 次日早盘是否触涨停（0/1）
  hit3           INTEGER,            -- 次日早盘最高是否 ≥ +3%（0/1）
  stratRet       REAL,               -- 策略净收益 %（扣成本）
  tf5Pattern     TEXT,               -- 5 分钟主形态 ID（摘要，明细见 bt_trade_tf）
  tf15Pattern    TEXT,               -- 15 分钟主形态 ID
  tf30Pattern    TEXT,               -- 30 分钟主形态 ID
  tf60Pattern    TEXT,               -- 60 分钟主形态 ID
  tf5Mask        INTEGER,            -- 5 分钟形态命中位掩码
  tf15Mask       INTEGER,            -- 15 分钟形态命中位掩码
  tf30Mask       INTEGER,            -- 30 分钟形态命中位掩码
  tf60Mask       INTEGER,            -- 60 分钟形态命中位掩码
  tfAlign        TEXT,               -- 多周期共振：all_bull/all_bear/mixed/partial/na
  tfAlignScore   INTEGER,            -- 共振分（各周期方向分之和，-8~+8）
  tfCoverage     INTEGER,            -- 该笔是否有分钟数据（0/1）
  tfQuality      TEXT,               -- 多周期数据质量：ok/warmup/missing
  createdAt      TEXT                -- 入库时间
);

CREATE TABLE IF NOT EXISTS bt_trade_tf (
  tradeId        INTEGER NOT NULL,   -- 关联 bt_trade.tradeId
  runId          INTEGER NOT NULL,   -- 关联 bt_run.runId
  period         INTEGER NOT NULL,   -- 周期（分钟）：5 / 15 / 30 / 60
  code           TEXT    NOT NULL,   -- 股票代码
  date           INTEGER NOT NULL,   -- 交易日 YYYYMMDD
  asOf           INTEGER NOT NULL,   -- 快照决策时刻 HHMM（默认 1430）
  lastBarTime    INTEGER,            -- 最后一根已收盘 bar 的结束时刻 HHMM
  barCount       INTEGER,            -- 该周期可用 K 线总根数（判断预热）
  barsToday      INTEGER,            -- 当日该周期已收盘根数
  closeVsMa5Pct  REAL,               -- 收盘相对周期 ma5 偏离 %
  closeVsMa10Pct REAL,               -- 收盘相对周期 ma10 偏离 %
  closeVsMa20Pct REAL,               -- 收盘相对周期 ma20 偏离 %
  closeVsMa60Pct REAL,               -- 收盘相对周期 ma60 偏离 %
  ma5SlopePct    REAL,               -- 周期 ma5 斜率（近 5 根 %）
  maAlign        TEXT,               -- 周期均线排列：bull_align/bear_align/converge/mixed
  posInRange20   REAL,               -- 收盘在近 20 根区间的位置 0~1
  posInRange60   REAL,               -- 收盘在近 60 根区间的位置 0~1
  rangeAmp20Pct  REAL,               -- 近 20 根区间振幅 %
  volRatio20     REAL,               -- 最新一根量 ÷ 前 20 根均量
  atrPct14       REAL,               -- 周期 ATR14 / 收盘 %
  rsi14          REAL,               -- 周期 RSI14
  macdHistPct    REAL,               -- 周期 MACD 柱 / 收盘 %
  ret1Pct        REAL,               -- 最近 1 根收益 %
  ret5Pct        REAL,               -- 最近 5 根收益 %
  trendSlopePct  REAL,               -- 近 20 根线性回归斜率（每根 %）
  trendR2        REAL,               -- 近 20 根线性回归 R²（判断通道/箱体）
  patterns       TEXT,               -- 命中形态 ID 列表（注册表 ID + 周期后缀，可多命中）
  patternMask    INTEGER,            -- 命中形态位掩码（与 bt_pattern_def.bitIndex 对应）
  primaryPattern TEXT,               -- 主形态 ID（按 bt_pattern_def.priority 取一条）
  patternBias    TEXT,               -- 形态方向：bull / bear / neutral（由命中形态分类汇总）
  biasScore      INTEGER,            -- 方向强度分（命中形态权重之和）
  engineVersion  TEXT,               -- 形态引擎版本（tools/patterns 注册表版本）
  qualityFlags   TEXT,               -- 数据质量：ok / warmup / short_bars / gap
  createdAt      TEXT,               -- 入库时间
  PRIMARY KEY (tradeId, period)
);

CREATE TABLE IF NOT EXISTS bt_pattern_def (
  patternId       TEXT PRIMARY KEY,  -- 形态 ID（日线为注册表原 ID，分钟为 ID@周期）
  nameCn          TEXT NOT NULL,     -- 中文名
  scope           TEXT NOT NULL,     -- 适用范围：day / intraday / both
  periods         TEXT,              -- 适用周期（"5,15,30,60"，日线为 "day"）
  sourceModule    TEXT,              -- 形态来源：registry:xingtaidu / registry:sequoia_x / derived
  category        TEXT,              -- 分类（均线启动类/量价共振类/短线强势启动/底部反转类/突破爆发类）
  direction       TEXT NOT NULL,     -- 方向：bull / bear / neutral
  weight          INTEGER NOT NULL,  -- 方向权重（用于 biasScore）
  priority        INTEGER NOT NULL,  -- 主形态优先级（数字越小越优先）
  bitIndex        INTEGER,           -- 位掩码下标（0~62）
  ruleExpr        TEXT NOT NULL,     -- 判定规则（可读表达式，与注册表 desc 一致）
  ruleParams      TEXT,              -- 规则参数（JSON）
  basisNote       TEXT,              -- 参考依据（理论来源与经验出处）
  version         TEXT NOT NULL,     -- 规则版本
  usableForDecision INTEGER NOT NULL DEFAULT 0, -- 是否可用于实盘凭据（0/1）
  evidenceTradeCnt INTEGER,          -- 验证样本笔数
  evidenceHit3Pct REAL,              -- 验证期 ≥+3% 命中率 %
  evidenceLift    REAL,              -- 相对基准的 lift
  evidenceYears   TEXT,              -- 分年命中率（JSON）
  validatedAt     TEXT               -- 验证时间
);

CREATE TABLE IF NOT EXISTS bt_market_day (
  date           INTEGER PRIMARY KEY, -- 交易日 YYYYMMDD
  upRatio        REAL,               -- 上涨家数占比 %
  limitUpCnt     INTEGER,            -- 涨停家数
  limitDownCnt   INTEGER,            -- 跌停家数
  up5Ratio       REAL,               -- 近 5 日上涨家数占比 %
  medianPct      REAL,               -- 全市场涨跌幅中位数 %
  totalAmountYi  REAL,               -- 全市场成交额（亿元）
  amountRatio5   REAL,               -- 成交额 ÷ 近 5 日均量
  indexPct       REAL,               -- 沪深300 涨跌幅 %
  indexMa20Pos   REAL,               -- 沪深300 相对 20 日线偏离 %
  regime         TEXT,               -- 市场状态分类
  tempScore      REAL,               -- 温度分 0~100
  tempPct        REAL                -- 温度分历史分位 0~1
);

CREATE TABLE IF NOT EXISTS bt_sector_day (
  boardId        TEXT NOT NULL,      -- 板块代码（如 880534）
  boardType      TEXT NOT NULL,      -- 类型：行业 / 概念 / 地域
  date           INTEGER NOT NULL,   -- 交易日 YYYYMMDD
  boardName      TEXT,               -- 板块名称
  pct            REAL,               -- 板块指数涨跌幅 %
  ret5           REAL,               -- 近 5 日收益 %
  ret20          REAL,               -- 近 20 日收益 %
  amountRatio5   REAL,               -- 板块成交额 ÷ 近 5 日均量
  upRatio        REAL,               -- 成分上涨占比 %
  limitUpCnt     INTEGER,            -- 成分涨停家数
  heatScore      REAL,               -- 热度分 0~100
  heatPct        REAL,               -- 热度分位 0~1
  rankPct        REAL,               -- 当日板块涨幅排名分位 0~1
  PRIMARY KEY (boardId, date)
);

-- bt_concept_map 本版不建表（概念题材后置，见设计文档 §4.9）

CREATE TABLE IF NOT EXISTS bt_trade_context (
  tradeId      INTEGER PRIMARY KEY,  -- 关联 bt_trade.tradeId
  runId        INTEGER NOT NULL,     -- 关联 bt_run.runId
  marketTemp   REAL,                 -- 买入日全市场温度分位
  marketRegime TEXT,                 -- 买入日市场状态
  sectorHeat   REAL,                 -- 所属行业热度分位
  sectorUpRatio REAL,                -- 所属行业成分上涨占比 %
  conceptHeat  REAL,                 -- 主要概念热度分位
  contextJson  TEXT                  -- 完整快照（含概念列表与板块明细）
);

CREATE TABLE IF NOT EXISTS bt_stat (
  statId       INTEGER PRIMARY KEY AUTOINCREMENT, -- 主键
  runId        INTEGER NOT NULL,   -- 关联 bt_run.runId
  dimension    TEXT NOT NULL,      -- 维度：overall/year/date/board/industry/rule/amp/amount/
                                   --   pct/close_pos/bias20/rsi14/vol_ratio/atr/list_days/
                                   --   day_pattern/day_category/theme_shape/market_regime/
                                   --   sector_heat/tf5_pattern/tf15_pattern/tf30_pattern/
                                   --   tf60_pattern/tf5_primary/tf15_primary/tf30_primary/
                                   --   tf60_primary/tf_align/tf_align_score/day_shape/channel/
                                   --   ma_align/pos120/turnover/vol_ratio_intraday/atr
                                   --   （concept 维度待概念数据接入）
  bucket       TEXT NOT NULL,      -- 分桶取值（如 "创业板"、"ma_bullish"）
  sampleCnt    INTEGER NOT NULL,   -- 样本笔数
  hit1Pct      REAL,               -- 次日早盘最高 ≥+1% 占比
  hit2Pct      REAL,               -- ≥+2%
  hit3Pct      REAL,               -- ≥+3%
  hit4Pct      REAL,               -- ≥+4%
  hit5Pct      REAL,               -- ≥+5%
  hit6Pct      REAL,               -- ≥+6%
  hit7Pct      REAL,               -- ≥+7%
  hit8Pct      REAL,               -- ≥+8%
  hit9Pct      REAL,               -- ≥+9%
  limitUpPct   REAL,               -- 触涨停占比
  retOpenMean  REAL,               -- 开盘卖出平均收益 %
  retHighMean  REAL,               -- 早盘最高平均收益 %
  retCloseMean REAL,               -- 卖出规则平均收益 %
  stratMean    REAL,               -- 策略净收益均值 %
  winRate      REAL,               -- 真实胜率 %（笔数口径）
  profitFactor REAL,               -- 盈亏比
  lift3        REAL,               -- 相对基准的 ≥+3% lift
  ci95Low      REAL,               -- ≥+3% 的 95% 置信下界 %
  ci95High     REAL,               -- ≥+3% 的 95% 置信上界 %
  byYearJson   TEXT,               -- 分年命中率（JSON）
  stability    TEXT,               -- 稳定性结论：stable/fragile/insufficient
  note         TEXT,               -- 备注
  UNIQUE (runId, dimension, bucket)
);

CREATE TABLE IF NOT EXISTS bt_time_grid (
  runId        INTEGER NOT NULL,   -- 关联 bt_run.runId
  buyMinute    INTEGER NOT NULL,   -- 买入时刻 HHMM（1430~1455）
  sellMinute   INTEGER NOT NULL,   -- 卖出时刻 HHMM（0931~1000）
  sampleCnt    INTEGER NOT NULL,   -- 样本笔数
  retMeanPct   REAL,               -- 平均收益 %（对买入价）
  retMedPct    REAL,               -- 收益中位数 %
  winRate      REAL,               -- 胜率 %
  retStdPct    REAL,               -- 收益标准差 %
  hit3Pct      REAL,               -- 该时点组合的 ≥+3% 占比 %
  PRIMARY KEY (runId, buyMinute, sellMinute)
);

CREATE TABLE IF NOT EXISTS bt_time_marginal (
  runId       INTEGER NOT NULL,    -- 关联 bt_run.runId
  leg         TEXT NOT NULL,       -- 腿：buy / sell
  minute      INTEGER NOT NULL,    -- 时刻 HHMM
  sampleCnt   INTEGER NOT NULL,    -- 样本笔数
  retMeanPct  REAL,                -- 该时刻相对基准的平均收益 %
  isBestShare REAL,                -- 该时刻为窗口内最优的比例 %
  PRIMARY KEY (runId, leg, minute)
);

CREATE TABLE IF NOT EXISTS bt_rule (
  ruleId       INTEGER PRIMARY KEY AUTOINCREMENT, -- 主键
  runId        INTEGER NOT NULL,   -- 关联 bt_run.runId
  ruleName     TEXT NOT NULL,      -- 规则名（如 组合G）
  conditionsJson TEXT NOT NULL,    -- 条件定义（JSON）
  sampleCnt    INTEGER NOT NULL,   -- 样本笔数
  hit3Pct      REAL,               -- ≥+3% 命中率 %
  baseHit3Pct  REAL,               -- 同期基准命中率 %
  lift3        REAL,               -- lift
  stratMean    REAL,               -- 策略净收益均值 %
  byYearJson   TEXT,               -- 分年命中率（JSON）
  verdict      TEXT,               -- 结论：采纳/观察/否决
  note         TEXT                -- 备注
);

CREATE TABLE IF NOT EXISTS bt_feature_def (
  tableName   TEXT NOT NULL,       -- 表名
  columnName  TEXT NOT NULL,       -- 字段名
  nameCn      TEXT NOT NULL,       -- 中文名
  meaning     TEXT,                -- 含义说明
  unit        TEXT,                -- 单位（% / 元 / 亿元 / 0~1 / 枚举）
  valueScope  TEXT,                -- 取值范围或枚举取值
  source      TEXT,                -- 数据来源
  calcRule    TEXT,                -- 计算口径
  isFeature   INTEGER,             -- 是否可作为预测特征（0/1）
  PRIMARY KEY (tableName, columnName)
);

-- =====================================================================
-- 第三套策略批次：T 日 14:40 分时反推 → T+1 09:31~10:30 最高涨幅 ≥3%
-- 数据源 data/backtest/minute-reverse/samples.csv（95 列，原样落库）
-- =====================================================================
CREATE TABLE IF NOT EXISTS bt_reverse_sample (
  code             TEXT NOT NULL,  -- 股票代码（6 位）
  name             TEXT,           -- 股票名称（通达信，当前名称回看历史）
  date             INTEGER NOT NULL, -- 买入日 T（YYYYMMDD）
  nextDate         INTEGER,        -- 次日 T+1（YYYYMMDD）
  board            TEXT,           -- 上市板（沪主板/深主板/中小板/创业板）
  industry         TEXT,           -- 通达信行业名称
  entry1440        REAL,           -- T 日 14:40 一分钟收盘价（不复权，买入价）
  tCloseRaw        REAL,           -- T 日不复权收盘价（用于涨跌停价计算）
  dPctPrev         REAL,           -- 前一日（T-1）涨跌幅 %
  dAmpPrev         REAL,           -- 前一日（T-1）振幅 %
  dRet5            REAL,           -- 截至 T-1 的近 5 日收益 %
  dRet20           REAL,           -- 截至 T-1 的近 20 日收益 %
  dRet60           REAL,           -- 截至 T-1 的近 60 日收益 %
  dRsi14           REAL,           -- T-1 日线 RSI14
  dAtrPct          REAL,           -- T-1 日线 ATR14 ÷ 收盘 %
  dBias5           REAL,           -- T-1 收盘相对 5 日均线乖离 %
  dBias10          REAL,           -- T-1 收盘相对 10 日均线乖离 %
  dBias20          REAL,           -- T-1 收盘相对 20 日均线乖离 %
  dBias60          REAL,           -- T-1 收盘相对 60 日均线乖离 %
  dBias120         REAL,           -- T-1 收盘相对 120 日均线乖离 %
  dDistHh20        REAL,           -- T-1 收盘距 20 日新高 %
  dListDays        INTEGER,        -- 上市交易日数（按 T 日计）
  dFloatMcapYi     REAL,           -- 流通市值（亿元，按 14:40 价重算）
  dBoard           TEXT,           -- 上市板（分类特征，与 board 同值）
  marketTemp       REAL,           -- T-1 全市场温度 0~1
  marketUpRatio    REAL,           -- T-1 全市场上涨家数占比 %
  marketLimitUpCnt INTEGER,        -- T-1 全市场涨停家数
  marketRegime     TEXT,           -- T-1 市场环境分类
  sectorPct        REAL,           -- T-1 所属行业指数涨跌幅 %
  sectorRet5       REAL,           -- T-1 所属行业近 5 日收益 %
  sectorRet20      REAL,           -- T-1 所属行业近 20 日收益 %
  sectorHeat       REAL,           -- T-1 所属行业热度分 0~100
  sectorUpRatio    REAL,           -- T-1 所属行业成分上涨占比 %
  sectorLimitUpCnt INTEGER,        -- T-1 所属行业成分涨停家数
  mRet10           REAL,           -- 尾盘 14:30→14:40 涨幅 %
  mRet5            REAL,           -- 尾盘 14:35→14:40 涨幅 %
  mRet30           REAL,           -- 尾盘 14:10→14:40 涨幅 %
  mRet60           REAL,           -- 尾盘 13:40→14:40 涨幅 %
  mAccel10         REAL,           -- 尾盘动量加速度（最近 10 分钟 - 前 10 分钟）%
  mTailAmtShare10  REAL,           -- 14:31~14:40 成交额占全段比例
  mTailAmtShare30  REAL,           -- 14:11~14:40 成交额占全段比例
  mTailAmtTempo    REAL,           -- 尾盘 10 分钟量能 ÷ 13:31~14:30 分钟均额（倍）
  mLastMinAmtShare REAL,           -- 14:40 当分钟成交额占全段比例
  mTailMaxDrop     REAL,           -- 14:11~14:40 自最高点起最大回撤 %
  mTailRangePos    REAL,           -- 14:40 价在尾盘 30 分钟区间的相对位置 0~1
  mTailVwapDev     REAL,           -- 14:40 价相对 14:01~14:40 VWAP 偏离 %
  mTailUpMinShare  REAL,           -- 14:01~14:40 上涨分钟占比 0~1
  mRetClose1440    REAL,           -- 14:40 价相对 T-1 不复权收盘涨幅 %（尾盘买入时的当日涨幅）
  mRetOpen1440     REAL,           -- 14:40 价相对 T 日开盘涨幅 %
  mGapPct          REAL,           -- T 日开盘缺口 %（开盘价相对 T-1 收盘）
  mAmp1440         REAL,           -- 截至 14:40 日内振幅 %（最高-最低）/T-1 收盘
  mClosePos1440    REAL,           -- 截至 14:40 收盘价在当日区间位置 0~1
  mVwapDev1440     REAL,           -- 14:40 价相对当日 VWAP 偏离 %
  mVwapSlope20     REAL,           -- 14:21~14:40 VWAP 相对 14:20 前 VWAP 偏离 %
  mHiTimeRank      REAL,           -- 当日最高点出现时间的位置 0~1（0=开盘，1=14:40）
  mFirstHourRet    REAL,           -- T 日 09:31~10:30 涨幅 %
  mNoonRet         REAL,           -- T 日 11:30→14:40 涨幅 %
  mPmRet           REAL,           -- T 日 13:01→14:40 涨幅 %
  mVolPct1440      REAL,           -- 分时波动率（分钟收益标准差）%
  mUpMinShare      REAL,           -- 当日上涨分钟占比 0~1
  mUpDownVolRatio  REAL,           -- 上涨分钟成交量 ÷ 下跌分钟成交量
  mAmtRatio2ndHalf REAL,           -- 13:00~14:40 成交额占全段比例
  mTurnover1440    REAL,           -- 截至 14:40 换手率 %（成交量 ÷ T 日时点流通股本）
  mAmountWan1440   REAL,           -- 截至 14:40 成交额（万元）
  mVolRatio1440    REAL,           -- 截至 14:40 量比（当日同期额 ÷ 前 5 日同刻均额）
  hi1000Pct        REAL,           -- T+1 09:31~10:00 最高涨幅 %
  hi1000Time       INTEGER,        -- T+1 09:31~10:00 最高点时刻 HHMM
  hi1030Pct        REAL,           -- T+1 09:31~10:30 最高涨幅 %（本批次标签）
  hi1030Time       INTEGER,        -- T+1 09:31~10:30 最高点时刻 HHMM
  hi1130Pct        REAL,           -- T+1 09:31~11:30 最高涨幅 %
  hi1130Time       INTEGER,        -- T+1 09:31~11:30 最高点时刻 HHMM
  openPct          REAL,           -- T+1 开盘涨幅 %
  c1000Pct         REAL,           -- T+1 10:00 价涨幅 %
  c1030Pct         REAL,           -- T+1 10:30 价涨幅 %
  hiDayPct         REAL,           -- T+1 全天最高涨幅 %
  limitTouch1030   INTEGER,        -- T+1 09:31~10:30 是否触涨停（0/1）
  limitTouchDay    INTEGER,        -- T+1 全天是否触涨停（0/1）
  hit1             INTEGER,        -- 标签：T+1 早盘最高 ≥+1%（0/1）
  hit1000_1        INTEGER,        -- 对照：T+1 09:31~10:00 最高 ≥+1%（0/1）
  hit2             INTEGER,        -- 标签：≥+2%
  hit1000_2        INTEGER,        -- 对照：09:31~10:00 最高 ≥+2%
  hit3             INTEGER,        -- 标签：≥+3%（本批次主目标）
  hit1000_3        INTEGER,        -- 对照：09:31~10:00 最高 ≥+3%
  hit4             INTEGER,        -- 标签：≥+4%
  hit1000_4        INTEGER,        -- 对照：09:31~10:00 最高 ≥+4%
  hit5             INTEGER,        -- 标签：≥+5%
  hit1000_5        INTEGER,        -- 对照：09:31~10:00 最高 ≥+5%
  hit6             INTEGER,        -- 标签：≥+6%
  hit1000_6        INTEGER,        -- 对照：09:31~10:00 最高 ≥+6%
  hit7             INTEGER,        -- 标签：≥+7%
  hit1000_7        INTEGER,        -- 对照：09:31~10:00 最高 ≥+7%
  hit8             INTEGER,        -- 标签：≥+8%
  hit1000_8        INTEGER,        -- 对照：09:31~10:00 最高 ≥+8%
  hit9             INTEGER,        -- 标签：≥+9%
  hit1000_9        INTEGER,        -- 对照：09:31~10:00 最高 ≥+9%
  PRIMARY KEY (code, date)
);

CREATE TABLE IF NOT EXISTS bt_reverse_feature (
  featureKey      TEXT PRIMARY KEY, -- 特征键（= samples.csv 列名）
  nameCn          TEXT NOT NULL,    -- 中文名
  unit            TEXT,             -- 单位（% / 倍 / 0~1 / 枚举）
  kind            TEXT,             -- 类型：num（数值）/ cat（分类）
  sourceColumn    TEXT,             -- 对应 bt_reverse_sample 的列名
  inModel         INTEGER,          -- 是否进入 minute-reverse-v1 模型（0/1）
  note            TEXT              -- 备注（口径与风险）
);

CREATE INDEX IF NOT EXISTS idx_bt_trade_run_date ON bt_trade (runId, date);
CREATE INDEX IF NOT EXISTS idx_bt_trade_run_hit3 ON bt_trade (runId, hit3);
CREATE INDEX IF NOT EXISTS idx_bt_trade_code     ON bt_trade (code, date);
CREATE INDEX IF NOT EXISTS idx_bt_trade_pattern  ON bt_trade (runId, dayPatternMask);
CREATE INDEX IF NOT EXISTS idx_bt_trade_tf_lookup ON bt_trade_tf (period, primaryPattern, date);
CREATE INDEX IF NOT EXISTS idx_bt_trade_tf_code   ON bt_trade_tf (code, date);
CREATE INDEX IF NOT EXISTS idx_bt_sector_day_date ON bt_sector_day (date, boardType);
CREATE INDEX IF NOT EXISTS idx_bt_reverse_hit3    ON bt_reverse_sample (date, hit3);
CREATE INDEX IF NOT EXISTS idx_bt_reverse_code    ON bt_reverse_sample (code, date);
"""


def _fd(table, col, cn, meaning='', unit='', scope='', source='', calc='', feat=1):
    return (table, col, cn, meaning, unit, scope, source, calc, feat)


# --------------------------------------------------------------- 字段字典
# (表, 字段, 中文名, 含义, 单位, 取值范围, 来源, 计算口径, 是否特征)
FEATURE_DEFS = [
    # ---- bt_trade 主体 ----
    _fd('bt_trade', 'tradeId', '逐笔主键', '一笔「T 日买入 + T+1 卖出」记录', '', '', '本库生成', '', 0),
    _fd('bt_trade', 'runId', '批次号', '关联 bt_run', '', '', '本库生成', '', 0),
    _fd('bt_trade', 'code', '股票代码', '6 位 A 股代码', '', '', '通达信日线', '', 0),
    _fd('bt_trade', 'name', '股票名称', '名称快照（用当前名称看历史，成分漂移）', '',
        '', '东财快照 2026-09-18', '', 0),
    _fd('bt_trade', 'board', '上市板', '沪主板/深主板/中小板/创业板', '', '枚举',
        '通达信', '按代码前缀归类', 1),
    _fd('bt_trade', 'date', '买入交易日', 'T 日 YYYYMMDD', '', '', '通达信日线', '', 0),
    _fd('bt_trade', 'entryTime', '买入时刻', '本次回测的买入时点', 'HHMM', '1430/1500',
        '本库生成', '分钟口径=1430，日线口径=1500', 0),
    _fd('bt_trade', 'entryPrice', '买入价', '计算收益的基准价', '元', '',
        '通达信分钟线/日线', '分钟口径=14:30 分钟收盘价；日线口径=当日收盘价', 1),
    _fd('bt_trade', 'close', '买入日收盘价', 'T 日不复权收盘价', '元', '', '通达信日线', '', 1),
    _fd('bt_trade', 'pct', '买入时涨跌幅', '买入时价相对昨收的涨幅', '%', '',
        '通达信', '(买入时价/昨收-1)×100', 1),
    _fd('bt_trade', 'amp', '买入时振幅', '截至买入时刻的日内振幅', '%', '',
        '通达信', '(截至买入时刻最高-最低)/昨收×100', 1),
    _fd('bt_trade', 'closePos', '区间位置', '买入时价在当日最高最低之间的位置', '0~1', '0~1',
        '通达信', '(买入时价-最低)/(最高-最低)', 1),
    _fd('bt_trade', 'upperShadow', '上影线', '上影线长度 ÷ 买入时价', '比例', '',
        '通达信', '(最高-max(开,买入时价))/买入时价', 1),
    _fd('bt_trade', 'lowerShadow', '下影线', '下影线长度 ÷ 买入时价', '比例', '',
        '通达信', '(min(开,买入时价)-最低)/买入时价', 1),
    _fd('bt_trade', 'turnoverPct', '换手率', '截至买入时刻的累计换手率', '%', '',
        '通达信分钟/日线 + 通达信 gbbq 股本',
        '截至买入时刻累计成交量 ÷ 买入日时点流通股本 ×100；股本按 gbbq 权益事件时点推导（无前视）', 1),
    _fd('bt_trade', 'turnoverSrc', '换手率口径', '换手率的数据口径', '', '枚举',
        '本库生成',
        'gbbq_pit=时点股本；intraday_minute=分钟真实量；snapshot_const=快照常量股本；floatcap_approx=旧近似口径', 0),
    _fd('bt_trade', 'floatSharesWan', '流通股本', '参与换手率计算的流通股本', '万股', '',
        '通达信 gbbq', 'gbbq 权益事件（变更后流通股本）按买入日时点取值', 1),
    _fd('bt_trade', 'volRatio', '量比', '当日成交量 ÷ 前 5 日均量', '倍', '',
        '通达信日线', '截至买入时刻累计量 ÷ 前 5 日全天均量', 1),
    _fd('bt_trade', 'volRatioIntraday', '分时量比', '同刻累计量 ÷ 近 5 日同刻均量', '倍', '',
        '通达信分钟线', '当日截至 14:30 累计量 ÷ 前 5 日同一时段累计量均值', 1),
    _fd('bt_trade', 'amountWan', '成交额', '截至买入时刻累计成交额', '万元', '',
        '通达信', '分钟 amount 求和 ÷ 1e4', 1),
    _fd('bt_trade', 'floatMcapYi', '流通市值', '按买入时价计算的流通市值', '亿元', '',
        '通达信 gbbq + 通达信日线', '买入日时点流通股本 × 买入时价', 1),
    _fd('bt_trade', 'bias20', '20日乖离率', '买入时价相对 20 日均线偏离', '%', '',
        '通达信', '买入时价/ma20-1', 1),
    _fd('bt_trade', 'bias60', '60日乖离率', '买入时价相对 60 日均线偏离', '%', '',
        '通达信', '买入时价/ma60-1', 1),
    _fd('bt_trade', 'rsi14', 'RSI14', '日线 RSI(14)', '', '0~100', '通达信', 'Wilder 平滑', 1),
    _fd('bt_trade', 'atrPct', 'ATR占比', '日线 ATR14 ÷ 买入时价', '%', '',
        '通达信', 'ATR14/买入时价×100', 1),
    _fd('bt_trade', 'ret5', '近5日收益', '买入时价相对 5 日前收盘', '%', '',
        '通达信', '买入时价/close[t-5]-1', 1),
    _fd('bt_trade', 'ret20', '近20日收益', '买入时价相对 20 日前收盘', '%', '',
        '通达信', '买入时价/close[t-20]-1', 1),
    _fd('bt_trade', 'ret60', '近60日收益', '买入时价相对 60 日前收盘', '%', '',
        '通达信', '买入时价/close[t-60]-1', 1),
    _fd('bt_trade', 'distHh20', '距20日高点', '买入时价相对 20 日最高价', '%', '',
        '通达信', '买入时价/hh20-1', 1),
    _fd('bt_trade', 'listDays', '上市交易日数', '该股在样本内的 K 线序号', '日', '',
        '通达信', '有效 K 线计数', 1),
    _fd('bt_trade', 'ma5Pos', '距5日线', '买入时价相对 ma5 偏离', '%', '', '通达信', '', 1),
    _fd('bt_trade', 'ma10Pos', '距10日线', '买入时价相对 ma10 偏离', '%', '', '通达信', '', 1),
    _fd('bt_trade', 'ma20Pos', '距20日线', '买入时价相对 ma20 偏离', '%', '', '通达信', '', 1),
    _fd('bt_trade', 'ma60Pos', '距60日线', '买入时价相对 ma60 偏离', '%', '', '通达信', '', 1),
    _fd('bt_trade', 'ma120Pos', '距120日线', '买入时价相对 ma120 偏离', '%', '', '通达信', '', 1),
    _fd('bt_trade', 'ma5Slope', '5日线斜率', 'ma5 近 5 日变化率', '%', '', '通达信',
        '(ma5[t]/ma5[t-5]-1)×100', 1),
    _fd('bt_trade', 'ma10Slope', '10日线斜率', 'ma10 近 10 日变化率', '%', '', '通达信', '', 1),
    _fd('bt_trade', 'ma20Slope', '20日线斜率', 'ma20 近 10 日变化率', '%', '', '通达信', '', 1),
    _fd('bt_trade', 'ma60Slope', '60日线斜率', 'ma60 近 20 日变化率', '%', '', '通达信', '', 1),
    _fd('bt_trade', 'ma120Slope', '120日线斜率', 'ma120 近 20 日变化率', '%', '', '通达信', '', 1),
    _fd('bt_trade', 'maAlign', '均线排列', 'ma5/10/20/60 的相对位置', '', 0,
        '通达信', 'bull_align 多头/bear_align 空头/converge 粘合/mixed 交织', 1),
    _fd('bt_trade', 'dayPatterns', '日线命中形态', '命中的日线形态 ID 列表（可多命中）', '',
        '', 'tools/patterns 注册表', '注册表 31 条形态逐条判定', 1),
    _fd('bt_trade', 'dayPatternMask', '日线形态掩码', '命中形态的位掩码', '', '',
        '本库生成', '与 bt_pattern_def.bitIndex 对应', 1),
    _fd('bt_trade', 'dayCategories', '日线形态分类', '命中形态所属分类集合', '', '',
        'tools/patterns 注册表', '', 1),
    _fd('bt_trade', 'dayShape', '日线形态位置', '长周期均线/通道位置语义', '', 0,
        '本库派生',
        '震荡形态/探底形态/波动回踩/上升通道/下降通道/高位横盘', 1),
    _fd('bt_trade', 'pos120', '120日区间位置', '买入时价在 120 日区间的位置', '0~1', '0~1',
        '通达信', '(买入时价-ll120)/(hh120-ll120)', 1),
    _fd('bt_trade', 'channelType', '通道类型', '20 日线性回归通道方向', '', 'up/down/box',
        '本库派生', '按斜率与 R² 判定', 1),
    _fd('bt_trade', 'marketTemp', '全市场温度', '买入日全市场温度历史分位', '0~1', '0~1',
        '本库派生', '广度+涨跌停+成交额+指数合成', 1),
    _fd('bt_trade', 'marketRegime', '市场状态', '买入日市场五态分类', '', 0,
        'market-regime.js 同口径', '强势主升/震荡偏强/轮动震荡/恐慌修复/弱势退潮', 1),
    _fd('bt_trade', 'sectorPct', '板块涨幅', '所属行业指数当日涨跌幅', '%', '',
        '通达信板块指数', '', 1),
    _fd('bt_trade', 'sectorRet5', '板块5日收益', '所属行业指数近 5 日收益', '%', '',
        '通达信板块指数', '', 1),
    _fd('bt_trade', 'sectorRet20', '板块20日收益', '所属行业指数近 20 日收益', '%', '',
        '通达信板块指数', '', 1),
    _fd('bt_trade', 'sectorHeat', '板块温度', '所属行业热度历史分位', '0~1', '0~1',
        '本库派生', '板块涨幅分位与资金强度合成', 1),
    _fd('bt_trade', 'sectorUpRatio', '板块上涨占比', '所属行业成分股上涨家数占比', '%', '',
        '本库派生', '按行业映射逐日统计', 1),
    _fd('bt_trade', 'sectorLimitUpCnt', '板块涨停家数', '所属行业成分股涨停家数', '家', '',
        '本库派生', '按行业映射逐日统计', 1),
    _fd('bt_trade', 'conceptTags', '概念标签', '概念题材标签（本版预留）', '', '',
        '—', '本版不做，保持 NULL', 0),
    _fd('bt_trade', 'conceptHeat', '概念热度', '龙头概念热度分位（本版预留）', '0~1', '',
        '—', '本版不做，保持 NULL', 0),
    _fd('bt_trade', 'benchPct', '基准涨幅', '沪深300 当日涨跌幅', '%', '',
        '通达信板块指数', '', 1),
    _fd('bt_trade', 'isLimitUp', '买入日涨停', '买入日是否涨停收盘', '0/1', '0/1',
        '通达信', '按板块涨跌幅限制判定', 1),
    _fd('bt_trade', 'touchedLimit', '买入日触板', '买入日盘中触及涨停但未封板', '0/1', '0/1',
        '通达信', '', 1),
    _fd('bt_trade', 'nextOpen', '次日开盘价', 'T+1 开盘价', '元', '', '通达信', '', 1),
    _fd('bt_trade', 'nextHigh', '次日早盘最高价', 'T+1 09:31~11:30 最高价', '元', '',
        '通达信分钟线', '', 0),
    _fd('bt_trade', 'nextClose', '次日卖出价', '按卖出规则确定的卖出价', '元', '',
        '通达信', '', 0),
    _fd('bt_trade', 'retOpen', '开盘卖出收益', 'T+1 开盘卖出毛收益', '%', '',
        '本库计算', 'nextOpen/entryPrice-1', 0),
    _fd('bt_trade', 'retHigh', '次日早盘最高涨幅', 'T+1 上午最高价相对买入价', '%', '',
        '本库计算', 'nextHigh/entryPrice-1 —— 本回测的核心标签', 0),
    _fd('bt_trade', 'retClose', '卖出规则收益', '按卖出规则计算的毛收益', '%', '',
        '本库计算', '', 0),
    _fd('bt_trade', 'limitTouch', '次日触涨停', 'T+1 早盘是否触及涨停', '0/1', '0/1',
        '本库计算', '', 0),
    _fd('bt_trade', 'hit3', '是否≥3%', 'T+1 早盘最高涨幅是否 ≥ +3%', '0/1', '0/1',
        '本库计算', 'retHigh >= 0.03 —— 预测目标', 0),
    _fd('bt_trade', 'stratRet', '策略净收益', '扣双边成本后的可执行收益', '%', '',
        '本库计算', '触+3%则按 max(3%,开盘收益) 计，否则按开盘收益；再扣 0.15%', 0),
    _fd('bt_trade', 'tf5Pattern', '5分钟主形态', '5 分钟周期主形态 ID', '', '',
        'tools/patterns', '周期快照 §bt_trade_tf', 1),
    _fd('bt_trade', 'tf15Pattern', '15分钟主形态', '15 分钟周期主形态 ID', '', '',
        'tools/patterns', '', 1),
    _fd('bt_trade', 'tf30Pattern', '30分钟主形态', '30 分钟周期主形态 ID', '', '',
        'tools/patterns', '', 1),
    _fd('bt_trade', 'tf60Pattern', '60分钟主形态', '60 分钟周期主形态 ID', '', '',
        'tools/patterns', '', 1),
    _fd('bt_trade', 'tf5Mask', '5分钟形态掩码', '5 分钟命中形态位掩码', '', '',
        '本库生成', '', 1),
    _fd('bt_trade', 'tf15Mask', '15分钟形态掩码', '15 分钟命中形态位掩码', '', '',
        '本库生成', '', 1),
    _fd('bt_trade', 'tf30Mask', '30分钟形态掩码', '30 分钟命中形态位掩码', '', '',
        '本库生成', '', 1),
    _fd('bt_trade', 'tf60Mask', '60分钟形态掩码', '60 分钟命中形态位掩码', '', '',
        '本库生成', '', 1),
    _fd('bt_trade', 'tfAlign', '多周期共振', '4 个周期形态方向是否一致', '', 0,
        '本库派生', 'all_bull/all_bear/mixed/partial/na', 1),
    _fd('bt_trade', 'tfAlignScore', '共振分', '各周期方向分之和', '分', '-8~8',
        '本库派生', '', 1),
    _fd('bt_trade', 'tfCoverage', '周期覆盖数', '有快照的周期个数', '个', '0~4',
        '本库派生', '', 1),
    _fd('bt_trade', 'tfQuality', '周期数据质量', '多周期快照质量', '', 0,
        '本库派生', 'ok/warmup/mixed/gap/missing', 0),
    _fd('bt_trade', 'createdAt', '入库时间', '写入时间', '', '', '本库生成', '', 0),

    # ---- bt_trade_tf ----
    _fd('bt_trade_tf', 'tradeId', '逐笔主键', '关联 bt_trade', '', '', '本库生成', '', 0),
    _fd('bt_trade_tf', 'runId', '批次号', '关联 bt_run', '', '', '本库生成', '', 0),
    _fd('bt_trade_tf', 'period', '周期', 'K 线周期（分钟）', '分钟', '5/15/30/60',
        '本库生成', '1 分钟按结束时刻归桶聚合', 0),
    _fd('bt_trade_tf', 'code', '股票代码', '', '', '', '通达信分钟线', '', 0),
    _fd('bt_trade_tf', 'date', '交易日', 'YYYYMMDD', '', '', '通达信分钟线', '', 0),
    _fd('bt_trade_tf', 'asOf', '决策时刻', '多周期快照的决策时点', 'HHMM', '1430',
        '本库生成', '只用 endTime<=asOf 的已收盘 bar', 0),
    _fd('bt_trade_tf', 'lastBarTime', '末根结束时刻', '最后一根已收盘 bar 的结束时刻', 'HHMM',
        '5/15/30m→1430，60m→1400', '通达信分钟线', '', 0),
    _fd('bt_trade_tf', 'barCount', '可用根数', '该周期累计 K 线根数', '根', '',
        '通达信分钟线', '用于判断指标预热', 1),
    _fd('bt_trade_tf', 'barsToday', '当日根数', '当日已收盘根数', '根', '',
        '通达信分钟线', '少于满档说明当日数据缺口', 1),
    _fd('bt_trade_tf', 'closeVsMa5Pct', '距周期MA5', '收盘相对周期 ma5 偏离', '%', '',
        '本库计算', '', 1),
    _fd('bt_trade_tf', 'closeVsMa10Pct', '距周期MA10', '收盘相对周期 ma10 偏离', '%', '',
        '本库计算', '', 1),
    _fd('bt_trade_tf', 'closeVsMa20Pct', '距周期MA20', '收盘相对周期 ma20 偏离', '%', '',
        '本库计算', '', 1),
    _fd('bt_trade_tf', 'closeVsMa60Pct', '距周期MA60', '收盘相对周期 ma60 偏离', '%', '',
        '本库计算', '', 1),
    _fd('bt_trade_tf', 'ma5SlopePct', '周期MA5斜率', 'ma5 近 5 根变化率', '%', '',
        '本库计算', '', 1),
    _fd('bt_trade_tf', 'maAlign', '周期均线排列', '周期 ma5/10/20/60 相对位置', '', 0,
        '本库计算', '', 1),
    _fd('bt_trade_tf', 'posInRange20', '20根区间位置', '收盘在近 20 根区间的位置', '0~1', '0~1',
        '本库计算', '', 1),
    _fd('bt_trade_tf', 'posInRange60', '60根区间位置', '收盘在近 60 根区间的位置', '0~1', '0~1',
        '本库计算', '', 1),
    _fd('bt_trade_tf', 'rangeAmp20Pct', '20根区间振幅', '近 20 根最高最低振幅', '%', '',
        '本库计算', '', 1),
    _fd('bt_trade_tf', 'volRatio20', '周期量比', '最新一根量 ÷ 前 20 根均量', '倍', '',
        '本库计算', '', 1),
    _fd('bt_trade_tf', 'atrPct14', '周期ATR占比', '周期 ATR14 ÷ 收盘', '%', '',
        '本库计算', '', 1),
    _fd('bt_trade_tf', 'rsi14', '周期RSI14', '周期 RSI(14)', '', '0~100', '本库计算', '', 1),
    _fd('bt_trade_tf', 'macdHistPct', '周期MACD柱', '周期 MACD 柱 ÷ 收盘', '%', '',
        '本库计算', '', 1),
    _fd('bt_trade_tf', 'ret1Pct', '末根涨幅', '最近 1 根收益', '%', '', '本库计算', '', 1),
    _fd('bt_trade_tf', 'ret5Pct', '近5根收益', '最近 5 根收益', '%', '', '本库计算', '', 1),
    _fd('bt_trade_tf', 'trendSlopePct', '周期趋势斜率', '近 20 根线性回归斜率', '%/根', '',
        '本库计算', '', 1),
    _fd('bt_trade_tf', 'trendR2', '周期趋势拟合度', '近 20 根线性回归 R²', '', '0~1',
        '本库计算', '高 R² + 正斜率=上升通道；低 R²=箱体/震荡', 1),
    _fd('bt_trade_tf', 'patterns', '周期命中形态', '命中的周期形态 ID 列表', '', '',
        'tools/patterns', 'A 类原样复用 / B 类放大窗口 / C 类不生成', 1),
    _fd('bt_trade_tf', 'patternMask', '周期形态掩码', '命中形态位掩码', '', '',
        '本库生成', '', 1),
    _fd('bt_trade_tf', 'primaryPattern', '周期主形态', '按 priority 取的主形态', '', '',
        '本库生成', '', 1),
    _fd('bt_trade_tf', 'patternBias', '周期形态方向', '命中形态方向汇总', '', 'bull/bear/neutral',
        '本库生成', '', 1),
    _fd('bt_trade_tf', 'biasScore', '周期方向分', '看多命中数 − 看空命中数', '分', '',
        '本库生成', '', 1),
    _fd('bt_trade_tf', 'engineVersion', '形态引擎版本', '', '', '',
        'tools/patterns 注册表', '', 0),
    _fd('bt_trade_tf', 'qualityFlags', '数据质量', 'ok/warmup/short_bars/gap', '', 0,
        '本库生成', '', 0),
    _fd('bt_trade_tf', 'createdAt', '入库时间', '', '', '', '本库生成', '', 0),

    # ---- bt_run / bt_stat / 其它 ----
    _fd('bt_run', 'runId', '批次号', '一次回测运行', '', '', '本库生成', '', 0),
    _fd('bt_run', 'runKey', '批次标识', '可读的批次唯一键', '', '', '本库生成', '', 0),
    _fd('bt_run', 'buyTime', '基准买入时刻', 'HHMM', 'HHMM', '1430', '本库生成', '', 0),
    _fd('bt_run', 'sellTimeStart', '卖出窗口起', 'HHMM', 'HHMM', '0930', '本库生成', '', 0),
    _fd('bt_run', 'sellTimeEnd', '卖出窗口止', 'HHMM', 'HHMM', '1000', '本库生成', '', 0),
    _fd('bt_run', 'costBps', '双边成本', '交易成本', '%', '', '本库生成', '默认 0.15', 0),
    _fd('bt_run', 'universeFilter', '股票池过滤', '入池与排除规则文字说明', '', '',
        '本库生成', '', 0),
    _fd('bt_run', 'paramsJson', '口径参数', '全部口径参数（含时间戳口径）', '', '',
        '本库生成', '', 0),
    _fd('bt_stat', 'statId', '统计主键', '', '', '', '本库生成', '', 0),
    _fd('bt_stat', 'runId', '批次号', '', '', '', '本库生成', '', 0),
    _fd('bt_stat', 'dimension', '统计维度', '分桶所依据的维度', '', 0,
        '本库生成', 'overall/year/date/board/industry/amp/... /tf30_pattern/tf_align', 0),
    _fd('bt_stat', 'bucket', '分桶', '维度取值', '', '', '本库生成', '', 0),
    _fd('bt_stat', 'sampleCnt', '样本笔数', '该桶样本数', '笔', '', '本库生成', '', 0),
    _fd('bt_stat', 'hit1Pct', '≥1%占比', '次日早盘最高 ≥+1%', '%', '', '本库生成', '', 0),
    _fd('bt_stat', 'hit2Pct', '≥2%占比', '次日早盘最高 ≥+2%', '%', '', '本库生成', '', 0),
    _fd('bt_stat', 'hit3Pct', '≥3%占比', '次日早盘最高 ≥+3%', '%', '', '本库生成', '', 0),
    _fd('bt_stat', 'hit4Pct', '≥4%占比', '次日早盘最高 ≥+4%', '%', '', '本库生成', '', 0),
    _fd('bt_stat', 'hit5Pct', '≥5%占比', '次日早盘最高 ≥+5%', '%', '', '本库生成', '', 0),
    _fd('bt_stat', 'hit6Pct', '≥6%占比', '次日早盘最高 ≥+6%', '%', '', '本库生成', '', 0),
    _fd('bt_stat', 'hit7Pct', '≥7%占比', '次日早盘最高 ≥+7%', '%', '', '本库生成', '', 0),
    _fd('bt_stat', 'hit8Pct', '≥8%占比', '次日早盘最高 ≥+8%', '%', '', '本库生成', '', 0),
    _fd('bt_stat', 'hit9Pct', '≥9%占比', '次日早盘最高 ≥+9%', '%', '', '本库生成', '', 0),
    _fd('bt_stat', 'limitUpPct', '触及涨停占比', '次日早盘触及涨停', '%', '',
        '本库生成', '', 0),
    _fd('bt_stat', 'retOpenMean', '开盘卖出均值', '次日开盘卖出平均收益', '%', '',
        '本库生成', '', 0),
    _fd('bt_stat', 'retHighMean', '早盘最高均值', '次日早盘最高涨幅平均', '%', '',
        '本库生成', '', 0),
    _fd('bt_stat', 'retCloseMean', '卖出规则均值', '按卖出规则的平均收益', '%', '',
        '本库生成', '', 0),
    _fd('bt_stat', 'stratMean', '策略净收益均值', '扣成本后平均收益', '%', '',
        '本库生成', '', 0),
    _fd('bt_stat', 'winRate', '真实胜率', '策略净收益 > 0 的笔数占比', '%', '',
        '本库生成', '', 0),
    _fd('bt_stat', 'profitFactor', '盈亏比', '总盈利 ÷ 总亏损', '倍', '', '本库生成', '', 0),
    _fd('bt_stat', 'lift3', '≥3% lift', '相对全样本基准的倍数', '倍', '', '本库生成', '', 0),
    _fd('bt_stat', 'ci95Low', '≥3%置信下界', '95% 置信区间下界', '%', '', '本库生成', '', 0),
    _fd('bt_stat', 'ci95High', '≥3%置信上界', '95% 置信区间上界', '%', '', '本库生成', '', 0),
    _fd('bt_stat', 'byYearJson', '分年命中率', '分年 ≥3% 命中率', '', '', '本库生成', '', 0),
    _fd('bt_stat', 'stability', '稳定性', 'stable/fragile/insufficient', '', '',
        '本库生成', '', 0),
    _fd('bt_stat', 'note', '备注', '', '', '', '本库生成', '', 0),
    _fd('bt_time_grid', 'buyMinute', '买入时刻', 'HHMM', 'HHMM', '1430~1455',
        '时间网格回测', '', 0),
    _fd('bt_time_grid', 'sellMinute', '卖出时刻', 'HHMM', 'HHMM', '0931~1000',
        '时间网格回测', '', 0),
    _fd('bt_time_grid', 'retMeanPct', '平均收益', '该买卖时点组合的平均净收益', '%', '',
        '时间网格回测', '', 0),
    _fd('bt_time_grid', 'retMedPct', '收益中位数', '', '%', '', '时间网格回测', '', 0),
    _fd('bt_time_grid', 'winRate', '胜率', '', '%', '', '时间网格回测', '', 0),
    _fd('bt_time_grid', 'retStdPct', '收益标准差', '', '%', '', '时间网格回测', '', 0),
    _fd('bt_time_grid', 'hit3Pct', '≥3%占比', '该时点组合 ≥+3% 占比', '%', '',
        '时间网格回测', '', 0),
    _fd('bt_time_marginal', 'leg', '腿', 'buy=买入时刻边际 / sell=卖出时刻边际', '',
        'buy/sell', '时间网格回测', '', 0),
    _fd('bt_time_marginal', 'minute', '时刻', 'HHMM', 'HHMM', '', '时间网格回测', '', 0),
    _fd('bt_time_marginal', 'isBestShare', '窗口内最优占比', '该时刻是窗口内最优的比例', '%',
        '', '时间网格回测', '', 0),
    _fd('bt_pattern_def', 'patternId', '形态ID', '日线为注册表原 ID，分钟为 ID@周期', '', '',
        'tools/patterns 注册表', '', 0),
    _fd('bt_pattern_def', 'nameCn', '形态中文名', '', '', '', 'tools/patterns 注册表', '', 0),
    _fd('bt_pattern_def', 'scope', '适用范围', 'day/intraday/both', '', 0,
        '本库派生', '', 0),
    _fd('bt_pattern_def', 'periods', '适用周期', '', '', '', '本库派生', '', 0),
    _fd('bt_pattern_def', 'sourceModule', '来源模块', '', '', '', 'tools/patterns', '', 0),
    _fd('bt_pattern_def', 'category', '形态分类', '5 大分类', '', 0, 'tools/patterns', '', 0),
    _fd('bt_pattern_def', 'direction', '方向', 'bull/bear/neutral', '', 0,
        '本库派生', '', 0),
    _fd('bt_pattern_def', 'priority', '主形态优先级', '数字越小越优先', '', '',
        '本库派生', '分类权重×100 + 注册表顺序', 0),
    _fd('bt_pattern_def', 'bitIndex', '掩码位', '位掩码下标 0~62', '', '', '本库派生', '', 0),
    _fd('bt_pattern_def', 'ruleExpr', '判定规则', '注册表 desc', '', '',
        'tools/patterns', '', 0),
    _fd('bt_pattern_def', 'ruleParams', '规则参数', 'JSON', '', '', 'tools/patterns', '', 0),
    _fd('bt_pattern_def', 'basisNote', '参考依据', '', '', '', '本库派生', '', 0),
    _fd('bt_pattern_def', 'version', '规则版本', '', '', '', '本库派生', '', 0),
    _fd('bt_pattern_def', 'usableForDecision', '可用于实盘', '是否达到实盘凭据标准', '0/1', '0/1',
        '本库派生', '样本量+逐年稳定性双达标才置 1', 0),
    _fd('bt_pattern_def', 'evidenceTradeCnt', '验证样本数', '', '笔', '', '本库验证', '', 0),
    _fd('bt_pattern_def', 'evidenceHit3Pct', '验证≥3%', '', '%', '', '本库验证', '', 0),
    _fd('bt_pattern_def', 'evidenceLift', '验证 lift', '', '倍', '', '本库验证', '', 0),
    _fd('bt_pattern_def', 'evidenceYears', '分年命中率', 'JSON', '', '', '本库验证', '', 0),
    _fd('bt_rule', 'ruleName', '规则名', '', '', '', '规则扫描', '', 0),
    _fd('bt_rule', 'conditionsJson', '条件定义', 'JSON', '', '', '规则扫描', '', 0),
    _fd('bt_rule', 'hit3Pct', '≥3%命中率', '', '%', '', '规则扫描', '', 0),
    _fd('bt_rule', 'baseHit3Pct', '基准命中率', '', '%', '', '规则扫描', '', 0),
    _fd('bt_rule', 'lift3', 'lift', '', '倍', '', '规则扫描', '', 0),
    _fd('bt_rule', 'verdict', '结论', '采纳/观察/否决', '', 0, '规则扫描', '', 0),
    _fd('bt_sector_day', 'boardId', '板块代码', '', '', '', '通达信板块指数', '', 0),
    _fd('bt_sector_day', 'boardType', '板块类型', '行业/概念/地域', '', 0,
        '通达信板块指数', '', 0),
    _fd('bt_sector_day', 'heatPct', '板块热度分位', '', '0~1', '0~1', '本库派生', '', 1),
    _fd('bt_sector_day', 'rankPct', '板块排名分位', '当日板块涨幅排名分位', '0~1', '0~1',
        '本库派生', '', 1),
    _fd('bt_market_day', 'tempPct', '市场温度分位', '温度分历史分位', '0~1', '0~1',
        '本库派生', '', 1),
    _fd('bt_market_day', 'regime', '市场状态', '五态分类', '', 0,
        'market-regime.js 同口径', '', 1),

    # ---- bt_run 续 ----
    _fd('bt_run', 'createdAt', '批次创建时间', 'ISO 时间', '', '', '本库生成', '', 0),
    _fd('bt_run', 'engineVersion', '引擎版本', '口径版本号', '', '', '本库生成', '', 0),
    _fd('bt_run', 'priceMode', '价格口径', '复权方式', '', 'qfq-adjust/raw',
        '本库生成', '收益用前复权，涨跌停用不复权', 0),
    _fd('bt_run', 'excludeIndustry', '排除行业', '本次排除的行业', '', '', '本库生成',
        '银行股', 0),
    _fd('bt_run', 'keepDelisted', '保留退市股', '0=剔除退市股（引入幸存者偏差）', '0/1',
        '0/1', '本库生成', '', 0),
    _fd('bt_run', 'tradeCount', '原始样本笔数', '该批次回测总笔数', '笔', '', '本库生成', '', 0),
    _fd('bt_run', 'note', '批次备注', '口径与局限说明', '', '', '本库生成', '', 0),

    # ---- bt_time_grid 续 ----
    _fd('bt_time_grid', 'runId', '批次号', '关联 bt_run', '', '', '本库生成', '', 0),
    _fd('bt_time_grid', 'sampleCnt', '样本笔数', '', '笔', '', '时间网格回测', '', 0),

    # ---- bt_time_marginal 续 ----
    _fd('bt_time_marginal', 'runId', '批次号', '关联 bt_run', '', '', '本库生成', '', 0),
    _fd('bt_time_marginal', 'sampleCnt', '样本笔数', '', '笔', '', '时间网格回测', '', 0),
    _fd('bt_time_marginal', 'retMeanPct', '该时刻平均收益', '买入腿=该买入时刻至次日10:00；'
        '卖出腿=14:30买入至该卖出时刻', '%', '', '时间网格回测', '', 0),

    # ---- bt_rule 续 ----
    _fd('bt_rule', 'ruleId', '规则主键', '', '', '', '本库生成', '', 0),
    _fd('bt_rule', 'runId', '批次号', '关联 bt_run', '', '', '本库生成', '', 0),
    _fd('bt_rule', 'sampleCnt', '样本笔数', '', '笔', '', '规则扫描', '', 0),
    _fd('bt_rule', 'stratMean', '策略净收益均值', '扣成本后平均收益', '%', '',
        '规则扫描', '', 0),
    _fd('bt_rule', 'byYearJson', '分年命中率', 'JSON：[{year,hit3Pct}]', '', '',
        '规则扫描', '', 0),
    _fd('bt_rule', 'note', '结论说明', '', '', '', '本库判定', '', 0),

    # ---- bt_pattern_def 续 ----
    _fd('bt_pattern_def', 'weight', '形态权重', '分类权重', '', '', '本库派生', '', 0),
    _fd('bt_pattern_def', 'validatedAt', '验证时间', '样本外验证完成时间', '', '',
        '本库验证', '', 0),

    # ---- bt_market_day 续 ----
    _fd('bt_market_day', 'date', '交易日', 'YYYYMMDD', '', '', '通达信日线', '', 0),
    _fd('bt_market_day', 'upRatio', '全市场上涨家数占比', '当日收涨家数 ÷ 有效家数', '%',
        '0~100', '本库派生', '', 1),
    _fd('bt_market_day', 'limitUpCnt', '涨停家数', '封涨停家数', '家', '', '本库派生',
        '涨幅≥涨跌停比例−0.8 且 收盘=最高', 1),
    _fd('bt_market_day', 'limitDownCnt', '跌停家数', '封跌停家数', '家', '', '本库派生',
        '涨幅≤−(涨跌停比例−0.8) 且 收盘=最低', 1),
    _fd('bt_market_day', 'up5Ratio', '大涨家数占比', '涨幅 ≥+5% 家数占比', '%', '0~100',
        '本库派生', '', 1),
    _fd('bt_market_day', 'medianPct', '涨跌幅中位数', '全市场当日涨跌幅中位数', '%', '',
        '本库派生', '', 1),
    _fd('bt_market_day', 'totalAmountYi', '全市场成交额', '当日全部个股成交额合计', '亿元',
        '', '通达信日线', '', 1),
    _fd('bt_market_day', 'amountRatio5', '量能比', '当日成交额 ÷ 前 5 日均额', '倍', '',
        '本库派生', '', 1),
    _fd('bt_market_day', 'indexPct', '沪深300涨跌幅', '基准指数当日涨跌', '%', '',
        '通达信指数日线', '', 1),
    _fd('bt_market_day', 'indexMa20Pos', '沪深300距20日线', '指数相对 20 日均线偏离', '%',
        '', '本库派生', '', 1),
    _fd('bt_market_day', 'tempScore', '市场温度原始分', '0.4×上涨占比 + 0.2×涨停 + '
        '0.2×中位数 + 0.2×量能', '分', '', '本库派生',
        '0.4*upRatio + 0.2*min(涨停/120,1.5) + 0.2*min((中位数+2)/4,1.5) + 0.1*min(量能比,2)',
        1),

    # ---- bt_sector_day 续 ----
    _fd('bt_sector_day', 'date', '交易日', 'YYYYMMDD', '', '', '通达信日线', '', 0),
    _fd('bt_sector_day', 'boardName', '板块中文名', '如「互联网」「半导体」', '', '',
        '通达信板块', '', 1),
    _fd('bt_sector_day', 'pct', '板块当日涨幅', '板块指数当日涨跌幅', '%', '',
        '通达信板块指数', '', 1),
    _fd('bt_sector_day', 'ret5', '板块近5日涨幅', '板块指数 5 日收益', '%', '',
        '通达信板块指数', '', 1),
    _fd('bt_sector_day', 'ret20', '板块近20日涨幅', '板块指数 20 日收益', '%', '',
        '通达信板块指数', '', 1),
    _fd('bt_sector_day', 'amountRatio5', '板块量能比', '板块成交额 ÷ 前 5 日均额；'
        '无板块成交额时为空', '倍', '', '本库派生', '本期为空', 0),
    _fd('bt_sector_day', 'upRatio', '板块内上涨占比', '成分股收涨家数 ÷ 成分家数', '%',
        '0~100', '本库派生', '', 1),
    _fd('bt_sector_day', 'limitUpCnt', '板块内涨停家数', '', '家', '', '本库派生', '', 1),
    _fd('bt_sector_day', 'heatScore', '板块热度分', '0.5×涨幅 + 0.4×上涨占比偏离 + '
        '0.1×涨停贡献', '分', '', '本库派生',
        '0.5*pct + 0.4*(upRatio-50)/50*2 + 0.1*min(涨停家数/5,2)', 1),

    # ---- bt_trade_context ----
    _fd('bt_trade_context', 'tradeId', '逐笔主键', '关联 bt_trade.tradeId', '', '',
        '本库生成', '', 0),
    _fd('bt_trade_context', 'runId', '批次号', '关联 bt_run', '', '', '本库生成', '', 0),
    _fd('bt_trade_context', 'marketTemp', '市场温度', '买入日全市场温度原始分', '分', '',
        'bt_market_day', '', 1),
    _fd('bt_trade_context', 'marketRegime', '市场状态', 'strong_trend/range_strong/'
        'rotation/recovery/weak', '', '枚举', 'bt_market_day', '', 1),
    _fd('bt_trade_context', 'sectorHeat', '板块热度', '所属行业当日热度分', '分', '',
        'bt_sector_day', '', 1),
    _fd('bt_trade_context', 'sectorUpRatio', '板块内上涨占比', '%', '%', '0~100',
        'bt_sector_day', '', 1),
    _fd('bt_trade_context', 'conceptHeat', '概念热度', '本期概念数据未接入，为空', '分', '',
        '预留', '', 0),
    _fd('bt_trade_context', 'contextJson', '上下文快照', '其他上下文 JSON', '', '',
        '本库生成', '', 0),

    # ---- bt_dataset ----
    _fd('bt_dataset', 'datasetId', '数据集ID', 'kline_day / minute_1m / minute_5m / '
        'minute_15m / minute_30m / minute_60m', '', '', '本库生成', '', 0),
    _fd('bt_dataset', 'kind', '数据类型', 'day/minute', '', 'day/minute', '本库生成', '', 0),
    _fd('bt_dataset', 'freqMin', '分钟周期', '日线为空；分钟为 1/5/15/30/60', '分钟', '',
        '本库生成', '', 0),
    _fd('bt_dataset', 'source', '数据来源', '本地文件路径或派生方式', '', '',
        '本库生成', '', 0),
    _fd('bt_dataset', 'dateMin', '起始日期', 'YYYYMMDD', '', '', '本库生成', '', 0),
    _fd('bt_dataset', 'dateMax', '结束日期', 'YYYYMMDD', '', '', '本库生成', '', 0),
    _fd('bt_dataset', 'tradingDays', '交易日数', '该数据集覆盖的交易日数量', '日', '',
        '本库生成', '', 0),
    _fd('bt_dataset', 'codeCount', '股票数量', '覆盖的股票只数', '只', '', '本库生成', '', 0),
    _fd('bt_dataset', 'barsPerCode', '每股根数', '每只股票的数据根数', '根', '',
        '本库生成', '', 0),
    _fd('bt_dataset', 'missingNote', '缺口说明', '数据缺失与局限说明', '', '',
        '本库生成', '', 0),
    _fd('bt_dataset', 'builtAt', '登记时间', 'ISO 时间', '', '', '本库生成', '', 0),
]

# ---- bt_reverse_sample：14:40 分时反推批次的原始采样（与 samples.csv 95 列一一对应）----
# (列名, 中文名, 单位, 取值范围, 是否模型特征)
_REVERSE_SAMPLE_DEFS = [
    ('code', '股票代码', '', '', 0),
    ('name', '股票名称', '', '', 0),
    ('date', '买入日T', '', 'YYYYMMDD', 0),
    ('nextDate', '次日T+1', '', 'YYYYMMDD', 0),
    ('board', '上市板', '', '枚举', 0),
    ('industry', '所属行业', '', '枚举', 0),
    ('entry1440', '14:40买入价', '元', '', 0),
    ('tCloseRaw', 'T日不复权收盘价', '元', '', 0),
    ('dPctPrev', '前一日涨幅', '%', '', 1),
    ('dAmpPrev', '前一日振幅', '%', '', 1),
    ('dRet5', '前一日近5日收益', '%', '', 1),
    ('dRet20', '前一日近20日收益', '%', '', 1),
    ('dRet60', '前一日近60日收益', '%', '', 1),
    ('dRsi14', '前一日RSI14', '', '0~100', 1),
    ('dAtrPct', '前一日ATR14波动率', '%', '', 1),
    ('dBias5', '前一日5日乖离', '%', '', 1),
    ('dBias10', '前一日10日乖离', '%', '', 1),
    ('dBias20', '前一日20日乖离', '%', '', 1),
    ('dBias60', '前一日60日乖离', '%', '', 1),
    ('dBias120', '前一日120日乖离', '%', '', 1),
    ('dDistHh20', '前一日距20日新高', '%', '', 1),
    ('dListDays', '上市天数', '日', '', 1),
    ('dFloatMcapYi', '流通市值', '亿元', '', 1),
    ('dBoard', '上市板(分类特征)', '', '枚举', 1),
    ('marketTemp', '全市场温度', '0~1', 'T-1', 1),
    ('marketUpRatio', '全市场上涨占比', '%', 'T-1', 1),
    ('marketLimitUpCnt', '全市场涨停家数', '家', 'T-1', 1),
    ('marketRegime', '市场环境', '', 'T-1', 1),
    ('sectorPct', '所属行业涨幅', '%', 'T-1', 1),
    ('sectorRet5', '所属行业5日收益', '%', 'T-1', 1),
    ('sectorRet20', '所属行业20日收益', '%', 'T-1', 1),
    ('sectorHeat', '所属行业热度分', '0~100', 'T-1', 1),
    ('sectorUpRatio', '所属行业上涨占比', '%', 'T-1', 1),
    ('sectorLimitUpCnt', '所属行业涨停家数', '家', 'T-1', 1),
    ('mRet10', '尾盘14:30→14:40涨幅', '%', '', 1),
    ('mRet5', '尾盘14:35→14:40涨幅', '%', '', 1),
    ('mRet30', '尾盘14:10→14:40涨幅', '%', '', 1),
    ('mRet60', '尾盘13:40→14:40涨幅', '%', '', 1),
    ('mAccel10', '尾盘动量加速度', '%', '', 1),
    ('mTailAmtShare10', '尾盘10分钟成交额占比', '', '0~1', 1),
    ('mTailAmtShare30', '尾盘30分钟成交额占比', '', '0~1', 1),
    ('mTailAmtTempo', '尾盘10分钟量能倍数', '倍', '', 1),
    ('mLastMinAmtShare', '14:40当分钟成交额占比', '', '0~1', 1),
    ('mTailMaxDrop', '尾盘30分钟最大回撤', '%', '', 1),
    ('mTailRangePos', '尾盘区间位置', '0~1', '', 1),
    ('mTailVwapDev', '相对尾盘均价偏离', '%', '', 1),
    ('mTailUpMinShare', '尾盘上涨分钟占比', '0~1', '', 1),
    ('mRetClose1440', '14:40相对昨收涨幅', '%', '', 1),
    ('mRetOpen1440', '14:40相对今开涨幅', '%', '', 1),
    ('mGapPct', '今日开盘缺口', '%', '', 1),
    ('mAmp1440', '截至14:40日内振幅', '%', '', 1),
    ('mClosePos1440', '截至14:40日内位置', '0~1', '', 1),
    ('mVwapDev1440', '相对当日均价偏离', '%', '', 1),
    ('mVwapSlope20', '尾盘20分钟均价斜率', '%', '', 1),
    ('mHiTimeRank', '当日最高点时间位置', '0~1', '', 1),
    ('mFirstHourRet', '上午前60分钟涨幅', '%', '', 1),
    ('mNoonRet', '11:30→14:40涨幅', '%', '', 1),
    ('mPmRet', '下午13:01→14:40涨幅', '%', '', 1),
    ('mVolPct1440', '分时波动率', '%', '', 1),
    ('mUpMinShare', '当日上涨分钟占比', '0~1', '', 1),
    ('mUpDownVolRatio', '上涨/下跌分钟量比', '', '', 1),
    ('mAmtRatio2ndHalf', '后半段成交额占比', '', '0~1', 1),
    ('mTurnover1440', '截至14:40换手率', '%', '', 1),
    ('mAmountWan1440', '截至14:40成交额', '万元', '', 1),
    ('mVolRatio1440', '截至14:40量比', '', '', 1),
    ('hi1000Pct', 'T+1 09:31~10:00最高涨幅', '%', '对照窗口', 0),
    ('hi1000Time', 'T+1最高点时刻(1000窗口)', 'HHMM', '', 0),
    ('hi1030Pct', 'T+1 09:31~10:30最高涨幅', '%', '本批次标签', 1),
    ('hi1030Time', 'T+1最高点时刻(1030窗口)', 'HHMM', '', 0),
    ('hi1130Pct', 'T+1 09:31~11:30最高涨幅', '%', '对照窗口', 0),
    ('hi1130Time', 'T+1最高点时刻(1130窗口)', 'HHMM', '', 0),
    ('openPct', 'T+1开盘涨幅', '%', '', 1),
    ('c1000Pct', 'T+1 10:00价涨幅', '%', '', 1),
    ('c1030Pct', 'T+1 10:30价涨幅', '%', '', 1),
    ('hiDayPct', 'T+1全天最高涨幅', '%', '对照口径', 0),
    ('limitTouch1030', 'T+1早盘是否触涨停', '0/1', '', 1),
    ('limitTouchDay', 'T+1全天是否触涨停', '0/1', '对照口径', 0),
    ('hit1', '标签:T+1早盘最高≥+1%', '0/1', '标签', 0),
    ('hit1000_1', '对照:10:00前最高≥+1%', '0/1', '对照标签', 0),
    ('hit2', '标签:T+1早盘最高≥+2%', '0/1', '标签', 0),
    ('hit1000_2', '对照:10:00前最高≥+2%', '0/1', '对照标签', 0),
    ('hit3', '标签:T+1早盘最高≥+3%', '0/1', '主标签', 0),
    ('hit1000_3', '对照:10:00前最高≥+3%', '0/1', '对照标签', 0),
    ('hit4', '标签:T+1早盘最高≥+4%', '0/1', '标签', 0),
    ('hit1000_4', '对照:10:00前最高≥+4%', '0/1', '对照标签', 0),
    ('hit5', '标签:T+1早盘最高≥+5%', '0/1', '标签', 0),
    ('hit1000_5', '对照:10:00前最高≥+5%', '0/1', '对照标签', 0),
    ('hit6', '标签:T+1早盘最高≥+6%', '0/1', '标签', 0),
    ('hit1000_6', '对照:10:00前最高≥+6%', '0/1', '对照标签', 0),
    ('hit7', '标签:T+1早盘最高≥+7%', '0/1', '标签', 0),
    ('hit1000_7', '对照:10:00前最高≥+7%', '0/1', '对照标签', 0),
    ('hit8', '标签:T+1早盘最高≥+8%', '0/1', '标签', 0),
    ('hit1000_8', '对照:10:00前最高≥+8%', '0/1', '对照标签', 0),
    ('hit9', '标签:T+1早盘最高≥+9%', '0/1', '标签', 0),
    ('hit1000_9', '对照:10:00前最高≥+9%', '0/1', '对照标签', 0),
]
assert len(_REVERSE_SAMPLE_DEFS) == 95, len(_REVERSE_SAMPLE_DEFS)

FEATURE_DEFS += [
    _fd('bt_reverse_sample', col, cn, f'14:40 分时反推批次原始采样｜{cn}', unit, scope,
        'data/backtest/minute-reverse/samples.csv（tools/minute_reverse_backtest.py）',
        '' if feat == 0 else 'T 日 ≤14:40 分时 + T-1 日线/市场/板块；无形态字段', feat)
    for col, cn, unit, scope, feat in _REVERSE_SAMPLE_DEFS
]

# ---- bt_reverse_feature：minute-reverse-v1 模型特征登记 ----
_REVERSE_MODEL_DEFS = [
    _fd('bt_reverse_feature', 'featureKey', '特征键', '与 samples.csv 列名一致', '',
        '', 'minute-reverse-v1', '', 0),
    _fd('bt_reverse_feature', 'nameCn', '特征中文名', '', '', '', 'minute-reverse-v1', '', 0),
    _fd('bt_reverse_feature', 'unit', '单位', '', '', '枚举', 'minute-reverse-v1', '', 0),
    _fd('bt_reverse_feature', 'kind', '特征类型', '数值型/分类型', '', 'num/cat',
        'minute-reverse-v1', '', 0),
    _fd('bt_reverse_feature', 'sourceColumn', '来源列', '对应 bt_reverse_sample 列名', '',
        '', '本库生成', '', 0),
    _fd('bt_reverse_feature', 'inModel', '是否入模', '是否进入 minute-reverse-v1 模型', '0/1',
        '0/1', '本库生成', '', 0),
    _fd('bt_reverse_feature', 'note', '备注', '口径与风险说明', '', '', '本库生成', '', 0),
]
FEATURE_DEFS += _REVERSE_MODEL_DEFS


def feature_rows():
    return FEATURE_DEFS


def create_schema(conn) -> None:
    """建表（幂等）。"""
    conn.executescript(SCHEMA_SQL)
