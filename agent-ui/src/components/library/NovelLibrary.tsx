'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, ChevronLeft, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/store'
import { createNovel, deleteNovel, listNovels } from '@/api/novels'
import type { NovelListItem } from '@/types/novel'
import NovelCard from './NovelCard'
import PublishDialog from './PublishDialog'
import PageShell from '@/components/layout/PageShell'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const STATUS_FILTERS: Array<{
  key: 'all' | 'CONCEPT' | 'ACTIVE'
  label: string
}> = [
  { key: 'all', label: '全部' },
  { key: 'CONCEPT', label: '构思中' },
  { key: 'ACTIVE', label: '写作中' }
]

const PAGE_SIZE = 12

const NovelLibrary = () => {
  const router = useRouter()
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const [novels, setNovels] = useState<NovelListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState<NovelListItem | null>(null)
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'CONCEPT' | 'ACTIVE'
  >('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)

  const filtered =
    statusFilter === 'all'
      ? novels
      : novels.filter((n) => n.status === statusFilter)

  const searchLower = search.trim().toLowerCase()
  const searched = searchLower
    ? filtered.filter(
        (n) =>
          n.title.toLowerCase().includes(searchLower) ||
          (n.genre || '').toLowerCase().includes(searchLower)
      )
    : filtered

  const totalPages = Math.ceil(searched.length / PAGE_SIZE)
  const pageItems = searched.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setNovels(await listNovels(endpoint, token))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [endpoint, token])

  useEffect(() => {
    refresh()
  }, [refresh])

  // 重置到第一页 when filter/search changes
  useEffect(() => {
    setPage(0)
  }, [statusFilter, search])

  const onNewNovel = async () => {
    try {
      const novel = await createNovel(endpoint, token, { title: '未命名' })
      router.push(`/novels/${novel.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建失败')
    }
  }

  const onDeleteNovel = async (id: string) => {
    try {
      await deleteNovel(endpoint, token, id)
      setNovels((prev) => prev.filter((n) => n.id !== id))
      toast.success('已删除')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  const onPublishNovel = (n: NovelListItem) => setPublishing(n)

  return (
    <PageShell
      active="library"
      title="我的小说"
      headerRight={
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-[240px] items-center gap-2 rounded-md border border-overlay-15 bg-bg-darkest px-3">
            <Search className="size-3.5 shrink-0 text-text-label" />
            <input
              type="text"
              placeholder="搜索小说..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-label"
            />
          </div>
          <Button
            variant="gradient"
            className="rounded-pill"
            onClick={onNewNovel}
          >
            + 新建小说
          </Button>
        </div>
      }
    >
      {loading ? (
        <p className="text-sm text-text-tertiary">加载中…</p>
      ) : novels.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center gap-2 text-text-tertiary">
          <p className="text-sm">还没有小说,点击「新建小说」开始。</p>
        </div>
      ) : searched.length === 0 ? (
        <div className="flex h-64 items-center justify-center text-text-tertiary">
          <p className="text-sm">没有匹配的小说。</p>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {STATUS_FILTERS.map((f) => {
              const active = statusFilter === f.key
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setStatusFilter(f.key)}
                  className={cn(
                    'rounded-pill px-3 py-1.5 text-xs font-medium',
                    active
                      ? 'border border-accent-primary bg-accent-primarySoft text-accent-indigoLight'
                      : 'border border-overlay-10 text-text-tertiary hover:text-text-primary'
                  )}
                >
                  {f.label}
                </button>
              )
            })}
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
            {pageItems.map((n) => (
              <NovelCard
                key={n.id}
                novel={n}
                onDelete={onDeleteNovel}
                onPublish={onPublishNovel}
              />
            ))}
          </div>
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="flex size-8 items-center justify-center rounded-md bg-overlay-5 text-text-tertiary transition-colors hover:text-text-primary disabled:opacity-30"
              >
                <ChevronLeft className="size-4" />
              </button>
              {Array.from({ length: totalPages }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPage(i)}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-md text-sm transition-colors',
                    page === i
                      ? 'border border-accent-primary bg-accent-primarySoft font-semibold text-accent-indigoLight'
                      : 'bg-overlay-5 text-text-tertiary hover:text-text-primary'
                  )}
                >
                  {i + 1}
                </button>
              ))}
              <button
                type="button"
                onClick={() =>
                  setPage((p) => Math.min(totalPages - 1, p + 1))
                }
                disabled={page >= totalPages - 1}
                className="flex size-8 items-center justify-center rounded-md bg-overlay-5 text-text-tertiary transition-colors hover:text-text-primary disabled:opacity-30"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          )}
        </>
      )}
      <PublishDialog novel={publishing} onClose={() => setPublishing(null)} />
    </PageShell>
  )
}

export default NovelLibrary
