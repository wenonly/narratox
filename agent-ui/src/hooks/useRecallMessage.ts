'use client'
import { useCallback } from 'react'
import { useQueryState } from 'nuqs'
import { toast } from 'sonner'

import { useStore } from '@/store'
import useChatActions from '@/hooks/useChatActions'
import { recallSessionAPI } from '@/api/os'
import { constructEndpointUrl } from '@/lib/constructEndpointUrl'

/**
 * 撤回一条用户消息(index = store.messages 里的下标,指向 role:'user')。
 * 流程:POST /sessions/:id/recall → 成功则切掉该消息及之后所有消息 + 回填输入框 + focus。
 * 旧消息(无 id)/ 流式中 → 不执行(toast 提示 / 调用方禁用)。
 */
const useRecallMessage = () => {
  const setMessages = useStore((s) => s.setMessages)
  const setChatInput = useStore((s) => s.setChatInput)
  const selectedEndpoint = useStore((s) => s.selectedEndpoint)
  const authToken = useStore((s) => s.authToken)
  const isStreaming = useStore((s) => s.isStreaming)
  const { focusChatInput } = useChatActions()
  const [sessionId] = useQueryState('session')

  const recall = useCallback(
    async (index: number) => {
      if (isStreaming) {
        toast.error('正在生成中,请稍后再撤回')
        return
      }
      const messages = useStore.getState().messages
      const userMsg = messages[index]
      if (!userMsg || userMsg.role !== 'user') return
      if (!userMsg.id) {
        toast.error('此消息为历史消息,暂不支持撤回')
        return
      }
      const recalledText = userMsg.content
      try {
        const endpoint = constructEndpointUrl(selectedEndpoint)
        await recallSessionAPI(endpoint, sessionId ?? '', userMsg.id, authToken)
        setMessages((prev) => prev.slice(0, index))
        setChatInput(recalledText)
        focusChatInput()
        toast.success('已撤回,内容已回到输入框')
      } catch (err) {
        toast.error(
          `撤回失败:${err instanceof Error ? err.message : String(err)}`
        )
      }
    },
    [
      isStreaming,
      selectedEndpoint,
      authToken,
      sessionId,
      setMessages,
      setChatInput,
      focusChatInput
    ]
  )

  return { recall, isStreaming }
}

export default useRecallMessage
