# `rsi_low_turn` v4 选股公式接入说明（智诊盯盘）

> 研究性离线回测与工程接入说明，不构成投资建议，也不构成任何收益承诺。
> 本文所有数字均由本仓库脚本在本机行情上重算得到，可按下文命令逐条复现。
> 回测证据与推导过程见 `docs/rsi_low_turn与limit_pullback盈亏比优化报告-2021至2026.md`。

## 一、接入范围（2026-09-18 定稿，同日追加 `limit_pullback`，同日把 `low` 收紧到 18）

- 选股启用 **`rsi_low_turn` v4** 与 **`limit_pullback` v4** 两条规则（用户要求对比选股效果）；
  其余 22 个形态保留完整定义，但默认 `enabled: false`，随时可在设置页逐条勾选恢复，不需要改代码。
- `limit_pullback` v4 的公式口径、落地位置与验收见 `docs/limit_pullback-v4接入说明.md`。
- 大盘过滤（`bench_ma_days` / `bench_ma_mode`）已证伪，不接入。

回测口径对比（2021-01-04 ~ 2026-09-18，全市场 5460 只含已退市股，含成本）：

| 形态 | 口径 | 笔数 | 胜率 | 盈亏比 | PF | 平均净收益 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `rsi_low_turn` | 原版 | 105,654 | 55.99% | 1.0041 | 1.2776 | +0.83% |
| `rsi_low_turn` | v4 初版（`low=20`） | 5,471 | 65.67% | 3.0756 | 5.8843 | +13.34% |
| **`rsi_low_turn`** | **v4 收紧档（`low=18`，本次上线）** | **3,830** | **68.85%** | **3.2343** | **7.1491** | **+15.29%** |
| `limit_pullback` | v4（已接入） | 3,089 | 51.99% | 2.3648 | 2.5610 | +6.08% |

### 为什么定 `low=18`，而不是 20 或 15

三个档位在**全区间**上的确是"门槛越低、盈亏比越高"：

| `low` | 笔数 | 胜率 | 盈亏比 | PF | 平均净收益 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 15 | 1,900 | 71.16% | 3.4957 | 8.6244 | +17.95% |
| **18（上线）** | **3,830** | **68.85%** | **3.2343** | **7.1491** | **+15.29%** |
| 20（初版） | 5,471 | 65.67% | 3.0756 | 5.8843 | +13.34% |

但 2024 年（小盘流动性冲击后的普涨反弹）在样本里权重过大，
剔除 2024 年后排序完全反转 —— **`low=15` 变成三者里最差**：

| `low` | 剔除 2024 笔数 | 胜率 | 盈亏比 | PF | 平均净收益 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 15 | 571 | 45.01% | 2.1476 | **1.7577** | +3.39% |
| **18（上线）** | **1,539** | **52.83%** | **2.2087** | **2.4734** | **+5.44%** |
| 20（初版） | 2,581 | 53.08% | 2.1405 | 2.4215 | +5.25% |

分年看更直接（盈亏比 / PF）：

| `low` | 2021 | 2022 | 2023 | 2024 | 2025 | 2026（至 09-18） |
| --- | --- | --- | --- | --- | --- | --- |
| 15 | 2.381 / 1.612 | 2.394 / 3.703 | 1.882 / 0.962 | 3.796 / 17.761 | 1.886 / 1.114 | 1.661 / **0.684** |
| **18** | 2.225 / 2.001 | 2.412 / 5.212 | 1.687 / **1.075** | 3.602 / 14.070 | 1.900 / **1.465** | 1.805 / **0.935** |

结论：`15` 的高盈亏比几乎全部来自 2024 年单年，且在 2023 / 2025 / 2026 三个非普涨年份全面更差
（2026 甚至只有 72 笔、PF 0.684）。`18` 在笔数减少约 30% 的同时，全区间盈亏比 3.08 → 3.23、
剔除 2024 后 2.14 → 2.21，是"降低出手频率换盈亏比"这一步里唯一各段都不吃亏的档位。
`low` 仍是设置页可调参数（`rules-store.js` `NUM_KEYS` 白名单内），想更激进可自行改到 15 并接受上述代价。

## 二、公式口径（唯一权威版本，改口径必须同时改回测与代码）

### 入场（只用信号日及以前的数据）

1. `RSI14` 用 Wilder 平滑；
2. 拐头前一根 `prevRsi < low(20)`，且当前 `rsi > prevRsi`（低位拐头向上）；
3. 近 `drop_days(60)` 个交易日涨跌幅 `<= drop_max(-30)%`，即 `close[i] / close[i-60] - 1`；
4. 样本长度至少 `max(30, period + 2, drop_days + 1)` 根，否则判为样本不足。

### 退出（`no_target = true`，6R 只是跟踪启动线）

| 项 | 口径 | 参数名 |
| --- | --- | --- |
| 结构止损 | `max( min(近10根最低价 × 0.99, 买点 − 2×ATR14), 买点 × 0.92 )` | `lowLookback=10` / `stopBuf=0.01` / `atrMult=2` / `riskCapPct=8` |
| 跟踪启动 | 浮盈到 **6R** 才切换到跟踪止盈，**不减仓** | `firstRMultiple=6` / `firstExitFraction=0` |
| 跟踪止损 | `max(MA10 前一根 × 0.92, 期间最高价 × 0.92, 买点保本)` | `trailMa=10` / `trailPct=0.08` |
| 时间止损 | 最长持有 **20 个交易日** | `maxHoldDays=20` |
| 固定目标 | **关闭**（不设测量目标，不落袋） | `noTarget=true` |

关键点：v4 的盈亏比不是靠"目标位定得远"，而是靠 **取消一切提前止盈**。
原版在 1R 附近减半仓，`avg_win ≈ avg_loss`，所以盈亏比贴着 1.00；
v4 把利润空间完全交给跟踪止损，只留一条结构止损兜底。

## 三、代码落地位置

| 关注点 | 文件 | 说明 |
| --- | --- | --- |
| 默认规则与门槛 | `rules-store.js` `DEFAULT_RULES` | `rsi_low_turn` 与 `limit_pullback` 两条 `enabled:true`、`minVolumeScore:0`；rsi 参数 `params:{period:14,low:20,drop_days:60,drop_max:-30}` |
| 参数可编辑白名单 | `rules-store.js` `NUM_KEYS` | 新增 `low` / `drop_days` / `drop_max` |
| 形态识别 | `screener-core.js` `PATTERNS.rsi_low_turn` | 调用 `rsiLowTurnEvidence()`，给出命中分与理由文案 |
| 证据纯函数 | `screener-core.js` `rsiLowTurnEvidence()` | Wilder RSI + 前值 + 前期跌幅，无 IO |
| 价位与退出计划 | `price-levels.js` `rsiLowTurnPlan()` | `algorithmVersion='rsi-low-turn-v4'`、`maxHoldDays=20`、`partialExitFraction=0`、`takeProfit[0].type='trail_activation'` |
| 判定链路透传 | `judgment-core.js` `prepareCode()` | 命中时返回 `rsiLowTurnPlan` |
| 设置页编辑 | `frontend/src/components/RuleEditorModal.vue` | v4 专用 `low` / `drop_days` / `drop_max` 输入 + `minVolumeScore` 输入 |
| 设置页摘要 | `frontend/src/components/SettingsSection.vue` | 显示 `RSI<20 低位拐头 · 近 60 日跌幅 ≤ -30% · 结构止损 + 6R 跟踪启动（最长 20 日）` |

## 四、怎么用（操作路径）

1. 启动：`npm start`（固定 `http://127.0.0.1:3110`），或在桌面版里打开智诊盯盘。
2. 打开 **设置 → 选股规则库**：应看到 `RSI低位拐头（超跌 v4）` 与 `涨停回踩（超跌 v4）` 两条勾选启用的规则，
   摘要行为 `形态 rsi_low_turn · RSI<20 低位拐头 · 近 60 日跌幅 ≤ -30% · 结构止损 + 6R 跟踪启动（最长 20 日）· 快照粗筛后入池复筛 · 量能分门槛 0`。
3. 点该规则 **编辑**：可改 `low` / `drop_days` / `drop_max` 与 `量能分入池门槛 minVolumeScore`，
   保存后即热生效（写入 `data/rules.json`，该文件 gitignore）。
4. 若要恢复其它形态：在同一列表里勾选对应规则的 **启用** → **保存规则**。
   23 条停用规则的参数与 prefilter 均已保留，无需重新填写。

## 五、两个必须知道的行为

### 1. 量能分门槛是 0，且这一点会如实显示

全局自动入池门槛是 `AUTO_POOL_MIN_SCORE = 70`，但 v4 是**超跌修复**口径：
命中当天的量能分天然偏低（实测全市场只有约 2% 的票能达到 70 分），
按全局门槛会把 v4 信号几乎全部拦掉。因此该规则声明 `minVolumeScore: 0`，
由 `autoPoolThresholdFor()` 取"命中多条规则中最宽松的一条"覆盖全局门槛，
入池资格改由「快照粗筛 + 本地 K 线形态确认」决定。

扫描接口返回的 `autoPool` 现在同时给出两个字段，避免"显示 70、实际按 0 放行"的误导：

- `minScore`：真实生效门槛（v4 命中时是 0）；
- `configuredMinScore`：全局配置门槛（默认 70）。

量能分本身仍在扫描结果表格里照常展示，只是不作为 v4 的门槛。

### 2. 盘中不会确认形态，只进 `pending_kline` 潜力候选

本地 K 线复筛 `assessLocalKlinePrefilter()` 要求
`source==='tencent' && adjustmentType==='qfq' && 根数≥60 && tailDate===snapshotDate && sourceLatestDate===snapshotDate && cached.tailStatus==='confirmed'`。

当日还没收盘时 `tailStatus` 只能是 `provisional`，所以 **v4 在盘中不会给出"已确认"信号**，
只会作为 `admissionMode='pending_kline'` 的潜力候选进池，等收盘 K 线落地后才复筛确认。
这是设计使然（形态以收盘价确认），不是缺陷；对应地，v4 本身也是低频信号：
本机 691 只有本地 K 线的票中，2026-06 至 2026-07 区间共 35 笔命中 / 26 只。

## 六、详情页 RSI 副图（把选股依据画出来）

个股详情弹框的 K 线图默认带 `RSI14 副图`，工具栏右侧的按钮可随时隐藏 / 显示（偏好记在
`localStorage` 的 `sentinel.detail.rsi`）。副图画的就是选股认的那条线：

- **数据同源**：副图走 `frontend/src/lib/rsi.mjs`，与 `screener-core.js` 的 `rsi()` 逐点同口径
  （Wilder 平滑、`n=14`）；阈值、跌幅窗口直接从当前启用的 `rsi_low_turn` 规则参数读取，
  在设置里把 `low` 改成 15，副图上的超卖带与阈值线立刻跟着动。
  `test/rsi-chart-parity.test.js` 用同一份 K 线比对前后端实现，`test/detail-rsi-chart-contract.test.js`
  守住渲染契约，口径分叉会直接让 `npm test` 失败。
- **图上读法**：红色阴影带 = `0 ~ low` 超卖区；`#ff6262` 虚线 = 超卖阈值（默认 18）；
  `#7a8390` 虚线 = 70；灰色空心圆 = 拐头但未通过跌幅过滤；绿色三角 = 形态命中；
  价格图上命中日的最低价下方还有一枚绿色箭头，直接回答"这一笔为什么被选中"。
- **悬停提示**：tooltip 给出「RSI14 当前值（前值）· 分区」，并标注该日是「形态命中」
  还是「拐头但未过跌幅过滤」，与 `detail.evidence` 里的 `RSI14 状态` 一致。

实现上有两个坑，改动这块代码时必须保留：

1. 三栏（价格 / 成交量 / RSI）与两栏的网格数量不同，ECharts 的 `setOption` 默认按索引合并
   数组型组件，会把关闭副图后多出来的 `grid[2]`、`yAxis[2]` 与 RSI 系列留在画布上
   （实测在 74%~85% 高度区压着成交量面板）。因此 `renderDetailChart()` 必须传
   `{ replaceMerge: ['series', 'grid', 'xAxis', 'yAxis'] }`。
2. 上面这个 `replaceMerge` 会整体替换 series，所以 AI 价格位标注（建仓 / 止损 / 止盈）
   必须由 `priceLevelMarks()` 一并交给主体重绘，否则盘中每次刷新都会把价格位连线抹掉。

## 七、验收命令与最近一次结果

```powershell
npm test                                              # 全绿；含 rsi_low_turn v4 与 judgment core v4 分支用例
npm run check                                         # node --check 全部文件
npm run build:frontend                                # vite build
npm start                                             # 固定 3110
node tools/scan_rsi_low_turn_v4_hits.js --print 60    # 只读本地 K 线扫描 v4 命中
node tools/verify_rsi_low_turn_integration.js         # 对 3110 做端到端接入验收
npm run verify:ui                                     # UI 静态验收（构建产物 + 响应式 + aria）
```

2026-09-18 实测：

- `npm test` 全绿，含 `rsi_low_turn v4 通过 signal@2026-03-08 buy 60.4 stop 57.87 risk% 4.2 6R 75.61`；
  `judgment core v4 分支 ok rsi-low-turn-v4 60.4 57.74`。
- `npm run check`、`npm run build:frontend` 通过。
- 桌面安装版已重打包并覆盖 `D:\Program Files\StockSentinelAI`（安装后的 `resources\app.asar`
  SHA-256 与 `release\win-unpacked` 完全一致）；重启后 `/api/rules` 返回
  `rsi_low_turn.params = { period:14, low:18, drop_days:60, drop_max:-30 }`，`low=18` 真正生效。
- 端到端验收：`node tools/verify_rsi_low_turn_integration.js` 通过（健康检查、24 条规则、
  服务端判定 `600418 2026-07-09 → RSI 低位（<18）拐头向上，近 60 日 -47.7%`、失效位 18.54）；
  `npm run verify:limit-pullback-v4` 通过。
  样本由 `002131@2026-07-09` 换成 `600418@2026-07-09`：前者前值 RSI=19.99，按 `low=18`
  本就不该命中，正是这次收紧阈值要剔除的那类边缘样本。
- **预筛候选 K 线补齐（同日）**：`market-prescan.json` 当日候选 1,589 只，用
  `node tools/prefetch_prescan_klines.js --data-dir "%APPDATA%\stock-sentinel-ai"` 连跑两轮，
  完整 1,412 只 + 上市不足 43 只，仍不可用 134 只（8.4%）；本地 `kline.db` 由 84.7 MB 增至 130.8 MB，
  入库代码数由 252 只增至 1,769 只。
- 真实扫描链路（`/api/scan?force=1`，2026-09-18）：范围 1,586 只 → 预筛命中 1,488 →
  潜力候选 16 → `prefilter.klineMissing=1475 → 132`（形态确认终于能真正跑）；
  但当日 `confirmed=0`，且只读全库扫描 `--last-only` 同为 0 笔 —— 即当天确实没有符合条件的票，
  不是链路失效。作为对照，同一数据目录近 120 个交易日共命中 **41 笔 / 27 只**，
  最近一笔 `2026-09-16 688795`（60 日 -48.4%），说明公式在日常是可用的。
- **详情页 RSI 副图（同日）**：无头 Chrome 打开候选池首行「久其软件 002279」（265 根前复权日 K）
  实测 22 项判定全通过、页面无 JS 异常：工具栏含 `RSI14 副图`、开关 `aria-pressed=true`、
  证据 `RSI14 状态: 49.3 · 中性偏弱`、tooltip 含 RSI14 行；RSI 面板（71%~85% 高度区）
  铺满超卖带 15 行、有 `#ff6262` 阈值线与 `#7a8390` 的 70 线、RSI 曲线 257 px、无成交量柱；
  关闭副图后该区改由成交量占据（6,477 px），70 线整行清零、超卖带底色清零。
  逐点口径另有 `test/rsi-chart-parity.test.js`（260 根 K 线：RSI 数值 / 拐头 10 处 / 命中 9 处全一致）。

## 八、风险与边界

- 回测是**日线级**模拟：同日触发止损与止盈时按止损优先（保守），
  但无法还原盘中先后顺序，实盘滑点可能大于回测设定。
- 6 年 3,830 笔（`low=18`），平均每交易日约 2.6 笔，但分布极不均匀：超跌行情集中期信号密集，
  平静期可能连续数周零信号 —— 这正是"不求频繁交易"的代价。
- `drop_max <= -30%` 的票天然带退市与流动性风险，实盘需配合仓位与流动性过滤。
- 本说明涉及的代码改动尚未提交（工作区有大量未提交变更），提交前需自行确认范围。
