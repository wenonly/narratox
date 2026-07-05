'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
 * 不可见的"底部哨兵"——追加到 data 末尾,用作 scrollToIndex 的可靠锚点。
 * 高度极小且固定(1px),Virtuoso 不需要等待动态测高就能准确定位;
 * 对比直接 scrollToIndex 到最后一条消息(动态高度,初始估算不准),这个方案稳定。
 */
const SENTINEL: ChatMessage = {
  role: 'system',
  content: '',
  created_at: 0
}

/**
 * 稳定 key:user 用 DB id;agent 无 id → created_at + 内容指纹;流式 tail 用固定 key。
 */
const stableKey = (msg: ChatMessage, isStreamingTail: boolean): string => {
  if (msg === SENTINEL) return '__sentinel__'
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

  // data = 真实 messages + 1 个 sentinel。sentinel 不影响 recall 下标(它在末尾)。
  const data = useMemo<ChatMessage[]>(
    () => (messages.length > 0 ? [...messages, SENTINEL] : []),
    [messages]
  )

  // mount 后滚到底部:rAF 等 Virtuoso 渲染一帧 → scrollToIndex 定位到 sentinel(1px 固定高,定位准确)。
  useEffect(() => {
    if (data.length === 0) return
    const raf = requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({
        index: data.length - 1,
        align: 'start',
        behavior: 'auto'
      })
    })
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.length === 0])

  const scrollToBottom = () =>
    virtuosoRef.current?.scrollToIndex({
      index: data.length - 1,
      align: 'start',
      behavior: 'smooth'
    })

  // 空态:flex-grow 撑满剩余空间 + 垂直居中,输入框自然落到底部。
  if (messages.length === 0) {
    return (
      <div className="flex flex-grow items-center justify-center">
        <ChatBlankState />
      </div>
    )
  }

  const lastIdx = messages.length - 1
  const lastMessage = messages[lastIdx]

  return (
    <div className="relative mb-4 flex max-h-[calc(100vh-64px)] min-h-0 flex-grow flex-col">
      <Virtuoso<ChatMessage>
        ref={virtuosoRef}
        data={data}
        computeItemKey={(_, item) =>
          stableKey(item, isStreaming && item === lastMessage)
        }
        firstItemIndex={firstItemIndex ?? 0}
        followOutput={(isAtBottom) => (isAtBottom ? 'smooth' : false)}
        atBottomStateChange={setIsAtBottom}
        startReached={onLoadMore ? () => onLoadMore() : undefined}
        increaseViewportBy={{ top: 800, bottom: 800 }}
        className="flex-grow"
        itemContent={(index, message) => {
          if (message === SENTINEL) return <div className="h-px" />
          return (
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
          )
        }}
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
