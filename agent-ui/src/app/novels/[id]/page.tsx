'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { useStore } from '@/store'
import { getNovel, createChapter } from '@/api/novels'
import type { Novel } from '@/types/novel'
import RequireAuth from '@/components/auth/RequireAuth'
import ResourceNav from '@/components/workspace/ResourceNav'

export default function NovelWorkspacePage() {
  return (
    <RequireAuth>
      <Workspace />
    </RequireAuth>
  )
}

const Workspace = () => {
  const params = useParams<{ id: string }>()
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const [novel, setNovel] = useState<Novel | null>(null)
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(
    null
  )

  const refresh = useCallback(async () => {
    try {
      const n = await getNovel(endpoint, token, params.id)
      setNovel(n)
      setSelectedChapterId((prev) => prev ?? n.chapters[0]?.id ?? null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败')
    }
  }, [endpoint, token, params.id])

  useEffect(() => {
    refresh()
  }, [refresh])

  const onNewChapter = async () => {
    try {
      await createChapter(endpoint, token, params.id)
      refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '新建失败')
    }
  }

  if (!novel) return <div className="p-8 text-sm text-muted">加载中…</div>

  return (
    <div className="flex h-screen bg-background/80">
      <ResourceNav
        novelTitle={novel.title}
        chapters={novel.chapters}
        selectedChapterId={selectedChapterId}
        onSelectChapter={setSelectedChapterId}
        onNewChapter={onNewChapter}
      />
      <div className="flex flex-1 items-center justify-center text-sm text-muted">
        聊天 + 稿件区(下一任务实现)
      </div>
    </div>
  )
}
