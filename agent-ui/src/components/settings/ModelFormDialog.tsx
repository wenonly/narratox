'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/store'
import { createModel, updateModel } from '@/api/settings'
import type { Model } from '@/types/settings'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import Field from './Field'

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
  model?: Model
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
            <Button variant="default" onClick={save}>
              {isEdit ? '保存' : '创建'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default ModelFormDialog
