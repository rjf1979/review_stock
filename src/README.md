# 行情日报平台 MVP

> 外部分析服务、AI 工具或自动化脚本对接本平台 API，请查阅 [后台管理 API 对接手册](../docs/api-integration-manual.md)。

## 启动

```powershell
cd src
npm install
npm run build
node server/index.js
```

打开 `http://localhost:3000`。

开发环境注册后，验证链接会打印在运行服务的终端中。复制链接到浏览器即可完成邮箱验证。

## 后台配置

复制 `.env.example` 为 `.env`，配置服务连接参数：

- `DATABASE_URL`：PostgreSQL 连接地址。本机免密 PostgreSQL 默认使用 `postgresql://postgres@127.0.0.1:5432/postgres`。
- `APP_URL`：部署后的公网地址。
- `ADMIN_KEY`：日报手动发送接口密钥。

邮件服务在后台的“邮件设置”中保存到 PostgreSQL。密钥只以掩码显示，服务端发送邮件时直接读取数据库配置。分析报告上传密钥由服务端首次启动时自动生成，保存在 PostgreSQL，在后台“上传密钥”页面查看或重新生成。

## 分析报告上传

平台自身不进行行情分析。外部分析服务把写好的分析结果 MD 文件上传到平台，由服务端渲染为 HTML 报告页并推送给订阅用户：

```
POST /api/upload/report
Headers:  x-upload-key: <上传密钥>   Content-Type: application/json
Body:     { "date": "2026-08-20", "markdown": "# A股收盘复盘\n\n正文…" }
```

- 上传密钥由服务端首次启动时自动生成，在后台“上传密钥”页面查看、重新生成或自定义设置。
- `date` 必填，为行情所属交易日，必须是 `YYYY-MM-DD` 且不能晚于今天。
- `markdown` 为 Markdown 字符串，需非空且不超过 5MB。
- 支持 YAML frontmatter（`title` / `summary`），否则取首个 `#` 标题和首个纯文本段落。
- 成功返回 `201`，报告写入 `src/reports/<date>/<date>-analysis.html`，原始 MD 保留为 `<date>-analysis.md`，该交易日标记为 `analyzed`。
- 密钥缺失或错误返回 `401`。

上传接口仅接收并保存数据（触发点）、立即返回 201，**不等待渲染**；AI 排版由后台独立任务异步完成（约 1-2 分钟）：调用后台“AI 设置”中配置的模型（支持 OpenAI Responses 与 Anthropic Messages 协议），由 AI 从零设计、将 Markdown 排版为一份全新的精美完整 HTML（不参考任何旧报告）；AI 同时在 HTML 中内嵌 `<script type="application/json" id="report-data">` 提炼首页所需结构化数据（市场温度、主要指数、市场广度、主线、连板梯队、明日观察点），服务端解析后存于 `day.analysis` 供首页展示。AI 未启用、未配置或调用失败时保留基础渲染，上传永不失败。后台“报告上传”页面可手动保存同一格式的 Markdown 报告，与外部分析接口共用同一处理机制。

上传后可在后台“每日报告”预览，`/api/admin/send-daily` 或每日 15:46 定时任务会把报告推送给已订阅用户。

## 日报发送

订阅用户会在服务启动后的定时任务中，于本地时间 15:46 之后发送当日简报。也可以手动触发：

```powershell
Invoke-RestMethod http://localhost:3000/api/admin/send-daily -Method Post -Headers @{ 'x-admin-key' = 'local-admin-key' }
```

当前报告归档在 `src/reports/`。只有 `analysisStatus=analyzed` 的交易日允许发送订阅邮件。

## 数据存储

除 `reports/` 内可直接访问的 HTML 行情报告外，全部业务数据仅保存于 PostgreSQL：用户、登录会话、交易日状态、分析任务、邮件发送记录和邮件设置均不依赖本地 JSON 或 Markdown 文件。首次启动会自动创建 `app_state` 与 `app_settings` 两张表；当前已保存的邮件设置会直接从数据库加载并可在后台修改。

## 交易日与上传触发

- 首页从 `/api/today` 读取当前交易日，分析未完成时显示“等待外部分析报告上传”。
- 后台地址：`http://localhost:3000/admin`。
- 只有 `analysisStatus=analyzed` 的交易日允许发送订阅邮件。
- 后台“邮箱注册情况”展示注册总量、验证状态和按日新增。
- 后台“每日发送进度”展示应发送、已发送、失败、待发送和完成率。
- 后台“分析任务”记录外部分析上传（`upload`）的状态与完成时间。
- 生产环境请替换 `ADMIN_KEY`，不要使用默认值；上传密钥在后台管理，请勿泄露给外部。
