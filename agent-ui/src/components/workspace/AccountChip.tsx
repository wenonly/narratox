'use client'

import { useRouter } from 'next/navigation'
import { ChevronDown, LogOut, Settings, Sparkles } from 'lucide-react'

import { useStore } from '@/store'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

/**
 * AccountChip — pill in ChatCard head: gradient avatar + username + caret.
 * Menu: 作者画像 / 设置 (→ /settings) · 登出.
 */
const AccountChip = () => {
  const router = useRouter()
  const user = useStore((s) => s.user)
  const logout = useStore((s) => s.logout)

  const username = user?.username || user?.email || 'U'
  const initial = username.charAt(0).toUpperCase()

  const goSettings = () => router.push('/settings')
  const handleLogout = () => {
    logout()
    router.replace('/login')
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-pill bg-overlay-10 py-1 pl-1 pr-2.5 transition-colors hover:bg-overlay-15"
        >
          <span className="flex size-6 items-center justify-center rounded-full bg-gradient-to-b from-accent-primary to-accent-violet text-xs font-semibold text-text-primary">
            {initial}
          </span>
          <span className="max-w-[120px] truncate text-xs text-text-secondary">
            {username}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-text-label" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="truncate">
          {username}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={goSettings}>
          <Sparkles className="mr-2 size-4 text-accent-violetLight" />
          作者画像
        </DropdownMenuItem>
        <DropdownMenuItem onClick={goSettings}>
          <Settings className="mr-2 size-4 text-text-label" />
          设置
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout}>
          <LogOut className="mr-2 size-4 text-text-label" />
          登出
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default AccountChip
