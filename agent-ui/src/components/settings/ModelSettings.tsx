'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useStore } from '@/store'
import {
  activateModel,
  deleteModel,
  deleteVendor,
  listVendors
} from '@/api/settings'
import type { Model, ModelProvider, Vendor } from '@/types/settings'
import { Button } from '@/components/ui/button'
import VendorFormDialog from './VendorFormDialog'
import ModelFormDialog from './ModelFormDialog'

/** 厂商 logo 配色(按 provider 映射,与 Pencil 设计色块对齐)。 */
const PROVIDER_COLOR: Record<ModelProvider, string> = {
  'openai-compatible': '#10A37F',
  anthropic: '#D97757',
  gemini: '#4285F4',
  deepseek: '#4D6BFE'
}

const ModelSettings = () => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)

  const [vendorDialog, setVendorDialog] = useState<{
    open: boolean
    vendor?: Vendor
  }>({ open: false })
  const [modelDialog, setModelDialog] = useState<{
    open: boolean
    vendorId?: string
    model?: Model
  }>({ open: false })

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

  const hasActiveVendor = vendors.some((v) => v.models.some((m) => m.active))

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <p className="text-xs text-text-tertiary">
          一家厂商 = 一组凭证(provider/baseUrl/API
          Key),下挂多个模型;选一个为默认。
        </p>
        <Button
          variant="gradient"
          className="ml-auto h-8 text-xs"
          onClick={() => setVendorDialog({ open: true })}
        >
          + 新建厂商
        </Button>
      </div>

      {loading ? (
        <p className="rounded-lg border border-overlay-15 bg-bg-card px-4 py-3 text-xs text-text-tertiary">
          加载中…
        </p>
      ) : vendors.length === 0 ? (
        <p className="rounded-lg border border-dashed border-overlay-15 px-4 py-6 text-center text-xs text-text-tertiary">
          还没有厂商。点「+ 新建厂商」添加。
        </p>
      ) : (
        <div className="space-y-2">
          {vendors.map((v) => {
            const logoColor = PROVIDER_COLOR[v.provider] ?? '#6B7280'
            const initial = (v.name.trim()[0] ?? '?').toUpperCase()
            return (
              <div
                key={v.id}
                className="rounded-lg border border-overlay-15 bg-bg-card px-4 py-3.5"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs font-semibold text-white"
                    style={{ backgroundColor: logoColor }}
                  >
                    {initial}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-text-primary">
                      {v.name}
                    </div>
                    <div className="truncate text-xs text-text-tertiary">
                      {v.provider}
                      {v.baseUrl ? ` · ${v.baseUrl}` : ''}
                      {!v.hasApiKey && ' · ⚠️ 未设 API Key'}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setModelDialog({ open: true, vendorId: v.id })
                      }
                      className="inline-flex h-[26px] items-center gap-1 rounded-sm px-2.5 text-xs text-text-tertiary transition-colors hover:bg-overlay-10 hover:text-text-primary"
                    >
                      <Plus size={12} />
                      添加
                    </button>
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        aria-label={`编辑厂商 ${v.name}`}
                        onClick={() =>
                          setVendorDialog({ open: true, vendor: v })
                        }
                        className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-sm text-text-tertiary transition-colors hover:bg-overlay-10 hover:text-text-primary"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        aria-label={`删除厂商 ${v.name}`}
                        onClick={() => onRemoveVendor(v)}
                        className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-sm text-text-tertiary transition-colors hover:bg-overlay-10 hover:text-destructive"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>

                {v.models.length === 0 ? (
                  <p className="mt-2 border-t border-overlay-10 pt-2 text-xs text-text-tertiary">
                    该厂商下还没有模型。
                  </p>
                ) : (
                  <div className="mt-2 space-y-1 border-t border-overlay-10 pt-2">
                    {v.models.map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center gap-2.5 rounded-md bg-overlay-5 px-2.5 py-2"
                      >
                        <span className="truncate text-sm font-medium text-text-primary">
                          {m.model}
                        </span>
                        <span className="shrink-0 text-xs text-text-label">
                          temp {m.temperature ?? '—'}
                        </span>
                        {m.active && (
                          <span className="shrink-0 rounded-full bg-accent-primarySoft px-2 py-0.5 text-[9px] font-semibold text-accent-indigoLight">
                            已激活
                          </span>
                        )}
                        <div className="ml-auto flex shrink-0 items-center gap-1">
                          {!m.active && (
                            <button
                              type="button"
                              onClick={() => onActivate(m.id)}
                              className="inline-flex h-6 items-center rounded-sm px-2 text-xs text-text-tertiary transition-colors hover:bg-overlay-10 hover:text-text-primary"
                            >
                              设默认
                            </button>
                          )}
                          <button
                            type="button"
                            aria-label={`编辑模型 ${m.model}`}
                            onClick={() =>
                              setModelDialog({
                                open: true,
                                vendorId: v.id,
                                model: m
                              })
                            }
                            className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-tertiary transition-colors hover:bg-overlay-10 hover:text-text-primary"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            type="button"
                            aria-label={`删除模型 ${m.model}`}
                            onClick={() => onRemoveModel(v, m)}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-tertiary transition-colors hover:bg-overlay-10 hover:text-destructive"
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
          })}
          {!hasActiveVendor && vendors.length > 0 && (
            <p className="pt-1 text-xs text-text-tertiary">
              提示:尚未选择默认模型,选一个模型点「设默认」即可。
            </p>
          )}
        </div>
      )}

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

export default ModelSettings
