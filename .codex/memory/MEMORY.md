# 项目记忆 · 行情日报

## 架构与边界
- 子项目独立开发、验证与发布：`src/desktop`、`src/web`、`src/app_flutter`、`src/mapi`、`src/stock-sentinel-ai` 均不得因默认改动而互相影响；跨项目共享契约或依赖须显式说明并单独验证。
- 官网只展示 Windows Desktop 的定位、功能、下载和免责声明；不承载行情采集、后台或用户数据。桌面端本地优先，数据存 Electron `userData` SQLite。
- 行情使用公开数据与确定性计算；历史缺失必须标注，不输出交易指令或收益承诺。

## 当前状态
- 桌面、官网和 mapi 已有线上发布链路；发布前构建、上传与 SHA-256 校验，最后切换升级清单。凭据只保存在本地忽略配置。
- Flutter App 已完成核心行情、历史、复盘和自选能力，仍需真机回归。
- Flutter 使用国内镜像：`PUB_HOSTED_URL=https://pub.flutter-io.cn`，`FLUTTER_STORAGE_BASE_URL=https://storage.flutter-io.cn`。

## stock-sentinel-ai
- 前端以 `frontend/index.html` 的语义 token、响应式断点、焦点环和红涨青跌体系为基线；`--down` 当前为青色。
- 专业操盘 Prompt 唯一来源为运行时 SQLite `ai_prompt_configs(id=1)`；前端清空后读取 `/api/ai/prompt`，失败明确报错，不使用 fallback。
- 全市扫描改造方案在 `docs/market-regime-scan-v1.md`，开发计划在 `docs/market-regime-scan-development-plan-v1.md`；均为待实施设计，不能提前写入生产文案。
