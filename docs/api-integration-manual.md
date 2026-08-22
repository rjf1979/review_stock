# 行情日报 · 上传每日行情（报告 MD）接口对接手册

> 供外部分析服务 / AI 工具 / 自动化脚本把每日行情收盘复盘 Markdown 上传到行情日报平台。仅此一个接口；其余后台管理接口不在本文档范围内。
> 更新时间：2026-08-21；接口行为以 `src/server/index.js` 为准。

## 1. 基本信息

| 项目 | 值 |
| --- | --- |
| 接口 | `POST /api/upload/report` |
| Base URL | `{BASE}` |
| 请求头 | `Content-Type: application/json`、`x-upload-key: {UPLOAD_KEY}` |
| 上传密钥 | `{UPLOAD_KEY}` |
| 请求体上限 | 5 MB |
| 日期格式 / 时区 | `YYYY-MM-DD`，按 Asia/Shanghai 判定"今天" |

## 2. 鉴权

- 请求头必须携带 `x-upload-key: {UPLOAD_KEY}`。
- 密钥错误返回 `401`；服务端尚未生成密钥返回 `503`。

## 3. 请求

```
POST {BASE}/api/upload/report
Headers:
  Content-Type: application/json
  x-upload-key: {UPLOAD_KEY}
Body:
{
  "date": "2026-08-20",
  "markdown": "# A股收盘复盘\n\n正文…"
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `date` | 是 | 行情所属交易日 `YYYY-MM-DD`，不能晚于今天 |
| `markdown` | 是 | Markdown 字符串，≤5 MB；支持 YAML frontmatter（`title` / `summary`），否则取首个 `#` 标题与首个纯文本段落 |

## 4. 成功响应（201）

```json
{
  "ok": true,
  "date": "2026-08-20",
  "reportPath": "/reports/2026-08-20/2026-08-20-analysis.html",
  "title": "A股收盘 · 主线与情绪复盘",
  "summary": "……",
  "day": {
    "date": "2026-08-20",
    "marketStatus": "closed",
    "lhbStatus": "pending",
    "analysisStatus": "analyzed",
    "reportPath": "/reports/2026-08-20/2026-08-20-analysis.html",
    "analysis": { "title": "…", "summary": "…", "temperature": null, "source": "upload", "uploadedAt": "…" },
    "updatedAt": "…"
  }
}
```

上传成功后：接口**立即返回 201**（仅接收并保存数据，作为触发点），原始 MD 写入 `reports/<date>/<date>-analysis.md`，并先写入基础渲染 HTML；该交易日标记为 `analyzed`，每日 15:46 定时推送给订阅用户。**AI 排版为独立后台任务**：接口返回后约 1-2 分钟内，后台自动用「AI 设置」中的模型把 MD 排版为精美 HTML 并提炼首页数据（市场温度/指数/广度/主线/连板等），覆盖基础渲染。接口调用方无需等待渲染完成，也不受 AI 渲染耗时的超时影响。

## 5. 错误响应

| 状态码 | 原因 |
| --- | --- |
| `400` | 缺少 `date` / 日期格式错误 / 日期晚于今天 / 缺少 `markdown` |
| `401` | 上传密钥无效 |
| `413` | 请求体超过 5 MB |
| `503` | 上传密钥尚未生成 |

错误体固定为 `{ "error": "<原因>" }`。

## 6. curl 示例

```bash
curl -X POST "{BASE}/api/upload/report" \
  -H "Content-Type: application/json" \
  -H "x-upload-key: {UPLOAD_KEY}" \
  -d '{"date":"2026-08-20","markdown":"# A股收盘复盘\n\n今日主线……"}'
```

## 7. 注意事项

- **`date` 必填**：2026-08-21 起改为必填，缺失返回 400，避免行情被归到错误日期。
- **未来日期拒绝**：`date` 不得晚于今天（Asia/Shanghai）。
- **中文编码**：请求体须为 UTF-8，`markdown` 中文内容原样保留。
- **异步渲染，上传永不因超时失败**：接口只接收并保存数据、立即返回 201；AI 排版在后台独立完成（约 1-2 分钟），失败自动保留基础渲染。调用方超时只需覆盖到接口返回（秒级），无需等待 AI 渲染。
- **密钥管理**：上传密钥由服务端首次启动自动生成并存于 PostgreSQL；本平台「API 对接手册」页面可查看并复制当前密钥。若需更换密钥，请在数据库 `app_settings.upload_key` 手动更新。
