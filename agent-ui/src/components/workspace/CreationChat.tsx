'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { useStore } from '@/store'
import useChatActions from '@/hooks/useChatActions'
import MessageArea from '@/components/chat/ChatArea/MessageArea'
import ChatInput from '@/components/chat/ChatArea/ChatInput'
import { listNovels } from '@/api/novels'

/**
 * 创作聊天:指向创作 Agent(mode=creation,无 novel)。
 * 创作 Agent 在问答中调 create_novel 建书后,这里检测到"新增小说"就跳到该书工作台。
 */
const CreationChat = () => {
  const router = useRouter()
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const setMessages = useStore((s) => s.setMessages)
  const { initialize } = useChatActions()
  const [, setAgentId] = useQueryState('agent')
  const [, setSessionId] = useQueryState('session')
  const [, setDbId] = useQueryState('db_id')
  const [, setMode] = useQueryState('mode')
  // 进入创作时已有的小说 id;create_novel 建新书后才检测得到"新增"。
  const initialNovelIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    setMessages([])
    setAgentId('deep-agent')
    setDbId('default')
    setMode('creation')
    setSessionId(`creation-${Math.random().toString(36).slice(2)}`)
    void listNovels(endpoint, token)
      .then((ns) => {
        initialNovelIds.current = new Set(ns.map((n) => n.id))
      })
      .catch(() => {
        /* ignore */
      })
    initialize()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 每轮结束(isStreaming true→false)后,若出现新增小说 → 跳转。
  useEffect(() => {
    let prev = useStore.getState().isStreaming
    const unsub = useStore.subscribe((s) => {
      if (prev && !s.isStreaming) {
        void listNovels(endpoint, token)
          .then((ns) => {
            const created = ns.find((n) => !initialNovelIds.current.has(n.id))
            if (created) router.replace(`/novels/${created.id}`)
          })
          .catch(() => {
            /* ignore */
          })
      }
      prev = s.isStreaming
    })
    return unsub
  }, [endpoint, token, router])

  return (
    <div className="flex flex-1 flex-col">
      <div className="px-5 py-2 text-xs text-muted">
        💬 创作 Agent · 问答立项
      </div>
      <MessageArea />
      <div className="sticky bottom-0 px-4 pb-2">
        <ChatInput />
      </div>
    </div>
  )
}

export default CreationChat
