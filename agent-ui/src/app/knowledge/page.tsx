'use client'

import { useEffect, useState } from 'react'
import { useStore } from '@/store'
import { getStatusAPI } from '@/api/os'
import RequireAuth from '@/components/auth/RequireAuth'
import PageShell from '@/components/layout/PageShell'
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
    <PageShell
      active="knowledge"
      title="写作知识库"
      subtitle={
        <>
          后端 {endpoint} ·{' '}
          {status === 200 ? '在线 ●' : `离线 (${status ?? '—'})`}
        </>
      }
    >
      <KnowledgeBrowser />
    </PageShell>
  )
}
