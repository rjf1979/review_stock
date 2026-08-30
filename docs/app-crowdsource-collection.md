# App 端众包数据采集 · 先采集先共享架构方案

> 决策（2026-08-29 定稿）：**采集方 = PC 桌面版 + 移动端 App（多设备众包），默认分享、不提供用户侧开关**。PC 与手机同为采集竞争方（谁先采到谁发布），移动端不依赖 PC 在线；PC 走设备鉴权作为高可信源。具体部署与默认分享改动见 `docs/app-deploy-plan.md`。

> 状态：方案定稿（v0.1，2026-08-29），尚未开发。移动端技术栈由 uni-app(Vue3) 改为 Flutter；采集从「PC 唯一」扩展为「多用户众包」，核心是解决「谁先采集谁先共享」的分布式去重与原子仲裁。本文档是落地设计，替代 `docs/mobile-architecture.md` 中「PC 唯一采集」的数据流描述（接口契约整体仍兼容）。

## 一、背景与目标

- 现状：PC 桌面版（Electron）是唯一采集方，从腾讯/东财公开源抓行情；`src/mapi/server.js` 接收 `/collect/*` 上传、本地 JSON 落盘、向移动端 `/api/*` 只读下发。OSS（`my-soft-2026`，cn-shanghai，自定义域名 `oss.askcode.cn` + CDN）目前只托管 `.exe`。
- 目标：采集能力开放到多用户 App（Flutter），形成众包采集集群——**谁先采到某条数据就先发布到 OSS 共享，其余设备直接读、不再重复抓源**。
- 分工：**独立 API 做协调/鉴权/仲裁 + 阿里云 OSS 做存储与 CDN 下发**。

## 二、核心设计：先采集先共享怎么做

**采集方构成**：PC 桌面版（Electron）+ 多台移动端 App，均从公开源抓取并经云端认领/校对后共享。PC 常驻、可信、字段最全，作为高可信源；移动端补充覆盖。所有采集方**默认就分享**（无用户开关），任一设备离线由其余设备自动顶替，不构成单点。

两个关键点：

1. **去重键 = 数据的逻辑身份（时间桶），不是设备时钟**。同一份数据在所有设备上算出同一个键，谁先到达都收敛到同一对象。
2. **仲裁原子化在 API 侧，客户端永远不持有 OSS 密钥**。

### 对象键（去重键）

| 数据类型 | 键（OSS object key） | 语义 |
| --- | --- | --- |
| 每日复盘 | `hangqing/review/<yyyymmdd>/<mode>.json`（`morning`/`close`） | 槽位认领 |
| 龙虎榜 | `hangqing/dragon/<yyyymmdd>.json` | 槽位认领 |
| 个股日 K | `hangqing/kline/<code>/<yyyymmdd>.json` | 槽位认领 |
| 实时快照 | `hangqing/realtime/<yyyymmdd>/<HHMMSS>.json` | 头指针更新 |
| 自选报价 | `hangqing/quotes/<yyyymmdd>/<HHMMSS>.json` | 头指针更新 |

### 两条写入语义

**A. 槽位认领（first-writer-wins，幂等）**——「一天只产一次、产完不变」的不可变数据（复盘/龙虎榜/日 K）。

仲裁用 Postgres 唯一约束（`api.dailystock.askcode.cn` 服务器自带 PG），原子、持久、零新增基础设施：

```sql
CREATE TABLE slots (
  slot_key   TEXT PRIMARY KEY,          -- 例 'review:2026-08-29:close'
  status     TEXT NOT NULL DEFAULT 'claimed',  -- claimed | done
  device_id  TEXT NOT NULL,
  object_key TEXT, etag TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), done_at TIMESTAMPTZ
);
```

写入协议（`POST /collect/review` 为例）：

1. 鉴权 + 限流 + 校验（见 §四）。
2. 算键 `slot_key`，执行 `INSERT ... ON CONFLICT (slot_key) DO NOTHING RETURNING slot_key`。
3. 返回空 → 已有写入者：`200 { won:false, existing:url }`，客户端改读该 URL。
4. 返回行存在 → 本机获胜：写 OSS（public-read），`UPDATE slots SET status='done', object_key=..., etag=...`。
5. 返回 `{ won:true, url, etag }`。

崩溃安全：`claimed` 未转 `done` 超过 TTL（约 2min）由清扫任务释放；数据幂等，重跑无害。

**B. 头指针更新（freshest-wins，时间桶去重）**——持续变化的实时快照/报价。时间戳单调守卫防旧数据回写：

```sql
CREATE TABLE heads (
  stream TEXT PRIMARY KEY,        -- 'realtime' | 'quotes'
  object_key TEXT, updated_at TIMESTAMPTZ, device_id TEXT
);
-- 仅当 incoming.updatedAt > 当前 updated_at 才覆盖
```

### 客户端协作闭环

每个设备采集前先问 API「该槽位是否已采集/是否新鲜」；缺则自己抓源上传，有则直接读共享对象，把上游免费源的重复抓取压到最小。

## 三、整体架构

```
采集方（多用户）：PC Electron + 多台 Flutter App
  各自从腾讯/东财公开源抓行情（Dart 复刻 PC 抓取逻辑）
  先查 API 是否已有 → 无则抓取+上传，有则直接读
        │ HTTPS + Device Token
        ▼
独立行情 API（api.dailystock.askcode.cn，47.92.170.168）
  auth(设备鉴权) / rate-limit / validate / 原子认领 / head 指针 / 读下发(返回 CDN URL)
  └─ 索引与状态存 Postgres（同服务器 PG）
        │ 写 OSS(持有 AK/SK)        │ 读(返回 CDN URL)
        ▼                           ▼
阿里云 OSS bucket my-soft-2026 / 前缀 hangqing/
  public-read + CDN(oss.askcode.cn)，大对象(日K/历史)走 CDN
```

安全边界：**OSS 长期 AK/SK 只存在 API 服务端**（复用 `.deploy/aliyun-oss.env`）；客户端只拿 Device Token，不碰 OSS 密钥（无需 STS）。读走 public-read + CDN，免签名 URL。

## 四、鉴权与校验（多用户众包必备）

- **设备鉴权**：首次启动 `POST /auth/device` 注册，返回 `device_id` + HS256 签名 Token（secret 存 `.env`）。写接口 `Authorization: Bearer <token>`；读接口公开。
- **信任分级（v1 简化）**：`devices(device_id, trust_level)`。owner 可标记自己的 PC/手机为 trusted；匿名新设备 trust_level 0。v1 通过校验即接受，trust 影响后续优先级；v2 再引入「新设备先证明质量再成权威」。
- **写入校验**（所有写接口统一执行）：
  - Schema：必填字段/类型。
  - 合理性：时间戳不得未来、须落在合法交易时段、价格 ≥0、涨跌幅在合理区间、日期须交易日。
  - 单调：实时/报价拒绝 `updatedAt` ≤ 当前 head 的旧数据。
- **限流**：按 device 令牌桶（单实例内存计数，mapi 单进程）。
- 过渡期保留现有 `X-Upload-Token` 兼容 PC 老客户端；新逻辑走 Device Token。

## 五、API 契约（在 `src/mapi` 上扩展）

写入端（Device Token / 兼容 X-Upload-Token）：`/auth/device`、`/collect/review`、`/collect/dragon`、`/collect/kline`（以上槽位认领）、`/collect/realtime`、`/collect/quotes`（头指针更新）、`/collect/heartbeat`。

读取端（公开，返回 OSS CDN URL 或内联 JSON）：`/api/realtime`、`/api/review?date=`、`/api/reviews`、`/api/dragon?date=`、`/api/kline?code=&date=`、`/api/stocks?codes=`、`/api/status`。返回统一带 `url` + `etag`，客户端优先从 CDN 拉取（缓存友好）；未配 CDN 时 API 内联回退。

## 六、改动清单

- **mapi（`src/mapi/`）**：`server.js` 拆分路由；新增 `oss.js`（`ali-oss` 封装，AK/SK 从 `.deploy/aliyun-oss.env` 注入）、`auth.js`（设备注册 + JWT）、`claim.js`（槽位认领 + 头指针单调更新）、`validate.js`（schema/合理性/交易日）、`rateLimit.js`、`schema.sql`（`devices`/`slots`/`heads` 三表）。`package.json` 新增 `ali-oss`、`pg`。环境变量新增 `PG_*`、`MAPI_JWT_SECRET`、`OSS_*`。
- **PC（`src/desktop/cloud-upload.js`）**：过渡期保持 `X-Upload-Token`，新增可选 `device_id` 注册，让 PC 作为 trusted collector 入新体系；改动最小。
- **Flutter（新增 `src/app_flutter/`，与 `src/app` 并存）**：
  ```
  lib/
    main.dart
    core/     api_client.dart(dio)、auth.dart(token+secure storage)、config.dart
    data/     models/、repositories/、sources/(Dart 复刻 PC 抓取)
    state/    riverpod providers
    features/ realtime/ watchlist/ overview/ review/ dragon/ history/ settings/
    services/ collector_service.dart(后台采集调度)、background(workmanager)
  ```
  - 网络 `dio`；首启注册 → `flutter_secure_storage` 存 token。
  - 7 视图照搬 PC 结构，消费 `/api/*`，大对象走 CDN。
  - `collector_service`：轮询 `/api/status` 判新鲜度 → 缺/过期则从腾讯/东财源抓取（复刻 desktop 的 `qt.gtimg.cn/q`、`web.ifzq.gtimg.cn/.../fqkline/get`、`push2*.eastmoney.com`、`datacenter-web.eastmoney.com` 等端点）→ 上传认领。
  - 合规沿用 PC 红线：红涨绿跌、免责声明、温度/情绪不上引。
- **文档**：更新 `docs/mobile-architecture.md` 的数据流描述。

## 七、分阶段实施

1. **Phase 0 · OSS 准备**：同 bucket 开 `hangqing/` 前缀 + 绑 CDN 路径（复用 `oss.askcode.cn`），验证 public-read。
2. **Phase 1 · mapi 升级**：加 `ali-oss`/`pg`、建表、新增五个模块，替换/并存现有读写路径；保持老 `/api/*` 兼容。
3. **Phase 2 · PC 接入新鉴权**：`cloud-upload.js` 注册设备、走新写路径（trusted）。
4. **Phase 3 · Flutter 骨架**：工程 + 鉴权 + 7 视图只读对接。
5. **Phase 4 · Flutter 采集端**：`collector_service` + 后台调度 + 抓源上传，实现「先采集先共享」闭环。
6. **Phase 5 · 加固**：限流/校验规则、trust 权重、CDN 缓存头、stale 降级、清扫任务。

## 八、验证

- **单元**：`claim.js` 并发写同一 slot → 恰好一个 `won:true`；键派生；`validate.js`（未来时间/非法交易日/负价拒绝）；头指针单调守卫（旧 `updatedAt` 被拒）。
- **集成**：两设备同时上传同日期复盘 → 一胜一读，URL/etag 一致；OSS 对象 public-read、`oss.askcode.cn/hangqing/...` 可公网取；PG 三表落对行。
- **端到端**：Flutter 模拟器 + PC 同时在线 → 杀 PC 后 App 自动转采集方；手机读到 CDN 数据，UI 显示「数据更新于 HH:mm / 来源设备」。

## 九、风险与备注

- **合规/ToS**：众包 = 把抓自腾讯/东财的公开数据再公开分发，需自行评估数据源服务条款与合规风险（本文案是技术实现，不背书合规）。
- **信任/投毒**：不可信设备可抢注上传错误数据 → §四 校验 + 限流 + trust 分级兜底；v1 校验从严，v2 再上「新设备先证明质量」。
- **成本**：实时快照「每设备每 60s 读一次」经 CDN 放大，需最小刷新间隔 + CDN 缓存 + head 短轮询降频。
- **一致性**：多条「最新」写入靠时间戳单调守卫保证不回退。

## 十、部署目标（服务器）

- 域名：`api.dailystock.askcode.cn` → `47.92.170.168`（阿里云，已入 `~/.ssh/known_hosts`）。
- 该服务器自带 PG（独立行情 API 的 `slots`/`devices`/`heads` 三表建在这里）。
- SSH 密钥候选：`~/.ssh/deploy_market_daily`（ed25519，注释 `deploy-market-daily`，与「行情日报」对应）；`~/.ssh/config` 目前尚无该服务器别名（现仅 `zhicha-vps`），部署前需补 Host 别名。
- OSS 走已有 `my-soft-2026` + CDN `oss.askcode.cn`；AK/SK 在 `.deploy/aliyun-oss.env`。
