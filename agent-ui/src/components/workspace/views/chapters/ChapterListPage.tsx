'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react'

import type { Arc, Chapter, ChapterOutline, Volume } from '@/types/novel'
import { cn } from '@/lib/utils'
import { groupChaptersByVolume } from '@/lib/volume-grouping'
import type { StatusFilter } from './chapter-types'

export interface ChapterListPageProps {
  chapters: Chapter[]
  volumes: Volume[]
  arcs: Arc[]
  outlines: ChapterOutline[]
  currentOrder: number
  writingOrder: number | null
  onPick: (order: number) => void
  onClose: () => void
}

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'committed', label: '已写' },
  { key: 'draft', label: '草稿' }
]

export const ChapterListPage = ({
  chapters,
  volumes,
  arcs,
  outlines,
  currentOrder,
  writingOrder,
  onPick,
  onClose
}: ChapterListPageProps) => {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set())
  const initializedRef = useRef(false)

  const isSearching = query.trim().length > 0

  const filteredChapters = useMemo(() => {
    const q = query.trim()
    let result = chapters
    if (/^\d+$/.test(q)) {
      const n = parseInt(q, 10)
      result = result.filter((c) => c.order === n)
    } else if (q) {
      result = result.filter((c) => c.title.includes(q))
    }
    if (filter !== 'all') {
      result = result.filter(
        (c) => c.status === (filter === 'committed' ? 'COMMITTED' : 'DRAFT')
      )
    }
    return result
  }, [chapters, query, filter])

  const allGroups = useMemo(
    () => groupChaptersByVolume(chapters, volumes, arcs, outlines),
    [chapters, volumes, arcs, outlines]
  )

  const filteredGroups = useMemo(
    () => groupChaptersByVolume(filteredChapters, volumes, arcs, outlines),
    [filteredChapters, volumes, arcs, outlines]
  )

  // 首次有数据时初始化折叠态:当前卷展开,其他卷折叠。之后用户操作不被覆盖。
  useEffect(() => {
    if (initializedRef.current) return
    if (allGroups.length === 0) return
    const cur = allGroups.find((g) =>
      g.chapters.some((c) => c.order === currentOrder)
    )
    const init = new Set<number>(allGroups.map((g) => g.volumeOrder))
    if (cur) init.delete(cur.volumeOrder)
    setCollapsed(init)
    initializedRef.current = true
  }, [allGroups, currentOrder])

  const toggleCollapse = (volumeOrder: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(volumeOrder)) next.delete(volumeOrder)
      else next.add(volumeOrder)
      return next
    })
  }

  // 搜索期间强制全部展开(命中项要可见);退出搜索恢复用户折叠态。
  const isCollapsed = (volumeOrder: number) =>
    !isSearching && collapsed.has(volumeOrder)

  return (
    <div className="flex h-full flex-col gap-3">
      {/* ChapBar */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-text-primary">
          章节目录 · {currentOrder} / {chapters.length}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="flex size-6 items-center justify-center rounded-md text-text-tertiary hover:bg-overlay-10 hover:text-text-primary"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* SearchBar */}
      <div className="flex items-center gap-2 rounded-md border border-overlay-15 bg-overlay-5 px-3 py-2">
        <Search className="size-3.5 shrink-0 text-text-tertiary" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索章名 / 章号"
          className="min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-tertiary"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="清除"
            className="text-text-tertiary hover:text-text-primary"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
              filter === f.key
                ? 'bg-accent-primarySoft text-accent-indigoLight'
                : 'bg-overlay-10 text-text-tertiary hover:bg-overlay-15'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 卷分组列表 */}
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        {filteredGroups.length === 0 ? (
          <p className="py-8 text-center text-xs text-text-tertiary">
            没有匹配的章节。
          </p>
        ) : (
          <div className="space-y-3">
            {filteredGroups.map((g) => {
              const collapsedNow = isCollapsed(g.volumeOrder)
              const isOrphan = g.volumeId === null
              return (
                <div key={g.volumeOrder} className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => toggleCollapse(g.volumeOrder)}
                    className="flex w-full items-center gap-1.5 px-1 py-0.5 text-[11px] font-semibold tracking-wide text-text-tertiary"
                  >
                    {collapsedNow ? (
                      <ChevronRight className="size-3" />
                    ) : (
                      <ChevronDown className="size-3" />
                    )}
                    <span>
                      {isOrphan
                        ? '未分卷'
                        : `卷${g.volumeOrder} · ${g.volumeTitle ?? '无标题'}`}
                    </span>
                    <span className="ml-auto text-text-tertiary">
                      {g.chapters.length} 章
                    </span>
                  </button>
                  {!collapsedNow && (
                    <div className="space-y-1">
                      {g.chapters.map((c) => {
                        const isCurrent = c.order === currentOrder
                        const isWriting = writingOrder === c.order
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => onPick(c.order)}
                            className={cn(
                              'flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors',
                              isCurrent
                                ? 'border-overlay-15 bg-accent-primarySoft'
                                : 'border-overlay-15 bg-bg-cardElevated hover:bg-overlay-5'
                            )}
                          >
                            <span
                              className={cn(
                                'truncate',
                                isCurrent
                                  ? 'font-semibold text-text-primary'
                                  : 'text-text-secondary',
                                isWriting && 'text-accent-indigoLight'
                              )}
                            >
                              第 {c.order} 章 · {c.title || '无标题'}
                            </span>
                            <span
                              className={cn(
                                'shrink-0 text-[10px]',
                                isWriting
                                  ? 'text-accent-indigoLight'
                                  : isCurrent
                                    ? 'text-accent-indigoLight'
                                    : 'text-text-tertiary'
                              )}
                            >
                              {isWriting
                                ? '写作中'
                                : isCurrent
                                  ? '● 在读'
                                  : c.status === 'COMMITTED'
                                    ? '✓ 已写'
                                    : '草稿'}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
