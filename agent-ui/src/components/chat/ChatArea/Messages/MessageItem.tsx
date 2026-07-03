import { memo } from 'react'
import { Undo2, Sparkles, CircleAlert } from 'lucide-react'
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
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'
import {
  ActivitiesContext,
  ToolBatch,
  SuppressedToolBlock
} from '@/components/ui/typography/MarkdownRenderer/activities'
import { useStore } from '@/store'
import type { ChatMessage } from '@/types/os'
import Videos from './Multimedia/Videos'
import Images from './Multimedia/Images'
import Audios from './Multimedia/Audios'
import AgentThinkingLoader from './AgentThinkingLoader'
import MemoryBubble from './MemoryBubble'

interface MessageProps {
  message: ChatMessage
  /** 该消息是否是当前正在流式输出的最后一条(用于显示正文末尾 ▌ 光标)。 */
  isStreaming?: boolean
}

/** 从活动表里取出所有工具活动的 id(按插入顺序;ActivityMap 是普通对象,key 按添加顺序遍历)。 */
const collectToolIds = (activities: ChatMessage['activities']): string[] => {
  if (!activities) return []
  return Object.entries(activities)
    .filter(([, detail]) => detail?.act === 'tool')
    .map(([id]) => id)
}

const AgentMessage = ({ message, isStreaming }: MessageProps) => {
  const { streamingErrorMessage } = useStore()
  const toolIds = collectToolIds(message.activities)
  const useBatch = toolIds.length >= 3

  let messageContent
  if (message.isError || message.streamingError) {
    // 持久错误(刷新后):文案在 content;瞬时错误(本轮流式态):文案在全局 streamingErrorMessage。
    const text = message.isError
      ? message.content
      : streamingErrorMessage ||
        'Please try refreshing the page or try again later.'
    messageContent = (
      <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
        <CircleAlert className="size-3.5 shrink-0" />
        <span>{text}</span>
      </div>
    )
  } else if (message.content) {
    messageContent = (
      <div className="flex w-full flex-col gap-4">
        <MarkdownRenderer
          activityOverrides={
            useBatch ? { tool: SuppressedToolBlock } : undefined
          }
        >
          {message.content}
        </MarkdownRenderer>
        {isStreaming && (
          <span
            aria-hidden
            className="animate-pulse text-sm leading-none text-accent-indigoLight"
          >
            ▌
          </span>
        )}
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
          <MarkdownRenderer
            activityOverrides={
              useBatch ? { tool: SuppressedToolBlock } : undefined
            }
          >
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
      <div className="flex gap-2.5 font-sans">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent-primarySoft">
          <Sparkles className="size-4 text-accent-indigoLight" />
        </div>
        <div className="flex-1 rounded-lg border border-overlay-15 bg-bg-card p-2.5">
          <div className="flex w-full flex-col gap-2">
            {useBatch && <ToolBatch ids={toolIds} />}
            {messageContent}
            {message.stopped && !message.streamingError && (
              <span className="w-fit rounded-md bg-overlay-10 px-2 py-0.5 text-xs text-text-tertiary">
                已停止
              </span>
            )}
            {message.memory && <MemoryBubble memory={message.memory} />}
          </div>
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
      <div className="group relative flex justify-end pt-4 text-start max-md:break-words">
        <div className="flex flex-col items-end gap-1">
          <div className="rounded-lg bg-accent-primarySoft px-3 py-2 font-sans text-text-secondary">
            {message.content}
          </div>
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
