# SQLite 字段类型审计

## 结论

行情数值字段使用 `REAL`，股票代码使用 `TEXT`，ISO 日期使用 `TEXT` 是合理的。当前需要规范的是研判表的外键、状态枚举和时间字段。

## 当前字段判断

| 字段 | 当前类型 | 结论 |
| --- | --- | --- |
| `kline.code/date` | `TEXT` | 合理；代码保留前导零，日期使用 `YYYY-MM-DD` |
| `kline.open/high/low/close/volume/amount` | `REAL` | 合理；允许空值表示源数据缺失 |
| `kline_meta.code/date/savedAt` | `TEXT` | 合理；`savedAt` 当前为 ISO 时间 |
| `judgment_records.code` | `TEXT` | 合理 |
| `judgment_records.tradeDate` | `TEXT` | 合理；ISO 日期 |
| `judgment_records.startedAt/finishedAt/durationMs` | `INTEGER` | 合理；Unix 毫秒，需统一说明 |
| `judgment_records.priceLevelSetId` | `TEXT` | 不合理，应为 `INTEGER`，与 `price_level_sets.id` 一致 |
| `judgment_records.isFinal` | `INTEGER` | 可用，但应增加 `CHECK (isFinal IN (0,1))` |
| 状态字段 | `TEXT` | 可用；应用层校验枚举，SQLite 暂不加 CHECK 以兼容版本演进 |
| JSON 字段 | `TEXT` | 合理；保存结构化证据/模型原文，读取时统一 JSON 解析 |
| `data_stats.statValue` | `REAL` | 统计值使用数值类型，禁止保存为字符串 |

## 后续规范

1. 新表统一使用 `INTEGER` 保存主键和外键，`REAL` 保存数量/价格/比例，`INTEGER` 保存 Unix 毫秒，ISO 日期和业务代码使用 `TEXT`。
2. `priceLevelSetId` 后续迁移为 `INTEGER`，并增加索引；迁移前需验证历史 JSON/SQLite 记录引用完整。
3. 统计表增加 `statKind`（`integer/real`）仅在需要区分展示格式时引入；当前所有统计值均可按 `REAL` 读取。
4. 状态枚举继续由业务层集中校验，避免数据库 CHECK 阻断新增状态。
