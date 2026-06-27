'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/store'
import { listVoiceProfiles } from '@/api/settings'
import { setNovelVoiceProfile } from '@/api/novels'
import type { VoiceProfile } from '@/types/settings'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'
import { cn } from '@/lib/utils'

interface Props {
  novelId: string
  selectedId: string | null
  onClose: () => void
}

const NONE_ID = '__none__'

const VoiceProfileDrawer = ({ novelId, selectedId, onClose }: Props) => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)

  const [profiles, setProfiles] = useState<VoiceProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(selectedId)
  const [switching, setSwitching] = useState(false)

  useEffect(() => {
    setSelected(selectedId)
  }, [selectedId])

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
    setSelected(nextId)
    setSwitching(true)
    try {
      await setNovelVoiceProfile(endpoint, token, novelId, nextId)
      toast.success('已切换')
    } catch (err) {
      // 回滚本地状态
      setSelected(selected)
      toast.error(err instanceof Error ? err.message : '切换失败')
    } finally {
      setSwitching(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex"
      onClick={onClose}
      role="presentation"
    >
      {/* 左侧抽屉面板:覆盖在 IconRail 之上 */}
      <aside
        className="flex h-full w-[420px] shrink-0 flex-col overflow-hidden border-r border-white/20 bg-background-secondary shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="作者画像"
      >
        <header className="flex items-center justify-between border-b border-white/20 px-4 py-3">
          <h2 className="text-sm font-semibold text-primary">作者画像</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-lg leading-none text-muted hover:text-primary"
            aria-label="关闭"
          >
            ×
          </button>
        </header>

        <div className="flex flex-col gap-3 px-4 py-3">
          <label className="text-xs text-muted">当前使用的画像</label>
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => handleSelect(NONE_ID)}
              disabled={switching}
              className={cn(
                'flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                selected === null
                  ? 'border-brand bg-brand/10 text-primary'
                  : 'border-white/20 text-muted hover:bg-accent hover:text-primary'
              )}
            >
              <span>无(默认风格)</span>
              {selected === null && <span className="text-brand">✓</span>}
            </button>
            {loading ? (
              <div className="px-3 py-2 text-xs text-muted">加载中…</div>
            ) : profiles.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted">
                还没有画像,去「设置」新建一个。
              </div>
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
                      'flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors',
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
          </div>
          <p className="text-xs text-muted">编辑画像内容去「设置」。</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-white/20 px-4 py-4">
          {currentProfile ? (
            <>
              <div className="mb-2 text-xs text-muted">
                预览:{currentProfile.name}
              </div>
              <MarkdownRenderer>{currentProfile.profile}</MarkdownRenderer>
            </>
          ) : (
            <div className="text-sm text-muted">
              未选择画像 — 选一个,或用默认风格。
            </div>
          )}
        </div>
      </aside>

      {/* 右侧占位:点击空白处关闭 */}
      <div className="flex-1 bg-background/60" />
    </div>
  )
}

export default VoiceProfileDrawer
