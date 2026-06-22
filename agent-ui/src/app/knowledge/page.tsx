'use client'

import { useEffect, useState } from 'react'
import { useStore } from '@/store'
import { getStatusAPI } from '@/api/os'
import RequireAuth from '@/components/auth/RequireAuth'
import AppSidebar from '@/components/layout/AppSidebar'
import KnowledgeBrowser from '@/components/knowledge/KnowledgeBrowser'

export default function KnowledgePage() {
  return (
    <RequireAuth>
      <Knowledge />
    </RequireAuth>
  )
}

const Knowledge = () => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const [status, setStatus] = useState<number | null>(null)

  useEffect(() => {
    getStatusAPI(endpoint, token)
      .then(setStatus)
      .catch(() => setStatus(503))
  }, [endpoint, token])

  return (
    <div className="flex h-screen bg-background/80">
      <AppSidebar active="knowledge" />
      <main className="flex-1 overflow-y-auto p-8">
        <h1 className="mb-2 text-lg font-semibold text-primary">写作知识库</h1>
        <p className="mb-6 text-xs text-muted">
          后端 {endpoint} ·{' '}
          {status === 200 ? '在线 ●' : `离线 (${status ?? '—'})`}
        </p>
        <KnowledgeBrowser />
      </main>
    </div>
  )
}
