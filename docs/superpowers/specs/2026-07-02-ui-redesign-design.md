# Narratox UI 全量重新设计规范

> **Design tokens 权威来源**：`/tmp/pencil-design-tokens-reference.md`（从旧 Pencil 295 次 batch_design 操作中提取）。代码 CSS/Tailwind 可能与设计稿不一致，**以本文档 tokens 为准**。

**目标**：从零重建全部 UI 设计（旧 .pen 文件已丢失），覆盖全部 7 个页面路由 + 所有交互状态/弹窗/空状态。

**设计风格**：暗色主题，Cursor / Linear / Vercel v0 风格，玻璃拟态（glass morphism），Indigo→Violet 渐变主色调。

**工具**：Pencil MCP v1.1.68，画布尺寸 1440×900px。

---

## 1. Design Tokens

### 1.1 颜色体系

#### 背景层级（从深到浅）
| Token | 色值 | 用途 |
|-------|------|------|
| `bg.base` | `#0a0a0b` | 画布最底层 |
| `bg.darkest` | `#0F0F13` / `#0F0F12` | 最暗背景层 |
| `bg.dark` | `#13131a` | 标准页面背景 |
| `bg.card` | `#1A1A22` / `#1A1A20` | 标准卡片背景 |
| `bg.cardElevated` | `#2A2A35` | 深色卡片底色（最高频卡片色） |
| `bg.raised` | `#252530` | 提升层背景（hover/弹出） |
| `bg.gradient` | `#0a0a0b → #13131a` (135°) | 页面背景渐变 |
| `bg.cardGradient` | `#1A1A22 → #222228` (135°) | 卡片渐变 |

#### 覆盖层（Overlay）
| Token | 色值 | 用途 |
|-------|------|------|
| `overlay.5` | `#ffffff0a` | 最微妙覆盖/边框 |
| `overlay.6` | `#ffffff08` | 思考块/工具块底色 |
| `overlay.10` | `#ffffff0f` | 卡片分隔/淡边框 |
| `overlay.15` | `#ffffff14` | 标准边框/分隔线 |

#### 主色调（Accent — Indigo → Violet 渐变系）
| Token | 色值 | 用途 |
|-------|------|------|
| `accent.primary` | `#6366f1` | 主色 Indigo（按钮/高亮/品牌） |
| `accent.primarySoft` | `#6366f126` | 半透明 Indigo（高亮背景/激活态填充） |
| `accent.indigoLight` | `#818CF8` | Indigo 浅色（指示条/链接） |
| `accent.indigoPale` | `#a5b4fc` | Indigo 淡色 |
| `accent.violet` | `#8b5cf6` | Violet（渐变终点） |
| `accent.violetLight` | `#a78bfa` | Violet 浅色（标签文字/强调） |
| `accent.violetPale` | `#c4b5fd` | Violet 更浅 |
| `accent.violetMid` | `#9D85FF` | 紫色中间色 |
| `accent.gradient` | `90° linear: #6366f1 → #8b5cf6` | 品牌渐变（按钮/品牌名） |

#### 文字颜色
| Token | 色值 | 用途 |
|-------|------|------|
| `text.primary` | `#ffffff` | 主要文字 |
| `text.bright` | `#fafafa` | 极浅文字（接近白） |
| `text.body` | `#E8E8EC` | 浅色正文 |
| `text.secondary` | `#d4d4d8` | 描述文字 |
| `text.tertiary` | `#a1a1aa` / `#8b8b96` / `#8A8A95` | 次级辅助文字 |
| `text.label` | `#71717a` | 标签/辅助文字（最高频） |
| `text.muted` | `#e2e2e8` | 次要文字 |
| `text.dim` | `#ffffff80` | 半透明白文字 |
| `text.accent` | `#a78bfa` | accent 相关文字 |
| `text.accentLink` | `#818CF8` | 强调链接/标签 |

#### 功能色
| Token | 色值 | 用途 |
|-------|------|------|
| `success` | `#22C55E` / green-400 | 成功/完成 |
| `warning` | `yellow-500/yellow-300` | 警告 |
| `destructive` | `#E53935` / red-400 | 删除/错误 |
| `info` | `blue-400` | 信息/工具 |

### 1.2 字号系统
| Token | 字号 | 字重 | 用途 |
|-------|------|------|------|
| `text.xs` | 9px | 400/500 | 极小数字 |
| `text.tiny` | 10px | 400/500 | 超小标签/时间戳 |
| `text.sm` | 11px | 400/500/600 | **最常用**——标签/辅助文字 |
| `text.base` | 12px | 400 | 辅助信息 |
| `text.body` | 13px | 500/600 | 按钮/导航文字 |
| `text.md` | 14px | 400/500 | 标准正文 |
| `text.lg` | 15px | 400 | 特性描述 |
| `text.xl` | 16px | 600 | 次级标题 |
| `text.2xl` | 18px | 600/700 | 强调标题/品牌 |
| `text.3xl` | 20px | 600 | 品牌名 |
| `text.4xl` | 22px | 600/700 | 区块标题 |
| `text.5xl` | 28px | 700 | 卡片大标题 |
| `text.display` | 32px–64px | 700 | 页面/超大标题 |

### 1.3 字重
| 字重 | 用途 |
|------|------|
| 400 (normal) | 正文 |
| 500 (medium) | 次级强调 |
| 600 (semibold) | **最常用**——按钮/标签/标题 |
| 700 (bold) | 强调标题 |

### 1.4 圆角系统
| Token | 圆角 | 用途 |
|-------|------|------|
| `radius.micro` | 3px | 微圆角 |
| `radius.sm` | 4px | 小按钮/标签 |
| `radius.md` | 6px | 小卡片/按钮 |
| `radius.lg` | 8px | **最常用**——标准卡片 |
| `radius.input` | 10px | 输入框/表单 |
| `radius.xl` | 12px | 大卡片 |
| `radius.dialog` | 14px | 弹窗 |
| `radius.2xl` | 16px | 特殊大卡片/玻璃面板 |
| `radius.special` | 20px | 特殊卡片 |
| `radius.pill` | 100px | 胶囊按钮/Tag |

### 1.5 间距系统（Gap）
| 间距 | 用途频次 |
|------|---------|
| 2px | 紧凑间距 |
| 3px | 紧凑间距 |
| 4px | 小间距 |
| 6px | **高频** |
| 8px | **最常用**（300次） |
| 10px | **高频** |
| 12px | 中等间距 |
| 14px | 宽松间距 |
| 16px | 大间距 |
| 20px | 区块间距 |
| 24px | 大区块间距 |

### 1.6 内边距常用组合
| Padding [V, H] | 用途 |
|----------------|------|
| [10, 12] | 列表项/卡片内容（最常用） |
| [0, 16] | 宽内容左右间距 |
| [0, 10] | 紧凑内容 |
| [2, 8] | Tag/胶囊标签 |
| [8, 10] | 按钮/紧凑卡片 |
| [0, 12] | 标准左右间距 |
| [8, 12] | 按钮内边距 |
| [0, 14] | 宽松左右间距 |
| [3, 8] | 小Tag标签 |
| [10, 14] | 宽松按钮 |

### 1.7 效果
#### 玻璃拟态（Glass Morphism — 标准效果）
```
effect: [
  { type: "background_blur", radius: 20 },
  { type: "shadow", shadowType: "outer", offset: {x:0, y:4}, blur: 24, fill: "#00000080" }
]
```

#### 阴影
| 模糊半径 | 用途 |
|---------|------|
| 8px | 紧凑阴影 |
| 12px | 中等阴影 |
| 24px | 标准阴影（配合玻璃） |
| 32px | 大范围散射 |

### 1.8 渐变
| 名称 | 方向 | 起止色 |
|------|------|--------|
| 品牌渐变 | 90° | #6366f1 → #8b5cf6 |
| 背景渐变 | 135° | #0a0a0b → #13131a |
| 卡片渐变 | 135° | #1A1A22 → #222228 |

### 1.9 图标库
**Lucide**，高频图标：
`chevron-right`(展开) · `sparkles`(AI) · `check`(确认) · `brain`(思考/Agent) · `send`(发送) · `list`(大纲) · `user`(角色/用户) · `chevron-down`(折叠) · `book`(书籍) · `library`(书库) · `arrow-left`(返回) · `info`(信息) · `wrench`(配置) · `message-circle`(对话) · `copy`(复制) · `plus`(新增) · `x`(关闭) · `globe`(世界) · `pen-line`(编辑) · `book-open`(阅读) · `chart-bar`(统计)

### 1.10 字体
**Inter**（所有文字统一使用 Inter 字体，不使用 PingFang SC）。

---

## 2. 布局系统

### 2.1 页面尺寸
- 画布：**1440 × 900px**（标准设计帧）
- 内容区最大宽度：1280px（左右各 80px 留白）

### 2.2 页面布局类型

| 页面 | 布局类型 | 结构 |
|------|---------|------|
| 登录/注册 | 居中单卡 | 全屏渐变背景 + 居中卡片(max-w-sm) |
| 书库 | 双栏 | AppSidebar(60px) — 实际设计 200px + 主区(网格) |
| 知识库 | 双栏 | AppSidebar(200px) + 主区(列表) |
| 拆解 | 单栏全宽 | 无 Sidebar + 主区(网格) |
| 设置 | 双栏 | AppSidebar(200px) + 主区(滚动分区) |
| 工作区 | 三栏 | IconRail(56px) + ChatPanel(flex-1) + ResourcePanel(420px) |

> **注**：旧设计稿用 200px sidebar / 56px IconRail（代码是 240px / 48px），**以旧设计稿为准**。

### 2.3 栅格
- 书库卡片网格：`grid-cols-3`（1440px 画布），间距 gap 16-20px
- 拆解卡片网格：同上
- 卡片尺寸：约 196×300px（书库）

---

## 3. 可复用组件规范

### 3.1 AppSidebar（200px）
- 宽 200px，`border-r` 1px `#ffffff14`
- 背景：`#0F0F13` 或半透明叠加
- 顶部：品牌区（Logo + "narratox" 渐变文字 18px 600）
- 导航项：高 36-40px，padding [0, 12]
  - **激活态**：fill `#6366f126`，左侧 2px 指示条 `#818CF8`（inside），文字 600 `#ffffff`
  - **普通态**：fill transparent，文字 normal `#a1a1aa`
  - **hover**：fill `#ffffff0a`
- 底部：登出按钮

### 3.2 IconRail（56px，工作区专用）
- 宽 56px，`border-r` 1px `#ffffff14`
- 背景：`#1A1A22`
- 顶部：返回按钮（`arrow-left`，brand 色）
- 分隔线：1px `#ffffff0a`，宽 24px 居中
- 资源图标按钮：48×48px，Lucide 图标
  - **激活态**：左侧 2px 指示条 `#818CF8`，fill `#6366f126`，图标高亮
  - **普通态**：opacity 50%，hover → opacity 100% + fill `#ffffff0a`
- 底部：作者画像 + 登出

### 3.3 NovelCard（书库卡片）
- 尺寸：约 196×300px
- 背景：`#1A1A22`，圆角 8px
- border：1px `#ffffff14`，hover → `#6366f140`
- 结构：
  - 顶部渐变封面区（彩色渐变，不同小说不同色）
  - 状态标签（写作中 `#6366f126`/构思中 `#ffffff0f`）
  - 标题 16px 600 `#ffffff`
  - 类型副标题 11px `#71717a`
  - 简介 11px `#a1a1aa`（3 行截断）
  - 底部更新时间 10px `#71717a`
  - 右上角 hover 显示 ⋮ 菜单

### 3.4 按钮
#### 主按钮（渐变胶囊）
```
fill: gradient(90°, #6366f1, #8b5cf6)
cornerRadius: 100 (pill) 或 8 (标准)
text: #ffffff, 13px, fontWeight 600
padding: [8, 12] 或 [10, 14]
```

#### 次按钮（边框）
```
fill: transparent
stroke: 1px #ffffff14
cornerRadius: 100 或 8
text: #E8E8EC, 13px, fontWeight 500
```

#### Ghost 按钮
```
fill: transparent
cornerRadius: 8
text: #a1a1aa, 13px, fontWeight 500
hover fill: #ffffff0a
```

#### Destructive 按钮
```
fill: #E5393520 (淡红)
stroke: 1px #E5393540
text: #E53935 或 #f87171
```

### 3.5 输入框
```
fill: #1A1A22 或 #ffffff08
stroke: 1px #ffffff14 (focus → #6366f1)
cornerRadius: 10px
text: #ffffff, 14px
padding: [10, 12]
placeholder: #71717a
```

### 3.6 Tag / Badge
```
padding: [2, 8] 或 [3, 8]
cornerRadius: 100 (pill) 或 4
fontSize: 10-11px
fontWeight: 500
```
- Accent tag: fill `#6366f126`, text `#a78bfa`
- Neutral tag: fill `#ffffff0f`, text `#a1a1aa`
- Success: fill `#22C55E20`, text `#22C55E`
- Warning: fill `#F59E0B20`, text `#FBBF24`

### 3.7 弹窗（Dialog）
```
overlay: #00000080 (半透明黑遮罩)
dialog fill: #1A1A22 或 #13131a
cornerRadius: 14px
padding: 24px
shadow: blur 32px #00000080
title: 18px 600 #ffffff
body: 14px #d4d4d8
```

### 3.8 思考块/工具块（Chat 活动行）
```
fill: #ffffff08
cornerRadius: 8px
padding: [10, 12]
border-left 或 icon 区: accent 色
标签文字: 11px 600 (purple-400 think / blue-400 tool / brand content)
内容: 11px #a1a1aa
```

---

## 4. 页面详细设计

### 4.1 登录页 `/login`
**布局**：全屏渐变背景(#0a0a0b→#13131a) + 居中卡片

**结构**：
- 背景：135° 渐变 `#0a0a0b → #13131a`
- 卡片：max-w-sm(384px)，bg `#1A1A22`，圆角 16px，border 1px `#ffffff14`，shadow blur 24px
- 卡片内容（从上到下）：
  - 标题 "登录" 18px 600 `#ffffff`
  - 副标题 "输入账号信息继续" 11px `#71717a`
  - 邮箱输入框
  - 密码输入框
  - 主按钮 "登录"（full width，渐变 `#6366f1→#8b5cf6`，pill）
  - 底部链接 "没有账号？注册" 11px

**状态**：
- 默认 | loading（按钮文字 → "登录中…"，按钮 disabled）

### 4.2 注册页 `/register`
**布局**：同登录页

**结构**：
- 卡片内容：
  - 标题 "注册"
  - 副标题 "创建账号开始写作"
  - 昵称输入框
  - 邮箱输入框
  - 密码输入框
  - 主按钮 "注册"
  - 底部链接 "已有账号？登录"

### 4.3 书库 `/`（主页）
**布局**：`[AppSidebar 200px] [主区 flex-1]`

**主区结构**：
- 顶栏（padding [0, 24]）：
  - 左：标题 "我的小说" 18px 600
  - 右：主按钮 "+ 新建小说"（渐变 pill）
- 内容区：卡片网格 `grid-cols-3`，gap 16px，padding [0, 24]

**卡片网格**：
- 3 列 × N 行，每张约 196×300px
- 每张卡片（彩色渐变封面）：
  - 封面区（上部 60%）：不同小说不同渐变色
    - 紫色渐变 `#6366f1→#8b5cf6`
    - 蓝色渐变 `#3b82f6→#6366f1`
    - 橙色渐变 `#f59e0b→#ef4444`
    - 粉色渐变 `#ec4899→#8b5cf6`
    - 绿色渐变 `#10b981→#06b6d4`
  - 封面上叠：状态标签（构思中/写作中）
  - 信息区（下部 40%）：
    - 标题 14px 600
    - 类型 11px `#71717a`
    - 简介 11px `#a1a1aa`（2-3行）
    - 底部更新时间 10px `#71717a`

**状态**：
- **加载中**：骨架屏（灰色卡片占位）
- **空状态**：居中文字 "还没有小说，点击「新建小说」开始" + 空状态图标
- **卡片 hover**：显示右上角 ⋮ 菜单
  - 菜单项："发布" / "删除"（红色）

**弹窗**：
- **删除确认弹窗**：标题 "删除《X》?"，描述 "此操作不可撤销"，取消/删除按钮
- **发布弹窗**（PublishDialog）：章节选择范围(from-to) + 选项(标题/简介/缩进) + 复制按钮

### 4.4 知识库 `/knowledge`
**布局**：`[AppSidebar 200px] [主区 flex-1]`

**主区结构**：
- 顶栏：标题 "写作知识库" 18px 600 + 后端状态
- 内容区：分类浏览 + 搜索
  - 分类标签行（6 类：教程/拆书/技巧/资源/案例/工具）
  - 条目列表/卡片网格
  - 每条目：标题 + tags + 摘要 + 🧠思考标记

### 4.5 拆解 `/dissect`
**布局**：**单栏全宽**（无 AppSidebar）

**主区结构**：
- 顶栏：
  - 左：标题 "对标拆解" 18px 600 + 副标题
  - 右：主按钮 "+ 上传小说"
- 内容区：卡片网格 `grid-cols-3`

**拆解卡片**：
- 背景 `#1A1A22`，圆角 8px，border `#ffffff14`，padding 20px
- 结构：
  - 标题 16px 600 + 状态标签
  - 状态标签颜色映射：
    - PENDING(待确认)：`#ffffff0f` / `#a1a1aa`
    - RUNNING(拆解中)：`#6366f126` / `#a78bfa`
    - DONE(完成)：`#22C55E20` / `#22C55E`
    - FAILED(失败)：`#E5393520` / destructive
    - INTERRUPTED(中断)：`#F59E0B20` / `#FBBF24`
  - 进度文字（RUNNING 时）："第 N/M 章 · agent名"
  - 元信息："N 章 · 日期"
  - 操作按钮行（根据状态）：
    - DONE → "浏览结果"
    - RUNNING/PENDING → "查看日志"
    - FAILED/INTERRUPTED → "重试"
    - 所有 → "删除"

**弹窗**：
- **上传确认弹窗**：标题编辑框 + ⚠ token 预估警告框（黄色调）+ 取消/开始拆解
- **日志抽屉弹窗**（LogDrawer，max-w-2xl）：
  - 标题 "拆解日志"
  - 等宽字体日志区（黑底 `#0F0F13`）
  - 每行：`时间 [标签] 内容`（标签彩色：think=purple, tool=blue, content=white, stage=brand, error=red, info=gray）
  - 底部 "▌ 拆解中…" 闪烁光标
  - 关闭按钮
- **结果浏览弹窗**（ResultBrowser，max-w-3xl）：
  - 标题 "《X》拆解结果"
  - 6 个分区（按顺序）：文风/节奏/情绪/角色/剧情/章节摘要
  - 每区：分区标题（brand 色）+ 条目卡片列表
  - 条目卡片：标题 + 章节标记 + 内容正文
- **删除确认弹窗**：标题 + 警告文字 + 取消/删除

### 4.6 设置 `/settings`
**布局**：`[AppSidebar 200px] [主区 flex-1 滚动]`

**主区结构**（纵向滚动，非 tab 切换）：
- 顶栏：标题 "设置" 18px 600 + 后端状态
- **Section 1：模型设置**（ModelSettings）
  - 区块标题 "模型设置" 14px 600
  - Vendor 卡片列表（OpenAI / Anthropic / Google / GLM / DeepSeek / Moonshot / Qwen 等）：
    - 每个 vendor 一个卡片：图标 + 名称 + 折叠模型行
    - 模型行：名称 + API Key 状态 + 激活/编辑/删除
  - "添加模型" 按钮
- **Section 2：Agent 模型配置**（AgentModelSettings）
  - 区块标题 "Agent 模型配置"
  - 入口卡片：当前配置摘要 + "配置" 按钮
  - 弹窗内：Agent 列表（按 phase 分组），每个 agent 一个行
    - tier 标签：🔴 strong / 🟡 mid / 💚 cheap
- **Section 3：作者画像**（VoiceProfileList）
  - 区块标题 "作者画像" + 描述
  - 画像卡片网格（2 列）：
    - 每个画像：名称 + 文风描述 + 编辑/预览切换
- **弹窗**：
  - VendorFormDialog（添加/编辑 vendor）
  - ModelFormDialog（添加/编辑 model）
  - AgentModelDialog（agent tier 配置）
  - VoiceProfileEditor（画像编辑/预览）

### 4.7 工作区 `/novels/[id]`（核心页面）
**布局**：`[IconRail 56px] [ChatPanel flex-1] [ResourcePanel 420px]`

#### 4.7.1 IconRail（左栏 56px）
- 背景 `#1A1A22`，border-r `#ffffff14`
- 顶部：← 返回按钮（brand 色 Indigo）
- 分隔线
- 资源图标列表（从上到下）：
  - ℹ️ 小说信息 (info)
  - 🌍 世界观 (worldview)
  - 📚 参考资料 (references)
  - 📝 大纲 (outline)
  - 📖 正文 (chapters)
  - 👤 角色 (characters)
  - 📊 状态/伏笔 (status)
  - 📅 事件时间线 (events)
  - 📊 态势 (overview)
- 分隔线
- 底部：🎭 作者画像 (voiceProfile) + ⏻ 登出

> **注**：旧设计稿使用 Lucide 图标而非 emoji。设计时统一用 Lucide：`info`/`globe`/`library`/`list`/`book-open`/`user`/`bookmark`/`calendar`/`chart-bar`/`sparkles`/`log-out`

#### 4.7.2 ChatPanel（中栏 flex-1）
- 背景 `#0a0a0b` 或渐变
- **顶栏**（h~36px，padding [0, 20]）：
  - 左："💬 聊天 · 一本小说一份记忆" 11px `#71717a`
  - 右："📍 phase" 11px `#71717a`（当前阶段标识）
- **消息区**（flex-1 overflow-y-auto）：
  - 用户消息：右对齐气泡或无气泡行
  - Agent 消息：左对齐
  - **活动行**（thinking/tool/content 流式）：
    - 思考行：紫色标签 [think]，bg `#ffffff08`
    - 工具行：蓝色标签 [tool]，bg `#ffffff08`
    - 内容行：brand/white 文字
    - 子agent/stage 行：brand 色 [stage]
  - 记忆标签（settler 结算后）：附在最后一条 agent 消息上
- **输入区**（底部 sticky）：
  - padding [0, 16, 8, 16]
  - 输入框 bg `#1A1A22`，圆角 10px，border `#ffffff14`
  - 发送按钮：brand 渐变 pill
  - streaming 时禁用 + 显示加载状态

#### 4.7.3 ResourcePanel（右栏 420px，条件显示）
- 宽 420px，border-l `#ffffff14`，bg `#0a0a0b` 或 `#13131a`
- **面板头**（padding [12, 16]）：
  - 左：面板标题 13px 600
  - 右：× 关闭按钮
- **内容区**（flex-1 overflow-y-auto，padding [0, 16, 24, 16]）
- 10 个条件视图（通过 IconRail 选择切换）：

**① 小说信息 (info)**
- 键值对列表：书名/类型/简介/核心冲突/每章字数目标/文风
- 每项：label 10px uppercase `#71717a` → value 13px `#E8E8EC`
- 底部提示 "信息卡 · 由 Agent 通过 update_novel 自动填充"

**② 世界观 (worldview)**
- 按类型分组（8 类）：设定/总览 · 力量体系 · 规则/禁忌 · 地点 · 势力/组织 · 种族/生物 · 物品/资源 · 历史/传说
- 每类标题：11px uppercase `#71717a` + 条目数
- 每条目：可折叠卡片
  - 折叠态：名称 + ▶
  - 展开态：名称 + ▼ + Markdown 内容
- 空状态："世界观尚未构建。在聊天里让 Agent 构建世界观…"

**③ 参考资料 (references)**
- 有 tag 的条目置顶（badge 全角色友好名）
- 条目卡片列表
- 【按需索引】场景→库条目标题+分类

**④ 大纲 (outline)**
- 【总纲】区（brand 色边框折叠卡）：
  - 故事核/主线/结局/力量进阶/暗线/卷划分
  - 三幕（act2Turn 标红"灵魂黑夜"）
- 卷列表（可折叠）：
  - 卷标题 ▶/▼ + written/total 计数
  - 展开内：目标/承上启下/主线推进 + 章节细纲卡列表
- 【弧线】区
- 【未分卷】区
- **章节细纲卡**（ChapterPlanCard）：
  - 折叠态：第 N 章 · 标题 + 状态(✓已写/○已确认/○细纲)
  - 展开态：开篇[CBN] / 情N[CPNS] / 结尾[CEN] + ✓必须 / ✗禁区 + "跳到该章正文"
  - 当前正在写的章：brand 色高亮 border
- 空状态："大纲尚未生成…"

**⑤ 正文 (chapters)**
- 翻页头：‹ 第 N 章 · 标题 › + 📋复制 + ☰目录
- 元信息行：状态标签(已写入/草稿) + 字数
- 目录弹出（TOC）：章列表，当前章高亮，写作中章 brand 色
- **AI 写作中**：
  - 骨架屏（6 行灰色 animate-pulse 渐变宽度条）
  - "第 N 章 · AI 写作中…"
- **写作跳转药丸**（WritingPill）：brand 色边框，"✍ AI 正写第 N 章 → 跳转 ›"
- 正文内容：Markdown 渲染
- 空状态："立项中,信息收集完成后开始写作" / "本章还没有内容"

**⑥ 角色 (characters)**
- 按 role 分组（主角/反派/配角），每组：标题 + 计数
- 角色卡（可折叠）：
  - 折叠态：名称 + 别名 + 性格基调:XX · 动机:XX
  - 展开态三区：
    - **档案**（9 字段）：出身/背景 · 成长经历 · 外貌 · 性格基调 · 执念/动机 · 弱点 · 弧光目标 · 语言风格 · 阵营
    - **当前态**（派生）：字段名:值 (第N章)
    - **变化时间线**：第N章 ★MAJOR 字段:值 (原因)
- 空状态："角色尚未建立…"

**⑦ 伏笔 (status/hooks)**
- 4 分组：
  - ★ 核心伏笔（brand 色）
  - ⚠️ 陈久未推进（brand 色）
  - 进行中（灰色）
  - 已回收（灰色半透明，删除线）
- **伏笔卡**（HookCard）：
  - ★（核心）+ 描述 + payoffTiming 标签 + ⚠️陈旧 / ✓已回收
  - 底部：始于第N章 · 推进N次 · 回收于第N章 · 依赖N个未回收
- 空状态："伏笔将在写作时由 settler 自动提取…"

**⑧ 事件时间线 (events)**
- 按 chapterOrder 分组（升序），组内 MAJOR 在前
- 每组：第 N 章 · 条目数
- **事件卡**（EventCard）：
  - MAJOR：brand 色边框 + "★ MAJOR"
  - minor：普通边框 + "· minor"
  - kind 标签 + 描述
  - 👥角色 · 📍地点
  - 🪝 关联伏笔
- 空状态："事件由 settler 每章自动提取…"

**⑨ 态势 (overview)**
- 进度卡：字数 · 章数 · frontier · 目标章数 + 当前卷/弧
- 立项检查清单：基础/参考/世界/大纲/弧/角色（✓/✗ brand 色）
- 大纲覆盖：N卷 / N弧 · 细纲已规划N章 · 距frontier剩N章
- 健康：开放伏笔 · MAJOR事件
- **下一步**（brand 色高亮卡）：近期phase + nextStep

**⑩ 作者画像 (voiceProfile)**
- 画像编辑/预览视图

---

## 5. 完整交互状态清单

### 5.1 全局状态
| 状态 | 触发 | 表现 |
|------|------|------|
| 未认证 | 无 token | 重定向到 /login |
| 加载中 | 页面初始/数据请求 | 骨架屏或 "加载中…" 11px `#71717a` |
| 后端离线 | status ≠ 200 | "离线 (503)" 红色标识 |
| 错误 toast | 操作失败 | 顶部红色提示条 |

### 5.2 书库状态
| 状态 | 表现 |
|------|------|
| 加载中 | "加载中…" |
| 空列表 | "还没有小说，点击「新建小说」开始" |
| 卡片 hover | 显示 ⋮ 菜单 + border 变 brand 色 |
| 删除确认弹窗 | Dialog |
| 发布弹窗 | PublishDialog |

### 5.3 工作区状态
| 状态 | 表现 |
|------|------|
| CONCEPT 立项中 | 默认显示 info 面板 + 正文面板 "立项中" |
| ACTIVE 写作中 | 默认显示最新章 + 态势面板可查看 |
| AI streaming | ChatPanel 活动行流式 + 输入框禁用 |
| 章节写作中 | 正文面板骨架屏 + WritingPill 跳转 |
| 跟随效应 | agent 写第 K 章 → 自动切到 chapters + 跳到第 K 章（除非 manualLock）|
| 记忆结算 | settler 完成 → 最后一条 agent 消息挂记忆标签 |
| 面板关闭 | ResourcePanel 完全隐藏（仅 ChatPanel + IconRail） |

### 5.4 拆解状态
| 状态 | 表现 |
|------|------|
| 上传确认 | 弹窗（标题编辑 + token 预估警告）|
| RUNNING 轮询 | 5s 间隔自动刷新卡片状态/进度 |
| 日志流式 | LogDrawer 实时滚动 + ▌光标闪烁 |
| 拆解完成 | 卡片状态 → ✓ 完成 + 出现"浏览结果"按钮 |
| 拆解失败 | 卡片状态 → ⚠ 失败 + 出现"重试"按钮 |

### 5.5 设置状态
| 状态 | 表现 |
|------|------|
| Vendor 表单弹窗 | 新增/编辑 vendor 配置 |
| Model 表单弹窗 | 新增/编辑 model 配置 |
| Agent tier 弹窗 | phase 分组 agent 行 + tier 标签 |
| 画像编辑 | 编辑/预览 toggle |

---

## 6. Pencil MCP v1.1.68 技术注意事项

### 6.1 DSL 语法（关键变更）
- 操作用**全名**：`Insert` / `Update` / `Delete` / `Move` / `Copy`（**不是** I/U/D/M/C）
- 参数名用 **`input`**（**不是** `operations`）
- 图标类型 `icon`，属性 `library:"lucide", icon:"名称"`（**不是** icon_font / iconFontFamily）
- stroke 用**扁平格式**：`strokeWidth:N, stroke:"color"`（**不是** `{thickness:{left:2}, fill, align:"inside"}`）
- text 节点**不能**有 padding/cornerRadius
- 所有文字用 **Inter** 字体

### 6.2 操作模板
```
// 插入
Insert: { id, type, props... }

// 更新（合并式）
Update: { id, props... }

// 删除
Delete: { id }

// 移动（改变 parent/顺序）
Move: { id, parentId, index }

// Copy 有已知 bug（第二参数不支持 string ID），避免使用
```

### 6.3 长提示处理
- 长提示/大批量操作 → 写到文件再读取，不要直接粘贴到对话

### 6.4 设计帧组织
- 每个页面/状态一个独立帧（frame）
- 帧尺寸 1440×900px（标准页面）或按需（弹窗帧可单独）
- 帧命名规则：`01 Auth Login` / `02 Library Main` / `03 Workspace Idle` 等
- 帧排列：横向 1600px 间距，纵向 1000px 间距，按页面分类分行

---

## 7. 设计帧清单（35 帧重建计划）

### Row 1: 认证 (2帧)
1. `01 Auth Login` — 登录页默认
2. `02 Auth Register` — 注册页默认

### Row 2: 书库 (4帧)
3. `03 Library Main` — 书库主页（卡片网格）
4. `04 Library Empty` — 空状态
5. `05 Library Card Menu` — 卡片 hover ⋮ 菜单 + 删除弹窗
6. `06 Library Publish` — 发布弹窗

### Row 3: 知识库 (1帧)
7. `07 Knowledge Main` — 知识库浏览

### Row 4: 拆解 (4帧)
8. `08 Dissect Main` — 拆解主页
9. `09 Dissect Upload Confirm` — 上传确认弹窗
10. `10 Dissect Log Drawer` — 日志抽屉
11. `11 Dissect Result Browser` — 结果浏览

### Row 5: 设置 (5帧)
12. `12 Settings Main` — 设置主页（全滚动）
13. `13 Settings Model Dialog` — 模型编辑弹窗
14. `14 Settings Agent Model` — Agent 模型配置弹窗
15. `15 Settings Voice Editor` — 画像编辑
16. `16 Settings Empty` — 首次空状态

### Row 6: 工作区核心 (6帧)
17. `17 Workspace Concept` — CONCEPT 立项阶段（info 面板默认）
18. `18 Workspace Active Idle` — ACTIVE 写作态空闲
19. `19 Workspace Streaming` — AI 流式输出中（活动行）
20. `20 Workspace Chapter Skeleton` — 章节骨架加载
21. `21 Workspace Outline` — 大纲面板展开
22. `22 Workspace Empty Resource` — 空资源面板

### Row 7: 资源面板视图 (8帧)
23. `23 RP Characters` — 角色面板
24. `24 RP Worldview` — 世界观面板
25. `25 RP Hooks` — 伏笔面板
26. `26 RP Events` — 事件时间线
27. `27 RP Overview` — 态势面板
28. `28 RP References` — 参考资料面板
29. `29 RP Chapters TOC` — 正文目录
30. `30 RP Voice Profile` — 作者画像

### Row 8: 组件参考 (5帧)
31. `31 Comp Buttons` — 按钮全集
32. `32 Comp Cards` — 卡片全集
33. `33 Comp Tags Badges` — 标签/徽章全集
34. `34 Comp Inputs` — 输入控件全集
35. `35 Comp Chat Activities` — 聊天活动行类型

---

## 8. 后续步骤

1. **Step 3**：调用 `superpowers:writing-plans`，将本规范分解为分步实施计划
2. **Step 4**：使用 Pencil MCP v1.1.68 逐帧创建设计：
   - 新建 `.pen` 文件
   - `set_variables` 设置 design tokens
   - 逐帧 `batch_design` 创建
   - 每帧 `export_nodes` 截图验证
