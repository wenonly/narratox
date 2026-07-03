'use client'

import { Brain } from 'lucide-react'
import type { MemoryData } from '@/types/os'

/** 结算中占位(轮询期间)。 */
export const MemorySettling = () => (
  <div className="inline-flex items-center gap-2 rounded-full border border-[#8b5cf640] bg-[#8b5cf60f] px-3 py-1.5">
    <Brain className="size-3.5 text-accent-violetLight" />
    <span className="text-xs text-text-tertiary">结算中…</span>
  </div>
)

/**
 * 记忆气泡(A5):紫色 pill,显示「记忆已更新」+ 一行概要。
 * 不再展开内部明细(密度过高),保留概要即可。
 */
const MemoryBubble = ({ memory }: { memory: MemoryData }) => {
  const hookCount = memory.newHooks.length + memory.resolvedHooks.length
  const detail = `第 ${memory.chapterOrder} 章摘要 · ${memory.roleChanges.length} 条角色变化 · ${hookCount} 处伏笔`

  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-[#8b5cf640] bg-[#8b5cf60f] px-3 py-1.5">
      <Brain className="size-3.5 shrink-0 text-accent-violetLight" />
      <div className="flex flex-col leading-tight">
        <span className="text-xs font-semibold text-accent-violetLight">
          记忆已更新
        </span>
        <span className="text-xs text-text-tertiary">{detail}</span>
      </div>
    </div>
  )
}

export default MemoryBubble
