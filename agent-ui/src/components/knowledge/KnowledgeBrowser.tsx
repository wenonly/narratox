'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '@/store'
import { listKnowledge, getKnowledgeEntry } from '@/api/knowledge'
import type { KbCategory, KbEntry, KbEntryDetail } from '@/types/knowledge'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'
import { Badge } from '@/components/ui/badge'
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

  const tagList = useMemo(() => {
    const all: string[] = []
    entries.forEach((e) => e.tags.forEach((v) => all.push(v)))
    return [...new Set(all)]
  }, [entries])

  return (
    <div className="flex h-[calc(100vh-7rem)] gap-3">
      {/* 左栏:搜索 + 分类 + 列表 */}
      <div className="flex w-80 flex-col gap-2">
        <input
          className="w-full rounded-input border border-overlay-15 bg-bg-card px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-label"
          placeholder="🔍 搜索标题/描述"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex flex-wrap gap-1">
          <button
            className={cn(
              'rounded px-2 py-0.5 text-xs',
              !activeCat
                ? 'bg-accent-primarySoft font-medium text-text-primary'
                : 'text-text-tertiary hover:text-text-primary'
            )}
            onClick={() => setActiveCat(undefined)}
          >
            全部 {categories.reduce((s, c) => s + c.count, 0)}
          </button>
          {categories.map((c) => (
            <button
              key={c.name}
              className={cn(
                'rounded px-2 py-0.5 text-xs',
                activeCat === c.name
                  ? 'bg-accent-primarySoft font-medium text-text-primary'
                  : 'text-text-tertiary hover:text-text-primary'
              )}
              onClick={() => setActiveCat(c.name)}
            >
              {c.name} {c.count}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto rounded-md border border-overlay-15">
          {loading && <p className="p-3 text-xs text-text-tertiary">加载中…</p>}
          {!loading && entries.length === 0 && (
            <p className="p-3 text-xs text-text-tertiary">无匹配条目</p>
          )}
          {entries.map((e) => (
            <button
              key={e.id}
              onClick={() => setSelectedId(e.id)}
              className={cn(
                'block w-full border-b border-overlay-10 px-3 py-2 text-left transition-colors',
                selectedId === e.id
                  ? 'bg-accent-primarySoft'
                  : 'hover:bg-overlay-10'
              )}
            >
              <div className="flex items-center gap-1 text-sm text-text-primary">
                <span className="truncate">{e.name}</span>
              </div>
              <p className="truncate text-xs text-text-tertiary">
                {e.description}
              </p>
            </button>
          ))}
        </div>
        {tagList.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tagList.slice(0, 12).map((t) => (
              <Badge key={t} variant="neutral">
                #{t}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* 右栏:阅读器 */}
      <div className="flex-1 overflow-y-auto rounded-md border border-overlay-15 bg-bg-card p-6">
        {!detail && (
          <p className="text-sm text-text-tertiary">从左侧选一条查看正文。</p>
        )}
        {detail && (
          <>
            <h2 className="mb-1 text-base font-semibold text-text-primary">
              {detail.entry.name}
            </h2>
            <p className="mb-4 text-xs text-text-tertiary">
              {detail.entry.category}
              {detail.entry.tags.length > 0 &&
                ` · ${detail.entry.tags.map((t) => `#${t}`).join(' ')}`}
            </p>
            <article className="prose prose-invert max-w-none text-sm">
              <MarkdownRenderer>{detail.content}</MarkdownRenderer>
            </article>
          </>
        )}
      </div>
    </div>
  )
}

export default KnowledgeBrowser
