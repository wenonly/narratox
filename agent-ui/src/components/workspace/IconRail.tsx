'use client'

import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Info,
  Globe,
  Library,
  List,
  BookOpen,
  User,
  Bookmark,
  Calendar,
  BarChart,
  Sparkles,
  LogOut
} from 'lucide-react'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'
import type { ResourceKey } from '@/components/workspace/types'

interface Props {
  activeResource: ResourceKey | null
  onSelectResource: (key: ResourceKey | null) => void
}

const RESOURCES = [
  { key: 'info', icon: Info, label: '小说信息' },
  { key: 'worldview', icon: Globe, label: '世界观' },
  { key: 'references', icon: Library, label: '参考资料' },
  { key: 'outline', icon: List, label: '大纲' },
  { key: 'chapters', icon: BookOpen, label: '正文' },
  { key: 'characters', icon: User, label: '角色' },
  { key: 'status', icon: Bookmark, label: '状态/伏笔' },
  { key: 'events', icon: Calendar, label: '事件时间线' },
  { key: 'overview', icon: BarChart, label: '态势' }
] as const

const IconRail = ({ activeResource, onSelectResource }: Props) => {
  const router = useRouter()
  const logout = useStore((s) => s.logout)

  const handleClick = (key: ResourceKey) => {
    onSelectResource(activeResource === key ? null : key)
  }

  const renderItem = (r: {
    key: ResourceKey
    icon: typeof Info
    label: string
  }) => {
    const active = activeResource === r.key
    return (
      <button
        key={r.key}
        type="button"
        onClick={() => handleClick(r.key)}
        className={cn(
          'relative flex h-9 items-center gap-2.5 rounded-md px-3.5 text-sm transition-colors',
          active ? 'bg-accent-primarySoft' : 'hover:bg-overlay-10'
        )}
      >
        {active && (
          <span className="bg-accent-indigo-light absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full" />
        )}
        <r.icon
          className={cn(
            'size-4 shrink-0',
            active ? 'text-accent-indigo-light' : 'text-text-label'
          )}
        />
        <span
          className={cn(
            active ? 'font-medium text-text-primary' : 'text-text-label'
          )}
        >
          {r.label}
        </span>
      </button>
    )
  }

  return (
    <div className="flex w-[200px] shrink-0 flex-col gap-1.5 border-r border-overlay-15 bg-bg-card py-3">
      <button
        type="button"
        onClick={() => router.push('/')}
        className="flex h-9 items-center gap-2.5 rounded-md px-3.5 text-sm font-medium text-text-secondary transition-colors hover:bg-overlay-10"
      >
        <ArrowLeft className="size-4" />
        返回
      </button>
      <div className="mx-3 h-px bg-overlay-10" />
      <nav className="flex flex-col gap-0.5">
        {RESOURCES.map((r) => renderItem(r))}
      </nav>
      <div className="mx-3 h-px bg-overlay-10" />
      <div className="flex-1" />
      <div className="flex flex-col gap-0.5">
        {renderItem({ key: 'voiceProfile', icon: Sparkles, label: '作者画像' })}
        <button
          type="button"
          onClick={() => {
            logout()
            router.replace('/login')
          }}
          className="flex h-9 items-center gap-2.5 rounded-md px-3.5 text-sm transition-colors hover:bg-overlay-10"
        >
          <LogOut className="size-4 text-text-label" />
          <span className="text-text-label">登出</span>
        </button>
      </div>
    </div>
  )
}

export default IconRail
