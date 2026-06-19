'use client'

import { useState } from 'react'
import type { Activity } from '@/types/os'
import { cn } from '@/lib/utils'

const fmtJson = (v: unknown): string => {
  if (v === undefined) return ''
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

const DetailBlock = ({
  label,
  children
}: {
  label: string
  children: string
}) => (
  <div>
    <div className="mb-0.5 text-[10px] uppercase tracking-wide text-muted/50">
      {label}
    </div>
    <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-background/60 p-1.5 text-[11px] leading-relaxed text-muted/80">
      {children}
    </pre>
  </div>
)

/**
 * 单个活动条目。stage=视觉分隔;think=推理(🧠,默认折叠,点开看推理全文,流式时字数实时增长);
 * tool=工具调用(🔧,点开看参数/返回)。content 条目不在此渲染(增量已并入消息体)。
 */
const ActivityItem = ({ activity }: { activity: Activity }) => {
  const [open, setOpen] = useState(false)

  if (activity.act === 'stage') {
    return (
      <div className="my-1 flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted/50">
        <span className="h-px flex-1 bg-primary/10" />
        <span className="shrink-0">{activity.label ?? activity.act}</span>
        <span className="h-px flex-1 bg-primary/10" />
      </div>
    )
  }

  const isThink = activity.act === 'think'
  const icon = isThink ? '🧠' : '🔧'
  const title = isThink ? '思考' : (activity.label ?? '工具')
  const hasDetail =
    (isThink && activity.text.length > 0) ||
    (!isThink &&
      (activity.toolArgs !== undefined || activity.toolResult !== undefined))
  const statusMark =
    activity.status === 'error' ? '⚠️' : activity.status === 'ok' ? '✓' : null

  return (
    <div className="rounded-md bg-background-secondary/40 px-2 py-1 text-xs text-muted">
      <button
        type="button"
        disabled={!hasDetail}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-left disabled:cursor-default"
      >
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{title}</span>
        {isThink && activity.text && (
          <span className="shrink-0 text-muted/50">
            · {activity.text.length}字
          </span>
        )}
        {statusMark && (
          <span className="ml-auto shrink-0 text-muted/50">{statusMark}</span>
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
        <div className="mt-1 space-y-1 border-t border-primary/10 pt-1">
          {isThink ? (
            <div className="whitespace-pre-wrap break-words leading-relaxed text-muted/80">
              {activity.text || '(空)'}
            </div>
          ) : (
            <>
              {activity.toolArgs !== undefined && (
                <DetailBlock label="参数">
                  {fmtJson(activity.toolArgs)}
                </DetailBlock>
              )}
              {activity.toolResult !== undefined && (
                <DetailBlock label="返回">
                  {fmtJson(activity.toolResult)}
                </DetailBlock>
              )}
              {activity.summary && (
                <div className="text-muted/60">{activity.summary}</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default ActivityItem
