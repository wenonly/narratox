'use client'

import {
  createContext,
  useContext,
  useState,
  type FC,
  type ReactNode
} from 'react'
import remarkDirective from 'remark-directive'
import { defaultSchema } from 'rehype-sanitize'
import { cn } from '@/lib/utils'
import type { ActivityMap } from '@/types/os'

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

/** 通用折叠块:点标题切换展开/收起。 */
const Collapsible: FC<{
  icon: string
  title: string
  statusMark: string | null
  meta?: string
  children?: ReactNode
}> = ({ icon, title, statusMark, meta, children }) => {
  const [open, setOpen] = useState(false)
  const hasDetail = !!children
  return (
    <div className="rounded-md bg-overlay-6 px-2 py-1 text-xs text-text-tertiary">
      <button
        type="button"
        disabled={!hasDetail}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-left disabled:cursor-default"
      >
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{title}</span>
        {meta && <span className="shrink-0 text-text-label">{meta}</span>}
        {statusMark && (
          <span className="ml-auto shrink-0 text-text-label">{statusMark}</span>
        )}
        {hasDetail && (
          <span
            className={cn(
              'ml-1 shrink-0 transition-transform',
              open && 'rotate-90'
            )}
          >
            ▸
          </span>
        )}
      </button>
      {open && hasDetail && (
        <div className="mt-1 space-y-1 border-t border-overlay-15 pt-1">
          {children}
        </div>
      )}
    </div>
  )
}

const DetailBlock: FC<{ label: string; children: string }> = ({
  label,
  children
}) => (
  <div>
    <div className="mb-0.5 text-[10px] uppercase tracking-wide text-text-label">
      {label}
    </div>
    <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-overlay-6 p-1.5 text-[11px] leading-relaxed text-text-tertiary">
      {children}
    </pre>
  </div>
)

/** ::think —— 折叠的思考块,显示字数,展开看推理全文。 */
export const ThinkBlock: FC<{ id?: string }> = ({ id }) => {
  const activities = useContext(ActivitiesContext)
  const a = id ? activities?.[id] : undefined
  if (!a) return null
  const text = a.text ?? ''
  return (
    <Collapsible
      icon="🧠"
      title="思考"
      statusMark={a.status === 'error' ? '⚠️' : a.status === 'ok' ? '✓' : null}
      meta={text ? `· ${text.length}字` : undefined}
    >
      <div className="whitespace-pre-wrap break-words leading-relaxed text-text-tertiary">
        {text || '(空)'}
      </div>
    </Collapsible>
  )
}

/** ::tool —— 折叠的工具块,显示工具名+状态,展开看参数/返回。 */
export const ToolBlock: FC<{ id?: string }> = ({ id }) => {
  const activities = useContext(ActivitiesContext)
  const a = id ? activities?.[id] : undefined
  if (!a) return null
  const hasDetail = a.toolArgs !== undefined || a.toolResult !== undefined
  return (
    <Collapsible
      icon="🔧"
      title={a.label ?? '工具'}
      statusMark={a.status === 'error' ? '⚠️' : a.status === 'ok' ? '✓' : null}
    >
      {hasDetail ? (
        <>
          {a.toolArgs !== undefined && (
            <DetailBlock label="参数">{fmtJson(a.toolArgs)}</DetailBlock>
          )}
          {a.toolResult !== undefined && (
            <DetailBlock label="返回">{fmtJson(a.toolResult)}</DetailBlock>
          )}
          {a.summary && <div className="text-text-label">{a.summary}</div>}
        </>
      ) : null}
    </Collapsible>
  )
}

/** ::stage —— 视觉分隔条(▶ writer / ▶ settler)。 */
export const StageBlock: FC<{ id?: string }> = ({ id }) => {
  const activities = useContext(ActivitiesContext)
  const a = id ? activities?.[id] : undefined
  return (
    <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-text-label">
      <span className="h-px flex-1 bg-overlay-10" />
      <span className="shrink-0">{a?.label ?? '阶段'}</span>
      <span className="h-px flex-1 bg-overlay-10" />
    </div>
  )
}
