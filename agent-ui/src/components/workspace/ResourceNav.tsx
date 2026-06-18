'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useStore } from '@/store'
import type { Novel } from '@/types/novel'

interface Props {
  novel: Novel
}

type NavModule = {
  label: string
  phase?: 'P2' | 'P3'
  functional?: boolean
}

const NAV_MODULES: NavModule[] = [
  { label: '📝 大纲', phase: 'P2' },
  { label: '📖 正文', functional: true },
  { label: '👤 角色', phase: 'P2' },
  { label: '🌍 世界观', phase: 'P2' },
  { label: '📊 状态', phase: 'P3' }
]

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
          <Field label="简介" value={novel.synopsis} />
          <Field label="文风" value={novel.settings?.style} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {NAV_MODULES.map((mod) => (
          <div
            key={mod.label}
            className={
              mod.functional
                ? 'text-xs font-medium text-primary'
                : 'text-xs text-muted/40'
            }
          >
            {mod.label}
            {mod.phase && (
              <span className="ml-1 rounded bg-accent px-1 text-[10px]">
                {mod.phase}
              </span>
            )}
          </div>
        ))}
      </div>

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
