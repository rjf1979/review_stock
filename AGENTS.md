# 行情日报项目指令

## 项目 Skill

本项目将 2026-08-18 日报生成所用规则版本化在 `.agents/skills/`。处理相关任务时按以下方式加载：

- 行情采集、收盘分析、日报生成、补数或质量核验：必须使用 `.agents/skills/a-share-daily-review/SKILL.md`。
- A 股接口、字段映射、数据源故障或历史数据校验：同时使用 `.agents/skills/a-stock-data/SKILL.md`。
- 后台、HTML 报告、响应式、打印、可访问性或交互状态：必须使用 `.agents/skills/ui-ux-pro-max/SKILL.md`。
- 报告视觉改版或最终视觉复核：在 UI 工程基线之后使用 `.agents/skills/design-taste-frontend/SKILL.md`，但不得改变后台信息架构。

现有设计系统与 2026-08-18 报告基准优先。日报只依赖项目数据契约内字段，不引入额外榜单数据或提示词。

## 子项目独立开发

- 以下中文名称是后续开发指令中指定子项目的标准名称：

| 中文名称 | 子项目目录 | 项目定位 |
| --- | --- | --- |
| 股市脉搏桌面版 | `src/desktop/` | Windows Electron A 股行情与每日复盘工具 |
| 股市脉搏官网 | `src/web/` | Windows 桌面版产品官网与安装包下载入口 |
| 股市脉搏 App | `src/app_flutter/` | Flutter 移动端行情应用 |
| 股市脉搏云端行情 API | `src/mapi/` | 众包采集与云端行情 HTTP 服务 |
| 智诊盯盘 | `src/stock-sentinel-ai/` | AI 辅助诊股与自选盯盘工具 |

- 收到上述中文名称时，将其视为对应目录的明确开发范围；每次任务只在目标子项目内规划、开发、测试和发布。
- 不得因默认实现、共享名称或相似功能修改其他子项目的代码、依赖、配置、构建脚本、文案或发布产物。
- 若任务确实需要跨子项目共享数据契约、接口、资产或发布配置，必须明确列出受影响子项目、兼容策略和各自验证项；完成前分别运行对应检查。
- 新功能的方案、开发计划、风险和验收文档优先保存在目标子项目的 `docs/`，不得把一个子项目的待实施能力提前写入其他子项目的生产界面或说明。

## 桌面版发布

每次发布 Windows 桌面版必须作为一次完整发布链路执行，不得只更新其中一项：

1. 先同步更新 `src/desktop/package.json`、`src/desktop/package-lock.json` 与 `src/desktop/installer.nsi` 中的版本号。
2. 构建并校验同一版本的 `x64` 与 `ia32` Windows 安装包，产物命名为 `hangqing-desktop-<version>-win-x64-setup.exe` 和 `hangqing-desktop-<version>-win-ia32-setup.exe`。
3. 在 GitHub Release 上传两个安装包，并记录对应的 SHA-256。
4. 更新根目录 `README.md` 的当前版本号和两种架构的 Release 下载链接；不得保留不存在的安装包链接。
5. 提交版本、README 与必要发布说明，并推送到远程 `main`；发布完成后核对 Release、资产和远程提交均可访问。

## Web 官网边界

`src/web/` 当前只维护桌面版官网：展示 Windows Desktop 的产品定位、功能、下载入口和免责声明。官网不承载行情采集、报告上传、AI 排版、后台管理、邮件订阅或用户数据；这些内容不应重新加入 Web 端。`src/app/` 仅作为未来 App 端的独立工程占位，不直接依赖 Electron 桌面端。

## 智诊盯盘 Web 端口

`src/stock-sentinel-ai/` 的本地 Web 服务及浏览验证端口固定为 `3110`。启动、调试、浏览器打开和验收时必须使用 `http://127.0.0.1:3110`；不得改用其他端口，也不得仅因端口占用而静默切换端口。端口被占用时，应先识别并处理占用该端口的旧版智诊盯盘服务，再在 `3110` 上启动当前版本。
