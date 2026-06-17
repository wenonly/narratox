'use client'

import { useEffect } from 'react'
import { useQueryState } from 'nuqs'
import { useStore } from '@/store'
import useChatActions from '@/hooks/useChatActions'
import MessageArea from '@/components/chat/ChatArea/MessageArea'
import ChatInput from '@/components/chat/ChatArea/ChatInput'
import { getSessionAPI } from '@/api/os'
import type { ChatMessage } from '@/types/os'

interface Props {
  sessionId: string
  selectedChapterId: string | null
  onAccepted: () => void
}

interface SessionRun {
  run_input: string
  content: string
  created_at: number
}

const ChatPanel = ({ sessionId, selectedChapterId, onAccepted }: Props) => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const setMessages = useStore((s) => s.setMessages)
  const { initialize } = useChatActions()
  const [, setAgentId] = useQueryState('agent')
  const [, setSessionId] = useQueryState('session')
  const [, setDbId] = useQueryState('db_id')

  // 挂载:设好 nuqs(agent/session/db_id)→ 现有 useAIStreamHandler + ChatInput 即可复用。
  useEffect(() => {
    setAgentId('deep-agent')
    setDbId('default')
    setSessionId(sessionId)
    initialize()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // 载入这本小说的聊天历史(把 run pairs 还原成 messages)。
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
            created_at: r.created_at
          })
          history.push({
            role: 'agent',
            content: r.content,
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

  // 每轮结束(写作 Agent 可能已用 write_chapter 改了稿件)→ 刷新 novel,让 ChapterDetail 更新。
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
        <span>✍ 目标:{selectedChapterId ? '当前章' : '未选章'}</span>
      </div>
      <MessageArea />
      <div className="sticky bottom-0 px-4 pb-2">
        <ChatInput />
      </div>
    </div>
  )
}

export default ChatPanel
