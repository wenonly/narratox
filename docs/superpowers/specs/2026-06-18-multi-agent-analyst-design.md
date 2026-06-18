# narratox 多 Agent 结算与一致性 — 设计文档(v0.5.0)

- 日期:2026-06-18
- 状态:已与用户确认(6 段逐一 approved),待 review
- 范围:在工作台写作流里引入**分析者(Analyst)**——一个**非用户面向**的后台结算 Agent。每次 `write_chapter` 落稿成功后,Analyst 自动提取本章四类事实(摘要 / 角色变化 / 伏笔 / 物品·地点·设定),写进新表(`ChapterSummary` + `StoryEvent`),并通过 `MemoryUpdated` 信号帧在聊天里以「记忆气泡」反馈给用户;反过来再通过 ContextAssembler 注入 + `query_memory` 工具帮 Writer「记住」前面发生过什么,闭合长篇创作的「创作-结算-记忆」环。
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

### 2.1 流里的位置

```
用户消息 → main(可能 transfer)→ writer(流式正文 + write_chapter 落稿)
                                    │
                              [侦测 write_chapter 的 ToolMessage 返回 ok]
                                    ↓
                              yield Settling(前端「结算中…」)
                              AnalystService.settle(...)  (低温0.1,读本轮正文 → 提取4类事实 → 写表)
                                    ↓
                              yield MemoryUpdated(本轮事实)
                                    ↓
                              RunCompleted
```

**触发点是 `write_chapter` 落稿成功,不是「流结束」**——非写作轮(纯聊天、立项)不该触发结算。

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

- 同一伏笔重复埋下 → Analyst 只新建一条(不去重,P3 再加去重/合并)。
- **回收检测**:Analyst 输入里带「当前 OPEN 伏笔列表(含 id)」,它直接回 `resolvedHookIds`(见 §4.3)。服务端按 id 把对应事件翻 `RESOLVED` + 填 `resolvedAtChapter`。**不做 description 模糊匹配**——id 由 LLM 直接回,省掉不确定性。

---

## 4. Analyst Agent 与提取流程

### 4.1 Analyst 是什么

`server/src/agentos/analyst.service.ts`——独立服务。

- 单独的 `ChatOpenAI` 实例,**`temperature: 0.1`**。
- **直接 `model.invoke`(structured output)拿 JSON,不走 agent 循环**——Analyst 不需要「思考-工具-再思考」的循环,一次结构化提取就够,少一层不确定性。
- 实例按 `userId` 缓存(无 novel 专属 prompt,不按 novel 缓存)。
- 沿用 swarm 的 `as never` 双包边界模式。

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

### 4.5 服务签名

```ts
class AnalystService {
  async settle({ userId, novelId, chapterOrder }: {
    userId: string; novelId: string; chapterOrder: number;
  }): Promise<MemoryUpdated> {
    // 1. 取本章正文(ChapterService.findByOrder)
    // 2. 取小说设定(NovelService.get)
    // 3. 取 OPEN 伏笔(StoryEventService.listOpen)
    // 4. model.invoke(structured) → analystSchema
    // 5. 落库(SummaryService.upsert + StoryEventService.create/resolve)
    // 6. 返回 MemoryUpdated(给 controller yield)
  }
}
```

只读 + 写新表,**不改 Chapter.content**(那是 Writer 的事)。

### 4.6 返回的 MemoryUpdated

```ts
interface MemoryUpdated {
  type: 'memory-updated';
  data: {
    chapterOrder: number;
    summary: string;
    roleChanges: { name: string; change: string }[];
    entities: { type: 'item'|'place'|'setting'; name: string; note: string }[];
    newHooks: string[];
    resolvedHooks: { id: string; description: string }[]; // 回填 description 给前端展示
  }
}
```

---

## 5. 流的接入(streamTurn + 信号帧)

### 5.1 触发点改造

当前 `streamTurn` 遍历 swarm 流时,已在侦测 `write_chapter` 的 **AIMessage tool_call** 用来 yield `WritingChapter`([workspace-swarm.service.ts:171-180](server/src/agentos/workspace-swarm.service.ts#L171-L180))。

**但 tool_call ≠ 落稿成功。** tool_call 是「Writer 决定要写」,实际落库在 tool 执行阶段,可能失败。

**改造**:`makeWriteChapterTool` 返回值从 `{ok, message}` 扩成 `{ok, chapterOrder, chapterId}`。`streamTurn` 改为侦测 `write_chapter` 的 **ToolMessage(工具返回结果)**——`ok:true` 时记下 `settledChapterOrder = N`。

```
遍历 swarm 流:
  - AIMessage 带 write_chapter tool_call → yield WritingChapter(前端骨架)
  - ToolMessage(write_chapter 返回 ok:true) → settledChapterOrder = N
正文流结束 →
  若 settledChapterOrder != null:
      yield { type:'settling' }            // 前端「结算中…」
      try { memory = await analyst.settle({userId, novelId, chapterOrder:N}) }
      catch { yield {type:'memory-skip'}; memory = null }
      if memory: yield memory              // {type:'memory-updated', data}
  → controller 继续 RunCompleted
```

### 5.2 失败处理

Analyst 失败(超时/输出不合法/落库错)→ **不中断主流**。`settle` 包 try/catch,失败 yield `{type:'memory-skip'}`(前端静默清除「结算中」态),然后正常 `RunCompleted`。结算失败 ≠ 写作失败——正文已落库,不能因记账挂了让用户看到错误。

### 5.3 三个新信号帧

| 帧 | 触发 | 前端处理 |
|---|---|---|
| `Settling` | 正文流结束 + 本轮有 `write_chapter` 成功 | `store.isSettling=true`;状态条「结算中…」;ChatInput 禁用 |
| `MemoryUpdated` | Analyst 落库成功 | `store.isSettling=false`;**暂存** `data` 到 `store.pendingMemory`(见下方时序) |
| `MemorySkip` | Analyst 失败 | `store.isSettling=false`(静默) |

**时序(关键)**:`MemoryUpdated` 在 `RunCompleted` **之前**到达,而 `useAIStreamHandler` 当前是在 `RunCompleted` 时才把正文 `finalize` 进 agent 消息——也就是说 `MemoryUpdated` 到达时那条 agent 消息可能尚未建好。因此 `MemoryUpdated` 不直接改消息,而是把 `data` 暂存到 `store.pendingMemory`;`RunCompleted` 处理时把 `pendingMemory` 一并写进「即将 `finalize` 的 agent 消息」的 `memory` 字段,然后清空 `pendingMemory`。

---

## 6. 反馈写作(ContextAssembler 注入 + query_memory)

### 6.1 ContextAssembler 注入(被动记忆)

`forSession` 组 Writer prompt 时,在文风之后、状态指令之前,**额外注入两个 slice**:

1. **近期章节摘要**:`ChapterSummary` 取最近 5 章的 `summary`,拼「【前情】第1章:… / 第2章:…」。
2. **OPEN 伏笔**:`StoryEvent where status=OPEN` 全取(通常不多),拼「【未回收伏笔】· 黑影身份 · 银色钥匙的来历」。

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

## 7. 前端(消息下方「记忆」气泡)

### 7.1 信号帧处理(useAIStreamHandler)

加三个事件分支(对应 §5.3):`Settling` → `isSettling=true`;`MemoryUpdated` → `isSettling=false` + 暂存 `store.pendingMemory`;`MemorySkip` → `isSettling=false`。

**消息结构扩展**:`ChatMessage` 加 `memory?: MemoryUpdatedData`。`MemoryUpdated` 不直接改消息(时序见 §5.3)——暂存到 `store.pendingMemory`,由 `RunCompleted` 处理时写进「即将 finalize 的 agent 消息」的 `memory` 并清空 `pendingMemory`。

### 7.2 「记忆」气泡组件

`MessageArea` 里 agent 消息:若 `message.memory` 存在,在气泡下方渲染可折叠记忆气泡(默认折叠,一行概览「🧠 已记忆:摘要 + N 项变化 + M 个伏笔」;展开看四类分组:roleChanges / entities / newHooks + resolvedHooks)。

折叠/展开切换;暗色主题,比正文气泡更弱(text-muted、小字、brand 左边框轻提示)。

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

### 7.3 状态条(ChatInput 区)

`Settling` 期间,ChatInput 上方显示「🧠 AI 正在结算本章记忆…」+ 输入禁用。`MemoryUpdated`/`MemorySkip` 后清除。和 `isStreaming` 一样走 store。

### 7.4 不做的 UI

- 不动 ResourcePanel(📊状态面板的完整账本视图留 P3;本期账本通过记忆气泡 + 直接查库验证)。
- 不加 toast(选了消息气泡,不再加噪音)。

---

## 8. 范围(v0.5.0)与非目标

**做**:
- Analyst 独立服务(低温 0.1,structured output,不走 agent 循环)。
- `write_chapter` 落稿成功后串行触发(ToolMessage 侦测)。
- 新表:`ChapterSummary` + `StoryEvent`(+ migration)。
- 四类事实提取(摘要/角色变化/伏笔/物品·地点·设定)。
- 三个信号帧:Settling / MemoryUpdated / MemorySkip。
- ContextAssembler 注入(近期5章摘要 + OPEN 伏笔)+ Writer `query_memory` 工具。
- 前端:记忆气泡(可折叠)+ Settling 状态条 + ChatInput 禁用。

**不做(非目标)**:
- Analyst 进 Swarm handoff 图(明确不进)。
- Analyst 走 mutation 层(明确走 service)。
- 资源面板(📊)的完整账本视图(P3)。
- 伏笔去重/合并(P3)。
- 向量/语义检索(P3)。
- 冲突检测/Auditor Agent(P3)。

---

## 9. 风险

- **串行结算的延迟感知**:低温 0.1 + 单次 invoke 约 2-5s。靠 `Settling` 帧 + 状态条管住感知,输入禁用避免用户在结算中误触下一轮。
- **四类全提取让 Analyst 偏重**:用 structured output 强制 schema + 低温保证稳定;失败静默降级(§5.2)。
- **resolvedHookIds 依赖 LLM 正确回 id**:OPEN 伏笔列表(含 id+description)喂给它,让它从列表里挑回收的 id。仍可能漏判/误判——P2 接受,不阻塞写作;P3 加 Auditor 复核。
- **回填伏笔 description**:服务端按 resolvedHookIds 回查 description 拼进 `MemoryUpdated.resolvedHooks`,前端才能展示「✅ 回收了 X」。

---

## 10. 后续扩展(P3)

- 📊 状态面板:ChapterSummary + StoryEvent 的完整可浏览/可编辑账本(走 mutation 层 'summary'/'event' handler)。
- 伏笔去重/合并(同义伏笔检测)。
- 向量/语义 `query_memory`。
- `Auditor` Agent:跨章一致性冲突检测(读账本 vs 新正文,标冲突)。
- 真相投影:从 JSON 账本生成 Markdown 资源文档供用户编辑。

---

## 11. 参考

- inkos 方法论(创意生成 vs 事实记账分离):[docs/references/inkos-workflow-reference.md](../../references/inkos-workflow-reference.md)。
- webnovel-writer 一致性方法论:[docs/references/webnovel-writer-workflow-reference.md](../../references/webnovel-writer-workflow-reference.md)。
- v0.4.0 spec/plan(统一 swarm + WritingChapter 信号基础)。
