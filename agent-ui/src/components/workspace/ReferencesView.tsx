'use client'

import { useEffect, useState } from 'react'
import { useStore } from '@/store'
import { getNovelReferences } from '@/api/novels'
import type { NovelReference } from '@/types/novel'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'

// injectTo 徽标:标注每条参考资料自动注入哪个 agent;工具可取的(库原始资料)标灰。
// 已知角色给友好名,未知角色显示原名。
const BADGE: Record<string, string> = {
  main: '主 agent',
  writer: '写手',
  both: '主+写手',
  validator: '校验',
  settler: '结算',
  chapter: '章节编排',
  worldbuilder: '世界观编排',
  'wb-writer': '世界观写手',
  'wb-critic': '世界观评审',
  outliner: '大纲编排',
  'outline-writer': '大纲写手',
  'outline-critic': '大纲评审',
  character: '角色编排',
  'char-writer': '角色写手',
  'char-critic': '角色评审'
}

const badgeClass = (injectTo: string | null): string => {
  if (injectTo === 'both')
    return 'bg-accent-primarySoft text-accent-indigoLight'
  if (injectTo) return 'bg-overlay-10 text-text-primary' // 任意角色 tag
  return 'bg-overlay-10 text-text-tertiary'
}

const badgeText = (injectTo: string | null): string =>
  injectTo ? (BADGE[injectTo] ?? injectTo) : '工具可取'

/**
 * 工作台「参考资料」面板:列出本小说的 NovelReference(立项后由 curator 子 agent
 * 自动生成)。每条显示 injectTo 徽标 + 分类 + 标题,点击展开读正文(markdown)。
 * set_references 落库时 referenceWriteSeq bump → 自动重新拉取。
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

  // 有 tag 的精要置顶,库条目(null)沉底;组内稳定保原序(ES sort 稳定)。
  const sorted = [...refs].sort((a, b) => {
    const at = a.injectTo ? 0 : 1
    const bt = b.injectTo ? 0 : 1
    return at - bt
  })

  return (
    <div className="space-y-1.5">
      {sorted.map((r) => {
        const isOpen = openId === r.id
        return (
          <div
            key={r.id}
            className="rounded border border-overlay-15 bg-bg-card px-2 py-1.5"
          >
            <button
              type="button"
              onClick={() => setOpenId((cur) => (cur === r.id ? null : r.id))}
              className="flex w-full items-center justify-between text-left"
            >
              <span className="flex items-center gap-1.5 text-sm text-text-primary">
                <span className="truncate">{r.title}</span>
                <span
                  className={`shrink-0 rounded px-1 text-[10px] ${badgeClass(r.injectTo)}`}
                >
                  {badgeText(r.injectTo)}
                </span>
              </span>
              <span className="text-xs text-text-tertiary">
                {isOpen ? '▼' : '▶'}
              </span>
            </button>
            {!isOpen && (
              <p className="mt-0.5 truncate text-xs text-text-tertiary">
                {r.category}
              </p>
            )}
            {isOpen && (
              <div className="mt-2 space-y-1 border-t border-overlay-15 pt-2">
                <p className="text-xs text-text-tertiary">
                  分类:{r.category || '—'}
                </p>
                {r.content ? (
                  <div className="prose prose-invert max-w-none text-sm">
                    <MarkdownRenderer>{r.content}</MarkdownRenderer>
                  </div>
                ) : (
                  <p className="text-xs text-text-tertiary">（无正文）</p>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default ReferencesView
