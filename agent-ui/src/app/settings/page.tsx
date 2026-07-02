'use client'

import { useEffect, useState } from 'react'
import { useStore } from '@/store'
import { getStatusAPI } from '@/api/os'
import RequireAuth from '@/components/auth/RequireAuth'
import PageShell from '@/components/layout/PageShell'
import AgentModelSettings from '@/components/settings/AgentModelSettings'
import ModelSettings from '@/components/settings/ModelSettings'
import VoiceProfileList from '@/components/settings/VoiceProfileList'

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
    <PageShell
      active="settings"
      title="设置"
      subtitle={
        <>
          后端 {endpoint} ·{' '}
          {status === 200 ? '在线 ●' : `离线 (${status ?? '—'})`}
        </>
      }
    >
      <h2 className="mb-2 text-sm font-semibold text-text-primary">模型设置</h2>
      <div className="mb-10">
        <ModelSettings />
      </div>

      <div className="mb-10">
        <AgentModelSettings />
      </div>

      <h2 className="mb-2 text-sm font-semibold text-text-primary">作者画像</h2>
      <p className="mb-3 text-xs text-text-tertiary">
        画像库 · 不同类型的书可建不同声音,每本小说在工作台单独选用
      </p>
      <VoiceProfileList />
    </PageShell>
  )
}
