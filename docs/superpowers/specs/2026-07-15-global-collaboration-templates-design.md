# 全局协作板块设计

> **Historical / point-in-time:** 本规格记录 2026-07-15 已确认的全局协作板块设计，仅用于交付追溯，不覆盖后续实现、测试或发布治理决策。
> **当前权威 (Current authority):** 以[正式发布门禁](../../release-gate.md)、当前代码与测试为准。

## 目标

将实时协作从“每个社群各自维护 `section`”改为与沉淀区“发图文 / 写文字”一致的产品级固定发布类型：模板定义全局唯一，所有现有和未来社群立即共享，帖子仍归属于具体社群。

第一批全局协作板块只有：

1. `拼车出行`；
2. `出游邀约`。

沉淀区的图文、文字、历史内容和相关数据链路不在本次改动范围内。

## 已确认的产品规则

- 协作板块可以继续创建，但只有超级管理员可以创建、配置、启用或停用。
- 一次模板改动对所有社群生效，不生成逐社群模板副本。
- 普通成员不能进入 Web Admin；普通成员可在小程序编辑或删除自己的帖子。
- 社群管理员可在 Web Admin 管理自己负责社群的全部协作帖子，但不能修改全局模板。
- 超级管理员可管理全部社群的协作帖子和全局模板。
- 本次只清理实时协作数据；沉淀内容完全不动。
- 现有 `拼车出行`、`出游邀约` 帖子迁入新模型；其他实时协作板块及其帖子被删除。

## 选定方案

采用“全局模板 + 无 section 协作帖”。

不采用逐社群复制 `sections`，因为副本会漂移，更新无法原子覆盖所有社群，新社群还需要补发。也不把模板写死在客户端代码里，因为这会使超级管理员无法在后台创建板块。

## 数据模型

### `collaboration_templates`

新增全局集合，模板文档不包含 `communityId`。

```ts
interface CollaborationTemplate {
  _id: string
  systemKey: string
  name: string
  icon: string
  order: number
  status: 'active' | 'disabled'
  enableComment: boolean
  enableLike: boolean
  widgets: Widget[]
  protectedSystemKey?: boolean
  createdAt: string
  updatedAt: string
  createdByAccountId: string
  updatedByAccountId: string
}
```

约束：

- `systemKey` 全局唯一且创建后不可修改；
- `name` 在未删除模板中全局唯一；
- `carpool` 与 `activity_invite` 是受保护的系统键，不能通过普通管理操作删除或改键；
- 模板不复制到社群，新社群自动读取相同目录；
- `widgets[].widgetId` 是帖子内容的稳定存储键。

### `posts`

协作帖改为：

```ts
interface CollaborationPost extends Post {
  area: 'collaboration'
  communityId: string
  collaborationTemplateId: string
  collaborationSystemKey: string
  sectionId?: never
}
```

- `communityId` 继续决定内容归属和管理员权限；
- `collaborationTemplateId` 指向全局模板；
- `collaborationSystemKey` 作为稳定查询和故障恢复字段；
- 新协作帖不再写入 `sectionId`；
- 沉淀帖继续使用现有 `area: 'archive'` 与 `format`，不改变。

## 初始模板

### 拼车出行

固定键：`carpool`。

以明士班线上“拼车出行”的实际业务契约为基准，使用稳定控件键：

1. `carpool_origin`：出发地，短文本，必填，列表展示；
2. `carpool_destination`：目的地，短文本，必填，列表展示；
3. `carpool_departure_time`：出发时间，日期时间，必填，列表展示；
4. `carpool_seats`：空余座位，短文本，必填；
5. `carpool_contact`：联系人，短文本，必填；
6. `carpool_attendance`：上车，报名控件，非必填，并保留历史报名关系；
7. `carpool_location`：地图位置，位置控件，必填；
8. `carpool_note`：补充说明，`note_blocks`，非必填，不进入列表摘要，允许文字和图片。

迁移准备阶段必须只读核对线上明士班模板的完整控件数组，以及类型、标签、必填、列表展示和顺序约束。历史 `fieldKey` 是系统生成值，不作为业务语义或一致性条件；内容仍按旧 `widgetId` 映射到新稳定键。若其他线上定义与上述字段不一致，prepare 阶段停止并输出差异，不猜测后直接删除数据。

### 出游邀约

固定键：`activity_invite`。

沿用 `buildActivityInviteSectionWidgets()` 的现有契约：邀约主题、出发时间、集合地点、联系电话、人数上限、补充说明和报名控件。保留从沉淀帖详情发起出游邀约、来源帖子关联和报名能力。

## 服务端接口

新增独立的全局模板 API，不把它继续塞入社群级 `section.list`。

小程序云函数：

- `collaborationTemplate.listActive`：返回全部启用模板；
- `collaborationTemplate.get`：读取一个模板。

帖子云函数：

- `post.createCollaboration`；
- `post.listCollaboration`；
- 现有 `post.get/update/delete` 扩展为识别无 section 协作帖；
- 报名、点赞、评论和详情接口按帖子 `communityId` 与模板控件校验，不再读取 section。

Admin API：

- `collaborationTemplate.listAdmin`；
- `collaborationTemplate.createAdmin`；
- `collaborationTemplate.updateAdmin`；
- `collaborationTemplate.disableAdmin`；
- `collaborationTemplate.deleteAdmin`，仅允许删除无帖且非受保护模板；
- 现有帖子管理接口增加 `area=collaboration` 与 `collaborationTemplateId` 筛选。

所有模板写接口加入 `SUPER_ADMIN_ONLY`。协作帖子管理沿用实体到社群的权限解析：社群管理员只能操作自己管理的社群，超级管理员可操作所有社群。

## 模板修改安全

- 修改名称、图标、排序、评论/点赞设置直接全局生效；
- 增加非必填控件可直接生效；
- 删除控件、改变控件类型、改变 `widgetId`，或把非必填改成必填时，服务端先统计全部社群的受影响帖子；
- 存在不兼容历史内容时阻断普通更新，要求使用专门数据迁移；
- 有帖模板只能停用，不能从日常管理界面级联删除；
- 模板停用后不再出现在发布选择器中，已有帖子仍可查看和管理。

## 小程序体验

点击“加号”后仍显示“发图文 / 写文字 / 发起协作”。

进入“发起协作”后：

1. 获取全局启用模板；
2. 当前展示“拼车出行”和“出游邀约”；
3. 选中模板后按其 widgets 构造动态表单；
4. 提交 `communityId + collaborationTemplateId + content`；
5. 服务端验证有效社群成员身份、模板状态、必填值和云文件格式。

普通成员在小程序端继续只能编辑或删除自己的帖子。服务端按 `authorId` 校验，不能依赖按钮隐藏。

首页实时协作区改为按当前 `communityId` 查询 `area=collaboration` 的帖子，并按全局模板补充名称、图标和控件定义。详情页同样按模板渲染，不再请求 section。

## Web Admin

新增一级菜单“协作板块管理”，仅超级管理员可见。它不挂在任何社群详情下。

原社群级“板块管理”入口退出实时协作管理职责。沉淀发布已经固定，不因本设计重新开放自定义沉淀板块。

现有“帖子管理”保留：

- 社群管理员查看、编辑、软删除自己负责社群的协作帖子；
- 超级管理员跨社群查看、编辑、软删除；
- 可按社群、模板、作者、状态和时间筛选；
- 模板管理权与帖子管理权严格分离。

## 出游邀约联动

移除按社群执行 `findActivityInviteSection/ensureActivityInviteSection` 的行为。

从沉淀帖发起邀约时，服务端读取全局 `activity_invite` 模板，创建 `area=collaboration` 的关联帖子，继续保留：

- `originPostId`；
- `originLinkType: 'activity_invite'`；
- 地点和标题预填；
- 同一来源帖的进行中邀约约束；
- 报名人数和成员可见联系电话规则。

## 一次性迁移与清理

迁移必须是可重复执行的 prepare/apply 流程，并纳入正式发布清单。功能 worktree 不执行生产迁移。

### Prepare

1. 枚举全部 realtime sections、关联帖子、报名记录、审核任务、通知、云文件引用和关联出游邀约；
2. 只读核对明士班“拼车出行”和青山村“出游邀约”的线上控件；
3. 将现有板块分为 `carpool`、`activity_invite` 和 `delete`；
4. 生成包含文档 ID、数量、内容映射、文件引用、源数据摘要哈希的不可变 manifest；
5. 单独报告将保留、迁移和删除的数量；
6. 断言 `area=archive` 的帖子数量和 ID 集合不在 mutation 集合内。

### Apply

1. 创建或校验两个全局模板；
2. 将保留板块的帖子转换为 `area=collaboration` 并映射到稳定 widgetId；
3. 保留出游邀约的来源关联和报名记录；
4. 删除其他 realtime sections 的帖子及其依赖数据；
5. 仅在确认云文件没有被任何保留帖子引用后删除文件；
6. 删除所有 realtime section 文档，包括迁移完成后的旧“拼车出行”和“出游邀约”section；
7. 重建相关首页快照或缓存；
8. 再次断言沉淀帖 ID、数量和内容摘要未改变；
9. 写入迁移证据和完成状态，使重复执行成为 no-op。

迁移任何一步失败都停止后续删除；不得通过部分成功状态伪装完成。

## 测试与验收

### 离线测试

- 全局模板 CRUD 与 `superAdmin` 权限；
- 所有社群读取同一模板、新社群无需初始化；
- 社群管理员不能修改模板，但可管理自己社群的协作帖子；
- 普通成员只能在小程序修改或删除自己的帖子；
- 无 section 协作帖创建、列表、详情、编辑、删除和报名；
- 拼车补充说明可为空、可包含 `cloud://` 图片块；
- 出游邀约来源联动不再创建 section；
- archive 行为回归不变；
- prepare/apply 幂等、错误中止、文件引用保护和 archive 零改动断言。

### 真实闭环

在具备 validation lease 的安全 fixture 环境中：

1. 超级管理员创建一个临时全局协作模板；
2. 两个临时社群无需同步即可看到模板；
3. 普通成员分别发布、编辑并删除自己的协作帖；
4. 社群管理员只能管理本社群帖子；
5. 超级管理员可跨社群管理；
6. 验证拼车补充说明上传图片；
7. 验证出游邀约来源联动与报名；
8. 清理临时帖子、模板和社群。

正式发布阶段只执行必要 smoke。生产数据迁移在代码发布成功后，由 clean、fresh 的公开 canonical main 发布角色执行，并保留 prepare/apply 证据；随后再做完整真实业务验收。不得从功能分支或当前 worktree 运行。

## 非目标

- 不修改沉淀区图文、文字的发布模型；
- 不删除或重写任何沉淀帖；
- 不恢复社群管理员创建板块的能力；
- 不在本功能 worktree 部署、发布或直接修改生产数据。
