'use client'

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import type { BenchmarkEntry } from '@/types/benchmark'
import {
  DIM_BY_KEY,
  MATERIAL_KINDS,
  MATERIAL_PURPOSES
} from '@/lib/benchmark-dimensions'
import { cn } from '@/lib/utils'

const ACCENT = DIM_BY_KEY.MATERIAL.color

const parseSections = (content: string): { header: string; body: string }[] => {
  if (!content) return []
  const parts = content.split(/【([^】]+)】/)
  if (parts.length < 3) return []
  const out: { header: string; body: string }[] = []
  for (let i = 1; i < parts.length; i += 2) {
    out.push({ header: parts[i], body: (parts[i + 1] ?? '').trim() })
  }
  return out
}

export const MaterialView = ({ entries }: { entries: BenchmarkEntry[] }) => {
  const [kindF, setKindF] = useState<string | null>(null)
  const [purposeF, setPurposeF] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const filtered = useMemo(
    () =>
      entries
        .filter((e) => (kindF ? e.kind === kindF : true))
        .filter((e) => (purposeF ? e.purposes.includes(purposeF) : true)),
    [entries, kindF, purposeF]
  )

  const selected =
    filtered.find((e) => e.id === selectedId) ??
    entries.find((e) => e.id === selectedId) ??
    filtered[0]

  return (
    <div className="flex h-full gap-4">
      {/* 左:列表 + filter chips */}
      <div className="flex w-60 shrink-0 flex-col gap-2 overflow-hidden rounded-lg bg-bg-darkest p-2">
        <div className="flex flex-col gap-1">
          <span className="px-1 text-[10px] font-semibold text-text-label">
            种类
          </span>
          <div className="flex flex-wrap gap-1">
            <Chip active={!kindF} onClick={() => setKindF(null)} label="全部" />
            {MATERIAL_KINDS.map((k) => (
              <Chip
                key={k}
                active={kindF === k}
                onClick={() => setKindF((p) => (p === k ? null : k))}
                label={k}
              />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="px-1 text-[10px] font-semibold text-text-label">
            用途
          </span>
          <div className="flex flex-wrap gap-1">
            <Chip
              active={!purposeF}
              onClick={() => setPurposeF(null)}
              label="全部"
            />
            {MATERIAL_PURPOSES.map((p) => (
              <Chip
                key={p}
                active={purposeF === p}
                onClick={() => setPurposeF((q) => (q === p ? null : p))}
                label={p}
              />
            ))}
          </div>
        </div>
        <div className="mt-1 flex items-center justify-between px-1">
          <span className="text-xs font-semibold text-text-secondary">
            素材
          </span>
          <span className="text-[10px] text-text-label">
            {filtered.length} 个
          </span>
        </div>
        <div className="flex flex-col gap-0.5 overflow-y-auto">
          {filtered.map((e) => {
            const active = selected?.id === e.id
            return (
              <button
                key={e.id}
                onClick={() => setSelectedId(e.id)}
                className={cn(
                  'flex flex-col gap-0.5 rounded-md px-2.5 py-2 text-left',
                  active ? '' : 'hover:bg-overlay-5'
                )}
                style={
                  active
                    ? { backgroundColor: 'rgba(99,102,241,0.15)' }
                    : undefined
                }
              >
                <span
                  className={cn(
                    'text-xs font-semibold',
                    active ? 'text-text-bright' : 'text-text-secondary'
                  )}
                >
                  {e.title}
                </span>
                <div className="flex flex-wrap gap-1">
                  {e.kind && <Tag>{e.kind}</Tag>}
                  {e.purposes.slice(0, 2).map((p) => (
                    <Tag key={p}>{p}</Tag>
                  ))}
                </div>
              </button>
            )
          })}
          {filtered.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-text-label">
              无匹配
            </p>
          )}
        </div>
      </div>
      {/* 右:详情 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {selected ? (
          <article className="flex flex-col gap-5 py-1">
            <header className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-text-primary">
                {selected.title}
              </h3>
              {selected.kind && (
                <span
                  className="rounded-pill px-2 py-0.5 text-[10px] font-semibold"
                  style={{ backgroundColor: ACCENT + '26', color: ACCENT }}
                >
                  {selected.kind}
                </span>
              )}
              {selected.purposes.map((p) => (
                <span
                  key={p}
                  className="rounded-pill bg-overlay-10 px-2 py-0.5 text-[10px] text-text-secondary"
                >
                  {p}
                </span>
              ))}
            </header>
            {parseSections(selected.content).length === 0 ? (
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-text-body">
                {selected.content}
              </p>
            ) : (
              parseSections(selected.content).map((s, i) => (
                <section key={i} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3.5 w-[3px] rounded-full"
                      style={{ backgroundColor: ACCENT }}
                    />
                    <h4 className="text-sm font-semibold text-text-secondary">
                      【{s.header}】
                    </h4>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-text-body">
                    {s.body}
                  </p>
                </section>
              ))
            )}
          </article>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-text-tertiary">暂无素材卡</p>
          </div>
        )}
      </div>
    </div>
  )
}

const Chip = ({
  active,
  onClick,
  label
}: {
  active: boolean
  onClick: () => void
  label: string
}) => (
  <button
    onClick={onClick}
    className={cn(
      'rounded-pill px-2 py-0.5 text-[10px] transition-colors',
      active
        ? 'bg-overlay-15 font-semibold text-text-primary'
        : 'bg-overlay-5 text-text-secondary hover:bg-overlay-10'
    )}
  >
    {active && <Check className="mr-0.5 inline size-2.5" />}
    {label}
  </button>
)

const Tag = ({ children }: { children: ReactNode }) => (
  <span className="rounded-pill bg-overlay-10 px-1.5 py-px text-[9px] text-text-secondary">
    {children}
  </span>
)
