'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/store'
import {
  activateModel,
  createModel,
  createVendor,
  deleteModel,
  deleteVendor,
  listVendors,
  updateModel,
  updateVendor
} from '@/api/settings'
import type { Model, ModelProvider, Vendor } from '@/types/settings'
import { PROVIDER_PRESETS, presetByProvider } from './model-presets'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/* -------------------------------------------------------------------------- */
/* 厂商表单弹窗(新建 / 编辑)                                                  */
/* -------------------------------------------------------------------------- */

interface VendorFormState {
  name: string
  provider: ModelProvider
  baseUrl: string
  apiKey: string
}

const emptyVendorForm = (): VendorFormState => ({
  name: '',
  provider: 'openai-compatible',
  baseUrl: '',
  apiKey: ''
})

interface VendorFormDialogProps {
  open: boolean
  onClose: () => void
  vendor?: Vendor // undefined = 新建
  onSaved: () => void
}

const VendorFormDialog = ({
  open,
  onClose,
  vendor,
  onSaved
}: VendorFormDialogProps) => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const isEdit = Boolean(vendor)
  const [form, setForm] = useState<VendorFormState>(emptyVendorForm())

  // 弹窗每次打开重置一次表单
  useEffect(() => {
    if (!open) return
    if (vendor) {
      const preset = presetByProvider(vendor.provider)
      setForm({
        name: vendor.name,
        provider: vendor.provider,
        baseUrl: vendor.baseUrl ?? preset.baseUrl,
        apiKey: '' // 留空 = 不改
      })
    } else {
      setForm(emptyVendorForm())
    }
  }, [open, vendor])

  const onProviderChange = (provider: ModelProvider) => {
    const preset = presetByProvider(provider)
    setForm((f) => ({
      ...f,
      provider,
      baseUrl: preset.baseUrl // 选 provider 自动预填默认 baseUrl
    }))
  }

  const save = async () => {
    if (!form.name.trim()) {
      toast.error('请填写厂商名称')
      return
    }
    if (!isEdit && !form.apiKey.trim()) {
      toast.error('新建厂商需要填写 API Key')
      return
    }
    try {
      if (isEdit && vendor) {
        await updateVendor(endpoint, token, vendor.id, {
          name: form.name.trim(),
          provider: form.provider,
          baseUrl: form.baseUrl === '' ? undefined : form.baseUrl,
          apiKey: form.apiKey === '' ? undefined : form.apiKey
        })
        toast.success('厂商已更新')
      } else {
        await createVendor(endpoint, token, {
          name: form.name.trim(),
          provider: form.provider,
          baseUrl: form.baseUrl === '' ? undefined : form.baseUrl,
          apiKey: form.apiKey
        })
        toast.success('厂商已新增')
      }
      onSaved()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑厂商' : '新建厂商'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <Field label="厂商名称">
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="如:DeepSeek / 我的 GLM"
              className="input-base"
            />
          </Field>
          <Field label="Provider">
            <select
              value={form.provider}
              onChange={(e) =>
                onProviderChange(e.target.value as ModelProvider)
              }
              className="input-base"
            >
              {PROVIDER_PRESETS.map((p) => (
                <option key={p.provider} value={p.provider}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Base URL(留空走 provider 默认端点)">
            <input
              value={form.baseUrl}
              onChange={(e) =>
                setForm((f) => ({ ...f, baseUrl: e.target.value }))
              }
              placeholder="https://..."
              className="input-base"
            />
          </Field>
          <Field label={isEdit ? 'API Key(留空不修改)' : 'API Key'}>
            <input
              type="password"
              value={form.apiKey}
              onChange={(e) =>
                setForm((f) => ({ ...f, apiKey: e.target.value }))
              }
              placeholder={isEdit ? '••••••••' : 'sk-...'}
              className="input-base"
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button
              onClick={save}
              className="rounded-xl bg-primary text-background hover:bg-primary/80"
            >
              {isEdit ? '保存' : '创建'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* -------------------------------------------------------------------------- */
/* 模型表单弹窗(新建 / 编辑)                                                  */
/* -------------------------------------------------------------------------- */

interface ModelFormState {
  model: string
  temperature: string
  name: string
}

const emptyModelForm = (): ModelFormState => ({
  model: '',
  temperature: '',
  name: ''
})

interface ModelFormDialogProps {
  open: boolean
  onClose: () => void
  vendorId: string
  model?: Model // undefined = 新建
  onSaved: () => void
}

const ModelFormDialog = ({
  open,
  onClose,
  vendorId,
  model,
  onSaved
}: ModelFormDialogProps) => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const isEdit = Boolean(model)
  const [form, setForm] = useState<ModelFormState>(emptyModelForm())

  useEffect(() => {
    if (!open) return
    if (model) {
      setForm({
        model: model.model,
        temperature: model.temperature == null ? '' : String(model.temperature),
        name: model.name ?? ''
      })
    } else {
      setForm(emptyModelForm())
    }
  }, [open, model])

  const save = async () => {
    if (!form.model.trim()) {
      toast.error('请填写模型 ID')
      return
    }
    const temperature =
      form.temperature === '' ? undefined : Number(form.temperature)
    if (temperature != null && Number.isNaN(temperature)) {
      toast.error('温度需为数字')
      return
    }
    try {
      if (isEdit && model) {
        await updateModel(endpoint, token, model.id, {
          model: form.model.trim(),
          temperature,
          name: form.name.trim() || undefined
        })
        toast.success('模型已更新')
      } else {
        if (!vendorId) {
          toast.error('缺少厂商')
          return
        }
        await createModel(endpoint, token, vendorId, {
          model: form.model.trim(),
          temperature,
          name: form.name.trim() || undefined
        })
        toast.success('模型已新增')
      }
      onSaved()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败')
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑模型' : '加模型'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <Field label="模型 ID">
            <input
              value={form.model}
              onChange={(e) =>
                setForm((f) => ({ ...f, model: e.target.value }))
              }
              placeholder="如:deepseek-chat / glm-4-plus"
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
          <Field label="显示名(可选)">
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="如:主力 / 备用"
              className="input-base"
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button
              onClick={save}
              className="rounded-xl bg-primary text-background hover:bg-primary/80"
            >
              {isEdit ? '保存' : '创建'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* -------------------------------------------------------------------------- */
/* 厂商单列分组主区                                                            */
/* -------------------------------------------------------------------------- */

const ModelSettings = () => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)

  // 厂商/模型弹窗状态
  const [vendorDialog, setVendorDialog] = useState<{
    open: boolean
    vendor?: Vendor
  }>({ open: false })
  const [modelDialog, setModelDialog] = useState<{
    open: boolean
    vendorId?: string
    model?: Model
  }>({ open: false })
  // 展开的厂商 id(默认全部展开)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setVendors(await listVendors(endpoint, token))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [endpoint, token])

  useEffect(() => {
    refresh()
  }, [refresh])

  const onActivate = async (id: string) => {
    try {
      await activateModel(endpoint, token, id)
      toast.success('已设为默认模型')
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '设默认失败')
    }
  }

  const onRemoveModel = async (v: Vendor, m: Model) => {
    if (!confirm(`删除模型「${m.name ?? m.model}」?`)) return
    try {
      await deleteModel(endpoint, token, m.id)
      toast.success('已删除')
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  const onRemoveVendor = async (v: Vendor) => {
    const hint =
      v.models.length > 0
        ? `删除厂商「${v.name}」及其 ${v.models.length} 个模型?`
        : `删除厂商「${v.name}」?`
    if (!confirm(hint)) return
    try {
      await deleteVendor(endpoint, token, v.id)
      toast.success('已删除')
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const hasActiveVendor = vendors.some((v) => v.models.some((m) => m.active))

  return (
    <div className="space-y-3">
      {/* 顶部说明 + 新建厂商 */}
      <div className="flex items-center gap-3">
        <p className="text-xs text-muted">
          一家厂商 = 一组凭证(provider/baseUrl/API
          Key),下挂多个模型;选一个为默认。
        </p>
        <Button
          onClick={() => setVendorDialog({ open: true })}
          className="ml-auto h-8 rounded-xl bg-primary text-xs text-background hover:bg-primary/80"
        >
          + 新建厂商
        </Button>
      </div>

      {loading ? (
        <p className="rounded-xl border border-primary/10 bg-background-secondary px-4 py-3 text-xs text-muted">
          加载中…
        </p>
      ) : vendors.length === 0 ? (
        <p className="rounded-xl border border-dashed border-primary/15 px-4 py-6 text-center text-xs text-muted">
          还没有厂商。点「+ 新建厂商」添加。
        </p>
      ) : (
        <div className="space-y-2">
          {vendors.map((v) => {
            const isCollapsed = collapsed.has(v.id)
            return (
              <div
                key={v.id}
                className="rounded-xl border border-primary/10 bg-background-secondary"
              >
                {/* 厂商头部 */}
                <div className="flex items-center gap-2 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => toggleCollapse(v.id)}
                    className="shrink-0 text-xs text-muted hover:text-primary"
                    aria-label={isCollapsed ? '展开' : '收起'}
                  >
                    {isCollapsed ? '▸' : '▾'}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-primary">
                      {v.name}
                    </div>
                    <div className="truncate text-xs text-muted">
                      {v.provider}
                      {v.baseUrl ? ` · ${v.baseUrl}` : ''}
                      {!v.hasApiKey && ' · ⚠️ 未设 API Key'}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setVendorDialog({ open: true, vendor: v })}
                    >
                      编辑
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-muted"
                      onClick={() => onRemoveVendor(v)}
                    >
                      删
                    </Button>
                  </div>
                </div>

                {/* 模型行 */}
                {!isCollapsed && (
                  <div className="border-t border-primary/10 px-4 py-2">
                    {v.models.length === 0 ? (
                      <p className="py-2 text-xs text-muted">
                        该厂商下还没有模型。
                      </p>
                    ) : (
                      <div className="space-y-1">
                        {v.models.map((m) => (
                          <div
                            key={m.id}
                            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-accent"
                          >
                            <span
                              className={cn(
                                'truncate',
                                m.active ? 'text-primary' : 'text-primary/90'
                              )}
                            >
                              {m.model}
                            </span>
                            <span className="shrink-0 text-xs text-muted">
                              · temp {m.temperature ?? '—'}
                            </span>
                            {m.active && (
                              <span className="shrink-0 rounded bg-brand/15 px-1.5 py-0.5 text-[10px] text-brand">
                                ⭐ 默认
                              </span>
                            )}
                            <div className="ml-auto flex shrink-0 gap-1">
                              {!m.active && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-xs"
                                  onClick={() => onActivate(m.id)}
                                >
                                  设默认
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-xs"
                                onClick={() =>
                                  setModelDialog({
                                    open: true,
                                    vendorId: v.id,
                                    model: m
                                  })
                                }
                              >
                                编辑
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-xs text-muted"
                                onClick={() => onRemoveModel(v, m)}
                              >
                                删
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* 加模型 */}
                    <button
                      type="button"
                      onClick={() =>
                        setModelDialog({ open: true, vendorId: v.id })
                      }
                      className="mt-1 w-full rounded-lg border border-dashed border-primary/15 px-2 py-1.5 text-xs text-muted hover:border-brand/40 hover:text-primary"
                    >
                      + 加模型
                    </button>
                  </div>
                )}
              </div>
            )
          })}
          {!hasActiveVendor && vendors.length > 0 && (
            <p className="pt-1 text-xs text-muted">
              提示:尚未选择默认模型,选一个模型点「设默认」即可。
            </p>
          )}
        </div>
      )}

      {/* 弹窗(新建/编辑厂商 + 加模型/编辑模型) */}
      <VendorFormDialog
        open={vendorDialog.open}
        vendor={vendorDialog.vendor}
        onClose={() => setVendorDialog({ open: false })}
        onSaved={refresh}
      />
      <ModelFormDialog
        open={modelDialog.open}
        vendorId={modelDialog.vendorId ?? ''}
        model={modelDialog.model}
        onClose={() => setModelDialog({ open: false })}
        onSaved={refresh}
      />
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
