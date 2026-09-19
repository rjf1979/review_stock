# tools 目录

## 25 形态回测

`xingtaidu_backtest.py` 是 `assets/xingtaidu` 五张图、25 个形态的统一回测入口。它固定执行：

- 信号收盘确认，下一交易日开盘成交；
- 买卖滑点各 0.1%、佣金双边万 2.5（最低 5 元）、卖出印花税 0.05%；
- 同日止损与止盈同时触发时按止损优先，避免日线无法判断盘中先后造成乐观偏差；
- 只读取本地行情（`data/hsjday` + `data/kline-full.db` 的 qfq 因子），不联网抓 K 线、不下单。

退出机制有两种模式，用 `--exit-mode` 切换：

- `--exit-mode pattern`（**默认**）：**每个形态一套独立的止盈止损逻辑**。25 个形态各自的
  关键位、失效位、形态高度、ATR 倍数、风险上限、1R 分批比例、测量目标、跟踪均线与最长
  持有日，全部显式定义在 `pattern_exits.py` 的规则表里（结构窗口一律右开、不含信号日）。
  当前规则表为 **v3**：v2 修了 4 个底部形态的失效位锚点与 `pullback_ma20` 的均线缓冲，
  v3 把 `long_lower_shadow` 的风险上限恢复到 8%、最长持有恢复到 20 日、目标改前 20 根
  高点、跟踪改 MA10 下方 8%。
  结构规则另支持 `close_below_ma_buf`（均线下方缓冲）与 `close_below_confirm`（连续确认
  天数），`pullback_ma20` 用它们做"连续两日收盘跌破 MA20 的 97.5%"离场。
  若测量目标低于 1R，则取消固定目标，余仓交给跟踪退出。
- `--exit-mode uniform`：2026-09-18 之前的旧统一口径（结构位与 `2×ATR14` 取更宽者、默认
  8% 风险上限、统一 1R 减 50%、趋势形态只跟踪、统一 40 日持有），仅用于与历史结果对照复现。

两种模式下显式传入的 `--hold` / 配置里的 `risk_pct`、`risk_atr`、`first_r_multiple`、
`first_exit_fraction`、`target_fraction`、`trail_ma`、`trail_pct` 都会覆盖形态自带参数；
**常规回测不要传 `--hold`**，否则会抹掉各形态自己的最长持有日。

`--config` 读 UTF-8 JSON，**只对配置里出现的形态生效**（其余形态保持规则表默认值），
因此可以作为"给部分形态加入场过滤"的开关，见下面的 v3f。

规则、限制和 DeepSeek 审计提示词见 `docs/xingtaidu-python-guide.md`。

```powershell
# 小样本先验检查（每个分片代码取前 100 只）
python tools/xingtaidu_backtest.py --patterns all --limit 100 --start 2021-01-01 --end 2026-09-18 --out smoke_100

# 全市场 25 形态，每形态一套止盈止损
python tools/xingtaidu_backtest.py --patterns all --start 2021-01-01 --end 2026-09-18 --out xingtaidu_25_pattern_exit_v1
```

全市场回测建议按股票分片并行执行，再由合并脚本汇总统计（并行 6 片约 4 分钟，合并约 1 分钟）：

```powershell
# 1) 分片并行回测（默认 6 片，输出到 data/backtest/xingtaidu/<OutDir>）
powershell -File tools/run_backtest_parts.ps1 -ExitMode pattern -OutDir parts2

# 2) 合并分片明细并生成统计 JSON（含 payoff / 分年 / 分段）
python tools/xingtaidu_backtest_merge.py --glob "data/backtest/xingtaidu/parts2/part_*.csv" `
  --out xingtaidu_25_pattern_exit_v1_2021_2026

# 3) 旧统一口径对照（可复现历史结果）
powershell -File tools/run_backtest_parts.ps1 -ExitMode uniform -OutDir parts

# 4) 只回测指定形态（例：只验证 long_lower_shadow 的规则改动）
powershell -File tools/run_backtest_parts.ps1 -ExitMode pattern -OutDir parts_v3 -Patterns long_lower_shadow

# 5) v3f：给 6 个高频形态统一加"近 60 日跌幅 ≥ 20%"过滤（其余 19 个形态不动）
powershell -File tools/run_backtest_parts.ps1 -ExitMode pattern -OutDir parts_v3f `
  -Config tools/backtest_v3_filters.json
```

结果写入 `data/backtest/xingtaidu/`，包含 CSV 明细和 JSON 汇总。明细保留 `exit_mode`、
`initial_stop`、`first_target`、`measured_target`、`key_level`、`structure_low`、`max_hold`、
分批 `partial_exit` 和 `reason`（退出原因）。

### 版本对照与入场过滤扫描

```powershell
# 逐形态比对两版统计（自动标出逐笔不一致的形态，其余应当完全一致）
python tools/xingtaidu_compare.py `
  --a data/backtest/xingtaidu/xingtaidu_25_pattern_exit_v2_2021_2026.json `
  --b data/backtest/xingtaidu/xingtaidu_25_pattern_exit_v3_2021_2026.json `
  --label-a v2 --label-b v3 --by delta_pf

# 单因子扫描：drop（前期跌幅）/ rs（相对强度）/ vol（量能）/ combo（组合），900 只子样本
python tools/xingtaidu_filter_scan.py --patterns all --limit 900 --dims drop,rs,vol
```

扫描结论：**"近 60 日跌幅 ≥ 20%"是唯一在多个形态上同向有效的过滤器**，
**"正相对强度"一致有害**（这些是抄底型形态，不是强势股回踩）。
该方向已固化为 `backtest_v3_filters.json`（v3f）。

### 单形态盈亏比优化（v4）：`rsi_low_turn` / `limit_pullback`

25 形态全区间里只有 `rsi_low_turn` 做到"盈亏比 ≥ 1 且 PF > 1"（1.0041 / 1.2776），
`limit_pullback` 是 0.8460 / 0.8216。把这两个形态单独拉出来做"入场过滤 × 退出规则"网格，
结论是**原版问题是退出端把利润截断，不是选股不准**。完整报告见
[`docs/rsi_low_turn与limit_pullback盈亏比优化报告-2021至2026.md`](<../docs/rsi_low_turn与limit_pullback盈亏比优化报告-2021至2026.md>)。

两个新增工具负责搜索，正式口径仍然走 `xingtaidu_backtest.py`：

```powershell
# 1) 生成场景网格（--exit-set base|deep|final|sens|promote，可用 --patterns 指定形态）
python tools/focus_build_scenarios.py --exit-set deep
python tools/focus_build_scenarios.py --exit-set sens --outdir data/backtest/xingtaidu/focus

# 2) 聚焦扫描：entry（只扫入场过滤）/ exit（固定入场只扫退出）/
#    all（入场 × 退出全网格）/ custom（读 --scenarios 指定的场景文件），--jobs 分片多进程
python tools/xingtaidu_focus_scan.py --patterns rsi_low_turn,limit_pullback `
  --stage custom --scenarios data/backtest/xingtaidu/focus/deep_grid.json `
  --jobs 6 --start 2021-01-01 --end 2026-09-18 --out data/backtest/xingtaidu/focus/deep_full.json

# 3) 用最终规则跑正式逐笔回测（与 25 形态报告同口径），产物即报告明细
powershell -File tools/run_backtest_parts.ps1 -ExitMode pattern -Patterns rsi_low_turn `
  -Config tools/backtest_focus_rsi_low_turn.json -OutDir parts_v4rsi
python tools/xingtaidu_backtest_merge.py `
  --glob "data/backtest/xingtaidu/parts_v4rsi/part_*.csv" `
  --out xingtaidu_focus_rsi_low_turn_v4_2021_2026
```

`--config` 新增 **`params`** 字段，可按形态逐个覆盖检测参数（不再只能全局覆盖）：

```json
{"patterns": ["rsi_low_turn"],
 "params": {"rsi_low_turn": {"low": 20.0, "drop_days": 60, "drop_max": -30.0}},
 "first_r_multiple": 6.0, "first_exit_fraction": 0.0, "no_target": true}
```

退出引擎新增 `no_target`：关闭形态自带的测量目标，配合 `first_r_multiple` 推高首次止盈、
`first_exit_fraction: 0.0` 取消分批，让余仓全部走结构止损 / 跟踪止损 / 最长持有。
`_ctx_filter` 新增 **`bench_ma_days` / `bench_ma_mode`（`above` / `below`）**大盘环境过滤，
该过滤器在本轮**被证伪**（全区间看着很好，2021-2023 与 2024-2026 方向完全翻转），
报告第十节有完整对照，不建议直接使用。

顺带修掉一个真实缺陷：`rsi_low_turn` 原先**没有调用 `_ctx_filter`**，导致 `--config` 里的
跌幅 / 相对强度 / 量能 / 大盘过滤对它全部静默失效；修复后参数缺省时行为与之前完全一致。

结果（全区间 2021-01-04 ~ 2026-09-11，与 25 形态报告同口径）：

| 形态 | 规则 | 笔数 | 胜率 | 盈亏比 | PF | 平均净收益 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `rsi_low_turn` | 原版 | 105,654 | 55.99% | 1.0041 | 1.2776 | +0.83% |
| `rsi_low_turn` | v4（RSI<20 + 60日跌幅≤-30% + 6R 不减仓 + 关测量目标） | 5,471 | 65.67% | **3.0756** | 5.8843 | +13.34% |
| `limit_pullback` | 原版 | 123,758 | 49.27% | 0.8460 | 0.8216 | -0.71% |
| `limit_pullback` | v4（60日跌幅≤-30% + 20日RS≤-5pp + 同一套退出） | 3,089 | 51.99% | 2.3648 | 2.5610 | +6.08% |

两个形态在两段独立区间（2021-2023 / 2024-2026）盈亏比都 ≥ 2.2，但 2023、2026 是亏损年、
2024 贡献过半样本，且这里是逐笔口径、未做组合层，采用前必须读报告第十二节限制。

### 组合层回测（资金曲线 / 最大回撤 / 信号密度）

`xingtaidu_portfolio.py` 把上面 200 多万行逐笔明细压成"单账户真实跑下来会怎样"：同股
去重、持仓不叠加、最多同时持有 N 只等权仓位，输出资金曲线、最大回撤、夏普、月度与年度
收益。`xingtaidu_portfolio_sensitivity.py` 做密度阈值网格与分段独立复算。

```powershell
python tools/xingtaidu_portfolio.py `
  --glob "data/backtest/xingtaidu/xingtaidu_25_pattern_exit_v2_2021_2026.csv" `
  --summary "data/backtest/xingtaidu/xingtaidu_25_pattern_exit_v2_2021_2026.json" `
  --outdir data/backtest/xingtaidu/portfolio_v2

python tools/xingtaidu_portfolio_sensitivity.py `
  --glob "data/backtest/xingtaidu/xingtaidu_25_pattern_exit_v2_2021_2026.csv" `
  --summary "data/backtest/xingtaidu/xingtaidu_25_pattern_exit_v2_2021_2026.json" `
  --out data/backtest/xingtaidu/portfolio_v2/density_sensitivity.json
```

关键发现：25 形态等权堆仓全区间 -56.72%、最大回撤 -61.15%；**只在信号密集日
（当日同批信号数 ≥ 90 分位）出手可翻正为 +48.32% / 年化 +7.22% / 回撤 -23.39%**。
密度分位是全区间统计，属样本内发现，详见 `docs/25形态回测报告-2021至2026.md` 第十二节。

### 样本外验证（把密度阈值改成只用历史数据）

`xingtaidu_density_oos.py` 把**密度分位阈值、形态白名单、同日优先级**三者全部改成
"只用当天之前的历史"（默认 250 个交易日滚动窗口、至少 60 个有信号日预热），
并同时输出样本内静态基线作为对照；`--window` / `--min-history-days` / `--min-pf` /
`--min-trades` 可调。用法见 `docs/xingtaidu-python-guide.md` 第十节。

```powershell
python tools/xingtaidu_density_oos.py `
  --glob "data/backtest/xingtaidu/xingtaidu_25_pattern_exit_v3filters_2021_2026.csv" `
  --summary "data/backtest/xingtaidu/xingtaidu_25_pattern_exit_v3filters_2021_2026.json" `
  --out data/backtest/xingtaidu/portfolio_v3f/density_oos.json
```

结果：v3f 样本外密集日组合 **+60.11% / 年化 +8.68% / 回撤 -15.58% / PF 1.296**，
而不做密度过滤的样本外全信号组合是 **-60.68% / PF 0.841**——翻正来自密度过滤本身。

## 共享数据模块

| 文件 | 用途 |
| --- | --- |
| `kdata.py` | 读取 `data/hsjday` 通达信日线和 qfq/hfq 复权因子 |
| `indicators.py` | MA、EMA、MACD、RSI、ATR、滚动高低点等指标 |
| `patterns/` | 25 个形态的注册和检测 |
| `pattern_exits.py` | 25 个形态各自的止盈止损规则表 |
| `xingtaidu_backtest_merge.py` | 合并分片 CSV，输出统计 JSON（payoff / 分年 / 分段） |
| `run_backtest_parts.ps1` | 按股票分片并行跑全市场回测 |
| `xingtaidu_focus_scan.py` | 单形态"入场过滤 × 退出规则"聚焦扫描（entry / exit / all / custom，支持分片多进程） |
| `focus_build_scenarios.py` | 生成聚焦扫描的场景网格 JSON（`--exit-set base/deep/final/sens/promote`） |
| `bt60_bucket_backtest.py` | 上市历史分桶回测（60-99 / 100-149 / 150-249 / ≥250 根分层，用于验证选股门槛 150） |
| `xingtaidu_screen.py` | 本地 CSV 的尾日形态筛选和证据输出，不做收益回测 |
| `adjust.py` | 复权因子抓取、校验和统计 |
| `verify_hsjday.py` | 本地日线目录只读核验 |
| `verify_st_detector.py` | ST 识别规则基准检查 |
| `watch_tdx.py` | 通达信数据源探测 |

专用回测只读取本地行情，不联网抓全市场 K 线、不下单、不修改生产候选池。

本轮 25 形态回测的完整结论见 `docs/25形态回测报告-2021至2026.md`；
`rsi_low_turn` / `limit_pullback` 的盈亏比优化见
`docs/rsi_low_turn与limit_pullback盈亏比优化报告-2021至2026.md`；
上市历史门槛（60 / 100 / 150 根）的分桶支撑见 `docs/2026-09-19-60根口径回测支撑验证.md`。
