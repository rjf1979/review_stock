# DeepSeek 25 形态回测提示词

请在 `D:/Projects/market-daily-report/src/stock-sentinel-ai` 内执行 25 个形态的真实本地日线回测。

1. 唯一入口：`tools/xingtaidu_backtest.py`；不要另写买卖逻辑。
2. 数据只用 `data/hsjday` 和 `data/kline-full.db` 的已验证 qfq 因子；检查日期、复权、停牌、上市天数，禁止未来数据。
3. 信号收盘确认，下一根开盘成交；开盘涨停、复牌间隔超过5日、上市不足250日跳过。
4. 退出机制固定为 `--exit-mode pattern`：**每个形态一套自己的止盈止损逻辑**，止损位、形态高度、ATR 倍数、风险上限、分批止盈 R 值、测量目标、跟踪均线与最长持有日全部定义在 `tools/pattern_exits.py`。不得改写或简化这套规则，也不要用 `--hold` 覆盖形态自带持有期。同日止损/止盈同时触发时止损优先。`--exit-mode uniform` 仅用于复现旧统一口径做对照。
   v2 历史改动（已并入 v3）：四个底部形态（`double_bottom`/`rising_w_bottom`/`arc_bottom`/`head_shoulder_bottom`）的失效位锚定**第二底/右肩**（`('low',8~12)`），风险上限 8%（`rising_w_bottom` 7%）；`pullback_ma20` 用 `close_below_ma_buf=0.025` + `close_below_confirm=2` 做"连续两日收盘跌破 MA20 的 97.5%"确认。改这些之前先说明理由，不要为了刷分而调参。
   当前规则表为 v3：v2 的改动（四个底部形态失效位锚定**第二底/右肩** `('low',8~12)`、风险上限 8%、`rising_w_bottom` 7%；`pullback_ma20` 用 `close_below_ma_buf=0.025` + `close_below_confirm=2`）继续有效；v3 另把 `long_lower_shadow` 的风险上限恢复到 8%、最长持有恢复到 20 日、测量目标改为前 20 根最高、跟踪改为 MA10 下方 8%。改这些之前先说明理由，不要为了刷分而调参。
5. 成本固定：买卖滑点各0.1%，佣金双边万2.5且最低5元，卖出印花税0.05%。
6. 先运行：

   `python tools/xingtaidu_backtest.py --patterns all --limit 100 --start 2021-01-01 --end 2026-09-18 --out smoke_100`

   检查无异常后再用 `tools/run_backtest_parts.ps1 -ExitMode pattern -OutDir parts2` 分片跑全市场，
   用 `tools/xingtaidu_backtest_merge.py` 合并统计；不覆盖已有输出。
7. 按25个形态分别报告交易数、胜率、平均/中位数净收益、盈亏比、平均持有日、分批止盈比例、结构止损/跟踪止损/测量目标/到期占比、分年结果。
7b. 逐笔统计之后必须做**组合层回测**（`tools/xingtaidu_portfolio.py`）：同股去重、持仓不叠加、单账户最多 10 只等权，输出资金曲线、最大回撤、夏普、月度/年度收益；并用 `tools/xingtaidu_portfolio_sensitivity.py` 做信号密度阈值网格与 2021-2023 / 2024-2026 分段复算。注意"信号密集日"分位是全区间统计，属样本内发现，必须在报告中标注。
7c. 密度阈值必须再做一次**样本外 walk-forward**（`tools/xingtaidu_density_oos.py`）：密度分位阈值、形态白名单、同日多形态优先级全部只用当天之前的历史滚动估计，并保留样本内静态基线做对照。若样本外翻正而"不做密度过滤"的样本外组合仍为负，才可以下"翻正来自密度过滤本身"的结论。
7d. 给高频形态加入场过滤时，先用 `tools/xingtaidu_filter_scan.py` 在固定子样本上做单因子扫描（`drop` / `rs` / `vol` / `combo`），只采纳**在多个形态上同向有效**的方向，并用 `--config`（只对列出的形态生效）固化；必须同时报告被证伪的对照组形态，并说明过滤器方向仍属样本内发现。
7e. 要针对**单个形态**做盈亏比优化时（例：`rsi_low_turn`、`limit_pullback` 原版盈亏比贴着 1.00），用 `tools/focus_build_scenarios.py --exit-set base|deep|final|sens|promote` 生成场景网格，再用 `tools/xingtaidu_focus_scan.py --stage entry|exit|all|custom --jobs 6` 搜索"入场过滤 × 退出规则"。`--config` 的 `params` 字段可按形态逐个覆盖检测参数（`drop_days`/`drop_max`、`rs_days`/`rs_min`/`rs_max`、`bench_ma_days`/`bench_ma_mode`）；退出侧 `no_target: true` 关闭形态自带测量目标，配合 `first_r_multiple` 与 `first_exit_fraction: 0.0` 取消分批止盈，但**结构止损、跟踪均线、风险上限必须保持 `pattern_exits.py` 原始定义，不得为了刷分去调**。扫描结论必须用正式口径（`run_backtest_parts.ps1 -ExitMode pattern` + `xingtaidu_backtest_merge.py`）复算一遍，并同时报告两段独立区间、剔除最好年份、阈值单调性；只报全区间最优参数不予采纳。参考 `docs/rsi_low_turn与limit_pullback盈亏比优化报告-2021至2026.md`。
8. 至少按训练 2021—2023、验证 2024—2025、样本外 2026（截至行情最后一根K线）切分；样本不足要明确写出。
9. 随机抽取交易，把数据截断到信号日重新计算，验证历史信号、买价和退出计划不变，报告失败样例。
10. 解释双底/W底、放量突破/平台/箱体的重叠，不把重复标签相加；禁止调参后只报告最优结果。

报告必须说明：这是研究性回测，不是收益承诺；数据质量、涨跌停未成交、日线无法判断盘中先后等限制；没有真实输出时不要编造数字。
