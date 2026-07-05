'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

import { useStore } from '@/store'
import { getCharacters } from '@/api/novels'
import type { Character, CharacterRole, Novel } from '@/types/novel'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'

export interface CharactersViewProps {
  novel: Novel
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

const CharactersView = ({ novel }: CharactersViewProps) => {
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

  if (loading) return <p className="text-sm text-text-tertiary">加载角色…</p>
  if (!chars || chars.length === 0) {
    return (
      <p className="text-sm text-text-tertiary">
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
              <p className="mb-1.5 text-[10px] font-semibold tracking-wide text-text-tertiary">
                {ROLE_LABEL[role]} · {items.length}
              </p>
              <div className="space-y-1.5">
                {items.map((c) => {
                  const isOpen = openName === c.name
                  const stateEntries = Object.entries(c.currentState).filter(
                    ([f]) => f !== 'appearance'
                  )
                  const essenceLine = [
                    c.personality && `性格基调:${c.personality}`,
                    c.motivation && `动机:${c.motivation}`
                  ].filter(Boolean)
                  return (
                    <div
                      key={c.id}
                      className="rounded-md border border-overlay-15 bg-bg-cardElevated px-3 py-2.5"
                    >
                      {isOpen ? (
                        <button
                          type="button"
                          onClick={() =>
                            setOpenName((cur) =>
                              cur === c.name ? null : c.name
                            )
                          }
                          className="flex w-full items-center gap-1.5 text-left"
                        >
                          <ChevronDown className="size-3.5 shrink-0 text-text-label" />
                          <span className="text-sm font-semibold text-text-primary">
                            {c.name}
                          </span>
                          {c.aliases.length > 0 && (
                            <span className="truncate text-xs text-text-tertiary">
                              · {c.aliases.join('/')}
                            </span>
                          )}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            setOpenName((cur) =>
                              cur === c.name ? null : c.name
                            )
                          }
                          className="flex w-full items-center gap-1.5 text-left"
                        >
                          <ChevronRight className="size-3.5 shrink-0 text-text-label" />
                          <span className="truncate text-sm font-semibold text-text-primary">
                            {c.name}
                          </span>
                          {c.aliases.length > 0 && (
                            <span className="ml-1 truncate text-xs text-text-tertiary">
                              · {c.aliases.join('/')}
                            </span>
                          )}
                          {essenceLine.length > 0 && (
                            <span className="ml-auto shrink-0 truncate text-xs text-text-tertiary">
                              {essenceLine[0]}
                            </span>
                          )}
                        </button>
                      )}
                      {isOpen && (
                        <div className="mt-2 space-y-2 border-t border-overlay-10 pt-2">
                          {/* 完整档案(char-writer 建的稳定身份) */}
                          {PROFILE_FIELDS.some((f) => c[f.key]) ? (
                            <div className="space-y-1">
                              <p className="text-[10px] font-semibold tracking-wide text-text-label">
                                档案
                              </p>
                              {PROFILE_FIELDS.map((f) => {
                                const val = c[f.key]
                                if (!val) return null
                                return f.long ? (
                                  <div key={f.key} className="text-xs">
                                    <span className="text-text-tertiary">
                                      {f.label}
                                    </span>
                                    <div className="prose prose-invert max-w-none pt-0.5 text-xs leading-relaxed text-text-secondary">
                                      <MarkdownRenderer>{val}</MarkdownRenderer>
                                    </div>
                                  </div>
                                ) : (
                                  <p key={f.key} className="text-xs">
                                    <span className="text-text-tertiary">
                                      {f.label}:
                                    </span>{' '}
                                    <span className="text-text-secondary">
                                      {val}
                                    </span>
                                  </p>
                                )
                              })}
                            </div>
                          ) : (
                            <p className="text-xs text-text-label">
                              档案尚未建立(char-writer 建档后显示)
                            </p>
                          )}
                          {/* 当前态(派生) */}
                          {stateEntries.length > 0 && (
                            <div className="space-y-0.5">
                              <p className="text-[10px] font-semibold tracking-wide text-text-label">
                                当前态
                              </p>
                              {stateEntries.map(([field, s]) => (
                                <p
                                  key={field}
                                  className="text-xs text-text-tertiary"
                                >
                                  <span className="text-text-secondary">
                                    {FIELD_LABEL[field] ?? field}
                                  </span>
                                  :{s.value}
                                  <span className="text-text-label">
                                    {' '}
                                    (第{s.chapterOrder}章)
                                  </span>
                                </p>
                              ))}
                            </div>
                          )}
                          {/* 变化时间线 */}
                          <div className="space-y-0.5">
                            <p className="text-[10px] font-semibold tracking-wide text-text-label">
                              变化时间线
                            </p>
                            {c.changes.length === 0 ? (
                              <p className="text-xs text-text-tertiary">
                                暂无变化记录
                              </p>
                            ) : (
                              c.changes
                                .slice()
                                .reverse()
                                .map((ch, i) => (
                                  <div
                                    key={i}
                                    className={
                                      ch.significance === 'MAJOR'
                                        ? 'rounded bg-accent-primarySoft px-1.5 py-0.5 text-xs'
                                        : 'text-xs'
                                    }
                                  >
                                    <span className="text-text-label">
                                      第{ch.chapterOrder}章
                                    </span>{' '}
                                    {ch.significance === 'MAJOR' && (
                                      <span className="text-accent-indigoLight">
                                        ★
                                      </span>
                                    )}{' '}
                                    <span className="text-text-secondary">
                                      {FIELD_LABEL[ch.field] ??
                                        ch.field.split(':')[0]}
                                    </span>
                                    :
                                    <span className="text-text-primary">
                                      {ch.value}
                                    </span>
                                    {ch.reason && (
                                      <span className="text-text-label">
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

export default CharactersView
