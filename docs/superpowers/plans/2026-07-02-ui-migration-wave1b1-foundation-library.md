# UI Migration — Wave 1B-1: Force-Multiplier + PageShell + Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the Wave 1B force-multiplier (rewrite `.input-base` + `body` bg — cascades to all settings forms), extract a shared `PageShell` (eliminates the 3× duplicated route shell), and reskin the library route (NovelLibrary/NovelCard/PublishDialog) to frames 03-06.

**Architecture:** `.input-base` + `body` in `globals.css` migrate old→new tokens (one rule each, cascades app-wide to form controls). `PageShell` centralizes the `bg-bg-darkest` + AppSidebar + header pattern (library adopts it now; knowledge/settings adopt it in Plan 1B-2 when their content reskins). Library components evolve to frames: NovelCard gains a gradient cover (frame 03) + `Card` classes + `Badge` for status; NovelLibrary uses `PageShell` + `Button variant="gradient"`; PublishDialog rewires tokens (buttons already variant-based from Wave 1A).

**Tech Stack:** Next.js 15 + React 18 + Tailwind v3.4 + cva + Radix Dialog/DropdownMenu + lucide-react. Wave 0/1A namespace + primitives active. `cn()` at `@/lib/utils`.

**Spec:** [Wave 1B execution design](../specs/2026-07-02-ui-migration-wave1b-design.md). Token values: [Token Spec](../specs/2026-07-02-ui-redesign-design.md).

**Verification:** No test runner — `pnpm validate` + grep + Playwright (auth-required routes: SSR check + optional visual via registered test user). Run pnpm from `agent-ui/`.

**⚠ Opacity-modifier footgun:** `accent.*`/`text.*`/`bg.*` tokens are bare `var()` — `/NN` modifiers DON'T work on them (silently dropped). Only functional colors (`destructive`/`success`/`warning`/`info`) support `/NN`. Use `bg-accent-primarySoft` (#6366f126 ≈ 15% indigo) for tinted backgrounds, `bg-accent-primary`/`text-accent-indigoLight` for solid, or literal `bg-[#6366f1XX]` for precise alpha. **Never write `bg-accent-primary/40` etc.**

---

## File Structure

- **Modify** `agent-ui/src/app/globals.css` — `.input-base` + `body` token migration (force-multiplier).
- **Create** `agent-ui/src/components/layout/PageShell.tsx` — shared route shell.
- **Modify** `agent-ui/src/components/library/NovelLibrary.tsx` — adopt PageShell + gradient CTA + state text.
- **Modify** `agent-ui/src/components/library/NovelCard.tsx` — gradient cover + Card classes + Badge + menu trigger + delete dialog.
- **Modify** `agent-ui/src/components/library/PublishDialog.tsx` — token rewire (body/labels/number inputs).

---

## Task 1: Force-multiplier — `.input-base` + `body` in globals.css

**Files:** Modify `agent-ui/src/app/globals.css`

- [ ] **Step 1: Migrate the `body` rule**

Find (around line 11-13):
```css
  body {
    @apply bg-background/80 text-secondary;
  }
```
Replace with:
```css
  body {
    @apply bg-bg-darkest text-text-body;
  }
```

- [ ] **Step 2: Migrate `.input-base` + its `:focus`**

Find (around line 34-39):
```css
  .input-base {
    @apply w-full rounded-xl border border-primary/10 bg-background-secondary px-3 py-2 text-sm text-primary outline-none;
  }
  .input-base:focus {
    @apply border-brand;
  }
```
Replace with:
```css
  .input-base {
    @apply w-full rounded-input border border-overlay-15 bg-bg-card px-3 py-2 text-sm text-text-primary outline-none;
  }
  .input-base:focus {
    @apply border-accent-primary;
  }
```

- [ ] **Step 3: Verify**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm validate
```
Expected: PASS. (This cascades new tokens to every `input-base` consumer — ModelSettings/AgentModelSettings/VoiceProfileEditor forms — but those routes aren't visually verified until Plan 1B-2.)

- [ ] **Step 4: Commit**

```bash
cd /Users/taowen/project/narratox && git add agent-ui/src/app/globals.css && git commit -m "feat(agent-ui): migrate .input-base + body to new tokens (Wave 1B force-multiplier)"
```

---

## Task 2: Create `PageShell`

**Files:** Create `agent-ui/src/components/layout/PageShell.tsx`

- [ ] **Step 1: Create the file**

```tsx
import type { ReactNode } from 'react'

import AppSidebar from '@/components/layout/AppSidebar'

interface PageShellProps {
  active: 'library' | 'knowledge' | 'dissect' | 'settings'
  title: string
  /** Optional status/subtitle line below the title. */
  subtitle?: ReactNode
  /** Optional right-aligned header content (e.g. primary CTA button). */
  headerRight?: ReactNode
  children: ReactNode
}

/**
 * Shared route shell for library/knowledge/settings: bg-bg-darkest + AppSidebar
 * + main header. (Workspace uses IconRail; dissect is single-column — neither
 * uses PageShell.)
 */
const PageShell = ({
  active,
  title,
  subtitle,
  headerRight,
  children
}: PageShellProps) => (
  <div className="flex h-screen bg-bg-darkest">
    <AppSidebar active={active} />
    <main className="flex-1 overflow-y-auto p-8">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-lg font-semibold text-text-primary">{title}</h1>
          {subtitle ? (
            <div className="text-[11px] text-text-label">{subtitle}</div>
          ) : null}
        </div>
        {headerRight ? <div className="shrink-0">{headerRight}</div> : null}
      </header>
      {children}
    </main>
  </div>
)

export default PageShell
```

- [ ] **Step 2: Verify**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm typecheck
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/taowen/project/narratox && git add agent-ui/src/components/layout/PageShell.tsx && git commit -m "feat(agent-ui): add PageShell shared route shell (Wave 1B)"
```

---

## Task 3: Reskin `NovelLibrary` (adopt PageShell + gradient CTA)

**Files:** Modify `agent-ui/src/components/library/NovelLibrary.tsx`

- [ ] **Step 1: Swap the AppSidebar import for PageShell, and replace the return JSX**

Change the import (line 11) from:
```tsx
import AppSidebar from '@/components/layout/AppSidebar'
```
to:
```tsx
import PageShell from '@/components/layout/PageShell'
```

Then replace the entire `return (...)` block (lines 58-93) with:

```tsx
  return (
    <PageShell
      active="library"
      title="我的小说"
      headerRight={
        <Button
          variant="gradient"
          className="rounded-pill"
          onClick={onNewNovel}
        >
          + 新建小说
        </Button>
      }
    >
      {loading ? (
        <p className="text-sm text-text-tertiary">加载中…</p>
      ) : novels.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center gap-2 text-text-tertiary">
          <p className="text-sm">还没有小说,点击「新建小说」开始。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {novels.map((n) => (
            <NovelCard
              key={n.id}
              novel={n}
              onDelete={onDeleteNovel}
              onPublish={onPublishNovel}
            />
          ))}
        </div>
      )}
      <PublishDialog novel={publishing} onClose={() => setPublishing(null)} />
    </PageShell>
  )
```

Changes: shell → `PageShell`; CTA `bg-primary...` override → `variant="gradient"` + `rounded-pill`; `text-muted` states → `text-text-tertiary`; empty state centered (frame 04 direction). Imports otherwise unchanged (`Button`, `NovelCard`, `PublishDialog`, hooks, api, store all stay).

- [ ] **Step 2: Verify**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm typecheck
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/taowen/project/narratox && git add agent-ui/src/components/library/NovelLibrary.tsx && git commit -m "feat(agent-ui): NovelLibrary adopts PageShell + gradient CTA (Wave 1B)"
```

---

## Task 4: Reskin `NovelCard` (gradient cover + Card + Badge)

**Files:** Modify `agent-ui/src/components/library/NovelCard.tsx`

- [ ] **Step 1: Add Badge import + cover palette, then replace the component body**

Add `Badge` to the imports. After the existing `DropdownMenu` import block, add:
```tsx
import { Badge } from '@/components/ui/badge'
```

Directly under the existing `formatDate` function (before `const NovelCard = ...`), add a cover-gradient palette + a deterministic picker:
```tsx
const COVERS = [
  'bg-[linear-gradient(135deg,#6366f1,#8b5cf6)]',
  'bg-[linear-gradient(135deg,#3b82f6,#6366f1)]',
  'bg-[linear-gradient(135deg,#f59e0b,#ef4444)]',
  'bg-[linear-gradient(135deg,#ec4899,#8b5cf6)]',
  'bg-[linear-gradient(135deg,#10b981,#06b6d4)]'
]

const pickCover = (id: string) => {
  let sum = 0
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i)
  return COVERS[sum % COVERS.length]
}
```

Then replace the `return (...)` block (the whole `<>...</>` fragment) with:

```tsx
  return (
    <>
      <Link
        href={`/novels/${novel.id}`}
        className={cn(
          'group relative flex flex-col overflow-hidden rounded-lg border border-overlay-15 bg-bg-card transition-colors hover:border-accent-indigoLight',
          novel.status === 'ACTIVE' && 'border-l-2 border-l-accent-indigoLight'
        )}
      >
        <div
          className={cn(
            'relative h-28 shrink-0',
            pickCover(novel.id)
          )}
        >
          <div className="absolute left-3 top-3">
            {novel.status === 'CONCEPT' ? (
              <Badge variant="neutral">构思中</Badge>
            ) : (
              <Badge variant="accent">写作中</Badge>
            )}
          </div>
          <div
            className="absolute right-3 top-3 z-10 opacity-0 transition-opacity group-hover:opacity-100"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  title="更多"
                  className="rounded-md bg-overlay-10 p-1 text-text-tertiary hover:text-text-primary"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    setMenuOpen(false)
                    onPublish?.(novel)
                  }}
                >
                  发布
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => {
                    setMenuOpen(false)
                    setConfirmOpen(true)
                  }}
                >
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-1.5 p-4">
          <h3 className="line-clamp-1 text-base font-semibold text-text-primary">
            {novel.title}
          </h3>
          {novel.genre ? (
            <span className="text-xs text-text-tertiary">{novel.genre}</span>
          ) : null}
          <p className="line-clamp-3 text-xs text-text-tertiary">
            {novel.synopsis || '暂无简介'}
          </p>
          <div className="mt-auto flex items-center justify-between pt-2">
            <span className="text-xs text-text-label">
              {formatDate(novel.updatedAt)}
            </span>
          </div>
        </div>
      </Link>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>删除《{novel.title}》?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-text-tertiary">此操作不可撤销。</p>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmOpen(false)
                onDelete(novel.id)
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
```

Changes: card → `rounded-lg border-overlay-15 bg-bg-card hover:border-accent-indigoLight` (+ ACTIVE left accent); NEW gradient cover (h-28, deterministic per-id color from 5-palette, frame 03 direction); status pill → `Badge` (`neutral`/`accent`); ⋮ trigger → `bg-overlay-10 text-text-tertiary hover:text-text-primary`; all `text-primary`→`text-text-primary`, `text-muted`→`text-text-tertiary`, `text-muted/50`→`text-text-label`; delete dialog `text-muted`→`text-text-tertiary`. Dropdown menu items keep `text-destructive` (functional color). Imports for Dialog/DropdownMenu/Button/Link/cn/types unchanged.

- [ ] **Step 2: Verify**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm typecheck
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/taowen/project/narratox && git add agent-ui/src/components/library/NovelCard.tsx && git commit -m "feat(agent-ui): reskin NovelCard with gradient cover + Card/ Badge (Wave 1B)"
```

---

## Task 5: Reskin `PublishDialog`

**Files:** Modify `agent-ui/src/components/library/PublishDialog.tsx`

- [ ] **Step 1: Rewire tokens in the dialog body + number inputs + labels**

Find the body container `<div className="space-y-4 py-2 text-sm text-primary">` → change to:
```tsx
        <div className="space-y-4 py-2 text-sm text-text-primary">
```

Find the two number `<input>` elements (the `from` and `to` inputs). Each has:
```tsx
              className="w-16 rounded border border-primary/10 bg-background px-1 py-0.5 disabled:opacity-40"
```
Change each to:
```tsx
              className="w-16 rounded border border-overlay-15 bg-bg-card px-1 py-0.5 text-text-primary disabled:opacity-40"
```

Find all `<span className="... text-muted">` (章节范围 label, the "–" separator, the "章" suffix) and the label `text-xs text-muted` — change each `text-muted` → `text-text-tertiary`. (There are ~4 occurrences of `text-muted` in this file; migrate all to `text-text-tertiary`.)

For the radio + checkbox `<input>` elements, add an `accent-color` so native controls render indigo. Each `<input type="radio">` and `<input type="checkbox">` currently has no `className` — add:
```tsx
                className="accent-[#6366f1]"
```
(4 native inputs total: 2 radios + 3 checkboxes = actually 5; add to all of them.)

The buttons (`variant="outline"`, default, `variant="secondary"`) are already correct from Wave 1A — leave them.

- [ ] **Step 2: Verify**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm typecheck && pnpm validate
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/taowen/project/narratox && git add agent-ui/src/components/library/PublishDialog.tsx && git commit -m "feat(agent-ui): reskin PublishDialog to new tokens (Wave 1B)"
```

---

## Task 6: Wave 1B-1 gate — validate + grep + SSR/visual

**Files:** none (verification)

- [ ] **Step 1: Full gate**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm validate
```
Expected: lint ✓ + prettier ✓ + typecheck ✓. If prettier fails, `pnpm format:fix` + re-run.

- [ ] **Step 2: camelCase hygiene grep (expect ZERO)**

```bash
cd /Users/taowen/project/narratox && grep -rnE "accent-(indigo|violet)-(light|pale|mid)|accent-primary-soft|bg-card-elevated" agent-ui/src/components/layout agent-ui/src/components/library
```
Expected: zero matches.

- [ ] **Step 3: Old-token grep on Wave 1B-1 files (expect ZERO)**

```bash
cd /Users/taowen/project/narratox && grep -rnE "(^|[^-])(bg-brand|bg-background|bg-background-secondary|bg-primary|text-primary|text-muted|border-primary|border-white/20|border-white/10|text-brand)([^a-z-]|$)" agent-ui/src/app/globals.css agent-ui/src/components/layout/PageShell.tsx agent-ui/src/components/library/NovelLibrary.tsx agent-ui/src/components/library/NovelCard.tsx agent-ui/src/components/library/PublishDialog.tsx
```
Expected: zero matches. (The negative-lookbehind/lookahead `(^|[^-])...([^a-z-]|$)` avoids the `text-text-primary` substring false-positive and the `bg-bg-*` prefix. `bg-brand` literal alpha variants like `bg-brand/20` are also caught.)

- [ ] **Step 4: SSR / visual check**

Library is auth-required, so a direct screenshot needs a logged-in session. Two-tier check:

Tier A (always): boot dev + confirm the library route SSRs without error (it should redirect to /login when unauthenticated — that's correct, not a failure):
```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm dev > /tmp/w1b1-dev.log 2>&1 &
sleep 18
curl -s -o /dev/null -w "library HTTP %{http_code} (307/200 redirect-to-login is OK)\n" http://localhost:3000/
curl -s -o /dev/null -w "login    HTTP %{http_code}\n" http://localhost:3000/login
grep -iE "error|cannot|undefined|failed" /tmp/w1b1-dev.log | head || echo "no errors"
pkill -f "next dev" 2>/dev/null || true
```
Expected: login 200, library 307/200 (redirect), no errors in log.

Tier B (optional, if a test user can be registered against a running server on :3001): register a throwaway user via `POST /auth/register`, log in via Playwright, navigate to `/`, screenshot the library empty state + (if data exists) the NovelCard grid; compare to frames `03 Library Main` (id `ZcuP6`) and `04 Library Empty` (id `iG9mm`). If the server isn't running or registration isn't feasible, skip — Tier A + greps are the hard gate; full visual smoke is a user step.

- [ ] **Step 5: Commit any formatting fixes**

```bash
cd /Users/taowen/project/narratox && git add -u && git diff --cached --quiet || git commit -m "style(agent-ui): prettier fixes (Wave 1B-1 gate)"
```

- [ ] **Step 6: Mark Wave 1B-1 complete**

Wave 1B-1 is done when: `pnpm validate` green; camelCase + old-token greps clean; library SSRs without error. The force-multiplier (`.input-base` + body) is now app-wide; PageShell is available for Plan 1B-2 to adopt in knowledge/settings. Next: Plan 1B-2 (knowledge + settings + W1-Gate).

---

## Self-Review (completed)

- **Spec coverage:** Spec §2.1 force-multiplier (`.input-base` + body) → Task 1. §2.1 PageShell → Task 2 (+ library adopts in Task 3; knowledge/settings adoption deferred to Plan 1B-2 per plan-level decision — cleaner per-route). §2.3 ad-hoc mappings → NovelCard (`border-white`→`border-overlay-15`, `bg-brand/20`→`Badge accent`, `border-l-brand/60`→`border-l-accent-indigoLight`, `text-brand`→`Badge`). §2.4 evolve-to-frame → NovelCard gradient cover (frame 03). Spec §4 gate → Task 6.
- **Placeholder scan:** No TBD/TODO. Task 6 Tier B visual is honestly conditional (auth-required) with a defined fallback (Tier A hard gate).
- **Type consistency:** PageShell props (`active`/`title`/`subtitle?`/`headerRight?`/`children`) match Task 3 usage (`active="library" title="我的小说" headerRight={...}`). `Badge` variants (`neutral`/`accent`) match Wave 0 definition. NovelCard `pickCover(id)` returns a className string consumed by `cn(...)`. NovelLibrary imports `PageShell` (not `AppSidebar`) after the swap — no dangling import. `accent-[#6366f1]` is a valid Tailwind arbitrary value for `accent-color`. No `/NN` opacity used on bare-var accent/text/bg tokens (footgun avoided: hover borders use solid `accent-indigoLight`, tinted bg uses `bg-overlay-10`/`accent-primarySoft`).
```
```
