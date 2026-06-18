'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { useStore } from '@/store'
import { getNovel } from '@/api/novels'
import type { Novel } from '@/types/novel'
import RequireAuth from '@/components/auth/RequireAuth'
import ResourceNav from '@/components/workspace/ResourceNav'
import ChapterPreview from '@/components/workspace/ChapterDetail'
import ChatPanel from '@/components/workspace/ChatPanel'

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

  if (!novel) return <div className="p-8 text-sm text-muted">加载中…</div>

  return (
    <div className="flex h-screen bg-background/80">
      <ResourceNav novel={novel} />
      <div className="flex flex-1 overflow-hidden">
        <ChatPanel
          sessionId={novel.sessionId}
          selectedChapterId={selectedChapterId}
          onAccepted={refresh}
          autoStart={novel.status === 'CONCEPT'}
        />
        {novel.status !== 'CONCEPT' && (
          <ChapterPreview
            chapter={novel.chapters.find((c) => c.id === selectedChapterId)}
            novel={novel}
            chapters={novel.chapters}
            novelId={novel.id}
            onSaved={refresh}
          />
        )}
      </div>
    </div>
  )
}
