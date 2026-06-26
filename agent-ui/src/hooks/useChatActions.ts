import { useCallback } from 'react'

import { useStore } from '../store'

import { type ChatMessage } from '@/types/os'
import { getStatusAPI } from '@/api/os'
import { useQueryState } from 'nuqs'

const useChatActions = () => {
  const { chatInputRef } = useStore()
  const selectedEndpoint = useStore((state) => state.selectedEndpoint)
  const authToken = useStore((state) => state.authToken)
  const [, setSessionId] = useQueryState('session')
  const setMessages = useStore((state) => state.setMessages)
  const [agentId, setAgentId] = useQueryState('agent')
  const [dbId, setDbId] = useQueryState('db_id')

  const getStatus = useCallback(async () => {
    try {
      const status = await getStatusAPI(selectedEndpoint, authToken)
      return status
    } catch {
      return 503
    }
  }, [selectedEndpoint, authToken])

  const clearChat = useCallback(() => {
    setMessages([])
    setSessionId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const focusChatInput = useCallback(() => {
    setTimeout(() => {
      requestAnimationFrame(() => chatInputRef?.current?.focus())
    }, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addMessage = useCallback(
    (message: ChatMessage) => {
      setMessages((prevMessages) => [...prevMessages, message])
    },
    [setMessages]
  )

  // 健康探针:server 在线则补默认 agent/db_id 查询参数;离线则清掉 agent。
  // (getStatus 已内部兜底,不再抛错。)
  const initialize = useCallback(async () => {
    const status = await getStatus()
    if (status === 200) {
      if (!agentId) setAgentId('deep-agent')
      if (!dbId) setDbId('default')
    } else {
      setAgentId(null)
    }
  }, [getStatus, setAgentId, setDbId, agentId, dbId])

  return {
    clearChat,
    addMessage,
    focusChatInput,
    initialize
  }
}

export default useChatActions
