# Admin Web 云端部署

Admin 控制台是 Vite + Vue 纯静态前端，构建产物位于 `admin-web/dist`。当前推荐部署到腾讯云 CloudBase 静态网站托管，不需要额外租 CVM 或轻量服务器。

## 当前生产入口

当前可直接访问的 Admin 生产入口：

```text
https://admin.tinghai.xin/login
```

这套入口部署在阿里云香港服务器上，域名与 HTTPS 已经打通：

- 域名：`admin.tinghai.xin`
- DNS：阿里云云解析，`admin` A 记录指向 `47.243.8.96`
- 服务器：阿里云香港，公网 IP `47.243.8.96`
- Web 服务：Nginx
- 静态目录：`/var/www/happyhome-admin/current`
- Nginx 站点配置：`/etc/nginx/sites-enabled/happyhome-admin`
- HTTPS：Let's Encrypt / Certbot，证书名 `admin.tinghai.xin`
- 证书路径：`/etc/letsencrypt/live/admin.tinghai.xin/fullchain.pem`
- 私钥路径：`/etc/letsencrypt/live/admin.tinghai.xin/privkey.pem`

常用只读核对命令：

```bash
curl -I https://admin.tinghai.xin/login
sudo nginx -t
sudo certbot certificates
systemctl status nginx --no-pager -l
```

证书自动续期由 `certbot.timer` 管理。上线后已验证过：

```bash
sudo certbot renew --dry-run --no-random-sleep-on-renew
```

如果未来 HTTPS 异常，优先检查：

1. `admin.tinghai.xin` 是否仍解析到 `47.243.8.96`
2. `sudo nginx -t` 是否通过
3. `sudo certbot certificates` 中 `admin.tinghai.xin` 是否存在且未过期
4. `curl -I http://admin.tinghai.xin` 是否 301 到 HTTPS
5. `curl -I https://admin.tinghai.xin/login` 是否 200

## 阿里云服务器代理注意事项

服务器上安装了 `mihomo.service`，用于本机显式代理。当前稳态配置是：

- `mihomo.service` 开机自启，进程命令：`/usr/local/bin/mihomo -d /etc/mihomo`
- 配置目录：`/etc/mihomo`
- 配置文件：`/etc/mihomo/config.yaml`
- 本机代理端口：`127.0.0.1:7890`
- 控制端口：`127.0.0.1:9090`
- `mode: rule`
- `tun.enable: false`
- 最后一条规则：`MATCH,默认节点`

不要随手开启 TUN。之前 TUN 模式会创建 `Meta` 网卡并接管 DNS，把系统解析导到 `198.18.0.2` / fake-ip，导致 `apt`、`certbot`、规则更新等系统任务超时。当前方案是业务服务器稳定优先：系统默认直连；只有明确需要外网代理的命令才显式使用 `127.0.0.1:7890`。

显式代理示例：

```bash
curl -x http://127.0.0.1:7890 -I https://www.google.com
curl -x http://127.0.0.1:7890 -I https://github.com
```

如果有人改动了 `mihomo`，改完后至少验证：

```bash
sudo /usr/local/bin/mihomo -t -d /etc/mihomo
sudo systemctl restart mihomo.service
systemctl status mihomo.service --no-pager -l
ip link show Meta || true
resolvectl status
apt-get update -qq
sudo certbot renew --dry-run --no-random-sleep-on-renew
curl -I https://admin.tinghai.xin/login
curl -x http://127.0.0.1:7890 -I https://github.com
```

预期状态：

- `Meta` 网卡不存在
- 默认路由只走 `eth0`
- `resolvectl status` 中 DNS 主要来自阿里云内网 DNS，例如 `100.100.2.136` / `100.100.2.138`
- `127.0.0.1:7890` 仍可用于显式代理
- `apt` 与 `certbot renew --dry-run` 不依赖代理也能通过

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
