# App 众包采集 · 明天部署与默认分享方案

> 状态：方案定稿（2026-08-29），**明天执行部署 + 开发**，今天只落文档不动代码。
> 决策：**PC 与移动端都参与数据分享，默认开启，不提供用户侧开关。**

---

## 一、定稿决策

1. **采集方 = PC 桌面版 + 移动端 App（多设备众包）**，谁先采到谁发布（Phase 1 认领协议已就绪）。
2. **默认分享，无开关**：所有采集方默认就上传到云端共享；不向用户暴露"云同步开启/关闭"控件。
3. 移动端不依赖 PC 在线；任一设备关机，其余设备自动顶替（新鲜度判断 → 缺则抓源 → 认领）。
4. PC 走设备鉴权作为**高可信采集源**（Phase 2 已做懒注册）；移动端走同一套 `/auth/device`。

---

## 二、明天要改的代码点（默认分享 + 去开关）

### PC 端（`src/desktop/`）
| 位置 | 现状 | 改为 |
| --- | --- | --- |
| `storage.js` `DEFAULT_SETTINGS` | `cloud_enabled: false, cloud_url: '', cloud_token: ''` | `cloud_enabled: true`，`cloud_url: 'https://api.dailystock.askcode.cn'`（内置默认） |
| `server.js` `createCloudPush` 的 `run()` | 未配 `cloud_url` 才跳过 → 默认已内置，恒真 | `if (!cfg.enabled)` 默认 false → 默认 true；`url` 有默认值不再跳过 |
| `cloud-upload.js` | `!config.token && !config.deviceToken` 才懒注册 | 默认走 `deviceToken` 懒注册（`X-Upload-Token` 兼容路径保留，不再需要用户填） |
| `frontend/index.html` 设置页 | 三道控件：`cloudEnabled` 复选框（默认 false）、`cloudUrl` 输入、`cloudToken` 密码 | **移除"手机云同步"复选框**；`cloudUrl` 改为只读/隐藏（用内置默认）；移除 `cloudToken` 输入（自动鉴权） |
| 前端 JS（`vue` data / `applyCloudEnabled` 等） | `cloudEnabled` 默认 false，可写 | `cloudEnabled: true`（恒真），删除开关 handler |

> 说明：`cloud_url`/`cloud_token` 仍保留在设置存储里（供兼容与将来切换域名），只是不再由用户编辑；`cloud_enabled` 语义从"用户开关"改为"分享总开关（恒真）"，前端不再渲染控件。

### 移动端（`src/app_flutter/`）
- 已默认走 `/auth/device` 自动注册 + 每次读后端判新鲜度 → 属"默认分享"，无开关。无需改动；确认 `collector_service` 在非交易时段静默即可。

---

## 三、mapi 部署（明天）

目标：`api.dailystock.askcode.cn`（`47.92.170.168`），该服务器自带 PG。

### 0. 前置（明天先确认）
- SSH：`~/.ssh/config` 目前只有 `zhicha-vps`（107.148.27.165:49073），**无本机别名**。候选密钥 `~/.ssh/deploy_market_daily`（ed25519，注释 `deploy-market-daily`）。→ 先加 Host 别名、验证连通与 sudo/目录权限。
- 服务器 PG：确认已装、连接方式（host/port/user/db），建库 `hangqing_mapi`。
- 把 `src/mapi/` 拷到服务器（或 git clone 仓库后取该目录）。

### 1. 依赖
```bash
cd /opt/apps/hangqing-mapi && npm install --omit=dev   # ali-oss, pg
```

### 2. 环境变量 `.env`（勿入库）
```
PORT=3102
HOST=127.0.0.1
MAPI_MODE=cloud
MAPI_UPLOAD_TOKEN=            # 可选，兼容路径
MAPI_JWT_SECRET=<强随机>       # 设备 token 签名（openssl rand -hex 64）
MAPI_CDN_DOMAIN=oss.askcode.cn
MAPI_STALE_MS=600000
MAPI_CLAIM_TTL_MS=120000
MAPI_REAP_INTERVAL_MS=60000
PGHOST=127.0.0.1  PGPORT=5432  PGUSER=...  PGPASSWORD=...  PGDATABASE=hangqing_mapi
ALIYUN_OSS_REGION=cn-shanghai  ALIYUN_OSS_BUCKET=my-soft-2026
ALIYUN_OSS_ACCESS_KEY_ID=...   ALIYUN_OSS_ACCESS_KEY_SECRET=...
```

### 3. 建表
```bash
psql "$PGDATABASE" -f src/mapi/schema.sql   # devices/slots/heads（幂等）
```
服务首次启动 `ensureSchema()` 也会建表（双保险）。

### 4. nginx 反代（HTTPS）
- server_name `api.dailystock.askcode.cn`；
- `location /` 反代 `127.0.0.1:3102`；
- 配 SSL（certbot / 现有证书流程），写接口带 `Authorization: Bearer <device token>`。

### 5. systemd 常驻
- `hangqing-mapi.service`，`ExecStart=/usr/bin/node server.js`，`EnvironmentFile=.env`，`Restart=always`；`systemctl enable --now`。

### 6. 上线验证（端到端）
1. `curl https://api.dailystock.askcode.cn/api/status` → 200（有 `serverTime`）。
2. `POST /auth/device` → 返回 `deviceId`+`token`。
3. 带 `Bearer` 上传 `/collect/realtime` → `{won:true,...}`；再传同时间桶 → `{won:false}`（去重生效）。
4. `POST /collect/review` 同日期第二次 → `{won:false, ready:true}`（first-writer-wins 生效）。
5. OSS 公网回读 `https://oss.askcode.cn/hangqing/...` 可访问；`/api/realtime` 返回带 `url`。
6. PC 端打开云同步（现在默认开）→ `cloud-upload` 自动注册设备 → 上传心跳；移动端同域名可读。

### 7. 回滚
- systemd stop + 切 nginx 指向回退；数据即 OSS 对象 + PG 三表，备份 `pg_dump` 与 OSS 前缀即可。

---

## 四、明天开发顺序

1. **部署 mapi**（下节三），跑通上面验证 1–6。
2. **PC 默认分享 + 去开关**（下节二）：改 `storage.js`/`server.js`/`cloud-upload.js`/设置页 UI/前端 JS；`npm test` + 手动开关桌面版验收。
3. **移动端联调**：`flutter run -d chrome --dart-define=MAPI_URL=https://api.dailystock.askcode.cn` 连真实云端，确认读下发 + 采集认领。
4. 补测试：PC `cloud-upload` 默认设备注册；`storage` 默认 `cloud_enabled=true`。

---

## 五、风险

- **默认上传 = 数据出本机**：需在合规红线内（仅公开源确定性计算，温度/情绪不上引），与文档既有边界一致。
- **无开关**：若用户不希望 PC 上传，只能靠关闭应用；如需"隐私总开关"可后续加回（当前按"默认分享、不展示开关"执行）。
- **公网写接口**：`/collect/*` 需 `Bearer`，须保证 `MAPI_JWT_SECRET` 只存在服务端 `.env`（不入库、不下发客户端）。
- **OSS AK/SK**：只放服务端 `.env`；客户端仅 Device Token，读走 public-read + CDN。
