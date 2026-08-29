# 股市脉搏 · 云端行情 API

独立 Node(纯内置模块) HTTP 服务，职责是「接收 PC 端采集上传、只读下发给移动端」。云不做采集。

## 启动

```bash
node server.js
```

默认监听 `127.0.0.1:3102`。生产环境建议只绑内网端口，由 Nginx/Caddy 对外 HTTPS 反代。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `3102` | 监听端口 |
| `HOST` | `127.0.0.1` | 监听地址 |
| `DATA_DIR` | `./data` | 落库目录（快照/复盘/龙虎榜/K线） |
| `MAPI_UPLOAD_TOKEN` | `''` | 写入端令牌；为空时所有写入拒绝 |
| `MAPI_STALE_MS` | `600000` | `status` 标记为 stale 的阈值（毫秒） |

示例（写入端令牌从 `.env` 读取，勿写入仓库）：

```bash
HOST=127.0.0.1 PORT=3102 DATA_DIR=/opt/apps/hangqing-mapi/shared \
MAPI_UPLOAD_TOKEN="$MAPI_UPLOAD_TOKEN" node server.js
```

## 写入端（PC 上传，需 `X-Upload-Token`）

- `POST /collect/realtime` 实时行情整包快照
- `POST /collect/review` 每日复盘（含 `date`）
- `POST /collect/dragon` 龙虎榜（含 `date`）
- `POST /collect/quotes` 自选报价 `{stocks, updatedAt}`
- `POST /collect/kline` 个股日 K `{code, ...}`
- `POST /collect/heartbeat` 心跳 `{version, fetchedAt, ok}`

无令牌或令牌不匹配返回 `401`，且不落盘。

## 读取端（移动端只读）

- `GET /api/realtime` 最新实时快照；无采集时 `503`
- `GET /api/review?date=YYYY-MM-DD` 当日复盘
- `GET /api/reviews` 复盘日期列表
- `GET /api/dragon?date=YYYY-MM-DD` 龙虎榜
- `GET /api/stocks?codes=a,b` 自选报价
- `GET /api/kline?code=xxx` 日 K
- `GET /api/status` 心跳/质量

## 部署要点

- 写入端必须配 `MAPI_UPLOAD_TOKEN`，且只下发给自有 PC 端，不要泄露到公开仓库。
- 读接口面向手机 App，可无需令牌；如需收紧，可后续为读加只读密钥。
- 周期性用 `systemd`/`pm2` 保持运行；数据落在 `DATA_DIR`，备份该目录即可。
