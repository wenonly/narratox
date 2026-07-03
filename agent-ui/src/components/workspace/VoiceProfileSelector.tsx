'use client'

import { useEffect, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'

import { useStore } from '@/store'
import { setNovelVoiceProfile } from '@/api/novels'
import { listVoiceProfiles } from '@/api/settings'
import type { VoiceProfile } from '@/types/settings'
import { cn } from '@/lib/utils'

interface Props {
  novelId: string
  currentProfileId: string | null | undefined
  onSaved: () => void
}

/**
 * VoiceProfileSelector(B5)— 工作台「作者画像」选择器(非 tab,在 Dialog 里弹)。
 * 顶部高亮当前小说所选画像(Novel.voiceProfileId → 解析);下方「从库中选择」列出
 * 用户画像库,点击切换 → PUT /novels/:id/voice-profile → onSaved 刷新。
 * 完整画像编辑器仍在 /settings;这里只做选择。
 *
 * profile 是自由 markdown 文本;这里只显示 name + 截短摘要(不做字段抽取,
 * 真正的字段解析在 /settings 编辑器里)。
 */
const VoiceProfileSelector = ({
  novelId,
  currentProfileId,
  onSaved
}: Props) => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const [profiles, setProfiles] = useState<VoiceProfile[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listVoiceProfiles(endpoint, token)
      .then((d) => {
        if (!cancelled) setProfiles(d)
      })
      .catch(() => {
        if (!cancelled) setProfiles(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [endpoint, token])

  const current =
    profiles?.find((p) => p.id === currentProfileId) ?? null

  const select = async (id: string) => {
    if (id === currentProfileId) return
    setSavingId(id)
    try {
      await setNovelVoiceProfile(endpoint, token, novelId, id)
      onSaved()
    } catch {
      /* 失败静默:onSaved 不会触发,选择不更新 */
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="space-y-3">
      {loading ? (
        <div className="flex items-center justify-center py-6 text-text-tertiary">
          <Loader2 className="size-4 animate-spin" />
        </div>
      ) : (
        <>
          {current ? (
            <div className="rounded-md border border-accent-indigoLight bg-accent-primarySoft p-3">
              <div className="flex items-center gap-1.5">
                <Sparkles className="size-3.5 text-accent-indigoLight" />
                <span className="text-sm font-semibold text-text-primary">
                  {current.name}
                </span>
                <span className="ml-auto rounded-full bg-overlay-10 px-1.5 py-0.5 text-[10px] text-text-secondary">
                  当前
                </span>
              </div>
              {current.profile && (
                <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-text-secondary">
                  {current.profile}
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-overlay-15 bg-overlay-5 p-3 text-center">
              <p className="text-xs text-text-tertiary">
                本小说尚未选择作者画像
              </p>
            </div>
          )}

          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
              从库中选择
            </p>
            {profiles && profiles.length > 0 ? (
              <div className="space-y-1.5">
                {profiles.map((p) => {
                  const isSelected = p.id === currentProfileId
                  const isSaving = savingId === p.id
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => select(p.id)}
                      disabled={isSaving}
                      className={cn(
                        'w-full rounded-md border p-2.5 text-left transition-colors',
                        isSelected
                          ? 'border-accent-indigoLight bg-accent-primarySoft'
                          : 'border-overlay-15 bg-bg-cardElevated hover:bg-overlay-10'
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={cn(
                            'text-sm font-medium',
                            isSelected
                              ? 'text-text-primary'
                              : 'text-text-secondary'
                          )}
                        >
                          {p.name}
                        </span>
                        {isSaving && (
                          <Loader2 className="size-3 animate-spin text-text-tertiary" />
                        )}
                      </div>
                      {p.profile && (
                        <p className="mt-0.5 line-clamp-1 text-xs text-text-tertiary">
                          {p.profile}
                        </p>
                      )}
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs text-text-tertiary">
                画像库为空。前往「设置」创建作者画像。
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default VoiceProfileSelector
