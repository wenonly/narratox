'use client'

import { useRef, useState } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'

import { useStore } from '@/store'
import useRecallMessage from '@/hooks/useRecallMessage'
import type { ChatMessage } from '@/types/os'

import { AgentMessageWrapper } from './Messages/Messages'
import { UserMessage, RecallConfirmDialog } from './Messages/MessageItem'
import ChatBlankState from './Messages/ChatBlankState'
import ScrollToBottom from './ScrollToBottom'

interface Props {
  /** 滚到顶时触发(向上分页加载更老一页)。不传 → 不分页(ChatArea 旧入口走这条)。 */
  onLoadMore?: () => void
  /** 正在加载更老一页(顶部 spinner)。 */
  loadingMore?: boolean
  /** react-virtuoso prepend 锚定:每次向上加载 N 条,此值 -= N,滚动不跳。 */
  firstItemIndex?: number
}

/**
 * 稳定 key:user 用 DB id;agent 无 id → created_at + 内容指纹;流式 tail 用固定 key
 * (tail 的 content 每 token 变,内容指纹会飘 → 流式中用 `agent:streaming` 钉住,
 * 流结束后自然切回内容指纹,一次性 remount 那一条,无伤大雅)。
 */
const stableKey = (msg: ChatMessage, isStreamingTail: boolean): string => {
  if (msg.role === 'user') {
    return msg.id ? `user:${msg.id}` : `user:${msg.created_at}`
  }
  if (isStreamingTail) return 'agent:streaming'
  return `agent:${msg.created_at}:${msg.content.length}:${msg.content.slice(0, 32)}`
}

const MessageArea = ({ onLoadMore, loadingMore, firstItemIndex }: Props) => {
  const messages = useStore((s) => s.messages)
  const { recall, isStreaming } = useRecallMessage()
  const [recallIndex, setRecallIndex] = useState<number | null>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const virtuosoRef = useRef<VirtuosoHandle>(null)

  const scrollToBottom = () =>
    virtuosoRef.current?.scrollToIndex({
      index: 'LAST',
      behavior: 'smooth'
    })

  // 空态短路在 Virtuoso 外层(Virtuoso 对空 data 不渲染任何空态)。
  if (messages.length === 0) {
    return <ChatBlankState />
  }

  const lastIdx = messages.length - 1
  const lastMessage = messages[lastIdx]

  return (
    <div className="relative mb-4 flex max-h-[calc(100vh-64px)] min-h-0 flex-grow flex-col">
      <Virtuoso<ChatMessage>
        ref={virtuosoRef}
        data={messages}
        computeItemKey={(_, item) =>
          stableKey(item, isStreaming && item === lastMessage)
        }
        firstItemIndex={firstItemIndex ?? 0}
        initialTopMostItemIndex={lastIdx}
        followOutput={(isAtBottom) => (isAtBottom ? 'smooth' : false)}
        atBottomStateChange={setIsAtBottom}
        startReached={onLoadMore ? () => onLoadMore() : undefined}
        increaseViewportBy={{ top: 800, bottom: 800 }}
        className="flex-grow"
        itemContent={(index, message) => (
          <div className="mx-auto w-full max-w-2xl px-4 pb-9">
            {message.role === 'agent' ? (
              <AgentMessageWrapper
                message={message}
                isLastMessage={index === lastIdx}
                isStreaming={isStreaming && index === lastIdx}
              />
            ) : (
              <UserMessage
                message={message}
                disabled={isStreaming}
                onRequestRecall={() => setRecallIndex(index)}
              />
            )}
          </div>
        )}
        components={{
          Header: () =>
            (loadingMore ?? false) ? (
              <div className="py-3 text-center text-xs text-text-tertiary">
                加载更早消息…
              </div>
            ) : null
        }}
      />
      <ScrollToBottom
        isAtBottom={isAtBottom}
        onScrollToBottom={scrollToBottom}
      />
      <RecallConfirmDialog
        open={recallIndex !== null}
        onOpenChange={(o) => !o && setRecallIndex(null)}
        onConfirm={() => {
          const idx = recallIndex
          if (idx !== null) void recall(idx)
        }}
      />
    </div>
  )
}

export default MessageArea
