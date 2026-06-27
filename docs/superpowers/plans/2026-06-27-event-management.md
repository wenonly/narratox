# 事件管理 实施计划(Phase 11)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 Event(故事事件)资源——独立于 StoryEvent(伏笔),relatedHookId N:1 链接。settler 提取第 5 类 → Event 表 → 【近期关键事件】注入 + get_events 召回 + FE 时间线面板。修 Phase 8 诊断的「超 5 章遗忘剧情」。

**Architecture:** 新 Prisma `Event` model(`chapterOrder:Int` 软引用,与 StoryEvent/CharacterChange 同)+ `EventSignificance` 枚举(MAJOR/MINOR 控量)。EventService(memory 层)+ settler 经 write_summary `plotEvents` 参数写入 + get_events 只读查询工具(挂 writer/validator/main)+ ContextAssembler 注入最近 8 个 MAJOR + GET 端点 + FE EventsView 面板(独立 tab)。

**Tech Stack:** NestJS 11 + Prisma 7(改 schema 后**必须手动 `prisma generate`**)+ deepagents;jest(`pnpm test`,NODE_OPTIONS=--experimental-vm-modules)+ `pnpm typecheck`;FE Next.js 15,`pnpm validate`(lint+format+typecheck,无 test runner)。

**Spec:** [2026-06-27-event-management-design.md](../specs/2026-06-27-event-management-design.md)

> **命名注意**:`write_summary` 工厂已解构 `events: StoryEventService`(伏笔)。新 EventService 注入名用 **`eventService`**(避撞);LLM 入参用 **`plotEvents`**。ToolDeps 已有 `events`(StoryEventService),新增 `eventService`(EventService)。

---

## File Structure

**server(新):** `src/memory/event.service.ts`、`src/agentos/tools/get-events.tool.ts` + 各自 spec。
**server(改):** `prisma/schema.prisma`、`src/memory/memory.module.ts`、`src/novel/novel.controller.ts`、`src/novel/novel.module.ts`、`src/agentos/tools/write-summary.tool.ts`、`src/agentos/agent-registry.ts`、`src/agentos/deep-agent.service.ts`、`src/agentos/agent-tree.config.ts`(+spec)、`src/agentos/agent-prompts.ts`、`src/agentos/context-assembler.service.ts`、`src/agentos/agentos.module.ts`(按需)。
**agent-ui(改):** `src/types/novel.ts`、`src/api/routes.ts`、`src/api/novels.ts`、`src/components/workspace/IconRail.tsx`、`src/components/workspace/ResourcePanel.tsx`、`src/app/novels/[id]/page.tsx`。

---

## Task 1:Prisma Event model + migration + generate

**Files:** Modify `server/prisma/schema.prisma`

- [ ] **Step 1: 加 Event model + EventSignificance 枚举**

在 `prisma/schema.prisma`(StoryEvent 之后,约第 141 行后)加:

```prisma
/// 故事事件账本:离散「这章发生了什么」,可检索、可交叉链接(章/角色/地点/伏笔/因果)。
/// 独立于 StoryEvent(伏笔):Event 是事实点(永久),伏笔是承诺线(OPEN→RESOLVED);
/// 一个伏笔可被多个 Event 触碰(relatedHookId N:1, relatedHookAction)。
model Event {
  id                String            @id @default(cuid())
  novelId           String
  novel             Novel             @relation(fields: [novelId], references: [id], onDelete: Cascade)
  chapterOrder      Int
  description       String
  kind              String?
  significance      EventSignificance @default(MINOR)
  involvedCharacters String[]         @default([])
  location          String?
  causedById        String?
  causedBy          Event?            @relation("EventCausality", fields: [causedById], references: [id], onDelete: SetNull)
  leadsTo           Event[]           @relation("EventCausality")
  relatedHookId     String?
  relatedHook       StoryEvent?       @relation(fields: [relatedHookId], references: [id], onDelete: SetNull)
  relatedHookAction String?
  createdAt         DateTime          @default(now())
  updatedAt         DateTime          @updatedAt

  @@index([novelId, chapterOrder])
  @@index([novelId, significance])
}

enum EventSignificance {
  MAJOR
  MINOR
}
```

- [ ] **Step 2: StoryEvent 加反向关系**

在 `model StoryEvent` 里(约第 124-141 行)加一行反向关系(供 relatedHook FK):

```prisma
  events            Event[]           @relation("relatedHook")   // 反向:触碰本伏笔的事件
```

> 注:若不加别名 Prisma 默认用字段名推断关系;`relatedHook` 两侧都显式命名避免歧义。若 Prisma 报「needs explicit name」,两侧 relation 用同一字符串名。执行时按 Prisma 报错微调。

- [ ] **Step 3: Novel 加反向关系**

在 `model Novel` 的反向关系数组里(约第 77-82 行 `events StoryEvent[]` 附近)加:

```prisma
  plotEvents         Event[]
```

- [ ] **Step 4: migrate + generate**

Run:
```bash
cd /Users/taowen/project/narratox/server && pnpm exec prisma migrate dev --name add_event_model
```
**关键**:Prisma 7 `migrate dev` 不自动 regenerate client(MEMORY.md gotcha)。migrate 后必须:
```bash
cd /Users/taowen/project/narratox/server && pnpm exec prisma generate
```
Expected: migration 生成 + client regenerate(含 `prisma.event`)。

- [ ] **Step 5: typecheck 确认 client 可用**

Run: `cd /Users/taowen/project/narratox/server && pnpm typecheck`
Expected: 通过(此时还没代码用 Event,只确认 client 生成无碍)。

- [ ] **Step 6: 提交**

```bash
cd /Users/taowen/project/narratox && git add server/prisma/schema.prisma server/prisma/migrations/
git commit -m "feat(db): Event model + EventSignificance(Phase 11)

故事事件账本(独立于伏笔,relatedHookId N:1 链接)。chapterOrder 软引用、
significance 控量、causedById 单父因果链。StoryEvent/Novel 加反向关系。"
```

---

## Task 2:EventService + MemoryModule + 单测(TDD)

**Files:** Create `server/src/memory/event.service.ts` + `server/src/memory/event.service.spec.ts`;Modify `server/src/memory/memory.module.ts`

- [ ] **Step 1: 先写 spec(失败驱动)**

`server/src/memory/event.service.spec.ts`,照 `story-event.service.spec.ts` 模式(jest.fn() mock PrismaService):

```ts
import { EventService } from './event.service';

const mockPrisma = (eventFindMany: unknown = []) => ({
  event: {
    createMany: jest.fn().mockResolvedValue({ count: 1 }),
    findMany: jest.fn().mockResolvedValue(eventFindMany),
  },
  novel: { findFirst: jest.fn() },
});

describe('EventService', () => {
  it('createEvents 批量写入(带 userId scope 的 novel 校验)', async () => {
    const prisma = mockPrisma();
    const svc = new EventService(prisma as any);
    await svc.createEvents('u1', 'n1', [
      { description: '发现血书', significance: 'MAJOR', involvedCharacters: ['沈砚'] },
    ], 12);
    expect(prisma.event.createMany).toHaveBeenCalled();
  });

  it('listRecentMajor 只取 MAJOR,按 chapterOrder desc,limit', async () => {
    const prisma = mockPrisma([{ chapterOrder: 12, description: 'a', significance: 'MAJOR' }]);
    const svc = new EventService(prisma as any);
    const out = await svc.listRecentMajor('u1', 'n1', 8);
    expect(prisma.event.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ novelId: 'n1', significance: 'MAJOR', novel: { userId: 'u1' } }),
      orderBy: { chapterOrder: 'desc' },
      take: 8,
    }));
    expect(out).toHaveLength(1);
  });

  it('listEvents 支持过滤(章范围/角色/significance/keyword)', async () => {
    const prisma = mockPrisma();
    const svc = new EventService(prisma as any);
    await svc.listEvents('u1', 'n1', { chapterFrom: 5, chapterTo: 20, character: '沈砚', significance: 'MAJOR', keyword: '血书' });
    const arg = (prisma.event.findMany as jest.Mock).mock.calls[0][0];
    expect(arg.where.chapterOrder.gte).toBe(5);
    expect(arg.where.chapterOrder.lte).toBe(20);
    expect(arg.where.involvedCharacters.has).toBe('沈砚');
    expect(arg.where.significance).toBe('MAJOR');
    expect(arg.where.description.contains).toBe('血书');
  });

  it('listForPanel 全量按 chapterOrder', async () => {
    const prisma = mockPrisma();
    const svc = new EventService(prisma as any);
    await svc.listForPanel('u1', 'n1');
    expect(prisma.event.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { novelId: 'n1', novel: { userId: 'u1' } },
      orderBy: { chapterOrder: 'asc' },
    }));
  });
});
```

- [ ] **Step 2: 跑 spec,确认失败**

Run: `cd /Users/taowen/project/narratox/server && pnpm test -- event.service.spec.ts`
Expected: FAIL(EventService 未实现)。

- [ ] **Step 3: 实现 EventService**

`server/src/memory/event.service.ts`(照 `story-event.service.ts` / `chapter-summary.service.ts` 模式;user scope 走 `novel: { userId }`):

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { EventSignificance } from '@prisma/client';

export interface PlotEventInput {
  description: string;
  significance?: EventSignificance;
  kind?: string;
  involvedCharacters?: string[];
  location?: string;
  causedById?: string;
  relatedHookId?: string;
  relatedHookAction?: string;
}

export interface EventFilter {
  chapterFrom?: number;
  chapterTo?: number;
  character?: string;
  significance?: EventSignificance;
  keyword?: string;
}

@Injectable()
export class EventService {
  constructor(private readonly prisma: PrismaService) {}

  /** settler 批量写入本章事件。chapterOrder 锚本章。*/
  async createEvents(
    userId: string,
    novelId: string,
    events: PlotEventInput[],
    chapterOrder: number,
  ) {
    if (!events?.length) return { count: 0 };
    // scope 校验:novel 归属 user
    const owned = await this.prisma.novel.findFirst({ where: { id: novelId, userId }, select: { id: true } });
    if (!owned) return { count: 0 };
    const rows = events.map((e) => ({
      novelId,
      chapterOrder,
      description: e.description,
      kind: e.kind ?? null,
      significance: e.significance ?? 'MINOR',
      involvedCharacters: e.involvedCharacters ?? [],
      location: e.location ?? null,
      causedById: e.causedById ?? null,
      relatedHookId: e.relatedHookId ?? null,
      relatedHookAction: e.relatedHookAction ?? null,
    }));
    return this.prisma.event.createMany({ data: rows });
  }

  /** 注入用:最近 N 个 MAJOR,按 chapterOrder desc。*/
  async listRecentMajor(userId: string, novelId: string, limit = 8) {
    return this.prisma.event.findMany({
      where: { novelId, significance: 'MAJOR', novel: { userId } },
      orderBy: { chapterOrder: 'desc' },
      take: limit,
      select: { id: true, chapterOrder: true, description: true, involvedCharacters: true, location: true, relatedHookId: true, relatedHookAction: true },
    });
  }

  /** get_events 工具用:结构化过滤查询。*/
  async listEvents(userId: string, novelId: string, f: EventFilter) {
    const where: any = { novelId, novel: { userId } };
    if (f.chapterFrom !== undefined || f.chapterTo !== undefined) {
      where.chapterOrder = {};
      if (f.chapterFrom !== undefined) where.chapterOrder.gte = f.chapterFrom;
      if (f.chapterTo !== undefined) where.chapterOrder.lte = f.chapterTo;
    }
    if (f.character) where.involvedCharacters = { has: f.character };
    if (f.significance) where.significance = f.significance;
    if (f.keyword) where.description = { contains: f.keyword };
    return this.prisma.event.findMany({
      where,
      orderBy: { chapterOrder: 'asc' },
      take: 30,
      select: { id: true, chapterOrder: true, description: true, significance: true, kind: true, involvedCharacters: true, location: true, relatedHookId: true, relatedHookAction: true, causedById: true },
    });
  }

  /** FE 面板用:全量按章。*/
  async listForPanel(userId: string, novelId: string) {
    return this.prisma.event.findMany({
      where: { novelId, novel: { userId } },
      orderBy: { chapterOrder: 'asc' },
    });
  }
}
```

- [ ] **Step 4: 跑 spec,确认通过**

Run: `cd /Users/taowen/project/narratox/server && pnpm test -- event.service.spec.ts`
Expected: PASS(4 用例)。

- [ ] **Step 5: 注册到 MemoryModule**

`server/src/memory/memory.module.ts` 的 `providers` + `exports` 加 `EventService`。

- [ ] **Step 6: typecheck + 提交**

Run: `cd /Users/taowen/project/narratox/server && pnpm typecheck`
```bash
cd /Users/taowen/project/narratox && git add server/src/memory/event.service.ts server/src/memory/event.service.spec.ts server/src/memory/memory.module.ts
git commit -m "feat(memory): EventService(createEvents/listRecentMajor/listEvents/listForPanel)

事件账本的 CRUD + 结构化过滤查询;user scope 走 novel.userId。jest 单测。"
```

---

## Task 3:settler 提取事件(write_summary += plotEvents + SETTLER prompt)

**Files:** Modify `server/src/agentos/tools/write-summary.tool.ts`、`server/src/agentos/agent-registry.ts`(注入 eventService)、`server/src/agentos/agent-prompts.ts`(SETTLER);Create/extend spec。

- [ ] **Step 1: write_summary 工厂加 eventService 注入 + plotEvents 参数**

`write-summary.tool.ts`:
- 工厂签名加 `eventService: EventService`(import from `../../memory/event.service`)。
- zod schema 加(plotEvents 数组,字段对齐 PlotEventInput,significance 枚举):
```ts
plotEvents: z.array(z.object({
  description: z.string().describe('发生了什么(如「沈砚在密室发现血书」)'),
  significance: z.enum(['MAJOR', 'MINOR']).describe('MAJOR=剧情转折/揭示/重大冲突(注入+重点召回);MINOR=次要推进(仅可查)'),
  kind: z.string().optional().describe('可选分类标签:revelation/confrontation/death/meeting/betrayal/...'),
  involvedCharacters: z.array(z.string()).optional().describe('涉及角色名'),
  location: z.string().optional().describe('地点名'),
  causedById: z.string().optional().describe('导致本事件的事件 id(因果链)'),
  relatedHookId: z.string().optional().describe('本事件埋/推进/回收的伏笔 id'),
  relatedHookAction: z.enum(['planted', 'advanced', 'resolved']).optional(),
})).optional().describe('本章关键事件(1-3 个 MAJOR + 若干 MINOR)'),
```
- 工具体内(其它 service 调用旁)加:
```ts
if (plotEvents?.length) {
  await eventService.createEvents(userId, novelId, plotEvents, chapterOrder);
}
```

- [ ] **Step 2: agent-registry 注入 eventService**

`agent-registry.ts`:`ToolDeps` 加 `eventService: EventService`;`makeWriteSummaryTool` 调用处加 `eventService: d.eventService`。`deep-agent.service.ts` 的 `deps` 构造加 `eventService: eventService`(需从 module 注入 EventService 到 DeepAgentService —— 见 agentos.module,确保 EventService 可注入)。

- [ ] **Step 3: SETTLER prompt 加【关键事件】段**

`agent-prompts.ts` 的 `SETTLER_AGENT_PROMPT`,在【伏笔】段之后加:
```
【关键事件 — plotEvents(「发生了什么」的账本)】
- 提取本章关键事件,判 significance:
  · MAJOR:剧情转折/重大揭示/关键冲突/人物命运节点(写后续章必须记得的)——每章 1-3 个。
  · MINOR:次要推进(到了某地、小交锋)——按需记。
- 每个 event:description(发生了什么)+ significance + 涉及角色(involvedCharacters)+ 地点(location)。
- 若本事件 埋/推进/回收 了伏笔 → relatedHookId(那个伏笔 id)+ relatedHookAction(planted/advanced/resolved)。
- 若本事件由前文某事件导致 → causedById(那个事件 id,因果链)。
- 区别于伏笔:伏笔是「承诺线」(待回收),事件是「事实点」(已发生)。大多数事件没有 relatedHook。
```

- [ ] **Step 4: 单测(若 write-summary.tool.spec.ts 不存在则新建,验证 plotEvents → createEvents)**

```ts
it('plotEvents 传入 → eventService.createEvents 被调', async () => {
  const eventService = { createEvents: jest.fn().mockResolvedValue({ count: 1 }) };
  const tool = makeWriteSummaryTool({ userId: 'u1', novelId: 'n1', chapters: {...}, summaries: {...}, events: {...}, characters: {...}, eventService } as any);
  await tool.invoke({ chapterOrder: 1, summary: 's', plotEvents: [{ description: 'x', significance: 'MAJOR' }] });
  expect(eventService.createEvents).toHaveBeenCalledWith('u1', 'n1', expect.any(Array), 1);
});
```
Run: `cd /Users/taowen/project/narratox/server && pnpm test -- write-summary`
Expected: PASS。

- [ ] **Step 5: 回归 + typecheck + 提交**

Run: `pnpm test && pnpm typecheck`
```bash
git add server/src/agentos/tools/write-summary.tool.ts server/src/agentos/tools/write-summary.tool.spec.ts server/src/agentos/agent-registry.ts server/src/agentos/deep-agent.service.ts server/src/agentos/agentos.module.ts server/src/agentos/agent-prompts.ts
git commit -m "feat(agent): settler 提取关键事件(write_summary plotEvents)

第 5 类提取:事件账本。settler 判 MAJOR/MINOR、链角色/地点/伏笔/因果。
write_summary += plotEvents 参数。"
```

---

## Task 4:get_events 工具 + 接线 + agent-tree(TDD)

**Files:** Create `server/src/agentos/tools/get-events.tool.ts` + spec;Modify `agent-registry.ts`、`agent-tree.config.ts`(+spec)。

- [ ] **Step 1: 先写 get-events.tool.spec.ts**

照 `get-reference.tool.spec.ts` 模式:
```ts
it('返回 JSON 字符串(防数组多模态块)', async () => {
  const eventService = { listEvents: jest.fn().mockResolvedValue([{ chapterOrder: 1, description: 'x' }]) };
  const t = makeGetEventsTool({ userId: 'u1', novelId: 'n1', eventService } as any);
  const out: any = await t.invoke({ character: '沈砚' });
  expect(typeof out).toBe('string');
  expect(JSON.parse(out)).toHaveLength(1);
});
```

- [ ] **Step 2: 实现 get-events.tool.ts**

```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { EventService } from '../../memory/event.service';

export function makeGetEventsTool({ userId, novelId, eventService }: {
  userId: string; novelId: string; eventService: EventService;
}) {
  return tool(
    async (args) => {
      const list = await eventService.listEvents(userId, novelId, args);
      return JSON.stringify(list); // 必须字符串(防数组被供应商当多模态块)
    },
    {
      name: 'get_events',
      description: '检索过往故事事件(「发生了什么」账本)。按章范围/角色名/重要性/关键词查。写涉及旧情节、核证「是否已发生过」时用。返回事件列表 JSON。',
      schema: z.object({
        chapterFrom: z.number().int().optional().describe('起始章(含)'),
        chapterTo: z.number().int().optional().describe('结束章(含)'),
        character: z.string().optional().describe('涉及的角色名'),
        significance: z.enum(['MAJOR', 'MINOR']).optional(),
        keyword: z.string().optional().describe('描述关键词'),
      }),
    },
  );
}
```

- [ ] **Step 3: agent-registry 注册 get_events**

```ts
import { makeGetEventsTool } from './tools/get-events.tool';
// TOOL_REGISTRY 里:
get_events: (d) => makeGetEventsTool({ userId: d.userId, novelId: d.novelId, eventService: d.eventService }),
```

- [ ] **Step 4: agent-tree.config.ts + spec(TDD:先改快照→红→改配置→绿)**

writer / validator / main 的 tools 各加 `'get_events'`(放 get_characters 或 query_memory 附近)。
spec 防回归快照对应三处 tools 数组同步加 `'get_events'`;新增正向断言:
```ts
it('writer/validator/main 都能召回事件(get_events)', () => {
  const main = AGENT_TREE;
  expect(main.tools).toContain('get_events');
  const chapter = main.subagents!.find(s => s.name === 'chapter')!;
  expect(chapter.subagents!.find(s => s.name === 'writer')!.tools).toContain('get_events');
  expect(chapter.subagents!.find(s => s.name === 'validator')!.tools).toContain('get_events');
});
```
Run: `pnpm test -- get-events.tool.spec.ts agent-tree.config.spec.ts` → 全绿。

- [ ] **Step 5: 回归 + typecheck + 提交**

```bash
git add server/src/agentos/tools/get-events.tool.ts server/src/agentos/tools/get-events.tool.spec.ts server/src/agentos/agent-registry.ts server/src/agentos/agent-tree.config.ts server/src/agentos/agent-tree.config.spec.ts
git commit -m "feat(agent): get_events 召回工具(挂 writer/validator/main)

结构化检索过往事件(章/角色/重要性/关键词),补 query_memory 关键词短板。
快照同步 + 正向断言。"
```

---

## Task 5:ContextAssembler 【近期关键事件】 slice

**Files:** Modify `server/src/agentos/context-assembler.service.ts`

- [ ] **Step 1: 构造注入 EventService + 拉 recent major + push slice**

构造函数加 `eventService: EventService`。`forSession` 里(`cast` 之后,`slices` 声明之后)加:
```ts
const recentEvents = await this.eventService.listRecentMajor(userId, novel.id, 8);
```
在【前情】slice 之后、【未回收伏笔】之前 push:
```ts
if (recentEvents.length) {
  const evLine = recentEvents.map((e) => `第${e.chapterOrder}章:${e.description}`).join(' / ');
  slices.push(`【近期关键事件】${evLine}`);
}
```
确保 `agentos.module.ts` 能注入 EventService(import MemoryModule 或 provide)。

- [ ] **Step 2: 回归 + typecheck + 提交**

Run: `pnpm test && pnpm typecheck`
```bash
git add server/src/agentos/context-assembler.service.ts server/src/agentos/agentos.module.ts
git commit -m "feat(context): 注入【近期关键事件】slice(最近8个MAJOR)

修 Phase 8 诊断:MAJOR 事件常驻上下文,不受 5 章窗口限。"
```

---

## Task 6:API GET /novels/:id/events

**Files:** Modify `server/src/novel/novel.controller.ts`、`server/src/novel/novel.module.ts`

- [ ] **Step 1: controller 加 GET 端点**

照现有 `@Get(':id/...')` 面板端点模式(注释「供右侧事件面板渲染」),注入 EventService:
```ts
@Get(':id/events')
async listEvents(@CurrentUser() user: { id: string }, @Param('id') id: string) {
  return this.events.listForPanel(user.id, id);
}
```
(controller 已注入其它 service;加一个 EventService 字段。)

- [ ] **Step 2: module 接线**

`novel.module.ts` 确保 EventService 可注入(import MemoryModule 若未导入,或 MemoryModule 已 global)。执行时按现有 module 结构接。

- [ ] **Step 3: 回归 + typecheck + 提交**

```bash
git add server/src/novel/novel.controller.ts server/src/novel/novel.module.ts
git commit -m "feat(api): GET /novels/:id/events(事件面板只读端点)"
```

---

## Task 7:FE EventsView 面板 + 接线

**Files:** Modify agent-ui `src/types/novel.ts`、`src/api/routes.ts`、`src/api/novels.ts`、`src/components/workspace/IconRail.tsx`、`src/components/workspace/ResourcePanel.tsx`、`src/app/novels/[id]/page.tsx`

- [ ] **Step 1: 类型 + 路由 + client**

`types/novel.ts` 加:
```ts
export interface EventTimelineItem {
  id: string; chapterOrder: number; description: string;
  kind: string | null; significance: 'MAJOR' | 'MINOR';
  involvedCharacters: string[]; location: string | null;
  causedById: string | null; relatedHookId: string | null; relatedHookAction: string | null;
}
```
`routes.ts` 加:`NovelEvents: (base, id) => \`${base}/novels/${id}/events\`,`。
`novels.ts` 加(照 getHooks):`export const getEvents = (base, token, novelId) => asJson<EventTimelineItem[]>(fetch(APIRoutes.NovelEvents(base, novelId), { headers: headers(token) }));`

- [ ] **Step 2: ResourceKey 三处同步 + IconRail 资源项**

`IconRail.tsx`、`ResourcePanel.tsx`、`page.tsx` 的 `ResourceKey` 联合类型各加 `'events'`。`IconRail.tsx` 的 `RESOURCES` 加 `{ key: 'events', icon: '📅', label: '事件时间线' }`。`ResourcePanel.tsx` 的 `TITLES` 加 `events: '事件时间线'`。

- [ ] **Step 3: ResourcePanel 条件渲染 + fallback + EventsView 组件**

`ResourcePanel.tsx` 条件区加 `{resource === 'events' && <EventsView novel={novel} />}`;fallback 兜底判断补 `resource !== 'events' &&`。

新增 `EventsView` 组件(同文件局部函数,照 `WorldView`/`HooksView` 模式 + 复用 `CharactersView` 时间线渲染):
- `useStore` 取 endpoint/token + `summariesWriteSeq`(事件由 settler 经 write_summary 写,复用此 seq 刷新)。
- `useEffect` 依赖 `[endpoint, token, novel.id, summariesWriteSeq]` → `getEvents(...)` → setState。
- 三态:loading/空引导(「事件由 settler 每章自动提取;暂无」)/ 有数据。
- 渲染:按 `chapterOrder` 分组,每事件一张卡 —— `★ MAJOR`/`· minor` 徽标、description、involvedCharacters chip、location、relatedHook 链接(若有)。折叠=一行;展开=详情。

- [ ] **Step 4: FE 校验**

Run: `cd /Users/taowen/project/narratox/agent-ui && pnpm validate`
Expected: lint + format + typecheck 全过。

- [ ] **Step 5: 提交**

```bash
cd /Users/taowen/project/narratox && git add agent-ui/
git commit -m "feat(agent-ui): 事件时间线面板(EventsView)

右侧新 tab「事件」,按章分组、★MAJOR/·minor 徽标、角色/地点/伏笔链。
复用既有面板模式;ResourceKey 三处同步;summariesWriteSeq 刷新。"
```

---

## Task 8:CLAUDE.md Phase 11 入档

**Files:** Modify `CLAUDE.md`(Phase 10 去 current + 加 Phase 11 条)

- [ ] 插入 Phase 11 条(概述 Event 资源 + 独立于伏笔 + settler 提取 + get_events + 注入 + 面板 + spec/plan 链接)。提交。

---

## Self-Review

- **Spec 覆盖**:Event model → T1;CRUD+查询 → T2;settler 提取 → T3;get_events → T4;注入 → T5;API → T6;FE → T7。独立+链接(relatedHookId)→ schema + plotEvents.relatedHookId;significance 控量 → schema + 注入只取 MAJOR;因果单父 → causedById;不统一/不手动 CRUD/不上向量 → 显式不做。✅
- **占位符**:无 TBD;关键代码逐字给出,模块接线按现有结构执行时定。✅
- **一致性**:`plotEvents`(LLM 入参)vs `eventService`(注入)vs `events`(StoryEventService)命名分明;chapterOrder 软引用与 StoryEvent/CharacterChange 一致;FE ResourceKey 三处同步。✅

## 验证未覆盖

- 单测锚定 service/tool/接线;**settler 稳定提取事件、判 significance、get_events 实际改善召回、FE 面板渲染** 需活 E2E(写 10+ 章)。本期不强制。
