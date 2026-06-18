# narratox 分段章节编辑工具 Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal (Phase 1):** Replace the Writer's single big-arg `write_chapter` tool with `append_section` + `get_chapter` so the model writes a chapter **section-by-section** (small tool args), fixing the z.ai ~60s `terminated` cutoff, and wire it into the swarm + a live-refreshing FE. (Phase 2 — `replace_section`/`insert_section` — is a separate later plan.)

**Architecture:** New `ChapterService.appendSection/getChapter` methods + two new tools (`makeAppendSectionTool`, `makeGetChapterTool`). The Writer agent drops `write_chapter` and gets `append_section` + `get_chapter`. `streamTurn` fires the existing `WritingChapter` signal on each `append_section` tool_call and settles at turn-end over the set of edited orders. FE adds a per-signal refresh (a seq counter) so the manuscript updates live as sections land. `Chapter.content` stays a string; the mutation-layer `ChapterHandler` is left in place (unused by the writer now).

**Tech Stack:** NestJS 11 + Prisma 7 + LangChain tools (zod). FE: Next.js 15 + Zustand. Server gate: `cd server && pnpm typecheck && pnpm lint && pnpm test && pnpm build`. FE gate: `cd agent-ui && pnpm validate && pnpm build`.

**Spec:** [docs/superpowers/specs/2026-06-19-granular-chapter-tools-design.md](../specs/2026-06-19-granular-chapter-tools-design.md)

**Branch:** `feat/granular-chapter-tools` (off `feat/analyst-settlement`).

---

## File Structure

- Modify: `server/src/novel/chapter.service.ts` — add `appendSection`, `getChapter`.
- Test: `server/src/novel/chapter.service.spec.ts` — cover the two new methods.
- Create: `server/src/agentos/tools/append-section.tool.ts` — `makeAppendSectionTool`.
- Create: `server/src/agentos/tools/get-chapter.tool.ts` — `makeGetChapterTool`.
- Test: `server/src/agentos/tools/append-section.tool.spec.ts`, `get-chapter.tool.spec.ts`.
- Modify: `server/src/agentos/agent-prompts.ts` — rewrite `WRITER_AGENT_PROMPT` for section-by-section writing.
- Modify: `server/src/agentos/workspace-swarm.service.ts` — Writer tools (swap write_chapter → append_section + get_chapter); streamTurn (detect append_section → WritingChapter signal + edited-orders set + turn-end settle; remove write_chapter detection).
- Delete: `server/src/agentos/tools/write-chapter.tool.ts` (+ its spec if one exists — grep first).
- Modify: `agent-ui/src/store.ts` — add `chapterWriteSeq` counter + setter (bumped per WritingChapter).
- Modify: `agent-ui/src/hooks/useAIStreamHandler.tsx` — bump `chapterWriteSeq` in the WritingChapter branch.
- Modify: `agent-ui/src/app/novels/[id]/page.tsx` — refresh novel on `chapterWriteSeq` change (live section updates).

---

## Notes for the implementer

- **The 60s fix is the whole point.** Do NOT reintroduce any tool that takes a whole-chapter `content` arg. `append_section.content` is ONE section (~300-800 chars). The Writer prompt must forbid whole-chapter generation. (Spike `server/scripts/spike-stream-timeout.ts` proved small-arg tool calls are 14-23s, reliable.)
- **`as never` boundary cast** on every tool passed to `createReactAgent` (dual-package .d.ts friction) — mirror existing tools.
- **userId/novelId closure-injected** in both new tools (never from LLM input) — same security posture as existing tools.
- **`ChapterHandler` / `ResourceRegistry` stay** — just no longer used by the writer. Don't rip them out.
- **`novels.activate`** (CONCEPT→ACTIVE) is called by `append_section` on first content, same as the old `write_chapter`.
- Commit after every task. Server gate: `cd server && pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

---

# Task 1: ChapterService.appendSection + getChapter

**Files:** Modify `server/src/novel/chapter.service.ts`; test `server/src/novel/chapter.service.spec.ts`.

- [ ] **Step 1: Write the failing tests**

Add to `server/src/novel/chapter.service.spec.ts` (inside the existing `describe('ChapterService', ...)`). First check the file's existing mock shape (`makePrismaMock`) and reuse it; if `chapter.aggregate` isn't on the mock, the existing tests don't need it. Add `update` to the mock's `chapter` if missing (appendSection/update use `prisma.chapter.update`). Add these tests:

```ts
  describe('appendSection', () => {
    it('appends content to an existing chapter and marks COMMITTED', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' }); // assertOwned
      prisma.chapter.findFirst.mockResolvedValue({ id: 'c1', order: 1, content: '开头' });
      prisma.chapter.update.mockResolvedValue({ id: 'c1', content: '开头新段' });
      const svc = new ChapterService(prisma as unknown as PrismaService);
      await svc.appendSection('u1', 'n1', 1, '新段');
      expect(prisma.chapter.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { content: '开头新段', status: 'COMMITTED' },
      });
    });

    it('creates the chapter (via findOrCreateByOrder) if the order is absent, then appends', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.chapter.findFirst.mockResolvedValueOnce(null); // absent
      prisma.chapter.create.mockResolvedValue({ id: 'c9', order: 9, content: '' });
      prisma.chapter.update.mockResolvedValue({ id: 'c9', content: '首段' });
      const svc = new ChapterService(prisma as unknown as PrismaService);
      await svc.appendSection('u1', 'n1', 9, '首段');
      expect(prisma.chapter.create).toHaveBeenCalledWith({ data: { novelId: 'n1', order: 9, title: '第9章' } });
      expect(prisma.chapter.update).toHaveBeenCalledWith({ where: { id: 'c9' }, data: { content: '首段', status: 'COMMITTED' } });
    });
  });

  describe('getChapter', () => {
    it('returns order/title/content or null', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.chapter.findFirst.mockResolvedValue({ order: 1, title: '第1章', content: 'abc' });
      const svc = new ChapterService(prisma as unknown as PrismaService);
      const got = await svc.getChapter('u1', 'n1', 1);
      expect(prisma.chapter.findFirst).toHaveBeenCalledWith({ where: { novelId: 'n1', order: 1 }, select: { order: true, title: true, content: true } });
      expect(got).toEqual({ order: 1, title: '第1章', content: 'abc' });
    });
  });
```

(If `makePrismaMock` lacks `chapter.update`, add `update: jest.fn()` to it. Confirm by reading the file first.)

- [ ] **Step 2: Run — FAIL**

`cd server && pnpm test -- chapter.service.spec.ts` → FAIL (methods missing).

- [ ] **Step 3: Implement**

In `server/src/novel/chapter.service.ts`, add these two methods to `ChapterService` (e.g. after `update`):

```ts
  /**
   * 追加一小节正文到第 order 章(不存在则自动建)。Section 粒度写入:Writer 用
   * append_section 一节节拼正文,避免整章大工具参数(会触发 z.ai 60s 掐流)。
   */
  async appendSection(userId: string, novelId: string, order: number, content: string) {
    // findOrCreateByOrder 已含 assertOwned;不存在则种 `第N章`。
    const chapter = await this.findOrCreateByOrder(userId, novelId, order);
    const newContent = (chapter.content ?? '') + content;
    return this.prisma.chapter.update({
      where: { id: chapter.id },
      data: { content: newContent, status: 'COMMITTED' },
    });
  }

  /** 只读:取第 order 章的 order/title/content(供 Writer 改前先看现状)。null=无此章。 */
  async getChapter(userId: string, novelId: string, order: number) {
    await this.assertOwned(userId, novelId);
    return this.prisma.chapter.findFirst({
      where: { novelId, order },
      select: { order: true, title: true, content: true },
    });
  }
```

- [ ] **Step 4: Run — PASS**

`cd server && pnpm test -- chapter.service.spec.ts` → PASS (existing + new). Then `pnpm typecheck`.

- [ ] **Step 5: Commit**
```sh
git add server/src/novel/chapter.service.ts server/src/novel/chapter.service.spec.ts
git commit -m "feat(novel): ChapterService.appendSection + getChapter (section-level edits)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 2: append_section + get_chapter tools

**Files:** Create `server/src/agentos/tools/append-section.tool.ts`, `get-chapter.tool.ts` + specs.

- [ ] **Step 1: Write failing tests**

Create `server/src/agentos/tools/append-section.tool.spec.ts`:

```ts
import { makeAppendSectionTool } from './append-section.tool';
import type { ChapterService } from '../../novel/chapter.service';
import type { NovelService } from '../../novel/novel.service';

const invoke = (t: unknown) => (t as { invoke: (a: unknown) => Promise<unknown> }).invoke.bind(t);

describe('append_section tool', () => {
  it('appends, activates novel, returns ok + sizes', async () => {
    const chapters = {
      appendSection: jest.fn().mockResolvedValue({ id: 'c1', content: '开头新段' }),
      findByOrder: jest.fn().mockResolvedValue({ content: '开头新段' }),
    } as unknown as ChapterService;
    const novels = { activate: jest.fn().mockResolvedValue(undefined) } as unknown as NovelService;
    const tool = makeAppendSectionTool({ userId: 'u1', novelId: 'n1', chapters, novels });
    const out = (await invoke(tool)({ chapterOrder: 1, content: '新段' })) as { ok: boolean; chapterOrder: number; chars: number; totalChars: number };
    expect(chapters.appendSection).toHaveBeenCalledWith('u1', 'n1', 1, '新段');
    expect(novels.activate).toHaveBeenCalledWith('u1', 'n1');
    expect(out).toEqual({ ok: true, chapterOrder: 1, chars: 6, totalChars: 12 });
  });
});
```

Create `server/src/agentos/tools/get-chapter.tool.spec.ts`:

```ts
import { makeGetChapterTool } from './get-chapter.tool';
import type { ChapterService } from '../../novel/chapter.service';

const invoke = (t: unknown) => (t as { invoke: (a: unknown) => Promise<unknown> }).invoke.bind(t);

describe('get_chapter tool', () => {
  it('returns ok + content when found', async () => {
    const chapters = {
      getChapter: jest.fn().mockResolvedValue({ order: 1, title: '第1章', content: '正文' }),
    } as unknown as ChapterService;
    const out = (await invoke(makeGetChapterTool({ userId: 'u1', novelId: 'n1', chapters }))({ chapterOrder: 1 })) as { ok: boolean; content: string };
    expect(chapters.getChapter).toHaveBeenCalledWith('u1', 'n1', 1);
    expect(out.ok).toBe(true);
    expect(out.content).toBe('正文');
  });

  it('returns ok:false when absent', async () => {
    const chapters = { getChapter: jest.fn().mockResolvedValue(null) } as unknown as ChapterService;
    const out = (await invoke(makeGetChapterTool({ userId: 'u1', novelId: 'n1', chapters }))({ chapterOrder: 9 })) as { ok: boolean; reason: string };
    expect(out).toEqual({ ok: false, reason: 'not_found' });
  });
});
```

- [ ] **Step 2: Run — FAIL**

`cd server && pnpm test -- append-section.tool.spec.ts get-chapter.tool.spec.ts` → FAIL (modules missing).

- [ ] **Step 3: Implement**

Create `server/src/agentos/tools/append-section.tool.ts`:

```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ChapterService } from '../../novel/chapter.service';
import type { NovelService } from '../../novel/novel.service';

/**
 * Writer 的「追加一节」工具。content 是一小节(~300-800 字),不是整章 —— 避免
 * 大工具参数触发 z.ai 60s 掐流(spike 证实)。userId/novelId 闭包注入。
 * 首次落内容时 novels.activate(CONCEPT→ACTIVE),与原 write_chapter 一致。
 */
export function makeAppendSectionTool({
  userId,
  novelId,
  chapters,
  novels,
}: {
  userId: string;
  novelId: string;
  chapters: ChapterService;
  novels: NovelService;
}) {
  return tool(
    async ({ chapterOrder, content }) => {
      await chapters.appendSection(userId, novelId, chapterOrder, content);
      await novels.activate(userId, novelId); // 幂等:CONCEPT→ACTIVE
      const ch = await chapters.findByOrder(userId, novelId, chapterOrder);
      return {
        ok: true,
        chapterOrder,
        chars: content.length,
        totalChars: (ch?.content ?? '').length,
      };
    },
    {
      name: 'append_section',
      description:
        '向第 chapterOrder 章末尾追加【一小节】正文(约300-800字)。一章通过多次 append_section 拼成。不要一次写整章。章节不存在会自动创建。',
      schema: z.object({
        chapterOrder: z.number().int().describe('章节序号(1-based)'),
        content: z.string().describe('这一小节的正文(约300-800字,不要整章)'),
      }),
    },
  );
}
```

Create `server/src/agentos/tools/get-chapter.tool.ts`:

```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ChapterService } from '../../novel/chapter.service';

/**
 * Writer 的只读「读当前章节正文」工具。改/续写前先 get_chapter 看现状。
 * 返回是输入(ToolMessage 进上下文),不触发 60s(60s 只看模型输出)。
 */
export function makeGetChapterTool({
  userId,
  novelId,
  chapters,
}: {
  userId: string;
  novelId: string;
  chapters: ChapterService;
}) {
  return tool(
    async ({ chapterOrder }) => {
      const ch = await chapters.getChapter(userId, novelId, chapterOrder);
      if (!ch) return { ok: false, reason: 'not_found' as const };
      return {
        ok: true as const,
        chapterOrder: ch.order,
        title: ch.title,
        content: ch.content ?? '',
        chars: (ch.content ?? '').length,
      };
    },
    {
      name: 'get_chapter',
      description:
        '读取第 chapterOrder 章的当前正文(改/续写前先调用看现状)。返回 content 全文。',
      schema: z.object({
        chapterOrder: z.number().int().describe('章节序号(1-based)'),
      }),
    },
  );
}
```

- [ ] **Step 4: Run — PASS**

`cd server && pnpm test -- append-section.tool.spec.ts get-chapter.tool.spec.ts` → PASS. `pnpm typecheck && pnpm lint`.

- [ ] **Step 5: Commit**
```sh
git add server/src/agentos/tools/append-section.tool.ts server/src/agentos/tools/append-section.tool.spec.ts server/src/agentos/tools/get-chapter.tool.ts server/src/agentos/tools/get-chapter.tool.spec.ts
git commit -m "feat(agentos): append_section + get_chapter tools (small-arg section writing)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 3: Wire into the Writer; rewrite prompt; rewrite streamTurn; remove write_chapter

**Files:** Modify `server/src/agentos/workspace-swarm.service.ts`, `server/src/agentos/agent-prompts.ts`; delete `server/src/agentos/tools/write-chapter.tool.ts`.

- [ ] **Step 1: Rewrite WRITER_AGENT_PROMPT**

In `server/src/agentos/agent-prompts.ts`, replace `WRITER_AGENT_PROMPT` with:

```ts
/** 写作 Agent:工作台里一节节写/续写章节。小参数工具,避免整章大参数触发 60s。 */
export const WRITER_AGENT_PROMPT = `你是一位小说写作手,在工作台里和作者一起写一本小说的章节。

【核心规则 — 必须遵守】
- 不要一次写整章,也不要把整章正文塞进任何一个工具。
- 用 append_section 一节节地写:每次只追加【一小节】(约300-800字),多次 append_section 拼成完整一章。
- 续写/改之前,先 get_chapter 看当前正文现状,再决定接着写什么。
- 写涉及已有角色/伏笔时,先用 query_memory 核实。
- 用 list_chapters 了解有哪些章节(序号/状态)。

【工作方式】
- 作者要写第 N 章:先 list_chapters / get_chapter(N) 了解,然后多次 append_section(N, 一小节),直到本章写完。
- 每写完一两节,可以停下来简短告诉作者进度、问是否继续,再写下一节。
- append_section 的 content 永远只是一小节,绝不返回整章。
- 遵循小说设定与已有内容,保持人物、世界观一致;不要编造冲突设定。`;
```

(Leave `CREATION_AGENT_PROMPT`/`MAIN_AGENT_ROUTE_SUFFIX`/etc. untouched if present — only `WRITER_AGENT_PROMPT` changes.)

- [ ] **Step 2: Swap the Writer's tools + rewrite streamTurn**

In `server/src/agentos/workspace-swarm.service.ts`:

**Imports** — remove `makeWriteChapterTool`, add the two new tool factories:
```ts
import { makeAppendSectionTool } from './tools/append-section.tool';
import { makeGetChapterTool } from './tools/get-chapter.tool';
```
(delete the `import { makeWriteChapterTool } from './tools/write-chapter.tool';` line).

**Writer tools array** (inside `getSwarm`, the `writer = createReactAgent({ ... tools: [ ... ] })`) — replace the `makeWriteChapterTool({...}) as never,` entry with:
```ts
        makeAppendSectionTool({
          userId,
          novelId,
          chapters: this.chapters,
          novels: this.novels,
        }) as never,
        makeGetChapterTool({
          userId,
          novelId,
          chapters: this.chapters,
        }) as never,
```
(Keep `makeListChaptersTool`, `makeQueryMemoryTool`, and the `transfer_to_main` handoff.)

**streamTurn** — replace the `write_chapter` detection block AND the settle block. The new logic: on `append_section` AIMessage tool_call → yield `writing-chapter`; collect edited orders from `append_section` ToolMessage ok results into a `Set`; at turn end, settle each. Replace the body from `let settledChapterOrder...` through the end of the settle block with:

```ts
    const editedOrders = new Set<number>();

    for await (const chunk of stream) {
      const msg = (Array.isArray(chunk) ? chunk[0] : chunk) as {
        tool_calls?: Array<{ name: string; args?: { chapterOrder?: number } }>;
        name?: string;
        content?: string;
        _getType?: () => string;
      };

      // append_section 决定写一节 → 通知前端(骨架 + 刷新)。
      if (msg?.tool_calls) {
        for (const tc of msg.tool_calls) {
          if (tc.name === 'append_section' && typeof tc.args?.chapterOrder === 'number') {
            yield { type: 'writing-chapter', order: tc.args.chapterOrder };
          }
        }
      }

      // append_section 返回 ok → 记下本章本轮被编辑(供轮末结算)。
      if (msg?.name === 'append_section' && typeof msg.content === 'string') {
        try {
          const parsed = JSON.parse(msg.content) as { ok?: boolean; chapterOrder?: number };
          if (parsed.ok === true && typeof parsed.chapterOrder === 'number') {
            editedOrders.add(parsed.chapterOrder);
            log?.info({ phase: 'append_section.detected', chapterOrder: parsed.chapterOrder }, 'agent');
          }
        } catch {
          /* 非 JSON,忽略 */
        }
      }

      // 工具结果(ToolMessage)不是聊天正文 —— 跳过,不泄漏工具 JSON。
      if (typeof msg?._getType === 'function' && msg._getType() === 'tool') {
        continue;
      }
      const delta = extractDelta(chunk);
      if (delta) yield delta;
    }

    // 轮末:对本轮每个被编辑的章异步结算(per-novel 锁去重)。
    if (editedOrders.size > 0 && this.analyst) {
      for (const order of editedOrders) {
        log?.info({ phase: 'settle.dispatch', chapterOrder: order }, 'agent');
        void this.analyst
          .settle({ userId, novelId, chapterOrder: order })
          .catch((e) => {
            log?.error(
              { phase: 'settle.dispatch_failed', chapterOrder: order, err: e instanceof Error ? e : new Error(String(e)) },
              'agent',
            );
          });
      }
    }
```

(The `streamTurn.start`/`streamTurn.end` log lines + the `const startedAt`/`log` setup stay. The return type stays `AsyncGenerator<string | { type: 'writing-chapter'; order: number }>`.)

- [ ] **Step 3: Delete write_chapter tool**

First grep for any remaining references:
```sh
cd server && grep -rn "write_chapter\|makeWriteChapterTool\|WriteChapter" src
```
Expected remaining references: ONLY the spec you're about to delete (and maybe a comment). If a `write-chapter.tool.spec.ts` exists, delete it too. Delete:
```sh
git rm server/src/agentos/tools/write-chapter.tool.ts
# if it exists:
git rm -f server/src/agentos/tools/write-chapter.tool.spec.ts 2>/dev/null || true
```
Fix any remaining references the grep found (e.g., a stale comment in `chapter.service.ts` doc-comments mentioning `write_chapter` is fine to leave, but an actual code import must go).

- [ ] **Step 4: typecheck + lint + test + build**

`cd server && pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Clean + green (the write_chapter tool tests are gone; everything else green). If `pnpm lint` flags anything, fix.

- [ ] **Step 5: Commit**
```sh
git add -A
git commit -m "feat(agentos): Writer writes section-by-section (append_section) — fix 60s

Swap write_chapter (big-arg) for append_section + get_chapter in the writer;
rewrite WRITER_AGENT_PROMPT for section-by-section writing; streamTurn fires
WritingChapter per append_section and settles edited orders at turn end.
Removes write_chapter (the >60s big-arg tool).

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 4: FE — live per-signal chapter refresh

**Files:** Modify `agent-ui/src/store.ts`, `agent-ui/src/hooks/useAIStreamHandler.tsx`, `agent-ui/src/app/novels/[id]/page.tsx`.

- [ ] **Step 1: Add a `chapterWriteSeq` counter to the store**

In `agent-ui/src/store.ts`, add to the `Store` interface (near `writingChapterOrder`):
```ts
  chapterWriteSeq: number
  bumpChapterWriteSeq: () => void
```
In the `create` initializer (near `writingChapterOrder: null`):
```ts
      chapterWriteSeq: 0,
      bumpChapterWriteSeq: () => set((s) => ({ chapterWriteSeq: s.chapterWriteSeq + 1 })),
```
In `logout()`/`login()` reset objects, add `chapterWriteSeq: 0` (alongside `writingChapterOrder: null`).

- [ ] **Step 2: Bump the seq on each WritingChapter signal**

In `agent-ui/src/hooks/useAIStreamHandler.tsx`, in the `WritingChapter` branch (the `else if (chunk.event === ('WritingChapter' as RunEvent))` block), after `setWritingChapterOrder(order)`, also bump the seq:
```ts
              const order = (chunk as { order?: number }).order
              if (typeof order === 'number') {
                useStore.getState().setWritingChapterOrder(order)
                useStore.getState().bumpChapterWriteSeq()
              }
```
(`useStore.getState()` is already used elsewhere in this file — safe.)

- [ ] **Step 3: Refresh the novel on seq change (live section updates)**

In `agent-ui/src/app/novels/[id]/page.tsx`, the `Workspace` component already has `writingChapterOrder` from the store and a `refresh` callback. Subscribe to `chapterWriteSeq` and refresh on change:
```ts
  const chapterWriteSeq = useStore((s) => s.chapterWriteSeq)
  useEffect(() => {
    // 每次 append_section 落库信号 → 刷新 novel,ChapterPreview 实时显示不断增长的正文
    if (chapterWriteSeq > 0) refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterWriteSeq])
```
(Place near the other effects. `refresh` is the existing `getNovel` callback. If the repo's lint flags the eslint-disable as unused, remove it — match the linter.)

- [ ] **Step 4: validate + build**

`cd agent-ui && pnpm validate && pnpm build` — clean. (If lint flags the disable, remove it; if prettier reformats, `pnpm format:fix` then re-validate.)

- [ ] **Step 5: Commit**
```sh
git add agent-ui/src/store.ts agent-ui/src/hooks/useAIStreamHandler.tsx agent-ui/src/app/novels/[id]/page.tsx
git commit -m "feat(agent-ui): live chapter refresh per append_section signal (chapterWriteSeq)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 5: Full-stack smoke + verify the 60s is gone

**Files:** none (verification).

- [ ] **Step 1: Server full gate**

`cd server && pnpm typecheck && pnpm lint && pnpm test && pnpm build` — clean + green + built.

- [ ] **Step 2: FE gate**

`cd agent-ui && pnpm typecheck && pnpm validate && pnpm build` — clean.

- [ ] **Step 3: Boot + curl the run endpoint (no browser needed)**

```sh
(cd server && pnpm build) ; (cd server && PORT=3019 node dist/src/main.js &) ; sleep 9
JWT=$(grep -o 'Bearer eyJ[A-Za-z0-9._-]*' server/logs/app*.log | head -1 | sed 's/Bearer //')
# 用第 1 章(已存在)发"续写一段"——append_section 路径,每节小参数,应 <60s 不挂
curl -s -X POST http://localhost:3019/agents/deep-agent/runs \
  -H "Authorization: Bearer $JWT" \
  -F 'message=给第1章续写一小节(约500字),用 append_section' \
  -F 'session_id=3baf846f-5740-4710-b6d3-38eb2e1349fe' \
  -F 'stream=true' --max-time 120 2>&1 | head -40
echo "=== agent.log: this turn ==="
jq -c 'select(.sessionId=="3baf846f-5740-4710-b6d3-38eb2e1349fe")' server/logs/agent*.log | tail -8
echo "=== errors? ==="
tail -3 server/logs/error*.log
pkill -f "dist/src/main.js"
```
Expected: the stream completes (RunCompleted) within ~60-120s with NO `terminated`; `agent.log` shows `append_section.detected` + `settle.dispatch`; `error.log` has no new `terminated`. (If `terminated` still appears, check the agent.log stack — but with small-arg append_section it should not recur.)

- [ ] **Step 4: Tag the Analyst feature (the 60s was the last blocker for v0.5.0 E2E)**

If the smoke passes (no terminated, append works, settle dispatches):
```sh
git tag v0.5.1-granular-tools-phase1
```
(Phase 1 is shippable on its own: writing/continuing works without the 60s cutoff; rewrite-via-replace comes in Phase 2.)

---

## Self-Review

**Spec coverage:**
- §3.1 append_section → Task 1 (service) + Task 2 (tool) + Task 3 (wired into writer + streamTurn signal). ✓
- §3.4 get_chapter → Task 1 + Task 2 + Task 3 (writer tool). ✓
- §4 ChapterService edit semantics (append; findOrCreate on absent; COMMITTED status) → Task 1. ✓
- §4 CONCEPT→ACTIVE via append_section → Task 2 (`novels.activate`). ✓
- §5 Writer prompt (section-by-section, forbid whole-chapter) → Task 3 Step 1. ✓
- §6 streamTurn signal reuse (WritingChapter per append) + FE live refresh → Task 3 Step 2 + Task 4. ✓
- §7 settle at turn end over edited-orders set → Task 3 Step 2. ✓
- §8 Phase 1 scope (append + get; replace/insert deferred to Phase 2) → this plan covers append+get only. ✓
- Remove write_chapter (the 60s big-arg tool) → Task 3 Step 3. ✓

**Placeholder scan:** Task 3 Step 3 greps for write_chapter refs and says "fix any remaining" — that's bounded (delete + fix imports), not a TODO. All code blocks complete. No TBD. ✓

**Type consistency:** `appendSection(userId, novelId, order, content)` / `getChapter(userId, novelId, order)` (Task 1) == tool calls (Task 2) == swarm wiring (Task 3). Tool return shapes (`{ok, chapterOrder, chars, totalChars}` / `{ok, chapterOrder, title, content, chars}`) match the streamTurn JSON.parse (`{ok, chapterOrder}`) + the spec. `chapterWriteSeq: number` + `bumpChapterWriteSeq` consistent across store/handler/page. ✓

**No gaps found.** Phase 1 plan ready.
