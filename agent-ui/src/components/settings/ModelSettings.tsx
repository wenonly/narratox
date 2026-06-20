'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/store'
import {
  activateModelConfig,
  createModelConfig,
  deleteModelConfig,
  listModelConfigs,
  updateModelConfig
} from '@/api/settings'
import type { ModelConfig, ModelProvider } from '@/types/settings'
import { MODEL_PROVIDER_PRESETS } from './model-presets'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface FormState {
  name: string
  provider: ModelProvider
  model: string
  baseUrl: string
  apiKey: string
  temperature: string
}

const EMPTY: FormState = {
  name: '',
  provider: 'openai-compatible',
  model: '',
  baseUrl: '',
  apiKey: '',
  temperature: ''
}

const presetFor = (provider: ModelProvider) =>
  MODEL_PROVIDER_PRESETS.find((p) => p.provider === provider) ??
  MODEL_PROVIDER_PRESETS[0]

const ModelSettings = () => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const [configs, setConfigs] = useState<ModelConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null) // null = 未选; 'new' = 新建
  const [form, setForm] = useState<FormState>(EMPTY)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setConfigs(await listModelConfigs(endpoint, token))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [endpoint, token])

  useEffect(() => {
    refresh()
  }, [refresh])

  const startNew = () => {
    setEditingId('new')
    setForm(EMPTY)
  }

  const selectConfig = (c: ModelConfig) => {
    setEditingId(c.id)
    setForm({
      name: c.name,
      provider: c.provider,
      model: c.model,
      baseUrl: c.baseUrl ?? '',
      apiKey: '', // 不回填;留空=不改
      temperature: c.temperature == null ? '' : String(c.temperature)
    })
  }

  const onProviderChange = (provider: ModelProvider) => {
    const preset = presetFor(provider)
    setForm((f) => ({
      ...f,
      provider,
      baseUrl: preset.needsBaseUrl ? (preset.baseUrl ?? '') : '',
      model: f.model || preset.model
    }))
  }

  const save = async () => {
    const temperature =
      form.temperature === '' ? undefined : Number(form.temperature)
    const payload = {
      name: form.name,
      provider: form.provider,
      model: form.model,
      baseUrl: form.provider === 'openai-compatible' ? form.baseUrl : undefined,
      apiKey: form.apiKey === '' ? undefined : form.apiKey,
      temperature
    }
    try {
      if (editingId === 'new') {
        if (!payload.apiKey) {
          toast.error('新建模型需要填写 API Key')
          return
        }
        await createModelConfig(endpoint, token, payload)
        toast.success('已新增')
      } else if (editingId) {
        await updateModelConfig(endpoint, token, editingId, payload)
        toast.success('已保存')
      }
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败')
    }
  }

  const activate = async (id: string) => {
    try {
      await activateModelConfig(endpoint, token, id)
      toast.success('已设为当前模型')
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '切换失败')
    }
  }

  const remove = async (id: string) => {
    if (!confirm('删除这个模型配置?')) return
    try {
      await deleteModelConfig(endpoint, token, id)
      if (editingId === id) setEditingId(null)
      toast.success('已删除')
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  const activeConfig = configs.find((c) => c.active)
  const preset = presetFor(form.provider)

  return (
    <div className="flex gap-6">
      {/* 左:配置列表 */}
      <div className="w-64 shrink-0 space-y-2">
        <Button
          onClick={startNew}
          className="h-9 w-full rounded-xl bg-primary text-xs text-background hover:bg-primary/80"
        >
          + 新建模型
        </Button>
        {loading ? (
          <p className="px-2 text-xs text-muted">加载中…</p>
        ) : (
          configs.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => selectConfig(c)}
              className={cn(
                'w-full rounded-xl border px-3 py-2 text-left text-sm transition-colors',
                editingId === c.id
                  ? 'border-brand bg-brand/10'
                  : 'border-primary/10 bg-background-secondary hover:bg-accent'
              )}
            >
              <div className="flex items-center justify-between">
                <span className="truncate font-medium text-primary">
                  {c.name}
                </span>
                {c.active && (
                  <span className="text-[10px] text-brand">当前</span>
                )}
              </div>
              <div className="truncate text-xs text-muted">
                {c.provider} · {c.model}
              </div>
            </button>
          ))
        )}
      </div>

      {/* 右:编辑器 */}
      <div className="flex-1">
        {editingId === null ? (
          <div className="rounded-xl border border-dashed border-primary/15 p-8 text-center text-sm text-muted">
            当前模型:
            {activeConfig
              ? `${activeConfig.name} (${activeConfig.model})`
              : '未配置'}
            <br />
            选择左侧一个模型编辑,或点「+ 新建模型」。
          </div>
        ) : (
          <div className="max-w-md space-y-4 text-sm">
            <Field label="名称">
              <input
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="如:我的 GLM"
                className="input-base"
              />
            </Field>
            <Field label="厂商">
              <select
                value={form.provider}
                onChange={(e) =>
                  onProviderChange(e.target.value as ModelProvider)
                }
                className="input-base"
              >
                {MODEL_PROVIDER_PRESETS.map((p) => (
                  <option key={p.id} value={p.provider}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="模型 ID">
              <input
                value={form.model}
                onChange={(e) =>
                  setForm((f) => ({ ...f, model: e.target.value }))
                }
                placeholder={preset.model}
                className="input-base"
              />
            </Field>
            {form.provider === 'openai-compatible' && (
              <Field label="Base URL">
                <input
                  value={form.baseUrl}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, baseUrl: e.target.value }))
                  }
                  placeholder={preset.baseUrl ?? ''}
                  className="input-base"
                />
              </Field>
            )}
            <Field
              label={editingId === 'new' ? 'API Key' : 'API Key(留空不修改)'}
            >
              <input
                type="password"
                value={form.apiKey}
                onChange={(e) =>
                  setForm((f) => ({ ...f, apiKey: e.target.value }))
                }
                placeholder={editingId === 'new' ? 'sk-...' : '••••••••'}
                className="input-base"
              />
            </Field>
            <Field label="温度(可选,0–2)">
              <input
                value={form.temperature}
                onChange={(e) =>
                  setForm((f) => ({ ...f, temperature: e.target.value }))
                }
                placeholder="0.5"
                className="input-base"
              />
            </Field>
            <div className="flex gap-2 pt-2">
              <Button
                onClick={save}
                className="rounded-xl bg-primary text-background hover:bg-primary/80"
              >
                {editingId === 'new' ? '创建' : '保存'}
              </Button>
              {editingId !== 'new' && editingId && (
                <>
                  <Button variant="ghost" onClick={() => activate(editingId)}>
                    设为当前
                  </Button>
                  <Button
                    variant="ghost"
                    className="text-muted"
                    onClick={() => remove(editingId)}
                  >
                    删除
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="block space-y-1.5">
    <span className="text-xs uppercase text-muted">{label}</span>
    {children}
  </label>
)

export default ModelSettings
