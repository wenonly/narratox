'use client'

import { useRouter } from 'next/navigation'

import { useStore } from '@/store'
import Icon from '@/components/ui/icon'
import { cn } from '@/lib/utils'

interface Props {
  active: 'library' | 'knowledge' | 'dissect' | 'settings'
}

const TABS = [
  { key: 'library', label: '小说库', href: '/' },
  { key: 'knowledge', label: '知识库', href: '/knowledge' },
  { key: 'dissect', label: '拆解', href: '/dissect' },
  { key: 'settings', label: '设置', href: '/settings' }
] as const

const AppSidebar = ({ active }: Props) => {
  const router = useRouter()
  const logout = useStore((s) => s.logout)
  return (
    <aside className="flex w-[200px] shrink-0 flex-col gap-3 border-r border-overlay-15 bg-bg-darkest px-3 py-5 font-sans">
      <div className="mb-2 flex items-center gap-2 px-2">
        <Icon type="agno" size="xs" />
        <span className="text-gradient-brand text-lg font-semibold">
          narratox
        </span>
      </div>
      <nav className="flex flex-col gap-1">
        {TABS.map((t) => {
          const isActive = active === t.key
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => router.push(t.href)}
              className={cn(
                'relative flex h-9 items-center rounded-md px-3 text-left text-[13px] transition-colors',
                isActive
                  ? 'bg-accent-primarySoft font-medium text-text-primary'
                  : 'text-text-tertiary hover:bg-overlay-10 hover:text-text-primary'
              )}
            >
              {isActive ? (
                <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent-indigoLight" />
              ) : null}
              {t.label}
            </button>
          )
        })}
      </nav>
      <div className="mt-auto px-1">
        <button
          type="button"
          onClick={() => {
            logout()
            router.replace('/login')
          }}
          className="flex h-9 w-full items-center rounded-md px-3 text-[13px] text-text-tertiary transition-colors hover:bg-overlay-10 hover:text-text-primary"
        >
          登出
        </button>
      </div>
    </aside>
  )
}

export default AppSidebar
