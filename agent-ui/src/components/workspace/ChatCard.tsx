'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { ArrowLeft } from 'lucide-react'

import { useStore } from '@/store'
import useChatActions from '@/hooks/useChatActions'
import MessageArea from '@/components/chat/ChatArea/MessageArea'
import { getSessionAPI } from '@/api/os'
import type { ChatMessage } from '@/types/os'
import type { Novel } from '@/types/novel'
import { deriveIdlePhase } from '@/lib/phase'

import AccountChip from './AccountChip'
import InputCapsule from './InputCapsule'
import StatusPopover from './StatusPopover'

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

/**
 * ChatCard — left twin card. ChatHead (返回 + 书名·类型 + phase pill + 进度 pill
 * + AccountChip) + MessageArea + InputCapsule. All ChatPanel effects preserved
 * (nuqs agent/session/db_id, history load, streaming→refresh, idle phase).
 */
const ChatCard = ({ sessionId, novel, onAccepted }: Props) => {
  const router = useRouter()
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

  // 挂载:设好 nuqs(agent/session/db_id)→ 现有 InputCapsule 即可复用。
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

  // 进度 pill:W2 由 StatusPopover 接管(GET /novels/:id/status → 进度/立项/下一步)。
  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-overlay-15 bg-bg-card shadow-[0_6px_24px_#00000066] [clip-path:inset(0_round(16px))]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-overlay-10 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => router.push('/')}
            aria-label="返回"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-overlay-10 hover:text-text-primary"
          >
            <ArrowLeft className="size-4" />
          </button>
          <span className="truncate text-sm font-medium text-text-primary">
            {novel.title}
            <span className="text-text-label">·{novel.genre || '-'}</span>
          </span>
          <span className="ml-1 shrink-0 rounded-full bg-accent-primarySoft px-2 py-0.5 text-xs text-accent-indigoLight">
            {phase}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusPopover novelId={novel.id} />
          <AccountChip
            novelId={novel.id}
            voiceProfileId={novel.voiceProfileId}
            onVoiceProfileSaved={onAccepted}
          />
        </div>
      </header>
      <MessageArea />
      <InputCapsule />
    </section>
  )
}

export default ChatCard
