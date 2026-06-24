'use client'

import { useEffect } from 'react'
import { useQueryState } from 'nuqs'
import { useStore } from '@/store'
import useChatActions from '@/hooks/useChatActions'
import MessageArea from '@/components/chat/ChatArea/MessageArea'
import ChatInput from '@/components/chat/ChatArea/ChatInput'
import { getSessionAPI } from '@/api/os'
import type { ChatMessage } from '@/types/os'
import type { Novel } from '@/types/novel'
import { deriveIdlePhase } from '@/lib/phase'

interface Props {
  sessionId: string
  novel: Novel
  onAccepted: () => void
}

interface SessionRun {
  run_input: string
  content: string
  created_at: number
  user_message_id: string
  user_message_lang_id: string | null
  is_error: boolean
}

const ChatPanel = ({ sessionId, novel, onAccepted }: Props) => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const setMessages = useStore((s) => s.setMessages)
  const currentChapterOrder = useStore((s) => s.currentChapterOrder)
  const activePhase = useStore((s) => s.activePhase)
  const phase = activePhase ?? deriveIdlePhase(novel, currentChapterOrder)
  const { initialize } = useChatActions()
  const [, setAgentId] = useQueryState('agent')
  const [, setSessionId] = useQueryState('session')
  const [, setDbId] = useQueryState('db_id')

  // 挂载:设好 nuqs(agent/session/db_id)→ 现有 ChatInput 即可复用。
  useEffect(() => {
    setAgentId('deep-agent')
    setDbId('default')
    setSessionId(sessionId)
    initialize()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // 载入这本小说的聊天历史(把 run pairs 还原成 messages)。
  // 开场白在 NovelService.create 时已种入 DB(user "你好" + assistant 问候),
  // 这里历史加载完用户就能直接看到 agent 的第一条消息。
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const runs = await getSessionAPI(
          endpoint,
          'agent',
          sessionId,
          undefined,
          token
        )
        if (cancelled) return
        const list = (Array.isArray(runs) ? runs : []) as SessionRun[]
        const history: ChatMessage[] = []
        for (const r of list) {
          history.push({
            role: 'user',
            content: r.run_input,
            id: r.user_message_id,
            langGraphId: r.user_message_lang_id ?? undefined,
            created_at: r.created_at
          })
          history.push({
            role: 'agent',
            content: r.content,
            isError: r.is_error,
            created_at: r.created_at + 1
          })
        }
        setMessages(history)
      } catch {
        /* 历史加载失败不阻塞,空聊天也能用 */
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // 每轮结束(写作 Agent 可能已改稿件)→ 刷新 novel,让正文面板更新。
  useEffect(() => {
    let prev = useStore.getState().isStreaming
    const unsub = useStore.subscribe((s) => {
      if (prev && !s.isStreaming) onAccepted()
      prev = s.isStreaming
    })
    return unsub
  }, [onAccepted])

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between px-5 py-2 text-xs text-muted">
        <span>💬 聊天 · 一本小说一份记忆</span>
        <span>📍 {phase}</span>
      </div>
      <MessageArea />
      <div className="sticky bottom-0 px-4 pb-2">
        <ChatInput />
      </div>
    </div>
  )
}

export default ChatPanel
