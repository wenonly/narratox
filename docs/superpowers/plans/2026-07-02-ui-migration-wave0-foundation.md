# UI Migration — Wave 0: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the design-token foundation (Inter font, CSS-variable token layer, Tailwind nested namespace, glass utilities) and the 4 net-new atomic primitives (`Card` / `Badge` / `ActivityRow` / `CollapsibleCard`) — without touching any route — so Waves 1-3 can reskin routes against a stable token + primitive layer.

**Architecture:** New tokens are introduced as CSS variables in `globals.css` (spec-exact names) and mapped into a NEW nested Tailwind color namespace (`bg.*` / `accent.*` / `text.*` / `overlay.*`). Old flat tokens (`brand #FF4017`, `background`, `primary`…) are left 100% untouched — both systems coexist until Wave 3 greps them out. Net-new primitives are built on the new namespace; existing primitives (`button`/`input`/`dialog`/…) stay on old tokens and are migrated as each route adopts them in Waves 1-3. A temporary `/dev/tokens` page renders every token + primitive for visual verification and is deleted in Wave 3.

**Tech Stack:** Next.js 15 (App Router) + React 18 + Tailwind v3.4 + `next/font/google` (Inter) + `class-variance-authority` + `clsx` + `tailwind-merge` + `lucide-react`. Existing `cn()` helper at `agent-ui/src/lib/utils.ts`.

**Spec:** [2026-07-02-ui-migration-strategy-design.md](../specs/2026-07-02-ui-migration-strategy-design.md). Token values (authoritative): [2026-07-02-ui-redesign-design.md §1](../specs/2026-07-02-ui-redesign-design.md) (the "Token Spec").

**Verification note:** `agent-ui` has NO test runner. Quality gate = `pnpm validate` (lint + prettier + typecheck). Each task below verifies via `pnpm typecheck` (fast) and the `/dev/tokens` page (visual). There are no jest/vitest steps — this is intentional, not an omission.

---

## Namespace decision (resolved here, do not re-litigate in tasks)

Tailwind nested color keys mirror the Token Spec group names **exactly**:
- `colors.bg.{base, darkest, dark, card, cardElevated, raised}` → utilities `bg-bg-base`, `bg-bg-card`, …
- `colors.accent.{primary, primarySoft, indigoLight, indigoPale, violet, violetLight, violetPale, violetMid}` → `bg-accent-primary`, `text-accent-violet`, …
- `colors.text.{primary, bright, body, secondary, tertiary, label, muted, dim, accent, accentLink}` → `text-text-primary`, `text-text-label`, … (the `text-text-*` double prefix is ugly but grep-traceable to the spec; an alias task is deferred — accept it)
- `colors.overlay.{5, 6, 10, 15}` → `bg-overlay-10`, `border-overlay-15`, …
- functional colors `success` / `warning` / `warningText` / `destructive` / `info` at top level

CSS variables use the spec-exact names (`--bg-base`, `--accent-primary`, `--text-primary`, `--overlay-10`). Tailwind color values reference them (`bg: { base: 'var(--bg-base)' }`).

---

## File Structure

- **Modify** `agent-ui/src/app/layout.tsx` — add Inter via `next/font/google`, apply `--font-inter` variable to `<body>` alongside existing Geist + DM Mono.
- **Modify** `agent-ui/src/app/globals.css` — add `:root` token variables + `.glass-panel` / `.bg-gradient-brand` / `.text-gradient-brand` utilities. Old `:root` / `.input-base` untouched.
- **Modify** `agent-ui/tailwind.config.ts` — ADD nested `bg` / `accent` / `text` / `overlay` color groups + `radius` scale + `fontFamily.inter`. Old flat colors untouched.
- **Create** `agent-ui/src/components/ui/card.tsx` — `Card`, `CardHeader`, `CardTitle`, `CardContent` (new-token namespace).
- **Create** `agent-ui/src/components/ui/badge.tsx` — `Badge` with `accent` / `neutral` / `success` / `warning` / `destructive` variants (cva).
- **Create** `agent-ui/src/components/ui/activity-row.tsx` — `ActivityRow` with `think` / `tool` / `content` / `stage` variants (cva) — chat + dissect log shared.
- **Create** `agent-ui/src/components/ui/collapsible-card.tsx` — `CollapsibleCard` (collapsed/expanded, used by worldview/outline/characters in Wave 2).
- **Create** `agent-ui/src/app/dev/tokens/page.tsx` — temporary token + primitive showcase. **Deleted in Wave 3.**

---

## Task 1: Add Inter font

**Files:**
- Modify: `agent-ui/src/app/layout.tsx`

- [ ] **Step 1: Add the Inter font import and variable**

Open `agent-ui/src/app/layout.tsx`. After the existing `DM_Mono` const (line ~16), add an `Inter` const, and add `inter.variable` to the `<body>` className.

Replace lines 1-16 and the `<body>` line so the file becomes:

```tsx
import type { Metadata } from 'next'
import { DM_Mono, Geist, Inter } from 'next/font/google'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'
const geistSans = Geist({
  variable: '--font-geist-sans',
  weight: '400',
  subsets: ['latin']
})

const dmMono = DM_Mono({
  subsets: ['latin'],
  variable: '--font-dm-mono',
  weight: '400'
})

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap'
})

export const metadata: Metadata = {
  title: 'Agent UI',
  description:
    'A modern chat interface for AI agents built with Next.js, Tailwind CSS, and TypeScript. This template provides a ready-to-use UI for interacting with Agno agents.'
}

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${geistSans.variable} ${dmMono.variable} antialiased`}
      >
        <NuqsAdapter>{children}</NuqsAdapter>
        <Toaster />
      </body>
    </html>
  )
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd agent-ui && pnpm typecheck`
Expected: PASS (no errors). Inter is a valid `next/font/google` export.

- [ ] **Step 3: Commit**

```bash
git add agent-ui/src/app/layout.tsx
git commit -m "feat(agent-ui): add Inter font via next/font (Wave 0 foundation)"
```

---

## Task 2: Add CSS-variable token layer + utilities to globals.css

**Files:**
- Modify: `agent-ui/src/app/globals.css`

- [ ] **Step 1: Append the token variables and utilities**

The existing `globals.css` content stays. Append the following at the end of the file (after the existing `@layer components { .input-base { ... } }` block):

```css
/* ============================================================ */
/* Wave 0 design tokens — Token Spec §1 (2026-07-02-ui-redesign) */
/* Spec-exact CSS variable names. Old tokens above are untouched. */
/* ============================================================ */
:root {
  /* bg — Token Spec §1.1 背景层级 */
  --bg-base: #0a0a0b;
  --bg-darkest: #0f0f13;
  --bg-dark: #13131a;
  --bg-card: #1a1a22;
  --bg-card-elevated: #2a2a35;
  --bg-raised: #252530;

  /* overlay — Token Spec §1.1 覆盖层 */
  --overlay-5: #ffffff0a;
  --overlay-6: #ffffff08;
  --overlay-10: #ffffff0f;
  --overlay-15: #ffffff14;

  /* accent — Token Spec §1.1 主色调 (Indigo → Violet) */
  --accent-primary: #6366f1;
  --accent-primary-soft: #6366f126;
  --accent-indigo-light: #818cf8;
  --accent-indigo-pale: #a5b4fc;
  --accent-violet: #8b5cf6;
  --accent-violet-light: #a78bfa;
  --accent-violet-pale: #c4b5fd;
  --accent-violet-mid: #9d85ff;

  /* text — Token Spec §1.1 文字颜色 */
  --text-primary: #ffffff;
  --text-bright: #fafafa;
  --text-body: #e8e8ec;
  --text-secondary: #d4d4d8;
  --text-tertiary: #a1a1aa;
  --text-label: #71717a;
  --text-muted: #e2e2e8;
  --text-dim: #ffffff80;
  --text-accent: #a78bfa;
  --text-accent-link: #818cf8;

  /* functional — Token Spec §1.1 功能色 */
  --success: #22c55e;
  --warning: #f59e0b;
  --warning-text: #fbbf24;
  --destructive: #e53935;
  --info: #60a5fa;

  /* brand gradient — Token Spec §1.8 */
  --gradient-brand: linear-gradient(90deg, #6366f1 0%, #8b5cf6 100%);
}

@layer components {
  /* Glass morphism — Token Spec §1.7. Use only on panels/dialogs. */
  .glass-panel {
    background-color: rgba(19, 19, 26, 0.72);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    box-shadow: 0 4px 24px #00000080;
  }

  /* Brand gradient helpers — Token Spec §1.8 */
  .bg-gradient-brand {
    background-image: var(--gradient-brand);
  }
  .text-gradient-brand {
    background-image: var(--gradient-brand);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
}
```

- [ ] **Step 2: Verify it builds (lint pass)**

Run: `cd agent-ui && pnpm lint`
Expected: PASS (CSS edits don't break ESLint; no warnings introduced).

- [ ] **Step 3: Commit**

```bash
git add agent-ui/src/app/globals.css
git commit -m "feat(agent-ui): add design-token CSS variables + glass/gradient utilities (Wave 0)"
```

---

## Task 3: Add Tailwind nested color namespace + radius scale

**Files:**
- Modify: `agent-ui/tailwind.config.ts`

- [ ] **Step 1: Add nested color groups, radius scale, and Inter font family**

Open `agent-ui/tailwind.config.ts`. Inside `theme.extend.colors`, ADD the new nested groups (do NOT remove or rename the existing flat `primary`/`brand`/`background`/etc.). Also extend `borderRadius` and `fontFamily`.

The full file after edit:

```ts
import type { Config } from 'tailwindcss'
import tailwindcssAnimate from 'tailwindcss-animate'

export default {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}'
  ],
  theme: {
    extend: {
      colors: {
        // ===== OLD flat tokens (untouched — removed in Wave 3) =====
        primary: '#FAFAFA',
        primaryAccent: '#18181B',
        brand: '#FF4017',
        background: {
          DEFAULT: '#111113',
          secondary: '#27272A'
        },
        secondary: '#f5f5f5',
        border: 'rgba(var(--color-border-default))',
        accent: '#27272A',
        muted: '#A1A1AA',
        destructive: '#E53935',
        positive: '#22C55E',

        // ===== NEW design-token namespace (Wave 0) — Token Spec §1 =====
        bg: {
          base: 'var(--bg-base)',
          darkest: 'var(--bg-darkest)',
          dark: 'var(--bg-dark)',
          card: 'var(--bg-card)',
          cardElevated: 'var(--bg-card-elevated)',
          raised: 'var(--bg-raised)'
        },
        overlay: {
          5: 'var(--overlay-5)',
          6: 'var(--overlay-6)',
          10: 'var(--overlay-10)',
          15: 'var(--overlay-15)'
        },
        accent: {
          // NOTE: the flat `accent: '#27272A'` above is the OLD token and
          // stays until Wave 3. Tailwind v3 resolves `bg-accent` to the flat
          // string; the nested `bg-accent-primary` etc. resolve to the new
          // vars. Both coexist.
          primary: 'var(--accent-primary)',
          primarySoft: 'var(--accent-primary-soft)',
          indigoLight: 'var(--accent-indigo-light)',
          indigoPale: 'var(--accent-indigo-pale)',
          violet: 'var(--accent-violet)',
          violetLight: 'var(--accent-violet-light)',
          violetPale: 'var(--accent-violet-pale)',
          violetMid: 'var(--accent-violet-mid)'
        },
        text: {
          primary: 'var(--text-primary)',
          bright: 'var(--text-bright)',
          body: 'var(--text-body)',
          secondary: 'var(--text-secondary)',
          tertiary: 'var(--text-tertiary)',
          label: 'var(--text-label)',
          muted: 'var(--text-muted)',
          dim: 'var(--text-dim)',
          accent: 'var(--text-accent)',
          accentLink: 'var(--text-accent-link)'
        },
        success: 'var(--success)',
        warning: 'var(--warning)',
        warningText: 'var(--warning-text)',
        info: 'var(--info)'
      },
      fontFamily: {
        geist: 'var(--font-geist-sans)',
        dmmono: 'var(--font-dm-mono)',
        inter: 'var(--font-inter)',
        // default body font for new/migrated UI is Inter
        sans: 'var(--font-inter)'
      },
      borderRadius: {
        // keep existing
        xl: '10px',
        // Token Spec §1.4 radius scale
        micro: '3px',
        sm: '4px',
        md: '6px',
        lg: '8px',
        input: '10px',
        dialog: '14px',
        '2xl': '16px',
        special: '20px',
        pill: '100px'
      }
    }
  },
  plugins: [tailwindcssAnimate]
} satisfies Config
```

> **Why this works despite the flat `accent`/`destructive` collision:** Tailwind v3 merges flat and nested under the same key. The flat `accent: '#27272A'` is preserved (so legacy `bg-accent` still resolves) and nested `accent.primary` adds `bg-accent-primary`. `destructive` is overwritten to `var(--destructive)` — but `#E53935` === `var(--destructive)` value, so legacy `bg-destructive` renders identically. Same for `success`/`positive` (both `#22C55E`).

- [ ] **Step 2: Verify typecheck + that the dev server compiles tokens**

Run: `cd agent-ui && pnpm typecheck`
Expected: PASS.

Then start the dev server in the background to confirm Tailwind compiles without errors:

```bash
cd agent-ui && timeout 25 pnpm dev > /tmp/wave0-dev.log 2>&1 || true
grep -iE "error|invalid|cannot" /tmp/wave0-dev.log || echo "no compile errors"
```

Expected: prints `no compile errors` (the `timeout` kill is expected; we only check the log).

- [ ] **Step 3: Commit**

```bash
git add agent-ui/tailwind.config.ts
git commit -m "feat(agent-ui): add nested design-token color namespace + radius scale (Wave 0)"
```

---

## Task 4: Create the `Card` primitive

**Files:**
- Create: `agent-ui/src/components/ui/card.tsx`

- [ ] **Step 1: Create the file**

```tsx
import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Card — Token Spec §3.3. Dark elevated surface for grouping content.
 * Built on the new token namespace (bg-bg-card / border-overlay-15).
 */
const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'rounded-lg border border-overlay-15 bg-bg-card text-text-primary',
      className
    )}
    {...props}
  />
))
Card.displayName = 'Card'

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex flex-col gap-1.5 p-4', className)}
    {...props}
  />
))
CardHeader.displayName = 'CardHeader'

const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn('text-base font-semibold text-text-primary', className)}
    {...props}
  />
))
CardTitle.displayName = 'CardTitle'

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('p-4 pt-0', className)} {...props} />
))
CardContent.displayName = 'CardContent'

export { Card, CardHeader, CardTitle, CardContent }
```

- [ ] **Step 2: Verify typecheck**

Run: `cd agent-ui && pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add agent-ui/src/components/ui/card.tsx
git commit -m "feat(agent-ui): add Card primitive on new token namespace (Wave 0)"
```

---

## Task 5: Create the `Badge` primitive (Tag)

**Files:**
- Create: `agent-ui/src/components/ui/badge.tsx`

- [ ] **Step 1: Create the file**

```tsx
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/**
 * Badge / Tag — Token Spec §3.6. Pill-shaped label.
 * Variants: accent / neutral / success / warning / destructive.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap',
  {
    variants: {
      variant: {
        accent: 'bg-accent-primarySoft text-accent-violetLight',
        neutral: 'bg-overlay-10 text-text-tertiary',
        success: 'bg-success/15 text-success',
        warning: 'bg-warning/15 text-warningText',
        destructive: 'bg-destructive/15 text-destructive'
      }
    },
    defaultVariants: {
      variant: 'neutral'
    }
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
```

> **Note on `bg-success/15`:** Tailwind v3 supports opacity modifiers on `var()`-backed colors only when the color is defined as a hex/rgb, not a raw `var()`. Because `success`/`warning`/`destructive` resolve to `var(--success)` etc., the `/15` opacity modifier may not apply. **If `pnpm dev` shows the badge background as fully solid**, change those three lines to explicit alpha hexes from the Token Spec §3.6: `success: 'bg-[#22C55E20] text-success'`, `warning: 'bg-[#F59E0B20] text-warningText'`, `destructive: 'bg-[#E5393520] text-destructive'`. Verify visually on `/dev/tokens` (Task 8) and pick whichever renders correctly.

- [ ] **Step 2: Verify typecheck**

Run: `cd agent-ui && pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add agent-ui/src/components/ui/badge.tsx
git commit -m "feat(agent-ui): add Badge primitive (Tag) on new token namespace (Wave 0)"
```

---

## Task 6: Create the `ActivityRow` primitive

**Files:**
- Create: `agent-ui/src/components/ui/activity-row.tsx`

- [ ] **Step 1: Create the file**

```tsx
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/**
 * ActivityRow — Token Spec §3.8. A single streamed activity line in chat
 * or the dissect log drawer. Variants color-code the activity kind:
 *   think (purple) / tool (blue) / content (brand/white) / stage (brand).
 * Shared by chat Messages (Wave 2) and dissect LogDrawer (Wave 3).
 */
const activityRowVariants = cva(
  'flex items-start gap-2 rounded-lg bg-overlay-6 px-3 py-2.5',
  {
    variants: {
      variant: {
        think: '',
        tool: '',
        content: 'bg-transparent px-0 py-1',
        stage: ''
      }
    },
    defaultVariants: {
      variant: 'content'
    }
  }
)

const labelClassByVariant: Record<NonNullable<ActivityRowProps['variant']>, string> = {
  think: 'text-accent-violetLight',
  tool: 'text-info',
  content: 'text-text-label',
  stage: 'text-accent-indigo-light'
}

const labelTextByVariant: Record<NonNullable<ActivityRowProps['variant']>, string> = {
  think: 'think',
  tool: 'tool',
  content: '',
  stage: 'stage'
}

export interface ActivityRowProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'>,
    VariantProps<typeof activityRowVariants> {
  label?: string
  children?: React.ReactNode
}

function ActivityRow({
  className,
  variant = 'content',
  label,
  children,
  ...props
}: ActivityRowProps) {
  const resolvedVariant = variant ?? 'content'
  const labelText = label ?? labelTextByVariant[resolvedVariant]
  return (
    <div className={cn(activityRowVariants({ variant }), className)} {...props}>
      {labelText ? (
        <span
          className={cn(
            'shrink-0 text-[11px] font-semibold uppercase tracking-wide',
            labelClassByVariant[resolvedVariant]
          )}
        >
          {labelText}
        </span>
      ) : null}
      <div className="min-w-0 flex-1 text-[11px] leading-relaxed text-text-tertiary">
        {children}
      </div>
    </div>
  )
}

export { ActivityRow, activityRowVariants }
```

- [ ] **Step 2: Verify typecheck**

Run: `cd agent-ui && pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add agent-ui/src/components/ui/activity-row.tsx
git commit -m "feat(agent-ui): add ActivityRow primitive (chat/dissect shared) (Wave 0)"
```

---

## Task 7: Create the `CollapsibleCard` primitive

**Files:**
- Create: `agent-ui/src/components/ui/collapsible-card.tsx`

- [ ] **Step 1: Create the file**

```tsx
'use client'

import * as React from 'react'
import { ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * CollapsibleCard — Token Spec §3.3衍生. Collapsed shows title + chevron;
 * expanded reveals children. Used by worldview/outline/characters panels
 * (Wave 2). Controlled by internal state; uncontrolled by default.
 */
interface CollapsibleCardProps {
  title: React.ReactNode
  /** Optional right-aligned extra (count badge, actions). */
  extra?: React.ReactNode
  defaultOpen?: boolean
  /** Controlled open state. If omitted, the card manages its own state. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
  className?: string
}

function CollapsibleCard({
  title,
  extra,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  children,
  className
}: CollapsibleCardProps) {
  const isControlled = openProp !== undefined
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen)
  const open = isControlled ? openProp : internalOpen

  const toggle = () => {
    const next = !open
    if (!isControlled) setInternalOpen(next)
    onOpenChange?.(next)
  }

  return (
    <div
      className={cn(
        'rounded-lg border border-overlay-15 bg-bg-card',
        className
      )}
    >
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        <ChevronDown
          className={cn(
            'size-3.5 shrink-0 text-text-label transition-transform',
            open ? '' : '-rotate-90'
          )}
        />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-primary">
          {title}
        </span>
        {extra ? <div className="shrink-0">{extra}</div> : null}
      </button>
      {open ? (
        <div className="border-t border-overlay-10 px-3 py-2.5 text-[12px] text-text-body">
          {children}
        </div>
      ) : null}
    </div>
  )
}

export { CollapsibleCard }
```

- [ ] **Step 2: Verify typecheck**

Run: `cd agent-ui && pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add agent-ui/src/components/ui/collapsible-card.tsx
git commit -m "feat(agent-ui): add CollapsibleCard primitive (Wave 0)"
```

---

## Task 8: Create the temporary `/dev/tokens` verification page

**Files:**
- Create: `agent-ui/src/app/dev/tokens/page.tsx`

- [ ] **Step 1: Create the file**

This page renders every token swatch and every Wave-0 primitive so the design can be verified visually. It is temporary — **deleted in Wave 3**. It is NOT wrapped in `RequireAuth` (it's a dev tool).

```tsx
import {
  ActivityRow,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CollapsibleCard
} from '@/components/ui'

// Note: import paths above assume a barrel export exists. If
// agent-ui/src/components/ui/index.ts does NOT re-export the new primitives,
// import directly:
//   import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
//   import { Badge } from '@/components/ui/badge'
//   import { ActivityRow } from '@/components/ui/activity-row'
//   import { CollapsibleCard } from '@/components/ui/collapsible-card'
// Use whichever form matches the repo's existing convention (check whether
// other files import from '@/components/ui' vs '@/components/ui/button').

const BG_TOKENS: Array<{ name: string; cls: string }> = [
  { name: 'bg.base', cls: 'bg-bg-base' },
  { name: 'bg.darkest', cls: 'bg-bg-darkest' },
  { name: 'bg.dark', cls: 'bg-bg-dark' },
  { name: 'bg.card', cls: 'bg-bg-card' },
  { name: 'bg.cardElevated', cls: 'bg-bg-cardElevated' },
  { name: 'bg.raised', cls: 'bg-bg-raised' }
]

const ACCENT_TOKENS: Array<{ name: string; cls: string }> = [
  { name: 'accent.primary', cls: 'bg-accent-primary' },
  { name: 'accent.primarySoft', cls: 'bg-accent-primarySoft' },
  { name: 'accent.indigoLight', cls: 'bg-accent-indigo-light' },
  { name: 'accent.violet', cls: 'bg-accent-violet' },
  { name: 'accent.violetLight', cls: 'bg-accent-violet-light' }
]

const TEXT_TOKENS: Array<{ name: string; cls: string }> = [
  { name: 'text.primary', cls: 'text-text-primary' },
  { name: 'text.body', cls: 'text-text-body' },
  { name: 'text.secondary', cls: 'text-text-secondary' },
  { name: 'text.tertiary', cls: 'text-text-tertiary' },
  { name: 'text.label', cls: 'text-text-label' },
  { name: 'text.accent', cls: 'text-text-accent' }
]

function Swatch({ name, cls }: { name: string; cls: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`${cls} h-8 w-8 rounded-md border border-overlay-15`} />
      <span className="text-[11px] text-text-tertiary">{name}</span>
    </div>
  )
}

export default function TokensPage() {
  return (
    <main className="min-h-screen bg-bg-base p-8 font-sans text-text-primary">
      <h1 className="mb-1 text-2xl font-bold">
        <span className="text-gradient-brand">Wave 0</span> Token & Primitive
        Showcase
      </h1>
      <p className="mb-8 text-[12px] text-text-label">
        Temporary dev page — deleted in Wave 3.
      </p>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-label">
          Background tokens
        </h2>
        <div className="flex flex-wrap gap-4">
          {BG_TOKENS.map((t) => (
            <Swatch key={t.name} {...t} />
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-label">
          Accent tokens
        </h2>
        <div className="flex flex-wrap gap-4">
          {ACCENT_TOKENS.map((t) => (
            <Swatch key={t.name} {...t} />
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-label">
          Text tokens
        </h2>
        <div className="flex flex-wrap gap-4">
          {TEXT_TOKENS.map((t) => (
            <span key={t.name} className={`${t.cls} text-[12px]`}>
              {t.name}
            </span>
          ))}
        </div>
      </section>

      <section className="mb-8 grid grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Card primitive</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[12px] text-text-body">
              Body text inside a Card. Token Spec §3.3.
            </p>
          </CardContent>
        </Card>
        <div className="rounded-lg glass-panel p-4">
          <p className="text-[12px] text-text-body">
            Glass panel utility (.glass-panel) — blur 20 + shadow 24.
          </p>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-label">
          Badges
        </h2>
        <div className="flex flex-wrap gap-2">
          <Badge variant="accent">accent</Badge>
          <Badge variant="neutral">neutral</Badge>
          <Badge variant="success">success</Badge>
          <Badge variant="warning">warning</Badge>
          <Badge variant="destructive">destructive</Badge>
        </div>
      </section>

      <section className="mb-8 flex flex-col gap-2">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-text-label">
          Activity rows
        </h2>
        <ActivityRow variant="think">
          Considering the chapter outline and whether the hook lands.
        </ActivityRow>
        <ActivityRow variant="tool">get_outline()</ActivityRow>
        <ActivityRow variant="stage">chapter orchestrator</ActivityRow>
        <ActivityRow variant="content">
          第 3 章正文内容,由 writer agent 流式输出……
        </ActivityRow>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-text-label">
          Collapsible card
        </h2>
        <CollapsibleCard title="主角 · 林无忌" extra={<Badge variant="accent">PROTAGONIST</Badge>}>
          外貌 / 性格 / 动机 等 9 字段档案,展开后渲染。
        </CollapsibleCard>
      </section>
    </main>
  )
}
```

- [ ] **Step 2: Resolve the import form for the new primitives**

Check how existing primitives are imported in the repo:

```bash
cd agent-ui && grep -rn "from '@/components/ui'" src --include="*.tsx" | head -3
grep -rn "from '@/components/ui/button'" src --include="*.tsx" | head -3
```

- If there is NO barrel `agent-ui/src/components/ui/index.ts` re-exporting the new primitives, either create one that re-exports `Card`/`Badge`/`ActivityRow`/`CollapsibleCard`, OR switch the page's import to the direct-file form (commented in the file above). Pick the form that matches the majority of existing usages.

- [ ] **Step 3: Verify typecheck**

Run: `cd agent-ui && pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Verify visually**

Run: `cd agent-ui && pnpm dev` then open `http://localhost:3000/dev/tokens` in a browser (this route is public — no auth).

Expected:
- Background swatches render at distinct darkness levels (`bg.base` darkest → `bg.raised` lightest).
- Accent swatches render Indigo→Violet hues.
- Text tokens render at distinct grays; `.text-gradient-brand` title shows the Indigo→Violet gradient.
- `.glass-panel` block shows a blurred translucent surface.
- Badges render pill-shaped, colored per variant. **If any badge background is fully solid (no alpha),** apply the Task 5 Note (swap to explicit `#RRGGBB20` alpha hexes) and reload.
- Activity rows render with colored labels (think=violet, tool=blue, stage=indigo, content=no label).
- Collapsible card expands/collapses on click.

- [ ] **Step 5: Commit**

```bash
git add agent-ui/src/app/dev/tokens/page.tsx
# also add the barrel if you created/modified one:
# git add agent-ui/src/components/ui/index.ts
git commit -m "feat(agent-ui): add temporary /dev/tokens showcase page (Wave 0)"
```

---

## Task 9: Full Wave 0 validation gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full quality gate**

Run: `cd agent-ui && pnpm validate`
Expected: lint ✓ + prettier ✓ + typecheck ✓ (all pass). If prettier fails, run `pnpm format:fix` and re-run `pnpm validate`.

- [ ] **Step 2: Confirm zero route regressions**

Run: `cd agent-ui && pnpm dev` and manually load each existing route once:
- `http://localhost:3000/login`
- `http://localhost:3000/` (library — will redirect to login if no token; that's fine)
- `http://localhost:3000/settings`

Expected: every existing route still renders exactly as before (old tokens untouched). The ONLY visible change app-wide is the body font may now fall back to Inter where Geist was the default — but since `fontFamily.geist` is unchanged and existing components don't use `font-sans`/`font-inter` yet, text should look identical. If any route's typography shifts unexpectedly, confirm no component was using the `font-sans` utility previously.

- [ ] **Step 3: Commit any formatting fixes from Step 1 (if any)**

```bash
git add -u
git diff --cached --quiet || git commit -m "style(agent-ui): prettier fixes from Wave 0 validate gate"
```

- [ ] **Step 4: Mark Wave 0 complete**

Wave 0 is done when:
- `pnpm validate` is green
- `/dev/tokens` renders all tokens + primitives correctly
- Existing routes are visually unchanged
- All 8 prior tasks committed

The output of Wave 0 is a stable token + primitive layer. Wave 1 (AppSidebar + auth/library/knowledge/settings) will be planned in its own doc next.

---

## Self-Review (completed)

- **Spec coverage:** Spec §3.1 token coexistence → Task 2+3 (new vars + nested namespace, old untouched). §3.2 primitives → Tasks 4-7 (Card/Badge/ActivityRow/CollapsibleCard new; existing primitives deferred to route waves by design). §3.1 Inter font → Task 1. §3.1 glass utility → Task 2. §3.3 design↔code sync → `/dev/tokens` (Task 8) is the per-token verification surface. Spec §4 Wave 0 deliverable ("tokens exist, primitives exist, no route changed, validate green") → Task 9 gate. **Gap: existing primitives (Button/Input/Dialog) rewiring** — intentionally deferred to route waves (each route adopts them); called out in Architecture.
- **Placeholder scan:** No TBD/TODO in task steps. Task 5 has a conditional fallback (opacity modifier) with concrete alternative code — not a placeholder, it's a verified branch. Task 8 Step 2 has a "pick the import form" decision with concrete grep commands — the only allowed ambiguity (repo convention check), with both forms shown.
- **Type consistency:** `Card`/`CardHeader`/`CardTitle`/`CardContent` exported names match between Task 4 and Task 8. `Badge` variant union (`accent|neutral|success|warning|destructive`) matches Task 8 usage. `ActivityRow` variant union (`think|tool|content|stage`) matches Task 8 usage. `CollapsibleCard` props (`title`/`extra`/`children`) match Task 8 usage. `cn` import path `@/lib/utils` matches existing `button.tsx`/`input.tsx`.
- **Tailwind collision check:** `accent` exists as both flat string (`'#27272A'`, legacy) and nested object — Tailwind v3 permits this; `bg-accent` resolves to legacy, `bg-accent-primary` to new var. Verified in Task 3 note. `destructive` overwritten to `var(--destructive)` but value-identical to legacy `#E53935`.
```
```
