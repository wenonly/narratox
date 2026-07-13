# 2026-07-14 Main Agent Todo Tracking(用户计划跟踪)

## 背景

作者在与 main agent 交互时,常给出「1. 建世界观 2. 建大纲 3. 写第一章」式的编号/顺序计划。当前 main 没有任何计划跟踪机制 —— 它按 Phase 16「一步一停」协议逐步执行,但**不持久化用户给的步骤清单**,导致:漏步、乱序、提前收工。作者无法判断 agent 跟到了第几步。

deepagents 依赖的 `langchain` 提供 `todoListMiddleware`:给 agent 注入 `write_todos` 工具 + `todos` state 字段(整体替换语义,每轮至多一次,经 checkpointer 持久化)。项目当前用 `createAgent`(非 `createDeepAgent`),中间件栈手挑,未挂载 todoListMiddleware。

## 目标

让 main 能**跟踪用户给出的多步计划**:记录全量 → 每步推进时更新 status → 收尾核对无 pending。无计划意图时不触发,行为不变。

## 非目标

- FE 可视化进度面板(deferred —— `write_todos` 工具调用已作为 `tool` 帧出现在聊天流,可见 JSON)。
- 子 agent 挂载(chapter-orchestrator/writer 的内部循环不在本期范围)。
- DB 迁移(`todos` 走 agent state + checkpointer,不入业务表)。

## 设计

### 1. 中间件挂载([deep-agent.service.ts](server/src/agentos/deep-agent.service.ts) `buildAgentGraph`)

main 的 middleware 数组首位加 `todoListMiddleware()`:

```ts
const { createAgent, todoListMiddleware } = await import('langchain');  // ← 拆出
// ...
middleware: [
  todoListMiddleware(),                          // ← 新增(首位)
  createSubAgentMiddleware({...}),
  createSummarizationMiddleware({ backend }),
  createPatchToolCallsMiddleware(),
],
```

`todoListMiddleware` 来自 `langchain`(deepagents 从那 re-export,项目已动态 import langchain)。它给 main state 加 `todos: { content, status: "pending"|"in_progress"|"completed" }[]` 字段,经 PostgresSaver 持久化(跨 turn 保留)。**子 agent 不受影响** —— `subagentStack()` 不动,仍是 `[createPatchToolCallsMiddleware]`。

### 2. main.md 加【用户计划跟踪】段落([prompts/main.md](server/src/agentos/prompts/main.md))

织进现有 Phase 16「一步一停」协议。放在【核心原则】之后,使其作为顶层纪律的一部分。关键点:

- **意图判断(交给 agent,不写死匹配)**:用户请求若体现多步骤/先后顺序的计划意图(显式编号「1.2.3.」、隐含「先…再…最后…」、或多件事并列委托),用 `write_todos` 记录。**单步请求不用**(避免噪声)。
- **与一步一停缝合**:检测到计划意图 → `write_todos` 记录全量(全部 pending)→ 每步开始把对应项标 `in_progress` + 给建议问作者 → 作者确认后委派 `task` → 回来标 `completed` → 进入下一步。
- **整体替换语义**:每次调用 `write_todos` 重发完整列表(带更新后的 status),不是增量。
- **收尾**:全部 `completed` 后才能说「计划完成」;有 pending 就继续或明确告诉作者剩什么。

main.md 是主系统提示词(中间件 prompt 在其后 append),这条具体规则压过中间件自带的"use for complex”通用 nudge —— 没计划意图时不触发,行为和现在一致。

### 3. 不动的部分

- **FE**:无改动。`write_todos` 调用经现有 `createActivityEmitter` 作为 `tool` 帧出现在聊天流(ToolMessage 内容 `"Updated todo list to [...]"` 的 JSON),无专门面板。
- **DB / AGENT_TREE / 子 agent / 工具**:不动。
- **测试**:`agent-prompts.spec.ts` 锁的 MAIN 特征子串是 `'你是【交互式编排者】'`(开头),新增段落不动它 —— 无需改断言。

## 影响面

两文件:`deep-agent.service.ts`(import + middleware 数组加一项)+ `prompts/main.md`(加一个段落)。零 DB、零 FE、零新 agent。

## 风险

- **中间件自带 prompt 噪声**:每轮 append "use for complex objectives"。由 main.md 显式「单步请求不用 write_todos」规则压制 —— main.md 是主提示词,具体规则优先。
- **整体替换语义误用**:agent 可能误以为是增量。main.md 明确「每次重发完整列表」。
- **agent 不触发**:意图判断交给模型,弱模型可能漏判隐含计划。可接受 —— 显式编号场景已被覆盖,且即便不触发,行为退化到现状(无回归)。
