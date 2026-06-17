'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useStore } from '@/store'
import type { Chapter } from '@/types/novel'
import { cn } from '@/lib/utils'

interface Props {
  novelTitle: string
  chapters: Chapter[]
  selectedChapterId: string | null
  onSelectChapter: (id: string) => void
  onNewChapter: () => void
}

const P2 = ['📝 大纲', '👤 角色', '🌍 世界观'] as const
const P3 = ['📊 状态'] as const

const ResourceNav = ({
  novelTitle,
  chapters,
  selectedChapterId,
  onSelectChapter,
  onNewChapter
}: Props) => {
  const router = useRouter()
  const logout = useStore((s) => s.logout)

  return (
    <aside className="flex w-60 shrink-0 flex-col gap-3 overflow-y-auto border-r border-primary/10 px-3 py-4 font-dmmono">
      <button
        onClick={() => router.push('/')}
        className="text-left text-xs font-medium text-brand"
        type="button"
      >
        ‹ 小说库
      </button>
      <div className="truncate text-sm font-semibold text-primary">
        {novelTitle}
      </div>

      <div className="text-xs font-medium uppercase text-muted">📖 章节</div>
      <div className="flex flex-col gap-1">
        {chapters.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelectChapter(c.id)}
            className={cn(
              'truncate rounded-md px-2 py-1 text-left text-xs',
              c.id === selectedChapterId
                ? 'bg-brand text-white'
                : 'text-muted hover:bg-accent'
            )}
          >
            第{c.order}章 · {c.title}
          </button>
        ))}
        <button
          type="button"
          onClick={onNewChapter}
          className="rounded-md px-2 py-1 text-left text-xs text-muted/60 hover:bg-accent"
        >
          + 新章
        </button>
      </div>

      {P2.map((label) => (
        <div key={label} className="text-xs text-muted/40">
          {label} <span className="rounded bg-accent px-1 text-[10px]">P2</span>
        </div>
      ))}
      {P3.map((label) => (
        <div key={label} className="text-xs text-muted/40">
          {label} <span className="rounded bg-accent px-1 text-[10px]">P3</span>
        </div>
      ))}

      <div className="mt-auto">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            logout()
            router.replace('/login')
          }}
          className="text-muted"
        >
          登出
        </Button>
      </div>
    </aside>
  )
}

export default ResourceNav
