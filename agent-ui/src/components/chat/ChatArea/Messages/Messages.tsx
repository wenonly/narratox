import { memo } from 'react'
import React, { type FC } from 'react'

import Icon from '@/components/ui/icon'
import Tooltip from '@/components/ui/tooltip'
import type { ChatMessage } from '@/types/os'
import {
  ToolCallProps,
  ReasoningStepProps,
  ReasoningProps,
  ReferenceData,
  Reference
} from '@/types/os'

import { AgentMessage } from './MessageItem'

interface MessageWrapperProps {
  message: ChatMessage
  /** 该消息是否是当前正在流式输出的最后一条(驱动正文 ▌ 光标)。 */
  isStreaming?: boolean
  /** 兼容旧调用方(现由 Virtuoso itemContent 传入,内部未用)。 */
  isLastMessage?: boolean
}

interface ReferenceProps {
  references: ReferenceData[]
}

interface ReferenceItemProps {
  reference: Reference
}

const ReferenceItem: FC<ReferenceItemProps> = ({ reference }) => (
  <div className="relative flex h-[63px] w-[190px] cursor-default flex-col justify-between overflow-hidden rounded-md bg-bg-cardElevated p-3 transition-colors hover:bg-overlay-10">
    <p className="text-sm font-medium text-text-primary">{reference.name}</p>
    <p className="truncate text-xs text-text-label">{reference.content}</p>
  </div>
)

const References: FC<ReferenceProps> = ({ references }) => (
  <div className="flex flex-col gap-4">
    {references.map((referenceData, index) => (
      <div
        key={`${referenceData.query}-${index}`}
        className="flex flex-col gap-3"
      >
        <div className="flex flex-wrap gap-3">
          {referenceData.references.map((reference, refIndex) => (
            <ReferenceItem
              key={`${reference.name}-${reference.meta_data.chunk}-${refIndex}`}
              reference={reference}
            />
          ))}
        </div>
      </div>
    ))}
  </div>
)

const Reasoning: FC<ReasoningStepProps> = ({ index, stepTitle }) => (
  <div className="flex items-center gap-2 text-text-secondary">
    <div className="flex h-[20px] items-center rounded-md bg-bg-cardElevated p-2">
      <p className="text-xs">STEP {index + 1}</p>
    </div>
    <p className="text-xs">{stepTitle}</p>
  </div>
)
const Reasonings: FC<ReasoningProps> = ({ reasoning }) => (
  <div className="flex flex-col items-start justify-center gap-2">
    {reasoning.map((title, index) => (
      <Reasoning
        key={`${title.title}-${title.action}-${index}`}
        stepTitle={title.title}
        index={index}
      />
    ))}
  </div>
)

const ToolComponent = memo(({ tools }: ToolCallProps) => (
  <div className="cursor-default rounded-full bg-overlay-10 px-2 py-1.5 text-xs">
    <p className="font-mono uppercase text-text-secondary">{tools.tool_name}</p>
  </div>
))
ToolComponent.displayName = 'ToolComponent'

/**
 * 单条 agent 消息的整段渲染(reasoning + references + tool chips + AgentMessage)。
 * tail-aware memo:流式期间非 tail 项保持对象身份(setMessages 浅拷贝数组、
 * 原地 mutate 尾部)→ 非 tail 引用相等即跳过,杀掉逐 token 全量重渲染。
 */
const AgentMessageWrapper = memo(
  ({ message, isStreaming }: MessageWrapperProps) => {
    return (
      <div className="flex flex-col gap-y-9">
        {message.extra_data?.reasoning_steps &&
          message.extra_data.reasoning_steps.length > 0 && (
            <div className="flex items-start gap-4">
              <Tooltip
                delayDuration={0}
                content={<p className="text-text-tertiary">Reasoning</p>}
                side="top"
              >
                <Icon type="reasoning" size="sm" />
              </Tooltip>
              <div className="flex flex-col gap-3">
                <p className="text-xs uppercase">Reasoning</p>
                <Reasonings reasoning={message.extra_data.reasoning_steps} />
              </div>
            </div>
          )}
        {message.extra_data?.references &&
          message.extra_data.references.length > 0 && (
            <div className="flex items-start gap-4">
              <Tooltip
                delayDuration={0}
                content={<p className="text-text-tertiary">References</p>}
                side="top"
              >
                <Icon type="references" size="sm" />
              </Tooltip>
              <div className="flex flex-col gap-3">
                <References references={message.extra_data.references} />
              </div>
            </div>
          )}
        {message.tool_calls && message.tool_calls.length > 0 && (
          <div className="flex items-start gap-3">
            <Tooltip
              delayDuration={0}
              content={<p className="text-text-tertiary">Tool Calls</p>}
              side="top"
            >
              <Icon
                type="hammer"
                className="rounded-lg bg-bg-cardElevated p-1"
                size="sm"
                color="secondary"
              />
            </Tooltip>
            <div className="flex flex-wrap gap-2">
              {message.tool_calls.map((toolCall, index) => (
                <ToolComponent
                  key={
                    toolCall.tool_call_id ||
                    `${toolCall.tool_name}-${toolCall.created_at}-${index}`
                  }
                  tools={toolCall}
                />
              ))}
            </div>
          </div>
        )}
        <AgentMessage message={message} isStreaming={isStreaming} />
      </div>
    )
  },
  (prev, next) => {
    if (prev.isStreaming || next.isStreaming) return false
    return prev.message === next.message
  }
)
AgentMessageWrapper.displayName = 'AgentMessageWrapper'

export { AgentMessageWrapper }
