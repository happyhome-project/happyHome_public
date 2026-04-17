# 美好 Home · UI 组件库使用速查

> 本项目使用 [wot-design-uni](https://wot-ui.cn) v1.14.0 作为基础 UI 组件库。
> 上游依赖：[docs/VISUAL-TONE.md](./VISUAL-TONE.md)（调性） / [docs/DESIGN-TOKENS.md](./DESIGN-TOKENS.md)（tokens）

---

## 1. 技术架构

```
wot-design-uni 组件（wd-button、wd-cell ...）
        │
        │ 读取 CSS 变量 --wot-*
        ▼
App.vue <style> 里把 --wot-* 映射到 $hh-* tokens
        │
        │ SCSS 编译时解析
        ▼
miniprogram/src/uni.scss 里的 $hh-* Design Tokens
```

**你写业务页面时**：
- 布局 / 交互组件 → 用 `<wd-*>` 组件（自带主题色）
- 自定义样式 → 用 `$hh-*` SCSS 变量（跟 wd 组件同色系）

---

## 2. 如何使用 wd-* 组件

### 2.1 自动导入（easycom）

已在 `pages.json` 配置好 easycom，**直接在 template 里写标签名即可**，不需要 import：

```vue
<template>
  <!-- 直接写，无需 import -->
  <wd-button type="primary">点我</wd-button>
  <wd-cell title="标题" value="内容" is-link />
  <wd-loading />
</template>
```

### 2.2 文档查阅

- 官方文档（中文）：[wot-ui.cn](https://wot-ui.cn)
- GitHub：[github.com/Moonofweisheng/wot-design-uni](https://github.com/Moonofweisheng/wot-design-uni)
- 组件列表：[wot-ui.cn/component/button](https://wot-ui.cn/component/button)

---

## 3. 本项目常用组件速查

### 3.1 wd-button（按钮）

```vue
<!-- 主按钮（发布、提交） -->
<wd-button type="primary" block :loading="submitting" @click="handleSubmit">
  发布
</wd-button>

<!-- 次按钮 / 描边按钮（去登录、去加入） -->
<wd-button size="small" plain type="primary" @click="goLogin">
  去登录
</wd-button>

<!-- 危险按钮（删除、退出） -->
<wd-button type="error" plain @click="handleDelete">
  删除
</wd-button>

<!-- 禁用态 -->
<wd-button type="primary" disabled>
  不可点
</wd-button>
```

**注意**：
- `type="primary"` 会自动使用 `$hh-color-primary`（木色橙），因为 App.vue 已覆盖 `--wot-color-theme`
- `type="error"` 会自动使用 `$hh-color-danger`（`#C0392B`）
- `:loading="true"` 自带转圈动画 + 防重复点击，可以替代手工的 `useBusyLock`（但后端去重仍然需要）

### 3.2 wd-cell（列表项 / 选择项）

```vue
<!-- 带箭头的导航项 -->
<wd-cell title="亲子板块" is-link @click="goToSection" />

<!-- 带值的展示项 -->
<wd-cell title="社区名称" value="美好家园" />

<!-- 带描述 -->
<wd-cell title="出游路线" label="2024-03-15 发布" is-link />
```

### 3.3 wd-loading（加载中）

```vue
<!-- 独立使用 -->
<wd-loading color="#E07A5F" />

<!-- 带文字 -->
<wd-loading color="#E07A5F" size="30px">加载中...</wd-loading>
```

### 3.4 wd-toast（轻提示）

```vue
<script setup>
import { useToast } from 'wot-design-uni'
const toast = useToast()

function onSuccess() {
  toast.success('发布成功')
}
function onError() {
  toast.error('发布失败，请重试')
}
</script>

<template>
  <!-- 必须在 template 里放一个 wd-toast 节点 -->
  <wd-toast />
</template>
```

> **当前状态**：create 页暂时仍用 `uni.showToast`，后续迁移到 `wd-toast`。

### 3.5 wd-message-box（确认弹窗）

```vue
<script setup>
import { useMessage } from 'wot-design-uni'
const message = useMessage()

async function handleDelete() {
  const action = await message.confirm({
    title: '确认删除？',
    msg: '删除后无法恢复',
    confirmButtonText: '删除',
  })
  if (action === 'confirm') {
    // 执行删除
  }
}
</script>

<template>
  <wd-message-box />
</template>
```

> **当前状态**：create 页暂时仍用 `uni.showModal`，后续迁移到 `wd-message-box`。

---

## 4. 主题覆盖机制

在 [miniprogram/src/App.vue](../miniprogram/src/App.vue) 的 `<style lang="scss">` 里，通过 CSS 变量覆盖实现主题对齐：

```scss
page {
  --wot-color-theme: #{$hh-color-primary};    // 木色橙
  --wot-color-success: #{$hh-color-success};
  --wot-color-danger: #{$hh-color-danger};
  --wot-button-medium-radius: #{$hh-radius-md}; // 温暖圆角
  // ... 更多映射见 App.vue
}
```

**效果**：所有 `wd-*` 组件自动继承美好 Home 的品牌色和圆角，无需逐组件配置。

---

## 5. 自建组件 vs wd-* 的分工

| 组件 | 用什么 | 理由 |
|------|--------|------|
| 按钮 | `wd-button` | 统一样式、loading、禁用态 |
| 列表项 | `wd-cell` | 统一箭头、分割线 |
| 加载指示 | `wd-loading` | 统一动画 |
| 轻提示 | `wd-toast`（待迁移） | 统一位置和动画 |
| 确认弹窗 | `wd-message-box`（待迁移） | 统一样式和按钮 |
| 输入框 | **保留原生** `<input>` | 微信小程序 input 有原生层级限制，wd-input 可能踩坑 |
| PostCard | **保留自建** | 业务定制，用 tokens 做样式 |
| SectionTabs | **待评估** `wd-tabs` | Phase 4 评估替换 |
| WidgetEditor | **保留自建** | 业务逻辑强，只做 tokens 迁移 |
| WidgetRenderer | **保留自建** | 同上 |

---

## 6. 常见问题

### Q: wd-* 组件不显示 / 样式丢失

1. 检查 `pages.json` 里有没有 `easycom` 配置
2. 检查 `globalStyle` 里有没有 `"mp-weixin": { "styleIsolation": "shared" }`
3. 确认 `wot-design-uni` 在 `package.json` 的 `dependencies` 里（不是 devDependencies）

### Q: 编译时一堆 DEPRECATION WARNING

这是 wot-design-uni 内部使用了 Sass legacy `@import` 语法。**不影响功能**，等库方更新即可。不要为了消除警告去改 `node_modules`。

### Q: H5 下 rpx 单位显示为 0px

uni-app 在 H5 模式下对 `uni-text` 组件的 rpx 处理有已知 quirk。**真机小程序上不会有此问题**。H5 测试时关注颜色和布局即可。

### Q: 想覆盖某个 wd-* 组件的特定样式

优先用 CSS 变量覆盖（在 App.vue 或 scoped style 里），参考 [wot-ui.cn/guide/custom-style](https://wot-ui.cn/guide/custom-style)。避免用 `!important` 硬盖。

---

> 下一步：Phase 3 写 [docs/UX-PRINCIPLES.md](./UX-PRINCIPLES.md) 交互规范，定义 loading/empty/error/confirm 六大状态该用什么组件。
