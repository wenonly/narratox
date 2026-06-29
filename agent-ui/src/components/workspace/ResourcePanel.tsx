'use client'

import { useEffect, useState } from 'react'
import { useStore } from '@/store'
import {
  getOutline,
  getWorldview,
  getHooks,
  getCharacters,
  getEvents,
  getStatus
} from '@/api/novels'
import type {
  ChapterOutline,
  Character,
  CharacterRole,
  Novel,
  OutlineData,
  OutlineNode,
  StoryEventHook,
  HookPayoffTiming,
  WorldEntry,
  WorldEntryType,
  EventTimelineItem,
  NovelStatus
} from '@/types/novel'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'
import { ReferencesView } from './ReferencesView'
import VoiceProfileView from './VoiceProfileView'

type ResourceKey =
  | 'outline'
  | 'chapters'
  | 'characters'
  | 'worldview'
  | 'references'
  | 'status'
  | 'info'
  | 'voiceProfile'
  | 'events'
  | 'overview'

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
  references: '参考资料',
  status: '状态',
  info: '小说信息',
  voiceProfile: '作者画像',
  events: '事件时间线',
  overview: '态势'
}

const ResourcePanel = ({ resource, novel, onClose, onSaved }: Props) => {
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
        {resource === 'references' && <ReferencesView novel={novel} />}
        {resource === 'status' && <HooksView novel={novel} />}
        {resource === 'events' && <EventsView novel={novel} />}
        {resource === 'overview' && <OverviewView novel={novel} />}
        {resource === 'characters' && <CharactersView novel={novel} />}
        {resource === 'info' && <InfoView novel={novel} />}
        {resource === 'voiceProfile' && (
          <VoiceProfileView novel={novel} onSaved={onSaved} />
        )}
        {resource !== 'chapters' &&
          resource !== 'info' &&
          resource !== 'outline' &&
          resource !== 'worldview' &&
          resource !== 'references' &&
          resource !== 'status' &&
          resource !== 'characters' &&
          resource !== 'voiceProfile' &&
          resource !== 'events' &&
          resource !== 'overview' && (
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

const TIMING_LABEL: Record<HookPayoffTiming, string> = {
  IMMEDIATE: '即时',
  NEAR_TERM: '近期',
  MID_ARC: '本卷',
  SLOW_BURN: '慢热',
  ENDGAME: '终局'
}

const HookCard = ({ hook }: { hook: StoryEventHook }) => {
  const isResolved = hook.status === 'RESOLVED'
  return (
    <div
      className={`rounded border px-2 py-1.5 ${
        isResolved
          ? 'border-primary/5 opacity-50'
          : hook.stale
            ? 'border-brand/40 bg-brand/5'
            : hook.coreHook
              ? 'border-brand/20 bg-brand/5'
              : 'border-primary/10 bg-background'
      }`}
    >
      <div className="flex items-center justify-between">
        <span
          className={`text-sm ${isResolved ? 'text-muted line-through' : 'text-primary'}`}
        >
          {hook.coreHook && <span className="text-brand">★ </span>}
          {hook.description}
        </span>
        <span className="flex gap-1 text-xs text-muted">
          <span className="rounded bg-accent px-1">
            {TIMING_LABEL[hook.payoffTiming]}
          </span>
          {hook.stale && <span className="text-brand">⚠️陈旧</span>}
          {isResolved && <span>✓已回收</span>}
        </span>
      </div>
      <div className="mt-1 text-xs text-muted/60">
        始于第{hook.openedAtChapter ?? '?'}章
        {hook.advancedCount > 0 && ` · 推进${hook.advancedCount}次`}
        {hook.resolvedAtChapter && ` · 回收于第${hook.resolvedAtChapter}章`}
        {hook.unmetDeps.length > 0 && ` · 依赖${hook.unmetDeps.length}个未回收`}
      </div>
    </div>
  )
}

const ROLE_LABEL: Record<CharacterRole, string> = {
  PROTAGONIST: '主角',
  ANTAGONIST: '反派',
  SUPPORTING: '配角'
}

const FIELD_LABEL: Record<string, string> = {
  personality: '性格',
  emotion: '情绪',
  ability: '能力',
  status: '状态',
  appearance: '出场',
  knowledge: '认知',
  background: '背景',
  other: '其他'
}

// char-writer 建的稳定身份字段(Phase 5)。long=true 用 MarkdownRenderer 渲染(外貌/弧光/背景可能成段)。
const PROFILE_FIELDS: Array<{
  key:
    | 'appearance'
    | 'personality'
    | 'motivation'
    | 'arcGoal'
    | 'voice'
    | 'faction'
    | 'background'
    | 'growth'
    | 'flaw'
  label: string
  long?: boolean
}> = [
  { key: 'background', label: '出身/背景', long: true },
  { key: 'growth', label: '成长经历', long: true },
  { key: 'appearance', label: '外貌', long: true },
  { key: 'personality', label: '性格基调' },
  { key: 'motivation', label: '执念/动机' },
  { key: 'flaw', label: '弱点', long: true },
  { key: 'arcGoal', label: '弧光目标', long: true },
  { key: 'voice', label: '语言风格' },
  { key: 'faction', label: '阵营' }
]

const CharactersView = ({ novel }: { novel: Novel }) => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const characterWriteSeq = useStore((s) => s.characterWriteSeq)
  const [chars, setChars] = useState<Character[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [openName, setOpenName] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getCharacters(endpoint, token, novel.id)
      .then((d) => {
        if (!cancelled) setChars(d)
      })
      .catch(() => {
        if (!cancelled) setChars(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [endpoint, token, novel.id, characterWriteSeq])

  if (loading) return <p className="text-sm text-muted">加载角色…</p>
  if (!chars || chars.length === 0) {
    return (
      <p className="text-sm text-muted">
        角色尚未建立。在聊天里让 Agent 建角色(set_character)或直接开始写作
        ——settler 会自动追踪角色变化(性格/能力/关系/情绪),形成成长时间线。
      </p>
    )
  }

  const byRole = (role: CharacterRole) => chars.filter((c) => c.role === role)

  return (
    <div className="space-y-3">
      {(['PROTAGONIST', 'ANTAGONIST', 'SUPPORTING'] as CharacterRole[]).map(
        (role) => {
          const items = byRole(role)
          if (items.length === 0) return null
          return (
            <div key={role}>
              <p className="text-xs uppercase text-muted">
                {ROLE_LABEL[role]} · {items.length}
              </p>
              <div className="mt-1 space-y-1.5">
                {items.map((c) => {
                  const isOpen = openName === c.name
                  const stateEntries = Object.entries(c.currentState).filter(
                    ([f]) => f !== 'appearance'
                  )
                  const essence = [
                    c.personality && `性格基调:${c.personality}`,
                    c.motivation && `动机:${c.motivation}`
                  ].filter(Boolean)
                  return (
                    <div
                      key={c.id}
                      className="rounded border border-primary/10 bg-background px-2 py-1.5"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setOpenName((cur) => (cur === c.name ? null : c.name))
                        }
                        className="flex w-full items-center justify-between text-left"
                      >
                        <span className="text-sm text-primary">{c.name}</span>
                        <span className="text-xs text-muted">
                          {c.aliases.length > 0 && `${c.aliases.join('/')} · `}
                          {isOpen ? '▼' : '▶'}
                        </span>
                      </button>
                      {/* 折叠态:essence 一行(身份速览) */}
                      {!isOpen && essence.length > 0 && (
                        <p className="mt-1 text-xs text-muted">
                          {essence.join(' · ')}
                        </p>
                      )}
                      {isOpen && (
                        <div className="mt-2 space-y-2 border-t border-primary/10 pt-2">
                          {/* 完整档案(char-writer 建的稳定身份) */}
                          {PROFILE_FIELDS.some((f) => c[f.key]) ? (
                            <div className="space-y-1">
                              <p className="text-xs uppercase text-muted/70">
                                档案
                              </p>
                              {PROFILE_FIELDS.map((f) => {
                                const val = c[f.key]
                                if (!val) return null
                                return f.long ? (
                                  <div key={f.key} className="text-xs">
                                    <span className="text-primary/70">
                                      {f.label}
                                    </span>
                                    <div className="prose prose-invert max-w-none pt-0.5 text-primary">
                                      <MarkdownRenderer>{val}</MarkdownRenderer>
                                    </div>
                                  </div>
                                ) : (
                                  <p key={f.key} className="text-xs">
                                    <span className="text-primary/70">
                                      {f.label}:
                                    </span>{' '}
                                    <span className="text-primary">{val}</span>
                                  </p>
                                )
                              })}
                            </div>
                          ) : (
                            <p className="text-xs text-muted/50">
                              档案尚未建立(char-writer 建档后显示)
                            </p>
                          )}
                          {/* 当前态(派生) */}
                          {stateEntries.length > 0 && (
                            <div className="space-y-0.5">
                              <p className="text-xs uppercase text-muted/70">
                                当前态
                              </p>
                              {stateEntries.map(([field, s]) => (
                                <p key={field} className="text-xs text-muted">
                                  <span className="text-primary/70">
                                    {FIELD_LABEL[field] ?? field}
                                  </span>
                                  :{s.value}
                                  <span className="text-muted/50">
                                    {' '}
                                    (第{s.chapterOrder}章)
                                  </span>
                                </p>
                              ))}
                            </div>
                          )}
                          {/* 变化时间线 */}
                          <div className="space-y-0.5">
                            <p className="text-xs uppercase text-muted/70">
                              变化时间线
                            </p>
                            {c.changes.length === 0 ? (
                              <p className="text-xs text-muted">暂无变化记录</p>
                            ) : (
                              c.changes
                                .slice()
                                .reverse()
                                .map((ch, i) => (
                                  <div key={i} className="text-xs">
                                    <span className="text-muted/50">
                                      第{ch.chapterOrder}章
                                    </span>{' '}
                                    {ch.significance === 'MAJOR' && (
                                      <span className="text-brand">★</span>
                                    )}{' '}
                                    <span className="text-primary/70">
                                      {FIELD_LABEL[ch.field] ??
                                        ch.field.split(':')[0]}
                                    </span>
                                    :
                                    <span className="text-primary">
                                      {ch.value}
                                    </span>
                                    {ch.reason && (
                                      <span className="text-muted/50">
                                        {' '}
                                        ({ch.reason})
                                      </span>
                                    )}
                                  </div>
                                ))
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        }
      )}
    </div>
  )
}

const HooksView = ({ novel }: { novel: Novel }) => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const hookWriteSeq = useStore((s) => s.hookWriteSeq)
  const [hooks, setHooks] = useState<StoryEventHook[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getHooks(endpoint, token, novel.id)
      .then((d) => {
        if (!cancelled) setHooks(d)
      })
      .catch(() => {
        if (!cancelled) setHooks(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [endpoint, token, novel.id, hookWriteSeq])

  if (loading) return <p className="text-sm text-muted">加载伏笔…</p>
  if (!hooks || hooks.length === 0) {
    return (
      <p className="text-sm text-muted">
        伏笔将在写作时由 settler 自动提取(埋下/推进/回收),带 payoffTiming
        与核心标记。 这里会显示完整伏笔账本 + 陈旧告警。
      </p>
    )
  }

  const core = hooks.filter((h) => h.coreHook && h.status !== 'RESOLVED')
  const stale = hooks.filter((h) => h.stale && !h.coreHook)
  const active = hooks.filter(
    (h) => !h.coreHook && !h.stale && h.status !== 'RESOLVED'
  )
  const resolved = hooks.filter((h) => h.status === 'RESOLVED')

  return (
    <div className="space-y-3">
      {core.length > 0 && (
        <div>
          <p className="text-xs uppercase text-brand">
            ★ 核心伏笔 · {core.length}
          </p>
          <div className="mt-1 space-y-1.5">
            {core.map((h) => (
              <HookCard key={h.id} hook={h} />
            ))}
          </div>
        </div>
      )}
      {stale.length > 0 && (
        <div>
          <p className="text-xs uppercase text-brand">
            ⚠️ 陈久未推进 · {stale.length}
          </p>
          <div className="mt-1 space-y-1.5">
            {stale.map((h) => (
              <HookCard key={h.id} hook={h} />
            ))}
          </div>
        </div>
      )}
      {active.length > 0 && (
        <div>
          <p className="text-xs uppercase text-muted">
            进行中 · {active.length}
          </p>
          <div className="mt-1 space-y-1.5">
            {active.map((h) => (
              <HookCard key={h.id} hook={h} />
            ))}
          </div>
        </div>
      )}
      {resolved.length > 0 && (
        <div>
          <p className="text-xs uppercase text-muted/50">
            已回收 · {resolved.length}
          </p>
          <div className="mt-1 space-y-1.5">
            {resolved.map((h) => (
              <HookCard key={h.id} hook={h} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const NEXT_STEP_LABEL: Record<string, string> = {
  collect_basics: '收集基础信息',
  build_world: '建世界观',
  plan_outline: '规划大纲',
  build_characters: '建角色档案',
  plan_more: '补细纲',
  write_next: '写下一章'
}

const OverviewView = ({ novel }: { novel: Novel }) => {
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

  if (loading) return <p className="text-sm text-muted">加载态势…</p>
  if (!status) return <p className="text-sm text-muted">暂无态势数据。</p>

  const ob = status.onboarding
  const basicsAll = Object.values(ob.basics).every(Boolean)
  const Check = ({ ok, label }: { ok: boolean; label: string }) => (
    <span className={ok ? 'text-primary' : 'text-brand'}>
      {ok ? '✓' : '✗'}
      {label}{' '}
    </span>
  )

  return (
    <div className="space-y-3 text-sm">
      <div className="rounded-md border border-primary/10 bg-background-secondary px-3 py-2">
        <p className="text-xs uppercase text-muted">进度</p>
        <p className="mt-1 text-primary">
          {status.totalWords} 字 · {status.chapterCount} 章 · frontier 第{' '}
          {status.frontierChapter} 章
          {status.coverage.targetChapters
            ? ` · 目标 ${status.coverage.targetChapters} 章`
            : ''}
        </p>
        {status.currentVolume && (
          <p className="text-xs text-muted">
            当前:卷《{status.currentVolume.title}》
            {status.currentArc
              ? ` · 弧${status.currentArc.order}「${status.currentArc.title}」(第${status.currentArc.fromChapter}-${status.currentArc.toChapter}章)`
              : ''}
          </p>
        )}
      </div>

      <div className="rounded-md border border-primary/10 px-3 py-2">
        <p className="text-xs uppercase text-muted">
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

      <div className="rounded-md border border-primary/10 px-3 py-2">
        <p className="text-xs uppercase text-muted">大纲覆盖</p>
        <p className="mt-1 text-xs text-muted">
          {status.coverage.volumes} 卷 / {status.coverage.arcs} 弧 · 细纲已规划{' '}
          {status.coverage.plannedChapters} 章 · 距 frontier 剩{' '}
          {status.coverage.plannedRemaining} 章可写
        </p>
      </div>

      <div className="rounded-md border border-primary/10 px-3 py-2">
        <p className="text-xs uppercase text-muted">健康</p>
        <p className="mt-1 text-xs text-muted">
          开放伏笔 {status.health.openHooks}
          {status.health.staleHooks
            ? `(⚠️陈久 ${status.health.staleHooks})`
            : ''}{' '}
          · MAJOR 事件 {status.health.majorEvents}
        </p>
      </div>

      <div className="rounded-md border border-brand/40 bg-brand/5 px-3 py-2">
        <p className="text-xs uppercase text-brand">
          下一步 · {status.recentPhase ? `近期:${status.recentPhase} · ` : ''}
          {NEXT_STEP_LABEL[status.nextStep] ?? status.nextStep}
        </p>
      </div>
    </div>
  )
}

const EventsView = ({ novel }: { novel: Novel }) => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  // 事件由 settler 经 write_summary 写,与伏笔同源 → 复用 hookWriteSeq 刷新。
  const hookWriteSeq = useStore((s) => s.hookWriteSeq)
  const [events, setEvents] = useState<EventTimelineItem[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getEvents(endpoint, token, novel.id)
      .then((d) => {
        if (!cancelled) setEvents(d)
      })
      .catch(() => {
        if (!cancelled) setEvents(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [endpoint, token, novel.id, hookWriteSeq])

  if (loading) return <p className="text-sm text-muted">加载事件…</p>
  if (!events || events.length === 0) {
    return (
      <p className="text-sm text-muted">
        事件由 settler 每章自动提取(剧情转折/揭示/冲突 = MAJOR,次要推进 =
        MINOR)。区别于伏笔:事件是「发生了什么」的事实点,伏笔是「待回收」的承诺线。这里显示全书事件时间线。
      </p>
    )
  }

  // 按 chapterOrder 分组(升序),组内 MAJOR 在前。
  const byChapter = new Map<number, EventTimelineItem[]>()
  for (const e of events) {
    const arr = byChapter.get(e.chapterOrder) ?? []
    arr.push(e)
    byChapter.set(e.chapterOrder, arr)
  }
  const chapters = Array.from(byChapter.keys()).sort((a, b) => a - b)

  return (
    <div className="space-y-3">
      {chapters.map((ch) => {
        const items = (byChapter.get(ch) ?? []).sort((a, b) =>
          a.significance === b.significance
            ? 0
            : a.significance === 'MAJOR'
              ? -1
              : 1
        )
        return (
          <div key={ch}>
            <p className="text-xs uppercase text-muted">
              第 {ch} 章 · {items.length}
            </p>
            <div className="mt-1 space-y-1.5">
              {items.map((e) => (
                <EventCard key={e.id} event={e} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const EventCard = ({ event }: { event: EventTimelineItem }) => {
  const major = event.significance === 'MAJOR'
  return (
    <div
      className={
        major
          ? 'rounded-md border border-brand/40 bg-brand/5 px-2.5 py-2'
          : 'rounded-md border border-primary/10 bg-background-secondary px-2.5 py-2'
      }
    >
      <div className="flex items-center gap-1.5 text-xs">
        <span className={major ? 'text-brand' : 'text-muted'}>
          {major ? '★ MAJOR' : '· minor'}
        </span>
        {event.kind && <span className="text-muted/70">· {event.kind}</span>}
      </div>
      <p className="mt-0.5 text-sm text-primary">{event.description}</p>
      {(event.involvedCharacters.length > 0 || event.location) && (
        <p className="mt-1 text-xs text-muted">
          {event.involvedCharacters.length > 0 &&
            `👥${event.involvedCharacters.join('、')} `}
          {event.location && `📍${event.location}`}
        </p>
      )}
      {event.relatedHookId && (
        <p className="mt-0.5 text-xs text-muted/70">
          🪝 {event.relatedHookAction ?? 'related'} ·
          {event.relatedHookId.slice(-4)}
        </p>
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
