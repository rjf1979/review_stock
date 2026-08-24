# 行情日报 Desktop 安装与本地数据说明

## 普通用户

正式发布的安装包应内置 Electron、Node 运行时和桌面端取数服务，用户不需要单独安装 Node.js、npm、PostgreSQL 或 SQLite 服务。

首次启动需要：

1. 从官网获取对应系统的安装包。
2. 允许软件访问互联网。行情数据由软件在本机访问公开数据源获取，不经过平台服务器中转。
3. 首次连接完成后再使用实时行情、自选股和每日复盘。

软件不要求注册账号。自选股、主题、刷新频率、通知设置和本地复盘归档均属于当前操作系统用户，不同 Windows/macOS 用户互不共享。

## 本地数据库

桌面版正式数据层使用 SQLite，数据库文件放在 Electron 的用户数据目录：

```text
<Electron userData>/hangqing.sqlite
```

数据库用于保存：

- `settings`：主题、刷新频率、通知等设置
- `watchlist`：自选股
- `market_snapshots`：最近一次成功行情快照，供闭市和短暂断网时展示
- `reviews`：本地复盘索引与 Markdown 文件位置
- `schema_meta`：数据库版本与迁移记录

应用不依赖用户手动启动数据库服务。数据库文件只允许当前用户访问，升级时先执行迁移，再保留旧数据备份。

当前实现使用 `sql.js` WASM 运行 SQLite，避免 Electron 原生模块在 Windows/macOS 安装时要求用户准备 C++ 编译环境。数据量增长到需要高频写入或复杂查询时，再评估切换到经过 Electron 打包验证的原生 SQLite 驱动。

## 原型版与开发环境

当前 Electron 原型仍使用浏览器 `localStorage`、`desktop-state.json` 和 `reviews/` 目录。迁移到 SQLite 时必须提供一次性导入：

- `hq_watch` → `watchlist`
- `hq_theme`、`hq_refresh`、`hq_notify` → `settings`
- `desktop-state.json` → `settings`
- `reviews/*.md` → `reviews`

开发者运行原型需要 Node.js、npm 和项目依赖；这不应出现在普通用户安装引导中。

## 故障处理

- 无法连接：检查网络、防火墙和代理，使用页面中的“重新连接”。
- 数据库损坏：退出程序后备份并重命名 `hangqing.sqlite`，由应用从可用快照或迁移备份恢复；不得直接删除用户数据。
- 卸载程序：默认不删除用户数据，用户可在设置中主动清理本地数据。
