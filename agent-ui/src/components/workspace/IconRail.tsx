'use client'

import { useRouter } from 'next/navigation'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'

type ResourceKey =
  | 'outline'
  | 'chapters'
  | 'characters'
  | 'worldview'
  | 'references'
  | 'status'
  | 'info'
  | 'voiceProfile'
  | 'events'
  | 'overview'

interface Props {
  activeResource: ResourceKey | null
  onSelectResource: (key: ResourceKey | null) => void
}

const RESOURCES: { key: ResourceKey; icon: string; label: string }[] = [
  { key: 'info', icon: 'ℹ️', label: '小说信息' },
  { key: 'worldview', icon: '🌍', label: '世界观' },
  { key: 'references', icon: '📚', label: '参考资料' },
  { key: 'outline', icon: '📝', label: '大纲' },
  { key: 'chapters', icon: '📖', label: '正文' },
  { key: 'characters', icon: '👤', label: '角色' },
  { key: 'status', icon: '📊', label: '状态' },
  { key: 'events', icon: '📅', label: '事件时间线' },
  { key: 'overview', icon: '📊', label: '态势' }
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
        title="返回小说库"
        className="mb-1 flex h-9 w-9 items-center justify-center rounded-lg text-lg text-brand transition-colors hover:bg-brand/10"
      >
        ←
      </button>
      <div className="mb-1 h-px w-6 bg-primary/10" />
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
      <div className="mt-auto flex flex-col items-center gap-1">
        <div className="my-1 h-px w-6 bg-primary/10" />
        <button
          type="button"
          onClick={() => handleClick('voiceProfile')}
          title="作者画像"
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-lg text-lg transition-colors',
            activeResource === 'voiceProfile'
              ? 'border-l-2 border-brand bg-brand/20'
              : 'opacity-50 hover:bg-accent hover:opacity-100'
          )}
        >
          🎭
        </button>
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
