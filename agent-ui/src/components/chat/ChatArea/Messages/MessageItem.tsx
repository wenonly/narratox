import { memo } from 'react'
import { Undo2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import Tooltip from '@/components/ui/tooltip'
import Icon from '@/components/ui/icon'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'
import { ActivitiesContext } from '@/components/ui/typography/MarkdownRenderer/activities'
import { useStore } from '@/store'
import type { ChatMessage } from '@/types/os'
import Videos from './Multimedia/Videos'
import Images from './Multimedia/Images'
import Audios from './Multimedia/Audios'
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
      <p className="text-destructive">Oops! Something went wrong. {text}</p>
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
      <div className="flex flex-row items-start gap-4 font-sans">
        <div className="flex-shrink-0">
          <Icon type="agent" size="sm" />
        </div>
        <div className="flex w-full flex-col gap-2">
          {messageContent}
          {message.stopped && !message.streamingError && (
            <span className="w-fit rounded-md bg-overlay-10 px-2 py-0.5 text-xs text-text-tertiary">
              已停止
            </span>
          )}
          {message.memory && <MemoryBubble memory={message.memory} />}
        </div>
      </div>
    </ActivitiesContext.Provider>
  )
}

interface UserMessageProps {
  message: ChatMessage
  disabled?: boolean
  onRequestRecall?: () => void
}

const UserMessage = memo(
  ({ message, disabled, onRequestRecall }: UserMessageProps) => {
    const supported = !!message.id
    const clickable = supported && !disabled && !!onRequestRecall
    return (
      <div className="group relative flex items-start gap-4 pt-4 text-start max-md:break-words">
        <div className="flex-shrink-0">
          <Icon type="user" size="sm" />
        </div>
        <div className="text-md rounded-lg pr-7 font-sans text-text-secondary">
          {message.content}
        </div>
        {onRequestRecall && (
          <Tooltip
            delayDuration={0}
            content={
              <p className="text-text-tertiary">
                {supported ? '撤回' : '历史消息暂不支持撤回'}
              </p>
            }
            side="top"
          >
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onRequestRecall()}
              className="absolute right-0 top-4 opacity-0 transition-opacity hover:!opacity-100 focus:opacity-100 disabled:cursor-not-allowed disabled:opacity-20 group-hover:opacity-100"
            >
              <Undo2 className="h-4 w-4 text-text-tertiary hover:text-text-primary" />
            </button>
          </Tooltip>
        )}
      </div>
    )
  }
)

AgentMessage.displayName = 'AgentMessage'
UserMessage.displayName = 'UserMessage'

interface RecallConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

const RecallConfirmDialog = ({
  open,
  onOpenChange,
  onConfirm
}: RecallConfirmDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>撤回此消息?</DialogTitle>
        <DialogDescription>
          该消息及其后的所有对话将被删除,内容会回到输入框。
        </DialogDescription>
      </DialogHeader>
      <DialogFooter className="gap-2 pt-4">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          取消
        </Button>
        <Button
          variant="destructive"
          onClick={() => {
            onConfirm()
            onOpenChange(false)
          }}
        >
          确认撤回
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
)

export { AgentMessage, UserMessage, RecallConfirmDialog }
