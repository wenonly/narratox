'use client'

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
  return (
    <PageShell active="knowledge" title="写作知识库">
      <KnowledgeBrowser />
    </PageShell>
  )
}
