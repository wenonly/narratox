# narratox 流水线运行时(基石)— 设计文档(v0.6.0 / 子项目 #1)

- 日期:2026-06-19
- 状态:已与用户确认架构方向,待 review
- 范围:用「**无状态 agent + 流水线编排 + 流式 stage 协议 + 前端 stage 可视化**」替换现在的 langgraph-swarm 层;落地一条最小写章流水线(writer→settler,同步),让 chat 端到端跑通,**退役 swarm 与持久化 checkpointer**——从根上消除 `400 Role empty` 与异步结算的隐患。这是 v2 的地基,后续流水线(校验/评分/修订、立项、细粒度工具 Phase2)都建在它上面。
- 不在本次范围(后续子项目):写章旗舰流水线的 校验/评分/修订回路(#2)、立项流水线 + 智能路由(#3)、replace/insert/delete 工具 + AI 自主拆分(#4)。

---

## 1. 为什么要换掉 swarm(背景)

现状(v0.5.x):`createSwarm` + 两个 `createReactAgent`(main/writer)+ `PostgresSaver` checkpointer,共享一个消息线程,靠 `transfer_to_*` 握手。问题:
- **共享线程跨轮累积** → 需要 `trimMessages` 裁剪 → 偶发 tool_call/结果错配 → GLM 报 `400 Role information cannot be empty`(自愈只是兜底)。
- **握手产生非标准消息**(重插入的 user、transfer 工具消息)→ GLM 间歇拒。
- **Analyst 异步结算**(fire-and-forget)→ 用户感知不到、错误不可见、可能与新消息冲突。

根因:**「记忆 = 不断累积的原始消息线程」**这个模型。inkos 的解法是 **「记忆 = 外部存储(DB),每次调用现读现拼」**,agent 运行时**不持有跨轮/跨 stage 的消息线程**。本基石采纳此模型。

---

## 2. 核心模型:无状态 agent + 外部记忆

**「无状态」≠「无记忆」。** agent 记得小说的一切(设定/章节/摘要/伏笔),但这些都在 **DB**(`Novel`/`Chapter`/`ChapterSummary`/`StoryEvent`)里。每次 agent 运行,**Composer 函数从 DB 读出相关切片、现拼一个干净的 `[system, user]` prompt**;agent 跑完,这条上下文**丢弃**。下一轮/下一 stage 重新从 DB 拼。

**工具循环是「有界的、单次运行的」**:writer 这种需要工具(append_section 等)的 agent,在其**单次运行内**有一个工具循环(LLM→tool_call→执行→LLM…)——但这条线程**只存在于本次运行、用完即弃**,不跨 stage、不跨轮持久化。因此它天然短小,不需要 trim,不会产生错配 → 不再 400。

> 实现选型:每个 agent = 一个**不带 checkpointer、不带 swarm** 的 `createReactAgent`(复用 langgraph 的工具循环 machinery),或等价的手写循环。spec 只锁定「无持久化线程、无握手、单次有界工具循环」;具体用 createReactAgent 还是手写留给 plan。

---

## 3. 核心抽象

### 3.1 `StatelessAgent`(专家)
```ts
interface StatelessAgent {
  name: string;                        // 'writer' | 'settler' | 'onboarding'
  run(ctx: AgentRunContext): AsyncGenerator<AgentEvent>;
}
interface AgentRunContext {
  userId: string;
  novelId: string;
  input: Record<string, unknown>;      // stage 专属入参(如 { chapterOrder: 3 })
}
```
- 每个 agent **固定自己的工具列表**(writer:append_section/get_chapter/list_chapters/query_memory/settle 用其只读版;settle:写 ChapterSummary/StoryEvent 的工具或直接 service 调用)。
- `run` 内部:Composer 拼 system prompt(从 DB 读)→ 带 user/input 跑有界工具循环 → 逐块 `yield` 事件。
- userId/novelId 闭包/入参注入(不从 LLM 取,防越权)——延续现有安全姿势。

### 3.2 `Composer`(上下文策展,记忆注入)
每个 agent 配一个 `buildContext(userId, novelId, input): { system, user }` 函数(就是「外部记忆现读现拼」):
- **writer 的 Composer**:读 Novel 设定 + 近 5 章 ChapterSummary + OPEN StoryEvent + 本章目标 → 拼 system。(基本是现有 `ContextAssembler` 的逻辑,去掉原始线程那层。)
- **settler 的 Composer**:读 Novel 元信息 + 本章正文(刚写的)+ OPEN 伏笔 → 拼 system。(基本是现有 `AnalystService` 的 prompt 构造。)
- Composer 是**确定性、不调 LLM** 的(inkos 范式):只读 DB、组装。隔离的边界——agent 只看到 Composer 给的切片。

### 3.3 `Pipeline`(流水线)+ Runner
```ts
interface Pipeline {
  name: string;                        // 'write-chapter' | 'onboarding'
  stages: StageSpec[];
}
interface StageSpec {
  name: string;                        // 'writer' | 'settler'
  agent: StatelessAgent;
  input: (ctx: PipelineContext) => Record<string, unknown>;  // 从管线上下文+前序产出组装本 stage 入参
}
```
Runner(`PipelineRunner`):
- 维护 `PipelineContext`(userId/novelId + 各 stage 的产出)。
- 顺序跑每个 stage:用 `input()` 组装入参 → `agent.run()`(流式)→ 把产出写回 ctx。
- **整条流水线的 stage 事件实时流向 FE**(think 式)。
- 这是**手写命令式编排**(一串 await,像 inkos 的 PipelineRunner),不是 graph 框架。

### 3.4 路由(本次极简)
基于 `Novel.status` 规则路由,**不用 LLM**:
- `CONCEPT` → onboarding agent(单 stage 流水线)。
- `ACTIVE` → write-chapter 流水线。
- (智能 LLM 路由、意图细分留给 #3。)

---

## 4. 首批流水线(本次落地)

### 4.1 write-chapter 流水线(最小,2 stage)
1. **writer** stage:Composer 拼(设定+前情+伏笔+本章目标)→ writer agent 用 append_section 等工具**一节节写完整章**(单次有界工具循环)→ 章节正文落 DB(复用现有 ChapterService.appendSection)。
2. **settler** stage:Composer 拼(本章正文+伏笔)→ settler agent 提取 4 类事实(摘要/角色变化/物品/伏笔)→ 写 ChapterSummary + StoryEvent(复用 SummaryService/StoryEventService 的写入逻辑)。
   - **这是现在异步 Analyst 的同步化、stage 化版本**:在同一流里、用户看得到、错误当场冒、没有后台进程。
- 无校验/评分/修订(那是 #2)。本流水线就是「写 + 记账」,证明运行时 + 同步结算 + 流式。

### 4.2 onboarding agent(单 stage,让 chat 端到端可用)
CONCEPT 时:agent 读当前 Novel 状态(get_novel_info 风格),按缺失字段追问,调 update_novel。无状态:每轮从 DB 读当前设定,判断缺什么。信息齐 → (status 翻 ACTIVE 由首次 write 触发,沿用现有)。
> 这是占位实现,保证 chat 不断;完整立项流水线在 #3。

---

## 5. 流式协议(stage 事件,think 式)

新增事件帧(与现有 `RunStarted`/`RunCompleted` 并存;`RunContent` 被 stage 事件取代):

| 帧 | 含义 | FE 处理 |
|---|---|---|
| `PipelineStart { pipeline, stages:[] }` | 流水线开始,告知有哪些 stage | 展示流水线 + stage 列表(灰色待办) |
| `StageStart { stage }` | 某 stage 开始 | 高亮当前 stage |
| `StageContent { stage, content }` | stage 的流式文本(累积式,沿用现 RunContent 约定) | stage 区块内流式显示 |
| `StageTool { stage, tool, args? }` | stage 内的工具调用(如 append_section) | stage 内显示"正在追加一节…" |
| `StageEnd { stage, summary? }` | stage 完成 | stage 标记完成(✓) |
| `PipelineEnd { result }` | 整条流水线完成 | 收尾 |

> append_section 的 `WritingChapter` 信号并入 `StageTool`(writer stage 内的工具事件),驱动 ChapterPreview 实时刷新——前端「章节一节节长出来」的效果保留。

---

## 6. 前端:stage 可视化(think 模式)

- `useAIStreamHandler`:加 stage 事件分支,维护 `pipeline: { stages: [{name, status, content}] }` 状态。
- ChatPanel 渲染一个**可折叠的「流水线进度」区块**(类似 reasoning/think 区):每个 stage 一行(图标+名称+状态:待办/进行中/完成),进行中的 stage 下方流式显示其 content。
- 章节正文仍走 ChapterPreview(由 StageTool→append_section 驱动刷新);stage 区只显示 agent 的「过程文本」(writer 的进度说明、settler 的"提取到 N 项事实")。
- 流水线进行中:输入框可禁用或允许排队(本次先禁用,避免并发——也消除你担心的"结算中再聊天打断"问题,因为结算就在流里、流没结束输入是锁的)。

---

## 7. 记忆模型(外部存储,无共享线程)

| 数据 | 存哪 | 谁读 |
|---|---|---|
| 小说设定/状态 | `Novel`(title/genre/synopsis/settings/status) | 每个 agent 的 Composer |
| 章节正文 | `Chapter.content` | writer(settler 不改) |
| 章节摘要/角色变化/物品 | `ChapterSummary` | writer 的 Composer(前情)、settler 写入 |
| 伏笔账本 | `StoryEvent` | writer 的 Composer(未回收)、settler 写入/回收 |
| 聊天记录(展示用) | `Message` | **仅 FE 展示,不回喂 agent** |

→ agent 的"记忆"= 上表 DB 数据,Composer 每次按需读、按需拼。**聊天原文不再进 agent 上下文**。这是隔离 + 不膨胀 + 不 400 的关键。

---

## 8. 迁移与删除

**删/停用**:
- `createSwarm` + 握手工具(transfer_to_writer/transfer_to_main)。
- `PostgresSaver` checkpointer(provider 停用;agent_memory 表可留空不再写)——**没有持久化线程 = 不再累积 = 不再 400**。自愈兜底(`clearThreadCheckpoints`+retry)随之可移除。
- `makeTrimHook` 的 trim/sanitize(无累积线程,无需 trim)。
- 异步 Analyst 路径(`streamTurn` 末尾的 fire-and-forget settle)——被同步 settler stage 取代。
- `ContextAssembler` 的原始线程拼接(保留其 DB→prompt 组装逻辑,迁入 writer 的 Composer)。

**保留/复用**:
- 所有工具(append_section/get_chapter/list_chapters/query_memory/update_novel)+ ChapterService/SummaryService/StoryEventService。
- ChapterSummary/StoryEvent 数据模型。
- 日志系统(pino/AgentLogger——stage 事件也走它)。
- 流式基础设施(controller 的 newline-JSON 推流)。

---

## 9. 非目标(后续子项目)

- 写章的 **校验/评分/修订回路**(ContinuityAuditor 式打分、最高分回滚、净增益门槛)= #2。
- **完整立项流水线 + LLM 意图路由** = #3。
- **replace/insert/delete/replace-all 工具 + AI 自主拆分**(writer 不再被规定"每次一节")= #4。
- Composer 的高级策展(按 agent 角色给不同切片、token 预算)= 后续。
- 多流水线并发/队列 = 后续。

---

## 10. 风险

- **writer 单次工具循环可能偏长**(写整章 = 多次 append)。每次 append 是小工具参数(已证 <60s);但循环内若反复 get_chapter 取整章,上下文会在本次运行内膨胀。缓解:settler/writer 的 Composer 优先给"摘要+目标",prompt 引导 writer 少做全文 get_chapter。若单次运行仍过大,#4 的细粒度工具 + 自主拆分会进一步化解。
- **createReactAgent 无 checkpointer 的可行性**:需在 plan 里 spike 一次「不带 checkpointer 的 createReactAgent 跑工具循环」确认行为正常(标准用法,应无问题)。
- **FE stage 可视化是不小的活**:新协议 + 新 UI 组件。但它是 think 式体验的核心,值得。
- **迁移期 chat 不能断**:onboarding 占位 agent 必须让 CONCEPT→ACTIVE 全程可用。

---

## 11. 参考

- inkos 范式:`BaseAgent` 无状态 `chat([{system},{user}])` + 确定性 Composer + 命令式 PipelineRunner + 评分回路(最高分回滚)。详见 `docs/references/inkos-workflow-reference.md` 及 `/Users/taowen/project/inkos`。
- 现有 ContextAssembler / AnalystService 的 prompt 构造(迁入 Composer)。
- v0.5.x 的工具层与记忆表(直接复用)。
