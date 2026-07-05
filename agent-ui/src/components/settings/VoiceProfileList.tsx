'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { useStore } from '@/store'
import { Button } from '@/components/ui/button'
import { deleteVoiceProfile, listVoiceProfiles } from '@/api/settings'
import type { VoiceProfile } from '@/types/settings'
import VoiceProfileEditor from './VoiceProfileEditor'

/** 从 markdown profile 提取纯文本预览(去标题/列表/引用标记),取前 N 字作为卡片 tagline。 */
const toPreview = (profile: string, limit = 120): string => {
  const line = profile
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .filter(
      (l) => l && !l.startsWith('>') && !l.startsWith('-') && !l.startsWith('*')
    )
    .join(' · ')
    .slice(0, limit)
  return line
}

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
              className="flex flex-col rounded-lg border border-overlay-15 bg-bg-card p-4"
            >
              <h3 className="truncate text-sm font-semibold text-text-primary">
                {p.name}
              </h3>
              <p className="mt-1 line-clamp-2 flex-1 text-xs leading-relaxed text-text-tertiary">
                {toPreview(p.profile) || '(空画像)'}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-sm bg-accent-primarySoft px-2.5 py-1 text-xs font-medium text-accent-indigoLight transition-opacity hover:opacity-90"
                  onClick={() => setEditingId(p.id)}
                >
                  编辑
                </button>
                <button
                  type="button"
                  aria-label={`删除画像 ${p.name}`}
                  className="rounded px-2 py-1 text-text-tertiary transition-colors hover:bg-overlay-10 hover:text-destructive"
                  onClick={() => remove(p)}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default VoiceProfileList
