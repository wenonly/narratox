'use client'

import { useEffect } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import type { KbEntryDetail } from '@/types/knowledge'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'

interface Props {
  detail: KbEntryDetail | null
  loading: boolean
  onClose: () => void
  onPrev: () => void
  onNext: () => void
  hasPrev: boolean
  hasNext: boolean
  prevTitle?: string
  nextTitle?: string
}

/**
 * 知识库详情右侧抽屉(对标 Pencil `07b Knowledge Preview` · PreviewPanel)。
 * - Scrim 只盖主区(left-[200px] 起),左侧 AppSidebar 保持可点
 * - 抽屉右侧 520px,左投影,Header(标题+关闭)/Body(标签+元信息+正文)/Footer(上下一篇)
 */
const KnowledgeDetailDrawer = ({
  detail,
  loading,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  prevTitle,
  nextTitle
}: Props) => {
  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && hasPrev) onPrev()
      else if (e.key === 'ArrowRight' && hasNext) onNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onPrev, onNext, hasPrev, hasNext])

  const entry = detail?.entry
  const content = detail?.content ?? ''
  const charCount = content.replace(/\s/g, '').length
  const minutes = Math.max(1, Math.round(charCount / 400))

  return (
    <>
      {/* Scrim — 仅主区 */}
      <div
        className="fixed inset-y-0 left-[200px] right-0 z-40 bg-black/60 backdrop-blur-[1px] animate-in fade-in-0 duration-200"
        onClick={onClose}
      />
      {/* Panel — 右侧抽屉 */}
      <aside
        className="fixed inset-y-0 right-0 z-50 flex w-[520px] max-w-[92vw] flex-col border-l border-[#ffffff14] bg-[#1E1E28] shadow-[-48px_0_48px_#00000066] animate-in slide-in-from-right duration-300"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#ffffff14] px-6 py-[18px]">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[11px] text-text-label">
              知识预览{entry ? ` · ${entry.category}` : ''}
            </span>
            <h2 className="truncate text-lg font-semibold text-text-primary">
              {entry ? entry.name : '加载中…'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="关闭"
            className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[#ffffff0f] text-text-secondary transition-colors hover:bg-[#ffffff1a] hover:text-text-primary"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-6 pb-6 pt-5">
          {entry ? (
            <>
              <div className="flex items-center gap-2">
                <span className="rounded-sm bg-[#6366f120] px-2 py-[3px] text-[11px] text-[#A5B4FC]">
                  {entry.category}
                </span>
                <span className="text-[11px] text-text-label">
                  约 {charCount} 字 · {minutes} 分钟阅读
                </span>
              </div>
              <div className="h-px bg-[#ffffff0f]" />
            </>
          ) : null}

          {loading && !detail ? (
            <p className="text-sm text-text-tertiary">加载中…</p>
          ) : detail ? (
            <article className="prose prose-invert max-w-none text-sm leading-relaxed text-text-secondary">
              <MarkdownRenderer>{content}</MarkdownRenderer>
            </article>
          ) : null}
        </div>

        {/* Footer — 上一篇 / 下一篇 */}
        <div className="flex items-center justify-between border-t border-[#ffffff14] px-6 py-3.5">
          <button
            type="button"
            onClick={onPrev}
            disabled={!hasPrev}
            className="flex min-w-0 items-center gap-1.5 text-xs text-text-tertiary transition-colors hover:text-text-primary disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronLeft className="size-3.5 shrink-0" />
            <span className="truncate">
              {hasPrev ? `上一篇 · ${prevTitle ?? ''}` : '已是第一篇'}
            </span>
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!hasNext}
            className="flex min-w-0 items-center gap-1.5 text-xs text-text-secondary transition-colors hover:text-text-primary disabled:pointer-events-none disabled:opacity-30"
          >
            <span className="truncate">
              {hasNext ? `下一篇 · ${nextTitle ?? ''}` : '已是最后一篇'}
            </span>
            <ChevronRight className="size-3.5 shrink-0" />
          </button>
        </div>
      </aside>
    </>
  )
}

export default KnowledgeDetailDrawer
