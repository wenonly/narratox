# 全局知识库浏览页 Implementation Plan (Plan 1/2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在主页左侧加「写作知识库」入口，建一个 `/knowledge` 页面，能按分类浏览/搜索全局知识库（`知识库/` 下的 633 条），并阅读单条正文——不进数据库，server 本地读文件。

**Architecture:** 新增 NestJS `KnowledgeModule`（`KnowledgeService` 读 `知识库/kb_index.json` + `条目/*.md`，内存缓存；`KnowledgeController` 暴露只读 REST）。agent-ui 新增 `/knowledge` 路由页（复用 settings 页骨架 + AppSidebar 新 tab），客户端组件 `KnowledgeBrowser` 采用两栏布局（左：搜索 + 分类树 + 条目列表；右：Markdown 正文阅读器）。

**Tech Stack:** NestJS 11（jest 单测）、Next.js 15 App Router（无测试运行器，质量门 `pnpm validate`）、既有 `知识库/` 语料（16MB，需随仓库提交）。

**关联 spec:** [docs/superpowers/specs/2026-06-23-novel-knowledge-base-design.md](../specs/2026-06-23-novel-knowledge-base-design.md)。本计划只覆盖 spec §2/§3.2/§6.1（全局 KB + 浏览页）。Plan 2 覆盖小说级 NovelReference + curator + 注入 + 工作台面板。

---

## 文件结构

**新增（server）**
- `server/src/knowledge/knowledge.service.ts` — 读 `知识库/` 文件、缓存 index、list/categories/getEntry/search。
- `server/src/knowledge/knowledge.controller.ts` — `GET /knowledge`、`GET /knowledge/:id`，JWT 保护、只读。
- `server/src/knowledge/knowledge.module.ts` — 注册 service + controller + `KB_DIR` provider；`exports: [KnowledgeService]`（Plan 2 的 curator 要用）。
- `server/test/fixtures/kb/kb_index.json` + `server/test/fixtures/kb/条目/方法论教程/fixtures-entry_0001.md` — 单测用的迷你语料（与真实 633 条解耦）。
- `server/src/knowledge/knowledge.service.spec.ts`

**修改（server）**
- `server/src/app.module.ts` — import `KnowledgeModule`。

**新增（agent-ui）**
- `agent-ui/src/types/knowledge.ts` — `KbEntry` / `KbCategory` / `KbListFilter` / `KbEntryDetail`。
- `agent-ui/src/api/knowledge.ts` — `listKnowledge` / `getKnowledgeEntry`。
- `agent-ui/src/components/knowledge/KnowledgeBrowser.tsx` — 两栏浏览组件（client）。
- `agent-ui/src/app/knowledge/page.tsx` — 页面壳（`RequireAuth` + `AppSidebar active="knowledge"` + `KnowledgeBrowser`）。

**修改（agent-ui）**
- `agent-ui/src/api/routes.ts` — 加 `Knowledge` / `KnowledgeEntry`。
- `agent-ui/src/components/layout/AppSidebar.tsx` — `TABS` 加 knowledge、`active` 联合类型加 `'knowledge'`。

**语料**
- `知识库/`（16MB，635 个文件）需随仓库提交（runtime 依赖）；脚本 `build_kb_index.py` 等也一并提交以便追溯生成方式。`拆书_文本/`（原始转换文本）保持 gitignore。

---

## Task 0: 提交语料与生成脚本（前置）

**Files:**
- Modify: `.gitignore`（确认 `知识库/` **不**在忽略列表；`拆书_文本/` 仍在）

- [ ] **Step 1: 确认 `知识库/` 未被忽略**

```bash
cd /Users/taowen/project/narratox
git check-ignore 知识库/ && echo "被忽略，需移除该规则" || echo "OK：知识库/ 未被忽略"
```
Expected: `OK：知识库/ 未被忽略`。若被忽略，从 `.gitignore` 删掉 `知识库/` 规则。

- [ ] **Step 2: 提交语料 + 生成脚本**

```bash
git add 知识库/ build_kb_index.py convert_kb.py convert_kb_pass2.py convert_kb_pass2b.py refine_kb_descriptions.py
git commit -m "$(cat <<'EOF'
chore(kb): 提交全局知识库语料与生成脚本

知识库/ (633 条/6 类) 为 KnowledgeService 的 runtime 依赖，随仓库提交。
生成脚本保留以便追溯。原始转换文本 拆书_文本/ 仍 gitignore。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```
Expected: 提交成功（约 635 个文件）。

---

## Task 1: KnowledgeService（读文件 + 缓存 + 检索）

**Files:**
- Create: `server/src/knowledge/knowledge.service.ts`
- Create: `server/test/fixtures/kb/kb_index.json`
- Create: `server/test/fixtures/kb/条目/方法论教程/fixtures-entry_0001.md`
- Test: `server/src/knowledge/knowledge.service.spec.ts`

- [ ] **Step 1: 建迷你语料 fixture**

`server/test/fixtures/kb/kb_index.json`:
```json
[
  {
    "id": "kb0001",
    "name": "测试-雪花写作法",
    "category": "方法论教程",
    "tags": { "写作环节": ["大纲"] },
    "description": "介绍雪花写作法构建大纲",
    "source": "fixtures/雪花.doc",
    "source_method": "textutil",
    "source_ocr": false,
    "chars": 100,
    "content_hash": "abc123",
    "md_path": "条目/方法论教程/fixtures-entry_0001.md"
  },
  {
    "id": "kb0002",
    "name": "测试-高岭之花人设",
    "category": "人设档案",
    "tags": { "写作环节": ["人设"], "题材": ["言情"] },
    "description": "三步塑造高岭之花",
    "source": "fixtures/高岭.pdf",
    "source_method": "ocr:tesseract(chi_sim)",
    "source_ocr": true,
    "chars": 80,
    "content_hash": "def456",
    "md_path": "条目/人设档案/fixtures-entry_0002.md"
  }
]
```

`server/test/fixtures/kb/条目/方法论教程/fixtures-entry_0001.md`:
```
---
id: kb0001
name: 测试-雪花写作法
category: 方法论教程
---
一、从一句话梗概开始
二、扩成一段话
```

`server/test/fixtures/kb/条目/人设档案/fixtures-entry_0002.md`:
```
---
id: kb0002
name: 测试-高岭之花人设
category: 人设档案
---
高岭之花：外冷内热。
```

- [ ] **Step 2: 写失败测试 `server/src/knowledge/knowledge.service.spec.ts`**

```typescript
import { join } from 'node:path';
import { KnowledgeService } from './knowledge.service';

const FIXTURE = join(__dirname, '../../test/fixtures/kb');

describe('KnowledgeService', () => {
  let svc: KnowledgeService;
  beforeEach(() => { svc = new KnowledgeService(FIXTURE); });

  it('lists all entries with category counts', async () => {
    const { categories, entries } = await svc.list({});
    expect(entries).toHaveLength(2);
    const map = Object.fromEntries(categories.map((c) => [c.name, c.count]));
    expect(map['方法论教程']).toBe(1);
    expect(map['人设档案']).toBe(1);
  });

  it('filters by category', async () => {
    const { entries } = await svc.list({ category: '人设档案' });
    expect(entries.map((e) => e.id)).toEqual(['kb0002']);
  });

  it('filters by tag (matches any tag dimension value)', async () => {
    const { entries } = await svc.list({ tag: '言情' });
    expect(entries.map((e) => e.id)).toEqual(['kb0002']);
  });

  it('searches by name/description substring (case-insensitive)', async () => {
    const { entries } = await svc.list({ search: '雪花' });
    expect(entries.map((e) => e.id)).toEqual(['kb0001']);
  });

  it('getEntry returns body with frontmatter stripped', async () => {
    const r = await svc.getEntry('kb0001');
    expect(r).not.toBeNull();
    expect(r!.content.startsWith('一、从一句话梗概开始')).toBe(true);
    expect(r!.entry.name).toBe('测试-雪花写作法');
  });

  it('getEntry returns null for unknown id', async () => {
    expect(await svc.getEntry('nope')).toBeNull();
  });

  it('search scores results and deprioritizes OCR source', async () => {
    // both match 言情? kb0002 has 言情 tag; query '言' hits kb0002 name? no. use '花'
    const res = await svc.search('花');
    const ids = res.map((e) => e.id);
    expect(ids).toContain('kb0002'); // name '高岭之花人设' contains 花
    expect(ids).toContain('kb0001'); // '雪花' contains 花
    // kb0001 (non-OCR) should rank >= kb0002 (OCR, deprioritized) when base scores tie-ish
    expect(ids.indexOf('kb0001')).toBeLessThanOrEqual(ids.indexOf('kb0002'));
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
cd server && pnpm test -- knowledge.service.spec.ts
```
Expected: FAIL（`KnowledgeService` 未定义 / 模块找不到）。

- [ ] **Step 4: 实现 `server/src/knowledge/knowledge.service.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const KB_DIR = 'KB_DIR';

export interface KbEntry {
  id: string;
  name: string;
  category: string;
  tags: Record<string, string[]>;
  description: string;
  source: string;
  source_method: string;
  source_ocr: boolean;
  chars: number;
  content_hash: string;
  md_path: string;
}

export interface KbCategoryCount {
  name: string;
  count: number;
}

export interface KbListFilter {
  category?: string;
  tag?: string;
  search?: string;
}

@Injectable()
export class KnowledgeService {
  private cache: KbEntry[] | null = null;
  private byId = new Map<string, KbEntry>();

  constructor(private readonly kbDir: string) {}

  private async load(): Promise<KbEntry[]> {
    if (this.cache) return this.cache;
    const raw = await readFile(join(this.kbDir, 'kb_index.json'), 'utf-8');
    const data = JSON.parse(raw) as KbEntry[];
    this.cache = data;
    this.byId = new Map(data.map((e) => [e.id, e]));
    return data;
  }

  async categories(): Promise<KbCategoryCount[]> {
    const entries = await this.load();
    const m = new Map<string, number>();
    for (const e of entries) m.set(e.category, (m.get(e.category) ?? 0) + 1);
    return [...m.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }

  async list(filter: KbListFilter = {}): Promise<{
    categories: KbCategoryCount[];
    entries: KbEntry[];
  }> {
    let entries = await this.load();
    if (filter.category) entries = entries.filter((e) => e.category === filter.category);
    if (filter.tag)
      entries = entries.filter((e) =>
        Object.values(e.tags).flat().includes(filter.tag!),
      );
    if (filter.search) {
      const q = filter.search.toLowerCase();
      entries = entries.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q),
      );
    }
    return { categories: await this.categories(), entries };
  }

  async getEntry(
    id: string,
  ): Promise<{ entry: KbEntry; content: string } | null> {
    await this.load();
    const entry = this.byId.get(id);
    if (!entry) return null;
    const raw = await readFile(join(this.kbDir, entry.md_path), 'utf-8');
    const m = raw.match(/^---\n.*?\n---\n(.*)$/s);
    return { entry, content: (m ? m[1] : raw).trim() };
  }

  /**
   * 关键词检索（Plan 2 的 curator search_knowledge 工具也会用）。
   * 命中：name +5、tag +4、description +3；OCR 来源 -1 降权。
   */
  async search(
    query: string,
    opts: { category?: string; limit?: number } = {},
  ): Promise<KbEntry[]> {
    const entries = await this.load();
    const q = query.toLowerCase();
    let scored = entries
      .map((e) => {
        let score = 0;
        if (e.name.toLowerCase().includes(q)) score += 5;
        if (Object.values(e.tags).flat().some((t) => t.toLowerCase().includes(q)))
          score += 4;
        if (e.description.toLowerCase().includes(q)) score += 3;
        if (e.source_ocr) score -= 1;
        return { e, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    if (opts.category) scored = scored.filter((x) => x.e.category === opts.category);
    return scored.slice(0, opts.limit ?? 8).map((x) => x.e);
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

```bash
cd server && pnpm test -- knowledge.service.spec.ts
```
Expected: PASS（7 个用例全过）。

- [ ] **Step 6: 提交**

```bash
git add server/src/knowledge/knowledge.service.ts server/src/knowledge/knowledge.service.spec.ts server/test/fixtures/kb/
git commit -m "feat(knowledge): KnowledgeService 读取全局知识库 + 单测"
```

---

## Task 2: KnowledgeController + KnowledgeModule

**Files:**
- Create: `server/src/knowledge/knowledge.controller.ts`
- Create: `server/src/knowledge/knowledge.module.ts`
- Test: `server/src/knowledge/knowledge.controller.spec.ts`

- [ ] **Step 1: 写失败测试 `server/src/knowledge/knowledge.controller.spec.ts`**

```typescript
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';

describe('KnowledgeController', () => {
  let controller: KnowledgeController;
  let svc: { list: jest.Mock; getEntry: jest.Mock };

  beforeEach(() => {
    svc = { list: jest.fn(), getEntry: jest.fn() };
    controller = new KnowledgeController(svc as unknown as KnowledgeService);
  });

  it('list() delegates filter to service', async () => {
    svc.list.mockResolvedValue({ categories: [], entries: [] });
    await controller.list('方法论教程', '大纲', '雪花');
    expect(svc.list).toHaveBeenCalledWith({
      category: '方法论教程',
      tag: '大纲',
      search: '雪花',
    });
  });

  it('entry() returns detail from service', async () => {
    const detail = { entry: { id: 'kb0001' }, content: '正文' };
    svc.getEntry.mockResolvedValue(detail);
    await expect(controller.entry('kb0001')).resolves.toEqual(detail);
  });

  it('entry() throws NotFoundException when missing', async () => {
    svc.getEntry.mockResolvedValue(null);
    await expect(controller.entry('nope')).rejects.toThrow('NotFoundException');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd server && pnpm test -- knowledge.controller.spec.ts
```
Expected: FAIL（控制器未定义）。

- [ ] **Step 3: 实现 `server/src/knowledge/knowledge.controller.ts`**

```typescript
import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';

@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly kb: KnowledgeService) {}

  /** 全局知识库是所有用户共享的参考资料：JWT 保护（默认全局 guard），但不按 user 隔离。 */
  @Get()
  list(
    @Query('category') category?: string,
    @Query('tag') tag?: string,
    @Query('search') search?: string,
  ) {
    return this.kb.list({ category, tag, search });
  }

  @Get(':id')
  async entry(@Param('id') id: string) {
    const detail = await this.kb.getEntry(id);
    if (!detail) throw new NotFoundException(`知识条目 ${id} 不存在`);
    return detail;
  }
}
```

- [ ] **Step 4: 实现 `server/src/knowledge/knowledge.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { resolve } from 'node:path';
import { KnowledgeController } from './knowledge.controller';
import { KB_DIR, KnowledgeService } from './knowledge.service';

@Module({
  controllers: [KnowledgeController],
  providers: [
    {
      provide: KB_DIR,
      useFactory: () =>
        process.env.KB_DIR ?? resolve(process.cwd(), '..', '知识库'),
    },
    {
      provide: KnowledgeService,
      useFactory: (kbDir: string) => new KnowledgeService(kbDir),
      inject: [KB_DIR],
    },
  ],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
```

- [ ] **Step 5: 跑测试确认通过**

```bash
cd server && pnpm test -- knowledge.controller.spec.ts
```
Expected: PASS（3 个用例）。

- [ ] **Step 6: 提交**

```bash
git add server/src/knowledge/knowledge.controller.ts server/src/knowledge/knowledge.module.ts server/src/knowledge/knowledge.controller.spec.ts
git commit -m "feat(knowledge): KnowledgeController + Module (只读 /knowledge)"
```

---

## Task 3: 注册 KnowledgeModule 到 app.module

**Files:**
- Modify: `server/src/app.module.ts`

- [ ] **Step 1: 注册模块**

在 `server/src/app.module.ts` 的 `imports` 数组里加 `KnowledgeModule`，并在文件顶部 import：
```typescript
import { KnowledgeModule } from './knowledge/knowledge.module';
```
（加到 `imports: [PrismaModule, AuthModule, AgentosModule, NovelModule, SettingsModule, KnowledgeModule]`）

- [ ] **Step 2: 跑全量 server 单测确认无回归**

```bash
cd server && pnpm test
```
Expected: 全部通过（含新增的 knowledge 两套 spec）。

- [ ] **Step 3: 起服务冒烟（手动）**

```bash
cd server && PORT=3001 pnpm start:dev &
sleep 5
# 需要带有效 JWT；先确认路由挂载（401 也说明路由存在）
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/knowledge
kill %1
```
Expected: `401`（路由已挂载、被全局 JwtAuthGuard 拦截——符合预期）。

- [ ] **Step 4: 提交**

```bash
git add server/src/app.module.ts
git commit -m "feat(knowledge): 注册 KnowledgeModule"
```

---

## Task 4: FE 类型 + API 路由 + 客户端

**Files:**
- Create: `agent-ui/src/types/knowledge.ts`
- Modify: `agent-ui/src/api/routes.ts`
- Create: `agent-ui/src/api/knowledge.ts`

- [ ] **Step 1: 类型 `agent-ui/src/types/knowledge.ts`**

```typescript
export interface KbEntry {
  id: string
  name: string
  category: string
  tags: Record<string, string[]>
  description: string
  source: string
  source_ocr: boolean
  chars: number
}

export interface KbCategory {
  name: string
  count: number
}

export interface KbListFilter {
  category?: string
  tag?: string
  search?: string
}

export interface KbEntryDetail {
  entry: KbEntry & { source_method: string; content_hash: string }
  content: string
}
```

- [ ] **Step 2: 路由 `agent-ui/src/api/routes.ts` 加两条**

找到现有路由对象（如 `SettingsModels`），紧随其后加：
```typescript
Knowledge: (base: string) => `${base}/knowledge`,
KnowledgeEntry: (base: string, id: string) => `${base}/knowledge/${id}`,
```

- [ ] **Step 3: 客户端 `agent-ui/src/api/knowledge.ts`**

```typescript
import { APIRoutes } from './routes'
import type { KbCategory, KbEntry, KbEntryDetail, KbListFilter } from '@/types/knowledge'

const headers = (token: string): HeadersInit => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${token}`
})

async function asJson<T>(res: Promise<Response>): Promise<T> {
  const r = await res
  if (!r.ok) {
    const msg = await r.text().catch(() => r.statusText)
    throw new Error(msg || `HTTP ${r.status}`)
  }
  return r.json() as Promise<T>
}

export const listKnowledge = (
  base: string,
  token: string,
  filter: KbListFilter = {}
): Promise<{ categories: KbCategory[]; entries: KbEntry[] }> => {
  const qs = new URLSearchParams()
  if (filter.category) qs.set('category', filter.category)
  if (filter.tag) qs.set('tag', filter.tag)
  if (filter.search) qs.set('search', filter.search)
  const q = qs.toString()
  return asJson(
    fetch(`${APIRoutes.Knowledge(base)}${q ? '?' + q : ''}`, {
      headers: headers(token)
    })
  )
}

export const getKnowledgeEntry = (
  base: string,
  token: string,
  id: string
): Promise<KbEntryDetail> =>
  asJson(
    fetch(APIRoutes.KnowledgeEntry(base, id), { headers: headers(token) })
  )
```

- [ ] **Step 4: typecheck**

```bash
cd agent-ui && pnpm typecheck
```
Expected: 无错误。

- [ ] **Step 5: 提交**

```bash
git add agent-ui/src/types/knowledge.ts agent-ui/src/api/routes.ts agent-ui/src/api/knowledge.ts
git commit -m "feat(knowledge-ui): 类型 + API 路由 + 客户端"
```

---

## Task 5: KnowledgeBrowser 组件（两栏）

**Files:**
- Create: `agent-ui/src/components/knowledge/KnowledgeBrowser.tsx`

- [ ] **Step 1: 实现组件（布局 B：左搜索+分类树+列表，右阅读器）**

```tsx
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '@/store'
import { listKnowledge, getKnowledgeEntry } from '@/api/knowledge'
import type { KbCategory, KbEntry, KbEntryDetail } from '@/types/knowledge'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'
import { cn } from '@/lib/utils'

const KnowledgeBrowser = () => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)

  const [categories, setCategories] = useState<KbCategory[]>([])
  const [entries, setEntries] = useState<KbEntry[]>([])
  const [activeCat, setActiveCat] = useState<string | undefined>(undefined)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<KbEntryDetail | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!endpoint || !token) return
    setLoading(true)
    try {
      const { categories, entries } = await listKnowledge(endpoint, token, {
        category: activeCat,
        search: search.trim() || undefined
      })
      setCategories(categories)
      setEntries(entries)
    } catch {
      setCategories([])
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [endpoint, token, activeCat, search])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!selectedId || !endpoint || !token) return
    getKnowledgeEntry(endpoint, token, selectedId)
      .then(setDetail)
      .catch(() => setDetail(null))
  }, [selectedId, endpoint, token])

  const tagList = useMemo(() => {
    const all: string[] = []
    entries.forEach((e) =>
      Object.values(e.tags).forEach((vs) => vs.forEach((v) => all.push(v)))
    )
    return [...new Set(all)]
  }, [entries])

  return (
    <div className="flex h-[calc(100vh-7rem)] gap-3">
      {/* 左栏：搜索 + 分类树 + 列表 */}
      <div className="flex w-80 flex-col gap-2">
        <input
          className="w-full rounded-md border border-primary/10 bg-background-secondary px-3 py-2 text-sm text-primary outline-none placeholder:text-muted"
          placeholder="🔍 搜索标题/描述"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex flex-wrap gap-1">
          <button
            className={cn(
              'rounded px-2 py-0.5 text-xs',
              !activeCat ? 'bg-brand/15 text-primary' : 'text-muted hover:text-primary'
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
                  ? 'bg-brand/15 text-primary'
                  : 'text-muted hover:text-primary'
              )}
              onClick={() => setActiveCat(c.name)}
            >
              {c.name} {c.count}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto rounded-md border border-primary/10">
          {loading && <p className="p-3 text-xs text-muted">加载中…</p>}
          {!loading && entries.length === 0 && (
            <p className="p-3 text-xs text-muted">无匹配条目</p>
          )}
          {entries.map((e) => (
            <button
              key={e.id}
              onClick={() => setSelectedId(e.id)}
              className={cn(
                'block w-full border-b border-primary/5 px-3 py-2 text-left transition-colors',
                selectedId === e.id ? 'bg-accent' : 'hover:bg-accent/50'
              )}
            >
              <div className="flex items-center gap-1 text-sm text-primary">
                <span className="truncate">{e.name}</span>
                {e.source_ocr && (
                  <span className="shrink-0 text-[10px] text-muted" title="OCR 来源">
                    🔤
                  </span>
                )}
              </div>
              <p className="truncate text-xs text-muted">{e.description}</p>
            </button>
          ))}
        </div>
        {tagList.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tagList.slice(0, 12).map((t) => (
              <span key={t} className="rounded bg-background-secondary px-1.5 py-0.5 text-[10px] text-muted">
                #{t}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 右栏：阅读器 */}
      <div className="flex-1 overflow-y-auto rounded-md border border-primary/10 bg-background/40 p-6">
        {!detail && (
          <p className="text-sm text-muted">从左侧选一条查看正文。</p>
        )}
        {detail && (
          <>
            <h2 className="mb-1 text-base font-semibold text-primary">
              {detail.entry.name}
            </h2>
            <p className="mb-4 text-xs text-muted">
              {detail.entry.category} · {detail.entry.chars} 字 ·{' '}
              {detail.entry.source_method}
            </p>
            <article className="prose prose-invert max-w-none text-sm">
              <MarkdownRenderer>{detail.content}</MarkdownRenderer>
            </article>
          </>
        )}
      </div>
    </div>
  )
}

export default KnowledgeBrowser
```

- [ ] **Step 2: typecheck**

```bash
cd agent-ui && pnpm typecheck
```
Expected: 无错误。`bg-background-secondary` 是项目既有 token（`globals.css` 定义、多处组件在用）。

- [ ] **Step 3: 提交**

```bash
git add agent-ui/src/components/knowledge/KnowledgeBrowser.tsx
git commit -m "feat(knowledge-ui): KnowledgeBrowser 两栏浏览组件"
```

---

## Task 6: /knowledge 页面 + AppSidebar tab

**Files:**
- Create: `agent-ui/src/app/knowledge/page.tsx`
- Modify: `agent-ui/src/components/layout/AppSidebar.tsx`

- [ ] **Step 1: 页面壳 `agent-ui/src/app/knowledge/page.tsx`（镜像 settings）**

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useStore } from '@/store'
import { getStatusAPI } from '@/api/os'
import RequireAuth from '@/components/auth/RequireAuth'
import AppSidebar from '@/components/layout/AppSidebar'
import KnowledgeBrowser from '@/components/knowledge/KnowledgeBrowser'

export default function KnowledgePage() {
  return (
    <RequireAuth>
      <Knowledge />
    </RequireAuth>
  )
}

const Knowledge = () => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const [status, setStatus] = useState<number | null>(null)

  useEffect(() => {
    getStatusAPI(endpoint, token)
      .then(setStatus)
      .catch(() => setStatus(503))
  }, [endpoint, token])

  return (
    <div className="flex h-screen bg-background/80">
      <AppSidebar active="knowledge" />
      <main className="flex-1 overflow-y-auto p-8">
        <h1 className="mb-2 text-lg font-semibold text-primary">写作知识库</h1>
        <p className="mb-6 text-xs text-muted">
          后端 {endpoint} ·{' '}
          {status === 200 ? '在线 ●' : `离线 (${status ?? '—'})`}
        </p>
        <KnowledgeBrowser />
      </main>
    </div>
  )
}
```

- [ ] **Step 2: AppSidebar 加 tab**

修改 `agent-ui/src/components/layout/AppSidebar.tsx`：

`Props` 的 `active` 联合类型加 `'knowledge'`：
```typescript
interface Props {
  active: 'library' | 'knowledge' | 'settings'
}
```

`TABS` 数组在 `library` 和 `settings` 之间插入：
```typescript
const TABS = [
  { key: 'library', label: '小说库', href: '/' },
  { key: 'knowledge', label: '写作知识库', href: '/knowledge' },
  { key: 'settings', label: '设置', href: '/settings' }
] as const
```

- [ ] **Step 3: 质量门**

```bash
cd agent-ui && pnpm validate
```
Expected: lint + format + typecheck 全过。

- [ ] **Step 4: 手动联调**

```bash
# 终端 1：起 server
cd server && PORT=3001 pnpm start:dev
# 终端 2：起 agent-ui
cd agent-ui && pnpm dev
```
浏览器开 `http://localhost:3000/knowledge`：左侧应出现 6 个分类（方法论 330 / 拆文 107 / 词汇 93 / 须知 43 / 模板 31 / 人设 29），搜索「大纲」能筛出条目，点条目右侧渲染正文。AppSidebar「写作知识库」高亮。

- [ ] **Step 5: 提交**

```bash
git add agent-ui/src/app/knowledge/page.tsx agent-ui/src/components/layout/AppSidebar.tsx
git commit -m "feat(knowledge-ui): /knowledge 页面 + 侧栏入口"
```

---

## 完成标准

- `/knowledge` 页可浏览 633 条、按分类/关键词筛、读正文。
- server `pnpm test` 全过；agent-ui `pnpm validate` 全过。
- `知识库/` 已随仓库提交，`KnowledgeModule` 已导出 `KnowledgeService`（供 Plan 2 的 curator 复用）。

## 下一步

Plan 2（小说级参考资料 + curator + 注入 + 工作台面板）——依赖本计划的 `KnowledgeService.search()`。届时另起 spec→plan。
