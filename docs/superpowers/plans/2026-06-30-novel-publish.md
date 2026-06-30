# 小说发布功能(novel publish)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给作者两个取正文的入口(卡片⋮菜单·发布弹窗 + 章节预览·复制本章),共用一个服务端格式化引擎 + 单端点,产出去 markdown、可直接粘贴的成稿(复制 / 下载)。

**Architecture:** BE 纯函数 `publish.ts`(`stripMarkdown` + `formatForPublish`)+ `GET /novels/:id/publish`(text/plain)。FE:`publishNovel` client → 两入口(`PublishDialog` 批量 + `ChaptersView` 单章)。卡片 🗑 换 ⋮ `DropdownMenu`(发布 / 删除二次确认 `Dialog`)。

**Tech Stack:** NestJS 11(BE)+ Next.js 15 / React 18 / shadcn new-york(FE)。BE 测试 jest;FE gate = `pnpm validate`(lint+format+typecheck,无 runner)。

参考 spec:[2026-06-30-novel-publish-design.md](../specs/2026-06-30-novel-publish-design.md)。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `server/src/novel/publish.ts` (+spec) | 纯函数:`stripMarkdown` + `formatForPublish`。无 DI |
| `server/src/novel/novel.controller.ts` | 新 `@Get(':id/publish')` 端点(query→纯函数) |
| `agent-ui/src/api/routes.ts` | `NovelPublish` 路由 |
| `agent-ui/src/api/novels.ts` | `publishNovel` client(返回 text) |
| `agent-ui/src/components/ui/dropdown-menu.tsx` | shadcn add 生成 |
| `agent-ui/src/components/library/PublishDialog.tsx` | 发布弹窗(范围+选项→复制/下载) |
| `agent-ui/src/components/library/NovelCard.tsx` | 🗑→⋮ 菜单 + 删除二次确认 Dialog |
| `agent-ui/src/components/library/NovelLibrary.tsx` | PublishDialog state + onPublish |
| `agent-ui/src/components/workspace/ResourcePanel.tsx` | ChaptersView 加「复制本章」 |

无 DB 迁移、无 agent、无 agentos 改动。

---

## Task 1: BE 纯函数 `publish.ts`(stripMarkdown + formatForPublish)

**Files:**
- Create: `server/src/novel/publish.ts`
- Test: `server/src/novel/publish.spec.ts`

- [ ] **Step 1: 写失败测试**

Create `server/src/novel/publish.spec.ts`:

```ts
import { stripMarkdown, formatForPublish } from './publish';

describe('stripMarkdown', () => {
  it('去标题 #', () => {
    expect(stripMarkdown('# 标题\n正文')).toBe('标题\n正文');
  });
  it('去粗 ** 与斜 *', () => {
    expect(stripMarkdown('**粗**和*斜*')).toBe('粗和斜');
  });
  it('链接 [t](u) → t', () => {
    expect(stripMarkdown('[文](http://x)')).toBe('文');
  });
  it('图片 ![]() 删除', () => {
    expect(stripMarkdown('前![](u)后')).toBe('前后');
  });
  it('引用 > 与列表 - / 1.', () => {
    expect(stripMarkdown('> 引用\n- 项\n1. 项')).toBe('引用\n项\n项');
  });
  it('纯文本不损', () => {
    expect(stripMarkdown('就是普通一句话。')).toBe('就是普通一句话。');
  });
});

describe('formatForPublish', () => {
  const novel = { title: '测试书', synopsis: '这是简介。' };
  const chapters = [
    { order: 1, title: '开端', content: '# 一\n**粗**段落。' },
    { order: 2, title: '发展', content: '第二章正文。' },
    { order: 3, title: '高潮', content: '第三章。' },
  ];
  const baseOpts = {
    from: 0, to: 0, includeTitle: true, includeSynopsis: false, indent: false,
  };

  it('含章题行 + 多章顺序 + 章间分块', () => {
    const out = formatForPublish(novel, chapters, baseOpts);
    expect(out).toContain('第1章 开端');
    expect(out).toContain('第2章 发展');
    expect(out).toContain('一\n粗段落。');
    expect(out.indexOf('第1章')).toBeLessThan(out.indexOf('第2章'));
  });

  it('不含章题行', () => {
    const out = formatForPublish(novel, chapters, {
      ...baseOpts, from: 1, to: 1, includeTitle: false,
    });
    expect(out).not.toContain('第1章');
    expect(out).toContain('粗段落');
  });

  it('范围切片 from..to', () => {
    const out = formatForPublish(novel, chapters, { ...baseOpts, from: 2, to: 2 });
    expect(out).toContain('第2章 发展');
    expect(out).not.toContain('第1章');
    expect(out).not.toContain('第3章');
  });

  it('from=0/to=0 = 全部(clamp 到 min..max)', () => {
    const out = formatForPublish(novel, chapters, baseOpts);
    expect(out).toContain('第1章');
    expect(out).toContain('第3章');
  });

  it('含简介(开头)', () => {
    const out = formatForPublish(novel, chapters, {
      ...baseOpts, from: 1, to: 1, includeSynopsis: true,
    });
    expect(out.startsWith('这是简介。')).toBe(true);
  });

  it('缩进:段首全角空格×2', () => {
    const out = formatForPublish(novel, chapters, {
      ...baseOpts, from: 2, to: 2, includeTitle: false, indent: true,
    });
    expect(out.startsWith('　　')).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && pnpm test -- publish.spec.ts`
Expected: FAIL(模块未导出)

- [ ] **Step 3: 写实现**

Create `server/src/novel/publish.ts`:

```ts
/**
 * 发布格式化(纯函数,无 DI)。把章节 markdown 投影成「可直接粘贴到番茄/起点」
 * 的纯文本成稿。详见 docs/superpowers/specs/2026-06-30-novel-publish-design.md
 */

/** 剥 markdown 标记,保留正文与段落换行。 */
export function stripMarkdown(md: string): string {
  return (
    md
      // 图片 ![alt](url) → 删
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      // 链接 [text](url) → text
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      // 标题 # ## ###(行首)→ 去标记
      .replace(/^#{1,6}\s+/gm, '')
      // 粗 **text** / __text__ → text(先粗后斜,免得 ** 提前被 * 吃)
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      // 斜 *text* / _text_ → text
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      // 行内码 `code` → code
      .replace(/`([^`]+)`/g, '$1')
      // 引用 > → 去
      .replace(/^>\s?/gm, '')
      // 无序列表 - * + → 去
      .replace(/^\s*[-*+]\s+/gm, '')
      // 有序列表 1. → 去
      .replace(/^\s*\d+\.\s+/gm, '')
      // 水平线 --- *** ___ → 删
      .replace(/^\s*([-*_])\1{2,}\s*$/gm, '')
      // 连续空行压成最多一个空行
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

export interface PublishOptions {
  from: number; // ≤0 → 从首章
  to: number; // ≤0 或 > max → 到末章
  includeTitle: boolean;
  includeSynopsis: boolean;
  indent: boolean; // 每段首行加全角空格×2
}

/**
 * novel + chapters → 平台成稿文本。章节按 order 升序,from..to 过滤(clamp)。
 */
export function formatForPublish(
  novel: { title: string; synopsis: string | null },
  chapters: Array<{ order: number; title: string; content: string }>,
  opts: PublishOptions,
): string {
  const sorted = [...chapters].sort((a, b) => a.order - b.order);
  const orders = sorted.map((c) => c.order);
  const min = orders.length ? Math.min(...orders) : 1;
  const max = orders.length ? Math.max(...orders) : 1;
  const from = opts.from > 0 ? opts.from : min;
  const to = opts.to > 0 ? opts.to : max;
  const inRange = sorted.filter((c) => c.order >= from && c.order <= to);

  const parts: string[] = [];
  if (opts.includeSynopsis && novel.synopsis) {
    parts.push(novel.synopsis.trim());
  }
  for (const c of inRange) {
    let body = stripMarkdown(c.content || '');
    if (opts.indent) {
      body = body
        .split('\n')
        .map((line) => (line.trim() ? `　　${line.trim()}` : line))
        .join('\n');
    }
    const head = opts.includeTitle ? `第${c.order}章 ${c.title || ''}\n\n` : '';
    parts.push(`${head}${body}`);
  }
  return parts.join('\n\n');
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && pnpm test -- publish.spec.ts`
Expected: PASS(全 12 用例)

- [ ] **Step 5: 提交**

```bash
git add server/src/novel/publish.ts server/src/novel/publish.spec.ts
git commit -m "feat(publish): stripMarkdown + formatForPublish 纯函数"
```

---

## Task 2: BE 端点 `GET /novels/:id/publish`

**Files:**
- Modify: `server/src/novel/novel.controller.ts`

- [ ] **Step 1: 改 imports(加 Query/Header + formatForPublish)**

在 `server/src/novel/novel.controller.ts` 顶部 `@nestjs/common` import 块加入 `Header`、`Query`(现有:`Body, Controller, Delete, Get, Param, Patch, Post, Put`):

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
```

在 service import 区(`import { StatusService } from './status.service';` 之后)加:

```ts
import { formatForPublish } from './publish';
```

- [ ] **Step 2: 加端点方法**

在 `@Get(':id/chapters') listChapters(...)` 方法**之前**插入:

```ts
  @Get(':id/publish')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async publish(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('title') title?: string,
    @Query('synopsis') synopsis?: string,
    @Query('indent') indent?: string,
  ): Promise<string> {
    const novel = await this.novels.get(user.id, id);
    const chs = await this.chapters.list(user.id, id);
    return formatForPublish(
      { title: novel.title, synopsis: novel.synopsis },
      chs.map((c) => ({
        order: c.order,
        title: c.title ?? '',
        content: c.content ?? '',
      })),
      {
        from: Number(from) || 0,
        to: Number(to) || 0,
        includeTitle: title !== '0',
        includeSynopsis: synopsis === '1',
        indent: indent !== '0',
      },
    );
  }
```

- [ ] **Step 3: typecheck + 全量测试不回归**

Run: `cd server && pnpm typecheck && pnpm test`
Expected: typecheck PASS;全量测试无回归(publish 纯函数已单测,controller 是薄胶水)。

- [ ] **Step 4: 提交**

```bash
git add server/src/novel/novel.controller.ts
git commit -m "feat(publish): GET /novels/:id/publish 端点(text/plain)"
```

---

## Task 3: FE 路由 + `publishNovel` client

**Files:**
- Modify: `agent-ui/src/api/routes.ts`
- Modify: `agent-ui/src/api/novels.ts`

- [ ] **Step 1: routes.ts 加 NovelPublish**

在 `agent-ui/src/api/routes.ts` 的 `NovelReferences` 条目之后加:

```ts
  NovelPublish: (base: string, id: string) => `${base}/novels/${id}/publish`,
```

- [ ] **Step 2: novels.ts 加 publishNovel**

在 `agent-ui/src/api/novels.ts` 末尾(最后一个 export 之后)加:

```ts
export async function publishNovel(
  base: string,
  token: string,
  id: string,
  opts: {
    from: number
    to: number
    title: boolean
    synopsis: boolean
    indent: boolean
  }
): Promise<string> {
  const qs = new URLSearchParams({
    from: String(opts.from),
    to: String(opts.to),
    title: opts.title ? '1' : '0',
    synopsis: opts.synopsis ? '1' : '0',
    indent: opts.indent ? '1' : '0',
  })
  const res = await fetch(`${APIRoutes.NovelPublish(base, id)}?${qs.toString()}`, {
    headers: headers(token),
  })
  if (!res.ok) throw new Error('生成失败')
  return res.text()
}
```

- [ ] **Step 3: typecheck**

Run: `cd agent-ui && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add agent-ui/src/api/routes.ts agent-ui/src/api/novels.ts
git commit -m "feat(publish): FE publishNovel client + NovelPublish 路由"
```

---

## Task 4: 引入 shadcn dropdown-menu

**Files:**
- Create(via CLI): `agent-ui/src/components/ui/dropdown-menu.tsx`

- [ ] **Step 1: 生成组件**

Run: `cd agent-ui && npx shadcn@latest add dropdown-menu`
Expected: 生成 `src/components/ui/dropdown-menu.tsx`(基于 components.json new-york + lucide)。

- [ ] **Step 2: 确认文件存在**

Run: `ls agent-ui/src/components/ui/dropdown-menu.tsx`
Expected: 文件存在。

- [ ] **Step 3: 提交**

```bash
git add agent-ui/src/components/ui/dropdown-menu.tsx
git commit -m "chore(ui): shadcn add dropdown-menu"
```

> 若 `npx shadcn add` 因网络/版本失败:回退方案是从 shadcn 官网 new-york `dropdown-menu.tsx` 源码手动创建(依赖 `@radix-ui/react-dropdown-menu`)。先试 CLI。

---

## Task 5: `PublishDialog` 组件

**Files:**
- Create: `agent-ui/src/components/library/PublishDialog.tsx`

- [ ] **Step 1: 写组件**

Create `agent-ui/src/components/library/PublishDialog.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/store'
import { publishNovel } from '@/api/novels'
import type { NovelListItem } from '@/types/novel'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface Props {
  novel: NovelListItem | null
  onClose: () => void
}

const PublishDialog = ({ novel, onClose }: Props) => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const [rangeMode, setRangeMode] = useState<'all' | 'range'>('all')
  const [from, setFrom] = useState(1)
  const [to, setTo] = useState(1)
  const [includeTitle, setIncludeTitle] = useState(true)
  const [indent, setIndent] = useState(true)
  const [synopsis, setSynopsis] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!novel) return null

  const buildOpts = () => ({
    from: rangeMode === 'all' ? 0 : from,
    to: rangeMode === 'all' ? 0 : to,
    title: includeTitle,
    synopsis,
    indent,
  })

  const rangeLabel =
    rangeMode === 'all' ? '全部章节' : `第${from}-${to}章`

  const handleCopy = async () => {
    setBusy(true)
    try {
      const text = await publishNovel(endpoint, token, novel.id, buildOpts())
      await navigator.clipboard.writeText(text)
      toast.success(`已复制 ${rangeLabel} 成稿`)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '生成失败')
    } finally {
      setBusy(false)
    }
  }

  const handleDownload = async () => {
    setBusy(true)
    try {
      const text = await publishNovel(endpoint, token, novel.id, buildOpts())
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${novel.title || '小说'}.txt`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '生成失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>发布《{novel.title}》</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2 text-sm text-primary">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="w-16 shrink-0 text-xs text-muted">章节范围</span>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={rangeMode === 'all'}
                onChange={() => setRangeMode('all')}
              />
              全部
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={rangeMode === 'range'}
                onChange={() => setRangeMode('range')}
              />
              第
            </label>
            <input
              type="number"
              min={1}
              value={from}
              disabled={rangeMode !== 'range'}
              onChange={(e) => setFrom(Number(e.target.value) || 1)}
              className="w-16 rounded border border-primary/10 bg-background px-1 py-0.5 disabled:opacity-40"
            />
            <span className="text-muted">–</span>
            <input
              type="number"
              min={1}
              value={to}
              disabled={rangeMode !== 'range'}
              onChange={(e) => setTo(Number(e.target.value) || 1)}
              className="w-16 rounded border border-primary/10 bg-background px-1 py-0.5 disabled:opacity-40"
            />
            <span className="text-muted">章</span>
          </div>
          <div className="space-y-1.5">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={includeTitle}
                onChange={(e) => setIncludeTitle(e.target.checked)}
              />
              含章题行
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={indent}
                onChange={(e) => setIndent(e.target.checked)}
              />
              首行缩进(全角空格×2)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={synopsis}
                onChange={(e) => setSynopsis(e.target.checked)}
              />
              含简介(开头)
            </label>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button onClick={handleCopy} disabled={busy}>
            {busy ? '生成中…' : '复制到剪贴板'}
          </Button>
          <Button variant="secondary" onClick={handleDownload} disabled={busy}>
            下载 .txt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default PublishDialog
```

- [ ] **Step 2: typecheck**

Run: `cd agent-ui && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add agent-ui/src/components/library/PublishDialog.tsx
git commit -m "feat(publish): PublishDialog 弹窗(范围+选项→复制/下载)"
```

---

## Task 6: `NovelCard` ⋮ 菜单 + 删除二次确认

**Files:**
- Modify: `agent-ui/src/components/library/NovelCard.tsx`(整文件重写)

- [ ] **Step 1: 整文件替换为**

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NovelListItem } from '@/types/novel'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface Props {
  novel: NovelListItem
  onDelete: (id: string) => void
  onPublish?: (novel: NovelListItem) => void
}

const formatDate = (iso: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('zh-CN')
}

const NovelCard = ({ novel, onDelete, onPublish }: Props) => {
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <>
      <Link
        href={`/novels/${novel.id}`}
        className={cn(
          'group relative flex flex-col gap-2 rounded-2xl border border-primary/10 bg-background-secondary p-5 transition-colors hover:border-brand/40',
          novel.status === 'ACTIVE' && 'border-l-2 border-l-brand/60',
        )}
      >
        {/* ⋮ 三点菜单:stopPropagation 不触发卡片 Link 跳转 */}
        <div
          className="absolute right-3 top-3 z-10 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title="更多"
                className="rounded-md bg-background-secondary/80 p-1 text-muted hover:text-primary"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  setMenuOpen(false)
                  onPublish?.(novel)
                }}
              >
                发布
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => {
                  setMenuOpen(false)
                  setConfirmOpen(true)
                }}
              >
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-start justify-between gap-2 pr-8">
          <h3 className="line-clamp-1 text-base font-semibold text-primary">
            {novel.title}
          </h3>
          <span
            className={cn(
              'shrink-0 rounded-md px-2 py-0.5 text-xs',
              novel.status === 'CONCEPT'
                ? 'bg-accent text-muted'
                : 'bg-brand/20 text-brand',
            )}
          >
            {novel.status === 'CONCEPT' ? '构思中' : '写作中'}
          </span>
        </div>
        {novel.genre && <span className="text-xs text-muted">{novel.genre}</span>}
        <p className="line-clamp-3 text-xs text-muted/80">
          {novel.synopsis || '暂无简介'}
        </p>
        <div className="mt-auto flex items-center justify-between pt-2">
          <span className="text-xs text-muted/50">{formatDate(novel.updatedAt)}</span>
        </div>
      </Link>

      {/* 删除二次确认 */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>删除《{novel.title}》?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted">此操作不可撤销。</p>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmOpen(false)
                onDelete(novel.id)
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default NovelCard
```

- [ ] **Step 2: typecheck**

Run: `cd agent-ui && pnpm typecheck`
Expected: PASS(注:`onPublish` prop 此时未被 NovelLibrary 传入 → TS 不报错,只在运行时 undefined;Task 7 接线)

- [ ] **Step 3: 提交**

```bash
git add agent-ui/src/components/library/NovelCard.tsx
git commit -m "feat(publish): NovelCard 🗑→⋮ 菜单 + 删除二次确认 Dialog"
```

---

## Task 7: `NovelLibrary` 接线 PublishDialog

**Files:**
- Modify: `agent-ui/src/components/library/NovelLibrary.tsx`

- [ ] **Step 1: 改 imports + 加 state + onPublish**

在 `agent-ui/src/components/library/NovelLibrary.tsx`:

import 区(`import NovelCard from './NovelCard'` 之后)加:

```ts
import PublishDialog from './PublishDialog'
```

在 `const [loading, setLoading] = useState(true)` 之后加:

```ts
  const [publishing, setPublishing] = useState<NovelListItem | null>(null)
```

在 `onDeleteNovel` 之后加:

```ts
  const onPublishNovel = (n: NovelListItem) => setPublishing(n)
```

- [ ] **Step 2: 给 NovelCard 传 onPublish + 渲染 PublishDialog**

把 NovelLibrary return 里的卡片那行:

```tsx
              <NovelCard key={n.id} novel={n} onDelete={onDeleteNovel} />
```

改为:

```tsx
              <NovelCard
                key={n.id}
                novel={n}
                onDelete={onDeleteNovel}
                onPublish={onPublishNovel}
              />
```

在 `</main>` 之前(`</main>` 与外层 `</div>` 之间)加:

```tsx
        <PublishDialog novel={publishing} onClose={() => setPublishing(null)} />
```

- [ ] **Step 3: typecheck**

Run: `cd agent-ui && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add agent-ui/src/components/library/NovelLibrary.tsx
git commit -m "feat(publish): NovelLibrary 接线 PublishDialog + onPublish"
```

---

## Task 8: 章节预览「复制本章」(ChaptersView)

**Files:**
- Modify: `agent-ui/src/components/workspace/ResourcePanel.tsx`

- [ ] **Step 1: 顶部 imports 加 publishNovel + toast**

在 `ResourcePanel.tsx` 顶部 import 区(`import { ReferencesView } from './ReferencesView'` 附近)加:

```ts
import { toast } from 'sonner'
import { publishNovel } from '@/api/novels'
```

- [ ] **Step 2: ChaptersView 内加 endpoint/token/copying + copyChapter**

在 `ChaptersView` 组件内,现有 `const [tocOpen, setTocOpen] = useState(false)` 之后加:

```ts
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const [copying, setCopying] = useState(false)

  const copyChapter = async () => {
    if (currentChapterOrder == null || !chapter) return
    setCopying(true)
    try {
      const text = await publishNovel(endpoint, token, novel.id, {
        from: currentChapterOrder,
        to: currentChapterOrder,
        title: true,
        synopsis: false,
        indent: true,
      })
      await navigator.clipboard.writeText(text)
      toast.success(`已复制第${currentChapterOrder}章`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '复制失败')
    } finally {
      setCopying(false)
    }
  }
```

- [ ] **Step 3: 切换头 ☰ 旁加「复制本章」按钮**

把 ChaptersView 切换头里 `☰` 目录按钮那一块:

```tsx
          <button
            type="button"
            onClick={() => setTocOpen((v) => !v)}
            className="px-1 text-muted hover:text-primary"
            title="目录"
          >
            ☰
          </button>
```

替换为(在 ☰ 之前插一个 📋 复制按钮):

```tsx
          <button
            type="button"
            onClick={copyChapter}
            disabled={copying || !chapter.content}
            title="复制本章(发布用)"
            className="px-1 text-muted hover:text-primary disabled:opacity-30"
          >
            📋
          </button>
          <button
            type="button"
            onClick={() => setTocOpen((v) => !v)}
            className="px-1 text-muted hover:text-primary"
            title="目录"
          >
            ☰
          </button>
```

- [ ] **Step 4: typecheck + lint**

Run: `cd agent-ui && pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add agent-ui/src/components/workspace/ResourcePanel.tsx
git commit -m "feat(publish): 章节预览加「复制本章」按钮"
```

---

## Task 9: 全量校验

- [ ] **Step 1: BE typecheck + test**

Run: `cd server && pnpm typecheck && pnpm test`
Expected: PASS(publish.spec 全绿;既有套件不回归)

- [ ] **Step 2: FE validate**

Run: `cd agent-ui && pnpm validate`
Expected: PASS(lint + format + typecheck)。若 format 报格式不符,跑 `pnpm format:fix` 后只提交本功能相关文件的格式修正(不捎带无关文件)。

- [ ] **Step 3: 手动验收(需 server + agent-ui 都跑起来)**

启动:`pnpm dev`(根目录,agent-ui:3000 + server:3001)。登录后:
1. 图书馆卡片 hover → ⋮ 菜单显出「发布 / 删除」两项。
2. 点「删除」→ 二次确认 Dialog → 取消/删除均生效。
3. 点「发布」→ 弹窗:默认「全部 + 含章题 + 缩进」;改「第 1–1 章」;点「复制到剪贴板」→ toast「已复制 第1-1章 成稿」→ 粘贴到记事本验证无 markdown 残留、有章题行、段首缩进。
4. 弹窗「下载 .txt」→ 下载 `书名.txt`,内容同上。
5. 进某小说工作区 → 资源面板「正文」tab → 切换头 📋 按钮 → toast「已复制第N章」→ 粘贴验证。

- [ ] **Step 4: 若 lint/format 有收尾改动,提交**

```bash
git add -A
git commit -m "chore(publish): lint/format 收尾"
```

---

## 自检(spec 覆盖对照)

- §3 架构(服务端引擎 + 单端点 + 两入口)→ Task 1/2/3/5/8 ✓
- §4.1 `stripMarkdown` + `formatForPublish`(纯函数,clamp,缩进,简介)→ Task 1 ✓
- §4.2 `GET /novels/:id/publish`(query、text/plain、clamp 语义)→ Task 2 ✓
- §5.1 卡片 ⋮ 菜单 + 删除二次确认 Dialog → Task 4(菜单组件)+ Task 6 ✓
- §5.2 PublishDialog(范围 + 三选项 + 复制/下载)→ Task 5 ✓
- §5.3 章节预览复制本章 → Task 8 ✓
- §6 publishNovel client + 路由 → Task 3 ✓
- §7 测试(BE 单测;FE validate)→ Task 1/9 ✓
- §10 验收 → Task 9 ✓
