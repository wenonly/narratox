'use client'

import { useState } from 'react'
import type { Novel } from '@/types/novel'
import { cn } from '@/lib/utils'

import EventsView from './EventsView'
import HooksView from './HooksView'

export interface PlotlineViewProps {
  novel: Novel
}

type SubTab = 'hooks' | 'events'

/**
 * 剧情线面板 — 合并 伏笔 + 事件 两个数据源,顶部一对子 tab 切换。
 * Pencil R4/R4b:子 tab 是胶囊轨道 + 两个等宽按钮;active = elevated + 主文色。
 * 数据/刷新逻辑各自留在 HooksView / EventsView 内,这里只做容器。
 */
const PlotlineView = ({ novel }: PlotlineViewProps) => {
  const [tab, setTab] = useState<SubTab>('hooks')

  return (
    <div className="space-y-3">
      <div className="flex rounded-full bg-overlay-5 p-1">
        {(
          [
            { key: 'hooks', label: '伏笔' },
            { key: 'events', label: '事件' }
          ] as const
        ).map((t) => {
          const isActive = tab === t.key
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-pressed={isActive}
              className={cn(
                'h-8 flex-1 rounded-full text-xs transition-colors',
                isActive
                  ? 'bg-bg-cardElevated font-semibold text-text-primary'
                  : 'text-text-tertiary hover:text-text-secondary'
              )}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      {tab === 'hooks' ? (
        <HooksView novel={novel} />
      ) : (
        <EventsView novel={novel} />
      )}
    </div>
  )
}

export default PlotlineView
