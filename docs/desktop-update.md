# 桌面版在线升级

## 工作方式

桌面端从 `https://dailystock.zhicha.io/updates/latest.json` 获取升级清单。应用启动 15 秒后自动检查，之后每 6 小时检查一次；设置页也可手动检查。

发现更高版本后，应用按当前进程架构选择 `x64` 或 `ia32` 安装包，下载到 Electron `userData/updates/`。文件大小和 SHA-256 均与清单一致后才允许升级。用户确认后，应用以 NSIS 静默模式启动现有覆盖安装器并退出。SQLite 数据库、设置、行情快照和历史复盘不在安装目录内，因此升级不会删除用户数据。

当前 `v0.2.1` 不包含更新器。用户需要手工安装一次首个包含更新器的版本，此后的版本才能在线升级。

## 官网目录

```text
src/web/public/updates/
├── latest.json
└── files/
    ├── hangqing-desktop-<version>-win-x64-setup.exe
    └── hangqing-desktop-<version>-win-ia32-setup.exe
```

安装包不提交到 Git。官网服务对清单返回 `Cache-Control: no-store`，对带版本号的安装包返回长期不可变缓存，并使用文件流响应。

## 发布顺序

1. 按桌面发布规范构建并校验 x64、ia32 安装包。
2. 在 `src/desktop/` 运行 `npm run updates:manifest`，由最终安装包生成大小和 SHA-256。
3. 将两个安装包上传到生产官网的 `/updates/files/`，不覆盖旧版本文件。
4. 通过 HTTPS 下载并复核两个生产文件的大小和 SHA-256。
5. 最后原子替换生产 `/updates/latest.json`，再用桌面端手动检查更新验收。
6. GitHub Release 和官网升级文件应使用同一批构建产物。

不得先发布清单再上传文件，否则客户端会看到无法下载的新版本。回滚时只需把 `latest.json` 恢复到上一版本；已经下载的错误文件不得复用原文件名。

## 清单字段

- `version`：严格的语义版本号。
- `publishedAt`：ISO 8601 发布时间。
- `notes`：设置页展示的简短变更列表。
- `assets.x64` / `assets.ia32`：HTTPS 地址、字节数和 SHA-256。

更新清单与安装包必须通过 HTTPS 提供。当前安装包尚未代码签名，SHA-256 只能验证文件与官网清单一致；正式扩大分发前仍建议购买 Windows 代码签名证书。
