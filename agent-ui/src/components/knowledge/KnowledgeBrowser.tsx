'use client'

import { useCallback, useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { useStore } from '@/store'
import { listKnowledge, getKnowledgeEntry } from '@/api/knowledge'
import type { KbCategory, KbEntry, KbEntryDetail } from '@/types/knowledge'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

const KnowledgeBrowser = () => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)

  const [categories, setCategories] = useState<KbCategory[]>([])
  const [entries, setEntries] = useState<KbEntry[]>([])
  const [activeCat, setActiveCat] = useState<string | undefined>(undefined)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<KbEntryDetail | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!endpoint || !token) return
    setLoading(true)
    try {
      const { categories, entries } = await listKnowledge(endpoint, token, {
        category: activeCat,
        search: search.trim() || undefined
      })
      setCategories(categories)
      setEntries(entries)
    } catch {
      setCategories([])
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [endpoint, token, activeCat, search])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!selectedId || !endpoint || !token) return
    getKnowledgeEntry(endpoint, token, selectedId)
      .then(setDetail)
      .catch(() => setDetail(null))
  }, [selectedId, endpoint, token])

  const totalCount = categories.reduce((s, c) => s + c.count, 0)

  return (
    <>
      <div className="flex flex-col gap-5">
        {/* 搜索框 */}
        <div className="flex h-10 w-full max-w-[480px] items-center gap-2.5 rounded-md border border-overlay-10 bg-bg-card px-3.5 text-sm">
          <Search className="size-4 shrink-0 text-text-label" />
          <input
            className="flex-1 bg-transparent text-text-primary outline-none placeholder:text-text-label"
            placeholder="搜索条目..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* 分类 chips */}
        <div className="flex flex-wrap gap-2">
          <button
            className={cn(
              'rounded-pill px-3 py-1.5 text-xs font-medium transition-colors',
              !activeCat
                ? 'bg-accent-primarySoft text-accent-violetLight'
                : 'bg-overlay-10 text-text-tertiary hover:text-text-primary'
            )}
            onClick={() => setActiveCat(undefined)}
          >
            全部 ({totalCount})
          </button>
          {categories.map((c) => (
            <button
              key={c.name}
              className={cn(
                'rounded-pill px-3 py-1.5 text-xs font-medium transition-colors',
                activeCat === c.name
                  ? 'bg-accent-primarySoft text-accent-violetLight'
                  : 'bg-overlay-10 text-text-tertiary hover:text-text-primary'
              )}
              onClick={() => setActiveCat(c.name)}
            >
              {c.name} ({c.count})
            </button>
          ))}
        </div>

        {/* 状态:加载中 / 无匹配 */}
        {loading && <p className="text-text-tertiary">加载中…</p>}
        {!loading && entries.length === 0 && (
          <p className="text-text-tertiary">无匹配条目</p>
        )}

        {/* 条目卡片网格 */}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
          {entries.map((e) => (
            <button
              key={e.id}
              onClick={() => setSelectedId(e.id)}
              className="flex h-[160px] flex-col gap-2 rounded-lg border border-overlay-15 bg-bg-card p-4 text-left transition-colors hover:border-accent-indigoLight"
            >
              {/* 标题 + 分类标签 */}
              <div className="flex items-center gap-2">
                <span className="line-clamp-1 flex-1 text-sm font-semibold text-text-primary">
                  {e.name}
                </span>
                <span className="shrink-0 rounded-sm bg-accent-primarySoft px-2 py-0.5 text-[11px] font-medium text-accent-violetLight">
                  {e.category}
                </span>
              </div>
              {/* 描述 */}
              <p className="line-clamp-3 text-xs leading-relaxed text-text-tertiary">
                {e.description}
              </p>
              {/* 元信息:首个标签 + 标签数 */}
              <div className="mt-auto flex items-center gap-2">
                {e.tags[0] && (
                  <span className="rounded-sm bg-overlay-10 px-1.5 py-0.5 text-[9px] text-text-label">
                    #{e.tags[0]}
                  </span>
                )}
                <span className="text-[9px] text-text-label">
                  {e.tags.length} 标签
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 详情 Dialog */}
      <Dialog
        open={selectedId !== null}
        onOpenChange={(o) => !o && setSelectedId(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detail?.entry.name}</DialogTitle>
            <DialogDescription>
              {detail?.entry.category}
              {detail &&
                detail.entry.tags.length > 0 &&
                ` · ${detail.entry.tags.map((t) => `#${t}`).join(' ')}`}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            {detail ? (
              <article className="prose prose-invert max-w-none text-sm">
                <MarkdownRenderer>{detail.content}</MarkdownRenderer>
              </article>
            ) : (
              <p className="text-text-tertiary">加载中…</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default KnowledgeBrowser
