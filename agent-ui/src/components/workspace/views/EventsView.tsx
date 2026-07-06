'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, MapPin, Sparkles, User } from 'lucide-react'

import { useStore } from '@/store'
import { getEvents } from '@/api/novels'
import type { EventTimelineItem, Novel } from '@/types/novel'
import { cn } from '@/lib/utils'

export interface EventsViewProps {
  novel: Novel
}

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

const ExpandedEvent = ({ event }: { event: EventTimelineItem }) => {
  return (
    <div className="mt-2 space-y-2.5 border-t border-overlay-10 pt-2">
      {/* full description */}
      <p className="text-xs leading-relaxed text-text-secondary">
        {event.description}
      </p>

      {/* involved characters chips */}
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

      {/* location chip */}
      {event.location && (
        <div className="flex items-center gap-1.5">
          <MapPin className="size-3 shrink-0 text-text-tertiary" />
          <span className="text-[10px] text-text-tertiary">地点</span>
          <span className="rounded-full bg-overlay-10 px-2 py-0.5 text-[10px] text-text-secondary">
            {event.location}
          </span>
        </div>
      )}

      {/* related hook mini-card (full description, NOT ID tail) */}
      {event.relatedHook && (
        <div className="space-y-1 rounded-md border border-overlay-15 bg-bg-cardElevated px-2 py-1.5">
          <p className="flex items-center gap-1 text-[10px] font-semibold tracking-wide text-text-label">
            <span>🪝 关联伏笔</span>
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
            {event.relatedHook.status} · {event.relatedHook.payoffTiming} payoff
          </p>
        </div>
      )}
    </div>
  )
}

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

const EventsView = ({ novel }: EventsViewProps) => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  // 事件由 settler 经 write_summary 写,与伏笔同源 → 复用 hookWriteSeq 刷新。
  const hookWriteSeq = useStore((s) => s.hookWriteSeq)
  const [events, setEvents] = useState<EventTimelineItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getEvents(endpoint, token, novel.id)
      .then((d) => {
        if (!cancelled) setEvents(d)
      })
      .catch(() => {
        if (!cancelled) setEvents(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [endpoint, token, novel.id, hookWriteSeq])

  if (loading) return <p className="text-sm text-text-tertiary">加载事件…</p>
  if (!events || events.length === 0) {
    return (
      <p className="text-sm text-text-tertiary">
        事件由 settler 每章自动提取(剧情转折/揭示/冲突 = MAJOR,次要推进 =
        MINOR)。区别于伏笔:事件是「发生了什么」的事实点,伏笔是「待回收」的承诺线。这里显示全书事件时间线。
      </p>
    )
  }

  // 按 chapterOrder 分组(升序),组内 MAJOR 在前。
  const byChapter = new Map<number, EventTimelineItem[]>()
  for (const e of events) {
    const arr = byChapter.get(e.chapterOrder) ?? []
    arr.push(e)
    byChapter.set(e.chapterOrder, arr)
  }
  const chapters = Array.from(byChapter.keys()).sort((a, b) => a - b)

  return (
    <div className="space-y-3">
      <OverviewBar events={events} />
      {chapters.map((ch) => {
        const items = (byChapter.get(ch) ?? []).sort((a, b) =>
          a.significance === b.significance
            ? 0
            : a.significance === 'MAJOR'
              ? -1
              : 1
        )
        return (
          <div key={ch}>
            <p className="mb-1.5 text-[10px] font-semibold tracking-wide text-text-tertiary">
              第 {ch} 章 · {items.length}
            </p>
            <div className="mt-1 space-y-1.5">
              {items.map((e) => (
                <EventCard
                  key={e.id}
                  event={e}
                  isOpen={openId === e.id}
                  onToggle={() =>
                    setOpenId((cur) => (cur === e.id ? null : e.id))
                  }
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default EventsView
