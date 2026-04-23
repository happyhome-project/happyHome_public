# Handoff · HappyHome (美好 Home · 邻里社区)

> 这份包交给 Claude Code 后，请在目标代码库里**还原这些 HTML 设计稿**。HTML 文件是**设计参考**，不是生产代码；不要直接把 HTML 塞进产品。

---

## 1. Overview

HappyHome 是一款"反算法"的邻里社区 App。定位：**不是广场、不是信息流、是一本合订的册子**。核心价值是把邻居之间的交流沉淀为可检索、可追溯的档案，由群主以"编辑"身份定期策展。

这次交付包含 4 个主要屏幕 + 1 套设计 tokens，代表 V4 "Classical Dossier" 视觉方向定稿。

### 关键产品主张
- **Archive over Feed** — 不用无限下拉信息流；每条内容属于某个板块、某期精选。
- **Editor-driven** — 群主是"主编"，每周策展"本周精选"。
- **Slow typography** — Serif 标题、Mono 数字、Sans 正文三体分工；极克制的色彩（单一墨绿 accent）。
- **Admin is first-class** — 群主工具（Admin）是决定社区能否沉淀的关键产品，不是二级后台。

---

## 2. About the Design Files

- 所有屏幕都用 **纯 HTML + CSS** 写成，无 React、无 Babel、无 JS 框架。目的是演示最终视觉和交互意图。
- 手机屏用 `375 × 812` 画布模拟 iOS 尺寸；Admin 用 `1440 × 900` 桌面画布。
- 所有设计值（颜色、间距、字号）都在 CSS 变量里定义，见 `tokens-v2.css`。
- **任务**：在目标代码库既有环境（React/Vue/SwiftUI/原生）里**像素级还原**这些设计稿，使用代码库自己的组件库和约定。如果还没环境，推荐用 **Next.js 14 + Tailwind v4 + CSS Vars**（见 §8 建议栈）。

---

## 3. Fidelity

**High-fidelity (hifi)**。

- 最终视觉方向已确认
- 颜色、字体、间距、圆角都是最终值
- 交互状态（hover / active / selected）已经在 HTML 里体现
- 文案都是真实场景下的中文示例，可直接保留或翻译

开发者应：**像素级还原**，使用目标代码库已有的组件系统。只有在目标代码库有强制的视觉约束（例如已有 design system）时才做妥协，并在 PR 描述里说明偏差。

---

## 4. 设计语言总纲 · Classical Dossier

### 字体三体分工
| 角色 | 字族 | 用在哪 |
|---|---|---|
| **Serif** | Songti SC / STSong / Source Han Serif SC / Georgia | 标题、精选卡片大字、强调 |
| **Sans** | PingFang SC / Hiragino Sans GB / system-ui | 正文、按钮、次级信息 |
| **Mono** | SF Mono / JetBrains Mono / Menlo | 数字、标签、元数据、"档案封面"小字 |
| **Num** | SF Pro Display | 所有独立数字（徽章、统计、时间） |

使用原则：
- **Serif 负责"这是一本册子"的庄重感** —— 不要拿来做按钮或密集表格。
- **Mono 负责"这是档案"的冷静感** —— 所有 metadata、label、section title 都用 mono，通常搭配 `text-transform: uppercase; letter-spacing: 0.16em–0.22em;`。
- **Sans 负责人话** —— 正文、描述性副标题。

### 颜色系统（oklch）
见 §7 Design Tokens。核心规则：
- **只有一个 accent（墨绿）**：`oklch(0.48 0.08 150)`。贯穿所有"此刻发生"、"精选"、"已选中"信号。
- **纸背景**：整体暖灰白，不是纯白；`--surface-0: oklch(0.965 0.005 75)` 是主底色。
- **墨黑**：`--ink-1: oklch(0.22 0.01 60)` 略偏暖，不是 `#000`。
- **危险色/实时色**：`--live: oklch(0.58 0.18 25)` 砖红，仅用于实时/举报/驳回。
- **禁止**：彩色渐变背景、彩色饱和色块（照片除外）、AI 式渐变、emoji（除非品牌方针明确采用）。

### 布局原则
- **手机屏**：`375 × 812`，status bar `44px` 高，tabbar `78px` 高带 `backdrop-filter: blur(12px)` 的半透明底。
- **信息层级靠字族切换，不靠色彩加权**。
- **所有卡片使用极细边框** `1px solid var(--ink-line)`，拒绝大面积阴影。
- **左侧彩条**（`3px × 12–18px`）是板块/类型的唯一色彩入口。

---

## 5. Screens · 屏幕清单

### Screen 01 · 首页 `style-1-classic.html`
**用途**：住户日常进入 App 第一屏，一眼看到"此刻 / 本周 / 板块 / 最新"四件事。

**布局**（自上而下）：
1. **Status Bar**（iOS 标准）
2. **社区封面卡**（Masthead）：社区名用 `font-serif 24px 600`，下有"今日 N 帖 · 本月 M 帖 · 沉淀率 X%"等 mono 数据行。
3. **实时条**（Live strip）：深色块，带脉冲点，展示"此刻有 N 个邻居在 XXX"。点击可跳转。
4. **本周精选**（Editor's Pick）：Serif 大标题 + 封面插图占位 + 群主签名行。点击进详情。
5. **板块目录**（Boards）：列表式，每条左侧一条色标、右侧一个数字徽章（本周新帖数）。
6. **最新帖子** 列表：标题 serif、meta mono、缩略图方形圆角。
7. **Tabbar**（首页 / 广场 / ＋ / 消息 / 我）。

**细节**：
- FAB（中间 "＋" 凸起按钮）是 `52×52` 圆，墨黑底白字。
- 数字全部用 `font-variant-numeric: tabular-nums`。

---

### Screen 02 · 帖子详情 `detail-shop.html`
**用途**：阅读一篇"周边好店"长帖。期刊式排版，尊重作者文字。

**布局**：
1. **顶部 nav**：返回 + 板块面包屑 + 更多操作。
2. **文章头**：kicker（mono uppercase「周边好店 · 第 42 期」）+ Serif 大标题 + 作者卡（头像 + 楼号 badge + 时间）。
3. **Drop cap 段首**：首段第一个字用 `font-serif 48px`，`float: left`，3 行下沉。
4. **正文**：Sans 15px `line-height: 1.75`，段距 `1em`。
5. **引语块**（blockquote）：左墙 `3px solid var(--accent)`，Serif italic，稍大。
6. **三图故事版**：`grid-template-columns: 2fr 1fr 1fr; grid-template-rows: 1fr 1fr;`，第一张占两行，形成杂志感版面。
7. **在地信息卡**（Location Card）：浅米色背景，带地址、电话、营业时间、预估人均、交通提示，mono 排版；下方 "导航 / 呼叫 / 分享" 三按钮。
8. **标签行**：`#` 前缀 mono 字体。
9. **评论区**：折叠可展开，头像 + 名字 + 楼号 badge + 评论正文 + "回复 · 点赞数" mono 元数据。
10. **底部贴着键盘上沿的"评论输入区"**（固定）。

---

### Screen 03 · 发帖写作 `compose.html`
**用途**：写一篇新帖。一张摊开的稿纸，不是一个"发表"按钮。

**布局**：
1. **Nav-c**：左"取消"、中"NEW POST"（mono kicker）、右"存草稿"（胶囊按钮）。
2. **板块选择器**：「发布到 → 周边好店」左彩条 + serif 板块名 + mono meta"沉淀 · 86 条"+ 下拉箭头。点开可切。
3. **Editor 区**：
   - **标题**：`textarea`，`font-serif 22px 600`，自动扩展高度。
   - **正文**：`textarea`，`font-sans 15px`，自动扩展。
   - **Markdown 快捷提示**（hint）：虚线框条，提示 `**加粗 · ## 小标 · > 引语 · — 分隔`。
4. **Inserts 区**（灰色 section）：
   - 配图 strip（横向滑动的 88×88 图片 + "+"）
   - 标签 chip 行（带 `#` 前缀的 suggestion chip，点击切换）
5. **Settings 列表**：位置、定时发布、同步到精选候选。每行 icon + label + value + chevron。
6. **键盘工具条**（fixed 贴键盘上沿）：加粗/斜体/H/列表/引语/图片/链接 + 字数统计 + "发布" 胶囊按钮。
7. **iOS 键盘占位**（fixed 贴 phone 底部，永远不跟随滚动）。

**重要**：键盘和键盘工具条必须**固定在 `.phone` 底部**，作为 scrollable `.phone-inner` 的**兄弟元素**，不是子元素。否则它们会随内容滚动，遮挡下面的 settings。

---

### Screen 04 · Admin 群主工作台 `admin.html` · **桌面 1440×900**
**用途**：群主每天 15 分钟处理社区队列：待审帖 / 举报 / 关键词触发 / 新人申请。

**布局**（四栏 grid）：`240px | 360px | 1fr | 320px`

1. **Top bar**（跨全宽）：Logo + 面包屑 + 搜索框 (`⌘K`) + "本周 · 第 38 周" live 标 + 当前管理员头像。
2. **Left Nav**（240px）：
   - "日常" 分组：待处理（带红点计数 12）、精选候选（7）、新人申请（3）、已处理（286）
   - "板块" 分组：每个板块一个色标 + 名字 + 计数
   - "管理" 分组：成员、板块栏目、健康度、公约
   - 底部 kbd 提示：`J/K 翻条`、`E 通过`、`X 驳回`、`⌘K 搜索`
3. **Queue 列**（360px）：
   - 顶部 "待处理 · 12 条 · 平均等候 38 分钟" serif 大标
   - Filter 胶囊（全部 / 新帖 / 举报 / 关键词 / 新人）
   - 列表项：tag（new/report/kw/join 四色）+ 板块 + 时间 + Serif 标题 + meta（作者 · 内容摘要）
   - 选中态左侧一条 3px 墨黑竖线
4. **主区**（弹性）：
   - 面包屑 + 文章标题（Serif 26px）+ 作者卡
   - **Action bar**：主按钮"通过并发布 `E`"，次按钮"打精选 `S`"、"置顶 7 天"、"改板块"、"给作者留言"，右侧"驳回 `X`"（红框）+"暂缓 24 小时"。
   - 帖子预览（带 lede、3 图 grid、标签）
   - **黄条"系统提示"** — 琥珀色背景 + 左边 3px 粗线，列出自动核查的软建议
5. **Right side**（320px）：
   - "作者"卡 —— 头像 + 名字 + "V 认证住户" badge + 简介 + 三格 stats（发帖 / 精选 / 违规）
   - "自动核查"清单 —— 敏感词/图片/引流词/广告/重复度，每行带 ok/warn/bad 状态图标
   - "近似历史帖" 3 条
   - "板块健康 · 周边好店" 三格 stats（本月贴 / 7日沉淀 / 均互动）

---

## 6. Interactions & Behavior

### 全局
- **所有页面顶部 status bar 固定 sticky top**，滚动时不动。
- **Tabbar 在手机页有 backdrop-filter blur**，滚动时下方内容透过模糊显示。
- **点击彩条/板块名 → 跳到该板块列表**。
- **点击精选卡 → 跳详情**。

### 发帖页
- `textarea` 自动随输入扩展高度（脚本：`el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px';`）。
- 键盘工具条的"发布"按钮，在字数 < 5 时置灰（未实现，请补）。
- 标签 chip 点击切换 picked 状态。

### Admin
- `J / K` 翻上/下一条队列项。
- `E` 通过（主按钮高亮）。
- `X` 驳回（红色）。
- `S` 打精选。
- `⌘K` 打开搜索 palette（未实现，请补）。
- 选中队列项时左侧 3px 墨黑竖线 + 背景切到 `--surface-1`。
- **处理后列表中该项变灰**（class `.reviewed`），但仍在列表里以便"撤销"。

### 动画 / 过渡
- Hover 过渡统一 `transition: 0.15–0.2s`。
- 无花哨 motion。"册子翻页"感 > "App 切换"感。

### 响应式
- 手机屏固定 375，不做响应式（iOS app 目标）。
- Admin 桌面屏固定 1440 × 900；**不要**做 responsive 塌缩。如果目标是 web admin，建议最小宽度 1280，其上加 flexible 列宽。

---

## 7. Design Tokens

完整 token 表见 `tokens-v2.css`。关键值：

### Surfaces (暖灰白纸)
```
--surface-0: oklch(0.965 0.005 75);   /* 主底色 */
--surface-1: oklch(0.988 0.004 75);   /* 卡片底 */
--surface-2: oklch(0.935 0.006 75);   /* hover / 次级块 */
--surface-3: oklch(0.905 0.008 75);
```

### Ink (墨色)
```
--ink-1: oklch(0.22 0.01 60);   /* 主文字 */
--ink-2: oklch(0.42 0.01 60);   /* 次文字 */
--ink-3: oklch(0.60 0.008 60);  /* 辅助 / mono 标签 */
--ink-4: oklch(0.75 0.006 60);  /* 禁用 / 更弱 */
--ink-line:   oklch(0.88 0.006 60);
--ink-line-2: oklch(0.93 0.005 60);
```

### Accent (单一墨绿)
```
--accent:      oklch(0.48 0.08 150);
--accent-ink:  oklch(0.38 0.08 150);
--accent-wash: oklch(0.94 0.03 150);
--accent-line: oklch(0.82 0.05 150);
```

### 其它语义色
```
--live:      oklch(0.58 0.18 25);    /* 举报 / 驳回 / 实时 */
--live-wash: oklch(0.93 0.045 30);
--amber-wash: oklch(0.94 0.04 75);   /* 系统提示 */
--blue-wash:  oklch(0.93 0.03 240);  /* 新人申请 */
```

### 字体
见 §4 表格。

### 字号阶 (只列实际用到的)
- **手机**: 10 / 10.5 / 11 / 11.5 / 12 / 12.5 / 13 / 13.5 / 14 / 14.5 / 15 / 16 / 17 / 18 / 22 / 24
- **桌面 Admin**: 9.5 / 10 / 10.5 / 11 / 11.5 / 12 / 12.5 / 13 / 13.5 / 14 / 14.5 / 15 / 16 / 17 / 18 / 20 / 22 / 26

**注意**：Chinese typography 需要半磅精度，请保留 .5 字号；不要统一 round 到整数。

### Letter spacing
- Mono uppercase label: `0.16em – 0.22em`
- Serif 大标题: `-0.01em – -0.022em`（收紧）
- Sans 正文: `0.005em`

### Radius
```
3 / 4 / 5 / 6 / 7 / 8 / 10 / 12 / 14 / 18 / 42 (phone frame) / 99 (pill/dot)
```

### Shadows
基本上不用。唯一例外：
- FAB: `0 10px 24px rgba(0,0,0,0.18)`
- Phone frame 演示: `0 0 0 10px oklch(0.18 0.005 60)` (bezel)

---

## 8. 建议栈（如果目标代码库还是空的）

**Web**：
- Next.js 14 App Router
- Tailwind v4（原生支持 CSS Vars 和 oklch）
- React Server Components for content pages, Client Components for compose/admin
- Typography via `next/font/google` + 系统 Songti 回退
- Animation: Framer Motion 用得克制，只做进入过渡和队列项过渡

**iOS (native)**：
- SwiftUI
- 字体：`Georgia` / `NewYork` (serif) · `SF Pro` (sans) · `SF Mono` (mono)
- 颜色用 Color(oklch...) → convert 到 sRGB

**推荐不要用**的东西：
- Material Design (跟克制档案气质冲突)
- shadcn/ui 的默认样式 (太现代太 SaaS)；可以用它的 primitives，但请按本 token 重写

---

## 9. Assets

**目前所有图片都是占位**（纯 CSS linear-gradient 伪造的色块）：
```css
background: linear-gradient(135deg, oklch(0.78 0.08 40), oklch(0.65 0.12 30));
```

上线前需要：
- 精选封面图（摄影/插画，非 stock）
- 帖子配图（用户 UGC，无需设计师）
- 头像默认图（单色字母 + 暖色背景，如设计稿）
- 板块图标（当前用 SVG line icons，保持 stroke-width: 1.8–2，拒绝填充色）

**Icon**：目前内联 SVG 画 Feather 风 line icon，stroke 1.8–2。推荐直接引入 `lucide-react` 或 `@phosphor-icons/react` 的 line variant。

---

## 10. Files in this Bundle

```
design_handoff_happyhome/
├── README.md                    ← 你正在读这个
├── tokens-v2.css                ← 所有 CSS 变量、字体、phone/tabbar 基础样式
├── style-1-classic.html         ← Screen 01 · 首页
├── detail-shop.html             ← Screen 02 · 帖子详情
├── compose.html                 ← Screen 03 · 发帖
└── admin.html                   ← Screen 04 · Admin 工作台（桌面）
```

打开每个 HTML 直接在浏览器预览；CSS 已去除项目根路径，所有引用改为同目录相对路径。

---

## 11. Out of Scope（下次迭代）

- 消息 / 私信
- 通知中心
- 搜索结果页
- 个人主页 / "我"tab
- 登录 / 注册 / 入群审核全流程
- 错误 / 空 / 加载态
- 页面过渡动效
- 深色模式（暂无）

如果要补，保持同一套 tokens 和字族分工即可。

---

## 12. Open Questions for the Dev

1. 目标代码库现有组件系统是什么？（必须先清点）
2. i18n 是否必要？（当前所有文案是中文，`font-serif` fallback chain 已覆盖 Source Han Serif；英文需要换 Georgia）
3. 实时 presence（首页 "此刻有 N 个邻居在 XXX"）用什么后端？WebSocket / SSE / Polling？
4. 群主端和住户端是同一个 App 还是分开？目前 Admin 按桌面做；如果是同一 App 移动版，需要另出一版。

—— *V4 Classical Dossier · 主编落款*
