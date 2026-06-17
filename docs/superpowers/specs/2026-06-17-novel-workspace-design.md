# narratox 小说工作台 — 设计文档（Phase 1）

- 日期：2026-06-17
- 状态：已与用户确认，待 review
- 范围：把 narratox 从「通用 chat」演化为「以小说为中心、聊天驱动写作、资源可插拔」的工作台。本文定义 Phase 1（基础可写）的完整设计，并为 Phase 2/3 预留扩展点。

---

## 1. 背景与目标

narratox 当前（v0.1.0）是一个通用 agent chat：`User → Session → Message`，session 是裸聊天线程，没有「小说 / 章节 / 稿件」的概念，正文与聊天混在一起。

目标：把它变成 **AI 写小说工作台**——

- 以「小说（Novel）」为顶层项目；
- 作者通过**一个聊天会话**与 AI 协作（一本小说一份 AI 记忆）；
- AI **提案**正文 / 大纲 / …，作者**采纳**后写入对应资源；
- 左栏是小说的「资源」导航，右侧随选中资源切换详情视图，未来可插拔扩展（大纲 / 角色 / 世界观 / 状态）。

设计原则：**复用 v0.1.0 的全部聊天基建**（鉴权、流式、Session/Message、LangGraph checkpointer），改动最小；**从第一天就把扩展接缝定型**（mutation 层、资源 4 件套、上下文组装器），让 Phase 2/3 不重构主结构。

---

## 2. 核心模型（不变量）

工作台是三栏，**中间聊天恒定、左右随交互变化**：

| 区域 | 内容 | 是否随交互变化 |
|---|---|---|
| 左栏 | 小说资源导航（‹小说库 / 当前书 / 章节 / 大纲 / 角色 / 世界观 / 状态 / ⚙登出） | 随选中项高亮变化 |
| 中间 | 聊天（一本小说 = 同一个 Agent session，恒定不动） | **不变** |
| 右栏 | **当前选中资源的详情视图** | 随左栏选中项切换 |

右栏详情视图的多态：

- 选中「章节」→ 章节正文（稿件）
- 选中「大纲」→ 大纲结构（总纲/卷/每章要点）
- 选中「角色」→ 角色卡片列表
- 选中「世界观」→ 世界观文字描述与结构

**关键不变量：中间聊天恒定；右侧随左栏切换；新资源 = 左栏加一项 + 右栏加一种视图 + 一个资源 handler + 一份上下文 slice。** Phase 1 左栏只有「章节」，其余为 P2/P3 占位（灰显）。

---

## 3. 整体结构（页面地图）

```
/login · /register            （已有）
/                小说库        （NEW，登录后落地页）
/novels/[id]     小说工作台    （NEW，写作主战场）
/settings        应用设置      （NEW，极简：回显当前模型）
```

---

## 4. 数据模型（Phase 1）

新增 `Novel`、`Chapter`；`Novel` 与现有 `Session` 1:1（复用聊天线程）。**聊天（Message）与稿件（Chapter.content）严格分离。**

```
User (已有)
 └─ Novel (NEW, 1—N)
      ├─ sessionId ──1:1──▶ Session (已有，改归属为"小说的聊天线程")
      │                       └─ Message (已有 = 作者⇄AI 聊天记录)
      └─ Chapter (NEW, 1—N)   content = 稿件正文
```

### Prisma（Phase 1 草案）

```prisma
model Novel {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  sessionId String   @unique                 // 1:1 聊天线程 = LangGraph thread_id
  session   Session  @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  title     String
  genre     String?
  synopsis  String?                          // 一句话故事/简介
  settings  Json     @default("{}")          // { style, language, chapterWordTarget, worldviewText, ... }
  createdAt DateTime @default(now())
  updatedAt DateTime @default(now())
  chapters  Chapter[]
  @@index([userId, updatedAt])
}

model Chapter {
  id        String       @id @default(cuid())
  novelId   String
  novel     Novel        @relation(fields: [novelId], references: [id], onDelete: Cascade)
  order     Int                                   // 章节序号，从 1 起
  title     String
  content   String       @default("")             // 稿件正文（markdown）
  status    ChapterStatus @default(DRAFT)
  createdAt DateTime     @default(now())
  updatedAt DateTime     @default(now())
  @@unique([novelId, order])
  @@index([novelId, order])
}

enum ChapterStatus {
  DRAFT        // 空章 / 草稿
  COMMITTED    // 已被「采纳」落稿
}
```

### 关键点

- `Novel.sessionId` 1:1 指向 `Session`：现有 `Session`（=LangGraph thread）+ `Message`（聊天历史）+ 流式 + checkpointer **原样复用**，只是 session 从「顶层会话」降级为「小说内部的聊天线程」。需给 `Session` 加一个可选反向关系 `novel Novel?`（满足 Prisma `@relation`），其余 `Session` 字段（id/userId/agentId/name/...）不变。
- 「采纳」= 把某条 AI 聊天消息的 `content` 写入选定 `Chapter.content`。聊天记录不动。
- `Chapter.status` 枚举现在就定义（cheap insurance）：Phase 1 的「采纳」= `DRAFT → COMMITTED`。Phase 2 可加 `REVIEWED` 等。
- `Novel.settings`（JSON）放每本小说的写作设定，喂给上下文组装器（见 §6）。

---

## 5. 写入层（mutation / 资源 4 件套）

所有「把内容落到资源」的写入，走**统一的 mutation 接口**。Phase 1 只实现 `chapter`，但接口定型，未来加资源只注册新 handler。

### 接口

```ts
type ResourceType = 'chapter' // Phase 1；Phase 2+: | 'outline' | 'character' | 'worldview' | 'status'
type MutationOp = 'set' | 'append' | 'patch'

interface ResourceMutation {
  resource: ResourceType
  targetId: string
  op: MutationOp
  content: string
}

interface ResourceHandler {
  resource: ResourceType
  apply(userId: string, mutation: ResourceMutation): Promise<void>
}
```

### 资源 4 件套（可插拔的全部含义）

每新增一种资源 = 补这 4 件，聊天与写入层都不用改：

1. 一个 `apply(mutation)` 服务（ResourceHandler 实现）；
2. 左栏一个导航项；
3. 右栏一种详情视图；
4. 一份「上下文 slice」（喂给写作 Agent，见 §6）。

### Phase 1 实现

- 唯一 handler：`ChapterHandler`。
  - `op: 'append'` → `chapter.content += content`（默认；「接着写」）；
  - `op: 'set'` → `chapter.content = content`（「重写本章」）；
  - 落库后将 `status` 置为 `COMMITTED`，刷新 `updatedAt`。
- 「采纳到本章」按钮调用 `POST /novels/:id/accept { chapterId, op, content | sourceMessageId }` → 构造 mutation → `ChapterHandler.apply`。
- 所有 handler 按 `userId` 隔离（沿用 v0.1.0 的多租户纪律）。

> Phase 1 不实现 webnovel-writer 的完整 commit + 投影扇出（StoryEvent / ChapterCommit / ProjectionRun 等表）——YAGNI。只把 mutation 接口与 `Chapter.status` 定型，留好接缝。投影扇出留 Phase 2/3。

---

## 6. 上下文组装器 & 写作 Agent

新增 `ContextAssembler`：把小说的设定组装成写作 Agent 的系统 prompt。

### Phase 1（lite）

- 读 `Novel`（title / genre / synopsis / settings）+ 一段基础「小说写作助手」prompt，拼成 system prompt。
- 现有 `deep-agent`（GLM-5.2 + Postgres checkpointer）改用**每本小说动态的 system prompt**（当前 `SYSTEM_PROMPT` 是常量，改为按 novel 组装）。
- 聊天记忆仍由 checkpointer 按 `thread_id = novel.sessionId` 自动加载。
- Phase 1 不注入稿件正文 / 大纲 / 角色到上下文（那些资源 P1 还没有），靠聊天记忆 + 设定。

### 输出形态（借鉴 webnovel-writer 的 context-agent）

- 组装出的 prompt 是**作者视角的自然语言**，不是 JSON 字段堆。
- Phase 2 扩成「5 段写作任务书」lite→full：开篇委托 / 这章的故事 / 人物 / 怎么写 / 收尾；优先级 `用户要求 > 章纲 > 总纲设定 > 前文摘要 > 记忆`。

---

## 7. 页面设计

### 7.1 小说库 `/`（NEW，落地页）

- 小说卡片网格：每张卡片显示 title / genre / synopsis 摘要 / updatedAt。
- 「新建小说」→ 采集 title / genre / synopsis / 设定文本（style/language/chapterWordTarget/worldviewText）→ `POST /novels`（后端同时创建 1:1 的 Session 作为聊天线程）→ 跳转 `/novels/[id]`。
- 点卡片 → 进入工作台。
- 登出入口。

### 7.2 工作台 `/novels/[id]`（NEW，三栏）

- **左栏（资源导航）**：`‹小说库` + 当前书名 + `📖 章节`（章节列表，可选中、`+ 新章`）+ `📝 大纲 / 👤 角色 / 🌍 世界观 / 📊 状态`（P2/P3 占位，灰显）+ `⚙ 设置 · 登出`。
- **中间（聊天）**：复用现有 chat 组件与流式。当前选中章节 = 「写作目标」，顶部显示 `✍ 目标：第 N 章`。AI 回复气泡带「采纳到第 N 章 ↗」按钮。**采纳前需已选中（或新建）一章作为目标；无目标时采纳按钮禁用。**
- **右栏（选中项详情）**：选中章节 → 显示该章正文（Phase 1 为 markdown 渲染 + 可直接以纯文本编辑，非富文本编辑器）；底部 tab 占位 `[正文] 世界观 角色 状态`。

### 7.3 应用设置 `/settings`（NEW，极简）

- Phase 1：**回显当前模型（GLM-5.2）+ endpoint 状态**（只读）。
- 占位 UI 给以后：模型选择 / 各模型参数自定义 / 主题切换。
- 与写作无关，纯应用设置。

> 每本小说的写作设定（类型/风格/设定文本）**不在配置页**，而是跟着 Novel 走（新建时采集，存 `Novel.settings`）。Phase 1 可加「编辑小说设定」入口（可选）。

---

## 8. 服务分离纪律（借鉴 webnovel-writer）

- **提案（写作 Agent）、审查（Phase 2）、事实抽取（Phase 2/3）是独立服务**，不让同一个 LLM 既写又判。
- Phase 1：用户即审查者，**跳过 LLM 审查**。
- 写入只走 mutation 层（§5），写作 Agent 本身不直接改资源；Phase 2 才给 Agent 加受控工具（`write_chapter` / `set_outline_beat` / `add_character`），工具内部仍调同一个 mutation 层。

---

## 9. API（Phase 1，server）

所有端点鉴权 + 按 `userId` 隔离（沿用全局 guard + `@CurrentUser`）。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/novels` | 建小说（含 1:1 Session）；body: title/genre?/synopsis?/settings? |
| GET | `/novels` | 列出当前用户的小说 |
| GET | `/novels/:id` | 小说 + 章节列表 |
| PATCH | `/novels/:id` | 改 title/genre/synopsis/settings |
| DELETE | `/novels/:id` | 删小说（级联章节 + 其 Session/Message） |
| POST | `/novels/:id/chapters` | 建章（自动 order） |
| GET | `/novels/:id/chapters` | 列章 |
| PATCH | `/novels/:id/chapters/:cid` | 改 title/order |
| POST | `/novels/:id/accept` | 采纳：{ chapterId, op, content \| sourceMessageId } → mutation → ChapterHandler |
| POST | `/agents/:id/runs` | **复用**现有流式聊天；`session_id = novel.sessionId`；system prompt 按小说组装 |
| GET | `/settings`（或复用 `/health`） | 回显当前模型 / endpoint 状态 |

---

## 10. Phase 1 构建路线（M0 → M4，每个是端到端纵向切片）

- **M0 数据模型 + 写入层骨架**：Prisma 加 Novel/Chapter(+status)；Novel 1:1 Session；mutation 接口定型；后端 `/novels`、`/novels/:id/chapters` CRUD、`/accept`。
- **M1 上下文组装器 + Agent**：`ContextAssembler`（lite）按小说拼 system prompt；聊天绑定 novel.sessionId，复用流式。
- **M2 前端 · 小说库**：`/` 卡片网格 + 新建小说（采集设定）。
- **M3 前端 · 工作台三栏**：左栏资源导航（P1 只章节）+ 中聊天（复用 + 「采纳到本章」）+ 右稿件详情；采纳 → accept mutation。
- **M4 前端 · 配置页**：`/settings` 回显模型 + 占位。

M4 跑完 → 全链路可用 → 打 tag（如 `v0.2.0`）。

---

## 11. 分期与扩展预留（Phase 2 / 3，只设计不实现）

| 资源 / 能力 | Phase | 内容 |
|---|---|---|
| 大纲（outline） | P2a | 总纲→卷→每章要点；既是写作目标又是写作依据（上下文 slice） |
| 角色（characters） | P2b | 实体 + 分级（核心/重要/次要/装饰）+ 关系；tier 决定上下文用量 |
| 世界观（worldview） | P2b | 设定文档/规则 |
| 状态 / 伏笔（status） | P3 | StoryEvent 10 类 + open_loop/promise 账本 + MemoryItem（status 生命周期，处理 retcon） |
| LLM 审查 | P2 | 5 维（设定/时间/连贯/角色/逻辑），每维强制出结论；`blocking_count` 门槛 |
| Agent 工具 | P2+ | `write_chapter`/`set_outline_beat`/`add_character`，内部走 mutation 层 |
| commit + 投影扇出 | P2+ | ChapterCommit 单一写路径 + 幂等/可重试投影 + ProjectionRun 追踪 |
| 多模型 / 主题 | later | `/settings` 的模型选择、参数、主题切换 |

**接缝已就位**：mutation 层（§5）+ 资源 4 件套 + `Chapter.status` 枚举 + ContextAssembler。Phase 2/3 加资源 = 注册 handler + 导航项 + 详情视图 + 上下文 slice，不改主结构。

---

## 12. 参考项目与借鉴点

- **inkos**（`~/project/inkos`，TS / Vite+Hono 工作台）：左栏多资源导航 + 右栏多态详情；agent 工具受控改稿件；SSE 单总线 + 类型化事件；JSON 真相 + MD 投影。
- **webnovel-writer**（`~/project/webnovel-writer`，Python / Claude Code 插件）：门控流水线（context→draft→review→polish→commit）；「大纲即法律」契约；StoryEvent 10 类事件溯源；commit 单一写路径 + 5 投影扇出（幂等/可重试）；MemoryItem 分层 + status 生命周期；服务分离（提案≠审查≠抽取）。

直接采纳：mutation = commit 单一写路径的骨架；ContextAssembler = context-agent 5 段简报（lite→full）；服务分离纪律。详见各 Phase 映射。

---

## 13. 非目标（Phase 1 不做）

- 大纲 / 角色 / 世界观 / 状态 的 UI 与数据表（P2/P3）。
- LLM 审查、Agent 工具（function-calling 直写资源）（P2+）。
- 完整 commit + 投影扇出 / 事件溯源 / 记忆系统（P2/P3）。
- 富文本编辑器（Phase 1 稿件为 markdown 只读渲染 + 简单编辑）。
- 多模型选择 / 主题切换（later）。
