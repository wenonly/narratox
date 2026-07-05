'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

import { useStore } from '@/store'
import { getNovelReferences } from '@/api/novels'
import type { NovelReference } from '@/types/novel'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'

// 折叠态摘要:正文首行去 markdown 后截到 60 字。
const essence = (content: string): string => {
  const text = content
    .replace(/^#+\s*/m, '')
    .replace(/[*_`>-]/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)[0]
  if (!text) return ''
  return text.length > 60 ? text.slice(0, 60) + '…' : text
}

/**
 * 工作台「参考资料」面板(Pencil R5)。
 * 两节:已关联(injectTo ≠ null,精要置顶) · 资料库索引(injectTo = null,
 * 工具可取)。条目折叠:collapsed = 标题+摘要;expanded = 标题+正文(纯文本)。
 * R5 移除了 per-entry 分类徽标。
 */
export const ReferencesView = ({ novel }: { novel: { id: string } }) => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const referenceWriteSeq = useStore((s) => s.referenceWriteSeq)
  const [refs, setRefs] = useState<NovelReference[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getNovelReferences(endpoint, token, novel.id)
      .then((d) => {
        if (!cancelled) setRefs(d)
      })
      .catch(() => {
        if (!cancelled) setRefs(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [endpoint, token, novel.id, referenceWriteSeq])

  if (loading)
    return <p className="text-sm text-text-tertiary">加载参考资料…</p>
  if (!refs || refs.length === 0) {
    return (
      <p className="text-sm text-text-tertiary">
        参考资料尚未生成。立项信息收集齐后,curator 子 agent
        会自动搜全局知识库并提炼本书专属参考资料(词汇/描写/方法论/须知等, 带
        injectTo 标注),这里会逐条显示。
      </p>
    )
  }

  const tagged = refs.filter((r) => r.injectTo)
  const library = refs.filter((r) => !r.injectTo)

  const renderEntry = (r: NovelReference) => {
    const isOpen = openId === r.id
    return (
      <div
        key={r.id}
        className="rounded-md border border-overlay-15 bg-bg-cardElevated px-3 py-2"
      >
        {isOpen ? (
          <button
            type="button"
            onClick={() => setOpenId((cur) => (cur === r.id ? null : r.id))}
            className="flex w-full items-center gap-1.5 text-left"
          >
            <ChevronDown className="size-3.5 shrink-0 text-text-label" />
            <span className="text-sm font-medium text-text-primary">
              {r.title}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setOpenId((cur) => (cur === r.id ? null : r.id))}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <ChevronRight className="size-3.5 shrink-0 text-text-label" />
              <span className="truncate text-sm text-text-primary">
                {r.title}
              </span>
            </span>
            {r.content && (
              <span className="ml-2 shrink-0 truncate text-xs text-text-tertiary">
                {essence(r.content)}
              </span>
            )}
          </button>
        )}
        {isOpen && (
          <div className="mt-2 border-t border-overlay-10 pt-2">
            {r.content ? (
              <div className="prose prose-invert max-w-none text-xs leading-relaxed text-text-secondary">
                <MarkdownRenderer>{r.content}</MarkdownRenderer>
              </div>
            ) : (
              <p className="text-xs text-text-tertiary">（无正文）</p>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {tagged.length > 0 && (
        <div>
          <p className="mb-1.5 text-[10px] font-semibold tracking-wide text-text-tertiary">
            已关联 · {tagged.length}
          </p>
          <div className="space-y-1.5">{tagged.map(renderEntry)}</div>
        </div>
      )}
      {library.length > 0 && (
        <div>
          <p className="mb-1.5 text-[10px] font-semibold tracking-wide text-text-tertiary">
            资料库索引 · {library.length}
          </p>
          <div className="space-y-1.5">{library.map(renderEntry)}</div>
        </div>
      )}
    </div>
  )
}

export default ReferencesView
