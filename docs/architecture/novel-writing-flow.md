# 写一本小说:提示词组装与全流程流转

> 架构文档 · 2026-06-27 · 覆盖 Phase 5-12 后的当前状态(agent-tree / context-assembler / deep-agent.service 实测核对)
>
> 阅读建议:VSCode 打开本文档,mermaid 图在 markdown 预览里渲染。

## 0. 一句话总览

用户在工作台发一条消息 → `POST /agents/:id/runs` → **ContextAssembler 把小说的全部「记忆」拼成主 agent 的 system prompt** → deepagents 的 `createAgent` 建出一棵 agent 树(main + 5 个 task 委派编排器)→ 主 agent 按状态(立项 / 写作)委派子 agent 跑流水线(写章 = writer → settler → validator + 修订)→ langgraph 流被压成**扁平活动帧** newline-JSON 推给前端 → settler 把本轮事实(摘要/角色/伏笔/事件/弧线)写回 DB → **下一轮 ContextAssembler 再注入**,形成记忆闭环。

**核心心智模型(最重要,先记住)**:
> **主 agent 上下文 = 被动注入的全书记忆(8 个 slice);子 agent 上下文 = 自己的职能 prompt + 按需用工具主动拉取。** 主 agent 「总能在背景里看到」态势/设定/角色/前情/事件/弧线/伏笔;writer/settler/validator 看不到这些 slice,它们用 `get_chapter_plan`/`get_character`/`get_events`/`get_arcs`/`query_memory` 等工具**主动查**。这是 Phase 6/7 审视后确立的分工。

---

## 1. Agent 树(谁负责什么)

```mermaid
flowchart TD
    MAIN["main 主 agent<br/>(编排者 · 拿全记忆 slice)"]

    subgraph CH["chapter 章节编排器"]
        direction TB
        WRITER["writer 写正文<br/>(append_section/replace_text...)"]
        SETTLER["settler 结算<br/>(write_summary:摘要/角色/伏笔/事件/弧线)"]
        VALIDATOR["validator 校验<br/>(12维 report_review)"]
    end

    CURATOR["curator 参考资料策划<br/>(KB → set_references)"]
    subgraph WB["worldbuilder"]
        WBW["wb-writer"]
        WBC["wb-critic"]
    end
    subgraph OL["outliner"]
        OLW["outline-writer<br/>(set_volume/set_arc/set_chapter_plan)"]
        OLC["outline-critic"]
    end
    subgraph CH2["character"]
        CHW["char-writer"]
        CHC["char-critic"]
    end

    MAIN -->|task 委派| CH
    MAIN -->|task 委派| CURATOR
    MAIN -->|task 委派| WB
    MAIN -->|task 委派| OL
    MAIN -->|task 委派| CH2

    WRITER --> SETTLER --> VALIDATOR
    WBW --> WBC
    OLW --> OLC
    CHW --> CHC
```

- **main**:状态感知(CONCEPT 立项 / ACTIVE 写作),只编排,不直接写正文/设定/大纲——一律 `task` 委派。
- **chapter 编排器**:聚焦上下文里跑完一章 writer → settler → validator(+ 最多 1 轮修订)。
- 每个 writer→critic 对都是「取 KB 方法论 → 生成 → 评审 → 定点修订」的镜像结构。

---

## 2. 从用户消息到 agent run(入口流转)

```mermaid
sequenceDiagram
    participant FE as 前端 ChatPanel
    participant CTL as AgentosController<br/>POST /agents/:id/runs
    participant CTX as ContextAssembler
    participant DA as DeepAgentService
    participant LG as langgraph agent 流
    participant DB as PostgreSQL

    FE->>CTL: { message, session_id, readingChapterOrder }<br/>(newline-JSON 流)
    CTL->>DB: sessions.resolveSession(拿/建 session)
    CTL->>DB: sessions.startTurn(落 user 行)
    CTL->>CTX: forSession(userId, sessionId)
    CTX->>DB: 查 novel + 拉 7 类记忆<br/>(summaries/events/characters/world/refs/arcs)
    CTX-->>CTL: { prompt=主agent systemPrompt, novelId }
    CTL->>FE: RunStarted 帧
    CTL->>DA: runTurn({ systemPrompt, novelId, threadId, emit })
    DA->>DB: getActive(模型配置) + voiceProfile
    DA->>LG: agent.stream({ messages:[user] }, { thread_id, streamMode:'messages' })
    loop 每个 langgraph chunk
        LG-->>DA: message chunk(think/content/tool/ActResult)
        DA-->>CTL: emit(ActivityEvent)
        CTL-->>FE: newline-JSON 帧(Act/ActDelta/ActTool/ActResult/ActEnd)
    end
    DA-->>CTL: 流结束
    CTL->>CTL: aggregateActivities(collected) → contentMarkdown
    CTL->>FE: RunCompleted { content }
    CTL->>DB: sessions.finishTurn(落 assistant 行 + activities)
```

- **thread_id = sessionId** = langgraph 的 `Session.id`;checkpointer(PostgresSaver,`agent_memory` schema)持久化对话状态,跨轮续接。
- **断连**:`req.on('close')` → `AbortController.abort()` 停掉 LLM/工具。
- **错误轮次也落库**(`isError=true`)供回显;`finally` 里 best-effort 持久化。

---

## 3. 提示词组装(本文核心)

### 3.1 主 agent 的 system prompt(ContextAssembler.forSession)

```mermaid
flowchart LR
    subgraph BASE["buildSystemPrompt(base)"]
        B1["角色定位:资深写作助手"]
        B2["【书名】【类型】【简介】<br/>【核心冲突】【字数目标】<br/>【世界观/设定】【文文】【语言】"]
        B3["规则:不编造冲突设定"]
        B4["【状态】指令<br/>CONCEPT=立项7项收集<br/>ACTIVE=写章流程"]
    end
    subgraph SLICES["记忆 slices(各自为空则不插)"]
        S0["【小说态势】<br/>字数/章/frontier/立项/覆盖/下一步"]
        S1["【当前弧线】<br/>当前 Arc goal+进展 + Volume arcSummary"]
        S2["【世界观】<br/>核心 concept+powerSystem"]
        S3["【角色档案·活跃/沉默】<br/>全档案+当前态 / 名册"]
        S4["【前情】<br/>最近 5 章摘要"]
        S5["【近期关键事件】<br/>最近 8 个 MAJOR Event"]
        S6["【未回收伏笔】<br/>核心/进行中/⚠️陈久"]
        S7["【写作参考】<br/>精要 top6 + 全量索引"]
    end
    BASE ==>|"slices 插在「规则」之前"| OUT["主 agent systemPrompt"]
    SLICES ==> OUT
```

**base 的状态分支是关键**:
- **CONCEPT(立项中)**:指令是「收集 7 项基础信息 → 委派 curator → 建世界观 → 规划大纲(含分弧)→ 建角色 → 才写正文」。
- **ACTIVE(写作中)**:指令是「写/续写/重写时委派 chapter agent 跑 writer→settler→validator;细纲过时则委派 outliner 改写(Phase 10)」。

**slice 数据源**(全部 user-scoped,`novel: { userId }`):

| slice | 来源 | 作用 |
|---|---|---|
| 当前弧线 | `ArcService.findArcByChapter(currentChapter)` + 其 Volume | 写章时知道「在哪条弧、本卷/本弧进展」(Phase 12) |
| 世界观 | `WorldEntryService.listCore`(concept+powerSystem) | 核心设定常驻 |
| 角色 | `CharacterService.listForContext`(分层:活跃全档案+当前态 / 沉默名册) | 长篇不丢角色(Phase 6) |
| 前情 | `SummaryService.listRecent(5)` | 最近 5 章情节 |
| 近期关键事件 | `EventService.listRecentMajor(8)` | 突破 5 章窗口的关键情节(Phase 11) |
| 未回收伏笔 | `StoryEventService.listOpen`(带 stale 计算) | 哪些承诺待兑现 |
| 写作参考 | `NovelReferenceService.listAll`(curator 固化的精要) | 本书专属方法论 |

> `currentChapter` = `Chapter` 表最大 `order`(决定当前弧、角色活跃窗口、伏笔陈旧)。

### 3.2 子 agent 的 system prompt(不一样!)

子 agent **不继承** main 的 slice,各自用声明式配置:

```mermaid
flowchart TD
    SPEC["AGENT_TREE 里的 AgentSpec"]
    SPEC -->|promptKey| P["PROMPTS[key]<br/>(agent-prompts.ts 的常量)"]
    SPEC -->|promptAugment| AUG{"promptAugment?"}
    AUG -->|writer| W["+ writerSlice<br/>(写作参考精要 + 作者画像)"]
    AUG -->|validator| V["+ validatorSlice<br/>(作者画像·校验对照)"]
    AUG -->|无| PLAIN["原 prompt"]
    P --> OUT
    W --> OUT
    V --> OUT
    PLAIN --> OUT
    OUT["子 agent systemPrompt"]
```

- `resolvePrompt(spec)`:`PROMPTS[spec.promptKey]` + (writer 拼 `writerSlice` / validator 拼 `validatorSlice`)。
- **writerSlice / validatorSlice 在 runTurn 里现拼**(每轮):参考资料(injectTo=writer/both 的 top6 精要)+ 作者画像。空则不加,行为不变。
- **子 agent 看不到【世界观/角色/前情/事件/弧线/伏笔】这些 slice**——靠工具主动拉(writer 写前 `get_chapter_plan(N)`/`get_arcs`/`get_character`,validator 审时 `get_chapter_plan`/`get_character`/`get_events`,settler 结算时 `get_chapter`)。**这是审计/聚焦场景的有意设计**:子 agent 上下文不被全书记忆稀释,只拉它这步需要的。

### 3.3 模型与工具的解析

- **model**:`resolveModel(spec, activeConfig)` → `resolveModelConfig`(按 spec.temperature 覆盖)→ `getModel`(buildChatModel 路由 provider:openai-compatible / anthropic / gemini;按 `modelTier` 定 maxTokens:long=16k / short=6k;按 `${id}:${maxTokens}:${temp}` 缓存)。**每用户配置,非硬编码**。
- **tools**:`resolveTools(spec.tools)` → `TOOL_REGISTRY[key](deps)`(工厂闭包注入 `userId`/`novelId`——**永远不来自 LLM 输入**,防越权)。

---

## 4. 写一章的完整子流程(最常走的路径)

```mermaid
flowchart TD
    U["作者:「写第 8 章」"] --> MAIN["main(ACTIVE)"]
    MAIN -->|"task「写第8章」"| CH["chapter 编排器"]
    CH -->|"task + 指令清单"| WRITER["writer"]
    WRITER --> W1["get_chapter_plan(8) 读细纲"]
    WRITER --> W2["get_chapter(7) 读上一章接缝<br/>(Phase 8 连续)"]
    WRITER --> W3["get_arcs 看当前弧(Phase 12)"]
    WRITER --> W4["get_character / query_memory 核设定"]
    WRITER --> W5["append_section 一节节写"]
    WRITER -->|"返回"| CH
    CH -->|"task"| SETTLER["settler"]
    SETTLER --> ST1["get_chapter(8) 读本章"]
    SETTLER --> ST2["write_summary:<br/>摘要/角色变化/伏笔/事件(Phase11)/<br/>arc+volume 滚动摘要(Phase12)"]
    SETTLER -->|"返回"| CH
    CH -->|"task"| VALIDATOR["validator"]
    VALIDATOR --> VA1["get_chapter(8) + get_chapter_plan(8)<br/>+ get_character/get_events + query_memory"]
    VALIDATOR --> VA2["report_review(12维:<br/>人物/设定/战力/伏笔/逻辑/文风/<br/>长度/爽点/钩子/AI味/作者声音/细纲兑现)"]
    VALIDATOR -->|"passed/score/blockingIssues"| CH
    CH --> DEC{"passed?"}
    DEC -->|是| DONE["回复 main:完成+score"]
    DEC -->|否 + 细纲过时| FLAG["结论带回「细纲过时」<br/>(Phase 9 dim12 → Phase 10)"]
    DEC -->|否 + 章节问题| REV["snapshot_chapter(8)<br/>→ writer 定点修订<br/>→ validator 复校(最多1轮)"]
    REV --> DEC2{"复校 score≥原?"}
    DEC2 -->|否| ROLL["restore_chapter 回滚"]
    DEC2 -->|是| DONE
    FLAG --> MAIN2["main 委派 outliner 改写细纲<br/>(活大纲 · accept-written-as-truth)"]
    DONE --> END2["前端:正文面板 + 📅事件 + 📊状态 自动刷新"]
```

**关键关卡(都在 ChapterService,事前拦截而非事后)**:
- `assertHasPlan`:writer 永不写没有细纲的章(逼 main 先委派 outliner 补/改细纲)。
- `assertFrontier`:前驱章必须已结算(逼按序写、防跳章丢记忆)。
- 写入后 `ChapterOutline.status → WRITTEN`(单向往状态标记,非对账)。

---

## 5. 记忆闭环(setter 写 → 下一轮注入)

```mermaid
flowchart LR
    subgraph WRITE["settler 经 write_summary 写入"]
        E1["ChapterSummary<br/>(摘要+角色变化+物品)"]
        E2["CharacterChange<br/>(角色时间线)"]
        E3["StoryEvent<br/>(伏笔 plant/advance/resolve)"]
        E4["Event<br/>(关键事件 MAJOR/MINOR · Phase11)"]
        E5["Arc.summary + Volume.arcSummary<br/>(滚动 · Phase12)"]
    end
    subgraph NEXT["下一轮 ContextAssembler.forSession"]
        N1["【前情】← ChapterSummary"]
        N2["【角色】← CharacterChange 派生 currentState"]
        N3["【未回收伏笔】← StoryEvent(OPEN)"]
        N4["【近期关键事件】← Event(MAJOR)"]
        N5["【当前弧线】← Arc + Volume.arcSummary"]
    end
    E1 --> N1
    E2 --> N2
    E3 --> N3
    E4 --> N4
    E5 --> N5
    NEXT -.->|"注入 main systemPrompt"| AGENT["下一轮主 agent<br/>看得到全部进展"]
```

**settler 是唯一记账员**——所有持久化记忆都经它的 `write_summary` 工具。它是单点依赖:漏提一个伏笔/事件,后续轮就丢(已知风险,Phase 8 审视标注)。

---

## 6. 流式输出协议(newline-JSON)

langgraph 的 `messages` 流被 `createActivityEmitter` 压成**扁平活动帧**,controller 每帧即时 flush(不缓冲):

```
RunStarted                                          ← 包头
Act(id=content) ActDelta... ActEnd                  ← 主 agent 的回复/正文
Act(id=tool:write_chapter) ActTool ActResult ActEnd ← 工具调用
Act(id=think) ActDelta... ActEnd                    ← 子 agent 推理(writer/settler/validator)
...
RunCompleted { content: contentMarkdown }           ← 包尾(聚合后的交错文档)
```

- `contentMarkdown` 含 `::think`/`::tool`/`::stage` 标记,落 `Message.content` 供刷新时重建交错文档。
- `streamTransformers: [createSubagentTransformer]` 把子 agent 的内部流也展平进同一条流。
- 前端 `useAIStreamHandler` 解析这些帧 → 构建 `store.messages`;`activity-aggregator` 在服务端做对称聚合。

---

## 7. 中间件栈(主 agent)

```mermaid
flowchart LR
    IN["user message"] --> MW1["createSubAgentMiddleware<br/>(提供 task 工具 + 子 agent 树)"]
    MW1 --> MW2["createSummarizationMiddleware<br/>(长对话自动压缩 · StateBackend)"]
    MW2 --> MW3["createPatchToolCallsMiddleware<br/>(修复中断/畸形 tool call)"]
    MW3 --> AGENT["createAgent 核心"]
```

- **无 filesystem 中间件**(故意用 `createAgent` 而非 `createDeepAgent`,避免它注入 write_file/read_file/execute)。子 agent 公用栈更精简:仅 `createPatchToolCallsMiddleware`。
- **summarization 只压 thread message 历史**,不碰 DB 记忆——DB 记忆(settler 写的)与 thread 压缩正交,跨 session 持久。
- `recursionLimit: 10_000`(深委派不限死)。

---

## 8. 关键设计点 & 已知边界

**设计点**:
1. **main 被动注入 vs 子 agent 主动拉取** 的分工(§3)——审计/聚焦场景按需拉取更准、更省上下文。
2. **声明式 agent 树**(`AGENT_TREE` + `TOOL_REGISTRY` + `PROMPTS` + `resolveModelConfig`)——加 agent = 加配置,不改 `deep-agent.service`。
3. **userId/novelId 闭包注入工具**——模型无法寻址他人小说/章节(多租户隔离)。
4. **DB 记忆 vs thread 记忆分离**——settler 显式持久化 vs langgraph 自动压缩;前者可检索,后者临时。

**已知边界 / 未验证**:
- **整条多 agent 委派链未活体 E2E**(settler 是否稳定提取事件、validator 是否真调 dim12、Phase 10 改写是否真触发)——Phase 5-12 全为理论加固。
- **settler 单点依赖**:漏提即永久丢;无提取质量校验。
- **query_memory 是关键词 contains**(无向量召回)——Phase 8 审视标注的终局解待做。
- **【作者画像】slice 拼给 writer + validator**(centaur 校验),其它子 agent 不含。
- **checkpointer 在 `agent_memory` schema**(Prisma 只管 `public`)——`prisma migrate dev` 不会动它,保持 drift-free。

---

## 附:一图全览

```mermaid
flowchart TD
    U["用户消息"] --> CTL["AgentosController"]
    CTL --> CTX["ContextAssembler.forSession"]
    CTX -->|"base + 7 slices"| PROMPT["主 agent systemPrompt"]
    CTL --> DA["DeepAgentService.runTurn"]
    DA --> BUILD["buildAgentGraph<br/>(createAgent + 3 中间件)"]
    PROMPT --> BUILD
    BUILD --> STREAM["agent.stream"]
    STREAM -->|"messages chunk"| EMIT["createActivityEmitter"]
    EMIT -->|"ActivityEvent 帧"| CTL
    CTL -->|"newline-JSON"| FE["前端"]
    STREAM -.->|"task 委派"| SUB["子 agent 树<br/>(chapter/curator/wb/outliner/character)"]
    SUB -.->|"工具调用(闭包注入 userId/novelId)"| DB[("PostgreSQL")]
    DB -.->|"每轮拉取"| CTX
```
