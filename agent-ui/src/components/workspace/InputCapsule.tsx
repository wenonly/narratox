'use client'

import { toast } from 'sonner'
import { ArrowUp } from 'lucide-react'
import { useQueryState } from 'nuqs'

import { TextArea } from '@/components/ui/textarea'
import Icon from '@/components/ui/icon'
import { useStore } from '@/store'
import useAIChatStreamHandler from '@/hooks/useAIStreamHandler'

/**
 * InputCapsule — single rounded-pill input (Pencil v5).
 * One capsule containing the TextArea (fill) + an embedded round gradient
 * send button (stop control in the same slot while streaming). Capped at
 * max-w-2xl + centered to align with the chat bubbles above.
 */
const InputCapsule = () => {
  const { chatInputRef } = useStore()
  const { handleStreamResponse, stopStreaming } = useAIChatStreamHandler()
  const [selectedAgent] = useQueryState('agent')
  const inputMessage = useStore((state) => state.inputMessage)
  const setInputMessage = useStore((state) => state.setChatInput)
  const isStreaming = useStore((state) => state.isStreaming)

  const handleSubmit = async () => {
    if (!inputMessage.trim()) return
    const currentMessage = inputMessage
    setInputMessage('')
    try {
      await handleStreamResponse(currentMessage)
    } catch (error) {
      toast.error(
        `Error in handleSubmit: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-4 pt-2">
      <div className="flex items-center gap-2 rounded-full border border-overlay-15 bg-bg-cardElevated py-1.5 pl-5 pr-1.5">
        <TextArea
          placeholder={'输入消息, Shift+Enter 换行…'}
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === 'Enter' &&
              !e.nativeEvent.isComposing &&
              !e.shiftKey &&
              !isStreaming
            ) {
              e.preventDefault()
              void handleSubmit()
            }
          }}
          className="max-h-24 min-h-6 flex-1 border-0 bg-transparent px-0 text-sm text-text-primary placeholder:text-text-label focus:border-0 focus:ring-0"
          disabled={!selectedAgent}
          ref={chatInputRef}
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={stopStreaming}
            title="停止生成"
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-accent-primary to-accent-violet text-text-primary"
          >
            <span className="relative flex h-4 w-4 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-text-primary opacity-60" />
              <Icon type="square" color="primary" />
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!selectedAgent || !inputMessage.trim()}
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-accent-primary to-accent-violet text-text-primary transition-opacity disabled:opacity-40"
          >
            <ArrowUp className="size-5" />
          </button>
        )}
      </div>
    </div>
  )
}

export default InputCapsule
