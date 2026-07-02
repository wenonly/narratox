'use client'

import { useState } from 'react'
import { useStore } from '@/store'
import { publishNovel } from '@/api/novels'
import type { Novel } from '@/types/novel'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'
import { toast } from 'sonner'

export interface ChaptersViewProps {
  novel: Novel
  writingChapterOrder: number | null
}

const ChaptersView = ({
  novel,
  writingChapterOrder
}: ChaptersViewProps) => {
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
      <p className="text-sm text-muted">
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
      {/* 翻页头 + 目录触发 */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          disabled={prevOrder == null}
          onClick={() => prevOrder != null && goTo(prevOrder)}
          className="px-2 text-muted hover:text-primary disabled:opacity-30"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={() => setTocOpen((v) => !v)}
          className="flex-1 text-center text-sm font-medium text-primary hover:text-brand"
        >
          第 {chapter.order} 章 · {chapter.title || '无标题'}
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={nextOrder == null}
            onClick={() => nextOrder != null && goTo(nextOrder)}
            className="px-2 text-muted hover:text-primary disabled:opacity-30"
          >
            ›
          </button>
          <button
            type="button"
            onClick={copyChapter}
            disabled={copying || !chapter.content}
            title="复制本章(发布用)"
            className="px-1 text-muted hover:text-primary disabled:opacity-30"
          >
            📋
          </button>
          <button
            type="button"
            onClick={() => setTocOpen((v) => !v)}
            className="px-1 text-muted hover:text-primary"
            title="目录"
          >
            ☰
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="rounded bg-accent px-1.5 py-0.5">
          {chapter.status === 'COMMITTED' ? '已写入' : '草稿'}
        </span>
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
          <p className="text-xs text-muted">
            第 {currentChapterOrder} 章 · AI 写作中…
          </p>
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-4 animate-pulse rounded bg-accent"
              style={{ width: `${70 + ((i * 7) % 30)}%` }}
            />
          ))}
        </div>
      ) : chapter.content ? (
        <article className="prose prose-invert max-w-none text-sm">
          <MarkdownRenderer>{chapter.content}</MarkdownRenderer>
        </article>
      ) : (
        <p className="text-sm text-muted">本章还没有内容。</p>
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
  <div className="max-h-64 overflow-y-auto rounded border border-primary/10 bg-background">
    {sorted.map((c) => {
      const isCurrent = c.order === currentOrder
      const isWriting = writingOrder === c.order
      return (
        <button
          key={c.order}
          type="button"
          onClick={() => onPick(c.order)}
          className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent ${
            isCurrent ? 'text-primary' : 'text-muted'
          } ${isWriting ? 'text-brand' : ''}`}
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
    className="flex w-full items-center justify-between rounded border border-brand/40 bg-brand/10 px-3 py-2 text-sm text-brand hover:bg-brand/20"
  >
    <span>✍ AI 正写第 {order} 章</span>
    <span>跳转 ›</span>
  </button>
)

export default ChaptersView
