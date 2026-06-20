'use client'

import { useEffect, useState } from 'react'
import { useStore } from '@/store'
import { getOutline, getWorldview } from '@/api/novels'
import type {
  ChapterOutline,
  Novel,
  OutlineData,
  OutlineNode,
  WorldEntry,
  WorldEntryType
} from '@/types/novel'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'

type ResourceKey =
  | 'outline'
  | 'chapters'
  | 'characters'
  | 'worldview'
  | 'status'
  | 'info'

interface Props {
  resource: ResourceKey
  novel: Novel
  onClose: () => void
  onSaved: () => void
}

const TITLES: Record<ResourceKey, string> = {
  outline: '大纲',
  chapters: '正文',
  characters: '角色',
  worldview: '世界观',
  status: '状态',
  info: '小说信息'
}

const ResourcePanel = ({ resource, novel, onClose }: Props) => {
  const writingChapterOrder = useStore((s) => s.writingChapterOrder)

  return (
    <section className="flex w-[420px] shrink-0 flex-col overflow-hidden border-l border-primary/10 bg-background">
      <header className="flex items-center justify-between px-4 py-3">
        <h2 className="text-sm font-semibold text-primary">
          {TITLES[resource]}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-lg leading-none text-muted hover:text-primary"
        >
          ×
        </button>
      </header>
      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {resource === 'chapters' && (
          <ChaptersView
            novel={novel}
            writingChapterOrder={writingChapterOrder}
          />
        )}
        {resource === 'outline' && <OutlineView novel={novel} />}
        {resource === 'worldview' && <WorldView novel={novel} />}
        {resource === 'info' && <InfoView novel={novel} />}
        {resource !== 'chapters' &&
          resource !== 'info' &&
          resource !== 'outline' &&
          resource !== 'worldview' && (
            <div className="flex h-full items-center justify-center text-sm text-muted">
              {TITLES[resource]} · 即将推出
            </div>
          )}
      </div>
    </section>
  )
}

const ChaptersView = ({
  novel,
  writingChapterOrder
}: {
  novel: Novel
  writingChapterOrder: number | null
}) => {
  const currentChapterOrder = useStore((s) => s.currentChapterOrder)
  const setCurrentChapterOrder = useStore((s) => s.setCurrentChapterOrder)
  const manualLock = useStore((s) => s.manualLock)
  const setManualLock = useStore((s) => s.setManualLock)
  const [tocOpen, setTocOpen] = useState(false)

  const sorted = [...novel.chapters].sort((a, b) => a.order - b.order)
  const idx = sorted.findIndex((c) => c.order === currentChapterOrder)
  const chapter = idx >= 0 ? sorted[idx] : undefined
  const prevOrder = idx > 0 ? sorted[idx - 1].order : null
  const nextOrder =
    idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1].order : null

  const goTo = (order: number) => {
    setCurrentChapterOrder(order)
    setManualLock(true)
    setTocOpen(false)
  }

  // CONCEPT / 无章
  if (currentChapterOrder == null || !chapter) {
    return (
      <p className="text-sm text-muted">
        {novel.status === 'CONCEPT'
          ? '立项中,信息收集完成后开始写作。'
          : '本章还没有内容。'}
      </p>
    )
  }

  const isWritingThis =
    writingChapterOrder !== null && writingChapterOrder === currentChapterOrder
  const showSkeleton = isWritingThis && !chapter.content
  const showPill =
    manualLock &&
    writingChapterOrder !== null &&
    writingChapterOrder !== currentChapterOrder

  return (
    <div className="space-y-3">
      {/* 翻页头 + 目录触发 */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          disabled={prevOrder == null}
          onClick={() => prevOrder != null && goTo(prevOrder)}
          className="px-2 text-muted hover:text-primary disabled:opacity-30"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={() => setTocOpen((v) => !v)}
          className="flex-1 text-center text-sm font-medium text-primary hover:text-brand"
        >
          第 {chapter.order} 章 · {chapter.title || '无标题'}
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={nextOrder == null}
            onClick={() => nextOrder != null && goTo(nextOrder)}
            className="px-2 text-muted hover:text-primary disabled:opacity-30"
          >
            ›
          </button>
          <button
            type="button"
            onClick={() => setTocOpen((v) => !v)}
            className="px-1 text-muted hover:text-primary"
            title="目录"
          >
            ☰
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="rounded bg-accent px-1.5 py-0.5">
          {chapter.status === 'COMMITTED' ? '已写入' : '草稿'}
        </span>
        <span>{chapter.content.length} 字</span>
      </div>

      {tocOpen && (
        <ChapterToc
          sorted={sorted}
          currentOrder={currentChapterOrder}
          writingOrder={writingChapterOrder}
          onPick={goTo}
        />
      )}
      {showPill && (
        <WritingPill
          order={writingChapterOrder as number}
          onJump={() => {
            setCurrentChapterOrder(writingChapterOrder as number)
            setManualLock(false)
          }}
        />
      )}

      {showSkeleton ? (
        <div className="space-y-2">
          <p className="text-xs text-muted">
            第 {currentChapterOrder} 章 · AI 写作中…
          </p>
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-4 animate-pulse rounded bg-accent"
              style={{ width: `${70 + ((i * 7) % 30)}%` }}
            />
          ))}
        </div>
      ) : chapter.content ? (
        <article className="prose prose-invert max-w-none text-sm">
          <MarkdownRenderer>{chapter.content}</MarkdownRenderer>
        </article>
      ) : (
        <p className="text-sm text-muted">本章还没有内容。</p>
      )}
    </div>
  )
}

const ChapterToc = ({
  sorted,
  currentOrder,
  writingOrder,
  onPick
}: {
  sorted: Array<{
    order: number
    title: string
    status: string
    content: string
  }>
  currentOrder: number
  writingOrder: number | null
  onPick: (order: number) => void
}) => (
  <div className="max-h-64 overflow-y-auto rounded border border-primary/10 bg-background">
    {sorted.map((c) => {
      const isCurrent = c.order === currentOrder
      const isWriting = writingOrder === c.order
      return (
        <button
          key={c.order}
          type="button"
          onClick={() => onPick(c.order)}
          className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent ${
            isCurrent ? 'text-primary' : 'text-muted'
          } ${isWriting ? 'text-brand' : ''}`}
        >
          <span>
            第 {c.order} 章 · {c.title || '无标题'}
          </span>
          <span className="text-xs">
            {isWriting ? '写作中' : isCurrent ? '在读' : ''}
          </span>
        </button>
      )
    })}
  </div>
)

const WritingPill = ({
  order,
  onJump
}: {
  order: number
  onJump: () => void
}) => (
  <button
    type="button"
    onClick={onJump}
    className="flex w-full items-center justify-between rounded border border-brand/40 bg-brand/10 px-3 py-2 text-sm text-brand hover:bg-brand/20"
  >
    <span>✍ AI 正写第 {order} 章</span>
    <span>跳转 ›</span>
  </button>
)

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

const WorldView = ({ novel }: { novel: Novel }) => {
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

const OutlineView = ({ novel }: { novel: Novel }) => {
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

const InfoView = ({ novel }: { novel: Novel }) => {
  const settings = novel.settings as {
    style?: string
    coreConflict?: string
    chapterWordTarget?: number
  } | null
  const rows = [
    { label: '书名', value: novel.title },
    { label: '类型', value: novel.genre || '—' },
    { label: '简介', value: novel.synopsis || '—' },
    { label: '核心冲突', value: settings?.coreConflict || '—' },
    {
      label: '每章字数目标',
      value: settings?.chapterWordTarget
        ? `${settings.chapterWordTarget} 字`
        : '—'
    },
    { label: '文风', value: settings?.style || '—' }
  ]
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="text-xs uppercase text-muted">{r.label}</div>
          <div className="text-sm text-primary">{r.value}</div>
        </div>
      ))}
      <div className="pt-2 text-xs text-muted/50">
        信息卡 · 由 Agent 通过 update_novel 自动填充
      </div>
    </div>
  )
}

export default ResourcePanel
