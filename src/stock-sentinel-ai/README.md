# 智诊盯盘（Stock Sentinel AI）

A 股**AI 辅助诊股与自选盯盘**桌面工具。本地取数，不经过任何服务器中转。

## 项目说明

智诊盯盘面向需要持续跟踪 A 股个股的研究者。它将全市场行情筛选、自选股盯盘、日 K 线和量价形态证据集中在同一桌面工具中，帮助用户从“发现候选”进入“个股诊断”和“后续跟踪”。

产品以 **AI 辅助研判** 为目标工作流：将行情快照、量价信号、均线结构、成交量和自选股实时状态组织为可核验的输入，供 AI 和使用者共同判断。系统展示的是数据与信号证据，不将任何单一信号或 AI 输出表述为确定收益、买卖指令或投资建议。

### 核心能力

- **全市场诊股初筛**：按上证、深证、创业板、科创板等市场扫描，使用换手率、量比、成交额和主力净流入快速缩小候选范围。
- **量价与形态复核**：对候选股加载前复权日 K，识别均线启动、放量突破、回踩缩量、底部反转等形态，并显示 MA 与成交量均线。
- **自选盯盘**：保存关注股票，刷新现价、涨跌幅、开高低、成交量、成交额、换手率和量比；点击个股即可进入 K 线详情。
- **本地数据仓库**：行情快照与 K 线优先落盘并按日期复用，减少重复联网请求，支持当日快速筛选和跨日预览。
- **研究边界清晰**：所有数据来自公开行情接口；AI 辅助研判和量价信号均仅用于研究参考，不构成任何投资建议。

## 定位

与「股市脉搏」区分：股市脉搏做全市场行情 + 每日复盘；智诊盯盘聚焦**AI 辅助研判、按市场类型 + 量价形态诊股，以及自选股实时盯盘**。

## 数据与扫描策略

- 扫描走东方财富 `clist/get` 全市场分页，字段含换手率（`f8`）、量比（`f10`）、成交额（`f6`）、主力净流入（`f62`）。分页 `pz=100` 读取 `data.total` 逐页；东财请求串行限流。
- 翻页终止按**原始页条数**判断，避免因剔除停牌/无价行而在第一页提前结束（曾致北交所仅取 88/352、四大市场仅 2182/5556）。现已修通。
- 全市口径：四大板块（上证/深证/创业/科创）真实快照约 5209 只、北交所约 340 只；受东财 1.1s 限流影响，全量快照需数十秒，故第一段只做快，第二段仅对候选池拉 K 线。
- 形态选股采用**两段式**：先用 `clist` 现成字段快速扫出候选池；再对候选池拉历史 K 线复筛需要形态（突破、回踩均线、量价背离等），避免对全市场拉历史 K 线。
- 日 K 主用腾讯前复权（不封 IP）；北交所 920 统一代码在腾讯暂未回填历史（仅当日一根），故 `fetchKline` 对其自动回退东财日 K，已实测 200 根正常返回。

## 先落地后筛选（本地数据仓库）

扫描遵循「**先把数据落到本地，再开启选股筛选**」：第一段全市场快照拉取后立即写入本地，第二段筛选优先复用本地数据，避免重复联网。

- 数据目录默认 `<项目>/data/`，目标路径可用环境变量 `VOLUME_INSIGHT_DATA_DIR` 覆盖（Electron 打包时自动指向 `userData`，避免写入只读安装目录）。
  - `data/snapshots/<日期>__<市场key>.json`：每日全市场快照归档，**按单市场分别落盘**（如 `2026-09-03__sh_main.json`、`2026-09-03__chuangye.json`），每条记录带 `market` 标记；勾选某个市场即针对性筛选该市场，跨市场组合不再合并成一份。
  - `data/kline.db`：单票前复权日 K 的 **SQLite** 库（`sql.js` 纯 JS，无外部 wasm），一张 `kline` 表 = 每只股票每个交易日一行（主键 `code+date`），另用 `kline_meta` 记录该股票最近一次抓取日期，供跨日复用与缓存时效判断。可用环境变量 `VOLUME_INSIGHT_KLINE_DB` 覆盖库文件路径。
- `dataSource` 三档语义（`/api/scan`、`/api/kline` 均支持）：
  - `live`：联网实时拉取全市场快照并**落盘**，对候选池拉最新 K 线并落盘。代价最高（数十秒）。
  - `local`：**按市场**逐个判断，仅用**当日**已落盘的该市场快照（当日重复扫描秒级复用）；某个市场当日没有则只补拉该市场并落盘。返回的 `byMarket` 逐市场如实标 `local`/`live`，缺失市场不会用旧数据冒充。
  - `last`：**按市场**逐个用**最近一次**本地快照（跨日期），缺数据的市场实时补拉。K 线缓存需不早于该市场快照日期，否则临时联网补齐。**必须标注数据日期**，适合隔夜/盘中预览，严禁把旧数据当新数据。
- 收益：全市场快照（约 50 页网络请求）只在首次或数据过期时拉取；同一天重复扫描、或切换到 `local`/`last` 后，快照与已缓存 K 线均从本地秒级返回。按市场分别落盘后，勾选单一市场（如上证主板）只读该市场文件、只扫该市场，针对性更强。

## 全市场 250 日 K 线预取（可选，背景任务）

- 接口 `GET /api/prefetch-kline?markets=<marketKey,...>&lmt=250&fresh=0&gapMs=1100` 启动后台预取：把所选市场全部股票的前复权日 K 逐只写入本地 SQLite（`data/kline.db`，一票一日一行）。
- **断点续传（深度感知）**：已有 K 线缓存且**根数达到目标天数**（`lmt`）才跳过；缓存不足（如此前仅 120 日）会被重新拉取补足到目标天数。`fresh=1` 则只跳过「今日已刷新」的，用于强制补最新一根。
- `GET /api/prefetch-status` 查询进度（`total/done/fetched/skipped/errors/current`）；`GET /api/prefetch-stop` 安全停止。前端「本地仓库」卡片可一键启动并实时显示进度。
- 说明：全量约 5500 只，**必须串行且限速**（默认 `gapMs=1100`，与东财 clist 一致），过快会触发腾讯/东财风控（`HTTP 501`/断连）。腾讯失败会自动回退东财日 K 补齐（含北交所 920 等历史不足的股票）。保守速率下一轮全量约需 1.5~2 小时，适合盘中/收盘后后台跑。
- **熔断自适应退避**：连续 6 只拉取为空/抛错（对应限流 `HTTP 501`/断连）即自动进入冷却，暂停 60s 后恢复；若仍持续失败则冷却时长每次翻倍（上限 5 分钟），一旦有成功立即复位。状态字段含 `cooling/cooldownMs/consecutiveFails`，前端进度条会提示「接口限流，冷却中」。这样接口被风控时不会继续轰接口、拖长封禁。
- **失败重试队列**：主循环遇到失败只把代码入队（不立即记错），主循环结束后对失败队列反复重试（单只最多重试 3 次后放弃并记错）；状态字段含 `queued`。配合断点续传，即使中途被风控中断，解封后也能自动补抓。另：`fetchKline` 只在拿到有效 K 线时才落盘，失败不写无效行，K 线库不会堆积脏数据。
- **批量落盘**：SQLite 写库默认每累计 250 只后 `db.export()` 落盘一次，避免「每写一只就全量导出」的 O(n²) 开销；迁移/预取结束时调用 `flush()` 强制落盘。
- **旧数据迁移**：此前用 JSON 文件存的 K 线（`data/kline/<code>.json`）可用 `node scripts/migrate-kline-to-sqlite.js [--delete]` 一次性导入 SQLite，`--delete` 在全部成功后删除旧目录。

## 设置页

- 顶部「设置」标签提供：**抓取任务天数**（20～500 日，默认 250）、**启动/停止预取**按钮与实时进度条，以及 **AI 辅助研判配置**（接口类型 / Base URL / 模型 / API Key / Temperature / 最大输出 tokens / 启用开关）。
- 设置通过 `GET /api/settings` 读取、`POST /api/settings` 保存，持久化到 **源码 `data/settings.json`**（已 gitignore）。配置仅保存在本机，不离开本地。
- **配置目录与大数据目录分离（开发模式约定）**：设置读写固定落在源码 `<项目>/data/settings.json`，`settings.js` 不再跟随 `VOLUME_INSIGHT_DATA_DIR`；K 线库 / 快照等仍随 `storage` 的该环境变量（如上所述可指到 `userData`）。注意：一旦把桌面版**打包成只读 asar 发布**，写死在源码 `data/` 将不可写，届时需把 `settings.js` 重新接回 `DATA_DIR`（或改用 `userData` 路径）并做配置迁移——当前按“先开发模式统一到 `data/`”落地，打包前需回归此点。
- **AI 辅助研判（已接线）**：设置页保存接口类型 / Base URL / 模型 / API Key / Temperature / 最大输出 tokens，并默认关闭；在个股详情点「AI 辅助研判」后用本机行情 + 日 K + 均线/MACD/RSI + 命中形态证据组装 prompt，调用 OpenAI 兼容 `/chat/completions` 返回研判文本。API Key 仅用于瞬时请求头，不落日志、不进证据、不离开本机。用量/形态信号仍完全由 `screener-core` 本地计算；AI 输出仅作研究参考，不构成投资建议。新增后端模块 `ai-assist.js`（含 `configReady` / `buildEvidence` / `buildPrompt` / 超时与错误处理），`screener-core` 导出 `detectSinglePatterns` 供单票形态证据。

## 选股规则（热插拔）

- 规则已剔除「量能活跃（volume_act）」，默认全部为 `kline` 形态规则，源自用户提供的《量价形态选股示意图》5 大类 24 个形态（均线启动/量价共振/短线强势/底部反转/突破爆发）。
- 规则分为可编辑的**热插拔配置**，持久化到 `data/rules.json`（已 gitignore），可通过设置页新增、编辑、删除、启停；扫描按「全部启用规则并集」执行。
- 规则只存配置不含函数：`scan`（仅用快照字段，全市场快）由 `params`（如最小量比/最小换手/主力净流入）在运行时生成；`kline`（需历史 K 线）由 `prefilter`（快照粗筛）控制候选规模，再对命中候选逐只拉前复权日 K 做形态复筛，返回 `pattern`（命中原因）与 `patternScore`（形态分）。
- 规则接口：`GET /api/rules`（读取）、`POST /api/rules`（保存）、`POST /api/rules/reset`（恢复默认）、`GET /api/patterns`（可用形态 `patternId` 列表）。
- 形态量化口径、逐字整理与可调参数见 `docs/xingtaidu-patterns.md`。

## 前端依赖

Vue 3.5.13 与 ECharts 5.5.1 已本地打包到 `frontend/vendor/`，无需 CDN，保证离线/弱网下 UI 可用。

## 运行

```bash
npm start          # 仅本地后端 + 静态前端，浏览器打开 http://127.0.0.1:3110
npm run desktop    # Electron 桌面窗口（需 npm install）
npm test           # 单测：形态/指标 + 本地存储与 live/local/last 复用
```

后端启动后可用 `GET /api/status` 查看数据目录、本地已归档的快照日期与 K 线缓存数量。

### 桌面版打包（electron-builder）

桌面壳位于 `electron-main.js`：主进程直接 `require('./server')` 启动本地后端，并把数据目录指向
`VOLUME_INSIGHT_DATA_DIR`（默认 `app.getPath('userData')`），避免把快照 / K 线写进只读的 asar 安装目录。
壳内启用单实例锁、Windows AppUserModelID，端口冲突时自动顺延（前端相对 `/api` 不依赖固定端口）。

```bash
# 生成应用图标（assets/icon.png + assets/icon.ico，多尺寸，纯矢量绘制无文字）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-icon.ps1

# 开发模式启动桌面窗口
npm run desktop

# 生成 Windows 安装包（x64 + ia32，产物到 release/）
npx electron-builder --win --x64 --ia32
```

打包清单（`package.json` 的 `build.files`）必须同步列出后端运行所需的全部源码模块，尤其是
`server.js` 通过 `require` 依赖的 `data.js / screener-core.js / storage.js / watchlist.js /
prefetch.js / settings.js`，以及 `node_modules/sql.js` 的纯 JS 版 `dist/sql-asm.js`（无需 wasm）。改动
后端模块后若打包报缺文件，先核对 `build.files`。

字段含义核对请见 `data.js` 顶部；形态规则定义见 `screener-core.js`；形态明细见 `docs/xingtaidu-patterns.md`。
