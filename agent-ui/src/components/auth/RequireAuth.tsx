'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { useStore } from '@/store'
import { meAPI } from '@/api/auth'

/**
 * 客户端鉴权守卫：token 在 localStorage（zustand persist），Next.js
 * middleware 读不到 localStorage，故用客户端守卫。等 store rehydrate 后：
 * - 无 token → 跳 /login；
 * - 有 token → GET /auth/me 校验，401 则登出并跳 /login。
 */
export default function RequireAuth({
  children
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const hydrated = useStore((s) => s.hydrated)
  const authToken = useStore((s) => s.authToken)
  const endpoint = useStore((s) => s.selectedEndpoint)
  const logout = useStore((s) => s.logout)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    if (!hydrated) return
    if (!authToken) {
      router.replace('/login')
      return
    }
    meAPI(endpoint, authToken)
      .then(() => setChecked(true))
      .catch(() => {
        logout()
        router.replace('/login')
      })
  }, [hydrated, authToken, endpoint, router, logout])

  if (!hydrated || !authToken || !checked) {
    return (
      <div className="flex h-screen items-center justify-center bg-background/80 text-sm text-muted">
        Loading…
      </div>
    )
  }
  return <>{children}</>
}
