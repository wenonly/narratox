# Benchmark Search Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace single `get_benchmark` tool with three focused tools (`list_benchmark_books`, `get_benchmark_entries`, `search_benchmark`) so the writing agent can list, drill into, and search dissection books.

**Architecture:** All Prisma queries and ownership checks live in `BenchmarkService` (3 new methods). Tool layer is thin — schema + delegate + shape output. Tools bind `{ userId, benchmark }` via closure. Wiring: `AgentosModule` imports `BenchmarkModule` so `BenchmarkService` injects into `DeepAgentService`, which passes it through `ToolDeps`.

**Tech Stack:** NestJS 11 + TypeScript + Prisma 7 + `@langchain/core/tools` + Jest

**Spec:** [docs/superpowers/specs/2026-07-14-benchmark-search-tools-design.md](../specs/2026-07-14-benchmark-search-tools-design.md)

---

## File Structure

**Create:**
- `server/src/agentos/tools/list-benchmark-books.tool.ts` — T1 tool
- `server/src/agentos/tools/list-benchmark-books.tool.spec.ts` — T1 spec
- `server/src/agentos/tools/get-benchmark-entries.tool.ts` — T2 tool
- `server/src/agentos/tools/get-benchmark-entries.tool.spec.ts` — T2 spec
- `server/src/agentos/tools/search-benchmark.tool.ts` — T3 tool (owns migrated `filterBenchmarkEntries`)
- `server/src/agentos/tools/search-benchmark.tool.spec.ts` — T3 spec (owns migrated pure-function tests)

**Modify:**
- `server/src/benchmark/benchmark.service.ts` — 3 new methods
- `server/src/benchmark/benchmark.service.spec.ts` — tests for new methods + add `groupBy` to mock
- `server/src/agentos/agentos.module.ts` — import `BenchmarkModule`
- `server/src/agentos/deep-agent.service.ts` — inject `BenchmarkService`, set `benchmark` in ToolDeps
- `server/src/agentos/agent-registry.ts` — remove `get_benchmark`, add 3 new tools
- `server/src/agentos/agent-tree.config.ts` — replace `get_benchmark` in main/writer tools arrays
- `server/src/agentos/agent-tree.config.spec.ts` — update snapshot + ownership assertion
- `server/src/agentos/prompts/main.md` — rewrite 【按需对标参考】 section
- `server/src/agentos/prompts/writer.md` — rewrite 【按需对标参考】 section
- `server/src/agentos/agent-prompts.spec.ts` — update substring assertion for MAIN_AGENT_PROMPT

**Delete:**
- `server/src/agentos/tools/get-benchmark.tool.ts`
- `server/src/agentos/tools/get-benchmark.tool.spec.ts`

---

## Task 1: Wire `BenchmarkService` into `DeepAgentService`

**Files:**
- Modify: `server/src/agentos/agentos.module.ts`
- Modify: `server/src/agentos/deep-agent.service.ts`

This task enables the writing-agent tool layer to access `BenchmarkService`. No tests (pure plumbing) — typecheck is the gate.

- [ ] **Step 1: Add `BenchmarkModule` import to `AgentosModule`**

In `server/src/agentos/agentos.module.ts`, add the import and include in `imports`:

```ts
import { BenchmarkModule } from '../benchmark/benchmark.module';
// ...other imports

@Module({
  imports: [NovelModule, MemoryModule, SettingsModule, KnowledgeModule, BenchmarkModule],
  // ...rest unchanged
})
```

- [ ] **Step 2: Add `BenchmarkService` import + constructor param in `DeepAgentService`**

In `server/src/agentos/deep-agent.service.ts`, add the type import near the other service imports:

```ts
import { BenchmarkService } from '../benchmark/benchmark.service';
```

Add to constructor (after `prisma` line, before `modelConfigs`):

```ts
    private readonly prisma: PrismaService,
    private readonly benchmark: BenchmarkService,
    private readonly modelConfigs: ModelConfigService,
```

- [ ] **Step 3: Set `benchmark` in `ToolDeps` assembly**

In `server/src/agentos/deep-agent.service.ts`, in the `deps: ToolDeps = { ... }` block (around L459-477), add `benchmark`:

```ts
    const deps: ToolDeps = {
      userId,
      novelId,
      readingChapterOrder,
      novels: this.novels,
      chapters: this.chapters,
      outlines: this.outlines,
      world: this.world,
      characters: this.characters,
      references: this.references,
      knowledge: this.knowledge,
      snapshots: this.snapshots,
      summaries: this.summaries,
      events: this.events,
      eventService: this.eventService,
      arcs: this.arcs,
      masterOutlines: this.masterOutlines,
      prisma: this.prisma,
      benchmark: this.benchmark,
    };
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --dir server typecheck`
Expected: PASS (no errors)

- [ ] **Step 5: Commit**

```bash
git add server/src/agentos/agentos.module.ts server/src/agentos/deep-agent.service.ts
git commit -m "feat(agentos): 注入 BenchmarkService 到 DeepAgentService 为新对标工具做准备"
```

---

## Task 2: Add `listBooksWithEntryCounts` to `BenchmarkService`

**Files:**
- Modify: `server/src/benchmark/benchmark.service.spec.ts` (add `groupBy` to mock + new test)
- Modify: `server/src/benchmark/benchmark.service.ts` (new method)

- [ ] **Step 1: Add `groupBy` to prisma mock**

In `server/src/benchmark/benchmark.service.spec.ts`, extend the mock. Replace the `benchmarkEntry` block:

```ts
const prisma = {
  benchmarkBook: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    updateMany: jest.fn(),
  },
  benchmarkEntry: {
    findMany: jest.fn(),
    deleteMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    groupBy: jest.fn(),
  },
};
```

- [ ] **Step 2: Write failing test**

Append to the `describe('BenchmarkService', ...)` block in `server/src/benchmark/benchmark.service.spec.ts`:

```ts
  it('listBooksWithEntryCounts: 聚合 userId 名下每本书的各 type 条目数', async () => {
    prisma.benchmarkBook.findMany.mockResolvedValue([
      {
        id: 'b1',
        title: '盘龙',
        status: 'DONE',
        chapters: [{ chapterNo: 1 }, { chapterNo: 2 }],
        updatedAt: new Date('2026-07-10T00:00:00.000Z'),
      },
    ]);
    prisma.benchmarkEntry.groupBy.mockResolvedValue([
      { bookId: 'b1', type: 'PLOT', _count: { _all: 5 } },
      { bookId: 'b1', type: 'STYLE', _count: { _all: 3 } },
    ]);
    const out = await svc.listBooksWithEntryCounts('u1');
    expect(out).toEqual([
      {
        id: 'b1',
        title: '盘龙',
        status: 'DONE',
        chapterCount: 2,
        entryCountByType: { PLOT: 5, STYLE: 3 },
        updatedAt: new Date('2026-07-10T00:00:00.000Z'),
      },
    ]);
    expect(prisma.benchmarkBook.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u1' },
        orderBy: { updatedAt: 'desc' },
      }),
    );
    expect(prisma.benchmarkEntry.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['bookId', 'type'],
        where: { bookId: { in: ['b1'] } },
        _count: { _all: true },
      }),
    );
  });

  it('listBooksWithEntryCounts: chapters 非数组时 chapterCount=0', async () => {
    prisma.benchmarkBook.findMany.mockResolvedValue([
      {
        id: 'b2',
        title: '坏书',
        status: 'PENDING',
        chapters: null,
        updatedAt: new Date(0),
      },
    ]);
    prisma.benchmarkEntry.groupBy.mockResolvedValue([]);
    const out = await svc.listBooksWithEntryCounts('u1');
    expect(out[0].chapterCount).toBe(0);
    expect(out[0].entryCountByType).toEqual({});
  });

  it('listBooksWithEntryCounts: limit 透传', async () => {
    prisma.benchmarkBook.findMany.mockResolvedValue([]);
    prisma.benchmarkEntry.groupBy.mockResolvedValue([]);
    await svc.listBooksWithEntryCounts('u1', 5);
    expect(prisma.benchmarkBook.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5 }),
    );
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --dir server test -- benchmark.service.spec.ts -t "listBooksWithEntryCounts"`
Expected: FAIL with `svc.listBooksWithEntryCounts is not a function`

- [ ] **Step 4: Implement the method**

In `server/src/benchmark/benchmark.service.ts`, add this method to the `BenchmarkService` class (after `list()`):

```ts
  /**
   * 列出 userId 名下所有对标书 + 每本书各 type 的条目数聚合(供写作 agent T1 工具)。
   * groupBy 一次拿全部 (bookId, type, count) 三元组,内存分桶避免 N+1。
   */
  async listBooksWithEntryCounts(userId: string, limit: number = 20) {
    const books = await this.prisma.benchmarkBook.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        status: true,
        chapters: true,
        updatedAt: true,
      },
    });
    if (books.length === 0) return [];
    const bookIds = books.map((b) => b.id);
    const groups = await this.prisma.benchmarkEntry.groupBy({
      by: ['bookId', 'type'],
      where: { bookId: { in: bookIds } },
      _count: { _all: true },
    });
    const countsByBook = new Map<string, Record<string, number>>();
    for (const g of groups) {
      const bid = g.bookId as string;
      if (!countsByBook.has(bid)) countsByBook.set(bid, {});
      countsByBook.get(bid)![g.type as string] = g._count._all;
    }
    return books.map((b) => ({
      id: b.id,
      title: b.title,
      status: b.status,
      chapterCount: Array.isArray(b.chapters) ? (b.chapters as unknown[]).length : 0,
      entryCountByType: countsByBook.get(b.id) ?? {},
      updatedAt: b.updatedAt,
    }));
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --dir server test -- benchmark.service.spec.ts -t "listBooksWithEntryCounts"`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add server/src/benchmark/benchmark.service.ts server/src/benchmark/benchmark.service.spec.ts
git commit -m "feat(benchmark): listBooksWithEntryCounts 聚合每本书的各 type 条目数"
```

---

## Task 3: Add `findEntriesForUser` to `BenchmarkService`

**Files:**
- Modify: `server/src/benchmark/benchmark.service.spec.ts`
- Modify: `server/src/benchmark/benchmark.service.ts`

- [ ] **Step 1: Write failing test**

Append to the `describe('BenchmarkService', ...)` block:

```ts
  it('findEntriesForUser: book 不存在 → error', async () => {
    prisma.benchmarkBook.findUnique.mockResolvedValue(null);
    const r = await svc.findEntriesForUser('u1', 'bX', {});
    expect(r).toEqual({ error: 'book_not_found' });
  });

  it('findEntriesForUser: book 不归属本人 → error(不泄露存在性)', async () => {
    prisma.benchmarkBook.findUnique.mockResolvedValue({
      id: 'b1',
      userId: 'other',
    });
    const r = await svc.findEntriesForUser('u1', 'b1', {});
    expect(r).toEqual({ error: 'book_not_found' });
  });

  it('findEntriesForUser: 正常返回(归属校验 + type 过滤)', async () => {
    prisma.benchmarkBook.findUnique.mockResolvedValue({
      id: 'b1',
      userId: 'u1',
    });
    const fakeEntries = [
      {
        id: 'e1',
        type: 'PLOT',
        title: '主线',
        content: '内容',
        chapterNo: null,
        kind: null,
        purposes: [],
        order: 0,
      },
    ];
    prisma.benchmarkEntry.findMany.mockResolvedValue(fakeEntries);
    const r = await svc.findEntriesForUser('u1', 'b1', { type: 'PLOT', limit: 30 });
    expect(r).toEqual({ entries: fakeEntries });
    expect(prisma.benchmarkEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bookId: 'b1', type: 'PLOT' },
        orderBy: { order: 'asc' },
        take: 30,
      }),
    );
  });

  it('findEntriesForUser: chapterNo 过滤', async () => {
    prisma.benchmarkBook.findUnique.mockResolvedValue({
      id: 'b1',
      userId: 'u1',
    });
    prisma.benchmarkEntry.findMany.mockResolvedValue([]);
    await svc.findEntriesForUser('u1', 'b1', { chapterNo: 5 });
    expect(prisma.benchmarkEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bookId: 'b1', chapterNo: 5 },
      }),
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir server test -- benchmark.service.spec.ts -t "findEntriesForUser"`
Expected: FAIL with `svc.findEntriesForUser is not a function`

- [ ] **Step 3: Implement the method**

In `server/src/benchmark/benchmark.service.ts`, add after `getEntries`:

```ts
  /**
   * 单书钻取(写作 agent T2):归属校验 → type/chapterNo 过滤。
   * book 不存在或非本人 → 返回 { error: 'book_not_found' }(不抛、不区分两种情况,避免泄露存在性)。
   */
  async findEntriesForUser(
    userId: string,
    bookId: string,
    opts: { type?: string; chapterNo?: number | null; limit?: number },
  ): Promise<
    { entries: Awaited<ReturnType<BenchmarkService['getEntries']>> } | { error: 'book_not_found' }
  > {
    const book = await this.prisma.benchmarkBook.findUnique({
      where: { id: bookId },
      select: { userId: true },
    });
    if (!book || book.userId !== userId) return { error: 'book_not_found' };
    const where: Record<string, unknown> = { bookId };
    if (opts.type) where.type = opts.type;
    if (opts.chapterNo != null) where.chapterNo = opts.chapterNo;
    const entries = await this.prisma.benchmarkEntry.findMany({
      where: where as never,
      orderBy: { order: 'asc' },
      take: opts.limit ?? 30,
    });
    return { entries };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir server test -- benchmark.service.spec.ts -t "findEntriesForUser"`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/benchmark/benchmark.service.ts server/src/benchmark/benchmark.service.spec.ts
git commit -m "feat(benchmark): findEntriesForUser 带归属校验的单书钻取"
```

---

## Task 4: Add `searchEntries` to `BenchmarkService`

**Files:**
- Modify: `server/src/benchmark/benchmark.service.spec.ts`
- Modify: `server/src/benchmark/benchmark.service.ts`

- [ ] **Step 1: Write failing test**

Append to the `describe('BenchmarkService', ...)` block:

```ts
  it('searchEntries: bookTitle 模糊匹配 + 跨书聚合', async () => {
    prisma.benchmarkBook.findMany.mockResolvedValue([
      { id: 'b1', title: '我的超能力每周刷新' },
      { id: 'b2', title: '超能力日记' },
    ]);
    const fakeEntries = [
      {
        id: 'e1',
        bookId: 'b1',
        type: 'PLOT',
        title: '主线',
        content: '…',
        chapterNo: null,
        kind: null,
        purposes: [],
        order: 0,
      },
    ];
    prisma.benchmarkEntry.findMany.mockResolvedValue(fakeEntries);
    const r = await svc.searchEntries('u1', { bookTitle: '超能力' });
    expect(prisma.benchmarkBook.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'u1',
          title: { contains: '超能力', mode: 'insensitive' },
        },
      }),
    );
    expect(r).toEqual([
      {
        entry: fakeEntries[0],
        bookTitle: '我的超能力每周刷新',
      },
    ]);
  });

  it('searchEntries: 无 bookTitle → 跨所有书', async () => {
    prisma.benchmarkBook.findMany.mockResolvedValue([{ id: 'b1', title: 'A' }]);
    prisma.benchmarkEntry.findMany.mockResolvedValue([]);
    await svc.searchEntries('u1', {});
    expect(prisma.benchmarkBook.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1' } }),
    );
  });

  it('searchEntries: bookTitle 无匹配 → 空数组', async () => {
    prisma.benchmarkBook.findMany.mockResolvedValue([]);
    const r = await svc.searchEntries('u1', { bookTitle: '不存在的书' });
    expect(r).toEqual([]);
    expect(prisma.benchmarkEntry.findMany).not.toHaveBeenCalled();
  });

  it('searchEntries: type 过滤透传 + take 放大 3 倍', async () => {
    prisma.benchmarkBook.findMany.mockResolvedValue([{ id: 'b1', title: 'A' }]);
    prisma.benchmarkEntry.findMany.mockResolvedValue([]);
    await svc.searchEntries('u1', { type: 'STYLE', limit: 10 });
    expect(prisma.benchmarkEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bookId: { in: ['b1'] }, type: 'STYLE' },
        take: 30,
      }),
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir server test -- benchmark.service.spec.ts -t "searchEntries"`
Expected: FAIL with `svc.searchEntries is not a function`

- [ ] **Step 3: Implement the method**

In `server/src/benchmark/benchmark.service.ts`, add after `findEntriesForUser`:

```ts
  /**
   * 跨书搜索(写作 agent T3):userId 隔离 + bookTitle 模糊匹配 + type 过滤。
   * kind/purpose/query 不在 Prisma 层做(走工具层纯函数 filterBenchmarkEntries)。
   * take 放大 3 倍,因为内存侧还会过滤。
   */
  async searchEntries(
    userId: string,
    opts: {
      bookTitle?: string;
      type?: string;
      limit?: number;
    },
  ): Promise<
    Array<{
      entry: Awaited<ReturnType<BenchmarkService['getEntries']>>[number];
      bookTitle: string;
    }>
  > {
    const where: Record<string, unknown> = { userId };
    if (opts.bookTitle) {
      where.title = { contains: opts.bookTitle, mode: 'insensitive' };
    }
    const books = await this.prisma.benchmarkBook.findMany({
      where: where as never,
      select: { id: true, title: true },
    });
    if (books.length === 0) return [];
    const idToTitle = new Map(books.map((b) => [b.id, b.title]));
    const entryWhere: Record<string, unknown> = { bookId: { in: books.map((b) => b.id) } };
    if (opts.type) entryWhere.type = opts.type;
    const entries = await this.prisma.benchmarkEntry.findMany({
      where: entryWhere as never,
      orderBy: { order: 'asc' },
      take: (opts.limit ?? 10) * 3,
    });
    return entries.map((entry) => ({
      entry,
      bookTitle: idToTitle.get(entry.bookId) ?? '',
    }));
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir server test -- benchmark.service.spec.ts -t "searchEntries"`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/benchmark/benchmark.service.ts server/src/benchmark/benchmark.service.spec.ts
git commit -m "feat(benchmark): searchEntries 跨书模糊搜索(userId 隔离)"
```

---

## Task 5: Create `list-benchmark-books.tool.ts` (T1)

**Files:**
- Create: `server/src/agentos/tools/list-benchmark-books.tool.ts`
- Create: `server/src/agentos/tools/list-benchmark-books.tool.spec.ts`

- [ ] **Step 1: Write failing test**

Create `server/src/agentos/tools/list-benchmark-books.tool.spec.ts`:

```ts
import { makeListBenchmarkBooksTool } from './list-benchmark-books.tool';
import type { BenchmarkService } from '../../benchmark/benchmark.service';

function makeBenchmarkMock(fn: jest.Mock): BenchmarkService {
  return { listBooksWithEntryCounts: fn } as unknown as BenchmarkService;
}

describe('makeListBenchmarkBooksTool', () => {
  it('返回 books 数组,调用 service.listBooksWithEntryCounts(userId)', async () => {
    const fn = jest.fn().mockResolvedValue([
      {
        id: 'b1',
        title: '盘龙',
        status: 'DONE',
        chapterCount: 30,
        entryCountByType: { PLOT: 5, STYLE: 3 },
        updatedAt: new Date('2026-07-10T00:00:00.000Z'),
      },
    ]);
    const t = makeListBenchmarkBooksTool({
      userId: 'u1',
      benchmark: makeBenchmarkMock(fn),
    });
    const res = (await t.invoke({})) as {
      books: Array<{ id: string; title: string; entryCountByType: Record<string, number> }>;
    };
    expect(fn).toHaveBeenCalledWith('u1', 20);
    expect(res.books).toHaveLength(1);
    expect(res.books[0].title).toBe('盘龙');
    expect(res.books[0].entryCountByType.PLOT).toBe(5);
  });

  it('空库 → { books: [] }', async () => {
    const fn = jest.fn().mockResolvedValue([]);
    const t = makeListBenchmarkBooksTool({
      userId: 'u1',
      benchmark: makeBenchmarkMock(fn),
    });
    const res = (await t.invoke({})) as { books: unknown[] };
    expect(res.books).toEqual([]);
  });

  it('limit 透传', async () => {
    const fn = jest.fn().mockResolvedValue([]);
    const t = makeListBenchmarkBooksTool({
      userId: 'u1',
      benchmark: makeBenchmarkMock(fn),
    });
    await t.invoke({ limit: 5 });
    expect(fn).toHaveBeenCalledWith('u1', 5);
  });

  it('闭包绑定 userId,不读 input', async () => {
    const fn = jest.fn().mockResolvedValue([]);
    const t = makeListBenchmarkBooksTool({
      userId: 'owner',
      benchmark: makeBenchmarkMock(fn),
    });
    await t.invoke({});
    expect(fn).toHaveBeenCalledWith('owner', 20);
  });

  it('工具名 list_benchmark_books', () => {
    const t = makeListBenchmarkBooksTool({
      userId: 'u1',
      benchmark: makeBenchmarkMock(jest.fn()),
    });
    expect(t.name).toBe('list_benchmark_books');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir server test -- list-benchmark-books.tool.spec.ts`
Expected: FAIL with `Cannot find module './list-benchmark-books.tool'`

- [ ] **Step 3: Implement the tool**

Create `server/src/agentos/tools/list-benchmark-books.tool.ts`:

```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { BenchmarkService } from '../../benchmark/benchmark.service';

/**
 * T1:列出当前用户名下所有拆解书 + 各 type 条目数。
 * userId 闭包注入。返回 JSON 字符串(防数组被部分供应商当多模态块 → 400)。
 */
export interface ListBenchmarkBooksDeps {
  userId: string;
  benchmark: BenchmarkService;
}

export const makeListBenchmarkBooksTool = (d: ListBenchmarkBooksDeps) =>
  tool(
    async ({ limit }) => {
      const books = await d.benchmark.listBooksWithEntryCounts(
        d.userId,
        limit ?? 20,
      );
      return JSON.stringify({ books });
    },
    {
      name: 'list_benchmark_books',
      description:
        '列出当前用户名下所有对标拆解书,返回每本书的 id、标题、拆解状态、章数、各拆解维度(PLOT/RHYTHM/EMOTION/CHARACTER/STYLE/MATERIAL/CHAPTER)的条目数。写作时动笔前先调一次,确认对标库有哪些可用。',
      schema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('最多返回几本书,默认 20'),
      }),
    },
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir server test -- list-benchmark-books.tool.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/agentos/tools/list-benchmark-books.tool.ts server/src/agentos/tools/list-benchmark-books.tool.spec.ts
git commit -m "feat(agentos): list_benchmark_books 工具(T1,列书+各 type 条数)"
```

---

## Task 6: Create `get-benchmark-entries.tool.ts` (T2)

**Files:**
- Create: `server/src/agentos/tools/get-benchmark-entries.tool.ts`
- Create: `server/src/agentos/tools/get-benchmark-entries.tool.spec.ts`

- [ ] **Step 1: Write failing test**

Create `server/src/agentos/tools/get-benchmark-entries.tool.spec.ts`:

```ts
import { makeGetBenchmarkEntriesTool } from './get-benchmark-entries.tool';
import type { BenchmarkService } from '../../benchmark/benchmark.service';

function makeBenchmarkMock(fn: jest.Mock): BenchmarkService {
  return { findEntriesForUser: fn } as unknown as BenchmarkService;
}

describe('makeGetBenchmarkEntriesTool', () => {
  it('正常返回 type 过滤的条目,content 截断到 600', async () => {
    const longContent = 'x'.repeat(800);
    const fn = jest.fn().mockResolvedValue({
      entries: [
        {
          id: 'e1',
          type: 'PLOT',
          title: '主线',
          content: longContent,
          chapterNo: null,
          kind: null,
          purposes: [],
          order: 0,
        },
      ],
    });
    const t = makeGetBenchmarkEntriesTool({
      userId: 'u1',
      benchmark: makeBenchmarkMock(fn),
    });
    const res = (await t.invoke({ bookId: 'b1', type: 'PLOT' as never })) as {
      entries: Array<{ content: string }>;
    };
    expect(fn).toHaveBeenCalledWith('u1', 'b1', { type: 'PLOT', limit: 30 });
    expect(res.entries[0].content.length).toBe(600);
  });

  it('bookId 不存在 → { entries: [], error: "book_not_found" }', async () => {
    const fn = jest.fn().mockResolvedValue({ error: 'book_not_found' });
    const t = makeGetBenchmarkEntriesTool({
      userId: 'u1',
      benchmark: makeBenchmarkMock(fn),
    });
    const res = await t.invoke({ bookId: 'bX' });
    expect(res).toEqual({ entries: [], error: 'book_not_found' });
  });

  it('chapterNo 透传', async () => {
    const fn = jest.fn().mockResolvedValue({ entries: [] });
    const t = makeGetBenchmarkEntriesTool({
      userId: 'u1',
      benchmark: makeBenchmarkMock(fn),
    });
    await t.invoke({ bookId: 'b1', chapterNo: 5 });
    expect(fn).toHaveBeenCalledWith('u1', 'b1', { chapterNo: 5, limit: 30 });
  });

  it('limit 透传', async () => {
    const fn = jest.fn().mockResolvedValue({ entries: [] });
    const t = makeGetBenchmarkEntriesTool({
      userId: 'u1',
      benchmark: makeBenchmarkMock(fn),
    });
    await t.invoke({ bookId: 'b1', limit: 50 });
    expect(fn).toHaveBeenCalledWith('u1', 'b1', { limit: 50 });
  });

  it('工具名 get_benchmark_entries', () => {
    const t = makeGetBenchmarkEntriesTool({
      userId: 'u1',
      benchmark: makeBenchmarkMock(jest.fn()),
    });
    expect(t.name).toBe('get_benchmark_entries');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir server test -- get-benchmark-entries.tool.spec.ts`
Expected: FAIL with `Cannot find module './get-benchmark-entries.tool'`

- [ ] **Step 3: Implement the tool**

Create `server/src/agentos/tools/get-benchmark-entries.tool.ts`:

```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { BenchmarkService } from '../../benchmark/benchmark.service';
import { BENCHMARK_TYPES } from '../../benchmark/dimensions';

/**
 * T2:单书深挖(写作 agent)。bookId 必填,归属由 service 校验。
 * content 截断到 600 字符,防单条工具结果爆 token。
 */
export interface GetBenchmarkEntriesDeps {
  userId: string;
  benchmark: BenchmarkService;
}

export const makeGetBenchmarkEntriesTool = (d: GetBenchmarkEntriesDeps) =>
  tool(
    async ({ bookId, type, chapterNo, limit }) => {
      const opts: {
        type?: string;
        chapterNo?: number | null;
        limit?: number;
      } = {};
      if (type) opts.type = type;
      if (chapterNo !== undefined && chapterNo !== null) opts.chapterNo = chapterNo;
      if (limit) opts.limit = limit;
      const r = await d.benchmark.findEntriesForUser(d.userId, bookId, opts);
      if ('error' in r) {
        return { entries: [], error: r.error };
      }
      return {
        entries: r.entries.map((e) => ({
          type: e.type,
          title: e.title,
          content: e.content.slice(0, 600),
          chapterNo: e.chapterNo,
          kind: e.kind,
          purposes: e.purposes,
        })),
      };
    },
    {
      name: 'get_benchmark_entries',
      description:
        '单书深挖:按 type/chapterNo 过滤某一本对标书的拆解条目。bookId 必须来自 list_benchmark_books 的返回。典型场景:看这本书的所有 STYLE 条目,或看第 3 章的 PLOT。',
      schema: z.object({
        bookId: z
          .string()
          .describe('对标书 id(来自 list_benchmark_books 的返回)'),
        type: z.enum(BENCHMARK_TYPES).optional().describe('按拆解维度过滤'),
        chapterNo: z
          .number()
          .int()
          .nullable()
          .optional()
          .describe('按章节号过滤'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('默认 30'),
      }),
    },
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir server test -- get-benchmark-entries.tool.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/agentos/tools/get-benchmark-entries.tool.ts server/src/agentos/tools/get-benchmark-entries.tool.spec.ts
git commit -m "feat(agentos): get_benchmark_entries 工具(T2,单书钻取+归属校验)"
```

---

## Task 7: Create `search-benchmark.tool.ts` (T3) + migrate `filterBenchmarkEntries`

**Files:**
- Create: `server/src/agentos/tools/search-benchmark.tool.ts`
- Create: `server/src/agentos/tools/search-benchmark.tool.spec.ts`

This task migrates the `filterBenchmarkEntries` pure function from the old `get-benchmark.tool.ts` (still in use until Task 10 deletes it; export from new file, old file keeps exporting until deletion).

- [ ] **Step 1: Write failing test (includes migrated pure-function tests)**

Create `server/src/agentos/tools/search-benchmark.tool.spec.ts`:

```ts
import {
  makeSearchBenchmarkTool,
  filterBenchmarkEntries,
} from './search-benchmark.tool';
import type { BenchmarkService } from '../../benchmark/benchmark.service';

function makeBenchmarkMock(fn: jest.Mock): BenchmarkService {
  return { searchEntries: fn } as unknown as BenchmarkService;
}

const E = (
  over: Partial<{
    id: string;
    type: string;
    kind: string | null;
    purposes: string[];
    title: string;
    content: string;
  }>,
) => ({
  id: 'e1',
  bookId: 'b1',
  type: 'CHAPTER',
  title: '',
  content: '',
  chapterNo: null,
  order: 0,
  kind: null,
  purposes: [],
  ...over,
});

describe('filterBenchmarkEntries (migrated from get-benchmark.tool)', () => {
  it('kind 精确匹配', () => {
    const r = filterBenchmarkEntries(
      [
        E({ type: 'MATERIAL', kind: '梗' }),
        E({ type: 'MATERIAL', kind: '金句' }),
      ],
      { kind: '梗' },
    );
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe('梗');
  });

  it('purpose 命中 purposes 数组任一', () => {
    const r = filterBenchmarkEntries(
      [
        E({ type: 'MATERIAL', purposes: ['爽点', '反转'] }),
        E({ type: 'MATERIAL', purposes: ['低谷'] }),
      ],
      { purpose: '爽点' },
    );
    expect(r).toHaveLength(1);
    expect(r[0].purposes).toContain('爽点');
  });

  it('query 子串匹配 title/content', () => {
    const r = filterBenchmarkEntries(
      [E({ title: '学霸应援' }), E({ content: '别的内容' })],
      { query: '学霸' },
    );
    expect(r).toHaveLength(1);
  });

  it('无过滤条件全留', () => {
    const es = [E({}), E({ type: 'MATERIAL' })];
    expect(filterBenchmarkEntries(es, {})).toHaveLength(2);
  });
});

describe('makeSearchBenchmarkTool', () => {
  it('正常路径:跨书聚合 + bookTitle 字段映射', async () => {
    const fn = jest.fn().mockResolvedValue([
      {
        entry: {
          id: 'e1',
          bookId: 'b1',
          type: 'PLOT',
          title: '主线',
          content: 'x'.repeat(800),
          chapterNo: null,
          kind: null,
          purposes: [],
          order: 0,
        },
        bookTitle: '我的超能力每周刷新',
      },
    ]);
    const t = makeSearchBenchmarkTool({
      userId: 'u1',
      benchmark: makeBenchmarkMock(fn),
    });
    const res = (await t.invoke({ bookTitle: '超能力' })) as {
      entries: Array<{ book: string; content: string }>;
    };
    expect(fn).toHaveBeenCalledWith('u1', { bookTitle: '超能力', limit: 10 });
    expect(res.entries).toHaveLength(1);
    expect(res.entries[0].book).toBe('我的超能力每周刷新');
    expect(res.entries[0].content.length).toBe(600);
  });

  it('无匹配 → { entries: [] }', async () => {
    const fn = jest.fn().mockResolvedValue([]);
    const t = makeSearchBenchmarkTool({
      userId: 'u1',
      benchmark: makeBenchmarkMock(fn),
    });
    const res = (await t.invoke({ bookTitle: '不存在' })) as { entries: unknown[] };
    expect(res.entries).toEqual([]);
  });

  it('MATERIAL kind/purpose 内存过滤', async () => {
    const fn = jest.fn().mockResolvedValue([
      {
        entry: E({ type: 'MATERIAL', kind: '梗', purposes: ['爽点'] }),
        bookTitle: 'A',
      },
      {
        entry: E({ type: 'MATERIAL', kind: '金句', purposes: ['反转'] }),
        bookTitle: 'A',
      },
    ]);
    const t = makeSearchBenchmarkTool({
      userId: 'u1',
      benchmark: makeBenchmarkMock(fn),
    });
    const res = (await t.invoke({ kind: '梗' as never })) as {
      entries: Array<{ kind: string | null }>;
    };
    expect(res.entries).toHaveLength(1);
    expect(res.entries[0].kind).toBe('梗');
  });

  it('工具名 search_benchmark', () => {
    const t = makeSearchBenchmarkTool({
      userId: 'u1',
      benchmark: makeBenchmarkMock(jest.fn()),
    });
    expect(t.name).toBe('search_benchmark');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir server test -- search-benchmark.tool.spec.ts`
Expected: FAIL with `Cannot find module './search-benchmark.tool'`

- [ ] **Step 3: Implement the tool**

Create `server/src/agentos/tools/search-benchmark.tool.ts`:

```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { BenchmarkService } from '../../benchmark/benchmark.service';
import {
  BENCHMARK_TYPES,
  MATERIAL_KINDS,
  MATERIAL_PURPOSES,
} from '../../benchmark/dimensions';

/**
 * T3:跨书搜索(写作 agent)。userId 闭包注入。
 * kind/purpose/query 走内存侧纯函数过滤(service 只做 bookTitle/type/limit)。
 * 返回 JSON 字符串(防数组被部分供应商当多模态块 → 400)。
 */
export interface SearchBenchmarkDeps {
  userId: string;
  benchmark: BenchmarkService;
}

/** 纯函数(可单测):对已查出的 entries 做 kind/purpose/query 内存过滤。 */
export interface BenchmarkFilter {
  kind?: string;
  purpose?: string;
  query?: string;
}

export function filterBenchmarkEntries<
  T extends {
    kind: string | null;
    purposes: string[];
    title: string;
    content: string;
  },
>(entries: T[], f: BenchmarkFilter): T[] {
  let out = entries;
  if (f.kind) out = out.filter((e) => e.kind === f.kind);
  if (f.purpose) out = out.filter((e) => e.purposes.includes(f.purpose!));
  const q = f.query?.trim();
  if (q) out = out.filter((e) => e.title.includes(q) || e.content.includes(q));
  return out;
}

export const makeSearchBenchmarkTool = (d: SearchBenchmarkDeps) =>
  tool(
    async ({ bookTitle, type, kind, purpose, query, limit }) => {
      const opts: {
        bookTitle?: string;
        type?: string;
        limit?: number;
      } = {};
      if (bookTitle) opts.bookTitle = bookTitle;
      if (type) opts.type = type;
      opts.limit = limit ?? 10;
      const rows = await d.benchmark.searchEntries(d.userId, opts);
      const filtered = filterBenchmarkEntries(
        rows.map((r) => r.entry),
        { kind, purpose, query },
      ).slice(0, limit ?? 10);
      const idToTitle = new Map(rows.map((r) => [r.entry.bookId, r.bookTitle]));
      const result = {
        entries: filtered.map((e) => ({
          book: idToTitle.get(e.bookId) ?? '',
          type: e.type,
          title: e.title,
          content: e.content.slice(0, 600),
          chapterNo: e.chapterNo,
          kind: e.kind,
          purposes: e.purposes,
        })),
      };
      return JSON.stringify(result);
    },
    {
      name: 'search_benchmark',
      description:
        '跨书搜索对标库条目,支持书名模糊 / 拆解维度 / 素材种类 / 用途 / 关键词任意组合。书名匹配用 bookTitle(如"超能力"可匹配《我的超能力每周刷新》),条目内容关键词用 query。典型场景:找所有书里"反转"类型的素材 → type=MATERIAL & purpose=反转。',
      schema: z.object({
        bookTitle: z
          .string()
          .optional()
          .describe('书名模糊匹配(大小写不敏感)'),
        type: z.enum(BENCHMARK_TYPES).optional(),
        kind: z
          .enum(MATERIAL_KINDS)
          .optional()
          .describe('仅 MATERIAL:素材种类(梗|名场面|金句|套路)'),
        purpose: z
          .enum(MATERIAL_PURPOSES)
          .optional()
          .describe('仅 MATERIAL:用途标签'),
        query: z
          .string()
          .optional()
          .describe('条目标题/正文关键词(内存侧模糊匹配)'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe('默认 10'),
      }),
    },
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir server test -- search-benchmark.tool.spec.ts`
Expected: PASS (8 tests: 4 filter + 4 tool)

- [ ] **Step 5: Commit**

```bash
git add server/src/agentos/tools/search-benchmark.tool.ts server/src/agentos/tools/search-benchmark.tool.spec.ts
git commit -m "feat(agentos): search_benchmark 工具(T3,跨书搜索+filterBenchmarkEntries 迁移)"
```

---

## Task 8: Update `agent-registry.ts` (remove `get_benchmark`, add 3 new)

**Files:**
- Modify: `server/src/agentos/agent-registry.ts`

- [ ] **Step 1: Swap imports**

In `server/src/agentos/agent-registry.ts`, replace this line:

```ts
import { makeGetBenchmarkTool } from './tools/get-benchmark.tool';
```

With:

```ts
import { makeListBenchmarkBooksTool } from './tools/list-benchmark-books.tool';
import { makeGetBenchmarkEntriesTool } from './tools/get-benchmark-entries.tool';
import { makeSearchBenchmarkTool } from './tools/search-benchmark.tool';
```

- [ ] **Step 2: Swap registry entries**

Replace this block (at the end of `TOOL_REGISTRY`):

```ts
  get_benchmark: (d) =>
    makeGetBenchmarkTool({ userId: d.userId, prisma: d.prisma }),
```

With:

```ts
  list_benchmark_books: (d) =>
    makeListBenchmarkBooksTool({ userId: d.userId, benchmark: d.benchmark! }),
  get_benchmark_entries: (d) =>
    makeGetBenchmarkEntriesTool({ userId: d.userId, benchmark: d.benchmark! }),
  search_benchmark: (d) =>
    makeSearchBenchmarkTool({ userId: d.userId, benchmark: d.benchmark! }),
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --dir server typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/src/agentos/agent-registry.ts
git commit -m "refactor(agentos): agent-registry 移除 get_benchmark,注册 3 个新对标工具"
```

---

## Task 9: Update `agent-tree.config.ts` (replace tools in main + writer)

**Files:**
- Modify: `server/src/agentos/agent-tree.config.ts`

- [ ] **Step 1: Replace `get_benchmark` in main.tools**

In `server/src/agentos/agent-tree.config.ts`, in the `main` tools array, replace this single line:

```ts
    'get_benchmark',
```

With three lines (in the same position, keeping alphabetical-ish ordering):

```ts
    'list_benchmark_books',
    'get_benchmark_entries',
    'search_benchmark',
```

- [ ] **Step 2: Replace `get_benchmark` in writer.tools**

In the same file, in the `writer` tools array, replace:

```ts
        'get_benchmark',
```

With:

```ts
        'list_benchmark_books',
        'get_benchmark_entries',
        'search_benchmark',
```

- [ ] **Step 3: Run spec to verify it fails (snapshot is stale)**

Run: `pnpm --dir server test -- agent-tree.config.spec.ts`
Expected: FAIL on the `describeTree(AGENT_TREE)` snapshot test (tools list mismatch). This is expected — Task 10 fixes it.

- [ ] **Step 4: Commit (will fix spec in next task)**

```bash
git add server/src/agentos/agent-tree.config.ts
git commit -m "refactor(agentos): AGENT_TREE main/writer 用 3 个新对标工具替换 get_benchmark"
```

---

## Task 10: Update `agent-tree.config.spec.ts` snapshot + ownership test

**Files:**
- Modify: `server/src/agentos/agent-tree.config.spec.ts`

- [ ] **Step 1: Update main tools snapshot**

In `server/src/agentos/agent-tree.config.spec.ts`, in the `describeTree(AGENT_TREE)` snapshot, replace this single line in the `main.tools` array:

```ts
          'get_benchmark',
```

With three lines:

```ts
          'list_benchmark_books',
          'get_benchmark_entries',
          'search_benchmark',
```

- [ ] **Step 2: Update writer tools snapshot**

In the same snapshot, in the `writer.tools` array, replace:

```ts
                    'get_benchmark',
```

With:

```ts
                    'list_benchmark_books',
                    'get_benchmark_entries',
                    'search_benchmark',
```

- [ ] **Step 3: Update ownership test**

Replace the test `"main/writer 都能拉对标(get_benchmark)"` (L292-298) with:

```ts
    it('main/writer 都能用 3 个对标工具(list/get_entries/search)', () => {
      expect(AGENT_TREE.tools).toContain('list_benchmark_books');
      expect(AGENT_TREE.tools).toContain('get_benchmark_entries');
      expect(AGENT_TREE.tools).toContain('search_benchmark');
      const chapter = AGENT_TREE.subagents!.find((s) => s.name === 'chapter')!;
      const writerTools = chapter.subagents!.find((s) => s.name === 'writer')!.tools;
      expect(writerTools).toContain('list_benchmark_books');
      expect(writerTools).toContain('get_benchmark_entries');
      expect(writerTools).toContain('search_benchmark');
    });
```

- [ ] **Step 4: Run spec to verify it passes**

Run: `pnpm --dir server test -- agent-tree.config.spec.ts`
Expected: PASS (all tests in this file)

- [ ] **Step 5: Commit**

```bash
git add server/src/agentos/agent-tree.config.spec.ts
git commit -m "test(agentos): 更新 AGENT_TREE 快照用 3 个新对标工具"
```

---

## Task 11: Rewrite prompts (`main.md` + `writer.md`)

**Files:**
- Modify: `server/src/agentos/prompts/main.md` (L104-112)
- Modify: `server/src/agentos/prompts/writer.md` (L128-137)

- [ ] **Step 1: Replace main.md【按需对标参考】section**

In `server/src/agentos/prompts/main.md`, replace lines 104-112 (entire 【按需对标参考】 section including heading and body):

```
## 【按需对标参考】

你可用三个工具从对标库(其他小说的拆解产物)取参考:
- list_benchmark_books() — 列出当前用户名下所有拆解书,看每本书的状态和各维度条目数。**动笔前先调一次**,确认对标库有什么。
- get_benchmark_entries(bookId, type?, chapterNo?) — 单书深挖某维度。bookId 必须来自 list_benchmark_books。典型:看这本书的所有 STYLE,或看第 3 章的 PLOT。
- search_benchmark(bookTitle?, type?, kind?, purpose?, query?) — 跨书搜索。书名模糊匹配用 bookTitle(如"超能力"),条目标题/正文关键词用 query。

写作场景参考:
- 写大纲/分卷 → get_benchmark_entries(bookId, type: PLOT 或 RHYTHM 或 EMOTION)
- 写正文 → get_benchmark_entries(bookId, type: STYLE 或 RHYTHM)
- 建角色 → get_benchmark_entries(bookId, type: CHARACTER)
- 写具体场景(开篇/爽点/反转/低谷)→ search_benchmark(type: MATERIAL, purpose: <对应标签>)

**对标是参考不是照抄**,产物不进入本小说设定表。无对标书时跳过此节。
```

- [ ] **Step 2: Replace writer.md【按需对标参考】section**

In `server/src/agentos/prompts/writer.md`, replace lines 128-137 (entire 【按需对标参考】 section including heading and body) with the same content as Step 1 (identical text).

- [ ] **Step 3: Run prompt spec to verify substring test fails**

Run: `pnpm --dir server test -- agent-prompts.spec.ts`
Expected: May still pass (the substring lock is `'你是【交互式编排者】'` for MAIN — not affected by benchmark section). Verify no regression.

- [ ] **Step 4: Restart-free check**

Prompts load at boot ([agent-prompts.ts](../../server/src/agentos/agent-prompts.ts)) — dev server `nest start --watch` reloads on `.md` change. If running, no action needed; if not running, nothing to do.

- [ ] **Step 5: Commit**

```bash
git add server/src/agentos/prompts/main.md server/src/agentos/prompts/writer.md
git commit -m "docs(prompts): 重写对标引导节,明确 list/get_entries/search 三工具用法"
```

---

## Task 12: Delete old `get-benchmark.tool.ts` + spec

**Files:**
- Delete: `server/src/agentos/tools/get-benchmark.tool.ts`
- Delete: `server/src/agentos/tools/get-benchmark.tool.spec.ts`

- [ ] **Step 1: Delete the files**

Run:
```bash
rm server/src/agentos/tools/get-benchmark.tool.ts server/src/agentos/tools/get-benchmark.tool.spec.ts
```

- [ ] **Step 2: Verify nothing else imports from the old file**

Run: `grep -r "get-benchmark.tool" server/src --include="*.ts"`
Expected: No matches (or only matches in git-ignored dist/).

- [ ] **Step 3: Typecheck**

Run: `pnpm --dir server typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add -A server/src/agentos/tools/
git commit -m "chore(agentos): 删除旧 get-benchmark.tool(已被 3 个新工具替代)"
```

---

## Task 13: Final full verification

**Files:** None (verification only)

- [ ] **Step 1: Full typecheck**

Run: `pnpm --dir server typecheck`
Expected: PASS (no errors)

- [ ] **Step 2: Full test suite**

Run: `pnpm --dir server test`
Expected: PASS (all tests)

- [ ] **Step 3: Lint check**

Run: `pnpm --dir server lint`
Expected: PASS

- [ ] **Step 4: Manual smoke test (optional, if dev server is up)**

In agent-ui at `http://localhost:3000`, open a novel workspace, send a prompt that triggers benchmark lookup:
- "list 一下我的对标库"
- "查《我的超能力每周刷新》的 STYLE 拆解"

Verify agent activity frames show `tool: list_benchmark_books` / `get_benchmark_entries` / `search_benchmark` invocations with non-empty results.

- [ ] **Step 5: Final commit if any fixups**

If any of the above steps surfaced fixups, commit them. Otherwise, no commit.

---

## Self-Review Checklist

**Spec coverage:**
- [x] T1 `list_benchmark_books` — Task 5
- [x] T2 `get_benchmark_entries` (with bookId ownership check) — Task 6
- [x] T3 `search_benchmark` (with bookTitle fuzzy + filterBenchmarkEntries migration) — Task 7
- [x] BenchmarkService 3 new methods — Tasks 2/3/4
- [x] AGENT_TREE main/writer tools update — Task 9
- [x] Prompt【按需对标参考】rewrite — Task 11
- [x] agent-prompts.spec substring alignment — covered implicitly (Task 11 verifies)
- [x] Old `get_benchmark` deletion — Task 12
- [x] Error handling matrix (empty books, book_not_found, ownership check, no matches) — Tasks 2/3/4/6/7

**Type consistency:**
- `listBooksWithEntryCounts(userId, limit)` → returns array — Task 2 (service) matches Task 5 (tool) call
- `findEntriesForUser(userId, bookId, opts)` → returns `{ entries } | { error }` — Task 3 (service) matches Task 6 (tool) call
- `searchEntries(userId, opts)` → returns `Array<{ entry, bookTitle }>` — Task 4 (service) matches Task 7 (tool) call
- All tool deps use `{ userId, benchmark }` consistently (no `prisma` leak)

**Placeholder scan:** None. Every step has executable code or commands.
