# 行情日报项目指令

## 项目 Skill

本项目将 2026-08-18 日报生成所用规则版本化在 `.agents/skills/`。处理相关任务时按以下方式加载：

- 行情采集、收盘分析、日报生成、补数或质量核验：必须使用 `.agents/skills/a-share-daily-review/SKILL.md`。
- A 股接口、字段映射、数据源故障或历史数据校验：同时使用 `.agents/skills/a-stock-data/SKILL.md`。
- 后台、HTML 报告、响应式、打印、可访问性或交互状态：必须使用 `.agents/skills/ui-ux-pro-max/SKILL.md`。
- 报告视觉改版或最终视觉复核：在 UI 工程基线之后使用 `.agents/skills/design-taste-frontend/SKILL.md`，但不得改变后台信息架构。

现有设计系统与 2026-08-18 报告基准优先。日报只依赖项目数据契约内字段，不引入额外榜单数据或提示词。

## 桌面版发布

每次发布 Windows 桌面版必须作为一次完整发布链路执行，不得只更新其中一项：

1. 先同步更新 `src/desktop/package.json`、`src/desktop/package-lock.json` 与 `src/desktop/installer.nsi` 中的版本号。
2. 构建并校验同一版本的 `x64` 与 `ia32` Windows 安装包，产物命名为 `hangqing-desktop-<version>-win-x64-setup.exe` 和 `hangqing-desktop-<version>-win-ia32-setup.exe`。
3. 在 GitHub Release 上传两个安装包，并记录对应的 SHA-256。
4. 更新根目录 `README.md` 的当前版本号和两种架构的 Release 下载链接；不得保留不存在的安装包链接。
5. 提交版本、README 与必要发布说明，并推送到远程 `main`；发布完成后核对 Release、资产和远程提交均可访问。

## 分析报告上传

平台自身不再进行行情分析：17:00 定时分析、AI 分析生成与 Skill 管理已移除，服务端不再从数据库 `skill_configs` 读取 Skill。每日报告由外部分析服务通过 `POST /api/upload/report`（请求头 `x-upload-key`）上传 Markdown，服务端渲染为 `src/web/reports/<date>/<date>-analysis.html`（原始 MD 保留在 `<date>-analysis.md`），并把该交易日标记为 `analyzed` 后推送订阅邮件。渲染优先调用后台“AI 设置”中配置的模型（`openai_responses` / `anthropic_messages`），由 AI **从零设计**、将 Markdown 排版为一份全新的精美完整 HTML（不参考任何旧报告）；AI 同时在 HTML 中内嵌 `<script type="application/json" id="report-data">` 提炼首页所需结构化数据（市场温度、主要指数、市场广度、主线、连板梯队、明日观察点），服务端解析后存于 `day.analysis` 供首页展示。AI 未启用、未配置或调用失败时回退到 `marked` 默认渲染，上传永不失败。上传密钥由服务端首次启动时自动生成并保存在 PostgreSQL `app_settings.upload_key`，在后台“上传密钥”页面查看或重新生成。后台“报告上传”页面可手动保存同一格式的 Markdown，与外部分析接口共用同一处理机制（`applyReport`）。`.agents/skills/` 仅作为外部分析服务编写报告与平台 UI 开发的参考基线，不会被平台运行时加载。
