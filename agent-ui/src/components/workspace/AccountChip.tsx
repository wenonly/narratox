'use client'

import { useState } from 'react'
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

import VoiceProfileSelector from './VoiceProfileSelector'
import LogoutConfirmDialog from '@/components/auth/LogoutConfirmDialog'

interface Props {
  /** 工作台传入:有值时「作者画像」开 Dialog 选画像;否则跳 /settings。 */
  novelId?: string
  /** 画像切换后刷新 novel。 */
  onVoiceProfileSaved?: () => void
  /** 当前小说所选画像 id(用于 selector 高亮)。 */
  voiceProfileId?: string | null
}

/**
 * AccountChip — pill in ChatCard head: gradient avatar + username + caret.
 * Menu: 作者画像 (→ workspace Dialog selector if novelId, else /settings) ·
 * 设置 (→ /settings) · 登出.
 */
const AccountChip = ({
  novelId,
  onVoiceProfileSaved,
  voiceProfileId
}: Props) => {
  const router = useRouter()
  const user = useStore((s) => s.user)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [logoutOpen, setLogoutOpen] = useState(false)

  const username = user?.username || user?.email || 'U'
  const initial = username.charAt(0).toUpperCase()

  const goSettings = () => router.push('/settings')
  const handleVoiceClick = () => {
    if (novelId) setVoiceOpen(true)
    else goSettings()
  }
  const handleLogout = () => setLogoutOpen(true)

  return (
    <>
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
          <DropdownMenuLabel className="truncate">{username}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleVoiceClick}>
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

      {novelId && (
        <Dialog open={voiceOpen} onOpenChange={setVoiceOpen}>
          <DialogContent className="max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>作者画像</DialogTitle>
            </DialogHeader>
            <VoiceProfileSelector
              novelId={novelId}
              currentProfileId={voiceProfileId}
              onSaved={() => {
                onVoiceProfileSaved?.()
              }}
            />
          </DialogContent>
        </Dialog>
      )}

      <LogoutConfirmDialog open={logoutOpen} onOpenChange={setLogoutOpen} />
    </>
  )
}

export default AccountChip
