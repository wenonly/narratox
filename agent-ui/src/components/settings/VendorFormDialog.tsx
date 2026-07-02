'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/store'
import { createVendor, updateVendor } from '@/api/settings'
import type { ModelProvider, Vendor } from '@/types/settings'
import { PROVIDER_PRESETS, presetByProvider } from './model-presets'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import Field from './Field'

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
  vendor?: Vendor
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

  useEffect(() => {
    if (!open) return
    if (vendor) {
      const preset = presetByProvider(vendor.provider)
      setForm({
        name: vendor.name,
        provider: vendor.provider,
        baseUrl: vendor.baseUrl ?? preset.baseUrl,
        apiKey: ''
      })
    } else {
      setForm(emptyVendorForm())
    }
  }, [open, vendor])

  const onProviderChange = (provider: ModelProvider) => {
    const preset = presetByProvider(provider)
    setForm((f) => ({ ...f, provider, baseUrl: preset.baseUrl }))
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
          baseUrl: form.baseUrl === '' ? null : form.baseUrl,
          apiKey: form.apiKey === '' ? undefined : form.apiKey
        })
        toast.success('厂商已更新')
      } else {
        await createVendor(endpoint, token, {
          name: form.name.trim(),
          provider: form.provider,
          baseUrl: form.baseUrl === '' ? null : form.baseUrl,
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
              onChange={(e) => onProviderChange(e.target.value as ModelProvider)}
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
            <Button variant="default" onClick={save}>
              {isEdit ? '保存' : '创建'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default VendorFormDialog
