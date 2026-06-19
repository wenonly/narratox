# Writer 编辑工具(AI 编程式查找/替换/插入)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 给 writer 专家补齐编辑能力——`replace_text` / `insert_text` / `delete_text` / `set_chapter_title`,沿用 Aider/Cursor 的 SEARCH/REPLACE 思路(读原文→逐字引用→精确查找),不改数据模型。

**Architecture:** 纯后端。匹配逻辑抽成纯 util `content-match.ts`(`findContentRange` 精确→空白归一化、`countMatches`),独立 TDD;`ChapterService` 加 4 个方法复用它;4 个工具工厂镜像 `append-section.tool.ts`;writer 接线 + prompt 更新。

**Tech Stack:** NestJS 11 + `@langchain/core/tools` `tool()` + zod + Jest。Gates:server `pnpm typecheck && pnpm lint && pnpm test && pnpm build`。

**Spec:** [docs/superpowers/specs/2026-06-19-writer-edit-tools-design.md](../specs/2026-06-19-writer-edit-tools-design.md)
**Branch:** `feat/writer-edit-tools`(off `main`)。

---

## 关键约定

- **匹配**:先精确(`indexOf`);精确不到再空白归一化(把 `content` 和 `find` 的连续 `\s+` 折叠成单空格后比对,命中映射回**原文区间**,保留其余排版)。这是散文查找替换可用的关键(容忍 AI 引空格/换行偏差)。
- **返回**:`{ ok:true, ... }` 或 `{ ok:false, reason:'not_found'|'anchor_not_found'|'no_such_chapter' }`。多处匹配带 `matchCount` 提示。
- **越权**:每个工具 userId/novelId 闭包注入(不从 LLM 入参取)。
- **颗粒度小段**(同 `append_section`),不触发 z.ai 60s。
- 编辑工具**不自动建章**(章节须已存在);`append_section` 仍自动建章。

---

# Task 1: content-match 纯 util [TDD]

**Files:** Create `server/src/novel/content-match.ts`;Test `server/src/novel/content-match.spec.ts`。

- [ ] **Step 1: 写失败测试**

Create `server/src/novel/content-match.spec.ts`:
```ts
import { findContentRange, countMatches } from './content-match'

describe('findContentRange', () => {
  it('exact match returns the range', () => {
    expect(findContentRange('hello world', 'world')).toEqual({ start: 6, end: 11 })
  })

  it('normalizes whitespace differences (extra spaces / newlines)', () => {
    const content = '少年  站在\n\n山崖上' // 双空格 + 双换行
    const r = findContentRange(content, '少年 站在 山崖上') // find 用单空格
    expect(r).not.toBeNull()
    // 命中映射回【整个原文区间】(含内部多余空白)
    expect(content.slice(r!.start, r!.end)).toBe('少年  站在\n\n山崖上')
  })

  it('preserves surrounding text (only the matched span is addressed)', () => {
    const content = '前文 少年 走 后文'
    const r = findContentRange(content, '少年 走')!
    expect(content.slice(0, r.start) + 'X' + content.slice(r.end)).toBe('前文 X 后文')
  })

  it('returns null when not found', () => {
    expect(findContentRange('hello', 'xyz')).toBeNull()
  })

  it('returns the FIRST match when multiple', () => {
    expect(findContentRange('a a a', 'a')).toEqual({ start: 0, end: 1 })
  })

  it('returns null for empty find', () => {
    expect(findContentRange('hello', '')).toBeNull()
  })
})

describe('countMatches', () => {
  it('counts exact occurrences', () => {
    expect(countMatches('a a a', 'a')).toBe(3)
  })
  it('0 when not found', () => {
    expect(countMatches('hello', 'x')).toBe(0)
  })
  it('0 for empty find', () => {
    expect(countMatches('hello', '')).toBe(0)
  })
})
```

- [ ] **Step 2: 跑测试,确认失败**

```sh
cd server && pnpm test -- content-match
```
预期:FAIL(`findContentRange`/`countMatches` 未定义)。

- [ ] **Step 3: 实现 util**

Create `server/src/novel/content-match.ts`:
```ts
export interface ContentRange {
  start: number
  end: number
}

/**
 * 在 content 里定位 find 的首个命中区间 [start, end)。
 * 先精确匹配;精确不到再"空白归一化匹配"(把连续 \s+ 折叠成单空格后比对,
 * 命中映射回原文区间 —— 保留原文其余空白/排版)。找不到返回 null。
 *
 * 容忍 AI 引用原文时空格/换行的小偏差 —— 这是散文查找替换能否可用的关键。
 */
export function findContentRange(
  content: string,
  find: string,
): ContentRange | null {
  if (!find) return null
  const exact = content.indexOf(find)
  if (exact !== -1) return { start: exact, end: exact + find.length }

  const { norm, spans } = normalizeWithSpans(content)
  const normFind = find.replace(/\s+/g, ' ').trim()
  if (!normFind) return null
  const j = norm.indexOf(normFind)
  if (j === -1) return null
  return { start: spans[j].from, end: spans[j + normFind.length - 1].to }
}

/** 统计 find 在 content 里的精确命中数(与 findContentRange 的"首个"语义一致)。 */
export function countMatches(content: string, find: string): number {
  if (!find) return 0
  let count = 0
  let from = 0
  let idx = content.indexOf(find, from)
  while (idx !== -1) {
    count++
    from = idx + find.length
    idx = content.indexOf(find, from)
  }
  return count
}

/**
 * 把 content 折叠空白:每个连续 \s+ 段 → 一个空格字符。返回归一化串 +
 * spans[i] = 第 i 个归一化字符在原文里的 [from, to)(空格字符对应整个空白段)。
 */
function normalizeWithSpans(content: string): {
  norm: string
  spans: Array<{ from: number; to: number }>
} {
  const norm: string[] = []
  const spans: Array<{ from: number; to: number }> = []
  let i = 0
  while (i < content.length) {
    if (/\s/.test(content[i])) {
      let j = i
      while (j < content.length && /\s/.test(content[j])) j++
      norm.push(' ')
      spans.push({ from: i, to: j })
      i = j
    } else {
      norm.push(content[i])
      spans.push({ from: i, to: i + 1 })
      i++
    }
  }
  return { norm: norm.join(''), spans }
}
```

- [ ] **Step 4: 跑测试,确认通过**

```sh
cd server && pnpm test -- content-match
```
预期:PASS(9 个用例)。

- [ ] **Step 5: typecheck + Commit**
```sh
cd server && pnpm typecheck
git add server/src/novel/content-match.ts server/src/novel/content-match.spec.ts
git commit -m "feat(novel): content-match util — exact + whitespace-normalized find"
```

---

# Task 2: ChapterService 4 个编辑方法 [TDD]

**Files:** Modify `server/src/novel/chapter.service.ts`;Test `server/src/novel/chapter.service.spec.ts`。

- [ ] **Step 1: 先读现有 spec 的 mock 风格**

```sh
cd server && sed -n '1,60p' src/novel/chapter.service.spec.ts
```
确认 `PrismaMock`(`novel.findFirst` + `chapter.{findFirst,findMany,create,update,aggregate}`)+ `makePrismaMock()` 工厂。新测试复用它。

- [ ] **Step 2: 写失败测试**

在 `server/src/novel/chapter.service.spec.ts` 末尾(`describe('ChapterService', …)` 内)加:
```ts
  describe('replaceText', () => {
    it('replaces the first exact match and commits', async () => {
      const prisma = makePrismaMock()
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' })
      prisma.chapter.findFirst.mockResolvedValue({ id: 'c1', content: '前文 旧 后文' })
      prisma.chapter.update.mockResolvedValue({})
      const svc = new ChapterService(prisma as unknown as PrismaService)
      const r = await svc.replaceText('u1', 'n1', 1, '旧', '新')
      expect(r).toEqual({ ok: true, matchCount: 1, totalChars: 7 })
      expect(prisma.chapter.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { content: '前文 新 后文', status: 'COMMITTED' },
      })
    })

    it('normalizes whitespace when exact match misses', async () => {
      const prisma = makePrismaMock()
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' })
      prisma.chapter.findFirst.mockResolvedValue({ id: 'c1', content: '少年  走了' })
      prisma.chapter.update.mockResolvedValue({})
      const svc = new ChapterService(prisma as unknown as PrismaService)
      const r = await svc.replaceText('u1', 'n1', 1, '少年 走了', '青年 走了')
      expect(r.ok).toBe(true)
      expect(prisma.chapter.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { content: '青年 走了', status: 'COMMITTED' },
      })
    })

    it('returns not_found when find is absent', async () => {
      const prisma = makePrismaMock()
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' })
      prisma.chapter.findFirst.mockResolvedValue({ id: 'c1', content: 'abc' })
      const svc = new ChapterService(prisma as unknown as PrismaService)
      const r = await svc.replaceText('u1', 'n1', 1, 'xyz', 'q')
      expect(r).toEqual({ ok: false, reason: 'not_found', matchCount: 0 })
      expect(prisma.chapter.update).not.toHaveBeenCalled()
    })

    it('returns no_such_chapter when chapter missing', async () => {
      const prisma = makePrismaMock()
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' })
      prisma.chapter.findFirst.mockResolvedValue(null)
      const svc = new ChapterService(prisma as unknown as PrismaService)
      const r = await svc.replaceText('u1', 'n1', 9, 'x', 'y')
      expect(r).toEqual({ ok: false, reason: 'no_such_chapter' })
    })

    it('matchCount reflects multiple exact matches', async () => {
      const prisma = makePrismaMock()
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' })
      prisma.chapter.findFirst.mockResolvedValue({ id: 'c1', content: '他 他 他' })
      prisma.chapter.update.mockResolvedValue({})
      const svc = new ChapterService(prisma as unknown as PrismaService)
      const r = await svc.replaceText('u1', 'n1', 1, '他', '她')
      expect(r).toEqual({ ok: true, matchCount: 3, totalChars: 5 })
    })
  })

  describe('insertText', () => {
    it('inserts after the anchor', async () => {
      const prisma = makePrismaMock()
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' })
      prisma.chapter.findFirst.mockResolvedValue({ id: 'c1', content: 'AB' })
      prisma.chapter.update.mockResolvedValue({})
      const svc = new ChapterService(prisma as unknown as PrismaService)
      const r = await svc.insertText('u1', 'n1', 1, 'A', 'X')
      expect(r.ok).toBe(true)
      expect(prisma.chapter.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { content: 'AXB', status: 'COMMITTED' },
      })
    })

    it('after="" inserts at the beginning', async () => {
      const prisma = makePrismaMock()
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' })
      prisma.chapter.findFirst.mockResolvedValue({ id: 'c1', content: 'AB' })
      prisma.chapter.update.mockResolvedValue({})
      const svc = new ChapterService(prisma as unknown as PrismaService)
      await svc.insertText('u1', 'n1', 1, '', 'X')
      expect(prisma.chapter.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { content: 'XAB', status: 'COMMITTED' },
      })
    })

    it('returns anchor_not_found when anchor absent', async () => {
      const prisma = makePrismaMock()
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' })
      prisma.chapter.findFirst.mockResolvedValue({ id: 'c1', content: 'AB' })
      const svc = new ChapterService(prisma as unknown as PrismaService)
      const r = await svc.insertText('u1', 'n1', 1, 'Z', 'X')
      expect(r).toEqual({ ok: false, reason: 'anchor_not_found' })
    })
  })

  describe('deleteText', () => {
    it('deletes the first match', async () => {
      const prisma = makePrismaMock()
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' })
      prisma.chapter.findFirst.mockResolvedValue({ id: 'c1', content: 'A删我B' })
      prisma.chapter.update.mockResolvedValue({})
      const svc = new ChapterService(prisma as unknown as PrismaService)
      const r = await svc.deleteText('u1', 'n1', 1, '删我')
      expect(r.ok).toBe(true)
      expect(prisma.chapter.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { content: 'AB', status: 'COMMITTED' },
      })
    })
  })

  describe('setChapterTitle', () => {
    it('updates the title', async () => {
      const prisma = makePrismaMock()
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' })
      prisma.chapter.findFirst.mockResolvedValue({ id: 'c1' })
      prisma.chapter.update.mockResolvedValue({})
      const svc = new ChapterService(prisma as unknown as PrismaService)
      const r = await svc.setChapterTitle('u1', 'n1', 1, '新标题')
      expect(r).toEqual({ ok: true, title: '新标题' })
      expect(prisma.chapter.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { title: '新标题' },
      })
    })
  })
```

- [ ] **Step 3: 跑测试,确认失败**

```sh
cd server && pnpm test -- chapter.service
```
预期:FAIL(新方法未定义)。

- [ ] **Step 4: 实现 4 个方法**

在 `server/src/novel/chapter.service.ts` 顶部 import:
```ts
import { findContentRange, countMatches } from './content-match'
```
在类里(`getChapter` 之后、`assertOwned` 之前)加:
```ts
  /** 编辑用:按 order 取章节的 {id, content};不存在返回 null(调用方决定报错)。 */
  private async loadForEdit(userId: string, novelId: string, order: number) {
    await this.assertOwned(userId, novelId)
    return this.prisma.chapter.findFirst({
      where: { novelId, order },
      select: { id: true, content: true },
    })
  }

  /** 替换第 order 章 find 的首个命中为 replace。 */
  async replaceText(
    userId: string,
    novelId: string,
    order: number,
    find: string,
    replace: string,
  ): Promise<
    | { ok: true; matchCount: number; totalChars: number }
    | { ok: false; reason: 'not_found' | 'no_such_chapter'; matchCount: number }
  > {
    const ch = await this.loadForEdit(userId, novelId, order)
    if (!ch) return { ok: false, reason: 'no_such_chapter', matchCount: 0 }
    const content = ch.content ?? ''
    const range = findContentRange(content, find)
    if (!range) return { ok: false, reason: 'not_found', matchCount: 0 }
    // 精确命中才算多处;归一化命中只知 ≥1。
    const matchCount =
      content.indexOf(find) !== -1 ? countMatches(content, find) : 1
    const newContent =
      content.slice(0, range.start) + replace + content.slice(range.end)
    await this.prisma.chapter.update({
      where: { id: ch.id },
      data: { content: newContent, status: 'COMMITTED' },
    })
    return { ok: true, matchCount, totalChars: newContent.length }
  }

  /** 在第 order 章的 after 原文之后插入 content(after="" → 插在最前)。 */
  async insertText(
    userId: string,
    novelId: string,
    order: number,
    after: string,
    insertContent: string,
  ): Promise<
    | { ok: true; totalChars: number }
    | { ok: false; reason: 'anchor_not_found' | 'no_such_chapter' }
  > {
    const ch = await this.loadForEdit(userId, novelId, order)
    if (!ch) return { ok: false, reason: 'no_such_chapter' }
    const content = ch.content ?? ''
    let at = 0
    if (after !== '') {
      const range = findContentRange(content, after)
      if (!range) return { ok: false, reason: 'anchor_not_found' }
      at = range.end
    }
    const newContent =
      content.slice(0, at) + insertContent + content.slice(at)
    await this.prisma.chapter.update({
      where: { id: ch.id },
      data: { content: newContent, status: 'COMMITTED' },
    })
    return { ok: true, totalChars: newContent.length }
  }

  /** 删除第 order 章里 find 的首个命中。 */
  async deleteText(
    userId: string,
    novelId: string,
    order: number,
    find: string,
  ): Promise<
    | { ok: true; totalChars: number }
    | { ok: false; reason: 'not_found' | 'no_such_chapter' }
  > {
    const ch = await this.loadForEdit(userId, novelId, order)
    if (!ch) return { ok: false, reason: 'no_such_chapter' }
    const content = ch.content ?? ''
    const range = findContentRange(content, find)
    if (!range) return { ok: false, reason: 'not_found' }
    const newContent = content.slice(0, range.start) + content.slice(range.end)
    await this.prisma.chapter.update({
      where: { id: ch.id },
      data: { content: newContent, status: 'COMMITTED' },
    })
    return { ok: true, totalChars: newContent.length }
  }

  /** 改第 order 章标题。 */
  async setChapterTitle(
    userId: string,
    novelId: string,
    order: number,
    title: string,
  ): Promise<
    | { ok: true; title: string }
    | { ok: false; reason: 'no_such_chapter' }
  > {
    await this.assertOwned(userId, novelId)
    const ch = await this.prisma.chapter.findFirst({
      where: { novelId, order },
      select: { id: true },
    })
    if (!ch) return { ok: false, reason: 'no_such_chapter' }
    await this.prisma.chapter.update({ where: { id: ch.id }, data: { title } })
    return { ok: true, title }
  }
```

- [ ] **Step 5: 跑测试,确认通过**
```sh
cd server && pnpm test -- chapter.service
```
预期:PASS(新 + 旧用例全过)。

- [ ] **Step 6: typecheck + Commit**
```sh
cd server && pnpm typecheck
git add server/src/novel/chapter.service.ts server/src/novel/chapter.service.spec.ts
git commit -m "feat(novel): ChapterService replaceText/insertText/deleteText/setChapterTitle"
```

---

# Task 3: 4 个工具工厂

**Files:** Create `server/src/agentos/tools/replace-text.tool.ts` / `insert-text.tool.ts` / `delete-text.tool.ts` / `set-chapter-title.tool.ts`。

- [ ] **Step 1: replace-text 工具**

Create `server/src/agentos/tools/replace-text.tool.ts`:
```ts
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { ChapterService } from '../../novel/chapter.service'

/** Writer 的"查找替换"工具(SEARCH/REPLACE 式)。userId/novelId 闭包注入。 */
export function makeReplaceTextTool({
  userId,
  novelId,
  chapters,
}: {
  userId: string
  novelId: string
  chapters: ChapterService
}) {
  return tool(
    async ({ chapterOrder, find, replace }) =>
      chapters.replaceText(userId, novelId, chapterOrder, find, replace),
    {
      name: 'replace_text',
      description:
        '在第 chapterOrder 章里找到 find 原文(逐字引用,先 get_chapter 看原文),替换为 replace(改第一处)。用于修订已写正文。引用要够独特(避免多处匹配);一次改一小段。空格/换行小差异可容忍。',
      schema: z.object({
        chapterOrder: z.number().int().describe('章节序号(1-based)'),
        find: z
          .string()
          .describe('要替换的原文片段(逐字引用自 get_chapter,够独特)'),
        replace: z.string().describe('替换成的新内容(一小段)'),
      }),
    },
  )
}
```

- [ ] **Step 2: insert-text 工具**

Create `server/src/agentos/tools/insert-text.tool.ts`:
```ts
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { ChapterService } from '../../novel/chapter.service'

/** Writer 的"锚点后插入"工具。after="" 插在最前。userId/novelId 闭包注入。 */
export function makeInsertTextTool({
  userId,
  novelId,
  chapters,
}: {
  userId: string
  novelId: string
  chapters: ChapterService
}) {
  return tool(
    async ({ chapterOrder, after, content }) =>
      chapters.insertText(userId, novelId, chapterOrder, after, content),
    {
      name: 'insert_text',
      description:
        '在第 chapterOrder 章的 after 原文【之后】插入 content(after="" 表示插在最前)。先 get_chapter 看原文,逐字引用 after 作锚点。一次插一小段。',
      schema: z.object({
        chapterOrder: z.number().int().describe('章节序号(1-based)'),
        after: z
          .string()
          .describe('锚点原文(逐字引用自 get_chapter);空串表示插到本章最前'),
        content: z.string().describe('要插入的新内容(一小段)'),
      }),
    },
  )
}
```

- [ ] **Step 3: delete-text 工具**

Create `server/src/agentos/tools/delete-text.tool.ts`:
```ts
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { ChapterService } from '../../novel/chapter.service'

/** Writer 的"查找删除"工具。userId/novelId 闭包注入。 */
export function makeDeleteTextTool({
  userId,
  novelId,
  chapters,
}: {
  userId: string
  novelId: string
  chapters: ChapterService
}) {
  return tool(
    async ({ chapterOrder, find }) =>
      chapters.deleteText(userId, novelId, chapterOrder, find),
    {
      name: 'delete_text',
      description:
        '删除第 chapterOrder 章里 find 原文的第一处(逐字引用,先 get_chapter 看原文)。引用要够独特。一次删一小段。',
      schema: z.object({
        chapterOrder: z.number().int().describe('章节序号(1-based)'),
        find: z
          .string()
          .describe('要删除的原文片段(逐字引用自 get_chapter,够独特)'),
      }),
    },
  )
}
```

- [ ] **Step 4: set-chapter-title 工具**

Create `server/src/agentos/tools/set-chapter-title.tool.ts`:
```ts
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { ChapterService } from '../../novel/chapter.service'

/** Writer 的"改章节标题"工具。userId/novelId 闭包注入。 */
export function makeSetChapterTitleTool({
  userId,
  novelId,
  chapters,
}: {
  userId: string
  novelId: string
  chapters: ChapterService
}) {
  return tool(
    async ({ chapterOrder, title }) =>
      chapters.setChapterTitle(userId, novelId, chapterOrder, title),
    {
      name: 'set_chapter_title',
      description: '修改第 chapterOrder 章的标题。',
      schema: z.object({
        chapterOrder: z.number().int().describe('章节序号(1-based)'),
        title: z.string().describe('新标题'),
      }),
    },
  )
}
```

- [ ] **Step 5: typecheck**
```sh
cd server && pnpm typecheck
```
预期:通过(工具未被引用也无妨)。

- [ ] **Step 6: Commit**
```sh
git add server/src/agentos/tools/replace-text.tool.ts server/src/agentos/tools/insert-text.tool.ts server/src/agentos/tools/delete-text.tool.ts server/src/agentos/tools/set-chapter-title.tool.ts
git commit -m "feat(agentos): writer edit tools — replace_text/insert_text/delete_text/set_chapter_title"
```

---

# Task 4: writer 接线 + prompt 更新 + 全量 gate

**Files:** Modify `server/src/pipeline/writer.agent.ts`;Modify `server/src/agentos/agent-prompts.ts`。

- [ ] **Step 1: writer 接 4 个新工具**

在 `server/src/pipeline/writer.agent.ts`:
- 顶部 import(在现有 tool import 附近):
```ts
import { makeReplaceTextTool } from '../agentos/tools/replace-text.tool'
import { makeInsertTextTool } from '../agentos/tools/insert-text.tool'
import { makeDeleteTextTool } from '../agentos/tools/delete-text.tool'
import { makeSetChapterTitleTool } from '../agentos/tools/set-chapter-title.tool'
```
- 把 `const tools = [ … ]` 数组(现有 4 个工具)扩展为 8 个(在 `makeAppendSectionTool(...)` 后、`makeGetChapterTool(...)` 前或后均可;追加 4 个):
```ts
    const tools = [
      makeAppendSectionTool({
        userId,
        novelId,
        chapters: this.chapters,
        novels: this.novels,
      }) as never,
      makeReplaceTextTool({ userId, novelId, chapters: this.chapters }) as never,
      makeInsertTextTool({ userId, novelId, chapters: this.chapters }) as never,
      makeDeleteTextTool({ userId, novelId, chapters: this.chapters }) as never,
      makeSetChapterTitleTool({
        userId,
        novelId,
        chapters: this.chapters,
      }) as never,
      makeGetChapterTool({ userId, novelId, chapters: this.chapters }) as never,
      makeListChaptersTool({
        userId,
        novelId,
        chapters: this.chapters,
      }) as never,
      makeQueryMemoryTool({ userId, novelId, prisma: this.prisma }) as never,
    ]
```

- [ ] **Step 2: 更新 WRITER_AGENT_PROMPT**

在 `server/src/agentos/agent-prompts.ts` 把 `WRITER_AGENT_PROMPT` 整体替换为(在原有"用工具写正文/一节节写"基础上,加"修订已写正文"的编辑纪律):
```ts
/** 写作 Agent:工作台里写/续写/修订章节。小参数工具,避免整章大参数触发 60s。 */
export const WRITER_AGENT_PROMPT = `你是一位小说写作手,在工作台里和作者一起写一本小说的章节。

【最重要 — 正文只走工具】
- 小说正文【绝对不能】直接写在聊天回复里。所有正文都必须通过工具写入/修订章节。
- 聊天回复里只允许:工具调用,或一句简短的完成说明(如"第1章第2段已改")。

【两类工作,选对工具】
- 加新内容(往后写)→ 用 append_section,一节节(约300-800字)地加。
- 修订已写正文(润色/改词/删句/中间插一段/改标题)→ 先 get_chapter 看原文,再:
  · 替换:replace_text(chapterOrder, find, replace) —— find 逐字引用原文,替换为 replace(改第一处)。
  · 中间插入:insert_text(chapterOrder, after, content) —— 在 after 原文之后插入。
  · 删除:delete_text(chapterOrder, find) —— 删除 find 原文(第一处)。
  · 改标题:set_chapter_title(chapterOrder, title)。

【查找替换纪律 — 像代码 SEARCH/REPLACE】
- 改前【先 get_chapter】看清原文,find/after 必须【逐字】引用(空格换行小差异可容忍,但尽量精确)。
- 引用片段要【够独特】,避免一段话里多处命中(否则只改第一处,可能改错)。
- 一次只改一小段(约一段),不要把整章塞进一个 replace_text。

【其他】
- 续写/改之前先 get_chapter 看现状;涉及已有角色/伏笔先 query_memory 核实;list_chapters 看有哪些章。
- 遵循小说设定与已有内容,保持人物、世界观一致;不要编造冲突设定。`
```

- [ ] **Step 3: 全量 gate**
```sh
cd server && pnpm typecheck && pnpm lint && pnpm test && pnpm build
```
预期:全绿。

- [ ] **Step 4: Commit**
```sh
git add server/src/pipeline/writer.agent.ts server/src/agentos/agent-prompts.ts
git commit -m "feat(agentos): wire writer edit tools + teach WRITER_AGENT_PROMPT the edit discipline"
```

---

# Task 5: 冒烟 + 验证

**Files:** none(验证)。

- [ ] **Step 1: gate**
```sh
cd server && pnpm typecheck && pnpm lint && pnpm test && pnpm build
```
预期:全绿。

- [ ] **Step 2: 冒烟(聊天,人工)**

`pnpm dev`,在一本已有正文的小说里,让 AI:
1. 「把第1章里的『少年』改成『青年』」→ 确认 `replace_text` 精确命中、正文更新、ChapterPreview 刷新;
2. 故意让 AI 引一句带多余空格的原文 → 确认**归一化匹配**仍命中(不报 not_found);
3. 「在第1章开头插入一段环境描写」→ `insert_text`(after="")插最前;
4. 「删掉第1章里的某句」→ `delete_text`;
5. 「把第1章标题改成 XX」→ `set_chapter_title`;
6. 确认 writer 不踩 60s(每个工具一次一小段);多轮无 400。

---

## Self-Review

**Spec coverage:**
- §2 四个工具(replace/insert/delete/title)→ Task 2(service)+ Task 3(tools)+ Task 4(wire)。
- §3 可靠性(精确→归一化、找不到报错、多处 matchCount、小颗粒)→ Task 1(util)+ Task 2(matchCount/reason)。
- §4 ChapterService 方法 → Task 2。
- §5 工具工厂(闭包注入)→ Task 3。
- §6 接线 + prompt → Task 4。
- §7 YAGNI(replace_all/Section 结构/移动/编辑不建章)→ 不出现在任何 task;loadForEdit 不建章(findByOrder,null→no_such_chapter)✓。
- §9 验证(TDD content-match + service;冒烟)→ Task 1/2/5。✓

**Placeholder scan:** 无 TBD/TODO。每步含完整代码 + 测试代码。

**Type consistency:**
- `findContentRange(content, find): ContentRange | null` / `countMatches(content, find): number`(Task 1)↔ Task 2 import + 调用一致。
- service 方法签名(Task 2)↔ 工具工厂调用(Task 3:`chapters.replaceText(userId, novelId, chapterOrder, find, replace)` 等)一致。
- 返回 `ok:true|false` 联合类型(Task 2)↔ 工具直接透传(Task 3)一致。
- 工厂名 `makeReplaceTextTool`/`makeInsertTextTool`/`makeDeleteTextTool`/`makeSetChapterTitleTool`(Task 3)↔ writer import + tools 数组(Task 4)一致。

**Scope:** 单一后端计划,5 个任务(2 TDD + 工具 + 接线 + 冒烟),可顺序执行。
