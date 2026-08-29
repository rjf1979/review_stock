# 项目记忆 · 行情日报

## 架构与数据
- `src/desktop/` 是主产品；`src/web/` 只提供官网、下载和升级清单；`src/app/` 是独立移动端占位。
- 所有设置、自选股、复盘和龙虎榜快照都在 Electron `userData` 目录下的 SQLite，本地优先且不经云端账号。
- 内部包名与 Windows AppUserModelId 必须保持 `hangqing-desktop` / `io.zhicha.dailystock`，否则 Electron 会切换 userData 目录，造成旧数据看似消失；对外可执行文件名为 `StockPulse.exe`。

## 当前开发状态（2026-08-29）
- `0.3.4` 已发布 x64/ia32：非交易日的每日复盘与龙虎榜默认解析为最近交易日；历史报告按日期汇总“每日复盘”和“龙虎榜”，可分别打开。
- 新增 `dragon_snapshots` 本地表；每次成功加载龙虎榜即保存完整列表和席位明细，已有复盘数据不改写。
- 构建链路：`npm run dist` 产出 `win-unpacked` 与 `win-ia32-unpacked` 后，需用 electron-builder 缓存中的 `makensis.exe` 分别以 `-DBUILD_ARCH=x64/ia32` 编译 `installer.nsi` 生成 `-setup.exe`。
- 官网升级清单与下载页均为 `0.3.4` 双架构；GitHub Release `v0.3.4` 已上传两个安装包。

## 发布与风险
- 升级清单必须在两种架构安装包上传、公开回读和 SHA-256 校验后最后原子切换；未签名安装包可能触发 Windows 提示。
- 行情只使用公开接口与确定性计算，历史字段缺失时明确标注，不以当前行情代替历史数据。
