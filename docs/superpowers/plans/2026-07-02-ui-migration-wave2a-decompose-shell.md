# UI Migration — Wave 2A: ResourcePanel Decompose + Workspace Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose the 1380-line `ResourcePanel.tsx` (8 inline views → 8 files in `workspace/views/`), centralize the duplicated `ResourceKey` union, and reskin the workspace shell (page/IconRail/ChatPanel/ResourcePanel-shell) to new tokens. This is the structural prerequisite that makes Wave 2C's per-view reskin feasible.

**Architecture:** The 8 inline views move to `workspace/views/*.tsx` behavior-preserving (each takes the props it currently closes over — at minimum `novel`, plus any `onClose`/`onSaved`/view-local handlers). `ResourcePanel.tsx` becomes a thin `switch (resource)` that imports the 8 extracted views + the 2 existing ones (ReferencesView/VoiceProfileView). `ResourceKey` centralizes to `workspace/types.ts`. Shell reskin: page `bg-bg-darkest`, IconRail (`w-14`=56px, new tokens, emoji kept), ChatPanel header, ResourcePanel shell.

**Tech Stack:** Next.js 15 + React 18 + Tailwind v3.4. New namespace + primitives active. `cn()` at `@/lib/utils`.

**Spec:** [Wave 2 execution design](../specs/2026-07-02-ui-migration-wave2-design.md).

**⚠ Opacity footgun:** bare-var tokens — no `/NN`. Use `bg-overlay-10`/`bg-accent-primarySoft`/solid.

---

## File Structure

- **Create** `agent-ui/src/components/workspace/types.ts` — centralized `ResourceKey`.
- **Create** `agent-ui/src/components/workspace/views/{InfoView,WorldviewView,OutlineView,ChaptersView,CharactersView,HooksView,EventsView,OverviewView}.tsx` — the 8 extracted views.
- **Modify** `agent-ui/src/components/workspace/ResourcePanel.tsx` — thin switch (1380L → ~80L).
- **Modify** `agent-ui/src/app/novels/[id]/page.tsx` — import centralized ResourceKey + shell reskin.
- **Modify** `agent-ui/src/components/workspace/IconRail.tsx` — import ResourceKey + reskin (w-14, tokens, emoji kept).
- **Modify** `agent-ui/src/components/workspace/ChatPanel.tsx` — header reskin.

---

## Task 1: Centralize `ResourceKey`

**Files:** Create `workspace/types.ts`; modify page/IconRail/ResourcePanel imports.

- [ ] **Step 1: Create `agent-ui/src/components/workspace/types.ts`**

```ts
export type ResourceKey =
  | 'outline'
  | 'chapters'
  | 'characters'
  | 'worldview'
  | 'references'
  | 'status'
  | 'info'
  | 'voiceProfile'
  | 'events'
  | 'overview'
```

- [ ] **Step 2: Replace the 3 duplicate `type ResourceKey = ...` definitions**

In `page.tsx` (lines 15-25), `IconRail.tsx` (lines 7-17), and `ResourcePanel.tsx` (its local `ResourceKey` def), DELETE the local `type ResourceKey = ...` block and ADD an import at the top:
```ts
import type { ResourceKey } from '@/components/workspace/types'
```
(All three files now import the single source of truth. The union values must match exactly — verify the existing local defs are identical to `types.ts` before deleting; if any differs, STOP and report.)

- [ ] **Step 3: Verify + commit**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm typecheck
cd /Users/taowen/project/narratox && git add agent-ui/src/components/workspace/types.ts agent-ui/src/app/novels/[id]/page.tsx agent-ui/src/components/workspace/IconRail.tsx agent-ui/src/components/workspace/ResourcePanel.tsx && git commit -m "refactor(agent-ui): centralize ResourceKey to workspace/types.ts (Wave 2A)"
```

---

## Task 2: Extract the 8 inline views to `workspace/views/*.tsx`

**Files:** Create 8 files; modify `ResourcePanel.tsx`. This is a BEHAVIOR-PRESERVING extraction.

- [ ] **Step 1: Read `ResourcePanel.tsx` fully and identify each view's boundary + prop dependencies**

The 8 inline views and their approximate line ranges (from exploration — verify against actual code):
- `InfoView` (~L1346-1380)
- `WorldviewView` (~L433-529)
- `OutlineView` (~L530-761)
- `ChaptersView` (~L119-432)
- `CharactersView` (~L843-1031)
- `HooksView` (~L1032-1136)
- `EventsView` (~L1240-1345)
- `OverviewView` (~L1137-1239)

For EACH view, identify: (a) its component signature (what props does the inline component receive from `ResourcePanel`? — typically `novel`, possibly `onClose`/`onSaved`/view-specific callbacks), (b) any module-level helpers/types it uses that live in `ResourcePanel.tsx` (these must move WITH the view or to a shared `workspace/views/shared.ts` if used by multiple views).

- [ ] **Step 2: Create each of the 8 view files**

For each view, create `agent-ui/src/components/workspace/views/{Name}.tsx` containing:
- `'use client'` if it uses hooks/state (most do — they fetch data).
- The necessary imports (`useStore`, the relevant `@/api/*` fetchers, `@/types/*`, `MarkdownRenderer`/`CollapsibleCard`/`Badge` etc. as used, `cn`).
- The view component, exported as default, with an explicit `Props` interface declaring exactly the props it currently receives from `ResourcePanel`.
- Any view-local helpers/types/constants it depends on.

**CRITICAL — behavior-preserving:** the extracted view's JSX, hooks, state, data-fetching, and event handlers must be byte-identical to the inline version. Do NOT reskin yet (that's Wave 2C) — move ONLY. Token classes stay as-is (old tokens) in this task; 2C migrates them.

- [ ] **Step 3: Verify + commit (one commit for the 8 new view files)**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm typecheck
cd /Users/taowen/project/narratox && git add agent-ui/src/components/workspace/views && git commit -m "refactor(agent-ui): extract 8 ResourcePanel views to workspace/views/* (Wave 2A)"
```

(typecheck passes: the new files are self-contained; `ResourcePanel.tsx` still defines + uses its OWN inline copies until Task 3 swaps them.)

---

## Task 3: `ResourcePanel.tsx` → thin switch

**Files:** Modify `agent-ui/src/components/workspace/ResourcePanel.tsx` (1380L → ~80L)

- [ ] **Step 1: Rewrite `ResourcePanel.tsx` as a thin switch**

Delete ALL 8 inline view definitions + their helpers/types. Keep ONLY:
- The imports (including the centralized `ResourceKey` from Task 1, the 8 new view components from Task 2, the existing `ReferencesView` + `VoiceProfileView`).
- The `ResourcePanel` component itself: receives `resource: ResourceKey`, `novel`, `onClose`, `onSaved` (its current props — verify against the existing signature); renders the panel shell (header with title + close button) and a `switch (resource)` that mounts the right view, passing each view the props it declared in Task 2.

The panel shell (header/title/close) + the `switch` stay in `ResourcePanel.tsx`. Use the CURRENT (old-token) styling for the shell in this task — shell reskin is Task 4. The `switch` maps:
- `info` → `<InfoView .../>`
- `worldview` → `<WorldviewView .../>`
- `outline` → `<OutlineView .../>`
- `chapters` → `<ChaptersView .../>`
- `characters` → `<CharactersView .../>`
- `status` → `<HooksView .../>` (note: `status` key maps to the hooks/status view — verify the existing mapping)
- `events` → `<EventsView .../>`
- `overview` → `<OverviewView .../>`
- `references` → `<ReferencesView .../>`
- `voiceProfile` → `<VoiceProfileView .../>`

**CRITICAL:** verify the existing `ResourcePanel` maps each `resource` value to the correct view BEFORE rewriting (read the current switch/conditional rendering). Preserve the exact mapping + prop passing.

- [ ] **Step 2: Verify**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm typecheck && pnpm validate
```
Expected: PASS. No unused imports (the old inline-view imports like `getWorldview`/`getOutline` etc. move to the view files; ResourcePanel should no longer import them). No duplicate definitions. File should be ~80 lines.

- [ ] **Step 3: Commit**

```bash
cd /Users/taowen/project/narratox && git add agent-ui/src/components/workspace/ResourcePanel.tsx && git commit -m "refactor(agent-ui): ResourcePanel → thin switch importing extracted views (Wave 2A)"
```

---

## Task 4: Reskin the workspace shell

**Files:** Modify `page.tsx`, `IconRail.tsx`, `ChatPanel.tsx`, `ResourcePanel.tsx` (shell only).

- [ ] **Step 1: `page.tsx` — shell bg + loading**

Find `<div className="p-8 text-sm text-muted">加载中…</div>` (line ~135) → `<div className="p-8 text-sm text-text-tertiary">加载中…</div>`.
Find `<div className="flex h-screen bg-background/80">` (line ~138) → `<div className="flex h-screen bg-bg-darkest">`.
(All the chapter-memory/streaming logic untouched.)

- [ ] **Step 2: `IconRail.tsx` — width 56px + tokens (emoji kept)**

Overwrite the file with EXACTLY:

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'
import type { ResourceKey } from '@/components/workspace/types'

interface Props {
  activeResource: ResourceKey | null
  onSelectResource: (key: ResourceKey | null) => void
}

const RESOURCES: { key: ResourceKey; icon: string; label: string }[] = [
  { key: 'info', icon: 'ℹ️', label: '小说信息' },
  { key: 'worldview', icon: '🌍', label: '世界观' },
  { key: 'references', icon: '📚', label: '参考资料' },
  { key: 'outline', icon: '📝', label: '大纲' },
  { key: 'chapters', icon: '📖', label: '正文' },
  { key: 'characters', icon: '👤', label: '角色' },
  { key: 'status', icon: '📊', label: '状态' },
  { key: 'events', icon: '📅', label: '事件时间线' },
  { key: 'overview', icon: '📊', label: '态势' }
]

const IconRail = ({ activeResource, onSelectResource }: Props) => {
  const router = useRouter()
  const logout = useStore((s) => s.logout)

  const handleClick = (key: ResourceKey) => {
    onSelectResource(activeResource === key ? null : key)
  }

  return (
    <div className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-overlay-15 bg-bg-darkest py-3">
      <button
        type="button"
        onClick={() => router.push('/')}
        title="返回小说库"
        className="mb-1 flex h-9 w-9 items-center justify-center rounded-lg text-lg text-accent-indigoLight transition-colors hover:bg-overlay-10"
      >
        ←
      </button>
      <div className="mb-1 h-px w-6 bg-overlay-10" />
      {RESOURCES.map((r) => (
        <button
          key={r.key}
          type="button"
          onClick={() => handleClick(r.key)}
          title={r.label}
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-lg text-lg transition-colors',
            activeResource === r.key
              ? 'border-l-2 border-accent-indigoLight bg-accent-primarySoft'
              : 'opacity-50 hover:bg-overlay-10 hover:opacity-100'
          )}
        >
          {r.icon}
        </button>
      ))}
      <div className="mt-auto flex flex-col items-center gap-1">
        <div className="my-1 h-px w-6 bg-overlay-10" />
        <button
          type="button"
          onClick={() => handleClick('voiceProfile')}
          title="作者画像"
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-lg text-lg transition-colors',
            activeResource === 'voiceProfile'
              ? 'border-l-2 border-accent-indigoLight bg-accent-primarySoft'
              : 'opacity-50 hover:bg-overlay-10 hover:opacity-100'
          )}
        >
          🎭
        </button>
        <button
          type="button"
          onClick={() => {
            logout()
            router.replace('/login')
          }}
          title="登出"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-sm opacity-50 transition-colors hover:bg-overlay-10 hover:opacity-100"
        >
          ⏻
        </button>
      </div>
    </div>
  )
}

export default IconRail
```

Changes: `w-12`→`w-14` (48→56px, Token Spec §3.2); `border-primary/10 bg-background-secondary`→`border-overlay-15 bg-bg-darkest`; back `text-brand hover:bg-brand/10`→`text-accent-indigoLight hover:bg-overlay-10`; active `border-l-2 border-brand bg-brand/20`→`border-l-2 border-accent-indigoLight bg-accent-primarySoft`; inactive `hover:bg-accent`→`hover:bg-overlay-10`; dividers `bg-primary/10`→`bg-overlay-10`; emoji KEPT; logout `hover:bg-accent`→`hover:bg-overlay-10`. `ResourceKey` imported from types.

- [ ] **Step 3: `ChatPanel.tsx` — header**

Find `<div className="flex items-center justify-between px-5 py-2 text-xs text-muted">` → change `text-muted` to `text-text-tertiary`. (All nuqs/history/streaming logic untouched.)

- [ ] **Step 4: `ResourcePanel.tsx` shell — token-swap the header/close (NOT the views; they're 2C)**

In the panel shell you wrote in Task 3 (the header/title/close wrapper around the `switch`), migrate ONLY the shell's old tokens (`text-primary`→`text-text-primary`, `text-muted`→`text-text-tertiary`, `border-primary/10`→`border-overlay-15`, `bg-background(-secondary)`→`bg-bg-card(Elevated)`, `bg-brand`→`bg-accent-primary`, `hover:bg-accent`→`hover:bg-overlay-10`, etc.). Do NOT touch the view components' tokens (Wave 2C). Run the old-token grep (Step 5) scoped to ResourcePanel.tsx — it should show zero old tokens in the SHELL but the imported views still have theirs (that's fine, they're separate files now).

- [ ] **Step 5: Verify + commit**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm typecheck && pnpm validate
cd /Users/taowen/project/narratox && git add agent-ui/src/app/novels/[id]/page.tsx agent-ui/src/components/workspace/IconRail.tsx agent-ui/src/components/workspace/ChatPanel.tsx agent-ui/src/components/workspace/ResourcePanel.tsx && git commit -m "feat(agent-ui): reskin workspace shell (page/IconRail/ChatPanel/RP-shell) (Wave 2A)"
```

---

## Task 5: Wave 2A gate

**Files:** none (verification)

- [ ] **Step 1: Full gate**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm validate
```
Expected: PASS. If prettier fails, `pnpm format:fix` + re-run.

- [ ] **Step 2: Decomposition verification**

```bash
cd /Users/taowen/project/narratox && echo "=== ResourcePanel.tsx line count (expect ~80-120, was 1380) ===" && wc -l agent-ui/src/components/workspace/ResourcePanel.tsx && echo "=== 8 view files exist ===" && ls agent-ui/src/components/workspace/views/ && echo "=== ResourceKey single source (expect 1 def in types.ts, 0 inline) ===" && grep -rn "type ResourceKey" agent-ui/src/components/workspace agent-ui/src/app/novels && echo "=== ResourceKey imports (expect 3: page/IconRail/ResourcePanel) ===" && grep -rl "import type { ResourceKey }" agent-ui/src
```
Expected: ResourcePanel ~80-120 lines; 8 files in views/; `type ResourceKey` only in types.ts; 3 importers.

- [ ] **Step 3: Shell old-token grep (expect ZERO — views are 2C, scoped out)**

```bash
cd /Users/taowen/project/narratox && grep -rnE "(^|[^-])(bg-brand|bg-background|bg-background-secondary|bg-primary|text-primary|text-muted|border-primary|hover:bg-accent)([^a-z-]|$)" agent-ui/src/app/novels/[id]/page.tsx agent-ui/src/components/workspace/IconRail.tsx agent-ui/src/components/workspace/ChatPanel.tsx agent-ui/src/components/workspace/ResourcePanel.tsx
```
Expected: ZERO (the shell is reskinned; the views live in `workspace/views/` which is NOT grepped here — their tokens are Wave 2C's job).

- [ ] **Step 4: SSR/compile check**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm dev > /tmp/w2a-dev.log 2>&1 &
sleep 18
curl -s -o /dev/null -w "/login     HTTP %{http_code}\n" http://localhost:3000/login
curl -s -o /dev/null -w "/novels/x  HTTP %{http_code}\n" http://localhost:3000/novels/x
grep -iE "error|cannot|undefined|failed|✗ Compilation" /tmp/w2a-dev.log | head || echo "no errors ✓"
pkill -f "next dev" 2>/dev/null || true
```
Expected: login 200, /novels/x 200/307 (auth redirect), no compile errors.

- [ ] **Step 5: Commit formatting fixes**

```bash
cd /Users/taowen/project/narratox && git add -u && git diff --cached --quiet || git commit -m "style(agent-ui): prettier fixes (Wave 2A gate)"
```

- [ ] **Step 6: Mark Wave 2A complete**

Wave 2A done when: validate green; ResourcePanel decomposed (8 view files + ~80L shell); ResourceKey centralized; shell reskinned; SSR clean. Next: Wave 2B (chat tree + ActivityRow + MarkdownRenderer + tooltip).

---

## Self-Review (completed)

- **Spec coverage:** Decompose 8 views + centralize ResourceKey (Wave 2 spec §2 2A) → Tasks 1-3. Shell reskin (page/IconRail/ChatPanel/RP-shell) → Task 4. IconRail 56px (§3.1) → Task 4 Step 2. ActivityRow adoption + MarkdownRenderer + view reskin DEFERRED (2B/2C per spec). Gate → Task 5.
- **Placeholder scan:** Tasks 2-3 are intentionally PROCEDURAL (the implementer reads the 1380-line ResourcePanel.tsx fresh — controller can't hold it). The rules + line-range guide + acceptance are explicit. Task 4 shell reskin is exact-code. No vague "TBD".
- **Type consistency:** `ResourceKey` in types.ts must match the 3 existing inline defs (Task 1 verifies before deleting). Each extracted view's Props interface is determined by reading its current closure (Task 2 Step 1). The `status`→HooksView mapping must be verified against current code (Task 3). IconRail/ChatPanel/page edits preserve all logic. No `/NN` opacity on bare-var tokens (IconRail uses `bg-accent-primarySoft`/`bg-overlay-10`/solid).
```
```
