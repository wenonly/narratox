# narratox Analyst Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a non-user-facing **Analyst** agent that, after each successful `write_chapter`, extracts 4 fact types (summary / role-changes / hooks / entities) into new `ChapterSummary` + `StoryEvent` tables, surfaces them in chat via a per-message "memory bubble", and feeds them back to the Writer via ContextAssembler injection + a `query_memory` tool.

**Architecture:** `AnalystService` is a plain service (NOT a swarm member) holding a low-temp `ChatOpenAI` doing one structured-output call. `WorkspaceSwarmService.streamTurn` detects the `write_chapter` **ToolMessage result** (not the tool_call), then serially awaits `AnalystService.settle(...)` between the last `RunContent` and `RunCompleted`, yielding `Settling` / `MemoryUpdated` / `MemorySkip` signal frames. New tables `ChapterSummary` (1:1 with Chapter) and `StoryEvent` (cross-chapter hook ledger, OPEN/RESOLVED) back the facts; `ContextAssembler.forSession` injects recent summaries + open hooks into the Writer prompt, and a new `query_memory` read-tool lets the Writer look up specific roles/hooks/entities by keyword.

**Tech Stack:** NestJS 11 + Prisma 7 (PostgreSQL, `public` schema) + `@langchain/openai` (ChatOpenAI, structured output) + zod. Frontend: Next.js 15 + React 18 + Zustand + Tailwind dark theme. Server tests: jest (`pnpm test`, ts-jest, `NODE_OPTIONS=--experimental-vm-modules`). No FE test runner — gate is `pnpm validate` + `pnpm build`.

**Spec:** [docs/superpowers/specs/2026-06-18-multi-agent-analyst-design.md](../specs/2026-06-18-multi-agent-analyst-design.md)

---

## File Structure

**Backend (server/):**
- Modify: `server/prisma/schema.prisma` — add `ChapterSummary`, `StoryEvent` models + `EventStatus` enum + reverse relations on `Novel`/`Chapter`.
- Create: `server/src/memory/chapter-summary.service.ts` — `SummaryService`: upsert/list-recent for `ChapterSummary`.
- Create: `server/src/memory/story-event.service.ts` — `StoryEventService`: list-open / create-hooks / resolve-hooks for `StoryEvent`.
- Create: `server/src/memory/memory.module.ts` — exports both services.
- Create: `server/src/agentos/analyst.service.ts` — `AnalystService.settle(...)` (LLM structured output → persist → return `MemoryUpdated`).
- Create: `server/src/agentos/analyst-schema.ts` — the zod `analystSchema` + `MemoryUpdated` TS type (shared, no Nest dep).
- Modify: `server/src/agentos/context-assembler.service.ts` — inject recent summaries + open hooks into the prompt; add `novelId`-based slice assembly.
- Create: `server/src/agentos/tools/query-memory.tool.ts` — `makeQueryMemoryTool` (Writer read-tool, keyword search).
- Modify: `server/src/agentos/workspace-swarm.service.ts` — inject `AnalystService` + memory services; detect `write_chapter` ToolMessage; add `query_memory` to writer; serial settle + yield `settling`/`memory-updated`/`memory-skip`.
- Modify: `server/src/agentos/tools/write-chapter.tool.ts` — return `{ ok, chapterOrder, chapterId }` (add `chapterId`).
- Modify: `server/src/agentos/agentos.module.ts` — import `MemoryModule`; provide `AnalystService`.
- Tests: `server/src/memory/chapter-summary.service.spec.ts`, `server/src/memory/story-event.service.spec.ts`, `server/src/agentos/context-assembler.memory.spec.ts`, `server/src/agentos/tools/query-memory.tool.spec.ts`.

**Frontend (agent-ui/):**
- Modify: `agent-ui/src/types/os.ts` — add `MemoryUpdatedData` + `memory?: MemoryUpdatedData` on `ChatMessage`; extend `RunEvent` with `Settling`/`MemoryUpdated`/`MemorySkip`.
- Modify: `agent-ui/src/store.ts` — add `isSettling`, `setIsSettling`, `pendingMemory`, `setPendingMemory`.
- Modify: `agent-ui/src/hooks/useAIStreamHandler.tsx` — handle the 3 new events (Settling/MemoryUpdated→pendingMemory/MemorySkip); fold `pendingMemory` into the finalized agent message on `RunCompleted`.
- Create: `agent-ui/src/components/chat/ChatArea/Messages/MemoryBubble.tsx` — collapsible 4-group memory display.
- Modify: `agent-ui/src/components/chat/ChatArea/Messages/MessageItem.tsx` — render `<MemoryBubble>` under agent messages that have `memory`.
- Modify: `agent-ui/src/components/chat/ChatArea/ChatInput/ChatInput.tsx` — show "结算中…" bar + disable input while `isSettling`.

---

## Notes for the implementer

- **Prisma 7 is config-driven** (`server/prisma.config.ts`). Migration command takes **no `--schema` flag**: `pnpm prisma migrate dev --name <name>` (run from `server/`).
- **LangGraph checkpoint tables live in `agent_memory` schema; Prisma manages only `public`.** Do NOT move the new tables — they go in `public` (default). Migrate with `pnpm prisma migrate dev`; it must produce a clean migration with **no** `agent_memory` drift.
- **`@Optional()` / DI:** `AnalystService` depends on `ZHIPUAI_API_KEY` at runtime (lazy-built model). If the key is missing, `settle()` must throw — and `streamTurn` catches it → yields `MemorySkip`. So a missing key degrades gracefully (no settlement, no crash).
- **`as never` boundary cast:** LangChain `tool()` returns `DynamicStructuredTool`; the langgraph/prebuilt tool union resolves via a different .d.ts under CommonJS → TS false-rejects. Every tool passed to `createReactAgent`/`createReactAgent` uses `as never`. Mirror the existing pattern in [workspace-swarm.service.ts](../../server/src/agentos/workspace-swarm.service.ts).
- **ESM dynamic imports:** `ChatOpenAI` is imported via `await import('@langchain/openai')` inside the method (not top-level) to keep jest's collection phase clean. Mirror existing swarm code.
- **Tests do NOT mock the LLM.** The pure, LLM-free seams (the two new services, the ContextAssembler memory-slice assembly, the query_memory tool's search) get jest unit tests. `AnalystService.settle`'s LLM call is exercised only by manual/E2E (no jest mock of `@langchain/openai` exists in the repo and we won't add one).
- **Commit after every task.** Gate: `cd server && pnpm typecheck && pnpm test` for backend tasks; `cd agent-ui && pnpm typecheck && pnpm validate` for frontend tasks.

---

# Task 1: Data model — `ChapterSummary` + `StoryEvent`

**Files:**
- Modify: `server/prisma/schema.prisma`

- [ ] **Step 1: Add models + enum to schema**

Open `server/prisma/schema.prisma`. In the `Chapter` model, add a reverse relation (after the existing fields, before the closing `}`):

```prisma
  summary   ChapterSummary?
```

In the `Novel` model, add a reverse relation:

```prisma
  events    StoryEvent[]
```

Append two new models + one enum at the end of the file:

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

- [ ] **Step 2: Generate the migration**

Run (from `server/`):
```sh
cd server && pnpm prisma migrate dev --name add_analyst_tables
```
Expected: migration created under `server/prisma/migrations/<ts>_add_analyst_tables/`, client regenerated. **Inspect the generated SQL** — it must only touch `public` (`"ChapterSummary"`, `"StoryEvent"`, `"EventStatus"`) and NOT mention `agent_memory`. If `agent_memory` drift appears, STOP — that means the schema is out of sync; do not proceed.

- [ ] **Step 3: Verify build + types**

Run: `cd server && pnpm typecheck`
Expected: clean (Prisma client now has `chapterSummary` / `storyEvent` delegates).

- [ ] **Step 4: Commit**
```sh
git add server/prisma/schema.prisma server/prisma/migrations server/src/prisma
git commit -m "feat(server): add ChapterSummary + StoryEvent tables (Analyst data model)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 2: `SummaryService` (ChapterSummary read/write)

**Files:**
- Create: `server/src/memory/chapter-summary.service.ts`
- Test: `server/src/memory/chapter-summary.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `server/src/memory/chapter-summary.service.spec.ts`:

```ts
import { SummaryService } from './chapter-summary.service';
import type { PrismaService } from '../prisma/prisma.service';

interface PrismaMock {
  chapterSummary: {
    upsert: jest.Mock;
    findMany: jest.Mock;
  };
}

function makePrismaMock(): PrismaMock {
  return {
    chapterSummary: {
      upsert: jest.fn(),
      findMany: jest.fn(),
    },
  };
}

describe('SummaryService', () => {
  describe('upsert', () => {
    it('upserts by chapterId with merged JSON fields', async () => {
      const prisma = makePrismaMock();
      prisma.chapterSummary.upsert.mockResolvedValue({ id: 's1' });
      const svc = new SummaryService(prisma as unknown as PrismaService);
      await svc.upsert({
        userId: 'u1',
        novelId: 'n1',
        chapterId: 'c1',
        summary: '主角下山',
        roleChanges: [{ name: '陈平安', change: '觉醒' }],
        entities: [{ type: 'item', name: '剑', note: '所得' }],
      });
      expect(prisma.chapterSummary.upsert).toHaveBeenCalledWith({
        where: { chapterId: 'c1' },
        create: {
          chapterId: 'c1',
          novelId: 'n1',
          summary: '主角下山',
          roleChanges: [{ name: '陈平安', change: '觉醒' }],
          entities: [{ type: 'item', name: '剑', note: '所得' }],
        },
        update: {
          novelId: 'n1',
          summary: '主角下山',
          roleChanges: [{ name: '陈平安', change: '觉醒' }],
          entities: [{ type: 'item', name: '剑', note: '所得' }],
        },
      });
    });
  });

  describe('listRecent', () => {
    it('returns the N most recent summaries joined to chapter order, ordered by chapter order desc', async () => {
      const prisma = makePrismaMock();
      prisma.chapterSummary.findMany.mockResolvedValue([
        { summary: '第3章摘要', chapter: { order: 3 } },
        { summary: '第2章摘要', chapter: { order: 2 } },
      ]);
      const svc = new SummaryService(prisma as unknown as PrismaService);
      const rows = await svc.listRecent('u1', 'n1', 5);
      expect(prisma.chapterSummary.findMany).toHaveBeenCalledWith({
        where: { novelId: 'n1', chapter: { novel: { userId: 'u1' } } },
        take: 5,
        orderBy: { chapter: { order: 'desc' } },
        select: { summary: true, chapter: { select: { order: true } } },
      });
      expect(rows).toEqual([
        { summary: '第3章摘要', chapterOrder: 3 },
        { summary: '第2章摘要', chapterOrder: 2 },
      ]);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm test -- chapter-summary.service.spec.ts`
Expected: FAIL — module `./chapter-summary.service` not found.

- [ ] **Step 3: Implement the service**

Create `server/src/memory/chapter-summary.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface RoleChange {
  name: string;
  change: string;
}
export interface EntityFact {
  type: 'item' | 'place' | 'setting';
  name: string;
  note: string;
}

/**
 * 写/读 ChapterSummary(Analyst 落库 + ContextAssembler 注入用)。
 * 按 novelId/userId 隔离。upsert 按 chapterId(1:1),重写章节后覆盖。
 */
@Injectable()
export class SummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(args: {
    userId: string;
    novelId: string;
    chapterId: string;
    summary: string;
    roleChanges: RoleChange[];
    entities: EntityFact[];
  }): Promise<void> {
    const { userId: _userId, novelId, chapterId, summary, roleChanges, entities } = args;
    await this.prisma.chapterSummary.upsert({
      where: { chapterId },
      create: { chapterId, novelId, summary, roleChanges, entities },
      update: { novelId, summary, roleChanges, entities },
    });
  }

  /** 最近 N 章的摘要(按章节序号倒序),供 ContextAssembler 注入【前情】。 */
  async listRecent(
    userId: string,
    novelId: string,
    limit: number,
  ): Promise<Array<{ summary: string; chapterOrder: number }>> {
    const rows = await this.prisma.chapterSummary.findMany({
      where: { novelId, chapter: { novel: { userId } } },
      take: limit,
      orderBy: { chapter: { order: 'desc' } },
      select: { summary: true, chapter: { select: { order: true } } },
    });
    return rows.map((r) => ({ summary: r.summary, chapterOrder: r.chapter.order }));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && pnpm test -- chapter-summary.service.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**
```sh
git add server/src/memory/chapter-summary.service.ts server/src/memory/chapter-summary.service.spec.ts
git commit -m "feat(memory): SummaryService — ChapterSummary upsert + listRecent

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 3: `StoryEventService` (hook ledger)

**Files:**
- Create: `server/src/memory/story-event.service.ts`
- Test: `server/src/memory/story-event.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `server/src/memory/story-event.service.spec.ts`:

```ts
import { StoryEventService } from './story-event.service';
import type { PrismaService } from '../prisma/prisma.service';

interface PrismaMock {
  storyEvent: {
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
}

function makePrismaMock(): PrismaMock {
  return {
    storyEvent: { findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
}

describe('StoryEventService', () => {
  describe('listOpen', () => {
    it('returns OPEN hooks for the novel, oldest first', async () => {
      const prisma = makePrismaMock();
      prisma.storyEvent.findMany.mockResolvedValue([
        { id: 'e1', description: '黑影', openedAtChapter: 1 },
        { id: 'e2', description: '钥匙', openedAtChapter: 2 },
      ]);
      const svc = new StoryEventService(prisma as unknown as PrismaService);
      const rows = await svc.listOpen('u1', 'n1');
      expect(prisma.storyEvent.findMany).toHaveBeenCalledWith({
        where: { novelId: 'n1', status: 'OPEN', novel: { userId: 'u1' } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, description: true, openedAtChapter: true },
      });
      expect(rows).toEqual([
        { id: 'e1', description: '黑影', openedAtChapter: 1 },
        { id: 'e2', description: '钥匙', openedAtChapter: 2 },
      ]);
    });
  });

  describe('createHooks', () => {
    it('creates one OPEN event per description, tagged with the opening chapter', async () => {
      const prisma = makePrismaMock();
      prisma.storyEvent.create.mockResolvedValue({});
      const svc = new StoryEventService(prisma as unknown as PrismaService);
      await svc.createHooks('u1', 'n1', ['黑影', '钥匙'], 3);
      expect(prisma.storyEvent.create).toHaveBeenCalledTimes(2);
      expect(prisma.storyEvent.create).toHaveBeenNthCalledWith(1, {
        data: { novelId: 'n1', description: '黑影', status: 'OPEN', openedAtChapter: 3 },
      });
    });

    it('is a no-op for an empty list', async () => {
      const prisma = makePrismaMock();
      const svc = new StoryEventService(prisma as unknown as PrismaService);
      await svc.createHooks('u1', 'n1', [], 3);
      expect(prisma.storyEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('resolveHooks', () => {
    it('flips each id to RESOLVED with the resolving chapter', async () => {
      const prisma = makePrismaMock();
      prisma.storyEvent.update.mockResolvedValue({});
      const svc = new StoryEventService(prisma as unknown as PrismaService);
      await svc.resolveHooks('u1', 'n1', ['e1', 'e2'], 3);
      expect(prisma.storyEvent.update).toHaveBeenCalledTimes(2);
      expect(prisma.storyEvent.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'e1', novelId: 'n1', status: 'OPEN' },
        data: { status: 'RESOLVED', resolvedAtChapter: 3 },
      });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm test -- story-event.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

Create `server/src/memory/story-event.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface OpenHook {
  id: string;
  description: string;
  openedAtChapter: number | null;
}

/**
 * 伏笔账本(StoryEvent)读写。OPEN=埋下,RESOLVED=回收。
 * 跨章查询;按 novelId/userId 隔离。createHooks 不去重(P3 再加)。
 */
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

  async createHooks(
    userId: string,
    novelId: string,
    descriptions: string[],
    openedAtChapter: number,
  ): Promise<void> {
    for (const description of descriptions) {
      await this.prisma.storyEvent.create({
        data: { novelId, description, status: 'OPEN', openedAtChapter },
      });
    }
  }

  async resolveHooks(
    userId: string,
    novelId: string,
    ids: string[],
    resolvedAtChapter: number,
  ): Promise<void> {
    for (const id of ids) {
      await this.prisma.storyEvent.update({
        where: { id, novelId, status: 'OPEN' },
        data: { status: 'RESOLVED', resolvedAtChapter },
      });
    }
  }
}
```

> Note: Prisma's `update.where` compound filter (`novelId`, `status` in `where` alongside the `id` PK) is supported — Prisma lets you filter by unique + additional scalar fields in `where` for `update`. If `pnpm typecheck` rejects it, fall back to `updateMany({ where: { id, novelId, status: 'OPEN' } })` (same semantics, returns count). Prefer `update`; switch only if the type errors.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && pnpm test -- story-event.service.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: typecheck (confirm the `update.where` compound filter compiles)**

Run: `cd server && pnpm typecheck`
Expected: clean. If it errors on the compound `where`, switch that call to `updateMany` as noted above and re-run.

- [ ] **Step 6: Commit**
```sh
git add server/src/memory/story-event.service.ts server/src/memory/story-event.service.spec.ts
git commit -m "feat(memory): StoryEventService — hook ledger (list/create/resolve)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 4: `MemoryModule` + wire into AgentosModule

**Files:**
- Create: `server/src/memory/memory.module.ts`
- Modify: `server/src/agentos/agentos.module.ts`

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

- [ ] **Step 2: Import MemoryModule into AgentosModule**

Open `server/src/agentos/agentos.module.ts`. Add the import and register it. Full new content:

```ts
import { Module } from '@nestjs/common';
import { AgentosController } from './agentos.controller';
import { ContextAssembler } from './context-assembler.service';
import { checkpointerProvider } from './checkpointer.provider';
import { SessionsService } from './sessions.service';
import { WorkspaceSwarmService } from './workspace-swarm.service';
import { NovelModule } from '../novel/novel.module';
import { MemoryModule } from '../memory/memory.module';

@Module({
  imports: [NovelModule, MemoryModule],
  controllers: [AgentosController],
  providers: [
    WorkspaceSwarmService,
    SessionsService,
    ContextAssembler,
    checkpointerProvider,
  ],
})
export class AgentosModule {}
```

> `AnalystService` is added in Task 6 (once it exists). Do not reference it yet.

- [ ] **Step 3: typecheck**

Run: `cd server && pnpm typecheck`
Expected: clean.

- [ ] **Step 4: Commit**
```sh
git add server/src/memory/memory.module.ts server/src/agentos/agentos.module.ts
git commit -m "feat(memory): MemoryModule + wire into AgentosModule

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 5: Analyst zod schema + `MemoryUpdated` type

**Files:**
- Create: `server/src/agentos/analyst-schema.ts`

- [ ] **Step 1: Create the schema + types**

Create `server/src/agentos/analyst-schema.ts`:

```ts
import { z } from 'zod';

/**
 * Analyst 结构化输出 schema(喂给 ChatOpenAI.withStructuredOutput)。
 * resolvedHookIds 是从输入的 OPEN 伏笔列表里挑出的、本章回收了的 id。
 */
export const analystSchema = z.object({
  summary: z.string().describe('本章一句话情节摘要'),
  roleChanges: z.array(
    z.object({
      name: z.string(),
      change: z.string().describe('状态变化,如「觉醒剑修天赋」「受重伤」'),
    }),
  ),
  entities: z.array(
    z.object({
      type: z.enum(['item', 'place', 'setting']),
      name: z.string(),
      note: z.string().describe('一句话说明'),
    }),
  ),
  newHooks: z.array(z.string().describe('本章新埋下的伏笔描述')),
  resolvedHookIds: z.array(
    z.string().describe('从输入的 OPEN 伏笔列表里,本章回收了的 id'),
  ),
});
export type AnalystOutput = z.infer<typeof analystSchema>;

/** 推给前端的「本轮结算结果」。resolvedHooks 回填 description(前端展示用)。 */
export interface MemoryUpdated {
  type: 'memory-updated';
  data: {
    chapterOrder: number;
    summary: string;
    roleChanges: { name: string; change: string }[];
    entities: { type: 'item' | 'place' | 'setting'; name: string; note: string }[];
    newHooks: string[];
    resolvedHooks: { id: string; description: string }[];
  };
}

/** streamTurn 产出的三类信号(与正文 string delta 并列)。 */
export type StreamSignal =
  | { type: 'writing-chapter'; order: number }
  | { type: 'settling' }
  | { type: 'memory-updated'; data: MemoryUpdated['data'] }
  | { type: 'memory-skip' };
```

- [ ] **Step 2: typecheck**

Run: `cd server && pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Commit**
```sh
git add server/src/agentos/analyst-schema.ts
git commit -m "feat(agentos): analyst zod schema + MemoryUpdated/StreamSignal types

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 6: `AnalystService.settle`

**Files:**
- Create: `server/src/agentos/analyst.service.ts`

> No jest test (LLM call). The service is thin: read context → 1 structured call → persist via the Task 2/3 services (already tested) → return `MemoryUpdated`. Manual/E2E only. Keep it small and dependency-injected so the wiring is obvious.

- [ ] **Step 1: Implement the service**

Create `server/src/agentos/analyst.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { GLM_BASE_URL, GLM_MODEL } from './agentos.constants';
import { analystSchema, type MemoryUpdated } from './analyst-schema';
import { SummaryService, type RoleChange, type EntityFact } from '../memory/chapter-summary.service';
import { StoryEventService } from '../memory/story-event.service';
import { ChapterService } from '../novel/chapter.service';
import { NovelService } from '../novel/novel.service';

interface NovelSettingsLite {
  style?: string;
  worldviewText?: string;
}

/**
 * 非用户面向的结算 Agent:write_chapter 落稿成功后,提取本章 4 类事实并落库。
 * 单独的 ChatOpenAI(temperature 0.1),一次 structured output 调用,不走 agent
 * 循环。按 userId 缓存 model。失败时由调用方(streamTurn)捕获 → MemorySkip。
 */
@Injectable()
export class AnalystService {
  private readonly models = new Map<string, unknown>();

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
      apiKey,
      model: GLM_MODEL,
      temperature: 0.1,
      configuration: { baseURL: GLM_BASE_URL },
    });
    this.models.set(userId, model);
    return model;
  }

  async settle(args: {
    userId: string;
    novelId: string;
    chapterOrder: number;
  }): Promise<MemoryUpdated> {
    const { userId, novelId, chapterOrder } = args;

    // 1. 本章正文
    const chapter = await this.chapters.findByOrder(userId, novelId, chapterOrder);
    if (!chapter) throw new Error(`chapter order ${chapterOrder} not found`);
    const content = chapter.content ?? '';

    // 2. 小说设定
    const novel = await this.novels.get(userId, novelId);
    const settings = (novel.settings ?? {}) as NovelSettingsLite;

    // 3. OPEN 伏笔(含 id,让模型直接回 resolvedHookIds)
    const openHooks = await this.events.listOpen(userId, novelId);

    // 4. 一次结构化调用
    const model = await this.getModel(userId);
    const structured = (model as {
      withStructuredOutput: (s: typeof analystSchema) => {
        invoke: (msgs: Array<{ role: string; content: string }>) => Promise<unknown>;
      };
    }).withStructuredOutput(analystSchema);
    const result = (await structured.invoke([
      {
        role: 'system',
        content:
          '你是小说一致性记账员。阅读本章正文,严谨地提取事实(低温、客观、不编造)。' +
          'resolvedHookIds 只能从下面给出的 OPEN 伏笔 id 里挑本章确实回收了的;没回收就返回空数组。',
      },
      {
        role: 'user',
        content:
          `【书名】${novel.title}\n` +
          `【类型】${novel.genre ?? '未指定'}\n` +
          `【简介】${novel.synopsis ?? '未指定'}\n` +
          `【世界观】${settings.worldviewText ?? '未指定'}\n` +
          `【文风】${settings.style ?? '未指定'}\n\n` +
          `【本章序号】第${chapterOrder}章\n` +
          `【OPEN 伏笔(仅可从中挑选回收)】\n` +
          (openHooks.length
            ? openHooks.map((h) => `- id=${h.id}: ${h.description}`).join('\n')
            : '(无)') +
          `\n\n【本章正文】\n${content}`,
      },
    ])) as {
      summary: string;
      roleChanges: RoleChange[];
      entities: EntityFact[];
      newHooks: string[];
      resolvedHookIds: string[];
    };

    // 5. 落库
    await this.summaries.upsert({
      userId,
      novelId,
      chapterId: chapter.id,
      summary: result.summary,
      roleChanges: result.roleChanges,
      entities: result.entities,
    });
    await this.events.createHooks(userId, novelId, result.newHooks, chapterOrder);
    await this.events.resolveHooks(userId, novelId, result.resolvedHookIds, chapterOrder);

    // 6. 回填 resolvedHooks 的 description 给前端展示
    const resolvedMap = new Map(openHooks.map((h) => [h.id, h.description]));
    const resolvedHooks = result.resolvedHookIds
      .map((id) => ({ id, description: resolvedMap.get(id) ?? '' }))
      .filter((r) => r.description);

    return {
      type: 'memory-updated',
      data: {
        chapterOrder,
        summary: result.summary,
        roleChanges: result.roleChanges,
        entities: result.entities,
        newHooks: result.newHooks,
        resolvedHooks,
      },
    };
  }
}
```

- [ ] **Step 2: Provide AnalystService in AgentosModule**

Open `server/src/agentos/agentos.module.ts`. Add the provider (and the import). The `providers` array becomes:

```ts
  providers: [
    WorkspaceSwarmService,
    SessionsService,
    ContextAssembler,
    AnalystService,
    checkpointerProvider,
  ],
```

and add to imports at top:

```ts
import { AnalystService } from './analyst.service';
```

- [ ] **Step 3: typecheck**

Run: `cd server && pnpm typecheck`
Expected: clean.

- [ ] **Step 4: Commit**
```sh
git add server/src/agentos/analyst.service.ts server/src/agentos/agentos.module.ts
git commit -m "feat(agentos): AnalystService — structured settlement after write_chapter

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 7: `write_chapter` tool returns `chapterId`

**Files:**
- Modify: `server/src/agentos/tools/write-chapter.tool.ts`

- [ ] **Step 1: Add `chapterId` to the return**

Open `server/src/agentos/tools/write-chapter.tool.ts`. The tool already resolves `chapter` via `findOrCreateByOrder` (which returns the row including `id`). Change the return object (currently lines ~47-51) to include `chapterId`:

```ts
      return {
        ok: true as const,
        chapterOrder,
        chapterId: chapter.id,
        message: `已${op === 'append' ? '追加到' : '重写'}第 ${chapterOrder} 章。`,
      };
```

Leave the rest of the file unchanged. (The `chapterOrder` is the schema input; `chapter.id` is the persisted cuid. Both now returned so the swarm can detect a successful write by reading the ToolMessage result.)

- [ ] **Step 2: typecheck + test**

Run: `cd server && pnpm typecheck && pnpm test`
Expected: clean + all green.

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

- [ ] **Step 1: Write the failing test**

Create `server/src/agentos/context-assembler.memory.spec.ts`:

```ts
import { ContextAssembler } from './context-assembler.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SummaryService } from '../memory/chapter-summary.service';
import type { StoryEventService } from '../memory/story-event.service';

interface PrismaMock {
  novel: { findFirst: jest.Mock };
}

function novelRow() {
  return {
    id: 'n1',
    title: '剑来',
    genre: '仙侠',
    synopsis: '少年下山',
    settings: { worldviewText: '剑修世界', style: '沉稳' },
    status: 'ACTIVE',
  };
}

describe('ContextAssembler memory injection', () => {
  it('injects recent chapter summaries + open hooks into an ACTIVE novel prompt', async () => {
    const prisma: PrismaMock = { novel: { findFirst: jest.fn().mockResolvedValue(novelRow()) } };
    const summaries = {
      listRecent: jest.fn().mockResolvedValue([
        { summary: '主角觉醒', chapterOrder: 2 },
        { summary: '主角下山', chapterOrder: 1 },
      ]),
    };
    const events = {
      listOpen: jest.fn().mockResolvedValue([
        { id: 'e1', description: '黑影身份', openedAtChapter: 1 },
      ]),
    };
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

  it('omits the memory slices when there are none', async () => {
    const prisma: PrismaMock = { novel: { findFirst: jest.fn().mockResolvedValue(novelRow()) } };
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

  it('still returns SYSTEM_PROMPT fallback when novel lookup misses', async () => {
    const prisma: PrismaMock = { novel: { findFirst: jest.fn().mockResolvedValue(null) } };
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
    expect(prompt).toBe(SYSTEM_PROMPT_MARKER); // see note below
  });
});

// The fallback is the SYSTEM_PROMPT constant imported in the service.
// Re-declare the same literal to assert equality without a circular import.
const SYSTEM_PROMPT_MARKER =
  'You are a helpful, concise assistant. Reply in the same language as the user.';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm test -- context-assembler.memory.spec.ts`
Expected: FAIL — constructor signature mismatch (service doesn't take summaries/events yet).

- [ ] **Step 3: Modify the service**

Open `server/src/agentos/context-assembler.service.ts`. Full new content:

```ts
import { Injectable } from '@nestjs/common';
import { SYSTEM_PROMPT } from './agentos.constants';
import { PrismaService } from '../prisma/prisma.service';
import { SummaryService } from '../memory/chapter-summary.service';
import { StoryEventService } from '../memory/story-event.service';

interface NovelPromptInput {
  title: string;
  genre: string | null;
  synopsis: string | null;
  settings?: unknown;
}

interface NovelSettings {
  style?: string;
  language?: string;
  worldviewText?: string;
}

/**
 * 把小说设定 + 记忆切片(近期章节摘要 + OPEN 伏笔)组装成 system prompt。
 * Phase 1 拼 title/genre/synopsis/settings;Analyst 之后再加【前情】/【未回收伏笔】。
 */
@Injectable()
export class ContextAssembler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly summaries: SummaryService,
    private readonly events: StoryEventService,
  ) {}

  /** 组装 system prompt(状态指令:CONCEPT→update_novel / ACTIVE→transfer_to_writer)。 */
  buildSystemPrompt(novel: NovelPromptInput, status?: string): string {
    const raw = novel.settings;
    const s: NovelSettings =
      raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
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
      lines.push(
        '【状态】写作中——信息已齐。作者要写正文时,用 transfer_to_writer 转交写作 Agent。',
      );
    }
    return lines.join('\n');
  }

  /**
   * 由聊天 session(=novel.sessionId)反查小说,组装 prompt + 记忆切片。
   * 记忆切片注入位置:文风/语言之后、状态指令之前。
   * select 收紧成 prompt 构造所需 + id 字段。
   */
  async forSession(
    userId: string,
    sessionId: string,
  ): Promise<{ prompt: string; novelId: string | null }> {
    const novel = await this.prisma.novel.findFirst({
      where: { sessionId, userId },
      select: {
        title: true,
        genre: true,
        synopsis: true,
        settings: true,
        id: true,
        status: true,
      },
    });
    if (!novel) return { prompt: SYSTEM_PROMPT, novelId: null };

    const base = this.buildSystemPrompt(novel, novel.status);

    // 记忆切片:近期 5 章摘要(升序拼,从早到近)+ 全部 OPEN 伏笔。
    const recent = await this.summaries.listRecent(userId, novel.id, 5);
    const openHooks = await this.events.listOpen(userId, novel.id);
    const slices: string[] = [];
    if (recent.length) {
      const recap = recent
        .slice()
        .reverse() // listRecent 是倒序,这里翻成升序(早→近)
        .map((r) => `第${r.chapterOrder}章:${r.summary}`)
        .join(' / ');
      slices.push(`【前情】${recap}`);
    }
    if (openHooks.length) {
      slices.push(`【未回收伏笔】${openHooks.map((h) => h.description).join(' · ')}`);
    }

    if (!slices.length) return { prompt: base, novelId: novel.id };
    // 插在「规则:...」之前的状态:把记忆切片插到 base 里「规则:」那一行的前面。
    const insertMarker = '规则:不要编造与设定冲突的情节';
    const idx = base.indexOf(insertMarker);
    if (idx === -1) return { prompt: base, novelId: novel.id };
    const withMemory =
      base.slice(0, idx) +
      slices.join('\n') +
      '\n' +
      base.slice(idx);
    return { prompt: withMemory, novelId: novel.id };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && pnpm test -- context-assembler.memory.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run full suite (ensure existing context-assembler.service.spec.ts still passes with the new constructor)**

Run: `cd server && pnpm test -- context-assembler`
Expected: PASS — but the **existing** `context-assembler.service.spec.ts` constructs `ContextAssembler` with the old 1-arg signature. **If it breaks, update it** to pass two stub services:
```ts
const summaries = { listRecent: jest.fn().mockResolvedValue([]) } as unknown as SummaryService;
const events = { listOpen: jest.fn().mockResolvedValue([]) } as unknown as StoryEventService;
new ContextAssembler(prisma, summaries, events);
```
Apply the same stub to any other test in that file that constructs the service.

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
import type { SummaryService } from '../../memory/chapter-summary.service';
import type { StoryEventService } from '../../memory/story-event.service';
import { PrismaService } from '../../prisma/prisma.service';

function makeDeps() {
  const prisma = {
    chapterSummary: { findMany: jest.fn() },
    storyEvent: { findMany: jest.fn() },
  };
  // query_memory searches the raw prisma tables directly (contains search),
  // so we inject prisma + the two services (for type symmetry only here).
  const summaries = { listRecent: jest.fn() } as unknown as SummaryService;
  const events = { listOpen: jest.fn() } as unknown as StoryEventService;
  return { prisma, summaries, events };
}

describe('query_memory tool', () => {
  it('returns matching summaries + hooks by keyword (case-insensitive contains)', async () => {
    const { prisma, summaries, events } = makeDeps();
    prisma.chapterSummary.findMany.mockResolvedValue([
      { summary: '陈平安觉醒剑修', chapter: { order: 2 } },
    ]);
    prisma.storyEvent.findMany.mockResolvedValue([
      { id: 'e1', description: '陈平安的身世', status: 'OPEN' },
    ]);
    const tool = makeQueryMemoryTool({
      userId: 'u1',
      novelId: 'n1',
      prisma: prisma as unknown as PrismaService,
      summaries,
      events,
    });
    const out = (await (tool as unknown as { invoke: (a: unknown) => Promise<unknown> }).invoke({
      query: '陈平安',
    })) as { summaries: unknown[]; hooks: unknown[] };
    expect(prisma.chapterSummary.findMany).toHaveBeenCalledWith({
      where: {
        novelId: 'n1',
        OR: [
          { summary: { contains: '陈平安', mode: 'insensitive' } },
          { roleChanges: { string_contains: '陈平安' } },
          { entities: { string_contains: '陈平安' } },
        ],
      },
      take: 10,
      orderBy: { chapter: { order: 'desc' } },
      select: { summary: true, chapter: { select: { order: true } } },
    });
    expect(out.summaries).toEqual([
      { chapterOrder: 2, summary: '陈平安觉醒剑修' },
    ]);
    expect(out.hooks).toEqual([
      { id: 'e1', description: '陈平安的身世', status: 'OPEN' },
    ]);
  });

  it('scopes by kind=hook (only hooks)', async () => {
    const { prisma, summaries, events } = makeDeps();
    prisma.storyEvent.findMany.mockResolvedValue([
      { id: 'e1', description: '钥匙', status: 'OPEN' },
    ]);
    const tool = makeQueryMemoryTool({
      userId: 'u1',
      novelId: 'n1',
      prisma: prisma as unknown as PrismaService,
      summaries,
      events,
    });
    const out = (await (tool as unknown as { invoke: (a: unknown) => Promise<unknown> }).invoke({
      query: '钥匙',
      kind: 'hook',
    })) as { summaries: unknown[]; hooks: unknown[] };
    expect(prisma.chapterSummary.findMany).not.toHaveBeenCalled();
    expect(out.hooks).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm test -- query-memory.tool.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the tool**

Create `server/src/agentos/tools/query-memory.tool.ts`:

```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SummaryService } from '../../memory/chapter-summary.service';
import type { StoryEventService } from '../../memory/story-event.service';

/**
 * Writer 的主动记忆检索工具(只读)。关键词在 章节摘要 / 角色变化 / 物品设定 /
 * 伏笔 里 contains 模糊匹配(大小写不敏感)。P2 只做关键词(P3 再加语义)。
 * userId/novelId 闭包注入。kind 省略时同时搜 summary + hook。
 */
export function makeQueryMemoryTool({
  userId,
  novelId,
  prisma,
}: {
  userId: string;
  novelId: string;
  prisma: PrismaService;
  summaries: SummaryService; // 保留入参以备将来按 service 查;本期直接走 prisma contains
  events: StoryEventService;
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
            novelId,
            chapter: { novel: { userId } },
            OR: [
              { summary: { contains: q, mode: 'insensitive' } },
              { roleChanges: { string_contains: q } },
              { entities: { string_contains: q } },
            ],
          },
          take: 10,
          orderBy: { chapter: { order: 'desc' } },
          select: { summary: true, chapter: { select: { order: true } } },
        });
        summaries = rows.map((r) => ({ chapterOrder: r.chapter.order, summary: r.summary }));
      }

      let hooks: Array<{ id: string; description: string; status: string }> = [];
      if (wantHook) {
        const rows = await prisma.storyEvent.findMany({
          where: {
            novelId,
            novel: { userId },
            description: { contains: q, mode: 'insensitive' },
          },
          take: 10,
          orderBy: { createdAt: 'asc' },
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
        kind: z
          .enum(['role', 'hook', 'entity', 'summary'])
          .optional()
          .describe('限定检索维度;省略则同时搜摘要与伏笔'),
      }),
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && pnpm test -- query-memory.tool.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: typecheck**

Run: `cd server && pnpm typecheck`
Expected: clean. (If `roleChanges: { string_contains }` / `mode: 'insensitive'` type-errors under the Prisma JSON filter, that's expected on some Prisma versions — if so, cast the `where` to `as never` at the `findMany` call site. Prefer keeping it typed; only cast if typecheck fails.)

- [ ] **Step 6: Commit**
```sh
git add server/src/agentos/tools/query-memory.tool.ts server/src/agentos/tools/query-memory.tool.spec.ts
git commit -m "feat(agentos): query_memory read-tool (keyword search over summaries + hooks)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 10: Wire Analyst + query_memory into the swarm; serial settle in `streamTurn`

**Files:**
- Modify: `server/src/agentos/workspace-swarm.service.ts`
- Modify: `server/src/agentos/agentos.controller.ts`

> No jest test for the swarm itself (LLM-bound). The pure pieces (services, prompt, tool) are tested in Tasks 2/3/8/9. This task is integration wiring — verified by `typecheck` + manual run.

- [ ] **Step 1: Extend `WorkspaceSwarmService` constructor + writer tool + `streamTurn`**

Open `server/src/agentos/workspace-swarm.service.ts`. Make these changes:

**a) Imports** — add at top (after the existing imports):
```ts
import { PrismaService } from '../prisma/prisma.service';
import { AnalystService } from './analyst.service';
import { makeQueryMemoryTool } from './tools/query-memory.tool';
import type { StreamSignal, MemoryUpdated } from './analyst-schema';
```

**b) Constructor** — add the new deps:
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

**c) Writer agent tools** — inside `getSwarm`, in the `writer`'s `tools` array (after `makeWriteChapterTool(...)`), add `query_memory`:
```ts
        tools: [
          makeListChaptersTool({ userId, novelId, chapters: this.chapters }) as never,
          makeWriteChapterTool({
            userId,
            novelId,
            chapters: this.chapters,
            registry: this.registry,
            novels: this.novels,
          }) as never,
          makeQueryMemoryTool({
            userId,
            novelId,
            prisma: this.prisma,
            summaries: undefined as never,
            events: undefined as never,
          }) as never,
          createHandoffTool({ agentName: 'main' }),
        ],
```

> The `query_memory` factory takes `summaries`/`events` for shape only (it queries prisma directly). Pass `undefined as never` to satisfy the signature; the tool body never touches them. Guard in `getSwarm`: `if (!this.prisma) throw new Error('PrismaService not wired');`.

**d) `streamTurn`** — replace the method body. The return type widens to `AsyncGenerator<string | StreamSignal>`, and it now detects the `write_chapter` **ToolMessage result** and runs a serial settle:

```ts
  /** 在 thread 上推进一轮;逐块产出文本增量 + 信号(writing-chapter/settling/memory-*)。 */
  async *streamTurn({
    userId,
    novelId,
    threadId,
    userMessage,
    systemPrompt,
  }: {
    userId: string;
    novelId: string;
    threadId: string;
    userMessage: string;
    systemPrompt: string;
  }): AsyncGenerator<string | StreamSignal> {
    const swarm = await this.getSwarm(userId, novelId, systemPrompt);
    const stream = await swarm.stream(
      { messages: [{ role: 'user', content: userMessage }] },
      { configurable: { thread_id: threadId }, streamMode: 'messages' },
    );

    let settledChapterOrder: number | null = null;

    for await (const chunk of stream) {
      const msg = (Array.isArray(chunk) ? chunk[0] : chunk) as {
        // AIMessage with tool_calls
        tool_calls?: Array<{ name: string; args?: { chapterOrder?: number } }>;
        // ToolMessage (tool result): name + parsed content
        name?: string;
        content?: string;
      };

      // (1) AIMessage 决定要写 → 通知前端骨架(writing-chapter)。
      if (msg?.tool_calls) {
        for (const tc of msg.tool_calls) {
          if (tc.name === 'write_chapter' && typeof tc.args?.chapterOrder === 'number') {
            yield { type: 'writing-chapter', order: tc.args.chapterOrder };
          }
        }
      }

      // (2) ToolMessage = write_chapter 的返回结果。ok:true → 记下要结算的章。
      //     ToolMessage 在 messages 模式下 content 是 JSON 字符串(工具 return 值)。
      if (msg?.name === 'write_chapter' && typeof msg.content === 'string') {
        try {
          const parsed = JSON.parse(msg.content) as {
            ok?: boolean;
            chapterOrder?: number;
          };
          if (parsed.ok === true && typeof parsed.chapterOrder === 'number') {
            settledChapterOrder = parsed.chapterOrder;
          }
        } catch {
          /* 非 JSON 内容,忽略 */
        }
      }

      const delta = extractDelta(chunk);
      if (delta) yield delta;
    }

    // (3) 正文流结束 + 本轮确有成功写章 → 串行结算(失败静默降级)。
    if (settledChapterOrder !== null && this.analyst) {
      yield { type: 'settling' };
      try {
        const memory: MemoryUpdated = await this.analyst.settle({
          userId,
          novelId,
          chapterOrder: settledChapterOrder,
        });
        yield { type: 'memory-updated', data: memory.data };
      } catch (err) {
        console.error(
          `[agentos] analyst settle failed (novel ${novelId} ch${settledChapterOrder}):`,
          err instanceof Error ? err.message : err,
        );
        yield { type: 'memory-skip' };
      }
    }
  }
```

- [ ] **Step 2: Emit the 3 new frames from the controller**

Open `server/src/agentos/agentos.controller.ts`. In the `for await (const item of this.workspace.streamTurn(...))` loop, the current branches handle `typeof item === 'string'` (RunContent) and `item.type === 'writing-chapter'` (WritingChapter). Add three branches. Replace the loop body's signal handling so it reads (after the existing `string` and `writing-chapter` branches):

```ts
        } else if (item.type === 'settling') {
          res.write(
            JSON.stringify({ event: 'Settling', created_at: now() }) + '\n',
          );
        } else if (item.type === 'memory-updated') {
          res.write(
            JSON.stringify({
              event: 'MemoryUpdated',
              data: item.data,
              created_at: now(),
            }) + '\n',
          );
        } else if (item.type === 'memory-skip') {
          res.write(
            JSON.stringify({ event: 'MemorySkip', created_at: now() }) + '\n',
          );
        }
```

> The `RunCompleted` frame is still emitted after the loop (unchanged). The serial settle runs **inside** `streamTurn` (before it returns), so `Settling`/`MemoryUpdated`/`MemorySkip` arrive before `RunCompleted` — exactly the §5.3 ordering the FE relies on.

- [ ] **Step 3: typecheck**

Run: `cd server && pnpm typecheck`
Expected: clean.

- [ ] **Step 4: Run full server test suite**

Run: `cd server && pnpm test`
Expected: all green (the swarm/controller changes aren't unit-tested, but nothing should break).

- [ ] **Step 5: Build**

Run: `cd server && pnpm build`
Expected: clean (`dist/` updated).

- [ ] **Step 6: Commit**
```sh
git add server/src/agentos/workspace-swarm.service.ts server/src/agentos/agentos.controller.ts
git commit -m "feat(agentos): serial Analyst settlement in streamTurn + query_memory tool

Detect write_chapter ToolMessage result (ok), then serially run AnalystService.settle
between the last RunContent and RunCompleted, yielding Settling/MemoryUpdated/MemorySkip.
Writer now also has query_memory.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 11: FE types — `MemoryUpdatedData` + `memory` on ChatMessage + new RunEvents

**Files:**
- Modify: `agent-ui/src/types/os.ts`

- [ ] **Step 1: Add types + extend enums**

Open `agent-ui/src/types/os.ts`. 

In the `RunEvent` enum, add (anywhere in the list):
```ts
  // Analyst settlement events (custom, server-emitted)
  Settling = 'Settling',
  MemoryUpdated = 'MemoryUpdated',
  MemorySkip = 'MemorySkip',
```

Add a new interface (near the other interfaces, e.g. after `RunResponse`):
```ts
export interface RoleChangeFact {
  name: string
  change: string
}
export interface EntityFact {
  type: 'item' | 'place' | 'setting'
  name: string
  note: string
}
export interface MemoryUpdatedData {
  chapterOrder: number
  summary: string
  roleChanges: RoleChangeFact[]
  entities: EntityFact[]
  newHooks: string[]
  resolvedHooks: { id: string; description: string }[]
}
```

On the `ChatMessage` interface, add an optional field:
```ts
  memory?: MemoryUpdatedData
```

- [ ] **Step 2: typecheck + validate**

Run: `cd agent-ui && pnpm typecheck && pnpm validate`
Expected: clean.

- [ ] **Step 3: Commit**
```sh
git add agent-ui/src/types/os.ts
git commit -m "feat(agent-ui): MemoryUpdatedData + memory on ChatMessage + Settling events

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 12: FE store — `isSettling` + `pendingMemory`

**Files:**
- Modify: `agent-ui/src/store.ts`

- [ ] **Step 1: Add state + setters to the Store interface and implementation**

Open `agent-ui/src/store.ts`. 

In the `Store` interface, add (next to `writingChapterOrder`):
```ts
  isSettling: boolean
  setIsSettling: (isSettling: boolean) => void
  pendingMemory: MemoryUpdatedData | null
  setPendingMemory: (memory: MemoryUpdatedData | null) => void
```

Add the import at top:
```ts
import { AuthUser, SessionEntry, type ChatMessage, type MemoryUpdatedData } from '@/types/os'
```

In the `create` initializer (next to `writingChapterOrder: null`):
```ts
      isSettling: false,
      setIsSettling: (isSettling) => set(() => ({ isSettling })),
      pendingMemory: null,
      setPendingMemory: (memory) => set(() => ({ pendingMemory: memory })),
```

In `logout()` and `login()` reset objects, add `isSettling: false, pendingMemory: null` (alongside `writingChapterOrder: null`).

- [ ] **Step 2: typecheck**

Run: `cd agent-ui && pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Commit**
```sh
git add agent-ui/src/store.ts
git commit -m "feat(agent-ui): isSettling + pendingMemory store state

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 13: FE stream handler — handle Settling/MemoryUpdated/MemorySkip

**Files:**
- Modify: `agent-ui/src/hooks/useAIStreamHandler.tsx`

- [ ] **Step 1: Add the three event branches**

Open `agent-ui/src/hooks/useAIStreamHandler.tsx`. 

Pull the two setters from the store (next to the other `useStore` selectors near the top):
```ts
  const setIsSettling = useStore((state) => state.setIsSettling)
  const setPendingMemory = useStore((state) => state.setPendingMemory)
```

In the `onChunk` callback's event chain, the existing `WritingChapter` branch is at line ~352:
```ts
            } else if (chunk.event === ('WritingChapter' as RunEvent)) {
```
Add three new branches **after** the `WritingChapter` branch and **before** the `RunCompleted` branch:

```ts
            } else if (chunk.event === ('Settling' as RunEvent)) {
              setIsSettling(true)
            } else if (chunk.event === ('MemoryUpdated' as RunEvent)) {
              setIsSettling(false)
              setPendingMemory((chunk as { data?: MemoryUpdatedData }).data ?? null)
            } else if (chunk.event === ('MemorySkip' as RunEvent)) {
              setIsSettling(false)
              setPendingMemory(null)
            }
```

Add `MemoryUpdatedData` to the type import at top:
```ts
import { RunEvent, RunResponseContent, type RunResponse, type MemoryUpdatedData } from '@/types/os'
```

- [ ] **Step 2: Fold `pendingMemory` into the finalized agent message on `RunCompleted`**

In the `RunCompleted` branch (line ~360-403), the `setMessages` callback builds the updated agent message via `{ ...message, content, tool_calls, ... }`. Add `memory` to that object so the pending memory attaches to the message being finalized. Change the returned object to include:

```ts
                    return {
                      ...message,
                      content: updatedContent,
                      tool_calls: processChunkToolCalls(chunk, message.tool_calls),
                      images: chunk.images ?? message.images,
                      videos: chunk.videos ?? message.videos,
                      response_audio: chunk.response_audio,
                      created_at: chunk.created_at ?? message.created_at,
                      memory: useStore.getState().pendingMemory ?? message.memory,
                      extra_data: {
                        reasoning_steps:
                          chunk.extra_data?.reasoning_steps ??
                          message.extra_data?.reasoning_steps,
                        references:
                          chunk.extra_data?.references ?? message.extra_data?.references
                      }
                    }
```

Then, immediately after the `RunCompleted` `setMessages(...)` call returns (still inside the `else if (RunCompleted)` block, after the closing `})` of `setMessages`), clear the pending memory:
```ts
              setPendingMemory(null)
```

> Why read `useStore.getState().pendingMemory` inside the updater rather than a closure var: the `onChunk` callback closes over the store setters, but `pendingMemory` is set by an earlier chunk in the same stream — `getState()` reads the live value at finalization time, avoiding stale-closure issues.

- [ ] **Step 3: Ensure `isSettling` is cleared at stream end**

In the `finally` block (line ~442), it already does `setIsStreaming(false)` and `setWritingChapterOrder(null)`. Add:
```ts
        setIsSettling(false)
```
(so a crashed/errored stream never leaves the UI stuck in "结算中").

- [ ] **Step 4: typecheck + validate**

Run: `cd agent-ui && pnpm typecheck && pnpm validate`
Expected: clean.

- [ ] **Step 5: Commit**
```sh
git add agent-ui/src/hooks/useAIStreamHandler.tsx
git commit -m "feat(agent-ui): handle Settling/MemoryUpdated/MemorySkip in stream handler

MemoryUpdated data staged in pendingMemory, folded into the finalized agent
message on RunCompleted (timing: MemoryUpdated arrives before RunCompleted).

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

import { useState } from 'react'
import type { MemoryUpdatedData } from '@/types/os'
import { cn } from '@/lib/utils'

interface Props {
  memory: MemoryUpdatedData
}

/**
 * Agent 消息下方的「本章记忆」气泡。默认折叠(一行概览),展开看四类分组。
 * 暗色弱化样式(text-muted / 小字 / brand 左边框)。
 */
const MemoryBubble = ({ memory }: Props) => {
  const [open, setOpen] = useState(false)

  const hookCount = memory.newHooks.length + memory.resolvedHooks.length
  const overview = `🧠 已记忆:摘要${memory.summary ? '·1' : ''} · 变化${memory.roleChanges.length} · 设定${memory.entities.length} · 伏笔${hookCount}`

  return (
    <div className="mt-3 w-full rounded-lg border-l-2 border-brand/60 bg-background-secondary/60 px-3 py-2 text-xs text-muted">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="truncate">{overview}</span>
        <span className={cn('ml-2 shrink-0 transition-transform', open && 'rotate-90')}>
          ▸
        </span>
      </button>

      {open && (
        <div className="mt-2 space-y-2 border-t border-primary/10 pt-2">
          <Group title="摘要">{memory.summary || '—'}</Group>
          {memory.roleChanges.length > 0 && (
            <Group title="角色变化">
              {memory.roleChanges.map((r, i) => (
                <div key={i}>
                  <span className="text-primary">{r.name}</span> · {r.change}
                </div>
              ))}
            </Group>
          )}
          {memory.entities.length > 0 && (
            <Group title="物品 / 地点 / 设定">
              {memory.entities.map((e, i) => (
                <div key={i}>
                  <span className="text-primary">[{e.type}] {e.name}</span> · {e.note}
                </div>
              ))}
            </Group>
          )}
          {(memory.newHooks.length > 0 || memory.resolvedHooks.length > 0) && (
            <Group title="伏笔">
              {memory.newHooks.map((h, i) => (
                <div key={`n${i}`}>🆕 {h}</div>
              ))}
              {memory.resolvedHooks.map((h, i) => (
                <div key={`r${i}`}>✅ {h.description}</div>
              ))}
            </Group>
          )}
        </div>
      )}
    </div>
  )
}

const Group = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div>
    <div className="mb-1 text-[10px] uppercase tracking-wide text-muted/60">{title}</div>
    <div className="space-y-0.5 leading-relaxed">{children}</div>
  </div>
)

export default MemoryBubble
```

- [ ] **Step 2: typecheck + validate**

Run: `cd agent-ui && pnpm typecheck && pnpm validate`
Expected: clean. (If `React.ReactNode` needs an import, add `import type { ReactNode } from 'react'` and use `ReactNode`. Prefer that if `React` namespace isn't in scope.)

- [ ] **Step 3: Commit**
```sh
git add agent-ui/src/components/chat/ChatArea/Messages/MemoryBubble.tsx
git commit -m "feat(agent-ui): MemoryBubble — collapsible per-message memory display

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 15: Render `MemoryBubble` under agent messages

**Files:**
- Modify: `agent-ui/src/components/chat/ChatArea/Messages/MessageItem.tsx`

- [ ] **Step 1: Render the bubble in `AgentMessage`**

Open `agent-ui/src/components/chat/ChatArea/Messages/MessageItem.tsx`. Add the import:
```ts
import MemoryBubble from './MemoryBubble'
```

In the `AgentMessage` component, the `messageContent` is the main bubble. Wrap the return so the memory bubble renders **below** the message content when `message.memory` is present. Change the `return` of `AgentMessage` from:

```tsx
  return (
    <div className="flex flex-row items-start gap-4 font-geist">
      <div className="flex-shrink-0">
        <Icon type="agent" size="sm" />
      </div>
      {messageContent}
    </div>
  )
```

to:

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

- [ ] **Step 2: typecheck + validate**

Run: `cd agent-ui && pnpm typecheck && pnpm validate`
Expected: clean.

- [ ] **Step 3: Commit**
```sh
git add agent-ui/src/components/chat/ChatArea/Messages/MessageItem.tsx
git commit -m "feat(agent-ui): render MemoryBubble under agent messages with memory

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 16: ChatInput "结算中…" bar + disable while settling

**Files:**
- Modify: `agent-ui/src/components/chat/ChatArea/ChatInput/ChatInput.tsx`

- [ ] **Step 1: Read the current ChatInput**

Run: `cd agent-ui && cat src/components/chat/ChatArea/ChatInput/ChatInput.tsx | head -80`
Read the full file to find (a) the submit/disable logic and (b) where the input row renders, so you can insert the status bar. (The component wires `useAIChatStreamHandler` + a textarea; `isStreaming` typically disables submit.)

- [ ] **Step 2: Subscribe to `isSettling` and show the bar + disable submit**

In `ChatInput.tsx`:
- Add: `const isSettling = useStore((state) => state.isSettling)` (and `import { useStore } from '@/store'` if not already imported).
- Treat settling like streaming for the **submit button** disable: wherever the disable condition uses `isStreaming` (e.g. `disabled={isStreaming}` or `!message.trim() || isStreaming`), extend it to `isStreaming || isSettling`.
- Render a status bar **above** the textarea/input row (inside the component's returned JSX, before the input row):
```tsx
        {isSettling && (
          <div className="mb-2 rounded-md border border-brand/30 bg-brand/5 px-3 py-1.5 text-xs text-muted">
            🧠 AI 正在结算本章记忆…
          </div>
        )}
```
- Match the existing structure — do not restructure the component beyond adding this bar and the disable flag. Follow the file's existing className conventions.

> If the disable logic is non-obvious (e.g. the submit is triggered by Enter in the textarea), disable there too: guard the submit handler with `if (isStreaming || isSettling) return`.

- [ ] **Step 3: typecheck + validate + build**

Run: `cd agent-ui && pnpm typecheck && pnpm validate && pnpm build`
Expected: clean.

- [ ] **Step 4: Commit**
```sh
git add agent-ui/src/components/chat/ChatArea/ChatInput/ChatInput.tsx
git commit -m "feat(agent-ui): show 结算中 bar + disable input while settling

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 17: Full-stack smoke test + finalize

**Files:** none (verification)

- [ ] **Step 1: Server build + full test suite**

Run: `cd server && pnpm typecheck && pnpm test && pnpm build`
Expected: all green, clean build.

- [ ] **Step 2: FE validate + build**

Run: `cd agent-ui && pnpm typecheck && pnpm validate && pnpm build`
Expected: clean.

- [ ] **Step 3: Manual end-to-end (requires running server + DB + ZHIPUAI key)**

Start the stack: `pnpm dev` at repo root (agent-ui :3000, server :3001). In the browser:
1. Create a new novel, complete onboarding (CONCEPT → fill 5 fields → main agent transfers to writer).
2. Ask the writer to write chapter 1.
3. **Expected:** while writing → ChapterPreview skeleton (existing). After the stream's RunContent ends → a `Settling` status bar appears ("🧠 AI 正在结算本章记忆…") with ChatInput disabled. A few seconds later → the agent message shows a `MemoryBubble` (collapsed) below it; expand to see summary / role changes / entities / hooks. Then `RunCompleted`, input re-enabled.
4. Ask the writer to write chapter 2 → confirm a second memory bubble appears and the OPEN hook from ch1 can be resolved (if the plot resolves it) → shows ✅.
5. Reload the page → memory bubbles persist (they're stored on the message via the stream; note: history reload via `/sessions/:id/runs` does NOT currently carry `memory` — that's an accepted limitation; bubbles only render for messages produced in the live session).

> If the `Settling` frame never appears, the ToolMessage detection in Task 10 isn't matching — check the `write_chapter` ToolMessage `content` shape (log it). If GLM wraps the tool return differently, adjust the JSON.parse guard. If `MemorySkip` appears instead of `MemoryUpdated`, check server logs for the analyst error.

- [ ] **Step 4: Commit any fixups + tag**

```sh
git add -A
git commit -m "chore(analyst): post-smoke fixups" --allow-empty
git tag v0.5.0
```

(Only tag if the smoke test passes. If issues found, fix in new commits first.)

---

## Self-Review

**Spec coverage:**
- §2 角色边界(Analyst 不进 swarm,独立 service) → Task 6 (AnalystService) + Task 10 (called from streamTurn, not a swarm agent). ✓
- §2.1 触发点 = write_chapter 落稿成功(ToolMessage) → Task 7 (returns chapterId/ok) + Task 10 (detects ToolMessage result). ✓
- §3.1 ChapterSummary(1:1) → Task 1 (model) + Task 2 (service). ✓
- §3.2 StoryEvent(OPEN/RESOLVED, id 回填) → Task 1 (model) + Task 3 (service). ✓
- §4.1 Analyst 独立 service / temp 0.1 / structured output / 不走 agent 循环 → Task 6. ✓
- §4.2 输入(本章正文 + 设定 + OPEN 伏笔) → Task 6 settle(). ✓
- §4.3 analystSchema(zod) → Task 5. ✓
- §4.4 落库走 service,不走 mutation 层 → Task 6 (uses SummaryService/StoryEventService, no ResourceRegistry). ✓
- §4.5 settle 签名 → Task 6. ✓
- §4.6 MemoryUpdated(回填 resolvedHooks.description) → Task 5 (type) + Task 6 (回填). ✓
- §5.1 触发点改造(ToolMessage) → Task 10. ✓
- §5.2 失败静默 → Task 10 (try/catch → memory-skip). ✓
- §5.3 三帧 Settling/MemoryUpdated/MemorySkip + 时序(pendingMemory) → Task 10 (yield) + Task 13 (pendingMemory + RunCompleted fold). ✓
- §6.1 注入(近期5章 + OPEN 伏笔) → Task 8. ✓
- §6.2 query_memory(关键词) → Task 9 + Task 10 (wired into writer). ✓
- §7.1 信号帧处理 + 消息结构扩展 → Task 11 (types) + Task 13 (handler). ✓
- §7.2 记忆气泡(可折叠四组) → Task 14. ✓
- §7.3 Settling 状态条 + ChatInput 禁用 → Task 16. ✓
- §7.4 不动 ResourcePanel / 不加 toast → confirmed (no tasks touch them). ✓

**Placeholder scan:** Task 16 Step 2 says "find the disable logic" via reading the file rather than inlining a line number — that's intentional (the component wasn't fully read in planning), but the step gives the exact code to add and the exact behavior. Acceptable; not a "TODO/figure it out" placeholder. All other steps have full code. No "TBD/add error handling/similar to Task N". ✓

**Type consistency:**
- `StreamSignal` (Task 5) = writing-chapter | settling | memory-updated | memory-skip. Task 10 `streamTurn` returns `AsyncGenerator<string | StreamSignal>` and yields exactly those 4 shapes. Controller (Task 10 Step 2) handles settling/memory-updated/memory-skip + existing writing-chapter. ✓
- `MemoryUpdated['data']` shape (Task 5) == `MemoryUpdatedData` (Task 11) == the `data` the controller emits (Task 10) == what `AnalystService.settle` returns (Task 6). Fields: chapterOrder/summary/roleChanges/entities/newHooks/resolvedHooks — identical across all. ✓
- `SummaryService.upsert` / `listRecent` (Task 2) signatures match Task 6 calls + Task 8 injection. ✓
- `StoryEventService.listOpen`/`createHooks`/`resolveHooks` (Task 3) match Task 6 calls. ✓
- `RoleChange`/`EntityFact` (Task 2) match `analystSchema` (Task 5) and `RoleChangeFact`/`EntityFact` (Task 11). ✓
- `query_memory` factory signature (Task 9) matches the call in Task 10 (passes prisma + undefined for summaries/events). ✓

**No gaps found.** Plan ready for execution.
