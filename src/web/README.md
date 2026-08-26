# 行情日报桌面版官网

Web 端当前只提供行情日报 Windows Desktop 的官网页面：介绍桌面版功能、展示产品工作方式、提供安装包下载入口和免责声明。桌面版是当前主产品，官网不承载行情采集、报告服务、后台管理、邮件订阅或用户数据。

官网同时托管桌面端在线升级清单 `/updates/latest.json` 与不可变升级文件 `/updates/files/*.exe`。发布时必须先上传两个架构的安装包，再原子替换 `latest.json`；清单中的文件大小与 SHA-256 必须来自最终上传文件。

## 启动

```powershell
cd src/web
npm install
npm run build
node server/index.js
```

打开 `http://localhost:3000`。

## 未来 App 端

`src/app/` 目前只是移动端工程占位。未来若启动 App 端开发，将单独确定平台、技术栈、数据访问、同步、离线、通知和发布策略，不直接依赖桌面端 Electron 主进程或本地 HTTP 服务。
