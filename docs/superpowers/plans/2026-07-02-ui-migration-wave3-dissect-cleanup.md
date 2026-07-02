# UI Migration — Wave 3: Dissect + Old-Token Cleanup (FINALE)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** (1) Reskin the dissect route (`DissectPage.tsx`) to new tokens. (2) Eliminate the old token system entirely — delete the temp `/dev/tokens` page, the now-dead `ActivityRow` primitive, all old-token DEFINITIONS from `tailwind.config.ts` + `globals.css`, and the dead Geist/DM_Mono fonts. After Wave 3, the app is 100% on the new design system.

**Architecture:** DissectPage reskin = recipe-driven (same as 2B/2C). Cleanup follows a strict dependency chain: migrate every last consumer BEFORE deleting its definition. The gate is a whole-app old-token grep returning ZERO.

**Spec:** [Wave 2 execution design §5](../specs/2026-07-02-ui-migration-wave2-design.md) (Wave 3 = dissect + old-token-def cleanup).

**⚠ Opacity footgun:** bare-var tokens — no `/NN`; map to solid.

---

## Token recipe (same as 2B/2C)
`bg-background`→`bg-bg-card`; `bg-background-secondary`→`bg-bg-cardElevated`; `bg-background/80`→`bg-bg-darkest`; `bg-background/60`→`bg-overlay-6`; `bg-primary`→`bg-accent-primary`; `bg-primary/80`→(hover) `bg-accent-indigoLight`; `bg-accent`(flat)→`bg-overlay-10`; `bg-brand`→`bg-accent-primary`(or Button); `bg-brand/20`→`bg-accent-primarySoft`; `text-primary`→`text-text-primary`; `text-background`→`text-white`(on accent bg); `text-muted`→`text-text-tertiary`; `text-muted/90`→`text-text-tertiary`; `text-muted/70`/`/50`→`text-text-label`; `text-brand`→`text-accent-indigoLight`; `border-primary/10`→`border-overlay-15`; `focus:border-brand/40`→`focus:border-accent-indigoLight`; functional colors stay. **Do NOT force ActivityRow** (LogDrawer needs error/info variants it lacks — token-swap only).

---

## Task 1: Reskin `DissectPage.tsx`

**File:** `src/components/dissect/DissectPage.tsx` (786L, 26 old-token spots). Read it, apply the recipe. Keep ALL logic (upload, book list, LogDrawer stream-reader `handleActivity`/`ActDelta` accumulation, ResultBrowser grouping) byte-identical. Migrate the 26 spots (page shell L172, h1 L176, upload button L184 → `<Button variant="gradient">`, book cards L210, status pills L33-34 → `<Badge>`, LogDrawer level-color map L658-661, ResultBrowser L714-736, etc.).

- [ ] `pnpm validate`; old-token grep on DissectPage.tsx → ZERO; commit `feat(agent-ui): reskin dissect route to new tokens (Wave 3)`.

## Task 2: Paragraph `mono` → `font-mono`

**File:** `src/components/ui/typography/Paragraph/constants.ts` L11 — change `font-dmmono` → `font-mono` (Tailwind built-in mono stack). (Removes the last `font-dmmono` consumer.)

- [ ] `pnpm validate`; commit `refactor(agent-ui): Paragraph mono variant → font-mono (Wave 3 cleanup)`.

## Task 3: Scrollbar off old `border` token

**File:** `src/app/globals.css` — the scrollbar-thumb `@apply bg-border` (in the `::-webkit-scrollbar-thumb` rule) → `@apply bg-overlay-10`. (Frees the old `border` token for deletion.)

- [ ] `pnpm validate`; commit `refactor(agent-ui): scrollbar → bg-overlay-10 (free old border token) (Wave 3)`.

## Task 4: Delete temp `/dev/tokens` page

**File:** delete `src/app/dev/tokens/page.tsx` (temp Wave 0 showcase, always planned for Wave 3 deletion). Confirm no imports elsewhere first.

- [ ] `grep -rl "dev/tokens" src` (expect zero references after delete); `git rm src/app/dev/tokens/page.tsx`; remove the empty `src/app/dev/` dir if empty; commit `chore(agent-ui): delete temp /dev/tokens showcase (Wave 3 cleanup)`.

## Task 5: Delete dead `ActivityRow` primitive

**Files:** `git rm src/components/ui/activity-row.tsx`. FIRST confirm zero consumers: `grep -rl "components/ui/activity-row" src` → must be ZERO (its only consumer was `/dev/tokens`, deleted in Task 4). If zero, delete; commit `chore(agent-ui): delete unused ActivityRow primitive (Wave 3 cleanup)`.

## Task 6: Delete old-token DEFINITIONS from `tailwind.config.ts`

**File:** `tailwind.config.ts` — from the `// ===== OLD flat tokens =====` block, DELETE: `primary`, `primaryAccent`, `brand`, `background` (DEFAULT + secondary), `secondary`, `border`, `muted`, `positive`, AND the `DEFAULT: '#27272A'` key from the nested `accent` object (keep `accent.primary`/`primarySoft`/etc.). Also delete `fontFamily.geist` + `fontFamily.dmmono` (consumers gone after Tasks 2/4). Keep the new nested namespace + functional colors + `fontFamily.inter`/`sans` + radius scale intact.

- [ ] AFTER editing, run the whole-app old-token grep (Task 9) — if ANY usage remains, the deletion broke it (a class no longer resolves → re-add the def or fix the usage). `pnpm validate` (tsc won't catch Tailwind class typos, but confirms no TS breakage). Commit `chore(agent-ui): delete old flat token definitions (Wave 3 finale)`.

## Task 7: Delete `--color-border-default` + dead fonts from globals + layout

**Files:** `globals.css` (delete `--color-border-default` from the first `:root` — keep `--scrollbar-width`); `layout.tsx` (delete the `Geist` import + `geistSans` const + its `.variable` from body className; delete the `DM_Mono` import + `dmMono` const + its `.variable` from body className — keep `Inter`).

- [ ] `pnpm validate`; commit `chore(agent-ui): remove dead Geist/DM_Mono fonts + --color-border-default (Wave 3)`.

## Task 8: Wave 3 gate (FINALE)

- [ ] `pnpm validate` green.
- [ ] **Whole-app old-token USAGE grep → ZERO:**
  ```bash
  grep -rnE "(^|[^-])\b(bg-brand|bg-background|bg-background-secondary|bg-primary|bg-secondary|text-primary|text-primaryAccent|bg-primaryAccent|text-muted|text-secondary|text-accent|text-brand|border-primary|border-white/20|border-white/10|font-dmmono|font-geist)([/0-9]*)([^a-zA-Z-]|$)" src --include="*.tsx" --include="*.ts"
  ```
  Expected: ZERO. (If any match, that's a missed migration — fix before declaring done.)
- [ ] Old-token DEFINITIONS gone: `grep -nE "brand:|primary:|background:|muted:|positive:|primaryAccent:|secondary:" tailwind.config.ts` → only the NEW nested defs (bg.base etc.), no flat old ones.
- [ ] SSR: `/login` + `/dissect` + `/` compile clean.
- [ ] **🎉 UI Migration COMPLETE — the app is 100% on the new design system; the old token system is fully eliminated.**

---

## Self-Review (completed)
- **Spec coverage:** dissect reskin (Wave 2 spec §5) → Task 1. Old-token-def cleanup (migration strategy spec §4 Wave 3) → Tasks 2-7. `/dev/tokens` deletion (Wave 0 plan, always planned for Wave 3) → Task 4. ActivityRow deletion (dead after /dev/tokens; YAGNI) → Task 5. Geist/DM_Mono (dead after Paragraph mono remap) → Tasks 2+7. Gate → Task 8.
- **Dependency chain is explicit** (migrate consumers BEFORE deleting defs): Task 2 (Paragraph) before 6/7 (font defs); Task 3 (scrollbar) before 6 (border def); Task 4 (/dev/tokens) before 5 (ActivityRow); Task 1 (dissect) before 6 (all old tokens).
- **Placeholder scan:** DissectPage task procedural (implementer reads 786L fresh); cleanup tasks exact. Whole-app gate is the safety net. No TBD.
- **Risk:** deleting defs is irreversible-in-spirit but git-reversible + gated by the whole-app grep. If a missed usage exists, the class silently no-ops (Tailwind drops unknown classes) — the gate grep catches it pre-merge.
```
```
