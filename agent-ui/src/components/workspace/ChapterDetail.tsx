'use client'

import { useEffect, useState } from 'react'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'
import { Button } from '@/components/ui/button'
import type { Chapter } from '@/types/novel'

const ChapterDetail = ({ chapter }: { chapter: Chapter | undefined }) => {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    setEditing(false)
    setDraft(chapter?.content ?? '')
  }, [chapter?.id, chapter?.content])

  if (!chapter) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted">
        选择一章查看正文
      </div>
    )
  }

  return (
    <section className="flex flex-1 flex-col overflow-hidden border-l border-primary/10">
      <header className="flex items-center justify-between px-5 py-3">
        <h2 className="text-sm font-semibold text-primary">
          第{chapter.order}章 · {chapter.title}
          <span className="ml-2 text-xs text-muted/60">
            [{chapter.status === 'COMMITTED' ? '已采纳' : '草稿'}]
          </span>
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (editing) setDraft(chapter.content)
            setEditing((v) => !v)
          }}
          className="text-muted"
        >
          {editing ? '预览' : '编辑'}
        </Button>
      </header>
      <div className="flex-1 overflow-y-auto px-5 pb-6">
        {editing ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="min-h-[60vh] w-full resize-y rounded-xl border border-primary/15 bg-background px-3 py-2 text-sm leading-6 text-primary focus:border-brand/60 focus:outline-none"
          />
        ) : (
          <article className="prose prose-invert max-w-none text-sm">
            {chapter.content ? (
              <MarkdownRenderer>{chapter.content}</MarkdownRenderer>
            ) : (
              <p className="text-muted">
                本章还没有内容。在左侧聊天里让 AI 写，然后「采纳到本章」。
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

export default ChapterDetail
