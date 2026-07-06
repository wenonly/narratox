'use client'

import { useEffect, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Dna,
  Flag,
  Gem,
  MapPin,
  Scale,
  Scroll,
  Zap,
  type LucideIcon
} from 'lucide-react'

import { useStore } from '@/store'
import { getWorldview } from '@/api/novels'
import { cn } from '@/lib/utils'
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

type FamilyKey = 'lore' | 'power' | 'world'

const TYPE_META: Record<
  WorldEntryType,
  { label: string; icon: LucideIcon; family: FamilyKey }
> = {
  concept: { label: '设定 / 总览', icon: Scroll, family: 'lore' },
  history: { label: '历史 / 传说', icon: Clock, family: 'lore' },
  powerSystem: { label: '力量体系', icon: Zap, family: 'power' },
  rule: { label: '规则 / 禁忌', icon: Scale, family: 'power' },
  item: { label: '物品 / 资源', icon: Gem, family: 'power' },
  location: { label: '地点', icon: MapPin, family: 'world' },
  faction: { label: '势力 / 组织', icon: Flag, family: 'world' },
  race: { label: '种族 / 生物', icon: Dna, family: 'world' }
}

const FAMILY_COLOR: Record<FamilyKey, { color: string; soft: string }> = {
  lore: { color: 'accent-primary', soft: 'accent-primarySoft' },
  power: { color: 'family-power', soft: 'family-powerSoft' },
  world: { color: 'family-world', soft: 'family-worldSoft' }
}

const TYPE_ORDER: WorldEntryType[] = [
  'concept',
  'history',
  'powerSystem',
  'rule',
  'item',
  'location',
  'faction',
  'race'
]

// 折叠态摘要:取正文首行(去 markdown 标记),截到 60 字。
const essence = (content: string): string => {
  const text = content
    .replace(/^#+\s*/m, '')
    .replace(/[*_`>-]/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)[0]
  if (!text) return ''
  return text.length > 60 ? text.slice(0, 60) + '…' : text
}

// Tailwind JIT 字面量 map:动态取色必须经此查找,模板字符串拼接会被 purge。
const FAMILY_BG: Record<string, string> = {
  'accent-primarySoft': 'bg-accent-primarySoft',
  'family-powerSoft': 'bg-family-powerSoft',
  'family-worldSoft': 'bg-family-worldSoft'
}
const FAMILY_FG: Record<string, string> = {
  'accent-primary': 'text-accent-primary',
  'family-power': 'text-family-power',
  'family-world': 'text-family-world'
}
const FAMILY_BAND: Record<string, string> = {
  'accent-primary': 'border-l-accent-primary',
  'family-power': 'border-l-family-power',
  'family-world': 'border-l-family-world'
}

// type 图标盒:族 soft 底 + 族色图标。size='sm'(折叠 26)/ 'md'(展开 34)。
const TypeIconBox = ({
  type,
  size = 'sm'
}: {
  type: WorldEntryType
  size?: 'sm' | 'md'
}) => {
  const meta = TYPE_META[type]
  const fam = FAMILY_COLOR[meta.family]
  const Icon = meta.icon
  const px = size === 'md' ? 34 : 26
  const fs = size === 'md' ? 16 : 13
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full',
        FAMILY_BG[fam.soft]
      )}
      style={{ width: px, height: px }}
    >
      <Icon
        className={FAMILY_FG[fam.color]}
        style={{ width: fs, height: fs }}
      />
    </div>
  )
}

const WorldviewView = ({ novel }: WorldviewViewProps) => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const worldEntryWriteSeq = useStore((s) => s.worldEntryWriteSeq)
  const [entries, setEntries] = useState<WorldEntry[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)

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

  if (loading) return <p className="text-sm text-text-tertiary">加载世界观…</p>
  if (!entries || entries.length === 0) {
    return (
      <p className="text-sm text-text-tertiary">
        世界观尚未构建。在聊天里让 Agent 构建世界观(它会调 set_world_entry
        建力量体系/地点/势力/规则等条目),这里会按类型分组显示。
      </p>
    )
  }

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
            <p className="mb-1.5 text-[10px] font-semibold tracking-wide text-text-tertiary">
              {WORLD_TYPE_LABEL[type]} · {items.length}
            </p>
            <div className="space-y-1.5">
              {items.map((e) => {
                const isOpen = openId === e.id
                return (
                  <div
                    key={e.id}
                    className="rounded-md border border-overlay-15 bg-bg-cardElevated px-3 py-2"
                  >
                    {isOpen ? (
                      <button
                        type="button"
                        onClick={() =>
                          setOpenId((cur) => (cur === e.id ? null : e.id))
                        }
                        className="flex w-full items-center gap-1.5 text-left"
                      >
                        <ChevronDown className="size-3.5 shrink-0 text-text-label" />
                        <span className="text-sm font-medium text-text-primary">
                          {e.name}
                        </span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          setOpenId((cur) => (cur === e.id ? null : e.id))
                        }
                        className="flex w-full items-center justify-between gap-2 text-left"
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <ChevronRight className="size-3.5 shrink-0 text-text-label" />
                          <span className="truncate text-sm text-text-primary">
                            {e.name}
                          </span>
                        </span>
                        {e.content && (
                          <span className="ml-2 shrink-0 truncate text-xs text-text-tertiary">
                            {essence(e.content)}
                          </span>
                        )}
                      </button>
                    )}
                    {isOpen && e.content && (
                      <div className="prose prose-invert mt-2 max-w-none border-t border-overlay-10 pt-2 text-xs leading-relaxed text-text-secondary">
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
