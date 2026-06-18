# narratox 图标栏布局重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把工作台从 3 栏均分重构为「图标栏 ~48px + 聊天全宽 + 可开关资源面板」(VS Code 模型),让聊天成为主舞台。

**Architecture:** IconRail(纯图标竖栏)取代 ResourceNav;ResourcePanel(可开关面板)按 activeResource 显示对应内容(正文/信息卡/占位);工作台页用 activeResource state 驱动面板开关,WritingChapter 信号自动打开章节面板。纯前端,后端不动。

**Tech Stack:** Next.js 15 App Router + React 18 + Zustand + Tailwind(暗色主题)。无测试器,门禁 `pnpm validate` + build。

**Spec:** [docs/superpowers/specs/2026-06-18-icon-rail-layout-design.md](../specs/2026-06-18-icon-rail-layout-design.md)
**Branch:** `feat/icon-rail-layout`

---

## File Structure

- Create: `agent-ui/src/components/workspace/IconRail.tsx` — ~48px 纯图标竖栏(取代 ResourceNav)
- Create: `agent-ui/src/components/workspace/ResourcePanel.tsx` — 可开关面板容器(chapters/info/placeholder)
- Modify: `agent-ui/src/app/novels/[id]/page.tsx` — 重构布局(IconRail + ChatPanel + 条件 ResourcePanel)
- Delete: `agent-ui/src/components/workspace/ResourceNav.tsx`(被 IconRail 取代)

---

# Task 1: IconRail 组件

**Files:** Create `agent-ui/src/components/workspace/IconRail.tsx`

- [ ] **Step 1: 写 IconRail** — 纯图标竖栏(~48px)。资源图标(📝📖👤🌍📊)+ ℹ️信息 + ⚙️设置 + 登出。点击资源图标 → `onSelectResource(key)`;再点当前激活图标 → `onSelectResource(null)`(关闭面板)。

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'

type ResourceKey = 'outline' | 'chapters' | 'characters' | 'worldview' | 'status' | 'info'

interface Props {
  activeResource: ResourceKey | null
  onSelectResource: (key: ResourceKey | null) => void
}

const RESOURCES: { key: ResourceKey; icon: string; label: string; phase: string }[] = [
  { key: 'outline', icon: '📝', label: '大纲', phase: 'P2' },
  { key: 'chapters', icon: '📖', label: '正文', phase: '' },
  { key: 'characters', icon: '👤', label: '角色', phase: 'P2' },
  { key: 'worldview', icon: '🌍', label: '世界观', phase: 'P2' },
  { key: 'status', icon: '📊', label: '状态', phase: 'P3' },
]

const IconRail = ({ activeResource, onSelectResource }: Props) => {
  const router = useRouter()
  const logout = useStore((s) => s.logout)

  const handleClick = (key: ResourceKey) => {
    onSelectResource(activeResource === key ? null : key)
  }

  return (
    <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-primary/10 bg-background-secondary py-3">
      {RESOURCES.map((r) => (
        <button
          key={r.key}
          type="button"
          onClick={() => handleClick(r.key)}
          title={r.label}
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-lg text-lg transition-colors',
            activeResource === r.key
              ? 'bg-brand/20 border-l-2 border-brand'
              : 'opacity-50 hover:opacity-100 hover:bg-accent'
          )}
        >
          {r.icon}
        </button>
      ))}
      <div className="my-1 h-px w-6 bg-primary/10" />
      <button
        type="button"
        onClick={() => handleClick('info')}
        title="小说信息"
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-lg text-lg transition-colors',
          activeResource === 'info'
            ? 'bg-brand/20 border-l-2 border-brand'
            : 'opacity-50 hover:opacity-100 hover:bg-accent'
        )}
      >
        ℹ️
      </button>
      <button
        type="button"
        onClick={() => router.push('/settings')}
        title="设置"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-lg opacity-50 transition-colors hover:opacity-100 hover:bg-accent"
      >
        ⚙️
      </button>
      <div className="mt-auto">
        <button
          type="button"
          onClick={() => { logout(); router.replace('/login') }}
          title="登出"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-sm opacity-50 transition-colors hover:opacity-100 hover:bg-accent"
        >
          ⏻
        </button>
      </div>
    </div>
  )
}

export default IconRail
```

- [ ] **Step 2: typecheck + validate**
Run: `cd agent-ui && pnpm typecheck && pnpm validate`
Expected: clean(IconRail 还没被 import,但自身类型合法)。

- [ ] **Step 3: Commit**
```sh
git add agent-ui/src/components/workspace/IconRail.tsx
git commit -m "feat(agent-ui): IconRail component (icon-only activity bar)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 2: ResourcePanel 组件

**Files:** Create `agent-ui/src/components/workspace/ResourcePanel.tsx`

- [ ] **Step 1: 写 ResourcePanel** — 可开关面板容器。根据 `resource` key 渲染对应内容:'chapters' → 复用现有 ChapterPreview(从 ChapterDetail 改名/迁移);'info' → 信息卡(只读 title/genre/synopsis/style);其他 → "即将推出"。顶部标题 + × 关闭。

```tsx
'use client'

import { useStore } from '@/store'
import type { Novel, Chapter } from '@/types/novel'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'

type ResourceKey = 'outline' | 'chapters' | 'characters' | 'worldview' | 'status' | 'info'

interface Props {
  resource: ResourceKey
  novel: Novel
  onClose: () => void
  onSaved: () => void
}

const TITLES: Record<ResourceKey, string> = {
  outline: '大纲', chapters: '正文', characters: '角色',
  worldview: '世界观', status: '状态', info: '小说信息',
}

const ResourcePanel = ({ resource, novel, onClose, onSaved }: Props) => {
  const writingChapterOrder = useStore((s) => s.writingChapterOrder)
  const chapters = novel.chapters

  return (
    <section className="flex w-[420px] shrink-0 flex-col overflow-hidden border-l border-primary/10 bg-background">
      <header className="flex items-center justify-between px-4 py-3">
        <h2 className="text-sm font-semibold text-primary">{TITLES[resource]}</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-muted hover:text-primary text-lg leading-none"
        >
          ×
        </button>
      </header>
      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {resource === 'chapters' && <ChaptersView novel={novel} chapters={chapters} writingChapterOrder={writingChapterOrder} onSaved={onSaved} />}
        {resource === 'info' && <InfoView novel={novel} />}
        {resource !== 'chapters' && resource !== 'info' && (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            {TITLES[resource]} · 即将推出
          </div>
        )}
      </div>
    </section>
  )
}

/** 正文视图:章节切换 + 骨架(写作中)+ 正文渲染。从现有 ChapterDetail/ChapterPreview 迁移。 */
const ChaptersView = ({ novel, chapters, writingChapterOrder, onSaved }: {
  novel: Novel; chapters: Chapter[]; writingChapterOrder: number | null; onSaved: () => void
}) => {
  // 简版:显示第一章或 writingChapterOrder 对应章。Phase 1 先不做 ‹› 切换器(已有 ChapterPreview 组件更完整,可复用)。
  // 如果 writingChapterOrder 非空 → 显示骨架;否则显示内容。
  if (writingChapterOrder !== null) {
    return (
      <div>
        <p className="text-xs text-muted mb-2">第 {writingChapterOrder} 章 · AI 写作中…</p>
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-4 rounded bg-accent animate-pulse" style={{ width: `${70 + Math.random() * 30}%` }} />
          ))}
        </div>
      </div>
    )
  }
  const chapter = chapters[0] // 简版:先显示第一章。完整切换器在 ChapterPreview 组件里(可后续合并)。
  if (!chapter || !chapter.content) {
    return <p className="text-sm text-muted">{novel.status === 'CONCEPT' ? '立项中,信息收集完成后开始写作。' : '本章还没有内容。'}</p>
  }
  return (
    <article className="prose prose-invert max-w-none text-sm">
      <MarkdownRenderer>{chapter.content}</MarkdownRenderer>
    </article>
  )
}

/** 信息卡(只读):书名/类型/简介/文风。 */
const InfoView = ({ novel }: { novel: Novel }) => {
  const rows = [
    { label: '书名', value: novel.title },
    { label: '类型', value: novel.genre || '—' },
    { label: '简介', value: novel.synopsis || '—' },
    { label: '文风', value: (novel.settings as { style?: string })?.style || '—' },
  ]
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="text-xs uppercase text-muted">{r.label}</div>
          <div className="text-sm text-primary">{r.value}</div>
        </div>
      ))}
      <div className="pt-2 text-xs text-muted/50">信息卡 · 由 Agent 通过 update_novel 自动填充</div>
    </div>
  )
}

export default ResourcePanel
```

> Note: ChaptersView 是一个简化版(先显示第一章 + 骨架)。如果现有 ChapterDetail/ChapterPreview 组件已经有更完整的切换器 + 编辑功能,可以直接复用(把 ChapterPreview 嵌入 ResourcePanel 的 'chapters' 分支)。**实现者:** 读现有的 `ChapterDetail.tsx`(或 ChapterPreview),如果它已经是独立组件,直接 `<ChapterPreview novel={novel} ... />` 嵌入,不用重写 ChaptersView。优先复用,避免重复。

- [ ] **Step 2: typecheck + validate**
Run: `cd agent-ui && pnpm typecheck && pnpm validate`
Expected: clean。

- [ ] **Step 3: Commit**
```sh
git add agent-ui/src/components/workspace/ResourcePanel.tsx
git commit -m "feat(agent-ui): ResourcePanel (togglable panel — chapters/info/placeholder)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 3: 工作台页重构 + 清理

**Files:** Modify `agent-ui/src/app/novels/[id]/page.tsx`; Delete `agent-ui/src/components/workspace/ResourceNav.tsx`

- [ ] **Step 1: 重构工作台页** — 读当前 `app/novels/[id]/page.tsx`。替换为 IconRail + ChatPanel + 条件 ResourcePanel 布局:
```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { useStore } from '@/store'
import { getNovel } from '@/api/novels'
import type { Novel } from '@/types/novel'
import RequireAuth from '@/components/auth/RequireAuth'
import IconRail from '@/components/workspace/IconRail'
import ResourcePanel from '@/components/workspace/ResourcePanel'
import ChatPanel from '@/components/workspace/ChatPanel'

type ResourceKey = 'outline' | 'chapters' | 'characters' | 'worldview' | 'status' | 'info'

export default function NovelWorkspacePage() {
  return <RequireAuth><Workspace /></RequireAuth>
}

const Workspace = () => {
  const params = useParams<{ id: string }>()
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const writingChapterOrder = useStore((s) => s.writingChapterOrder)
  const [novel, setNovel] = useState<Novel | null>(null)
  const [activeResource, setActiveResource] = useState<ResourceKey | null>(null)

  const refresh = useCallback(async () => {
    try {
      setNovel(await getNovel(endpoint, token, params.id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败')
    }
  }, [endpoint, token, params.id])

  useEffect(() => { refresh() }, [refresh])

  // WritingChapter 信号 → 自动打开章节面板
  useEffect(() => {
    if (writingChapterOrder !== null) setActiveResource('chapters')
  }, [writingChapterOrder])

  // CONCEPT 阶段默认显示信息卡(ℹ️ 高亮)
  useEffect(() => {
    if (novel?.status === 'CONCEPT' && activeResource === null) {
      setActiveResource('info')
    }
  }, [novel?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!novel) return <div className="p-8 text-sm text-muted">加载中…</div>

  return (
    <div className="flex h-screen bg-background/80">
      <IconRail activeResource={activeResource} onSelectResource={setActiveResource} />
      <ChatPanel
        sessionId={novel.sessionId}
        selectedChapterId={null}
        onAccepted={refresh}
      />
      {activeResource && (
        <ResourcePanel
          resource={activeResource}
          novel={novel}
          onClose={() => setActiveResource(null)}
          onSaved={refresh}
        />
      )}
    </div>
  )
}
```

> **关键变化:**
> - `IconRail` 取代 `ResourceNav`。
> - `activeResource` state 驱动面板开关。
> - `WritingChapter` 信号(writingChapterOrder !== null)→ 自动 `setActiveResource('chapters')`。
> - CONCEPT + 首次进入 → `setActiveResource('info')`(信息卡面板默认打开,让用户看到正在收集的信息)。
> - ChatPanel 始终全宽(没有条件渲染 ChapterDetail/ChapterPreview;那逻辑移入 ResourcePanel)。
> - 删除 `selectedChapterId` / `onNewChapter`(不再需要;章节在 ResourcePanel 内管理)。

- [ ] **Step 2: 删除 ResourceNav**
```sh
git rm agent-ui/src/components/workspace/ResourceNav.tsx
```
确认没有其它 import(grep `ResourceNav`)。

- [ ] **Step 3: typecheck + validate + build**
Run: `cd agent-ui && pnpm typecheck && pnpm validate && pnpm build`
Expected: clean。

- [ ] **Step 4: Commit**
```sh
git add -A
git commit -m "feat(agent-ui): workspace refactor — IconRail + togglable ResourcePanel (VS Code model)

Chat is primary (full width). Resource panel opens on demand (WritingChapter
auto-open, user icon-click, CONCEPT defaults to info). Removed ResourceNav.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §2.1 图标栏 → Task 1 (IconRail: 📝📖👤🌍📊 + ℹ️⚙️ + 登出).
- §2.2 聊天全宽 → Task 3 (ChatPanel always flex:1, no conditional ChapterDetail).
- §2.3 可开关面板 → Task 2 (ResourcePanel) + Task 3 (activeResource state + auto-open).
- §3.1 CONCEPT → Task 3 (CONCEPT defaults to 'info' panel; ℹ️ highlighted).
- §3.2 ACTIVE 写作 → Task 3 (WritingChapter → 'chapters'; skeleton in ResourcePanel).
- §4.1-4.5 FE changes → Task 1 (IconRail) + Task 2 (ResourcePanel) + Task 3 (page refactor + delete ResourceNav).
- §5 非目标 → 不做拖拽/inline编辑/P2-P3内容/折叠. ✓.

**类型一致:** `ResourceKey` = 'outline'|'chapters'|'characters'|'worldview'|'status'|'info' 在 IconRail + ResourcePanel + workspace page 一致。`activeResource: ResourceKey | null` + `onSelectResource: (key | null) => void` 一致。

**无占位符:** 每个 step 含完整代码 + 命令。P2/P3 "即将推出" 是 UI 占位文案(非实现占位)。
