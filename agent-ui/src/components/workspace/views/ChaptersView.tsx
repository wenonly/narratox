'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight, Copy, List } from 'lucide-react'

import { useStore } from '@/store'
import { publishNovel } from '@/api/novels'
import type { Novel } from '@/types/novel'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'

export interface ChaptersViewProps {
  novel: Novel
  writingChapterOrder: number | null
}

const ChaptersView = ({ novel, writingChapterOrder }: ChaptersViewProps) => {
  const currentChapterOrder = useStore((s) => s.currentChapterOrder)
  const setCurrentChapterOrder = useStore((s) => s.setCurrentChapterOrder)
  const manualLock = useStore((s) => s.manualLock)
  const setManualLock = useStore((s) => s.setManualLock)
  const [tocOpen, setTocOpen] = useState(false)
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const [copying, setCopying] = useState(false)

  const copyChapter = async () => {
    if (currentChapterOrder == null || !chapter) return
    setCopying(true)
    try {
      const text = await publishNovel(endpoint, token, novel.id, {
        from: currentChapterOrder,
        to: currentChapterOrder,
        title: true,
        synopsis: false,
        indent: true
      })
      await navigator.clipboard.writeText(text)
      toast.success(`已复制第${currentChapterOrder}章`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '复制失败')
    } finally {
      setCopying(false)
    }
  }

  const sorted = [...novel.chapters].sort((a, b) => a.order - b.order)
  const idx = sorted.findIndex((c) => c.order === currentChapterOrder)
  const chapter = idx >= 0 ? sorted[idx] : undefined
  const prevOrder = idx > 0 ? sorted[idx - 1].order : null
  const nextOrder =
    idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1].order : null

  const goTo = (order: number) => {
    setCurrentChapterOrder(order)
    setManualLock(true)
    setTocOpen(false)
  }

  // CONCEPT / 无章
  if (currentChapterOrder == null || !chapter) {
    return (
      <p className="text-sm text-text-tertiary">
        {novel.status === 'CONCEPT'
          ? '立项中,信息收集完成后开始写作。'
          : '本章还没有内容。'}
      </p>
    )
  }

  const isWritingThis =
    writingChapterOrder !== null && writingChapterOrder === currentChapterOrder
  const showSkeleton = isWritingThis && !chapter.content
  const showPill =
    manualLock &&
    writingChapterOrder !== null &&
    writingChapterOrder !== currentChapterOrder

  return (
    <div className="space-y-3">
      {/* 章节工具栏:翻页 pill(占满宽)+ 复制 / 目录 按钮。 */}
      <div className="flex items-center gap-1">
        <div className="flex min-w-0 flex-1 items-center gap-1 rounded-md border border-overlay-15 bg-bg-cardElevated px-1 py-1">
          <button
            type="button"
            disabled={prevOrder == null}
            onClick={() => prevOrder != null && goTo(prevOrder)}
            aria-label="上一章"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-overlay-10 hover:text-text-primary disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setTocOpen((v) => !v)}
            className="min-w-0 flex-1 truncate text-center text-sm font-medium text-text-primary hover:text-accent-indigoLight"
            title={`第 ${chapter.order} 章 · ${chapter.title || '无标题'}`}
          >
            <span className="truncate">
              第 {chapter.order} 章 · {chapter.title || '无标题'}
            </span>
          </button>
          <button
            type="button"
            disabled={nextOrder == null}
            onClick={() => nextOrder != null && goTo(nextOrder)}
            aria-label="下一章"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-overlay-10 hover:text-text-primary disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={copyChapter}
          disabled={copying || !chapter.content}
          title="复制本章(发布用)"
          aria-label="复制本章"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-overlay-10 hover:text-text-primary disabled:opacity-30"
        >
          <Copy className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => setTocOpen((v) => !v)}
          aria-label="章节列表"
          title="章节列表"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-overlay-10 hover:text-text-primary"
        >
          <List className="size-4" />
        </button>
      </div>
      <div className="flex items-center gap-2 text-xs text-text-tertiary">
        <Badge variant={chapter.status === 'COMMITTED' ? 'success' : 'neutral'}>
          {chapter.status === 'COMMITTED' ? '已写入' : '草稿'}
        </Badge>
        <span>{chapter.content.length} 字</span>
      </div>

      {tocOpen && (
        <ChapterToc
          sorted={sorted}
          currentOrder={currentChapterOrder}
          writingOrder={writingChapterOrder}
          onPick={goTo}
        />
      )}
      {showPill && (
        <WritingPill
          order={writingChapterOrder as number}
          onJump={() => {
            setCurrentChapterOrder(writingChapterOrder as number)
            setManualLock(false)
          }}
        />
      )}

      {showSkeleton ? (
        <div className="space-y-2">
          <p className="text-xs text-text-tertiary">
            第 {currentChapterOrder} 章 · AI 写作中…
          </p>
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-4 animate-pulse rounded bg-overlay-10"
              style={{ width: `${70 + ((i * 7) % 30)}%` }}
            />
          ))}
        </div>
      ) : chapter.content ? (
        <article className="prose prose-invert max-w-none text-sm">
          <MarkdownRenderer>{chapter.content}</MarkdownRenderer>
        </article>
      ) : (
        <p className="text-sm text-text-tertiary">本章还没有内容。</p>
      )}
    </div>
  )
}

const ChapterToc = ({
  sorted,
  currentOrder,
  writingOrder,
  onPick
}: {
  sorted: Array<{
    order: number
    title: string
    status: string
    content: string
  }>
  currentOrder: number
  writingOrder: number | null
  onPick: (order: number) => void
}) => (
  <div className="max-h-64 overflow-y-auto rounded border border-overlay-15 bg-bg-card">
    {sorted.map((c) => {
      const isCurrent = c.order === currentOrder
      const isWriting = writingOrder === c.order
      return (
        <button
          key={c.order}
          type="button"
          onClick={() => onPick(c.order)}
          className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-overlay-10 ${
            isCurrent ? 'text-text-primary' : 'text-text-tertiary'
          } ${isWriting ? 'text-accent-indigoLight' : ''}`}
        >
          <span>
            第 {c.order} 章 · {c.title || '无标题'}
          </span>
          <span className="text-xs">
            {isWriting ? '写作中' : isCurrent ? '在读' : ''}
          </span>
        </button>
      )
    })}
  </div>
)

const WritingPill = ({
  order,
  onJump
}: {
  order: number
  onJump: () => void
}) => (
  <button
    type="button"
    onClick={onJump}
    className="flex w-full items-center justify-between rounded border border-overlay-15 bg-accent-primarySoft px-3 py-2 text-sm text-accent-indigoLight hover:bg-overlay-15"
  >
    <span>✍ AI 正写第 {order} 章</span>
    <span>跳转 ›</span>
  </button>
)

export default ChaptersView
