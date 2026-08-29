# 手机 App（uni-app Vue3）架构与接口契约

> 状态：设计定稿（v0.1）。移动端沿用 PC 桌面版的 7 视图结构；行情数据由 PC 端采集后上传，移动端通过云端行情 API 读取。移动端不依赖 `src/desktop/` 的 Electron 主进程与本地 HTTP 服务。

## 一、总体数据流

```
┌──────────────────────────────┐
│  PC 桌面版（Electron）           │
│  本地采集：腾讯/东财/mootdx       │
│  ├─ server.js（/api/realtime…） │
│  └─ 新增 cloud-upload.js        │
│     采集快照/复盘/龙虎榜后 POST    │
└──────────────┬───────────────┘
               │ HTTPS + X-Upload-Token
               ▼
┌──────────────────────────────┐
│  云端行情 API（VPS，mapi.zhicha.io）  │
│  ├─ POST /collect/*  接收采集上传    │
│  ├─ JSON 文件落库（快照/复盘/龙虎榜）  │
│  └─ GET /api/*       供移动端读取    │
└─────────────┬────────────────┘
               │ HTTPS（公开只读）
               ▼
┌──────────────────────────────┐
│  移动端 uni-app(Vue3)           │
│  7 视图：实时/自选/大盘/复盘/龙虎榜/   │
│  历史/设置，均消费云端行情 API        │
└──────────────────────────────┘
```

**原则**
- 采集仍在用户本地 PC 完成（沿用现有公开免费数据源），云仅做「上传中转 + 存储 + 只读下发」。
- 移动端不直连任何行情源，只认云端行情 API。
- PC 端只负责写（上传），云只负责读下发；读多写少。
- 采集上传采用「自上次成功时间之后的新数据 + 心跳」；云侧保留最近 N 天。

## 二、云端行情 API（服务端）

独立 Node http 服务，运行在现有 VPS（推荐 `mapi.zhicha.io`，内部端口如 `3102`，由 nginx 反代 + Cloudflare 兜底，参考 `dailystock` 部署约定）。

### 写入端（PC 上传，需 `X-Upload-Token`）
| 方法 | 路径 | 请求体 | 说明 |
| --- | --- | --- | --- |
| POST | `/collect/realtime` | `{...realtimePayload}` | 实时行情整包快照（含 indices/breadth/sectors/concepts/fundFlow/pankou/marketSession/dataMeta/updatedAt） |
| POST | `/collect/review` | `{date, markdown, temperature, payload, meta}` | 每日复盘（午间快照 + 收盘复盘） |
| POST | `/collect/dragon` | `{date, list}` | 龙虎榜 |
| POST | `/collect/quotes` | `{stocks, updatedAt}` | 自选股报价（PC 已采集的个股快照） |
| POST | `/collect/kline` | `{code, tradeDate, latestDate, kline}` | 个股日 K 线 |
| POST | `/collect/heartbeat` | `{token, version, fetchedAt, ok}` | 心跳，云侧记录最近采集时间/质量 |

### 读取端（移动端读，公开只读或 Token）
| 方法 | 路径 | 返回 |
| --- | --- | --- |
| GET | `/api/realtime` | 最新实时快照；无采集时 `{status:'stale', ...}` |
| GET | `/api/review?date=YYYY-MM-DD` | 当日复盘（markdown + 结构化 payload） |
| GET | `/api/reviews` | `{entries:[{date,temperature,reportMode,qualityStatus,asOf,updatedAt}]}` |
| GET | `/api/dragon?date=YYYY-MM-DD` | `{date,list}` |
| GET | `/api/stocks?codes=...` | `{stocks:[{code,name,price,changePct,…}]}` |
| GET | `/api/kline?code=...&date=...` | `{code,tradeDate,latestDate,isFresh,kline:[...]}` |
| GET | `/api/status` | `{latestFetchAt, version, quality, serverTime}` |

### 鉴权与降级
- 写接口一律要求 `X-Upload-Token`（配置在云端 `production.env` 与 PC 端设置中）。
- 读接口若最近 N 分钟无采集心跳，返回 `status:'stale'` + 最近一次快照，前端显示「数据更新于 HH:mm」。
- 云侧在「采集缺失超过阈值」时可作为兜底直连公开源（可选开关，默认关闭，保持 PC 采集优先）。
- `/api/stocks`、`/api/kline` 由云端读取 PC 上传的缓存（`/collect/quotes`、`/collect/kline`），云自身不采集。

## 三、PC 端采集上传模块

新增 `src/desktop/cloud-upload.js`：
- 复用现有 `review-core.js` 的结果集（realtime snapshot、review payload、dragon list）。
- 采集完成/复盘生成后，异步 POST 到云端行情 API；失败重试 + 上限（如 5 次，指数退避）。
- 配置项：`cloud_url`、`cloud_token`、`cloud_enabled`，保存在桌面版设置（`/api/settings`，SQLite）。
- 与现有 `review-scheduler.js` 结合：`12:00` 上传午间快照，`16:00` 上传收盘复盘；实时快照按频率（如 60s）上传。
- 上传不阻塞本地 UI；失败仅记录，不影响桌面功能。

## 四、移动端 uni-app(Vue3)

目录 `src/app/`，标准 uni-app Vite 工程。7 个页面照搬 PC 结构：

| 页面 | 路由 | 数据接口 | 说明 |
| --- | --- | --- | --- |
| 实时行情 | `pages/realtime/index` | `/api/realtime` | 指数条 + 全市场宽度 + 涨停/跌停 + 板块/资金 + 盘口异动 |
| 自选股 | `pages/watchlist/index` | `/api/stocks?codes=` + `/api/kline` | 自选列表 + 报价 + K 线 |
| 大盘概况 | `pages/overview/index` | `/api/realtime`（indices/sectors） | 指数详情 + 行业涨幅 |
| 每日复盘 | `pages/review/index` | `/api/review?date=` | 温度 + 结构化复盘（markdown 渲染） |
| 龙虎榜 | `pages/dragon/index` | `/api/dragon?date=` | 表格 |
| 历史报告 | `pages/history/index` | `/api/reviews` + `/api/review?date=` | 日期列表 → 详情 |
| 设置 | `pages/settings/index` | 本地存储 + `/api/status` | API 地址、数据源、主题、免责 |

### 前端分层
- `src/api/client.js`：`request('/api/realtime')` 封装 uni.request，统一超时/错误/`status:'stale'` 降级。
- `src/api/modules.js`：按页面对应的接口函数（`getRealtime`、`getReview(date)` 等）。
- `src/utils/format.js`：涨跌颜色（红涨绿跌）、数字千分位、时间格式化。
- `src/store/`：轻量响应式（Vue `reactive`）缓存最新快照、自选股。

## 五、关键约束

- 移动端不得 `require`/`import` `src/desktop/`；数据交互只通过云端行情 API 契约。
- 红涨绿跌、免责声明、温度/情绪 = 统计指标不上引（沿用 PC 合规红线）。
- 工程独立构建（`npm run dev:h5` / `build:app`），与桌面端互不影响。
- 敏感信息（上传 Token）不写入仓库，PC 端存本地设置、云端存 `.env`。
