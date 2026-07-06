# 参考资料面板视觉重做 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps use checkbox (`- [ ]`) syntax。

**Goal:** ReferencesView 重做 —— injectTo 分组 + 色带 + category pill + 可展开 + injectTo tint + 概览条。

**Architecture:** 纯 FE 单文件重写([ReferencesView.tsx](agent-ui/src/components/workspace/ReferencesView.tsx),142 → ~250 行)。**零 server / DB / agent / 类型 / API**(NovelReference 已有 `injectTo`/`category`/`source`)。injectTo 主轴分组(已关联按值分组 main/writer/both/角色名 + 库索引单节),category 辅助小标签,库索引中性灰。token 全复用现有(零 config 改动)。

**Tech Stack:** Next.js 15 + React 18 + TS + Tailwind v3 + lucide-react + 现有 MarkdownRenderer。

---

## File Structure

| 文件 | 改动 |
|---|---|
| [agent-ui/src/components/workspace/ReferencesView.tsx](agent-ui/src/components/workspace/ReferencesView.tsx) | 重写(单文件) |
| *(无其他文件改动)* | token 全复用,`tailwind.config.ts` / `globals.css` 不动 |

---

### Task 1: 常量层 + 数据分组 + import

**Files:**
- Modify: [agent-ui/src/components/workspace/ReferencesView.tsx](agent-ui/src/components/workspace/ReferencesView.tsx)(顶部)

- [ ] **Step 1: 替换文件顶部 import + 写常量与数据层**

替换 [ReferencesView.tsx](agent-ui/src/components/workspace/ReferencesView.tsx) 第 1-21 行(`'use client'` 到旧 `essence` 函数)为:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, CornerDownRight, Layers, Library, PenTool, Sparkles, User } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { useStore } from '@/store'
import { getNovelReferences } from '@/api/novels'
import type { NovelReference } from '@/types/novel'
import { cn } from '@/lib/utils'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'

type InjectMeta = {
  label: string
  band: string
  soft: string
  icon: LucideIcon
  tint: string | null
}

const MAIN_META: InjectMeta = { label: '注入 main', band: 'accent-primary', soft: 'accent-primarySoft', icon: Sparkles, tint: 'main agent(编排者)' }
const WRITER_META: InjectMeta = { label: '注入 writer', band: 'accent-violet', soft: 'accent-violetSoft', icon: PenTool, tint: 'writer agent(写手)' }
const BOTH_META: InjectMeta = { label: '注入 main+writer', band: 'accent-primary', soft: 'accent-primarySoft', icon: Layers, tint: 'main + writer' }
const LIBRARY_META: InjectMeta = { label: '资料库索引', band: 'text-label', soft: 'overlay-10', icon: Library, tint: null }

const INJECT_MAP: Record<string, InjectMeta> = {
  main: MAIN_META,
  writer: WRITER_META,
  both: BOTH_META,
}

// null → 库索引;INJECT_MAP 命中 → 对应 meta;否则 → 角色专属(label 用 injectTo 字符串)
function resolveInject(injectTo: string | null): InjectMeta {
  if (injectTo === null) return LIBRARY_META
  return INJECT_MAP[injectTo] ?? {
    label: `${injectTo} 专属`,
    band: 'accent-primary',
    soft: 'accent-primarySoft',
    icon: User,
    tint: `${injectTo} 相关上下文`,
  }
}

// Tailwind JIT 字面量 map:动态取色必须经此查找,模板字符串拼接会被 purge。
const BAND_CLASS: Record<string, string> = {
  'accent-primary': 'border-l-accent-primary',
  'accent-violet': 'border-l-accent-violet',
  'text-label': 'border-l-text-label',
}
const ICONBOX_BG: Record<string, string> = {
  'accent-primarySoft': 'bg-accent-primarySoft',
  'accent-violetSoft': 'bg-accent-violetSoft',
  'overlay-10': 'bg-overlay-10',
}
const ICON_FG: Record<string, string> = {
  'accent-primary': 'text-accent-primary',
  'accent-violet': 'text-accent-violet',
  'text-label': 'text-text-label',
}

const essence = (content: string): string => {
  const text = content
    .replace(/^#+\s*/m, '')
    .replace(/[*_`>-]/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)[0]
  if (!text) return ''
  return text.length > 60 ? text.slice(0, 60) + '…' : text
}

type RefGroup = { key: string; meta: InjectMeta; items: NovelReference[] }

// 已关联按 injectTo 分组(保序:main → writer → both → 各角色,按首次出现)+ 库索引单节(末尾)
function groupByInjectTo(refs: NovelReference[]): RefGroup[] {
  const linked: NovelReference[] = []
  const library: NovelReference[] = []
  for (const r of refs) (r.injectTo ? linked : library).push(r)
  const order: string[] = []
  const map: Record<string, NovelReference[]> = {}
  for (const r of linked) {
    const k = r.injectTo as string
    if (!map[k]) {
      order.push(k)
      map[k] = []
    }
    map[k].push(r)
  }
  const groups: RefGroup[] = order.map((k) => ({ key: k, meta: resolveInject(k), items: map[k] }))
  if (library.length) groups.push({ key: '__library__', meta: LIBRARY_META, items: library })
  return groups
}
```

- [ ] **Step 2: Commit**

```bash
git add agent-ui/src/components/workspace/ReferencesView.tsx
git commit -m "feat(references): 常量层 + 数据分组(injectTo 主轴)

INJECT_META 五类(main/writer/both/角色名/null)+ JIT-safe
BAND/ICONBOX/ICON 字面量 maps + resolveInject + groupByInjectTo + essence。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: 子组件(TypeIconBox + OverviewBar + FoldedEntry + ExpandedEntry)

**Files:**
- Modify: [agent-ui/src/components/workspace/ReferencesView.tsx](agent-ui/src/components/workspace/ReferencesView.tsx)(在 Task 1 的常量后、主组件前插入)

- [ ] **Step 1: TypeIconBox + OverviewBar**

```tsx
const TypeIconBox = ({ meta, size = 'sm' }: { meta: InjectMeta; size?: 'sm' | 'md' }) => {
  const px = size === 'md' ? 34 : 26
  const fs = size === 'md' ? 17 : 13
  const Icon = meta.icon
  return (
    <div
      className={cn('flex shrink-0 items-center justify-center rounded-full', ICONBOX_BG[meta.soft])}
      style={{ width: px, height: px }}
    >
      <Icon className={ICON_FG[meta.band]} style={{ width: fs, height: fs }} />
    </div>
  )
}

const OverviewBar = ({ refs }: { refs: NovelReference[] }) => {
  const total = refs.length
  const linked = refs.filter((r) => r.injectTo).length
  const library = total - linked
  return (
    <div className="flex items-center gap-2 rounded-md bg-overlay-5 px-2.5 py-2 text-xs">
      <span className="font-semibold text-text-primary">{total}</span>
      <span className="text-text-tertiary">条参考</span>
      <span className="text-text-label">·</span>
      <span className="font-semibold text-accent-indigoLight">{linked}</span>
      <span className="text-text-tertiary">已关联</span>
      <span className="text-text-label">·</span>
      <span className="font-semibold text-text-secondary">{library}</span>
      <span className="text-text-tertiary">库索引</span>
    </div>
  )
}
```

- [ ] **Step 2: FoldedEntry(折叠卡:色带 + TypeIconBox + 标题 + category pill + 摘要 + chevron)**

```tsx
const FoldedEntry = ({
  r,
  isOpen,
  onToggle,
}: {
  r: NovelReference
  isOpen: boolean
  onToggle: () => void
}) => {
  const meta = resolveInject(r.injectTo)
  return (
    <div
      className={cn(
        'rounded-md border border-l-2 border-overlay-15 bg-bg-cardElevated px-3 py-2.5',
        BAND_CLASS[meta.band]
      )}
    >
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-2.5 text-left">
        <TypeIconBox meta={meta} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-text-primary">{r.title}</span>
            {r.category && (
              <span className="shrink-0 rounded-full bg-overlay-10 px-1.5 py-0.5 text-[10px] font-medium text-text-tertiary">
                {r.category}
              </span>
            )}
          </div>
          {r.content && <p className="truncate text-xs text-text-tertiary">{essence(r.content)}</p>}
        </div>
        {isOpen ? (
          <ChevronDown className="size-3.5 shrink-0 text-text-label" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-text-label" />
        )}
      </button>
    </div>
  )
}
```

- [ ] **Step 3: ExpandedEntry(展开卡:injectTo tint + markdown body)**

```tsx
const ExpandedEntry = ({ r }: { r: NovelReference }) => {
  const meta = resolveInject(r.injectTo)
  return (
    <div className="mt-2 space-y-2.5 border-t border-overlay-10 pt-2.5">
      {/* injectTo tint 块:已关联显「注入 X · 自动带入」,库索引显「工具按需取」*/}
      <div className={cn('space-y-1 rounded-md px-2.5 py-2', ICONBOX_BG[meta.soft])}>
        {meta.tint ? (
          <div className="flex items-center gap-1.5">
            <CornerDownRight className={cn('size-3', ICON_FG[meta.band])} />
            <span className={cn('text-[10px] font-semibold tracking-wide', ICON_FG[meta.band])}>
              {meta.label} · 写作时自动带入 {meta.tint}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <Library className="size-3 text-text-secondary" />
            <span className="text-[10px] font-semibold tracking-wide text-text-secondary">
              资料库索引 · agent 用 get_reference 工具按需拉取
            </span>
          </div>
        )}
      </div>
      {/* markdown body */}
      {r.content ? (
        <div className="prose prose-invert max-w-none text-xs leading-relaxed text-text-secondary">
          <MarkdownRenderer>{r.content}</MarkdownRenderer>
        </div>
      ) : (
        <p className="text-xs text-text-tertiary">(无正文)</p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add agent-ui/src/components/workspace/ReferencesView.tsx
git commit -m "feat(references): 子组件(TypeIconBox/OverviewBar/FoldedEntry/ExpandedEntry)

- TypeIconBox:injectTo soft 底 + 色 icon(sm 26 / md 34)
- OverviewBar:总 / 已关联 / 库索引 三 stat
- FoldedEntry:色带 + TypeIconBox + 标题 + category pill + 摘要
- ExpandedEntry:injectTo tint(已关联显「注入 X · 自动带入」,库索引显「工具按需取」)+ markdown body

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: 主组件组装 + 清理旧代码 + validate

**Files:**
- Modify: [agent-ui/src/components/workspace/ReferencesView.tsx](agent-ui/src/components/workspace/ReferencesView.tsx)(替换默认 export)

- [ ] **Step 1: 替换主组件 ReferencesView**

删除旧的 `export const ReferencesView = ({ novel }) => { ... }` 整段(原第 29-142 行,含旧 `renderEntry` + 旧 return JSX),替换为:

```tsx
export const ReferencesView = ({ novel }: { novel: { id: string } }) => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const referenceWriteSeq = useStore((s) => s.referenceWriteSeq)
  const [refs, setRefs] = useState<NovelReference[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getNovelReferences(endpoint, token, novel.id)
      .then((d) => {
        if (!cancelled) setRefs(d)
      })
      .catch(() => {
        if (!cancelled) setRefs(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [endpoint, token, novel.id, referenceWriteSeq])

  if (loading) return <p className="text-sm text-text-tertiary">加载参考资料…</p>
  if (!refs || refs.length === 0) {
    return (
      <p className="text-sm text-text-tertiary">
        参考资料尚未生成。立项信息收集齐后,curator 子 agent
        会自动搜全局知识库并提炼本书专属参考资料(词汇/描写/方法论/须知等,带
        injectTo 标注),这里会逐条显示。
      </p>
    )
  }

  const groups = groupByInjectTo(refs)

  return (
    <div className="space-y-3">
      <OverviewBar refs={refs} />
      {groups.map((g) => {
        const GroupIcon = g.meta.icon
        return (
          <div key={g.key}>
            <div className="mb-1.5 flex items-center gap-1.5 px-1">
              <span className={cn('size-1.5 rounded-full', ICONBOX_BG[g.meta.soft])} />
              <GroupIcon className={cn('size-3', ICON_FG[g.meta.band])} />
              <span className="text-[10px] font-semibold tracking-wide text-text-tertiary">
                {g.meta.label}
              </span>
              <span className="text-[10px] text-text-label">· {g.items.length}</span>
            </div>
            <div className="space-y-1.5">
              {g.items.map((r) => {
                const isOpen = openId === r.id
                return (
                  <div key={r.id}>
                    <FoldedEntry
                      r={r}
                      isOpen={isOpen}
                      onToggle={() => setOpenId((cur) => (cur === r.id ? null : r.id))}
                    />
                    {isOpen && <ExpandedEntry r={r} />}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default ReferencesView
```

- [ ] **Step 2: 清理重复定义**

确保文件内:
- 只有一个 `essence`(Task 1 已定义,旧的被替换)。
- 旧 `renderEntry` 函数已删除。
- 旧 `tagged` / `library` 局部变量已删除(被 `groupByInjectTo` 取代)。
- 无未使用的 import(检查 `cn` / 所有 lucide icon 都在用)。

- [ ] **Step 3: validate(质量门)**

```bash
pnpm --dir agent-ui validate
```

Expected: lint + prettier + typecheck 全过(零 error)。常见报错点:
- `text-label` / `overlay-10` / `accent-violetSoft` 等类名未在 tailwind.config 注册 → 检查 [tailwind.config.ts](agent-ui/tailwind.config.ts)(这些 token 应已存在;若缺,先确认前 3 个模块的改动已合并)。
- `border-l-text-label` 未生成 → 确认 `text-label` 在 tailwind border 颜色里(Tailwind v3 颜色 token 自动可用于 border)。

- [ ] **Step 4: Commit**

```bash
git add agent-ui/src/components/workspace/ReferencesView.tsx
git commit -m "feat(references): 主组件组装(injectTo 分组 + 概览条 + 折叠/展开)

ReferencesView 重写:OverviewBar + groupByInjectTo 渲染(已关联按
injectTo 分组 main/writer/both/角色名 + 库索引单节),折叠卡色带 +
TypeIconBox + category pill,展开卡 injectTo tint + markdown body。

零 server/DB/agent/类型/API。Closes 参考资料面板重做。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:** spec 5 个问题 → task 覆盖:
- 灰卡海无分层 → Task 3 `groupByInjectTo` 4 分组 + 色点/图标/label/count ✓
- injectTo 语义丢 → Task 1 `INJECT_META` + Task 2 色带/TypeIconBox + tint ✓
- category 完全没用 → Task 2 FoldedEntry category pill ✓
- 无概览 → Task 2 OverviewBar ✓
- 展开无 tint → Task 2 ExpandedEntry injectTo tint ✓

**2. Placeholder scan:** 无 TBD/TODO,所有代码块完整可粘贴 ✓

**3. Type consistency:** `InjectMeta` / `RefGroup` / `resolveInject` / `groupByInjectTo` 跨 3 task 引用一致 ✓

**4. JIT safety:** `BAND_CLASS` / `ICONBOX_BG` / `ICON_FG` 字面量 map,无 `bg-${x}` 模板拼接 ✓

**5. per-side border:** `border-l-2 border-overlay-15` + `border-l-{color}`(沿用 character 范式,不用 `border-{color}` shorthand 染四边)✓

**6. 库索引中性灰:** `text-label` band + `overlay-10` soft + `Library` 图标,与已关联彩色组视觉对比 ✓

## Execution Handoff

Subagent-Driven(沿用前 3 个模块流程):
1. 建分支 `references-view-redesign`(从 main)
2. 每 task 派 fresh implementer subagent + 两阶段 review(spec compliance + code quality)
3. 全部完成后 whole-branch final review
4. fast-forward 合 main + 报告
