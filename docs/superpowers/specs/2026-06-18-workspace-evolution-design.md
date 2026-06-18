# narratox 工作台 UX 演进 — 设计文档(v0.4.0)

- 日期:2026-06-18
- 状态:已与用户确认,待 review
- 分支:`feat/workspace-evolution`
- 范围:把工作台从「左侧章节列表 + 手动采纳/新章 + 右侧单章显示」演进为「左侧信息卡+资源(不列章节)+ 右侧章节预览(AI 自动写、写作时骨架+自动跳转、可切换)」,并把「创建」合并进工作台(统一 swarm,早建 Novel,主 Agent 按状态切立项/写作)。
- 前置:v0.3.0(多 agent swarm:创作 Agent + 工作台 swarm)已完成;创作记忆 bug 已修(be43407,创作 Agent 加 checkpointer)。

---

## 1. 背景与目标

v0.3.0 的工作台三个问题:
1. **左侧列章节 + 手动新章** —— 章节推进应是 AI 驱动(基于已有信息判断写哪章),不是用户手动管。
2. **右侧只显示"选中章"** —— 应是"预览区":AI 写作时自动跳到该章 + 骨架加载,写完可查看可切换。
3. **创建与写作割裂**(`/novels/new` 创作 chat → 跳 `/novels/[id]` 工作台)—— 应是平滑过渡:信息卡边问边填,填满后章节区顺势出现。

本版本统一为:**一个工作台页面、一个 swarm**,主 Agent 按小说状态切换"立项/写作",左侧信息卡 + 右侧章节预览。

**核心原则**:章节由 AI 驱动(自动判断 + 自动建章);用户在右侧预览/浏览;创建→写作原地过渡。

---

## 2. 架构:统一 swarm

**删掉** separate 创作 Agent + `/novels/new` 页(合并进工作台 swarm)。

**新建小说流程**:
1. 小说库「新建小说」→ `POST /novels`(bare:title 占位,`status: CONCEPT`,seed 第 1 章)→ 跳 `/novels/[id]`。
2. 工作台 swarm 的**主 Agent** 检测 novel 状态(由 `ContextAssembler` 注入 prompt):
   - **基础信息不全(CONCEPT)**→ 立项模式:问答收集书名/类型/世界观/文风 → 每轮调 `update_novel` 工具 → FE 每轮 refresh 读 novel → 左侧信息卡实时填充。
   - **信息齐了**→ 路由模式:调 `transfer_to_writer`。
3. **写作 Agent**:`list_chapters` 看现有章节 → 判断写哪章(第一个无内容的 / 上一章 COMMITTED 的 +1)→ `write_chapter(order=N)`(按序号**自动建章**若不存在)→ 服务端发 `WritingChapter { order:N }` 信号。
4. **右侧预览区**:收到 WritingChapter → 跳到第 N 章 + 骨架加载 → 流结束 refresh → 显示正文 + 可 `‹ ›` 切换浏览。Novel 首次 write_chapter 落内容后 `CONCEPT → ACTIVE`。

主 Agent 的 prompt 由 `ContextAssembler` 按 novel 状态组装:CONCEPT 强调立项(update_novel);ACTIVE/信息齐 强调路由(transfer_to_writer)。主 Agent 始终持有 `update_novel` + `transfer_to_writer` 两个工具,按 prompt 指引选用。

---

## 3. 数据模型 + 工具

### 3.1 Novel.status(新)
`Novel` 加 `status: NovelStatus` 枚举:
- `CONCEPT` —— 立项中(bare novel,基础信息不全 / 还没写章)。小说库显示"构思中"标签。
- `ACTIVE` —— 已开始写作(首次 `write_chapter` 落内容后自动翻)。
- 默认 `ACTIVE`(对历史数据);「新建小说」早建的 = `CONCEPT`。
- **半成品处理**:用户中途放弃 → 留下 CONCEPT 小说(不污染 ACTIVE 列表;可删可继续)。不做自动清理(YAGNI)。

`write_chapter` 落内容时若 novel 仍 `CONCEPT` → 翻 `ACTIVE`。

### 3.2 update_novel 工具(新)
主 Agent 立项时调,改 novel 的 title/genre/synopsis/settings(worldviewText/style)。封装 `NovelService.update`,`userId`/`novelId` 闭包注入。
```
update_novel({ title?, genre?, worldviewText?, style? }) → NovelService.update(userId, novelId, dto)
```

### 3.3 write_chapter 改造:按序号自动建章
v0.3.0:`write_chapter(chapterOrder)` → `findByOrder` → 不存在报 `{ok:false}`。
v0.4.0:`write_chapter(chapterOrder)` → 若该序号不存在 → **自动创建**(ChapterService.create 到该 order)→ 再写。取代手动新章 + not-found 报错。Agent 一个工具搞定"推进+建章+写"。

### 3.4 WritingChapter 信号(新)
swarm 流(`streamMode:'messages'`)里,写作 Agent 调 `write_chapter` 会产生带 `tool_calls` 的 AIMessage。`WorkspaceSwarmService.streamTurn`(或 stream-adapter)检测到 `write_chapter({chapterOrder:N})` 工具调用时,产出一个 **`WritingChapter { order:N }`** 标记帧(与 RunContent 并行)。FE 收到 → 右侧跳第 N 章 + 骨架。

> 实现要点:streamTurn 目前只 yield 字符串 delta(extractDelta)。需要扩展:遍历 chunk 时,若该 chunk 是带 `write_chapter` tool_call 的 AIMessage,额外 yield 一个结构化信号(或 controller 层把它编成 `WritingChapter` 帧写入流)。FE `useAIStreamHandler` 加一个 `WritingChapter` 事件分支。

---

## 4. 前端

### 4.1 统一工作台页 `/novels/[id]`
- 删 `/novels/new` + `CreationChat`。小说库「新建小说」→ `POST /novels`(CONCEPT)→ `router.push('/novels/[id]')`。
- 工作台页复用,mode 统一 `workspace`(创作/写作都是 workspace swarm,主 Agent 按状态切)。

### 4.2 左侧 ResourceNav 改造
- **去掉**「📖 章节」列表 + 「+ 新章」。
- **加「📖 小说信息卡」**:显示 novel 的 title / genre / worldviewText / style(读 novel,每轮 refresh 更新 → 立项时边问边填)。
- 资源占位(大纲/角色/世界观/状态)保留。

### 4.3 右侧 ChapterDetail → ChapterPreview
- **加章节切换器** `‹ 第 N 章 ›`(prev/next 或下拉),可浏览任意章(只读)。
- **WritingChapter 信号**:收到 `{order:N}` → 自动跳到第 N 章 + 显示**骨架加载**(写作中)。
- 流结束 refresh → 显示正文。编辑功能(PATCH)保留。
- 当 novel 还是 CONCEPT(无章节内容)→ 右侧显示"立项中,信息收集完成后开始写作"占位。

### 4.4 信息卡 / 章节预览的更新
都靠**每轮 turn-end refresh**(ChatPanel 已有 isStreaming false→true→false 订阅 → refresh)。update_novel 改了 → refresh → 卡片更新;write_chapter 写了 → refresh → 章节内容更新 + CONCEPT→ACTIVE。

---

## 5. 范围(v0.4.0)与非目标

**做**:
- 统一 swarm(主 Agent 立项/写作双模式)+ 创作合并 + 删 /novels/new。
- Novel.status(CONCEPT/ACTIVE)+ 小说库"构思中"标签。
- update_novel 工具;write_chapter 自动建章。
- WritingChapter 信号 + 右侧预览(切换器 + 骨架 + 自动跳转)。
- 左侧信息卡(实时填充)。

**不做(非目标)**:
- 世界观/角色/状态资源(仍 P2/P3 占位)。
- 大纲管理。
- CONCEPT 小说的自动清理(用户手动删/续)。
- 跨小说的"构思中"列表筛选 UI(仅标签区分)。

---

## 6. 风险

- **主 Agent 状态切换可靠性**:主 Agent 需可靠判断"信息齐了→转写作"。ContextAssembler 注入的状态 + prompt 指引是关键。需验证(类似 v0.3.0 的 handoff spike)。回退:若主 Agent 判断不稳,可加一个显式 `start_writing` 工具/状态门槛。
- **WritingChapter 信号**:依赖从 swarm 流里准确检测 write_chapter tool_call。需测。
- **write_chapter 自动建章的 order 推进**:Agent 需正确判断"下一章序号"(list_chapters → max order +1,或第一个无内容章)。prompt 引导 + list_chapters 支撑。

---

## 7. 参考
- v0.3.0 spec/plan(多 agent swarm 基础)。
- `docs/references/webnovel-writer-workflow-reference.md`(信息收集/章纲方法论)。
- `docs/references/inkos-workflow-reference.md`(创作问答 + draft 卡片)。
