'use client'

import { useEffect } from 'react'
import { Check } from 'lucide-react'

import type { Chapter } from '@/types/novel'

export interface ChapterEditorProps {
  chapter: Chapter
  draft: string
  onChange: (v: string) => void
  saving: boolean
  onCancel: () => void
  onSave: () => void
}

export const ChapterEditor = ({
  chapter,
  draft,
  onChange,
  saving,
  onCancel,
  onSave
}: ChapterEditorProps) => {
  useEffect(() => {
    onChange(chapter.content)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter.id])

  return (
    <div className="space-y-2">
      <textarea
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        disabled={saving}
        className="min-h-[300px] w-full resize-y rounded-md border border-accent-indigoLight bg-bg-darkest p-3 font-sans text-sm leading-relaxed text-text-body outline-none focus:border-accent-indigoLight"
        placeholder="编辑正文…"
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-tertiary">
          编辑中 · {draft.length} 字 · 未保存
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="h-8 rounded-md bg-overlay-5 px-3 text-sm text-text-secondary hover:bg-overlay-10 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-gradient-to-b from-accent-primary to-accent-violet px-3 text-sm font-semibold text-text-primary hover:opacity-90 disabled:opacity-50"
          >
            <Check className="size-3.5" />
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
