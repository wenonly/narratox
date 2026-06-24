# 错误信息回显 + 用户消息撤回 — 设计文档

- 日期:2026-06-24
- 状态:已与用户确认,待 review
- 范围:两件事 —— (1) **错误信息回显**:整轮失败(LLM 崩溃 / 未配置模型 / 流中断)时,把用户原消息 + 错误内容作为消息持久化并回显,不再"发了就消失";(2) **用户消息撤回**:用户消息右上角加撤回按钮,二次确认后**尾部截断**(删掉该消息 + 其回复 + 之后所有轮次),撤回的文案回填进输入框,且 **Agent 记忆(checkpoint)一起真回退**。
- 前置:当前持久化在 [agentos.controller.ts:220](server/src/agentos/agentos.controller.ts) 的 `finally` 里,守卫是 `completed && message` —— **报错时不写 `Message` 表**;前端 [useAIStreamHandler.tsx:40-49](agent-ui/src/hooks/useAIStreamHandler.tsx) 只给末尾空 agent 气泡打 transient `streamingError` 标志 + 全局 `streamingErrorMessage` 字符串,刷新即失。Agent 记忆靠 langgraph checkpointer 自动加载 thread state([deep-agent.service.ts:375-378](server/src/agentos/deep-agent.service.ts)),报错时部分 checkpoint 已写入 `agent_memory`,与 `Message` 表分叉。前端输入框 `inputMessage` 是 [ChatInput.tsx:17](agent-ui/src/components/chat/ChatArea/ChatInput/ChatInput.tsx) 的 local `useState`,store 无 setter。

> 本次顺带把"持久化时机"从"成功才一次性写 user+assistant"重构为"开始时建 user 行、结束时写 assistant 行(无论成败)",这是两个功能的共同地基。

---

## 1. 背景与目标

用户反馈两个问题:

1. **错误轮次从 Message 列表消失**:聊天中大模型或工具报错,这条(用户消息 + 错误)不进 Message 列表(不持久化、刷新就没),但 Deep Agents 的记忆(checkpoint)里还留着数据。希望错误信息也进入 Message 列表、能在界面回显。
2. **想撤回/重发某条用户消息**:希望用户消息右上角有撤回图标,点击二次确认后,**撤回到该消息发送之前**,撤回的文案自动放回输入框。

**核心原则**:错误轮次 = 一等公民消息(持久化 + 回显);撤回 = 真回退(Agent 记忆一起回退,而非仅清 UI)。

---

## 2. 架构总览

### 2.1 决策(已与用户确认)

| 议题 | 决策 |
|---|---|
| 功能①错误范围 | **仅整轮失败错误**(LLM 崩溃 / 未配置模型 / 流中断)。单次工具错误(`ActEnd status:'error'`)本次**不做**(emitter 现硬编码 `status:'ok'`,见"不在本次范围") |
| 功能②回退深度 | **真回退**:Agent 记忆(checkpoint)一起回退,用 langgraph 原生 `getState` + `updateState(RemoveMessage)`(已验证 langgraph 1.4.2 + `@langchain/core` 支持) |
| 撤回语义 | **尾部截断**:撤回某用户消息 = 删该消息 + 其回复 + 之后所有轮次(中间挖洞无意义) |
| 错误轮次去留 | **保留在历史**(移除前端"下一轮自动 slice(0,-2) 掉错误对"逻辑),用户不想要可用撤回 |
| 撤回按钮范围 | **只在用户消息上**,不撤回 assistant 消息 |
| 撤回按钮显隐 | **hover 才显示**,避免视觉噪音 |
| 输入框回填 | 把 `inputMessage` 从 ChatInput local state **提升进 Zustand store**,加 `setChatInput` action |
| Schema 变更 | `Message` 加两列:`isError Boolean @default(false)`、`langGraphId String?` |

### 2.2 数据流

**功能①(错误回显)+ 共同地基(持久化重构)**:

```
用户发消息 ──POST /agents/:id/runs──► AgentosController
                                         │
                生成 userMsgId = uuid()
                sessions.startTurn(userId, sessionId, userContent, langGraphId)  ◄── 立即建 user 行(带 langGraphId)
                发 RunStarted { ..., user_message_id, user_message_lang_id }
                                         │
                deepAgent.runTurn({ ..., userMessageId: userMsgId })             ◄── 注入 { role:'user', content, id: userMsgId }
                                         │
                finally(无论成败):
                  sessions.finishTurn(turnId, reply, activities, isError)         ◄── 写 assistant 行;失败时 isError=true, content=错误文案
```

**功能②(撤回 / 真回退)**:

```
用户点撤回(消息 idx=i) ──二次确认──► POST /sessions/:id/recall { messageRowId }
                                         │
                SessionsService.recall(userId, sessionId, messageRowId):
                  1. 查该 user 行(校验 ownership + 取 langGraphId / createdAt)+ 之后所有 Message 行
                  2. graph = deepAgent.buildAgentGraph(...)              ◄── 复用 runTurn 的构造,不调 LLM
                  3. state = await graph.getState({ configurable:{ thread_id: sessionId } })
                  4. idx = state.values.messages.findIndex(m => m.id === langGraphId)
                     idx>=0 → removes = state.values.messages.slice(idx).map(m => new RemoveMessage(m.id))
                              await graph.updateState({ configurable:{ thread_id } }, { messages: removes })
                     idx<0  → (已被摘要压缩)跳过 state 修改,仅删 DB 行
                  5. 删 Prisma 里 turn N 及之后 Message 行
                                         │
                客户端:setMessages(slice(0, i)) + setChatInput(撤回的文案)
```

---

## 3. 数据模型(Prisma)

`Message` 加两列([schema.prisma](server/prisma/schema.prisma)):

```prisma
model Message {
  id          String   @id @default(cuid())
  sessionId   String
  role        String                         // 'user' | 'assistant'(自由字符串,不变)
  content     String
  activities  Json?
  isError     Boolean  @default(false)       // 🆕 功能①:整轮失败标记(仅 assistant 行用)
  langGraphId String?                        // 🆕 功能②:user 行对应的 langgraph message id(仅 user 行用)
  createdAt   DateTime @default(now())
  session     Session  @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  @@index([sessionId, createdAt])
}
```

迁移:`prisma migrate dev`(注意 [memory: prisma7-generate-gotcha](../../../.claude/projects/-Users-taowen-project-narratox/memory/prisma7-generate-gotcha.md) —— 改 schema 后**必须手动 `prisma generate`**)。历史行:`isError=false`、`langGraphId=null`(见"已知限制 §7.3")。

---

## 4. 功能①:错误信息回显(整轮失败)

### 4.1 服务端

**持久化重构** —— 拆 [sessions.service.ts](server/src/agentos/sessions.service.ts) 的 `appendTurn` 为两步:

```ts
// 轮次开始:立即建 user 行(带 langGraphId),返回行 id
async startTurn(userId, sessionId, userContent, langGraphId): Promise<string>

// 轮次结束:写 assistant 行(成功/失败都调)
async finishTurn(userId, turnId, assistantContent, activities?, isError = false): Promise<void>
```

- `startTurn`:校验 session ownership → `prisma.message.create({ role:'user', content, langGraphId })` → 返回 `id`。同时 bump `session.updatedAt`。
- `finishTurn`:`prisma.message.create({ role:'assistant', content, activities, isError })` 关联到同 session(按 turnId 不强需,assistant 行天然排在 user 行之后,靠 `createdAt asc` 配对,与现有 `getRuns` 配对逻辑一致)。
- 保留 `appendTurn` 仅供过渡/测试?**不保留** —— 直接替换,更新 [agentos.controller.spec.ts:297](server/src/agentos/agentos.controller.spec.ts)(该用例断言"报错时不调 appendTurn",需改为"报错时仍调 finishTurn 且 isError=true")。

**Controller 改动**([agentos.controller.ts](server/src/agentos/agentos.controller.ts) `runAgent`):

1. `resolveSession` 后、发 `RunStarted` 前:生成 `userMsgId = randomUUID()`,`const turnId = await sessions.startTurn(user.id, sessionId, message, userMsgId)`。
2. `RunStarted` 帧扩展:加 `user_message_id: turnId`、`user_message_lang_id: userMsgId`(供前端回填撤回所需 id)。
3. **错误消息跨块传递**:在 `try` 之前声明 `let runError: Error | undefined;`。`catch` 块里 `runError = err instanceof Error ? err : new Error(String(err))`,仍发 `RunError` 帧(客户端据此做 transient 红字 + 流式态收尾),**但持久化交给 finally**(不在 catch 里重复写)。
4. `finally` 块:把 `if (completed && message) sessions.appendTurn(...)` 改为**总是** `await sessions.finishTurn(user.id, turnId, reply, activities, !completed)`,其中 `reply = completed ? (contentMarkdown || '（已写入章节正文）') : (runError?.message ?? '本轮执行失败')`。`finishTurn` 自身 try/catch 只记日志(与现状一致,best-effort)。

### 4.2 前端

**类型**([types/os.ts:220 ChatMessage](agent-ui/src/types/os.ts)):加持久化字段:

```ts
export interface ChatMessage {
  role: 'user' | 'agent' | 'system' | 'tool'
  content: string
  id?: string                 // 🆕 DB 行 id(撤回用)
  langGraphId?: string        // 🆕 user 行的 langgraph id(撤回用)
  isError?: boolean           // 🆕 持久化错误标记(区别于 transient streamingError)
  streamingError?: boolean    // 保留:本轮流式态的瞬时错误
  // ...其余不变
}
```

**流式 handler**([useAIStreamHandler.tsx](agent-ui/src/hooks/useAIStreamHandler.tsx)):

- `RunStarted` 分支:把帧里的 `user_message_id` / `user_message_lang_id` 盖到刚乐观推入的那条 user 消息上(用 `setMessages` updater 定位末尾 user 行)。
- **删除 [L124-137](agent-ui/src/hooks/useAIStreamHandler.tsx) 的 `slice(0,-2)` 自动回滚** —— 错误轮次现在要保留。`updateMessagesWithErrorState` 改为:给末尾 agent 消息同时打 `streamingError=true`(保留瞬时红字)+ 不再删 user 行。
- `RunError` / `onError` / 外层 catch 三处:保留 `setStreamingErrorMessage`(瞬时提示),不再触发删除。

**历史加载**(两处都改):
- [ChatPanel.tsx:51-86](agent-ui/src/components/workspace/ChatPanel.tsx):`r` 映射时带上 `id`、`isError`(assistant 行)。
- [useSessionLoader.tsx:66-175](agent-ui/src/hooks/useSessionLoader.tsx):同上,把后端 `isError` / 行 `id` 透传到 `ChatMessage`。

**渲染**([MessageItem.tsx:18-30 AgentMessage](agent-ui/src/components/chat/ChatArea/Messages/MessageItem.tsx)):红字触发条件由 `message.streamingError` 改为 `message.isError || message.streamingError`。错误文案来源分两条路径(实现须显式区分,避免混用):
- **持久化错误**(刷新后从历史加载):`message.isError === true` → 文案取 `message.content`(服务端 `finishTurn` 已把 `runError.message` 写进 content)。
- **本轮流式态错误**(未刷新):`message.streamingError === true` → 文案取全局 `streamingErrorMessage`(流式中 content 可能有半截脏文本,不用 content)。

---

## 5. 功能②:用户消息撤回(真回退)

### 5.1 服务端

**DeepAgentService 抽取共享构造**([deep-agent.service.ts:185-373](server/src/agentos/deep-agent.service.ts)):把 `runTurn` 内联的 `createAgent({...})` 构造抽成:

```ts
private async buildAgentGraph(args: {
  userId, novelId, readingChapterOrder, signal?
}): Promise<CompiledGraph>   // 带 .stream / .getState / .updateState 的那个对象
```

- `runTurn` 调 `buildAgentGraph` 后 `.stream(...)`,并注入 user 消息 id:`{ messages: [{ role:'user', content: userMessage, id: userMessageId }] }`(新增 `userMessageId` 入参)。
- 新增 `async rewind(userId, novelId, threadId, langGraphId)`:调 `buildAgentGraph`(不 stream)→ `getState` → `findIndex` → `updateState({ messages: removes })`。**注意**:recall 不调 LLM;构造 graph 仍需走 model config 读取,但因不 invoke,model 可为占位(实现时 `buildAgentGraph` 允许 `model` 缺省时传一个最小占位实例,见 §7.2)。

**SessionsService.recall**:

```ts
async recall(userId, sessionId, messageRowId): Promise<{ recalledContent: string }> {
  // 1. 校验 + 取锚点 user 行 + 之后所有行(按 createdAt asc)
  const anchor = await prisma.message.findFirst({ where:{ id:messageRowId, sessionId, role:'user' } });
  if (!anchor || !(await this.owns(userId, sessionId))) throw new NotFoundException();
  const after = await prisma.message.findMany({
    where:{ sessionId, createdAt:{ gte: anchor.createdAt } },
    orderBy:{ createdAt:'asc' },
  });
  // 2. 真回退 checkpoint(若有 langGraphId)
  if (anchor.langGraphId) {
    await deepAgent.rewind(userId, novelId, sessionId, anchor.langGraphId);
  }
  // 3. 删 DB 行(尾部截断)
  await prisma.message.deleteMany({ where:{ id:{ in: after.map(m=>m.id) } } });
  return { recalledContent: anchor.content };
}
```

(novelId 从 `session.novel.id` 取 —— Session 1:1 Novel。)

**Controller**([agentos.controller.ts](server/src/agentos/agentos.controller.ts)):加 `@Post('sessions/:id/recall')`,body `{ messageRowId }`,`@CurrentUser` 注入,调 `sessions.recall`,返回 `{ recalledContent }`(客户端其实自带文案,但返回便于校验)。

### 5.2 前端

**Store**([store.ts](agent-ui/src/store.ts)):把 `inputMessage` 从 ChatInput 提升进来:

```ts
inputMessage: string          // 🆕 从 ChatInput local state 迁入
setChatInput: (v: string) => void
focusChatInput: () => void    // 已有,保留
```

- `ChatInput.tsx`:删本地 `useState('')`,改读 `useStore(s=>s.inputMessage)` / `setChatInput`;`handleSubmit` 清空用 `setChatInput('')`。`chatInputRef` 保留(autofocus/autosize)。
- `partialize` **不要**持久化 `inputMessage`(刷新清空,与现状一致)。

**撤回按钮**([MessageItem.tsx UserMessage L93-104](agent-ui/src/components/chat/ChatArea/Messages/MessageItem.tsx)):

- `UserMessage` 包一层 `group relative`,右上角放撤回图标按钮 `className="opacity-0 group-hover:opacity-100"`(用 lucide `Undo2` 或 `RotateCcw`)。
- 点击 → 弹二次确认(shadcn `AlertDialog`,文案:"撤回此消息?该消息及其后的所有对话将被删除,内容会回到输入框。")。
- 确认 → `POST /sessions/:id/recall { messageRowId: message.id }`:
  - 流式中(`isStreaming`)禁用撤回(避免与正在写的轮次冲突)。
  - 成功 → `setMessages(prev => prev.slice(0, i))` + `setChatInput(message.content)` + `focusChatInput()`。
  - 失败 → toast 报错,messages 不动。
- **没有 `id` 的旧消息**(pre-feature):撤回按钮 disabled + tooltip "此消息为历史消息,暂不支持撤回"(见 §7.3)。

**API 路由**([api/routes.ts](agent-ui/src/api/routes.ts) + [api/os.ts](agent-ui/src/api/os.ts)):加 `APIRoutes.RecallSession(url, sessionId) = "${url}/sessions/${sessionId}/recall"` + `recallSessionAPI(...)`。

---

## 6. 两个功能的交汇点

`startTurn` 提前建 user 行(+ `langGraphId`)这件事**同时服务两个功能**:

| | 功能①(错误回显) | 功能②(撤回) |
|---|---|---|
| user 行提前建 | 整轮失败时 user 消息仍在历史 | 撤回有锚点行可定位 |
| `langGraphId` | — | 撤回时定位 checkpoint state 里的消息 |
| `isError` | 错误 assistant 行标记 | — |

所以服务端"持久化重构 + 两列"是**一次性共同改动**,两功能在此基础上各自展开。建议实现顺序:先共同地基(Schema + startTurn/finishTurn)→ 功能①(端到端可见、风险低)→ 功能②(撤回 + 真回退)。

---

## 7. 关键风险 / 边界 / 已知限制

### 7.1 RemoveMessage 删不存在 id 会抛错
`messages_reducer.d.ts:31,39`:删 state 里已不存在的 id 抛错。**对策**:`rewind` 里 `findIndex` 找锚点;`idx>=0` 才构造 `removes`,且 `removes` 只包含当前 `state.values.messages` 里**确实存在**的 id(用 `filter` 交集),避免删已被摘要移除的中间消息。`idx<0`(锚点已被摘要压缩)→ 跳过 state 修改。

### 7.2 摘要压缩导致"不完全遗忘"(已知限制)
`createSummarizationMiddleware`([deep-agent.service.ts:355](server/src/agentos/deep-agent.service.ts))会把老消息压成摘要。**对仍在 live 消息窗口里的近期轮次,撤回 = 完全遗忘;对已被压进摘要的老轮次,DB/UI 回退了,但摘要里可能残留语义痕迹。** 本次不处理摘要重生成(成本过高),文档/tooltip 如实说明"撤回最近的消息最干净"。

### 7.3 pre-feature 历史消息无 `langGraphId`
迁移前的 user 行 `langGraphId=null`。撤回这类消息:`recall` 跳过 checkpoint 回退、只删 DB 行 → **不是真回退**(agent 仍记得)。**对策**:前端对 `!message.langGraphId` 的 user 消息禁用撤回按钮 + tooltip 说明,避免给用户假承诺。(若后续要支持,可加"按 content 在 state.messages 里模糊匹配"的回退路径,本次不做。)

### 7.4 子 agent 的消息都在同一 thread
`createSubAgentMiddleware` 的子 agent(chapter/writer/...)消息累积在主 thread 的 `messages` channel。`rewind` 从锚点 user 消息 `slice(idx)` 到末尾,**自然涵盖**该轮的 assistant 回复 / tool call / tool result / 子 agent task 消息 —— 即尾部截断在 state 层也成立。无需单独处理子 agent。

### 7.5 `buildAgentGraph` 的 model 占位
recall 不调 LLM,但 `createAgent` 必须传 `model`。无活动 model 配置时:要么要求"撤回也需已配置模型"(简单),要么 `buildAgentGraph` 在"仅用于 state 操作"模式下传一个最小占位 model 实例。**实现选后者**(传占位,不读 config),让撤回不依赖模型配置状态。

### 7.6 并发 / 流式中撤回
流式进行中禁止撤回(前端 disable);服务端 `recall` 与 `runTurn` 共用 thread_id,理论上若并发会有 checkpoint 写竞争。本次靠"前端流式中禁用"规避,服务端不加锁(YAGNI)。

### 7.7 同一 createdAt 配对风险
`getRuns` / `recall` 靠 `createdAt asc` 配对 user/assistant。`startTurn` 与 `finishTurn` 是两次 `create`,时间不同 → assistant.createdAt > user.createdAt,配对稳定。极端同毫秒:`@@index([sessionId, createdAt])` + cuid 主键,配对按时间 + 行顺序,实践中无歧义(一轮只有一对 user/assistant)。

---

## 8. 测试策略

**server(jest 单元)**:
- `sessions.service.spec.ts`:`startTurn` 建 user 行(带 langGraphId)+ 返回 id;`finishTurn` 写 assistant 行(`isError` 两种);`recall` 尾部截断删除 + 调用 `deepAgent.rewind`(mock);ownership 校验。
- `agentos.controller.spec.ts`:更新"报错时持久化"用例 —— 断言 `startTurn` 总被调、`finishTurn` 在 `finally` 总被调且 `isError=!completed`;`RunStarted` 帧带 `user_message_id`/`user_message_lang_id`;新增 `recall` 路由用例。
- `deep-agent.service`:`buildAgentGraph` 抽取后,`rewind` 用 mock graph 验证 `getState`→`findIndex`→`updateState` 调用序列 + RemoveMessage 构造;`idx<0` 跳过分支。
- model-factory 路由等已有测试不受影响。

**agent-ui(无 test runner,靠 `pnpm validate` + 手测)**:
- typecheck:`ChatMessage` 新字段、`setChatInput`、撤回 API 类型。
- 手测:① 触发整轮失败(关掉 model 配置)→ 看红字 + 刷新仍在;② 发几轮 → hover 用户消息 → 撤回 → 截断 + 输入框回填 + 再发一条验证 agent 不记得被撤回内容。

---

## 9. 不在本次范围(YAGNI)

- **单次工具错误回显**(`ActEnd status:'error'`):emitter 现硬编码 `status:'ok'`([activity-emitter.ts:119,136,139](server/src/agentos/activity-emitter.ts)),改 emitter + 工具卡片标红是独立工作量,本次不做(功能①已选"仅整轮失败")。
- **撤回 assistant 消息 / 中间挖洞**:语义复杂、需重放,不做。
- **摘要重生成以彻底遗忘老轮次**:成本过高,见 §7.2。
- **pre-feature 历史消息的真回退**(按 content 模糊匹配 state):见 §7.3。
- **服务端并发锁**:见 §7.6。
- **多分支 checkpoint 管理 / orphan GC**:`updateState` 路线不产生分叉,无需。

---

## 10. 文件级改动清单

**server**:
- [prisma/schema.prisma](server/prisma/schema.prisma):`Message` 加 `isError`、`langGraphId` + 迁移。
- [src/agentos/sessions.service.ts](server/src/agentos/sessions.service.ts):`appendTurn` → `startTurn` + `finishTurn`;新增 `recall`。
- [src/agentos/agentos.controller.ts](server/src/agentos/agentos.controller.ts):`runAgent` 持久化重构 + `RunStarted` 扩展;新增 `POST sessions/:id/recall`。
- [src/agentos/deep-agent.service.ts](server/src/agentos/deep-agent.service.ts):抽 `buildAgentGraph`;`runTurn` 注入 `userMessageId`;新增 `rewind`。
- [src/agentos/sessions.service.spec.ts](server/src/agentos/sessions.service.spec.ts) / [agentos.controller.spec.ts](server/src/agentos/agentos.controller.spec.ts):更新/新增用例。

**agent-ui**:
- [src/types/os.ts](agent-ui/src/types/os.ts):`ChatMessage` 加 `id`/`langGraphId`/`isError`。
- [src/store.ts](agent-ui/src/store.ts):迁入 `inputMessage` + `setChatInput`。
- [src/components/chat/ChatArea/ChatInput/ChatInput.tsx](agent-ui/src/components/chat/ChatArea/ChatInput/ChatInput.tsx):读 store 的 input。
- [src/hooks/useAIStreamHandler.tsx](agent-ui/src/hooks/useAIStreamHandler.tsx):`RunStarted` 回填 id;删 `slice(0,-2)`;错误态保留消息。
- [src/hooks/useSessionLoader.tsx](agent-ui/src/hooks/useSessionLoader.tsx) + [src/components/workspace/ChatPanel.tsx](agent-ui/src/components/workspace/ChatPanel.tsx):历史加载透传 `id`/`isError`。
- [src/components/chat/ChatArea/Messages/MessageItem.tsx](agent-ui/src/components/chat/ChatArea/Messages/MessageItem.tsx):`AgentMessage` 红字条件;`UserMessage` 加撤回按钮 + 二次确认。
- [src/api/routes.ts](agent-ui/src/api/routes.ts) + [src/api/os.ts](agent-ui/src/api/os.ts):`RecallSession` 路由 + client。
