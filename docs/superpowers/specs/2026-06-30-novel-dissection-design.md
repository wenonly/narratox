# 拆解小说 Agent + 全局对标库 + per-agent 模型配置（Phase 22）

- **日期**：2026-06-30
- **状态**：设计稿（待审）
- **关联**：参考 [docs/references/oh-story-claudecode-reference.md](../../docs/references/oh-story-claudecode-reference.md) 第 8 节「对标拆文 → 写作消费的资产链路」；承接 Phase 21。
- **可视化草案**：`.superpowers/brainstorm/`（overview / storage-model / granularity / oh-story-vs-narratox / dissect-architecture / full-system-design / ui-mockup）。

---

## 1. 背景与目标

narratox 目前是「从零创作」，缺 oh-story 那种「看懂别人爆款」的能力（参考文档 P2 §12.7 明确列为 narratox 完全缺失、建议单独立项的方向）。本 Phase 引入：

1. **拆解小说模块**：主页独立大模块，上传一本小说 → 全文逐章完全拆解 → 结构化存入**全局对标库**。
2. **全局对标库**：跨小说共享的「对标素材库」，写作时各 agent 按需只读引用（不触发拆解）。
3. **per-agent 模型配置**：让拆解主力子 agent 用便宜模型、关键 agent 用强模型，从结构上避免 token 爆炸。配置项从 `AGENT_TREE` 自动派生，新增子 agent 零额外代码自动出现。

**非目标**（明确排除）：
- 不做「写作中途上传文件实时拆解」——拆解动作只在主页模块发生；写作时只引用已有对标库。
- 不做「逆向导入」（拆自己写的小说反建成设定/大纲/角色）——本期仅「对标参考」语义。
- 不做模型成本感知 / 价格标注（系统无从得知 openai-compatible 接的 provider 价格）。

---

## 2. 需求决策汇总（均已与作者确认）

| # | 决策 | 选择 |
|---|---|---|
| 1 | 拆解语义 | **对标参考**：拆别人的爆款当学习素材，产出进对标库，写作时注入参考，不变成我小说的正式设定 |
| 2 | 对标库归属 | **全局对标库（方案 A）**：独立 `Benchmark` 表，跨小说共享，与 `NovelReference`（绑定小说）分离 |
| 3 | 拆解颗粒度 | **全文逐章完全拆解**（oh-story 式）：逐章摘要 + 全维度结构化 |
| 4 | 拆解入口 | **仅主页独立模块**；写作时只读引用对标库，不拆解 |
| 5 | 运行模式 | **异步后台 + 实时日志**：状态/进度持久化，日志流式推送**不落库**，点「查看详情」开抽屉看实时日志，断线重连不补历史 |
| 6 | 写作引用触发 | **提示词指导各 agent 按需拉**：main/writer/outliner 等在各自提示词被告知「什么阶段拉什么 benchmark」，配 `get_benchmark` 工具 |
| 7 | per-agent 模型配置 | **全局所有 agent 都能配**，放设置页；分组 + agent 描述 + 推荐模型 badge；从 `AGENT_TREE` 自动派生配置项 |
| 8 | token 防护 | 每次拆解前**弹窗二次确认**（警告消耗大 + 预估耗时/token） |

---

## 3. 整体架构

三大块端到端：

```
主页「拆解小说」模块                          设置页 per-agent 模型配置
  上传 → 二次确认弹窗                           从 AGENT_TREE + DISSECT_TREE 派生
  → 异步拆解（实时日志抽屉）                     分组 / 描述 / 推荐模型 badge / 下拉
        │                                          │
        ▼                                          ▼
  DissectAgentService（独立 agent run）      AgentModelOverride 表
  dissect-main + 5 子 agent                  resolveModel: override 优先 → 回退 active
  per-agent 模型（便宜/中/强）                    │
        │                                          │
        ▼                                          ▼
  全局对标库（BenchmarkBook + BenchmarkEntry）  写作 agent 引用
  type: CHAPTER/PLOT/RHYTHM/EMOTION/          get_benchmark(type?) 按需拉
  CHARACTER/STYLE                            提示词指导（写大纲/写作/建角色）
```

**关键架构原则**：
- **拆解是独立 agent run，不绑定 novel**。现有 `POST /agents/:id/runs` 经 `ContextAssembler.forSession` 拿 `novelId`；拆解对象是「对标书」，不属于任何 novel，故另起入口与服务。
- **per-agent 配置项零手维护**：遍历 `AGENT_TREE + DISSECT_TREE` 自动渲染。加子 agent = 加树配置，设置页自动多一项。
- **复用活动帧协议**：拆解日志用现有 `Act*` / `RunStarted` / `RunCompleted` 帧（`createActivityEmitter` / `aggregateActivities`），前端日志抽屉复用流式解析。

---

## 4. 拆解 Agent 设计

### 4.1 DISSECT_TREE（新增声明式树）

与 `AGENT_TREE` 并列，根为 `dissect-main`。文件：`server/src/agentos/dissect-tree.config.ts`（仿 `agent-tree.config.ts`）。prompts 走 `server/src/agentos/prompts/dissect-*.md`（6 个）。

| agent | recommendedTier | modelTier | 职责 | 产出 type |
|---|---|---|---|---|
| **dissect-main** | strong | long | 拆解主编排：切章 → 逐章委派 chapter-extractor → 全书维度委派 analyst → 审核委派 critic | — |
| **chapter-extractor** | cheap | short | **逐章拆**（跑最多次）：每章产 1 条摘要 + 情节点 + 角色提及。调 `write_benchmark(type=CHAPTER)` | CHAPTER × N |
| **plot-analyst** | strong | long | 基于全章摘要，拆剧情线 + 节奏 + 情绪模块（oh-story 三大权威源） | PLOT / RHYTHM / EMOTION |
| **character-extractor** | mid | long | 基于全章角色提及，建主要角色卡（人设/动机/弧光） | CHARACTER × N |
| **style-analyst** | mid | long | 抽样关键章，拆文风指纹（句长/标点/对话 + 原文锚点） | STYLE |
| **dissect-critic** | strong | long | 审核拆解完整性/一致性，漏则补；产质量报告 | — |

> `recommendedTier`（strong/mid/cheap）是**纯 UI 标注**，运行时不读；`modelTier`（long/short）仍是 maxTokens 档位（沿用现有语义）。两者正交。

### 4.2 运行模式（异步后台 + 流式日志）

拆解逐章必然慢（几十分钟），不能挂在单 HTTP 请求生命周期里。设计：

- **`DissectAgentService.startDissect(bookId)`**：启动**后台 Promise（不 await）**，agent 在 event loop 跑到完成或进程退出。内部：
  - 跑 DISSECT_TREE 的 agent graph（仿 `buildAgentGraph`，但 root prompt 来自拆解 context，不是 novel context）
  - 经 `createActivityEmitter` emit 活动帧 → 推到该 book 的 in-memory `EventEmitter`
  - 每章拆完更新 `BenchmarkBook.progress`（`{ chapter: X, total: N, agent: 'chapter-extractor' }`）
- **job map**：`Map<bookId, { emitter, abortController }>`（单进程，Nest 单例）。
- **`POST /benchmarks/:id/dissect`**：校验 → 触发 `startDissect` → **立即转流式**：订阅该 book 的 emitter，把活动帧 newline-JSON 推到 `res`；`req.on('close')` **不 abort job**（拆解继续在后台），仅结束本次推送。
- **`GET /benchmarks/:id/stream`**：断线重连入口。订阅 emitter 推**新日志**（历史不补，符合「日志不落库」）；job 已结束则推当前 status 后关闭。
- **心跳保活**：流式端点每 15s 推一个 `{event:'Heartbeat'}`，防代理超时切断。
- **进程重启兜底**：启动时扫 `status=RUNNING` 的 BenchmarkBook → 标 `INTERRUPTED`（前端提示「进程重启，需重新拆解」）。第一版**不支持断点续传**，失败/中断重头来（删 entries + 重新 dissect）。

### 4.3 拆解 context（独立于 novel）

新建 `DissectContextAssembler.forBook(userId, bookId)`：返回 `{ prompt, bookId }`。prompt 含【本书信息】（书名/章数）+【拆解任务说明】+【产出规范】（每个 type 写什么、调 `write_benchmark` 的格式）。无世界观/角色/大纲 slice（那是 novel context）。

### 4.4 拆解 tools（新增，挂 DISSECT_TREE，走 `TOOL_REGISTRY`）

- **`write_benchmark`**（写）：`{ type, title, content, order?, chapterNo? }` → 写一条 BenchmarkEntry。`userId`/`bookId` 闭包注入（安全，模型不能写别人的书）。chapter-extractor 每章调一次（type=CHAPTER, chapterNo=N）。
- **`get_raw_chapter`**（读）：`{ chapterNo }` → 取原文第 N 章（按章号切分后的片段，控 token）。chapter-extractor 拆当前章时调。
- **`get_dissect_entries`**（读）：`{ type?, chapterNo? }` → 取已拆条目。plot-analyst / character-extractor 基于已拆 CHAPTER 条目做全书分析时调。
- **`report_dissect_review`**（写）：dissect-critic 产质量报告（存 BenchmarkBook.review JSON）。

> 章节切分：上传时按「第N章」/「Chapter N」正则预处理切分，存 `BenchmarkBook.chapters Json`（章号→原文偏移），`get_raw_chapter` 按偏移取片段。切分失败（无明显章节标记）→ 按字数均分 + 告警。

---

## 5. 数据模型（Prisma 变更）

新增 3 张表 + 1 个 enum + AgentSpec 扩展。**手动 `prisma generate`**（Phase 11/12/18/21 的已知 gotcha：migrate dev 不自动 regenerate client）。

```prisma
/// 全局对标库：一本拆解书。跨小说共享，与 novel 无关。
model BenchmarkBook {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  title     String                     // 对标书名（用户填或从文件名取）
  rawText   String                     // 原文全文（Postgres text 足够大）
  chapters  Json     @default("[]")    // 章节切分索引 [{chapterNo, offset, length, title}]
  status    BenchmarkStatus @default(PENDING)
  progress  Json     @default("{}")    // { chapter, total, agent } 拆解进度
  review    Json?                      // dissect-critic 质量报告
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  entries   BenchmarkEntry[]

  @@index([userId, updatedAt])
}

/// 拆解产物条目。一本 book 产出 N 条（CHAPTER 多条、其余各几条）。
model BenchmarkEntry {
  id        String            @id @default(cuid())
  bookId    String
  book      BenchmarkBook     @relation(fields: [bookId], references: [id], onDelete: Cascade)
  type      BenchmarkEntryType
  title     String
  content   String            @default("")
  chapterNo Int?              // type=CHAPTER 时：第几章；其余 null
  order     Int               @default(0)  // 同 type 内排序
  createdAt DateTime          @default(now())
  updatedAt DateTime          @updatedAt

  @@index([bookId, type])
  @@index([bookId, chapterNo])
}

enum BenchmarkStatus {
  PENDING       // 已上传，待二次确认
  RUNNING       // 拆解中
  DONE          // 完成
  FAILED        // 失败
  INTERRUPTED   // 进程重启中断
}

enum BenchmarkEntryType {
  CHAPTER     // 章节摘要（逐章，多条）
  PLOT        // 剧情线
  RHYTHM      // 节奏（爆发节律/信息推进）
  EMOTION     // 情绪模块（读者需求/爽点引擎）
  CHARACTER   // 角色卡（多条）
  STYLE       // 文风指纹
}

/// per-agent 模型覆盖：用户为某 agent 指定用哪个 ModelConfig。
/// (userId, agentKey) 唯一。agentKey = AgentSpec.name（写作树 + 拆解树全局唯一）。
model AgentModelOverride {
  id            String @id @default(cuid())
  userId        String
  user          User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  agentKey      String   // 如 'chapter-extractor' / 'writer' / 'dissect-main'
  modelConfigId String
  modelConfig   ModelConfig @relation(fields: [modelConfigId], references: [id], onDelete: Cascade)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([userId, agentKey])
  @@index([userId])
}
```

`User` / `ModelConfig` 加反向关系字段（`benchmarkBooks BenchmarkBook[]` / `agentOverrides AgentModelOverride[]`）。

**AgentSpec 扩展**（`agent-tree.config.ts`）：
```ts
export type RecommendedTier = 'strong' | 'mid' | 'cheap';
export interface AgentSpec {
  // ...现有字段...
  recommendedTier?: RecommendedTier; // 新增：纯 UI 标注，运行时不读
  // modelOverride 注释位保留（per-agent 通过 AgentModelOverride 表实现，不在此字段）
}
```
给现有所有 spec 补 `recommendedTier`（main/validator/critic/wb-critic 等 strong；writer/outliner 等 mid；settler/consistency 类 cheap）。group 不加字段——**从树派生**（见 §8.2）。

---

## 6. 后端设计

### 6.1 DissectAgentService（新增）

文件：`server/src/agentos/dissect-agent.service.ts`。仿 `DeepAgentService`：
- `buildDissectGraph(args)`：递归 `buildNode` 走 **DISSECT_TREE**（复用 `createAgent` + `createSubAgentMiddleware` + `createSummarizationMiddleware` + `createPatchToolCallsMiddleware` 栈）；tools 走 `TOOL_REGISTRY`（拆解 tools 的 `ToolDeps` 加 `bookId` + `BenchmarkService`）；model 经 `resolveModel(spec, overrideMap, activeConfig)`。
- `startDissect(userId, bookId)`：后台 Promise 跑 agent stream → emit 活动帧 → 更新 progress；写入 job map。
- **复用** `getModel` cache 机制（cache key 含 config.id → per-agent 不同 ModelConfig 天然不同缓存）。

### 6.2 per-agent 模型解析（改 resolveModel 链）

- 新建 `AgentModelOverrideService.listMap(userId): Promise<Map<string, ModelConfigRecord>>`（一次 DB 读全量 override，含 apiKey）。
- `DeepAgentService.runTurn` / `DissectAgentService.startDissect` 开头：`const overrideMap = await overrides.listMap(userId);` 传入 `buildAgentGraph` / `buildDissectGraph`。
- `buildNode` 内：`const cfg = overrideMap.get(spec.name) ?? activeConfig;` → `getModel(resolveModelConfig(spec, cfg), MAX_TOKENS_BY_TIER[spec.modelTier])`。
- `resolveModelConfig(spec, cfg)` 仍处理 temperature 覆盖（纯函数不变，只是入参 cfg 可能是 override）。

### 6.3 BenchmarkController + BenchmarkService（新增）

文件：`server/src/benchmark/`（新模块，纳入 `app.module.ts`）。路由 `/benchmarks`：

| 路由 | 方法 | 功能 |
|---|---|---|
| `/benchmarks/upload` | POST | `FileInterceptor` 接 txt 文件 → 建 BenchmarkBook(PENDING) + 章节切分 → 返回 `{ id, chapterCount, estTokens }`（不启动拆解） |
| `/benchmarks` | GET | 列当前用户的对标书（id/title/status/progress/章数） |
| `/benchmarks/:id` | GET | 详情（book + entries 分组） |
| `/benchmarks/:id/dissect` | POST | **触发拆解**：转流式（订阅 emitter 推活动帧）。前置校验 status=PENDING/DONE(重拆) |
| `/benchmarks/:id/stream` | GET | 断线重连续看日志 |
| `/benchmarks/:id` | DELETE | 删 book + entries |
| `/benchmarks/:id/entries?type=` | GET | 浏览拆解结果（写作引用前端也可用） |

所有路由 `@CurrentUser()` 隔离，数据按 `userId` scope（多租户）。

### 6.4 写作引用（新增 tool + prompt 指导）

- **`get_benchmark`**（新增，挂 AGENT_TREE 的 `main` / `writer` / `outline-writer`，走 `TOOL_REGISTRY`；这三个是实际会写大纲/正文/参考的干活 agent，`outliner` orchestrator 本身 tools 为空、只委派）：
  - 入参 `{ bookId?, type?, query?, limit? }`
  - `userId` 闭包注入；查 BenchmarkEntry，按 type / 关键词过滤；返回精简列表（title + content 片段 + type）
  - 不指定 bookId → 跨所有对标书搜
- **prompt 指导**（改 `prompts/main.md` / `writer.md` / `outliner-writer.md`）：各加一节【按需对标参考】：
  - 写大纲/分卷 → 拉 `PLOT` / `RHYTHM` / `EMOTION`（学结构/节奏/爽点）
  - 写正文 → 拉 `STYLE`（句长/对话锚点）/ `RHYTHM`（爆发节律）
  - 建角色 → 拉 `CHARACTER`（角色卡范式）
  - 明确「对标是参考不是照抄，不进入本小说设定表」

### 6.5 文件上传

现状：`agentos.controller.ts` 用 `NoFilesInterceptor()`（拒文件）。拆解用 `FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 50MB } })`，txt UTF-8。epub/其他格式 deferred（§11）。

---

## 7. 前端设计

### 7.1 主页「拆解小说」模块

- **路由**：`/dissect`（新）。`AppSidebar` 加「拆解」tab（与「小说库」「设置」并列）。
- **任务列表页**：列对标书（title / status badge / progress / 操作）。状态：✓ DONE（浏览结果）/ 🔄 RUNNING（第 X/N 章 · agent）/ ⏸ PENDING（待确认）/ ⚠ FAILED/INTERRUPTED（重试）。
- **上传 + 二次确认弹窗**：点「＋ 上传」选文件 → 调 `/benchmarks/upload` → 弹黄色确认窗（警告 token 消耗大 + 预估耗时/token + 「建议 chapter-extractor 配便宜模型」）→ 确认 → 调 `/benchmarks/:id/dissect` 进流式。
- **日志抽屉**：RUNNING 任务点「查看日志」展开，复用流式解析（`useAIStreamHandler` 适配活动帧），实时滚动（时间戳 + agent 标签着色 + tool 调用）。断线重连自动接 `/benchmarks/:id/stream`。
- **拆解结果浏览**：DONE 任务点「浏览结果」→ 按 type 分组展示 entries（文风/节奏/情绪/角色/剧情/章节摘要）。

### 7.2 设置页 per-agent 模型配置

- **新 endpoint**：
  - `GET /settings/agent-tree` → 遍历 AGENT_TREE + DISSECT_TREE，返回 `[{ group, agents: [{ key, description, recommendedTier }] }]`（group 从树派生：写作树按 orchestrator 分组，拆解树独立一组）。
  - `GET /settings/agent-models` → 用户已配 override 的 `Map<agentKey, modelConfigId>`。
  - `PUT /settings/agent-models/:agentKey` `{ modelConfigId | null }` → upsert / 删 override。
- **UI**（`/settings` 新增「agent 模型」区）：
  - 顶部「默认模型」（= active ModelConfig，未配 override 的 agent 用它）
  - 分组卡片：每组列 agent，每行 = `name · description · 推荐模型 badge（💚便宜/🟡中/🔴强）· 模型下拉`（下拉选项 = 用户 ModelConfig 列表 +「默认」）。
  - **派生渲染**：新增子 agent → 树配置加一项 → endpoint 自动返回 → UI 自动多一行。

---

## 8. 关键设计约束（写死，防过度承诺）

1. **系统不做运行时模型成本判断**。`openai-compatible` 接任意 provider，价格不可知。`recommendedTier` 是 agent 侧**静态人工标注**，纯粹 UI 提示，不校验用户实际配了什么模型。
2. **token 预估只能粗略**：章数 × 每章输入/输出估算，与具体模型无关；弹窗用「预估 ~XX 万 token（按章数粗估）」措辞，不写死精确值。
3. **日志不持久化**：只流式推送展示。状态/进度持久化（BenchmarkBook.status/progress）。
4. **per-agent 配置项零手维护**：遍历 AGENT_TREE + DISSECT_TREE 自动渲染，不维护第二份 agent 清单。
5. **拆解是独立 agent run**：不绑定 novel，不经 `POST /agents/:id/runs`，不经 `ContextAssembler.forSession`。

---

## 9. 复用与新建清单

### 复用（不重写）
- `createAgent` + 中间件栈（`createSubAgentMiddleware` / `createSummarizationMiddleware` / `createPatchToolCallsMiddleware`）—— `DissectAgentService` 仿 `DeepAgentService.buildAgentGraph`
- 活动帧协议（`createActivityEmitter` / `aggregateActivities` / `Act*` 帧）
- `buildChatModel` + `getModel` cache（key 含 config.id）
- `TOOL_REGISTRY` 模式（加新 tool key）
- `AGENT_TREE` 声明式 + `collectSpecs` 遍历（per-agent UI 派生）
- 前端流式管道（`useAIStreamHandler` / `useAIResponseStream`）
- `AppSidebar` tab 模式

### 新建
- `dissect-tree.config.ts`（DISSECT_TREE）+ `prompts/dissect-*.md`（6 个）
- `DissectAgentService` + `DissectContextAssembler`
- `benchmark/` 模块（Controller + Service）+ `BenchmarkBook` / `BenchmarkEntry` Prisma 模型
- 拆解 tools：`write_benchmark` / `get_raw_chapter` / `get_dissect_entries` / `report_dissect_review`
- `AgentModelOverride` 表 + `AgentModelOverrideService` + settings endpoint
- `AgentSpec.recommendedTier` + 现有 spec 补标注
- 写作引用 tool `get_benchmark` + main/writer/outliner prompt 加【按需对标参考】节
- 前端：`/dissect` 模块（上传/列表/日志抽屉/结果浏览）+ 设置页 per-agent 配置区 + 二次确认弹窗组件

---

## 10. 范围界定（YAGNI / Deferred）

**本期不做**：
- 写作中途上传文件实时拆解（明确砍掉，只主页模块 + 只读引用）
- 逆向导入（拆自己的小说 → 设定表）
- epub / 其他格式（先 txt）
- 拆解断点续传（失败/中断重头来）
- 模型成本感知 / 按价格自动推荐模型
- 对标书与小说的显式「关联」UI（本期 main 按需自动拉，不做手动绑定）
- 对标库向量检索（千书级才需要，本期 type + 关键词够用）
- 拆解结果的手动编辑（agent 是唯一作者，同 characters 哲学）
- 多对标「主对标/副对标 + 阶段预算」（oh-story 的高级特性，等对标库跑通再做）

---

## 11. Phase 定位与风险

- **Phase 22**。承接 Phase 21（character bio + changes slim）。是参考文档 P2 §12.7「对标系统单独立项」的落地。
- **风险①：逐章拆解 token 成本**。即便 chapter-extractor 配便宜模型，几百章仍可能消耗大。缓解：弹窗二次确认 + 预估；cheap 模型路由；长篇可考虑先拆「黄金三章 + 关键转折 + 抽样章」（后续增强，本期仍按全文逐章，因为作者明确要求）。
- **风险②：长任务进程重启丢失**。标 INTERRUPTED + 手动重试。生产环境若需高可用，后续可把 job 挪到独立 worker 进程（BullMQ 等），本期单进程够用。
- **风险③：per-agent override 与 active 切换的缓存一致性**。getModel cache key 含 config.id + updatedAt，切 override 或编辑 ModelConfig 都自然 cache miss。已验证安全。
- **风险④：章号命名契约**。网文章节标记多样（「第N章」/「Chapter N」/「第N回」），切分正则需覆盖常见形态，切不准时按字数均分 + 告警（不阻断）。

---

## 12. 实施顺序建议（供 plan 参考）

1. **DB 迁移**：BenchmarkBook / BenchmarkEntry / AgentModelOverride + enum，手动 `prisma generate`。
2. **per-agent 模型配置**（先做，拆解依赖它省 token）：AgentSpec.recommendedTier + AgentModelOverrideService + resolveModel 链改造 + settings endpoint + 设置页 UI（从 AGENT_TREE 派生，此步只写作树）。
3. **对标库 CRUD**：BenchmarkController/Service + 前端 `/dissect` 任务列表 + 上传 + 二次确认弹窗（PENDING 态）。
4. **拆解 Agent**：DISSECT_TREE + prompts + DissectAgentService + 拆解 tools + 流式日志 + 日志抽屉（RUNNING 态）。
5. **per-agent 配置补拆解树**：设置页纳入 DISSECT_TREE（自动，验证即可）。
6. **写作引用**：`get_benchmark` tool + main/writer/outliner prompt 指导 + 结果浏览页（DONE 态）。
7. **测试**：L0 单元（resolveModel override 链 / 章节切分 / buildDissectGraph 树形）+ L1 集成（拆解一本短样本 → entries 落库 → get_benchmark 召回）。
