'use client'
import { Suspense } from 'react'
import { useRouter } from 'next/navigation'
import RequireAuth from '@/components/auth/RequireAuth'
import CreationChat from '@/components/workspace/CreationChat'
import { useStore } from '@/store'
import { Button } from '@/components/ui/button'

export default function NewNovelPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <RequireAuth>
        <CreationShell />
      </RequireAuth>
    </Suspense>
  )
}

const CreationShell = () => {
  const router = useRouter()
  const logout = useStore((s) => s.logout)
  return (
    <div className="flex h-screen bg-background/80">
      <aside className="flex w-60 shrink-0 flex-col gap-3 border-r border-primary/10 px-4 py-5 font-dmmono">
        <button
          onClick={() => router.push('/')}
          className="text-left text-xs font-medium text-brand"
          type="button"
        >
          ‹ 小说库
        </button>
        <span className="text-xs font-medium uppercase text-white">
          新建小说
        </span>
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
      <CreationChat />
    </div>
  )
}
