# UI Migration — Wave 1B-2a: Dialog fix + Knowledge + ModelSettings split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Dialog/input contrast (DialogContent `bg-bg-card`→`bg-bg-dark` per Token Spec §3.7, so `.input-base` fields read as raised), reskin the knowledge route to frame 07, and split the 615-line `ModelSettings.tsx` into 4 focused files (`Field`/`VendorFormDialog`/`ModelFormDialog`/`ModelSettings`) while reskinning all of them.

**Architecture:** The Dialog bg tweak is a 1-line change to a Wave 1A primitive that improves contrast for EVERY dialog form app-wide (Token Spec §3.7 explicitly allows dialog fill `#13131a`). Knowledge adopts `PageShell` (built in 1B-1) + KnowledgeBrowser rewires tokens + adopts `Badge` for tag pills. ModelSettings split is behavior-preserving: the 2 form dialogs + `Field` helper move to their own files (reskinned), the main list imports them and gets reskinned (vendor cards → `bg-bg-cardElevated`, model rows → `hover:bg-overlay-10`, `⭐ 默认` → `Badge accent`, CTAs → Button variants).

**Tech Stack:** Next.js 15 + React 18 + Tailwind v3.4 + cva + Radix Dialog + lucide-react. Wave 0/1A/1B-1 namespace + primitives active (`PageShell`, `Badge`, `Card`, Button `gradient`/`default`/`soft`). `cn()` at `@/lib/utils`. `.input-base` already migrated (1B-1 force-multiplier).

**Spec:** [Wave 1B execution design](../specs/2026-07-02-ui-migration-wave1b-design.md). Token values: [Token Spec](../specs/2026-07-02-ui-redesign-design.md).

**Verification:** No test runner — `pnpm validate` + grep + Playwright (auth-required: SSR check + optional visual via registered user). Run pnpm from `agent-ui/`.

**⚠ Opacity-modifier footgun:** `accent.*`/`text.*`/`bg.*` are bare `var()` — `/NN` DOESN'T work on them. Use `bg-accent-primarySoft`/`bg-overlay-10`/solid, or literal `bg-[#6366f1XX]`. Only functional colors (`destructive`/`success`/`warning`/`info`) support `/NN`.

---

## File Structure

- **Modify** `agent-ui/src/components/ui/dialog.tsx` — DialogContent `bg-bg-card`→`bg-bg-dark`.
- **Modify** `agent-ui/src/app/knowledge/page.tsx` — adopt PageShell.
- **Modify** `agent-ui/src/components/knowledge/KnowledgeBrowser.tsx` — token rewire + Badge for tags.
- **Create** `agent-ui/src/components/settings/Field.tsx` — shared label wrapper.
- **Create** `agent-ui/src/components/settings/VendorFormDialog.tsx` — extracted + reskinned.
- **Create** `agent-ui/src/components/settings/ModelFormDialog.tsx` — extracted + reskinned.
- **Modify** `agent-ui/src/components/settings/ModelSettings.tsx` — drop internal defs, import the 3, reskin list.

---

## Task 1: Dialog bg tweak (Token Spec §3.7)

**Files:** Modify `agent-ui/src/components/ui/dialog.tsx`

- [ ] **Step 1: Change DialogContent bg**

In `DialogContent`'s `className={cn(...)}` string, find `bg-bg-card` and change it to `bg-bg-dark`. The full token in the string is `... border border-overlay-15 bg-bg-card p-6 shadow-2xl ...` → change to `... border border-overlay-15 bg-bg-dark p-6 shadow-2xl ...`. (Only that one occurrence in DialogContent; leave everything else in dialog.tsx unchanged.)

Why: `.input-base` is `bg-bg-card` (#1A1A22); if DialogContent is also `bg-bg-card`, form inputs merge with the dialog bg. Token Spec §3.7 allows dialog fill `#13131a` (=`bg-bg-dark`), giving inputs a raised contrast. This improves ALL dialog forms app-wide.

- [ ] **Step 2: Verify + commit**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm typecheck
cd /Users/taowen/project/narratox && git add agent-ui/src/components/ui/dialog.tsx && git commit -m "fix(agent-ui): DialogContent bg-bg-card→bg-bg-dark (§3.7) for input contrast (Wave 1B-2a)"
```

---

## Task 2: Knowledge page adopts PageShell

**Files:** Modify `agent-ui/src/app/knowledge/page.tsx`

- [ ] **Step 1: Swap AppSidebar import for PageShell; replace the `Knowledge` return**

Change import line 7 from `import AppSidebar from '@/components/layout/AppSidebar'` to:
```tsx
import PageShell from '@/components/layout/PageShell'
```

Replace the `return (...)` inside `Knowledge` (lines 29-41) with:
```tsx
  return (
    <PageShell
      active="knowledge"
      title="写作知识库"
      subtitle={
        <>
          后端 {endpoint} ·{' '}
          {status === 200 ? '在线 ●' : `离线 (${status ?? '—'})`}
        </>
      }
    >
      <KnowledgeBrowser />
    </PageShell>
  )
```

(Imports for useEffect/useState, useStore, getStatusAPI, RequireAuth, KnowledgeBrowser stay. The status string moves into PageShell's `subtitle` prop.)

- [ ] **Step 2: Verify + commit**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm typecheck
cd /Users/taowen/project/narratox && git add agent-ui/src/app/knowledge/page.tsx && git commit -m "feat(agent-ui): knowledge page adopts PageShell (Wave 1B-2a)"
```

---

## Task 3: Reskin `KnowledgeBrowser` (frame 07)

**Files:** Modify `agent-ui/src/components/knowledge/KnowledgeBrowser.tsx`

- [ ] **Step 1: Add Badge import + replace the return JSX**

Add to imports (after the MarkdownRenderer import):
```tsx
import { Badge } from '@/components/ui/badge'
```

Replace the entire `return (...)` block (lines 57-150) with:

```tsx
  return (
    <div className="flex h-[calc(100vh-7rem)] gap-3">
      {/* 左栏:搜索 + 分类 + 列表 */}
      <div className="flex w-80 flex-col gap-2">
        <input
          className="w-full rounded-input border border-overlay-15 bg-bg-card px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-label"
          placeholder="🔍 搜索标题/描述"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex flex-wrap gap-1">
          <button
            className={cn(
              'rounded px-2 py-0.5 text-xs',
              !activeCat
                ? 'bg-accent-primarySoft font-medium text-text-primary'
                : 'text-text-tertiary hover:text-text-primary'
            )}
            onClick={() => setActiveCat(undefined)}
          >
            全部 {categories.reduce((s, c) => s + c.count, 0)}
          </button>
          {categories.map((c) => (
            <button
              key={c.name}
              className={cn(
                'rounded px-2 py-0.5 text-xs',
                activeCat === c.name
                  ? 'bg-accent-primarySoft font-medium text-text-primary'
                  : 'text-text-tertiary hover:text-text-primary'
              )}
              onClick={() => setActiveCat(c.name)}
            >
              {c.name} {c.count}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto rounded-md border border-overlay-15">
          {loading && (
            <p className="p-3 text-xs text-text-tertiary">加载中…</p>
          )}
          {!loading && entries.length === 0 && (
            <p className="p-3 text-xs text-text-tertiary">无匹配条目</p>
          )}
          {entries.map((e) => (
            <button
              key={e.id}
              onClick={() => setSelectedId(e.id)}
              className={cn(
                'block w-full border-b border-overlay-10 px-3 py-2 text-left transition-colors',
                selectedId === e.id
                  ? 'bg-accent-primarySoft'
                  : 'hover:bg-overlay-10'
              )}
            >
              <div className="flex items-center gap-1 text-sm text-text-primary">
                <span className="truncate">{e.name}</span>
              </div>
              <p className="truncate text-xs text-text-tertiary">
                {e.description}
              </p>
            </button>
          ))}
        </div>
        {tagList.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tagList.slice(0, 12).map((t) => (
              <Badge key={t} variant="neutral">
                #{t}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* 右栏:阅读器 */}
      <div className="flex-1 overflow-y-auto rounded-md border border-overlay-15 bg-bg-card p-6">
        {!detail && (
          <p className="text-sm text-text-tertiary">从左侧选一条查看正文。</p>
        )}
        {detail && (
          <>
            <h2 className="mb-1 text-base font-semibold text-text-primary">
              {detail.entry.name}
            </h2>
            <p className="mb-4 text-xs text-text-tertiary">
              {detail.entry.category}
              {detail.entry.tags.length > 0 &&
                ` · ${detail.entry.tags.map((t) => `#${t}`).join(' ')}`}
            </p>
            <article className="prose prose-invert max-w-none text-sm">
              <MarkdownRenderer>{detail.content}</MarkdownRenderer>
            </article>
          </>
        )}
      </div>
    </div>
  )
```

All hooks/logic (lines 11-55) UNCHANGED. Changes: search input rewired; category chips `bg-brand/15 text-primary`→`bg-accent-primarySoft text-text-primary`, inactive `text-muted`→`text-text-tertiary`; list border `border-primary/10`→`border-overlay-15`, row divider `border-primary/5`→`border-overlay-10`, selected `bg-accent`→`bg-accent-primarySoft`, hover `bg-accent/50`→`bg-overlay-10`; tag pills → `Badge variant="neutral"`; reader pane `bg-background/40`→`bg-bg-card`, border rewire; all `text-primary`→`text-text-primary`, `text-muted`→`text-text-tertiary`. `prose prose-invert` kept.

- [ ] **Step 2: Verify + commit**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm typecheck
cd /Users/taowen/project/narratox && git add agent-ui/src/components/knowledge/KnowledgeBrowser.tsx && git commit -m "feat(agent-ui): reskin KnowledgeBrowser to new tokens + Badge tags (Wave 1B-2a)"
```

---

## Task 4: Extract `Field` + `VendorFormDialog` + `ModelFormDialog`

**Files:** Create 3 new files under `agent-ui/src/components/settings/`. These extract components currently defined inside `ModelSettings.tsx` (behavior-preserving) + reskin them. `ModelSettings.tsx` still has its internal copies after this task (Task 5 removes them + imports the new ones).

- [ ] **Step 1: Create `Field.tsx`**

```tsx
import type { ReactNode } from 'react'

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="block space-y-1.5">
    <span className="text-xs uppercase text-text-tertiary">{label}</span>
    {children}
  </label>
)

export default Field
```

- [ ] **Step 2: Create `VendorFormDialog.tsx`**

```tsx
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
```

- [ ] **Step 3: Create `ModelFormDialog.tsx`**

```tsx
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
              onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
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
```

- [ ] **Step 4: Verify + commit (one commit for the 3 extracted files)**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm typecheck
cd /Users/taowen/project/narratox && git add agent-ui/src/components/settings/Field.tsx agent-ui/src/components/settings/VendorFormDialog.tsx agent-ui/src/components/settings/ModelFormDialog.tsx && git commit -m "refactor(agent-ui): extract Field/VendorFormDialog/ModelFormDialog out of ModelSettings (Wave 1B-2a)"
```

(typecheck passes because `ModelSettings.tsx` still defines + uses its OWN internal copies; the new files are self-contained and currently unused. Task 5 swaps ModelSettings to import them.)

---

## Task 5: Reskin `ModelSettings.tsx` (import extracted, reskin list)

**Files:** Modify `agent-ui/src/components/settings/ModelSettings.tsx`

- [ ] **Step 1: Replace the ENTIRE file**

This drops the internal `VendorFormDialog`/`ModelFormDialog`/`Field` definitions, imports the extracted files, and reskins the vendor/model list. Overwrite the whole file with:

```tsx
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
```

Changes: removed `VendorFormDialog`/`ModelFormDialog`/`Field`/`VendorFormState`/`ModelFormState`/`emptyVendorForm`/`emptyModelForm` definitions (now imported/separate); removed now-unused imports (`ReactNode`, Dialog bits, `createVendor`/`updateVendor`/`createModel`/`updateModel`, `ModelProvider`, `PROVIDER_PRESETS`/`presetByProvider`); added `Badge` + the two dialog imports. List reskin: `bg-background-secondary`→`bg-bg-cardElevated`, `border-primary/10`→`border-overlay-15`, `border-primary/15`→`border-overlay-15`, `hover:bg-accent`→`hover:bg-overlay-10`, `border-t border-primary/10`→`border-t border-overlay-10`, model name `text-primary`/`text-primary/90`→`text-text-primary`/`text-text-body` (no `/90` — opacity footgun), `bg-brand/15 text-brand` ⭐→`Badge accent`, `hover:border-brand/40`→`hover:border-accent-indigoLight`, CTA `bg-primary...`→`variant="gradient"`, all `text-muted`→`text-text-tertiary`, `text-primary`→`text-text-primary`. `confirm()` native dialogs unchanged.

- [ ] **Step 2: Verify**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm typecheck && pnpm validate
```
Expected: PASS. (No duplicate-declaration errors — the internal defs are gone, the imports resolve.)

- [ ] **Step 3: Commit**

```bash
cd /Users/taowen/project/narratox && git add agent-ui/src/components/settings/ModelSettings.tsx && git commit -m "feat(agent-ui): reskin ModelSettings list + use extracted dialogs (Wave 1B-2a)"
```

---

## Task 6: Wave 1B-2a gate

**Files:** none (verification)

- [ ] **Step 1: Full gate**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm validate
```
Expected: PASS. If prettier fails, `pnpm format:fix` + re-run.

- [ ] **Step 2: camelCase hygiene grep (expect ZERO)**

```bash
cd /Users/taowen/project/narratox && grep -rnE "accent-(indigo|violet)-(light|pale|mid)|accent-primary-soft|bg-card-elevated" agent-ui/src/app/knowledge agent-ui/src/components/knowledge agent-ui/src/components/settings
```
Expected: zero matches.

- [ ] **Step 3: Old-token grep on Wave 1B-2a files (expect ZERO)**

```bash
cd /Users/taowen/project/narratox && grep -rnE "(^|[^-])(bg-brand|bg-background|bg-background-secondary|bg-primary|text-primary|text-muted|border-primary|border-white/20|border-white/10|text-brand)([^a-z-]|$)" agent-ui/src/app/knowledge/page.tsx agent-ui/src/components/knowledge/KnowledgeBrowser.tsx agent-ui/src/components/settings/Field.tsx agent-ui/src/components/settings/VendorFormDialog.tsx agent-ui/src/components/settings/ModelFormDialog.tsx agent-ui/src/components/settings/ModelSettings.tsx
```
Expected: zero matches.

- [ ] **Step 4: Split verification — ModelSettings.tsx no longer defines the dialogs/Field**

```bash
cd /Users/taowen/project/narratox && grep -c "const VendorFormDialog\|const ModelFormDialog\|const Field" agent-ui/src/components/settings/ModelSettings.tsx
```
Expected: `0` (they're imported now, not defined). And confirm the 3 new files exist + export them:
```bash
grep -l "export default VendorFormDialog" agent-ui/src/components/settings/VendorFormDialog.tsx && \
grep -l "export default ModelFormDialog" agent-ui/src/components/settings/ModelFormDialog.tsx && \
grep -l "export default Field" agent-ui/src/components/settings/Field.tsx
```

- [ ] **Step 5: SSR check**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm dev > /tmp/w1b2a-dev.log 2>&1 &
sleep 18
curl -s -o /dev/null -w "/knowledge HTTP %{http_code} (307/200 OK)\n" http://localhost:3000/knowledge
curl -s -o /dev/null -w "/login    HTTP %{http_code}\n" http://localhost:3000/login
grep -iE "error|cannot|undefined|failed|✗ Compilation" /tmp/w1b2a-dev.log | head || echo "no errors ✓"
pkill -f "next dev" 2>/dev/null || true
```
Expected: login 200, knowledge 307/200 (redirect when unauthed), no compile errors. (Full visual of knowledge/settings needs a logged-in session — user smoke-test; the dialog bg tweak is visually confirmed by opening any dialog.)

- [ ] **Step 6: Commit any formatting fixes**

```bash
cd /Users/taowen/project/narratox && git add -u && git diff --cached --quiet || git commit -m "style(agent-ui): prettier fixes (Wave 1B-2a gate)"
```

- [ ] **Step 7: Mark Wave 1B-2a complete**

Wave 1B-2a is done when: `pnpm validate` green; camelCase + old-token greps clean; ModelSettings split verified (0 internal defs, 3 new files export); knowledge SSRs without error. Next: Plan 1B-2b (settings page + AgentModelSettings + VoiceProfile{List,Editor} + W1-Gate).

---

## Self-Review (completed)

- **Spec coverage:** Dialog bg fix (1B brainstorm decision) → Task 1. Knowledge (1B spec §3 W1B-2 + frame 07) → Tasks 2-3. ModelSettings split (1B spec §2.2) → Tasks 4-5. Force-multiplier (.input-base) already done in 1B-1 — Tasks 4-5 rely on it (form inputs use `input-base`). Ad-hoc token mappings (1B spec §2.3) → KnowledgeBrowser + ModelSettings. Opacity footgun respected (model name uses `text-text-body` not `text-text-primary/90`).
- **Placeholder scan:** No TBD/TODO. Task 6 visual is honestly conditional (auth-required).
- **Type consistency:** `Field` exported as default from `./Field`; both dialogs `import Field from './Field'`; ModelSettings `import VendorFormDialog from './VendorFormDialog'` + `ModelFormDialog from './ModelFormDialog'` — all match the file names/exports. `Badge` variant `accent`/`neutral` match Wave 0 definition. Button `variant="gradient"`/`"default"`/`"ghost"` match Wave 1A. PageShell props `active`/`title`/`subtitle`/`children` match Task 2 usage. No `/NN` opacity on bare-var tokens anywhere (`text-text-body` used instead of `/90`; `bg-accent-primarySoft`/`bg-overlay-10` for tints). ModelSettings no longer imports `cn` from nowhere — still used for active/inactive model color. Removed imports (`createVendor`/`updateModel`/etc.) are NOT referenced anywhere in the new ModelSettings body (they moved to the dialog files) — verified each.
```
```
