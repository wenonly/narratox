'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/store'
import {
  deleteAgentModel,
  listAgentModels,
  listAgentTree,
  putAgentModel
} from '@/api/settings'
import type { AgentGroup, ModelConfig, RecommendedTier } from '@/types/settings'

const TIER_LABEL: Record<RecommendedTier, string> = {
  strong: '🔴 推荐强',
  mid: '🟡 推荐中',
  cheap: '💚 推荐便宜'
}
const TIER_COLOR: Record<RecommendedTier, string> = {
  strong: 'text-red-400',
  mid: 'text-yellow-400',
  cheap: 'text-green-400'
}

interface Props {
  /** 复用父级已加载的模型列表(含 name/id)。 */
  configs: ModelConfig[]
}

const AgentModelSettings = ({ configs }: Props) => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const [groups, setGroups] = useState<AgentGroup[]>([])
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [g, o] = await Promise.all([
        listAgentTree(endpoint, token),
        listAgentModels(endpoint, token)
      ])
      setGroups(g)
      setOverrides(o)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [endpoint, token])

  useEffect(() => {
    refresh()
  }, [refresh])

  const onChange = async (agentKey: string, modelConfigId: string) => {
    const prev = overrides[agentKey]
    try {
      if (modelConfigId === '') {
        const next = { ...overrides }
        delete next[agentKey]
        setOverrides(next)
        await deleteAgentModel(endpoint, token, agentKey)
      } else {
        setOverrides({ ...overrides, [agentKey]: modelConfigId })
        await putAgentModel(endpoint, token, agentKey, modelConfigId)
      }
      toast.success('已保存')
    } catch (err) {
      setOverrides({ ...overrides, [agentKey]: prev }) // 回滚
      toast.error(err instanceof Error ? err.message : '保存失败')
    }
  }

  if (loading) return <p className="text-xs text-muted">加载中…</p>

  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <div key={g.group}>
          <h3 className="mb-2 text-xs font-semibold uppercase text-muted">
            {g.group}
          </h3>
          <div className="space-y-1.5">
            {g.agents.map((a) => (
              <div
                key={a.key}
                className="flex items-center gap-3 rounded-lg border border-primary/10 bg-background-secondary px-3 py-2"
              >
                <div className="w-44 shrink-0">
                  <div className="text-sm text-primary">{a.key}</div>
                  <div className="truncate text-xs text-muted">
                    {a.description}
                  </div>
                </div>
                <span
                  className={`text-[10px] ${TIER_COLOR[a.recommendedTier]}`}
                >
                  {TIER_LABEL[a.recommendedTier]}
                </span>
                <select
                  value={overrides[a.key] ?? ''}
                  onChange={(e) => onChange(a.key, e.target.value)}
                  className="input-base ml-auto w-48"
                >
                  <option value="">默认</option>
                  {configs.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default AgentModelSettings
