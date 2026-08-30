# 股市脉搏 · 云端行情 API（众包采集）

独立 Node HTTP 服务。两种模式：

- **file 模式（默认）**：PC 唯一采集，JSON 落盘 `data/`，向后兼容旧部署。
- **cloud 模式（`MAPI_MODE=cloud`）**：多用户众包采集，OSS 存对象 + Postgres 存索引，实现「先采集先共享」（先采集者原子认领槽位、其余设备直接读共享对象）。

## 启动

```bash
node server.js          # file 模式
MAPI_MODE=cloud node server.js   # cloud 模式
```

默认监听 `127.0.0.1:3102`。生产建议只绑内网端口，由 Nginx/Caddy 对外 HTTPS 反代。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `3102` | 监听端口 |
| `HOST` | `127.0.0.1` | 监听地址 |
| `DATA_DIR` | `./data` | file 模式落库目录 + heartbeat |
| `MAPI_MODE` | `file` | `file` 或 `cloud` |
| `MAPI_UPLOAD_TOKEN` | `''` | file 模式写入令牌；cloud 模式兼容路径 |
| `MAPI_JWT_SECRET` | `''` | cloud 模式设备 token 签名密钥 |
| `MAPI_STALE_MS` | `600000` | `status` 标记 stale 的阈值（毫秒） |
| `MAPI_RATE_CAPACITY` / `MAPI_RATE_REFILL` | `30` / `1` | cloud 模式每设备限流令牌桶 |
| `MAPI_CDN_DOMAIN` | `''` | 读 URL 的 CDN 域名（如 `oss.askcode.cn`） |
| `DATABASE_URL`（或 `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE`） | — | cloud 模式 PG 连接 |
| `ALIYUN_OSS_REGION/ACCESS_KEY_ID/ACCESS_KEY_SECRET/BUCKET/ENDPOINT` | — | cloud 模式 OSS 连接 |

## 核心语义（cloud 模式）

「先采集先共享」分两条写入语义：

- **槽位认领（first-writer-wins）**：不可变数据（复盘/龙虎榜/日K）。以数据逻辑身份为键（如 `review:2026-08-29:close`），PG `INSERT ... ON CONFLICT DO NOTHING` 原子仲裁——谁先认领成功谁写 OSS，后来者返回 `{won:false, url, etag, ready}` 直接读。
- **头指针更新（freshest-wins）**：持续变化数据（实时快照/自选报价）。时间戳单调守卫，仅接受更新的写入，拒绝旧数据回写。

## 写入端（cloud 模式需 Device Token，`POST /auth/device` 换取；file 模式用 `X-Upload-Token`）

- `POST /auth/device` 设备注册，返回 `{deviceId, token}`
- `POST /collect/review`（`{date, markdown, payload, meta, ...}`）
- `POST /collect/dragon`（`{date, list}`）
- `POST /collect/kline`（`{code, tradeDate, latestDate, kline}`）
- `POST /collect/realtime`（整包快照，含 `updatedAt`）
- `POST /collect/quotes`（`{stocks, updatedAt}`）
- `POST /collect/heartbeat`（心跳）

## 读取端（公开只读）

- `GET /api/realtime` 最新实时快照
- `GET /api/review?date=YYYY-MM-DD` / `GET /api/reviews`
- `GET /api/dragon?date=YYYY-MM-DD`
- `GET /api/stocks?codes=a,b`
- `GET /api/kline?code=xxx&date=YYYY-MM-DD`
- `GET /api/status`

cloud 模式读响应额外带 `url`（OSS/CDN 直链）。

## 测试与校验

```bash
npm run check   # 语法检查
npm test        # 单元测试（node --test，无需 PG/OSS）
```

`db.js` 的建表 SQL 见 `schema.sql`（与服务启动时的幂等建表一致）。

## 部署要点

- 写入端必须配置鉴权（file 模式 `MAPI_UPLOAD_TOKEN`；cloud 模式 `MAPI_JWT_SECRET`）。
- OSS 长期 AK/SK 只存在本服务端（`.env`），绝不下发客户端；读走 public-read + CDN。
- 数据对象键前缀 `hangqing/`，与桌面安装包前缀 `files/` 分离。
- 周期性用 systemd/pm2 保持运行；PG 三表备份 + OSS 对象即为全部状态。
