'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/store'
import {
  activateModel,
  deleteModel,
  deleteVendor,
  listVendors
} from '@/api/settings'
import type { Model, Vendor } from '@/types/settings'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import VendorFormDialog from './VendorFormDialog'
import ModelFormDialog from './ModelFormDialog'

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
        <p className="rounded-lg border border-overlay-15 bg-bg-cardElevated px-4 py-3 text-xs text-text-tertiary">
          加载中…
        </p>
      ) : vendors.length === 0 ? (
        <p className="rounded-lg border border-dashed border-overlay-15 px-4 py-6 text-center text-xs text-text-tertiary">
          还没有厂商。点「+ 新建厂商」添加。
        </p>
      ) : (
        <div className="space-y-2">
          {vendors.map((v) => {
            const isCollapsed = collapsed.has(v.id)
            return (
              <div
                key={v.id}
                className="rounded-lg border border-overlay-15 bg-bg-cardElevated"
              >
                <div className="flex items-center gap-2 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => toggleCollapse(v.id)}
                    className="shrink-0 text-xs text-text-tertiary hover:text-text-primary"
                    aria-label={isCollapsed ? '展开' : '收起'}
                  >
                    {isCollapsed ? '▸' : '▾'}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-text-primary">
                      {v.name}
                    </div>
                    <div className="truncate text-xs text-text-tertiary">
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
                      className="h-7 text-xs text-text-tertiary"
                      onClick={() => onRemoveVendor(v)}
                    >
                      删
                    </Button>
                  </div>
                </div>

                {!isCollapsed && (
                  <div className="border-t border-overlay-10 px-4 py-2">
                    {v.models.length === 0 ? (
                      <p className="py-2 text-xs text-text-tertiary">
                        该厂商下还没有模型。
                      </p>
                    ) : (
                      <div className="space-y-1">
                        {v.models.map((m) => (
                          <div
                            key={m.id}
                            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-overlay-10"
                          >
                            <span
                              className={cn(
                                'truncate',
                                m.active
                                  ? 'text-text-primary'
                                  : 'text-text-body'
                              )}
                            >
                              {m.model}
                            </span>
                            <span className="shrink-0 text-xs text-text-tertiary">
                              · temp {m.temperature ?? '—'}
                            </span>
                            {m.active && (
                              <Badge variant="accent">⭐ 默认</Badge>
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
                                className="h-6 px-2 text-xs text-text-tertiary"
                                onClick={() => onRemoveModel(v, m)}
                              >
                                删
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setModelDialog({ open: true, vendorId: v.id })
                      }
                      className="mt-1 w-full rounded-md border border-dashed border-overlay-15 px-2 py-1.5 text-xs text-text-tertiary hover:border-accent-indigoLight hover:text-text-primary"
                    >
                      + 加模型
                    </button>
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
