'use client'

import { useEffect, useState } from 'react'
import { useStore } from '@/store'
import { getStatus } from '@/api/novels'
import type { Novel, NovelStatus } from '@/types/novel'

export interface OverviewViewProps {
  novel: Novel
}

const NEXT_STEP_LABEL: Record<string, string> = {
  collect_basics: '收集基础信息',
  build_world: '建世界观',
  plan_outline: '规划大纲',
  build_characters: '建角色档案',
  plan_more: '补细纲',
  write_next: '写下一章'
}

const OverviewView = ({ novel }: OverviewViewProps) => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  // 章/大纲/事件/角色写入都改变态势 → 复用 chapterWriteSeq 刷新。
  const chapterWriteSeq = useStore((s) => s.chapterWriteSeq)
  const [status, setStatus] = useState<NovelStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getStatus(endpoint, token, novel.id)
      .then((d) => {
        if (!cancelled) setStatus(d)
      })
      .catch(() => {
        if (!cancelled) setStatus(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [endpoint, token, novel.id, chapterWriteSeq])

  if (loading) return <p className="text-sm text-text-tertiary">加载态势…</p>
  if (!status)
    return <p className="text-sm text-text-tertiary">暂无态势数据。</p>

  const ob = status.onboarding
  const basicsAll = Object.values(ob.basics).every(Boolean)
  const Check = ({ ok, label }: { ok: boolean; label: string }) => (
    <span className={ok ? 'text-text-primary' : 'text-accent-indigoLight'}>
      {ok ? '✓' : '✗'}
      {label}{' '}
    </span>
  )

  return (
    <div className="space-y-3 text-sm">
      <div className="rounded-md border border-overlay-15 bg-bg-cardElevated px-3 py-2">
        <p className="text-xs uppercase text-text-tertiary">进度</p>
        <p className="mt-1 text-text-primary">
          {status.totalWords} 字 · {status.chapterCount} 章 · frontier 第{' '}
          {status.frontierChapter} 章
          {status.coverage.targetChapters
            ? ` · 目标 ${status.coverage.targetChapters} 章`
            : ''}
        </p>
        {status.currentVolume && (
          <p className="text-xs text-text-tertiary">
            当前:卷《{status.currentVolume.title}》
            {status.currentArc
              ? ` · 弧${status.currentArc.order}「${status.currentArc.title}」(第${status.currentArc.fromChapter}-${status.currentArc.toChapter}章)`
              : ''}
          </p>
        )}
      </div>

      <div className="rounded-md border border-overlay-15 px-3 py-2">
        <p className="text-xs uppercase text-text-tertiary">
          立项 {ob.readyToWrite ? '✓ 可写' : '(未齐)'}
        </p>
        <p className="mt-1 text-xs">
          <Check ok={basicsAll} label="基础" />
          <Check ok={ob.hasReferences} label="参考" />
          <Check ok={ob.hasWorld} label="世界" />
          <Check ok={ob.hasOutline} label="大纲" />
          <Check ok={ob.hasArcs} label="弧" />
          <Check ok={ob.hasCharacters} label="角色" />
        </p>
      </div>

      <div className="rounded-md border border-overlay-15 px-3 py-2">
        <p className="text-xs uppercase text-text-tertiary">大纲覆盖</p>
        <p className="mt-1 text-xs text-text-tertiary">
          {status.coverage.volumes} 卷 / {status.coverage.arcs} 弧 · 细纲已规划{' '}
          {status.coverage.plannedChapters} 章 · 距 frontier 剩{' '}
          {status.coverage.plannedRemaining} 章可写
        </p>
      </div>

      <div className="rounded-md border border-overlay-15 px-3 py-2">
        <p className="text-xs uppercase text-text-tertiary">健康</p>
        <p className="mt-1 text-xs text-text-tertiary">
          开放伏笔 {status.health.openHooks}
          {status.health.staleHooks
            ? `(⚠️陈久 ${status.health.staleHooks})`
            : ''}{' '}
          · MAJOR 事件 {status.health.majorEvents}
        </p>
      </div>

      <div className="rounded-md border border-overlay-15 bg-accent-primarySoft px-3 py-2">
        <p className="text-xs uppercase text-accent-indigoLight">
          下一步 · {status.recentPhase ? `近期:${status.recentPhase} · ` : ''}
          {NEXT_STEP_LABEL[status.nextStep] ?? status.nextStep}
        </p>
      </div>
    </div>
  )
}

export default OverviewView
