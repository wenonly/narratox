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
  const setIsEndpointActive = useStore((state) => state.setIsEndpointActive)
  const setIsEndpointLoading = useStore((state) => state.setIsEndpointLoading)
  const setMode = useStore((state) => state.setMode)
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

  const initialize = useCallback(async () => {
    setIsEndpointLoading(true)
    try {
      const status = await getStatus()
      if (status === 200) {
        setIsEndpointActive(true)
        setMode('agent')
        if (!agentId) setAgentId('deep-agent')
        if (!dbId) setDbId('default')
      } else {
        setIsEndpointActive(false)
        setMode('agent')
        setAgentId(null)
      }
    } catch (error) {
      console.error('Error initializing :', error)
      setIsEndpointActive(false)
    } finally {
      setIsEndpointLoading(false)
    }
  }, [
    getStatus,
    setIsEndpointActive,
    setIsEndpointLoading,
    setMode,
    setAgentId,
    setDbId,
    agentId,
    dbId
  ])

  return {
    clearChat,
    addMessage,
    focusChatInput,
    initialize
  }
}

export default useChatActions
