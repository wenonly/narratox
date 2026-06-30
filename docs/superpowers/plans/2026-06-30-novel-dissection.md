# 拆解小说 Agent + 全局对标库 + 写作引用 Implementation Plan（Phase 22 · Plan 2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 主页「拆解小说」模块:上传 txt → 全文逐章完全拆解 → 存全局对标库(BenchmarkBook/Entry)→ 写作时各 agent 用 `get_benchmark` 按需只读引用。

**Architecture:** 拆解是独立 agent run(不绑定 novel),DISSECT_TREE(dissect-main + 5 子 agent)经 DissectAgentService 后台异步跑,流式推活动帧(复用 createActivityEmitter);对标库 BenchmarkBook/Entry 跨小说共享;per-agent 模型配置(Plan 1 已完成)让 chapter-extractor 配便宜模型省 token。写作引用是只读 tool,不改对标库。

**Tech Stack:** NestJS 11 + Prisma 7(server,Jest TDD) / Next.js 15 + React 18(agent-ui,typecheck+lint)。

**关联 spec:** [docs/superpowers/specs/2026-06-30-novel-dissection-design.md](../specs/2026-06-30-novel-dissection-design.md)

**前置(已完成):** Plan 1(per-agent 模型配置 Vendor/Model 两层 + AgentModelOverride + buildAgentGroups + resolveModel 链)。本 plan 跳过 spec §5/§6.2/§7.2 的 per-agent 部分(已实现),只做拆解小说本身。

---

## File Structure

**server(创建/修改):**
- Modify: `server/prisma/schema.prisma` — 加 BenchmarkBook / BenchmarkEntry + 2 enum
- Create: `server/src/benchmark/chapter-splitter.ts` — 章节切分纯函数
- Create: `server/src/benchmark/benchmark.service.ts` + `benchmark.controller.ts` + `benchmark.module.ts`
- Create: `server/src/agentos/dissect-tree.config.ts` — DISSECT_TREE(仿 AGENT_TREE)
- Create: `server/src/agentos/prompts/dissect-*.md`(6 个)
- Create: `server/src/agentos/dissect-context-assembler.service.ts`
- Create: `server/src/agentos/dissect-agent.service.ts` — 异步 + 流式 + job map
- Create: `server/src/agentos/tools/write-benchmark.tool.ts` / `get-raw-chapter.tool.ts` / `get-dissect-entries.tool.ts` / `report-dissect-review.tool.ts`
- Create: `server/src/agentos/tools/get-benchmark.tool.ts` — 写作引用(挂 AGENT_TREE)
- Modify: `server/src/agentos/agent-registry.ts` — ToolDeps 加 bookId? + benchmark?;TOOL_REGISTRY 加 5 个新 tool key
- Modify: `server/src/agentos/agent-tree.config.ts` — buildAgentGroups 纳入 DISSECT_TREE;get_benchmark 挂 main/writer/outline-writer
- Modify: `server/src/agentos/prompts/main.md` / `writer.md` / `outliner-writer.md` — 加【按需对标参考】节
- Modify: `server/src/app.module.ts` — 注册 BenchmarkModule + DissectAgentService

**agent-ui(创建/修改):**
- Modify: `agent-ui/src/api/routes.ts` + `api/benchmark.ts`(新) + `types/benchmark.ts`(新)
- Create: `agent-ui/src/app/dissect/page.tsx` + `components/dissect/`(上传/列表/确认弹窗/日志抽屉/结果浏览)
- Modify: `agent-ui/src/components/layout/AppSidebar.tsx` — 加「拆解」tab

---

## Task 1: DB migration — BenchmarkBook / BenchmarkEntry

**Files:**
- Modify: `server/prisma/schema.prisma`

- [ ] **Step 1: 加 schema**

在 `server/prisma/schema.prisma` 末尾追加:

```prisma
/// 全局对标库:一本拆解书。跨小说共享,与 novel 无关。
model BenchmarkBook {
  id        String          @id @default(cuid())
  userId    String
  user      User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  title     String
  rawText   String
  chapters  Json            @default("[]")
  status    BenchmarkStatus @default(PENDING)
  progress  Json            @default("{}")
  review    Json?
  createdAt DateTime        @default(now())
  updatedAt DateTime        @updatedAt
  entries   BenchmarkEntry[]

  @@index([userId, updatedAt])
}

model BenchmarkEntry {
  id        String             @id @default(cuid())
  bookId    String
  book      BenchmarkBook      @relation(fields: [bookId], references: [id], onDelete: Cascade)
  type      BenchmarkEntryType
  title     String
  content   String             @default("")
  chapterNo Int?
  order     Int                @default(0)
  createdAt DateTime           @default(now())
  updatedAt DateTime           @updatedAt

  @@index([bookId, type])
  @@index([bookId, chapterNo])
}

enum BenchmarkStatus {
  PENDING
  RUNNING
  DONE
  FAILED
  INTERRUPTED
}

enum BenchmarkEntryType {
  CHAPTER
  PLOT
  RHYTHM
  EMOTION
  CHARACTER
  STYLE
}
```

在 `model User` 加反向关系:`benchmarkBooks BenchmarkBook[]`。

- [ ] **Step 2: 迁移 + regenerate**

```bash
cd server && pnpm prisma migrate dev --name benchmark_book_entry && pnpm prisma generate
```
(Prisma 7 gotcha:手动 generate)
Expected: `✔ Generated Prisma Client`,`benchmarkBook`/`benchmarkEntry` delegate 出现。

- [ ] **Step 3: typecheck 冒烟**

`cd server && pnpm typecheck` → 应绿(新表无代码引用)。

- [ ] **Step 4: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations
git commit -m "feat(benchmark): BenchmarkBook/Entry schema + 2 enum

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: 章节切分纯函数

**Files:**
- Create: `server/src/benchmark/chapter-splitter.ts`
- Test: `server/src/benchmark/chapter-splitter.spec.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { splitChapters } from './chapter-splitter';

describe('splitChapters', () => {
  it('按「第N章」切分', () => {
    const text = '第一章 出场\n内容A\n第二章 冲突\n内容B';
    const r = splitChapters(text);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ chapterNo: 1, title: '出场' });
    expect(r[0].text).toContain('内容A');
    expect(r[1]).toMatchObject({ chapterNo: 2, title: '冲突' });
  });
  it('无章节标记 → 按字数均分(告警)', () => {
    const text = 'a'.repeat(3000);
    const r = splitChapters(text, { warnIfNoMarker: true });
    expect(r.length).toBeGreaterThan(1);
    expect(r.every((c) => c.title === '')).toBe(true);
  });
  it('空文本 → 空数组', () => {
    expect(splitChapters('')).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑确认失败** → Run: `cd server && pnpm test -- chapter-splitter.spec.ts` → FAIL。

- [ ] **Step 3: 实现**

```ts
export interface SplitChapter {
  chapterNo: number;
  title: string;
  offset: number;
  length: number;
  text: string;
}

const MARKER = /第\s*([0-9一二三四五六七八九十百千零两]+)\s*[章回节卷]/g;

/**
 * 按章节标记切分原文。标记形如「第一章」「第3章」「第N回」。
 * 无标记 → 按 ~2000 字均分(网文章节常见长度),title 空。
 */
export function splitChapters(
  raw: string,
  _opts: { warnIfNoMarker?: boolean } = {},
): SplitChapter[] {
  if (!raw.trim()) return [];
  const matches = [...raw.matchAll(MARKER)];
  if (matches.length === 0) {
    // 均分
    const chunkSize = 2000;
    const out: SplitChapter[] = [];
    for (let i = 0; i < raw.length; i += chunkSize) {
      out.push({
        chapterNo: out.length + 1,
        title: '',
        offset: i,
        length: Math.min(chunkSize, raw.length - i),
        text: raw.slice(i, i + chunkSize),
      });
    }
    return out;
  }
  const out: SplitChapter[] = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const start = m.index ?? 0;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? raw.length) : raw.length;
    // 标题:标记行到换行
    const lineEnd = raw.indexOf('\n', start);
    const title = lineEnd > -1 && lineEnd < end
      ? raw.slice(start, lineEnd).replace(MARKER, '').trim()
      : '';
    out.push({
      chapterNo: i + 1,
      title,
      offset: start,
      length: end - start,
      text: raw.slice(start, end),
    });
  }
  return out;
}
```

- [ ] **Step 4: 跑确认通过** → PASS。
- [ ] **Step 5: Commit**

```bash
git add server/src/benchmark/chapter-splitter.ts server/src/benchmark/chapter-splitter.spec.ts
git commit -m "feat(benchmark): splitChapters 章节切分纯函数

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: BenchmarkService(CRUD)

**Files:**
- Create: `server/src/benchmark/benchmark.service.ts` + `.spec.ts`

- [ ] **Step 1: 写失败测试**(`benchmark.service.spec.ts`,mock prisma,覆盖 list/upload(create)/get/delete)

```ts
import { BenchmarkService } from './benchmark.service';
const prisma = { benchmarkBook: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), delete: jest.fn(), update: jest.fn() }, benchmarkEntry: { findMany: jest.fn(), deleteMany: jest.fn(), create: jest.fn() } };
const svc = new BenchmarkService(prisma as never);
beforeEach(() => jest.clearAllMocks());

describe('BenchmarkService', () => {
  it('list 按 userId 倒序', async () => {
    (prisma.benchmarkBook.findMany as jest.Mock).mockResolvedValue([{ id: 'b1', title: '盘龙' }]);
    const out = await svc.list('u1');
    expect(out[0].id).toBe('b1');
    expect(prisma.benchmarkBook.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1' } }));
  });
  it('upload 建 book + 切分 chapters', async () => {
    (prisma.benchmarkBook.create as jest.Mock).mockResolvedValue({ id: 'b1', chapters: [] });
    const r = await svc.upload('u1', '盘龙', '第一章 出场\n内容');
    expect(prisma.benchmarkBook.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'u1', title: '盘龙', status: 'PENDING' }),
    }));
    expect(r.id).toBe('b1');
  });
  it('get 含 entries 分组', async () => {
    (prisma.benchmarkBook.findUnique as jest.Mock).mockResolvedValue({ id: 'b1', userId: 'u1' });
    (prisma.benchmarkEntry.findMany as jest.Mock).mockResolvedValue([]);
    const r = await svc.get('u1', 'b1');
    expect(r?.id).toBe('b1');
  });
  it('delete 删 book + entries', async () => {
    (prisma.benchmarkBook.findUnique as jest.Mock).mockResolvedValue({ id: 'b1', userId: 'u1' });
    await svc.delete('u1', 'b1');
    expect(prisma.benchmarkEntry.deleteMany).toHaveBeenCalledWith({ where: { bookId: 'b1' } });
    expect(prisma.benchmarkBook.delete).toHaveBeenCalledWith({ where: { id: 'b1' } });
  });
});
```

- [ ] **Step 2: 跑确认失败** → FAIL。

- [ ] **Step 3: 实现**(`benchmark.service.ts`):

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { splitChapters } from './chapter-splitter';

@Injectable()
export class BenchmarkService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.benchmarkBook.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, status: true, progress: true, chapters: true, createdAt: true },
    });
  }

  async upload(userId: string, title: string, rawText: string) {
    const chapters = splitChapters(rawText).map(({ chapterNo, title: t, offset, length }) => ({
      chapterNo, title: t, offset, length,
    }));
    return this.prisma.benchmarkBook.create({
      data: { userId, title, rawText, chapters: chapters as never, status: 'PENDING' },
    });
  }

  async get(userId: string, id: string) {
    const book = await this.prisma.benchmarkBook.findUnique({ where: { id } });
    if (!book || book.userId !== userId) throw new NotFoundException();
    return book;
  }

  async getWithEntries(userId: string, id: string) {
    const book = await this.get(userId, id);
    const entries = await this.prisma.benchmarkEntry.findMany({ where: { bookId: id }, orderBy: { order: 'asc' } });
    return { ...book, entries };
  }

  async delete(userId: string, id: string) {
    await this.get(userId, id); // 归属校验
    await this.prisma.benchmarkEntry.deleteMany({ where: { bookId: id } });
    await this.prisma.benchmarkBook.delete({ where: { id } });
  }

  /** 拆解工具调用:写一条 entry(userId/bookId 闭包注入)。 */
  writeEntry(bookId: string, type: string, title: string, content: string, order = 0, chapterNo: number | null = null) {
    return this.prisma.benchmarkEntry.create({
      data: { bookId, type: type as never, title, content, order, chapterNo },
    });
  }

  getEntries(bookId: string, type?: string, chapterNo?: number) {
    const where: Record<string, unknown> = { bookId };
    if (type) where.type = type;
    if (chapterNo != null) where.chapterNo = chapterNo;
    return this.prisma.benchmarkEntry.findMany({ where: where as never, orderBy: { order: 'asc' } });
  }

  /** 进程重启:RUNNING → INTERRUPTED。 */
  async markInterruptedOnBoot() {
    await this.prisma.benchmarkBook.updateMany({
      where: { status: 'RUNNING' },
      data: { status: 'INTERRUPTED' },
    });
  }
}
```

- [ ] **Step 4: 跑确认通过** → PASS。
- [ ] **Step 5: Commit**

```bash
git add server/src/benchmark/benchmark.service.ts server/src/benchmark/benchmark.service.spec.ts
git commit -m "feat(benchmark): BenchmarkService CRUD + 章节切分

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: 拆解 tools(4 个) + ToolDeps 扩展 + TOOL_REGISTRY

**Files:**
- Modify: `server/src/agentos/agent-registry.ts`(ToolDeps 加 bookId? + benchmark?;TOOL_REGISTRY 加 4 key)
- Create: `server/src/agentos/tools/write-benchmark.tool.ts` / `get-raw-chapter.tool.ts` / `get-dissect-entries.tool.ts` / `report-dissect-review.tool.ts`

- [ ] **Step 1: ToolDeps 扩展**

`agent-registry.ts` 的 `ToolDeps` 加两个可选字段(写作 tools 不读):

```ts
import type { BenchmarkService } from '../benchmark/benchmark.service';
export interface ToolDeps {
  // ...现有字段...
  bookId?: string;            // 拆解 tools 用(novel-bound 工具不读)
  benchmark?: BenchmarkService; // 拆解 tools 用
}
```

- [ ] **Step 2: 4 个 tool(仿现有 tool 模式,如 get-events.tool.ts)**

每个 tool 用 `tool()` from `@langchain/core/tools`,zod schema,工厂接收 deps(userId/bookId/benchmark 闭包注入)。

**write-benchmark.tool.ts**:
```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { BenchmarkService } from '../../benchmark/benchmark.service';

export interface WriteBenchmarkDeps { userId: string; bookId: string; benchmark: BenchmarkService; }
export const makeWriteBenchmarkTool = (d: WriteBenchmarkDeps) =>
  tool(
    async ({ type, title, content, order, chapterNo }) => {
      await d.benchmark.writeEntry(d.bookId, type, title, content, order ?? 0, chapterNo ?? null);
      return { ok: true };
    },
    {
      name: 'write_benchmark',
      description: '写一条拆解产物到对标库。type: CHAPTER|PLOT|RHYTHM|EMOTION|CHARACTER|STYLE。',
      schema: z.object({
        type: z.enum(['CHAPTER', 'PLOT', 'RHYTHM', 'EMOTION', 'CHARACTER', 'STYLE']),
        title: z.string(),
        content: z.string(),
        order: z.number().optional(),
        chapterNo: z.number().nullable().optional(),
      }),
    },
  );
```

**get-raw-chapter.tool.ts**(取原文第 N 章):
```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { PrismaService } from '../../prisma/prisma.service';
export interface GetRawChapterDeps { bookId: string; prisma: PrismaService; }
export const makeGetRawChapterTool = (d: GetRawChapterDeps) =>
  tool(
    async ({ chapterNo }) => {
      const book = await d.prisma.benchmarkBook.findUnique({ where: { id: d.bookId } });
      if (!book) return { error: 'book not found' };
      const chapters = (book.chapters as Array<{ chapterNo: number; offset: number; length: number }>) ?? [];
      const ch = chapters.find((c) => c.chapterNo === chapterNo);
      if (!ch) return { error: `chapter ${chapterNo} not found` };
      return { text: book.rawText.slice(ch.offset, ch.offset + ch.length) };
    },
    { name: 'get_raw_chapter', description: '取对标书原文第 N 章(按章号切分后的片段)。', schema: z.object({ chapterNo: z.number() }) },
  );
```

**get-dissect-entries.tool.ts**(取已拆条目):
```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { BenchmarkService } from '../../benchmark/benchmark.service';
export interface GetDissectEntriesDeps { bookId: string; benchmark: BenchmarkService; }
export const makeGetDissectEntriesTool = (d: GetDissectEntriesDeps) =>
  tool(
    async ({ type, chapterNo }) => {
      const entries = await d.benchmark.getEntries(d.bookId, type, chapterNo ?? undefined);
      return { entries: entries.map((e) => ({ type: e.type, title: e.title, content: e.content.slice(0, 500), chapterNo: e.chapterNo })) };
    },
    { name: 'get_dissect_entries', description: '取已拆解条目(按 type/chapterNo 过滤)。', schema: z.object({ type: z.enum(['CHAPTER','PLOT','RHYTHM','EMOTION','CHARACTER','STYLE']).optional(), chapterNo: z.number().nullable().optional() }) },
  );
```

**report-dissect-review.tool.ts**(质量报告):
```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { PrismaService } from '../../prisma/prisma.service';
export interface ReportDissectReviewDeps { bookId: string; prisma: PrismaService; }
export const makeReportDissectReviewTool = (d: ReportDissectReviewDeps) =>
  tool(
    async ({ summary, missingTypes, notes }) => {
      await d.prisma.benchmarkBook.update({ where: { id: d.bookId }, data: { review: { summary, missingTypes, notes } as never } });
      return { ok: true };
    },
    { name: 'report_dissect_review', description: '提交拆解质量报告(完整性/缺失/备注)。', schema: z.object({ summary: z.string(), missingTypes: z.array(z.string()).optional(), notes: z.string().optional() }) },
  );
```

- [ ] **Step 3: TOOL_REGISTRY 注册 4 key**

`agent-registry.ts` 顶部 import 4 个工厂,在 `TOOL_REGISTRY` 加:

```ts
  write_benchmark: (d) => makeWriteBenchmarkTool({ userId: d.userId, bookId: d.bookId!, benchmark: d.benchmark! }),
  get_raw_chapter: (d) => makeGetRawChapterTool({ bookId: d.bookId!, prisma: d.prisma }),
  get_dissect_entries: (d) => makeGetDissectEntriesTool({ bookId: d.bookId!, benchmark: d.benchmark! }),
  report_dissect_review: (d) => makeReportDissectReviewTool({ bookId: d.bookId!, prisma: d.prisma }),
```

- [ ] **Step 4: typecheck**(工具未挂树,应绿)
- [ ] **Step 5: Commit**

```bash
git add server/src/agentos/agent-registry.ts server/src/agentos/tools/write-benchmark.tool.ts server/src/agentos/tools/get-raw-chapter.tool.ts server/src/agentos/tools/get-dissect-entries.tool.ts server/src/agentos/tools/report-dissect-review.tool.ts
git commit -m "feat(agentos): 拆解 tools(write_benchmark/get_raw_chapter/get_dissect_entries/report_dissect_review) + ToolDeps 扩展

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: DISSECT_TREE + prompts/dissect-*.md

**Files:**
- Create: `server/src/agentos/dissect-tree.config.ts`
- Create: `server/src/agentos/prompts/dissect-main.md` / `chapter-extractor.md` / `plot-analyst.md` / `character-extractor.md` / `style-analyst.md` / `dissect-critic.md`

- [ ] **Step 1: prompts(6 个 .md,每个含 YAML frontmatter name/key + 纯 body)**

每个 prompt 文件格式(参考现有 `prompts/writer.md`):
```markdown
---
name: CHAPTER_EXTRACTOR
key: chapter-extractor
---
<body:逐章拆解指令——读 get_raw_chapter(N) → 产摘要+情节点+角色提及 → 调 write_benchmark(type=CHAPTER, chapterNo=N)>
```
6 个 key:`DISSECT_MAIN` / `CHAPTER_EXTRACTOR` / `PLOT_ANALYST` / `CHARACTER_EXTRACTOR` / `STYLE_ANALYST` / `DISSECT_CRITIC`。

prompt 内容要点(写在 body):
- **DISSECT_MAIN**:编排——切章(从 book 信息拿章数)→ 逐章委派 chapter-extractor → 全书委派 plot-analyst/character-extractor/style-analyst → 审核委派 dissect-critic。每章更新进度概念(实际进度由 service 拦截 write_benchmark 更新)。
- **CHAPTER_EXTRACTOR**:对第 N 章:调 `get_raw_chapter(N)` → 产「摘要 + 3-5 情节点 + 角色提及」→ 调 `write_benchmark(type=CHAPTER, chapterNo=N, title='第N章 摘要', content=...)`。逐章独立。
- **PLOT_ANALYST**:读 `get_dissect_entries(type=CHAPTER)` 全章摘要 → 拆 PLOT(故事线)+ RHYTHM(节奏)+ EMOTION(情绪模块)→ 各调 write_benchmark。
- **CHARACTER_EXTRACTOR**:读 CHAPTER 角色提及 → 建主要角色 CHARACTER 卡(人设/动机/弧光)→ write_benchmark。
- **STYLE_ANALYST**:抽样关键章(第1/中/末)→ 拆文风 STYLE(句长/标点/对话 + 原文锚点)→ write_benchmark。
- **DISSECT_CRITIC**:读所有 entries → 审核完整性(6 type 是否齐全、CHAPTER 是否覆盖全章)→ 调 report_dissect_review。

- [ ] **Step 2: dissect-tree.config.ts(仿 agent-tree.config.ts 的 AGENT_TREE 结构)**

```ts
import type { ModelTier, RecommendedTier } from './agent-tree.config';
import * as P from './dissect-prompts';  // 见 Step 3

export interface DissectSpec {
  name: string;
  description: string;
  promptKey: string;
  modelTier: ModelTier;
  recommendedTier: RecommendedTier;
  tools: string[];
  subagents?: DissectSpec[];
}

export const DISSECT_PROMPTS: Record<string, string> = {
  DISSECT_MAIN: P.DISSECT_MAIN_PROMPT,
  CHAPTER_EXTRACTOR: P.CHAPTER_EXTRACTOR_PROMPT,
  PLOT_ANALYST: P.PLOT_ANALYST_PROMPT,
  CHARACTER_EXTRACTOR: P.CHARACTER_EXTRACTOR_PROMPT,
  STYLE_ANALYST: P.STYLE_ANALYST_PROMPT,
  DISSECT_CRITIC: P.DISSECT_CRITIC_PROMPT,
};

export const DISSECT_TREE: DissectSpec = {
  name: 'dissect-main',
  description: '拆解小说主编排:切章→逐章拆→全书维度→审核。',
  promptKey: 'DISSECT_MAIN',
  modelTier: 'long',
  recommendedTier: 'strong',
  tools: [],
  subagents: [
    { name: 'chapter-extractor', description: '逐章拆:摘要+情节点+角色提及。', promptKey: 'CHAPTER_EXTRACTOR', modelTier: 'short', recommendedTier: 'cheap', tools: ['write_benchmark', 'get_raw_chapter'] },
    { name: 'plot-analyst', description: '拆剧情线/节奏/情绪模块。', promptKey: 'PLOT_ANALYST', modelTier: 'long', recommendedTier: 'strong', tools: ['write_benchmark', 'get_dissect_entries'] },
    { name: 'character-extractor', description: '建角色卡。', promptKey: 'CHARACTER_EXTRACTOR', modelTier: 'long', recommendedTier: 'mid', tools: ['write_benchmark', 'get_dissect_entries'] },
    { name: 'style-analyst', description: '拆文风指纹。', promptKey: 'STYLE_ANALYST', modelTier: 'long', recommendedTier: 'mid', tools: ['write_benchmark', 'get_raw_chapter'] },
    { name: 'dissect-critic', description: '审核拆解完整性。', promptKey: 'DISSECT_CRITIC', modelTier: 'long', recommendedTier: 'strong', tools: ['get_dissect_entries', 'report_dissect_review'] },
  ],
};

export function collectDissectSpecs(spec: DissectSpec): DissectSpec[] {
  return [spec, ...(spec.subagents ?? []).flatMap(collectDissectSpecs)];
}
```

- [ ] **Step 3: dissect-prompts.ts(loader,仿 agent-prompts.ts)**

创建 `server/src/agentos/dissect-prompts.ts`:读 `prompts/dissect-*.md`(strip frontmatter),export 6 个 named constant(`DISSECT_MAIN_PROMPT` 等)。**参考现有 `agent-prompts.ts` 的 loader 模式**(candidate-path fallback:co-located `__dirname/prompts` → `__dirname/../../src/agentos/prompts`)。

- [ ] **Step 4: typecheck**
- [ ] **Step 5: Commit**

```bash
git add server/src/agentos/dissect-tree.config.ts server/src/agentos/dissect-prompts.ts server/src/agentos/prompts/dissect-*.md
git commit -m "feat(agentos): DISSECT_TREE + 6 个拆解 prompts

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: DissectContextAssembler

**Files:**
- Create: `server/src/agentos/dissect-context-assembler.service.ts`

- [ ] **Step 1: 实现**

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DissectContextAssembler {
  constructor(private readonly prisma: PrismaService) {}

  /** 拆解 context(独立于 novel):返回 prompt + bookId。 */
  async forBook(userId: string, bookId: string): Promise<{ prompt: string; bookId: string }> {
    const book = await this.prisma.benchmarkBook.findUnique({ where: { id: bookId } });
    if (!book || book.userId !== userId) throw new Error('Benchmark book not found');
    const chapters = (book.chapters as unknown[]) ?? [];
    const prompt = [
      `【拆解任务】拆解对标书《${book.title}》,共 ${chapters.length} 章。`,
      '【产出规范】按角色拆解维度产出,调 write_benchmark 写入对标库:',
      '- CHAPTER(逐章):每章调 write_benchmark(type=CHAPTER, chapterNo=N),含摘要+情节点+角色提及',
      '- PLOT/RHYTHM/EMOTION(全书):基于全章摘要,各调 write_benchmark',
      '- CHARACTER(主要角色):各调 write_benchmark',
      '- STYLE(文风指纹):抽样关键章,调 write_benchmark',
      '【工具】get_raw_chapter(N) 取原文第N章;get_dissect_entries(type?) 取已拆条目。',
    ].join('\n');
    return { prompt, bookId };
  }
}
```

- [ ] **Step 2: typecheck**
- [ ] **Step 3: Commit**

```bash
git add server/src/agentos/dissect-context-assembler.service.ts
git commit -m "feat(agentos): DissectContextAssembler.forBook(拆解 context)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: DissectAgentService(异步 + 流式 + job map)

**Files:**
- Create: `server/src/agentos/dissect-agent.service.ts`

> 这是核心 + 最复杂的 task。**仿 `DeepAgentService` 的 buildAgentGraph + resolveModel**(复用 getModel/pickAgentConfig/resolveModelConfig/assembleModelConfig 链),但:
> - 不绑定 novel,绑定 bookId
> - 后台异步 Promise(不 await),经 EventEmitter 推活动帧
> - 进度拦截:write_benchmark 写 CHAPTER 时更新 BenchmarkBook.progress

- [ ] **Step 1: 实现(关键结构)**

```ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter } from 'events';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import { CHECKPOINTER } from './checkpointer.provider';
import { ModelConfigService } from '../settings/model-config.service';
import { AgentModelOverrideService } from '../settings/agent-model-override.service';
import { BenchmarkService } from '../benchmark/benchmark.service';
import { PrismaService } from '../prisma/prisma.service';
import { buildChatModel, type ModelConfigRecord } from './model-factory';
import { resolveModelConfig, type AgentSpec } from './agent-tree.config';
import { DISSECT_TREE, DISSECT_PROMPTS, type DissectSpec } from './dissect-tree.config';
import { TOOL_REGISTRY, type ToolDeps } from './agent-registry';
import { pickAgentConfig, type AgentOverrideEntry } from './deep-agent.service';
import { createActivityEmitter } from './activity-emitter';
import type { ActivityEvent } from './activity.types';

interface DissectJob { emitter: EventEmitter; abortController: AbortController; }

@Injectable()
export class DissectAgentService implements OnModuleInit {
  private readonly logger = new Logger('DissectAgentService');
  private readonly models = new Map<string, unknown>();
  private readonly jobs = new Map<string, DissectJob>();

  constructor(
    private readonly modelConfigs: ModelConfigService,
    private readonly agentOverrides: AgentModelOverrideService,
    private readonly benchmark: BenchmarkService,
    private readonly prisma: PrismaService,
    @Optional() @Inject(CHECKPOINTER) private readonly checkpointer?: BaseCheckpointSaver,
  ) {}

  async onModuleInit() {
    // 进程重启兜底:RUNNING → INTERRUPTED
    await this.benchmark.markInterruptedOnBoot();
  }

  private async getModel(config: ModelConfigRecord, maxTokens: number) {
    const key = `${config.id}:${config.updatedAt.getTime()}:${maxTokens}:${config.temperature}`;
    const cached = this.models.get(key);
    if (cached) return cached;
    const model = await buildChatModel(config, maxTokens);
    this.models.set(key, model);
    return model;
  }

  private async resolveModel(spec: DissectSpec, activeConfig: ModelConfigRecord, overrideMap: Map<string, AgentOverrideEntry>) {
    const { config, temperatureOverride } = pickAgentConfig(spec.name, overrideMap, activeConfig);
    const finalConfig = config ?? activeConfig;
    return this.getModel(resolveModelConfig(finalConfig, temperatureOverride), spec.modelTier === 'long' ? 16000 : 6000);
  }

  /** 构造 DISSECT_TREE 的 agent graph。仿 DeepAgentService.buildAgentGraph。 */
  private async buildDissectGraph(args: {
    userId: string; bookId: string; systemPrompt: string;
    activeConfig: ModelConfigRecord; overrideMap: Map<string, AgentOverrideEntry>;
  }) {
    const { createAgent } = await import('langchain');
    const { createSubAgentMiddleware, createSummarizationMiddleware, createPatchToolCallsMiddleware, StateBackend } = await import('deepagents');
    const backend = new StateBackend();
    const subagentStack = () => [createPatchToolCallsMiddleware()] as never;
    const deps: ToolDeps = {
      userId: args.userId, novelId: '', readingChapterOrder: null,
      novels: null as never, chapters: null as never, outlines: null as never,
      world: null as never, characters: null as never, references: null as never,
      knowledge: null as never, snapshots: null as never, summaries: null as never,
      events: null as never, eventService: null as never, arcs: null as never,
      masterOutlines: null as never, prisma: this.prisma,
      bookId: args.bookId, benchmark: this.benchmark,
    };
    const resolveTools = (keys: string[]) => keys.map((k) => TOOL_REGISTRY[k](deps) as never);

    const mainModel = await this.resolveModel(DISSECT_TREE, args.activeConfig, args.overrideMap);
    const buildNode = async (spec: DissectSpec): Promise<Record<string, unknown>> => {
      const node: Record<string, unknown> = {
        name: spec.name,
        description: spec.description,
        systemPrompt: DISSECT_PROMPTS[spec.promptKey],
        model: await this.resolveModel(spec, args.activeConfig, args.overrideMap),
        tools: resolveTools(spec.tools),
      };
      if (spec.subagents && spec.subagents.length > 0) {
        node.middleware = [createSubAgentMiddleware({
          defaultModel: mainModel as never, generalPurposeAgent: false,
          defaultMiddleware: subagentStack(),
          subagents: (await Promise.all(spec.subagents.map(buildNode))) as never,
        }) as never];
      }
      return node;
    };
    return createAgent({
      model: mainModel as never,
      systemPrompt: args.systemPrompt,
      tools: resolveTools(DISSECT_TREE.tools),
      middleware: [
        createSubAgentMiddleware({
          defaultModel: mainModel as never, generalPurposeAgent: false,
          defaultMiddleware: subagentStack(),
          subagents: (await Promise.all((DISSECT_TREE.subagents ?? []).map(buildNode))) as never,
        }) as never,
        createSummarizationMiddleware({ backend }) as never,
        createPatchToolCallsMiddleware() as never,
      ],
    }).withConfig({ recursionLimit: 500 }) as unknown as {
      stream: (input: { messages: Array<{ role: string; content: string }> }, opts: { configurable: Record<string, unknown>; streamMode: string; signal?: AbortSignal }) => Promise<AsyncIterable<unknown>>;
    };
  }

  /** 启动后台拆解(不 await)。emit 活动帧到 job emitter + 更新 progress。 */
  async startDissect(userId: string, bookId: string): Promise<void> {
    const activeConfig = await this.modelConfigs.getActive(userId);
    if (!activeConfig) throw new Error('尚未配置模型');
    const overrideMap = await this.agentOverrides.listMap(userId);
    const { prompt } = await this.dissectContext.forBook(userId, bookId);  // 注入 DissectContextAssembler(见 constructor)

    const emitter = new EventEmitter();
    const abortController = new AbortController();
    this.jobs.set(bookId, { emitter, abortController });

    await this.prisma.benchmarkBook.update({ where: { id: bookId }, data: { status: 'RUNNING', progress: { chapter: 0, total: 0, agent: 'dissect-main' } as never } });

    // 后台跑(不 await)
    (async () => {
      try {
        const agent = await this.buildDissectGraph({ userId, bookId, systemPrompt: prompt, activeConfig, overrideMap });
        const stream = await agent.stream(
          { messages: [{ role: 'user', content: '开始拆解。' }] },
          { configurable: { thread_id: `dissect-${bookId}` }, streamMode: 'messages', signal: abortController.signal },
        );
        const em = createActivityEmitter((ev: ActivityEvent) => emitter.emit('activity', ev));
        for await (const chunk of stream) em.feed(chunk as never);
        em.finish();
        await this.prisma.benchmarkBook.update({ where: { id: bookId }, data: { status: 'DONE' } });
      } catch (err) {
        this.logger.error(`dissect ${bookId} failed: ${err instanceof Error ? err.message : err}`);
        await this.prisma.benchmarkBook.update({ where: { id: bookId }, data: { status: 'FAILED' } });
      } finally {
        emitter.emit('done');
        this.jobs.delete(bookId);
      }
    })();
  }

  getJob(bookId: string): DissectJob | undefined { return this.jobs.get(bookId); }
}
```

> **注意**:`buildDissectGraph` 的 `resolveModel` 接收 `DissectSpec`(兼容 AgentSpec 结构);`pickAgentConfig`/`resolveModelConfig` 复用(deep-agent.service 导出)。`getModel` cache 机制复用(独立 map,但 key 一致)。constructor 还需注入 `DissectContextAssembler`(上面 `this.dissectContext`)。import 补全(`@Optional`/`@Inject` from `@nestjs/common`)。

- [ ] **Step 2: 注册 BenchmarkModule + DissectAgentService 到 app.module**

`server/src/benchmark/benchmark.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { BenchmarkService } from './benchmark.service';
import { BenchmarkController } from './benchmark.controller';
import { DissectAgentService } from '../agentos/dissect-agent.service';
import { DissectContextAssembler } from '../agentos/dissect-context-assembler.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { CheckpointerProvider } from '../agentos/checkpointer.provider';

@Module({
  imports: [PrismaModule, SettingsModule],
  controllers: [BenchmarkController],
  providers: [BenchmarkService, DissectAgentService, DissectContextAssembler, CheckpointerProvider],
  exports: [BenchmarkService],
})
export class BenchmarkModule {}
```

`app.module.ts` 加 `BenchmarkModule`。

- [ ] **Step 3: typecheck**(BenchmarkController 还没建,Task 8 建——本 task 先建一个空 controller 占位或 Task 8 一起)

> 为避免中间红,本 task 可先注释 controller 引用,Task 8 建 controller 时取消注释。或 Task 7+8 合并。

- [ ] **Step 4: Commit**

```bash
git add server/src/agentos/dissect-agent.service.ts server/src/benchmark/benchmark.module.ts server/src/app.module.ts
git commit -m "feat(agentos): DissectAgentService 异步拆解 + 流式 + job map + 进程重启兜底

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

---

## Task 8: BenchmarkController(upload + 流式 + 断线重连)

**Files:**
- Create: `server/src/benchmark/benchmark.controller.ts`
- Modify: `server/src/benchmark/benchmark.module.ts`(Task 7 占位的 controller 取消注释)

- [ ] **Step 1: 实现 controller**

> 流式部分**仿 `agentos.controller.ts` 的 runAgent**(writeFrame newline-JSON + RunStarted/活动帧/RunCompleted/Heartbeat)。关键差异:`req.on('close')` **不 abort job**(拆解后台继续),只结束本次推送。

```ts
import { Body, Controller, Delete, Get, Param, Post, Res, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Request, Response } from 'express';
import { CurrentUser, type RequestUser } from '../auth/current-user.decorator';
import { BenchmarkService } from './benchmark.service';
import { DissectAgentService } from '../agentos/dissect-agent.service';

@Controller('benchmarks')
export class BenchmarkController {
  constructor(
    private readonly benchmarks: BenchmarkService,
    private readonly dissect: DissectAgentService,
  ) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }))
  async upload(
    @CurrentUser() user: RequestUser,
    @UploadedFile() file: Express.Multer.File,
    @Body('title') title: string,
  ) {
    if (!file) throw new Error('未收到文件');
    const rawText = file.buffer.toString('utf-8');
    const book = await this.benchmarks.upload(user.id, title || file.originalname, rawText);
    const chapterCount = (book.chapters as unknown[])?.length ?? 0;
    return { id: book.id, chapterCount, estTokens: chapterCount * 4000 };
  }

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.benchmarks.list(user.id);
  }

  @Get(':id')
  async detail(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.benchmarks.getWithEntries(user.id, id);
  }

  /** 触发拆解 + 立即转流式(订阅 job emitter)。req.on close 不 abort job。 */
  @Post(':id/dissect')
  async dissect(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Res() res: Response,
    @Req() req: Request,
  ): Promise<void> {
    res.setHeader('Content-Type', 'application/json');
    const writeFrame = (payload: Record<string, unknown>): void => {
      if (res.writableEnded || res.destroyed) return;
      res.write(JSON.stringify(payload) + '\n');
    };

    // 校验归属 + 状态
    const book = await this.benchmarks.get(user.id, id);
    if (book.status === 'RUNNING') {
      writeFrame({ event: 'RunError', content: '该任务正在拆解中' });
      res.end();
      return;
    }

    // 启动后台拆解(不 await)
    await this.dissect.startDissect(user.id, id);
    const job = this.dissect.getJob(id);

    writeFrame({ event: 'RunStarted', book_id: id, created_at: Date.now() });

    // 心跳(防代理超时)
    const heartbeat = setInterval(() => writeFrame({ event: 'Heartbeat' }), 15_000);

    // 推活动帧
    const onActivity = (ev: unknown) => writeFrame({ event: 'activity', activity: ev });
    job?.emitter.on('activity', onActivity);

    // job 完成 / 客户端断开
    const cleanup = () => {
      clearInterval(heartbeat);
      job?.emitter.off('activity', onActivity);
      if (!res.writableEnded) {
        writeFrame({ event: 'RunCompleted', created_at: Date.now() });
        res.end();
      }
    };
    job?.emitter.once('done', cleanup);
    req.on('close', cleanup);  // 客户端断开:结束推送,但不 abort job(后台继续)
  }

  /** 断线重连:订阅当前 job 推新日志;job 不在则推 status 后关。 */
  @Get(':id/stream')
  async stream(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Res() res: Response,
    @Req() req: Request,
  ): Promise<void> {
    res.setHeader('Content-Type', 'application/json');
    const writeFrame = (p: Record<string, unknown>) => { if (!res.writableEnded && !res.destroyed) res.write(JSON.stringify(p) + '\n'); };
    const job = this.dissect.getJob(id);
    if (!job) {
      const book = await this.benchmarks.get(user.id, id);
      writeFrame({ event: 'RunCompleted', status: book.status });
      res.end();
      return;
    }
    const heartbeat = setInterval(() => writeFrame({ event: 'Heartbeat' }), 15_000);
    const onActivity = (ev: unknown) => writeFrame({ event: 'activity', activity: ev });
    job.emitter.on('activity', onActivity);
    const cleanup = () => { clearInterval(heartbeat); job.emitter.off('activity', onActivity); if (!res.writableEnded) { writeFrame({ event: 'RunCompleted' }); res.end(); } };
    job.emitter.once('done', cleanup);
    req.on('close', cleanup);
  }

  @Delete(':id')
  async delete(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.benchmarks.delete(user.id, id);
    return { ok: true };
  }
}
```

- [ ] **Step 2: typecheck + 全量 test**
- [ ] **Step 3: Commit**

```bash
git add server/src/benchmark/benchmark.controller.ts server/src/benchmark/benchmark.module.ts
git commit -m "feat(benchmark): BenchmarkController(upload + 流式 dissect + stream 断线重连 + delete)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9: per-agent 配置纳入 DISSECT_TREE

**Files:**
- Modify: `server/src/agentos/agent-tree.config.ts`(`buildAgentGroups`)
- Test: `server/src/agentos/agent-tree.groups.spec.ts`

- [ ] **Step 1: 改 buildAgentGroups 加 DISSECT_TREE 组**

`agent-tree.config.ts` 的 `buildAgentGroups`,在末尾加 DISSECT_TREE 一组(import DISSECT_TREE + collectDissectSpecs):

```ts
import { DISSECT_TREE, collectDissectSpecs, type DissectSpec } from './dissect-tree.config';

export function buildAgentGroups(): AgentGroup[] {
  const entry = (s: AgentSpec | DissectSpec): AgentGroupEntry => ({
    key: s.name, description: s.description, recommendedTier: s.recommendedTier,
  });
  const groups: AgentGroup[] = [{ group: AGENT_TREE.name, agents: [entry(AGENT_TREE)] }];
  for (const orch of AGENT_TREE.subagents ?? []) {
    groups.push({ group: orch.name, agents: collectSpecs(orch).map(entry) });
  }
  // 拆解树独立一组
  groups.push({ group: 'dissect(拆解)', agents: collectDissectSpecs(DISSECT_TREE).map((s) => entry(s as never)) });
  return groups;
}
```

(`AgentGroupEntry.entry` 接收 `AgentSpec | DissectSpec`——两者结构兼容 name/description/recommendedTier。)

- [ ] **Step 2: 改测试(groups.spec.ts 加 DISSECT_TREE 断言)**

```ts
it('buildAgentGroups 含 DISSECT_TREE 拆解组', () => {
  const groups = buildAgentGroups();
  const dissectGroup = groups.find((g) => g.group === 'dissect(拆解)');
  expect(dissectGroup).toBeDefined();
  expect(dissectGroup!.agents.map((a) => a.key)).toEqual(
    expect.arrayContaining(['dissect-main', 'chapter-extractor', 'plot-analyst', 'character-extractor', 'style-analyst', 'dissect-critic']),
  );
});
```

- [ ] **Step 3: 跑测试 + typecheck**
- [ ] **Step 4: Commit**

```bash
git add server/src/agentos/agent-tree.config.ts server/src/agentos/agent-tree.groups.spec.ts
git commit -m "feat(agentos): buildAgentGroups 纳入 DISSECT_TREE(per-agent 配置含拆解 agent)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 10: 写作引用 get_benchmark tool + prompt 指导

**Files:**
- Create: `server/src/agentos/tools/get-benchmark.tool.ts`
- Modify: `server/src/agentos/agent-registry.ts`(TOOL_REGISTRY 加 get_benchmark)
- Modify: `server/src/agentos/agent-tree.config.ts`(main/writer/outline-writer tools 加 'get_benchmark')
- Modify: `server/src/agentos/prompts/main.md` / `writer.md` / `outliner-writer.md`(加【按需对标参考】节)

- [ ] **Step 1: get-benchmark.tool.ts**

```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { PrismaService } from '../../prisma/prisma.service';
export interface GetBenchmarkDeps { userId: string; prisma: PrismaService; }
export const makeGetBenchmarkTool = (d: GetBenchmarkDeps) =>
  tool(
    async ({ type, query, limit }) => {
      // 查该用户所有对标书的 entries(跨 book)
      const books = await d.prisma.benchmarkBook.findMany({ where: { userId: d.userId }, select: { id: true, title: true } });
      const bookIds = books.map((b) => b.id);
      const where: Record<string, unknown> = { bookId: { in: bookIds } };
      if (type) where.type = type;
      const entries = await d.prisma.benchmarkEntry.findMany({ where: where as never, take: limit ?? 10, orderBy: { order: 'asc' } });
      const filtered = query
        ? entries.filter((e) => e.content.includes(query) || e.title.includes(query))
        : entries;
      return {
        entries: filtered.map((e) => ({
          book: books.find((b) => b.id === e.bookId)?.title,
          type: e.type, title: e.title,
          content: e.content.slice(0, 600), chapterNo: e.chapterNo,
        })),
      };
    },
    {
      name: 'get_benchmark',
      description: '从全局对标库按需拉取拆解产物(跨所有对标书)。写大纲拉 PLOT/RHYTHM/EMOTION;写正文拉 STYLE/RHYTHM;建角色拉 CHARACTER。对标是参考不是照抄。',
      schema: z.object({
        type: z.enum(['CHAPTER', 'PLOT', 'RHYTHM', 'EMOTION', 'CHARACTER', 'STYLE']).optional(),
        query: z.string().optional(),
        limit: z.number().optional(),
      }),
    },
  );
```

- [ ] **Step 2: TOOL_REGISTRY + agent-tree**

`agent-registry.ts` 加:
```ts
import { makeGetBenchmarkTool } from './tools/get-benchmark.tool';
// TOOL_REGISTRY:
  get_benchmark: (d) => makeGetBenchmarkTool({ userId: d.userId, prisma: d.prisma }),
```

`agent-tree.config.ts`:main / writer / outline-writer 的 `tools` 数组末尾加 `'get_benchmark'`。

- [ ] **Step 3: prompt 加【按需对标参考】节**

在 `prompts/main.md`、`writer.md`、`outliner-writer.md` 末尾各加:

```markdown

## 【按需对标参考】

你可用 `get_benchmark(type?, query?)` 从对标库拉取其他小说的拆解产物作参考:
- 写大纲/分卷 → 拉 `PLOT`(故事线) / `RHYTHM`(节奏) / `EMOTION`(情绪模块),学结构与爽点
- 写正文 → 拉 `STYLE`(文风:句长/对话锚点) / `RHYTHM`(爆发节律)
- 建角色 → 拉 `CHARACTER`(角色卡范式)

**对标是参考不是照抄**,产物不进入本小说设定表。无对标书时跳过此节。
```

- [ ] **Step 4: typecheck + test(agent-prompts.spec 若 lock prompt substring,可能需更新)**
- [ ] **Step 5: Commit**

```bash
git add server/src/agentos/tools/get-benchmark.tool.ts server/src/agentos/agent-registry.ts server/src/agentos/agent-tree.config.ts server/src/agentos/prompts/main.md server/src/agentos/prompts/writer.md server/src/agentos/prompts/outliner-writer.md
git commit -m "feat(agentos): get_benchmark 写作引用 tool + main/writer/outline-writer prompt 按需对标指导

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 11: 前端 API 层

**Files:**
- Modify: `agent-ui/src/api/routes.ts`
- Create: `agent-ui/src/api/benchmark.ts`
- Create: `agent-ui/src/types/benchmark.ts`

- [ ] **Step 1: 类型(types/benchmark.ts)**

```ts
export type BenchmarkStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'INTERRUPTED'
export type BenchmarkEntryType = 'CHAPTER' | 'PLOT' | 'RHYTHM' | 'EMOTION' | 'CHARACTER' | 'STYLE'
export interface BenchmarkEntry {
  id: string; bookId: string; type: BenchmarkEntryType
  title: string; content: string; chapterNo: number | null; order: number
}
export interface BenchmarkBook {
  id: string; title: string; status: BenchmarkStatus
  progress: { chapter: number; total: number; agent: string } | Record<string, never>
  chapters: unknown[]; createdAt: string
  entries?: BenchmarkEntry[]  // detail 含
}
```

- [ ] **Step 2: 路由(routes.ts)**

```ts
  Benchmarks: (base: string) => `${base}/benchmarks`,
  Benchmark: (base: string, id: string) => `${base}/benchmarks/${id}`,
  BenchmarkDissect: (base: string, id: string) => `${base}/benchmarks/${id}/dissect`,
  BenchmarkStream: (base: string, id: string) => `${base}/benchmarks/${id}/stream`,
  BenchmarkUpload: (base: string) => `${base}/benchmarks/upload`,
```

- [ ] **Step 3: api/benchmark.ts(REST 函数 + 流式 dissect/stream)**

REST:list/detail/delete/upload 用现有 fetch + Authorization 风格(参考 `api/settings.ts` 的 headers/asJson/asEmpty)。upload 用 FormData。

```ts
import { APIRoutes } from './routes'
import type { BenchmarkBook } from '@/types/benchmark'

const headers = (token: string) => ({ Authorization: `Bearer ${token}` })

export const listBenchmarks = async (b: string, t: string): Promise<BenchmarkBook[]> => {
  const res = await fetch(APIRoutes.Benchmarks(b), { headers: headers(t) })
  if (!res.ok) throw new Error(`list failed (${res.status})`)
  return res.json()
}
export const getBenchmark = async (b: string, t: string, id: string): Promise<BenchmarkBook> => {
  const res = await fetch(APIRoutes.Benchmark(b, id), { headers: headers(t) })
  if (!res.ok) throw new Error(`get failed (${res.status})`)
  return res.json()
}
export const deleteBenchmark = async (b: string, t: string, id: string): Promise<void> => {
  const res = await fetch(APIRoutes.Benchmark(b, id), { method: 'DELETE', headers: headers(t) })
  if (!res.ok) throw new Error(`delete failed (${res.status})`)
}
export const uploadBenchmark = async (b: string, t: string, file: File, title: string): Promise<{ id: string; chapterCount: number; estTokens: number }> => {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('title', title)
  const res = await fetch(APIRoutes.BenchmarkUpload(b), { method: 'POST', headers: headers(t), body: fd })
  if (!res.ok) throw new Error(`upload failed (${res.status})`)
  return res.json()
}

/** 流式拆解:POST dissect,返回 ReadableStream(newline-JSON)。调用方读帧。 */
export const dissectBenchmarkStream = (b: string, t: string, id: string) =>
  fetch(APIRoutes.BenchmarkDissect(b, id), { method: 'POST', headers: headers(t) })
/** 断线重连 */
export const streamBenchmark = (b: string, t: string, id: string) =>
  fetch(APIRoutes.BenchmarkStream(b, id), { headers: headers(t) })
```

- [ ] **Step 4: typecheck**(组件未建,预期红——记录给 Task 12)
- [ ] **Step 5: Commit**

```bash
git add agent-ui/src/api/routes.ts agent-ui/src/api/benchmark.ts agent-ui/src/types/benchmark.ts
git commit -m "feat(agent-ui): benchmark API + 类型(REST + 流式 dissect/stream)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 12: 前端 /dissect 模块

**Files:**
- Create: `agent-ui/src/app/dissect/page.tsx`(路由 + RequireAuth)
- Create: `agent-ui/src/components/dissect/DissectPage.tsx`(任务列表 + 上传 + 二次确认 + 日志抽屉 + 结果浏览)
- Modify: `agent-ui/src/components/layout/AppSidebar.tsx`(加「拆解」tab)

> 前端无 test,用 typecheck + lint + format + 手动验证。**参考现有组件模式**:列表样式参考 `components/library/`(小说库卡片);弹窗参考 `components/ui/dialog.tsx`;流式日志解析参考 `hooks/useAIStreamHandler`(适配 newline-JSON 活动帧)。

- [ ] **Step 1: AppSidebar 加「拆解」tab**

`AppSidebar.tsx` 的 tab 列表加 `{ key: 'dissect', label: '拆解', href: '/dissect' }`(与「小说库」「设置」并列)。

- [ ] **Step 2: /dissect 路由**

`app/dissect/page.tsx`:
```tsx
import RequireAuth from '@/components/auth/RequireAuth'
import DissectPage from '@/components/dissect/DissectPage'
export default function Page() {
  return <RequireAuth><DissectPage /></RequireAuth>
}
```

- [ ] **Step 3: DissectPage.tsx(核心组件,5 个子区域)**

实现要点(按 narratox 暗色风格,参考 library/ 卡片 + ui/dialog 弹窗):

1. **任务列表**:`listBenchmarks` → 卡片列表。每卡:title + status badge(✓ DONE / 🔄 RUNNING 第X/N章·agent / ⏸ PENDING / ⚠ FAILED·INTERRUPTED)+ 操作按钮(浏览结果[DONE] / 查看日志[RUNNING] / 重试[FAILED/INTERRUPTED] / 删)。
2. **上传**:「+ 上传」按钮 → 隐藏 `<input type="file" accept=".txt">` → 选文件 → `uploadBenchmark(file, title)` → 拿到 `{id, chapterCount, estTokens}` → 弹**二次确认 Dialog**(黄色,警告 token + 预估 + 「建议 chapter-extractor 配便宜模型」)→ 确认 → `dissectBenchmarkStream(id)` 进流式。
3. **流式日志抽屉**:RUNNING 任务点「查看日志」→ 展开 Drawer/Dialog。读 `dissectBenchmarkStream` 的 ReadableStream,逐行 parse newline-JSON,按 event 类型渲染(RunStarted / activity[think/tool/content] / Heartbeat / RunCompleted)。复用 `useAIResponseStream` 的增量解析思路(活动帧 → 时间戳 + agent 标签着色 + tool 调用)。断线自动接 `streamBenchmark`。
4. **结果浏览**:DONE 任务点「浏览结果」→ `getBenchmark(id)` → 按 type 分组(文风/节奏/情绪/角色/剧情/章节摘要)展示 entries。
5. **状态轮询**:列表页定期(5s)`listBenchmarks` 刷新 status/progress(RUNNING 时)。

关键代码骨架(完整 TSX 由 implementer 按上述要点 + 现有组件模式填充):
```tsx
'use client'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/store'
import { listBenchmarks, uploadBenchmark, getBenchmark, deleteBenchmark, dissectBenchmarkStream } from '@/api/benchmark'
import type { BenchmarkBook } from '@/types/benchmark'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

const STATUS_LABEL: Record<string, string> = {
  PENDING: '⏸ 待确认', RUNNING: '🔄 拆解中', DONE: '✓ 完成', FAILED: '⚠ 失败', INTERRUPTED: '⚠ 中断',
}

const DissectPage = () => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const [books, setBooks] = useState<BenchmarkBook[]>([])
  const [loading, setLoading] = useState(true)
  const [pendingUpload, setPendingUpload] = useState<{ id: string; chapterCount: number; estTokens: number } | null>(null)
  const [logBookId, setLogBookId] = useState<string | null>(null)  // 日志抽屉
  const [resultBook, setResultBook] = useState<BenchmarkBook | null>(null)  // 结果浏览

  const refresh = useCallback(async () => { /* listBenchmarks */ }, [endpoint, token])
  useEffect(() => { refresh() }, [refresh])

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return
    try { const r = await uploadBenchmark(endpoint, token, f, f.name); setPendingUpload(r) }
    catch (err) { toast.error(err instanceof Error ? err.message : '上传失败') }
  }
  const confirmDissect = async () => {
    if (!pendingUpload) return
    setPendingUpload(null)
    // 触发流式 + 打开日志抽屉
    setLogBookId(pendingUpload.id)
    dissectBenchmarkStream(endpoint, token, pendingUpload.id)  // 流由 LogDrawer 读
  }

  return (
    <div>
      <h1>拆解小说</h1>
      <Button onClick={() => document.getElementById('dissect-upload')?.click()}>+ 上传小说</Button>
      <input id="dissect-upload" type="file" accept=".txt" hidden onChange={onFile} />
      {/* 任务列表:books.map(b => 卡片 + status + 操作) */}
      {/* 二次确认 Dialog:pendingUpload */}
      {/* 日志抽屉:logBookId */}
      {/* 结果浏览:resultBook */}
    </div>
  )
}
export default DissectPage
```

> 日志抽屉的流式解析是前端最复杂的部分。implementer 参考 `hooks/useAIResponseStream.tsx`(newline-JSON 增量解析)+ `useAIStreamHandler.tsx`(帧 → 渲染),适配 benchmark 的 event 结构(RunStarted/activity/Heartbeat/RunCompleted)。

- [ ] **Step 4: typecheck + lint + format + 手动验证**

Run: `cd agent-ui && pnpm validate` → 全绿。启服务手动验证:上传 txt → 二次确认 → 拆解流式 → 结果浏览。

- [ ] **Step 5: Commit**

```bash
git add agent-ui/src/app/dissect/page.tsx agent-ui/src/components/dissect/ agent-ui/src/components/layout/AppSidebar.tsx
git commit -m "feat(agent-ui): /dissect 拆解小说模块(上传+列表+二次确认+日志抽屉+结果浏览)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 13: 回归 + 测试

- [ ] **Step 1: server 全量**

Run: `cd server && pnpm test && pnpm typecheck`
Expected: 全绿。

- [ ] **Step 2: agent-ui validate**

Run: `cd agent-ui && pnpm validate`
Expected: 全绿。

- [ ] **Step 3: 端到端手动验证**

- 主页「拆解」tab → 上传 txt → 二次确认 → 拆解流式(日志抽屉实时滚动)→ DONE → 浏览结果(6 type 分组)
- 设置页「按 Agent 分配模型」→ 含 DISSECT_TREE 的 6 个拆解 agent → 给 chapter-extractor 配便宜模型
- 写作时 main/writer 能调 `get_benchmark` 拉对标参考

- [ ] **Step 4: 收尾 commit(若有 lint 修复)**

---

## Definition of Done

- [ ] BenchmarkBook / BenchmarkEntry 两表 + 2 enum + prisma generate
- [ ] splitChapters 章节切分纯函数
- [ ] BenchmarkService CRUD + writeEntry(拆解工具用)
- [ ] 4 个拆解 tools(write_benchmark/get_raw_chapter/get_dissect_entries/report_dissect_review) + ToolDeps 扩展(bookId?/benchmark?)
- [ ] DISSECT_TREE(dissect-main + 5 子 agent) + 6 prompts
- [ ] DissectContextAssembler.forBook
- [ ] DissectAgentService 异步 + 流式 + job map + 进程重启 INTERRUPTED 兜底
- [ ] BenchmarkController(upload FileInterceptor + dissect 流式 + stream 断线重连 + delete)
- [ ] buildAgentGroups 纳入 DISSECT_TREE(per-agent 配置含拆解 agent)
- [ ] get_benchmark 写作引用 tool + main/writer/outline-writer prompt 按需对标指导
- [ ] 前端 /dissect 模块(上传/列表/二次确认/日志抽屉/结果浏览)+ AppSidebar 拆解 tab
- [ ] server test/typecheck + agent-ui validate 全绿
- [ ] 复用 Plan 1 per-agent 链(chapter-extractor 配便宜模型省 token)
