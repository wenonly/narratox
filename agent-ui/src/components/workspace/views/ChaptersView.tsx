'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight, Copy, List, Pencil } from 'lucide-react'

import { useStore } from '@/store'
import { publishNovel, updateChapter } from '@/api/novels'
import type { Novel } from '@/types/novel'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'

import { ChapterEditor } from './chapters/ChapterEditor'
import { ChapterSkeleton } from './chapters/ChapterSkeleton'
import { WritingPill } from './chapters/WritingPill'

export interface ChaptersViewProps {
  novel: Novel
  writingChapterOrder: number | null
}

const ChaptersView = ({ novel, writingChapterOrder }: ChaptersViewProps) => {
  const currentChapterOrder = useStore((s) => s.currentChapterOrder)
  const setCurrentChapterOrder = useStore((s) => s.setCurrentChapterOrder)
  const manualLock = useStore((s) => s.manualLock)
  const setManualLock = useStore((s) => s.setManualLock)
  const bumpChapterWriteSeq = useStore((s) => s.bumpChapterWriteSeq)
  const [tocOpen, setTocOpen] = useState(false)
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const [copying, setCopying] = useState(false)

  // B4 — 编辑模式:本地草稿 + 编辑开关。章节切换或退出编辑时丢弃草稿。
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

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

  // B4 — 保存草稿 → PATCH → bump chapterWriteSeq(page.tsx 已订阅,触发 refresh)。
  const saveDraft = async () => {
    if (!chapter || saving) return
    setSaving(true)
    try {
      await updateChapter(endpoint, token, novel.id, chapter.id, {
        content: draft
      })
      bumpChapterWriteSeq()
      toast.success('已保存')
      setEditing(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
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
  // 写作中且正文尚短(< 20 字,认为是空/刚起步)→ 显示骨架屏。
  const showSkeleton = isWritingThis && chapter.content.length < 20
  const showPill =
    manualLock &&
    writingChapterOrder !== null &&
    writingChapterOrder !== currentChapterOrder

  return (
    <div className="space-y-3">
      {/* B3 — WritingPill:写作中但用户在别章时,顶部提示跳转。 */}
      {showPill && (
        <WritingPill
          order={writingChapterOrder as number}
          onJump={() => {
            setCurrentChapterOrder(writingChapterOrder as number)
            setManualLock(false)
          }}
        />
      )}

      {/* 章节工具栏:翻页 pill(占满宽)+ 复制 / 目录 / 编辑 按钮。 */}
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
        {/* B4 — 编辑切换(写本 chapter 时不允许编辑,避免与 AI 写入冲突)。 */}
        <button
          type="button"
          onClick={() => {
            setDraft(chapter.content)
            setEditing((v) => !v)
          }}
          disabled={isWritingThis}
          aria-label={editing ? '退出编辑' : '编辑正文'}
          title={editing ? '退出编辑' : '编辑正文'}
          className={`flex size-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-30 ${
            editing
              ? 'bg-accent-primarySoft text-accent-indigoLight'
              : 'text-text-tertiary hover:bg-overlay-10'
          }`}
        >
          <Pencil className="size-4" />
        </button>
      </div>
      <div className="flex items-center gap-2 text-xs text-text-tertiary">
        {/* B3 — 写作中时把绿 badge 换成靛色「写作中」。 */}
        {isWritingThis ? (
          <span className="rounded-full bg-accent-primarySoft px-2 py-0.5 text-xs text-accent-indigoLight">
            写作中
          </span>
        ) : (
          <Badge
            variant={chapter.status === 'COMMITTED' ? 'success' : 'neutral'}
          >
            {chapter.status === 'COMMITTED' ? '已写入' : '草稿'}
          </Badge>
        )}
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

      {editing ? (
        <ChapterEditor
          chapter={chapter}
          draft={draft}
          onChange={setDraft}
          saving={saving}
          onCancel={() => setEditing(false)}
          onSave={saveDraft}
        />
      ) : showSkeleton ? (
        <ChapterSkeleton order={currentChapterOrder} />
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

export default ChaptersView
