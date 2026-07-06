'use client'

import { useEffect, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Check,
  CircleDot,
  Link2,
  Star,
  TriangleAlert
} from 'lucide-react'

import { useStore } from '@/store'
import { getHooks } from '@/api/novels'
import type { HookPayoffTiming, Novel, StoryEventHook } from '@/types/novel'
import { cn } from '@/lib/utils'

export interface HooksViewProps {
  novel: Novel
}

const TIMING_LABEL: Record<HookPayoffTiming, string> = {
  IMMEDIATE: '即时',
  NEAR_TERM: '近期',
  MID_ARC: '本卷',
  SLOW_BURN: '慢热',
  ENDGAME: '终局'
}

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

const GROUP_DOT: Record<HookState, string> = {
  core: 'bg-accent-indigoLight',
  active: 'bg-text-tertiary',
  stale: 'bg-family-power',
  resolved: 'bg-family-world'
}

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
      {/* status chips */}
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

      {/* lifecycle vertical track */}
      <div className="space-y-1">
        <p className="text-[10px] font-semibold tracking-wide text-text-label">
          生命周期
        </p>
        {hasLifecycle ? (
          steps.map((ev) => {
            const major = ev.significance === 'MAJOR'
            return (
              <div key={ev.id} className="flex items-start gap-2 py-0.5">
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
                  <p className="text-xs text-text-secondary">
                    {ev.description}
                  </p>
                </div>
              </div>
            )
          })
        ) : (
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

      {/* deps (ID→desc resolved, met=✓ / unmet=⚠) */}
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
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-overlay-10">
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
            {isPending &&
              hook.advancedCount > 0 &&
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
      {isOpen && <ExpandedHook hook={hook} state={state} hookById={hookById} />}
    </div>
  )
}

const HooksView = ({ novel }: HooksViewProps) => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const hookWriteSeq = useStore((s) => s.hookWriteSeq)
  const [hooks, setHooks] = useState<StoryEventHook[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getHooks(endpoint, token, novel.id)
      .then((d) => {
        if (!cancelled) setHooks(d)
      })
      .catch(() => {
        if (!cancelled) setHooks(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [endpoint, token, novel.id, hookWriteSeq])

  if (loading) return <p className="text-sm text-text-tertiary">加载伏笔…</p>
  if (!hooks || hooks.length === 0) {
    return (
      <p className="text-sm text-text-tertiary">
        伏笔将在写作时由 settler 自动提取(埋下/推进/回收),带 payoffTiming
        与核心标记。 这里会显示完整伏笔账本 + 陈旧告警。
      </p>
    )
  }

  const hookById = new Map(hooks.map((h) => [h.id, h]))

  const core = hooks.filter((h) => h.coreHook && h.status !== 'RESOLVED')
  const stale = hooks.filter((h) => h.stale && !h.coreHook)
  const active = hooks.filter(
    (h) => !h.coreHook && !h.stale && h.status !== 'RESOLVED'
  )
  const resolved = hooks.filter((h) => h.status === 'RESOLVED')

  const renderGroup = (state: HookState, items: StoryEventHook[]) =>
    items.length > 0 ? (
      <div key={state}>
        <GroupLabel state={state} count={items.length} />
        <div className="mt-1 space-y-1.5">
          {items.map((h) => (
            <HookCard
              key={h.id}
              hook={h}
              isOpen={openId === h.id}
              onToggle={() => setOpenId((cur) => (cur === h.id ? null : h.id))}
              hookById={hookById}
            />
          ))}
        </div>
      </div>
    ) : null

  return (
    <div className="space-y-3">
      <OverviewBar hooks={hooks} />
      {renderGroup('core', core)}
      {renderGroup('stale', stale)}
      {renderGroup('active', active)}
      {renderGroup('resolved', resolved)}
    </div>
  )
}

export default HooksView
