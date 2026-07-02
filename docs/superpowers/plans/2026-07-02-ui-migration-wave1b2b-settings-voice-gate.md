# UI Migration — Wave 1B-2b: Settings page + Agent/Voice + W1-Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Wave 1 — reskin the settings route's remaining components (settings page shell → PageShell, AgentModelSettings, VoiceProfileList, VoiceProfileEditor) to frames 12-16, then run the W1-Gate hard grep proving every Wave 1 route file has zero old-token references.

**Architecture:** All 4 files apply the now-established recipe (old→new tokens, adopt `Button` variants + `Badge`, `border-white/*`→`overlay-*`). settings/page adopts `PageShell` (built 1B-1). AgentModelSettings' tier colors map to functional colors (`destructive`/`warningText`/`success`). VoiceProfileEditor's 2 primary CTAs convert to `<Button>`. Logic is preserved everywhere (JSX/token-only changes). W1-Gate confirms Wave 1 completeness: old tokens may remain ONLY in workspace/dissect (Wave 2/3).

**Tech Stack:** Next.js 15 + React 18 + Tailwind v3.4. `PageShell`, `Button` (`gradient`/`default`/`ghost`/`outline`), `Badge`, `.input-base` all active. `cn()` at `@/lib/utils`.

**Spec:** [Wave 1B execution design](../specs/2026-07-02-ui-migration-wave1b-design.md). Token values: [Token Spec](../specs/2026-07-02-ui-redesign-design.md).

**Verification:** No test runner — `pnpm validate` + grep + Playwright (auth-required: SSR check). Run pnpm from `agent-ui/`.

**⚠ Opacity-modifier footgun:** `accent.*`/`text.*`/`bg.*` bare `var()` — no `/NN`. Use `bg-accent-primarySoft`/`bg-overlay-10`/solid. Only functional colors (`destructive`/`success`/`warning`/`info`) support `/NN`.

---

## File Structure

- **Modify** `agent-ui/src/app/settings/page.tsx` — adopt PageShell.
- **Modify** `agent-ui/src/components/settings/AgentModelSettings.tsx` — reskin + tier colors → functional colors.
- **Modify** `agent-ui/src/components/settings/VoiceProfileList.tsx` — reskin + CTA → Button.
- **Modify** `agent-ui/src/components/settings/VoiceProfileEditor.tsx` — reskin + 2 CTAs → Button.

---

## Task 1: settings page adopts PageShell

**Files:** Modify `agent-ui/src/app/settings/page.tsx`

- [ ] **Step 1: Replace the file**

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useStore } from '@/store'
import { getStatusAPI } from '@/api/os'
import RequireAuth from '@/components/auth/RequireAuth'
import PageShell from '@/components/layout/PageShell'
import AgentModelSettings from '@/components/settings/AgentModelSettings'
import ModelSettings from '@/components/settings/ModelSettings'
import VoiceProfileList from '@/components/settings/VoiceProfileList'

export default function SettingsPage() {
  return (
    <RequireAuth>
      <Settings />
    </RequireAuth>
  )
}

const Settings = () => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const [status, setStatus] = useState<number | null>(null)

  useEffect(() => {
    getStatusAPI(endpoint, token)
      .then(setStatus)
      .catch(() => setStatus(503))
  }, [endpoint, token])

  return (
    <PageShell
      active="settings"
      title="设置"
      subtitle={
        <>
          后端 {endpoint} ·{' '}
          {status === 200 ? '在线 ●' : `离线 (${status ?? '—'})`}
        </>
      }
    >
      <h2 className="mb-2 text-sm font-semibold text-text-primary">模型设置</h2>
      <div className="mb-10">
        <ModelSettings />
      </div>

      <div className="mb-10">
        <AgentModelSettings />
      </div>

      <h2 className="mb-2 text-sm font-semibold text-text-primary">作者画像</h2>
      <p className="mb-3 text-xs text-text-tertiary">
        画像库 · 不同类型的书可建不同声音,每本小说在工作台单独选用
      </p>
      <VoiceProfileList />
    </PageShell>
  )
}
```

(Import swap: `AppSidebar`→`PageShell`. Status line → `subtitle`. h2/desc tokens migrated. The 3 section components unchanged.)

- [ ] **Step 2: Verify + commit**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm typecheck
cd /Users/taowen/project/narratox && git add agent-ui/src/app/settings/page.tsx && git commit -m "feat(agent-ui): settings page adopts PageShell (Wave 1B-2b)"
```

---

## Task 2: Reskin `AgentModelSettings`

**Files:** Modify `agent-ui/src/components/settings/AgentModelSettings.tsx`

- [ ] **Step 1: Replace the file (logic unchanged; tokens + tier colors migrated)**

```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/store'
import {
  listAgentModels,
  listAgentTree,
  listVendors,
  putAgentModel
} from '@/api/settings'
import type {
  AgentGroup,
  AgentOverride,
  RecommendedTier,
  Vendor
} from '@/types/settings'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

const TIER_LABEL: Record<RecommendedTier, string> = {
  strong: '🔴 推荐强',
  mid: '🟡 推荐中',
  cheap: '💚 推荐便宜'
}
const TIER_COLOR: Record<RecommendedTier, string> = {
  strong: 'text-destructive',
  mid: 'text-warningText',
  cheap: 'text-success'
}

const AgentModelSettings = () => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const [open, setOpen] = useState(false)
  const [groups, setGroups] = useState<AgentGroup[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [overrides, setOverrides] = useState<Record<string, AgentOverride>>({})
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [g, v, o] = await Promise.all([
        listAgentTree(endpoint, token),
        listVendors(endpoint, token),
        listAgentModels(endpoint, token)
      ])
      setGroups(g)
      setVendors(v)
      setOverrides(o)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [endpoint, token])

  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])

  const onChange = async (
    agentKey: string,
    modelId: string,
    temperature: number | null
  ) => {
    const prevEntry = overrides[agentKey]

    try {
      setOverrides((prev) => ({
        ...prev,
        ...(!modelId && temperature == null
          ? {}
          : { [agentKey]: { modelId, temperature } })
      }))
      await putAgentModel(endpoint, token, agentKey, {
        modelId: modelId || undefined,
        temperature
      })
      if (!modelId && temperature == null) {
        setOverrides((prev) => {
          const next = { ...prev }
          delete next[agentKey]
          return next
        })
      }
      toast.success('已保存')
    } catch (err) {
      setOverrides((prev) => {
        const next = { ...prev }
        if (prevEntry) next[agentKey] = prevEntry
        else delete next[agentKey]
        return next
      })
      toast.error(err instanceof Error ? err.message : '保存失败')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-3 rounded-lg border border-overlay-15 bg-bg-cardElevated px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-text-primary">
            按 Agent 分配模型
          </div>
          <div className="truncate text-xs text-text-tertiary">
            为各 Agent 单独指定模型与温度,未指定则跟随默认模型
          </div>
        </div>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="ml-auto shrink-0">
            管理
          </Button>
        </DialogTrigger>
      </div>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>按 Agent 分配模型</DialogTitle>
          <DialogDescription>
            为各 Agent
            单独指定模型与温度,未指定则跟随默认模型。推荐级别仅作参考。
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <p className="py-4 text-xs text-text-tertiary">加载中…</p>
        ) : (
          <div className="scrollbar-none -mx-1 min-h-0 flex-1 overflow-y-auto px-1">
            <div className="space-y-5">
              {groups.map((g) => (
                <div key={g.group}>
                  <h3 className="mb-2 text-xs font-semibold uppercase text-text-tertiary">
                    {g.group}
                  </h3>
                  <div className="space-y-1.5">
                    {g.agents.map((a) => (
                      <div
                        key={a.key}
                        className="flex items-center gap-3 rounded-lg border border-overlay-15 bg-bg-cardElevated px-3 py-2"
                      >
                        <div className="w-40 shrink-0">
                          <div className="text-sm text-text-primary">
                            {a.key}
                          </div>
                          <div className="truncate text-xs text-text-tertiary">
                            {a.description}
                          </div>
                        </div>
                        <span
                          className={`text-[10px] ${TIER_COLOR[a.recommendedTier]}`}
                        >
                          {TIER_LABEL[a.recommendedTier]}
                        </span>
                        <select
                          value={overrides[a.key]?.modelId ?? ''}
                          onChange={(e) =>
                            onChange(
                              a.key,
                              e.target.value,
                              overrides[a.key]?.temperature ?? null
                            )
                          }
                          className="input-base ml-auto w-44"
                        >
                          <option value="">默认</option>
                          {vendors.map((v) => (
                            <optgroup key={v.id} label={v.name}>
                              {v.models.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.model}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        <input
                          type="number"
                          step="0.1"
                          min={0}
                          max={2}
                          value={overrides[a.key]?.temperature ?? ''}
                          onChange={(e) =>
                            onChange(
                              a.key,
                              overrides[a.key]?.modelId ?? '',
                              e.target.value === ''
                                ? null
                                : Number(e.target.value)
                            )
                          }
                          placeholder="0.5"
                          className="input-base w-16"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default AgentModelSettings
```

Changes: `TIER_COLOR` `text-red-400/yellow-400/green-400`→`text-destructive/warningText/success`; entry card + agent rows `border-primary/10 bg-background-secondary`→`border-overlay-15 bg-bg-cardElevated`; all `text-primary`→`text-text-primary`, `text-muted`→`text-text-tertiary`; `input-base` (select/number) already new from force-multiplier. ALL logic (refresh/onChange rollback/state) byte-identical.

- [ ] **Step 2: Verify + commit**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm typecheck
cd /Users/taowen/project/narratox && git add agent-ui/src/components/settings/AgentModelSettings.tsx && git commit -m "feat(agent-ui): reskin AgentModelSettings + tier colors→functional (Wave 1B-2b)"
```

---

## Task 3: Reskin `VoiceProfileList`

**Files:** Modify `agent-ui/src/components/settings/VoiceProfileList.tsx`

- [ ] **Step 1: Add Button import + replace the list-state return**

Add the Button import (after the MarkdownRenderer import line):
```tsx
import { Button } from '@/components/ui/button'
```

Replace the ENTIRE list-state `return (...)` (the second return, after the `if (creating || editingProfile)` early return) with:

```tsx
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
              className="flex flex-col rounded-lg border border-overlay-15 bg-bg-cardElevated p-4"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="truncate text-sm font-semibold text-text-primary">
                  {p.name}
                </h3>
                <div className="flex shrink-0 gap-2">
                  <button
                    className="text-xs text-text-tertiary hover:text-text-primary"
                    onClick={() => setEditingId(p.id)}
                  >
                    编辑
                  </button>
                  <button
                    className="text-xs text-text-tertiary hover:text-destructive"
                    onClick={() => remove(p)}
                  >
                    删除
                  </button>
                </div>
              </div>
              <div className="max-h-40 overflow-hidden rounded-md bg-bg-card p-2 text-xs leading-relaxed text-text-primary">
                {p.profile ? (
                  p.profile.length > PREVIEW_LIMIT ? (
                    <span className="text-text-tertiary">
                      {p.profile.slice(0, PREVIEW_LIMIT)}…
                    </span>
                  ) : (
                    <MarkdownRenderer>{p.profile}</MarkdownRenderer>
                  )
                ) : (
                  <span className="text-text-tertiary">(空画像)</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
```

(The `if (creating || editingProfile) return <VoiceProfileEditor ...>` early return + ALL hooks/handlers above it UNCHANGED. Changes: CTA `bg-brand`→`Button variant="gradient"`; empty `border-white/20`→`border-overlay-15`; cards `border-white/20 bg-background-secondary`→`border-overlay-15 bg-bg-cardElevated`; preview `bg-background text-primary`→`bg-bg-card text-text-primary`; all `text-muted`→`text-text-tertiary`; delete hover `text-brand`→`text-destructive`.)

- [ ] **Step 2: Verify + commit**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm typecheck
cd /Users/taowen/project/narratox && git add agent-ui/src/components/settings/VoiceProfileList.tsx && git commit -m "feat(agent-ui): reskin VoiceProfileList + CTA→Button (Wave 1B-2b)"
```

---

## Task 4: Reskin `VoiceProfileEditor`

**Files:** Modify `agent-ui/src/components/settings/VoiceProfileEditor.tsx`

- [ ] **Step 1: Add Button import + replace the return JSX**

Add the Button import (after the MarkdownRenderer import):
```tsx
import { Button } from '@/components/ui/button'
```

Replace the ENTIRE `return (...)` block with:

```tsx
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
                className="text-text-tertiary hover:text-text-primary"
                onClick={() =>
                  setSamples((prev) => prev.filter((_, idx) => idx !== i))
                }
              >
                删
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
```

(All hooks/logic — `doGenerate`/`startManual`/`save`/state — UNCHANGED. Changes: container/inputs/textareas `border-white/20`→`border-overlay-15`, `bg-background(-secondary)`→`bg-bg-card(Elevated)`; edit/preview tab toggle `bg-accent text-primary`→`bg-accent-primarySoft text-text-primary`, inactive `text-muted`→`text-text-tertiary`; save/create + 从样本生成 → `<Button variant="default"/"gradient" size="sm">`; `text-brand`→`text-accent-indigoLight`; `border-white/10`→`border-overlay-10`; `font-mono` KEPT (editor monospace, not dmmono); all `text-primary`→`text-text-primary`, `text-muted`→`text-text-tertiary`.)

- [ ] **Step 2: Verify + commit**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm typecheck && pnpm validate
cd /Users/taowen/project/narratox && git add agent-ui/src/components/settings/VoiceProfileEditor.tsx && git commit -m "feat(agent-ui): reskin VoiceProfileEditor + CTAs→Button (Wave 1B-2b)"
```

---

## Task 5: W1-Gate (Wave 1 finale)

**Files:** none (verification)

- [ ] **Step 1: Full gate**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm validate
```
Expected: PASS. If prettier fails, `pnpm format:fix` + re-run.

- [ ] **Step 2: W1-Gate hard grep — ALL Wave 1 route files zero old-token (expect ZERO)**

```bash
cd /Users/taowen/project/narratox && grep -rnE "(^|[^-])(bg-brand|bg-background|bg-background-secondary|bg-primary|text-primary|text-muted|border-primary|border-white/20|border-white/10|text-brand|font-dmmono)([^a-z-]|$)" \
  agent-ui/src/app/page.tsx \
  'agent-ui/src/app/(auth)' \
  agent-ui/src/app/knowledge \
  agent-ui/src/app/settings \
  agent-ui/src/components/layout \
  agent-ui/src/components/library \
  agent-ui/src/components/knowledge \
  agent-ui/src/components/settings \
  agent-ui/src/components/auth
```
Expected: ZERO matches. (The `(^|[^-])...([^a-z-]|$)` anchors avoid false-positives on `text-text-primary`/`bg-bg-card`/`border-overlay-15`/`bg-accent-primary`. `bg-destructive`/`text-success`/`text-warningText` are allowed functional colors — not in this list.) If ANY match, fix it before proceeding.

- [ ] **Step 3: Confirm old tokens remain ONLY in Wave 2/3 (workspace/dissect)**

```bash
cd /Users/taowen/project/narratox && echo "old-token files OUTSIDE Wave 1 (should all be workspace/dissect/chat):" && grep -rlE "(^|[^-])(bg-brand|bg-background|bg-primary|text-primary|text-muted|border-primary)([^a-z-]|$)" agent-ui/src --include="*.tsx" | sort
```
Expected: matches ONLY under `components/chat/`, `components/workspace/`, `components/dissect/`, `app/novels/`, `app/dissect/`. NO `library`/`knowledge`/`settings`/`auth`/`layout` files. (These stragglers are Wave 2/3's job.)

- [ ] **Step 4: SSR check**

```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm dev > /tmp/w1b2b-dev.log 2>&1 &
sleep 18
curl -s -o /dev/null -w "/settings  HTTP %{http_code}\n" http://localhost:3000/settings
curl -s -o /dev/null -w "/knowledge HTTP %{http_code}\n" http://localhost:3000/knowledge
curl -s -o /dev/null -w "/login     HTTP %{http_code}\n" http://localhost:3000/login
grep -iE "error|cannot|undefined|failed|✗ Compilation" /tmp/w1b2b-dev.log | head || echo "no errors ✓"
pkill -f "next dev" 2>/dev/null || true
```
Expected: all 200 (or 307 redirect for settings/knowledge when unauthed — both OK), no compile errors. (Full visual needs a logged-in session — user smoke-test: login → settings → open Vendor/Model/AgentModel dialogs → VoiceProfile create/edit.)

- [ ] **Step 5: Commit formatting fixes**

```bash
cd /Users/taowen/project/narratox && git add -u && git diff --cached --quiet || git commit -m "style(agent-ui): prettier fixes (Wave 1B-2b gate)"
```

- [ ] **Step 6: Mark Wave 1 COMPLETE**

Wave 1 is done when: `pnpm validate` green; W1-Gate grep zero; old tokens confined to workspace/dissect; all routes SSR clean. **Wave 1 (auth + library + knowledge + settings + shared atoms + AppSidebar) is fully on the new design system.** Next: Wave 2 (workspace — `/novels/[id]`, IconRail/Chat/ResourcePanel + 10 views).

---

## Self-Review (completed)

- **Spec coverage:** settings page → PageShell (1B spec §3 W1B-2) → Task 1. AgentModelSettings + VoiceProfile{List,Editor} reskin → Tasks 2-4. W1-Gate (1B spec §4 + Wave 1 spec §4) → Task 5. Ad-hoc mappings (`border-white/*`→`overlay-*`, `text-brand`→`accent-indigoLight`/`destructive`, `bg-brand`→`Button`) → Tasks 3-4. Force-multiplier `.input-base` (1B-1) used by AgentModelSettings inputs. Opacity footgun respected (no `/NN` on bare-var tokens; tab toggle uses `bg-accent-primarySoft`).
- **Placeholder scan:** No TBD/TODO. Task 5 visual honestly conditional (auth-required).
- **Type consistency:** `Button` variants used (`gradient`/`default`/`outline`/`ghost`) all exist (Wave 1A). `PageShell` props match Task 1 usage (`active="settings" title="设置" subtitle={...}`). `text-destructive`/`text-warningText`/`text-success` are the functional-color text utilities (Tailwind keys `destructive`/`warningText`/`success`). `bg-accent-primarySoft` resolves. No `/NN` on bare-var tokens. `font-mono` kept (Tailwind built-in, not the old `font-dmmono`). All logic (AgentModelSettings onChange/rollback, VoiceProfile generate/save, VoiceProfileList editor-swap) byte-identical to base.
```
```
