'use client'

import { createContext, useContext, useState, type FC } from 'react'
import {
  Brain,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleAlert,
  LoaderCircle,
  Wrench,
  CornerDownRight
} from 'lucide-react'
import remarkDirective from 'remark-directive'
import { defaultSchema } from 'rehype-sanitize'
import { cn } from '@/lib/utils'
import type { ActivityMap, ActivityDetail } from '@/types/os'

export const ActivitiesContext = createContext<ActivityMap | null>(null)

/** 把 ::think/::tool/::stage leaf 指令转成同名 HAST 元素(带 id),供 components 映射渲染。 */
function remarkActivityDirectives() {
  const NAMES = new Set(['think', 'tool', 'stage'])
  const walk = (node: unknown): void => {
    const n = node as {
      type?: string
      name?: string
      attributes?: Record<string, unknown>
      data?: Record<string, unknown>
      children?: unknown[]
    }
    if (
      n &&
      n.type &&
      n.type.endsWith('Directive') &&
      n.name &&
      NAMES.has(n.name)
    ) {
      const data = n.data ?? (n.data = {})
      data.hName = n.name
      data.hProperties = {
        ...(data.hProperties as object | undefined),
        id: n.attributes?.id
      }
    }
    if (n && Array.isArray(n.children)) for (const c of n.children) walk(c)
  }
  return (tree: unknown) => walk(tree)
}

/** rehype-sanitize schema:在默认白名单上加 think/tool/stage 标签 + id 属性。 */
export const activitySanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'think', 'tool', 'stage'],
  attributes: {
    ...defaultSchema.attributes,
    think: ['id'],
    tool: ['id'],
    stage: ['id']
  },
  clobber: (defaultSchema.clobber ?? []).filter((k) => k !== 'id'),
  clobberPrefix: defaultSchema.clobberPrefix
}

export const activityRemarkPlugins = [remarkDirective, remarkActivityDirectives]

const fmtJson = (v: unknown): string => {
  if (v === undefined) return ''
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

/** A1 think —— 折叠 chip + 展开的推理文。 */
export const ThinkBlock: FC<{ id?: string }> = ({ id }) => {
  const activities = useContext(ActivitiesContext)
  const a = id ? activities?.[id] : undefined
  const [open, setOpen] = useState(false)
  if (!a) return null
  const text = a.text ?? ''
  const done = a.status === 'ok' || a.status === 'error' || text.length > 0
  const errored = a.status === 'error'
  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full bg-overlay-5 px-2.5 py-1 transition-colors hover:bg-overlay-10"
      >
        <Brain className="size-3 text-accent-violetLight" />
        <span className="text-xs text-text-secondary">
          思考 · {errored ? '出错' : done ? '已完成' : '…'}
        </span>
        {open ? (
          <ChevronDown className="size-3 text-text-tertiary" />
        ) : (
          <ChevronRight className="size-3 text-text-tertiary" />
        )}
      </button>
      {open && (
        <div className="mt-1.5 rounded-md bg-overlay-5 px-3 py-2.5">
          <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-text-tertiary">
            {text || '(空)'}
          </pre>
        </div>
      )}
    </div>
  )
}

/** A2 tool —— 单行紧凑行(在 batch 模式下被 ToolBatch 取代,直接渲染时用此组件)。 */
export const ToolBlock: FC<{ id?: string }> = ({ id }) => {
  const activities = useContext(ActivitiesContext)
  const a = id ? activities?.[id] : undefined
  const [open, setOpen] = useState(false)
  if (!a) return null
  const running = a.status === undefined
  const errored = a.status === 'error'
  const hasDetail = a.toolArgs !== undefined || a.toolResult !== undefined
  const summary = a.summary?.trim() || ''
  return (
    <div className="my-1">
      <button
        type="button"
        disabled={!hasDetail && !summary}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md bg-overlay-5 px-2 py-1.5 text-left text-xs',
          (hasDetail || summary) && 'hover:bg-overlay-10',
          !hasDetail && !summary && 'cursor-default'
        )}
      >
        {running ? (
          <LoaderCircle className="size-3 shrink-0 animate-spin text-accent-indigoLight" />
        ) : errored ? (
          <CircleAlert className="size-3 shrink-0 text-destructive" />
        ) : (
          <CircleCheck className="size-3 shrink-0 text-success" />
        )}
        <span className="shrink-0 font-mono text-text-secondary">
          {a.label ?? '工具'}
        </span>
        {summary && (
          <span className="truncate text-text-tertiary">· {summary}</span>
        )}
      </button>
      {open && (hasDetail || summary) && (
        <div className="mt-1 space-y-1.5 pl-5">
          {a.toolArgs !== undefined && (
            <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-overlay-5 p-1.5 font-mono text-xs leading-relaxed text-text-tertiary">
              {fmtJson(a.toolArgs)}
            </pre>
          )}
          {a.toolResult !== undefined && (
            <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-overlay-5 p-1.5 font-mono text-xs leading-relaxed text-text-tertiary">
              {fmtJson(a.toolResult)}
            </pre>
          )}
          {summary && (
            <div className="flex items-center gap-1 text-xs text-success">
              <CircleCheck className="size-3" /> {summary}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** A3 stage —— 子 agent 切换的 handoff 卡。 */
export const StageBlock: FC<{ id?: string }> = ({ id }) => {
  const activities = useContext(ActivitiesContext)
  const a = id ? activities?.[id] : undefined
  if (!a) return null
  const running = a.status === undefined
  const errored = a.status === 'error'
  const done = a.status === 'ok'
  return (
    <div
      className={cn(
        'my-1.5 rounded-md border-l-2 bg-bg-cardElevated px-3 py-2.5',
        errored
          ? 'border-l-2 border-destructive'
          : done
            ? 'border-l-2 border-success'
            : 'border-l-2 border-accent-indigoLight'
      )}
    >
      <div className="flex items-center gap-2">
        <CornerDownRight className="size-3 shrink-0 text-accent-indigoLight" />
        <span className="rounded-full bg-accent-primarySoft px-1.5 py-0.5 text-xs font-semibold text-accent-indigoLight">
          {a.label ?? '阶段'}
        </span>
        <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs">
          {running ? (
            <>
              <LoaderCircle className="size-3 animate-spin text-accent-indigoLight" />
              <span className="text-accent-indigoLight">进行中</span>
            </>
          ) : errored ? (
            <>
              <CircleAlert className="size-3 text-destructive" />
              <span className="text-destructive">出错</span>
            </>
          ) : (
            <>
              <CircleCheck className="size-3 text-success" />
              <span className="text-success">完成</span>
            </>
          )}
        </span>
      </div>
    </div>
  )
}

/**
 * 工具调用批量折叠面板(A2 的 batch 形态)。
 *
 * react-markdown 把每个 `::tool` 指令渲染成独立的 ToolBlock(兄弟节点),
 * 它们彼此看不见。当一个 agent 消息有 ≥3 个工具活动时,我们在 MarkdownRenderer
 * 之上(MessageItem)渲染这个 batch 面板,并把同 id 的内联 ToolBlock 屏蔽为 null,
 * 以实现「N 个工具调用 → 一行 ▾ → 展开看 N 行」。
 */
export const ToolBatch: FC<{ ids: string[] }> = ({ ids }) => {
  const activities = useContext(ActivitiesContext)
  const [open, setOpen] = useState(false)
  if (ids.length === 0 || !activities) return null
  const rows = ids
    .map((iid) =>
      activities[iid] ? { id: iid, detail: activities[iid] } : null
    )
    .filter((r): r is { id: string; detail: ActivityDetail } => r !== null)
  if (rows.length === 0) return null
  const doneCount = rows.filter(
    (r) => r.detail.status === 'ok' || r.detail.status === 'error'
  ).length
  return (
    <div className="my-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-md border border-overlay-15 bg-bg-cardElevated px-2.5 py-1.5 hover:bg-overlay-5"
      >
        <span className="inline-flex min-w-0 items-center gap-2">
          <Wrench className="size-3 shrink-0 text-accent-indigoLight" />
          <span className="shrink-0 text-xs text-text-secondary">
            工具调用 · {rows.length} 次
          </span>
          <span className="shrink-0 text-xs text-text-label">
            {doneCount}/{rows.length}
          </span>
        </span>
        <ChevronDown
          className={cn(
            'size-3 shrink-0 text-text-tertiary transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>
      {open && (
        <div className="mt-1.5 space-y-1">
          {rows.map((r) => (
            <ToolBlock key={r.id} id={r.id} />
          ))}
        </div>
      )}
    </div>
  )
}

/** 当 ToolBatch 接管时,内联的 ::tool 标记渲染为 null。 */
export const SuppressedToolBlock: FC<{ id?: string }> = () => null
