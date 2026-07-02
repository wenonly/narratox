# UI Migration — Wave 2B: Chat Tree + MarkdownRenderer + Tooltip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the chat tree (`Messages`/`MessageItem`/`ChatInput`/`MemoryBubble`/blank/loader/Multimedia) + `MarkdownRenderer/{activities,inlineStyles,styles}` + `tooltip` to new tokens. **Pure token reskin — no structural change.**

**Architecture:** Recipe-driven: apply the old→new token mapping (below) to each file; verify with per-file grep. **Revised decision: do NOT adopt `ActivityRow`** — chat renders activities as rich collapsible `ThinkBlock`/`ToolBlock`/`StageBlock` (with expand/detail), not flat rows; replacing them with `ActivityRow` would lose collapse/detail (regression). `ActivityRow` stays available for Wave 3's dissect log drawer.

**Tech Stack:** Tailwind v3.4. New namespace active. `cn()` at `@/lib/utils`.

**⚠ Opacity footgun (critical here — chat has many `/NN` variants):** `accent.*`/`text.*`/`bg.*` bare `var()` — `/NN` DOESN'T work. The recipe maps old `/NN` variants to solid tokens (e.g. `text-muted/50`→`text-text-label`, `text-primary/80`→`text-text-secondary`) or overlay tokens (`bg-background-secondary/40`→`bg-overlay-6`). Never carry `/NN` onto a bare-var new token.

---

## Token mapping recipe (apply per file)

| Old | New | Notes |
|---|---|---|
| `bg-background` | `bg-bg-card` | |
| `bg-background-secondary` | `bg-bg-cardElevated` | |
| `bg-background/80` | `bg-bg-darkest` | |
| `bg-background/60` | `bg-overlay-6` | subtle inset |
| `bg-background-secondary/40` | `bg-overlay-6` | collapsible container |
| `bg-background-secondary/80` | `bg-overlay-10` | hover |
| `bg-primary` | `bg-accent-primary` | |
| `bg-primary/10` | `bg-overlay-10` | divider |
| `bg-accent` (flat pill/hover) | `bg-overlay-10` | ToolComponent pill etc. |
| `bg-brand` | `bg-accent-primary` (or `<Button variant="...">` if it's a CTA) | |
| `bg-brand/10`,`bg-brand/15`,`bg-brand/20` | `bg-accent-primarySoft` | |
| `text-primary` | `text-text-primary` | |
| `text-primary/80` | `text-text-secondary` | no /80 on bare var |
| `text-primary/40` | `text-text-label` | |
| `text-muted` | `text-text-tertiary` | |
| `text-muted/80` | `text-text-tertiary` | |
| `text-muted/60`,`text-muted/50` | `text-text-label` | |
| `text-secondary` | `text-text-secondary` | old flat #f5f5f5 |
| `text-accent` | `text-text-tertiary` | old flat dark; for tooltip labels |
| `text-brand` | `text-accent-indigoLight` | camelCase |
| `border-primary/10` | `border-overlay-15` | |
| `border-primary/5` | `border-overlay-10` | |
| `border-white/20` | `border-overlay-15` | |
| `border-white/10` | `border-overlay-10` | |
| `font-dmmono` | `font-mono` | keep mono for tool/code |
| `font-geist` | `font-sans` (= Inter) | |
| `focus:bg-accent` | `focus:bg-overlay-10` | |

**Functional colors** (`bg-destructive`, `text-destructive`, `bg-success`, `text-success`, etc.) stay — they're fine. **Logic/hooks/state/handlers untouched** — className strings only.

---

## Files (group into 2 units)

**Unit A — chat tree:**
- `src/components/chat/ChatArea/Messages/Messages.tsx` (inline ReferenceItem/References/Reasoning/Reasonings/ToolComponent/AgentMessageWrapper)
- `src/components/chat/ChatArea/Messages/MessageItem.tsx` (AgentMessage/UserMessage/RecallConfirmDialog — has a `bg-brand` recall button → `variant="destructive"` or `bg-accent-primary`)
- `src/components/chat/ChatArea/ChatInput/ChatInput.tsx`
- `src/components/chat/ChatArea/Messages/MemoryBubble.tsx`
- `src/components/chat/ChatArea/Messages/ChatBlankState.tsx`
- `src/components/chat/ChatArea/Messages/AgentThinkingLoader.tsx`
- `src/components/chat/ChatArea/ScrollToBottom.tsx`
- `src/components/chat/ChatArea/Messages/Multimedia/Images/Images.tsx` (Videos.tsx/Audios.tsx are clean — skip unless grep finds tokens)

**Unit B — MarkdownRenderer + tooltip:**
- `src/components/ui/typography/MarkdownRenderer/activities.tsx` (Collapsible/DetailBlock/ThinkBlock/ToolBlock/StageBlock — heaviest, ~11 tokens)
- `src/components/ui/typography/MarkdownRenderer/inlineStyles.tsx`
- `src/components/ui/typography/MarkdownRenderer/styles.tsx`
- `src/components/ui/tooltip/tooltip.tsx`

---

## Task 1 (Unit A): chat tree reskin

**Files:** the 8 chat-tree files above.

- [ ] **Step 1: Read each file, apply the recipe**

For each file: read it, apply the token mapping recipe to every className. **Special cases:**
- `MessageItem.tsx` `RecallConfirmDialog` recall button: if it's a raw `<button className="... bg-brand text-primary ...">` or a `<Button>` with a `bg-brand` override, migrate to a `<Button variant="destructive">` (recall is a destructive action) — or if keeping raw, `bg-destructive text-white`. Use judgment; the action is "confirm recall" (destructive-ish). Keep the dialog logic intact.
- `Messages.tsx` `ToolComponent`: `rounded-full bg-accent px-2 py-1.5` + `font-dmmono uppercase text-primary/80` → `rounded-full bg-overlay-10 px-2 py-1.5` + `font-mono uppercase text-text-secondary`.
- `Messages.tsx` Tooltip content `<p className="text-accent">Reasoning</p>` etc. → `text-text-tertiary`.
- Keep ALL logic (the `useRecallMessage`, `AgentMessageWrapper` conditional rendering, `memo`, streaming flags) byte-identical.

- [ ] **Step 2: Verify each file (per-file old-token grep → ZERO)**

```bash
cd /Users/taowen/project/narratox && grep -rnE "(^|[^-])(bg-brand|bg-background|bg-background-secondary|bg-primary|text-primary|text-muted|text-secondary|text-accent|text-brand|border-primary|border-white/20|border-white/10|font-dmmono|font-geist|focus:bg-accent)([^a-z-]|$)" agent-ui/src/components/chat/ChatArea/Messages agent-ui/src/components/chat/ChatArea/ChatInput agent-ui/src/components/chat/ChatArea/ScrollToBottom.tsx
```
Expected: ZERO. (`bg-destructive`/`text-success` allowed.)

- [ ] **Step 3: Commit**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm validate
cd /Users/taowen/project/narratox && git add agent-ui/src/components/chat && git commit -m "feat(agent-ui): reskin chat tree to new tokens (Wave 2B)"
```

---

## Task 2 (Unit B): MarkdownRenderer + tooltip reskin

**Files:** the 4 files above.

- [ ] **Step 1: Apply the recipe to each**

`activities.tsx` is the heaviest — `Collapsible` (`bg-background-secondary/40`→`bg-overlay-6`, `text-muted`→`text-text-tertiary`, `text-muted/50`→`text-text-label`, `border-primary/10`→`border-overlay-15`), `DetailBlock` (`text-muted/50`→`text-text-label`, `bg-background/60`→`bg-overlay-6`, `text-muted/80`→`text-text-tertiary`), `StageBlock` (`text-muted/50`→`text-text-label`, `bg-primary/10`→`bg-overlay-10`), ThinkBlock/ToolBlock inner (`text-muted/80`→`text-text-tertiary`, `text-muted/60`→`text-text-label`). Keep ALL the remark/sanitize/context logic + collapse state byte-identical.
`inlineStyles.tsx` + `styles.tsx`: apply recipe to className tokens only (these style inline code/links/code-blocks — keep the markdown rendering logic).
`tooltip.tsx`: apply recipe (it's a Radix tooltip wrapper — `bg-background`/`text-primary`/`border-primary` etc. → new).

- [ ] **Step 2: Verify (per-file grep → ZERO)**

```bash
cd /Users/taowen/project/narratox && grep -rnE "(^|[^-])(bg-brand|bg-background|bg-background-secondary|bg-primary|text-primary|text-muted|text-secondary|text-accent|text-brand|border-primary|border-white/20|border-white/10|font-dmmono|font-geist|focus:bg-accent)([^a-z-]|$)" agent-ui/src/components/ui/typography/MarkdownRenderer agent-ui/src/components/ui/tooltip/tooltip.tsx
```
Expected: ZERO.

- [ ] **Step 3: Commit**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm validate
cd /Users/taowen/project/narratox && git add agent-ui/src/components/ui/typography/MarkdownRenderer agent-ui/src/components/ui/tooltip/tooltip.tsx && git commit -m "feat(agent-ui): reskin MarkdownRenderer + tooltip to new tokens (Wave 2B)"
```

---

## Task 3: Wave 2B gate

- [ ] **Step 1: Full gate**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm validate
```

- [ ] **Step 2: Wave 2B surface old-token grep (expect ZERO)**

```bash
cd /Users/taowen/project/narratox && grep -rnE "(^|[^-])(bg-brand|bg-background|bg-background-secondary|bg-primary|text-primary|text-muted|text-secondary|text-accent|text-brand|border-primary|border-white/20|border-white/10|font-dmmono|font-geist|focus:bg-accent)([^a-z-]|$)" agent-ui/src/components/chat agent-ui/src/components/ui/typography/MarkdownRenderer agent-ui/src/components/ui/tooltip
```
Expected: ZERO. (workspace/views + dissect still have old tokens — 2C/Wave 3.)

- [ ] **Step 3: SSR/compile**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm dev > /tmp/w2b-dev.log 2>&1 &
sleep 18
curl -s -o /dev/null -w "/login HTTP %{http_code}\n" http://localhost:3000/login
grep -iE "error|cannot|undefined|failed|✗ Compilation" /tmp/w2b-dev.log | head || echo "no errors ✓"
pkill -f "next dev" 2>/dev/null || true
```

- [ ] **Step 4: Commit formatting fixes + mark 2B complete**

```bash
cd /Users/taowen/project/narratox && git add -u && git diff --cached --quiet || git commit -m "style(agent-ui): prettier fixes (Wave 2B gate)"
```

Wave 2B done when: validate green; chat + MarkdownRenderer + tooltip grep clean; SSR clean. Next: Wave 2C (the 10 ResourcePanel views → frames).

---

## Self-Review (completed)

- **Spec coverage:** chat tree + MarkdownRenderer + tooltip reskin (Wave 2 spec §2 2B) → Tasks 1-2. **ActivityRow adoption DROPPED** (revision: chat's ThinkBlock/ToolBlock/StageBlock are rich collapsibles, not flat rows — adopting ActivityRow = regression; documented in Architecture). Gate → Task 3. `tooltip` + `MarkdownRenderer` (deferred from Wave 1C) now done.
- **Placeholder scan:** recipe-driven (the mapping table IS the spec for each file). Special cases (MessageItem recall button, ToolComponent, Tooltip labels) called out with concrete guidance. No TBD.
- **Type consistency:** no API/prop changes (className-only). RecallConfirmDialog button variant guidance given. `font-dmmono`→`font-mono` (Tailwind built-in). Opacity variants mapped to solid tokens (no `/NN` on bare-var new tokens). Functional colors preserved.
```
```
