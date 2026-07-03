'use client'

import { useEffect, useState } from 'react'
import { Circle, CircleCheck, CornerDownRight, Loader2 } from 'lucide-react'

import { useStore } from '@/store'
import { getStatus } from '@/api/novels'
import type { NovelStatus } from '@/types/novel'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

interface Props {
  novelId: string
}

/**
 * StatusPopover — 态势 popover,从 ChatCard 头部的「进度」pill 触发(B2)。
 * 内容:进度条(字数 % + 章/卷) · 立项清单(8 项基础 + 4 项构建) · 下一步。
 * 数据来自 GET /novels/:id/status(StatusService.getOverview)。
 */
const StatusPopover = ({ novelId }: Props) => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const [status, setStatus] = useState<NovelStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    getStatus(endpoint, token, novelId)
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
  }, [endpoint, token, novelId, open])

  const pct =
    status && status.targetTotalWords
      ? Math.min(
          100,
          Math.round((status.totalWords / status.targetTotalWords) * 100)
        )
      : null
  const chapterPart =
    status?.coverage?.targetChapters != null
      ? `${status.chapterCount}/${status.coverage.targetChapters} 章`
      : `${status?.chapterCount ?? 0} 章`
  const volumePart = `${status?.coverage?.volumes ?? 0} 卷`

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="rounded-full bg-overlay-10 px-2 py-0.5 text-xs text-text-secondary transition-colors hover:bg-overlay-15"
        >
          进度 {pct != null ? `${pct}%` : `${status?.chapterCount ?? 0} 章`}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="w-[320px] rounded-lg border border-overlay-15 bg-bg-cardElevated p-4 shadow-[0_6px_24px_#00000066]"
      >
        {loading && !status ? (
          <div className="flex items-center justify-center py-6 text-text-tertiary">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : !status ? (
          <p className="py-4 text-center text-xs text-text-tertiary">
            态势数据暂不可用
          </p>
        ) : (
          <div className="space-y-3">
            {/* 进度 */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold text-text-secondary">
                  进度
                </span>
                <span className="text-xs text-text-tertiary">
                  {status.totalWords.toLocaleString()}/
                  {status.targetTotalWords
                    ? status.targetTotalWords.toLocaleString()
                    : '—'}{' '}
                  字
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-overlay-10">
                <div
                  className="h-full rounded-full bg-accent-primary transition-all"
                  style={{
                    width: pct != null ? `${pct}%` : '0%'
                  }}
                />
              </div>
              <p className="mt-1 text-xs text-text-tertiary">
                {chapterPart} · {volumePart}
              </p>
            </div>

            <div className="h-px bg-overlay-10" />

            {/* 立项清单 */}
            <div>
              <p className="mb-1.5 text-xs font-semibold text-text-secondary">
                立项清单
              </p>
              <div className="space-y-1">
                {CHECKLIST.map((item) => {
                  const done = item.done(status)
                  return (
                    <div
                      key={item.key}
                      className="flex items-start gap-1.5 text-xs"
                    >
                      {done ? (
                        <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
                      ) : (
                        <Circle className="mt-0.5 size-3.5 shrink-0 text-text-label" />
                      )}
                      <span
                        className={
                          done ? 'text-text-secondary' : 'text-text-label'
                        }
                      >
                        {item.label}
                        {done && item.detail && item.detail(status) && (
                          <span className="ml-1 text-text-tertiary">
                            · {item.detail(status)}
                          </span>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="h-px bg-overlay-10" />

            {/* 下一步 */}
            <div className="rounded-md bg-accent-primarySoft p-2">
              <div className="flex items-start gap-1.5">
                <CornerDownRight className="mt-0.5 size-3.5 shrink-0 text-accent-indigoLight" />
                <p className="text-xs leading-relaxed text-accent-indigoLight">
                  {status.nextStep || '继续推进故事…'}
                </p>
              </div>
            </div>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// 立项清单项(8 基础 + 4 构建),与 server StatusService.onboarding 对齐。
const CHECKLIST: Array<{
  key: string
  label: string
  done: (s: NovelStatus) => boolean
  detail?: (s: NovelStatus) => string
}> = [
  {
    key: 'title',
    label: '书名',
    done: (s) => s.onboarding.basics.title
  },
  {
    key: 'genre',
    label: '类型',
    done: (s) => s.onboarding.basics.genre
  },
  {
    key: 'synopsis',
    label: '简介',
    done: (s) => s.onboarding.basics.synopsis
  },
  {
    key: 'coreConflict',
    label: '核心冲突',
    done: (s) => s.onboarding.basics.coreConflict
  },
  {
    key: 'chapterWordTarget',
    label: '每章字数目标',
    done: (s) => s.onboarding.basics.chapterWordTarget
  },
  {
    key: 'totalWordTarget',
    label: '全书字数目标',
    done: (s) => s.onboarding.basics.totalWordTarget
  },
  {
    key: 'worldviewText',
    label: '世界观雏形',
    done: (s) => s.onboarding.basics.worldviewText
  },
  {
    key: 'style',
    label: '风格基调',
    done: (s) => s.onboarding.basics.style
  },
  {
    key: 'hasWorld',
    label: '世界观条目',
    done: (s) => s.onboarding.hasWorld
  },
  {
    key: 'hasOutline',
    label: '大纲',
    done: (s) => s.onboarding.hasOutline,
    detail: (s) =>
      `${s.coverage.volumes} 卷 · ${s.coverage.plannedChapters} 章细纲`
  },
  {
    key: 'hasCharacters',
    label: '角色档案',
    done: (s) => s.onboarding.hasCharacters
  },
  {
    key: 'hasReferences',
    label: '参考资料',
    done: (s) => s.onboarding.hasReferences
  }
]

export default StatusPopover
