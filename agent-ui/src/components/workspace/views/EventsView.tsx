'use client'

import { useEffect, useState } from 'react'
import { useStore } from '@/store'
import { getEvents } from '@/api/novels'
import type { EventTimelineItem, Novel } from '@/types/novel'

export interface EventsViewProps {
  novel: Novel
}

const EventCard = ({ event }: { event: EventTimelineItem }) => {
  const major = event.significance === 'MAJOR'
  return (
    <div
      className={
        major
          ? 'rounded-md border border-brand/40 bg-brand/5 px-2.5 py-2'
          : 'rounded-md border border-primary/10 bg-background-secondary px-2.5 py-2'
      }
    >
      <div className="flex items-center gap-1.5 text-xs">
        <span className={major ? 'text-brand' : 'text-muted'}>
          {major ? '★ MAJOR' : '· minor'}
        </span>
        {event.kind && <span className="text-muted/70">· {event.kind}</span>}
      </div>
      <p className="mt-0.5 text-sm text-primary">{event.description}</p>
      {(event.involvedCharacters.length > 0 || event.location) && (
        <p className="mt-1 text-xs text-muted">
          {event.involvedCharacters.length > 0 &&
            `👥${event.involvedCharacters.join('、')} `}
          {event.location && `📍${event.location}`}
        </p>
      )}
      {event.relatedHookId && (
        <p className="mt-0.5 text-xs text-muted/70">
          🪝 {event.relatedHookAction ?? 'related'} ·
          {event.relatedHookId.slice(-4)}
        </p>
      )}
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

  if (loading) return <p className="text-sm text-muted">加载事件…</p>
  if (!events || events.length === 0) {
    return (
      <p className="text-sm text-muted">
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
            <p className="text-xs uppercase text-muted">
              第 {ch} 章 · {items.length}
            </p>
            <div className="mt-1 space-y-1.5">
              {items.map((e) => (
                <EventCard key={e.id} event={e} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default EventsView
