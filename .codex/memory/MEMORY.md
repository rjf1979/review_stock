# 项目记忆 · 行情日报

项目：A股收盘复盘日报平台（订阅注册 → 报告上传 → HTML 渲染 → 邮件推送）。
位置：`D:\Projects\行情日报`；服务端 `src/server/index.js`（Node 原生 http），PostgreSQL 持久化，前端 Vue 3。

## 数据与接口约定
- 平台自身不生成行情分析；每日行情由外部分析服务经 `POST /api/upload/report`（请求头 `x-upload-key`）上传 Markdown，服务端渲染 HTML 并推送订阅邮件。
- **2026-08-21 起，上传接口 `date`（行情日期）字段必填**（`YYYY-MM-DD`，不能晚于今天），缺省为当天的行为已移除；后台 `/api/admin/reports/upload` 同样必填。调用方必须显式携带行情日期，避免行情被归到上传当天。
- 完整对接手册：`docs/api-integration-manual.md`（2026-08-21 起**只保留上传每日行情 MD 接口** `POST /api/upload/report`，其余后台接口不在手册范围）。
- 上传密钥（`app_settings.upload_key`）在后台「API 对接手册」页（`/admin/api-manual`）查看并复制；独立"上传密钥"管理页与 `PUT /api/admin/settings/upload-key` 接口已移除（2026-08-21）。

## 鉴权（三套）
- 后台管理：请求头 `x-admin-key`（`ADMIN_KEY`，默认 `local-admin-key`，生产必须更换）
- 上传：请求头 `x-upload-key`（PG `app_settings.upload_key`，首次启动自动生成）
- 订阅用户：`sid` Cookie（`/api/login` 下发，30 天有效）

## 基础设施
- 本地 PostgreSQL 免密可连：`postgresql://postgres@127.0.0.1:5432/postgres`
- 业务数据全部存 PostgreSQL（`app_state` JSONB + `app_settings`），无本地 JSON 依赖。
- 每日 15:46（Asia/Shanghai）定时推送已订阅用户日报。
- 项目 Skill 基线在 `.agents/skills/`（A股复盘、行情数据、UI 等）。
