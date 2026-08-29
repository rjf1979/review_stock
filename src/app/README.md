# 股市脉搏 · 移动端（uni-app Vue3）

A 股盘中 + 每日复盘移动端，页面结构沿用 PC 桌面版 7 视图；行情数据通过云端行情 API 读取，采集由 PC 端完成后上传。

## 技术栈

- uni-app（Vue3，Vite 5），`@dcloudio/*` 对齐版本 `3.0.0-5020420260813003`
- 可出端：H5 / App（iOS、Android）/ 微信小程序
- 数据层：`src/api/` 统一封装 `uni.request`，指向云端行情 API（可在「设置」中改地址）

## 页面（照搬 PC）

| 页面 | 路由 | 接口 |
| --- | --- | --- |
| 实时行情 | `pages/realtime/index` | `/api/realtime` |
| 每日复盘 | `pages/review/index`、`pages/review/detail` | `/api/review?date=`、`/api/reviews` |
| 自选股 | `pages/watchlist/index` | `/api/stocks?codes=`（本地保存自选） |
| K 线 | `pages/kline/index` | `/api/kline?code=` |
| 大盘概况 | `pages/overview/index` | `/api/realtime` |
| 龙虎榜 | `pages/dragon/index` | `/api/dragon?date=` |
| 历史报告 | `pages/history/index` | `/api/reviews` |
| 设置 | `pages/settings/index` | `/api/status` |

## 运行

```bash
npm install
npm run dev:h5      # H5 预览
npm run build:app   # 打包 App
npm run dev:mp-weixin
```

## 依赖说明

- 移动端**不依赖** `src/desktop/` 的 Electron 主进程或本地 HTTP 服务。
- 与云端行情 API 的数据契约见 [`docs/mobile-architecture.md`](../../docs/mobile-architecture.md)。
- 上传 Token、API 地址等敏感信息不入仓。

## 合规

行情数据来自公开来源，仅供整理与展示，不构成投资建议；「市场温度」「情绪指标」为统计性描述，不代表未来走势。
