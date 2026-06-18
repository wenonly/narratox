# narratox 工作台布局重构 — 设计文档(图标栏 + 可开关面板)

- 日期:2026-06-18
- 状态:已与用户确认(VS Code 式布局方向 approved),待 review
- 分支:`feat/icon-rail-layout`
- 范围:把工作台从「3 栏均分(左导航 256px + 聊天 + 右预览)」重构为「图标栏 ~48px + 聊天全宽 + 可开关资源面板」。聊天是主舞台,资源按需。**纯前端重构,后端不动。**
- 前置:v0.4.0(统一 swarm + 信息卡 + ChapterPreview + WritingChapter 信号)已完成。

---

## 1. 核心不变量

**聊天是主舞台,始终最宽。** 资源面板按需开关,不与聊天抢空间。进入工作台时聊天是焦点,不预选任何资源。

## 2. 布局

```
┌──┬──────────────────────────────┬─────────────┐
│📝│                              │             │
│📖│      💬 聊天(始终最宽)        │  资源面板    │
│👤│                              │  (可开关)   │
│🌍│                              │             │
│📊│                              │             │
│──│                              │             │
│ℹ️│                              │             │
│⚙️│                              │             │
└──┴──────────────────────────────┴─────────────┘
 ~48px     flex(聊天占满剩余)     ~40%(可关闭)
```

### 2.1 左侧图标栏(~48px,纯图标)
- 资源入口(从上到下):📝大纲(P2) · 📖正文(P1 功能就绪) · 👤角色(P2) · 🌍世界观(P2) · 📊状态(P3)
- 分隔线
- ℹ️ 小说信息(点击 → 右侧面板显示信息卡)
- ⚙️ 设置(跳 `/settings`)
- 底部:登出
- 点击资源图标 → 右侧面板打开对应资源视图 + 该图标高亮。
- 当前激活的图标高亮(brand 左边框)。

### 2.2 中间聊天(主舞台)
- `flex: 1`,始终占满图标栏和(可选)面板之间的全部空间。
- 复用现有 ChatPanel(MessageArea + ChatInput + useAIStreamHandler)。
- 聊天不随面板开关而重置(同一个 Agent session,同一个 store.messages)。

### 2.3 右侧资源面板(可开关)
- **默认关闭**(CONCEPT 和刚进入时)→ 聊天全宽。
- **Agent 写作时自动打开**(收到 `WritingChapter{order}` 信号)→ 📖图标高亮 + 面板显示 ChapterPreview(骨架→正文)。
- **用户点击左栏图标** → 面板打开对应资源(Phase 1 只有 📖正文=ChapterPreview + ℹ️信息卡;其他 P2/P3 灰显或提示"即将推出")。
- **用户点 × 或再点当前图标** → 面板关闭 → 聊天全宽。
- 面板宽度 ~40% 或固定 ~420px(可后续加拖拽)。

## 3. 各阶段行为

### 3.1 CONCEPT(立项)
- 面板关闭。聊天全宽。Agent 开场白(seed message)可见。
- ℹ️ 图标默认高亮(可点开信息卡面板查看/确认当前基础信息)。
- 用户和 Agent 对话收集信息 → 信息卡(点 ℹ️ 查看)随 update_novel 填充。
- 没有任何资源被预选——聊天就是焦点。

### 3.2 ACTIVE(写作)
- Agent 写章节 → `WritingChapter{order}` → 面板自动打开 + 📖 高亮 + ChapterPreview(骨架→正文)。
- 用户可关闭面板(×)→ 全宽聊天继续对话。
- 用户点 📖 → 重新打开章节面板(可切换章节浏览)。
- 用户点 ℹ️ → 切到信息卡面板(查看/编辑基础信息)。
- 用户点 📝👤🌍 → P2/P3 提示。

## 4. 前端改动

### 4.1 新组件:IconRail(取代 ResourceNav)
`agent-ui/src/components/workspace/IconRail.tsx`
- 纯图标竖栏(~48px)。图标列表(大纲/正文/角色/世界观/状态 + ℹ️ + ⚙️ + 登出)。
- Props:`activeResource: string | null`(当前选中的资源 key)、`onSelectResource: (key: string) => void`、`novelStatus: string`(CONCEPT/ACTIVE 决定哪些图标可用)。
- 点击图标 → `onSelectResource(key)`(切换右侧面板内容);再点当前图标 → `onSelectResource(null)`(关闭面板)。
- 暗色主题(bg #1a1a1d,图标 text-muted/40 默认 / brand 高亮)。

### 4.2 新组件:ResourcePanel(右侧可开关面板容器)
`agent-ui/src/components/workspace/ResourcePanel.tsx`
- Props:`resource: string | null`(当前显示的资源 key)、`novel: Novel`、`onClose: () => void`、`onSaved: () => void`。
- `resource === null` → 不渲染(聊天全宽)。
- `resource === 'chapters'` → `<ChapterPreview>`(现有组件,加 `‹›` 切换 + 骨架 + WritingChapter)。
- `resource === 'info'` → 信息卡(书名/类型/简介/文风,可编辑 → `updateNovel` API)。
- 其他(P2/P3)→ "即将推出"占位。
- 顶部:资源标题 + × 关闭按钮。

### 4.3 工作台页重构 — `app/novels/[id]/page.tsx`
- State:`activeResource: string | null`(默认 `null`)。
- `WritingChapter` 信号(从 store `writingChapterOrder`)→ `setActiveResource('chapters')`(自动打开章节面板)。
- 布局:`<IconRail>` + `<ChatPanel>` + `{activeResource && <ResourcePanel>}`。
- ChatPanel 的 `onAccepted`(turn-end refresh)照旧。

### 4.4 信息卡 → ResourcePanel('info')
- 从 ResourceNav(已删)迁移到 ResourcePanel。显示 novel.title/genre/synopsis/settings.style。
- 可编辑(inline edit → `updateNovel` API → refresh)。Phase 1 可先只读(编辑是后续增强)。

### 4.5 删除/改造
- ResourceNav.tsx → 删除(被 IconRail 取代)。
- ChapterDetail/ChapterPreview → 迁入 ResourcePanel(作为 'chapters' 视图)。

## 5. 非目标
- 面板拖拽调宽(后续)。
- 大纲/角色/世界观/状态面板内容(P2/P3)。
- 信息卡 inline 编辑(Phase 1 可只读;编辑是增强)。
- 图标栏可折叠/展开为文字栏(后续)。

## 6. 参考
- VS Code activity bar + side panel 模式。
- v0.4.0 的 WritingChapter 信号(驱动面板自动打开)。
