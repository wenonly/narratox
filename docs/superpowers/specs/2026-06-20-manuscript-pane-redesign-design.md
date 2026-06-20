# Manuscript Pane Redesign — Design

**Date:** 2026-06-20
**Status:** Approved (brainstorm complete), pending implementation plan
**Scope:** `agent-ui` workspace right pane + one new server-side agent tool

## Problem

The workspace right pane (`agent-ui/src/components/workspace/ResourcePanel.tsx` → `ChaptersView`) is hard-coded to `novel.chapters[0]`. It shows exactly one chapter, never the first's successors, has no chapter switcher, no edit affordance, and shows a fake "writing" skeleton whenever *any* chapter is being written — disconnected from what's displayed. The server and writer agent fully support multi-chapter (tools keyed by `chapterOrder`, `findOrCreateByOrder`), and there is even an **orphaned** `ChapterDetail.tsx` (`ChapterPreview`) implementing a switcher + edit + PATCH + auto-jump — but it is never rendered.

The user also wants the chat agent to be *aware* of which chapter they are currently reading, so references like "改这章开头" resolve without the user restating the chapter number.

## Goals

1. **Multi-chapter browsing** in the right pane — switch to any chapter (prev/next + a table-of-contents dropdown).
2. **Real-time follow** — when the agent writes chapter K, the pane follows it (default), with a **manual lock** so a user who is browsing another chapter is not yanked away mid-turn.
3. **Agent awareness of the user's reading focus** — a new read-only tool `get_reading_chapter` returns the chapter the user is currently viewing, so the main agent can resolve deictic references ("这章") and delegate the correct `chapterOrder` to the writer.

## Non-goals (deferred)

- Live (mid-turn) sync of the reading chapter to the agent — v1 uses a **snapshot taken at run start** (see §6).
- Manual in-pane text editing + PATCH save (the dead `ChapterDetail` had it; deprioritized — not selected).
- Chat→manuscript click-to-jump linking (deprioritized — not selected).
- The other resource panes (outline / characters / worldview / status) remain "即将推出" placeholders.

## Core concept: one shared `currentChapterOrder`

The whole module orbits a single source of truth: **the order of the chapter currently displayed/read**. Everything keys off `order` (matching the agent tools and the Prisma `@@unique([novelId, order])`).

| Role | Effect on `currentChapterOrder` |
|---|---|
| **User (manual)** | prev/next, or a TOC pick → sets `currentChapterOrder` and `manualLock = true` |
| **Agent (writing)** | `append_section {chapterOrder:K}` → follow logic (below) |
| **Initial load** | novel load → latest chapter's order (`null` while `CONCEPT` / no chapters) |
| **Agent reads it** | new tool `get_reading_chapter` returns this value to the agent |

"Real-time follow" and "agent knows what you're reading" are two faces of the same state: it drives the pane on the client, and (sent in the run body) it drives the agent tool on the server.

## Follow + manual-lock rule

`manualLock: boolean` — session-scoped, **not** persisted (matches existing `writingChapterOrder`/`chapterWriteSeq`, which are also session-only under the store's `partialize`).

```
user manual navigation  → manualLock = true
agent writes chapter K  → if (!manualLock) currentChapterOrder = K   // follow
                        → else show pill "✍ AI 正写第 K 章 → 跳转"  // don't hijack
click pill              → currentChapterOrder = K; manualLock = false // re-follow
user sends new message  → manualLock = false                        // hand control back
```

**Decisions settled:**
- Lock clears on **either** pill-click **or** the user sending a new message. (User-approved.)
- Per-`append_section` refresh is kept (a section is ~300–800 chars; refresh cadence is moderate). The followed chapter's content visibly grows section by section. (User-approved.)
- `get_reading_chapter` returns a **snapshot taken at run start**, not a live value. (User-approved — mid-turn chapter switching is rare and live sync's cost is out of scope.)

## Layout (Approach A — prev/next + TOC dropdown)

Rewrite `ChaptersView` inside `ResourcePanel.tsx`. **Delete** the orphaned `ChapterDetail.tsx`. Remove the always-`null` `selectedChapterId` plumbing.

```
┌────────────────────────────────────┐
│ ‹   第 N 章 · {title}   ›      ☰   │  header: prev/next + TOC trigger + status badge
│ [写作中|已写入|草稿]   {words} 字    │
├────────────────────────────────────┤
│ ✍ AI 正写第 K 章         跳转 ›    │  pill — only when manualLock && writing elsewhere
├────────────────────────────────────┤
│ {current chapter content}           │  MarkdownRenderer; grows on each chapterWriteSeq bump
└────────────────────────────────────┘
```

- **☰ TOC** — an overlay list, one row per chapter: `第 N 章 · {title} · [status] · {words}`. Current chapter highlighted; the chapter being written highlighted in `brand` red. Clicking a row sets `currentChapterOrder` + `manualLock = true`.
- **Skeleton** — shown only when `writingChapterOrder === currentChapterOrder` **and** that chapter has no content yet. (Fixes the current bug where any write shows a skeleton regardless of the displayed chapter.) Once the first `append_section` lands and `chapterWriteSeq` refreshes the content, the growing prose replaces the skeleton.
- **Empty / CONCEPT state** — when the novel has no chapters (`CONCEPT`), show the existing "立项中" placeholder; hide prev/next/TOC; `currentChapterOrder = null`.
- **Bounds** — prev disabled at order 1, next disabled at the latest chapter.
- **Reading-focus status line** — `ChatPanel` gains a line above the input: `📍 你正在读 第 N 章 · {title}（agent 可见）`. Reads `currentChapterOrder` + `novel.chapters`. Hidden while `CONCEPT`.

## Client state (`agent-ui/src/store.ts`)

Add:

- `currentChapterOrder: number | null` (+ setter). Drives both the pane and the value sent in the run body.
- `manualLock: boolean` (+ setter).

Already present and reused (no change to their mechanics):

- `writingChapterOrder: number | null` — "agent is writing chapter K". Producer stays in `useAIStreamHandler.tsx` (the `append_section` → `setWritingChapterOrder` branch).
- `chapterWriteSeq` — live-refresh trigger (bumped per `append_section`).

Remove:

- `selectedChapterId` plumbing in `page.tsx` (`selectedChapterId={null}`) and `ChatPanel.tsx` (display string only). Replace with `currentChapterOrder`.

## Client data flow

1. **Load** — `page.tsx` `refresh()` fetches the novel; an effect seeds `currentChapterOrder` to `max(chapters.order)` once (or leaves `null` for `CONCEPT`).
2. **Manual nav** — `ManuscriptPane` prev/next or TOC click → `set({ currentChapterOrder: K, manualLock: true })`.
3. **Agent writes** — `useAIStreamHandler` `append_section` branch sets `writingChapterOrder = K`, bumps `chapterWriteSeq`. A new effect implements follow: `if (!manualLock) set({ currentChapterOrder: K })`.
4. **Live growth** — `page.tsx` already subscribes to `chapterWriteSeq` and calls `refresh()`. The refetched `novel.chapters[K].content` is longer; the pane (now showing K when following) renders the growth. (Today this refreshes `chapters[0]`; the only change is the pane reads `currentChapterOrder`, not index 0.)
5. **Turn end** — `useAIStreamHandler` `finally` already clears `writingChapterOrder = null` → pill disappears. `manualLock` persists until the next user message.
6. **New message** — `handleStreamResponse` sets `manualLock = false` before posting the run.

## Server: `get_reading_chapter` tool + run contract

The agent runs server-side; `currentChapterOrder` lives in the browser. v1 bridges this by sending the value in the run body and closure-injecting it into a tool — same security posture as `userId`/`novelId` (never trusted from LLM input).

### Run body

`useAIStreamHandler.handleStreamResponse` already builds a multipart `FormData` (`message`, `stream`, `session_id`, `mode`). Append:

```ts
formData.append('readingChapterOrder', String(currentChapterOrder ?? ''))
```

### Controller (`server/src/agentos/agentos.controller.ts`)

Extend the `body` type with `readingChapterOrder?: string` and parse it (`NoFilesInterceptor` yields strings):

```ts
const readingChapterOrder =
  body?.readingChapterOrder && !Number.isNaN(Number(body.readingChapterOrder))
    ? Number(body.readingChapterOrder)
    : null;
```

Thread it into `runTurn`:

```ts
await this.deepAgent.runTurn({
  userId, novelId, threadId: sessionId, userMessage: message,
  systemPrompt: prompt, emit, signal: ac.signal,
  readingChapterOrder,
});
```

### `DeepAgentService.runTurn` (`server/src/agentos/deep-agent.service.ts`)

Add `readingChapterOrder: number | null` to the `args` of `runTurn` (L75) and add the tool to the **main agent's** tool list (L130–131):

```ts
makeGetReadingChapterTool({ readingChapterOrder, chapters: this.chapters }) as never,
```

It does **not** go to the writer/settler/validator — the main agent reads focus and passes the explicit `chapterOrder` when delegating.

### The tool (`server/src/agentos/tools/get-reading-chapter.tool.ts`)

New `tool(...)` factory, closure-injected `{ readingChapterOrder, chapters }`:

```ts
export const makeGetReadingChapterTool = ({ readingChapterOrder, chapters }) =>
  tool({
    name: 'get_reading_chapter',
    description:
      '返回用户当前正在阅读的章节(发送本条消息时的快照)。' +
      '当用户说「这章/这章开头/这里」等指代时,先调用本工具确认章节号,' +
      '再把正确的 chapterOrder 委派给 writer。若无正在阅读的章节返回 null。',
    schema: z.object({}), // no args — value is closure-injected, never from LLM
    func: async () => {
      if (readingChapterOrder == null) return { ok: false, reason: 'no_active_chapter' };
      // userId/novelId are closure-injected at tool-build time (same as sibling tools),
      // so the lookup is owner-scoped — the value never comes from LLM input.
      const ch = await chapters.findByOrder(userId, novelId, readingChapterOrder);
      if (!ch) return { ok: false, reason: 'no_such_chapter', order: readingChapterOrder };
      return { ok: true, order: ch.order, title: ch.title, status: ch.status };
    },
  });
```

`ChapterService.findByOrder(userId, novelId, order)` already exists (`server/src/novel/chapter.service.ts`, returns the row or `null`); the closure shape mirrors `makeGetChapterTool`.

### Prompt (`server/src/agentos/agent-prompts.ts`, `MAIN_AGENT_PROMPT` L40–57)

Add a short clause:

> 用户正在阅读的章节可由 `get_reading_chapter` 获取(发送消息时的快照)。当用户用「这章 / 这章开头 / 这里」等指代时,先调用它确认 `chapterOrder`,再把该值传给 writer 委派;不要凭猜测假定章节号。

## Files touched

**agent-ui**
- `src/components/workspace/ResourcePanel.tsx` — rewrite `ChaptersView` (prev/next + TOC + pill + correct skeleton), add `ChapterToc` + `WritingPill` subcomponents.
- `src/components/workspace/ChapterDetail.tsx` — **delete** (orphaned).
- `src/components/workspace/ChatPanel.tsx` — reading-focus status line; drop `selectedChapterId`.
- `src/app/novels/[id]/page.tsx` — seed `currentChapterOrder`; drop `selectedChapterId={null}`; the `chapterWriteSeq` → `refresh()` subscription stays (now refreshes the *current* chapter via `currentChapterOrder`).
- `src/hooks/useAIStreamHandler.tsx` — follow effect (`!manualLock → currentChapterOrder = K`); `manualLock = false` on new message; append `readingChapterOrder` to the run `FormData`; fix stale `ChapterPreview`/`WritingChapter` comments.
- `src/store.ts` — add `currentChapterOrder`, `manualLock`; remove `selectedChapterId` usage.

**server**
- `src/agentos/agentos.controller.ts` — parse `readingChapterOrder`; thread to `runTurn`.
- `src/agentos/deep-agent.service.ts` — `readingChapterOrder` arg; add tool to main agent.
- `src/agentos/tools/get-reading-chapter.tool.ts` — **new**.
- `src/agentos/tools/index.ts` (or wherever tools are barrel-exported/registered) — export the new factory.
- `src/agentos/agent-prompts.ts` — `MAIN_AGENT_PROMPT` clause.

## Edge cases

- **`CONCEPT` novel** — no chapters → `currentChapterOrder = null`; pane shows "立项中"; status line hidden; `get_reading_chapter` returns `{ok:false, reason:'no_active_chapter'}`.
- **Single chapter** — prev/next disabled at both bounds; TOC lists one row.
- **Agent creates a new chapter** (`append_section` `findOrCreateByOrder`) — after `refresh()`, `novel.chapters` includes it; if following, the pane jumps to it and shows growth.
- **Snapshot staleness** — user switches chapters mid-turn; agent still sees the run-start snapshot. Acceptable for v1; the main-agent prompt steers it to confirm via the tool rather than assume.
- **`writingChapterOrder` set but lock held** — pane stays put, pill shows; `chapterWriteSeq` still refreshes the novel (so on pill-click the jumped-to chapter is already current).

## Cleanup (carried in this change)

- Delete `ChapterDetail.tsx`.
- Remove `selectedChapterId` plumbing (`page.tsx`, `ChatPanel.tsx`, store).
- Fix stale comments referencing `ChapterPreview` / `WritingChapter` in `page.tsx`, `ChatPanel.tsx`, `useAIStreamHandler.tsx`.

## Testing

- **agent-ui** has no test runner; gate is `pnpm validate` (lint + format + typecheck). Manual smoke: create novel → agent writes ch1 (follow + growth visible) → while writing ch2, switch to ch1 (pane holds, pill appears) → click pill (jumps to ch2) → send "改这章开头" (agent's `get_reading_chapter` resolves to current chapter; lock cleared).
- **server** (jest):
  - `get-reading-chapter.tool.spec.ts` — mock `ChapterService`: returns `{ok,title,order,status}` when set; `{ok:false, reason:'no_active_chapter'}` when null; `{ok:false, reason:'no_such_chapter'}` when the chapter was deleted. Verify no schema args (closure-only).
  - Extend the controller/runTurn wiring test (or add one) to assert `readingChapterOrder` is parsed from the body string and passed into `runTurn`.

## Open follow-ups (not in this change)

- Live mid-turn reading-chapter sync (would need a side channel; deferred).
- Manual in-pane edit + PATCH (revive the dead `ChapterDetail` edit path if later desired).
- Chat→manuscript click-to-jump.
- The four placeholder resource panes (outline/characters/worldview/status).
