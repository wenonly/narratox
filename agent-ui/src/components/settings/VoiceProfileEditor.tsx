'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { useStore } from '@/store'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'
import { Button } from '@/components/ui/button'
import {
  createVoiceProfile,
  generateVoiceProfile,
  updateVoiceProfile
} from '@/api/settings'
import type { VoiceProfile } from '@/types/settings'

const TEMPLATE = `# 作者画像
## 语调与节奏
(整体气质、句长节奏……)
## 标志句式
- (口头禅、句式、段尾习惯)
## 专属意象
- (反复用的意象/物件/感官词)
## 用词偏好
- (动词风格、口语化/书面化)
## 要避免(AI 套路)
- (此外 / 仿佛…一般 / 胸口发紧……)
## 代表性片段
> (摘 1-2 段你最有代表性的原文)`

interface Props {
  profile?: VoiceProfile
  onSaved: () => void
  onCancel: () => void
}

const VoiceProfileEditor = ({ profile, onSaved, onCancel }: Props) => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)

  const isEdit = Boolean(profile)

  const [name, setName] = useState(profile?.name ?? '')
  const [content, setContent] = useState(profile?.profile ?? '')
  const [view, setView] = useState<'edit' | 'preview'>('edit')
  const [samples, setSamples] = useState<string[]>([''])
  const [generating, setGenerating] = useState(false)
  const [dirty, setDirty] = useState(false)

  const doGenerate = async () => {
    const filled = samples.map((s) => s.trim()).filter(Boolean)
    if (!filled.length) {
      toast.error('请至少粘贴一段你的文字')
      return
    }
    setGenerating(true)
    try {
      const { profile: out } = await generateVoiceProfile(endpoint, token, {
        samples: filled
      })
      setContent(out)
      setDirty(true)
      setView('preview')
      toast.success('已生成,请审阅后点「保存」')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '生成失败')
    } finally {
      setGenerating(false)
    }
  }

  const startManual = () => {
    setContent(TEMPLATE)
    setDirty(true)
    setView('edit')
  }

  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('请填写画像名称')
      return
    }
    try {
      if (isEdit && profile) {
        await updateVoiceProfile(endpoint, token, profile.id, {
          name: trimmed,
          profile: content
        })
      } else {
        await createVoiceProfile(endpoint, token, {
          name: trimmed,
          profile: content
        })
      }
      setDirty(false)
      toast.success(isEdit ? '已保存 · 下次写章生效' : '已创建 · 下次写章生效')
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败')
    }
  }

  return (
    <div className="rounded-lg border border-overlay-15 bg-bg-cardElevated p-5">
      {/* 名称 + 视图切换 + 保存/取消 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setDirty(true)
          }}
          placeholder="画像名称(如:武侠风 / 都市口语)"
          className="min-w-[200px] flex-1 rounded-md border border-overlay-15 bg-bg-card px-3 py-1.5 text-sm text-text-primary placeholder:text-text-label"
        />
        <span
          className={`cursor-pointer rounded-md px-3 py-1 text-xs ${view === 'edit' ? 'bg-accent-primarySoft text-text-primary' : 'text-text-tertiary'}`}
          onClick={() => setView('edit')}
        >
          ✎ 编辑
        </span>
        <span
          className={`cursor-pointer rounded-md px-3 py-1 text-xs ${view === 'preview' ? 'bg-accent-primarySoft text-text-primary' : 'text-text-tertiary'}`}
          onClick={() => setView('preview')}
        >
          👁 预览
        </span>
        <span className="flex-1" />
        <button
          className="rounded-md border border-overlay-15 px-3 py-1 text-xs text-text-tertiary"
          onClick={onCancel}
        >
          取消
        </button>
        <Button variant="default" size="sm" disabled={!dirty} onClick={save}>
          {isEdit ? '保存' : '创建'}
        </Button>
      </div>

      {/* 主体:编辑/预览 */}
      {view === 'edit' ? (
        <textarea
          className="min-h-[280px] w-full resize-y rounded-md border border-overlay-15 bg-bg-card p-3 font-mono text-xs leading-relaxed text-text-primary"
          value={content}
          onChange={(e) => {
            setContent(e.target.value)
            setDirty(true)
          }}
          placeholder="画像 Markdown……"
        />
      ) : (
        <div className="min-h-[280px] w-full rounded-md border border-overlay-15 bg-bg-card p-3 text-xs leading-relaxed text-text-primary">
          {content ? (
            <MarkdownRenderer>{content}</MarkdownRenderer>
          ) : (
            <span className="text-text-tertiary">
              还没有内容,切换到「编辑」开始写。
            </span>
          )}
        </div>
      )}

      {/* 从样本生成 */}
      <div className="mt-4 space-y-2 border-t border-overlay-10 pt-4">
        <p className="text-xs text-text-tertiary">
          {content
            ? '从样本重新生成会覆盖当前内容。'
            : '粘贴 1-5 段你最像自己风格的文字,AI 据此归纳:'}
        </p>
        {samples.map((s, i) => (
          <div key={i} className="flex gap-2">
            <textarea
              className="min-h-[70px] flex-1 resize-y rounded-md border border-overlay-15 bg-bg-card px-3 py-2 font-mono text-xs text-text-primary"
              placeholder={`第 ${i + 1} 段样本…`}
              value={s}
              onChange={(e) =>
                setSamples((prev) =>
                  prev.map((p, idx) => (idx === i ? e.target.value : p))
                )
              }
            />
            {samples.length > 1 && (
              <button
                type="button"
                aria-label={`删除第 ${i + 1} 段样本`}
                className="self-start rounded p-2 text-text-tertiary transition-colors hover:bg-overlay-10 hover:text-destructive"
                onClick={() =>
                  setSamples((prev) => prev.filter((_, idx) => idx !== i))
                }
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
        <div className="flex gap-2">
          <button
            className="text-xs text-accent-indigoLight"
            onClick={() => setSamples((prev) => [...prev, ''])}
          >
            + 添加一段
          </button>
          <span className="flex-1" />
          <Button
            variant="gradient"
            size="sm"
            disabled={generating}
            onClick={doGenerate}
          >
            {generating ? '正在归纳你的声音…' : '从样本生成'}
          </Button>
          <button
            className="rounded-md border border-overlay-15 px-3 py-1.5 text-xs text-text-primary"
            onClick={startManual}
          >
            手动编辑模板
          </button>
        </div>
      </div>

      <p className="mt-2 text-xs text-text-tertiary">
        保存后即时生效 · 下次写章即注入
      </p>
    </div>
  )
}

export default VoiceProfileEditor
