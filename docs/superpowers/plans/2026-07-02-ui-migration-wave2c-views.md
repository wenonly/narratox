# UI Migration — Wave 2C: 10 ResourcePanel Views Reskin

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Goal:** Reskin the 10 ResourcePanel views (8 extracted in 2A + ReferencesView + VoiceProfileView) to new tokens + adopt `Card`/`Badge`/`CollapsibleCard` where the view has cards/lists/badges/collapsibles. Aligns to Pencil frames 23-30 + Info.

**Architecture:** Recipe-driven token reskin (same mapping as Wave 2B) + primitive adoption where it fits naturally. **Logic/data-fetching/hooks untouched** — className + primitive swaps only. Pixel-perfect frame matching deferred to user final review (needs auth+data visual).

**Spec:** [Wave 2 execution design](../specs/2026-07-02-ui-migration-wave2-design.md).

**⚠ Opacity footgun:** bare-var tokens — no `/NN`. Map old `/NN` to solid tokens (`text-muted/50`→`text-text-label`, etc.) or overlay tokens.

---

## Token recipe (same as 2B — apply to className only)
`bg-background`→`bg-bg-card`; `bg-background-secondary`→`bg-bg-cardElevated`; `bg-background/80`→`bg-bg-darkest`; `bg-background/*`→`bg-overlay-*`; `bg-primary`→`bg-accent-primary`; `bg-primary/10`→`bg-overlay-10`; `bg-accent`(flat)→`bg-overlay-10`; `bg-brand`→`bg-accent-primary`(or Button variant); `bg-brand/*`→`bg-accent-primarySoft`; `text-primary`→`text-text-primary`; `text-primary/80`→`text-text-secondary`; `text-primary/40`→`text-text-label`; `text-muted`→`text-text-tertiary`; `text-muted/80`→`text-text-tertiary`; `text-muted/60`/`/50`→`text-text-label`; `text-secondary`→`text-text-secondary`; `text-accent`→`text-text-tertiary`; `text-brand`→`text-accent-indigoLight`; `border-primary/10`→`border-overlay-15`; `border-primary/5`→`border-overlay-10`; `border-white/20`→`border-overlay-15`; `border-white/10`→`border-overlay-10`; `font-dmmono`→`font-mono`; `font-geist`→`font-sans`; `focus:bg-accent`→`focus:bg-overlay-10`. Functional colors stay.

## Primitive adoption (where it fits, judgment per view)
- **`Card`**: a view's outer container that's a `rounded-xl border border-... bg-background-secondary p-4` → consider `Card` (or keep inline with new tokens — either is fine; prefer `Card` for the main container).
- **`Badge`**: status pills / role tags / significance markers (`bg-brand/15 text-brand` / `bg-accent text-muted` / `rounded px-2 py-0.5 text-[10px]`) → `<Badge variant="...">`.
- **`CollapsibleCard`**: a view with collapsible entries (worldview entries by type, character profiles, outline nodes) — IF the view currently has its own inline collapse toggle that matches CollapsibleCard's pattern (title + chevron + expand), adopt it; if the collapse logic is bespoke/complex, leave it + just rewire tokens (don't force a behavior change).
- **`Button variant="..."`**: raw `<button className="bg-brand...">` CTAs → `<Button>`.

**Do NOT refactor data-fetching or change behavior.** When in doubt, token-swap only (skip primitive adoption) — the user reviews per-view at the end.

---

## Files (2 units)

**Unit 1 (4 bigger views):** `workspace/views/{ChaptersView,OutlineView,CharactersView,EventsView}.tsx`
**Unit 2 (6 views):** `workspace/views/{WorldviewView,HooksView,OverviewView,InfoView}.tsx` + `workspace/{ReferencesView,VoiceProfileView}.tsx`

---

## Task 1 (Unit 1): 4 bigger views

- [ ] Read each, apply recipe + primitive adoption. ChaptersView is biggest (chapter list + write state) — keep ALL chapter-write/skeleton/publish logic intact. OutlineView (volumes/arcs/master outline) — keep toggle/Set logic. CharactersView (role groups + change timeline) — keep PROFILE_FIELDS/changes rendering. EventsView (timeline + significance) — keep sort/filter.
- [ ] `pnpm validate`; old-token grep on the 4 files → ZERO; commit `feat(agent-ui): reskin Chapters/Outline/Characters/Events views (Wave 2C)`.

## Task 2 (Unit 2): 6 views

- [ ] Read each, apply recipe + primitive adoption. WorldviewView (entries by type) + HooksView (resolved/unresolved) + OverviewView (coverage stats) + InfoView (novel info) + ReferencesView (markdown reader) + VoiceProfileView (profile markdown). Keep all data logic.
- [ ] `pnpm validate`; old-token grep on the 6 files → ZERO; commit `feat(agent-ui): reskin World/Hooks/Overview/Info/References/VoiceProfile views (Wave 2C)`.

## Task 3: Wave 2C gate

- [ ] `pnpm validate` green.
- [ ] old-token grep `workspace/views/` + `workspace/ReferencesView.tsx` + `workspace/VoiceProfileView.tsx` → ZERO.
- [ ] Whole-workspace old-token grep: `workspace/` + `chat/` + `app/novels` → ZERO (Wave 2 done; only dissect remains).
- [ ] SSR/compile clean.
- [ ] **Wave 2 complete** → Wave 3 (dissect + old-token-def cleanup).

---

## Self-Review (completed)
- **Spec coverage:** 10 views reskin (Wave 2 spec §2 2C) → Tasks 1-2. Primitive adoption (Card/Badge/CollapsibleCard) per the spec's "新原子" intent, bounded to where it fits without behavior change. Gate → Task 3. Pixel-perfect frame matching deferred (visual needs auth+data).
- **Placeholder scan:** recipe + primitive guidance are concrete; per-view behavior-preservation constraints called out (ChaptersView write logic, OutlineView toggles, etc.). No TBD.
- **Type consistency:** className + primitive swaps only; no API/prop changes. Opacity variants → solid tokens. CollapsibleCard adoption only where the existing pattern matches (no forced refactor).
```
```
