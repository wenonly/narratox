'use client'

import { useEffect, useState } from 'react'
import { useStore } from '@/store'
import { getWorldview } from '@/api/novels'
import type { Novel, WorldEntry, WorldEntryType } from '@/types/novel'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'

export interface WorldviewViewProps {
  novel: Novel
}

const WORLD_TYPE_LABEL: Record<WorldEntryType, string> = {
  concept: '设定 / 总览',
  powerSystem: '力量体系',
  location: '地点',
  faction: '势力 / 组织',
  race: '种族 / 生物',
  rule: '规则 / 禁忌',
  item: '物品 / 资源',
  history: '历史 / 传说'
}

const WorldviewView = ({ novel }: WorldviewViewProps) => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  // set_world_entry 落库时 bump → 重新拉取。
  const worldEntryWriteSeq = useStore((s) => s.worldEntryWriteSeq)
  const [entries, setEntries] = useState<WorldEntry[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [openName, setOpenName] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getWorldview(endpoint, token, novel.id)
      .then((d) => {
        if (!cancelled) setEntries(d)
      })
      .catch(() => {
        if (!cancelled) setEntries(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [endpoint, token, novel.id, worldEntryWriteSeq])

  if (loading) return <p className="text-sm text-muted">加载世界观…</p>
  if (!entries || entries.length === 0) {
    return (
      <p className="text-sm text-muted">
        世界观尚未构建。在聊天里让 Agent 构建世界观(它会调 set_world_entry
        建力量体系/地点/势力/规则等条目),这里会按类型分组显示。
      </p>
    )
  }

  // 按 type 分组(保持 WORLD_TYPE_LABEL 的展示顺序)。
  const typeOrder: WorldEntryType[] = [
    'concept',
    'powerSystem',
    'rule',
    'location',
    'faction',
    'race',
    'item',
    'history'
  ]
  const grouped = (type: WorldEntryType) =>
    entries.filter((e) => e.type === type)

  return (
    <div className="space-y-3">
      {typeOrder.map((type) => {
        const items = grouped(type)
        if (items.length === 0) return null
        return (
          <div key={type}>
            <p className="text-xs uppercase text-muted">
              {WORLD_TYPE_LABEL[type]} · {items.length}
            </p>
            <div className="mt-1 space-y-1.5">
              {items.map((e) => {
                const isOpen = openName === e.name
                return (
                  <div
                    key={e.id}
                    className="rounded border border-primary/10 bg-background px-2 py-1.5"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setOpenName((cur) => (cur === e.name ? null : e.name))
                      }
                      className="flex w-full items-center justify-between text-left"
                    >
                      <span className="text-sm text-primary">{e.name}</span>
                      <span className="text-xs text-muted">
                        {isOpen ? '▼' : '▶'}
                      </span>
                    </button>
                    {isOpen && e.content && (
                      <div className="prose prose-invert mt-2 max-w-none border-t border-primary/10 pt-2 text-sm">
                        <MarkdownRenderer>{e.content}</MarkdownRenderer>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default WorldviewView
