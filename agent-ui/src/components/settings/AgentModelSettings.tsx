'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Bookmark,
  BookOpen,
  Bot,
  Brain,
  ChevronDown,
  Feather,
  Globe,
  List,
  Pencil,
  ScanText,
  ShieldCheck,
  User,
  type LucideIcon
} from 'lucide-react'
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

/** tier 软底彩色 badge(对齐 Pencil:strong=红 / mid=黄 / cheap=绿)。 */
const TIER_BADGE: Record<RecommendedTier, { label: string; cls: string }> = {
  strong: { label: '强', cls: 'bg-destructive/20 text-destructive' },
  mid: { label: '中', cls: 'bg-warning/20 text-warning' },
  cheap: { label: '便宜', cls: 'bg-success/20 text-success' }
}

/** agent key → 角色图标(对齐 Pencil;未命中的 key 兜底 Bot)。 */
const AGENT_ICON: Record<string, LucideIcon> = {
  main: Brain,
  'dissect-main': Brain,
  chapter: Pencil,
  writer: Feather,
  settler: Bookmark,
  validator: ShieldCheck,
  curator: BookOpen,
  worldbuilder: Globe,
  'wb-writer': Globe,
  'wb-critic': ShieldCheck,
  outliner: List,
  'outline-writer': List,
  'outline-critic': ShieldCheck,
  character: User,
  'char-writer': User,
  'char-critic': ShieldCheck,
  'chapter-extractor': ScanText,
  'plot-analyst': ScanText,
  'character-extractor': ScanText,
  'style-analyst': ScanText,
  'dissect-critic': ShieldCheck
}

const AgentIcon = ({ agentKey }: { agentKey: string }) => {
  const Icon = AGENT_ICON[agentKey] ?? Bot
  return <Icon size={14} className="shrink-0 text-text-tertiary" />
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

  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])

  const onChange = async (
    agentKey: string,
    modelId: string,
    temperature: number | null
  ) => {
    const prevEntry = overrides[agentKey]

    try {
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
      if (!modelId && temperature == null) {
        setOverrides((prev) => {
          const next = { ...prev }
          delete next[agentKey]
          return next
        })
      }
      toast.success('已保存')
    } catch (err) {
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
      <div className="flex items-center gap-3 rounded-lg border border-overlay-15 bg-bg-cardElevated px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-text-primary">
            按 Agent 分配模型
          </div>
          <div className="truncate text-xs text-text-tertiary">
            为各 Agent 单独指定模型与温度,未指定则跟随默认模型
          </div>
        </div>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="ml-auto shrink-0">
            配置
          </Button>
        </DialogTrigger>
      </div>
      <DialogContent className="max-h-[85vh] sm:max-w-[720px]">
        <DialogHeader className="shrink-0">
          <DialogTitle>按 Agent 分配模型</DialogTitle>
          <DialogDescription>
            为各 Agent
            单独指定模型与温度,未指定则跟随默认模型。推荐级别仅作参考。
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <p className="py-4 text-xs text-text-tertiary">加载中…</p>
        ) : (
          <div className="scrollbar-none -mx-1 min-h-0 flex-1 overflow-y-auto px-1">
            <div className="space-y-5">
              {groups.map((g) => (
                <div key={g.group}>
                  <h3 className="mb-2 text-xs font-semibold uppercase text-text-tertiary">
                    {g.group}
                  </h3>
                  <div className="space-y-1.5">
                    {g.agents.map((a) => (
                      <div
                        key={a.key}
                        className="flex items-center gap-3 rounded-md border border-overlay-10 bg-bg-cardElevated px-3 py-2.5"
                      >
                        <AgentIcon agentKey={a.key} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-text-primary">
                            {a.key}
                          </div>
                          <div className="truncate text-xs text-text-tertiary">
                            {a.description}
                          </div>
                        </div>
                        <span
                          className={`shrink-0 rounded-sm px-2 py-0.5 text-[10px] font-semibold ${TIER_BADGE[a.recommendedTier].cls}`}
                        >
                          {TIER_BADGE[a.recommendedTier].label}
                        </span>
                        <div className="relative w-44 shrink-0">
                          <select
                            value={overrides[a.key]?.modelId ?? ''}
                            onChange={(e) =>
                              onChange(
                                a.key,
                                e.target.value,
                                overrides[a.key]?.temperature ?? null
                              )
                            }
                            className="input-base w-full appearance-none py-1.5 pr-9"
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
                          <ChevronDown
                            size={14}
                            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary"
                          />
                        </div>
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
                          className="input-base w-16 shrink-0 py-1.5"
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
