'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, CornerDownRight, Layers, Library, PenTool, Sparkles, User } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { useStore } from '@/store'
import { getNovelReferences } from '@/api/novels'
import type { NovelReference } from '@/types/novel'
import { cn } from '@/lib/utils'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'

type InjectMeta = {
  label: string
  band: string
  soft: string
  icon: LucideIcon
  tint: string | null
}

const MAIN_META: InjectMeta = { label: '注入 main', band: 'accent-primary', soft: 'accent-primarySoft', icon: Sparkles, tint: 'main agent(编排者)' }
const WRITER_META: InjectMeta = { label: '注入 writer', band: 'accent-violet', soft: 'accent-violetSoft', icon: PenTool, tint: 'writer agent(写手)' }
const BOTH_META: InjectMeta = { label: '注入 main+writer', band: 'accent-primary', soft: 'accent-primarySoft', icon: Layers, tint: 'main + writer' }
const LIBRARY_META: InjectMeta = { label: '资料库索引', band: 'text-label', soft: 'overlay-10', icon: Library, tint: null }

const INJECT_MAP: Record<string, InjectMeta> = {
  main: MAIN_META,
  writer: WRITER_META,
  both: BOTH_META,
}

// null → 库索引;INJECT_MAP 命中 → 对应 meta;否则 → 角色专属(label 用 injectTo 字符串)
function resolveInject(injectTo: string | null): InjectMeta {
  if (injectTo === null) return LIBRARY_META
  return INJECT_MAP[injectTo] ?? {
    label: `${injectTo} 专属`,
    band: 'accent-primary',
    soft: 'accent-primarySoft',
    icon: User,
    tint: `${injectTo} 相关上下文`,
  }
}

// Tailwind JIT 字面量 map:动态取色必须经此查找,模板字符串拼接会被 purge。
const BAND_CLASS: Record<string, string> = {
  'accent-primary': 'border-l-accent-primary',
  'accent-violet': 'border-l-accent-violet',
  'text-label': 'border-l-text-label',
}
const ICONBOX_BG: Record<string, string> = {
  'accent-primarySoft': 'bg-accent-primarySoft',
  'accent-violetSoft': 'bg-accent-violetSoft',
  'overlay-10': 'bg-overlay-10',
}
const ICON_FG: Record<string, string> = {
  'accent-primary': 'text-accent-primary',
  'accent-violet': 'text-accent-violet',
  'text-label': 'text-text-label',
}

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

type RefGroup = { key: string; meta: InjectMeta; items: NovelReference[] }

// 已关联按 injectTo 分组(保序:main → writer → both → 各角色,按首次出现)+ 库索引单节(末尾)
function groupByInjectTo(refs: NovelReference[]): RefGroup[] {
  const linked: NovelReference[] = []
  const library: NovelReference[] = []
  for (const r of refs) (r.injectTo ? linked : library).push(r)
  const order: string[] = []
  const map: Record<string, NovelReference[]> = {}
  for (const r of linked) {
    const k = r.injectTo as string
    if (!map[k]) {
      order.push(k)
      map[k] = []
    }
    map[k].push(r)
  }
  const groups: RefGroup[] = order.map((k) => ({ key: k, meta: resolveInject(k), items: map[k] }))
  if (library.length) groups.push({ key: '__library__', meta: LIBRARY_META, items: library })
  return groups
}

/**
 * 工作台「参考资料」面板(Pencil R5)。
 * 两节:已关联(injectTo ≠ null,精要置顶) · 资料库索引(injectTo = null,
 * 工具可取)。条目折叠:collapsed = 标题+摘要;expanded = 标题+正文(纯文本)。
 * R5 移除了 per-entry 分类徽标。
 */
export const ReferencesView = ({ novel }: { novel: { id: string } }) => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const referenceWriteSeq = useStore((s) => s.referenceWriteSeq)
  const [refs, setRefs] = useState<NovelReference[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getNovelReferences(endpoint, token, novel.id)
      .then((d) => {
        if (!cancelled) setRefs(d)
      })
      .catch(() => {
        if (!cancelled) setRefs(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [endpoint, token, novel.id, referenceWriteSeq])

  if (loading)
    return <p className="text-sm text-text-tertiary">加载参考资料…</p>
  if (!refs || refs.length === 0) {
    return (
      <p className="text-sm text-text-tertiary">
        参考资料尚未生成。立项信息收集齐后,curator 子 agent
        会自动搜全局知识库并提炼本书专属参考资料(词汇/描写/方法论/须知等, 带
        injectTo 标注),这里会逐条显示。
      </p>
    )
  }

  const tagged = refs.filter((r) => r.injectTo)
  const library = refs.filter((r) => !r.injectTo)

  const renderEntry = (r: NovelReference) => {
    const isOpen = openId === r.id
    return (
      <div
        key={r.id}
        className="rounded-md border border-overlay-15 bg-bg-cardElevated px-3 py-2"
      >
        {isOpen ? (
          <button
            type="button"
            onClick={() => setOpenId((cur) => (cur === r.id ? null : r.id))}
            className="flex w-full items-center gap-1.5 text-left"
          >
            <ChevronDown className="size-3.5 shrink-0 text-text-label" />
            <span className="text-sm font-medium text-text-primary">
              {r.title}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setOpenId((cur) => (cur === r.id ? null : r.id))}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <ChevronRight className="size-3.5 shrink-0 text-text-label" />
              <span className="truncate text-sm text-text-primary">
                {r.title}
              </span>
            </span>
            {r.content && (
              <span className="ml-2 shrink-0 truncate text-xs text-text-tertiary">
                {essence(r.content)}
              </span>
            )}
          </button>
        )}
        {isOpen && (
          <div className="mt-2 border-t border-overlay-10 pt-2">
            {r.content ? (
              <div className="prose prose-invert max-w-none text-xs leading-relaxed text-text-secondary">
                <MarkdownRenderer>{r.content}</MarkdownRenderer>
              </div>
            ) : (
              <p className="text-xs text-text-tertiary">（无正文）</p>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {tagged.length > 0 && (
        <div>
          <p className="mb-1.5 text-[10px] font-semibold tracking-wide text-text-tertiary">
            已关联 · {tagged.length}
          </p>
          <div className="space-y-1.5">{tagged.map(renderEntry)}</div>
        </div>
      )}
      {library.length > 0 && (
        <div>
          <p className="mb-1.5 text-[10px] font-semibold tracking-wide text-text-tertiary">
            资料库索引 · {library.length}
          </p>
          <div className="space-y-1.5">{library.map(renderEntry)}</div>
        </div>
      )}
    </div>
  )
}

export default ReferencesView
