# ChaptersView 三态重做 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把工作区右侧资源面板的「章节」模块从「内嵌 TOC 挤压正文」重做为「三态互斥全屏切换」(列表态 / 正文态 / 写作中骨架屏态),并补齐长篇场景下的搜索 + 卷折叠 + 状态过滤能力。

**Architecture:** `ChaptersView` 瘦身为三态路由(持有 `OutlineData` + `tocOpen` state),委托给 `ChapterListPage`(R-TOC)和 `ChapterReadingPage`(R-Reading,含 skeleton 变体)。卷分组用纯函数 `groupChaptersByVolume`(三层映射优先级:ChapterOutline.volumeId → Arc 范围 → 未分卷兜底)。

**Tech Stack:** Next.js 15 (App Router) + React 18 + TypeScript + Tailwind + Zustand + lucide-react。

**Spec:** [docs/superpowers/specs/2026-07-06-chapters-view-three-state-redesign-design.md](../specs/2026-07-06-chapters-view-three-state-redesign-design.md)

**Pencil 三帧(设计权威):** R-TOC=`Bcz70` / R-Reading=`UUCpA` / R-Writing=`GMp9L`(在 `design/narratox.pen`,导出 PNG 在 `design/_exports/`)。

---

## 关键约束(已验证)

- **`Novel` 类型只有 `chapters`**(无 `volumes`/`arcs`/`outlines`)—— OutlineData 通过 `getOutline(endpoint, token, novelId)` 单独 fetch(参照 [OutlineView.tsx:204-219](../../../agent-ui/src/components/workspace/views/OutlineView.tsx#L204-L219) 的模式)。
- **agent-ui 无 test runner**(无 Jest/Vitest/Playwright)—— 质量门是 `pnpm --dir agent-ui validate`(lint + format + typecheck)。纯函数靠类型 + manual 验证(浏览器看分组对不对)。
- **`writingChapterOrder` / `currentChapterOrder` / `manualLock` / `outlineWriteSeq` 已在 Zustand store**(ChaptersView/OutlineView 已用)。
- **store 字段:** `currentChapterOrder` / `setCurrentChapterOrder` / `manualLock` / `setManualLock` / `writingChapterOrder` / `bumpChapterWriteSeq` / `outlineWriteSeq`。
- **不进 store 的状态(视图本地):** `tocOpen` / `searchQuery` / `activeFilter` / `collapsedVolumes` / `editing` / `draft` —— 组件 unmount 丢失可接受。

---

## File Structure

| 文件 | 责任 | 创建/修改 |
|---|---|---|
| `agent-ui/src/lib/volume-grouping.ts` | 纯函数:`groupChaptersByVolume` + `findVolumeForChapter` | **创建** |
| `agent-ui/src/components/workspace/views/chapters/chapter-types.ts` | 共享类型:`StatusFilter` | **创建** |
| `agent-ui/src/components/workspace/views/chapters/ChapterSkeleton.tsx` | 写作中骨架屏(从 ChaptersView 抽出) | **创建(抽取)** |
| `agent-ui/src/components/workspace/views/chapters/ChapterEditor.tsx` | 编辑模式(从 ChaptersView 抽出) | **创建(抽取)** |
| `agent-ui/src/components/workspace/views/chapters/WritingPill.tsx` | 写作跟随 pill(从 ChaptersView 抽出) | **创建(抽取)** |
| `agent-ui/src/components/workspace/views/chapters/ChapterReadingPage.tsx` | R-Reading 正文态 + skeleton 变体 | **创建** |
| `agent-ui/src/components/workspace/views/chapters/ChapterListPage.tsx` | R-TOC 列表态(搜索/过滤/卷折叠) | **创建** |
| `agent-ui/src/components/workspace/views/ChaptersView.tsx` | 三态路由 + OutlineData fetch | **修改(瘦身)** |

**抽取动机:** 当前 [ChaptersView.tsx](../../../agent-ui/src/components/workspace/views/ChaptersView.tsx) 388 行,内联 4 个子组件(`ChapterSkeleton`/`WritingPill`/`ChapterEditor`/`ChapterToc`)。加三态逻辑后会超 500 行 —— 拆子目录后 `ChaptersView` 瘦身到 ~80 行路由。

---

### Task 1: 卷分组纯函数 `lib/volume-grouping.ts`

**Files:**
- Create: `agent-ui/src/lib/volume-grouping.ts`

- [ ] **Step 1.1: 创建 lib/volume-grouping.ts**

```ts
import type { Arc, Chapter, ChapterOutline, Volume } from '@/types/novel'

/** 卷分组结果。volumeId=null 表示「未分卷」(兜底,放列表最后)。 */
export interface VolumeGroup {
  volumeId: string | null
  volumeOrder: number // 排序用;未分卷 = Infinity
  volumeTitle: string | null
  chapters: Chapter[]
}

/**
 * 把章节按卷分组。卷-章映射三层优先级(与 OutlineView 一致):
 * 1. ChapterOutline.volumeId(Phase 12 后真源)
 * 2. Arc.fromChapter ≤ order ≤ Arc.toChapter → arc.volumeId
 * 3. 都没有 → 未分卷(null),放最后
 *
 * 卷按 Volume.order 升序;卷内章节按 Chapter.order 升序。
 * 空卷(没有命中的章节)被过滤掉,不出现在结果里。
 */
export function groupChaptersByVolume(
  chapters: Chapter[],
  volumes: Volume[],
  arcs: Arc[],
  outlines: ChapterOutline[],
): VolumeGroup[] {
  const outlineByOrder = new Map<number, ChapterOutline>()
  for (const o of outlines) outlineByOrder.set(o.chapterOrder, o)

  const resolveVolumeId = (chapter: Chapter): string | null => {
    const outline = outlineByOrder.get(chapter.order)
    if (outline?.volumeId) return outline.volumeId
    const arc = arcs.find(
      (a) =>
        chapter.order >= a.fromChapter &&
        chapter.order <= a.toChapter &&
        a.volumeId,
    )
    if (arc?.volumeId) return arc.volumeId
    return null
  }

  const buckets = new Map<string | null, Chapter[]>()
  for (const c of chapters) {
    const vid = resolveVolumeId(c)
    if (!buckets.has(vid)) buckets.set(vid, [])
    buckets.get(vid)!.push(c)
  }
  for (const list of buckets.values()) list.sort((a, b) => a.order - b.order)

  const groups: VolumeGroup[] = volumes
    .map((v) => ({
      volumeId: v.id,
      volumeOrder: v.order,
      volumeTitle: v.title,
      chapters: buckets.get(v.id) ?? [],
    }))
    .filter((g) => g.chapters.length > 0)

  const orphans = buckets.get(null)
  if (orphans && orphans.length > 0) {
    groups.push({
      volumeId: null,
      volumeOrder: Infinity,
      volumeTitle: null,
      chapters: orphans,
    })
  }

  return groups
}

/** 找指定 order 章所属的卷(用于 R-Reading 的「卷位」显示)。返回 null = 未分卷。 */
export function findVolumeForChapter(
  order: number,
  volumes: Volume[],
  arcs: Arc[],
  outlines: ChapterOutline[],
): Volume | null {
  const outline = outlines.find((o) => o.chapterOrder === order)
  if (outline?.volumeId) {
    return volumes.find((v) => v.id === outline.volumeId) ?? null
  }
  const arc = arcs.find(
    (a) => order >= a.fromChapter && order <= a.toChapter && a.volumeId,
  )
  if (arc?.volumeId) {
    return volumes.find((v) => v.id === arc.volumeId) ?? null
  }
  return null
}
```

- [ ] **Step 1.2: typecheck 验证**

Run: `pnpm --dir agent-ui typecheck`
Expected: PASS(无类型错误;`@/types/novel` 已有 `Arc`/`Chapter`/`ChapterOutline`/`Volume`)。

- [ ] **Step 1.3: commit**

```bash
git add agent-ui/src/lib/volume-grouping.ts
git commit -m "feat(chapters): 抽取卷分组纯函数 lib/volume-grouping.ts

三层映射优先级(ChapterOutline.volumeId → Arc 范围 → 未分卷),
为 ChaptersView 卷分组 + 卷位显示做准备。"
```

---

### Task 2: 抽取内联组件到 `chapters/` 子目录

**Files:**
- Create: `agent-ui/src/components/workspace/views/chapters/chapter-types.ts`
- Create: `agent-ui/src/components/workspace/views/chapters/ChapterSkeleton.tsx`
- Create: `agent-ui/src/components/workspace/views/chapters/ChapterEditor.tsx`
- Create: `agent-ui/src/components/workspace/views/chapters/WritingPill.tsx`
- Modify: `agent-ui/src/components/workspace/views/ChaptersView.tsx`(改为 import,删内联定义)

**动机:** 纯重构,零行为变化。把 ChaptersView.tsx 里的 3 个内联子组件移到独立文件,为 Task 3/4/5 让路。

- [ ] **Step 2.1: 创建 chapters/chapter-types.ts**

```ts
export type StatusFilter = 'all' | 'committed' | 'draft'
```

- [ ] **Step 2.2: 创建 chapters/ChapterSkeleton.tsx**

把 [ChaptersView.tsx:247-263](../../../agent-ui/src/components/workspace/views/ChaptersView.tsx#L247-L263) 的 `ChapterSkeleton` 整体移过来:

```tsx
import { LoaderCircle } from 'lucide-react'

const SKELETON_BAR_WIDTHS = ['90%', '76%', '82%', '60%', '70%']

export const ChapterSkeleton = ({ order }: { order: number }) => (
  <div className="flex flex-col gap-2 rounded-md bg-overlay-5 p-3">
    <div className="flex items-center gap-2">
      <LoaderCircle className="size-3.5 animate-spin text-accent-violetLight" />
      <span className="text-xs text-accent-violetLight">
        第 {order} 章 · 正文生成中…
      </span>
    </div>
    {SKELETON_BAR_WIDTHS.map((w, i) => (
      <div
        key={i}
        className="h-1.5 rounded-full bg-overlay-10"
        style={{ width: w }}
      />
    ))}
  </div>
)
```

- [ ] **Step 2.3: 创建 chapters/ChapterEditor.tsx**

把 [ChaptersView.tsx:287-344](../../../agent-ui/src/components/workspace/views/ChaptersView.tsx#L287-L344) 的 `ChapterEditor` 整体移过来(包含 `useEffect` 重置草稿 + textarea + 取消/保存按钮)。注意 import:`useEffect` from `react`,`Check` from `lucide-react`,`Chapter` from `@/types/novel`。

```tsx
'use client'

import { useEffect } from 'react'
import { Check } from 'lucide-react'

import type { Chapter } from '@/types/novel'

export interface ChapterEditorProps {
  chapter: Chapter
  draft: string
  onChange: (v: string) => void
  saving: boolean
  onCancel: () => void
  onSave: () => void
}

export const ChapterEditor = ({
  chapter,
  draft,
  onChange,
  saving,
  onCancel,
  onSave,
}: ChapterEditorProps) => {
  useEffect(() => {
    onChange(chapter.content)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter.id])

  return (
    <div className="space-y-2">
      <textarea
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        disabled={saving}
        className="min-h-[300px] w-full resize-y rounded-md border border-accent-indigoLight bg-bg-darkest p-3 font-sans text-sm leading-relaxed text-text-body outline-none focus:border-accent-indigoLight"
        placeholder="编辑正文…"
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-tertiary">
          编辑中 · {draft.length} 字 · 未保存
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="h-8 rounded-md bg-overlay-5 px-3 text-sm text-text-secondary hover:bg-overlay-10 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-gradient-to-b from-accent-primary to-accent-violet px-3 text-sm font-semibold text-text-primary hover:opacity-90 disabled:opacity-50"
          >
            <Check className="size-3.5" />
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2.4: 创建 chapters/WritingPill.tsx**

把 [ChaptersView.tsx:266-284](../../../agent-ui/src/components/workspace/views/ChaptersView.tsx#L266-L284) 的 `WritingPill` 移过来:

```tsx
import { PencilLine } from 'lucide-react'

export interface WritingPillProps {
  order: number
  onJump: () => void
}

export const WritingPill = ({ order, onJump }: WritingPillProps) => (
  <button
    type="button"
    onClick={onJump}
    className="flex w-full items-center justify-between rounded-md border border-[#6366f140] bg-[#6366f110] px-3 py-2 text-sm hover:bg-[#6366f11a]"
  >
    <span className="flex items-center gap-1.5 font-semibold text-accent-indigoLight">
      <PencilLine className="size-3.5 text-accent-indigoLight" />
      ✍ AI 正写第 {order} 章
    </span>
    <span className="text-xs text-accent-indigoLight">跳转 ›</span>
  </button>
)
```

- [ ] **Step 2.5: 修改 ChaptersView.tsx —— 删内联定义,改 import**

在 [ChaptersView.tsx](../../../agent-ui/src/components/workspace/views/ChaptersView.tsx) 顶部加 import,删除内联的 `ChapterSkeleton`/`ChapterEditor`/`WritingPill` 三个组件定义(第 247-284 行 + 第 287-344 行)。`ChapterToc` **暂保留**(Task 5 会删掉,被 ChapterListPage 替代)。

顶部 import 改成(替换第 1-20 行的 import block):

```tsx
'use client'

import { useEffect, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  List,
  Pencil,
} from 'lucide-react'

import { useStore } from '@/store'
import { publishNovel, updateChapter } from '@/api/novels'
import type { Novel } from '@/types/novel'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'

import { ChapterEditor } from './chapters/ChapterEditor'
import { ChapterSkeleton } from './chapters/ChapterSkeleton'
import { WritingPill } from './chapters/WritingPill'
```

注意:`LoaderCircle` / `PencilLine` / `Check` 不再在 ChaptersView 直接用(已移到子组件),从 import 删掉。

- [ ] **Step 2.6: typecheck + lint**

Run: `pnpm --dir agent-ui typecheck && pnpm --dir agent-ui lint`
Expected: PASS。

- [ ] **Step 2.7: 手动验证(行为零变化)**

```bash
pnpm --dir agent-ui dev
```
浏览器打开任一小说 → 资源面板「章节」tab → 确认:翻页/复制/编辑/目录按钮正常;触发 AI 写章 → 骨架屏 + WritingPill 正常显示。

- [ ] **Step 2.8: commit**

```bash
git add agent-ui/src/components/workspace/views/chapters/
git add agent-ui/src/components/workspace/views/ChaptersView.tsx
git commit -m "refactor(chapters): 抽取 ChapterSkeleton/Editor/WritingPill 到子目录

纯重构,零行为变化。为三态路由瘦身 ChaptersView 做准备。"
```

---

### Task 3: `ChapterReadingPage`(R-Reading + skeleton 变体)

**Files:**
- Create: `agent-ui/src/components/workspace/views/chapters/ChapterReadingPage.tsx`

接收已解析的 `chapter` + `outlineData`(用于卷位显示)+ 写作信号,渲染 ChapterBar + Meta + (Skeleton/Editor/Article)。

- [ ] **Step 3.1: 创建 ChapterReadingPage.tsx**

```tsx
'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight, Copy, List, Pencil } from 'lucide-react'

import { useStore } from '@/store'
import { publishNovel, updateChapter } from '@/api/novels'
import type { Chapter, Novel, OutlineData } from '@/types/novel'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'

import { ChapterEditor } from './ChapterEditor'
import { ChapterSkeleton } from './ChapterSkeleton'
import { WritingPill } from './WritingPill'
import { findVolumeForChapter } from '@/lib/volume-grouping'

export interface ChapterReadingPageProps {
  novel: Novel
  chapter: Chapter
  prevOrder: number | null
  nextOrder: number | null
  outlineData: OutlineData | null
  writingChapterOrder: number | null
  onOpenToc: () => void
  onJumpToOrder: (order: number) => void
}

export const ChapterReadingPage = ({
  novel,
  chapter,
  prevOrder,
  nextOrder,
  outlineData,
  writingChapterOrder,
  onOpenToc,
  onJumpToOrder,
}: ChapterReadingPageProps) => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const manualLock = useStore((s) => s.manualLock)
  const setManualLock = useStore((s) => s.setManualLock)
  const bumpChapterWriteSeq = useStore((s) => s.bumpChapterWriteSeq)

  const [copying, setCopying] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const isWritingThis =
    writingChapterOrder !== null && writingChapterOrder === chapter.order
  const showSkeleton = isWritingThis && chapter.content.length < 20
  const showPill =
    manualLock &&
    writingChapterOrder !== null &&
    writingChapterOrder !== chapter.order

  const volume =
    outlineData &&
    findVolumeForChapter(
      chapter.order,
      outlineData.volumes,
      outlineData.arcs,
      outlineData.chapterOutlines,
    )

  const copyChapter = async () => {
    setCopying(true)
    try {
      const text = await publishNovel(endpoint, token, novel.id, {
        from: chapter.order,
        to: chapter.order,
        title: true,
        synopsis: false,
        indent: true,
      })
      await navigator.clipboard.writeText(text)
      toast.success(`已复制第${chapter.order}章`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '复制失败')
    } finally {
      setCopying(false)
    }
  }

  const saveDraft = async () => {
    if (saving) return
    setSaving(true)
    try {
      await updateChapter(endpoint, token, novel.id, chapter.id, {
        content: draft,
      })
      bumpChapterWriteSeq()
      toast.success('已保存')
      setEditing(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const goTo = (order: number) => {
    onJumpToOrder(order)
    setManualLock(true)
  }

  return (
    <div className="space-y-3">
      {showPill && writingChapterOrder !== null && (
        <WritingPill
          order={writingChapterOrder}
          onJump={() => {
            onJumpToOrder(writingChapterOrder)
            setManualLock(false)
          }}
        />
      )}

      {/* ChapterBar:翻页 pager + 复制/列表/编辑 */}
      <div className="flex items-center gap-1">
        <div className="flex min-w-0 flex-1 items-center gap-1 rounded-md border border-overlay-15 bg-bg-cardElevated px-1 py-1">
          <button
            type="button"
            disabled={prevOrder == null}
            onClick={() => prevOrder != null && goTo(prevOrder)}
            aria-label="上一章"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-overlay-10 hover:text-text-primary disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={onOpenToc}
            className="min-w-0 flex-1 truncate text-center text-sm font-medium text-text-primary hover:text-accent-indigoLight"
            title={`第 ${chapter.order} 章 · ${chapter.title || '无标题'}`}
          >
            <span className="truncate">
              第 {chapter.order} 章 · {chapter.title || '无标题'}
            </span>
          </button>
          <button
            type="button"
            disabled={nextOrder == null}
            onClick={() => nextOrder != null && goTo(nextOrder)}
            aria-label="下一章"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-overlay-10 hover:text-text-primary disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={copyChapter}
          disabled={copying || !chapter.content}
          title="复制本章(发布用)"
          aria-label="复制本章"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-overlay-10 hover:text-text-primary disabled:opacity-30"
        >
          <Copy className="size-4" />
        </button>
        <button
          type="button"
          onClick={onOpenToc}
          aria-label="章节列表"
          title="章节列表"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-overlay-10 hover:text-text-primary"
        >
          <List className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(chapter.content)
            setEditing((v) => !v)
          }}
          disabled={isWritingThis}
          aria-label={editing ? '退出编辑' : '编辑正文'}
          title={editing ? '退出编辑' : '编辑正文'}
          className={`flex size-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-30 ${
            editing
              ? 'bg-accent-primarySoft text-accent-indigoLight'
              : 'text-text-tertiary hover:bg-overlay-10'
          }`}
        >
          <Pencil className="size-4" />
        </button>
      </div>

      {/* Meta:状态 badge + 字数 + 卷位 */}
      <div className="flex items-center gap-2 text-xs text-text-tertiary">
        {isWritingThis ? (
          <span className="rounded-full bg-accent-primarySoft px-2 py-0.5 text-xs text-accent-indigoLight">
            写作中
          </span>
        ) : (
          <Badge
            variant={chapter.status === 'COMMITTED' ? 'success' : 'neutral'}
          >
            {chapter.status === 'COMMITTED' ? '已写入' : '草稿'}
          </Badge>
        )}
        <span>{chapter.content.length} 字</span>
        {volume && (
          <span className="ml-auto">
            {volume.title} · 第 {chapter.order} 章
          </span>
        )}
      </div>

      {editing ? (
        <ChapterEditor
          chapter={chapter}
          draft={draft}
          onChange={setDraft}
          saving={saving}
          onCancel={() => setEditing(false)}
          onSave={saveDraft}
        />
      ) : showSkeleton ? (
        <ChapterSkeleton order={chapter.order} />
      ) : chapter.content ? (
        <article className="prose prose-invert max-w-none text-sm">
          <MarkdownRenderer>{chapter.content}</MarkdownRenderer>
        </article>
      ) : (
        <p className="text-sm text-text-tertiary">本章还没有内容。</p>
      )}
    </div>
  )
}
```

- [ ] **Step 3.2: typecheck**

Run: `pnpm --dir agent-ui typecheck`
Expected: PASS。

- [ ] **Step 3.3: commit**

```bash
git add agent-ui/src/components/workspace/views/chapters/ChapterReadingPage.tsx
git commit -m "feat(chapters): 新建 ChapterReadingPage(R-Reading 正文态)

含 skeleton 变体 + 卷位 meta(经 findVolumeForChapter 解析)。
ChaptersView 还没切过来,此 commit 不影响线上行为。"
```

---

### Task 4: `ChapterListPage`(R-TOC + 搜索/过滤/卷折叠)

**Files:**
- Create: `agent-ui/src/components/workspace/views/chapters/ChapterListPage.tsx`

接收已分组所需数据 + 用户操作回调,渲染搜索框 + Filters + 卷分组折叠列表。

- [ ] **Step 4.1: 创建 ChapterListPage.tsx**

```tsx
'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react'

import type { Arc, Chapter, ChapterOutline, Volume } from '@/types/novel'
import { cn } from '@/lib/utils'
import { groupChaptersByVolume } from '@/lib/volume-grouping'
import type { StatusFilter } from './chapter-types'

export interface ChapterListPageProps {
  chapters: Chapter[]
  volumes: Volume[]
  arcs: Arc[]
  outlines: ChapterOutline[]
  currentOrder: number
  writingOrder: number | null
  onPick: (order: number) => void
  onClose: () => void
}

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'committed', label: '已写' },
  { key: 'draft', label: '草稿' },
]

export const ChapterListPage = ({
  chapters,
  volumes,
  arcs,
  outlines,
  currentOrder,
  writingOrder,
  onPick,
  onClose,
}: ChapterListPageProps) => {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<StatusFilter>('all')
  // 默认:当前章所在卷展开,其他折叠。搜索时全部展开(本地覆盖)。
  const initialExpanded = useMemo(() => {
    const groups = groupChaptersByVolume(chapters, volumes, arcs, outlines)
    const cur = groups.find((g) =>
      g.chapters.some((c) => c.order === currentOrder),
    )
    return new Set<number>(cur ? [cur.volumeOrder] : [])
  }, [chapters, volumes, arcs, outlines, currentOrder])
  const [collapsed, setCollapsed] = useState<Set<number>>(
    () => new Set(),
  )

  const isSearching = query.trim().length > 0

  const filteredChapters = useMemo(() => {
    const q = query.trim()
    let result = chapters
    if (/^\d+$/.test(q)) {
      const n = parseInt(q, 10)
      result = result.filter((c) => c.order === n)
    } else if (q) {
      result = result.filter((c) => (c.title ?? '').includes(q))
    }
    if (filter !== 'all') {
      result = result.filter(
        (c) => c.status === (filter === 'committed' ? 'COMMITTED' : 'DRAFT'),
      )
    }
    return result
  }, [chapters, query, filter])

  const groups = useMemo(
    () => groupChaptersByVolume(filteredChapters, volumes, arcs, outlines),
    [filteredChapters, volumes, arcs, outlines],
  )

  const toggleCollapse = (volumeOrder: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(volumeOrder)) next.delete(volumeOrder)
      else next.add(volumeOrder)
      return next
    })
  }

  // 搜索期间强制全部展开(命中项要可见);退出搜索恢复用户折叠态。
  const isCollapsed = (volumeOrder: number) =>
    !isSearching && collapsed.has(volumeOrder)

  return (
    <div className="flex h-full flex-col gap-3">
      {/* ChapBar:标题 + 关闭 */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-text-primary">
          章节目录 · {currentOrder} / {chapters.length}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="flex size-6 items-center justify-center rounded-md text-text-tertiary hover:bg-overlay-10 hover:text-text-primary"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* SearchBar */}
      <div className="flex items-center gap-2 rounded-md border border-overlay-15 bg-overlay-5 px-3 py-2">
        <Search className="size-3.5 shrink-0 text-text-tertiary" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索章名 / 章号"
          className="min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-tertiary"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="清除"
            className="text-text-tertiary hover:text-text-primary"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
              filter === f.key
                ? 'bg-accent-primarySoft text-accent-indigoLight'
                : 'bg-overlay-10 text-text-tertiary hover:bg-overlay-15',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 卷分组列表 */}
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        {groups.length === 0 ? (
          <p className="py-8 text-center text-xs text-text-tertiary">
            没有匹配的章节。
          </p>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => {
              const collapsedNow = isCollapsed(g.volumeOrder)
              const isOrphan = g.volumeId === null
              return (
                <div key={g.volumeOrder} className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => toggleCollapse(g.volumeOrder)}
                    className="flex w-full items-center gap-1.5 px-1 py-0.5 text-[11px] font-semibold tracking-wide text-text-tertiary"
                  >
                    {collapsedNow ? (
                      <ChevronRight className="size-3" />
                    ) : (
                      <ChevronDown className="size-3" />
                    )}
                    <span>
                      {isOrphan ? '未分卷' : `卷${g.volumeOrder} · ${g.volumeTitle ?? '无标题'}`}
                    </span>
                    <span className="ml-auto text-text-tertiary">
                      {g.chapters.length} 章
                    </span>
                  </button>
                  {!collapsedNow && (
                    <div className="space-y-1">
                      {g.chapters.map((c) => {
                        const isCurrent = c.order === currentOrder
                        const isWriting = writingOrder === c.order
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => onPick(c.order)}
                            className={cn(
                              'flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors',
                              isCurrent
                                ? 'border-overlay-15 bg-accent-primarySoft'
                                : 'border-overlay-15 bg-bg-cardElevated hover:bg-overlay-5',
                            )}
                          >
                            <span
                              className={cn(
                                'truncate',
                                isCurrent
                                  ? 'font-semibold text-text-primary'
                                  : 'text-text-secondary',
                                isWriting && 'text-accent-indigoLight',
                              )}
                            >
                              第 {c.order} 章 · {c.title || '无标题'}
                            </span>
                            <span
                              className={cn(
                                'shrink-0 text-[10px]',
                                isWriting
                                  ? 'text-accent-indigoLight'
                                  : isCurrent
                                    ? 'text-accent-indigoLight'
                                    : 'text-text-tertiary',
                              )}
                            >
                              {isWriting
                                ? '写作中'
                                : isCurrent
                                  ? '● 在读'
                                  : c.status === 'COMMITTED'
                                    ? '✓ 已写'
                                    : '草稿'}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4.2: typecheck**

Run: `pnpm --dir agent-ui typecheck`
Expected: PASS。

- [ ] **Step 4.3: commit**

```bash
git add agent-ui/src/components/workspace/views/chapters/ChapterListPage.tsx
git commit -m "feat(chapters): 新建 ChapterListPage(R-TOC 列表态)

搜索(章号精确/章名模糊)+ Filters(全部/已写/草稿)+ 卷分组折叠
(当前卷默认展开、其他折叠;搜索期间强制全展开)。

ChaptersView 还没切过来,此 commit 不影响线上行为。"
```

---

### Task 5: `ChaptersView` 改成三态路由

**Files:**
- Modify: `agent-ui/src/components/workspace/views/ChaptersView.tsx`

瘦身:fetch OutlineData(参照 OutlineView 模式)→ 持有 `tocOpen` → 三态路由 → 委托给 ChapterListPage / ChapterReadingPage。删除内联 `ChapterToc`(被替代)。

- [ ] **Step 5.1: 重写 ChaptersView.tsx**

整个文件替换为(保留原 `ChaptersViewProps` 接口签名,不破坏调用方):

```tsx
'use client'

import { useEffect, useState } from 'react'

import { useStore } from '@/store'
import { getOutline } from '@/api/novels'
import type { Novel, OutlineData } from '@/types/novel'

import { ChapterListPage } from './chapters/ChapterListPage'
import { ChapterReadingPage } from './chapters/ChapterReadingPage'

export interface ChaptersViewProps {
  novel: Novel
  writingChapterOrder: number | null
}

const ChaptersView = ({ novel, writingChapterOrder }: ChaptersViewProps) => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const currentChapterOrder = useStore((s) => s.currentChapterOrder)
  const setCurrentChapterOrder = useStore((s) => s.setCurrentChapterOrder)
  const setManualLock = useStore((s) => s.setManualLock)
  const outlineWriteSeq = useStore((s) => s.outlineWriteSeq)

  const [tocOpen, setTocOpen] = useState(false)
  const [outlineData, setOutlineData] = useState<OutlineData | null>(null)

  // fetch OutlineData(参照 OutlineView 模式):mount + outlineWriteSeq 变化时刷新。
  useEffect(() => {
    let cancelled = false
    getOutline(endpoint, token, novel.id)
      .then((d) => {
        if (!cancelled) setOutlineData(d)
      })
      .catch(() => {
        if (!cancelled) setOutlineData(null)
      })
    return () => {
      cancelled = true
    }
  }, [endpoint, token, novel.id, outlineWriteSeq])

  const sorted = [...novel.chapters].sort((a, b) => a.order - b.order)
  const idx = sorted.findIndex((c) => c.order === currentChapterOrder)
  const chapter = idx >= 0 ? sorted[idx] : undefined
  const prevOrder = idx > 0 ? sorted[idx - 1].order : null
  const nextOrder =
    idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1].order : null

  const pickOrder = (order: number) => {
    setCurrentChapterOrder(order)
    setManualLock(true)
    setTocOpen(false)
  }

  // CONCEPT / 无章:占位。
  if (currentChapterOrder == null || !chapter) {
    return (
      <p className="text-sm text-text-tertiary">
        {novel.status === 'CONCEPT'
          ? '立项中,信息收集完成后开始写作。'
          : '本章还没有内容。'}
      </p>
    )
  }

  // 三态路由:列表态 > 写作中态 > 正文态(tocOpen 优先,不被写作打断)。
  if (tocOpen) {
    return (
      <ChapterListPage
        chapters={sorted}
        volumes={outlineData?.volumes ?? []}
        arcs={outlineData?.arcs ?? []}
        outlines={outlineData?.chapterOutlines ?? []}
        currentOrder={chapter.order}
        writingOrder={writingChapterOrder}
        onPick={pickOrder}
        onClose={() => setTocOpen(false)}
      />
    )
  }

  return (
    <ChapterReadingPage
      novel={novel}
      chapter={chapter}
      prevOrder={prevOrder}
      nextOrder={nextOrder}
      outlineData={outlineData}
      writingChapterOrder={writingChapterOrder}
      onOpenToc={() => setTocOpen(true)}
      onJumpToOrder={pickOrder}
    />
  )
}

export default ChaptersView
```

注意:
- **删除原内联 `ChapterToc`**(第 346-385 行)—— 被 `ChapterListPage` 替代。
- **`outlineWriteSeq`** 跟踪大纲写入(OutlineView 已用同款)—— 大纲变化时刷新卷分组。
- **三态优先级**:`tocOpen` → 列表;否则(`isWritingThis && content<20` 由 ReadingPage 内部判断)→ skeleton/正文。

- [ ] **Step 5.2: typecheck + lint + format**

Run: `pnpm --dir agent-ui validate`
Expected: PASS(lint + format + typecheck 全过)。

- [ ] **Step 5.3: 手动验证**

```bash
pnpm --dir agent-ui dev
```
浏览器打开一本有多章 + 多卷的小说(无大纲书可临时造数据,或先在 OutlineView 触发大纲生成):

1. **默认态**:进章节 tab → 显示 R-Reading(ChapterBar + Meta + 正文),Meta 右侧显「卷X · 第 N 章」。
2. **切列表**:点 Btn-list(或章标题)→ 整个面板切换为 R-TOC(正文不可见,不挤压)。
3. **搜索**:输入章名片段 → 列表过滤;输入纯数字 → 高亮该章;清空 → 恢复。
4. **Filters**:点「已写」→ 只显 COMMITTED;「草稿」→ 只显 DRAFT;「全部」→ 恢复。
5. **卷折叠**:当前卷默认展开,其他卷折叠;点卷标题 → 切换;搜索期间全展开。
6. **回正文**:点任一章 → 切回 R-Reading,`currentChapterOrder` = 选中章。
7. **写作中态**:触发 agent 写当前章 → 自动显骨架屏 + 「写作中」badge;正文流到位 → 自动回正文态。
8. **WritingPill**:写第 N 章 + 手动切到第 M 章 → R-Reading 顶部显 pill;点 → 跳第 N 章 + 进骨架屏。
9. **CONCEPT 占位**:打开 CONCEPT 小说 → 显「立项中…」。

- [ ] **Step 5.4: commit**

```bash
git add agent-ui/src/components/workspace/views/ChaptersView.tsx
git commit -m "feat(chapters): ChaptersView 重做为三态互斥全屏切换

- 列表态(tocOpen)→ ChapterListPage,正文不再被挤压
- 写作中态(isWritingThis && content<20)→ ChapterReadingPage 显骨架屏
- 默认态 → ChapterReadingPage 显正文 + 卷位 meta
- fetch OutlineData 经 getOutline(参照 OutlineView),卷分组真源

Closes: ChaptersView 三态重做(spec 2026-07-06)"
```

---

### Task 6: 收尾验证

**Files:** 无新文件。

- [ ] **Step 6.1: 全量质量门**

Run: `pnpm --dir agent-ui validate`
Expected: PASS(lint + format + typecheck)。

- [ ] **Step 6.2: server typecheck(确认未受影响)**

Run: `pnpm --dir server typecheck`
Expected: PASS(本期零 server 改动,作为回归确认)。

- [ ] **Step 6.3: Pencil 设计对照**

打开 `design/narratox.pen`,对照三帧(`Bcz70`/`UUCpA`/`GMp9L`)确认 FE 实现:
- ChapterBar 布局一致(翻页 pager + 三连按钮)
- Meta 行布局一致(badge + 字数 + 卷位)
- 列表搜索框 / Filters / 卷折叠 chevron 一致
- 骨架屏 spinner + 灰条一致

如有 token 偏差(颜色/间距),FE 调整对齐设计(spec tokens 权威)。

- [ ] **Step 6.4: 更新 memory(可选)**

如果实施过程中发现新的 Pencil 帧 ID 或 token 映射,更新 `~/.claude/projects/-Users-taowen-project-narratox/memory/pencil-resource-panel-frames.md`。

---

## Self-Review

**1. Spec coverage:**

| Spec section | 对应 task |
|---|---|
| §3 三态互斥切换 | Task 5(ChaptersView 路由) |
| §3.2 切换优先级(tocOpen > 写作中) | Task 5 Step 5.1 注释 |
| §4.1 R-TOC 结构 | Task 4 |
| §4.2 搜索框(章号/章名 + 搜索期间展开) | Task 4 Step 4.1(`isSearching` 强制展开) |
| §4.3 Filters 状态语义 | Task 4 Step 4.1(`FILTERS` 常量 + filterChapters) |
| §4.4 卷折叠(当前卷展开) | Task 4 Step 4.1(`initialExpanded`) |
| §5 R-Reading + 卷位 meta | Task 3(`findVolumeForChapter`) |
| §6 R-Writing 骨架屏 | Task 3(ReadingPage 内 `showSkeleton` 分支,复用 ChapterSkeleton) |
| §7 WritingPill 不画独立帧 | Task 3(ReadingPage 内 `showPill` 分支,复用 WritingPill) |
| §8.1 状态管理(视图本地) | Task 4/5(`useState` local) |
| §8.2 渲染决策 | Task 5 |
| §8.3 搜索逻辑 | Task 4(`filteredChapters` useMemo) |
| §8.4 卷-章映射三层 | Task 1(`groupChaptersByVolume`) |
| §10 不在范围内 | 全文遵守(无 server/DB/agent 改动) |
| §11 验证 | Task 5.3 + Task 6 |

**2. Placeholder scan:** 无 TBD/TODO/"handle edge cases"。每个 step 有完整代码或精确命令。

**3. Type consistency:**
- `VolumeGroup` 定义在 Task 1,使用在 Task 4 —— 一致。
- `StatusFilter` 定义在 Task 2.1(chapter-types.ts),使用在 Task 4 —— 一致。
- `ChapterReadingPageProps` / `ChapterListPageProps` 定义在 Task 3/4,使用在 Task 5 —— 一致。
- `pickOrder(order: number)` 在 Task 5 定义,在 Task 4 作为 `onPick`、Task 3 作为 `onJumpToOrder` 使用 —— 签名一致。
- `outlineData: OutlineData | null` 贯穿 Task 5 → Task 3/4 —— 一致。

**4. Ambiguity:**
- 「搜索期间全展开」逻辑明确(`isSearching && !collapsed.has` → 展开即 `isCollapsed = !isSearching && collapsed.has`)。
- 「卷位 meta」:`volume && (...)` 条件渲染,未分卷时不显示 —— 明确。
- **潜在风险**:`getOutline` fetch 失败时 `outlineData=null` → ListPage 收到空 volumes/arcs/outlines → 所有章进「未分卷」组。这是优雅降级(用户仍能看章列表,只是没卷分组)—— 可接受,非 bug。

---

## 不在范围内(重申)

- 聊天侧 B3 写作跟随帧(`ZkM0J`)—— 不动。
- server / DB / agent 改动 —— 零。
- 章节数据 server 分页 —— client-side filter 足够。
- 章节拖拽重排 / 批量操作 —— agent 是唯一作者,无手动 CRUD。
- 加 vitest 测试 runner —— 独立任务,不在本期。
