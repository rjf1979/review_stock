# `limit_pullback` v4 选股公式接入说明（智诊盯盘）

> 研究性离线回测与工程接入说明，不构成投资建议，也不构成任何收益承诺。
> 本文所有数字均由本仓库脚本在本机行情上重算得到，可按下文命令逐条复现。
> 回测证据与推导过程见 `docs/rsi_low_turn与limit_pullback盈亏比优化报告-2021至2026.md`。

## 一、接入范围（2026-09-18 更新）

系统现在**同时启用两条 v4 规则**，用于对比选股效果：

| 规则 | 状态 | 回测（2021-01-04 ~ 2026-09-11，含成本） |
| --- | --- | --- |
| `rsi_low_turn` v4 | `enabled: true` | 5,471 笔 / 胜率 65.67% / 盈亏比 3.0756 / PF 5.8843 / 平均 +13.34% |
| `limit_pullback` v4 | `enabled: true` | 3,089 笔 / 胜率 51.99% / 盈亏比 2.3648 / PF 2.5610 / 平均 +6.08% |

其余 22 个形态保留完整定义与参数，默认 `enabled: false`，随时可在设置页逐条勾选恢复。
大盘过滤（`bench_ma_days` / `bench_ma_mode`）已证伪，仍不接入。

## 二、公式口径（唯一权威版本，改口径必须同时改回测与代码）

### 入场（只用信号日及以前的数据）

1. **涨停锚**：近 `window(15)` 个交易日（**不含信号日**）出现过涨停
   （涨幅 ≥ 涨跌停比例×100 − 0.8pp，且收盘 = 当日最高；ST 5%、30/68 开头 20%、8/4/92 开头 30%、其余 10%）；
2. **缩量回踩**：信号日量能 `volume < 5 日均量 × vol_shrink(0.9)`；
3. **不破支撑**：信号日最低价 ≥ 近 `window(15)` 日最低价 × 0.98；
4. **超跌**：近 `drop_days(60)` 日涨跌幅 ≤ `drop_max(-30)%`；
5. **弱于大盘**：近 `rs_days(20)` 日相对强度 ≤ `rs_max(-5)pp`，
   相对强度 = 个股 20 日涨幅 − 沪深300 同期涨幅（基准当日缺失沿用到最近交易日）。

第 4、5 条是 v4 新增的入场过滤，缺一不可：只加跌幅过滤的 PF 是 1.4158，
叠加相对强度后升到 1.8626，因此**基准缺失时不允许静默放行**，直接给出 `bench_unavailable`。

### 退出（`no_target = true`，6R 只是跟踪启动线）

| 项 | 口径 | 参数名 |
| --- | --- | --- |
| 结构止损 | `max( min(近8根最低价 × 0.98, 买点 − 2×ATR14), 买点 × 0.92 )` | `lowLookback=8` / `stopBuf=0.02` / `atrMult=2` / `riskCapPct=8` |
| 跟踪启动 | 浮盈到 **6R** 才切换到跟踪止盈，**不减仓** | `firstRMultiple=6` / `firstExitFraction=0` |
| 跟踪止损 | `max(MA5 前一根 × 0.94, 期间最高价 × 0.94, 买点保本)` | `trailMa=5` / `trailPct=0.06` |
| 时间止损 | 最长持有 **20 个交易日** | `maxHoldDays=20` |
| 固定目标 | **关闭**（不设测量目标，不落袋） | `noTarget=true` |

ATR14 与结构位都取**信号日之前**已完成的数据，与回测 `_plan_pattern` 完全一致。
`limit_pullback` 在原版下 PF 只有 0.8216（退出端单用 PF 0.897，反而有害），
它的改善几乎全部来自入场过滤；退出沿用与 `rsi_low_turn` v4 同一套参数。

## 三、代码落地位置

| 关注点 | 文件 | 说明 |
| --- | --- | --- |
| 默认规则与门槛 | `rules-store.js` `DEFAULT_RULES` | `limit_pullback` `enabled:true`、`minVolumeScore:0`、`params:{window:15,vol_shrink:0.9,drop_days:60,drop_max:-30,rs_days:20,rs_max:-5}` |
| 参数可编辑白名单 | `rules-store.js` `NUM_KEYS` | 新增 `vol_shrink` / `rs_days` / `rs_max` |
| 沪深300 基准序列 | `bench-series.js`（新） | `ensureBenchSeries()` / `benchCloseLookup()`；取数顺序：进程缓存 → `data/bench-sh000300.json` → 腾讯日K → 项目内通达信日线兜底 → `available:false` |
| 形态识别 | `screener-core.js` `PATTERNS.limit_pullback` | 调用 `isLimitUpBar()` + `limitPullbackEvidence()`，命中分与理由文案带上相对强度证据 |
| 证据纯函数 | `screener-core.js` `limitPullbackEvidence()` | 涨停锚 + 缩量 + 支撑 + 跌幅 + 相对强度，无 IO |
| 价位与退出计划 | `price-levels.js` `limitPullbackPlan()` | `algorithmVersion='limit-pullback-v4'`、`maxHoldDays=20`、`partialExitFraction=0`、`takeProfit[0].type='trail_activation'` |
| 退出口径选择 | `judgment-core.js` `selectPatternPlan()` | 按命中的 `patternId` 选 v4 计划，`prepareCode()` 同时返回 `rsiLowTurnPlan` / `limitPullbackPlan` |
| 设置页编辑 | `frontend/src/components/RuleEditorModal.vue` | `window` / `vol_shrink` / `drop_days` / `drop_max` / `rs_days` / `rs_max` 输入 + `minVolumeScore` |
| 设置页摘要 | `frontend/src/components/SettingsSection.vue` | 显示涨停回踩 v4 参数摘要 |

接口侧：`/api/pool/patterns`、`/api/kline/levels`、`/api/kline/patterns`、`/api/ai/analyze`
以及 `selection-replay.js` 都会带 `benchLookup`；`/api/kline/levels` 在命中 v4 形态时
返回形态自带的退出口径（`patternExitVersion` / `patternExitPlan` / `takeProfit` / `atr14`）。

## 四、怎么用（操作路径）

1. 启动：`npm start`（固定 `http://127.0.0.1:3110`），或直接打开桌面版智诊盯盘。
2. **设置 → 选股规则库**：应看到两条勾选启用 —— `RSI低位拐头（超跌 v4）`、`涨停回踩（超跌 v4）`，
   两条的 `量能分门槛` 均为 0。
3. 点 **编辑** 可改各自的参数，保存后热生效（写入 `data/rules.json`，该文件 gitignore）。
4. 打开 **扫描** 页执行选股；命中任一 v4 规则的票会进入候选并展示命中理由，
   详情页的可执行价位按对应形态的 v4 退出计划显示（结构止损 / 6R 跟踪启动 / 最长 20 日）。

## 五、两个必须知道的行为

1. **相对强度依赖沪深300 基准**。基准取不到时，`limit_pullback` 不会放行
   （理由显示为基准不可用），这是刻意设计。基准缓存写入数据目录的
   `bench-sh000300.json`，默认 TTL 240 分钟。
2. **盘中没有“已确认”信号**。本地 K 线复筛要求尾日 `tailStatus==='confirmed'`，
   盘中只产出 `admissionMode='pending_kline'` 的潜力候选；**候选 ≠ 形态命中**。

## 六、选股效果（2026-09-18 实测，本机 691 只本地 K 线库）

```powershell
node tools/scan_v4_selection_hits.js --days 120 --print 30
node tools/verify_limit_pullback_integration.js   # 或 npm run verify:limit-pullback-v4
```

| 回看窗口 | 形态 | 命中 | 涉及股票 | 命中日期区间 | 信号后 20 日平均最高 / 最低 |
| --- | --- | ---: | ---: | --- | --- |
| 120 交易日 | `limit_pullback` | 281 | 66 | 2026-04-03 ~ 2026-09-01 | +13.6% / -10.3% |
| 120 交易日 | `rsi_low_turn` | 58 | 40 | 2026-03-24 ~ 2026-07-31 | +11.0% / -9.0% |
| 30 交易日 | `limit_pullback` | 39 | 20 | 2026-07-27 ~ 2026-09-01 | +17.3% / -2.7% |

近 30 日样例：`2026-08-03 301282` 后 20 日最高 **+87.4%**、`2026-08-03 600330` **+78.4%**、
`2026-08-20 002015` **+24.2%**、`2026-08-11 001309` **+20.1%**。
2026-09-18 收盘后全市场扫描 **0 命中**（该口径低频，最近一笔为 `2026-09-01 600726`），
属于正常现象而不是接入失败。

## 七、风险与边界

- 回测是**日线级**模拟：同日触发止损与止盈时按止损优先（保守），
  无法还原盘中先后顺序，实盘滑点可能大于回测设定。
- 命中样本集中于超跌行情；平静期可能连续数周零信号，这是"不求频繁交易"的代价。
- `drop_max <= -30%` 的票天然带退市与流动性风险，实盘需配合仓位与流动性过滤。
- 桌面版数据目录（`%APPDATA%\stock-sentinel-ai`）与源码库是两套 K 线：
  扫描预筛集合里没有本地 K 线的票会被记为 `klineMissing` 而不做形态确认，
  想让全市场都参与形态确认，需先补齐候选 K 线（`POST /api/pool/kline` 预取）。
- 本说明涉及的代码改动尚未提交（工作区有大量未提交变更），提交前需自行确认范围。
