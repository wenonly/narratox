'use client'

import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useStore } from '@/store'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * 共用退出确认弹窗。AppSidebar + AccountChip(workspace)共用。
 * 二次确认 → logout() + redirect /login。
 */
const LogoutConfirmDialog = ({ open, onOpenChange }: Props) => {
  const router = useRouter()
  const logout = useStore((s) => s.logout)

  const handleConfirm = () => {
    onOpenChange(false)
    logout()
    router.replace('/login')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>确定退出登录?</DialogTitle>
          <DialogDescription>
            退出后需要重新登录才能继续使用 NarratoX。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="destructive" onClick={handleConfirm}>
            <LogOut className="size-4" />
            确认退出
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default LogoutConfirmDialog
