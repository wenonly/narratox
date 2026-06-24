'use client'

import { useRouter } from 'next/navigation'
import { useStore } from '@/store'
import { Button } from '@/components/ui/button'
import Icon from '@/components/ui/icon'
import { cn } from '@/lib/utils'

interface Props {
  active: 'library' | 'knowledge' | 'settings'
}

const TABS = [
  { key: 'library', label: '小说库', href: '/' },
  { key: 'knowledge', label: '知识库', href: '/knowledge' },
  { key: 'settings', label: '设置', href: '/settings' }
] as const

const AppSidebar = ({ active }: Props) => {
  const router = useRouter()
  const logout = useStore((s) => s.logout)
  return (
    <aside className="flex w-60 shrink-0 flex-col gap-3 border-r border-primary/10 px-4 py-5 font-dmmono">
      <div className="mb-2 flex items-center gap-2">
        <Icon type="agno" size="xs" />
        <span className="text-xs font-medium uppercase text-white">
          narratox
        </span>
      </div>
      <nav className="flex flex-col gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => router.push(t.href)}
            className={cn(
              'rounded-lg px-3 py-2 text-left text-sm transition-colors',
              active === t.key
                ? 'bg-brand/15 font-medium text-primary'
                : 'text-muted hover:bg-accent hover:text-primary'
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>
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

export default AppSidebar
