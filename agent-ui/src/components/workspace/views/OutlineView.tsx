'use client'

import { useEffect, useState } from 'react'
import { GitBranch, Scroll } from 'lucide-react'

import { useStore } from '@/store'
import { getOutline } from '@/api/novels'
import type {
  Arc,
  ChapterOutline,
  Novel,
  OutlineData,
  OutlineNode
} from '@/types/novel'
import { cn } from '@/lib/utils'

export interface OutlineViewProps {
  novel: Novel
}

const NodeRow = ({ label, node }: { label: string; node: OutlineNode }) => (
  <div className="flex items-baseline gap-2 text-xs">
    <span className="w-8 shrink-0 text-text-tertiary">{label}</span>
    <span className="text-text-secondary">
      {node.subject} <span className="text-text-label">|</span> {node.action}{' '}
      <span className="text-text-label">|</span> {node.target}
    </span>
  </div>
)

// 5 拍进度点(单元循环:麻烦→尝试→意外→解决→成长)。done = 已写章节数(封顶 5)。
const BeatDots = ({ done }: { done: number }) => (
  <div className="flex items-center gap-1">
    {Array.from({ length: 5 }).map((_, i) => (
      <span
        key={i}
        className={cn(
          'size-1.5 rounded-full',
          i < done ? 'bg-accent-indigoLight' : 'bg-overlay-10'
        )}
      />
    ))}
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
      className={cn(
        'rounded-md border px-2.5 py-1.5',
        isCurrent
          ? 'border-accent-indigoLight bg-accent-primarySoft'
          : 'border-overlay-15 bg-bg-cardElevated'
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="truncate text-sm text-text-primary">
          第 {plan.chapterOrder} 章 · {plan.title || '无标题'}
        </span>
        <span
          className={cn(
            'ml-2 shrink-0 text-xs',
            isCurrent ? 'text-accent-indigoLight' : 'text-text-tertiary'
          )}
        >
          {isCurrent ? '●正在写' : statusLabel}
        </span>
      </button>
      {isOpen && (
        <div className="mt-2 space-y-1 border-t border-overlay-10 pt-2">
          <NodeRow label="开篇" node={plan.cbn} />
          {plan.cpns.map((n, i) => (
            <NodeRow key={i} label={`情${i + 1}`} node={n} />
          ))}
          <NodeRow label="结尾" node={plan.cen} />
          {plan.mustCover.length > 0 && (
            <div className="pt-1 text-xs text-text-tertiary">
              ✓ 必须:{' '}
              <span className="text-text-secondary">
                {plan.mustCover.join(' / ')}
              </span>
            </div>
          )}
          {plan.forbidden.length > 0 && (
            <div className="text-xs text-text-tertiary">
              ✗ 禁区:{' '}
              <span className="text-text-secondary">
                {plan.forbidden.join(' / ')}
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={onJump}
            className="text-xs text-accent-indigoLight hover:underline"
          >
            跳到该章正文 ›
          </button>
        </div>
      )}
    </div>
  )
}

// 弧线卡:左 indigo 边 + 范围 pill + 5 拍进度点 + goal + 章细纲内嵌。
const ArcCard = ({
  arc,
  plans,
  openOrder,
  onTogglePlan,
  writingChapterOrder,
  onJump
}: {
  arc: Arc
  plans: ChapterOutline[]
  openOrder: number | null
  onTogglePlan: (order: number) => void
  writingChapterOrder: number | null
  onJump: (order: number) => void
}) => {
  const written = plans.filter((p) => p.status === 'WRITTEN').length
  const beats = Math.min(5, written)
  return (
    <div className="rounded-md border-l-2 border-accent-indigoLight bg-overlay-5 p-3">
      <div className="flex items-center gap-2">
        <GitBranch className="size-3.5 shrink-0 text-accent-indigoLight" />
        <span className="truncate text-sm font-medium text-text-primary">
          {arc.title || `弧 ${arc.order}`}
        </span>
        <span className="ml-auto shrink-0 rounded-full bg-overlay-10 px-1.5 py-0.5 text-[10px] text-text-tertiary">
          第{arc.fromChapter}-{arc.toChapter}章
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <BeatDots done={beats} />
        <span className="text-[10px] text-text-label">
          {written}/{plans.length} 章
        </span>
      </div>
      {arc.goal && (
        <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">
          {arc.goal}
        </p>
      )}
      {plans.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {plans.map((p) => (
            <ChapterPlanCard
              key={p.id}
              plan={p}
              isOpen={openOrder === p.chapterOrder}
              onToggle={() => onTogglePlan(p.chapterOrder)}
              isCurrent={writingChapterOrder === p.chapterOrder}
              onJump={() => onJump(p.chapterOrder)}
            />
          ))}
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
  const togglePlan = (order: number) =>
    setOpenOrder((cur) => (cur === order ? null : order))

  if (loading) return <p className="text-sm text-text-tertiary">加载大纲…</p>

  if (
    !data ||
    (data.volumes.length === 0 && data.chapterOutlines.length === 0)
  ) {
    return (
      <p className="text-sm text-text-tertiary">
        大纲尚未生成。在聊天里让 Agent 规划大纲(它会调 set_volume /
        set_chapter_plan),这里会显示卷与各章细纲节点。
      </p>
    )
  }

  // 弧线按 fromChapter 升序;落入某弧的细纲 = chapterOrder ∈ [from, to]。
  const arcsForVolume = (volumeId: string | null): Arc[] =>
    data.arcs
      .filter((a) => {
        // Arc 没有 volumeId,所以按章节范围归到包含该范围的卷。
        // 这里用「弧的起始章落在哪卷」判定:把卷的细纲章节范围算出来。
        const volPlans = data.chapterOutlines.filter(
          (c) => (c.volumeId ?? null) === volumeId
        )
        if (volPlans.length === 0) return false
        const volMin = Math.min(...volPlans.map((p) => p.chapterOrder))
        const volMax = Math.max(...volPlans.map((p) => p.chapterOrder))
        return a.fromChapter >= volMin && a.fromChapter <= volMax
      })
      .slice()
      .sort((a, b) => a.fromChapter - b.fromChapter)

  const plansForArc = (arc: Arc): ChapterOutline[] =>
    data.chapterOutlines
      .filter(
        (p) =>
          p.chapterOrder >= arc.fromChapter && p.chapterOrder <= arc.toChapter
      )
      .sort((a, b) => a.chapterOrder - b.chapterOrder)

  const plansByVolume = (volumeId: string | null) =>
    data.chapterOutlines
      .filter((c) => (c.volumeId ?? null) === volumeId)
      .sort((a, b) => a.chapterOrder - b.chapterOrder)

  // 不属于任何弧的细纲(直接挂卷下)。
  const orphanPlansForVolume = (volumeId: string | null): ChapterOutline[] => {
    const arcs = arcsForVolume(volumeId)
    const covered = new Set<number>()
    for (const a of arcs)
      for (const p of plansForArc(a)) covered.add(p.chapterOrder)
    return plansByVolume(volumeId).filter((p) => !covered.has(p.chapterOrder))
  }

  const jumpTo = (order: number) => setCurrentChapterOrder(order)

  return (
    <div className="space-y-3">
      {data.master && (
        <div className="rounded-md border border-overlay-15 bg-accent-primarySoft p-3">
          <div className="flex items-center gap-1.5">
            <Scroll className="size-3.5 text-accent-indigoLight" />
            <span className="text-sm font-semibold text-accent-indigoLight">
              总纲 · 全书北极星
            </span>
          </div>
          <div className="mt-1.5 space-y-0.5 text-xs leading-relaxed text-text-secondary">
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
            {data.master.threeAct &&
              (data.master.threeAct.act1Turn ||
                data.master.threeAct.act2Turn ||
                data.master.threeAct.act3Turn) && (
                <div className="space-y-0.5 pt-0.5">
                  <p>三幕(大梁):</p>
                  {data.master.threeAct.act1Turn && (
                    <p className="pl-2">
                      ·一幕末(卷{data.master.threeAct.act1Turn.atVolume}):
                      {data.master.threeAct.act1Turn.beat}
                    </p>
                  )}
                  {data.master.threeAct.act2Turn && (
                    <p className="pl-2 text-accent-indigoLight">
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
        </div>
      )}
      {data.volumes.map((v) => {
        const volPlans = plansByVolume(v.id)
        const written = volPlans.filter((p) => p.status === 'WRITTEN').length
        const isOpen = openVolumes.has(v.order)
        const arcs = arcsForVolume(v.id)
        const orphans = orphanPlansForVolume(v.id)
        return (
          <div key={v.id} className="rounded-md border border-overlay-15">
            <button
              type="button"
              onClick={() => toggleVolume(v.order)}
              className="flex w-full items-center justify-between px-3 py-2 text-left"
            >
              <span className="truncate text-sm font-medium text-text-primary">
                {isOpen ? '▾' : '▸'} {v.title}
              </span>
              <span className="shrink-0 text-xs text-text-tertiary">
                {written}/{volPlans.length} 章
              </span>
            </button>
            {isOpen && (
              <div className="space-y-2 border-t border-overlay-10 px-3 py-2.5">
                {(v.goal || v.bridge || v.mainProgress) && (
                  <div className="space-y-0.5 text-xs leading-relaxed text-text-tertiary">
                    {v.goal && <p>目标:{v.goal}</p>}
                    {v.bridge && <p>承上启下:{v.bridge}</p>}
                    {v.mainProgress && <p>主线推进:{v.mainProgress}</p>}
                  </div>
                )}
                {arcs.map((a) => (
                  <ArcCard
                    key={a.id ?? a.order}
                    arc={a}
                    plans={plansForArc(a)}
                    openOrder={openOrder}
                    onTogglePlan={togglePlan}
                    writingChapterOrder={writingChapterOrder}
                    onJump={jumpTo}
                  />
                ))}
                {orphans.length > 0 && (
                  <div className="space-y-1.5">
                    {orphans.map((p) => (
                      <ChapterPlanCard
                        key={p.id}
                        plan={p}
                        isOpen={openOrder === p.chapterOrder}
                        onToggle={() => togglePlan(p.chapterOrder)}
                        isCurrent={writingChapterOrder === p.chapterOrder}
                        onJump={() => jumpTo(p.chapterOrder)}
                      />
                    ))}
                  </div>
                )}
                {volPlans.length === 0 && (
                  <p className="text-xs text-text-tertiary">本卷暂无细纲</p>
                )}
              </div>
            )}
          </div>
        )
      })}
      {/* 未挂卷的细纲 + 弧线 */}
      {plansByVolume(null).length > 0 && (
        <div className="rounded-md border border-overlay-15">
          <p className="px-3 py-2 text-sm font-medium text-text-primary">
            未分卷
          </p>
          <div className="space-y-2 border-t border-overlay-10 px-3 py-2.5">
            {arcsForVolume(null).map((a) => (
              <ArcCard
                key={a.id ?? a.order}
                arc={a}
                plans={plansForArc(a)}
                openOrder={openOrder}
                onTogglePlan={togglePlan}
                writingChapterOrder={writingChapterOrder}
                onJump={jumpTo}
              />
            ))}
            {orphanPlansForVolume(null).map((p) => (
              <ChapterPlanCard
                key={p.id}
                plan={p}
                isOpen={openOrder === p.chapterOrder}
                onToggle={() => togglePlan(p.chapterOrder)}
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
