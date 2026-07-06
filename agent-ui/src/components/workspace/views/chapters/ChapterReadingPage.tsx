'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight, Copy, List, Pencil } from 'lucide-react'

import { useStore } from '@/store'
import { publishNovel, updateChapter } from '@/api/novels'
import type { Chapter, Novel, OutlineData } from '@/types/novel'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'

import { ChapterEditor } from './ChapterEditor'
import { ChapterSkeleton } from './ChapterSkeleton'
import { WritingPill } from './WritingPill'
import { findVolumeForChapter } from '@/lib/volume-grouping'

export interface ChapterReadingPageProps {
  novel: Novel
  chapter: Chapter
  prevOrder: number | null
  nextOrder: number | null
  outlineData: OutlineData | null
  writingChapterOrder: number | null
  onOpenToc: () => void
  onJumpToOrder: (order: number) => void
}

export const ChapterReadingPage = ({
  novel,
  chapter,
  prevOrder,
  nextOrder,
  outlineData,
  writingChapterOrder,
  onOpenToc,
  onJumpToOrder
}: ChapterReadingPageProps) => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const manualLock = useStore((s) => s.manualLock)
  const setManualLock = useStore((s) => s.setManualLock)
  const bumpChapterWriteSeq = useStore((s) => s.bumpChapterWriteSeq)

  const [copying, setCopying] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const isWritingThis =
    writingChapterOrder !== null && writingChapterOrder === chapter.order
  const showSkeleton = isWritingThis && chapter.content.length < 20
  const showPill =
    manualLock &&
    writingChapterOrder !== null &&
    writingChapterOrder !== chapter.order

  const volume =
    outlineData &&
    findVolumeForChapter(
      chapter.order,
      outlineData.volumes,
      outlineData.arcs,
      outlineData.chapterOutlines
    )

  const copyChapter = async () => {
    setCopying(true)
    try {
      const text = await publishNovel(endpoint, token, novel.id, {
        from: chapter.order,
        to: chapter.order,
        title: true,
        synopsis: false,
        indent: true
      })
      await navigator.clipboard.writeText(text)
      toast.success(`已复制第${chapter.order}章`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '复制失败')
    } finally {
      setCopying(false)
    }
  }

  const saveDraft = async () => {
    if (saving) return
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

  // onJumpToOrder(ChaptersView.pickOrder)已含 setManualLock(true),这里不重复调用。
  const goTo = (order: number) => {
    onJumpToOrder(order)
  }

  return (
    <div className="space-y-3">
      {showPill && writingChapterOrder !== null && (
        <WritingPill
          order={writingChapterOrder}
          onJump={() => {
            onJumpToOrder(writingChapterOrder)
            setManualLock(false)
          }}
        />
      )}

      {/* ChapterBar:翻页 pager + 复制/列表/编辑 */}
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
            onClick={onOpenToc}
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
          onClick={onOpenToc}
          aria-label="章节列表"
          title="章节列表"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-overlay-10 hover:text-text-primary"
        >
          <List className="size-4" />
        </button>
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

      {/* Meta:状态 badge + 字数 + 卷位 */}
      <div className="flex items-center gap-2 text-xs text-text-tertiary">
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
        {volume && (
          <span className="ml-auto">
            {volume.title} · 第 {chapter.order} 章
          </span>
        )}
      </div>

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
        <ChapterSkeleton order={chapter.order} />
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
