# 伏笔 + 事件模块视觉重做 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development 实施(每 task 一个 fresh subagent + 两阶段 review)。验证:`pnpm --dir agent-ui validate` + `pnpm --dir server typecheck`。

**Goal:** 把 [HooksView.tsx](agent-ui/src/components/workspace/views/HooksView.tsx) + [EventsView.tsx](agent-ui/src/components/workspace/views/EventsView.tsx) 视觉重做,对齐 Pencil(`GIRqK` 伏笔 / `a6KJNa` 事件):可展开 + 状态语义色(复用 family 三色)+ lifecycle 竖向轨道(从 `hook.events` 渲染)+ 概览条 + 关联伏笔 mini-card。

**Architecture:** 3 task:① server 2 处 include(零 schema 迁移)+ FE 类型可选字段;② HooksView 重做;③ EventsView 重做。复用 character/worldview 的 JIT-safe 字面量 map 范式。

**Tech Stack:** NestJS 11 + Prisma(server);Next.js 15 + React 18 + TS + Tailwind + lucide-react(FE)。

参考 spec:[2026-07-06-hooks-events-redesign-design.md](../specs/2026-07-06-hooks-events-redesign-design.md)。

---

## File Structure

- **Modify:** [server/src/memory/story-event.service.ts](server/src/memory/story-event.service.ts#L179) — `listForStatusView` findMany 加 `include: { events: {...} }`
- **Modify:** [server/src/memory/event.service.ts](server/src/memory/event.service.ts#L124) — `listForPanel` findMany 加 `include: { relatedHook: {...} }`
- **Modify:** [agent-ui/src/types/novel.ts](agent-ui/src/types/novel.ts) — `StoryEventHook` 加 `events?`,`EventTimelineItem` 加 `relatedHook?`
- **Modify:** [agent-ui/src/components/workspace/views/HooksView.tsx](agent-ui/src/components/workspace/views/HooksView.tsx) — 全文重写
- **Modify:** [agent-ui/src/components/workspace/views/EventsView.tsx](agent-ui/src/components/workspace/views/EventsView.tsx) — 全文重写

零 Prisma schema 迁移(关系已存在)。零 agent/prompt 改动。

---

### Task 1:server include + FE 类型扩展

**Files:**
- Modify: `server/src/memory/story-event.service.ts`
- Modify: `server/src/memory/event.service.ts`
- Modify: `agent-ui/src/types/novel.ts`

- [ ] **Step 1:story-event.service.ts 的 listForStatusView 加 events include**

在 [story-event.service.ts:179](server/src/memory/story-event.service.ts#L179) 的 `findMany({...})` 加 `include`(在 `orderBy` 之后):

```ts
const all = await this.prisma.storyEvent.findMany({
  where: { novelId, novel: { userId } },
  orderBy: [{ coreHook: 'desc' }, { createdAt: 'asc' }],
  include: {
    events: {
      select: {
        id: true,
        chapterOrder: true,
        description: true,
        kind: true,
        significance: true,
        relatedHookAction: true,
        createdAt: true,
      },
      orderBy: { chapterOrder: 'asc' },
    },
  },
});
```

(`listForStatusView` 末尾的 `return all.map((h) => ({ ...h, stale, unmetDeps }))` 不变 —— `...h` 自动带 `events`,unmetDeps 只读 `dependsOn`,互不影响。)

- [ ] **Step 2:event.service.ts 的 listForPanel 加 relatedHook include**

在 [event.service.ts:123](server/src/memory/event.service.ts#L123) 的 `listForPanel`:

```ts
async listForPanel(userId: string, novelId: string) {
  return this.prisma.event.findMany({
    where: { novelId, novel: { userId } },
    orderBy: { chapterOrder: 'asc' },
    include: {
      relatedHook: {
        select: { id: true, description: true, status: true, payoffTiming: true },
      },
    },
  });
}
```

- [ ] **Step 3:FE 类型加可选字段**

在 [agent-ui/src/types/novel.ts](agent-ui/src/types/novel.ts) 的 `StoryEventHook` interface 末尾(现有 `unmetDeps` 之后)加:

```ts
  events?: Array<{
    id: string
    chapterOrder: number
    description: string
    kind: string | null
    significance: 'MAJOR' | 'MINOR'
    relatedHookAction: string | null
  }>
```

在 `EventTimelineItem` interface 末尾(现有 `relatedHookAction` 之后)加:

```ts
  relatedHook?: {
    id: string
    description: string
    status: 'OPEN' | 'PROGRESSING' | 'RESOLVED'
    payoffTiming: HookPayoffTiming
  } | null
```

(`HookPayoffTiming` 已在同文件定义,可直接引用。)

- [ ] **Step 4:验证**

```bash
pnpm --dir server typecheck && pnpm --dir agent-ui typecheck
```

Expected: 双通过(server include 类型由 Prisma 推断,FE 可选字段兼容)。

- [ ] **Step 5:Commit**

```bash
git add server/src/memory/story-event.service.ts server/src/memory/event.service.ts agent-ui/src/types/novel.ts
git commit -m "feat(hooks-events): server include events/relatedHook + FE 类型扩展"
```

End with blank line + `Co-Authored-By: Claude <noreply@anthropic.com>`。

---

### Task 2:HooksView 重做(可展开 + lifecycle + 状态色)

**Files:**
- Modify: `agent-ui/src/components/workspace/views/HooksView.tsx`

- [ ] **Step 1:改 import + 加 cn**

第 1-7 行改 import(加 `useState`(已有)+ `cn` + 新 lucide 图标):

```tsx
'use client'

import { useEffect, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  CircleDot,
  Check,
  Link2,
  Star,
  TriangleAlert
} from 'lucide-react'

import { useStore } from '@/store'
import { getHooks } from '@/api/novels'
import type { HookPayoffTiming, Novel, StoryEventHook } from '@/types/novel'
import { cn } from '@/lib/utils'
```

(`CircleDot`/`Check`/`Link2`/`Star`/`TriangleAlert` 用于状态图标。验证 lucide-react 导出这几个 —— 实施时 `import('lucide-react').then(l => !!l.CircleDot)` 确认。)

- [ ] **Step 2:TIMING_LABEL 保留 + 加 STATUS_META 状态色 map**

第 12-18 行 `TIMING_LABEL` 保留。其后加:

```tsx
// 状态图标 + 状态色(复用 family 三色,零新 token)。
// core=indigo / stale=amber / 普通=neutral / resolved=emerald-muted。
type HookState = 'core' | 'active' | 'stale' | 'resolved'

function hookState(h: StoryEventHook): HookState {
  if (h.status === 'RESOLVED') return 'resolved'
  if (h.coreHook) return 'core'
  if (h.stale) return 'stale'
  return 'active'
}

const STATE_META: Record<
  HookState,
  { bg: string; icon: typeof Star; iconColor: string; label: string }
> = {
  core: {
    bg: 'bg-accent-primarySoft',
    icon: Star,
    iconColor: 'text-accent-indigoLight',
    label: '★ 核心'
  },
  active: {
    bg: 'bg-bg-cardElevated',
    icon: CircleDot,
    iconColor: 'text-text-tertiary',
    label: '进行中'
  },
  stale: {
    bg: 'bg-family-powerSoft',
    icon: TriangleAlert,
    iconColor: 'text-family-power',
    label: '⚠ 陈久'
  },
  resolved: {
    bg: 'bg-overlay-5',
    icon: Check,
    iconColor: 'text-family-world',
    label: '已回收'
  }
}
```

(图标用 lucide 组件引用(`typeof Star`),不用字符串,避免动态查找。)

- [ ] **Step 3:加 OverviewBar + HookCard 重写**

替换原 `HookCard`(20-61 行)为:

```tsx
const HookCard = ({
  hook,
  isOpen,
  onToggle,
  hookById
}: {
  hook: StoryEventHook
  isOpen: boolean
  onToggle: () => void
  hookById: Map<string, StoryEventHook>
}) => {
  const state = hookState(hook)
  const meta = STATE_META[state]
  const Icon = meta.icon
  const isResolved = state === 'resolved'
  const isPending = !isResolved
  return (
    <div
      className={cn(
        'rounded-md border border-overlay-15 px-2.5 py-2',
        meta.bg,
        isResolved && 'opacity-60'
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2.5 text-left"
      >
        <span
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-full',
            isResolved ? 'bg-overlay-10' : 'bg-overlay-10'
          )}
        >
          <Icon className={cn('size-3', meta.iconColor)} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className={cn(
              'truncate text-sm font-medium',
              isResolved
                ? 'text-text-tertiary line-through'
                : 'text-text-primary'
            )}
          >
            {hook.description}
          </span>
          <span className="truncate text-xs text-text-label">
            {hook.openedAtChapter != null && `埋 ch${hook.openedAtChapter}`}
            {hook.resolvedAtChapter != null &&
              ` → 揭 ch${hook.resolvedAtChapter}`}
            {isPending && hook.advancedCount > 0 &&
              ` · 推进 ${hook.advancedCount} 次`}
          </span>
        </div>
        <span className="shrink-0 rounded bg-overlay-10 px-1 text-[10px] text-text-secondary">
          {TIMING_LABEL[hook.payoffTiming]}
        </span>
        {isOpen ? (
          <ChevronDown className="size-3.5 shrink-0 text-text-label" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-text-label" />
        )}
      </button>
      {isOpen && (
        <ExpandedHook
          hook={hook}
          state={state}
          hookById={hookById}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4:加 ExpandedHook 子组件(lifecycle + 依赖)**

在 `HookCard` 之后加:

```tsx
const ExpandedHook = ({
  hook,
  state,
  hookById
}: {
  hook: StoryEventHook
  state: HookState
  hookById: Map<string, StoryEventHook>
}) => {
  const isResolved = state === 'resolved'
  const isPending = !isResolved
  const steps = hook.events ?? []
  const hasLifecycle = steps.length > 0
  const deps = hook.dependsOn ?? []
  return (
    <div className="mt-2 space-y-2.5 border-t border-overlay-10 pt-2">
      {/* 状态 chips 行 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-overlay-10 px-2 py-0.5 text-[10px] font-medium text-text-secondary">
          {TIMING_LABEL[hook.payoffTiming]} payoff
        </span>
        <span className="rounded-full bg-overlay-10 px-2 py-0.5 text-[10px] font-medium text-text-secondary">
          {hook.status}
        </span>
        {hook.advancedCount > 0 && (
          <span className="rounded-full bg-overlay-10 px-2 py-0.5 text-[10px] font-medium text-text-secondary">
            推进 {hook.advancedCount} 次
          </span>
        )}
      </div>

      {/* lifecycle 竖向轨道(从 hook.events 渲染) */}
      <div className="space-y-1">
        <p className="text-[10px] font-semibold tracking-wide text-text-label">
          生命周期
        </p>
        {hasLifecycle ? (
          steps.map((ev) => {
            const major = ev.significance === 'MAJOR'
            return (
              <div
                key={ev.id}
                className="flex items-start gap-2 py-0.5"
              >
                <span
                  className={cn(
                    'mt-0.5 size-2 shrink-0 rounded-full border',
                    major
                      ? 'border-accent-indigoLight bg-accent-indigoLight'
                      : 'border-text-label bg-transparent'
                  )}
                />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        'text-[10px] font-semibold',
                        major ? 'text-accent-indigoLight' : 'text-text-tertiary'
                      )}
                    >
                      第 {ev.chapterOrder} 章
                    </span>
                    {ev.relatedHookAction && (
                      <span className="text-[9px] text-text-label">
                        · {ev.relatedHookAction}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-secondary">{ev.description}</p>
                </div>
              </div>
            )
          })
        ) : (
          /* 数据未含 events 时降级单行 meta(不崩) */
          <p className="text-xs text-text-tertiary">
            埋 ch{hook.openedAtChapter ?? '?'}
            {hook.lastAdvancedAtChapter != null &&
              ` · 最近推进 ch${hook.lastAdvancedAtChapter}`}
          </p>
        )}
        {isPending && (
          <div className="flex items-start gap-2 py-0.5">
            <span className="mt-0.5 size-2 shrink-0 rounded-full border border-accent-indigoLight bg-transparent" />
            <span className="text-[10px] font-semibold text-accent-indigoLight">
              ◯ 待回收
            </span>
          </div>
        )}
        {isResolved && (
          <div className="flex items-start gap-2 py-0.5">
            <span className="mt-0.5 size-2 shrink-0 rounded-full border border-family-world bg-family-world" />
            <span className="text-[10px] font-semibold text-family-world">
              ● 回收 ch{hook.resolvedAtChapter ?? '?'}
            </span>
          </div>
        )}
      </div>

      {/* 依赖(ID→desc 解析,met=✓ / unmet=⚠) */}
      {deps.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold tracking-wide text-text-label">
            依赖
          </p>
          <div className="flex flex-wrap gap-1.5">
            {deps.map((depId) => {
              const dep = hookById.get(depId)
              const met = dep?.status === 'RESOLVED'
              return (
                <span
                  key={depId}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]',
                    met
                      ? 'bg-overlay-10 text-text-secondary'
                      : 'bg-family-powerSoft text-family-power'
                  )}
                >
                  <Link2 className="size-2.5" />
                  {dep?.description ?? depId.slice(-6)}
                  {met ? ' ✓' : ' ⚠'}
                </span>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5:主组件加 openId 状态 + hookById + OverviewBar**

替换原 `HooksView`(63-157 行)。保留 loading / empty / data-fetch 逻辑。改动:
- 加 `const [openId, setOpenId] = useState<string | null>(null)`。
- 计算 `const hookById = new Map((hooks ?? []).map((h) => [h.id, h]))`。
- 分组保留(`core` / `stale` / `active` / `resolved`)但分组 label 用状态色 + STATE_META.label:
- return 顶部加 `<OverviewBar hooks={hooks} />`(见下)。
- HookCard 用新 props:`isOpen={openId === h.id}` `onToggle={() => setOpenId(cur => cur === h.id ? null : h.id)}` `hookById={hookById}`。

**OverviewBar 子组件:**

```tsx
const OverviewBar = ({ hooks }: { hooks: StoryEventHook[] }) => {
  const total = hooks.length
  const open = hooks.filter((h) => h.status !== 'RESOLVED' && !h.stale).length
  const stale = hooks.filter((h) => h.stale).length
  const resolved = hooks.filter((h) => h.status === 'RESOLVED').length
  return (
    <div className="flex items-center gap-2 rounded-md bg-overlay-5 px-2.5 py-2 text-xs">
      <span className="font-semibold text-text-primary">{total}</span>
      <span className="text-text-tertiary">伏笔</span>
      <span className="text-text-label">·</span>
      <span className="font-semibold text-text-primary">{open}</span>
      <span className="text-text-tertiary">open</span>
      <span className="text-text-label">·</span>
      <span className="font-semibold text-family-power">{stale}</span>
      <span className="text-text-tertiary">stale</span>
      <span className="text-text-label">·</span>
      <span className="font-semibold text-family-world">{resolved}</span>
      <span className="text-text-tertiary">resolved</span>
    </div>
  )
}
```

**分组 label 升级**(替换原 `<p className="...">★ 核心伏笔 · {core.length}</p>` 等)。在 `STATE_META` 之后加字面量 dot 色 map(JIT-safe):

```tsx
const GROUP_DOT: Record<HookState, string> = {
  core: 'bg-accent-indigoLight',
  active: 'bg-text-tertiary',
  stale: 'bg-family-power',
  resolved: 'bg-family-world'
}

function GroupLabel({ state, count }: { state: HookState; count: number }) {
  const meta = STATE_META[state]
  return (
    <div className="mb-1.5 flex items-center gap-1.5 px-1">
      <span className={cn('size-1.5 rounded-full', GROUP_DOT[state])} />
      <span className="text-[10px] font-semibold tracking-wide text-text-tertiary">
        {meta.label}
      </span>
      <span className="text-[10px] text-text-label">· {count}</span>
    </div>
  )
}
```

**HooksView 分组渲染**(替换原 4 个 `{core.length > 0 && (...)}` 块):

```tsx
return (
  <div className="space-y-3">
    <OverviewBar hooks={hooks} />
    {core.length > 0 && (
      <div>
        <GroupLabel state="core" count={core.length} />
        <div className="mt-1 space-y-1.5">
          {core.map((h) => (
            <HookCard
              key={h.id}
              hook={h}
              isOpen={openId === h.id}
              onToggle={() =>
                setOpenId((cur) => (cur === h.id ? null : h.id))
              }
              hookById={hookById}
            />
          ))}
        </div>
      </div>
    )}
    {/* stale / active / resolved 同款,把 state 换掉 */}
  </div>
)
```

(4 个分组块各传对应 `state`。)

- [ ] **Step 6:验证**

```bash
pnpm --dir agent-ui validate
```

Expected: lint + format + typecheck 全过。

- [ ] **Step 7:Commit**

```bash
git add agent-ui/src/components/workspace/views/HooksView.tsx
git commit -m "feat(hooks): 可展开 + lifecycle 时间线 + 状态语义色"
```

End with blank line + `Co-Authored-By: Claude <noreply@anthropic.com>`。

---

### Task 3:EventsView 重做(可展开 + chips + 关联伏笔)

**Files:**
- Modify: `agent-ui/src/components/workspace/views/EventsView.tsx`

- [ ] **Step 1:改 import + 加 cn**

```tsx
'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, MapPin, Sparkles, User } from 'lucide-react'

import { useStore } from '@/store'
import { getEvents } from '@/api/novels'
import type { EventTimelineItem, Novel } from '@/types/novel'
import { cn } from '@/lib/utils'
```

- [ ] **Step 2:重写 EventCard(折叠 + 展开子组件)**

替换原 `EventCard`(12-46 行):

```tsx
const EventCard = ({
  event,
  isOpen,
  onToggle
}: {
  event: EventTimelineItem
  isOpen: boolean
  onToggle: () => void
}) => {
  const major = event.significance === 'MAJOR'
  return (
    <div
      className={cn(
        'rounded-md border border-overlay-15 px-2.5 py-2',
        major ? 'bg-accent-primarySoft' : 'bg-bg-cardElevated'
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 text-left"
      >
        <span className="flex size-5 shrink-0 items-center justify-center">
          {major ? (
            <Sparkles className="size-3 text-accent-indigoLight" />
          ) : (
            <span className="size-1.5 rounded-full bg-text-tertiary" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-text-primary">
            {event.description}
          </span>
          <span className="block truncate text-[10px] text-text-tertiary">
            {major ? '★ MAJOR' : '· minor'}
            {event.kind && ` · ${event.kind}`}
            {event.involvedCharacters.length > 0 &&
              ` · 👥${event.involvedCharacters.join('、')}`}
          </span>
        </span>
        {isOpen ? (
          <ChevronDown className="size-3.5 shrink-0 text-text-label" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-text-label" />
        )}
      </button>
      {isOpen && <ExpandedEvent event={event} />}
    </div>
  )
}
```

- [ ] **Step 3:加 ExpandedEvent 子组件**

```tsx
const ExpandedEvent = ({ event }: { event: EventTimelineItem }) => {
  const major = event.significance === 'MAJOR'
  return (
    <div className="mt-2 space-y-2.5 border-t border-overlay-10 pt-2">
      {/* 完整叙述 */}
      <p className="text-xs leading-relaxed text-text-secondary">
        {event.description}
      </p>

      {/* 涉及人物 chips */}
      {event.involvedCharacters.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold tracking-wide text-text-label">
            涉及人物
          </p>
          <div className="flex flex-wrap gap-1.5">
            {event.involvedCharacters.map((name) => (
              <span
                key={name}
                className="inline-flex items-center gap-1 rounded-full bg-overlay-10 px-2 py-0.5 text-[10px] text-text-secondary"
              >
                <User className="size-2.5" />
                {name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 地点 chip */}
      {event.location && (
        <div className="flex items-center gap-1.5">
          <MapPin className="size-3 shrink-0 text-text-tertiary" />
          <span className="text-[10px] text-text-tertiary">地点</span>
          <span className="rounded-full bg-overlay-10 px-2 py-0.5 text-[10px] text-text-secondary">
            {event.location}
          </span>
        </div>
      )}

      {/* 关联伏笔 mini-card(显完整描述,替代 ID 尾号) */}
      {event.relatedHook && (
        <div className="space-y-1 rounded-md border border-overlay-15 bg-bg-cardElevated px-2 py-1.5">
          <p className="flex items-center gap-1 text-[10px] font-semibold tracking-wide text-text-label">
            🪝 关联伏笔
            {event.relatedHookAction && (
              <span className="font-normal text-text-label">
                · {event.relatedHookAction}
              </span>
            )}
          </p>
          <p className="text-xs font-medium text-accent-indigoLight">
            {event.relatedHook.description}
          </p>
          <p className="text-[10px] text-text-tertiary">
            {event.relatedHook.status} · {event.relatedHook.payoffTiming}{' '}
            payoff
          </p>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4:加 OverviewBar + 主组件 openId 状态**

替换原 `EventsView`(48-118 行)。保留 loading / empty / data-fetch / 按章分组逻辑。改动:
- 加 `const [openId, setOpenId] = useState<string | null>(null)`。
- return 顶部加 `<OverviewBar events={events} />`。
- EventCard 用新 props。

**OverviewBar:**

```tsx
const OverviewBar = ({ events }: { events: EventTimelineItem[] }) => {
  const total = events.length
  const major = events.filter((e) => e.significance === 'MAJOR').length
  const chapters = new Set(events.map((e) => e.chapterOrder)).size
  return (
    <div className="flex items-center gap-2 rounded-md bg-overlay-5 px-2.5 py-2 text-xs">
      <span className="font-semibold text-text-primary">{total}</span>
      <span className="text-text-tertiary">事件</span>
      <span className="text-text-label">·</span>
      <span className="font-semibold text-accent-indigoLight">{major}</span>
      <span className="text-text-tertiary">MAJOR</span>
      <span className="text-text-label">·</span>
      <span className="font-semibold text-text-primary">{chapters}</span>
      <span className="text-text-tertiary">章</span>
    </div>
  )
}
```

**EventCard 用法:**

```tsx
{items.map((e) => (
  <EventCard
    key={e.id}
    event={e}
    isOpen={openId === e.id}
    onToggle={() => setOpenId((cur) => (cur === e.id ? null : e.id))}
  />
))}
```

- [ ] **Step 5:验证**

```bash
pnpm --dir agent-ui validate && pnpm --dir server typecheck
```

Expected: 全过。

- [ ] **Step 6:Commit**

```bash
git add agent-ui/src/components/workspace/views/EventsView.tsx
git commit -m "feat(events): 可展开 + 人物/地点/关联伏笔 chips"
```

End with blank line + `Co-Authored-By: Claude <noreply@anthropic.com>`。

---

## 验证(整分支,subagent 跑完 3 task 后)

1. `pnpm --dir agent-ui validate` + `pnpm --dir server typecheck` 全过。
2. `pnpm --dir agent-ui dev`(server 已含 include)打开 `/novels/:id` 右侧伏笔 tab:
   - 概览条显数(stale/resolved 着色)。
   - 4 状态分组:core indigo / 进行中 neutral / 陈久 amber / 已回收 emerald-muted。
   - 点核心伏笔展开:完整 description + chips + **lifecycle 竖向轨道**(per-step)+ 依赖 chips(ID→desc)。
   - 数据未含 events 时降级单行 meta。
3. 切到事件 tab:
   - 概览条 + 按章分组。
   - 点 MAJOR 事件展开:完整 description + 人物 chips + 地点 chip + 关联伏笔 mini-card。
4. 对比 Pencil:伏笔对 `GIRqK`,事件对 `a6KJNa`。

## 不在范围

- **DB / Prisma schema** —— 零迁移(关系已存在)。
- **agent / prompt / tool** —— 不动。
- **causedBy 因果链 UI** —— 留作未来。
- **手动伏笔/事件 CRUD** —— 不动。

## 实施者注意

- HooksView.tsx / EventsView.tsx 行号基于改前版本(Hooks 160 行 / Events 120 行)。Edit 按 old_string 唯一匹配。
- **Task 1 要先于 Task 2/3** —— FE 类型 `events?` / `relatedHook?` 必须先就位,view 才能引用。
- Task 1 的 server include 让 Prisma 推断类型(无显式 return type,自动带 events/relatedHook)。FE 端把它们标为可选字段,兼容旧响应。
- Task 2/3 改不同文件,**理论上可并行**,但 skill 要求串行(避免冲突)。
- 4 个 lucide 图标(CircleDot/Check/Link2/Star/TriangleAlert/MapPin/Sparkles/User)实施时 `import('lucide-react').then(l => ...)` 验证存在。
- 真实浏览器测试如需要:**只用新建 fixture 账户**(见 memory `subagent-test-no-real-account.md`)。
