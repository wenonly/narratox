'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useStore } from '@/store'
import { createNovel, deleteNovel, listNovels } from '@/api/novels'
import type { NovelListItem } from '@/types/novel'
import NovelCard from './NovelCard'
import PublishDialog from './PublishDialog'
import PageShell from '@/components/layout/PageShell'
import { Button } from '@/components/ui/button'

const NovelLibrary = () => {
  const router = useRouter()
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const [novels, setNovels] = useState<NovelListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState<NovelListItem | null>(null)

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
        <Button
          variant="gradient"
          className="rounded-pill"
          onClick={onNewNovel}
        >
          + 新建小说
        </Button>
      }
    >
      {loading ? (
        <p className="text-sm text-text-tertiary">加载中…</p>
      ) : novels.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center gap-2 text-text-tertiary">
          <p className="text-sm">还没有小说,点击「新建小说」开始。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {novels.map((n) => (
            <NovelCard
              key={n.id}
              novel={n}
              onDelete={onDeleteNovel}
              onPublish={onPublishNovel}
            />
          ))}
        </div>
      )}
      <PublishDialog novel={publishing} onClose={() => setPublishing(null)} />
    </PageShell>
  )
}

export default NovelLibrary
