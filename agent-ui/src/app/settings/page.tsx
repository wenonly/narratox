'use client'

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

const SectionHeader = ({
  title,
  subtitle
}: {
  title: string
  subtitle?: string
}) => (
  <div className="mb-2.5">
    <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
    {subtitle && <p className="mt-0.5 text-xs text-text-label">{subtitle}</p>}
  </div>
)

const Settings = () => {
  return (
    <PageShell active="settings" title="设置">
      <div className="space-y-6">
        <section>
          <SectionHeader title="模型设置" />
          <ModelSettings />
        </section>

        <section>
          <SectionHeader title="Agent 模型配置" />
          <AgentModelSettings />
        </section>

        <section>
          <SectionHeader
            title="作者画像"
            subtitle="画像库 · 不同类型的书可建不同声音"
          />
          <VoiceProfileList />
        </section>
      </div>
    </PageShell>
  )
}
