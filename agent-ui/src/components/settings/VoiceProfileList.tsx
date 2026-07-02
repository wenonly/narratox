'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/store'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'
import { Button } from '@/components/ui/button'
import { deleteVoiceProfile, listVoiceProfiles } from '@/api/settings'
import type { VoiceProfile } from '@/types/settings'
import VoiceProfileEditor from './VoiceProfileEditor'

/** 截断预览:超过 N 字省略,避免卡片过高。 */
const PREVIEW_LIMIT = 180

const VoiceProfileList = () => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)

  const [profiles, setProfiles] = useState<VoiceProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setProfiles(await listVoiceProfiles(endpoint, token))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [endpoint, token])

  useEffect(() => {
    refresh()
  }, [refresh])

  const closeEditor = () => {
    setCreating(false)
    setEditingId(null)
  }

  const handleSaved = async () => {
    await refresh()
    closeEditor()
  }

  const remove = async (p: VoiceProfile) => {
    if (!confirm(`删除画像「${p.name}」?`)) return
    try {
      await deleteVoiceProfile(endpoint, token, p.id)
      toast.success('已删除')
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败')
    }
  }

  const editingProfile = profiles.find((p) => p.id === editingId) ?? null

  // 编辑/新建态:展示编辑器
  if (creating || editingProfile) {
    return (
      <VoiceProfileEditor
        profile={editingProfile ?? undefined}
        onSaved={handleSaved}
        onCancel={closeEditor}
      />
    )
  }

  // 列表态
  return (
    <div className="space-y-3">
      <div>
        <Button variant="gradient" onClick={() => setCreating(true)}>
          + 新建画像
        </Button>
      </div>

      {loading ? (
        <p className="text-xs text-text-tertiary">加载中…</p>
      ) : profiles.length === 0 ? (
        <div className="rounded-lg border border-dashed border-overlay-15 p-6 text-center text-sm text-text-tertiary">
          还没有作者画像。点「+ 新建画像」添加,或从样本生成。
          <br />
          AI 会照画像的腔调写作、并用它当尺子校验。
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {profiles.map((p) => (
            <div
              key={p.id}
              className="flex flex-col rounded-lg border border-overlay-15 bg-bg-cardElevated p-4"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="truncate text-sm font-semibold text-text-primary">
                  {p.name}
                </h3>
                <div className="flex shrink-0 gap-2">
                  <button
                    className="text-xs text-text-tertiary hover:text-text-primary"
                    onClick={() => setEditingId(p.id)}
                  >
                    编辑
                  </button>
                  <button
                    className="text-xs text-text-tertiary hover:text-destructive"
                    onClick={() => remove(p)}
                  >
                    删除
                  </button>
                </div>
              </div>
              <div className="max-h-40 overflow-hidden rounded-md bg-bg-card p-2 text-xs leading-relaxed text-text-primary">
                {p.profile ? (
                  p.profile.length > PREVIEW_LIMIT ? (
                    <span className="text-text-tertiary">
                      {p.profile.slice(0, PREVIEW_LIMIT)}…
                    </span>
                  ) : (
                    <MarkdownRenderer>{p.profile}</MarkdownRenderer>
                  )
                ) : (
                  <span className="text-text-tertiary">(空画像)</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default VoiceProfileList
