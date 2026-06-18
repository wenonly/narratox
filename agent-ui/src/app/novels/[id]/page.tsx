'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { useStore } from '@/store'
import { getNovel } from '@/api/novels'
import type { Novel } from '@/types/novel'
import RequireAuth from '@/components/auth/RequireAuth'
import IconRail from '@/components/workspace/IconRail'
import ResourcePanel from '@/components/workspace/ResourcePanel'
import ChatPanel from '@/components/workspace/ChatPanel'

type ResourceKey =
  | 'outline'
  | 'chapters'
  | 'characters'
  | 'worldview'
  | 'status'
  | 'info'

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
  const writingChapterOrder = useStore((s) => s.writingChapterOrder)
  const [novel, setNovel] = useState<Novel | null>(null)
  const [activeResource, setActiveResource] = useState<ResourceKey | null>(null)

  const refresh = useCallback(async () => {
    try {
      setNovel(await getNovel(endpoint, token, params.id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败')
    }
  }, [endpoint, token, params.id])

  useEffect(() => {
    refresh()
  }, [refresh])

  // WritingChapter → auto-open chapters panel
  useEffect(() => {
    if (writingChapterOrder !== null) setActiveResource('chapters')
  }, [writingChapterOrder])

  // CONCEPT → default to info panel
  useEffect(() => {
    if (novel?.status === 'CONCEPT' && activeResource === null)
      setActiveResource('info')
  }, [novel?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!novel) return <div className="p-8 text-sm text-muted">加载中…</div>

  return (
    <div className="flex h-screen bg-background/80">
      <IconRail
        activeResource={activeResource}
        onSelectResource={setActiveResource}
      />
      <ChatPanel
        sessionId={novel.sessionId}
        selectedChapterId={null}
        onAccepted={refresh}
      />
      {activeResource && (
        <ResourcePanel
          resource={activeResource}
          novel={novel}
          onClose={() => setActiveResource(null)}
          onSaved={refresh}
        />
      )}
    </div>
  )
}
