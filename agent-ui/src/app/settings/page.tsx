'use client'

import { useEffect, useState } from 'react'
import { useStore } from '@/store'
import { getStatusAPI } from '@/api/os'
import RequireAuth from '@/components/auth/RequireAuth'
import AppSidebar from '@/components/layout/AppSidebar'
import ModelSettings from '@/components/settings/ModelSettings'
import VoiceProfile from '@/components/settings/VoiceProfile'

export default function SettingsPage() {
  return (
    <RequireAuth>
      <Settings />
    </RequireAuth>
  )
}

const Settings = () => {
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
      <AppSidebar active="settings" />
      <main className="flex-1 overflow-y-auto p-8">
        <h1 className="mb-2 text-lg font-semibold text-primary">设置</h1>
        <p className="mb-6 text-xs text-muted">
          后端 {endpoint} ·{' '}
          {status === 200 ? '在线 ●' : `离线 (${status ?? '—'})`}
        </p>

        <h2 className="mb-2 text-sm font-semibold text-primary">模型设置</h2>
        <div className="mb-10">
          <ModelSettings />
        </div>

        <h2 className="mb-2 text-sm font-semibold text-primary">作者画像</h2>
        <p className="mb-3 text-xs text-muted">
          你的写作声音 · 全局(所有小说共用)
        </p>
        <VoiceProfile />
      </main>
    </div>
  )
}
