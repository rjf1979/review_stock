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

## Web 官网边界

`src/web/` 当前只维护桌面版官网：展示 Windows Desktop 的产品定位、功能、下载入口和免责声明。官网不承载行情采集、报告上传、AI 排版、后台管理、邮件订阅或用户数据；这些内容不应重新加入 Web 端。`src/app/` 仅作为未来 App 端的独立工程占位，不直接依赖 Electron 桌面端。
