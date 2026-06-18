# narratox Analyst Agent Implementation Plan (v2 — async)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a non-user-facing **Analyst** agent that, after each successful `write_chapter`, **asynchronously** extracts 4 fact types (summary / role-changes / hooks / entities) into new `ChapterSummary` + `StoryEvent` tables. The write stream is **not** blocked (RunCompleted fires immediately); the memory is rebuilt from DB by a `GET /novels/:id/chapters/:order/summary` endpoint that the frontend **polls**, rendering a per-message "memory bubble". Facts feed back to the Writer via ContextAssembler injection + a `query_memory` tool.

**Architecture (v2, spike-driven):** `AnalystService.settle()` is fire-and-forget (`void … .catch(log)`, not awaited) from `streamTurn` after it detects the `write_chapter` **ToolMessage result**. It does ONE `withStructuredOutput(schema, { method: 'functionCalling' })` call (spike-verified: default/jsonSchema/jsonMode all fail on the z.ai coding endpoint; functionCalling works in ~16-32s). Memory data is **reconstructed from DB** by a GET endpoint (single source of truth) — so there are NO `Settling`/`MemoryUpdated`/`MemorySkip` stream frames and NO `pendingMemory` timing race. `ContextAssembler.forSession` injects recent summaries + open hooks; a `query_memory` read-tool lets the Writer look up specific facts by keyword.

**Tech Stack:** NestJS 11 + Prisma 7 (PostgreSQL, `public` schema) + `@langchain/openai` (ChatOpenAI, structured output via `method:'functionCalling'`) + zod. Frontend: Next.js 15 + React 18 + Zustand + Tailwind dark theme. Server tests: jest (`pnpm test`, ts-jest, `NODE_OPTIONS=--experimental-vm-modules`). No FE test runner — gate is `pnpm validate` + `pnpm build`.

**Spec:** [docs/superpowers/specs/2026-06-18-multi-agent-analyst-design.md](../specs/2026-06-18-multi-agent-analyst-design.md)

**Spike:** [server/scripts/spike-analyst-structured.ts](../../server/scripts/spike-analyst-structured.ts) — verified functionCalling works, others fail.

---

## File Structure

**Backend (server/):**
- Modify: `server/prisma/schema.prisma` — `ChapterSummary`, `StoryEvent`, `EventStatus` + reverse relations.
- Create: `server/src/memory/chapter-summary.service.ts` — `SummaryService`: upsert / listRecent.
- Create: `server/src/memory/story-event.service.ts` — `StoryEventService`: listOpen / createHooks / resolveHooks / **cleanupForChapter** (delete-on-cascade helper).
- Create: `server/src/memory/memory.module.ts` — exports both services.
- Create: `server/src/agentos/analyst-schema.ts` — zod `analystSchema` (+ `MemoryData` shape for the GET endpoint).
- Create: `server/src/agentos/analyst.service.ts` — `AnalystService.settle()` (functionCalling structured output → persist → void). Includes per-novel in-memory settle lock.
- Modify: `server/src/agentos/context-assembler.service.ts` — inject recent summaries + open hooks into Writer prompt.
- Create: `server/src/agentos/tools/query-memory.tool.ts` — `makeQueryMemoryTool`.
- Modify: `server/src/agentos/tools/write-chapter.tool.ts` — return `{ ok, chapterOrder, chapterId }`.
- Modify: `server/src/agentos/workspace-swarm.service.ts` — inject `AnalystService` + `PrismaService`; add `query_memory` to writer; detect `write_chapter` ToolMessage; **fire-and-forget** `analyst.settle()`. NO new stream frames.
- Modify: `server/src/novel/novel.controller.ts` + `novel.service.ts` — `GET /novels/:id/chapters/:order/summary` (rebuild `MemoryData`); chapter delete → cascade-clean StoryEvents.
- Modify: `server/src/agentos/agentos.module.ts` — import `MemoryModule`; provide `AnalystService`.
- Tests: `server/src/memory/chapter-summary.service.spec.ts`, `server/src/memory/story-event.service.spec.ts`, `server/src/agentos/context-assembler.memory.spec.ts`, `server/src/agentos/tools/query-memory.tool.spec.ts`, `server/src/novel/novel.memory-endpoint.spec.ts`.

**Frontend (agent-ui/):**
- Modify: `agent-ui/src/types/os.ts` — `MemoryData` + `memory?: MemoryData` on `ChatMessage`.
- Modify: `agent-ui/src/api/novels.ts` — `getChapterMemory(...)`.
- Create: `agent-ui/src/hooks/useChapterMemory.ts` — polling hook (4s interval, 60s timeout, settled/timeout states).
- Create: `agent-ui/src/components/chat/ChatArea/Messages/MemoryBubble.tsx` — collapsible 4-group display + "结算中" placeholder.
- Modify: `agent-ui/src/components/chat/ChatArea/Messages/MessageItem.tsx` — render `<MemoryBubble>` under agent messages.
- Modify: `agent-ui/src/app/novels/[id]/page.tsx` — after a write turn, drive the polling + attach memory to the last agent message.

> **No changes** to `useAIStreamHandler.tsx`, `store.ts` (no pendingMemory/isSettling), or `ChatInput.tsx` (input never disabled — async). This is the key simplification over v1.

---

## Notes for the implementer

- **Prisma 7 is config-driven** (`server/prisma.config.ts`). Migrate with `pnpm prisma migrate dev --name <name>` from `server/` — **no `--schema` flag**.
- **LangGraph checkpoint tables live in `agent_memory` schema; Prisma manages only `public`.** New tables go in `public` (default). After `migrate dev`, inspect the SQL — it must only touch `public` and never mention `agent_memory`. If `agent_memory` drift appears, STOP.
- **CRITICAL — structured output method:** `AnalystService` MUST call `model.withStructuredOutput(schema, { method: 'functionCalling' })`. The default method (no option) hangs 5 minutes on the z.ai coding endpoint (spike-confirmed). `jsonSchema`/`jsonMode` also fail. Do not omit the option.
- **CRITICAL — fire-and-forget, never await settle in the stream:** `void this.analyst.settle({...}).catch(log)`. Awaiting would block RunCompleted for ~16-32s.
- **`as never` boundary cast** for every tool passed to `createReactAgent` (dual-package .d.ts friction). Mirror [workspace-swarm.service.ts](../../server/src/agentos/workspace-swarm.service.ts).
- **ESM dynamic imports:** `ChatOpenAI` via `await import('@langchain/openai')` inside the method.
- **Tests do NOT mock the LLM.** Pure seams (services, ContextAssembler memory-slice assembly, query_memory search, GET endpoint assembly) get jest tests. `AnalystService`'s LLM call is exercised only manually (spike already proved it works).
- **Commit after every task.** Backend gate: `cd server && pnpm typecheck && pnpm test`. Frontend gate: `cd agent-ui && pnpm typecheck && pnpm validate`.

---

# Task 1: Data model — `ChapterSummary` + `StoryEvent`

**Files:**
- Modify: `server/prisma/schema.prisma`

- [ ] **Step 1: Add models + enum**

Open `server/prisma/schema.prisma`. In `Chapter`, add reverse relation: `summary ChapterSummary?`. In `Novel`, add: `events StoryEvent[]`. Append at end:

```prisma
model ChapterSummary {
  id          String   @id @default(cuid())
  chapterId   String   @unique
  chapter     Chapter  @relation(fields: [chapterId], references: [id], onDelete: Cascade)
  novelId     String
  summary     String   @default("")
  roleChanges Json     @default("[]")
  entities    Json     @default("[]")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @default(now())

  @@index([novelId])
}

model StoryEvent {
  id                String      @id @default(cuid())
  novelId           String
  novel             Novel       @relation(fields: [novelId], references: [id], onDelete: Cascade)
  description       String
  status            EventStatus @default(OPEN)
  openedAtChapter   Int?
  resolvedAtChapter Int?
  createdAt         DateTime    @default(now())
  updatedAt         DateTime    @default(now())

  @@index([novelId, status])
}

enum EventStatus {
  OPEN
  RESOLVED
}
```

- [ ] **Step 2: Migrate**

Run (from `server/`):
```sh
cd server && pnpm prisma migrate dev --name add_analyst_tables
```
Inspect generated SQL — only `public` (`"ChapterSummary"`, `"StoryEvent"`, `"EventStatus"`), NO `agent_memory`. If drift appears, STOP.

- [ ] **Step 3: typecheck**

Run: `cd server && pnpm typecheck`
Expected: clean.

- [ ] **Step 4: Commit**
```sh
git add server/prisma/schema.prisma server/prisma/migrations server/src/prisma
git commit -m "feat(server): add ChapterSummary + StoryEvent tables (Analyst data model)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 2: `SummaryService`

**Files:**
- Create: `server/src/memory/chapter-summary.service.ts`
- Test: `server/src/memory/chapter-summary.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `server/src/memory/chapter-summary.service.spec.ts`:

```ts
import { SummaryService } from './chapter-summary.service';
import type { PrismaService } from '../prisma/prisma.service';

interface PrismaMock {
  chapterSummary: { upsert: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock };
}
const makePrismaMock = (): PrismaMock => ({
  chapterSummary: { upsert: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
});

describe('SummaryService', () => {
  it('upserts by chapterId with merged JSON fields', async () => {
    const prisma = makePrismaMock();
    prisma.chapterSummary.upsert.mockResolvedValue({ id: 's1' });
    const svc = new SummaryService(prisma as unknown as PrismaService);
    await svc.upsert({
      userId: 'u1', novelId: 'n1', chapterId: 'c1', summary: '主角下山',
      roleChanges: [{ name: '陈平安', change: '觉醒' }],
      entities: [{ type: 'item', name: '剑', note: '所得' }],
    });
    expect(prisma.chapterSummary.upsert).toHaveBeenCalledWith({
      where: { chapterId: 'c1' },
      create: { chapterId: 'c1', novelId: 'n1', summary: '主角下山',
        roleChanges: [{ name: '陈平安', change: '觉醒' }],
        entities: [{ type: 'item', name: '剑', note: '所得' }] },
      update: { novelId: 'n1', summary: '主角下山',
        roleChanges: [{ name: '陈平安', change: '觉醒' }],
        entities: [{ type: 'item', name: '剑', note: '所得' }] },
    });
  });

  it('findByChapter returns null when absent, the row when present', async () => {
    const prisma = makePrismaMock();
    prisma.chapterSummary.findFirst.mockResolvedValue({ id: 's1', summary: 'x' });
    const svc = new SummaryService(prisma as unknown as PrismaService);
    const got = await svc.findByChapter('u1', 'n1', 'c1');
    expect(prisma.chapterSummary.findFirst).toHaveBeenCalledWith({
      where: { chapterId: 'c1', novel: { userId: 'u1' } },
    });
    expect(got).toEqual({ id: 's1', summary: 'x' });
  });

  it('listRecent returns N summaries ordered by chapter order desc', async () => {
    const prisma = makePrismaMock();
    prisma.chapterSummary.findMany.mockResolvedValue([
      { summary: '第3章', chapter: { order: 3 } },
      { summary: '第2章', chapter: { order: 2 } },
    ]);
    const svc = new SummaryService(prisma as unknown as PrismaService);
    const rows = await svc.listRecent('u1', 'n1', 5);
    expect(prisma.chapterSummary.findMany).toHaveBeenCalledWith({
      where: { novelId: 'n1', chapter: { novel: { userId: 'u1' } } },
      take: 5, orderBy: { chapter: { order: 'desc' } },
      select: { summary: true, chapter: { select: { order: true } } },
    });
    expect(rows).toEqual([
      { summary: '第3章', chapterOrder: 3 },
      { summary: '第2章', chapterOrder: 2 },
    ]);
  });
});
```

- [ ] **Step 2: Run — FAIL**

Run: `cd server && pnpm test -- chapter-summary.service.spec.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `server/src/memory/chapter-summary.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface RoleChange { name: string; change: string; }
export interface EntityFact { type: 'item' | 'place' | 'setting'; name: string; note: string; }

@Injectable()
export class SummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(args: {
    userId: string; novelId: string; chapterId: string;
    summary: string; roleChanges: RoleChange[]; entities: EntityFact[];
  }): Promise<void> {
    const { novelId, chapterId, summary, roleChanges, entities } = args;
    await this.prisma.chapterSummary.upsert({
      where: { chapterId },
      create: { chapterId, novelId, summary, roleChanges, entities },
      update: { novelId, summary, roleChanges, entities },
    });
  }

  /** GET 端点用:按 chapterId 取本章已结算的事实(null=未结算)。 */
  findByChapter(userId: string, novelId: string, chapterId: string) {
    return this.prisma.chapterSummary.findFirst({
      where: { chapterId, novel: { userId } },
    });
  }

  /** 最近 N 章摘要(按章节序号倒序),供 ContextAssembler 注入【前情】。 */
  async listRecent(
    userId: string, novelId: string, limit: number,
  ): Promise<Array<{ summary: string; chapterOrder: number }>> {
    const rows = await this.prisma.chapterSummary.findMany({
      where: { novelId, chapter: { novel: { userId } } },
      take: limit, orderBy: { chapter: { order: 'desc' } },
      select: { summary: true, chapter: { select: { order: true } } },
    });
    return rows.map((r) => ({ summary: r.summary, chapterOrder: r.chapter.order }));
  }
}
```

- [ ] **Step 4: Run — PASS**

Run: `cd server && pnpm test -- chapter-summary.service.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**
```sh
git add server/src/memory/chapter-summary.service.ts server/src/memory/chapter-summary.service.spec.ts
git commit -m "feat(memory): SummaryService — upsert / findByChapter / listRecent

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 3: `StoryEventService` (+ chapter-delete cascade helper)

**Files:**
- Create: `server/src/memory/story-event.service.ts`
- Test: `server/src/memory/story-event.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `server/src/memory/story-event.service.spec.ts`:

```ts
import { StoryEventService } from './story-event.service';
import type { PrismaService } from '../prisma/prisma.service';

interface PrismaMock {
  storyEvent: { findMany: jest.Mock; create: jest.Mock; update: jest.Mock; deleteMany: jest.Mock; updateMany: jest.Mock };
}
const makePrismaMock = (): PrismaMock => ({
  storyEvent: { findMany: jest.fn(), create: jest.fn(), update: jest.fn(), deleteMany: jest.fn(), updateMany: jest.fn() },
});

describe('StoryEventService', () => {
  it('listOpen returns OPEN hooks oldest first', async () => {
    const prisma = makePrismaMock();
    prisma.storyEvent.findMany.mockResolvedValue([{ id: 'e1', description: '黑影', openedAtChapter: 1 }]);
    const svc = new StoryEventService(prisma as unknown as PrismaService);
    const rows = await svc.listOpen('u1', 'n1');
    expect(prisma.storyEvent.findMany).toHaveBeenCalledWith({
      where: { novelId: 'n1', status: 'OPEN', novel: { userId: 'u1' } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, description: true, openedAtChapter: true },
    });
    expect(rows).toEqual([{ id: 'e1', description: '黑影', openedAtChapter: 1 }]);
  });

  it('createHooks makes one OPEN event per description, tagged with opening chapter', async () => {
    const prisma = makePrismaMock();
    const svc = new StoryEventService(prisma as unknown as PrismaService);
    await svc.createHooks('u1', 'n1', ['黑影', '钥匙'], 3);
    expect(prisma.storyEvent.create).toHaveBeenCalledTimes(2);
    expect(prisma.storyEvent.create).toHaveBeenNthCalledWith(1, {
      data: { novelId: 'n1', description: '黑影', status: 'OPEN', openedAtChapter: 3 },
    });
  });

  it('createHooks is a no-op for empty list', async () => {
    const prisma = makePrismaMock();
    const svc = new StoryEventService(prisma as unknown as PrismaService);
    await svc.createHooks('u1', 'n1', [], 3);
    expect(prisma.storyEvent.create).not.toHaveBeenCalled();
  });

  it('resolveHooks flips each id to RESOLVED with resolving chapter', async () => {
    const prisma = makePrismaMock();
    const svc = new StoryEventService(prisma as unknown as PrismaService);
    await svc.resolveHooks('u1', 'n1', ['e1', 'e2'], 3);
    expect(prisma.storyEvent.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.storyEvent.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'e1', novelId: 'n1', status: 'OPEN' },
      data: { status: 'RESOLVED', resolvedAtChapter: 3 },
    });
  });

  it('cleanupForChapter deletes opened-here events + reopens resolved-here events', async () => {
    const prisma = makePrismaMock();
    const svc = new StoryEventService(prisma as unknown as PrismaService);
    await svc.cleanupForChapter('u1', 'n1', 4);
    expect(prisma.storyEvent.deleteMany).toHaveBeenCalledWith({
      where: { novelId: 'n1', openedAtChapter: 4, novel: { userId: 'u1' } },
    });
    expect(prisma.storyEvent.updateMany).toHaveBeenCalledWith({
      where: { novelId: 'n1', resolvedAtChapter: 4, novel: { userId: 'u1' } },
      data: { status: 'OPEN', resolvedAtChapter: null },
    });
  });
});
```

- [ ] **Step 2: Run — FAIL**

Run: `cd server && pnpm test -- story-event.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `server/src/memory/story-event.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface OpenHook { id: string; description: string; openedAtChapter: number | null; }

@Injectable()
export class StoryEventService {
  constructor(private readonly prisma: PrismaService) {}

  listOpen(userId: string, novelId: string): Promise<OpenHook[]> {
    return this.prisma.storyEvent.findMany({
      where: { novelId, status: 'OPEN', novel: { userId } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, description: true, openedAtChapter: true },
    }) as Promise<OpenHook[]>;
  }

  async createHooks(userId: string, novelId: string, descriptions: string[], openedAtChapter: number): Promise<void> {
    for (const description of descriptions) {
      await this.prisma.storyEvent.create({
        data: { novelId, description, status: 'OPEN', openedAtChapter },
      });
    }
  }

  async resolveHooks(userId: string, novelId: string, ids: string[], resolvedAtChapter: number): Promise<void> {
    for (const id of ids) {
      // updateMany to compound-filter on (id + novelId + status) safely.
      await this.prisma.storyEvent.updateMany({
        where: { id, novelId, status: 'OPEN' },
        data: { status: 'RESOLVED', resolvedAtChapter },
      });
    }
  }

  /** 章节删除级联:埋于本章的事件删除;回收于本章的事件回退为 OPEN。 */
  async cleanupForChapter(userId: string, novelId: string, chapterOrder: number): Promise<void> {
    await this.prisma.storyEvent.deleteMany({
      where: { novelId, openedAtChapter: chapterOrder, novel: { userId } },
    });
    await this.prisma.storyEvent.updateMany({
      where: { novelId, resolvedAtChapter: chapterOrder, novel: { userId } },
      data: { status: 'OPEN', resolvedAtChapter: null },
    });
  }

  /** GET 端点用:取与某章相关的事件(埋于/回收于该章)。 */
  listForChapter(userId: string, novelId: string, chapterOrder: number) {
    return this.prisma.storyEvent.findMany({
      where: { novelId, novel: { userId }, OR: [{ openedAtChapter: chapterOrder }, { resolvedAtChapter: chapterOrder }] },
      orderBy: { createdAt: 'asc' },
      select: { id: true, description: true, openedAtChapter: true, resolvedAtChapter: true },
    });
  }
}
```

- [ ] **Step 4: Run — PASS**

Run: `cd server && pnpm test -- story-event.service.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: typecheck**

Run: `cd server && pnpm typecheck`
Expected: clean.

- [ ] **Step 6: Commit**
```sh
git add server/src/memory/story-event.service.ts server/src/memory/story-event.service.spec.ts
git commit -m "feat(memory): StoryEventService — list/create/resolve + chapter-cascade cleanup

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 4: `MemoryModule` + wire into AgentosModule

**Files:**
- Create: `server/src/memory/memory.module.ts`
- Modify: `server/src/agentos/agentos.module.ts`, `server/src/novel/novel.module.ts`

- [ ] **Step 1: Create MemoryModule**

Create `server/src/memory/memory.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { SummaryService } from './chapter-summary.service';
import { StoryEventService } from './story-event.service';

@Module({
  providers: [SummaryService, StoryEventService],
  exports: [SummaryService, StoryEventService],
})
export class MemoryModule {}
```

- [ ] **Step 2: Import MemoryModule into both AgentosModule and NovelModule**

`server/src/agentos/agentos.module.ts` — add `import { MemoryModule } from '../memory/memory.module';`, and `imports: [NovelModule, MemoryModule]`. (AnalystService provider added in Task 6.)

`server/src/novel/novel.module.ts` — add `import { MemoryModule } from '../memory/memory.module';`, add to `imports: [...]`, and **export nothing extra**. Also export `MemoryModule` re-export is not needed; instead, since the controller (Task 9) needs `SummaryService` + `StoryEventService`, import `MemoryModule` so NovelModule's providers (the controller) can inject them.

- [ ] **Step 3: typecheck**

Run: `cd server && pnpm typecheck`
Expected: clean.

- [ ] **Step 4: Commit**
```sh
git add server/src/memory/memory.module.ts server/src/agentos/agentos.module.ts server/src/novel/novel.module.ts
git commit -m "feat(memory): MemoryModule + wire into Agentos/Novel modules

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 5: Analyst zod schema + `MemoryData`

**Files:**
- Create: `server/src/agentos/analyst-schema.ts`

- [ ] **Step 1: Create schema + types**

Create `server/src/agentos/analyst-schema.ts`:

```ts
import { z } from 'zod';

/**
 * Analyst 结构化输出 schema。MUST 用 withStructuredOutput(schema, { method:'functionCalling' })
 * —— spike 证明这是 z.ai coding 端点唯一可用的 method。
 */
export const analystSchema = z.object({
  summary: z.string().describe('本章一句话情节摘要'),
  roleChanges: z.array(
    z.object({ name: z.string(), change: z.string().describe('状态变化') }),
  ),
  entities: z.array(
    z.object({
      type: z.enum(['item', 'place', 'setting']),
      name: z.string(),
      note: z.string().describe('一句话说明'),
    }),
  ),
  newHooks: z.array(z.string().describe('本章新埋下的伏笔描述')),
  resolvedHookIds: z.array(z.string().describe('从输入的 OPEN 伏笔列表里,本章回收了的 id')),
});
export type AnalystOutput = z.infer<typeof analystSchema>;

/**
 * GET /novels/:id/chapters/:order/summary 返回的形状(从 DB 重建)。
 * settled=false → 前端继续轮询。
 */
export interface MemoryData {
  settled: boolean;
  chapterOrder: number;
  summary: string;
  roleChanges: { name: string; change: string }[];
  entities: { type: 'item' | 'place' | 'setting'; name: string; note: string }[];
  newHooks: { id: string; description: string }[];
  resolvedHooks: { id: string; description: string }[];
}
```

- [ ] **Step 2: typecheck**

Run: `cd server && pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Commit**
```sh
git add server/src/agentos/analyst-schema.ts
git commit -m "feat(agentos): analyst zod schema + MemoryData (DB-reconstructed shape)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 6: `AnalystService.settle` (functionCalling + void + settle lock)

**Files:**
- Create: `server/src/agentos/analyst.service.ts`

> No jest test (LLM call). Thin: read context → ONE structured call → persist via tested services. The structured-call method is spike-verified.

- [ ] **Step 1: Implement**

Create `server/src/agentos/analyst.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { GLM_BASE_URL, GLM_MODEL } from './agentos.constants';
import { analystSchema } from './analyst-schema';
import { SummaryService, type RoleChange, type EntityFact } from '../memory/chapter-summary.service';
import { StoryEventService } from '../memory/story-event.service';
import { ChapterService } from '../novel/chapter.service';
import { NovelService } from '../novel/novel.service';

interface NovelSettingsLite { style?: string; worldviewText?: string; }

/**
 * 非用户面向结算 Agent。write_chapter 落稿成功后 fire-and-forget 触发 settle()。
 * 单独 ChatOpenAI(temp 0.1),一次 withStructuredOutput(method:'functionCalling') 调用。
 * 按 userId 缓存 model;按 novelId 内存锁防并发结算。settle 绝不抛出(内部 try/catch)。
 */
@Injectable()
export class AnalystService {
  private readonly models = new Map<string, unknown>();
  private readonly settlingNovels = new Set<string>();

  constructor(
    private readonly chapters: ChapterService,
    private readonly novels: NovelService,
    private readonly summaries: SummaryService,
    private readonly events: StoryEventService,
  ) {}

  private async getModel(userId: string) {
    const cached = this.models.get(userId);
    if (cached) return cached;
    const { ChatOpenAI } = await import('@langchain/openai');
    const apiKey = process.env.ZHIPUAI_API_KEY;
    if (!apiKey) throw new Error('ZHIPUAI_API_KEY is not set');
    const model = new ChatOpenAI({
      apiKey, model: GLM_MODEL, temperature: 0.1,
      configuration: { baseURL: GLM_BASE_URL },
      timeout: 90_000, maxRetries: 0,
    });
    this.models.set(userId, model);
    return model;
  }

  async settle(args: { userId: string; novelId: string; chapterOrder: number }): Promise<void> {
    const { userId, novelId, chapterOrder } = args;
    // 并发锁:同一小说同一时间只跑一个结算。
    if (this.settlingNovels.has(novelId)) return;
    this.settlingNovels.add(novelId);
    try {
      await this.doSettle(userId, novelId, chapterOrder);
    } catch (err) {
      console.error(
        `[agentos] analyst settle failed (novel ${novelId} ch${chapterOrder}):`,
        err instanceof Error ? err.message : err,
      );
    } finally {
      this.settlingNovels.delete(novelId);
    }
  }

  private async doSettle(userId: string, novelId: string, chapterOrder: number): Promise<void> {
    const chapter = await this.chapters.findByOrder(userId, novelId, chapterOrder);
    if (!chapter) return; // 章节已不在(被删/越权),静默退出
    const content = chapter.content ?? '';

    const novel = await this.novels.get(userId, novelId);
    const settings = (novel.settings ?? {}) as NovelSettingsLite;
    const openHooks = await this.events.listOpen(userId, novelId);

    const model = await this.getModel(userId);
    const structured = (model as {
      withStructuredOutput: (s: typeof analystSchema, opts: { method: string }) => {
        invoke: (m: Array<{ role: string; content: string }>) => Promise<unknown>;
      };
    }).withStructuredOutput(analystSchema, { method: 'functionCalling' });

    const result = (await structured.invoke([
      {
        role: 'system',
        content:
          '你是小说一致性记账员。阅读本章正文,严谨提取事实(客观、不编造)。' +
          'resolvedHookIds 只能从下面给出的 OPEN 伏笔 id 里挑本章确实回收了的;没回收就返回空数组。',
      },
      {
        role: 'user',
        content:
          `【书名】${novel.title}\n【类型】${novel.genre ?? '未指定'}\n` +
          `【简介】${novel.synopsis ?? '未指定'}\n【世界观】${settings.worldviewText ?? '未指定'}\n` +
          `【文风】${settings.style ?? '未指定'}\n\n【本章序号】第${chapterOrder}章\n` +
          `【OPEN 伏笔(仅可从中挑选回收)】\n` +
          (openHooks.length ? openHooks.map((h) => `- id=${h.id}: ${h.description}`).join('\n') : '(无)') +
          `\n\n【本章正文】\n${content}`,
      },
    ])) as { summary: string; roleChanges: RoleChange[]; entities: EntityFact[]; newHooks: string[]; resolvedHookIds: string[] };

    await this.summaries.upsert({
      userId, novelId, chapterId: chapter.id,
      summary: result.summary, roleChanges: result.roleChanges, entities: result.entities,
    });
    await this.events.createHooks(userId, novelId, result.newHooks, chapterOrder);
    await this.events.resolveHooks(userId, novelId, result.resolvedHookIds, chapterOrder);
  }
}
```

- [ ] **Step 2: Provide in AgentosModule**

`server/src/agentos/agentos.module.ts` — add `import { AnalystService } from './analyst.service';` and add `AnalystService` to `providers`.

- [ ] **Step 3: typecheck + full test**

Run: `cd server && pnpm typecheck && pnpm test`
Expected: clean + green.

- [ ] **Step 4: Commit**
```sh
git add server/src/agentos/analyst.service.ts server/src/agentos/agentos.module.ts
git commit -m "feat(agentos): AnalystService — async settle (functionCalling, void, per-novel lock)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 7: `write_chapter` returns `chapterId`

**Files:**
- Modify: `server/src/agentos/tools/write-chapter.tool.ts`

- [ ] **Step 1: Add chapterId to return**

Open `server/src/agentos/tools/write-chapter.tool.ts`. The tool already resolves `chapter` via `findOrCreateByOrder`. Change the return object (currently `{ ok, message }`) to:

```ts
      return {
        ok: true as const,
        chapterOrder,
        chapterId: chapter.id,
        message: `已${op === 'append' ? '追加到' : '重写'}第 ${chapterOrder} 章。`,
      };
```

- [ ] **Step 2: typecheck + test**

Run: `cd server && pnpm typecheck && pnpm test`
Expected: clean + green.

- [ ] **Step 3: Commit**
```sh
git add server/src/agentos/tools/write-chapter.tool.ts
git commit -m "feat(agentos): write_chapter returns chapterId for settlement detection

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 8: ContextAssembler memory injection

**Files:**
- Modify: `server/src/agentos/context-assembler.service.ts`
- Test: `server/src/agentos/context-assembler.memory.spec.ts`
- May modify: `server/src/agentos/context-assembler.service.spec.ts` (existing — update constructor call)

- [ ] **Step 1: Write the failing test**

Create `server/src/agentos/context-assembler.memory.spec.ts`:

```ts
import { ContextAssembler } from './context-assembler.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SummaryService } from '../memory/chapter-summary.service';
import type { StoryEventService } from '../memory/story-event.service';

const novelRow = () => ({
  id: 'n1', title: '剑来', genre: '仙侠', synopsis: '少年下山',
  settings: { worldviewText: '剑修世界', style: '沉稳' }, status: 'ACTIVE',
});

const SYSTEM_PROMPT = 'You are a helpful, concise assistant. Reply in the same language as the user.';

describe('ContextAssembler memory injection', () => {
  it('injects recent summaries + open hooks into an ACTIVE prompt', async () => {
    const prisma = { novel: { findFirst: jest.fn().mockResolvedValue(novelRow()) } };
    const summaries = { listRecent: jest.fn().mockResolvedValue([
      { summary: '主角觉醒', chapterOrder: 2 }, { summary: '主角下山', chapterOrder: 1 },
    ]) };
    const events = { listOpen: jest.fn().mockResolvedValue([
      { id: 'e1', description: '黑影身份', openedAtChapter: 1 },
    ]) };
    const asm = new ContextAssembler(
      prisma as unknown as PrismaService,
      summaries as unknown as SummaryService,
      events as unknown as StoryEventService,
    );
    const { prompt, novelId } = await asm.forSession('u1', 's1');
    expect(novelId).toBe('n1');
    expect(summaries.listRecent).toHaveBeenCalledWith('u1', 'n1', 5);
    expect(events.listOpen).toHaveBeenCalledWith('u1', 'n1');
    expect(prompt).toContain('【前情】');
    expect(prompt).toContain('第1章:主角下山');
    expect(prompt).toContain('第2章:主角觉醒');
    expect(prompt).toContain('【未回收伏笔】');
    expect(prompt).toContain('黑影身份');
  });

  it('omits memory slices when none exist', async () => {
    const prisma = { novel: { findFirst: jest.fn().mockResolvedValue(novelRow()) } };
    const summaries = { listRecent: jest.fn().mockResolvedValue([]) };
    const events = { listOpen: jest.fn().mockResolvedValue([]) };
    const asm = new ContextAssembler(
      prisma as unknown as PrismaService,
      summaries as unknown as SummaryService,
      events as unknown as StoryEventService,
    );
    const { prompt } = await asm.forSession('u1', 's1');
    expect(prompt).not.toContain('【前情】');
    expect(prompt).not.toContain('【未回收伏笔】');
  });

  it('falls back to SYSTEM_PROMPT + null novelId when novel lookup misses', async () => {
    const prisma = { novel: { findFirst: jest.fn().mockResolvedValue(null) } };
    const summaries = { listRecent: jest.fn() };
    const events = { listOpen: jest.fn() };
    const asm = new ContextAssembler(
      prisma as unknown as PrismaService,
      summaries as unknown as SummaryService,
      events as unknown as StoryEventService,
    );
    const { prompt, novelId } = await asm.forSession('u1', 's1');
    expect(novelId).toBeNull();
    expect(summaries.listRecent).not.toHaveBeenCalled();
    expect(prompt).toBe(SYSTEM_PROMPT);
  });
});
```

- [ ] **Step 2: Run — FAIL**

Run: `cd server && pnpm test -- context-assembler.memory.spec.ts`
Expected: FAIL (constructor signature).

- [ ] **Step 3: Modify the service**

Open `server/src/agentos/context-assembler.service.ts`. Full new content:

```ts
import { Injectable } from '@nestjs/common';
import { SYSTEM_PROMPT } from './agentos.constants';
import { PrismaService } from '../prisma/prisma.service';
import { SummaryService } from '../memory/chapter-summary.service';
import { StoryEventService } from '../memory/story-event.service';

interface NovelPromptInput { title: string; genre: string | null; synopsis: string | null; settings?: unknown; }
interface NovelSettings { style?: string; language?: string; worldviewText?: string; }

@Injectable()
export class ContextAssembler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly summaries: SummaryService,
    private readonly events: StoryEventService,
  ) {}

  buildSystemPrompt(novel: NovelPromptInput, status?: string): string {
    const raw = novel.settings;
    const s: NovelSettings = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const lines = [
      '你是一位资深小说写作助手，与作者协作创作一部小说。遵循作者的意图，用自然、连贯的中文正文回复；正文只输出小说内容本身，不要加解说或meta说明。',
      '',
      `【书名】${novel.title}`,
    ];
    if (novel.genre) lines.push(`【类型】${novel.genre}`);
    if (novel.synopsis) lines.push(`【简介】${novel.synopsis}`);
    if (s.worldviewText) lines.push(`【世界观/设定】${s.worldviewText}`);
    if (s.style) lines.push(`【文风】${s.style}`);
    if (s.language) lines.push(`【语言】${s.language}`);
    lines.push('');
    lines.push('规则:不要编造与设定冲突的情节;保持人物与已有内容一致。');
    if (status === 'CONCEPT') {
      lines.push('');
      lines.push(
        '【状态】立项中——基础信息不全。需要收集以下 5 项基础信息(对应 update_novel 参数):\n1. 书名(title)\n2. 类型/题材(genre)\n3. 简介/故事核心(synopsis)——一两句话概括这本小说讲什么\n4. 世界观/设定(worldviewText)\n5. 文风(style)\n\n工作方式:\n- 开场白已在聊天中;用户回复后先调 get_novel_info 查看已收集的信息和缺失字段(missing 列表)。\n- 根据 missing 列表追问缺失项;每轮调 update_novel 更新(把你目前已知的所有字段都填进去)。\n- 5 项都收集齐(missing 为空)后 transfer_to_writer。\n- 不要重新打招呼。',
      );
    } else {
      lines.push('');
      lines.push('【状态】写作中——信息已齐。作者要写正文时,用 transfer_to_writer 转交写作 Agent。');
    }
    return lines.join('\n');
  }

  async forSession(userId: string, sessionId: string): Promise<{ prompt: string; novelId: string | null }> {
    const novel = await this.prisma.novel.findFirst({
      where: { sessionId, userId },
      select: { title: true, genre: true, synopsis: true, settings: true, id: true, status: true },
    });
    if (!novel) return { prompt: SYSTEM_PROMPT, novelId: null };

    const base = this.buildSystemPrompt(novel, novel.status);
    const recent = await this.summaries.listRecent(userId, novel.id, 5);
    const openHooks = await this.events.listOpen(userId, novel.id);

    const slices: string[] = [];
    if (recent.length) {
      const recap = recent.slice().reverse().map((r) => `第${r.chapterOrder}章:${r.summary}`).join(' / ');
      slices.push(`【前情】${recap}`);
    }
    if (openHooks.length) {
      slices.push(`【未回收伏笔】${openHooks.map((h) => h.description).join(' · ')}`);
    }
    if (!slices.length) return { prompt: base, novelId: novel.id };

    const marker = '规则:不要编造与设定冲突的情节';
    const idx = base.indexOf(marker);
    if (idx === -1) return { prompt: base, novelId: novel.id };
    return { prompt: base.slice(0, idx) + slices.join('\n') + '\n' + base.slice(idx), novelId: novel.id };
  }
}
```

- [ ] **Step 4: Run — PASS**

Run: `cd server && pnpm test -- context-assembler.memory.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Fix the existing context-assembler.service.spec.ts if it breaks**

Run: `cd server && pnpm test -- context-assembler.service.spec.ts`
If it FAILS on `new ContextAssembler(...)` (old 1-arg signature), update every construction in that file to:
```ts
const summaries = { listRecent: jest.fn().mockResolvedValue([]) } as unknown as SummaryService;
const events = { listOpen: jest.fn().mockResolvedValue([]) } as unknown as StoryEventService;
new ContextAssembler(prisma, summaries, events);
```
(add the imports for the two service types as type-only). Re-run until green.

- [ ] **Step 6: typecheck**

Run: `cd server && pnpm typecheck`
Expected: clean.

- [ ] **Step 7: Commit**
```sh
git add server/src/agentos/context-assembler.service.ts server/src/agentos/context-assembler.memory.spec.ts server/src/agentos/context-assembler.service.spec.ts
git commit -m "feat(agentos): inject recent summaries + open hooks into Writer prompt

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 9: `query_memory` read-tool

**Files:**
- Create: `server/src/agentos/tools/query-memory.tool.ts`
- Test: `server/src/agentos/tools/query-memory.tool.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `server/src/agentos/tools/query-memory.tool.spec.ts`:

```ts
import { makeQueryMemoryTool } from './query-memory.tool';
import { PrismaService } from '../../prisma/prisma.service';

const invoke = (t: unknown) => (t as { invoke: (a: unknown) => Promise<unknown> }).invoke.bind(t);

describe('query_memory tool', () => {
  it('returns matching summaries + hooks by keyword (contains, both when kind omitted)', async () => {
    const prisma = {
      chapterSummary: { findMany: jest.fn().mockResolvedValue([{ summary: '陈平安觉醒剑修', chapter: { order: 2 } }]) },
      storyEvent: { findMany: jest.fn().mockResolvedValue([{ id: 'e1', description: '陈平安的身世', status: 'OPEN' }]) },
    };
    const tool = makeQueryMemoryTool({ userId: 'u1', novelId: 'n1', prisma: prisma as unknown as PrismaService });
    const out = (await invoke(tool)({ query: '陈平安' })) as { summaries: unknown[]; hooks: unknown[] };
    expect(prisma.chapterSummary.findMany).toHaveBeenCalled();
    expect(out.summaries).toEqual([{ chapterOrder: 2, summary: '陈平安觉醒剑修' }]);
    expect(out.hooks).toEqual([{ id: 'e1', description: '陈平安的身世', status: 'OPEN' }]);
  });

  it('kind=hook searches only hooks', async () => {
    const prisma = {
      chapterSummary: { findMany: jest.fn() },
      storyEvent: { findMany: jest.fn().mockResolvedValue([{ id: 'e1', description: '钥匙', status: 'OPEN' }]) },
    };
    const tool = makeQueryMemoryTool({ userId: 'u1', novelId: 'n1', prisma: prisma as unknown as PrismaService });
    const out = (await invoke(tool)({ query: '钥匙', kind: 'hook' })) as { summaries: unknown[]; hooks: unknown[] };
    expect(prisma.chapterSummary.findMany).not.toHaveBeenCalled();
    expect(out.hooks).toHaveLength(1);
  });

  it('empty query returns empty arrays', async () => {
    const prisma = { chapterSummary: { findMany: jest.fn() }, storyEvent: { findMany: jest.fn() } };
    const tool = makeQueryMemoryTool({ userId: 'u1', novelId: 'n1', prisma: prisma as unknown as PrismaService });
    const out = (await invoke(tool)({ query: '   ' })) as { summaries: unknown[]; hooks: unknown[] };
    expect(prisma.chapterSummary.findMany).not.toHaveBeenCalled();
    expect(out).toEqual({ summaries: [], hooks: [] });
  });
});
```

- [ ] **Step 2: Run — FAIL**

Run: `cd server && pnpm test -- query-memory.tool.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `server/src/agentos/tools/query-memory.tool.ts`:

```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Writer 的主动记忆检索(只读)。关键词在 章节摘要/角色变化/物品设定/伏笔 里 contains 匹配。
 * userId/novelId 闭包注入。kind 省略 → 同时搜 summary + hook。P2 只做关键词。
 */
export function makeQueryMemoryTool({
  userId,
  novelId,
  prisma,
}: {
  userId: string;
  novelId: string;
  prisma: PrismaService;
}) {
  return tool(
    async ({ query, kind }) => {
      const q = query.trim();
      if (!q) return { summaries: [], hooks: [] };
      const wantSummary = !kind || kind === 'summary' || kind === 'role' || kind === 'entity';
      const wantHook = !kind || kind === 'hook';

      let summaries: Array<{ chapterOrder: number; summary: string }> = [];
      if (wantSummary) {
        const rows = await prisma.chapterSummary.findMany({
          where: {
            novelId, chapter: { novel: { userId } },
            OR: [
              { summary: { contains: q, mode: 'insensitive' } },
              { roleChanges: { string_contains: q } },
              { entities: { string_contains: q } },
            ],
          },
          take: 10, orderBy: { chapter: { order: 'desc' } },
          select: { summary: true, chapter: { select: { order: true } } },
        });
        summaries = rows.map((r) => ({ chapterOrder: r.chapter.order, summary: r.summary }));
      }

      let hooks: Array<{ id: string; description: string; status: string }> = [];
      if (wantHook) {
        const rows = await prisma.storyEvent.findMany({
          where: { novelId, novel: { userId }, description: { contains: q, mode: 'insensitive' } },
          take: 10, orderBy: { createdAt: 'asc' },
          select: { id: true, description: true, status: true },
        });
        hooks = rows.map((r) => ({ id: r.id, description: r.description, status: r.status }));
      }
      return { summaries, hooks };
    },
    {
      name: 'query_memory',
      description:
        '按关键词检索已记住的事实:章节摘要/角色变化/物品设定(role·entity·summary)与伏笔(hook)。写涉及已有角色/伏笔的章节前先调用核实。',
      schema: z.object({
        query: z.string().describe('关键词,如角色名、物品名、伏笔描述片段'),
        kind: z.enum(['role', 'hook', 'entity', 'summary']).optional().describe('限定检索维度;省略则同时搜摘要与伏笔'),
      }),
    },
  );
}
```

- [ ] **Step 4: Run — PASS**

Run: `cd server && pnpm test -- query-memory.tool.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: typecheck (resolve JSON-filter typing if needed)**

Run: `cd server && pnpm typecheck`
If `roleChanges: { string_contains }` / `mode: 'insensitive'` type-errors, cast the `findMany` `where` to `as never` at the call site. Prefer typed; only cast if it fails.

- [ ] **Step 6: Commit**
```sh
git add server/src/agentos/tools/query-memory.tool.ts server/src/agentos/tools/query-memory.tool.spec.ts
git commit -m "feat(agentos): query_memory read-tool (keyword search over summaries + hooks)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 10: Wire Analyst + query_memory into the swarm; **fire-and-forget** settle

**Files:**
- Modify: `server/src/agentos/workspace-swarm.service.ts`

> No new stream frames. No controller changes. The settle is fire-and-forget; `streamTurn` returns as before (controller emits RunCompleted normally). No jest test (LLM-bound integration); verified by typecheck + manual run.

- [ ] **Step 1: Extend constructor + add query_memory to writer + fire-and-forget settle**

Open `server/src/agentos/workspace-swarm.service.ts`.

**a) Imports** (after existing imports):
```ts
import { PrismaService } from '../prisma/prisma.service';
import { AnalystService } from './analyst.service';
import { makeQueryMemoryTool } from './tools/query-memory.tool';
```

**b) Constructor** — add deps:
```ts
  constructor(
    @Optional()
    @Inject(CHECKPOINTER)
    private readonly checkpointer?: BaseCheckpointSaver,
    private readonly registry?: ResourceRegistry,
    private readonly chapters?: ChapterService,
    private readonly novels?: NovelService,
    private readonly analyst?: AnalystService,
    private readonly prisma?: PrismaService,
  ) {}
```

**c) In `getSwarm`**, guard prisma (near the other guards) and add `query_memory` to the writer's `tools` array (after `makeWriteChapterTool(...)`):
```ts
    if (!this.prisma) {
      throw new Error('PrismaService not wired');
    }
```
```ts
        tools: [
          makeListChaptersTool({ userId, novelId, chapters: this.chapters }) as never,
          makeWriteChapterTool({ userId, novelId, chapters: this.chapters, registry: this.registry, novels: this.novels }) as never,
          makeQueryMemoryTool({ userId, novelId, prisma: this.prisma }) as never,
          createHandoffTool({ agentName: 'main' }),
        ],
```

**d) `streamTurn`** — keep the existing AIMessage tool_call detection (WritingChapter). ADD ToolMessage-result detection, and fire-and-forget settle after the stream. Replace the method body:

```ts
  async *streamTurn({
    userId, novelId, threadId, userMessage, systemPrompt,
  }: {
    userId: string; novelId: string; threadId: string; userMessage: string; systemPrompt: string;
  }): AsyncGenerator<string | { type: 'writing-chapter'; order: number }> {
    const swarm = await this.getSwarm(userId, novelId, systemPrompt);
    const stream = await swarm.stream(
      { messages: [{ role: 'user', content: userMessage }] },
      { configurable: { thread_id: threadId }, streamMode: 'messages' },
    );

    let settledChapterOrder: number | null = null;

    for await (const chunk of stream) {
      const msg = (Array.isArray(chunk) ? chunk[0] : chunk) as {
        tool_calls?: Array<{ name: string; args?: { chapterOrder?: number } }>;
        name?: string;
        content?: string;
      };

      // AIMessage 决定写 → 通知前端骨架。
      if (msg?.tool_calls) {
        for (const tc of msg.tool_calls) {
          if (tc.name === 'write_chapter' && typeof tc.args?.chapterOrder === 'number') {
            yield { type: 'writing-chapter', order: tc.args.chapterOrder };
          }
        }
      }

      // ToolMessage = write_chapter 返回结果。ok:true → 记下要结算的章。
      if (msg?.name === 'write_chapter' && typeof msg.content === 'string') {
        try {
          const parsed = JSON.parse(msg.content) as { ok?: boolean; chapterOrder?: number };
          if (parsed.ok === true && typeof parsed.chapterOrder === 'number') {
            settledChapterOrder = parsed.chapterOrder;
          }
        } catch { /* 非 JSON 内容,忽略 */ }
      }

      const delta = extractDelta(chunk);
      if (delta) yield delta;
    }

    // 正文流结束 + 本轮确有成功写章 → 异步结算(fire-and-forget,不 await,不阻塞 RunCompleted)。
    if (settledChapterOrder !== null && this.analyst) {
      void this.analyst.settle({ userId, novelId, chapterOrder: settledChapterOrder }).catch((e) =>
        console.error('[agentos] analyst settle dispatcher failed:', e instanceof Error ? e.message : e),
      );
    }
  }
```

> The return type stays `AsyncGenerator<string | { type: 'writing-chapter'; order: number }>` — **no new frame types**. The controller is unchanged: it already iterates and emits RunContent/WritingChapter/RunCompleted.

- [ ] **Step 2: typecheck + full test + build**

Run: `cd server && pnpm typecheck && pnpm test && pnpm build`
Expected: clean + green + built.

- [ ] **Step 3: Commit**
```sh
git add server/src/agentos/workspace-swarm.service.ts
git commit -m "feat(agentos): fire-and-forget Analyst settle + query_memory tool in writer

Detect write_chapter ToolMessage result, then void analyst.settle() (not awaited).
Writer gains query_memory. No new stream frames.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 11: `GET /novels/:id/chapters/:order/summary` endpoint (rebuild MemoryData) + chapter-delete cascade

**Files:**
- Modify: `server/src/novel/novel.controller.ts`
- Modify: `server/src/novel/novel.service.ts`
- Test: `server/src/novel/novel.memory-endpoint.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `server/src/novel/novel.memory-endpoint.spec.ts`:

```ts
import { NovelService } from './novel.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ResourceRegistry } from '../resources/resource-registry';
import type { SummaryService } from '../memory/chapter-summary.service';
import type { StoryEventService } from '../memory/story-event.service';

describe('NovelService.getChapterMemory', () => {
  it('returns settled:false when no summary exists for the chapter', async () => {
    const prisma = { novel: { findFirst: jest.fn().mockResolvedValue({ id: 'n1' }) }, chapter: { findFirst: jest.fn().mockResolvedValue({ id: 'c1' }) } };
    const registry = {} as unknown as ResourceRegistry;
    const summaries = { findByChapter: jest.fn().mockResolvedValue(null) } as unknown as SummaryService;
    const events = { listForChapter: jest.fn() } as unknown as StoryEventService;
    const svc = new NovelService(prisma as unknown as PrismaService, registry, summaries, events);
    const out = await svc.getChapterMemory('u1', 'n1', 3);
    expect(out).toEqual({ settled: false, chapterOrder: 3, summary: '', roleChanges: [], entities: [], newHooks: [], resolvedHooks: [] });
  });

  it('rebuilds MemoryData from ChapterSummary + StoryEvents for the chapter', async () => {
    const prisma = { novel: { findFirst: jest.fn().mockResolvedValue({ id: 'n1' }) }, chapter: { findFirst: jest.fn().mockResolvedValue({ id: 'c1' }) } };
    const registry = {} as unknown as ResourceRegistry;
    const summaries = { findByChapter: jest.fn().mockResolvedValue({
      summary: '觉醒', roleChanges: [{ name: '陈平安', change: '觉醒' }],
      entities: [{ type: 'item', name: '剑', note: '所得' }],
    }) } as unknown as SummaryService;
    const events = { listForChapter: jest.fn().mockResolvedValue([
      { id: 'e1', description: '黑影', openedAtChapter: 3, resolvedAtChapter: null },
      { id: 'e2', description: '钥匙', openedAtChapter: 2, resolvedAtChapter: 3 },
    ]) } as unknown as StoryEventService;
    const svc = new NovelService(prisma as unknown as PrismaService, registry, summaries, events);
    const out = await svc.getChapterMemory('u1', 'n1', 3);
    expect(out.settled).toBe(true);
    expect(out.summary).toBe('觉醒');
    expect(out.roleChanges).toEqual([{ name: '陈平安', change: '觉醒' }]);
    expect(out.newHooks).toEqual([{ id: 'e1', description: '黑影' }]);
    expect(out.resolvedHooks).toEqual([{ id: 'e2', description: '钥匙' }]);
  });
});
```

- [ ] **Step 2: Run — FAIL**

Run: `cd server && pnpm test -- novel.memory-endpoint.spec.ts`
Expected: FAIL (NovelService constructor + method missing).

- [ ] **Step 3: Modify NovelService**

Open `server/src/novel/novel.service.ts`. Add imports + constructor deps + the method. Add at top:
```ts
import { SummaryService } from '../memory/chapter-summary.service';
import { StoryEventService } from '../memory/story-event.service';
import type { MemoryData } from '../agentos/analyst-schema';
```
Change the constructor signature to accept the two services:
```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ResourceRegistry,
    private readonly summaries: SummaryService,
    private readonly events: StoryEventService,
  ) {}
```
Add the method (and a chapter lookup helper):
```ts
  /** GET /novels/:id/chapters/:order/summary —— 从 DB 重建 MemoryData。 */
  async getChapterMemory(userId: string, novelId: string, order: number): Promise<MemoryData> {
    await this.assertOwned(userId, novelId);
    const chapter = await this.prisma.chapter.findFirst({ where: { novelId, order }, select: { id: true } });
    if (!chapter) throw new NotFoundException('Chapter not found');
    const summary = await this.summaries.findByChapter(userId, novelId, chapter.id);
    if (!summary) {
      return { settled: false, chapterOrder: order, summary: '', roleChanges: [], entities: [], newHooks: [], resolvedHooks: [] };
    }
    const evs = await this.events.listForChapter(userId, novelId, order);
    const newHooks = evs.filter((e) => e.openedAtChapter === order).map((e) => ({ id: e.id, description: e.description }));
    const resolvedHooks = evs.filter((e) => e.resolvedAtChapter === order).map((e) => ({ id: e.id, description: e.description }));
    return {
      settled: true,
      chapterOrder: order,
      summary: summary.summary,
      roleChanges: summary.roleChanges as MemoryData['roleChanges'],
      entities: summary.entities as MemoryData['entities'],
      newHooks,
      resolvedHooks,
    };
  }

  /** 章节删除:级联清理 StoryEvent(埋于本章→删;回收于本章→回退 OPEN)。 */
  async deleteChapterCascade(userId: string, novelId: string, order: number): Promise<void> {
    await this.events.cleanupForChapter(userId, novelId, order);
  }
```

> Note: `ChapterHandler.apply` / `accept` and `create` are unchanged. The new deps (`summaries`, `events`) are injected via MemoryModule (Task 4). If any OTHER test constructs `new NovelService(prisma, registry)` with 2 args, update it to pass the two stubs too. Grep first:
> `cd server && grep -rn "new NovelService(" src`

- [ ] **Step 4: Add the controller route**

Open `server/src/novel/novel.controller.ts`. Add a route (mirror existing chapter routes' decorators/guards; `@CurrentUser()` + `@Param`):
```ts
  @Get('novels/:id/chapters/:order/summary')
  async getChapterMemory(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Param('order') order: string,
  ) {
    return this.novels.getChapterMemory(user.id, id, Number(order));
  }
```
(Import `RequestUser`/`CurrentUser` exactly as the existing routes in that file do.)

- [ ] **Step 5: Fix any NovelService test that breaks (2-arg → 4-arg constructor)**

Run: `cd server && pnpm test -- novel.service.spec.ts novel.controller.spec.ts`
Update each `new NovelService(prisma, registry)` to add:
```ts
const summaries = { findByChapter: jest.fn(), upsert: jest.fn(), listRecent: jest.fn() } as unknown as SummaryService;
const events = { listForChapter: jest.fn(), cleanupForChapter: jest.fn() } as unknown as StoryEventService;
new NovelService(prisma, registry, summaries, events);
```
Re-run until green.

- [ ] **Step 6: Run — PASS + typecheck**

Run: `cd server && pnpm test -- novel.memory-endpoint.spec.ts && pnpm typecheck`
Expected: PASS + clean.

- [ ] **Step 7: Commit**
```sh
git add server/src/novel/novel.service.ts server/src/novel/novel.controller.ts server/src/novel/novel.memory-endpoint.spec.ts server/src/novel/novel.service.spec.ts server/src/novel/novel.controller.spec.ts
git commit -m "feat(novel): GET chapters/:order/summary (rebuild MemoryData) + delete cascade

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 12: FE types + API client

**Files:**
- Modify: `agent-ui/src/types/os.ts`, `agent-ui/src/api/novels.ts`

- [ ] **Step 1: Add types**

Open `agent-ui/src/types/os.ts`. Add:
```ts
export interface MemoryData {
  settled: boolean
  chapterOrder: number
  summary: string
  roleChanges: { name: string; change: string }[]
  entities: { type: 'item' | 'place' | 'setting'; name: string; note: string }[]
  newHooks: { id: string; description: string }[]
  resolvedHooks: { id: string; description: string }[]
}
```
On `ChatMessage`, add: `memory?: MemoryData`.

- [ ] **Step 2: Add API client**

Open `agent-ui/src/api/novels.ts`. Mirror the existing client style (e.g. `getNovel`). Add:
```ts
export async function getChapterMemory(
  endpoint: string,
  token: string,
  novelId: string,
  order: number,
): Promise<MemoryData> {
  const url = `${endpoint}/novels/${novelId}/chapters/${order}/summary`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`getChapterMemory failed: ${res.status}`)
  return res.json()
}
```
(Import `MemoryData` from `@/types/os`. If `novels.ts` uses an `asJson<T>` helper, use it; otherwise the explicit `fetch` above matches `getNovel`'s pattern — match whatever the file already does.)

- [ ] **Step 3: typecheck + validate**

Run: `cd agent-ui && pnpm typecheck && pnpm validate`
Expected: clean.

- [ ] **Step 4: Commit**
```sh
git add agent-ui/src/types/os.ts agent-ui/src/api/novels.ts
git commit -m "feat(agent-ui): MemoryData type + getChapterMemory API client

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 13: `useChapterMemory` polling hook

**Files:**
- Create: `agent-ui/src/hooks/useChapterMemory.ts`

- [ ] **Step 1: Create the hook**

Create `agent-ui/src/hooks/useChapterMemory.ts`:

```ts
'use client'

import { useEffect, useRef, useState } from 'react'
import { getChapterMemory } from '@/api/novels'
import { useStore } from '@/store'
import type { MemoryData } from '@/types/os'

type Status = 'idle' | 'polling' | 'settled' | 'timeout'

/**
 * 写作轮后轮询本章记忆。active=true 且给定 order 时启动;每 4s 一次,60s 超时。
 * settled 后停;超时或卸载时清理。不禁用输入框(异步)。
 */
export function useChapterMemory(novelId: string | undefined, order: number | null, active: boolean) {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const [status, setStatus] = useState<Status>('idle')
  const [memory, setMemory] = useState<MemoryData | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startedAt = useRef(0)

  useEffect(() => {
    // 清理上一次
    if (timer.current) clearTimeout(timer.current)
    if (!active || !novelId || order === null) {
      setStatus('idle')
      setMemory(null)
      return
    }

    setStatus('polling')
    setMemory(null)
    startedAt.current = Date.now()
    const TIMEOUT = 60_000
    const INTERVAL = 4_000

    const tick = async () => {
      try {
        const data = await getChapterMemory(endpoint, token, novelId, order)
        if (data.settled) {
          setStatus('settled')
          setMemory(data)
          timer.current = null
          return
        }
      } catch {
        /* 单次失败不致命,继续轮询 */
      }
      if (Date.now() - startedAt.current >= TIMEOUT) {
        setStatus('timeout')
        timer.current = null
        return
      }
      timer.current = setTimeout(tick, INTERVAL)
    }

    timer.current = setTimeout(tick, 1500) // 先给结算一点启动时间再开始轮询
    return () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novelId, order, active, endpoint, token])

  return { status, memory }
}

export default useChapterMemory
```

- [ ] **Step 2: typecheck + validate**

Run: `cd agent-ui && pnpm typecheck && pnpm validate`
Expected: clean.

- [ ] **Step 3: Commit**
```sh
git add agent-ui/src/hooks/useChapterMemory.ts
git commit -m "feat(agent-ui): useChapterMemory polling hook (4s/60s, settled/timeout)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 14: `MemoryBubble` component

**Files:**
- Create: `agent-ui/src/components/chat/ChatArea/Messages/MemoryBubble.tsx`

- [ ] **Step 1: Create the component**

Create `agent-ui/src/components/chat/ChatArea/Messages/MemoryBubble.tsx`:

```tsx
'use client'

import { useState, type ReactNode } from 'react'
import type { MemoryData } from '@/types/os'
import { cn } from '@/lib/utils'

/** 结算中占位(轮询期间)。 */
export const MemorySettling = () => (
  <div className="mt-3 rounded-lg border-l-2 border-brand/30 bg-background-secondary/40 px-3 py-2 text-xs text-muted">
    🧠 结算中…
  </div>
)

/** 拿到记忆后的可折叠气泡。 */
const MemoryBubble = ({ memory }: { memory: MemoryData }) => {
  const [open, setOpen] = useState(false)
  const hookCount = memory.newHooks.length + memory.resolvedHooks.length
  const overview = `🧠 本章记忆:摘要·1 · 变化${memory.roleChanges.length} · 设定${memory.entities.length} · 伏笔${hookCount}`

  return (
    <div className="mt-3 w-full rounded-lg border-l-2 border-brand/60 bg-background-secondary/60 px-3 py-2 text-xs text-muted">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
        <span className="truncate">{overview}</span>
        <span className={cn('ml-2 shrink-0 transition-transform', open && 'rotate-90')}>▸</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2 border-t border-primary/10 pt-2">
          <Group title="摘要">{memory.summary || '—'}</Group>
          {memory.roleChanges.length > 0 && (
            <Group title="角色变化">
              {memory.roleChanges.map((r, i) => (<div key={i}><span className="text-primary">{r.name}</span> · {r.change}</div>))}
            </Group>
          )}
          {memory.entities.length > 0 && (
            <Group title="物品 / 地点 / 设定">
              {memory.entities.map((e, i) => (<div key={i}><span className="text-primary">[{e.type}] {e.name}</span> · {e.note}</div>))}
            </Group>
          )}
          {(memory.newHooks.length > 0 || memory.resolvedHooks.length > 0) && (
            <Group title="伏笔">
              {memory.newHooks.map((h, i) => (<div key={`n${i}`}>🆕 {h.description}</div>))}
              {memory.resolvedHooks.map((h, i) => (<div key={`r${i}`}>✅ {h.description}</div>))}
            </Group>
          )}
        </div>
      )}
    </div>
  )
}

const Group = ({ title, children }: { title: string; children: ReactNode }) => (
  <div>
    <div className="mb-1 text-[10px] uppercase tracking-wide text-muted/60">{title}</div>
    <div className="space-y-0.5 leading-relaxed">{children}</div>
  </div>
)

export default MemoryBubble
```

- [ ] **Step 2: typecheck + validate**

Run: `cd agent-ui && pnpm typecheck && pnpm validate`
Expected: clean.

- [ ] **Step 3: Commit**
```sh
git add agent-ui/src/components/chat/ChatArea/Messages/MemoryBubble.tsx
git commit -m "feat(agent-ui): MemoryBubble + MemorySettling placeholder

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 15: Wire polling into the workspace page + render under messages

**Files:**
- Modify: `agent-ui/src/app/novels/[id]/page.tsx`
- Modify: `agent-ui/src/components/chat/ChatArea/Messages/MessageItem.tsx`

- [ ] **Step 1: Drive the poll from the workspace page**

Open `agent-ui/src/app/novels/[id]/page.tsx`. The page already tracks `writingChapterOrder` (from store) for the skeleton. After a write turn (when `writingChapterOrder` goes back to `null` following a non-null value, i.e. the turn ended), we want to poll that chapter's memory and attach it to the last agent message.

Add (inside the `Workspace` component, after the existing `writingChapterOrder` subscription):
```tsx
  const lastWrittenOrder = useRef<number | null>(null)
  // 记住上一轮写过的章序号(写作中 → null 时,说明该轮写完)
  useEffect(() => {
    if (writingChapterOrder !== null) lastWrittenOrder.current = writingChapterOrder
  }, [writingChapterOrder])

  const pollingOrder = writingChapterOrder === null ? lastWrittenOrder.current : null
  const { status: memoryStatus, memory } = useChapterMemory(
    params.id,
    pollingOrder,
    writingChapterOrder === null && pollingOrder !== null && memoryStatus !== 'settled',
  )

  // 拿到记忆 → 挂到最后一条 agent 消息
  useEffect(() => {
    if (memory && memoryStatus === 'settled') {
      setMessages((prev) => {
        const next = [...prev]
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].role === 'agent') { next[i] = { ...next[i], memory }; break }
        }
        return next
      })
      lastWrittenOrder.current = null // 消费掉,避免重复挂
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memory, memoryStatus])
```
Add imports: `useChapterMemory` from `@/hooks/useChapterMemory`, `useRef` from react, `setMessages` from store (`const setMessages = useStore((s) => s.setMessages)`).

> The poll is `active` only when: not currently writing (`writingChapterOrder === null`), there is a recently-written order, and not yet settled. This starts polling right after RunCompleted (the store flips writingChapterOrder to null on stream end — see existing `useAIStreamHandler` finally block) and stops when settled.

- [ ] **Step 2: Render under the agent message**

Open `agent-ui/src/components/chat/ChatArea/Messages/MessageItem.tsx`. Add import:
```ts
import MemoryBubble from './MemoryBubble'
```
In `AgentMessage`, wrap the content so the bubble shows below when `message.memory` is present. Change the `return` from the single `{messageContent}` to:
```tsx
  return (
    <div className="flex flex-row items-start gap-4 font-geist">
      <div className="flex-shrink-0">
        <Icon type="agent" size="sm" />
      </div>
      <div className="flex w-full flex-col gap-2">
        {messageContent}
        {message.memory && <MemoryBubble memory={message.memory} />}
      </div>
    </div>
  )
```
(The "结算中" placeholder is rendered by the workspace page driving the poll; it can optionally be shown on the in-flight last agent message. For this task, keep it simple: the bubble appears once settled. A subtle "结算中" can be added to the page header if desired — not required.)

- [ ] **Step 3: typecheck + validate + build**

Run: `cd agent-ui && pnpm typecheck && pnpm validate && pnpm build`
Expected: clean.

- [ ] **Step 4: Commit**
```sh
git add agent-ui/src/app/novels/[id]/page.tsx agent-ui/src/components/chat/ChatArea/Messages/MessageItem.tsx
git commit -m "feat(agent-ui): poll chapter memory after a write + render bubble under agent msg

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 16: Full-stack smoke test + finalize

**Files:** none (verification)

- [ ] **Step 1: Server build + full suite**

Run: `cd server && pnpm typecheck && pnpm test && pnpm build`
Expected: all green, clean build.

- [ ] **Step 2: FE validate + build**

Run: `cd agent-ui && pnpm typecheck && pnpm validate && pnpm build`
Expected: clean.

- [ ] **Step 3: Manual end-to-end (running stack + DB + ZHIPUAI key)**

`pnpm dev` at repo root (:3000 + :3001). In the browser:
1. New novel → complete onboarding (CONCEPT → 5 fields → main transfers to writer).
2. Ask writer to write chapter 1.
3. **Expected:** while writing → ChapterPreview skeleton. Stream `RunCompleted` fires → **chat input re-enables immediately** (async; NOT blocked). After ~16-32s the agent message for that turn shows a `MemoryBubble` (collapsed) below it; expand → summary / role changes / entities / hooks. (Server logs show `[agentos] analyst settle...` completing.)
4. Write chapter 2 → second bubble; verify an OPEN hook from ch1 can show as ✅ in a later chapter if the plot resolves it.
5. Reload the page → the bubble does NOT come back (history reload via `/sessions/:id/runs` doesn't carry `memory`); this is the accepted limitation (memory lives in DB; a future history-enrichment can populate it).

> Diagnostics: if no bubble ever appears after 60s → check server logs. If you see `analyst settle failed`, the structured call errored (verify `method:'functionCalling'` is set). If `getChapterMemory` 404s → the `GET .../chapters/:order/summary` route isn't registered. If it always returns `settled:false` → Analyst isn't writing ChapterSummary (check the ToolMessage detection in Task 10 by logging `msg.name`/`msg.content`).

- [ ] **Step 4: Tag (only if smoke passes)**

```sh
git add -A
git commit -m "chore(analyst): post-smoke fixups" --allow-empty
git tag v0.5.0
```

---

## Self-Review

**Spec coverage:**
- §2 角色边界(Analyst 不进 swarm) → Task 6 (service) + Task 10 (fire-and-forget from streamTurn). ✓
- §2.1 异步触发 + RunCompleted 不阻塞 → Task 10 (void settle, not awaited; controller unchanged). ✓
- §3.1 ChapterSummary(1:1) → Task 1 + Task 2. ✓
- §3.2 StoryEvent(OPEN/RESOLVED + 删除级联 + 重写) → Task 1 + Task 3 (cleanupForChapter) + Task 11 (deleteChapterCascade wired; rewrite handled by settle upsert + Analyst re-runs on op=set). ✓
- §4.1 functionCalling pin + temp 0.1 + 不走循环 → Task 6. ✓
- §4.1 并发锁(settlingNovels) → Task 6 (Set + guard). ✓
- §4.2 输入(正文+设定+OPEN 伏笔) → Task 6. ✓
- §4.3 analystSchema → Task 5. ✓
- §4.4 落库走 service 不走 mutation → Task 6 (uses services). ✓
- §4.5 settle void + fire-and-forget → Task 6 (void return) + Task 10 (void call). ✓
- §4.6 MemoryData 从 DB 重建 → Task 5 (type) + Task 11 (getChapterMemory). ✓
- §5.1 ToolMessage 触发 → Task 7 (chapterId/ok return) + Task 10. ✓
- §5.2 GET 端点重建 → Task 11. ✓
- §5.3 前端轮询(不禁用输入) → Task 13 (hook) + Task 15 (page). ✓
- §5.4 失败静默 → Task 6 (settle try/catch) + Task 10 (catch). ✓
- §6.1 注入(近期5章 + OPEN) → Task 8. ✓
- §6.2 query_memory(关键词) → Task 9 + Task 10 (wired). ✓
- §7 前端(API + 轮询 hook + 气泡 + 不动 ChatInput) → Task 12/13/14/15. ✓ (ChatInput untouched — confirmed no task modifies it.)
- §8 非目标(无流帧/pendingMemory) → Task 10 keeps return type unchanged; store.ts NOT modified (confirmed: no task edits store.ts or useAIStreamHandler.tsx). ✓

**Placeholder scan:** Task 11 Step 3/Step 5 instruct fixing other NovelService tests via grep — that's a targeted, bounded instruction (exact stub code given), not a "figure it out" placeholder. All code blocks complete. No TBD/TODO. ✓

**Type consistency:**
- `MemoryData` shape (Task 5 backend) == (Task 12 FE) == (Task 11 getChapterMemory return) == (Task 13 hook state) == (Task 14 bubble prop). Fields: settled/chapterOrder/summary/roleChanges/entities/newHooks/resolvedHooks — identical. ✓
- `analystSchema` (Task 5) == Task 6 withStructuredOutput. ✓
- `SummaryService` (Task 2): upsert/findByChapter/listRecent == Task 6 calls + Task 11 call + Task 8 call. ✓
- `StoryEventService` (Task 3): listOpen/createHooks/resolveHooks/cleanupForChapter/listForChapter == Task 6 + Task 8 + Task 11 calls. ✓
- `makeQueryMemoryTool({userId,novelId,prisma})` (Task 9) == Task 10 call (no more vestigial summaries/events params — fixed vs v1). ✓
- `streamTurn` return type unchanged (`string | {type:'writing-chapter';order}`) — Task 10 keeps it, controller needs no change. ✓
- `NovelService` constructor 4-arg (Task 11) — flagged for all test updates. ✓

**No gaps found.** Plan ready for execution.
