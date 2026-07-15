# 首页可见 Tabs 二阶段吸顶回归修复设计

> **Historical / point-in-time:** 本设计记录 2026-07-15 首页可见 Tabs 吸顶回归的根因与修复方案，仅用于追溯，不覆盖后续产品或实现决策。
> **Current authority:** 以[文档权威索引](../../README.md)、当前首页代码、发布 UI 检查和测试为准。

## 问题与根因

首页原有“固定社区栏 → 搜索框吸顶 → Tabs 吸顶”的两阶段滚动行为。归档信息流升级为主题驱动后，真正可见的标签被替换为 `ArchiveTopicTabs`，原 `.section-tabs-sticky-shell` 则被保留为 `v-show="false"` 的旧结构。吸顶定位仍挂在隐藏旧节点上，当前可见标签的计算样式为 `position: static`。

现有回归测试没有发现问题：静态测试只检查旧 class 和 CSS 是否存在；H5 smoke 会在运行时自行创建一个假的 `.section-tabs-sticky-shell`，验证的不是生产模板中的可见标签。因此代码和测试同时偏离了用户实际操作对象。

## 第一性原理约束

二阶段吸顶只依赖四个不可分割的不变量：

1. 页面只能渲染一份用户可见的主题 Tabs，避免选择状态和滚动位置分叉。
2. 这份 Tabs 必须一直占据文档流高度，吸顶前后不能发生占位塌缩或副本切换。
3. Tabs 的吸顶坐标必须等于固定社区栏与已吸顶搜索框的高度之和：`150rpx + env(safe-area-inset-top) + 138rpx`。
4. Sticky 节点的包含块必须延伸到主题瀑布流底部，否则它会在父容器底边提前释放。

## 方案比较

### 方案 A：页面用 sticky 外壳包裹真实组件（采用）

在 `.archive-topic-shell` 内，用 `.section-tabs-sticky-shell` 包裹唯一可见的 `ArchiveTopicTabs`，让 `ArchiveWaterfall` 继续作为后续兄弟节点。页面负责首页级吸顶坐标，通用组件只负责标签内容与横向滚动。删除隐藏旧 Tabs，并用 archive 修饰类抵消旧结构专用的 margin/padding，保持当前初始排版不变。

### 方案 B：让 `ArchiveTopicTabs` 自身 sticky（不采用）

代码更少，但会把首页社区栏、搜索框高度和 z-index 规则写进通用组件，使它无法在其他页面独立复用。

### 方案 C：监听滚动并切换 fixed 状态（不采用）

需要阈值测量、占位补偿和平台分支，重新引入此前已移除的双状态同步问题；原生 sticky 已能表达当前需求。

## DOM 与样式

生产模板调整为：

```vue
<view class="archive-topic-shell">
  <view class="section-tabs-sticky-shell section-tabs-sticky-shell--archive">
    <ArchiveTopicTabs ... />
  </view>
  <ArchiveWaterfall ... />
</view>
```

- `.section-tabs-sticky-shell` 保留现有 `position: sticky`、`top` 和 `z-index`。
- `.section-tabs-sticky-shell--archive` 将旧板块标签专用的 margin/padding 归零，不改变当前主题标签初始位置和高度。
- Sticky 外壳继续透明，不恢复白底、阴影或模糊。
- 不修改搜索框、顶部渐变、主题标签选中态、瀑布流数据或云端接口。

## 测试修复

- 静态契约要求 `ArchiveTopicTabs` 位于唯一的 `.section-tabs-sticky-shell` 内，并禁止 `v-show="false"` 的 sticky Tabs。
- H5 smoke 不再创建假 Tabs；只给真实页面补充纵向 fixture 空间，然后测量真实 sticky 外壳和 `ArchiveTopicTabs`。
- 验证搜索框固定在社区栏下方、真实 Tabs 固定在搜索框下方、Tabs 内部与外壳顶边一致，并在反向滚动时释放。
- 微信小程序构建和运行时验证作为最终平台证据；H5 只用于隔离复现和几何预检。

## 非目标

- 不恢复旧 evergreen 板块标签或旧信息流。
- 不移除与本回归无关的隐藏旧信息流分支。
- 不调整主题标签视觉、首页渐变、活动区、搜索行为或后台数据。
- 不从功能 worktree 发布、部署云函数或上传小程序。
