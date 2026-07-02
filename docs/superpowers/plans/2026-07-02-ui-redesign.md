# Narratox UI 全量重新设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从零重建全部 35 个 UI 设计帧（旧 .pen 文件已丢失），覆盖 7 个页面路由 + 所有交互状态/弹窗/空状态。

**Architecture:** 先建 .pen 文件 + design tokens 变量 → 再建组件参考帧（Row 8）确立样式 → 逐行创建页面帧（Row 1-7）→ 每帧 export 截图验证。所有 design tokens 来自 `/tmp/pencil-design-tokens-reference.md`（旧 Pencil 实际操作记录），非代码 CSS。

**Tech Stack:** Pencil MCP v1.1.68（DSL 全名 Insert/Update/Delete/Move、`input` 参数、Lucide icon、扁平 stroke、Inter 字体、text 节点无 padding/cornerRadius）。

**Spec:** `docs/superpowers/specs/2026-07-02-ui-redesign-design.md`

---

## 帧画布坐标图

所有帧 1440×900px，间距：横向 1600px，纵向 1000px。

```
Row 1 (y=0):     Auth     [0,0]                    [1600,0]
Row 2 (y=1000):  Library  [0,1000] [1600] [3200] [4800]
Row 3 (y=2000):  Knowledge [0,2000]
Row 4 (y=3000):  Dissect  [0,3000] [1600] [3200] [4800]
Row 5 (y=4000):  Settings [0,4000] [1600] [3200] [4800] [6400]
Row 6 (y=5000):  Workspace [0,5000] [1600] [3200] [4800] [6400] [8000]
Row 7 (y=6000):  Resource Panels [0,6000] [1600] [3200] [4800] [6400] [8000] [9600] [11200]
Row 8 (y=7000):  Components [0,7000] [1600] [3200] [4800] [6400]
```

---

## Task 1: 初始化 .pen 文件 + Design Token 变量

**目标**：创建新 .pen 文件，设置 design token 变量，创建 35 个空帧占位（带名称）。

- [ ] **Step 1: 创建新 .pen 文件**

调用 Pencil MCP `create_file`，路径 `~/carpenter-app.pen`。

- [ ] **Step 2: 设置 design token 变量**

调用 `set_variables`，设置以下变量（来自 spec 第 1 节）：

```
颜色变量：
  bg_base:        #0a0a0b
  bg_darkest:     #0F0F13
  bg_dark:        #13131a
  bg_card:        #1A1A22
  bg_card_elev:   #2A2A35
  bg_raised:      #252530

  overlay_5:      #ffffff0a
  overlay_6:      #ffffff08
  overlay_10:     #ffffff0f
  overlay_15:     #ffffff14

  accent_primary:    #6366f1
  accent_primary_soft: #6366f126
  accent_indigo_lt:  #818CF8
  accent_indigo_pal: #a5b4fc
  accent_violet:     #8b5cf6
  accent_violet_lt:  #a78bfa
  accent_violet_pal: #c4b5fd
  accent_violet_mid: #9D85FF

  text_primary:   #ffffff
  text_bright:    #fafafa
  text_body:      #E8E8EC
  text_secondary: #d4d4d8
  text_tertiary:  #a1a1aa
  text_label:     #71717a

  success:        #22C55E
  warning:        #F59E0B
  destructive:    #E53935
  info_blue:      #60A5FA

字号变量：
  text_xs:      9px
  text_tiny:    10px
  text_sm:      11px
  text_base:    12px
  text_body_sz: 13px
  text_md:      14px
  text_lg:      15px
  text_xl:      16px
  text_2xl:     18px
  text_3xl:     20px
  text_4xl:     22px
  text_5xl:     28px

圆角变量：
  radius_sm:    4px
  radius_md:    6px
  radius_lg:    8px
  radius_input: 10px
  radius_xl:    12px
  radius_dialog: 14px
  radius_2xl:   16px
  radius_pill:  100px
```

- [ ] **Step 3: 创建 35 个命名帧占位**

调用 `batch_design`，用 Insert 操作创建 35 个 frame 节点（仅 frame 外壳 + 名称，不含内容）。每个 frame：`type:"frame", width:1440, height:900`，坐标按帧画布坐标图。

帧命名列表（与 spec 第 7 节完全对应）：
```
Row 1: "01 Auth Login", "02 Auth Register"
Row 2: "03 Library Main", "04 Library Empty", "05 Library Card Menu", "06 Library Publish"
Row 3: "07 Knowledge Main"
Row 4: "08 Dissect Main", "09 Dissect Upload Confirm", "10 Dissect Log Drawer", "11 Dissect Result Browser"
Row 5: "12 Settings Main", "13 Settings Model Dialog", "14 Settings Agent Model", "15 Settings Voice Editor", "16 Settings Empty"
Row 6: "17 Workspace Concept", "18 Workspace Active Idle", "19 Workspace Streaming", "20 Workspace Chapter Skeleton", "21 Workspace Outline", "22 Workspace Empty Resource"
Row 7: "23 RP Characters", "24 RP Worldview", "25 RP Hooks", "26 RP Events", "27 RP Overview", "28 RP References", "29 RP Chapters TOC", "30 RP Voice Profile"
Row 8: "31 Comp Buttons", "32 Comp Cards", "33 Comp Tags Badges", "34 Comp Inputs", "35 Comp Chat Activities"
```

- [ ] **Step 4: 验证帧创建**

调用 `snapshot_layout` 确认 35 个帧都在正确坐标。调用 `export_nodes` 导出第一个帧确认空白帧渲染正常。

---

## Task 2: 组件参考帧（Row 8, 帧 31-35）

**目标**：先建组件参考帧，确立所有可复用组件的样式标准。后续页面帧直接参照这些组件。

**帧位置**：y=7000，x=0/1600/3200/4800/6400

### 帧 31: Comp Buttons (x=0, y=7000)

- [ ] **Step 1: 创建背景**

frame 内插入全屏 rect：`fill:#13131a`。顶部标题文字 "Buttons" 22px 700 `#ffffff`。

- [ ] **Step 2: 创建主按钮组（渐变胶囊）**

4 个主按钮纵向排列（y=100, 150, 200, 250），每个：
```
type: rect
width: 160, height: 40
fill: linearGradient(90°, #6366f1, #8b5cf6)
cornerRadius: 100
内含 text: #ffffff, 13px, fontWeight:600
文字: "登录" / "新建小说" / "开始拆解" / "发送"
```

- [ ] **Step 3: 创建次按钮组（边框）**

4 个次按钮（y=350, 400, 450, 500）：
```
type: rect
width: 160, height: 40
fill: transparent
strokeWidth: 1, stroke: #ffffff14
cornerRadius: 100
text: #E8E8EC, 13px, 500
文字: "取消" / "浏览结果" / "查看日志" / "关闭"
```

- [ ] **Step 4: 创建 Ghost + Destructive 按钮**

Ghost 按钮 2 个（y=550, 600）：
```
fill: transparent, cornerRadius:8, text:#a1a1aa 13px 500
文字: "删除" / "登出"
```

Destructive 按钮 2 个（y=650, 700）：
```
fill: #E5393520, strokeWidth:1 stroke:#E5393540, cornerRadius:8
text: #f87171 13px 600
文字: "删除" / "移除"
```

- [ ] **Step 5: 导出验证**

`export_nodes` 帧 31 → `/tmp/pencil-verify/31-buttons.png` (2x)。检查：4 种按钮样式渲染正确，渐变方向正确。

### 帧 32: Comp Cards (x=1600, y=7000)

- [ ] **Step 1: 创建背景 + 标题**

背景 `#13131a`，标题 "Cards" 22px 700。

- [ ] **Step 2: 创建标准卡片（NovelCard 样式）**

1 张完整小说卡片（x=60, y=100），196×300px：
```
外框: rect, fill:#1A1A22, cornerRadius:8, strokeWidth:1 stroke:#ffffff14
封面区: rect(0,0,196,180), fill: linearGradient(135°,#6366f1,#8b5cf6)
状态标签: rect 右上角, fill:#6366f126, cornerRadius:4, text:"写作中" #a78bfa 10px 500
标题: text "星河彼岸" 16px 600 #ffffff (y=200)
类型: text "科幻 · 赛博朋克" 11px #71717a (y=224)
简介: text 3行 #a1a1aa 11px (y=246)
时间: text "2024-01-15" 10px #71717a (y=282)
```

- [ ] **Step 3: 创建深色卡片（bg_card_elev）**

1 张 elevated 卡片（x=300, y=100），196×200px：
```
fill: #2A2A35, cornerRadius:8, strokeWidth:1 stroke:#ffffff14
标题: text "拆解卡片" 16px 600 #ffffff
状态标签: fill:#22C55E20 text:"✓ 完成" #22C55E 10px
元信息: "12 章 · 2024-01-10" 11px #71717a
```

- [ ] **Step 4: 创建思考块/活动行卡片**

3 个活动行卡片（y=350, 400, 450），每个 width=400 height=36：
```
fill: #ffffff08, cornerRadius:8, padding:[10,12]
标签: 11px 600 — think: #c084fc("think"), tool: #60A5FA("tool"), content: #ffffff("content")
内容: 11px #a1a1aa
示例文字: "分析用户意图…" / "get_outline({id:123})" / "好的,我来帮你规划大纲…"
```

- [ ] **Step 5: 导出验证**

`export_nodes` → `/tmp/pencil-verify/32-cards.png`。

### 帧 33: Comp Tags Badges (x=3200, y=7000)

- [ ] **Step 1: 创建背景 + 标题**

- [ ] **Step 2: 创建标签矩阵**

6 行标签，每行 4 个标签变体：
```
Row 1 - Accent tags:  fill:#6366f126 text:#a78bfa  → "写作中" "拆解中" "ACTIVE" "Agent"
Row 2 - Neutral tags: fill:#ffffff0f text:#a1a1aa  → "构思中" "PENDING" "草稿" "默认"
Row 3 - Success:      fill:#22C55E20 text:#22C55E → "完成" "已写入" "✓已回收" "在线"
Row 4 - Warning:      fill:#F59E0B20 text:#FBBF24 → "陈旧" "中断" "⚠警告" "离线"
Row 5 - Destructive:  fill:#E5393520 text:#f87171 → "失败" "★ MAJOR" "删除" "错误"
Row 6 - Tier badges:  → "🔴 strong" "🟡 mid" "💚 cheap" "MAJOR"
```
每个标签：padding [3,8]，cornerRadius:100，fontSize:10-11px，fontWeight:500。

- [ ] **Step 3: 导出验证**

`export_nodes` → `/tmp/pencil-verify/33-tags.png`。

### 帧 34: Comp Inputs (x=4800, y=7000)

- [ ] **Step 1: 创建背景 + 标题**

- [ ] **Step 2: 创建标准输入框**

3 个输入框（y=100, 160, 220），width=300 height=40：
```
fill: #1A1A22, strokeWidth:1 stroke:#ffffff14, cornerRadius:10
placeholder text: #71717a 14px — "邮箱" / "密码" / "搜索…"
```

- [ ] **Step 3: 创建 Focus 状态输入框**

1 个输入框 focus 状态（y=280）：
```
fill: #1A1A22, strokeWidth:2 stroke:#6366f1, cornerRadius:10
text: "user@example.com" #ffffff 14px
```

- [ ] **Step 4: 创建 Chat 输入框**

1 个聊天输入框（y=340），width=500 height=48：
```
fill: #1A1A22, strokeWidth:1 stroke:#ffffff14, cornerRadius:10
placeholder: "输入消息…" #71717a 13px
右侧发送按钮: rect, gradient(90°,#6366f1,#8b5cf6), cornerRadius:100, icon: send
```

- [ ] **Step 5: 创建 Textarea（编辑模式）**

1 个大文本区（y=420），width=400 height=120：
```
fill: #ffffff08, strokeWidth:1 stroke:#ffffff14, cornerRadius:10
text: "多行文本编辑区…" #d4d4d8 13px
```

- [ ] **Step 6: 导出验证**

`export_nodes` → `/tmp/pencil-verify/34-inputs.png`。

### 帧 35: Comp Chat Activities (x=6400, y=7000)

- [ ] **Step 1: 创建背景 + 标题**

背景 `#0a0a0b`，标题 "Chat Activities" 22px 700。

- [ ] **Step 2: 创建用户消息**

1 条用户消息（y=100）：
```
右对齐布局
气泡: rect, fill:#6366f1, cornerRadius:12, width:300
text: "帮我写第一章" #ffffff 14px
```

- [ ] **Step 3: 创建 5 种活动行**

5 个活动行（y=160, 210, 260, 310, 360），每个 width=600 height=36：
```
1. think 行:  fill:#ffffff08, 标签"think" #c084fc, 内容"分析当前态势…" #a1a1aa
2. tool 行:   fill:#ffffff08, 标签"tool" #60A5FA, 内容"get_outline({novelId:xxx})" #a1a1aa
3. stage 行:  fill:#ffffff08, 标签"stage" #a78bfa, 内容"CHAPTER_ORCH 委派写作…" #a1a1aa
4. content 行: fill:transparent, 标签"content" #ffffff, 内容"好的,让我来规划…" #E8E8EC
5. result 行: fill:#ffffff08, 标签"result" #22C55E, 内容"set_chapter_plan ✓ 完成" #a1a1aa
```

- [ ] **Step 4: 创建记忆标签**

1 个记忆标签（y=420）：
```
rect, fill:#6366f126, strokeWidth:1 stroke:#6366f140, cornerRadius:6
icon: brain (purple)
text: "第 5 章已结算 · 伏笔+2 · 角色+1" #a78bfa 11px 500
```

- [ ] **Step 5: 导出验证**

`export_nodes` → `/tmp/pencil-verify/35-chat-activities.png`。确认全部 5 帧组件参考帧渲染正确。

---

## Task 3: 认证帧（Row 1, 帧 01-02）

**帧位置**：y=0, x=0/1600

### 帧 01: Auth Login (x=0, y=0)

- [ ] **Step 1: 创建渐变背景**

frame 内全屏 rect：`fill: linearGradient(135°, #0a0a0b, #13131a)`。

- [ ] **Step 2: 创建登录卡片**

居中卡片（x=528, y=210, w=384, h=480）：
```
type: rect
fill: #1A1A22
cornerRadius: 16
strokeWidth: 1, stroke: #ffffff14
effect: [
  {type:"background_blur", radius:20},
  {type:"shadow", shadowType:"outer", offset:{x:0,y:4}, blur:24, fill:"#00000080"}
]
```

- [ ] **Step 3: 创建卡片内容**

卡片内从上到下（相对卡片坐标）：
```
标题: "登录" 18px 600 #ffffff (padding-top:32, center)
副标题: "输入账号信息继续" 11px #71717a (gap:6)
邮箱输入框: w=320 h=40, fill:#1A1A22 stroke:#ffffff14 radius:10, placeholder "邮箱" #71717a 14px (gap:20)
密码输入框: 同上, placeholder "密码"
登录按钮: w=320 h=44, gradient(90°,#6366f1,#8b5cf6), radius:100, text "登录" #ffffff 13px 600 (gap:16)
底部链接: "没有账号？注册" 11px, "没有账号？" #71717a + "注册" #818CF8 underline
```

- [ ] **Step 4: 导出验证**

`export_nodes` → `/tmp/pencil-verify/01-login.png` (2x)。

### 帧 02: Auth Register (x=1600, y=0)

- [ ] **Step 1-4: 同帧 01 结构，内容替换**

卡片内容差异：
```
标题: "注册"
副标题: "创建账号开始写作"
增加昵称输入框（密码框上方）: placeholder "昵称"
注册按钮: text "注册"
底部链接: "已有账号？登录"
```

- [ ] **Step 5: 导出验证**

`export_nodes` → `/tmp/pencil-verify/02-register.png` (2x)。

---

## Task 4: 书库帧（Row 2, 帧 03-06）

**帧位置**：y=1000, x=0/1600/3200/4800

### 帧 03: Library Main (x=0, y=1000)

- [ ] **Step 1: 创建 AppSidebar（200px）**

左侧 sidebar（x=0, y=0, w=200, h=900）：
```
fill: #0F0F13, strokeWidth:1 stroke:#ffffff14 (right border only → 用 rect 覆盖右边线)
品牌区 (padding [20,16]):
  icon: sparkles size:16 fill:#6366f1
  text: "narratox" 18px 600 gradient(#6366f1→#8b5cf6)
导航项 (padding [0,12], gap:2):
  小说库: 激活态 — fill:#6366f126, 左侧 2px 指示条 #818CF8, text "小说库" 13px 600 #ffffff
  知识库: 普通态 — fill:transparent, text "知识库" 13px normal #a1a1aa
  拆解: 普通态
  设置: 普通态
底部: 登出 ghost 按钮
```

- [ ] **Step 2: 创建主区顶栏**

主区（x=200, y=0, w=1240, h=900），背景 `#0a0a0b`。

顶栏（y=0, h=64, padding [0,24]）：
```
左: text "我的小说" 18px 600 #ffffff
右: 主按钮 rect gradient(90°,#6366f1,#8b5cf6) radius:100, icon: plus + text "+ 新建小说" #ffffff 13px 600
```

- [ ] **Step 3: 创建卡片网格**

内容区（y=64, padding [0,24]），3 列网格，gap 16px。

6 张小说卡片（2 行 × 3 列），每张 196×300px（实际宽度按网格自适应 ~373px）。

卡片 1（紫色渐变封面，写作中）：
```
外框: rect fill:#1A1A22 cornerRadius:8 strokeWidth:1 stroke:#ffffff14
封面区: h=180, fill: linearGradient(135°,#6366f1,#8b5cf6)
  左侧指示条: 2px #818CF8 (ACTIVE 卡片)
状态标签: 右上角, fill:#6366f126 cornerRadius:4, text "写作中" #a78bfa 10px 500
信息区 padding [12,16]:
  标题: "星河彼岸" 16px 600 #ffffff
  类型: "科幻 · 赛博朋克" 11px #71717a
  简介: 2行文字 #a1a1aa 11px
  时间: "2024-01-15" 10px #71717a
```

卡片 2（蓝色渐变 `#3b82f6→#6366f1`，写作中）— 标题 "龙脉传说"，类型 "玄幻 · 修仙"
卡片 3（橙色渐变 `#f59e0b→#ef4444`，构思中）— 标题 "都市暗影"，类型 "都市 · 悬疑"，状态标签 neutral
卡片 4（粉色渐变 `#ec4899→#8b5cf6`，写作中）— 标题 "逆天仙途"，类型 "仙侠"
卡片 5（绿色渐变 `#10b981→#06b6d4`，写作中）— 标题 "末日纪元"，类型 "科幻 · 末世"
卡片 6（紫色渐变 `#6366f1→#8b5cf6`，构思中）— 标题 "万界归一"，类型 "诸天无限"

- [ ] **Step 4: 导出验证**

`export_nodes` → `/tmp/pencil-verify/03-library-main.png` (2x)。检查：sidebar 激活态正确、6 张卡片渐变封面、网格对齐。

### 帧 04: Library Empty (x=1600, y=1000)

- [ ] **Step 1: 复制 sidebar + 主区背景**

与帧 03 相同的 AppSidebar（小说库激活）+ 主区背景。

- [ ] **Step 2: 创建空状态**

内容区居中：
```
icon: library size:48 fill:#2A2A35 (居中 y=300)
text: "还没有小说，点击「新建小说」开始" 14px #71717a (y=380)
保留顶栏 "+ 新建小说" 按钮
```

- [ ] **Step 3: 导出验证**

`export_nodes` → `/tmp/pencil-verify/04-library-empty.png`。

### 帧 05: Library Card Menu (x=3200, y=1000)

- [ ] **Step 1: 复制帧 03 的完整背景 + sidebar + 卡片网格**

- [ ] **Step 2: 创建第一张卡片的 hover ⋮ 菜单**

在卡片 1 右上角添加：
```
⋮ 按钮: icon more-horizontal size:16 fill:#a1a1aa, bg:#2A2A35 cornerRadius:4
下拉菜单（在 ⋮ 按钮下方）:
  fill:#1A1A22 cornerRadius:8 strokeWidth:1 stroke:#ffffff14 shadow:blur:12 #00000080
  菜单项 1: "发布" 13px #E8E8EC, padding:[8,12]
  菜单项 2: "删除" 13px #f87171 (destructive)
卡片 1 border 变为: stroke:#818CF8 (hover 态)
```

- [ ] **Step 3: 创建删除确认弹窗 overlay**

全屏半透明遮罩 + 居中弹窗：
```
overlay: rect fill:#00000080 (全屏)
dialog: rect w=360 h=180 fill:#1A1A22 cornerRadius:14 shadow:blur:32 #00000080
  标题: "删除《星河彼岸》?" 18px 600 #ffffff
  描述: "此操作不可撤销。" 14px #d4d4d8
  底部按钮行:
    取消: 次按钮 (border #ffffff14, text #E8E8EC)
    删除: destructive 按钮 (fill:#E5393520, text #f87171)
```

- [ ] **Step 4: 导出验证**

`export_nodes` → `/tmp/pencil-verify/05-card-menu.png`。

### 帧 06: Library Publish (x=4800, y=1000)

- [ ] **Step 1: 复制帧 03 的完整背景 + sidebar + 卡片网格**

- [ ] **Step 2: 创建发布弹窗 overlay**

全屏遮罩 + 居中弹窗（w=480 h=520）：
```
dialog: fill:#1A1A22 cornerRadius:14
标题: "发布《星河彼岸》" 18px 600 #ffffff
副标题: "选择章节范围并复制到剪贴板" 11px #71717a

章节范围选择:
  label "从" + 输入框(数字) | label "到" + 输入框(数字)
  默认: 从 1 到 5

选项行（checkbox 样式）:
  ☑ 包含章节标题
  ☐ 包含卷简介
  ☑ 首行缩进

预览区: rect fill:#0F0F13 cornerRadius:8 h=160, text 等宽 12px #a1a1aa (前几章预览)

底部按钮行:
  关闭: ghost 按钮
  复制到剪贴板: 主按钮 (gradient pill, icon: copy + text "复制到剪贴板")
```

- [ ] **Step 3: 导出验证**

`export_nodes` → `/tmp/pencil-verify/06-publish.png`。

---

## Task 5: 知识库帧（Row 3, 帧 07）

**帧位置**：y=2000, x=0

### 帧 07: Knowledge Main (x=0, y=2000)

- [ ] **Step 1: 创建 AppSidebar（知识库激活）**

与帧 03 相同的 sidebar，但 "知识库" 为激活态，"小说库" 为普通态。

- [ ] **Step 2: 创建主区顶栏 + 搜索**

主区（x=200, w=1240），背景 `#0a0a0b`。
```
顶栏 (h=64, padding [0,24]):
  左: text "写作知识库" 18px 600 #ffffff
  右: text "后端 localhost:3001 · 在线 ●" 11px #71717a
搜索框: w=400 h=36, fill:#1A1A22 radius:10 stroke:#ffffff14, placeholder "搜索条目…" icon: search
```

- [ ] **Step 3: 创建分类标签行**

分类标签行（y=80, padding [0,24], gap:8），6 个分类标签：
```
全部(633): 激活态 fill:#6366f126 text:#a78bfa
教程(85):  fill:#ffffff0f text:#a1a1aa
拆书(120): fill:#ffffff0f text:#a1a1aa
技巧(95):  fill:#ffffff0f text:#a1a1aa
资源(43):  fill:#ffffff0f text:#a1a1aa
案例(28):  fill:#ffffff0f text:#a1a1aa
每个: padding [3,8] cornerRadius:100 fontSize:11px fontWeight:500
```

- [ ] **Step 4: 创建条目卡片网格**

3 列 × 3 行 = 9 个条目卡片（y=130, gap:12），每张 ~373×140px：
```
卡片结构:
  fill:#1A1A22 cornerRadius:8 strokeWidth:1 stroke:#ffffff14 padding:[12,16]
  顶部行: 标题 14px 600 #ffffff + tag 标签(fill:#6366f126 text:"教程" #a78bfa 10px)
  摘要: 2行文字 11px #a1a1aa
  底部: 🧠思考 标记(if 有) + 来源 10px #71717a
```

9 个条目标题示例（中文）：
"三幕式结构详解" / "角色弧光设计法" / "爽点节奏曲线" / "伏笔埋设技巧" / "大纲分层规划" / "世界观构建指南" / "对话写作技巧" / "场景转换手法" / "网文开篇黄金法则"

- [ ] **Step 5: 导出验证**

`export_nodes` → `/tmp/pencil-verify/07-knowledge.png` (2x)。

---

## Task 6: 拆解帧（Row 4, 帧 08-11）

**帧位置**：y=3000, x=0/1600/3200/4800

### 帧 08: Dissect Main (x=0, y=3000)

- [ ] **Step 1: 创建全宽背景（无 sidebar）**

frame 全屏 `#0a0a0b`。无 AppSidebar（拆解页是单栏全宽）。

- [ ] **Step 2: 创建顶栏**

顶栏（h=80, padding [0,32]）：
```
左:
  标题: "对标拆解" 18px 600 #ffffff
  副标题: "上传范本小说 → 自动拆解为文风/节奏/情绪/角色/剧情/章节摘要条目" 11px #71717a
右:
  主按钮: gradient pill, icon: plus + "+ 上传小说" #ffffff 13px 600
```

- [ ] **Step 3: 创建拆解卡片网格**

3 列 × 2 行 = 6 张卡片（y=100, padding [0,32], gap:16），每张 ~400×180px：
```
卡片结构:
  fill:#1A1A22 cornerRadius:8 strokeWidth:1 stroke:#ffffff14 padding:[20,20]
  顶部行:
    标题: 16px 600 #ffffff (line-clamp-1)
    状态标签: padding [2,8] cornerRadius:4 10px 500
  进度文字 (RUNNING 时): 11px #a78bfa "第 8/24 章 · chapter-extractor"
  元信息: 11px #71717a/70 "24 章 · 2024-01-10 14:30"
  底部按钮行: 按状态显示不同按钮组合
```

6 张卡片状态分配：
```
卡 1: DONE → ✓ 完成(green), 按钮: "浏览结果" + "删除"
卡 2: RUNNING → 🔄 拆解中(accent), 进度"第 8/24 章", 按钮: "查看日志" + "删除"
卡 3: DONE → ✓ 完成, 按钮: "浏览结果" + "删除"
卡 4: FAILED → ⚠ 失败(destructive), 按钮: "重试" + "删除"
卡 5: PENDING → ⏸ 待确认(neutral), 按钮: "查看日志" + "删除"
卡 6: INTERRUPTED → ⚠ 中断(warning), 按钮: "重试" + "删除"
```

- [ ] **Step 4: 导出验证**

`export_nodes` → `/tmp/pencil-verify/08-dissect-main.png` (2x)。

### 帧 09: Dissect Upload Confirm (x=1600, y=3000)

- [ ] **Step 1: 复制帧 08 背景 + 卡片网格**

- [ ] **Step 2: 创建上传确认弹窗**

遮罩 + 弹窗（w=440 h=340）：
```
dialog: fill:#1A1A22 cornerRadius:14 shadow:blur:32
标题: "确认拆解?" 18px 600 #ffffff

标题编辑:
  label "标题" 11px #71717a
  输入框: w=full h=36, fill:#1A1A22 stroke:#ffffff14 radius:10, text "斗破苍穹" #ffffff 14px

⚠ 警告框:
  fill:#F59E0B10 cornerRadius:8 strokeWidth:1 stroke:#F59E0B30 padding:[12,12]
  标题: "⚠ 预估消耗" #FBBF24 11px 600
  内容: "共 1644 章, 预估 850.0k tokens。" #FBBF24/90 11px
  建议: "建议在「设置」为 chapter-extractor 角色配置一个便宜的模型以控制成本。" #FBBF24/70 10px

底部按钮行:
  取消: 次按钮
  开始拆解: 主按钮 (gradient pill)
```

- [ ] **Step 3: 导出验证**

`export_nodes` → `/tmp/pencil-verify/09-upload-confirm.png`。

### 帧 10: Dissect Log Drawer (x=3200, y=3000)

- [ ] **Step 1: 复制帧 08 背景**

- [ ] **Step 2: 创建日志抽屉弹窗**

遮罩 + 大弹窗（w=672 = max-w-2xl, h=660）：
```
dialog: fill:#1A1A22 cornerRadius:14
标题: "拆解日志" 18px 600 #ffffff

日志区 (h=440):
  fill:#0F0F13 cornerRadius:8 strokeWidth:1 stroke:#ffffff14 padding:[12,12]
  font: Inter Mono 12px (等宽)

  日志行（每行格式: 时间 [标签] 内容）:
    14:30:01 [RunStarted] 拆解开始                    — info #71717a
    14:30:02 [think] 分析章节结构…                     — think #c084fc
    14:30:05 [tool] extract_chapter({order:1})         — tool #60A5FA
    14:30:08 [content] 第 1 章: 林动出场…              — content #ffffff
    14:30:10 [stage] CHAPTER_ORCH → 文风分析            — stage #a78bfa
    14:30:15 [result] extract_chapter ✓ 完成            — result #22C55E
    ... (8-10 行)

  底部光标: "▌ 拆解中…" #71717a/50 animate-pulse 暗示

底部按钮: "关闭" 次按钮
```

- [ ] **Step 3: 导出验证**

`export_nodes` → `/tmp/pencil-verify/10-log-drawer.png`。

### 帧 11: Dissect Result Browser (x=4800, y=3000)

- [ ] **Step 1: 复制帧 08 背景**

- [ ] **Step 2: 创建结果浏览弹窗**

遮罩 + 大弹窗（w=800 = max-w-3xl, h=700）：
```
dialog: fill:#1A1A22 cornerRadius:14
标题: "《斗破苍穹》拆解结果" 18px 600 #ffffff

内容区 (h=580, overflow scroll), 6 个分区按序:

Section 1 - 文风 STYLE (h2 标题 14px 600 #a78bfa):
  条目卡: fill:#2A2A35 cornerRadius:8 stroke:#ffffff14 padding:[12,12]
    标题: "叙事节奏" 14px 500 #ffffff + 章节标签 "全卷" #a1a1aa
    内容: "快节奏推进,每章末留悬念钩…" 11px #a1a1aa/90

Section 2 - 节奏 RHYTHM:
  条目: "三章一爆点" + 内容描述

Section 3 - 情绪 EMOTION:
  条目: "逆袭爽感曲线" + 内容

Section 4 - 角色 CHARACTER:
  条目: "萧炎·主角成长弧" + 章节标记 "第 1 章"

Section 5 - 剧情情 PLOT:
  条目: "药老收徒转折点" + 章节标记 "第 12 章"

Section 6 - 章节摘要 CHAPTER:
  条目: "第 1 章 · 陨落的天才" + 摘要内容

底部按钮: "关闭" 次按钮
```

- [ ] **Step 3: 导出验证**

`export_nodes` → `/tmp/pencil-verify/11-result-browser.png`。

---

## Task 7: 设置帧（Row 5, 帧 12-16）

**帧位置**：y=4000, x=0/1600/3200/4800/6400

### 帧 12: Settings Main (x=0, y=4000)

- [ ] **Step 1: 创建 AppSidebar（设置激活）**

- [ ] **Step 2: 创建主区顶栏 + 滚动内容**

主区（x=200, w=1240），背景 `#0a0a0b`。
```
顶栏 (h=64, padding [0,32]):
  标题: "设置" 18px 600 #ffffff
  右: "后端 localhost:3001 · 在线 ●" 11px #71717a
```

- [ ] **Step 3: 创建 Section 1 - 模型设置**

区块标题: "模型设置" 14px 600 #ffffff (padding [0,32])

Vendor 卡片列表（3 个 vendor 卡片纵向，padding [0,32], gap:12）：

Vendor 卡片 1 - OpenAI:
```
fill:#1A1A22 cornerRadius:8 stroke:#ffffff14 padding:[16,16]
顶部行: icon OpenAI logo + "OpenAI" 16px 600 + 右侧 "添加模型" ghost 按钮(#a1a1aa)
折叠模型行:
  gpt-4o | API Key ✓ 已配置 | [激活] 标签(accent) | 编辑 | 删除
  gpt-4o-mini | API Key ✓ | 编辑 | 删除
每行: fill:#ffffff08 cornerRadius:6 padding:[8,10], 模型名 13px #fff, key状态 11px #22C55E
```

Vendor 卡片 2 - Anthropic: claude-sonnet-4 / claude-haiku
Vendor 卡片 3 - GLM: glm-4-plus / glm-4-air

- [ ] **Step 4: 创建 Section 2 - Agent 模型配置**

区块标题: "Agent 模型配置" 14px 600

入口卡片:
```
fill:#1A1A22 cornerRadius:8 stroke:#ffffff14 padding:[16,16]
内容: "当前: 统一使用活跃模型 (GLM 4 Plus)" 13px #E8E8EC
按钮: "配置" 次按钮
```

- [ ] **Step 5: 创建 Section 3 - 作者画像**

区块标题: "作者画像" 14px 600 + 描述 "画像库 · 不同类型的书可建不同声音" 11px #71717a

2 列画像卡片网格（2 张）：
```
卡片 1: fill:#1A1A22 cornerRadius:8 stroke:#ffffff14 padding:[16,16]
  名称: "爽文快节奏" 16px 600
  描述: "短句为主, 爽点密集…" 11px #a1a1aa
  底部: 编辑 / 预览 按钮
卡片 2: "细腻文学风" 同结构
```

- [ ] **Step 6: 导出验证**

`export_nodes` → `/tmp/pencil-verify/12-settings-main.png` (2x)。

### 帧 13: Settings Model Dialog (x=1600, y=4000)

- [ ] **Step 1: 复制帧 12 背景 + sidebar**

- [ ] **Step 2: 创建模型编辑弹窗**

遮罩 + 弹窗（w=480 h=520）：
```
标题: "编辑模型" 18px 600

表单字段:
  Provider: 输入框 "openai-compatible" (disabled #71717a)
  名称: 输入框 "GLM 4 Plus" #ffffff
  模型 ID: 输入框 "glm-4-plus"
  Base URL: 输入框 "https://open.bigmodel.cn/api/paas/v4"
  API Key: 密码框 "sk-***" (#71717a placeholder)
  Temperature: 输入框 "0.7" + 说明 11px
  Max Tokens: 输入框 "4096"

底部: 取消(次按钮) + 保存(主按钮)
```

- [ ] **Step 3: 导出验证**

`export_nodes` → `/tmp/pencil-verify/13-model-dialog.png`。

### 帧 14: Settings Agent Model (x=3200, y=4000)

- [ ] **Step 1: 复制帧 12 背景 + sidebar**

- [ ] **Step 2: 创建 Agent 模型配置弹窗**

遮照 + 大弹窗（w=600 h=680）：
```
标题: "Agent 模型配置" 18px 600

3 个 phase 分组:

Phase: onboarding (建项阶段):
  Agent 行 4 个, 每行:
    icon(brain) + agent 名 13px #fff + tier 标签 + 模型名 11px #71717a
    main: 🟡 mid → GLM-4-Plus
    curator: 💚 cheap → GLM-4-Air
    worldbuilder: 🟡 mid → GLM-4-Plus
    character: 🟡 mid → GLM-4-Plus

Phase: writing (写作阶段):
    chapter: 🔴 strong → Claude Sonnet
    settler: 💚 cheap → GLM-4-Air
    validator: 🟡 mid → GLM-4-Plus

Phase: outline (大纲阶段):
    outliner: 🟡 mid → GLM-4-Plus

底部: 关闭(次按钮)
tier 标签: 🔴=strong fill:#E5393520 / 🟡=mid fill:#F59E0B20 / 💚=cheap fill:#22C55E20
```

- [ ] **Step 3: 导出验证**

`export_nodes` → `/tmp/pencil-verify/14-agent-model.png`。

### 帧 15: Settings Voice Editor (x=4800, y=4000)

- [ ] **Step 1: 复制帧 12 背景 + sidebar**

- [ ] **Step 2: 创建画像编辑视图**

主区内容替换为画像编辑器：
```
返回链接: "← 作者画像" 13px #818CF8
标题: "爽文快节奏" 18px 600 #ffffff

编辑/预览 toggle 按钮 (右上角)

编辑区:
  文风描述 Textarea: w=full h=120, fill:#1A1A22 radius:10
    text: "短句为主, 一句一段。情绪来得快去得也快…"
  句长偏好: 输入框 "短(8-15字)"
  用词偏好: 输入框 "口语化, 少书面语"
  叙事节奏: 输入框 "快, 信息密度高"
  情绪倾向: 输入框 "外放, 直接表达"

底部: 保存(主按钮) + 取消
```

- [ ] **Step 3: 导出验证**

`export_nodes` → `/tmp/pencil-verify/15-voice-editor.png`。

### 帧 16: Settings Empty (x=6400, y=4000)

- [ ] **Step 1: 复制帧 12 背景 + sidebar**

- [ ] **Step 2: 创建首次空状态**

Section 1 (模型设置) 空态:
```
icon: wrench size:48 fill:#2A2A35 (居中)
text: "尚未配置模型" 14px #71717a
text: "点击「添加模型」配置你的第一个 AI 模型" 11px #71717a
主按钮: "+ 添加模型" (gradient pill)
```

Section 2/3 同样空态占位。

- [ ] **Step 3: 导出验证**

`export_nodes` → `/tmp/pencil-verify/16-settings-empty.png`。

---

## Task 8: 工作区核心帧（Row 6, 帧 17-22）

**帧位置**：y=5000, x=0/1600/3200/4800/6400/8000

### 公共子结构：IconRail（所有工作区帧复用）

所有 6 个工作区帧共享 IconRail（56px 左栏）。第一个帧创建完整 IconRail，后续帧复制。

IconRail 结构（x=0, y=0, w=56, h=900）：
```
fill: #1A1A22, right border: 1px #ffffff14

顶部区 (y=12):
  返回按钮: icon arrow-left size:20 fill:#818CF8 (居中 48×48)

分隔线 (y=60): h:1 w:24 fill:#ffffff0a 居中

资源图标列表 (y=76, gap:4, 每个 48×48 居中):
  info: icon info size:18
  globe: icon globe size:18  (世界观)
  library: icon library size:18  (参考资料)
  list: icon list size:18  (大纲)
  book-open: icon book-open size:18  (正文)
  user: icon user size:18  (角色)
  bookmark: icon bookmark size:18  (状态/伏笔)
  calendar: icon calendar size:18  (事件)
  chart-bar: icon chart-bar size:18  (态势)

分隔线: h:1 w:24 fill:#ffffff0a

底部区 (mt-auto):
  sparkles: icon sparkles size:18  (作者画像)
  log-out: icon log-out size:18  (登出)
```

激活态变化（每帧不同）：激活的图标左侧有 2px #818CF8 指示条 + fill #6366f126 背景。

### 帧 17: Workspace Concept (x=0, y=5000)

**状态**：CONCEPT 立项中，info 面板默认打开，IconRail info 激活。

- [ ] **Step 1: 创建背景 + IconRail（info 激活）**

- [ ] **Step 2: 创建 ChatPanel（中栏 flex-1 ≈ 964px）**

ChatPanel（x=56, w=964, h=900）：
```
背景: #0a0a0b

顶栏 (h=36, padding [0,20]):
  左: text "💬 聊天 · 一本小说一份记忆" 11px #71717a
  右: text "📍 立项中" 11px #71717a

消息区 (flex-1, padding [16,20]):
  Agent 开场白消息:
    text: "你好！我是你的写作助手。让我们开始创建你的小说吧！" 14px #E8E8EC
    bg: transparent, 左对齐

  用户消息:
    text: "我想写一本科幻小说" 14px #E8E8EC
    右对齐, bg:#6366f126 cornerRadius:12 padding:[8,12]

  Agent 活动行:
    [think] 思考中... (fill:#ffffff08, #c084fc label)
    [stage] CURATOR_ORCH → 分析类型... (fill:#ffffff08, #a78bfa label)

输入区 (底部 sticky, padding [0,16,8,16]):
  输入框: w=full h=48, fill:#1A1A22 radius:10 stroke:#ffffff14, placeholder "输入消息…"
  发送按钮: gradient pill, icon send
```

- [ ] **Step 3: 创建 ResourcePanel（info 面板）**

ResourcePanel（x=1020, w=420, h=900）：
```
fill: #13131a, left border: 1px #ffffff14

面板头 (padding [12,16]):
  左: text "小说信息" 13px 600 #ffffff
  右: text "×" 18px #71717a

内容区 (padding [0,16,24,16]):
  键值对列表 (gap:12):
    书名: label "书名" 10px uppercase #71717a → value "未命名" 13px #E8E8EC
    类型: "科幻"
    简介: "暂无" #71717a
    核心冲突: "暂无"
    每章字数目标: "3000 字"
    文风: "暂无"

  底部提示: "信息卡 · 由 Agent 通过 update_novel 自动填充" 11px #71717a/50
```

- [ ] **Step 4: 导出验证**

`export_nodes` → `/tmp/pencil-verify/17-ws-concept.png` (2x)。

### 帧 18: Workspace Active Idle (x=1600, y=5000)

**状态**：ACTIVE 写作态，正文面板默认（chapters 激活），空闲（非 streaming）。

- [ ] **Step 1: 复制 IconRail（chapters/book-open 激活）**

- [ ] **Step 2: 创建 ChatPanel（多轮对话历史）**

消息区显示更多历史消息：
```
Agent: "大纲已规划完成,共 3 卷 60 章。准备好开始写第一章了吗?" 14px #E8E8EC
User: "开始吧" (右对齐气泡)
Agent 活动行(已完成):
  [content] 好的,我来写第一章的开头… 14px #E8E8EC
  [result] append_section ✓ 第 1 章已写入 3000 字  11px #22C55E
记忆标签: brain icon + "第 1 章已结算 · 伏笔+2 · 角色+1" #a78bfa 11px (附在 agent 消息上)

顶栏右侧: "📍 写正文" 11px #71717a
```

- [ ] **Step 3: 创建 ResourcePanel（正文面板）**

```
面板头: "正文" 13px 600

翻页头:
  ‹ | "第 1 章 · 龙脉觉醒" 13px 500 #ffffff(hover→#818CF8) | › | 📋 | ☰

元信息行:
  标签 "已写入" fill:#22C55E20 text:#22C55E | "3,240 字" 11px #71717a

正文内容 (Markdown 渲染):
  h2: "第一章 龙脉觉醒" 16px 600 #ffffff
  正文段落: 14px #E8E8EC (line-height 1.7)
  多段正文文字（3-4 段示例）
```

- [ ] **Step 4: 导出验证**

`export_nodes` → `/tmp/pencil-verify/18-ws-idle.png`。

### 帧 19: Workspace Streaming (x=3200, y=5000)

**状态**：AI 流式输出中，活动行正在滚动，输入框 disabled。

- [ ] **Step 1: 复制 IconRail（chapters 激活）**

- [ ] **Step 2: 创建 ChatPanel（streaming 态）**

消息区底部增加正在流式输出的活动行：
```
... 历史消息同帧 18 ...

当前 streaming 活动行:
  [think] 正在思考第 2 章的情节发展...  (#c084fc, fill:#ffffff08)
  [tool] get_chapter({order:1})  (#60A5FA, fill:#ffffff08)
  [tool] get_chapter_plan({order:2})  (#60A5FA)
  [content] 好的,让我继续写第二章。林动走出山洞…  (#ffffff, 光标▌)
  (以上行依次排列)

输入区:
  输入框: disabled, fill:#1A1A22 opacity:0.5
  发送按钮: disabled, 灰色(非渐变)

顶栏: "📍 写正文 · AI 响应中" 11px #a78bfa
```

- [ ] **Step 3: 创建 ResourcePanel（正文面板 — 同帧 18 但正在更新）**

正文面板显示第 1 章内容（上一章），但翻页头显示：
```
‹ | "第 2 章 · 初入宗门" | ›
(标题但内容区为空/正在加载)
```

- [ ] **Step 4: 导出验证**

`export_nodes` → `/tmp/pencil-verify/19-ws-streaming.png`。

### 帧 20: Workspace Chapter Skeleton (x=4800, y=5000)

**状态**：章节骨架加载中（AI 正在写当前章），正文面板显示骨架屏。

- [ ] **Step 1: 复制 IconRail（chapters 激活）**

- [ ] **Step 2: 创建 ChatPanel（streaming + tool 调用）**

消息区显示：
```
[stage] CHAPTER_ORCH 委派写作… (#a78bfa)
[tool] append_section({order:2, section:0, content:"第二章 初入宗门\n\n"}) (#60A5FA)
```

- [ ] **Step 3: 创建 ResourcePanel（骨架屏态）**

```
面板头: "正文"

翻页头:
  ‹ | "第 2 章 · 初入宗门" | ›

WritingPill (brand 色高亮):
  rect fill:#6366f110 stroke:#6366f140 cornerRadius:8 padding:[8,12]
  text: "✍ AI 正写第 2 章" #a78bfa 13px + "跳转 ›"

骨架屏区:
  text: "第 2 章 · AI 写作中…" 11px #71717a
  6 行灰色条 (animate-pulse 暗示):
    rect fill:#2A2A35 cornerRadius:4, 各行宽度 70-100% 随机
    heights:4, gap:8
```

- [ ] **Step 4: 导出验证**

`export_nodes` → `/tmp/pencil-verify/20-ws-skeleton.png`。

### 帧 21: Workspace Outline (x=6400, y=5000)

**状态**：大纲面板展开（outline 激活），显示总纲 + 卷 + 弧线。

- [ ] **Step 1: 复制 IconRail（outline/list 激活）**

- [ ] **Step 2: 创建 ChatPanel（简化）**

保留基本对话，非 streaming。

- [ ] **Step 3: 创建 ResourcePanel（大纲面板展开态）**

```
面板头: "大纲"

【总纲】折叠卡 (展开态):
  rect fill:#6366f105 stroke:#6366f130 cornerRadius:8 padding:[8,8]
  text: "📜 总纲(全书北极星)" 13px 600 #a78bfa
  内容行 (11px #a1a1aa):
    故事核: 少年得龙脉,逆天改命
    主线: 修炼突破→复仇→守护
    结局: 成为最强者
    力量进阶: 卷1:炼气 → 卷2:筑基 → 卷3:金丹
    暗线: 身世之谜(埋1→揭3)
    三幕:
      ·一幕末(卷1): 得龙脉
      ·二幕末·灵魂黑夜(卷2): 被废修为 (#a78bfa 红色标)
      ·三幕末(卷3): 最终决战

卷 1 (展开):
  ▼ "卷一 · 初入宗门" 14px 600 #ffffff + "3/5" 11px #71717a
  padding-left: 8, border-left: 1px #ffffff14

  目标: 林动入门宗门
  承上启下: 承接得脉,开启修炼
  主线推进: 进入外门

  章节细纲卡 3 张:
    卡 1 (展开态, isCurrent):
      fill:#6366f110 stroke:#6366f150 cornerRadius:6
      "第 1 章 · 龙脉觉醒" 13px #ffffff + "●正在写" #a78bfa
      开篇: 林动 | 遭遇 | 考核
      情1: 林动 | 展示 | 实力
      结尾: 林动 | 加入 | 宗门
      ✓必须: 龙脉 / 林动出场
      ✗禁区: 修为超过炼气
      "跳到该章正文 ›" #818CF8

    卡 2 (折叠态): "第 2 章 · 初入宗门" + "○已确认" #71717a
    卡 3 (折叠态): "第 3 章 · 外门弟子" + "○细纲" #71717a

【弧线】:
  🎬 卷一主线弧 · 第1-5章 · 少年入门
```

- [ ] **Step 4: 导出验证**

`export_nodes` → `/tmp/pencil-verify/21-ws-outline.png`。

### 帧 22: Workspace Empty Resource (x=8000, y=5000)

**状态**：无面板选中（activeResource=null），只有 IconRail + ChatPanel。

- [ ] **Step 1: 复制 IconRail（无激活态，所有图标 opacity 50%）**

- [ ] **Step 2: 创建 ChatPanel（占满剩余空间）**

ChatPanel（x=56, w=1384, h=900），所有图标非激活态。
内容简化为基础对话。

- [ ] **Step 3: 导出验证**

`export_nodes` → `/tmp/pencil-verify/22-ws-empty-resource.png`。

---

## Task 9: 资源面板视图帧（Row 7, 帧 23-30）

**帧位置**：y=6000, x=0/1600/3200/4800/6400/8000/9600/11200

所有帧共享：IconRail（对应资源激活）+ ChatPanel（简化）+ ResourcePanel（对应面板内容）。ChatPanel 仅保留基础骨架（顶栏 + 空/少量消息 + 输入框），重点是 ResourcePanel 内容。

### 帧 23: RP Characters (x=0, y=6000)

IconRail: user 激活。ResourcePanel 显示角色面板。

- [ ] **Step 1: 创建 IconRail（characters/user 激活）+ ChatPanel 骨架**

- [ ] **Step 2: 创建角色面板内容**

```
面板头: "角色"

主角 · 1 (11px uppercase #71717a)

角色卡 1 (展开态) — 林动:
  fill:#1A1A22 stroke:#ffffff14 cornerRadius:8 padding:[6,8]
  顶部行: "林动" 13px #ffffff + "萧炎/林少爷 · ▼" 11px #71717a
  essence 行: "性格基调: 坚韧不拔 · 动机: 保护家族" 11px #71717a

  档案区:
    "档案" 10px uppercase #71717a/70
    出身/背景: "乌坦城林家旁支, 曾经的天才" 11px #E8E8EC
    成长经历: "三岁修炼, 十岁遭劫, 修为倒退…" 11px
    外貌: "剑眉星目, 身材修长" 11px
    性格基调: "坚韧, 隐忍, 有仇必报" 11px
    执念/动机: "恢复天赋, 保护妹妹" 11px
    弱点: "过于执着, 容易冲动" 11px
    弧光目标: "从废柴到最强者" 11px
    语言风格: "直接, 简洁, 不废话" 11px
    阵营: "林家 / 萧家(药老)" 11px

  当前态:
    "当前态" 10px uppercase
    修为: 炼气七段 (第 1 章)
    位置: 乌坦城林家

  变化时间线:
    "变化时间线" 10px uppercase
    第 1 章 ★ 修为: 炼气七段 (龙脉觉醒)

反派 · 1:
角色卡 2 (折叠态) — 萧厉:
  "萧厉" 13px + "▶" + "性格: 阴险 · 动机: 灭林家" 11px
```

- [ ] **Step 3: 导出验证**

`export_nodes` → `/tmp/pencil-verify/23-rp-characters.png` (2x)。

### 帧 24: RP Worldview (x=1600, y=6000)

IconRail: globe 激活。

- [ ] **Step 1: 创建 IconRail + ChatPanel 骨架**

- [ ] **Step 2: 创建世界观面板内容**

```
面板头: "世界观"

设定 / 总览 · 1 (11px uppercase #71717a)
  折叠卡(展开): "斗气大陆" ▼
    Markdown 内容: "这是一个以斗气为尊的世界…" 11px #E8E8EC

力量体系 · 2
  "斗气等级" ▶ (折叠)
  "龙脉之力" ▶ (折叠)

规则 / 禁忌 · 1
  "天地规则" ▶

地点 · 3
  "乌坦城" ▶
  "萧家" ▶
  "魔兽山脉" ▶

势力 / 组织 · 2
  "林家" ▶
  "萧家" ▶
```

- [ ] **Step 3: 导出验证**

`export_nodes` → `/tmp/pencil-verify/24-rp-worldview.png`。

### 帧 25: RP Hooks (x=3200, y=6000)

IconRail: bookmark 激活。

- [ ] **Step 1: 创建 IconRail + ChatPanel 骨架**

- [ ] **Step 2: 创建伏笔面板内容**

```
面板头: "伏笔"

★ 核心伏笔 · 2 (11px uppercase #a78bfa)
  卡 1:
    fill:#6366f105 stroke:#6366f120 cornerRadius:6
    ★ "龙脉身世之谜" #ffffff + payoffTiming "终局" tag
    始于第 1 章 · 推进 2 次
  卡 2:
    ★ "药老真实身份"

⚠️ 陈久未推进 · 1 (#a78bfa)
  卡: "神秘黑袍人" + ⚠️陈旧 + 始于第 2 章

进行中 · 3 (#71717a)
  卡 1: "林动修为秘密" · payoffTiming "本卷"
  卡 2: "妹妹的特殊体质"
  卡 3: "宗门大比邀请"

已回收 · 1 (#71717a/50)
  卡: ~~"入门考核作弊疑云"~~ ✓已回收 · 回收于第 3 章
  opacity: 0.5, line-through
```

- [ ] **Step 3: 导出验证**

`export_nodes` → `/tmp/pencil-verify/25-rp-hooks.png`。

### 帧 26: RP Events (x=4800, y=6000)

IconRail: calendar 激活。

- [ ] **Step 1: 创建 IconRail + ChatPanel 骨架**

- [ ] **Step 2: 创建事件时间线面板内容**

```
面板头: "事件时间线"

第 1 章 · 3 (11px uppercase #71717a)

  Event 卡 1 (MAJOR):
    fill:#6366f110 stroke:#6366f140 cornerRadius:6 padding:[8,10]
    "★ MAJOR" #a78bfa 11px · kind "转折"
    "林动在山洞中发现龙脉,修为恢复" #ffffff 13px
    👥林动 📍魔兽山脉

  Event 卡 2 (minor):
    fill:#2A2A35 stroke:#ffffff14
    "· minor" #71717a · kind "推进"
    "林动回到林家" #ffffff 13px

  Event 卡 3 (minor): "萧厉暗中观察"

第 2 章 · 2
  Event 卡 4 (MAJOR): "宗门考核开始" + 👥林动,萧厉
  Event 卡 5 (minor): "林动展示实力"

第 3 章 · 1
  Event 卡 6 (MAJOR): "药老收林动为徒" + 🪝 关联伏笔
```

- [ ] **Step 3: 导出验证**

`export_nodes` → `/tmp/pencil-verify/26-rp-events.png`。

### 帧 27: RP Overview (x=6400, y=6000)

IconRail: chart-bar 激活。

- [ ] **Step 1: 创建 IconRail + ChatPanel 骨架**

- [ ] **Step 2: 创建态势面板内容**

```
面板头: "态势"

进度卡:
  fill:#2A2A35 stroke:#ffffff14 cornerRadius:8 padding:[8,12]
  "进度" 10px uppercase #71717a
  "12,400 字 · 3 章 · frontier 第 4 章 · 目标 60 章" 13px #ffffff
  "当前: 卷《卷一 · 初入宗门》 · 弧 1「少年入门」(第1-5章)" 11px #71717a

立项检查卡:
  "立项 ✓ 可写" 10px uppercase
  ✓基础 ✓参考 ✓世界 ✓大纲 ✓弧 ✗角色
  (✓ = #ffffff, ✗ = #a78bfa)

大纲覆盖卡:
  "大纲覆盖" 10px uppercase
  "1 卷 / 1 弧 · 细纲已规划 5 章 · 距 frontier 剩 2 章可写" 11px #71717a

健康卡:
  "健康" 10px uppercase
  "开放伏笔 6 (⚠️陈久 1) · MAJOR 事件 3" 11px

下一步卡 (brand 高亮):
  fill:#6366f110 stroke:#6366f140 cornerRadius:8
  "下一步 · 近期:写正文 · 建角色档案" #a78bfa 11px 600
```

- [ ] **Step 3: 导出验证**

`export_nodes` → `/tmp/pencil-verify/27-rp-overview.png`。

### 帧 28: RP References (x=8000, y=6000)

IconRail: library 激活。

- [ ] **Step 1: 创建 IconRail + ChatPanel 骨架**

- [ ] **Step 2: 创建参考资料面板内容**

```
面板头: "参考资料"

Tagged 条目 (置顶):
  卡 1: fill:#1A1A22 stroke:#ffffff14
    标题: "三幕式结构详解" 14px 500 #ffffff
    badge 行: "main" #a78bfa / "writer" #a78bfa / "outliner" #a78bfa
    按需索引: "场景: 开篇规划 → 大纲规划条目" 10px #71717a

  卡 2: "角色弧光设计法"
    badge: "character" / "writer"

其他条目:
  卡 3: "爽点节奏曲线" (无 tag, 普通)
  卡 4: "伏笔埋设技巧"
  卡 5: "对话写作技巧"
```

- [ ] **Step 3: 导出验证**

`export_nodes` → `/tmp/pencil-verify/28-rp-references.png`。

### 帧 29: RP Chapters TOC (x=9600, y=6000)

IconRail: book-open 激活。

- [ ] **Step 1: 创建 IconRail + ChatPanel 骨架**

- [ ] **Step 2: 创建正文 + 目录弹出态**

```
面板头: "正文"

翻页头:
  ‹ | "第 1 章 · 龙脉觉醒" | › | 📋 | ☰

元信息行:
  "已写入" #22C55E tag + "3,240 字"

TOC 目录弹出 (展开态):
  fill:#0F0F13 stroke:#ffffff14 cornerRadius:8, max-h:256
  章节列表:
    第 1 章 · 龙脉觉醒 — "在读" #ffffff + "●"
    第 2 章 · 初入宗门 — "写作中" #a78bfa
    第 3 章 · 外门弟子 — #71717a

正文内容 (TOC 下方):
  h2: "第一章 龙脉觉醒" 16px 600
  段落 1: "夜色如墨,乌坦城林家后山的山洞中…" 14px #E8E8EC
  段落 2: "林动盘膝而坐,体内的斗气如同枯竭的河流…"
  段落 3: "突然,一道紫金色的光芒从玉佩中涌出…"
  段落 4: (延续)
```

- [ ] **Step 3: 导出验证**

`export_nodes` → `/tmp/pencil-verify/29-rp-chapters-toc.png`。

### 帧 30: RP Voice Profile (x=11200, y=6000)

IconRail: sparkles 激活。

- [ ] **Step 1: 创建 IconRail + ChatPanel 骨架**

- [ ] **Step 2: 创建作者画像面板内容**

```
面板头: "作者画像"

当前选用的画像卡:
  fill:#6366f110 stroke:#6366f140 cornerRadius:8 padding:[12,12]
  "当前选用" badge #a78bfa
  "爽文快节奏" 16px 600 #ffffff
  "短句为主, 一句一段。情绪来得快去得也快。" 11px #a1a1aa
  参数行: "句长: 短(8-15字) · 节奏: 快 · 情绪: 外放"

可用画像列表:
  卡 2 (可选): "细腻文学风" 14px #E8E8EC
    "长句, 意象丰富, 情感细腻" 11px #71717a
    "选用" ghost 按钮

  卡 3 (可选): "幽默轻松风"
    "吐槽密集, 括号旁白" 11px #71717a

底部: "+ 新建画像" ghost 按钮 + "管理画像库" 链接 #818CF8
```

- [ ] **Step 3: 导出验证**

`export_nodes` → `/tmp/pencil-verify/30-rp-voice-profile.png`。

---

## Task 10: 最终验证 + 全量导出

- [ ] **Step 1: snapshot_layout 全局检查**

调用 `snapshot_layout`（depth 1）确认所有 35 帧在正确坐标位置、命名无误。

- [ ] **Step 2: 逐行导出验证**

按行批量 `export_nodes`，2x scale，导出到 `/tmp/pencil-verify/`：
```
Row 1: 01-login.png, 02-register.png
Row 2: 03-library-main.png, 04-library-empty.png, 05-card-menu.png, 06-publish.png
Row 3: 07-knowledge.png
Row 4: 08-dissect-main.png, 09-upload-confirm.png, 10-log-drawer.png, 11-result-browser.png
Row 5: 12-settings-main.png, 13-model-dialog.png, 14-agent-model.png, 15-voice-editor.png, 16-settings-empty.png
Row 6: 17-ws-concept.png, 18-ws-idle.png, 19-ws-streaming.png, 20-ws-skeleton.png, 21-ws-outline.png, 22-ws-empty-resource.png
Row 7: 23-rp-characters.png, 24-rp-worldview.png, 25-rp-hooks.png, 26-rp-events.png, 27-rp-overview.png, 28-rp-references.png, 29-rp-chapters-toc.png, 30-rp-voice-profile.png
Row 8: 31-buttons.png, 32-cards.png, 33-tags.png, 34-inputs.png, 35-chat-activities.png
```

- [ ] **Step 3: 逐帧视觉检查**

检查每张截图：
- 颜色是否符合 design tokens（Indigo/Violet 渐变系，非 Tailwind #FF4017）
- 字号是否正确（11px 最常用）
- 圆角是否正确（8px 标准卡片）
- 间距是否正确（8px 最常用 gap）
- Lucide 图标是否正确渲染（非 emoji）
- 文字是否为 Inter 字体
- 导航激活态是否有 #6366f126 填充 + #818CF8 左侧指示条
- 渐变方向是否正确（品牌 90°，背景 135°）

- [ ] **Step 4: 修复发现的问题**

对发现问题的帧执行 `batch_design` Update 操作修复，重新导出验证。

- [ ] **Step 5: 保存 .pen 文件**

确认所有 35 帧设计完成后，保存 `~/carpenter-app.pen`。

---

## Self-Review

### Spec coverage
- ✅ Design tokens (spec §1) → Task 1 Step 2 (set_variables)
- ✅ 页面布局 (spec §2) → Tasks 3-9 per-page frames
- ✅ 可复用组件 (spec §3) → Task 2 component reference frames
- ✅ 登录页 (spec §4.1) → Task 3 帧 01
- ✅ 注册页 (spec §4.2) → Task 3 帧 02
- ✅ 书库 (spec §4.3) → Task 4 帧 03-06
- ✅ 知识库 (spec §4.4) → Task 5 帧 07
- ✅ 拆解 (spec §4.5) → Task 6 帧 08-11
- ✅ 设置 (spec §4.6) → Task 7 帧 12-16
- ✅ 工作区 3 栏 (spec §4.7) → Task 8 帧 17-22
- ✅ 资源面板 10 视图 (spec §4.7.3) → Task 9 帧 23-30 (8 views; info+chapters 在帧 17/18 已覆盖)
- ✅ 交互状态 (spec §5) → 散布在各帧中(streaming/skeleton/empty/menu/dialog)
- ✅ Pencil v1.1.68 DSL (spec §6) → 所有 Task 步骤遵循

### Placeholder scan
- 无 TBD/TODO
- 每帧的节点结构都有具体设计值（颜色/字号/圆角/间距均来自 tokens）

### Type consistency
- 所有颜色值一致引用 spec tokens
- 所有帧尺寸一致（1440×900）
- IconRail 在 6 个工作区帧中一致（56px, #1A1A22, 相同图标列表）
- AppSidebar 在 5 个页面帧中一致（200px, #0F0F13, 相同导航项）
