import Icon from '@/components/ui/icon'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'
import { ActivitiesContext } from '@/components/ui/typography/MarkdownRenderer/activities'
import { useStore } from '@/store'
import type { ChatMessage } from '@/types/os'
import Videos from './Multimedia/Videos'
import Images from './Multimedia/Images'
import Audios from './Multimedia/Audios'
import { memo } from 'react'
import AgentThinkingLoader from './AgentThinkingLoader'
import MemoryBubble from './MemoryBubble'

interface MessageProps {
  message: ChatMessage
}

const AgentMessage = ({ message }: MessageProps) => {
  const { streamingErrorMessage } = useStore()
  let messageContent
  if (message.isError || message.streamingError) {
    // 持久错误(刷新后):文案在 content;瞬时错误(本轮流式态):文案在全局 streamingErrorMessage。
    const text = message.isError
      ? message.content
      : streamingErrorMessage ||
        'Please try refreshing the page or try again later.'
    messageContent = (
      <p className="text-destructive">
        Oops! Something went wrong. {text}
      </p>
    )
  } else if (message.content) {
    messageContent = (
      <div className="flex w-full flex-col gap-4">
        <MarkdownRenderer>{message.content}</MarkdownRenderer>
        {message.videos && message.videos.length > 0 && (
          <Videos videos={message.videos} />
        )}
        {message.images && message.images.length > 0 && (
          <Images images={message.images} />
        )}
        {message.audio && message.audio.length > 0 && (
          <Audios audio={message.audio} />
        )}
      </div>
    )
  } else if (message.response_audio) {
    if (!message.response_audio.transcript) {
      messageContent = (
        <div className="mt-2 flex items-start">
          <AgentThinkingLoader />
        </div>
      )
    } else {
      messageContent = (
        <div className="flex w-full flex-col gap-4">
          <MarkdownRenderer>
            {message.response_audio.transcript}
          </MarkdownRenderer>
          {message.response_audio.content && message.response_audio && (
            <Audios audio={[message.response_audio]} />
          )}
        </div>
      )
    }
  } else {
    messageContent = (
      <div className="mt-2">
        <AgentThinkingLoader />
      </div>
    )
  }

  return (
    <ActivitiesContext.Provider value={message.activities ?? null}>
      <div className="flex flex-row items-start gap-4 font-geist">
        <div className="flex-shrink-0">
          <Icon type="agent" size="sm" />
        </div>
        <div className="flex w-full flex-col gap-2">
          {messageContent}
          {message.stopped && !message.streamingError && (
            <span className="w-fit rounded-md bg-accent px-2 py-0.5 text-xs text-muted">
              已停止
            </span>
          )}
          {message.memory && <MemoryBubble memory={message.memory} />}
        </div>
      </div>
    </ActivitiesContext.Provider>
  )
}

const UserMessage = memo(({ message }: MessageProps) => {
  return (
    <div className="flex items-start gap-4 pt-4 text-start max-md:break-words">
      <div className="flex-shrink-0">
        <Icon type="user" size="sm" />
      </div>
      <div className="text-md rounded-lg font-geist text-secondary">
        {message.content}
      </div>
    </div>
  )
})

AgentMessage.displayName = 'AgentMessage'
UserMessage.displayName = 'UserMessage'
export { AgentMessage, UserMessage }
