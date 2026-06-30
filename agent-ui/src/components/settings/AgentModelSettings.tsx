'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/store'
import {
  listAgentModels,
  listAgentTree,
  listVendors,
  putAgentModel
} from '@/api/settings'
import type {
  AgentGroup,
  AgentOverride,
  RecommendedTier,
  Vendor
} from '@/types/settings'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

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

const AgentModelSettings = () => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const [open, setOpen] = useState(false)
  const [groups, setGroups] = useState<AgentGroup[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [overrides, setOverrides] = useState<Record<string, AgentOverride>>({})
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [g, v, o] = await Promise.all([
        listAgentTree(endpoint, token),
        listVendors(endpoint, token),
        listAgentModels(endpoint, token)
      ])
      setGroups(g)
      setVendors(v)
      setOverrides(o)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [endpoint, token])

  // 打开弹窗时才拉取(设置页一进来不占请求)
  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])

  const onChange = async (
    agentKey: string,
    modelId: string,
    temperature: number | null
  ) => {
    // 调用前的真值(回滚用)。同步读,代表本次写入前的状态。
    const prevEntry = overrides[agentKey]

    try {
      // functional setState:避免连续快速编辑(模型+温度)读 stale overrides 丢一个
      // 两者空 → 本地不建条目(后端 remove);否则保留(modelId 可空 = 只设温度)
      setOverrides((prev) => ({
        ...prev,
        ...(!modelId && temperature == null
          ? {}
          : { [agentKey]: { modelId, temperature } })
      }))
      await putAgentModel(endpoint, token, agentKey, {
        modelId: modelId || undefined,
        temperature
      })
      // 两者空 → 后端 remove → 本地同步删条目
      if (!modelId && temperature == null) {
        setOverrides((prev) => {
          const next = { ...prev }
          delete next[agentKey]
          return next
        })
      }
      toast.success('已保存')
    } catch (err) {
      // 回滚用 functional,基于最新 prev 恢复到 prevEntry(或删除若原本无)
      setOverrides((prev) => {
        const next = { ...prev }
        if (prevEntry) next[agentKey] = prevEntry
        else delete next[agentKey]
        return next
      })
      toast.error(err instanceof Error ? err.message : '保存失败')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* 设置页紧凑入口:点开才弹窗配置 */}
      <div className="flex items-center gap-3 rounded-lg border border-primary/10 bg-background-secondary px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-primary">
            按 Agent 分配模型
          </div>
          <div className="truncate text-xs text-muted">
            为各 Agent 单独指定模型与温度,未指定则跟随默认模型
          </div>
        </div>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="ml-auto shrink-0">
            管理
          </Button>
        </DialogTrigger>
      </div>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>按 Agent 分配模型</DialogTitle>
          <DialogDescription>
            为各 Agent
            单独指定模型与温度,未指定则跟随默认模型。推荐级别仅作参考。
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <p className="py-4 text-xs text-muted">加载中…</p>
        ) : (
          <div className="scrollbar-none -mx-1 min-h-0 flex-1 overflow-y-auto px-1">
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
                        <div className="w-40 shrink-0">
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
                          value={overrides[a.key]?.modelId ?? ''}
                          onChange={(e) =>
                            onChange(
                              a.key,
                              e.target.value,
                              overrides[a.key]?.temperature ?? null
                            )
                          }
                          className="input-base ml-auto w-44"
                        >
                          <option value="">默认</option>
                          {vendors.map((v) => (
                            <optgroup key={v.id} label={v.name}>
                              {v.models.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.model}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        <input
                          type="number"
                          step="0.1"
                          min={0}
                          max={2}
                          value={overrides[a.key]?.temperature ?? ''}
                          onChange={(e) =>
                            onChange(
                              a.key,
                              overrides[a.key]?.modelId ?? '',
                              e.target.value === ''
                                ? null
                                : Number(e.target.value)
                            )
                          }
                          placeholder="0.5"
                          className="input-base w-16"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default AgentModelSettings
