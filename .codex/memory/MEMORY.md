# 项目记忆 · 行情日报

项目：A股收盘复盘日报平台（报告上传 → HTML 渲染 → 后台查看）；邮件订阅已停用。
位置：`D:\Projects\行情日报`；服务端 `src/server/index.js`，PostgreSQL 持久化，Vue 3 前端，Electron 桌面端在 `desktop/`。

## 当前约定
- 外部分析服务通过 `POST /api/upload/report` 携带 `x-upload-key` 上传 Markdown；`date` 必填，格式为 `YYYY-MM-DD` 且不得晚于今天。
- 完整接口说明：`docs/api-integration-manual.md`；上传密钥在后台「API 对接手册」页查看。
- 后台鉴权：`x-admin-key`；上传鉴权：`x-upload-key`。生产必须替换默认 `ADMIN_KEY`。
- 邮件旧用户、会话、配置列和发送记录保留在 PostgreSQL 兼容历史数据，但运行时不再读取、修改或发送；旧订阅 API 返回 HTTP 410，定时发送已删除。
- 桌面端工作日 15:35 后自动生成复盘，支持托盘常驻、系统通知和本地归档。
- 桌面端亮/暗皮肤已完成：设置页切换，`hq_theme` 本地持久化，亮色沿用 Web 红白黑设计。
- 桌面端刷新体验已完成：实时行情只做 Vue 局部静默更新；刷新期间保留数据，不整体刷新页面。其它视图使用内容区遮盖式 loading，避免布局抖动。
- 桌面端交易时段已完成：A 股工作日 `09:30-11:30、13:00-15:00` 才轮询；闭市时显示闭市原因与下次开市时间，并单次获取、保留最后交易行情快照。
- Electron 已加入单实例锁，避免重复启动造成 `3100` 端口占用弹框。
- 生产环境：`https://dailystock.zhicha.io`，systemd 服务 `dailystock.service`，内部端口 `3002`；2026-08-22 已发布并重启验证。
