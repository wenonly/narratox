'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useStore } from '@/store'
import { createNovel, listNovels } from '@/api/novels'
import type { NovelListItem } from '@/types/novel'
import NovelCard from './NovelCard'
import { Button } from '@/components/ui/button'
import Icon from '@/components/ui/icon'

const NovelLibrary = () => {
  const router = useRouter()
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const logout = useStore((s) => s.logout)
  const [novels, setNovels] = useState<NovelListItem[]>([])
  const [loading, setLoading] = useState(true)

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

  return (
    <div className="flex h-screen bg-background/80">
      <aside className="flex w-60 shrink-0 flex-col gap-3 border-r border-primary/10 px-4 py-5 font-dmmono">
        <div className="flex items-center gap-2">
          <Icon type="agno" size="xs" />
          <span className="text-xs font-medium uppercase text-white">
            narratox
          </span>
        </div>
        <Button
          onClick={onNewNovel}
          className="h-9 rounded-xl bg-primary text-xs font-medium text-background hover:bg-primary/80"
        >
          + 新建小说
        </Button>
        <div className="mt-auto">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              logout()
              router.replace('/login')
            }}
            className="text-muted"
          >
            登出
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-8">
        <h1 className="mb-6 text-lg font-semibold text-primary">我的小说</h1>
        {loading ? (
          <p className="text-sm text-muted">加载中…</p>
        ) : novels.length === 0 ? (
          <p className="text-sm text-muted">
            还没有小说，点击「新建小说」开始。
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {novels.map((n) => (
              <NovelCard key={n.id} novel={n} />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

export default NovelLibrary
