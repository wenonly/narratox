'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { useStore } from '@/store'
import { getNovel } from '@/api/novels'
import { useChapterMemory } from '@/hooks/useChapterMemory'
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
  const chapterWriteSeq = useStore((s) => s.chapterWriteSeq)
  const currentChapterOrder = useStore((s) => s.currentChapterOrder)
  const setCurrentChapterOrder = useStore((s) => s.setCurrentChapterOrder)
  const setManualLock = useStore((s) => s.setManualLock)
  const setMessages = useStore((s) => s.setMessages)
  const [novel, setNovel] = useState<Novel | null>(null)
  const [activeResource, setActiveResource] = useState<ResourceKey | null>(null)

  // 记录最近一次写入的章节序号,用于在写作轮结束后启动记忆轮询
  const lastWrittenOrder = useRef<number | null>(null)
  const settledRef = useRef(false)
  useEffect(() => {
    if (writingChapterOrder !== null) {
      lastWrittenOrder.current = writingChapterOrder
      settledRef.current = false // 新一轮写入,重置结算标记
    }
  }, [writingChapterOrder])

  // 写作进行中(writingChapterOrder !== null)不轮询;写作结束后对最近写入的章节轮询直到结算
  const pollingOrder =
    writingChapterOrder === null ? lastWrittenOrder.current : null
  const { status: memoryStatus, memory } = useChapterMemory(
    params.id,
    pollingOrder,
    writingChapterOrder === null && pollingOrder !== null && !settledRef.current
  )

  // 记忆结算后挂到最后一条 agent 消息上,并消费 ref 避免重复挂载
  useEffect(() => {
    if (memory && memoryStatus === 'settled' && !settledRef.current) {
      settledRef.current = true
      setMessages((prev) => {
        const next = [...prev]
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].role === 'agent') {
            next[i] = { ...next[i], memory }
            break
          }
        }
        return next
      })
      lastWrittenOrder.current = null
    }
  }, [memory, memoryStatus, setMessages])

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

  // 切换小说 → 重置面板焦点(旧小说的 order 不适用新小说)
  useEffect(() => {
    setCurrentChapterOrder(null)
    setManualLock(false)
  }, [params.id, setCurrentChapterOrder, setManualLock])

  // 首次载入(或切小说后)→ 默认显示最新章;CONCEPT/无章时保持 null
  useEffect(() => {
    if (currentChapterOrder != null) return
    if (!novel || novel.chapters.length === 0) return
    const maxOrder = novel.chapters.reduce((m, c) => Math.max(m, c.order), 0)
    if (maxOrder > 0) setCurrentChapterOrder(maxOrder)
  }, [novel, currentChapterOrder, setCurrentChapterOrder])

  // 跟随效应:agent 写第 K 章 → 若用户未手动锁定,面板跳到 K
  useEffect(() => {
    if (writingChapterOrder == null) return
    if (useStore.getState().manualLock) return
    setCurrentChapterOrder(writingChapterOrder)
  }, [writingChapterOrder, setCurrentChapterOrder])

  // 每次 append_section 落库信号 → 刷新 novel,正文面板实时显示不断增长的当前章正文
  useEffect(() => {
    if (chapterWriteSeq > 0) refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterWriteSeq])

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
        novel={novel}
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
