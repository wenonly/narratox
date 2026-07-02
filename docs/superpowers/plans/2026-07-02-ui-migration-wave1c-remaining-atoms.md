# UI Migration — Wave 1C: Remaining Shared Atoms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the shared-atom layer Wave 1A started — rewire the 3 remaining Wave-1-consumed `ui/*` primitives (dropdown-menu, sonner, Icon) to new tokens, and delete dead `select.tsx`. This makes Wave 1 routes render fully on the new design (no old-token dropdown/toast/icon-fallback underneath). `tooltip` (chat-only) and `MarkdownRenderer` (720L prose, chat-heaviest) defer to Wave 2.

**Architecture:** All 3 rewires are in-place className token swaps (APIs unchanged → zero call-site changes, app-wide appearance flip only). `select.tsx` has 0 call-sites → safe to delete.

**Tech Stack:** Tailwind v3.4 + Radix DropdownMenu + sonner + next-themes. New namespace active. `cn()` at `@/lib/utils`.

**Spec:** [Wave 1B execution design](../specs/2026-07-02-ui-migration-wave1b-design.md) (atom-layer completion). Token values: [Token Spec](../specs/2026-07-02-ui-redesign-design.md).

**⚠ Opacity footgun:** bare-var tokens — no `/NN`. Use `bg-overlay-10`/`bg-accent-primarySoft`/solid.

---

## File Structure

- **Modify** `agent-ui/src/components/ui/dropdown-menu.tsx` — 7 targeted className token swaps.
- **Modify** `agent-ui/src/components/ui/sonner.tsx` — toaster classNames.
- **Modify** `agent-ui/src/components/ui/icon/Icon.tsx` — 2 fallback color spots.
- **Delete** `agent-ui/src/components/ui/select.tsx` — dead code (0 call-sites).

---

## Task 1: Rewire `dropdown-menu.tsx`

**Files:** Modify `agent-ui/src/components/ui/dropdown-menu.tsx`

7 targeted `cn(...)` className string swaps (the cva-like base strings inside each `forwardRef`). For each, find the exact substring and replace:

- [ ] **Step 1: SubTrigger (line 30)** — `focus:bg-accent data-[state=open]:bg-accent` → `focus:bg-overlay-10 data-[state=open]:bg-overlay-10`
- [ ] **Step 2: SubContent (line 50)** — `border bg-background p-1 text-primary` → `border border-overlay-15 bg-bg-card p-1 text-text-primary`
- [ ] **Step 3: Content (line 68)** — `border bg-background p-1 text-primary` → `border border-overlay-15 bg-bg-card p-1 text-text-primary`
- [ ] **Step 4: Item (line 86)** — `focus:bg-accent focus:text-primary` → `focus:bg-overlay-10 focus:text-text-primary`
- [ ] **Step 5: CheckboxItem (line 102)** — `focus:bg-accent focus:text-primary` → `focus:bg-overlay-10 focus:text-text-primary`
- [ ] **Step 6: RadioItem (line 126)** — `focus:bg-accent focus:text-primary` → `focus:bg-overlay-10 focus:text-text-primary`
- [ ] **Step 7: Separator (line 165)** — `bg-primary/10` → `bg-overlay-10`

(Leave `rounded-sm`, the lucide icons, all forwardRef/displayName, and the export block unchanged. The two `border bg-background p-1 text-primary` strings in SubContent/Content are identical — replace BOTH occurrences.)

- [ ] **Step 8: Verify + commit**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm typecheck
cd /Users/taowen/project/narratox && git add agent-ui/src/components/ui/dropdown-menu.tsx && git commit -m "feat(agent-ui): rewire dropdown-menu to new tokens (Wave 1C)"
```

---

## Task 2: Rewire `sonner.tsx`

**Files:** Modify `agent-ui/src/components/ui/sonner.tsx`

- [ ] **Step 1: Replace the `toastOptionsclassNames` block**

Replace lines 16-23 (the `classNames: { ... }` object) with:

```tsx
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-bg-card group-[.toaster]:text-text-primary group-[.toaster]:border-overlay-15 group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-text-tertiary',
          actionButton:
            'group-[.toast]:bg-accent-primary group-[.toast]:text-white',
          cancelButton:
            'group-[.toast]:bg-bg-cardElevated group-[.toast]:text-text-primary'
        }
```

Changes: toast `bg-background`→`bg-bg-card`, `text-primary`→`text-text-primary`, `border-border`→`border-overlay-15`; description `text-muted`→`text-text-tertiary`; actionButton `bg-primary text-background`→`bg-accent-primary text-white`; cancelButton `bg-muted text-background`→`bg-bg-cardElevated text-text-primary`. (The `group-[.toaster]:` / `group-[.toast]:` prefixes are sonner's API — keep them.)

- [ ] **Step 2: Verify + commit**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm typecheck
cd /Users/taowen/project/narratox && git add agent-ui/src/components/ui/sonner.tsx && git commit -m "feat(agent-ui): rewire sonner toaster to new tokens (Wave 1C)"
```

---

## Task 3: Rewire `Icon.tsx` fallback colors

**Files:** Modify `agent-ui/src/components/ui/icon/Icon.tsx`

- [ ] **Step 1: Swap the 2 fallback color tokens (around lines 20-21)**

Find:
```
        color && !disabled ? `text-${color}` : 'text-primary',
        disabled && 'cursor-default text-muted/50',
```
Replace with:
```
        color && !disabled ? `text-${color}` : 'text-text-primary',
        disabled && 'cursor-default text-text-tertiary',
```

(The dynamic `text-${color}` stays — callers pass token names; that's their wave's concern. Only the two FALLBACKS migrate. `text-muted/50` → `text-text-tertiary` drops the `/50` — opacity on bare var wouldn't work anyway, and solid tertiary is the right disabled look.)

- [ ] **Step 2: Verify + commit**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm typecheck
cd /Users/taowen/project/narratox && git add agent-ui/src/components/ui/icon/Icon.tsx && git commit -m "feat(agent-ui): rewire Icon fallback colors to new tokens (Wave 1C)"
```

---

## Task 4: Delete dead `select.tsx`

**Files:** Delete `agent-ui/src/components/ui/select.tsx`

- [ ] **Step 1: Confirm 0 call-sites, then delete**

```bash
cd /Users/taowen/project/narratox && grep -rl "components/ui/select'" agent-ui/src --include="*.tsx" | wc -l
```
Expected: `0` (dead code). If >0, STOP and report (do NOT delete a used file). If 0:
```bash
git rm agent-ui/src/components/ui/select.tsx && git commit -m "chore(agent-ui): delete dead select.tsx (0 call-sites) (Wave 1C)"
```

---

## Task 5: Wave 1C gate

**Files:** none (verification)

- [ ] **Step 1: Full gate**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm validate
```
Expected: PASS (deleting select.tsx must not break typecheck — confirm no stale import). If prettier fails, `pnpm format:fix` + re-run.

- [ ] **Step 2: Old-token grep on the 3 rewired atoms (expect ZERO)**

```bash
cd /Users/taowen/project/narratox && grep -rnE "(^|[^-])(bg-brand|bg-background|bg-primary|text-primary|text-muted|border-border|focus:bg-accent)([^a-z-]|$)" agent-ui/src/components/ui/dropdown-menu.tsx agent-ui/src/components/ui/sonner.tsx agent-ui/src/components/ui/icon/Icon.tsx
```
Expected: zero matches. (`border-border` added since sonner used it; `focus:bg-accent` since dropdown-menu used it.)

- [ ] **Step 3: Confirm tooltip + MarkdownRenderer remain old-token (deferred to Wave 2 — NOT a failure)**

```bash
cd /Users/taowen/project/narratox && echo "deferred-to-Wave-2 atom files (expected to still have old tokens):" && grep -rlE "bg-background|text-primary|focus:bg-accent" agent-ui/src/components/ui/tooltip agent-ui/src/components/ui/typography/MarkdownRenderer --include="*.tsx" | sort
```
Expected: tooltip + MarkdownRenderer files listed (these are Wave 2's job). This is informational, not a gate failure.

- [ ] **Step 4: SSR check**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm dev > /tmp/w1c-dev.log 2>&1 &
sleep 16
curl -s -o /dev/null -w "/login HTTP %{http_code}\n" http://localhost:3000/login
grep -iE "error|cannot|undefined|failed|✗ Compilation" /tmp/w1c-dev.log | head || echo "no errors ✓"
pkill -f "next dev" 2>/dev/null || true
```
Expected: 200, no errors. (Visual: any toast/dropdown now renders new tokens — user smoke-test.)

- [ ] **Step 5: Commit formatting fixes**

```bash
cd /Users/taowen/project/narratox && git add -u && git diff --cached --quiet || git commit -m "style(agent-ui): prettier fixes (Wave 1C gate)"
```

- [ ] **Step 6: Mark Wave 1C complete → Wave 1 DONE**

Wave 1C done when: `pnpm validate` green; the 3 atoms grep clean; select.tsx deleted; SSR clean. **Wave 1 (all routes + all consumed shared atoms) is now fully on the new design system** — tooltip + MarkdownRenderer remain for Wave 2 (chat). Next: Wave 2 (workspace — `/novels/[id]`, IconRail/Chat/ResourcePanel + 10 views).

---

## Self-Review (completed)

- **Spec coverage:** dropdown-menu + sonner + Icon rewire (Wave 1C brainstorm IN-scope) → Tasks 1-3. select.tsx delete (dead) → Task 4. tooltip + MarkdownRenderer OUT (deferred Wave 2) → noted in Task 5 Step 3. Gate → Task 5.
- **Placeholder scan:** No TBD/TODO. Task 4 has a 0-call-site confirmation gate before delete (safety).
- **Type consistency:** dropdown-menu edits are pure className string swaps inside existing `cn(...)` — no API change, all 14 exports preserved. sonner keeps the `group-[.toaster]:`/`group-[.toast]:` sonner prefixes. Icon keeps the dynamic `text-${color}`. select.tsx deletion safe (0 call-sites, verified in-task). No `/NN` opacity on bare-var tokens (`bg-overlay-10`/`bg-accent-primary`/`text-text-tertiary` all solid or proper tokens).
```
```
