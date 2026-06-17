'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useStore } from '@/store'
import { getStatusAPI } from '@/api/os'
import RequireAuth from '@/components/auth/RequireAuth'
import { Button } from '@/components/ui/button'

// 模型来自 server agentos.constants.GLM_MODEL(Phase 1 只读回显;以后接 /settings 端点)
const CURRENT_MODEL = 'GLM-5.2'

export default function SettingsPage() {
  return (
    <RequireAuth>
      <Settings />
    </RequireAuth>
  )
}

const Settings = () => {
  const router = useRouter()
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
      <aside className="flex w-60 shrink-0 flex-col gap-3 border-r border-primary/10 px-4 py-5 font-dmmono">
        <button
          onClick={() => router.push('/')}
          className="text-left text-xs font-medium text-brand"
          type="button"
        >
          ‹ 小说库
        </button>
        <span className="text-xs font-medium uppercase text-white">设置</span>
      </aside>
      <main className="flex-1 overflow-y-auto p-8">
        <h1 className="mb-6 text-lg font-semibold text-primary">应用设置</h1>
        <div className="max-w-md space-y-4 text-sm">
          <Row label="当前模型" value={CURRENT_MODEL} />
          <Row label="后端地址" value={endpoint} />
          <Row
            label="后端状态"
            value={status === 200 ? '在线 ●' : `离线 (${status ?? '—'})`}
          />
          <div className="rounded-xl border border-primary/10 bg-background-secondary p-4 text-xs text-muted">
            <p className="mb-1 font-medium text-primary">以后会支持</p>
            <ul className="list-disc pl-4">
              <li>模型选择 / 各模型参数自定义</li>
              <li>主题切换</li>
            </ul>
          </div>
          <Button variant="ghost" size="sm" className="text-muted">
            (Phase 1 仅只读)
          </Button>
        </div>
      </main>
    </div>
  )
}

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between rounded-xl border border-primary/10 bg-background-secondary px-4 py-3">
    <span className="text-xs uppercase text-muted">{label}</span>
    <span className="text-primary">{value}</span>
  </div>
)
