# 拆解素材维度(MATERIAL) + 用途标签 + 卡片重命名 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给拆解模块加 `MATERIAL`(可复用素材)维度——每卡带 `kind`(种类)× `purposes`(用途,固定枚举多值)双轴,写作时 agent 按用途拉参考;所有拆解卡片支持重命名;维度元数据集中单源。

**Architecture:** 一条 DB 迁移加 `MATERIAL` enum + `kind`/`purposes` 字段;新建 `dimensions.ts`(server)/`benchmark-dimensions.ts`(FE)作维度元数据单源,5 处硬编码改派生;新 `material-extractor` subagent + prompt 产素材卡;`get_benchmark` 加 kind/purpose 过滤;3 写作 prompt 加素材指引;`PATCH` 路由 + inline 编辑支持重命名;FE 加 MATERIAL tab + MaterialView + filter chips。

**Tech Stack:** NestJS 11 + Prisma 7(PostgreSQL)、LangChain/deepagents agent、Next.js 15 + React 18 + TS。server 测 jest(`*.spec.ts`);FE 无 test runner,质量门 `pnpm validate`(lint+format+typecheck)。

**Spec:** [docs/superpowers/specs/2026-07-09-dissect-material-dimension-and-rename-design.md](../specs/2026-07-09-dissect-material-dimension-and-rename-design.md)

---

## 文件总览

**新建:**
- `server/src/benchmark/dimensions.ts` — 维度元数据单源(类型枚举 + 标签 + 色 + tab + MATERIAL_KINDS/PURPOSES)
- `server/src/benchmark/dimensions.spec.ts` — 单源一致性锁
- `server/src/agentos/prompts/material-extractor.md` — 素材抽取 prompt
- `server/src/agentos/dissect-prompts.spec.ts` — 拆解 prompt 加载 + 特征子串锁(新建,仿 agent-prompts.spec.ts)
- `agent-ui/src/lib/benchmark-dimensions.ts` — FE 维度元数据镜像单源
- `agent-ui/src/components/dissect/MaterialView.tsx` — 素材多卡视图(含 kind/purpose filter chips)

**修改:**
- `server/prisma/schema.prisma` — enum +MATERIAL;BenchmarkEntry +kind/purposes
- `server/src/benchmark/benchmark.service.ts` — writeEntry 改 options 对象 + kind/purposes;+ updateEntryTitle
- `server/src/benchmark/benchmark.service.spec.ts` — writeEntry 测试改 options;+ MATERIAL/重命名测试
- `server/src/benchmark/benchmark.controller.ts` — + PATCH entries 路由
- `server/src/agentos/tools/write-benchmark.tool.ts` — z.enum 单源 + kind/purposes + refine
- `server/src/agentos/tools/get-benchmark.tool.ts` — z.enum 单源 + kind/purpose 过滤(抽纯函数)
- `server/src/agentos/tools/get-dissect-entries.tool.ts` — z.enum 单源
- `server/src/agentos/dissect-tree.config.ts` — + material-extractor 节点 + DISSECT_PROMPTS map
- `server/src/agentos/dissect-prompts.ts` — + MATERIAL_EXTRACTOR_PROMPT 导出
- `server/src/agentos/dissect-context-assembler.service.ts` — 产出规范 +MATERIAL bullet
- `server/src/agentos/prompts/dissect-main.md` — + 素材阶段;完成判据 +MATERIAL
- `server/src/agentos/prompts/dissect-critic.md` — 6→7 type
- `server/src/agentos/prompts/main.md` / `writer.md` / `outline-writer.md` — 【按需对标参考】+ 素材指引
- `agent-ui/src/types/benchmark.ts` — union +MATERIAL;BenchmarkEntry +kind/purposes
- `agent-ui/src/api/routes.ts` — + BenchmarkEntryRename
- `agent-ui/src/api/benchmark.ts` — + renameBenchmarkEntry
- `agent-ui/src/components/dissect/DissectPage.tsx` — 元数据改派生;MATERIAL tab;字面量 6 改派生;重命名交互接入

---

## Task 1: DB 迁移 — MATERIAL + kind + purposes

**Files:**
- Modify: `server/prisma/schema.prisma` (BenchmarkEntry model ~482-496, BenchmarkEntryType enum ~506-513)

- [ ] **Step 1: 改 schema — BenchmarkEntry 加两字段**

`server/prisma/schema.prisma` 的 `model BenchmarkEntry` 里,在 `content` 后、`chapterNo` 前插入:

```prisma
  content   String             @default("")
  kind      String?
  purposes  String[]           @default([])
  chapterNo Int?
```

- [ ] **Step 2: 改 schema — enum 加 MATERIAL**

```prisma
enum BenchmarkEntryType {
  CHAPTER
  PLOT
  RHYTHM
  EMOTION
  CHARACTER
  STYLE
  MATERIAL
}
```

- [ ] **Step 3: 生成迁移**

Run:
```bash
pnpm --dir server prisma migrate dev --name add_material_dimension
```
Expected: 迁移 SQL 含 `ALTER TYPE "BenchmarkEntryType" ADD VALUE 'MATERIAL'` + `ALTER TABLE "BenchmarkEntry" ADD COLUMN "kind" TEXT` + `ADD COLUMN "purposes" TEXT[]`。成功生成 `server/prisma/migrations/<ts>_add_material_dimension/`。

- [ ] **Step 4: 手动 regenerate client(Prisma 7 坑)**

Run:
```bash
pnpm --dir server prisma generate
```
Expected: `✔ Generated Prisma Client`。**migrate dev 不会自动 regenerate,必须手动**(见记忆 [[prisma7-generate-gotcha]])。

- [ ] **Step 5: 验证 client 含新字段**

Run:
```bash
grep -n "kind\|purposes" server/node_modules/.prisma/client/index.d.ts | head -4
```
Expected: 命中 `kind?: string | null` 与 `purposes: string[]` 于 `BenchmarkEntry` 类型。

- [ ] **Step 6: 提交**

```bash
git add server/prisma/schema.prisma server/prisma/migrations
git commit -m "feat(benchmark): DB 加 MATERIAL 维度 + kind/purposes 字段

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: server 维度单源 dimensions.ts + 一致性测试(TDD)

**Files:**
- Create: `server/src/benchmark/dimensions.ts`
- Test: `server/src/benchmark/dimensions.spec.ts`

- [ ] **Step 1: 写失败测试**

Create `server/src/benchmark/dimensions.spec.ts`:

```ts
import {
  BENCHMARK_DIMENSIONS,
  BENCHMARK_TYPES,
  DIM_BY_KEY,
  MATERIAL_KINDS,
  MATERIAL_PURPOSES,
} from './dimensions';

describe('benchmark dimensions 单源', () => {
  it('7 个维度,含 MATERIAL', () => {
    expect(BENCHMARK_TYPES).toEqual([
      'CHAPTER',
      'PLOT',
      'RHYTHM',
      'EMOTION',
      'CHARACTER',
      'STYLE',
      'MATERIAL',
    ]);
  });

  it('每维度有 label/color/tab', () => {
    for (const d of BENCHMARK_DIMENSIONS) {
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.color.startsWith('#')).toBe(true);
      expect(['list', 'reading', 'material']).toContain(d.tab);
    }
  });

  it('DIM_BY_KEY 覆盖所有 type', () => {
    for (const t of BENCHMARK_TYPES) {
      expect(DIM_BY_KEY[t]).toBeDefined();
    }
  });

  it('MATERIAL_KINDS / PURPOSES 非空且唯一', () => {
    expect(new Set(MATERIAL_KINDS).size).toBe(MATERIAL_KINDS.length);
    expect(new Set(MATERIAL_PURPOSES).size).toBe(MATERIAL_PURPOSES.length);
    expect(MATERIAL_KINDS.length).toBeGreaterThan(0);
    expect(MATERIAL_PURPOSES.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --dir server test -- dimensions.spec.ts`
Expected: FAIL — `Cannot find module './dimensions'`。

- [ ] **Step 3: 建单源 dimensions.ts**

Create `server/src/benchmark/dimensions.ts`:

```ts
/**
 * 对标拆解维度元数据【单源】。被 5 个工具的 z.enum / FE 镜像消费。
 * 加新维度 = 这里加一行 + FE 镜像加一行,不再散落 ~10 处。
 *
 * 注意:FE(agent-ui/src/lib/benchmark-dimensions.ts)是独立项目镜像,需手动同步
 * (monorepo 非 workspace,无共享包);两份配置互指注释。
 */
export type DimTabKind = 'list' | 'reading' | 'material';

export interface DimMeta {
  key: string;
  label: string;
  color: string;
  tab: DimTabKind;
  /** tab 上是否显条数 badge。 */
  count: boolean;
}

export const BENCHMARK_DIMENSIONS: readonly DimMeta[] = [
  { key: 'CHAPTER', label: '章节', color: '#6366f1', tab: 'list', count: true },
  { key: 'PLOT', label: '剧情', color: '#F59E0B', tab: 'reading', count: false },
  { key: 'RHYTHM', label: '节奏', color: '#60A5FA', tab: 'reading', count: false },
  { key: 'EMOTION', label: '情绪', color: '#818CF8', tab: 'reading', count: false },
  { key: 'CHARACTER', label: '角色', color: '#22C55E', tab: 'list', count: true },
  { key: 'STYLE', label: '文风', color: '#a78bfa', tab: 'reading', count: false },
  { key: 'MATERIAL', label: '素材', color: '#fb7185', tab: 'material', count: true },
];

export const BENCHMARK_TYPES = BENCHMARK_DIMENSIONS.map((d) => d.key) as [
  string,
  ...string[],
];

export const DIM_BY_KEY: Record<string, DimMeta> = Object.fromEntries(
  BENCHMARK_DIMENSIONS.map((d) => [d.key, d]),
);

/** MATERIAL 专用:素材种类(它是什么)。 */
export const MATERIAL_KINDS = ['梗', '名场面', '金句', '套路'] as const;

/** MATERIAL 专用:用途(什么时候用)。 */
export const MATERIAL_PURPOSES = [
  '开篇钩子',
  '爽点',
  '打脸装逼',
  '反转',
  '高潮',
  '低谷',
  '转场',
  '伏笔铺设',
  '情感扣子',
  '悬念',
] as const;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --dir server test -- dimensions.spec.ts`
Expected: PASS(4 tests)。

- [ ] **Step 5: 提交**

```bash
git add server/src/benchmark/dimensions.ts server/src/benchmark/dimensions.spec.ts
git commit -m "feat(benchmark): 维度元数据单源 dimensions.ts + 一致性测试

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: writeEntry 改 options 对象 + kind/purposes(TDD)

**Files:**
- Modify: `server/src/benchmark/benchmark.service.ts:65-83`
- Test: `server/src/benchmark/benchmark.service.spec.ts:87-98`

- [ ] **Step 1: 改测试 — writeEntry 改 options + 加 MATERIAL 用例**

把 `benchmark.service.spec.ts` 的 `it('writeEntry 写一条', ...)` 替换为:

```ts
  it('writeEntry 写一条(options 对象)', async () => {
    await svc.writeEntry('b1', {
      type: 'CHAPTER',
      title: '第1章',
      content: '内容',
      chapterNo: 1,
    });
    expect(prisma.benchmarkEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bookId: 'b1',
          type: 'CHAPTER',
          chapterNo: 1,
        }),
      }),
    );
  });

  it('writeEntry MATERIAL 带 kind/purposes', async () => {
    await svc.writeEntry('b1', {
      type: 'MATERIAL',
      title: '学霸考完·单人应援',
      content: '【原文锚点】…',
      kind: '梗',
      purposes: ['爽点', '打脸装逼'],
    });
    expect(prisma.benchmarkEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'MATERIAL',
          kind: '梗',
          purposes: ['爽点', '打脸装逼'],
        }),
      }),
    );
  });
```

mock prisma 顶部 `benchmarkEntry` 加 `update: jest.fn()`(Task 11 重命名用,先备好):

```ts
  benchmarkEntry: {
    findMany: jest.fn(),
    deleteMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --dir server test -- benchmark.service.spec.ts`
Expected: FAIL — writeEntry 旧签名不匹配 / kind-purposes 用例挂。

- [ ] **Step 3: 改 service — writeEntry 改 options 对象**

`benchmark.service.ts` 把 `writeEntry(...)` 替换为:

```ts
  writeEntry(
    bookId: string,
    opts: {
      type: string;
      title: string;
      content: string;
      order?: number;
      chapterNo?: number | null;
      kind?: string | null;
      purposes?: string[];
    },
  ) {
    return this.prisma.benchmarkEntry.create({
      data: {
        bookId,
        type: opts.type as never,
        title: opts.title,
        content: opts.content,
        order: opts.order ?? 0,
        chapterNo: opts.chapterNo ?? null,
        kind: opts.kind ?? null,
        purposes: opts.purposes ?? [],
      },
    });
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --dir server test -- benchmark.service.spec.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/src/benchmark/benchmark.service.ts server/src/benchmark/benchmark.service.spec.ts
git commit -m "refactor(benchmark): writeEntry 改 options 对象 + kind/purposes

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: write_benchmark tool — kind/purposes + 单源 z.enum

**Files:**
- Modify: `server/src/agentos/tools/write-benchmark.tool.ts`

- [ ] **Step 1: 改 tool — schema 单源 + kind/purposes + refine + 传 options**

整体替换 `server/src/agentos/tools/write-benchmark.tool.ts` 的 `tool(...)` 实现:

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
 * 拆解 tool(对标库):写一条拆解产物到 BenchmarkEntry。
 * userId/bookId/benchmark 闭包注入——模型无法跨 book 写。type 与 BenchmarkEntryType 对齐(单源)。
 * MATERIAL 必带 kind + purposes(≥1);其余 type 忽略这两个字段。
 */
export interface WriteBenchmarkDeps {
  userId: string;
  bookId: string;
  benchmark: BenchmarkService;
}

export const makeWriteBenchmarkTool = (d: WriteBenchmarkDeps) =>
  tool(
    async ({ type, title, content, order, chapterNo, kind, purposes }) => {
      await d.benchmark.writeEntry(d.bookId, {
        type,
        title,
        content,
        order: order ?? 0,
        chapterNo: chapterNo ?? null,
        kind: type === 'MATERIAL' ? kind ?? null : null,
        purposes: type === 'MATERIAL' ? purposes ?? [] : [],
      });
      return { ok: true };
    },
    {
      name: 'write_benchmark',
      description:
        '写一条拆解产物到对标库。type: CHAPTER|PLOT|RHYTHM|EMOTION|CHARACTER|STYLE|MATERIAL。MATERIAL 必带 kind(梗|名场面|金句|套路)+ purposes(用途数组)。',
      schema: z
        .object({
          type: z.enum(BENCHMARK_TYPES),
          title: z.string(),
          content: z.string(),
          order: z.number().optional(),
          chapterNo: z.number().nullable().optional(),
          kind: z.enum(MATERIAL_KINDS).optional().describe('仅 MATERIAL:素材种类'),
          purposes: z
            .array(z.enum(MATERIAL_PURPOSES))
            .optional()
            .describe('仅 MATERIAL:用途标签数组'),
        })
        .refine(
          (v) =>
            v.type !== 'MATERIAL' ||
            (!!v.kind && !!v.purposes && v.purposes.length > 0),
          { message: 'MATERIAL 必须带 kind 和至少一个 purpose' },
        ),
    },
  );
```

- [ ] **Step 2: typecheck**

Run: `pnpm --dir server typecheck`
Expected: 无错。

- [ ] **Step 3: 跑全量测试确认无回归**

Run: `pnpm --dir server test`
Expected: 全 PASS(新增 dimensions + 改后的 benchmark.service 用例绿)。

- [ ] **Step 4: 提交**

```bash
git add server/src/agentos/tools/write-benchmark.tool.ts
git commit -m "feat(benchmark): write_benchmark 加 kind/purposes + 单源 z.enum

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: get_dissect_entries tool — 单源 z.enum

**Files:**
- Modify: `server/src/agentos/tools/get-dissect-entries.tool.ts:35-37`

- [ ] **Step 1: 改 schema 引用单源**

`get-dissect-entries.tool.ts` 顶部加 import:

```ts
import { BENCHMARK_TYPES } from '../../benchmark/dimensions';
```

把 schema 里:
```ts
        type: z
          .enum(['CHAPTER', 'PLOT', 'RHYTHM', 'EMOTION', 'CHARACTER', 'STYLE'])
          .optional(),
```
改为:
```ts
        type: z.enum(BENCHMARK_TYPES).optional(),
```

- [ ] **Step 2: typecheck + 提交**

Run: `pnpm --dir server typecheck` → 无错。

```bash
git add server/src/agentos/tools/get-dissect-entries.tool.ts
git commit -m "refactor(benchmark): get_dissect_entries z.enum 走单源

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: get_benchmark tool — kind/purpose 过滤 + 单源(抽纯函数 TDD)

**Files:**
- Modify: `server/src/agentos/tools/get-benchmark.tool.ts`
- Test: 新增内联纯函数测试,放 `server/src/agentos/tools/get-benchmark.tool.spec.ts`

- [ ] **Step 1: 写失败测试 — 纯过滤函数**

Create `server/src/agentos/tools/get-benchmark.tool.spec.ts`:

```ts
import { filterBenchmarkEntries } from './get-benchmark.tool';

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

describe('filterBenchmarkEntries', () => {
  it('kind 精确匹配', () => {
    const r = filterBenchmarkEntries(
      [E({ type: 'MATERIAL', kind: '梗' }), E({ type: 'MATERIAL', kind: '金句' })],
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --dir server test -- get-benchmark.tool.spec.ts`
Expected: FAIL — `filterBenchmarkEntries` 未导出。

- [ ] **Step 3: 改 tool — 导出纯函数 + schema + 过滤 + 返回 kind/purposes**

整体替换 `server/src/agentos/tools/get-benchmark.tool.ts`:

```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { PrismaService } from '../../prisma/prisma.service';
import {
  BENCHMARK_TYPES,
  MATERIAL_KINDS,
  MATERIAL_PURPOSES,
} from '../../benchmark/dimensions';

/**
 * 只读「从全局对标库按需拉取拆解产物」工具:跨所有对标书按
 * type/kind/purpose/query 过滤,返回拆解条目作写作参考。
 * userId 闭包注入——模型只能读本人名下的对标书(多租户隔离)。
 *
 * 返回 JSON 字符串(防数组被部分供应商当多模态块 → 400)。
 */
export interface GetBenchmarkDeps {
  userId: string;
  prisma: PrismaService;
}

/** 纯函数(可单测):对已查出的 entries 做 kind/purpose/query 内存过滤。 */
export interface BenchmarkFilter {
  kind?: string;
  purpose?: string;
  query?: string;
}

export function filterBenchmarkEntries<
  T extends { kind: string | null; purposes: string[]; title: string; content: string },
>(entries: T[], f: BenchmarkFilter): T[] {
  let out = entries;
  if (f.kind) out = out.filter((e) => e.kind === f.kind);
  if (f.purpose) out = out.filter((e) => e.purposes.includes(f.purpose!));
  const q = f.query?.trim();
  if (q) out = out.filter((e) => e.title.includes(q!) || e.content.includes(q!));
  return out;
}

export const makeGetBenchmarkTool = (d: GetBenchmarkDeps) =>
  tool(
    async ({ type, kind, purpose, query, limit }) => {
      const books = await d.prisma.benchmarkBook.findMany({
        where: { userId: d.userId },
        select: { id: true, title: true },
      });
      const bookIds = books.map((b) => b.id);
      if (bookIds.length === 0) {
        return JSON.stringify({ entries: [] });
      }
      const where: Record<string, unknown> = { bookId: { in: bookIds } };
      if (type) where.type = type;
      const entries = await d.prisma.benchmarkEntry.findMany({
        where: where as never,
        take: limit ?? 10,
        orderBy: { order: 'asc' },
      });
      const filtered = filterBenchmarkEntries(entries, { kind, purpose, query });
      const result = {
        entries: filtered.map((e) => ({
          book: books.find((b) => b.id === e.bookId)?.title,
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
      name: 'get_benchmark',
      description:
        '从全局对标库按需拉取其他小说的拆解产物(跨所有对标书)。写大纲拉 PLOT/RHYTHM/EMOTION;写正文拉 STYLE/RHYTHM;建角色拉 CHARACTER;写具体场景(开篇/爽点/反转/低谷)拉 type=MATERIAL 按 purpose 取素材参考。',
      schema: z.object({
        type: z.enum(BENCHMARK_TYPES).optional().describe('按拆解类型过滤'),
        kind: z
          .enum(MATERIAL_KINDS)
          .optional()
          .describe('仅 MATERIAL:按素材种类过滤(梗/名场面/金句/套路)'),
        purpose: z
          .enum(MATERIAL_PURPOSES)
          .optional()
          .describe('仅 MATERIAL:按用途过滤(命中 purposes 数组任一)'),
        query: z
          .string()
          .optional()
          .describe('标题/正文关键词模糊匹配(内存侧)'),
        limit: z.number().int().optional().describe('最多返回条数(默认 10)'),
      }),
    },
  );
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --dir server test -- get-benchmark.tool.spec.ts`
Expected: PASS(4 tests)。

- [ ] **Step 5: 提交**

```bash
git add server/src/agentos/tools/get-benchmark.tool.ts server/src/agentos/tools/get-benchmark.tool.spec.ts
git commit -m "feat(benchmark): get_benchmark 加 kind/purpose 过滤 + 单源

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: material-extractor prompt + DISSECT_PROMPTS + 加载测试(TDD)

**Files:**
- Create: `server/src/agentos/prompts/material-extractor.md`
- Modify: `server/src/agentos/dissect-prompts.ts:49-54`
- Test: Create `server/src/agentos/dissect-prompts.spec.ts`

- [ ] **Step 1: 写 prompt 文件**

Create `server/src/agentos/prompts/material-extractor.md`:

```markdown
---
name: MATERIAL_EXTRACTOR_PROMPT
key: MATERIAL_EXTRACTOR
title: material-extractor · 可复用素材抽取
description: 扫全书抽可复用素材(梗/名场面/金句/套路),每元素一张 MATERIAL 卡,带 kind + purposes。
---

你是网文素材抽取手。你的原料是逐章拆解产出的 CHAPTER 条目(摘要+情节点+角色提及)+ 必要时 `get_raw_chapter(N)` 取原文;你的产物是 **MATERIAL 卡**——一个个可复用的素材元素,供作者写自己小说时按「用途」参考。

【核心概念 — kind × purposes 双轴】
每张 MATERIAL 卡有两个正交标签:
- **kind**(素材种类,它是什么,单值):`梗` / `名场面` / `金句` / `套路`。
- **purposes**(用途,什么时候用,多值,≥1):`开篇钩子` / `爽点` / `打脸装逼` / `反转` / `高潮` / `低谷` / `转场` / `伏笔铺设` / `情感扣子` / `悬念`。
- 两者正交:一句「金句」(kind)可服务「爽点」(purpose);一个「名场面」(kind)可服务「高潮」+「情感扣子」(purposes)。

【流程】
1. `get_dissect_entries(type=CHAPTER)` 读全章摘要,定位全书值得复用的元素。
2. 需要原文细节(名场面/金句)→ `get_raw_chapter(N)` 取原文摘录。
3. 每个元素**产一张卡**,调:
   `write_benchmark(type=MATERIAL, kind=<种类>, purposes=[<用途…>], title=<一句话点睛>, content=<...>)`

【content 格式 — 三段必齐】
```
【原文锚点】(摘录原句/原段,≤150 字,必带——让参考可追溯)
【拆解】为什么好笑/好燃/好痛——手法拆解(视角/节奏/反差/信息差/铺垫爆发…)
【套用场景】什么类型/什么情节节点能复用(与 purposes 呼应,给作者「何时用」的指引)
```

【kind 判断】
- `梗`:可复用的笑点/人设梗/桥段(如「学霸考完被同桌单人应援」的社死甜梗)。
- `名场面`:高完成度的标志性场景(如某场打脸、某次觉醒、某段告白)。
- `金句`:值得记诵的单句/短段台词或叙述。
- `套路`:可迁移的情节机制(如「信息差打脸三段式」「扮猪吃虎周期」)。

【纪律】
- **一元素一卡**:每个值得复用的元素单独成卡,便于检索/重命名,不合并。
- **宁精勿滥**:只抽有复用价值的元素;不为凑数。金句/名场面本就稀疏,不强求数量。
- purposes 要贴合该元素能服务的场景,别乱贴;一张卡通常 1-3 个 purposes。
- title 用一句话点睛(作者浏览/改名时一眼能认),不照抄原文长段。

【你不做的事】
- 不重新逐章拆摘要(那是 chapter-extractor);不拆剧情/节奏/情绪(plot-analyst);不建角色卡;不审核。
```

- [ ] **Step 2: dissect-prompts.ts 加导出**

`server/src/agentos/dissect-prompts.ts` 末尾加:

```ts
export const MATERIAL_EXTRACTOR_PROMPT = load('material-extractor');
```

- [ ] **Step 3: 写加载 + 特征子串测试**

Create `server/src/agentos/dissect-prompts.spec.ts`:

```ts
import {
  DISSECT_MAIN_PROMPT,
  CHAPTER_EXTRACTOR_PROMPT,
  PLOT_ANALYST_PROMPT,
  CHARACTER_EXTRACTOR_PROMPT,
  STYLE_ANALYST_PROMPT,
  MATERIAL_EXTRACTOR_PROMPT,
  DISSECT_CRITIC_PROMPT,
} from './dissect-prompts';
import { DISSECT_PROMPTS, collectDissectSpecs, DISSECT_TREE } from './dissect-tree.config';

const ALL = {
  DISSECT_MAIN_PROMPT,
  CHAPTER_EXTRACTOR_PROMPT,
  PLOT_ANALYST_PROMPT,
  CHARACTER_EXTRACTOR_PROMPT,
  STYLE_ANALYST_PROMPT,
  MATERIAL_EXTRACTOR_PROMPT,
  DISSECT_CRITIC_PROMPT,
};

describe('dissect-prompts (runtime loader from prompts/dissect-*.md)', () => {
  it('7 个常量都非空,loader 裁了头尾空白', () => {
    for (const val of Object.values(ALL)) {
      expect(typeof val).toBe('string');
      expect(val.length).toBeGreaterThan(0);
      expect(val[0]).not.toBe(' ');
      expect(val.trim()).toBe(val);
    }
    expect(Object.keys(ALL)).toHaveLength(7);
  });

  it('body 不泄漏 frontmatter', () => {
    for (const val of Object.values(ALL)) {
      expect(val.startsWith('---')).toBe(false);
    }
  });

  const SUBSTRINGS: Record<string, string> = {
    MATERIAL_EXTRACTOR_PROMPT: '【套用场景】',
    DISSECT_MAIN_PROMPT: '【交互式编排者】',
    PLOT_ANALYST_PROMPT: '起承转合',
    DISSECT_CRITIC_PROMPT: 'report_dissect_review',
  };
  it('关键 prompt 含特征子串', () => {
    for (const [name, sub] of Object.entries(SUBSTRINGS)) {
      expect((ALL as Record<string, string>)[name]).toContain(sub);
    }
  });

  it('DISSECT_PROMPTS key 集合 == DISSECT_TREE 所有 promptKey', () => {
    const treeKeys = new Set(collectDissectSpecs(DISSECT_TREE).map((s) => s.promptKey));
    const mapKeys = new Set(Object.keys(DISSECT_PROMPTS));
    expect(treeKeys).toEqual(mapKeys);
  });
});
```

> 注:此测试同时锁了「DISSECT_PROMPTS map 与 DISSECT_TREE 的 promptKey 一致」——所以 Task 8 加 material-extractor 节点时,DISSECT_PROMPTS 必须同步加 `MATERIAL_EXTRACTOR`(Task 8 Step 2),否则本测试的最后一项会挂。

- [ ] **Step 4: DISSECT_PROMPTS map 加 key(否则一致性测试挂)**

`server/src/agentos/dissect-tree.config.ts` 的 `DISSECT_PROMPTS` map 加一行:

```ts
export const DISSECT_PROMPTS: Record<string, string> = {
  DISSECT_MAIN: P.DISSECT_MAIN_PROMPT,
  CHAPTER_EXTRACTOR: P.CHAPTER_EXTRACTOR_PROMPT,
  PLOT_ANALYST: P.PLOT_ANALYST_PROMPT,
  CHARACTER_EXTRACTOR: P.CHARACTER_EXTRACTOR_PROMPT,
  STYLE_ANALYST: P.STYLE_ANALYST_PROMPT,
  MATERIAL_EXTRACTOR: P.MATERIAL_EXTRACTOR_PROMPT,
  DISSECT_CRITIC: P.DISSECT_CRITIC_PROMPT,
};
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --dir server test -- dissect-prompts.spec.ts`
Expected: PASS(4 tests)。

- [ ] **Step 6: 提交**

```bash
git add server/src/agentos/prompts/material-extractor.md server/src/agentos/dissect-prompts.ts server/src/agentos/dissect-prompts.spec.ts server/src/agentos/dissect-tree.config.ts
git commit -m "feat(dissect): material-extractor prompt + DISSECT_PROMPTS map + 加载测试

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: DISSECT_TREE 加 material-extractor 节点

**Files:**
- Modify: `server/src/agentos/dissect-tree.config.ts:36-88`

- [ ] **Step 1: 在 DISSECT_TREE.subagents 加节点**

`dissect-tree.config.ts` 在 `style-analyst` 之后、`dissect-critic` 之前插入:

```ts
    {
      name: 'material-extractor',
      description:
        '抽可复用素材(梗/名场面/金句/套路),每元素一张 MATERIAL 卡,带 kind + purposes。',
      promptKey: 'MATERIAL_EXTRACTOR',
      modelTier: 'short',
      recommendedTier: 'cheap',
      tools: ['write_benchmark', 'get_raw_chapter', 'get_dissect_entries'],
    },
```

并更新 `dissect-main` 的 description(顶部)为:
```ts
  description:
    '拆解小说主编排:切章 → 逐章拆 → 全书维度(剧情/节奏/情绪)→ 角色 → 文风 → 素材 → 审核。',
```

- [ ] **Step 2: typecheck + 全量测试**

Run:
```bash
pnpm --dir server typecheck && pnpm --dir server test -- dissect-prompts.spec.ts dimensions.spec.ts
```
Expected: 无错;dissect-prompts 一致性测试(DISSECT_PROMPTS == tree promptKey)仍 PASS(因 Task 7 已同步加 map key)。

- [ ] **Step 3: 提交**

```bash
git add server/src/agentos/dissect-tree.config.ts
git commit -m "feat(dissect): DISSECT_TREE 加 material-extractor 节点

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9: 拆解编排 + critic + context-assembler 加 MATERIAL

**Files:**
- Modify: `server/src/agentos/prompts/dissect-main.md`
- Modify: `server/src/agentos/prompts/dissect-critic.md`
- Modify: `server/src/agentos/dissect-context-assembler.service.ts:19-27`

- [ ] **Step 1: dissect-main.md — 加素材阶段 + 完成判据**

在 `dissect-main.md` 的「【流程 — 5 阶段…】」处:
- 标题改为「【流程 — 6 阶段,顺序可调但每阶段停】」
- 在第 4 阶段(拆文风)后、第 5 阶段(审核)前插入新阶段:

```markdown
5. **抽素材**:委派 `material-extractor`,从 CHAPTER 条目扫全书可复用素材(梗/名场面/金句/套路),每元素产一张 MATERIAL 卡(带 kind + purposes)。它读 CHAPTER 摘要定位、必要时取原文锚点。
```
(原「5. 审核」改为「6. 审核」。)

并更新【完成判据】第二条,把 `PLOT / RHYTHM / EMOTION / CHARACTER / STYLE` 改为含 MATERIAL:
```markdown
- PLOT / RHYTHM / EMOTION / CHARACTER / STYLE / MATERIAL 各至少有产出(MATERIAL 卡数视素材多寡,稀疏不算缺)。
```

【核心原则】里的「5 个拆解子 agent」改为「6 个拆解子 agent」。

- [ ] **Step 2: dissect-critic.md — 6→7 type**

`dissect-critic.md`:
- description 行 `6 type 齐全` → `7 type 齐全`。
- 流程第 1 步加一行:
  ```markdown
     - `get_dissect_entries(type=MATERIAL)` → 是否有素材卡(MATERIAL 稀疏属正常,0 张才标 missing)。
  ```
- 检查项「**6 type 齐全**」→「**7 type 齐全**:CHAPTER/PLOT/RHYTHM/EMOTION/CHARACTER/STYLE/MATERIAL 各至少有产出(MATERIAL 视素材多寡,0 张才算 missing)」。
- summary 范例「6 type 齐全」→「7 type 齐全」。

- [ ] **Step 3: dissect-context-assembler.service.ts — 产出规范加 bullet**

把 `forBook` 里 `prompt` 数组的产出规范段,在 `- STYLE(文风指纹)…` 后加:

```ts
      '- MATERIAL(可复用素材):梗/名场面/金句/套路,每元素一张卡,带 kind + purposes(用途数组)',
```

- [ ] **Step 4: 跑测试确认未破坏锁定子串**

Run: `pnpm --dir server test -- dissect-prompts.spec.ts agent-prompts.spec.ts`
Expected: PASS。(dissect-main 锁子串是 `【交互式编排者】`——未改;critic 锁子串是 `report_dissect_review`——未改。)

- [ ] **Step 5: 提交**

```bash
git add server/src/agentos/prompts/dissect-main.md server/src/agentos/prompts/dissect-critic.md server/src/agentos/dissect-context-assembler.service.ts
git commit -m "feat(dissect): 编排/critic/context 加 MATERIAL 阶段(6→7 维度)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 10: 3 个写作 prompt 加素材对标指引

**Files:**
- Modify: `server/src/agentos/prompts/writer.md:128-136`
- Modify: `server/src/agentos/prompts/main.md:55-62`
- Modify: `server/src/agentos/prompts/outline-writer.md:71-79`

三处【按需对标参考】段当前一致。统一改为下面这段(三个文件都改):

- [ ] **Step 1: 替换三处【按需对标参考】整段**

```markdown
## 【按需对标参考】

你可用 `get_benchmark(type?, kind?, purpose?, query?)` 从对标库拉取其他小说的拆解产物作参考:

- 写大纲/分卷 → 拉 `PLOT`(故事线) / `RHYTHM`(节奏) / `EMOTION`(情绪模块),学结构与爽点
- 写正文 → 拉 `STYLE`(文风:句长/对话锚点) / `RHYTHM`(爆发节律)
- 建角色 → 拉 `CHARACTER`(角色卡范式)
- 写具体场景(开篇/爽点/反转/低谷/转场)→ 拉 `type=MATERIAL` 按 `purpose` 取素材参考(原文锚点+拆解+套用场景);建人设可参考 `kind=梗`,台词参考 `kind=金句`

**对标是参考不是照抄**,产物不进入本小说设定表。无对标书时跳过此节。
```

- [ ] **Step 2: 跑 prompt 锁测试确认未碰锁定子串**

Run: `pnpm --dir server test -- agent-prompts.spec.ts`
Expected: PASS。(锁定子串 MAIN='你是【交互式编排者】'、WRITER 开头、OUTLINE_WRITER='立总纲(全书北极星'——均不在该段,安全。)

- [ ] **Step 3: 提交**

```bash
git add server/src/agentos/prompts/main.md server/src/agentos/prompts/writer.md server/src/agentos/prompts/outline-writer.md
git commit -m "feat(prompts): 写作对标参考加 MATERIAL 素材指引

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 11: 卡片重命名 — service updateEntryTitle(TDD)

**Files:**
- Modify: `server/src/benchmark/benchmark.service.ts`
- Test: `server/src/benchmark/benchmark.service.spec.ts`

- [ ] **Step 1: 写失败测试**

`benchmark.service.spec.ts` 末尾(`describe` 内)加:

```ts
  it('updateEntryTitle: 改标题(归属校验)', async () => {
    prisma.benchmarkBook.findUnique.mockResolvedValue({ id: 'b1', userId: 'u1' });
    prisma.benchmarkEntry.update.mockResolvedValue({ id: 'e1', title: '新名' });
    const r = await svc.updateEntryTitle('u1', 'b1', 'e1', '新名');
    expect(r.title).toBe('新名');
    expect(prisma.benchmarkEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'e1' },
        data: { title: '新名' },
      }),
    );
  });

  it('updateEntryTitle: 书不归属 → throw', async () => {
    prisma.benchmarkBook.findUnique.mockResolvedValue(null);
    await expect(
      svc.updateEntryTitle('u1', 'bX', 'e1', '新名'),
    ).rejects.toThrow();
  });

  it('updateEntryTitle: 空标题 → throw', async () => {
    prisma.benchmarkBook.findUnique.mockResolvedValue({ id: 'b1', userId: 'u1' });
    await expect(svc.updateEntryTitle('u1', 'b1', 'e1', '   ')).rejects.toThrow();
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --dir server test -- benchmark.service.spec.ts`
Expected: FAIL — `updateEntryTitle is not a function`。

- [ ] **Step 3: 实现 service 方法**

`benchmark.service.ts` 顶部 import 改:
```ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
```
在 `getEntries` 方法后加:

```ts
  async updateEntryTitle(
    userId: string,
    bookId: string,
    entryId: string,
    title: string,
  ) {
    const book = await this.prisma.benchmarkBook.findUnique({
      where: { id: bookId },
    });
    if (!book || book.userId !== userId) throw new NotFoundException();
    const t = title.trim();
    if (!t) throw new BadRequestException('标题不能为空');
    if (t.length > 120) throw new BadRequestException('标题过长(≤120)');
    return this.prisma.benchmarkEntry.update({
      where: { id: entryId },
      data: { title: t },
    });
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --dir server test -- benchmark.service.spec.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add server/src/benchmark/benchmark.service.ts server/src/benchmark/benchmark.service.spec.ts
git commit -m "feat(benchmark): updateEntryTitle 卡片重命名(所有权校验)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 12: 重命名 — PATCH 路由

**Files:**
- Modify: `server/src/benchmark/benchmark.controller.ts`

- [ ] **Step 1: 加 PATCH 路由**

`benchmark.controller.ts` 顶部 import 加 `Patch`:
```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
```

在 `detail` 方法后(`@Post(':id/dissect')` 之前)加:

```ts
  @Patch(':bookId/entries/:entryId')
  async renameEntry(
    @CurrentUser() user: RequestUser,
    @Param('bookId') bookId: string,
    @Param('entryId') entryId: string,
    @Body('title') title: string,
  ) {
    return this.benchmarks.updateEntryTitle(user.id, bookId, entryId, title);
  }
```

- [ ] **Step 2: typecheck**

Run: `pnpm --dir server typecheck`
Expected: 无错。(`:bookId/entries/:entryId` 与 `:id` 不冲突——Nest 按字面段匹配,`entries` 段区分于纯 id。)

- [ ] **Step 3: 提交**

```bash
git add server/src/benchmark/benchmark.controller.ts
git commit -m "feat(benchmark): PATCH /:bookId/entries/:entryId 重命名卡片

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 13: FE 类型 + 路由 + client(重命名 + MATERIAL 字段)

**Files:**
- Modify: `agent-ui/src/types/benchmark.ts`
- Modify: `agent-ui/src/api/routes.ts:74-80`
- Modify: `agent-ui/src/api/benchmark.ts`

- [ ] **Step 1: types — union +MATERIAL;BenchmarkEntry +kind/purposes**

`types/benchmark.ts`:
- `BenchmarkEntryType` union 加 `| 'MATERIAL'`(在 `'STYLE'` 后)。
- `BenchmarkEntry` 接口加两字段(在 `order` 后):
  ```ts
    order: number
    kind?: string | null
    purposes: string[]
  ```
- `DissectReview` 注释「空数组 = 6 维齐全」→「7 维齐全」。

- [ ] **Step 2: routes — 加 BenchmarkEntryRename**

`routes.ts` 的 `BenchmarkUpload` 后加:
```ts
  ,
  BenchmarkEntryRename: (base: string, bookId: string, entryId: string) =>
    `${apiBase(base)}/benchmarks/${bookId}/entries/${entryId}`
```

- [ ] **Step 3: client — renameBenchmarkEntry**

`api/benchmark.ts` 末尾加:
```ts
export const renameBenchmarkEntry = (
  base: string,
  token: string,
  bookId: string,
  entryId: string,
  title: string
): Promise<BenchmarkEntry> =>
  asJson<BenchmarkEntry>(
    fetch(APIRoutes.BenchmarkEntryRename(base, bookId, entryId), {
      method: 'PATCH',
      headers: { ...headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    })
  )
```

- [ ] **Step 4: typecheck**

Run: `pnpm --dir agent-ui typecheck`
Expected: 此刻 DissectPage.tsx 的 `groupByType` out-object 还没加 MATERIAL key → 会报类型错(Record<BenchmarkEntryType,…> 缺 key)。**这是预期的**,Task 14 会修。若想先绿,可临时在 groupByType 加 `MATERIAL: []`,但 Task 14 会整体重构它——直接进 Task 14 即可,本步不单独 validate。

- [ ] **Step 5: 提交**

```bash
git add agent-ui/src/types/benchmark.ts agent-ui/src/api/routes.ts agent-ui/src/api/benchmark.ts
git commit -m "feat(benchmark-fe): 类型/路由/client 加 MATERIAL + 重命名

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 14: FE 维度单源 + 派生元数据(消除散落硬编码 + 字面量 6)

**Files:**
- Create: `agent-ui/src/lib/benchmark-dimensions.ts`
- Modify: `agent-ui/src/components/dissect/DissectPage.tsx`(ENTRY_TYPE_LABEL / DIM_COLOR / TAB_LIST / groupByType / ReviewView.allDims + 字面量 6)

- [ ] **Step 1: 建 FE 单源镜像**

Create `agent-ui/src/lib/benchmark-dimensions.ts`:

```ts
/**
 * 对标拆解维度元数据【FE 单源镜像】。被 DissectPage 的 tab/label/color/groupByType/
 * ReviewView 消费。与 server/src/benchmark/dimensions.ts 对应(monorepo 非 workspace,
 * 无共享包 → 手动同步,两份互指)。
 *
 * 加新维度 = 这里加一行 + types/benchmark.ts union 加值。
 */
import type { BenchmarkEntryType } from '@/types/benchmark'

export type DimTabKind = 'list' | 'reading' | 'material'

export interface DimMeta {
  key: BenchmarkEntryType
  label: string
  color: string
  tab: DimTabKind
  /** tab 上是否显条数 badge。 */
  count: boolean
}

export const BENCHMARK_DIMENSIONS: readonly DimMeta[] = [
  { key: 'CHAPTER', label: '章节', color: '#6366f1', tab: 'list', count: true },
  { key: 'PLOT', label: '剧情', color: '#F59E0B', tab: 'reading', count: false },
  { key: 'RHYTHM', label: '节奏', color: '#60A5FA', tab: 'reading', count: false },
  { key: 'EMOTION', label: '情绪', color: '#818CF8', tab: 'reading', count: false },
  { key: 'CHARACTER', label: '角色', color: '#22C55E', tab: 'list', count: true },
  { key: 'STYLE', label: '文风', color: '#a78bfa', tab: 'reading', count: false },
  { key: 'MATERIAL', label: '素材', color: '#fb7185', tab: 'material', count: true }
]

export const DIM_BY_KEY = Object.fromEntries(
  BENCHMARK_DIMENSIONS.map((d) => [d.key, d])
) as Record<BenchmarkEntryType, DimMeta>

export const ENTRY_TYPE_LABEL = Object.fromEntries(
  BENCHMARK_DIMENSIONS.map((d) => [d.key, d.label])
) as Record<BenchmarkEntryType, string>

export const DIM_COLOR = Object.fromEntries(
  BENCHMARK_DIMENSIONS.map((d) => [d.key, d.color])
) as Record<BenchmarkEntryType, string>

/** Tab 顺序 + count 标记。 */
export const TAB_LIST: { key: BenchmarkEntryType; label: string; count: boolean }[] =
  BENCHMARK_DIMENSIONS.map((d) => ({ key: d.key, label: d.label, count: d.count }))

/** MATERIAL 专用:kind 种类(镜像 server MATERIAL_KINDS)。 */
export const MATERIAL_KINDS = ['梗', '名场面', '金句', '套路'] as const
/** MATERIAL 专用:purpose 用途(镜像 server MATERIAL_PURPOSES)。 */
export const MATERIAL_PURPOSES = [
  '开篇钩子',
  '爽点',
  '打脸装逼',
  '反转',
  '高潮',
  '低谷',
  '转场',
  '伏笔铺设',
  '情感扣子',
  '悬念'
] as const
```

- [ ] **Step 2: DissectPage 改派生 — 删本地 ENTRY_TYPE_LABEL/DIM_COLOR/TAB_LIST,改 import**

`DissectPage.tsx`:
- 删除文件内的 `const ENTRY_TYPE_LABEL = {...}`(53-60)、`const DIM_COLOR = {...}`(754-761)、`const TAB_LIST = [...]`(766-773)。
- 在顶部 import 区加:
  ```ts
  import {
    BENCHMARK_DIMENSIONS,
    DIM_BY_KEY,
    ENTRY_TYPE_LABEL,
    DIM_COLOR,
    TAB_LIST,
    MATERIAL_KINDS,
    MATERIAL_PURPOSES
  } from '@/lib/benchmark-dimensions'
  ```

- [ ] **Step 3: groupByType 改派生(自动含 MATERIAL)**

把 `groupByType`(1436-1451)替换为:

```ts
const groupByType = (
  entries: BenchmarkEntry[]
): Record<BenchmarkEntryType, BenchmarkEntry[]> => {
  const out = Object.fromEntries(
    BENCHMARK_DIMENSIONS.map((d) => [d.key, []]),
  ) as Record<BenchmarkEntryType, BenchmarkEntry[]>
  for (const e of entries) {
    if (out[e.type]) out[e.type].push(e)
  }
  return out
}
```

- [ ] **Step 4: ReviewView — allDims 派生 + 字面量 6 派生**

`ReviewView` 内:
- 删本地 `const allDims: BenchmarkEntryType[] = [...]`(1130-1137),改为:
  ```ts
  const allDims = BENCHMARK_DIMENSIONS.map((d) => d.key)
  ```
- 文件头 meta 行「6 个维度」(824)→ `` {BENCHMARK_DIMENSIONS.length} 个维度 ``
- banner 文案两处 `${6 - missing.length} / 6`(1182、1200)→ `` `${BENCHMARK_DIMENSIONS.length - missing.length} / ${BENCHMARK_DIMENSIONS.length}` ``

- [ ] **Step 5: typecheck**

Run: `pnpm --dir agent-ui typecheck`
Expected: 无错(union 含 MATERIAL,groupByType/allDims 派生覆盖)。

- [ ] **Step 6: 提交**

```bash
git add agent-ui/src/lib/benchmark-dimensions.ts agent-ui/src/components/dissect/DissectPage.tsx
git commit -m "refactor(dissect-fe): 维度元数据走单源镜像 + 字面量 6 派生

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 15: FE — MATERIAL tab + MaterialView + filter chips

**Files:**
- Create: `agent-ui/src/components/dissect/MaterialView.tsx`
- Modify: `agent-ui/src/components/dissect/DissectPage.tsx`(ResultBrowser body 接 MATERIAL tab)

- [ ] **Step 1: 建 MaterialView 组件**

Create `agent-ui/src/components/dissect/MaterialView.tsx`:

```tsx
'use client'

import { useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import type { BenchmarkEntry } from '@/types/benchmark'
import {
  DIM_BY_KEY,
  MATERIAL_KINDS,
  MATERIAL_PURPOSES
} from '@/lib/benchmark-dimensions'
import { cn } from '@/lib/utils'

const ACCENT = DIM_BY_KEY.MATERIAL.color

const parseSections = (content: string): { header: string; body: string }[] => {
  if (!content) return []
  const parts = content.split(/【([^】]+)】/)
  if (parts.length < 3) return []
  const out: { header: string; body: string }[] = []
  for (let i = 1; i < parts.length; i += 2) {
    out.push({ header: parts[i], body: (parts[i + 1] ?? '').trim() })
  }
  return out
}

export const MaterialView = ({
  entries
}: {
  entries: BenchmarkEntry[]
}) => {
  const [kindF, setKindF] = useState<string | null>(null)
  const [purposeF, setPurposeF] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const filtered = useMemo(
    () =>
      entries
        .filter((e) => (kindF ? e.kind === kindF : true))
        .filter((e) => (purposeF ? e.purposes.includes(purposeF) : true)),
    [entries, kindF, purposeF]
  )

  const selected =
    filtered.find((e) => e.id === selectedId) ??
    entries.find((e) => e.id === selectedId) ??
    filtered[0]

  return (
    <div className="flex h-full gap-4">
      {/* 左:列表 + filter chips */}
      <div className="flex w-60 shrink-0 flex-col gap-2 overflow-hidden rounded-lg bg-bg-darkest p-2">
        <div className="flex flex-col gap-1">
          <span className="px-1 text-[10px] font-semibold text-text-label">
            种类
          </span>
          <div className="flex flex-wrap gap-1">
            <Chip active={!kindF} onClick={() => setKindF(null)} label="全部" />
            {MATERIAL_KINDS.map((k) => (
              <Chip
                key={k}
                active={kindF === k}
                onClick={() => setKindF((p) => (p === k ? null : k))}
                label={k}
              />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="px-1 text-[10px] font-semibold text-text-label">
            用途
          </span>
          <div className="flex flex-wrap gap-1">
            <Chip
              active={!purposeF}
              onClick={() => setPurposeF(null)}
              label="全部"
            />
            {MATERIAL_PURPOSES.map((p) => (
              <Chip
                key={p}
                active={purposeF === p}
                onClick={() => setPurposeF((q) => (q === p ? null : p))}
                label={p}
              />
            ))}
          </div>
        </div>
        <div className="mt-1 flex items-center justify-between px-1">
          <span className="text-xs font-semibold text-text-secondary">素材</span>
          <span className="text-[10px] text-text-label">
            {filtered.length} 个
          </span>
        </div>
        <div className="flex flex-col gap-0.5 overflow-y-auto">
          {filtered.map((e) => {
            const active = selected?.id === e.id
            return (
              <button
                key={e.id}
                onClick={() => setSelectedId(e.id)}
                className={cn(
                  'flex flex-col gap-0.5 rounded-md px-2.5 py-2 text-left',
                  active ? '' : 'hover:bg-overlay-5'
                )}
                style={active ? { backgroundColor: 'rgba(99,102,241,0.15)' } : undefined}
              >
                <span
                  className={cn(
                    'text-xs font-semibold',
                    active ? 'text-text-bright' : 'text-text-secondary'
                  )}
                >
                  {e.title}
                </span>
                <div className="flex flex-wrap gap-1">
                  <Tag>{e.kind}</Tag>
                  {e.purposes.slice(0, 2).map((p) => (
                    <Tag key={p}>{p}</Tag>
                  ))}
                </div>
              </button>
            )
          })}
          {filtered.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-text-label">无匹配</p>
          )}
        </div>
      </div>
      {/* 右:详情 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {selected ? (
          <article className="flex flex-col gap-5 py-1">
            <header className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-text-primary">
                {selected.title}
              </h3>
              {selected.kind && (
                <span
                  className="rounded-pill px-2 py-0.5 text-[10px] font-semibold"
                  style={{ backgroundColor: ACCENT + '26', color: ACCENT }}
                >
                  {selected.kind}
                </span>
              )}
              {selected.purposes.map((p) => (
                <span
                  key={p}
                  className="rounded-pill bg-overlay-10 px-2 py-0.5 text-[10px] text-text-secondary"
                >
                  {p}
                </span>
              ))}
            </header>
            {parseSections(selected.content).length === 0 ? (
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-text-body">
                {selected.content}
              </p>
            ) : (
              parseSections(selected.content).map((s, i) => (
                <section key={i} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3.5 w-[3px] rounded-full"
                      style={{ backgroundColor: ACCENT }}
                    />
                    <h4 className="text-sm font-semibold text-text-secondary">
                      【{s.header}】
                    </h4>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-text-body">
                    {s.body}
                  </p>
                </section>
              ))
            )}
          </article>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-text-tertiary">暂无素材卡</p>
          </div>
        )}
      </div>
    </div>
  )
}

const Chip = ({
  active,
  onClick,
  label
}: {
  active: boolean
  onClick: () => void
  label: string
}) => (
  <button
    onClick={onClick}
    className={cn(
      'rounded-pill px-2 py-0.5 text-[10px] transition-colors',
      active
        ? 'bg-overlay-15 font-semibold text-text-primary'
        : 'bg-overlay-5 text-text-secondary hover:bg-overlay-10'
    )}
  >
    {active && <Check className="mr-0.5 inline size-2.5" />}
    {label}
  </button>
)

const Tag = ({ children }: { children: React.ReactNode }) => (
  <span className="rounded-pill bg-overlay-10 px-1.5 py-px text-[9px] text-text-secondary">
    {children}
  </span>
)
```

- [ ] **Step 2: DissectPage 接 MATERIAL tab**

`DissectPage.tsx`:
- import 加 `MaterialView`:
  ```ts
  import { MaterialView } from './MaterialView'
  ```
- ResultBrowser body 区(880-931),在 `{tab === 'STYLE' && (...)}` 后、`{tab === 'REVIEW' && (...)}` 前加:
  ```tsx
          {tab === 'MATERIAL' && <MaterialView entries={grouped.MATERIAL} />}
  ```

- [ ] **Step 3: validate**

Run: `pnpm --dir agent-ui validate`
Expected: lint + format + typecheck 全过。

- [ ] **Step 4: 提交**

```bash
git add agent-ui/src/components/dissect/MaterialView.tsx agent-ui/src/components/dissect/DissectPage.tsx
git commit -m "feat(dissect-fe): MATERIAL tab + MaterialView + kind/purpose filter

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 16: FE — 卡片 inline 重命名

**Files:**
- Create: `agent-ui/src/components/dissect/RenameableTitle.tsx`
- Modify: `agent-ui/src/components/dissect/DissectPage.tsx`(EntryDetail / ReadingView 头接入重命名)

- [ ] **Step 1: 建 RenameableTitle 组件**

Create `agent-ui/src/components/dissect/RenameableTitle.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { Pencil, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 可重命名标题:展示态 hover 显铅笔 → 点开 inline input → 回车/失焦提交、Esc 取消。
 * 提交调 onRename(newTitle);失败由调用方 toast + 不更新本地(回滚)。
 */
export const RenameableTitle = ({
  title,
  onRename,
  className
}: {
  title: string
  onRename: (next: string) => Promise<void>
  className?: string
}) => {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      setDraft(title)
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing, title])

  const commit = async () => {
    const t = draft.trim()
    if (!t || t === title) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await onRename(t)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <span className="flex items-center gap-1">
        <input
          ref={inputRef}
          value={draft}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setEditing(false)
          }}
          onBlur={commit}
          maxLength={120}
          className={cn(
            'rounded-md border border-overlay-20 bg-overlay-5 px-2 py-0.5 text-sm font-semibold text-text-primary outline-none focus:border-accent-indigoLight',
            className
          )}
        />
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={commit}
          disabled={saving}
          className="text-text-label hover:text-text-primary"
        >
          <Check className="size-3.5" />
        </button>
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setEditing(false)}
          className="text-text-label hover:text-text-primary"
        >
          <X className="size-3.5" />
        </button>
      </span>
    )
  }

  return (
    <span className="group inline-flex items-center gap-1">
      <span className={className}>{title}</span>
      <button
        onClick={() => setEditing(true)}
        className="opacity-0 transition-opacity group-hover:opacity-100"
        title="重命名"
      >
        <Pencil className="size-3 text-text-label hover:text-text-primary" />
      </button>
    </span>
  )
}
```

- [ ] **Step 2: ResultBrowser 加 rename handler + 透传**

`DissectPage.tsx` 的 `ResultBrowser` 组件:
- import 加 `renameBenchmarkEntry`:`import { ..., renameBenchmarkEntry } from '@/api/benchmark'`(已有 `getBenchmark` 等同文件 import 块)。
- 顶部已有 `endpoint`/`token`(DissectPage 层)。`ResultBrowser` 需要它们 + 重命名后刷新。给 `ResultBrowser` 加 props `onRenamed?: () => void`(可选),或直接在 ResultBrowser 内取 store。最简:ResultBrowser 已是子组件,从 useStore 取 endpoint/token,并在重命名后乐观更新 `book`。
- 给 `ResultBrowser` 签名加 `onRename` 内部函数:

在 `ResultBrowser` 内(`const review = ...` 附近)加:
```ts
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const handleRename = async (entryId: string, next: string) => {
    if (!endpoint || !token || !book) return
    try {
      await renameBenchmarkEntry(endpoint, token, book.id, entryId, next)
      // 乐观更新:就地改 entry.title(getBenchmark 兜底由调用方刷新,这里直接改 book.entries)
      const idx = book.entries?.findIndex((e) => e.id === entryId) ?? -1
      if (idx >= 0 && book.entries) {
        book.entries[idx] = { ...book.entries[idx], title: next }
      }
      toast.success('已重命名')
    } catch (err) {
      toast.error('重命名失败:' + (err as Error).message)
      throw err
    }
  }
```
(`toast` 已 import;`useStore` 已 import。)

- [ ] **Step 3: EntryDetail 标题接入重命名**

`EntryDetail`(1270)签名加 `entryId` 已在 `entry` 里。把 header 的 `<h3>{title}</h3>`(1285)替换为:
```tsx
        <RenameableTitle
          title={title}
          onRename={(next) => handleRename(entry.id, next)}
          className="text-lg font-semibold text-text-primary"
        />
```
并给 `EntryDetail` props 加 `onRename: (entryId: string, next: string) => Promise<void>`,把 `handleRename` 透传(从 ListView → EntryDetail)。`ListView` 也加 `onRename` prop 透传。

> 调用链:ResultBrowser 把 `handleRename` 传给 `ListView`(`onRename={handleRename}`)→ ListView 传给 `EntryDetail`。

- [ ] **Step 4: ReadingView 头接入重命名**

`ReadingView`(1070)签名加 `onRename`,把头 `<h3>{entry.title}</h3>`(1087)替换为:
```tsx
          <RenameableTitle
            title={entry.title}
            onRename={(next) => onRename(entry.id, next)}
            className="text-sm font-medium text-text-secondary"
          />
```
ResultBrowser 调 `ReadingView` 处(913-927)各加 `onRename={handleRename}`。

- [ ] **Step 5: validate**

Run: `pnpm --dir agent-ui validate`
Expected: lint + format + typecheck 全过。修复 import(`Pencil` 等已在新文件;DissectPage 若新增用到则确保 import)。

- [ ] **Step 6: 手验**

启动 `pnpm --dir agent-ui dev`,打开 `/dissect`,任一已完成书 → 浏览结果 → 各 tab 卡片标题 hover 显铅笔 → 改名 → 刷新仍在。

- [ ] **Step 7: 提交**

```bash
git add agent-ui/src/components/dissect/RenameableTitle.tsx agent-ui/src/components/dissect/DissectPage.tsx
git commit -m "feat(dissect-fe): 卡片 inline 重命名(铅笔/双击)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 17: 全量校验 + 手验拆解

- [ ] **Step 1: server 全量测试 + typecheck + lint**

Run:
```bash
pnpm --dir server typecheck && pnpm --dir server test && pnpm --dir server lint
```
Expected: typecheck 无错;全量 jest PASS(含新增 dimensions / dissect-prompts / get-benchmark.tool / benchmark.service 用例);lint 无新错。

- [ ] **Step 2: FE 全量校验**

Run: `pnpm --dir agent-ui validate`
Expected: lint + format + typecheck 全过。

- [ ] **Step 3: 手验完整拆解(需真实模型 + 一本对标书)**

启动 `pnpm dev`(root,server:3001 + agent-ui:3000):
1. `/dissect` 上传一本短篇 → 开始拆解。
2. 看活动日志出现 `material-extractor` 阶段。
3. 拆完 → 浏览结果 → 新「素材」tab 有 MATERIAL 卡,kind/purposes 正确,filter chips 生效。
4. 各 tab 卡片能改名并持久。
5. 总评 tab 显「7 个维度」。
6. (写作侧)任一小说工作台让 agent 写开篇 → 日志可见它调 `get_benchmark(type=MATERIAL, purpose=开篇钩子)`(取决于模型是否采纳,非硬性)。

- [ ] **Step 4: 终态提交(若有手验小修)**

```bash
git add -A
git commit -m "chore(dissect): 素材维度+重命名 收尾

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## 自检(对照 spec)

- **§1 数据模型** → Task 1(MATERIAL + kind + purposes + 迁移)。
- **§2 维度单源** → Task 2(server dimensions.ts)、Task 14(FE 镜像);5 工具 z.enum 改派生 → Task 4/5/6;FE 元数据/TAB/groupByType/allDims/字面量 6 派生 → Task 14。
- **§3 拆解提取** → Task 7(prompt + DISSECT_PROMPTS)、Task 8(DISSECT_TREE 节点)、writeEntry options+kind/purposes → Task 3、write_benchmark tool → Task 4。
- **§4 critic + context** → Task 9(dissect-main/critic/context-assembler 6→7 + 素材阶段)。
- **§5 写作检索** → Task 6(get_benchmark kind/purpose 过滤)、Task 10(3 写作 prompt 素材指引)。
- **§6 卡片重命名** → Task 11(service)、Task 12(PATCH 路由)、Task 13(FE client/route/type)、Task 16(inline 编辑)。
- **§7 FE 浏览器** → Task 14(派生 + MATERIAL)、Task 15(MaterialView + filter chips)。
- **测试** → Task 2/3/6/7/11 单测;Task 17 全量 + 手验。prompt 锁测试 → Task 7。
- **非目标** 守住:无工作台 FE 面板、不重命名书标题、不改 kind/purposes、无向量检索 —— 计划均未含。

**类型一致性自检:** `writeEntry` options 形态(`{type,title,content,order?,chapterNo?,kind?,purposes?}`)在 Task 3 定义、Task 4 消费;`updateEntryTitle(userId,bookId,entryId,title)` Task 11 定义、Task 12 消费;`BenchmarkEntryEntryRename` 路由 Task 13 定义、Task 16 消费;`BENCHMARK_DIMENSIONS`/`DIM_BY_KEY` FE Task 14 定义、Task 15/16 消费;`filterBenchmarkEntries` Task 6 定义+导出+测试。命名一致。

**占位符扫描:** 无 TBD/TODO;每个 code step 给了完整代码;命令给了 expected。
