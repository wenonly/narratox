# UI Migration — Wave 1A: Shared Atoms + AppSidebar + Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewire the shared primitives (Button/Input/Dialog/Textarea/Skeleton) from old tokens to the Wave 0 new-token namespace (variant APIs preserved), rewrite `AppSidebar` to Token Spec §3.1, and reskin login/register to frames 01/02 — establishing the reskin pattern Wave 1B (library/knowledge/settings) will follow.

**Architecture:** All primitives are rewired IN PLACE — internal `className` strings migrate old→new tokens, variant/prop APIs stay identical so every call site (including Wave 2/3 workspace/dissect) keeps working unchanged. Button additionally gains Token Spec §3.4 `gradient`/`soft` variants (old variants retained). AppSidebar is rewritten to §3.1 (only library/knowledge/settings use it, so strictly Wave-1-scoped). Auth pages adopt the new `Button variant="gradient"` + new tokens. A side benefit: undefined shadcn tokens (`text-muted-foreground`, `ring-ring`, `ring-offset-background`) that silently no-op today get replaced with real tokens.

**Tech Stack:** Next.js 15 + React 18 + Tailwind v3.4 + cva + Radix Dialog + lucide-react. Existing `cn()` at `agent-ui/src/lib/utils.ts`. Wave 0 new-token namespace active (`bg-bg-card`, `text-text-primary`, `bg-accent-primary`, `.bg-gradient-brand`, etc.).

**Spec:** [Wave 1 execution design](../specs/2026-07-02-ui-migration-wave1-design.md). Token values: [Token Spec](../specs/2026-07-02-ui-redesign-design.md).

**Verification:** No test runner — `pnpm validate` (lint+prettier+typecheck) + Playwright screenshot vs Pencil frames + grep. Run pnpm from `agent-ui/`.

---

## Token migration cheat-sheet (reuse for every Wave 1 task)

| Old class | New class | Notes |
|-----------|-----------|-------|
| `bg-background` | `bg-bg-card` | page/card bg |
| `bg-background-secondary` | `bg-bg-card` (#1A1A22) | Token Spec §3.7 dialog fill |
| `bg-background/80` (overlay) | `bg-black/80` | Token Spec §3.7 overlay #00000080 |
| `bg-primary` | `bg-accent-primary` | |
| `bg-brand` / `bg-brand/90` | use `Button variant="gradient"` | or `bg-accent-primary` |
| `bg-accent` (flat, hover) | `bg-overlay-10` | |
| `text-primary` | `text-text-primary` | |
| `text-muted` | `text-text-tertiary` | |
| `text-brand` | `text-accent-indigoLight` | (camelCase!) |
| `text-muted-foreground` | `text-text-tertiary` | was UNDEFINED — bug fix |
| `border-primary/10` / `border-primary/15` | `border-overlay-15` | |
| `border-border` | `border-overlay-15` | |
| `bg-primary/10` (skeleton) | `bg-overlay-10` | |
| `focus:ring-ring` / `focus-visible:ring-ring` | `focus-visible:ring-accent-indigoLight` | was UNDEFINED — bug fix |
| `ring-offset-background` | (drop) or `bg-bg-card` offset | was UNDEFINED |

**CRITICAL — camelCase token classes** (Tailwind nested namespace preserves the JS key casing): `bg-accent-indigoLight` / `text-accent-indigoLight` / `bg-accent-primarySoft` / `bg-accent-violetLight` / `bg-bg-cardElevated` / `text-text-accentLink`. NEVER write `bg-accent-indigo-light` (kebab) — it silently no-ops. Verify with grep after each task.

---

## File Structure

- **Modify** `agent-ui/src/components/ui/button.tsx` — rewire variants to new tokens + add `gradient`/`soft`.
- **Modify** `agent-ui/src/components/ui/input.tsx` — rewire to new tokens.
- **Modify** `agent-ui/src/components/ui/textarea.tsx` — rewire className only.
- **Modify** `agent-ui/src/components/ui/skeleton.tsx` — rewire `bg-primary/10` → `bg-overlay-10`.
- **Modify** `agent-ui/src/components/ui/dialog.tsx` — rewire overlay/content/close/description; fix undefined tokens.
- **Modify** `agent-ui/src/components/layout/AppSidebar.tsx` — rewrite to Token Spec §3.1.
- **Modify** `agent-ui/src/app/(auth)/login/page.tsx` — reskin to frame 01.
- **Modify** `agent-ui/src/app/(auth)/register/page.tsx` — reskin to frame 02.
- **Modify** `agent-ui/src/app/dev/tokens/page.tsx` — add Button variant showcase (optional but recommended).

---

## Task 1: Rewire `Button` + add `gradient`/`soft` variants

**Files:** Modify `agent-ui/src/components/ui/button.tsx`

- [ ] **Step 1: Replace the file with the rewired version**

```tsx
import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-indigoLight disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-accent-primary text-white shadow hover:bg-accent-primary/90',
        gradient: 'bg-gradient-brand text-white shadow hover:opacity-90',
        soft: 'bg-accent-primarySoft text-accent-violetLight hover:bg-accent-primarySoft/80',
        destructive:
          'bg-destructive text-white shadow-sm hover:bg-destructive/90',
        outline:
          'border border-overlay-15 bg-bg-card text-text-primary shadow-sm hover:bg-overlay-10',
        secondary:
          'bg-bg-cardElevated text-text-primary shadow-sm hover:bg-overlay-15',
        ghost: 'hover:bg-overlay-10 hover:text-text-primary',
        link: 'text-accent-indigoLight underline-offset-4 hover:underline'
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-8',
        icon: 'h-9 w-9'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
```

Changes vs original: base `focus-visible:ring-ring` → `focus-visible:ring-accent-indigoLight`; `default` `bg-primary text-background` → `bg-accent-primary text-white`; ADDED `gradient` + `soft`; `outline`/`secondary`/`ghost`/`link` rewired per cheat-sheet; `destructive` unchanged (already channel-backed).

- [ ] **Step 2: Verify**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm typecheck
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/taowen/project/narratox && git add agent-ui/src/components/ui/button.tsx && git commit -m "feat(agent-ui): rewire Button to new tokens + add gradient/soft variants (Wave 1A)"
```

---

## Task 2: Rewire `Input`, `Textarea`, `Skeleton`

**Files:** Modify `agent-ui/src/components/ui/input.tsx`, `agent-ui/src/components/ui/textarea.tsx`, `agent-ui/src/components/ui/skeleton.tsx`

- [ ] **Step 1: Replace `input.tsx`**

```tsx
import * as React from 'react'

import { cn } from '@/lib/utils'

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-11 w-full rounded-input border border-overlay-15 bg-bg-card px-3 py-2 text-sm text-text-primary transition-colors placeholder:text-text-label focus-visible:border-accent-primary focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = 'Input'

export { Input }
```

- [ ] **Step 2: In `textarea.tsx`, replace ONLY the `className={cn(...)}` block (lines ~73-83)**

Find:
```tsx
        className={cn(
          'w-full resize-none bg-transparent shadow-sm',
          'rounded-xl border border-border',
          'px-3 py-2',
          'text-sm leading-5',
          'placeholder:text-muted-foreground',
          'focus-visible:ring-0.5 focus-visible:ring-ring focus-visible:border-primary/50 focus-visible:outline-none',
          'disabled:cursor-not-allowed disabled:opacity-50',
          showScroll ? 'overflow-y-auto' : 'overflow-hidden',
          className
        )}
```
Replace with:
```tsx
        className={cn(
          'w-full resize-none bg-transparent shadow-sm',
          'rounded-input border border-overlay-15',
          'px-3 py-2',
          'text-sm leading-5 text-text-primary placeholder:text-text-label',
          'focus-visible:ring-0.5 focus-visible:ring-accent-indigoLight focus-visible:border-accent-primary focus-visible:outline-none',
          'disabled:cursor-not-allowed disabled:opacity-50',
          showScroll ? 'overflow-y-auto' : 'overflow-hidden',
          className
        )}
```
Leave the rest of `textarea.tsx` (the autosize logic, refs, exports) UNCHANGED.

- [ ] **Step 3: Replace `skeleton.tsx`**

```tsx
import { cn } from '@/lib/utils'

const Skeleton = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-overlay-10', className)}
      {...props}
    />
  )
}

export { Skeleton }
```

- [ ] **Step 4: Verify**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm typecheck
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/taowen/project/narratox && git add agent-ui/src/components/ui/input.tsx agent-ui/src/components/ui/textarea.tsx agent-ui/src/components/ui/skeleton.tsx && git commit -m "feat(agent-ui): rewire Input/Textarea/Skeleton to new tokens (Wave 1A)"
```

---

## Task 3: Rewire `Dialog`

**Files:** Modify `agent-ui/src/components/ui/dialog.tsx`

- [ ] **Step 1: Replace the file**

```tsx
'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'

import { cn } from '@/lib/utils'
import Icon from './icon'

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-50 flex max-h-[623px] w-full max-w-[440px] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-hidden rounded-dialog border border-overlay-15 bg-bg-card p-6 shadow-2xl shadow-black/60 duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]',
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="text-text-tertiary data-[state=open]:bg-overlay-10 absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-indigoLight disabled:pointer-events-none">
        <Icon type="x" size="xs" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex flex-col space-y-1.5 text-center sm:text-left',
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = 'DialogHeader'

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2',
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = 'DialogFooter'

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      'text-lg font-semibold leading-none tracking-tight text-text-primary',
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-text-tertiary text-sm', className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription
}
```

Changes: overlay `bg-background/80` → `bg-black/80`; content `rounded-[12px] border-border bg-background/100` → `rounded-dialog border-overlay-15 bg-bg-card`, shadow → `shadow-2xl shadow-black/60`; close button drops undefined `ring-ring`/`ring-offset-background`/`text-muted-foreground`, uses `text-text-tertiary` + `focus-visible:ring-accent-indigoLight` + `data-[state=open]:bg-overlay-10`; `DialogTitle` gains `text-text-primary`; `DialogDescription` `text-muted-foreground` → `text-text-tertiary`.

- [ ] **Step 2: Verify**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm typecheck
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/taowen/project/narratox && git add agent-ui/src/components/ui/dialog.tsx && git commit -m "feat(agent-ui): rewire Dialog to new tokens; fix undefined muted-foreground/ring tokens (Wave 1A)"
```

---

## Task 4: Rewrite `AppSidebar` to Token Spec §3.1

**Files:** Modify `agent-ui/src/components/layout/AppSidebar.tsx`

- [ ] **Step 1: Confirm the target frame**

Screenshot Pencil frame `03 Library Main` (id `ZcuP6`) to confirm the AppSidebar design (nav-item style, whether nav items have icons):
```bash
# (via Pencil MCP get_screenshot in the executing agent — nodeId ZcuP6, filePath design/narratox.pen)
```
If the frame shows Lucide icons next to nav labels, add them (template in Step 2 includes a commented icon line). If text-only, leave as-is. Default to text-only per §3.1 literal.

- [ ] **Step 2: Replace `AppSidebar.tsx`**

```tsx
'use client'

import { useRouter } from 'next/navigation'

import { useStore } from '@/store'
import Icon from '@/components/ui/icon'
import { cn } from '@/lib/utils'

interface Props {
  active: 'library' | 'knowledge' | 'dissect' | 'settings'
}

const TABS = [
  { key: 'library', label: '小说库', href: '/' },
  { key: 'knowledge', label: '知识库', href: '/knowledge' },
  { key: 'dissect', label: '拆解', href: '/dissect' },
  { key: 'settings', label: '设置', href: '/settings' }
] as const

const AppSidebar = ({ active }: Props) => {
  const router = useRouter()
  const logout = useStore((s) => s.logout)
  return (
    <aside className="flex w-[200px] shrink-0 flex-col gap-3 border-r border-overlay-15 bg-bg-darkest px-3 py-5 font-sans">
      <div className="mb-2 flex items-center gap-2 px-2">
        <Icon type="agno" size="xs" />
        <span className="text-gradient-brand text-lg font-semibold">
          narratox
        </span>
      </div>
      <nav className="flex flex-col gap-1">
        {TABS.map((t) => {
          const isActive = active === t.key
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => router.push(t.href)}
              className={cn(
                'relative flex h-9 items-center rounded-md px-3 text-left text-[13px] transition-colors',
                isActive
                  ? 'bg-accent-primarySoft font-medium text-text-primary'
                  : 'text-text-tertiary hover:bg-overlay-10 hover:text-text-primary'
              )}
            >
              {isActive ? (
                <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent-indigoLight" />
              ) : null}
              {t.label}
            </button>
          )
        })}
      </nav>
      <div className="mt-auto px-1">
        <button
          type="button"
          onClick={() => {
            logout()
            router.replace('/login')
          }}
          className="flex h-9 w-full items-center rounded-md px-3 text-[13px] text-text-tertiary transition-colors hover:bg-overlay-10 hover:text-text-primary"
        >
          登出
        </button>
      </div>
    </aside>
  )
}

export default AppSidebar
```

Notes: width 240→200px; `font-dmmono`→`font-sans` (Inter); active item gets `bg-accent-primarySoft` + left 2px indicator `bg-accent-indigoLight` (camelCase!); inactive `text-text-tertiary hover:bg-overlay-10`; brand wordmark becomes gradient text-lg font-semibold (Token Spec §3.1). Removed the `Button` import (logout is now a plain styled button matching nav style).

- [ ] **Step 3: Verify**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm typecheck && pnpm validate
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd /Users/taowen/project/narratox && git add agent-ui/src/components/layout/AppSidebar.tsx && git commit -m "feat(agent-ui): rewrite AppSidebar to Token Spec §3.1 (Wave 1A)"
```

---

## Task 5: Reskin `login` to frame 01

**Files:** Modify `agent-ui/src/app/(auth)/login/page.tsx`

- [ ] **Step 1: Replace the JSX return (keep imports + `LoginPage` logic unchanged)**

Only the `return (...)` block changes. Replace it with:

```tsx
  return (
    <div className="flex h-screen items-center justify-center bg-[linear-gradient(135deg,#0a0a0b,#13131a)] px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-overlay-15 bg-bg-card p-8 shadow-2xl shadow-black/60"
      >
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold text-text-primary">登录</h1>
          <p className="text-[11px] text-text-label">输入账号信息继续</p>
        </div>
        <div className="space-y-3">
          <Input
            type="email"
            placeholder="邮箱"
            aria-label="邮箱"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            type="password"
            placeholder="密码"
            aria-label="密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <Button
          type="submit"
          variant="gradient"
          className="h-11 w-full rounded-pill"
          disabled={loading}
        >
          {loading ? '登录中…' : '登录'}
        </Button>
        <p className="text-center text-[11px] text-text-label">
          没有账号？
          <Link
            href="/register"
            className="text-accent-indigoLight underline-offset-2 hover:underline"
          >
            注册
          </Link>
        </p>
      </form>
    </div>
  )
```

Changes: bg `bg-background/80` → gradient `bg-[linear-gradient(135deg,#0a0a0b,#13131a)]`; card `bg-background-secondary border-primary/10` → `bg-bg-card border-overlay-15`; title `text-xl text-primary` → `text-lg text-text-primary`; subtitle `text-muted` → `text-[11px] text-text-label`; submit button `bg-brand...` override → `variant="gradient"` + `rounded-pill`; link `text-brand` → `text-accent-indigoLight`; bottom text `text-muted` → `text-text-label`. Imports already include `Button`/`Input`/`Link` — no import change.

- [ ] **Step 2: Verify**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm typecheck
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/taowen/project/narratox && git add 'agent-ui/src/app/(auth)/login/page.tsx' && git commit -m "feat(agent-ui): reskin login to Token Spec frame 01 (Wave 1A)"
```

---

## Task 6: Reskin `register` to frame 02

**Files:** Modify `agent-ui/src/app/(auth)/register/page.tsx`

- [ ] **Step 1: Replace the JSX return (keep imports + logic unchanged)**

```tsx
  return (
    <div className="flex h-screen items-center justify-center bg-[linear-gradient(135deg,#0a0a0b,#13131a)] px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-overlay-15 bg-bg-card p-8 shadow-2xl shadow-black/60"
      >
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold text-text-primary">注册</h1>
          <p className="text-[11px] text-text-label">创建账号开始写作</p>
        </div>
        <div className="space-y-3">
          <Input
            type="email"
            placeholder="邮箱"
            aria-label="邮箱"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            type="text"
            placeholder="用户名（可选）"
            aria-label="用户名"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <Input
            type="password"
            placeholder="密码（至少 8 位）"
            aria-label="密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </div>
        <Button
          type="submit"
          variant="gradient"
          className="h-11 w-full rounded-pill"
          disabled={loading}
        >
          {loading ? '注册中…' : '注册'}
        </Button>
        <p className="text-center text-[11px] text-text-label">
          已有账号？
          <Link
            href="/login"
            className="text-accent-indigoLight underline-offset-2 hover:underline"
          >
            登录
          </Link>
        </p>
      </form>
    </div>
  )
```

(Same token migration as Task 5; subtitle text matches Token Spec §4.2 "创建账号开始写作".)

- [ ] **Step 2: Verify**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm typecheck
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/taowen/project/narratox && git add 'agent-ui/src/app/(auth)/register/page.tsx' && git commit -m "feat(agent-ui): reskin register to Token Spec frame 02 (Wave 1A)"
```

---

## Task 7: Update `/dev/tokens` showcase with Button variants

**Files:** Modify `agent-ui/src/app/dev/tokens/page.tsx`

- [ ] **Step 1: Add a Button showcase section**

Add `Button` to the imports (`import { Button } from '@/components/ui/button'`), then add a new section before the closing `</main>` (after the Collapsible card section):

```tsx
      <section className="flex flex-col gap-2">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-text-label">
          Buttons
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="default">default</Button>
          <Button variant="gradient">gradient</Button>
          <Button variant="soft">soft</Button>
          <Button variant="outline">outline</Button>
          <Button variant="secondary">secondary</Button>
          <Button variant="ghost">ghost</Button>
          <Button variant="link">link</Button>
          <Button variant="destructive">destructive</Button>
          <Button variant="gradient" className="rounded-pill">
            gradient pill
          </Button>
        </div>
      </section>
```

- [ ] **Step 2: Verify**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm validate
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/taowen/project/narratox && git add agent-ui/src/app/dev/tokens/page.tsx && git commit -m "feat(agent-ui): add Button variant showcase to /dev/tokens (Wave 1A)"
```

---

## Task 8: Wave 1A gate — validate + visual + grep

**Files:** none (verification)

- [ ] **Step 1: Full gate**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm validate
```
Expected: lint ✓ + prettier ✓ + typecheck ✓. If prettier fails, `pnpm format:fix` + re-run.

- [ ] **Step 2: camelCase hygiene grep (no kebab accent classes in the rewired files)**

```bash
cd /Users/taowen/project/narratox && grep -rnE "accent-(indigo|violet)-(light|pale|mid)|accent-primary-soft|bg-card-elevated" agent-ui/src/components/ui agent-ui/src/components/layout agent-ui/src/app/\(auth\)
```
Expected: ZERO matches (all should be camelCase). If any match, fix them.

- [ ] **Step 3: Old-token grep on Wave 1A files (zero expected)**

```bash
cd /Users/taowen/project/narratox && grep -rnE "bg-brand|bg-background|bg-primary|text-primary|text-muted|border-primary|bg-accent(?:[\"' /]|$)" agent-ui/src/components/ui/button.tsx agent-ui/src/components/ui/input.tsx agent-ui/src/components/ui/dialog.tsx agent-ui/src/components/ui/textarea.tsx agent-ui/src/components/ui/skeleton.tsx agent-ui/src/components/layout/AppSidebar.tsx 'agent-ui/src/app/(auth)/login/page.tsx' 'agent-ui/src/app/(auth)/register/page.tsx'
```
Expected: ZERO matches. (The `bg-accent(?:["' /]|$)` anchors the flat `bg-accent` so it does NOT match the new `bg-accent-primary`.) If any old token remains, migrate it per the cheat-sheet.

- [ ] **Step 4: Visual verification — `/dev/tokens`, `/login`, `/register` vs Pencil frames**

Start dev:
```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm dev > /tmp/w1a-dev.log 2>&1 &
sleep 18
```
Then (via Playwright MCP in the executing controller/agent):
- Navigate to `http://localhost:3000/dev/tokens` → screenshot → confirm Button variants render (gradient = Indigo→Violet pill, default = solid Indigo, etc.) and all prior Wave 0 swatches still correct.
- Navigate to `http://localhost:3000/login` → screenshot → compare to Pencil frame `01 Auth Login` (id `i0K9a`).
- Navigate to `http://localhost:3000/register` → screenshot → compare to Pencil frame `02 Auth Register` (id `KcPrq`).

Expected: dark gradient bg, `bg-bg-card` card with `border-overlay-15`, gradient submit button (pill), Indigo link color. 0 console errors.

Then kill dev:
```bash
pkill -f "next dev" 2>/dev/null || true
```

- [ ] **Step 5: Commit any formatting fixes**

```bash
cd /Users/taowen/project/narratox && git add -u && git diff --cached --quiet || git commit -m "style(agent-ui): prettier fixes (Wave 1A gate)"
```

- [ ] **Step 6: Mark Wave 1A complete**

Wave 1A is done when: `pnpm validate` green; camelCase + old-token greps clean; `/dev/tokens` + `/login` + `/register` match frames 01/02. The shared atoms are now on the new-token namespace (workspace/dissect buttons/dialogs also flipped — expected). Next: Wave 1B (library/knowledge/settings) gets its own plan.

---

## Self-Review (completed)

- **Spec coverage:** Spec §2.1 (atoms in-place rewire + Button adds gradient/soft) → Tasks 1-3. Spec §2.2 (AppSidebar rewrite to §3.1) → Task 4. Spec §3 (auth evolves to frames) → Tasks 5-6. Spec §4 (validate + screenshot + grep gate) → Task 8. `/dev/tokens` update → Task 7. All steps have exact code.
- **Placeholder scan:** No TBD/TODO. Task 4 Step 1 has a "confirm the frame via screenshot" instruction with a concrete fallback (text-only per §3.1 literal) — verified decision, not a placeholder.
- **Type consistency:** Button `variant` union includes `gradient`/`soft` (Task 1) and Tasks 5/6/7 use `variant="gradient"` — matches. AppSidebar drops `Button` import (Task 4) since logout is now a plain button — no dangling ref. Input/Textarea/Skeleton/Dialog keep identical export names. `cn`/`React.forwardRef` patterns match existing. camelCase tokens (`bg-accent-indigoLight`, `bg-accent-primarySoft`, `text-accent-violetLight`, `bg-bg-cardElevated`) used throughout; Task 8 grep enforces no kebab leakage.
```
```
