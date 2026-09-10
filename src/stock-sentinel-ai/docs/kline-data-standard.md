# 智诊盯盘 · 行情量纲数据标准 v1

> 范围：智诊盯盘（`src/stock-sentinel-ai/`）的日 K、实时快照及一切依赖 volume/amount 的派生计算（量能均线、量能评分输入、AI 研判样本、价位量能确认）。
> 状态：标准已实现（源边界归一 + 读侧兜底 + 一次性迁移 `kline_volume_unit_v1`）。本文不是提案。

## 1. 存储量纲（canonical）

| 字段 | 存储单位 | 说明 |
| --- | --- | --- |
| `volume` | **股** | 日 K 与实时快照统一；整数，≥0 |
| `amount` | **元** | 可选字段；腾讯 fqkline 暂不提供，留空不补造 |

本地 SQLite（`data/kline.db`）与所有内存传递结构都只允许出现上述单位。任何"手"数据不得越过源适配边界进入存储、接口或计算。

## 2. 数据源量纲与转换责任

**转换发生在源适配边界**（`data.js` 的 `normalizeKlineVolume(volume, source)` / `normalizeQuote`），调用方与存储层不做二次换算：

| 数据源 | 接口 | 原始 volume 单位 | 转换 |
| --- | --- | --- | --- |
| 腾讯 fqkline | `web.ifzq.gtimg.cn/.../fqkline/get` | 手 | ×100 |
| 东财 日K | `push2his.eastmoney.com/.../kline/get` (f56) | 手 | ×100 |
| 东财 批量快照 | `push2delay.eastmoney.com/.../ulist.np/get` (f5) | 手 | ×100 |
| 新浪 日K | `money.finance.sina.com.cn/.../getKLineData` | 股 | 原样 |

新增数据源时必须：① 在上表登记原始量纲；② 在适配边界完成到 canonical 的转换；③ 在 `test/kline-volume.test.js` 增加对应断言。`normalizeKlineVolume` 对未知来源默认原样返回（视为股），因此**接入新源前必须先登记**。

## 3. 读侧兜底（防新旧数据混流）

读取路径（`normalizeKlineVolumeSeries`）对整序列做一次量级一致性检查，用于兜底历史遗留的混单位数据：

- 以"前 n−2 根的正值中位数"为历史锚；
- 仅当**序列末尾连续 ≥2 根**都 ≥20× 历史锚时，判定为"历史为手、尾部为股"，把边界之前的柱整体 ×100；
- 单根暴量（真实放量、停牌复牌）不触发；真实缩量不反向触发；
- 该兜底只修正显示与派生计算，**不回写存储**；存储修正唯一入口是迁移。

## 4. 存量数据修复（一次性迁移 `kline_volume_unit_v1`）

历史数据由旧版代码（未做源边界归一）写入，腾讯源"手"数据直接入库。迁移不做量级猜测，直接**逐代码与实时源同日期比对**：

1. 拉取该代码实时源 K 线（已按第 2 节归一为"股"，主源腾讯，失败按健康链降级）；
2. 取最近最多 12 个重叠交易日，逐日计算 `stored.volume / source.volume`；
3. 比值 ≤0.05 的柱判为"手"，×100 修正；0.2～5 视为正确；落在灰色地带的柱**跳过该代码**并记录，绝不盲修；
4. 代码级结果记入报告（fixed / ok / skipped 及原因），全部代码处理完后写 `schema_migrations('kline_volume_unit_v1')` 标记，重启不重复执行；
5. 迁移启动前对 `kline.db` 做文件级备份（`kline.db.backup-<时间戳>`）。

迁移在服务启动时异步触发（有标记即跳过；空库瞬时返回）。网络不可用导致跳过的代码可用 `force` 重新执行。

## 5. 一致性约束（回归红线）

- 同一股票同一交易日：`快照 volume ≈ 日K volume`（差值仅来自盘中时点）；`amount ≈ volume × 当日均价`。
- 任何新增消费方（评分、AI 样本、报告）拿到的 volume 都应视为"股"，禁止在消费方内部再做 ×100/÷100 修正。
- 禁止 reintroduce"仅看尾部 ±100 倍即除/乘 100"的启发式（旧 `normalizeKlineVolumeSeries` 尾部规则的教训：在混合单位序列上会误伤正确数据）。
