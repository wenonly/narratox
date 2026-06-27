'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/store'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'
import {
  generateVoiceProfile,
  getVoiceProfile,
  putVoiceProfile
} from '@/api/settings'

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

type Phase = 'loading' | 'empty' | 'ready'

const VoiceProfile = () => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const [phase, setPhase] = useState<Phase>('loading')
  const [profile, setProfile] = useState('')
  const [dirty, setDirty] = useState(false)
  const [view, setView] = useState<'edit' | 'preview'>('edit')
  const [samples, setSamples] = useState<string[]>([''])
  const [generating, setGenerating] = useState(false)

  const load = useCallback(async () => {
    setPhase('loading')
    try {
      const p = await getVoiceProfile(endpoint, token)
      if (p) {
        setProfile(p)
        setPhase('ready')
      } else {
        setPhase('empty')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载失败')
      setPhase('empty')
    }
  }, [endpoint, token])

  useEffect(() => {
    load()
  }, [load])

  const startManual = () => {
    setProfile(TEMPLATE)
    setDirty(true)
    setPhase('ready')
  }

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
      setProfile(out)
      setDirty(true)
      setPhase('ready')
      setView('edit')
      toast.success('已生成,请审阅后点「保存」')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '生成失败')
    } finally {
      setGenerating(false)
    }
  }

  const save = async () => {
    try {
      await putVoiceProfile(endpoint, token, profile)
      setDirty(false)
      toast.success('已保存 · 下次写章生效')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败')
    }
  }

  if (phase === 'loading') return <p className="text-xs text-muted">加载中…</p>

  if (phase === 'empty') {
    return (
      <div className="rounded-xl border border-white/20 bg-background-secondary p-5">
        <p className="mb-4 text-sm text-muted">
          还没有作者画像。AI
          会照它写的腔调写作、并用它当尺子校验。留空则用默认写作风格。
        </p>
        <div className="mb-6 space-y-2">
          <p className="text-xs text-muted">
            粘贴 1-5 段你最像自己风格的文字,AI 据此归纳:
          </p>
          {samples.map((s, i) => (
            <div key={i} className="flex gap-2">
              <textarea
                className="min-h-[80px] flex-1 resize-y rounded-md border border-white/20 bg-background px-3 py-2 font-mono text-xs text-primary"
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
                  className="text-muted hover:text-primary"
                  onClick={() =>
                    setSamples((prev) => prev.filter((_, idx) => idx !== i))
                  }
                >
                  删
                </button>
              )}
            </div>
          ))}
          <button
            className="text-xs text-brand"
            onClick={() => setSamples((prev) => [...prev, ''])}
          >
            + 添加一段
          </button>
        </div>
        <div className="flex gap-2">
          <button
            className="rounded-md bg-brand px-4 py-2 text-sm text-primary disabled:opacity-50"
            disabled={generating}
            onClick={doGenerate}
          >
            {generating ? '正在归纳你的声音…' : '从我的写作生成'}
          </button>
          <button
            className="rounded-md border border-white/20 px-4 py-2 text-sm text-primary"
            onClick={startManual}
          >
            手动编辑模板
          </button>
        </div>
      </div>
    )
  }

  // ready
  return (
    <div className="rounded-xl border border-white/20 bg-background-secondary p-5">
      <div className="mb-3 flex items-center gap-2">
        <span
          className={`cursor-pointer rounded-md px-3 py-1 text-xs ${view === 'edit' ? 'bg-accent text-primary' : 'text-muted'}`}
          onClick={() => setView('edit')}
        >
          ✎ 编辑
        </span>
        <span
          className={`cursor-pointer rounded-md px-3 py-1 text-xs ${view === 'preview' ? 'bg-accent text-primary' : 'text-muted'}`}
          onClick={() => setView('preview')}
        >
          👁 预览
        </span>
        <span className="flex-1" />
        <button
          className="rounded-md border border-white/20 px-3 py-1 text-xs text-muted"
          onClick={() => {
            setProfile('')
            setSamples([''])
            setPhase('empty')
          }}
        >
          ↻ 重新生成
        </button>
        <button
          className="rounded-md bg-brand px-4 py-1 text-xs text-primary disabled:opacity-50"
          disabled={!dirty}
          onClick={save}
        >
          保存
        </button>
      </div>
      {view === 'edit' ? (
        <textarea
          className="min-h-[320px] w-full resize-y rounded-md border border-white/20 bg-background p-3 font-mono text-xs leading-relaxed text-primary"
          value={profile}
          onChange={(e) => {
            setProfile(e.target.value)
            setDirty(true)
          }}
        />
      ) : (
        <div className="min-h-[320px] w-full rounded-md border border-white/20 bg-background p-3 text-xs leading-relaxed text-primary">
          <MarkdownRenderer>{profile}</MarkdownRenderer>
        </div>
      )}
      <p className="mt-2 text-xs text-muted">保存后即时生效 · 下次写章即注入</p>
    </div>
  )
}

export default VoiceProfile
