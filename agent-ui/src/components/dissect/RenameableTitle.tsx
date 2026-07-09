'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Pencil, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 可重命名标题:展示态 hover 显铅笔 → 点开 inline input → 回车/失焦提交、Esc 取消。
 * 提交调 onRename(next);失败由调用方 toast + 不更新本地(回滚)。
 */
export const RenameableTitle = ({
  title,
  onRename,
  className
}: {
  title: string
  onRename: (next: string) => Promise<void>
  className?: string
}) => {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      setDraft(title)
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing, title])

  const commit = async () => {
    const t = draft.trim()
    if (!t || t === title) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await onRename(t)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <span className="flex items-center gap-1">
        <input
          ref={inputRef}
          value={draft}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setEditing(false)
          }}
          onBlur={commit}
          maxLength={120}
          className={cn(
            'rounded-md border border-overlay-20 bg-overlay-5 px-2 py-0.5 text-sm font-semibold text-text-primary outline-none focus:border-accent-indigoLight',
            className
          )}
        />
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={commit}
          disabled={saving}
          className="text-text-label hover:text-text-primary"
        >
          <Check className="size-3.5" />
        </button>
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setEditing(false)}
          className="text-text-label hover:text-text-primary"
        >
          <X className="size-3.5" />
        </button>
      </span>
    )
  }

  return (
    <span className="group inline-flex items-center gap-1">
      <span className={className}>{title}</span>
      <button
        onClick={() => setEditing(true)}
        className="opacity-0 transition-opacity group-hover:opacity-100"
        title="重命名"
      >
        <Pencil className="size-3 text-text-label hover:text-text-primary" />
      </button>
    </span>
  )
}
