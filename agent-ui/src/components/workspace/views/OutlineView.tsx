'use client'

import { useEffect, useState } from 'react'
import { useStore } from '@/store'
import { getOutline } from '@/api/novels'
import type {
  ChapterOutline,
  Novel,
  OutlineData,
  OutlineNode
} from '@/types/novel'

export interface OutlineViewProps {
  novel: Novel
}

const NodeRow = ({ label, node }: { label: string; node: OutlineNode }) => (
  <div className="flex items-baseline gap-2 text-xs">
    <span className="w-8 shrink-0 text-muted">{label}</span>
    <span className="text-primary">
      {node.subject} <span className="text-muted">|</span> {node.action}{' '}
      <span className="text-muted">|</span> {node.target}
    </span>
  </div>
)

const ChapterPlanCard = ({
  plan,
  isOpen,
  onToggle,
  isCurrent,
  onJump
}: {
  plan: ChapterOutline
  isOpen: boolean
  onToggle: () => void
  isCurrent: boolean
  onJump: () => void
}) => {
  const statusLabel =
    plan.status === 'WRITTEN'
      ? '✓已写'
      : plan.status === 'APPROVED'
        ? '○已确认'
        : '○细纲'
  return (
    <div
      className={`rounded border px-2 py-1.5 ${
        isCurrent
          ? 'border-brand/50 bg-brand/10'
          : 'border-primary/10 bg-background'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-sm text-primary">
          第 {plan.chapterOrder} 章 · {plan.title || '无标题'}
        </span>
        <span className={`text-xs ${isCurrent ? 'text-brand' : 'text-muted'}`}>
          {isCurrent ? '●正在写' : statusLabel}
        </span>
      </button>
      {isOpen && (
        <div className="mt-2 space-y-1 border-t border-primary/10 pt-2">
          <NodeRow label="开篇" node={plan.cbn} />
          {plan.cpns.map((n, i) => (
            <NodeRow key={i} label={`情${i + 1}`} node={n} />
          ))}
          <NodeRow label="结尾" node={plan.cen} />
          {plan.mustCover.length > 0 && (
            <div className="pt-1 text-xs text-muted">
              ✓ 必须:{' '}
              <span className="text-primary">{plan.mustCover.join(' / ')}</span>
            </div>
          )}
          {plan.forbidden.length > 0 && (
            <div className="text-xs text-muted">
              ✗ 禁区:{' '}
              <span className="text-primary">{plan.forbidden.join(' / ')}</span>
            </div>
          )}
          <button
            type="button"
            onClick={onJump}
            className="text-xs text-brand hover:underline"
          >
            跳到该章正文 ›
          </button>
        </div>
      )}
    </div>
  )
}

const OutlineView = ({ novel }: OutlineViewProps) => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const writingChapterOrder = useStore((s) => s.writingChapterOrder)
  const setCurrentChapterOrder = useStore((s) => s.setCurrentChapterOrder)
  // 大纲写入序号:set_volume/set_chapter_plan 落库时 bump → 触发重新拉取。
  const outlineWriteSeq = useStore((s) => s.outlineWriteSeq)
  const [data, setData] = useState<OutlineData | null>(null)
  const [loading, setLoading] = useState(true)
  const [openOrder, setOpenOrder] = useState<number | null>(null)
  const [openVolumes, setOpenVolumes] = useState<Set<number>>(new Set())

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getOutline(endpoint, token, novel.id)
      .then((d) => {
        if (cancelled) return
        setData(d)
        if (d.volumes.length > 0) setOpenVolumes(new Set([d.volumes[0].order]))
      })
      .catch(() => {
        if (!cancelled) setData(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [endpoint, token, novel.id, outlineWriteSeq])

  // 写第 N 章时自动展开该章
  useEffect(() => {
    if (writingChapterOrder != null) setOpenOrder(writingChapterOrder)
  }, [writingChapterOrder])

  const toggleVolume = (order: number) => {
    setOpenVolumes((prev) => {
      const next = new Set(prev)
      if (next.has(order)) next.delete(order)
      else next.add(order)
      return next
    })
  }

  if (loading) return <p className="text-sm text-muted">加载大纲…</p>

  if (
    !data ||
    (data.volumes.length === 0 && data.chapterOutlines.length === 0)
  ) {
    return (
      <p className="text-sm text-muted">
        大纲尚未生成。在聊天里让 Agent 规划大纲(它会调 set_volume /
        set_chapter_plan),这里会显示卷与各章细纲节点。
      </p>
    )
  }

  const plansByVolume = (volumeId: string | null) =>
    data.chapterOutlines
      .filter((c) => (c.volumeId ?? null) === volumeId)
      .sort((a, b) => a.chapterOrder - b.chapterOrder)

  const jumpTo = (order: number) => setCurrentChapterOrder(order)

  return (
    <div className="space-y-3">
      {data.master && (
        <details className="rounded border border-brand/20 bg-brand/5 px-2 py-1.5">
          <summary className="cursor-pointer text-sm font-medium text-brand">
            📜 总纲(全书北极星)
          </summary>
          <div className="mt-2 space-y-1 text-xs text-muted">
            {data.master.theme && <p>故事核:{data.master.theme}</p>}
            {data.master.mainLine && <p>主线:{data.master.mainLine}</p>}
            {data.master.ending && <p>结局:{data.master.ending}</p>}
            {data.master.powerProgression?.length > 0 && (
              <p>
                力量进阶:
                {data.master.powerProgression
                  .map((p) => `卷${p.volume}:${p.level}`)
                  .join(' · ')}
              </p>
            )}
            {data.master.hiddenLines?.length > 0 && (
              <p>
                暗线:
                {data.master.hiddenLines
                  .map(
                    (h) => `${h.name}(埋${h.plant ?? '?'}→揭${h.reveal ?? '?'})`
                  )
                  .join(' / ')}
              </p>
            )}
            {data.master.volumeSplitLogic && (
              <p>卷划分:{data.master.volumeSplitLogic}</p>
            )}
            {data.master.threeAct &&
              (data.master.threeAct.act1Turn ||
                data.master.threeAct.act2Turn ||
                data.master.threeAct.act3Turn) && (
                <div className="space-y-0.5">
                  <p>三幕(大梁):</p>
                  {data.master.threeAct.act1Turn && (
                    <p className="pl-2">
                      ·一幕末(卷{data.master.threeAct.act1Turn.atVolume}):
                      {data.master.threeAct.act1Turn.beat}
                    </p>
                  )}
                  {data.master.threeAct.act2Turn && (
                    <p className="pl-2 text-brand">
                      ·二幕末·灵魂黑夜(卷
                      {data.master.threeAct.act2Turn.atVolume}):
                      {data.master.threeAct.act2Turn.beat}
                    </p>
                  )}
                  {data.master.threeAct.act3Turn && (
                    <p className="pl-2">
                      ·三幕末(卷{data.master.threeAct.act3Turn.atVolume}):
                      {data.master.threeAct.act3Turn.beat}
                    </p>
                  )}
                </div>
              )}
          </div>
        </details>
      )}
      {data.volumes.map((v) => {
        const plans = plansByVolume(v.id)
        const written = plans.filter((p) => p.status === 'WRITTEN').length
        const isOpen = openVolumes.has(v.order)
        return (
          <div key={v.id}>
            <button
              type="button"
              onClick={() => toggleVolume(v.order)}
              className="flex w-full items-center justify-between text-left"
            >
              <span className="text-sm font-medium text-primary">
                {isOpen ? '▼' : '▶'} {v.title}
              </span>
              <span className="text-xs text-muted">
                {written}/{plans.length}
              </span>
            </button>
            {isOpen && (
              <div className="mt-1 space-y-1.5 border-l border-primary/10 pl-2">
                {v.goal && <p className="text-xs text-muted">目标:{v.goal}</p>}
                {v.bridge && (
                  <p className="text-xs text-muted">承上启下:{v.bridge}</p>
                )}
                {v.mainProgress && (
                  <p className="text-xs text-muted">
                    主线推进:{v.mainProgress}
                  </p>
                )}
                {plans.map((p) => (
                  <ChapterPlanCard
                    key={p.id}
                    plan={p}
                    isOpen={openOrder === p.chapterOrder}
                    onToggle={() =>
                      setOpenOrder((cur) =>
                        cur === p.chapterOrder ? null : p.chapterOrder
                      )
                    }
                    isCurrent={writingChapterOrder === p.chapterOrder}
                    onJump={() => jumpTo(p.chapterOrder)}
                  />
                ))}
                {plans.length === 0 && (
                  <p className="text-xs text-muted">本卷暂无细纲</p>
                )}
              </div>
            )}
          </div>
        )
      })}
      {data.arcs.length > 0 && (
        <div>
          <p className="text-sm font-medium text-muted">弧线</p>
          <div className="mt-1 space-y-1 border-l border-primary/10 pl-2">
            {data.arcs
              .slice()
              .sort((a, b) => a.fromChapter - b.fromChapter)
              .map((a) => (
                <p key={a.id ?? a.order} className="text-xs text-muted">
                  🎬 {a.title} · 第{a.fromChapter}-{a.toChapter}章
                  {a.goal ? ` · ${a.goal}` : ''}
                  {a.summary ? ` · ${a.summary}` : ''}
                </p>
              ))}
          </div>
        </div>
      )}
      {/* 未挂卷的细纲 */}
      {plansByVolume(null).length > 0 && (
        <div>
          <p className="text-sm font-medium text-muted">未分卷</p>
          <div className="mt-1 space-y-1.5 border-l border-primary/10 pl-2">
            {plansByVolume(null).map((p) => (
              <ChapterPlanCard
                key={p.id}
                plan={p}
                isOpen={openOrder === p.chapterOrder}
                onToggle={() =>
                  setOpenOrder((cur) =>
                    cur === p.chapterOrder ? null : p.chapterOrder
                  )
                }
                isCurrent={writingChapterOrder === p.chapterOrder}
                onJump={() => jumpTo(p.chapterOrder)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default OutlineView
