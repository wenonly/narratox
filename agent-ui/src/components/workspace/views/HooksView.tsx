'use client'

import { useEffect, useState } from 'react'
import { useStore } from '@/store'
import { getHooks } from '@/api/novels'
import type { HookPayoffTiming, Novel, StoryEventHook } from '@/types/novel'

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

const HookCard = ({ hook }: { hook: StoryEventHook }) => {
  const isResolved = hook.status === 'RESOLVED'
  const isCore = hook.coreHook && !isResolved
  return (
    <div
      className={
        isResolved
          ? 'rounded-md border border-overlay-15 bg-overlay-5 px-2.5 py-2 opacity-60'
          : isCore
            ? 'rounded-md border border-overlay-15 bg-accent-primarySoft px-2.5 py-2'
            : hook.stale
              ? 'rounded-md border border-overlay-15 bg-accent-primarySoft px-2.5 py-2'
              : 'rounded-md border border-overlay-15 bg-bg-cardElevated px-2.5 py-2'
      }
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={`truncate text-sm ${
            isResolved ? 'text-text-tertiary line-through' : 'text-text-primary'
          }`}
        >
          {hook.coreHook && <span className="text-accent-indigoLight">★ </span>}
          {hook.description}
        </span>
        <span className="flex shrink-0 gap-1 text-xs text-text-tertiary">
          <span className="rounded bg-overlay-10 px-1">
            {TIMING_LABEL[hook.payoffTiming]}
          </span>
        </span>
      </div>
      <div className="mt-1 text-xs text-text-label">
        始于第{hook.openedAtChapter ?? '?'}章
        {hook.advancedCount > 0 && ` · 推进${hook.advancedCount}次`}
        {hook.resolvedAtChapter && ` · 回收于第${hook.resolvedAtChapter}章`}
        {hook.unmetDeps.length > 0 && ` · 依赖${hook.unmetDeps.length}个未回收`}
        {hook.stale && !isResolved && (
          <span className="ml-1 text-accent-indigoLight">· 陈久未推进</span>
        )}
      </div>
    </div>
  )
}

const HooksView = ({ novel }: HooksViewProps) => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const hookWriteSeq = useStore((s) => s.hookWriteSeq)
  const [hooks, setHooks] = useState<StoryEventHook[] | null>(null)
  const [loading, setLoading] = useState(true)

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

  const core = hooks.filter((h) => h.coreHook && h.status !== 'RESOLVED')
  const stale = hooks.filter((h) => h.stale && !h.coreHook)
  const active = hooks.filter(
    (h) => !h.coreHook && !h.stale && h.status !== 'RESOLVED'
  )
  const resolved = hooks.filter((h) => h.status === 'RESOLVED')

  return (
    <div className="space-y-3">
      {core.length > 0 && (
        <div>
          <p className="mb-1.5 text-[10px] font-semibold tracking-wide text-accent-indigoLight">
            ★ 核心伏笔 · {core.length}
          </p>
          <div className="mt-1 space-y-1.5">
            {core.map((h) => (
              <HookCard key={h.id} hook={h} />
            ))}
          </div>
        </div>
      )}
      {stale.length > 0 && (
        <div>
          <p className="mb-1.5 text-[10px] font-semibold tracking-wide text-accent-indigoLight">
            ⚠️ 陈久未推进 · {stale.length}
          </p>
          <div className="mt-1 space-y-1.5">
            {stale.map((h) => (
              <HookCard key={h.id} hook={h} />
            ))}
          </div>
        </div>
      )}
      {active.length > 0 && (
        <div>
          <p className="mb-1.5 text-[10px] font-semibold tracking-wide text-text-tertiary">
            进行中 · {active.length}
          </p>
          <div className="mt-1 space-y-1.5">
            {active.map((h) => (
              <HookCard key={h.id} hook={h} />
            ))}
          </div>
        </div>
      )}
      {resolved.length > 0 && (
        <div>
          <p className="mb-1.5 text-[10px] font-semibold tracking-wide text-text-label">
            已回收 · {resolved.length}
          </p>
          <div className="mt-1 space-y-1.5">
            {resolved.map((h) => (
              <HookCard key={h.id} hook={h} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default HooksView
