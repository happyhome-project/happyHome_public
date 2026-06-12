# 小程序数据预拉取配置说明

HappyHome 首页支持微信官方“数据预拉取”。代码路径已经具备兜底：

1. 微信预拉取命中：启动时直接使用预拉取快照。
2. 预拉取未命中：读取本地 6 小时短缓存。
3. 都没有：调用 `post.bootstrap` 拉取云端最新数据。

## 后台开启路径

微信公众平台：

`开发管理 -> 开发设置 -> 数据预加载 -> 开启`

官方文档：

- https://developers.weixin.qq.com/miniprogram/dev/framework/ability/pre-fetch.html
- https://developers.weixin.qq.com/miniprogram/dev/api/storage/background-fetch/wx.getBackgroundFetchData.html

## 推荐配置：云开发

如果微信后台提供“开发者服务器 / 云开发”两个选项，优先选择“云开发”：

- 环境ID：`cloudbase-3gh862acb1505ff3`
- 函数名：`home-prefetch`

这条路径不需要配置业务域名，也不需要填写 HTTPS 地址。

## 备用配置：开发者服务器

如果必须走开发者服务器模式，则配置 CloudBase HTTP 访问地址，指向 `home-prefetch` 云函数。

当前环境基准域名：

`https://cloudbase-3gh862acb1505ff3-1307183045.ap-shanghai.app.tcloudbase.com`

当前已配置并验证的预拉取地址：

`https://cloudbase-3gh862acb1505ff3-1307183045.ap-shanghai.app.tcloudbase.com/home-prefetch`

不要使用 `http-gateway`，它是 H5/测试专用入口，需要 Bearer token 和 `x-test-openid`，不适合作为微信预拉取入口。

## Token 规则

- 小程序登录后，后端生成 `backgroundFetchToken`。
- 客户端调用 `wx.setBackgroundFetchToken({ token })`。
- 微信预拉取请求会带上 `token`。
- `home-prefetch` 只用 token 反查当前用户，并且只返回该用户 active 社区可见的首页快照。
- token 过期、无效、用户无 active 社区或快照超过 256KB 时，返回安全空快照，不返回成员内容。

## 灰度建议

首次开启建议使用灰度：

- 体验者灰度先验证预拉取是否命中。
- 确认真机首页无异常后再放大比例。
- 如果主体或后台只允许配置云开发环境，则按后台实际选项配置到 `home-prefetch` 所在云环境。

## 验收现象

- 命中预拉取或短缓存时，首页内容应在 1 秒内出现。
- 云端刷新完成后，首页内容会自动覆盖为最新。
- 用户退出社区或被移出社区后，旧缓存会被清空，并跳转到加入社区页。
