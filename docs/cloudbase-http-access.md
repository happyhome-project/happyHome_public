# CloudBase HTTP 访问服务 —— 知识更新

> 基于 https://docs.cloudbase.net/cloud-function/quick-start 和 https://docs.cloudbase.net/cli-v1/functions/deploy 学习整理

---

## 背景问题

Admin Web 是浏览器应用，无法使用微信 SDK 直接调云函数。需要通过 HTTP 调用 admin 云函数。

有两种方式：

| 方式 | 说明 | 需要 access_token |
|------|------|-----------------|
| 微信 Server API | POST https://api.weixin.qq.com/tcb/invokecloudfunction?access_token=... | ✅ 是（麻烦） |
| CloudBase HTTP 访问服务 | 直接 HTTP URL，Bearer token 鉴权 | ❌ 不需要 |

**结论：应使用 CloudBase HTTP 访问服务，不需要 AppSecret。**

---

## CloudBase HTTP 访问服务

CloudBase 支持给云函数开启"HTTP 访问服务"，开启后函数获得一个公开 HTTP URL：

```
https://<envId>.ap-shanghai.app.tcloudbase.com/<functionName>
```

示例（请替换为控制台生成的实际 URL）：
```
https://<env-id>-<uin>.ap-shanghai.app.tcloudbase.com/admin
```

- 请求直接到达云函数，`event.httpMethod`、`event.headers`、`event.body` 均有值
- 函数内部自行验证身份（`Authorization: Bearer <token>`，由 `ADMIN_TOKEN` 环境变量控制）
- **不需要** WeChat access_token，也不需要额外网关

---

## 开启方式（腾讯云控制台）

### 方法一：控制台操作（推荐）

1. 进入 [腾讯云 CloudBase 控制台](https://console.cloud.tencent.com/tcb)
2. 选择环境 `cloudbase-3gh862acb1505ff3`
3. 左侧菜单 → **云函数**
4. 点击 `admin` 函数名进入详情
5. 找到 **"HTTP访问服务"** 标签页或配置项
6. 开启 HTTP 访问，记录生成的 URL

### 方法二：tcb CLI 部署（如果控制台找不到入口）

```bash
# 安装 CloudBase CLI
npm install -g @cloudbase/cli

# 登录（会打开浏览器授权）
tcb login

# 重新部署 admin 为 HTTP 函数
# 注意：函数类型不能更改，需要先删除再重建
tcb fn delete admin --env cloudbase-3gh862acb1505ff3
tcb fn deploy --httpFn admin --env cloudbase-3gh862acb1505ff3
```

---

## 开启后配置 Admin Web

在 `admin-web/.env.local` 中设置（至少）：

```env
VITE_CLOUD_API_URL=https://<env-id>-<uin>.ap-shanghai.app.tcloudbase.com
```

建议同时配置：

```env
VITE_ADMIN_USERNAME=admin
VITE_ADMIN_PASSWORD=<local-admin-password>
VITE_ADMIN_TOKEN=your_admin_token
```

并在 `admin` 云函数环境变量中设置同一个 `ADMIN_TOKEN`。

Admin Web 的 `callAdmin` 函数会调用 `${BASE_URL}/admin`，路径即为函数名。

---

## 注意：函数类型限制

> CloudBase 规定：**函数类型（普通 vs HTTP）创建后不可更改。**

如果当前 admin 函数是普通类型，需要：
1. 在控制台或 CLI 删除现有 admin 函数
2. 重新部署为 HTTP 类型

HTTP 类型函数的代码结构与普通函数相同，入口仍是 `exports.main`，但事件结构包含 `httpMethod`/`headers`/`body`。我们的 admin/index.ts 已经正确处理了这两种情况。

---

## 关于 tcb CLI vs miniprogram-ci

| 工具 | 用途 |
|------|------|
| `miniprogram-ci` | 上传小程序代码、云函数到微信后台 |
| `@cloudbase/cli` (tcb) | 管理 CloudBase 环境（HTTP函数、环境变量、数据库等） |

两者可以管理同一个 CloudBase 环境，功能互补。
