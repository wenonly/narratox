# narratox 多 Agent 结算与一致性 — 设计文档(v0.5.0)

- 日期:2026-06-18
- 状态:v2(spike 后异步化重订),待 review
- 范围:在工作台写作流里引入**分析者(Analyst)**——一个**非用户面向**的后台结算 Agent。`write_chapter` 落稿成功后,Analyst **异步**提取本章四类事实(摘要 / 角色变化 / 伏笔 / 物品·地点·设定),写进新表(`ChapterSummary` + `StoryEvent`);写作流不阻塞、照常 `RunCompleted`。记忆由前端**轮询** `GET /novels/:id/chapters/:order/summary` 从 DB 重建,以「记忆气泡」反馈给用户;再通过 ContextAssembler 注入 + `query_memory` 工具帮 Writer「记住」前面,闭合长篇创作的「创作-结算-记忆」环。
- v1→v2 变更(spike 驱动):① 结构化输出 **必须 pin `method:'functionCalling'`**(默认 method 挂死 5 分钟);② 串行 → **异步 fire-and-forget**(spike 实测单次 ~16-32s);③ 砍掉 `Settling`/`MemoryUpdated`/`MemorySkip` 流帧 + `pendingMemory` 时序,改轮询 + DB 重建。
- 前置:v0.4.0(统一 swarm + 信息卡 + ChapterPreview + WritingChapter 信号)已完成。

---

## 1. 背景与目标

随着篇幅增加,单 Agent 难以在写正文的同时记住数章前的伏笔、角色状态、世界观细节。借鉴 `inkos` 的方法论,把**创意生成(Writer)**与**一致性记账(Analyst)**分离。

**核心目标**:
1. **自动记账**——每轮写作后自动提取本章摘要、角色状态变化、伏笔、物品/设定,落库。
2. **作者感知**——让用户直观看到「这轮 AI 记住了什么」(消息下方记忆气泡)。
3. **反哺写作**——把记账结果注入 Writer 上下文 + 提供 `query_memory` 工具,让 Writer 写后面章节时「记得」前面。

**非用户面向**是关键边界:Analyst 不和用户对话,不在 Swarm 的 handoff 图里;用户永远只和 main/writer 聊天。

---

## 2. 角色边界:Analyst 不进 Swarm handoff 图

当前 Swarm:`main`(路由 + 立项)⇄ `writer`(写正文),靠 `transfer_to_writer` / `transfer_to_main` 转交。

**Analyst 不参与这条转交链**——它没有 `transfer_*`,用户永远不直接对话它。它是 `WorkspaceSwarmService.streamTurn` 在**侦测到 `write_chapter` 成功落稿后**,直接调用的一个独立服务(`AnalystService`)。

为什么分离:Swarm 的 handoff 是为「用户面向的专家转交」设计的;Analyst 是「写完后的后台记账」,塞进 Swarm 会让 activeAgent 在 writer→analyst→main 乱跳,且它的结构化 JSON 输出不该混进用户聊天消息流。分离 = clean。

### 2.1 触发与通知(异步)

```
用户消息 → main(可能 transfer)→ writer(流式正文 + write_chapter 落稿)
                                    │
                              [侦测 write_chapter 的 ToolMessage 返回 ok]
                                    ↓
                      void analyst.settle(...)  ← fire-and-forget,不 await(后台跑 16-32s)
                                    ↓
                              RunCompleted(主流立即结束,用户可继续)
                                    ↓ (后台,与用户并行)
                              Analyst 提取 4 类事实 → 写 ChapterSummary / StoryEvent
                                    ↓ (前端轮询)
                              GET /novels/:id/chapters/:order/summary → settled:true
                                    ↓
                              消息下方渲染记忆气泡
```

**触发点是 `write_chapter` 落稿成功,不是「流结束」**——非写作轮(纯聊天、立项)不该触发结算。**结算异步,不阻塞主流**(spike 实测单次 ~16-32s,串行不可接受)。

---

## 3. 数据模型(新表,Prisma `public` schema)

### 3.1 `ChapterSummary`(1:1 于 Chapter,本章事实)

```prisma
model ChapterSummary {
  id          String   @id @default(cuid())
  chapterId   String   @unique
  chapter     Chapter  @relation(fields: [chapterId], references: [id], onDelete: Cascade)
  novelId     String
  summary     String   @default("")   // 本章一句话情节摘要
  roleChanges Json     @default("[]") // [{name, change}] 角色状态变化
  entities    Json     @default("[]") // [{type:'item'|'place'|'setting', name, note}]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @default(now())

  @@index([novelId])
}

model Chapter {
  // ...既有字段
  summary ChapterSummary?
}
```

- 重写章节(`write_chapter op=set`)后再结算 → **覆盖**(upsert),不追加。
- `novelId` 冗余,方便按小说查(避免 join)。

### 3.2 `StoryEvent`(伏笔账本,跨章)

```prisma
model StoryEvent {
  id               String      @id @default(cuid())
  novelId          String
  novel            Novel       @relation(fields: [novelId], references: [id], onDelete: Cascade)
  description      String                     // "黑影的身份之谜"
  status           EventStatus @default(OPEN)
  openedAtChapter  Int?                       // 第几章埋的
  resolvedAtChapter Int?                      // 第几章回收的
  createdAt        DateTime    @default(now())
  updatedAt        DateTime    @default(now())

  @@index([novelId, status])
}

enum EventStatus {
  OPEN
  RESOLVED
}

model Novel {
  // ...既有字段
  events StoryEvent[]
}
```

- **数据生命周期管理(回滚)**: 如果用户删除了某章,其对应的 `ChapterSummary` 随 `Chapter` 级联删除。对于 `StoryEvent`,在删除章节时,需异步触发一个清理逻辑:将 `openedAtChapter` 等于该章 order 的事件删除;将 `resolvedAtChapter` 等于该章 order 的事件重置为 `OPEN` 并清空 `resolvedAtChapter`。
- **重写处理**: 重写章节(op=set)会导致 Analyst 重新识别。为减少重复,Analyst 的输入中包含本章已有的 Summary/Hooks 参考(如果有),让其判断是否是已存在但被改写的伏笔。
- 同一伏笔重复埋下 → Analyst 只新建一条(不去重,P3 再加去重/合并)。
- **回收检测**:Analyst 输入里带「当前 OPEN 伏笔列表(含 id)」,它直接回 `resolvedHookIds`(见 §4.3)。服务端按 id 把对应事件翻 `RESOLVED` + 填 `resolvedAtChapter`。**不做 description 模糊匹配**——id 由 LLM 直接回,省掉不确定性。

---

## 4. Analyst Agent 与提取流程

### 4.1 Analyst 是什么

`server/src/agentos/analyst.service.ts`——独立服务。

- 单独的 `ChatOpenAI` 实例,**`temperature: 0.1`**。
- **必须显式 `withStructuredOutput(schema, { method: 'functionCalling' })`**。spike(`server/scripts/spike-analyst-structured.ts`)实测:在 z.ai coding 端点上,**默认 method 会挂死 5 分钟才超时**;`jsonSchema` 被 GLM 用 ```json 围栏包裹导致解析失败;`jsonMode` 下 GLM 自造了不同结构;**只有 `functionCalling` 稳定返回 schema 合规结果**(~16s)。不写 method = 雷。
- **不走 agent 循环**——一次结构化提取就够,少一层不确定性。
- 实例按 `userId` 缓存(无 novel 专属 prompt,不按 novel 缓存)。
- 沿用 swarm 的 `as never` 双包边界模式。
- **并发控制(任务锁)**: 同一本小说同一时间只允许一个结算任务。在 `settle` 开始时检查内存中的 `settlingNovels: Set<string>`,避免并发写入导致的 DB 冲突。

### 4.2 输入(Context)

只喂必要 context(不喂整本聊天史——贵且无关):

1. **本轮落稿的章节正文**(`ChapterService.findByOrder(novelId, chapterOrder).content`)。
2. **小说设定**(title/genre/synopsis/worldview/style,`NovelService.get`)——帮它理解「这是个什么故事」。
3. **当前 OPEN 的伏笔列表**(`StoryEvent where status=OPEN`,含 id + description)——让它判断「本章是否回收了某个已有伏笔」。

### 4.3 输出(structured output,zod)

```ts
const analystSchema = z.object({
  summary: z.string().describe('本章一句话情节摘要'),
  roleChanges: z.array(z.object({
    name: z.string(),
    change: z.string().describe('状态变化,如「觉醒剑修天赋」「受重伤」'),
  })),
  entities: z.array(z.object({
    type: z.enum(['item', 'place', 'setting']),
    name: z.string(),
    note: z.string().describe('一句话说明'),
  })),
  newHooks: z.array(z.string().describe('本章新埋下的伏笔描述')),
  resolvedHookIds: z.array(z.string().describe('从输入的 OPEN 伏笔列表里,本章回收了的 id')),
});
```

### 4.4 落库(走 service,**不走 mutation 层**)

拿到结构化结果后,服务端直接写:

- `ChapterSummary`:`upsert({chapterId, novelId, summary, roleChanges, entities})`。
- `StoryEvent`:`newHooks` 每条 `create({novelId, description, status:'OPEN', openedAtChapter:本章order})`;`resolvedHookIds` 每条 `update → {status:'RESOLVED', resolvedAtChapter:本章order}`。

**为什么不走 mutation 层**:mutation 层的 `ResourceHandler` 抽象是「chat/工具触发的资源写入」(给「资源面板」用);Analyst 是内部自动流水线,硬塞 handler 反而绕。新表直接配 `SummaryService` + `StoryEventService`(userId 闭包隔离)。

### 4.5 服务签名(异步,fire-and-forget)

```ts
class AnalystService {
  async settle({ userId, novelId, chapterOrder }: {
    userId: string; novelId: string; chapterOrder: number;
  }): Promise<void> {
    // 1. 取本章正文(ChapterService.findByOrder)
    // 2. 取小说设定(NovelService.get)
    // 3. 取 OPEN 伏笔(StoryEventService.listOpen)
    // 4. withStructuredOutput(analystSchema, { method:'functionCalling' }).invoke(...)
    // 5. 落库(SummaryService.upsert + StoryEventService.create/resolve)
    // 不返回数据 —— 记忆由前端轮询 GET 端点从 DB 重建(单一真相源)。
  }
}
```

`settle` **返回 `void`**(不返回数据)。调用方(streamTurn)fire-and-forget 触发它,**不 await**(见 §5)。失败在 `settle` 内部 try/catch + log,绝不抛回调用方(写作流不受影响)。

只读 + 写新表,**不改 Chapter.content**(那是 Writer 的事)。

### 4.6 记忆的数据形状(由 GET 端点从 DB 重建)

前端通过 `GET /novels/:id/chapters/:order/summary` 拿到的 `MemoryData`(从 DB 组装,非流帧):

```ts
interface MemoryData {
  settled: boolean;           // false=还没结算(前端继续轮询),true=可展示
  chapterOrder: number;
  summary: string;
  roleChanges: { name: string; change: string }[];
  entities: { type: 'item'|'place'|'setting'; name: string; note: string }[];
  newHooks: { id: string; description: string }[];   // StoryEvent openedAtChapter=N
  resolvedHooks: { id: string; description: string }[]; // resolvedAtChapter=N
}
```

> 与 v1 的区别:hooks 不再由 LLM 单次返回里带,而是从 DB 重建(`StoryEvent` 表是真相源)——这样数据可被未来「用户纠错」端点直接改 DB,无需重跑 LLM。

---

## 5. 触发与通知(异步 fire-and-forget + 轮询)

> **v2(spike 后):异步,不阻塞主流。** spike 实测单次结构化提取 **~16-32s**(GLM-5.2 推理模型)。串行会让每轮写作后卡死用户十几秒——不可接受。改为:写作流照常 `RunCompleted` 结束、用户立刻可继续;Analyst 后台跑,跑完后前端轮询取回。记忆落 DB,DB 是唯一真相源——**无需任何 `MemoryUpdated` 流帧,也无需 `pendingMemory` 时序竞态**(v1 的过度设计,已删)。

### 5.1 触发点(write_chapter 落稿成功 → fire-and-forget 触发结算)

当前 `streamTurn` 遍历 swarm 流时,已在侦测 `write_chapter` 的 **AIMessage tool_call** 用来 yield `WritingChapter`。

**但 tool_call ≠ 落稿成功。** tool_call 是「Writer 决定要写」,实际落库在 tool 执行阶段,可能失败。

**改造**:`makeWriteChapterTool` 返回值从 `{ok, message}` 扩成 `{ok, chapterOrder, chapterId}`。`streamTurn` 改为侦测 `write_chapter` 的 **ToolMessage(工具返回结果)**——`ok:true` 时记下 `settledChapterOrder = N`。正文流**遍历完后**,若 `settledChapterOrder != null`:

```ts
// 不 await,不阻塞 —— settle 内部 try/catch,绝不抛出。
void this.analyst.settle({ userId, novelId, chapterOrder: N }).catch((e) =>
  console.error('[agentos] analyst settle failed:', e),
);
```

→ `streamTurn` 立刻返回,controller 照常发 `RunCompleted`、关闭响应。**写作流对结算零感知、零延迟。**

### 5.2 取回(GET 端点,从 DB 重建)

`GET /novels/:id/chapters/:order/summary`(NovelController)→ 组装 §4.6 的 `MemoryData`:
- 查 `ChapterSummary`(by chapterId via order)→ `summary` / `roleChanges` / `entities`;无 → `settled:false`。
- 查 `StoryEvent` where `openedAtChapter = N` → `newHooks`;where `resolvedAtChapter = N` → `resolvedHooks`。
- 归属校验(novel 属 user)。

### 5.3 前端轮询

`RunCompleted` 后,若本轮有过 `WritingChapter{order:N}`(写作轮),前端启动轮询:
- 每 ~4s 调 `GET /novels/:id/chapters/:order/summary`,直到 `settled:true` 或超时(~60s)。
- 轮询期间,在该 agent 消息下方显示轻量「🧠 结算中…」占位(不禁用输入框——这是与 v1 的关键区别)。
- 拿到 `settled:true` → 停轮询,把 `MemoryData` 挂到该消息的 `memory` 字段,渲染记忆气泡。
- 超时未结算 → 占位淡出(下次刷新或下轮可续;记忆仍在 DB,不丢)。

### 5.4 失败处理

Analyst 失败(超时/输出不合法/落库错)→ `settle` 内部 try/catch + log,**不抛出**。DB 里该章 `ChapterSummary` 永远不存在 → 前端轮询超时 → 占位淡出。结算失败 ≠ 写作失败——正文已落库,用户无感知(只是没有记忆气泡)。

## 6. 反馈写作(ContextAssembler 注入 + query_memory)

### 6.1 ContextAssembler 注入(被动记忆)

`forSession` 组 Writer prompt 时,在文风之后、状态指令之前,**额外注入三个 slice**:

1. **近期章节摘要**:`ChapterSummary` 取最近 5 章的 `summary`,拼「【前情】第1章:… / 第2章:…」。
2. **OPEN 伏笔**:`StoryEvent where status=OPEN` 全取(通常不多),拼「【未回收伏笔】· 黑影身份 · 银色钥匙的来历」。
3. **上一章文风锚点**: 注入上一章最后 1000 字正文。**理由**: 摘要损失了文感,显式注入末尾正文能帮 Writer 接住上一章的语气和节奏。

`forSession` 签名不变(`{prompt, novelId}`),内部多两次轻量查询(均按 novelId 索引,快)。

### 6.2 query_memory 工具(主动查)

给 **Writer Agent** 加一个读工具:

```ts
// makeQueryMemoryTool({ userId, novelId, summaries, events })
query_memory({ query: '陈平安', kind?: 'role'|'hook'|'entity'|'summary' })
  → 相关记忆(角色出现章节 / 相关伏笔 / 相关物品)
```

- 实现:keyword 在 `roleChanges.name` / `entities.name` / `StoryEvent.description` / `ChapterSummary.summary` 里 Prisma `contains` 模糊匹配(mode insensitive)。P2 不做向量检索。
- Writer 的 prompt 加一句:「写涉及已有角色/伏笔的章节时,先用 query_memory 核实再写。」

### 6.3 为什么两个都要

- **注入** = 被动、稳定、每轮都在(近期 5 章 + OPEN 伏笔),覆盖 80%。
- **query_memory** = 主动、按需,覆盖「突然查具体角色/伏笔」的 20%。

### 6.4 范围控制

- 注入只取近期 **5 章** + 全部 OPEN 伏笔(不加全部历史,省 token)。
- `query_memory` 只做关键词(P3 再加语义)。
- **不做**冲突检测/一致性审计(那是 v0.5.0 §10 的 Auditor,P3)。

---

## 7. 前端(轮询取回 + 消息下方「记忆」气泡)

### 7.1 API 客户端 + 类型

`src/types/os.ts`:`MemoryData`(对应 §4.6)。
`src/api/novels.ts`:`getChapterMemory(endpoint, token, novelId, order): Promise<MemoryData>` → `GET /novels/:id/chapters/:order/summary`。

### 7.2 轮询 hook(写作轮后启动)

新 hook `useChapterMemory(novelId, order, active: boolean)`:
- `active` 在「本轮是写作轮」(`writingChapterOrder` 非空)且 `RunCompleted` 后为 true。
- 每 4s 调 `getChapterMemory`,直到 `settled:true` 或 ~60s 超时;组件卸载/换章时清理 timer。
- 本地状态 `{ status: 'idle'|'polling'|'settled'|'timeout', memory }`。

轮询期间在对应 agent 消息下显示「🧠 结算中…」占位(**不禁用输入框**)。`settled` 后把 `memory` 写进该消息的 `memory` 字段(由工作台页透传:它知道本轮 agent 消息 index)。

### 7.3 「记忆」气泡组件

`MemoryBubble`(可折叠):默认折叠,一行概览「🧠 已记忆:摘要·1 · 变化N · 设定M · 伏笔K」;展开看四类分组(summary / roleChanges / entities / newHooks + resolvedHooks)。暗色弱化(text-muted、小字、brand 左边框)。

- **失败补偿**: 如果轮询超时(~60s)或后端返回 `settled:false` 且已停止,在占位符处显示一个「🧠 重新结算」按钮,允许用户手动触发 `AnalystService.settle`。

```
┌ agent 消息(正文)──────────┐
│  陈平安拔剑出鞘…            │
└──────────────────────────┘
┌ 🧠 本章记忆 ▾(点击展开)──┐
│ 摘要:陈平安觉醒剑修,立誓…  │
│ 角色变化:陈平安·觉醒剑修    │
│ 物品/设定:剑灵·觉醒形态     │
│ 伏笔:🆕 黑影身份 · ✅…      │
└──────────────────────────┘
```

### 7.4 不做的 UI

- **不动 ChatInput**(不禁用输入、不加状态条)——异步,用户可继续打字。
- 不动 ResourcePanel(📊状态面板的完整账本视图留 P3)。
- 不加 toast。

---

## 8. 范围(v0.5.0)与非目标

**做**:
- Analyst 独立服务(低温 0.1,**`withStructuredOutput(method:'functionCalling')`**,不走 agent 循环)。
- `write_chapter` 落稿成功后**异步 fire-and-forget 触发**(ToolMessage 侦测)。
- 新表:`ChapterSummary` + `StoryEvent`(+ migration)。
- 四类事实提取(摘要/角色变化/伏笔/物品·地点·设定)。
- `GET /novels/:id/chapters/:order/summary` 端点(从 DB 重建 MemoryData)。
- ContextAssembler 注入(近期5章摘要 + OPEN 伏笔)+ Writer `query_memory` 工具。
- 前端:轮询 hook + 记忆气泡(可折叠)+ 「结算中」占位(**不禁用输入**)。

**不做(非目标)**:
- Analyst 进 Swarm handoff 图(明确不进)。
- Analyst 走 mutation 层(明确走 service)。
- 流内的 Settling/MemoryUpdated/MemorySkip 帧(v2 改异步轮询,已删——无需 pendingMemory 时序)。
- 资源面板(📊)的完整账本视图 + 记忆纠错 UI(P3;但 GET 端点 + DB 形状已为纠错预留)。
- 伏笔去重/合并(P3)。
- 向量/语义检索(P3)。
- 冲突检测/Auditor Agent(P3)。

---

## 9. 风险

- **延迟(spike 已量化)**:单次结构化提取 ~16-32s(GLM-5.2 推理模型)。**异步**规避了阻塞主流;记忆气泡在写完后 ~16-32s 出现,靠「结算中」占位 + 最终气泡的「迟到到达」体感可接受。若未来要更快:P3 换更小/更快的模型专门跑 Analyst,或减少提取维度。
- **结构化输出兼容性(spike 已排雷)**:**必须 pin `method:'functionCalling'`**。默认 method 在 z.ai coding 端点会挂死 5 分钟。此约束已写进 AnalystService。
- **错误事实污染后续写作**(未解,接受):Analyst 提取错的事实 → 存 DB → 注入 ContextAssembler → Writer 据错事实续写,腐蚀连续性。本期无用户纠错 UI(P3)。缓解:低温 0.1 + 「只从给定 id 挑回收」约束降低幻觉;记忆气泡让用户至少能**看到**被记了什么(发现明显错误时可手动调整写作方向)。真正的纠错/审计留 P3(GET 端点 + DB 形状已预留)。
- **四类全提取让 Analyst 偏重**:structured output 强制 schema + 低温保证稳定;失败静默(§5.4,无记忆气泡,不阻塞)。
- **resolvedHookIds 依赖 LLM 正确回 id**:OPEN 伏笔列表(含 id+description)喂给它,让它从列表里挑回收的 id。仍可能漏判/误判——P2 接受,不阻塞写作;P3 加 Auditor 复核。

---

## 10. 后续扩展(P3)

- 📊 状态面板:ChapterSummary + StoryEvent 的完整可浏览/可编辑账本(走 mutation 层 'summary'/'event' handler)。
- 伏笔去重/合并(同义伏笔检测)。
- 向量/语义 `query_memory`。
- `Auditor` Agent:跨章一致性冲突检测(读账本 vs 新正文,标冲突)。
- 真放投影:从 JSON 账本生成 Markdown 资源文档供用户编辑。

---

## 11. 参考

- inkos 方法论(创意生成 vs 事实记账分离):[docs/references/inkos-workflow-reference.md](../../references/inkos-workflow-reference.md)。
- webnovel-writer 一致性方法论:[docs/references/webnovel-writer-workflow-reference.md](../../references/webnovel-writer-workflow-reference.md)。
- v0.4.0 spec/plan(统一 swarm + WritingChapter 信号基础)。
