'use client'

import { useCallback, useRef, useState } from 'react'

import { useStore } from '@/store'
import {
  getSessionAPI,
  type SessionRunDTO,
  type SessionRunsPage
} from '@/api/os'
import type { ChatMessage } from '@/types/os'

const PAGE_SIZE = 20

/** 把一页 SessionRunDTO 展开成 ChatMessage[](每条 run = user + agent 两条)。 */
function expandRuns(runs: SessionRunDTO[]): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const r of runs) {
    out.push({
      role: 'user',
      content: r.run_input,
      id: r.user_message_id,
      langGraphId: r.user_message_lang_id ?? undefined,
      created_at: r.created_at
    })
    out.push({
      role: 'agent',
      content: r.content,
      isError: r.is_error,
      activities: r.activities ?? undefined,
      created_at: r.created_at + 1
    })
  }
  return out
}

/**
 * 视图本地分页状态(不进 store):加载最新一页 + 向上滚加载更老。
 * messages 仍只活在 store 里;这里只持有分页元数据(hasMore/cursor/loading)。
 *
 * 为什么不进 store:recall(useRecallMessage)按 store.messages 的绝对下标撤回,
 * 流式 handler 也按数组尾原地 mutate —— 这些消费者对分页元数据无感。分页只是
 * 「列表怎么被填充」的视图属性。prepend 必须走 setMessages 进 store(不能在
 * 视图里 slice 一份),否则 recall 下标会错位。
 */
const usePaginatedHistory = () => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const setMessages = useStore((s) => s.setMessages)

  const [loadingInitial, setLoadingInitial] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [cursor, setCursor] = useState<number | null>(null)
  // react-virtuoso 的 prepend 锚定:每次向上加载 N 条,firstItemIndex -= N,
  // 让内部测高/位移算式稳定 → 滚动位置不跳(#1079/#947)。从大数开始递减(不能 < 0)。
  const [firstItemIndex, setFirstItemIndex] = useState(1_000_000)
  // startReached 防抖:react-virtuoso #281,prepend 落地前会再触发一次。
  const loadingMoreRef = useRef(false)

  const loadInitial = useCallback(
    async (sessionId: string) => {
      setLoadingInitial(true)
      try {
        const page = (await getSessionAPI(
          endpoint,
          'agent',
          sessionId,
          undefined,
          token,
          { limit: PAGE_SIZE }
        )) as SessionRunsPage
        setMessages(expandRuns(page.runs))
        setHasMore(page.hasMore)
        setCursor(page.nextCursor)
      } catch {
        /* 历史加载失败不阻塞,空聊天也能用 */
      } finally {
        setLoadingInitial(false)
      }
    },
    [endpoint, token, setMessages]
  )

  const loadMore = useCallback(
    async (sessionId: string) => {
      if (!hasMore || loadingMoreRef.current || cursor === null) return
      loadingMoreRef.current = true
      setLoadingMore(true)
      try {
        const page = (await getSessionAPI(
          endpoint,
          'agent',
          sessionId,
          undefined,
          token,
          { limit: PAGE_SIZE, before: cursor }
        )) as SessionRunsPage
        const older = expandRuns(page.runs)
        // prepend 进 store:保留下标语义(recall 按 store.messages 绝对位置)
        setMessages((prev) => [...older, ...prev])
        // prepend 锚定:逻辑首下标左移 older.length,virtuoso 不跳滚动
        setFirstItemIndex((n) => n - older.length)
        setHasMore(page.hasMore)
        setCursor(page.nextCursor)
      } catch {
        /* 静默:向上加载失败不阻塞浏览 */
      } finally {
        setLoadingMore(false)
        loadingMoreRef.current = false
      }
    },
    [hasMore, cursor, endpoint, token, setMessages]
  )

  return {
    loadInitial,
    loadMore,
    loadingInitial,
    loadingMore,
    hasMore,
    firstItemIndex
  }
}

export default usePaginatedHistory
