---
date: 2026-07-14
title: 小说 agent 过程记忆(per-novel,main 维护,常驻注入,整段重写压缩)
status: draft
---

# 小说 agent 过程记忆 — 设计

## 背景

narratox 现有四套记忆,但都是**故事事实(canon)**层:

| 层 | 存储 | 内容 |
|----|------|------|
| LangGraph checkpointer | `agent_memory` schema | 同线程对话历史(短期) |
| deepagents summarization | 线程内 StateBackend | 老消息压缩(中期) |
| ChapterSummary / StoryEvent / Event | Prisma `public` | 摘要/伏笔/事件(长期 canon) |
| SessionsService Message | Prisma `public` | UI transcript(纯展示) |

**缺口**:没有"过程记忆"——写作中沉淀的**经验、决策、本书规矩**无处可放。例如:
- "本书读者偏好短章快节奏,第 8 章后调整了节奏反馈变好"
- "试过多线叙事在此书水土不服,改回单线"
- "作者要求:本书不用第一人称、反派不洗白"

这些不是故事 canon(不在 ChapterSummary/Event 里),不是对话历史(会被 summarization 压掉),不是静态全局规则(每本书不同)。结果:跨会话、跨轮次 main 反复踩同样的坑、忘记用户给过的写作指令。

## 目标

1. 给 main agent 加一份**per-novel 过程记忆**:经验/决策/本书规矩
2. main **每轮结束前**调用工具更新它(对齐 settler 必调 `write_summary` 的软强制模式)
3. 记忆**常驻注入** main systemPrompt(每轮都看见,不靠召回)
4. 记忆**有界**:靠 main 整段重写时压缩,服务端兜底截断
5. **单表、单工具、零新中间件**——复刻现有 `write_summary` 模式的轻量版

## 非目标

- 不做向量检索 / 语义召回(常驻注入,无需 search;CLAUDE.md "向量检索(千章级)" deferred 项不动)
- 不用 deepagents `StoreBackend` / `createMemoryMiddleware`(常驻全量注入场景下语义 search 收益为零,且引入 Store 表 + embedding 依赖 + 与 Prisma 模式不一致)
- 不给子 agent(chapter/writer/settler/validator/curator)注入或挂工具——过程记忆是 main 的编排笔记本;子 agent 需要的信息由 main 在 task 委派时显式传达
- 不做跨小说的用户级全局记忆(本期 per-novel;用户偏好跨书共享是后续优化)
- 不动 FE(本期纯后端;FE 展示记忆是后续)

## 架构

### 数据流

```
每轮 runTurn:
  ContextAssembler.forSession
    → 读 NovelProcessMemory(novelId)
    → 拼【本书过程记忆】slice → 注入 main systemPrompt
  main 跑编排/对话(看得到注入的记忆)
  main 结束前调 update_memory(只传变化的段)
    → ProcessMemoryService.upsert(userId, novelId, partial)
    → merge + 截断兜底 → 写 NovelProcessMemory 行
下轮 → ContextAssembler 再读 → 注入更新后的记忆
```

### 压缩的关键洞察

`update_memory` 是**整段重写**(main 传完整新内容,不是 append delta)。main 每轮通过注入看到当前三段完整内容,所以压缩发生在 main 的推理里——把"现有内容 + 本轮新增"合并/去重/提炼后,传压缩后的完整新版本。**零额外 LLM 调用**,服务端不做压缩,只做兜底截断。

## 数据模型

### Prisma(`server/prisma/schema.prisma`)

```prisma
model NovelProcessMemory {
  novelId    String   @id @unique
  novel      Novel    @relation(fields: [novelId], references: [id], onDelete: Cascade)
  rules      String   @default("")   // 【本书规矩】markdown
  lessons    String   @default("")   // 【经验教训】markdown
  decisions  String   @default("")   // 【近期决策】markdown,main 维护成 ≤10 条
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([novelId])
}
```

- 一行一小说,`novelId` 同时是 PK 和 FK(无独立 id,1:1 关系)
- `onDelete: Cascade`——删小说自动清记忆
- 三段都是 `String`(markdown),非 Json——"部分更新"粒度是**段**,段内由 main 整段重写,服务端不解析

`Novel` model 加反向关系:`processMemory  NovelProcessMemory?`

迁移:`prisma migrate dev` 后**手动 `pnpm --dir server prisma generate`**(Prisma 7 不自动 regenerate client —— 见 memory `prisma7-generate-gotcha.md`)。

## 写入路径

### 工具 `update_memory`

文件:`server/src/agentos/tools/update-memory.tool.ts`(新建)

```ts
schema: z.object({
  rules:     z.string().optional().describe('【本书规矩】完整新内容(仅当本轮有变化才传)'),
  lessons:   z.string().optional().describe('【经验教训】完整新内容'),
  decisions: z.string().optional().describe('【近期决策】完整新内容,保持≤10条'),
})
```

- `userId` / `novelId` **闭包注入**(防越权,同所有现有工具)——不从 LLM 入参取
- 至少一段必填(全空调用 = 无意义,服务端拒绝)
- 工具 description 明示三段语义 + 字数上限 + 压缩纪律

### `ProcessMemoryService`

文件:`server/src/memory/process-memory.service.ts`(新建)

```ts
@Injectable()
export class ProcessMemoryService {
  constructor(private readonly prisma: PrismaService) {}

  // 写:upsert by novelId。字段语义:undefined=不覆盖(保留原值);""=清空该段(主动删除);
  //       非空字符串=设为新值。校验 novel 归属 user(scoped)。
  //       每段超长 → 截断 + logger.warn(可观测 main 是否偷懒)。
  async upsert(userId: string, novelId: string, partial: {
    rules?: string; lessons?: string; decisions?: string;
  }): Promise<{ rules: string; lessons: string; decisions: string }> {
    // 1. 校验 novel 归属 user(findFirst novelId+userId)
    // 2. 对传了的字段截断(rules/lessons ≤ 800 字,decisions ≤ 1200 字),超则 warn
    // 3. upsert:create 用默认值 + 传了的字段;update 用传了的字段
    // 4. 返回最新三段(供工具 result 回显)
  }

  // 读:ContextAssembler.forSession 注入用。返回 null = 无行或三段全空。
  async get(userId: string, novelId: string): Promise<{
    rules: string; lessons: string; decisions: string;
  } | null> { /* findFirst novelId+userId via novel relation;三段全空 → null */ }
}
```

字数上限常量(类导出,便于单测):
```ts
export const MEMORY_LIMITS = { rules: 800, lessons: 800, decisions: 1200 };
```

### "强制每轮调"的语义

- 软强制:靠 main prompt 指令(同 settler 必调 `write_summary` 的现有模式)
- **不挂中间件硬门**——main 漏调 → 该轮记忆不更新(降级,不致命);下轮注入的还是旧记忆,main 仍能看到
- 现有 `write_summary` 也是这个软强制模式,已被验证可用

## 压缩模型

### 三段不同的压缩策略(prompt 里告诉 main)

| 段 | 软目标 | 超了 main 怎么做 |
|----|--------|------------------|
| 【规矩】 | ≤ 800 字 | 合并冲突规矩、删过时指令;规矩应是少量硬性条目,天然不长 |
| 【经验】 | ≤ 800 字 | 合并相似经验、淘汰被后续推翻的、把多条细节提炼成一句原则 |
| 【近期决策】 | ≤ 10 条 / ≤ 1200 字 | **老的升段**:把有长期价值的决策提炼成经验写进【经验】段,再从决策段删;纯过时的直接删 |

【近期决策】→【经验】的"升段"流动是核心:决策是短时,经验是蒸馏后的长时。避免决策段无限堆积。

### 服务端兜底

- `ProcessMemoryService.upsert` 对每段硬截断(rules/lessons ≤ 800,decisions ≤ 1200)
- 超则截尾 + `logger.warn`(可观测 main 守不守纪律)
- 正常情况下 main 自己压缩,兜底很少触发

## 召回路径(注入)

### 注入点:`ContextAssembler.forSession`

`server/src/agentos/context-assembler.service.ts`(`forSession` 方法,第 86-128 行)。

改动:
1. 构造函数注入 `ProcessMemoryService`
2. `forSession` 里在取 master / overview 之后,加 `const mem = await this.processMemory.get(userId, novel.id)`
3. `mem` 非空 → 拼 slice,push 进 `slices[]`
4. slice 与 masterSlice / 【小说态势】走同一条插入路径(插在 systemPrompt 的 "规则:" marker 前)

### Slice 格式

```
【本书过程记忆】（main 维护,每轮 update_memory 更新;写作遵守规矩段,参考经验段）
【规矩】<rules 内容>
【经验】<lessons 内容>
【近期决策】<decisions 内容>
```

### 空态处理

| 情况 | 行为 |
|------|------|
| 无 NovelProcessMemory 行(首本/首轮) | 不注入 slice,main 只看到 prompt 里的"请开始维护"指令 |
| 行存在但三段全空 | `get()` 返回 null,不注入 |
| 任一段非空 | 注入完整 slice(空段也显示标题,让 main 知道结构存在) |

### 谁看得到:**只注入 main**

子 agent 不注入。main 若要让 writer 遵守某条规矩(如"本书不用第一人称"),在 task 委派时显式传达——与 main 现在传达【总纲】【字数目标】同一机制。

**代价**:main 偷懒不向 writer 传达规矩 → writer 可能违反。但这与"main 忘了传前情"是同一类问题,靠 main prompt 纪律约束,不靠记忆系统解决。

**后续优化(非本期)**:若发现规矩总漏传 writer,可把 `rules` 段加进 writer augment(与现有【作者声音】并列)。YAGNI,先 main-only。

## Prompt 改动

### `server/src/agentos/prompts/main.md`(追加一节)

位置:文件末尾追加。要点:

```
## 【本书过程记忆】维护

你有一份 per-novel 过程记忆(见上方注入的【本书过程记忆】段),三段:
- 【规矩】本书硬性写作要求(作者明确给过的指令,如"不用第一人称""反派不洗白")
- 【经验】提炼出的写作经验(如"本书读者偏好短章快节奏""多线叙事在此书水土不服")
- 【近期决策】最近重要的写作决策/尝试(≤10 条)

维护规则:
- **本轮对话结束前必须调用 update_memory**(即使本轮没新内容,也要判断旧内容是否需压缩)
- 更新某段前,先看上方注入的现有内容;把"现有 + 本轮新增"合并压缩后,传完整新内容
- 各段有字数上限(规矩/经验 ≤800 字,决策 ≤1200 字),超了合并相似条目/淘汰过时条目/提炼更精炼表述——不要简单截断丢信息
- 【近期决策】超 10 条时,把有长期价值的升段进【经验】,再从决策段删
- 只传本轮有变化的段;没变化的段不传(服务端保留原值)
```

`agent-prompts.spec.ts` 加 substring 断言:锁 "必须调用 update_memory" 子串(防 prompt 被误删)。

## 接线清单

| 文件 | 改动 |
|------|------|
| `server/prisma/schema.prisma` | 加 `NovelProcessMemory` model;`Novel` 加 `processMemory ProcessMemory?` 反向关系 |
| 迁移 | `pnpm --dir server prisma migrate dev` + **手动 `pnpm --dir server prisma generate`** |
| `server/src/memory/process-memory.service.ts` | 新建(`upsert` + `get` + `MEMORY_LIMITS`) |
| `server/src/memory/process-memory.service.spec.ts` | 新建单测 |
| `server/src/memory/memory.module.ts` | providers + exports 加 `ProcessMemoryService` |
| `server/src/agentos/tools/update-memory.tool.ts` | 新建工具 |
| `server/src/agentos/agent-registry.ts` | `TOOL_REGISTRY['update_memory']` 注册;`ToolDeps` 加 `processMemory: ProcessMemoryService` |
| `server/src/agentos/agent-tree.config.ts` | `AGENT_TREE.tools` 数组加 `'update_memory'`(只给 main) |
| `server/src/agentos/context-assembler.service.ts` | 注入 `ProcessMemoryService`;`forSession` 读记忆 + 拼 slice |
| `server/src/agentos/deep-agent.service.ts` | 构造函数注入 `ProcessMemoryService`;`deps` 对象传 `processMemory: this.processMemory` |
| `server/src/agentos/agentos.module.ts` | 确认 `MemoryModule` 已 import(已 import,新增 service 自动可见) |
| `server/src/agentos/prompts/main.md` | 追加【本书过程记忆】维护节 |
| `server/src/agentos/agent-prompts.spec.ts` | 加 substring 断言 |

## 测试

| 层 | 测试 |
|----|------|
| `ProcessMemoryService` 单测 | upsert 语义(undefined=保留原值;""=清空;非空=设新值)、超长截断 + warn、novel 归属 user 校验(越权返 null)、`get` 三段全空返 null |
| `update-memory.tool` 单测 | userId/novelId 闭包防越权、至少一段必填、返回回显最新三段 |
| `ContextAssembler` 单测 | 有记忆 → slice 注入到 "规则:" 前;无记忆/全空 → 不注入 |
| `agent-prompts.spec.ts` | substring 锁("必须调用 update_memory") |
| 现有测试回归 | `agent-tree.groups.spec.ts`(tools 数组变化)、`deep-agent.override.spec.ts`、`context-assembler.service.spec.ts` 不破 |
| 集成(手动) | 跑一轮 → 行创建;跑二轮 → systemPrompt 含 slice;造超长内容 → 截断 warn 日志可见 |

## 设计决策记录

1. **为什么不用 deepagents `StoreBackend` / `createMemoryMiddleware`**:常驻全量注入场景下语义 search 收益为零(不检索,全量灌入);引入它 = 多一套 Store 表 + embedding 模型依赖 + 与 Prisma 模式不一致。代价实,收益零。若未来做"千章级向量召回"或"跨小说用户偏好语义搜索"再上(deferred)。

2. **为什么 per-novel 不 per-user**:用户明确选择 per-novel。每本书的规矩/经验/决策高度书特定;跨书共享的"作者偏好"已有 `VoiceProfile` 承载,不重复造。

3. **为什么软强制不硬门**:对齐现有 `write_summary` 验证过的模式;硬门中间件增加复杂度且 main 漏调不致命(降级,旧记忆仍注入)。

4. **为什么整段重写不 append**:整段重写让压缩内建进 main 推理(看现有 + 本轮 → 合并),零额外 LLM 调用;append 模式需要独立的压缩/蒸馏步骤,过度工程。

5. **为什么三段 String 不 Json 数组**:"部分更新"粒度是段不是条目;String 最简、服务端无解析;段内由 main 整段重写(天然支持压缩)。

## 非目标 / Deferred

- 向量检索/语义召回(千章级才需要)
- 跨小说用户级全局过程记忆
- FE 展示/编辑记忆面板
- 把规矩段注入 writer augment(若 main 漏传 writer 再加)
- 记忆版本历史(当前只存最新)
