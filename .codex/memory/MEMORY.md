# 项目记忆 · 行情日报

## 架构与数据
- `src/desktop/` 是主产品；`src/web/` 只提供官网、下载和升级清单；`src/app/` 是独立移动端 uni-app(Vue3) 工程。
- 所有设置、自选股、复盘和龙虎榜快照都在 Electron `userData` 目录下的 SQLite，本地优先且不经云端账号。
- 内部包名与 Windows AppUserModelId 必须保持 `hangqing-desktop` / `io.zhicha.dailystock`，否则 Electron 会切换 userData 目录，造成旧数据看似消失；对外可执行文件名为 `StockPulse.exe`。

## 当前开发状态（2026-08-29）
- `0.3.6` 已发布 x64/ia32：更新检查周期从 6 小时调整为 2 小时，启动后延迟 1 分钟自动检查；官网下载页与升级清单同步到 `0.3.6`。
- 构建链路：`npm run dist` 产出 `win-unpacked` 与 `win-ia32-unpacked` 后，需用 electron-builder 缓存中的 `makensis.exe` 分别以 `-DBUILD_ARCH=x64/ia32` 编译 `installer.nsi` 生成 `-setup.exe`。
- 官网升级清单与下载页均为 `0.3.6` 双架构；GitHub Release `v0.3.6` 已上传两个安装包，SHA-256 与本地及 OSS 一致。

## 升级清单在线发布
- 安装包（x64/ia32 `-setup.exe`）永远只托管在阿里云 OSS（`oss.askcode.cn/files/`）与 GitHub Release；官网服务器不挂载 `.exe`。
- 线上升级清单位于云服务器 `/var/www/dailystock-updates/latest.json`，通过 SSH 主机别名 `zhicha-vps`（`~/.ssh/config` 已配置密钥 `zhicha_vps_ed25519`）访问，域名 `dailystock.zhicha.io` 走 Cloudflare。
- 发布手法：`scp src/web/public/updates/latest.json zhicha-vps:/var/www/dailystock-updates/latest.json.tmp-0.3.6`，再在服务器 `cp latest.json latest.json.bak-<时间戳>`、`mv latest.json.tmp-* latest.json` 原子替换；公网回读 `https://dailystock.zhicha.io/updates/latest.json` 校验 version/URL/SHA。
- 坑：本地 PowerShell `Invoke-WebRequest` 会把 UTF-8 中文显示成乱码，属显示问题；用 `curl` 落盘后 `node -e JSON.parse(readFileSync(...,'utf8'))` 校验即正确。远程命令不要内联 `$(date ...)`，PowerShell 会错误展开，应把远程命令放进单引号变量传给 ssh。

## 手机端 + 云端行情 API（2026-08-29 骨架）
- `src/app/` 为 uni-app(Vue3) 移动端，照搬 PC 7 视图（实时/自选/K线/大盘/复盘/龙虎榜/历史/设置），走 `src/api/` 封装 `uni.request`，构建 `npm run build:h5` 通过。
- 采集仍由 PC 完成：`src/desktop/cloud-upload.js`（`setConfig`/指数退避重试）在 `server.js` 的 `createCloudPush` 中被调用，实时/复盘/龙虎榜/自选报价/K线/心跳异步 POST 到云端；实时与报价 60s 节流，失败仅记录不阻塞 UI。
- 云端服务 `src/mapi/server.js`：写端 `/collect/*` 需 `X-Upload-Token`，读端 `/api/*` 只读下发；JSON 落盘 `data/`，含 `stale` 标记（`MAPI_STALE_MS` 默认 10 分钟）。未授权写返回 401 且不落盘。
- 桌面设置页新增云同步三项：`cloud_enabled`/`cloud_url`/`cloud_token`；接口契约与流程图见 `docs/mobile-architecture.md`。
- 待办：把 mapi 部署到 VPS（nginx 反代 `mapi.zhicha.io`，token 从 `.env` 读），及移动端真机打包联调。

## App 端众包采集方案（2026-08-29 定稿；Phase 1/2/5 + Flutter 骨架/7页已开发并单测通过）
- 移动端技术栈改为 **Flutter**（`src/app_flutter/`，已 `flutter create` + analyze 零问题 + test 7/7 + Chrome 运行）；采集从「PC 唯一」改为「多设备众包」，诉求「谁先采集谁先共享」，用 OSS + 独立 API 实现。
- 后端 `src/mapi/`（file/cloud 双模式）已实现：`keys`/`validate`/`rateLimit`/`auth`/`db`/`oss`/`claim` + `schema.sql`；`npm test` 22/22 通过。要点：去重键=数据逻辑身份；槽位认领(first-writer-wins, PG `ON CONFLICT`)+头指针(freshest-wins 单调守卫)；OSS AK/SK 只在服务端、客户端只拿 Device Token、读走 CDN。
- PC 端已接入设备鉴权（`cloud-upload.js` 懒注册 Bearer + `storage` 持久化 device id/token），桌面测试通过。
- 主题皮肤明暗两套已对齐 PC 版（`AppPalette`，红涨绿跌用 PC red/green）；K线图标用 koboyo 手绘 candlestick SVG 重上色（`.runtime/icon_dark.png`/`icon_white.png`），未接入 App 图标。
- **部署目标**：独立行情 API 在 `api.dailystock.askcode.cn`（`47.92.170.168`，自带 PG）；SSH 候选 `~/.ssh/deploy_market_daily`（config 无别名，需补）。
- **决策（明天执行）**：采集方=PC+移动端，**默认分享、无用户开关**。明天①部署 mapi 到 api.dailystock.askcode.cn；②PC 默认分享+去开关（storage `cloud_enabled:true`、内置默认 cloud_url、设置页移除云同步控件）。执行清单见 `docs/app-deploy-plan.md`；当日记录见 `2026-08-29.md`。
- **进展（2026-08-30）**：已提交并推送骨架（`161041c`）与 PC 默认分享去开关（`363060c`；含 cloud-upload 默认设备注册测试 + storage 默认分享断言，npm test/check 通过）。**②已落地，①部署仍阻塞**：缺 `api.dailystock.askcode.cn` 的 SSH 账号/端口、PG 连接与域名 SSL/DNS 状态；待补后按 `docs/app-deploy-plan.md` §三执行。

## 网络配置：GitHub 稳定访问
- 本机 `github.com` 曾偶发解析到不稳的亚太节点（`20.205.243.166`），导致 `git push` 超时；`gh` 走 `api.github.com` 正常。`github.com` 是 git 智能 HTTP 唯一端点，`github.com:443` 波动时 git 会卡。
- 已用 hosts 固定 GitHub 到实测可达 IP：`github.com=140.82.112.3`、`api.github.com=140.82.112.6`、`raw/objects/avatars/codeload.githubusercontent.com=185.199.109.133`；并配置 git 全局 `http.version=HTTP/1.1`、`http.postBuffer=524288000`、`core.compression=9`、慢速超时重试。
- 一键脚本在 `.deploy/`（已被 .gitignore 忽略）：管理员运行 `Set-GitHubHosts.ps1`（自动备份并刷新 DNS），回退用 `Restore-GitHubHosts.ps1`；条目源在 `github-hosts-entries.txt`，换节点改它重跑即可。
- 写入 hosts 需管理员权限；普通权限会提示失败，需手动 UAC。备份为 `hosts.codex-backup-<时间戳>`。

## 发布与风险
- 升级清单必须在两种架构安装包上传、公开回读和 SHA-256 校验后最后原子切换；未签名安装包可能触发 Windows 提示。
- 行情只使用公开接口与确定性计算，历史字段缺失时明确标注，不以当前行情代替历史数据。
