# Manuscript Pane Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the workspace right pane from a hardcoded `chapters[0]` view into a multi-chapter manuscript module with real-time follow + manual lock, plus a server-side `get_reading_chapter` tool so the agent knows which chapter the user is reading.

**Architecture:** One shared client state `currentChapterOrder` drives both the pane (display) and the agent (sent in the run body → closure-injected into a read-only tool). The agent's `append_section` already emits `writingChapterOrder`; a new effect follows it unless the user has manually navigated (`manualLock`).

**Tech Stack:** Next.js 15 (App Router) + React 18 + Zustand (`agent-ui`); NestJS 11 + LangChain `tool()` + Prisma (`server`). Server tests: Jest. agent-ui has **no test runner** — its gate is `pnpm validate` (lint + format + typecheck); FE tasks verify via typecheck and a final manual smoke.

**Spec:** [docs/superpowers/specs/2026-06-20-manuscript-pane-redesign-design.md](../specs/2026-06-20-manuscript-pane-redesign-design.md)

---

## File Structure

**Server (new + modified):**
- Create `server/src/agentos/reading-chapter.ts` — pure `parseReadingChapterOrder(raw): number | null` (testable seam for the multipart-string body field).
- Create `server/src/agentos/reading-chapter.spec.ts` — unit test for the parser.
- Create `server/src/agentos/tools/get-reading-chapter.tool.ts` — new read-only agent tool (closure-injected snapshot).
- Create `server/src/agentos/tools/get-reading-chapter.tool.spec.ts` — unit test for the tool.
- Modify `server/src/agentos/agentos.controller.ts` — read + parse `readingChapterOrder` from body; thread into `runTurn`.
- Modify `server/src/agentos/deep-agent.service.ts` — add `readingChapterOrder` to `runTurn` args; register the tool on the main agent.
- Modify `server/src/agentos/agent-prompts.ts` — `MAIN_AGENT_PROMPT` clause about `get_reading_chapter`.

**agent-ui (modified):**
- Modify `agent-ui/src/store.ts` — add `currentChapterOrder`, `manualLock` (+ setters); reset both in `login`/`logout`.
- Modify `agent-ui/src/app/novels/[id]/page.tsx` — seed/follow/reset `currentChapterOrder`; follow effect; pass `novel` to `ChatPanel`; drop `selectedChapterId`.
- Modify `agent-ui/src/hooks/useAIStreamHandler.tsx` — reset `manualLock` on new message; append `readingChapterOrder` to the run `FormData`; fix stale comments.
- Modify `agent-ui/src/components/workspace/ResourcePanel.tsx` — rewrite `ChaptersView` (prev/next + TOC dropdown + writing pill + correct skeleton); add `ChapterToc` + `WritingPill`.
- Modify `agent-ui/src/components/workspace/ChatPanel.tsx` — reading-focus status line; drop `selectedChapterId`; receive `novel` prop.
- Delete `agent-ui/src/components/workspace/ChapterDetail.tsx` — orphaned dead code.

---

## Task 1: Server — `parseReadingChapterOrder` helper (TDD)

A pure, tested seam so the multipart-string → number parsing is verifiable without standing up the streaming controller.

**Files:**
- Create: `server/src/agentos/reading-chapter.ts`
- Create: `server/src/agentos/reading-chapter.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `server/src/agentos/reading-chapter.spec.ts`:

```ts
import { parseReadingChapterOrder } from './reading-chapter';

describe('parseReadingChapterOrder', () => {
  it('parses a numeric string', () => {
    expect(parseReadingChapterOrder('3')).toBe(3);
  });

  it('returns null for empty string', () => {
    expect(parseReadingChapterOrder('')).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(parseReadingChapterOrder(undefined)).toBeNull();
  });

  it('returns null for NaN', () => {
    expect(parseReadingChapterOrder('abc')).toBeNull();
  });

  it('returns null for non-positive integers', () => {
    expect(parseReadingChapterOrder('0')).toBeNull();
    expect(parseReadingChapterOrder('-1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm test -- reading-chapter.spec.ts`
Expected: FAIL — `parseReadingChapterOrder is not defined` / module not found.

- [ ] **Step 3: Write minimal implementation**

Create `server/src/agentos/reading-chapter.ts`:

```ts
/**
 * Parse the `readingChapterOrder` multipart field (always a string from
 * NoFilesInterceptor) into a 1-based chapter order, or null.
 *
 * Null means "the user has no chapter open" (CONCEPT novel / empty pane). The
 * value is a snapshot taken at run start — it is closure-injected into the
 * agent tool, never read from LLM input.
 */
export function parseReadingChapterOrder(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && pnpm test -- reading-chapter.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/agentos/reading-chapter.ts server/src/agentos/reading-chapter.spec.ts
git commit -m "feat(agentos): parseReadingChapterOrder helper for run-body chapter field"
```

---

## Task 2: Server — `get_reading_chapter` tool (TDD)

New read-only tool. Mirrors `makeGetChapterTool` but takes no args (value is closure-injected) and returns only `{order, title, status}`.

**Files:**
- Create: `server/src/agentos/tools/get-reading-chapter.tool.ts`
- Create: `server/src/agentos/tools/get-reading-chapter.tool.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `server/src/agentos/tools/get-reading-chapter.tool.spec.ts`:

```ts
import { makeGetReadingChapterTool } from './get-reading-chapter.tool';
import type { ChapterService } from '../../novel/chapter.service';

describe('get_reading_chapter tool', () => {
  it('returns ok + order/title/status when the user has a chapter open', async () => {
    const findByOrder = jest
      .fn()
      .mockResolvedValue({ order: 3, title: '雨夜', status: 'COMMITTED' });
    const chapters = { findByOrder } as unknown as ChapterService;

    const t = makeGetReadingChapterTool({
      userId: 'u1',
      novelId: 'n1',
      readingChapterOrder: 3,
      chapters,
    });
    const out = (await t.invoke({})) as {
      ok: boolean;
      order: number;
      title: string;
      status: string;
    };

    expect(findByOrder).toHaveBeenCalledWith('u1', 'n1', 3);
    expect(out).toEqual({ ok: true, order: 3, title: '雨夜', status: 'COMMITTED' });
  });

  it('returns no_active_chapter when readingChapterOrder is null', async () => {
    const findByOrder = jest.fn();
    const chapters = { findByOrder } as unknown as ChapterService;

    const t = makeGetReadingChapterTool({
      userId: 'u1',
      novelId: 'n1',
      readingChapterOrder: null,
      chapters,
    });
    const out = (await t.invoke({})) as { ok: boolean; reason: string };

    expect(findByOrder).not.toHaveBeenCalled();
    expect(out).toEqual({ ok: false, reason: 'no_active_chapter' });
  });

  it('returns no_such_chapter when the chapter was deleted', async () => {
    const findByOrder = jest.fn().mockResolvedValue(null);
    const chapters = { findByOrder } as unknown as ChapterService;

    const t = makeGetReadingChapterTool({
      userId: 'u1',
      novelId: 'n1',
      readingChapterOrder: 9,
      chapters,
    });
    const out = (await t.invoke({})) as { ok: boolean; reason: string; order: number };

    expect(findByOrder).toHaveBeenCalledWith('u1', 'n1', 9);
    expect(out).toEqual({ ok: false, reason: 'no_such_chapter', order: 9 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm test -- get-reading-chapter.tool.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `server/src/agentos/tools/get-reading-chapter.tool.ts`:

```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ChapterService } from '../../novel/chapter.service';

/**
 * Main agent 的只读「用户正在读哪一章」工具。readingChapterOrder 是 run 开始时
 * 的快照(客户端 currentChapterOrder 经 run body 传入),闭包注入 —— 不从 LLM 输入取,
 * 与 userId/novelId 同等安全。用于解析「这章/这章开头」等指代。
 */
export function makeGetReadingChapterTool({
  userId,
  novelId,
  readingChapterOrder,
  chapters,
}: {
  userId: string;
  novelId: string;
  readingChapterOrder: number | null;
  chapters: ChapterService;
}) {
  return tool(
    async () => {
      if (readingChapterOrder == null) {
        return { ok: false as const, reason: 'no_active_chapter' as const };
      }
      const ch = await chapters.findByOrder(userId, novelId, readingChapterOrder);
      if (!ch) {
        return {
          ok: false as const,
          reason: 'no_such_chapter' as const,
          order: readingChapterOrder,
        };
      }
      return {
        ok: true as const,
        order: ch.order,
        title: ch.title,
        status: ch.status,
      };
    },
    {
      name: 'get_reading_chapter',
      description:
        '返回用户当前正在阅读的章节(本条消息发送时的快照:{order,title,status})。' +
        '当用户说「这章 / 这章开头 / 这里」等指代时,先调用本工具确认 chapterOrder,' +
        '再把该值传给 writer 委派;不要凭猜测假定章节号。无正在阅读的章节时返回 no_active_chapter。',
      schema: z.object({}), // 无参数 —— 值由闭包注入,绝不来自 LLM
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && pnpm test -- get-reading-chapter.tool.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/agentos/tools/get-reading-chapter.tool.ts server/src/agentos/tools/get-reading-chapter.tool.spec.ts
git commit -m "feat(agentos): get_reading_chapter tool (user reading-focus snapshot)"
```

---

## Task 3: Server — wire `readingChapterOrder` through controller → runTurn → main agent + prompt

**Files:**
- Modify: `server/src/agentos/agentos.controller.ts`
- Modify: `server/src/agentos/deep-agent.service.ts`
- Modify: `server/src/agentos/agent-prompts.ts`

- [ ] **Step 1: Controller — parse the body field and thread to runTurn**

In `server/src/agentos/agentos.controller.ts`:

1. Add the import at the top (with the other `./` imports, after line 23):

```ts
import { parseReadingChapterOrder } from './reading-chapter';
```

2. Extend the `body` type (currently lines 113–118) to include the new field:

```ts
    @Body()
    body: {
      message?: string;
      session_id?: string;
      stream?: string;
      readingChapterOrder?: string;
    },
```

3. Parse it right after `const message = body?.message ?? '';` (after line 122), before the `try`:

```ts
    const readingChapterOrder = parseReadingChapterOrder(body?.readingChapterOrder);
```

4. Thread it into `runTurn` — replace the existing `await this.deepAgent.runTurn({...})` call (lines 170–178) with:

```ts
        await this.deepAgent.runTurn({
          userId: user.id,
          novelId,
          threadId: sessionId,
          userMessage: message,
          systemPrompt: prompt,
          emit,
          signal: ac.signal,
          readingChapterOrder,
        });
```

- [ ] **Step 2: DeepAgentService — accept the arg and register the tool on the main agent**

In `server/src/agentos/deep-agent.service.ts`:

1. Add the import with the other tool imports (after line 23, the `makeGetChapterTool` line):

```ts
import { makeGetReadingChapterTool } from './tools/get-reading-chapter.tool';
```

2. Extend the `runTurn` args type (lines 75–83) — add `readingChapterOrder`:

```ts
  async runTurn(args: {
    userId: string;
    novelId: string;
    threadId: string;
    userMessage: string;
    systemPrompt: string;
    emit: (ev: ActivityEvent) => void;
    signal?: AbortSignal;
    readingChapterOrder: number | null;
  }): Promise<void> {
    const {
      userId,
      novelId,
      threadId,
      userMessage,
      systemPrompt,
      emit,
      signal,
      readingChapterOrder,
    } = args;
```

3. Register the tool on the main agent — replace the main agent `tools:` array (lines 129–132) with:

```ts
      tools: [
        makeGetNovelInfoTool({ userId, novelId, novels: this.novels }) as never,
        makeUpdateNovelTool({ userId, novelId, novels: this.novels }) as never,
        makeGetReadingChapterTool({
          userId,
          novelId,
          readingChapterOrder,
          chapters: this.chapters,
        }) as never,
      ],
```

- [ ] **Step 3: Prompt — tell the main agent about the tool**

In `server/src/agentos/agent-prompts.ts`, append a clause to `MAIN_AGENT_PROMPT`. Replace the closing of the `【规则】` block (the last three lines of the template, lines 54–57) with:

```ts
【规则】
- 正文不要写在聊天里——通过子 agent 写入章节。
- 每一步都通过 task 委派,不要自己直接写正文。
- 你是编排者:所有正文的写/改都通过 task 委派 writer 子 agent 完成,不要自己产出或存储正文。

【用户正在读的章节】
- get_reading_chapter 返回用户当前正在阅读的章节(本条消息发送时的快照)。
- 当用户用「这章 / 这章开头 / 这里 / 当前章」等指代时,先 get_reading_chapter 确认 chapterOrder,
  再把该值传给 writer 委派;不要凭猜测假定章节号。`;
```

- [ ] **Step 4: Typecheck + build + run the full server test suite**

Run:
```bash
cd server && pnpm typecheck && pnpm test && pnpm build
```
Expected: typecheck clean; all jest tests pass (including the two new spec files from Tasks 1–2); `nest build` succeeds.

- [ ] **Step 5: Commit**

```bash
git add server/src/agentos/agentos.controller.ts server/src/agentos/deep-agent.service.ts server/src/agentos/agent-prompts.ts
git commit -m "feat(agentos): wire readingChapterOrder through runTurn to get_reading_chapter tool"
```

---

## Task 4: agent-ui store — add `currentChapterOrder` + `manualLock`

Additive only — no removals yet (those come in the cleanup task). Both are session-scoped (not persisted — they're absent from `partialize`).

**Files:**
- Modify: `agent-ui/src/store.ts`

- [ ] **Step 1: Add the interface fields + setters**

In `agent-ui/src/store.ts`, add to the `Store` interface (after the `chapterWriteSeq` / `bumpChapterWriteSeq` lines, 52–53):

```ts
  currentChapterOrder: number | null
  setCurrentChapterOrder: (order: number | null) => void
  manualLock: boolean
  setManualLock: (lock: boolean) => void
```

- [ ] **Step 2: Add the initial values + setters in the store body**

In the `create` body, after `bumpChapterWriteSeq` (lines 128–130), add:

```ts
      currentChapterOrder: null,
      setCurrentChapterOrder: (order) => set(() => ({ currentChapterOrder: order })),
      manualLock: false,
      setManualLock: (lock) => set(() => ({ manualLock: lock })),
```

- [ ] **Step 3: Reset both in `logout` and `login`**

In the `logout` set object (lines 89–98) add the two fields alongside `writingChapterOrder: null, chapterWriteSeq: 0`:

```ts
          writingChapterOrder: null,
          chapterWriteSeq: 0,
          currentChapterOrder: null,
          manualLock: false
```

Do the same in the `login` set object (lines 102–111):

```ts
          writingChapterOrder: null,
          chapterWriteSeq: 0,
          currentChapterOrder: null,
          manualLock: false
```

(Leave `partialize` untouched — these must NOT persist, matching `writingChapterOrder`/`chapterWriteSeq`.)

- [ ] **Step 4: Typecheck**

Run: `cd agent-ui && pnpm typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add agent-ui/src/store.ts
git commit -m "feat(agent-ui): currentChapterOrder + manualLock store fields"
```

---

## Task 5: agent-ui streaming handler — reset lock on send + send readingChapterOrder

**Files:**
- Modify: `agent-ui/src/hooks/useAIStreamHandler.tsx`

- [ ] **Step 1: Reset `manualLock` when the user sends a new message**

In `handleStreamResponse`, inside the `try` block, right after the `formData.append('mode', modeParam ?? 'workspace')` line (line 177), add:

```ts
        // 新一轮用户消息 → 交还跟随控制权(覆盖上一轮的手动锁定)
        useStore.getState().setManualLock(false)
```

- [ ] **Step 2: Append `readingChapterOrder` to the run FormData**

Immediately after the `setManualLock(false)` line added above, add:

```ts
        // 当前阅读章节快照 → 服务端 get_reading_chapter 工具(闭包注入)
        const readingOrder = useStore.getState().currentChapterOrder
        formData.append('readingChapterOrder', readingOrder == null ? '' : String(readingOrder))
```

- [ ] **Step 3: Fix the stale comments**

Replace the comment at line 417:

```ts
                  // append_section → 通知 ChapterPreview 刷新(取代旧 WritingChapter 帧)
```

with:

```ts
                  // append_section → 置 writingChapterOrder(驱动跟随效应)+ 刷新正文
```

Replace the comment at line 526:

```ts
        // 清掉写作中标记:流结束(无论成功与否)都把 ChapterPreview 还原成正文态
```

with:

```ts
        // 清掉写作中标记:流结束(无论成功与否)都把正文面板还原成正文态
```

- [ ] **Step 4: Typecheck + lint**

Run: `cd agent-ui && pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add agent-ui/src/hooks/useAIStreamHandler.tsx
git commit -m "feat(agent-ui): send readingChapterOrder + clear manualLock on new message"
```

---

## Task 6: agent-ui workspace page — seed / follow / reset `currentChapterOrder`

Owns the follow effect (always mounted, drives focus regardless of which panel is open).

**Files:**
- Modify: `agent-ui/src/app/novels/[id]/page.tsx`

- [ ] **Step 1: Subscribe to the new store fields**

At the top of the `Workspace` component, after the `chapterWriteSeq` selector (line 36), add:

```ts
  const currentChapterOrder = useStore((s) => s.currentChapterOrder)
  const setCurrentChapterOrder = useStore((s) => s.setCurrentChapterOrder)
  const setManualLock = useStore((s) => s.setManualLock)
```

- [ ] **Step 2: Reset focus on novel switch**

Add an effect (anywhere among the existing effects, e.g. after the `refresh` effect at lines 86–88):

```ts
  // 切换小说 → 重置面板焦点(旧小说的 order 不适用新小说)
  useEffect(() => {
    setCurrentChapterOrder(null)
    setManualLock(false)
  }, [params.id, setCurrentChapterOrder, setManualLock])
```

- [ ] **Step 3: Seed `currentChapterOrder` to the latest chapter on first load**

Add an effect right after the reset effect:

```ts
  // 首次载入(或切小说后)→ 默认显示最新章;CONCEPT/无章时保持 null
  useEffect(() => {
    if (currentChapterOrder != null) return
    if (!novel || novel.chapters.length === 0) return
    const maxOrder = novel.chapters.reduce((m, c) => Math.max(m, c.order), 0)
    if (maxOrder > 0) setCurrentChapterOrder(maxOrder)
  }, [novel, currentChapterOrder, setCurrentChapterOrder])
```

- [ ] **Step 4: Add the follow effect**

Add an effect (the core of real-time follow):

```ts
  // 跟随效应:agent 写第 K 章 → 若用户未手动锁定,面板跳到 K
  useEffect(() => {
    if (writingChapterOrder == null) return
    if (useStore.getState().manualLock) return
    setCurrentChapterOrder(writingChapterOrder)
  }, [writingChapterOrder, setCurrentChapterOrder])
```

- [ ] **Step 5: Drop `selectedChapterId` and pass `novel` to ChatPanel**

Replace the `<ChatPanel ... />` JSX (lines 115–119) with:

```tsx
      <ChatPanel sessionId={novel.sessionId} novel={novel} onAccepted={refresh} />
```

- [ ] **Step 6: Fix the stale comment at line 90**

Replace:

```ts
  // 每次 append_section 落库信号 → 刷新 novel,ChapterPreview 实时显示不断增长的正文
```

with:

```ts
  // 每次 append_section 落库信号 → 刷新 novel,正文面板实时显示不断增长的当前章正文
```

- [ ] **Step 7: Typecheck**

Run: `cd agent-ui && pnpm typecheck`
Expected: FAIL — `ChatPanel` still declares `selectedChapterId` and doesn't accept `novel` (fixed in Task 8). That's expected; continue to Task 8. (If you prefer green typecheck at every commit, defer this commit until after Task 8 — but the instructions below commit now and the next task resolves it.)

- [ ] **Step 8: Commit**

```bash
git add agent-ui/src/app/novels/[id]/page.tsx
git commit -m "feat(agent-ui): seed/follow/reset currentChapterOrder in workspace"
```

> Note: typecheck will only go green once Task 8 updates `ChatPanel`'s props. The two tasks are intentionally paired; do not run `pnpm validate` between them.

---

## Task 7: agent-ui ResourcePanel — rewrite `ChaptersView` (prev/next + TOC + pill + skeleton)

**Files:**
- Modify: `agent-ui/src/components/workspace/ResourcePanel.tsx`

- [ ] **Step 1: Replace `ChaptersView` and add `ChapterToc` + `WritingPill`**

Replace the entire `ChaptersView` component (lines 66–106) with the block below. (Leave `ResourcePanel` header, `InfoView`, and the `TITLES` map as-is. `ResourcePanel` already selects `writingChapterOrder` and passes it to `ChaptersView` — keep that.)

```tsx
const ChaptersView = ({
  novel,
  writingChapterOrder
}: {
  novel: Novel
  writingChapterOrder: number | null
}) => {
  const currentChapterOrder = useStore((s) => s.currentChapterOrder)
  const setCurrentChapterOrder = useStore((s) => s.setCurrentChapterOrder)
  const manualLock = useStore((s) => s.manualLock)
  const setManualLock = useStore((s) => s.setManualLock)
  const [tocOpen, setTocOpen] = useState(false)

  const sorted = [...novel.chapters].sort((a, b) => a.order - b.order)
  const idx = sorted.findIndex((c) => c.order === currentChapterOrder)
  const chapter = idx >= 0 ? sorted[idx] : undefined
  const prevOrder = idx > 0 ? sorted[idx - 1].order : null
  const nextOrder = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1].order : null

  const goTo = (order: number) => {
    setCurrentChapterOrder(order)
    setManualLock(true)
    setTocOpen(false)
  }

  // CONCEPT / 无章
  if (currentChapterOrder == null || !chapter) {
    return (
      <p className="text-sm text-muted">
        {novel.status === 'CONCEPT'
          ? '立项中,信息收集完成后开始写作。'
          : '本章还没有内容。'}
      </p>
    )
  }

  const isWritingThis =
    writingChapterOrder !== null && writingChapterOrder === currentChapterOrder
  const showSkeleton = isWritingThis && !chapter.content
  const showPill =
    manualLock &&
    writingChapterOrder !== null &&
    writingChapterOrder !== currentChapterOrder

  return (
    <div className="space-y-3">
      {/* 翻页头 + 目录触发 */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          disabled={prevOrder == null}
          onClick={() => prevOrder != null && goTo(prevOrder)}
          className="px-2 text-muted hover:text-primary disabled:opacity-30"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={() => setTocOpen((v) => !v)}
          className="flex-1 text-center text-sm font-medium text-primary hover:text-brand"
        >
          第 {chapter.order} 章 · {chapter.title || '无标题'}
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={nextOrder == null}
            onClick={() => nextOrder != null && goTo(nextOrder)}
            className="px-2 text-muted hover:text-primary disabled:opacity-30"
          >
            ›
          </button>
          <button
            type="button"
            onClick={() => setTocOpen((v) => !v)}
            className="px-1 text-muted hover:text-primary"
            title="目录"
          >
            ☰
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="rounded bg-accent px-1.5 py-0.5">
          {chapter.status === 'COMMITTED' ? '已写入' : '草稿'}
        </span>
        <span>{chapter.content.length} 字</span>
      </div>

      {tocOpen && (
        <ChapterToc
          sorted={sorted}
          currentOrder={currentChapterOrder}
          writingOrder={writingChapterOrder}
          onPick={goTo}
        />
      )}
      {showPill && (
        <WritingPill
          order={writingChapterOrder as number}
          onJump={() => {
            setCurrentChapterOrder(writingChapterOrder as number)
            setManualLock(false)
          }}
        />
      )}

      {showSkeleton ? (
        <div className="space-y-2">
          <p className="text-xs text-muted">
            第 {currentChapterOrder} 章 · AI 写作中…
          </p>
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-4 animate-pulse rounded bg-accent"
              style={{ width: `${70 + ((i * 7) % 30)}%` }}
            />
          ))}
        </div>
      ) : chapter.content ? (
        <article className="prose prose-invert max-w-none text-sm">
          <MarkdownRenderer>{chapter.content}</MarkdownRenderer>
        </article>
      ) : (
        <p className="text-sm text-muted">本章还没有内容。</p>
      )}
    </div>
  )
}

const ChapterToc = ({
  sorted,
  currentOrder,
  writingOrder,
  onPick
}: {
  sorted: Array<{ order: number; title: string; status: string; content: string }>
  currentOrder: number
  writingOrder: number | null
  onPick: (order: number) => void
}) => (
  <div className="max-h-64 overflow-y-auto rounded border border-primary/10 bg-background">
    {sorted.map((c) => {
      const isCurrent = c.order === currentOrder
      const isWriting = writingOrder === c.order
      return (
        <button
          key={c.order}
          type="button"
          onClick={() => onPick(c.order)}
          className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent ${
            isCurrent ? 'text-primary' : 'text-muted'
          } ${isWriting ? 'text-brand' : ''}`}
        >
          <span>
            第 {c.order} 章 · {c.title || '无标题'}
          </span>
          <span className="text-xs">
            {isWriting ? '写作中' : isCurrent ? '在读' : ''}
          </span>
        </button>
      )
    })}
  </div>
)

const WritingPill = ({
  order,
  onJump
}: {
  order: number
  onJump: () => void
}) => (
  <button
    type="button"
    onClick={onJump}
    className="flex w-full items-center justify-between rounded border border-brand/40 bg-brand/10 px-3 py-2 text-sm text-brand hover:bg-brand/20"
  >
    <span>✍ AI 正写第 {order} 章</span>
    <span>跳转 ›</span>
  </button>
)
```

- [ ] **Step 2: Add the `useState` import**

The top of `ResourcePanel.tsx` currently has `'use client'` then imports. Ensure React `useState` is imported — replace line 1–2 region so the imports begin with:

```tsx
'use client'

import { useState } from 'react'
import { useStore } from '@/store'
```

(Keep the existing `Novel`, `MarkdownRenderer` imports.)

- [ ] **Step 3: Typecheck + lint**

Run: `cd agent-ui && pnpm typecheck && pnpm lint`
Expected: clean (this file is self-contained; the only remaining red is `ChatPanel` props from Task 6, resolved in Task 8).

- [ ] **Step 4: Commit**

```bash
git add agent-ui/src/components/workspace/ResourcePanel.tsx
git commit -m "feat(agent-ui): multi-chapter ChaptersView (prev/next + TOC + follow pill + skeleton)"
```

---

## Task 8: agent-ui ChatPanel — reading-focus status line, drop `selectedChapterId`, accept `novel`

**Files:**
- Modify: `agent-ui/src/components/workspace/ChatPanel.tsx`

- [ ] **Step 1: Change the props**

Replace the `Props` interface (lines 12–16) and the component signature (line 24):

```tsx
interface Props {
  sessionId: string
  novel: Novel
  onAccepted: () => void
}
```

and

```tsx
const ChatPanel = ({ sessionId, novel, onAccepted }: Props) => {
```

Add the `Novel` import at the top (after line 5, the `useStore` import):

```tsx
import type { Novel } from '@/types/novel'
```

- [ ] **Step 2: Subscribe to `currentChapterOrder` and resolve the title**

Inside the component, after the existing `useStore` selectors (after line 31), add:

```tsx
  const currentChapterOrder = useStore((s) => s.currentChapterOrder)
  const readingChapter =
    currentChapterOrder == null
      ? null
      : novel.chapters.find((c) => c.order === currentChapterOrder) ?? null
```

- [ ] **Step 3: Replace the header bar**

Replace the header `<div>` (lines 94–97) with:

```tsx
      <div className="flex items-center justify-between px-5 py-2 text-xs text-muted">
        <span>💬 聊天 · 一本小说一份记忆</span>
        {readingChapter ? (
          <span>
            📍 正在读 第 {readingChapter.order} 章 · {readingChapter.title || '无标题'}（agent 可见）
          </span>
        ) : (
          <span>📍 暂未打开章节</span>
        )}
      </div>
```

- [ ] **Step 4: Fix the stale comment at line 82**

Replace:

```tsx
  // 每轮结束(写作 Agent 可能已用 write_chapter 改了稿件)→ 刷新 novel,让 ChapterDetail 更新。
```

with:

```tsx
  // 每轮结束(写作 Agent 可能已改稿件)→ 刷新 novel,让正文面板更新。
```

- [ ] **Step 5: Typecheck + lint + format**

Run: `cd agent-ui && pnpm typecheck && pnpm lint && pnpm format:fix`
Expected: clean — this resolves the `ChatPanel` prop mismatch from Task 6, so the whole FE typechecks green.

- [ ] **Step 6: Commit**

```bash
git add agent-ui/src/components/workspace/ChatPanel.tsx
git commit -m "feat(agent-ui): reading-focus status line in ChatPanel; drop selectedChapterId"
```

---

## Task 9: Cleanup — delete dead `ChapterDetail.tsx` + verify no stale refs

**Files:**
- Delete: `agent-ui/src/components/workspace/ChapterDetail.tsx`

- [ ] **Step 1: Confirm it is still orphaned (safety check)**

Run:
```bash
cd agent-ui && grep -rn "ChapterDetail\|ChapterPreview" src/ || echo "no references"
```
Expected: the only hits are inside `ChapterDetail.tsx` itself (its own `ChapterPreview` export) — no imports from elsewhere. If any import shows up, STOP and wire it in / remove that import instead of deleting.

- [ ] **Step 2: Delete the file**

```bash
cd agent-ui && git rm src/components/workspace/ChapterDetail.tsx
```

- [ ] **Step 3: Re-run the reference check**

```bash
cd agent-ui && grep -rn "ChapterDetail\|ChapterPreview\|WritingChapter" src/ || echo "clean"
```
Expected: `clean` (the stale comments were already fixed in Tasks 5/6/8).

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(agent-ui): delete orphaned ChapterDetail.tsx (dead code)"
```

---

## Task 10: Final validation + manual smoke

**Files:** none (verification only).

- [ ] **Step 1: Server gate**

Run:
```bash
cd server && pnpm typecheck && pnpm test && pnpm build
```
Expected: all green.

- [ ] **Step 2: agent-ui gate**

Run:
```bash
cd agent-ui && pnpm validate
```
Expected: lint + format + typecheck all pass.

- [ ] **Step 3: Manual smoke (run both apps)**

From repo root: `pnpm dev` (agent-ui :3000, server :3001). Log in, open/create a novel with a configured model, and verify each path:

1. **Seed** — open a multi-chapter novel; the pane shows the latest chapter, header `‹ 第 N 章 · title ›`, word count + status badge.
2. **Manual nav** — click `›` / `‹`; pane switches; click the title/☰ to open the TOC and jump to an arbitrary chapter. Header `📍 正在读 第 N 章 …（agent 可见）` updates in the chat.
3. **Follow** — send "写第 1 章" (or continue). While the agent writes via `append_section`, the pane auto-jumps to the written chapter and the prose grows section-by-section (skeleton first if the chapter was empty).
4. **Manual lock + pill** — while the agent is writing chapter K, click `‹` to read an earlier chapter. The pane stays; a `✍ AI 正写第 K 章 → 跳转 ›` pill appears. Click it → jumps to K and re-follows.
5. **Lock clears on new message** — after a locked turn, send a new message; the next write auto-follows again without clicking the pill.
6. **Agent focus tool** — manually browse to chapter 3, then send "改这章开头,把第一句改短"。In the streamed activity the main agent should call `get_reading_chapter` (visible as a tool activity) and the writer should edit chapter 3, not some other chapter. (Confirm via the activity timeline + the pane showing chapter 3's edit.)
7. **CONCEPT** — a fresh `CONCEPT` novel shows "立项中…" in the pane and `📍 暂未打开章节` in the chat; no crash.

- [ ] **Step 4: Commit any format/lint fixups (if none, skip)**

```bash
git add -A && git commit -m "chore: post-validation fixups" || echo "nothing to commit"
```

---

## Notes for the implementer

- **No FE test runner.** agent-ui correctness is gated by `pnpm validate` + the Task 10 smoke. The pure follow/lock logic is intentionally kept inside effects/components (small) rather than extracted into untested helpers.
- **Snapshot, not live.** `get_reading_chapter` returns the chapter the user had open at send time. If they switch mid-turn the agent won't see it — by design (spec §6).
- **`writingChapterOrder` producer is unchanged.** The existing `append_section` branch in `useAIStreamHandler.tsx` (which sets `writingChapterOrder` + bumps `chapterWriteSeq`) stays as-is; Task 6 only adds a *consumer* (the follow effect) and Task 5 only fixes comments there.
- **Orders assumed contiguous.** Prev/next use the sorted-array index, so gaps degrade gracefully (an absent order resolves to the empty placeholder), but creation always uses `max+1`, so gaps shouldn't occur.
