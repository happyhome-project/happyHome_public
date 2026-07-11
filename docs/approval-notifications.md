# 审批提醒配置

HappyHome 第一版审批提醒采用“Admin Web 待办中心 + 小程序订阅消息”：

- 成员加入申请：通知本社区 active 管理员和 superAdmin。
- 社区创建申请：通知 superAdmin。
- 订阅消息只能发给已绑定微信、并且在小程序里点过“接收审批提醒”的管理员。

## 1. 微信公众平台模板

在微信公众平台进入：小程序后台 -> 功能 -> 订阅消息。

也可以走 API 自动化。先发现当前小程序类目和可用模板标题：

```bash
npm run configure:approval-templates -- discover
```

查看某个模板标题的关键词：

```bash
npm run configure:approval-templates -- discover --keywords-tid=模板标题ID
```

确认 `tid` 和 `kid` 后，可以直接添加到个人模板库并同步云函数 env：

```bash
npm run configure:approval-templates -- add ^
  --member-tid=成员模板标题ID --member-kids=1,2,3 --member-map=communityName,action,time ^
  --community-tid=社区模板标题ID --community-kids=1,2,3,4 --community-map=communityName,action,time,status
```

该脚本会从 `admin` 云函数 env 读取 `WX_APPID` / `WX_APPSECRET`，因此不会把 AppSecret 写入仓库。若微信接口返回 IP 白名单错误，需要先在微信公众平台把当前执行机器公网 IP 加入白名单。
脚本会按 `kid` 的 rule 和顺序自动推导发送字段，例如第 3 个关键词 rule 是 `date`，字段 key 会配置成 `date3`。

建议准备两个一次性订阅模板：

| 用途 | 建议模板标题 | 字段顺序 | 字段类型 |
|---|---|---|---|
| 成员加入申请 | 成员加入申请提醒 | 社区名称、提醒事项、申请时间、状态 | thing、thing、time、phrase |
| 社区创建申请 | 社区创建申请提醒 | 社区名称、提醒事项、申请时间、状态 | thing、thing、time、phrase |

如果平台模板库给出的字段 key 正好是 `thing1`、`thing2`、`time3`、`phrase4`，可以直接使用默认映射。

如果字段 key 不一致，记录实际 key，按下面 JSON 配置。`status` 可省略，适用于模板没有状态字段的情况：

```env
APPROVAL_MEMBER_JOIN_TEMPLATE_FIELDS={"communityName":"thing1","action":"thing2","time":"time3","status":"phrase4"}
APPROVAL_COMMUNITY_CREATE_TEMPLATE_FIELDS={"communityName":"thing1","action":"thing2","time":"time3","status":"phrase4"}
```

字段含义固定：

| 映射名 | 发送内容 |
|---|---|
| `communityName` | 社区名称 |
| `action` | `成员加入申请` 或 `新社区待审批` |
| `time` | 申请创建时间 |
| `status` | `待审批` |

## 2. 云函数环境变量

订阅消息是在申请发生时发送，所以模板环境变量要配置到触发申请的函数：

- `member` 云函数：成员加入申请模板。
- `community` 云函数：社区创建申请模板。

把模板 ID 写到 `~/.happyhome/cam.env` 或当前 shell 环境：

```env
APPROVAL_MEMBER_JOIN_TEMPLATE_ID=成员加入申请模板ID
APPROVAL_COMMUNITY_CREATE_TEMPLATE_ID=社区创建申请模板ID
APPROVAL_MEMBER_JOIN_TEMPLATE_FIELDS={"communityName":"thing1","action":"thing2","time":"time3","status":"phrase4"}
APPROVAL_COMMUNITY_CREATE_TEMPLATE_FIELDS={"communityName":"thing1","action":"thing2","time":"time3","status":"phrase4"}
```

同步到 CloudBase：

```bash
npm run update:approval-env
```

同步后重新部署相关云函数：

```bash
npm run deploy:cloud -- --only=member,community
```

## 3. 小程序构建环境变量

小程序前端需要同样的模板 ID，才能调用 `wx.requestSubscribeMessage` 弹出授权面板：

```env
VITE_APPROVAL_MEMBER_JOIN_TEMPLATE_ID=成员加入申请模板ID
VITE_APPROVAL_COMMUNITY_CREATE_TEMPLATE_ID=社区创建申请模板ID
```

配置后可在当前功能分支做组件级开发验证：

```bash
npm --workspace miniprogram run type-check
npm --workspace miniprogram run build:mp-weixin
```

跨组件正式发布、上传、体验版选择和证据要求统一见 [`release-gate.md`](./release-gate.md)；本文只维护审批提醒配置与功能验收。

## 4. 验收路径

1. 管理员登录小程序，进入“我的”，点击“接收审批提醒”。
2. 用未加入用户申请加入审批制社区。
3. 确认对应管理员收到服务通知；如果没收到，先看 `admin_notifications` 集合：
   - `template_not_configured`：云函数 env 没配或未冷启动。
   - `not_subscribed`：管理员没有授权订阅。
   - `subscribe_api_unavailable`：当前云函数运行环境不支持云调用发送。
   - `failed`：看 `reason` 中的微信错误码，常见是字段 key 与模板不匹配。

## 5. 平台边界

一次性订阅消息不是长期无限推送。管理员每次授权后通常只保证一次下发机会；若需要更稳定触达，后续再评估公众号/服务号方案。

## 6. 当前小程序类目的可用候选

2026-06-01 通过 `configure:approval-templates discover` 验证，当前小程序类目包括：`物业管理`、`住宿服务`、`投票`、`信息查询`。

推荐第一版统一使用 `任务接收通知`，把两类审批都表达成“后台待办任务”：

```bash
npm run configure:approval-templates -- add ^
  --member-tid=802 --member-kids=3,4,2,12 --member-map=communityName,action,time,status ^
  --community-tid=802 --community-kids=3,4,2,12 --community-map=communityName,action,time,status
```

对应含义：

| 事件 | 模板 | 字段映射 |
|---|---|---|
| 成员加入申请 | 任务接收通知 | 任务标题=社区名，任务内容=成员加入申请，发布时间=申请时间，任务状态=待处理 |
| 社区创建申请 | 任务接收通知 | 任务标题=社区名，任务内容=新社区待审批，发布时间=创建时间，任务状态=待处理 |

这个模板不是“审批提醒”专用模板，但比“活动成员变更申请提醒”或“访客审批通知”更中性、更适合统一表达后台待办。如果后续微信后台能申请到更贴切的模板标题，再用新的 `tid/kid` 替换即可。
