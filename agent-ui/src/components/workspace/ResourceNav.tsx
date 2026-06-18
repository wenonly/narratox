'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useStore } from '@/store'
import type { Novel } from '@/types/novel'

interface Props {
  novel: Novel
}

const P2 = ['📝 大纲', '👤 角色', '🌍 世界观'] as const
const P3 = ['📊 状态'] as const

const Field = ({ label, value }: { label: string; value?: string | null }) => (
  <div className="flex flex-col gap-0.5">
    <span className="text-[10px] uppercase text-muted/60">{label}</span>
    <span className="whitespace-pre-wrap break-words text-xs text-primary">
      {value || '—'}
    </span>
  </div>
)

const ResourceNav = ({ novel }: Props) => {
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

      <div className="rounded-lg border border-primary/15 bg-background-secondary px-3 py-3">
        <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-primary">
          📖 小说信息
        </div>
        <div className="flex flex-col gap-2">
          <Field label="书名" value={novel.title} />
          <Field label="类型" value={novel.genre} />
          <Field label="世界观" value={novel.settings?.worldviewText} />
          <Field label="文风" value={novel.settings?.style} />
        </div>
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
