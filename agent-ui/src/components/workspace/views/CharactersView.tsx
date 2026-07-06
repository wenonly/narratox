'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Skull, Target } from 'lucide-react'

import { useStore } from '@/store'
import { getCharacters } from '@/api/novels'
import type { Character, CharacterRole, Novel } from '@/types/novel'
import { cn } from '@/lib/utils'

export interface CharactersViewProps {
  novel: Novel
}

const ROLE_COLOR: Record<
  CharacterRole,
  { label: string; color: string; soft: string }
> = {
  PROTAGONIST: {
    label: '主角',
    color: 'accent-primary',
    soft: 'accent-primarySoft'
  },
  ANTAGONIST: {
    label: '反派',
    color: 'role-ant',
    soft: 'role-antSoft'
  },
  SUPPORTING: {
    label: '配角',
    color: 'accent-violet',
    soft: 'accent-violetSoft'
  }
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

// 短字段 → 2-col chip grid(展开态档案区)。flaw/arcGoal 不在此处——它们有独立 tint 块。
const SHORT_FIELDS: Array<{
  key: 'faction' | 'voice' | 'personality' | 'motivation'
  label: string
}> = [
  { key: 'faction', label: '阵营' },
  { key: 'voice', label: '语言' },
  { key: 'personality', label: '性格' },
  { key: 'motivation', label: '执念' }
]

// 长字段 → 段落堆叠(展开态档案区)。
const LONG_FIELDS: Array<{
  key: 'background' | 'growth' | 'appearance'
  label: string
}> = [
  { key: 'background', label: '出身背景' },
  { key: 'growth', label: '成长经历' },
  { key: 'appearance', label: '外貌' }
]

// Tailwind JIT 字面量 map:动态取色必须经此查找,模板字符串拼接会被 purge。
const AVATAR_BG: Record<string, string> = {
  'accent-primarySoft': 'bg-accent-primarySoft',
  'role-antSoft': 'bg-role-antSoft',
  'accent-violetSoft': 'bg-accent-violetSoft'
}
const AVATAR_FG: Record<string, string> = {
  'accent-primary': 'text-accent-primary',
  'role-ant': 'text-role-ant',
  'accent-violet': 'text-accent-violet'
}

// 折叠卡左边竖带的角色色(同 AVATAR_FG,JIT 要求字面量 map)。
const BAND_CLASS: Record<string, string> = {
  'accent-primary': 'border-l-accent-primary',
  'role-ant': 'border-l-role-ant',
  'accent-violet': 'border-l-accent-violet'
}

// 角色头像:首字母 + role soft 底 + role 色字。size='sm'(折叠 28)/ 'md'(展开 34)。
const Avatar = ({
  name,
  color,
  soft,
  size = 'sm'
}: {
  name: string
  color: string
  soft: string
  size?: 'sm' | 'md'
}) => {
  const px = size === 'md' ? 34 : 28
  const fs = size === 'md' ? 16 : 13
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full',
        AVATAR_BG[soft]
      )}
      style={{ width: px, height: px }}
    >
      <span
        className={cn('font-semibold', AVATAR_FG[color])}
        style={{ fontSize: fs }}
      >
        {name[0]}
      </span>
    </div>
  )
}

// 头部概览条:X 角色 · Y MAJOR · 第N章 最近。
const OverviewBar = ({ chars }: { chars: Character[] }) => {
  const total = chars.length
  const major = chars.reduce(
    (n, c) => n + c.changes.filter((ch) => ch.significance === 'MAJOR').length,
    0
  )
  const recent =
    chars.reduce((m, c) => {
      const top = c.changes.reduce((x, ch) => Math.max(x, ch.chapterOrder), 0)
      return Math.max(m, top)
    }, 0) || 0
  return (
    <div className="flex items-center gap-2 rounded-md bg-overlay-5 px-2.5 py-2 text-xs">
      <span className="font-semibold text-text-primary">{total}</span>
      <span className="text-text-tertiary">角色</span>
      <span className="text-text-label">·</span>
      <span className="font-semibold text-accent-indigoLight">{major}</span>
      <span className="text-text-tertiary">MAJOR</span>
      <span className="text-text-label">·</span>
      <span className="text-text-tertiary">最近</span>
      <span className="font-semibold text-text-secondary">第{recent}章</span>
    </div>
  )
}

const ExpandedBody = ({ c }: { c: Character }) => {
  const stateEntries = Object.entries(c.currentState).filter(
    ([f]) => f !== 'appearance'
  )
  const changes = c.changes.slice().reverse()
  const rc = ROLE_COLOR[c.role]
  return (
    <div className="mt-2 space-y-2.5 border-t border-overlay-10 pt-2.5">
      {/* 弱点 (rose tint) */}
      {c.flaw && (
        <div className="space-y-1 rounded-md bg-role-antSoft px-2.5 py-2">
          <div className="flex items-center gap-1.5">
            <Skull className="size-3 text-role-ant" />
            <span className="text-[10px] font-semibold tracking-wide text-role-ant">
              执念 · 弱点
            </span>
          </div>
          <p className="text-xs leading-relaxed text-text-secondary">
            {c.flaw}
          </p>
        </div>
      )}

      {/* 弧光目标 (indigo tint) */}
      {c.arcGoal && (
        <div className="space-y-1 rounded-md bg-accent-primarySoft px-2.5 py-2">
          <div className="flex items-center gap-1.5">
            <Target className="size-3 text-accent-indigoLight" />
            <span className="text-[10px] font-semibold tracking-wide text-accent-indigoLight">
              弧光目标
            </span>
          </div>
          <p className="text-xs leading-relaxed text-text-secondary">
            {c.arcGoal}
          </p>
        </div>
      )}

      {/* 档案:短字段 chip grid + 长字段堆叠 */}
      {SHORT_FIELDS.some((f) => c[f.key]) ||
      LONG_FIELDS.some((f) => c[f.key]) ? (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold tracking-wide text-text-label">
            档案
          </p>
          {SHORT_FIELDS.some((f) => c[f.key]) && (
            <div className="grid grid-cols-2 gap-1.5">
              {SHORT_FIELDS.map((f) =>
                c[f.key] ? (
                  <div
                    key={f.key}
                    className="flex min-w-0 items-center gap-1 rounded-full bg-overlay-5 px-2 py-1"
                  >
                    <span className="shrink-0 text-[10px] text-text-tertiary">
                      {f.label}
                    </span>
                    <span className="truncate text-[10px] font-medium text-text-secondary">
                      {c[f.key]}
                    </span>
                  </div>
                ) : null
              )}
            </div>
          )}
          {LONG_FIELDS.map((f) =>
            c[f.key] ? (
              <div key={f.key} className="space-y-0.5">
                <span className="text-[10px] text-text-tertiary">
                  {f.label}
                </span>
                <p className="text-xs leading-relaxed text-text-secondary">
                  {c[f.key]}
                </p>
              </div>
            ) : null
          )}
        </div>
      ) : null}

      {/* 当前态 chips */}
      {stateEntries.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold tracking-wide text-text-label">
            当前态 · 第
            {Math.max(...stateEntries.map(([, s]) => s.chapterOrder), 0)}章
          </p>
          <div className="flex flex-wrap gap-1.5">
            {stateEntries.map(([field, s]) => (
              <div
                key={field}
                className="flex min-w-0 max-w-full items-center gap-1 rounded-full bg-overlay-10 px-2 py-0.5"
              >
                <span className="shrink-0 text-[10px] text-text-tertiary">
                  {FIELD_LABEL[field] ?? field}
                </span>
                <span className="truncate text-[10px] font-medium text-text-primary">
                  {s.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 变化时间线(倒序节点) */}
      <div className="space-y-1">
        <p className="text-[10px] font-semibold tracking-wide text-text-label">
          变化时间线 · {c.changes.length} 条
        </p>
        {changes.length === 0 ? (
          <p className="text-xs text-text-tertiary">暂无变化记录</p>
        ) : (
          changes.map((ch) => {
            const major = ch.significance === 'MAJOR'
            return (
              <div key={ch.id} className="flex items-start gap-2 py-0.5">
                <span
                  className={cn(
                    'mt-0.5 size-2 shrink-0 rounded-full border',
                    major
                      ? 'border-accent-indigoLight bg-accent-indigoLight'
                      : 'border-accent-indigoLight bg-transparent'
                  )}
                />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        'text-[10px] font-semibold',
                        major ? 'text-accent-indigoLight' : 'text-text-tertiary'
                      )}
                    >
                      第{ch.chapterOrder}章
                    </span>
                    {major && (
                      <span className="text-[9px] font-semibold text-accent-indigoLight">
                        ★ MAJOR
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-secondary">
                    <span className="text-text-tertiary">
                      {FIELD_LABEL[ch.field] ?? ch.field.split(':')[0]}:
                    </span>{' '}
                    {ch.value}
                  </p>
                  {ch.reason && (
                    <p className="text-[10px] text-text-label">→ {ch.reason}</p>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* 角色色提示尾(与 role soft 同色,绑定视觉) */}
      <div className="flex items-center gap-1 pt-0.5 text-[9px] text-text-label">
        <span className={cn('size-1 rounded-full', AVATAR_BG[rc.soft])} />
        {rc.label}
      </div>
    </div>
  )
}

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
      <OverviewBar chars={chars} />
      {(['PROTAGONIST', 'ANTAGONIST', 'SUPPORTING'] as CharacterRole[]).map(
        (role) => {
          const items = byRole(role)
          if (items.length === 0) return null
          return (
            <div key={role}>
              <div className="mb-1.5 flex items-center gap-1.5 px-1">
                <span
                  className={cn(
                    'size-1.5 rounded-full',
                    AVATAR_BG[ROLE_COLOR[role].soft]
                  )}
                />
                <span className="text-[10px] font-semibold tracking-wide text-text-tertiary">
                  {ROLE_COLOR[role].label}
                </span>
                <span className="text-[10px] text-text-label">
                  · {items.length}
                </span>
              </div>
              <div className="space-y-1.5">
                {items.map((c) => {
                  const isOpen = openName === c.name
                  return (
                    <div
                      key={c.id}
                      className={cn(
                        'rounded-md border border-l-2 border-overlay-15 bg-bg-cardElevated px-3 py-2.5',
                        BAND_CLASS[ROLE_COLOR[c.role].color]
                      )}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setOpenName((cur) => (cur === c.name ? null : c.name))
                        }
                        className="flex w-full items-center gap-2.5 text-left"
                      >
                        <Avatar
                          name={c.name}
                          color={ROLE_COLOR[c.role].color}
                          soft={ROLE_COLOR[c.role].soft}
                        />
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-semibold text-text-primary">
                              {c.name}
                            </span>
                            {c.aliases.length > 0 && (
                              <span className="truncate text-xs text-text-tertiary">
                                {c.aliases.join('/')}
                              </span>
                            )}
                          </div>
                          {(c.personality || c.motivation) && (
                            <p className="truncate text-xs text-text-tertiary">
                              {[
                                c.personality && `性格:${c.personality}`,
                                c.motivation && `动机:${c.motivation}`
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </p>
                          )}
                        </div>
                        {isOpen ? (
                          <ChevronDown className="size-3.5 shrink-0 text-text-label" />
                        ) : (
                          <ChevronRight className="size-3.5 shrink-0 text-text-label" />
                        )}
                      </button>
                      {isOpen && <ExpandedBody c={c} />}
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
