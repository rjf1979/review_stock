# 项目记忆 · 行情日报

## 架构
- 桌面版在 `src/desktop/`，官网在 `src/web/`，唯一移动端为 `src/app_flutter/`；早期 uni-app 已移除。官网只承载产品展示和 Windows 下载，不放采集、后台或订阅。
- 桌面数据存 Electron `userData` SQLite，本地优先；内部包名/AppUserModelId 保持 `hangqing-desktop` / `io.zhicha.dailystock`，对外程序名 `StockPulse.exe`。
- 行情只使用公开接口和确定性计算；历史缺失要标注，不上引、不给买卖建议。

## 当前状态（2026-09-01）
- 桌面 v0.3.9 已发布 x64/ia32，实时盘口优化、OSS/GitHub/升级清单一致；默认分享云端行情且无云同步开关。
- 官网和「统一安装应用」已上线：release `20260901-132042`，助手 OSS/GitHub 资产校验一致，升级清单为 0.3.9。
- mapi 已上线 `api.dailystock.askcode.cn`，systemd 服务 `hangqing-mapi`，SSH 别名 `api-dailystock`，最新 release `20260831132759`。
- 官网 Node 只监听 `127.0.0.1:3002`，目录 `/var/www/dailystock`，升级清单 `/var/www/dailystock-updates/latest.json`，SSH 别名 `zhicha-vps`。
- App 已完成桌面一致图标、线上行情契约、自选众包补数、龙虎榜回退、设置分区、5–60 秒刷新选择和午间快照保护；真机已验证。

## 发布与风险
- 发布必须先构建/上传/SHA 校验/公开回读，最后原子切换升级清单；未签名安装包可能触发系统提示。
- GitHub 偶发不稳时可用项目 `.deploy/` hosts 脚本；凭据只放本地忽略文件，不写入源码和聊天。
- Flutter 使用国内镜像：`PUB_HOSTED_URL=https://pub.flutter-io.cn`，`FLUTTER_STORAGE_BASE_URL=https://storage.flutter-io.cn`。
