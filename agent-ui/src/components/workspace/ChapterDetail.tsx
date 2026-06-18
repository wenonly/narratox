'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'
import { Button } from '@/components/ui/button'
import { useStore } from '@/store'
import { updateChapter } from '@/api/novels'
import type { Chapter, Novel } from '@/types/novel'

interface ChapterPreviewProps {
  /** 初始/受控展示的章节(来自旧 selectedChapterId 选择)。可缺省。 */
  chapter?: Chapter | undefined
  novel: Novel
  /** 全部章节,供切换器遍历。通常等于 novel.chapters。 */
  chapters: Chapter[]
  novelId: string
  onSaved: () => void
}

const ChapterPreview = ({
  chapter,
  novel,
  chapters,
  novelId,
  onSaved
}: ChapterPreviewProps) => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const writingChapterOrder = useStore((s) => s.writingChapterOrder)

  const sortedChapters = useMemo(
    () => [...chapters].sort((a, b) => a.order - b.order),
    [chapters]
  )

  // viewOrder 是切换器的本地状态,以传入 chapter 的 order 为初值。
  const [viewOrder, setViewOrder] = useState<number | null>(
    chapter?.order ?? sortedChapters[0]?.order ?? null
  )
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  // 切到不同小说/章节受控值时,同步 viewOrder 初值。
  useEffect(() => {
    setViewOrder(chapter?.order ?? sortedChapters[0]?.order ?? null)
  }, [chapter?.order, sortedChapters])

  // WritingChapter 事件驱动:自动跳到正在写的章节,并触发骨架屏。
  useEffect(() => {
    if (writingChapterOrder !== null) {
      setViewOrder(writingChapterOrder)
      setEditing(false)
    }
  }, [writingChapterOrder])

  const current = useMemo(
    () =>
      viewOrder !== null
        ? sortedChapters.find((c) => c.order === viewOrder)
        : undefined,
    [sortedChapters, viewOrder]
  )

  // 内容流结束后(writingChapterOrder 变 null)显示 current 的正文,
  // 此时 novel.chapters 已由 turn-end 的 onAccepted 刷新。
  useEffect(() => {
    if (writingChapterOrder !== null) return // 写作中:不要用旧正文覆盖草稿
    setEditing(false)
    setDraft(current?.content ?? '')
  }, [current?.id, current?.content, writingChapterOrder])

  const isWriting =
    writingChapterOrder !== null &&
    (current?.order ?? null) === writingChapterOrder

  const onPrev = () => {
    if (!sortedChapters.length) return
    const idx = current
      ? sortedChapters.findIndex((c) => c.id === current.id)
      : -1
    if (idx > 0) setViewOrder(sortedChapters[idx - 1].order)
  }
  const onNext = () => {
    if (!sortedChapters.length) return
    const idx = current
      ? sortedChapters.findIndex((c) => c.id === current.id)
      : -1
    if (idx >= 0 && idx < sortedChapters.length - 1)
      setViewOrder(sortedChapters[idx + 1].order)
  }

  const onSave = async () => {
    if (!current) return
    setSaving(true)
    try {
      await updateChapter(endpoint, token, novelId, current.id, {
        content: draft
      })
      toast.success('已保存')
      setEditing(false)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (!current) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted">
        选择一章查看正文
      </div>
    )
  }

  return (
    <section className="flex flex-1 flex-col overflow-hidden border-l border-primary/10">
      <header className="flex items-center justify-between px-5 py-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onPrev}
            disabled={
              sortedChapters.findIndex((c) => c.id === current.id) <= 0 ||
              isWriting
            }
            className="px-2 text-muted"
            aria-label="上一章"
          >
            ‹
          </Button>
          <h2 className="text-sm font-semibold text-primary">
            第{current.order}章 · {current.title}
            <span className="ml-2 text-xs text-muted/60">
              [
              {isWriting
                ? '写作中'
                : current.status === 'COMMITTED'
                  ? '已写入'
                  : '草稿'}
              ]
            </span>
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onNext}
            disabled={
              sortedChapters.findIndex((c) => c.id === current.id) >=
                sortedChapters.length - 1 || isWriting
            }
            className="px-2 text-muted"
            aria-label="下一章"
          >
            ›
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {editing && (
            <Button size="sm" onClick={onSave} disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (editing) setDraft(current.content)
              setEditing((v) => !v)
            }}
            disabled={isWriting}
            className="text-muted"
          >
            {editing ? '预览' : '编辑'}
          </Button>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto px-5 pb-6">
        {isWriting ? (
          <ChapterWritingSkeleton />
        ) : editing ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={saving}
            className="min-h-[60vh] w-full resize-y rounded-xl border border-primary/15 bg-background px-3 py-2 text-sm leading-6 text-primary focus:border-brand/60 focus:outline-none disabled:opacity-60"
          />
        ) : (
          <article className="prose prose-invert max-w-none text-sm">
            {current.content ? (
              <MarkdownRenderer>{current.content}</MarkdownRenderer>
            ) : novel.status === 'CONCEPT' ? (
              <p className="text-muted">立项中,信息收集完成后开始写作</p>
            ) : (
              <p className="text-muted">
                本章还没有内容。在左侧聊天里让 AI 写,内容会自动写入本章。
              </p>
            )}
          </article>
        )}
      </div>
      <footer className="px-5 py-2 text-xs text-muted/50">
        [正文] · 世界观 · 角色 · 状态(P2/P3 占位)
      </footer>
    </section>
  )
}

/**
 * 写作中骨架屏:几条脉动占位条,提示 AI 正在生成。
 * 不读 store,纯展示,由父组件按 isWriting 渲染。
 */
const ChapterWritingSkeleton = () => (
  <div className="space-y-3" role="status" aria-label="AI 正在写作本章">
    <div className="h-4 w-1/3 animate-pulse rounded bg-primary/15" />
    <div className="h-4 w-full animate-pulse rounded bg-primary/10" />
    <div className="h-4 w-full animate-pulse rounded bg-primary/10" />
    <div className="h-4 w-11/12 animate-pulse rounded bg-primary/10" />
    <div className="h-4 w-full animate-pulse rounded bg-primary/10" />
    <div className="h-4 w-4/5 animate-pulse rounded bg-primary/10" />
    <div className="h-4 w-full animate-pulse rounded bg-primary/10" />
    <div className="h-4 w-2/3 animate-pulse rounded bg-primary/10" />
    <p className="pt-2 text-xs text-muted/60">AI 正在写作本章…</p>
  </div>
)

export default ChapterPreview
