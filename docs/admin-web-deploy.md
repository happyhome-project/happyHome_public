# Admin Web 云端部署

Admin 控制台是 Vite + Vue 纯静态前端，构建产物位于 `admin-web/dist`。当前推荐部署到腾讯云 CloudBase 静态网站托管，不需要额外租 CVM 或轻量服务器。

## 当前上线方式

```powershell
npm.cmd run deploy:admin-web
```

该命令会执行：

1. 构建 `admin-web`
2. 将 `admin-web/dist` 上传到 CloudBase 静态网站托管根目录
3. 默认使用 hash 路由构建线上临时后台，入口形如 `/#/login`

默认 CloudBase 环境：

```text
cloudbase-3gh862acb1505ff3
```

默认 Admin API 地址：

```text
https://cloudbase-3gh862acb1505ff3-1307183045.ap-shanghai.app.tcloudbase.com
```

如需覆盖 API 地址：

```powershell
$env:VITE_CLOUD_API_URL="https://your-cloudbase-http-domain"
npm.cmd run deploy:admin-web
```

如已在 CloudBase 静态托管里配置 SPA fallback，可切回 history 路由构建：

```powershell
$env:VITE_ROUTER_MODE="history"
npm.cmd run deploy:admin-web
```

如需上传到静态托管子路径：

```powershell
$env:ADMIN_WEB_CLOUD_PATH="/admin"
npm.cmd run deploy:admin-web
```

## 前置条件

- 腾讯云 CloudBase 环境已开通静态网站托管。
- 本机 CloudBase CLI 已登录腾讯云账号；脚本通过 `npx.cmd --yes @cloudbase/cli ...` 调用 CLI。
- `admin` 云函数已开启 HTTP 访问服务，并且 `VITE_CLOUD_API_URL/admin` 可访问。
- `admin` 云函数环境变量中的 `ADMIN_TOKEN` 与前端构建时的 `VITE_ADMIN_TOKEN` 一致。

## SPA 路由设置

本地开发默认使用 Vue Router history 模式。CloudBase 静态托管如果没有错误文档配置，直接访问 `/communities`、`/members/:communityId` 会 404。因此当前部署脚本默认用 hash 路由上线，访问路径为 `/#/login`、`/#/communities`。

如果要使用无 `#` 的正式 URL，必须在 CloudBase 静态网站托管设置里将错误页面或回退页面配置为：

```text
index.html
```

配置完成后，再用 `VITE_ROUTER_MODE=history` 重新部署。

## 临时认证风险

当前 Admin Web 仍使用前端内置账号、密码和 token：

```text
VITE_ADMIN_USERNAME
VITE_ADMIN_PASSWORD
VITE_ADMIN_TOKEN
```

所有 `VITE_*` 变量都会在构建时进入前端 JS 包，因此这套方式只适合临时内测。公网生产前应切换到后端登录/session 机制，避免把固定管理 token 暴露给浏览器。

## 验收清单

部署后至少检查：

- 打开静态托管访问地址，浏览器页签显示 `社区后台`。
- `/#/login` 可访问并可登录。
- `/#/communities`、`/#/members/:communityId` 刷新不白屏。
- 社区列表、成员管理、板块管理、帖子管理都能打开并调用云端 `admin` HTTP 函数。
- 退出登录或 token 失效时能回到登录页。
