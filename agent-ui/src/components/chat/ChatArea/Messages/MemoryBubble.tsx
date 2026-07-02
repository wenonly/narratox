'use client'

import { useState, type ReactNode } from 'react'
import type { MemoryData } from '@/types/os'
import { cn } from '@/lib/utils'

/** 结算中占位(轮询期间)。 */
export const MemorySettling = () => (
  <div className="mt-3 rounded-lg border-l-2 border-accent-primarySoft bg-overlay-6 px-3 py-2 text-xs text-text-tertiary">
    🧠 结算中…
  </div>
)

/** 拿到记忆后的可折叠气泡。 */
const MemoryBubble = ({ memory }: { memory: MemoryData }) => {
  const [open, setOpen] = useState(false)
  const hookCount = memory.newHooks.length + memory.resolvedHooks.length
  const overview = `🧠 本章记忆:摘要·1 · 变化${memory.roleChanges.length} · 设定${memory.entities.length} · 伏笔${hookCount}`

  return (
    <div className="mt-3 w-full rounded-lg border-l-2 border-accent-primarySoft bg-overlay-6 px-3 py-2 text-xs text-text-tertiary">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="truncate">{overview}</span>
        <span
          className={cn(
            'ml-2 shrink-0 transition-transform',
            open && 'rotate-90'
          )}
        >
          ▸
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-2 border-t border-overlay-15 pt-2">
          <Group title="摘要">{memory.summary || '—'}</Group>
          {memory.roleChanges.length > 0 && (
            <Group title="角色变化">
              {memory.roleChanges.map((r, i) => (
                <div key={i}>
                  <span className="text-text-primary">{r.name}</span> ·{' '}
                  {r.change}
                </div>
              ))}
            </Group>
          )}
          {memory.entities.length > 0 && (
            <Group title="物品 / 地点 / 设定">
              {memory.entities.map((e, i) => (
                <div key={i}>
                  <span className="text-text-primary">
                    [{e.type}] {e.name}
                  </span>{' '}
                  · {e.note}
                </div>
              ))}
            </Group>
          )}
          {(memory.newHooks.length > 0 || memory.resolvedHooks.length > 0) && (
            <Group title="伏笔">
              {memory.newHooks.map((h, i) => (
                <div key={`n${i}`}>🆕 {h.description}</div>
              ))}
              {memory.resolvedHooks.map((h, i) => (
                <div key={`r${i}`}>✅ {h.description}</div>
              ))}
            </Group>
          )}
        </div>
      )}
    </div>
  )
}

const Group = ({ title, children }: { title: string; children: ReactNode }) => (
  <div>
    <div className="mb-1 text-[10px] uppercase tracking-wide text-text-label">
      {title}
    </div>
    <div className="space-y-0.5 leading-relaxed">{children}</div>
  </div>
)

export default MemoryBubble
