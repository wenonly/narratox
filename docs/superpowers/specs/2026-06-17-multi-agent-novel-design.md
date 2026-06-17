# narratox 多 Agent 小说工作台 — 设计文档(骨架)

- 日期:2026-06-17
- 状态:已与用户确认,待 review
- 分支:`feat/multi-agent-novel`
- 范围:把 narratox 从「单 agent chat + 手动采纳」升级为「**多 agent swarm + AI 问答式建书 + agent 工具自动写**」的骨架。本骨架只跑通 **创作 Agent + 工作台主 Agent + 写作 Agent**(都用已有的 Novel/Chapter 资源);大纲/角色/世界观 Agent 定义好但随资源后续启用。
- 前置:Phase 1(v0.2.0)已完成 —— 小说库 + 工作台(聊天+稿件)+ 配置 + mutation 层 + 单 agent 聊天。

---

## 1. 背景与目标

Phase 1 的两个痛点:

1. **建书靠手动表单** —— 用户手填标题/类型/世界观。应是 AI 问答式收集(参考 inkos)。
2. **落稿靠手动「采纳」按钮** —— 用户手点。应是 agent 在对话中自动判断、用工具写。

本骨架引入 **多 agent 架构**(LangGraph swarm)解决这两点,并为后续(大纲/角色/世界观/审查/事实系统)搭好骨架。

**核心原则**(借鉴 webnovel-writer-workflow-reference §3.2/§6.4):每个 agent 有明确的**读写边界 + 输出契约**;一个 LLM 调用不做完所有事;agent 之间通过工具/handoff 协作,不耦合。

---

## 2. 架构(已验证可行:GO-WITH-CAVEATS)

**两个 agent 上下文**(因为"问答→再建书",书在 Q&A 时还不存在):

### 2.1 创作 Agent(建书前,单 agent)
一个独立的**创作聊天**(`createReactAgent`,带 `create_novel` 工具)。问答收集信息 → 调 `create_novel` 建书 → 跳工作台。**替代 Phase 1 的手动 `NewNovelForm`。**

- 不需要 swarm(创作时只有一个 agent,无转交需求)。
- 跑在临时线程上(创作对话不入书;书建好后工作台开新会话,创作信息存在 `Novel.settings`/字段里)。

### 2.2 工作台 swarm(每本小说一个,主+专家)
用 `@langchain/langgraph-swarm` 的 `createSwarm`。主 Agent(按小说 prompt)+ 写作 Agent,主 Agent 用 `transfer_to_*` 转交,写作 Agent 直接和你聊、用工具写章节。

- **handoff 机制**:`createHandoffTool({ agentName })` 生成 `transfer_to_<name>` 工具;主 Agent 调它 → LangGraph `Command(goto, update:{activeAgent})` 把控制权交给目标 agent → 目标 agent 直接产出下一句给用户。**真 swarm handoff,非同步子 agent。**
- **共享线程记忆**:所有 agent 共用同一 `messages`(同 `thread_id` = `novel.sessionId`)。handoff 后新 agent 看得到全部历史。
- **active agent 持久化**:`SwarmState.activeAgent` 通道,经 checkpointer 跨轮保持(下一轮自动续到上次活跃的 agent)。
- **按小说缓存**:swarm 按 `ContextAssembler` 产出的 systemPrompt 缓存(沿用 Phase 1 的 per-prompt 缓存思路)。

### 2.3 可行性结论(已验证)
- `@langchain/langgraph-swarm@1.0.2` 未安装,需新增;peer(`langgraph ^1.3.1`、`core ^1.1.44`)我们满足(`langgraph@1.4.2`、`core@1.1.49`)。
- **GLM(ChatOpenAI)✓**(无 Anthropic 约束)、**PostgresSaver checkpointer 原样复用✓**、**`streamMode:'messages'` 流式不变✓**、**共享线程记忆✓**。
- **两个代价**(见 §10):① deepagents 自带的 `SummarizationMiddleware` 会丢,需自己加 `preModelHook`;② **GLM 发 `transfer_to_*` 的可靠性是唯一真未知**,需集成测验证,不行就回退自定义路由。

---

## 3. Agent 阵容

| Agent | 上下文 | 角色 | 读 | 写(工具) | 骨架状态 |
|---|---|---|---|---|---|
| **创作 Agent** | 建书前 | 问答立项,建书 | — | `create_novel` | **本次跑通** |
| **主 Agent** | 工作台 | 判断意图、转交(前台) | — | `transfer_to_writer`(+后续) | **本次跑通** |
| **写作 Agent** | 工作台 | 写/续写章节 | 章节列表 | `write_chapter`/`update_chapter` + `transfer_to_main` | **本次跑通** |
| 大纲 Agent | 工作台 | 规划结构 | — | `write_outline` | 定义,待大纲资源 |
| 角色 Agent | 工作台 | 管理角色 | — | `write_character` | 定义,待角色资源 |
| 世界观 Agent | 工作台 | 管理设定 | — | `write_worldview` | 定义,待世界观资源 |

### 各 agent 细节(本次跑通的三个)

**创作 Agent**
- system prompt:网文/小说立项助手。一次问一个问题、含糊时给 2-3 选项、信息够了主动建议建书(借鉴 inkos 的创作 prompt 风格)。**不强制多步闸门**(参考 webnovel-reference §7/§6.2 —— narratox 面向协作,AI 出草稿作者改,而非强制问答门)。
- 收集字段:`title`(必需)、`genre`、`synopsis`(一句话故事/核心冲突)、`settings.worldviewText`(世界观种子)、`settings.style`(文风);其余 optional。
- 工具:`create_novel({ title, genre?, synopsis?, settings? })` → `NovelService.create`(复用 Phase 1,建 Novel+Session+种第一章)→ 返回 `{ novelId }`。
- 充分性:`title` 必需(代码层硬校验,沿用 inkos);其余 prompt 引导,prompt 判断"够了"就建议调 `create_novel`。

**主 Agent(工作台)**
- system prompt:`ContextAssembler.forSession` 产出的 per-novel prompt(沿用 Phase 1)+ swarm 调度指令("判断用户意图,写作类转交写作 Agent")。
- 工具:`transfer_to_writer`(handoff)。
- 不直接写资源,只路由。

**写作 Agent(工作台)**
- system prompt:小说写作手,按对话/大纲写正文;生成正文时**主动调 `write_chapter` 落稿**(不要等用户点采纳)。
- 工具:`write_chapter({ chapterId, op:'append'|'set', content })`、`update_chapter`(alias of set)、`list_chapters`(只读,知道有哪些章)、`transfer_to_main`。
- 写入工具**直接走 Phase 1 mutation 层**(`ChapterHandler.apply`)。

---

## 4. 工具层(自动写,去掉「采纳」)

- **删除前端「采纳到本章」按钮**(`Messages.tsx` 的 `onAccept` 回退掉)。
- agent 写入工具是 Phase 1 mutation 层的**薄封装**:
  - `create_novel` → `NovelService.create`
  - `write_chapter` / `update_chapter` → `ChapterHandler.apply({resource:'chapter', targetId, op, content})`
- 工具签名用 zod schema(`responseFormat` 可选);工具内部按 `userId` 隔离(从 thread/上下文取,或工具闭包绑定)。
- 写作 Agent 生成正文时自动调 `write_chapter` → 稿件实时更新。用户在聊天里说"重写/接着写",Agent 用工具改稿件。**无需手点采纳。**
- 这正是把 Phase 1 的 mutation 层升级成 agent tools(spec 原规划在 Phase 2+)。

> 用户身份如何在工具里拿到:agent 运行在某个 novel 的 thread 上;工具需知道 `userId` + `novelId`。方案:构建 swarm/工具时,把 `{userId, novelId}` 作为**闭包变量**注入工具(每个 novel 的 swarm 实例自带这两个值),工具内部直接用,不从 LLM 入参取(防伪造)。创作 Agent 的 `create_novel` 工具闭包带 `userId`(建书时还没 novelId)。

---

## 5. 交互 / UX

### 5.1 建书:创作聊天替代表单
- 小说库「新建小说」→ 不再弹 `NewNovelForm`,而是 `router.push('/novels/new')`(创作聊天页)。
- 创作 Agent 一问一答 → 信息够了调 `create_novel` → **前端检测到 `create_novel` 工具结果(含 novelId)→ 自动跳 `/novels/[id]`**。
- 删除 `NewNovelForm`(用户要求替换;不保留表单)。

### 5.2 工作台:自动写
- 进工作台 → 主 Agent 接待。"写第 N 章 / 接着写" → 主转交写作 Agent → 写作 Agent 边聊边调 `write_chapter` → **右侧稿件随对话自动更新**(流结束后 `refresh` 拉 novel,章节内容刷新)。
- **没有「采纳」按钮**。稿件是 agent 写的副产品,实时反映。

### 5.3 (可选,非骨架)agent 切换指示
流里 `metadata.lc_agent_name` 标识当前 agent;未来可在 UI 显示"正与写作 Agent 对话"。骨架不做。

---

## 6. 数据模型

**骨架不加新表**。复用 Phase 1:
- 创作 Agent → `Novel`(+ `Session` + 种 `Chapter`)。
- 写作 Agent → `Chapter.content`。
- `ContextAssembler` 不变(主 Agent prompt)。
- 大纲/角色/世界观资源 = 后续 spec(届时加表 + 对应 agent 启用)。

---

## 7. 服务端改动

### 7.1 `DeepAgentService` 改造(或拆出新服务)
- 新增 `buildCreationAgent()`:`createReactAgent` + `create_novel` 工具(闭包带 `userId`)。
- 新增 `buildSwarm(systemPrompt, ctx)`:`createReactAgent` 建主 Agent + 写作 Agent → `createSwarm({agents, defaultActiveAgent:'main'})` → `.compile({checkpointer})`。工具闭包带 `{userId, novelId}`。
- 主 Agent 的 prompt 由 `ContextAssembler` 产(沿用 Phase 1 `forSession`)。
- **保留** `streamTurn`(swarm 和创作 agent 都支持 `.stream({messages},{configurable:{thread_id},streamMode:'messages'})`)、`extractDelta`、per-prompt 缓存、`checkpointer as never` cast、动态 import(ESM,保 Jest 干净)。
- 每个 `createReactAgent` 加 `preModelHook`(见 §10.1)补回长历史摘要。

### 7.2 端点
- `POST /agents/:id/runs`(流式聊天)需区分两种上下文:
  - **无 session_id**(或创作标记)→ 创作 Agent(临时线程)。
  - **有 session_id**(=novel.sessionId)→ 工作台 swarm(按 novel 解析 userId/novelId,取缓存 swarm)。
- `create_novel` / `write_chapter` 等工具落库走现有 `NovelService`/`ChapterHandler`,**不新增端点**(工具在 agent 内部调服务,不经 HTTP)。

### 7.3 依赖
- 新增 `@langchain/langgraph-swarm@^1.0.2`;把 `@langchain/langgraph@^1.4.2` 提为直接依赖(当前是 deepagents 的传递依赖)。
- 用 `createReactAgent`(`@langchain/langgraph/prebuilt`),**不用** `langchain` 的 `createAgent`(swarm 未适配,官方告警)。

---

## 8. 前端改动

- **删「采纳到本章」按钮**:`Messages.tsx` 去掉 `onAccept`/`canAccept`;`MessageArea`/`ChatPanel` 不再传。稿件靠 agent 工具自动写 + 流结束 `refresh`。
- **创作聊天页** `/novels/new`:复用聊天组件(`MessageArea`/`ChatInput`/`useAIStreamHandler`),指向创作 Agent(无 session_id);流处理里检测 `create_novel` 工具结果 → `router.push(/novels/[id])`。
- **小说库**:`NewNovelButton` 改为跳 `/novels/new`;移除 `NewNovelForm`。
- 工作台 `ChatPanel`:不变(仍复用聊天基建),只是不再有采纳按钮、稿件自动刷。

---

## 9. 分期与范围

**本骨架(本 spec)**:
1. swarm 基建 + 依赖 + GLM handoff 可靠性验证(§10.2)。
2. 创作 Agent + `create_novel` 工具 + 创作聊天页(替代表单)。
3. 工作台 swarm:主 Agent + 写作 Agent + `write/update_chapter` 工具(自动写)。
4. 删「采纳」按钮;`preModelHook` 摘要。
5. 全门禁绿 + 端到端冒烟(创作问答→建书→工作台→写作 Agent 自动写章节)。

**后续(各自独立 spec)**:
- 大纲 Agent + 大纲资源(结构化章纲节点 CBN/CPNs/CEN —— 参考 webnovel-reference §6.2)。
- 角色 / 世界观 Agent + 资源(实体表 + tier —— §6.3)。
- 轻量 reviewer Agent(§6.4 短期)。
- Phase 3:StoryEvent ledger + 事实提取(写作 agent 落稿时触发 —— §6.6)+ 三层记忆 + token 预算(§6.5)+ 状态/体检视图。
- UI:agent 切换指示、创作聊天里的实时"草稿卡"(inkos 借鉴)。

---

## 10. 风险与缓解

### 10.1 长历史摘要丢失(中)
deepagents 自动挂 `SummarizationMiddleware`;raw `createReactAgent` 没有。**缓解**:每个 agent 加 `preModelHook`,用 `trimMessages`(保留最近 N 轮 + system)或轻量摘要。长篇前必须就位。

### 10.2 GLM handoff 可靠性(唯一真未知)
swarm 靠 LLM 可靠发出 `transfer_to_*`。GLM-5.2 支持工具调用(Phase 1 已证),但 handoff 时机/判断在非 OpenAI/Anthropic 模型上先例少。**缓解**:写一个集成测,主 Agent 在应转交的场景下确实发出 `transfer_to_writer`。**若不可靠 → 回退方案:自定义路由**(自建 supervisor `StateGraph` + `activeAgent` 通道,每轮由我们的逻辑派发 agent,不依赖 LLM 发 transfer;无需 swarm 包)。

### 10.3 工具调用身份安全
工具的 `userId`/`novelId` **闭包注入**(构建 swarm/工具时绑定),**绝不从 LLM 工具入参取**,防伪造/越权。沿用 Phase 1 的多租户隔离纪律。

### 10.4 ESM / Jest
`createSwarm`/`createHandoffTool`/`createReactAgent` 在方法内**动态 import**(不在模块顶层),保 Jest 收集干净(沿用 `deep-agent.service.ts` 既有模式)。

---

## 11. 参考与依据

- `~/project/inkos` —— 创作问答 prompt 风格、`create_book` 工具作强制函数、模式门控工具集。
- `docs/references/webnovel-writer-workflow-reference.md` —— agent 读写边界+输出契约(§3.2/§6.4)、创作轻量问答非强制闸门(§7/§6.2)、事实提取/结构化章纲作为后续(§6.2/§6.6)。
- `langchain-learn/deep-agents-tutorial/11-subagents.md` + `node_modules/deepagents` —— 对比 deepagents `task` 子 agent(同步、不面向用户)vs swarm handoff;确认本设计用 swarm。
- `@langchain/langgraph-swarm` `.d.ts` —— `createSwarm`/`createHandoffTool`/`SwarmState.activeAgent` API。

---

## 12. 非目标(本骨架不做)

- 大纲 / 角色 / 世界观 的资源表与对应 agent 启用(后续 spec)。
- reviewer / data-agent / context-agent(Phase 2 末 / Phase 3)。
- StoryEvent ledger / 事实提取 / 投影(Phase 3)。
- 三层记忆 + token 预算 / 按相关性注入(Phase 3;骨架用 `preModelHook` trim 兜底)。
- UI agent 切换指示、创作草稿卡(后续)。
- 保留手动表单 / 手动「采纳」(用户明确移除)。
