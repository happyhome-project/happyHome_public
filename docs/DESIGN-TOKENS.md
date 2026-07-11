# 美好 Home · Design Tokens ⚠️ 已过时（描述 v1 木色橙）

> ⚠️ **本文档描述 v1 木色橙 tokens，已于 2026-04-20 废弃。**
> 当前 tokens 已升级为 **v2 Classical Dossier**（墨绿 + 三字体栈 + 暖灰白纸底）。
> 代码权威源：[miniprogram/src/uni.scss](../miniprogram/src/uni.scss)（已是 v2）
> 设计与代码权威源：[miniprogram/src/uni.scss](../miniprogram/src/uni.scss)
> **迁移状态**：$hh-color-* 等旧名保留为别名指向 v2 值，保证未重构页面不崩。具体对应见 uni.scss 第 130-150 行。

---

## 历史内容（v1 · 已废弃）

> 这是 [miniprogram/src/uni.scss](../miniprogram/src/uni.scss) 里 `$hh-*` 变量的**翻译手册**。写样式时先翻这份文档，再写代码。
> 上游依赖：[docs/VISUAL-TONE.md](./VISUAL-TONE.md)（为什么这些值是这些值）

---

## 1. 为什么要 Tokens

**在没有 tokens 的项目里**（当前状态）：
```scss
/* PostCard.vue */
.card { background: #fff; border-radius: 12rpx; padding: 24rpx; color: #333; }
.time { color: #999; font-size: 22rpx; }

/* index/index.vue */
.banner { background: #ffffff; border-radius: 16rpx; padding: 28rpx; color: #222; }
.meta  { color: #aaa; font-size: 24rpx; }
```

问题：同一个"卡片"、同一个"时间戳"，在不同文件里长得不一样。要统一得改 N 处。

**有 tokens 之后**：
```scss
.card { background: $hh-color-surface; border-radius: $hh-radius-md; padding: $hh-space-md; color: $hh-color-text; }
.time { color: $hh-color-text-mute; font-size: $hh-font-tag; }
```

要调整整个产品的"时间戳灰度"？改一个变量，全站生效。

---

## 2. 命名规则

| 前缀 | 含义 | 示例 |
|------|------|------|
| `$uni-*` | uni-app 官方变量，**不要改** | `$uni-color-primary` |
| `$hh-*` | 美好 Home 项目变量，**只用这套** | `$hh-color-primary` |

`$hh-*` 下分五大类：`color` / `font` / `space` / `radius` / `shadow`，另有 `z`、`duration`、`ease` 三组辅助。

---

## 3. 颜色 Tokens

### 3.1 品牌色 & 语义色

| Token | 值 | 用在哪 | 反例（别这样用） |
|-------|-----|--------|-----------------|
| `$hh-color-primary` | `#E07A5F` | **主按钮底色**、**选中态**、**主要链接** | 不要用它当背景大面积铺（会闷） |
| `$hh-color-primary-light` | `#F5B9A8` | 主按钮 hover 底、**主色 Tag 的底色** | 不要用在文字（对比不够） |
| `$hh-color-primary-dark` | `#C25D43` | 主按钮按下态、强调文字 | 不要做大面积底色 |
| `$hh-color-success` | `#52C41A` | "发布成功" Toast、"已加入"状态标 | — |
| `$hh-color-warning` | `#FAAD14` | 权限提示、"请先登录"非阻断提示 | 不要用于错误（用 danger） |
| `$hh-color-danger` | `#C0392B` | 删除按钮、退出确认、**错误提示** | 不要用来吓人（避免大红弹窗） |
| `$hh-color-info` | `#6E8CA0` | **次要操作文字**、信息 Toast | 不要抢 primary 的戏 |

### 3.2 中性色（文字/背景/边框）

| Token | 值 | 用在哪 |
|-------|-----|--------|
| `$hh-color-bg` | `#FFFFFF` | 页面最底层背景、纯白容器 |
| `$hh-color-bg-sub` | `#F7F6F3` | **卡片之间的灰底**（暖白色，不是冷灰！）|
| `$hh-color-surface` | `#FFFFFF` | 卡片 / 面板 / 弹窗表面 |
| `$hh-color-border` | `#EBE3D8` | 输入框边框、分组分隔边 |
| `$hh-color-divider` | `#F2EFE9` | 列表行之间的分割线（比 border 更淡） |
| `$hh-color-text` | `#2C2416` | 标题、正文主体 |
| `$hh-color-text-sub` | `#595550` | 副标题、说明文字 |
| `$hh-color-text-mute` | `#766F65` | **时间戳**、placeholder、"加载更多"文字（4.96:1 ✅） |
| `$hh-color-text-inverse` | `#FFFFFF` | 深色底上的文字（主按钮文字） |
| `$hh-color-mask` | `rgba(0,0,0,0.4)` | 弹窗 / 底部抽屉的遮罩 |
| `$hh-color-primary-text` | `#C25D43` | **正文链接**、小字强调（= primary-dark，4.25:1）|
| `$hh-color-hover` | `rgba($primary, 0.06)` | 列表项 / 按钮的 hover 底（极淡主色，跟 primary 联动） |
| `$hh-opacity-disabled` | `0.4` | **禁用态透明度**（按钮 / 输入框 / 开关） |

### 3.3 决策表 · "这里该用什么色？"

| 场景 | 答案 |
|------|------|
| 主按钮文字 | `$hh-color-text-inverse` on `$hh-color-primary` 底 |
| 次按钮（描边按钮） | `$hh-color-primary` 文字 + `$hh-color-primary` 边 + `$hh-color-surface` 底 |
| 卡片里的时间戳 | `$hh-color-text-mute` + `$hh-font-tag` |
| 列表项 hover 反馈 | 底色从 `$hh-color-surface` 变 `$hh-color-hover` |
| 错误文案（表单校验失败） | `$hh-color-danger` |
| 面包屑 / 非主导航链接 | `$hh-color-text-sub` |
| **正文里的彩色链接** | `$hh-color-primary-text`（不要用 `$hh-color-primary`，对比度不够） |
| 禁用按钮 | 正常样式 + `opacity: $hh-opacity-disabled` + `pointer-events: none` |

---

## 4. 字体 Tokens

| Token | 值 | 用在哪 |
|-------|-----|--------|
| `$hh-font-h1` | `44rpx` | 详情页最大标题、欢迎页 |
| `$hh-font-h2` | `36rpx` | 板块标题、对话框标题、卡片主标 |
| `$hh-font-h3` | `32rpx` | 小节标题、按钮文字（大号按钮） |
| `$hh-font-body-lg` | `30rpx` | 动态正文内容 |
| `$hh-font-body` | `28rpx` | 正文标准、按钮文字（标准） |
| `$hh-font-caption` | `24rpx` | 辅助说明、表单 label |
| `$hh-font-tag` | `22rpx` | 标签、角标、时间戳 |

**字重**：绝大多数文字用 `$hh-font-weight-regular`（400）。标题用 `$hh-font-weight-medium`（500）。`$hh-font-weight-bold`（600）只用于非常强调的场景。**不要用 700/900**（违背"温和"气质）。

**行高决策**：
- 单行元素（按钮、Tag）：不设行高
- 标题：`$hh-line-height-tight`（1.3）
- 正文：`$hh-line-height-base`（1.5）
- 长段落 / 文章：`$hh-line-height-relaxed`（1.7）

---

## 5. 间距 Tokens

### 8-based 阶梯

| Token | 值 | 用在哪 |
|-------|-----|--------|
| `$hh-space-xs` | `8rpx` | 图标和文字之间的缝 |
| `$hh-space-sm` | `16rpx` | 字段内部、Tag 内边距 |
| `$hh-space-md` | `24rpx` | **卡片内 padding**、字段之间 |
| `$hh-space-lg` | `32rpx` | **卡片与卡片之间**、**页面左右 padding** |
| `$hh-space-xl` | `48rpx` | 板块之间、大区块之间 |
| `$hh-space-xxl` | `64rpx` | 页面顶部首元素距顶、底部 safe area |

### 典型组合

```scss
// 一张标准卡片
.post-card {
  padding: $hh-space-md;           // 卡内 24rpx
  margin-bottom: $hh-space-lg;     // 卡间 32rpx
  border-radius: $hh-radius-md;    // 圆角 16rpx
  background: $hh-color-surface;
  box-shadow: $hh-shadow-card;
}

// 一个页面的列表容器
.feed {
  padding: $hh-space-lg $hh-space-lg 0;  // 上 32 / 左右 32 / 下 0
  background: $hh-color-bg-sub;          // 暖白底色
}
```

---

## 6. 圆角 Tokens

| Token | 值 | 用在哪 |
|-------|-----|--------|
| `$hh-radius-sm` | `8rpx` | Tag、输入框、小号按钮 |
| `$hh-radius-md` | `16rpx` | **卡片**、标准按钮（核心温度感） |
| `$hh-radius-lg` | `24rpx` | 大面板、底部抽屉、大号图片 |
| `$hh-radius-full` | `9999rpx` | 头像、pill 按钮、开关 |

---

## 7. 阴影 Tokens

| Token | 值 | 用在哪 |
|-------|-----|--------|
| `$hh-shadow-card` | 轻微下投 | **卡片默认阴影**（几乎看不见但有层次） |
| `$hh-shadow-float` | 中度下投 | 浮层 / 下拉菜单 / 浮动按钮 |
| `$hh-shadow-modal` | 重度下投 | 模态弹窗 / 底部抽屉 |

**原则**：**少用阴影，用了就明显**。平铺页面一律不加阴影，只有"层"的概念出现时才加。

---

## 8. 动效 Tokens

| Token | 值 | 用在哪 |
|-------|-----|--------|
| `$hh-duration-fast` | `0.15s` | 按钮按下反馈、小元素切换 |
| `$hh-duration-base` | `0.25s` | 标准过渡（颜色变化、隐现） |
| `$hh-duration-slow` | `0.4s` | 面板滑入 / 页面切换 |
| `$hh-ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` | 默认缓动（进出都有减速） |
| `$hh-ease-in` | — | 进入动效（从快到慢） |
| `$hh-ease-out` | — | 退出动效（从慢到快） |

```scss
// 标准按钮 hover 效果
.btn {
  transition: background $hh-duration-fast $hh-ease-standard;
  &:active { background: $hh-color-primary-dark; }
}
```

---

## 9. Z-index Tokens

| Token | 值 | 用在哪 |
|-------|-----|--------|
| `$hh-z-normal` | `1` | 常规 |
| `$hh-z-sticky` | `10` | 吸顶 tab、吸底工具栏 |
| `$hh-z-overlay` | `100` | 半透明遮罩 |
| `$hh-z-modal` | `1000` | 弹窗 / 抽屉 |
| `$hh-z-toast` | `2000` | Toast（永远最高） |

---

## 10. 使用方式

### 10.1 在 `.vue` 文件里用

uni-app + Vue 3 的 SFC 默认已经 import `uni.scss`。可以直接用：

```vue
<template>
  <view class="card">
    <text class="title">{{ title }}</text>
    <text class="time">{{ time }}</text>
  </view>
</template>

<style lang="scss" scoped>
.card {
  padding: $hh-space-md;
  background: $hh-color-surface;
  border-radius: $hh-radius-md;
  box-shadow: $hh-shadow-card;
}
.title {
  font-size: $hh-font-h3;
  color: $hh-color-text;
}
.time {
  font-size: $hh-font-tag;
  color: $hh-color-text-mute;
}
</style>
```

### 10.2 如果某个 `.vue` 拿不到变量

检查两件事：
1. `<style>` 标签有 `lang="scss"` 吗？
2. 项目根 [miniprogram/vite.config.ts](../miniprogram/vite.config.ts) 里 uni-app 插件默认会注入 `uni.scss`，一般不用手动 import。如果报"undefined variable"，在文件顶部加 `@import "@/uni.scss";`。

---

## 11. 迁移策略（旧代码如何改）

**不要一次性把所有页面都改了**。按 UI 升级路线图的 Phase 4 顺序，按页重构：

1. 找到所有硬编码的颜色（`#xxx` / `rgba(...)`）、字号、间距
2. 查表找到对应的 `$hh-*` token
3. 替换

**替换参考（从 Explore 扫出来的常见硬编码）**：

| 旧值 | 新值 |
|------|------|
| `#333` / `#333333` | `$hh-color-text` |
| `#999` / `#aaa` / `#bbb` | `$hh-color-text-mute` |
| `#666` / `#555` | `$hh-color-text-sub` |
| `#fff` / `#ffffff` | `$hh-color-bg` 或 `$hh-color-surface`（看语义） |
| `#f5f5f5` / `#f7f8fa` | `$hh-color-bg-sub` |
| `#eee` / `#ebedf0` | `$hh-color-border` |
| 字号 `22rpx` | `$hh-font-tag` |
| 字号 `24rpx` | `$hh-font-caption` |
| 字号 `26rpx` ⚠️ | `$hh-font-caption`（`26rpx` 被并入 `24rpx`） |
| 字号 `28rpx` | `$hh-font-body` |
| 字号 `30rpx` | `$hh-font-body-lg` |
| 字号 `32rpx` | `$hh-font-h3` |
| 字号 `34rpx` ⚠️ | `$hh-font-h3`（`34rpx` 并入 `32rpx`，多余粒度去掉） |
| 字号 `36rpx` | `$hh-font-h2` |
| 间距 `12rpx` ⚠️ | `$hh-space-sm`（16rpx）或 `$hh-space-xs`（8rpx）按比例 |
| 间距 `16rpx` | `$hh-space-sm` |
| 间距 `24rpx` | `$hh-space-md` |
| 间距 `28rpx` ⚠️ | `$hh-space-md`（24rpx）或 `$hh-space-lg`（32rpx）按比例 |
| 间距 `32rpx` | `$hh-space-lg` |
| 间距 `48rpx` | `$hh-space-xl` |
| 圆角 `12rpx` | `$hh-radius-md` （16rpx，统一温度） |

⚠️ 标记的是旧代码里的"碎粒度"值，迁移时统一向**系统化的 8-based 阶梯**对齐，少数页面会出现 1-2rpx 的视觉变化，这是**预期行为**（统一 > 精确复刻）。

---

## 12. 新增 Token 的流程

要新增一个 `$hh-*` token 前先问自己：

1. **现有 token 真的不够用吗？** 大多数需求其实能用现有组合解决。
2. **这是通用的，还是只为某一页？** 只为某一页的话不要加 token，在组件内部 scoped 即可。
3. **它有强烈的 "意图"吗？** token 的命名反映意图，不反映外观。`$hh-color-text-mute` 是意图（弱化文字）；`$hh-gray-9` 是外观 —— 意图驱动的 token 才稳定。

决定要加的话：
1. 在 [miniprogram/src/uni.scss](../miniprogram/src/uni.scss) 对应分类加
2. 在本文档对应表格加一行
3. 在 [docs/VISUAL-TONE.md](./VISUAL-TONE.md) 更新决策链（如果涉及调性）

---

> 下一步：Phase 2 会把这份 tokens 映射到 `wot-design-uni` 的 CSS 变量上，让 UI 库的组件也继承这份调性。
