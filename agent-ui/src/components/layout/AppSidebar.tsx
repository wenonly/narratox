'use client'

import { useRouter } from 'next/navigation'
import { Sparkles, Library, BookOpen, FileText, Settings, type LucideIcon } from 'lucide-react'

import { useStore } from '@/store'
import { cn } from '@/lib/utils'

interface Props {
  active: 'library' | 'knowledge' | 'dissect' | 'settings'
}

const TABS: Array<{ key: Props['active']; label: string; href: string; icon: LucideIcon }> = [
  { key: 'library', label: '小说库', href: '/', icon: Library },
  { key: 'knowledge', label: '知识库', href: '/knowledge', icon: BookOpen },
  { key: 'dissect', label: '拆解', href: '/dissect', icon: FileText },
  { key: 'settings', label: '设置', href: '/settings', icon: Settings }
]

const AppSidebar = ({ active }: Props) => {
  const router = useRouter()
  const logout = useStore((s) => s.logout)
  const user = useStore((s) => s.user)
  const displayName = user?.username || user?.email?.split('@')[0] || '用户'
  const initial = (displayName[0] || 'U').toUpperCase()

  return (
    <aside className="flex w-[200px] shrink-0 flex-col gap-3 border-r border-overlay-15 bg-bg-darkest px-3 py-5 font-sans">
      {/* 品牌 */}
      <div className="flex items-center gap-2.5 px-2 pb-6 pt-1">
        <div className="flex size-7 items-center justify-center rounded-md bg-gradient-to-b from-accent-primary to-accent-violet">
          <Sparkles className="size-4 text-text-primary" />
        </div>
        <span className="text-gradient-brand text-lg font-bold">narratox</span>
      </div>

      {/* 导航 */}
      <nav className="flex flex-col gap-1">
        {TABS.map((t) => {
          const isActive = active === t.key
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => router.push(t.href)}
              className={cn(
                'relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] transition-colors',
                isActive
                  ? 'bg-accent-primarySoft font-semibold text-text-primary'
                  : 'text-text-tertiary hover:bg-overlay-10 hover:text-text-primary'
              )}
            >
              {isActive ? (
                <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent-indigoLight" />
              ) : null}
              <t.icon className="size-4 shrink-0" />
              <span>{t.label}</span>
            </button>
          )
        })}
      </nav>

      {/* 用户卡 */}
      <div className="mt-auto px-1">
        <div className="flex items-center gap-2.5 rounded-lg p-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-accent-primary to-accent-violet text-sm font-semibold text-text-primary">
            {initial}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-sm font-medium text-text-primary">
              {displayName}
            </span>
            <button
              type="button"
              onClick={() => {
                logout()
                router.replace('/login')
              }}
              className="text-left text-[11px] text-text-label transition-colors hover:text-destructive"
            >
              登出
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}

export default AppSidebar
