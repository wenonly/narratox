'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, GitBranch, Scroll } from 'lucide-react'

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

// 弧进度条:written/total 连续比例(替代旧的 5 离散点 BeatDots,
// 后者 Math.min(5, written) 把"5 拍单元循环"错实现成"已写章数封顶 5",
// 弧章数 >5 时 4/12 高亮 4 点 规律不明)。
const ArcProgress = ({ written, total }: { written: number; total: number }) => {
  const pct = total > 0 ? Math.round((written / total) * 100) : 0
  return (
    <div className="flex items-center gap-1.5">
      <div className="relative h-1 w-12 overflow-hidden rounded-full bg-overlay-10">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-accent-indigoLight"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-text-label">
        {written}/{total}
      </span>
    </div>
  )
}

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
  const isWritten = plan.status === 'WRITTEN'
  // Pencil: 已写/正在写 → accent-primary-soft + indigo 状态;其余 → bg-card-elevated + tertiary。
  const elevated = isCurrent || isWritten
  const statusLabel = isCurrent
    ? '● 正在写'
    : isWritten
      ? '✓ 已写'
      : plan.status === 'APPROVED'
        ? '○ 已确认'
        : '○ 细纲'
  return (
    <div
      className={cn(
        'rounded-sm border px-2 py-1.5',
        elevated
          ? 'border-overlay-15 bg-accent-primarySoft'
          : 'border-overlay-15 bg-bg-cardElevated'
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="truncate text-xs text-text-primary">
          第 {plan.chapterOrder} 章 · {plan.title || '无标题'}
        </span>
        <span
          className={cn(
            'shrink-0 text-[9px]',
            isCurrent || isWritten
              ? 'text-accent-indigoLight'
              : 'text-text-tertiary'
          )}
        >
          {statusLabel}
        </span>
      </button>
      {isOpen && (
        <div className="mt-1.5 space-y-1 border-t border-overlay-10 pt-1.5">
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
  return (
    <div className="rounded-md border-l-2 border-accent-indigoLight bg-overlay-5 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <GitBranch className="size-3 shrink-0 text-accent-indigoLight" />
          <span className="truncate text-sm font-semibold text-text-primary">
            {arc.title || `弧 ${arc.order}`}
          </span>
          <span className="shrink-0 rounded-full bg-overlay-10 px-1.5 py-px text-[10px] text-text-tertiary">
            第{arc.fromChapter}-{arc.toChapter}章
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <ArcProgress written={written} total={plans.length} />
        </div>
      </div>
      {arc.goal && (
        <p className="mt-1 text-xs leading-relaxed text-text-tertiary">
          {arc.goal}
        </p>
      )}
      {plans.length > 0 && (
        <div className="mt-1.5 space-y-1.5">
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

  // 弧线直接按 volumeId 归属(强关联,Phase 12 起 arc.volumeId 是真源)。
  // 不再用 fromChapter 范围启发式反推——后者会在弧越界时把别卷的章吞进来(bug)。
  const arcsForVolume = (volumeId: string | null): Arc[] =>
    data.arcs
      .filter((a) => (a.volumeId ?? null) === volumeId)
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
        <div className="rounded-md border border-overlay-15 bg-accent-primarySoft px-3 py-2.5">
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
          <div key={v.id} className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => toggleVolume(v.order)}
              className="flex items-center justify-between py-1 text-left"
            >
              <span className="flex items-center gap-1.5 truncate">
                {isOpen ? (
                  <ChevronDown className="size-3 shrink-0 text-text-tertiary" />
                ) : (
                  <ChevronRight className="size-3 shrink-0 text-text-tertiary" />
                )}
                <span
                  className={cn(
                    'truncate text-sm text-text-primary',
                    isOpen ? 'font-semibold' : 'font-medium'
                  )}
                >
                  {v.title}
                </span>
              </span>
              <span className="shrink-0 text-xs text-text-tertiary">
                {written}/{volPlans.length}
              </span>
            </button>
            {isOpen && (
              <>
                {(v.goal || v.bridge || v.mainProgress) && (
                  <div className="space-y-0.5 pl-5 text-xs leading-relaxed text-text-tertiary">
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
                  <p className="pl-5 text-xs text-text-tertiary">
                    本卷暂无细纲
                  </p>
                )}
              </>
            )}
          </div>
        )
      })}
      {/* 未挂卷的细纲 + 弧线 */}
      {(arcsForVolume(null).length > 0 ||
        orphanPlansForVolume(null).length > 0) && (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-1.5 py-1 text-sm font-medium text-text-primary">
            <ChevronRight className="size-3 text-text-tertiary" />
            未分卷
          </p>
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
      )}
    </div>
  )
}

export default OutlineView
