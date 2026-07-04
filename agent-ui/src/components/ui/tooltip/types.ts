import type { ReactNode } from 'react'

export interface TooltipProps {
  children: ReactNode
  content: ReactNode
  className?: string
  side?: 'top' | 'right' | 'bottom' | 'left' | undefined
  delayDuration?: number
  contentClassName?: string
  /**
   * 透传给 radix TooltipTrigger 的 asChild。当 children 本身就是按钮等可交互元素时,
   * 必须设 true —— 否则 trigger 会再渲染一个 <button>,造成 <button> 嵌套(非法 HTML +
   * hydration 报错)。children 是纯图标/文本时保持默认 false。
   */
  asChild?: boolean
}
