'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/store'
import { listVoiceProfiles } from '@/api/settings'
import { setNovelVoiceProfile } from '@/api/novels'
import type { VoiceProfile } from '@/types/settings'
import type { Novel } from '@/types/novel'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'
import { cn } from '@/lib/utils'

interface Props {
  novel: Novel
  onSaved: () => void
}

const NONE_ID = '__none__'

const VoiceProfileView = ({ novel, onSaved }: Props) => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)

  const [profiles, setProfiles] = useState<VoiceProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(
    novel.voiceProfileId ?? null
  )
  const [switching, setSwitching] = useState(false)

  useEffect(() => {
    setSelected(novel.voiceProfileId ?? null)
  }, [novel.voiceProfileId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listVoiceProfiles(endpoint, token)
      .then((rows) => {
        if (!cancelled) setProfiles(rows)
      })
      .catch((err) => {
        if (!cancelled)
          toast.error(err instanceof Error ? err.message : '画像加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [endpoint, token])

  const currentProfile = useMemo(
    () => profiles.find((p) => p.id === selected) ?? null,
    [profiles, selected]
  )

  const handleSelect = async (id: string | null) => {
    if (switching) return
    const nextId = id === NONE_ID ? null : id
    if (nextId === selected) return
    const prev = selected
    setSelected(nextId) // 乐观更新
    setSwitching(true)
    try {
      await setNovelVoiceProfile(endpoint, token, novel.id, nextId)
      toast.success('已切换')
      onSaved() // 让父组件刷新 novel
    } catch (err) {
      setSelected(prev) // 回滚
      toast.error(err instanceof Error ? err.message : '切换失败')
    } finally {
      setSwitching(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-xs text-muted">当前使用的画像</p>
        <button
          type="button"
          onClick={() => handleSelect(NONE_ID)}
          disabled={switching}
          className={cn(
            'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors',
            selected === null
              ? 'border-brand bg-brand/10 text-primary'
              : 'border-white/20 text-muted hover:bg-accent hover:text-primary'
          )}
        >
          <span>无(默认风格)</span>
          {selected === null && <span className="text-brand">✓</span>}
        </button>
        {loading ? (
          <p className="px-3 py-2 text-xs text-muted">加载中…</p>
        ) : profiles.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted">
            还没有画像,去「设置」新建一个。
          </p>
        ) : (
          profiles.map((p) => {
            const active = p.id === selected
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelect(p.id)}
                disabled={switching}
                className={cn(
                  'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                  active
                    ? 'border-brand bg-brand/10 text-primary'
                    : 'border-white/20 text-muted hover:bg-accent hover:text-primary'
                )}
              >
                <span className="truncate">{p.name}</span>
                {active && <span className="text-brand">✓</span>}
              </button>
            )
          })
        )}
        <p className="px-1 text-xs text-muted/60">编辑画像内容去「设置」。</p>
      </div>

      <div className="border-t border-white/20 pt-3">
        {currentProfile ? (
          <>
            <p className="mb-2 text-xs text-muted">
              预览:{currentProfile.name}
            </p>
            <article className="prose prose-invert max-w-none text-sm">
              <MarkdownRenderer>{currentProfile.profile}</MarkdownRenderer>
            </article>
          </>
        ) : (
          <p className="text-sm text-muted">
            未选择画像 — 选一个,或用默认风格。
          </p>
        )}
      </div>
    </div>
  )
}

export default VoiceProfileView
