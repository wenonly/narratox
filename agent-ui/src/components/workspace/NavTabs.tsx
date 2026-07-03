'use client'

import { BookOpen, Globe, Library, List, Milestone, User } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { ResourceKey } from './types'

interface Props {
  active: ResourceKey
  onSelect: (key: ResourceKey) => void
}

/** 6 resource tabs — centered in ResourceCard head. W1: icon-only 36×36 buttons. */
const TABS: { key: ResourceKey; icon: typeof BookOpen; label: string }[] = [
  { key: 'chapters', icon: BookOpen, label: '正文' },
  { key: 'outline', icon: List, label: '大纲' },
  { key: 'characters', icon: User, label: '角色' },
  { key: 'worldview', icon: Globe, label: '世界观' },
  { key: 'plotline', icon: Milestone, label: '剧情线' },
  { key: 'references', icon: Library, label: '参考资料' }
]

const NavTabs = ({ active, onSelect }: Props) => {
  return (
    <nav className="flex items-center justify-center gap-1">
      {TABS.map(({ key, icon: Icon, label }) => {
        const isActive = active === key
        return (
          <button
            key={key}
            type="button"
            onClick={() => onSelect(key)}
            aria-label={label}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'flex size-9 items-center justify-center rounded-md transition-colors',
              isActive ? 'bg-accent-primarySoft' : 'hover:bg-overlay-10'
            )}
          >
            <Icon
              className={cn(
                'size-4 shrink-0',
                isActive ? 'text-accent-indigoLight' : 'text-text-label'
              )}
            />
          </button>
        )
      })}
    </nav>
  )
}

export default NavTabs
