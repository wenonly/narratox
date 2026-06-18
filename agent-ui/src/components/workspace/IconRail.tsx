'use client'

import { useRouter } from 'next/navigation'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'

type ResourceKey =
  | 'outline'
  | 'chapters'
  | 'characters'
  | 'worldview'
  | 'status'
  | 'info'

interface Props {
  activeResource: ResourceKey | null
  onSelectResource: (key: ResourceKey | null) => void
}

const RESOURCES: { key: ResourceKey; icon: string; label: string }[] = [
  { key: 'outline', icon: '📝', label: '大纲' },
  { key: 'chapters', icon: '📖', label: '正文' },
  { key: 'characters', icon: '👤', label: '角色' },
  { key: 'worldview', icon: '🌍', label: '世界观' },
  { key: 'status', icon: '📊', label: '状态' }
]

const IconRail = ({ activeResource, onSelectResource }: Props) => {
  const router = useRouter()
  const logout = useStore((s) => s.logout)

  const handleClick = (key: ResourceKey) => {
    onSelectResource(activeResource === key ? null : key)
  }

  return (
    <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-primary/10 bg-background-secondary py-3">
      <button
        type="button"
        onClick={() => router.push('/')}
        title="小说库"
        className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg text-lg opacity-60 transition-colors hover:bg-accent hover:opacity-100"
      >
        📚
      </button>
      {RESOURCES.map((r) => (
        <button
          key={r.key}
          type="button"
          onClick={() => handleClick(r.key)}
          title={r.label}
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-lg text-lg transition-colors',
            activeResource === r.key
              ? 'border-l-2 border-brand bg-brand/20'
              : 'opacity-50 hover:bg-accent hover:opacity-100'
          )}
        >
          {r.icon}
        </button>
      ))}
      <div className="my-1 h-px w-6 bg-primary/10" />
      <button
        type="button"
        onClick={() => handleClick('info')}
        title="小说信息"
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-lg text-lg transition-colors',
          activeResource === 'info'
            ? 'border-l-2 border-brand bg-brand/20'
            : 'opacity-50 hover:bg-accent hover:opacity-100'
        )}
      >
        ℹ️
      </button>
      <button
        type="button"
        onClick={() => router.push('/settings')}
        title="设置"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-lg opacity-50 transition-colors hover:bg-accent hover:opacity-100"
      >
        ⚙️
      </button>
      <div className="mt-auto">
        <button
          type="button"
          onClick={() => {
            logout()
            router.replace('/login')
          }}
          title="登出"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-sm opacity-50 transition-colors hover:bg-accent hover:opacity-100"
        >
          ⏻
        </button>
      </div>
    </div>
  )
}

export default IconRail
