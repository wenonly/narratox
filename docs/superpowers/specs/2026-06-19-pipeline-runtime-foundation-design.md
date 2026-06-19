# narratox 流水线运行时(基石)— 设计文档(v0.6.0 / 子项目 #1)

- 日期:2026-06-19
- 状态:已与用户确认架构方向(含两轮修订:保留 checkpointer 会话记忆、扁平活动流可视化),待 review
- 范围:用「**会话层(单 agent + checkpointer 记忆)+ 无状态专家流水线 + 扁平活动流协议/可视化**」替换现在的 langgraph-swarm 层;落地一条最小写章流水线(writer→settler,同步),让 chat 端到端跑通,**退役 swarm**——从根上消除握手机制带来的 `400 Role empty`。这是 v2 的地基,后续流水线(校验/评分/修订、立项、细粒度工具 Phase2)都建在它上面。
- 不在本次范围(后续子项目):写章旗舰流水线的 校验/评分/修订回路(#2)、立项流水线 + 智能路由(#3)、replace/insert/delete 工具 + AI 自主拆分(#4)。

---

## 1. 为什么要换掉 swarm(背景)

现状(v0.5.x):`createSwarm` + 两个 `createReactAgent`(main/writer)+ `PostgresSaver` checkpointer,共享一个消息线程,靠 `transfer_to_*` 握手。问题:
- **握手机制产生非标准消息**(transfer 工具消息、重插入的 user)攒进共享线程 + `trimMessages` 裁剪 → 偶发 tool_call/结果错配 → GLM 报 `400 Role information cannot be empty`(自愈只是兜底)。
- **Analyst 异步结算**(fire-and-forget)→ 用户感知不到、错误不可见、可能与新消息冲突。

**罪魁是 swarm 的握手 + 共享线程**,不是"有记忆"本身。所以:**砍 swarm,保留 checkpointer 的会话记忆**;专家流水线用无状态隔离 agent。

---

## 2. 核心模型:两层记忆

**会话层(有记忆)** + **专家流水线层(无状态、DB 记忆)**,各司其职:

| 层 | checkpointer(会话记忆) | 记什么 | 形态 |
|---|---|---|---|
| **会话层** | **保留**(Deep Agent 的记忆卖点) | 聊天上下文:用户偏好、刚做了什么、"我们聊过什么" | **单 agent**(不再 swarm 多 agent 握手)+ checkpointer。线程干净(无握手垃圾)→ 400 风险大降 |
| **专家流水线层** | 无(无状态) | 每次从 DB 读小说状态(章节/摘要/伏笔)——这是它们的"记忆" | writer/settler 等专家,隔离、单次有界工具循环,用完即弃 |

- 用户发消息 → **会话 agent**(checkpointer 记得聊天)判断意图 → 触发 **write-chapter 流水线**(无状态专家)→ 流水线跑完 → 结果回写给会话 agent(记进 checkpointer)+ 存 DB。
- **两层记忆互补**:聊天记忆(checkpointer)+ 小说状态记忆(DB)。Deep Agent 的记忆功能一点没丢,只是不再让 swarm 把握手垃圾堆进同一条线程。
- **"无状态"≠"无记忆"**:专家 agent 记得小说一切(从 DB 读),只是不拖跨轮的原始聊天线程。

> 会话层保留 checkpointer 仍有极小 400 残余风险(trim 边界),三道防线:① 砍 swarm(最大污染源没了);② trimHook 错配修复(已做);③ 自愈兜底(已做)。不再以牺牲记忆为代价。

### 专家 agent 的工具循环(有界、单次)
writer 这种需要工具的专家,在其**单次运行内**有一个工具循环(LLM→tool_call→执行→LLM…)——只存在于本次运行、用完即弃,不跨 stage、不跨轮持久化。天然短小,不需 trim,不会错配。实现选型(createReactAgent 无 checkpointer / 手写循环)留给 plan,spec 只锁定「无持久化线程、无握手、单次有界工具循环」。

---

## 3. 核心抽象

### 3.1 会话 agent(有记忆,入口)
- 单 `createReactAgent`(**带 checkpointer**,保留会话记忆)+ 状态感知 prompt(CONCEPT→收集 / ACTIVE→写作)+ 工具:至少 `update_novel`、`get_novel_info`、和一个 **`run_pipeline(name, input)` 触发器**(把重活交给专家流水线)。
- 不再用 swarm 握手。意图路由先走规则(CONCEPT→收集;ACTIVE→写作),智能路由留 #3。

### 3.2 `StatelessAgent`(专家)
```ts
interface StatelessAgent {
  name: string;                        // 'writer' | 'settler'
  run(ctx: AgentRunContext): AsyncGenerator<ActivityEvent>;  // 产出扁平活动事件
}
```
- 固定自己的工具列表(writer:append_section/get_chapter/list_chapters/query_memory)。
- `run` 内部:Composer 拼 system → 带 input 跑有界工具循环 → 逐块 yield 活动事件。
- userId/novelId 闭包/入参注入(防越权)。

### 3.3 `Composer`(上下文策展 = 记忆注入)
每个专家配一个 `buildContext(userId, novelId, input): { system, user }`(确定性、不调 LLM、只读 DB):
- **writer**:Novel 设定 + 近 5 章 ChapterSummary + OPEN StoryEvent + 本章目标(基本是现 `ContextAssembler` 的 DB→prompt 逻辑,去掉原始线程)。
- **settler**:Novel 元信息 + 本章正文 + OPEN 伏笔(基本是现 `AnalystService` 的 prompt 构造)。

### 3.4 `Pipeline` + Runner
```ts
interface Pipeline { name: string; stages: StageSpec[]; }
interface StageSpec { name: string; agent: StatelessAgent; input: (ctx) => Record<string, unknown>; }
```
`PipelineRunner`:维护 ctx → 顺序跑 stage(用 input() 组装入参 → agent.run() 流式 → 产出写回 ctx)→ **整条流水线的活动事件实时流向 FE**。手写命令式编排(一串 await,像 inkos)。

---

## 4. 首批流水线(本次落地)

### 4.1 write-chapter(最小,2 stage)
1. **writer**:Composer 拼(设定+前情+伏笔+目标)→ writer agent 用 append_section 等**一节节写完整章**(单次有界工具循环)→ 章节正文落 DB(复用 ChapterService.appendSection)。
2. **settler**:Composer 拼(本章正文+伏笔)→ 提取 4 类事实(摘要/角色变化/物品/伏笔)→ 写 ChapterSummary + StoryEvent(复用 SummaryService/StoryEventService 写入,**取代现在异步 Analyst**)。同步、在流里、可见、错误当场冒。
- 无校验/评分/修订(那是 #2)。

### 4.2 onboarding(单 agent,让 chat 端到端可用)
CONCEPT 时:会话 agent 读 Novel 状态、追问缺失字段、调 update_novel。靠 checkpointer 记得本轮问答 + 每轮从 DB 读当前设定。信息齐 → ACTIVE。(完整立项流水线在 #3;本次会话 agent 直接处理。)

---

## 5. 流式协议:扁平活动流(不嵌套)

一次回合 = **一条扁平活动流**,按时间顺序排列。事件带 id(匹配 delta),**无 parent id、无树**:

| 帧 | 含义 |
|---|---|
| `Act { id, type:'think'\|'tool'\|'stage'\|'content', label? }` | 一个活动条目(think=推理、tool=工具调用、stage=阶段分隔、content=输出) |
| `ActDelta { id, text }` | 该条目的流式增量(think 的推理 token / content 的正文) |
| `ActTool { id, tool, args }` | 工具调用参数 |
| `ActResult { id, result }` | 工具返回 |
| `ActEnd { id, status:'ok'\|'error', summary? }` | 条目结束 |

- **stage** 是一个分隔/标题条目(如 `Act{type:'stage', label:'writer'}`),它**不包含**后续条目;后续的 think/tool 是**平级**条目,只是时序上跟在该 stage 后(FE 用 stage 标题做视觉分组)。
- **think 条目接 GLM 的 `reasoning_content`**(现在被 extractDelta 丢了,要额外捕获),让"展开看思考"有内容。
- 每个条目可单独展开看细节(think 的推理 token、tool 的参数与返回)。子 agent 调用 = 流里多几个平级条目(本期不一定有子 agent,但结构天然支持)。

> 与现有 `RunStarted`/`RunCompleted` 并存(首尾包裹);`RunContent`/`WritingChapter` 被 `Act` 系列取代。

---

## 6. 前端:扁平活动时间线(全可展开)

- `useAIStreamHandler`:加 `Act/ActDelta/ActTool/ActResult/ActEnd` 分支,维护一个**扁平活动数组**(按 id 聚合 delta)。
- ChatPanel 渲染**竖直活动时间线**:每个条目一行/一块(think 🧠、tool 🔧、stage ▶、content 📝),**默认折叠概要,点开看细节**(think 的推理全文、tool 的参数+返回)。
- stage 条目作为**视觉分隔/标题**,把它后面的 think/tool 视觉归组(但层级上是平级)。
- 章节正文仍走 ChapterPreview:writer 的 `ActTool{tool:'append_section'}` 触发 ChapterPreview 刷新(正文一节节长出来)。
- 流水线进行中:输入框禁用(避免并发 → 消除"结算中再聊天打断"问题;因为结算就在流里,流没完输入锁着)。

---

## 7. 记忆模型(三份存储)

| 存储 | 存什么 | 谁用 | 处置 |
|---|---|---|---|
| **① checkpointer**(`agent_memory`) | 会话消息线程 | **会话 agent**(回忆聊天) | **保留**(单 agent,无握手) |
| **② Message 表**(`public.Message`) | 聊天记录 | 前端展示 | 保留(界面照常显示) |
| **③ 小说结构化数据**(`Novel`/`Chapter`/`ChapterSummary`/`StoryEvent`) | 设定/正文/摘要/伏笔 | 专家 agent 的 Composer | 保留,每次现读 |

> 聊天原文(②)不回喂专家 agent;专家只读 ③。会话 agent 用 ①。**用户持久偏好**(如"主角要更阴郁")应显式存进 Novel.settings(update_novel 可写),由 Composer 注入——不靠聊天线程隐式记忆(更靠谱、可改)。

---

## 8. 迁移与删除

**删/停用**:
- `createSwarm` + 握手工具(transfer_to_writer/transfer_to_main)——400 主污染源。
- 会话 agent 从「swarm 双 agent」改为「单 agent + checkpointer」。
- 异步 Analyst 路径(streamTurn 末尾 fire-and-forget settle)——被同步 settler stage 取代。
- `ContextAssembler` 的原始线程拼接(保留 DB→prompt 逻辑,迁入 writer 的 Composer)。
- 自愈兜底(`clearThreadCheckpoints`+retry):**保留**(会话 checkpointer 仍在,trim 边界兜底)。

**保留/复用**:
- checkpointer provider(PostgresSaver)——给会话 agent 用。
- 所有工具(append_section/get_chapter/list_chapters/query_memory/update_novel)+ ChapterService/SummaryService/StoryEventService。
- ChapterSummary/StoryEvent 数据模型、日志系统(pino/AgentLogger)、流式基础设施(controller newline-JSON)。
- `makeTrimHook`(给会话 agent 用,含错配修复)。

---

## 9. 非目标(后续子项目)

- 写章的 **校验/评分/修订回路**(打分、最高分回滚、净增益门槛)= #2。
- **完整立项流水线 + LLM 意图路由** = #3。
- **replace/insert/delete/replace-all 工具 + AI 自主拆分** = #4。
- Composer 高级策展、多流水线并发 = 后续。

---

## 10. 风险

- **会话 checkpointer 仍可能极小概率 400**(trim 边界)。防线:砍 swarm(主源)+ trimHook 错配修复 + 自愈兜底。若仍反复,再针对单 agent 线程的 trim 优化。
- **writer 单次工具循环可能偏长**(写整章=多次 append)。每次 append 小参数(<60s);循环内若反复 get_chapter 取整章会膨胀本次运行上下文。缓解:Composer 优先给摘要+目标,prompt 引导少做全文 get_chapter。
- **扁平活动流协议 + FE 时间线**是本期主要新活;接 reasoning_content 也需验证 GLM 流式能否稳定给 reasoning token。
- **迁移期 chat 不能断**:onboarding 由会话 agent 直接处理,CONCEPT→ACTIVE 全程可用。
- **createReactAgent 无 checkpointer(专家)+ 有 checkpointer(会话)** 的可行性:plan 里 spike 确认。

---

## 11. 参考

- inkos 范式:`BaseAgent` 无状态 `chat([{system},{user}])` + 确定性 Composer + 命令式 PipelineRunner + 评分回路。详见 `docs/references/inkos-workflow-reference.md` 及 `/Users/taowen/project/inkos`。
- 现有 ContextAssembler / AnalystService 的 prompt 构造(迁入 Composer)。
- v0.5.x 的工具层与记忆表(直接复用)。
