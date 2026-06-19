# 交错内联活动时间线(Markdown 嵌套组件)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 把 agent 消息从「正文在上 + 活动卡片列表在下」改成**一篇 Markdown 文档**——正文是普通 Markdown,`think`/`tool`/`stage` 是 `remark-directive` 自定义指令组件,嵌套在真实发生位置(默认折叠);并**持久化 activities**,使刷新/重开后交错时间线完整保留。

**Architecture:** 前端:`message.content` = 带静态指令标记的 Markdown 串(按时序),`message.activities` = id→细节查找表;`MarkdownRenderer` 加 `remark-directive` + 一个把指令转 HAST 的小插件 + `components` 映射(`ThinkBlock`/`ToolBlock`/`StageBlock`),组件按 id 从 `ActivitiesContext` 取细节;`MessageItem` 始终是一个 `<MarkdownRenderer>`。后端:`Message.activities Json?` 列;`aggregateActivities(events)` 把扁平 `Act*` 事件聚合成 `{ contentMarkdown, activitiesLookup }`,随 `appendTurn` 落库,`getRuns` 回带;`useSessionLoader` 还原。

**Tech Stack:** FE — Next.js 15 + `react-markdown` v9 + `remark-directive`(新增)+ `rehype-sanitize`。BE — NestJS 11 + Prisma 7 + Jest。Gates:server `pnpm typecheck && pnpm lint && pnpm test && pnpm build`;FE `pnpm validate && pnpm build`(agent-ui 无测试 runner,FE 靠 gates + 冒烟)。

**Spec:** [docs/superpowers/specs/2026-06-19-interleaved-activity-timeline-design.md](../specs/2026-06-19-interleaved-activity-timeline-design.md)
**Branch:** `feat/interleaved-activity-timeline`(已存在,off `main`)。

---

## 关键约定(全计划共用)

- **指令标记语法**(remark-directive leaf directive,只带 id,细节在查找表):
  - think: `::think{id="<id>"}`
  - tool: `::tool{id="<id>"}`
  - stage: `::stage{id="<id>"}`
  - 在 Markdown 串里前后各空一行(块级):追加时用 `\n\n::think{id="..."}\n\n`。
- **活动 id 前缀**(来自 server `nextActId`):`think-…` / `tool-…` / `stage-…` / `content-…`。content 不进查找表(其文本直接在 Markdown 串里)。
- **`ActivityDetail` 形状(FE + BE 同款)**:
  ```ts
  interface ActivityDetail {
    act: 'think' | 'tool' | 'stage'
    label?: string
    text?: string            // think 推理全文
    toolArgs?: unknown       // tool 参数
    toolResult?: unknown     // tool 返回
    status?: 'ok' | 'error'
    summary?: string
  }
  type ActivityMap = Record<string, ActivityDetail>
  ```
- **聚合逻辑(FE 流式 + server 纯函数,同构)**:`Act{think|tool|stage,id}` → 追加标记到 content + 开查找表条目;`ActDelta{id}` → id 在表里(think)则 append `text`,否则(content)append 到 content;`ActTool/ActResult/ActEnd` → 填对应字段;`Act{content}` 无操作。

---

# Task 1: 后端 — Message.activities 列 + 迁移

**Files:** Modify `server/prisma/schema.prisma`;生成迁移。

- [ ] **Step 1: 给 Message 加 activities 列**

把 `server/prisma/schema.prisma` 里:
```prisma
model Message {
  id        String   @id @default(cuid())
  sessionId String
  role      String
  content   String
  createdAt DateTime @default(now())
  session   Session  @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId, createdAt])
}
```
改为(加一行 `activities Json?`):
```prisma
model Message {
  id         String   @id @default(cuid())
  sessionId  String
  role       String
  content    String
  activities Json?
  createdAt  DateTime @default(now())
  session    Session   @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId, createdAt])
}
```

- [ ] **Step 2: 生成迁移**

```sh
cd server && pnpm exec prisma migrate dev --name message_activities
```
预期:生成 `prisma/migrations/<ts>_message_activities/migration.sql`,含 `ALTER TABLE "Message" ADD COLUMN "activities" JSONB;`。Prisma 7 是 config-driven,**不加** `--schema`。

- [ ] **Step 3: 重新生成 client + typecheck**

```sh
cd server && pnpm exec prisma generate && pnpm typecheck
```
预期:typecheck 通过(`Message.activities` 类型为 `JsonValue | null`)。

- [ ] **Step 4: Commit**
```sh
git add server/prisma/schema.prisma server/prisma/migrations
git commit -m "feat(db): Message.activities Json? column for persisted activity timeline"
```

---

# Task 2: 后端 — activity-aggregator(纯函数 + 单测)[TDD]

**Files:** Create `server/src/pipeline/activity-aggregator.ts`;Test `server/src/pipeline/activity-aggregator.spec.ts`。

- [ ] **Step 1: 写失败测试**

Create `server/src/pipeline/activity-aggregator.spec.ts`:
```ts
import { aggregateActivities } from './activity-aggregator'
import type { ActivityEvent } from './activity.types'

describe('aggregateActivities', () => {
  it('builds markdown with markers + activities lookup in temporal order', () => {
    const events: ActivityEvent[] = [
      { type: 'Act', id: 'think-1', act: 'think', label: '思考' },
      { type: 'ActDelta', id: 'think-1', text: '想' },
      { type: 'ActDelta', id: 'content-1', text: '你好' },
      { type: 'Act', id: 'tool-1', act: 'tool', label: 'append_section' },
      { type: 'ActTool', id: 'tool-1', args: { chapterOrder: 1 } },
      { type: 'ActResult', id: 'tool-1', result: { ok: true } },
      { type: 'ActEnd', id: 'tool-1', status: 'ok' },
      { type: 'ActEnd', id: 'think-1', status: 'ok' },
    ]
    const { contentMarkdown, activities } = aggregateActivities(events)

    // think 标记 → 你好(content 正文)→ tool 标记,按时序
    expect(contentMarkdown).toBe(
      '::think{id="think-1"}\n\n你好\n\n::tool{id="tool-1"}'
    )
    expect(activities['think-1']).toEqual({ act: 'think', label: '思考', text: '想', status: 'ok' })
    expect(activities['tool-1']).toEqual({
      act: 'tool',
      label: 'append_section',
      toolArgs: { chapterOrder: 1 },
      toolResult: { ok: true },
      status: 'ok',
    })
    // content 不进表
    expect(activities['content-1']).toBeUndefined()
  })

  it('handles stage markers', () => {
    const events: ActivityEvent[] = [
      { type: 'Act', id: 'stage-1', act: 'stage', label: 'writer' },
      { type: 'ActDelta', id: 'content-1', text: '正文' },
    ]
    const { contentMarkdown, activities } = aggregateActivities(events)
    expect(contentMarkdown).toBe('::stage{id="stage-1"}\n\n正文')
    expect(activities['stage-1']).toEqual({ act: 'stage', label: 'writer' })
  })

  it('produces empty content for an event-less turn', () => {
    const { contentMarkdown, activities } = aggregateActivities([])
    expect(contentMarkdown).toBe('')
    expect(activities).toEqual({})
  })
})
```

- [ ] **Step 2: 跑测试,确认失败**

```sh
cd server && pnpm test -- activity-aggregator
```
预期:FAIL(`aggregateActivities` 未定义)。

- [ ] **Step 3: 实现 aggregator**

Create `server/src/pipeline/activity-aggregator.ts`:
```ts
import type { ActivityEvent } from './activity.types'

/** 单个活动条目的细节(think/tool/stage),与 FE 的 ActivityDetail 同款。 */
export interface ActivityDetail {
  act: 'think' | 'tool' | 'stage'
  label?: string
  text?: string
  toolArgs?: unknown
  toolResult?: unknown
  status?: 'ok' | 'error'
  summary?: string
}
export type ActivityMap = Record<string, ActivityDetail>

export interface AggregatedTurn {
  contentMarkdown: string
  activities: ActivityMap
}

/**
 * 把一轮扁平 ActivityEvent 流聚合成 { contentMarkdown, activitiesLookup }。
 * content 的正文直接进 markdown 串;think/tool/stage 只插 leaf 指令标记,
 * 细节存进查找表。FE 流式构建与此同构(见 useAIStreamHandler Act* 分支)。
 *
 * contentMarkdown 里 think/tool/stage 的标记语法必须与 FE 完全一致:
 *   ::think{id="<id>"}  ::tool{id="<id>"}  ::stage{id="<id>"}
 */
export function aggregateActivities(events: ActivityEvent[]): AggregatedTurn {
  let contentMarkdown = ''
  const activities: ActivityMap = {}

  for (const ev of events) {
    if (ev.type === 'Act' && ev.act !== 'content' && ev.id) {
      contentMarkdown += `\n\n::${ev.act}{id="${ev.id}"}\n\n`
      const detail: ActivityDetail = { act: ev.act }
      if (ev.label) detail.label = ev.label
      activities[ev.id] = detail
    } else if (
      ev.type === 'ActDelta' &&
      ev.id &&
      typeof ev.text === 'string'
    ) {
      const existing = activities[ev.id]
      if (existing) {
        // think 的推理增量
        activities[ev.id] = {
          ...existing,
          text: (existing.text ?? '') + ev.text,
        }
      } else {
        // content 正文增量
        contentMarkdown += ev.text
      }
    } else if (ev.type === 'ActTool' && ev.id && activities[ev.id]) {
      activities[ev.id] = { ...activities[ev.id], toolArgs: ev.args }
    } else if (ev.type === 'ActResult' && ev.id && activities[ev.id]) {
      activities[ev.id] = { ...activities[ev.id], toolResult: ev.result }
    } else if (ev.type === 'ActEnd' && ev.id && activities[ev.id]) {
      activities[ev.id] = {
        ...activities[ev.id],
        status: ev.status,
        summary: ev.summary,
      }
    }
  }

  return { contentMarkdown: contentMarkdown.trim(), activities }
}
```

- [ ] **Step 4: 跑测试,确认通过**

```sh
cd server && pnpm test -- activity-aggregator
```
预期:PASS(3 个用例)。

- [ ] **Step 5: typecheck + Commit**
```sh
cd server && pnpm typecheck
git add server/src/pipeline/activity-aggregator.ts server/src/pipeline/activity-aggregator.spec.ts
git commit -m "feat(pipeline): aggregateActivities — Act* events → markdown+markers + activities lookup"
```

---

# Task 3: 后端 — sessions.service 持久化 + 回读 activities [TDD]

**Files:** Modify `server/src/agentos/sessions.service.ts`;Test `server/src/agentos/sessions.service.spec.ts`。

- [ ] **Step 1: 读现有 appendTurn / getRuns / RunPair**

```sh
cd server && sed -n '1,140p' src/agentos/sessions.service.ts
```
确认 `RunPair` 形状(含 `userContent`、`assistantContent`、`createdAt`)与 `appendTurn(userId, sessionId, userContent, assistantContent)`、`getRuns` 签名。

- [ ] **Step 2: 写/改测试**

打开 `server/src/agentos/sessions.service.spec.ts`,在现有用例基础上加(若无 appendTurn 用例则新增 describe):
```ts
it('appendTurn stores activities on the assistant message and getRuns returns them', async () => {
  // 造一个 stub prisma:message.create 两次(user + assistant),记录 assistant 的 data
  const created: Array<Record<string, unknown>> = []
  const prisma = {
    message: {
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        created.push(args.data)
        return Promise.resolve({})
      }),
    },
    session: { upsert: jest.fn(() => Promise.resolve({ id: 's1', name: 'n', createdAt: new Date(), updatedAt: new Date() })) },
    // ...其它 getRuns 用到的 stub(沿用文件里现有的 mock 风格)
  }
  const svc = new SessionsService(prisma as any)
  const activities = { 'think-1': { act: 'think', text: '想' } }
  await svc.appendTurn('u1', 's1', 'hi', '你好', activities)

  // 第二条 create 是 assistant,带 activities
  const assistant = created.find((d) => d.role === 'assistant')
  expect(assistant).toBeDefined()
  expect(assistant!.activities).toEqual(activities)
})
```
(若文件已有 prisma mock 工厂,复用之;关键是断言 `assistant.activities` 被存。)

- [ ] **Step 3: 跑测试,确认失败**

```sh
cd server && pnpm test -- sessions.service
```
预期:FAIL(appendTurn 不接受/不存 activities)。

- [ ] **Step 4: 改 appendTurn + RunPair + getRuns**

在 `server/src/agentos/sessions.service.ts`:
- `RunPair` 加字段:
  ```ts
  export interface RunPair {
    userContent: string
    assistantContent: string
    activities: unknown // 已聚合的 ActivityMap(JSON),未存则 null
    createdAt: Date
  }
  ```
- `appendTurn` 签名加可选 `activities`,写入 assistant message 的 `activities`:
  ```ts
  async appendTurn(
    userId: string,
    sessionId: string,
    userContent: string,
    assistantContent: string,
    activities?: unknown,
  ): Promise<void> {
    // ...resolveSession 等沿用现有
    // assistant message create 的 data 里加 activities(可能 undefined → 列为 null)
    await this.prisma.message.create({
      data: { sessionId, role: 'assistant', content: assistantContent, activities: activities ?? undefined },
    })
  }
  ```
  (保留原有 user message create 不变;只给 assistant 加 `activities`。)
- `getRuns` 在拼 `RunPair` 时带上 `activities`(从 message row 读):
  ```ts
  // 现有循环里构造 RunPair 时:
  assistantContent: messages[i + 1].content,
  activities: (messages[i + 1] as { activities?: unknown }).activities ?? null,
  createdAt: messages[i + 1].createdAt,
  ```
  (`findMany` 默认 select 全列,activities 已含。)

- [ ] **Step 5: 跑测试,确认通过**
```sh
cd server && pnpm test -- sessions.service
```
预期:PASS。

- [ ] **Step 6: typecheck + Commit**
```sh
cd server && pnpm typecheck
git add server/src/agentos/sessions.service.ts server/src/agentos/sessions.service.spec.ts
git commit -m "feat(agentos): persist + return Message.activities in appendTurn / getRuns"
```

---

# Task 4: 后端 — controller 接聚合 + getSessionRuns 回带 activities [TDD + gate]

**Files:** Modify `server/src/agentos/agentos.controller.ts`;Test `server/src/agentos/agentos.controller.spec.ts`。

- [ ] **Step 1: 改 controller runAgent —— 收集事件 + 聚合 + 传 appendTurn**

在 `server/src/agentos/agentos.controller.ts`:
- 顶部 import:`import { aggregateActivities } from '../pipeline/activity-aggregator'`、`import type { ActivityEvent } from '../pipeline/activity.types'`。
- `runAgent` 里:把现在累计 `fullReply` 的逻辑替换为「收集原始 ActivityEvent」。
  - 删掉 `let fullReply = ''` 与 emit 里的 `fullReply += ev.text` / `contentIds` 累计。
  - 改为:`const collected: ActivityEvent[] = []`。
  - `emit` 改成:
    ```ts
    const emit = (ev: ActivityEvent): void => {
      collected.push(ev)
      res.write(
        JSON.stringify({ event: ev.type, ...ev, created_at: now() }) + '\n',
      )
    }
    ```
  - no-novel fallback 那段保持(它也走 emit → collected)。
  - `runTurn` 之后、RunCompleted 之前,聚合:
    ```ts
    const { contentMarkdown, activities } = aggregateActivities(collected)
    ```
  - `RunCompleted` 帧的 `content` 用 `contentMarkdown`(FE 不再用它显示,但保持一致):
    ```ts
    res.write(JSON.stringify({ event: 'RunCompleted', content: contentMarkdown, created_at: now() }) + '\n')
    ```
  - finally 里 `appendTurn` 用 `contentMarkdown` + `activities`:
    ```ts
    const reply = contentMarkdown.trim() || '（已写入章节正文）'
    await this.sessions.appendTurn(user.id, sessionId, message, reply, activities)
    ```
    (注意:`contentMarkdown` / `activities` 需在 try 外层声明,或把聚合结果存到外层变量供 finally 用。把 `let contentMarkdown = ''` / `let activities: unknown = {}` 声明在 try 之前,try 内赋值。)

- [ ] **Step 2: 改 getSessionRuns 回带 activities**

同文件 `getSessionRuns`:
```ts
return runs.map((r) => ({
  run_input: r.userContent,
  content: r.assistantContent,
  activities: r.activities,
  created_at: toUnix(r.createdAt),
}))
```

- [ ] **Step 3: 更新 controller spec**

`server/src/agentos/agentos.controller.spec.ts`:
- mock 的 `runTurn` emit 出的 Act 事件现在会被 controller 聚合;断言 `RunCompleted.content` 是聚合后的 markdown 串(含标记),`appendTurn` 第 5 参数是 activities lookup。
- 现有「streams flat activity frames」用例:默认 mock emit `Act{think t1}` + `ActDelta t1 '想'` + `Act{content c1}` + `ActDelta c1 'Hello'`。聚合后 `RunCompleted.content` 应为 `::think{id="t1"}\n\nHello`,`appendTurn` 带 `{ 't1': { act:'think', text:'想', status:... } }`。把断言改成:
  ```ts
  expect(frames.at(-1)?.content).toBe('::think{id="t1"}\n\nHello')
  expect(sessions.appendTurn).toHaveBeenCalledWith(
    'u1', 'sess-1', 'hi',
    '::think{id="t1"}\n\nHello',
    expect.objectContaining({ 't1': expect.anything() }),
  )
  ```
- 「emits RunError」用例:runTurn 抛错 → 不聚合、不 appendTurn,断言不变。

- [ ] **Step 4: 跑测试**
```sh
cd server && pnpm test -- agentos.controller
```
预期:PASS。

- [ ] **Step 5: 全量 gate**
```sh
cd server && pnpm typecheck && pnpm lint && pnpm test && pnpm build
```
预期:全绿。

- [ ] **Step 6: Commit**
```sh
git add server/src/agentos/agentos.controller.ts server/src/agentos/agentos.controller.spec.ts
git commit -m "feat(agentos): aggregate activities in controller; persist via appendTurn; return in getRuns"
```

---

# Task 5: 前端 — remark-directive + 指令组件 + activities context

**Files:** `agent-ui/package.json`(加依赖);Create `agent-ui/src/components/ui/typography/MarkdownRenderer/activities.tsx`;Modify `agent-ui/src/components/ui/typography/MarkdownRenderer/MarkdownRenderer.tsx`。

- [ ] **Step 1: 安装 remark-directive**
```sh
cd agent-ui && pnpm add remark-directive
```

- [ ] **Step 2: 创建 activities.tsx(context + remark 插件 + 三个 Block 组件 + sanitize schema)**

Create `agent-ui/src/components/ui/typography/MarkdownRenderer/activities.tsx`:
```tsx
'use client'

import { createContext, useContext, useState, type FC, type ReactNode } from 'react'
import remarkDirective from 'remark-directive'
import { defaultSchema } from 'rehype-sanitize'
import { cn } from '@/lib/utils'

/** id → 活动细节 查找表。MessageItem 提供;指令组件按 id 取细节。 */
export interface ActivityDetail {
  act: 'think' | 'tool' | 'stage'
  label?: string
  text?: string
  toolArgs?: unknown
  toolResult?: unknown
  status?: 'ok' | 'error'
  summary?: string
}
export type ActivityMap = Record<string, ActivityDetail>

export const ActivitiesContext = createContext<ActivityMap | null>(null)

/** 把 ::think/::tool/::stage leaf 指令转成同名 HAST 元素(带 id),供 components 映射渲染。 */
function remarkActivityDirectives() {
  const NAMES = new Set(['think', 'tool', 'stage'])
  const walk = (node: unknown): void => {
    const n = node as {
      type?: string
      name?: string
      attributes?: Record<string, unknown>
      data?: Record<string, unknown>
      children?: unknown[]
    }
    if (n && n.type && n.type.endsWith('Directive') && n.name && NAMES.has(n.name)) {
      const data = n.data ?? (n.data = {})
      data.hName = n.name
      data.hProperties = { ...(data.hProperties as object | undefined), id: n.attributes?.id }
    }
    if (n && Array.isArray(n.children)) for (const c of n.children) walk(c)
  }
  return (tree: unknown) => walk(tree)
}

/** rehype-sanitize schema:在默认白名单上加 think/tool/stage 标签 + id 属性。 */
export const activitySanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'think', 'tool', 'stage'],
  attributes: {
    ...defaultSchema.attributes,
    think: ['id'],
    tool: ['id'],
    stage: ['id']
  }
}

export const activityRemarkPlugins = [remarkDirective, remarkActivityDirectives]

const fmtJson = (v: unknown): string => {
  if (v === undefined) return ''
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

/** 通用折叠块:点标题切换展开/收起。 */
const Collapsible: FC<{
  icon: string
  title: string
  statusMark: string | null
  meta?: string
  children?: ReactNode
}> = ({ icon, title, statusMark, meta, children }) => {
  const [open, setOpen] = useState(false)
  const hasDetail = !!children
  return (
    <div className="my-1 rounded-md bg-background-secondary/40 px-2 py-1 text-xs text-muted">
      <button
        type="button"
        disabled={!hasDetail}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-left disabled:cursor-default"
      >
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{title}</span>
        {meta && <span className="shrink-0 text-muted/50">{meta}</span>}
        {statusMark && <span className="ml-auto shrink-0 text-muted/50">{statusMark}</span>}
        {hasDetail && <span className={cn('ml-1 shrink-0 transition-transform', open && 'rotate-90')}>▸</span>}
      </button>
      {open && hasDetail && (
        <div className="mt-1 space-y-1 border-t border-primary/10 pt-1">{children}</div>
      )}
    </div>
  )
}

const DetailBlock: FC<{ label: string; children: string }> = ({ label, children }) => (
  <div>
    <div className="mb-0.5 text-[10px] uppercase tracking-wide text-muted/50">{label}</div>
    <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-background/60 p-1.5 text-[11px] leading-relaxed text-muted/80">
      {children}
    </pre>
  </div>
)

/** ::think —— 折叠的思考块,显示字数,展开看推理全文。 */
export const ThinkBlock: FC<{ id?: string }> = ({ id }) => {
  const activities = useContext(ActivitiesContext)
  const a = id ? activities?.[id] : undefined
  if (!a) return null
  const text = a.text ?? ''
  return (
    <Collapsible
      icon="🧠"
      title="思考"
      statusMark={a.status === 'error' ? '⚠️' : a.status === 'ok' ? '✓' : null}
      meta={text ? `· ${text.length}字` : undefined}
    >
      <div className="whitespace-pre-wrap break-words leading-relaxed text-muted/80">
        {text || '(空)'}
      </div>
    </Collapsible>
  )
}

/** ::tool —— 折叠的工具块,显示工具名+状态,展开看参数/返回。 */
export const ToolBlock: FC<{ id?: string }> = ({ id }) => {
  const activities = useContext(ActivitiesContext)
  const a = id ? activities?.[id] : undefined
  if (!a) return null
  const hasDetail = a.toolArgs !== undefined || a.toolResult !== undefined
  return (
    <Collapsible
      icon="🔧"
      title={a.label ?? '工具'}
      statusMark={a.status === 'error' ? '⚠️' : a.status === 'ok' ? '✓' : null}
    >
      {hasDetail ? (
        <>
          {a.toolArgs !== undefined && <DetailBlock label="参数">{fmtJson(a.toolArgs)}</DetailBlock>}
          {a.toolResult !== undefined && <DetailBlock label="返回">{fmtJson(a.toolResult)}</DetailBlock>}
          {a.summary && <div className="text-muted/60">{a.summary}</div>}
        </>
      ) : null}
    </Collapsible>
  )
}

/** ::stage —— 视觉分隔条(▶ writer / ▶ settler)。 */
export const StageBlock: FC<{ id?: string }> = ({ id }) => {
  const activities = useContext(ActivitiesContext)
  const a = id ? activities?.[id] : undefined
  return (
    <div className="my-1 flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted/50">
      <span className="h-px flex-1 bg-primary/10" />
      <span className="shrink-0">{a?.label ?? '阶段'}</span>
      <span className="h-px flex-1 bg-primary/10" />
    </div>
  )
}
```

- [ ] **Step 3: 接进 MarkdownRenderer.tsx**

把 `agent-ui/src/components/ui/typography/MarkdownRenderer/MarkdownRenderer.tsx` 整体替换为(注意 `remarkGfm` 必须保留,与新增的 directive 插件并列):
```tsx
import { type FC } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'

import { cn } from '@/lib/utils'

import { type MarkdownRendererProps } from './types'
import { inlineComponents } from './inlineStyles'
import { components } from './styles'
import {
  activityRemarkPlugins,
  activitySanitizeSchema,
  ThinkBlock,
  ToolBlock,
  StageBlock
} from './activities'

const MarkdownRenderer: FC<MarkdownRendererProps> = ({
  children,
  classname,
  inline = false
}) => (
  <ReactMarkdown
    className={cn(
      'prose prose-h1:text-xl dark:prose-invert flex w-full flex-col gap-y-5 rounded-lg',
      classname
    )}
    components={{
      ...(inline ? inlineComponents : components),
      think: ThinkBlock,
      tool: ToolBlock,
      stage: StageBlock
    }}
    remarkPlugins={[remarkGfm, ...activityRemarkPlugins]}
    rehypePlugins={[rehypeRaw, [rehypeSanitize, activitySanitizeSchema]]}
  >
    {children}
  </ReactMarkdown>
)

export default MarkdownRenderer
```

- [ ] **Step 4: gate**
```sh
cd agent-ui && pnpm validate && pnpm build
```
预期:全绿(build 产物含新组件)。

- [ ] **Step 5: Commit**
```sh
git add agent-ui/package.json agent-ui/pnpm-lock.yaml agent-ui/src/components/ui/typography/MarkdownRenderer/
git commit -m "feat(agent-ui): remark-directive + ThinkBlock/ToolBlock/StageBlock + activities context"
```

---

# Task 6: 前端 — 类型 + useAIStreamHandler 重写(构建 markdown+标记 与 lookup)

**Files:** Modify `agent-ui/src/types/os.ts`;Modify `agent-ui/src/hooks/useAIStreamHandler.tsx`。

- [ ] **Step 1: 更新 types/os.ts**

把 `agent-ui/src/types/os.ts` 里现有的 `Activity`/`ActivityAct`(v0.6.0 Task6 加的数组版)替换为查找表版:
```ts
/** 活动条目类型(think/tool/stage;content 不进表)。 */
export type ActivityAct = 'think' | 'tool' | 'stage' | 'content'

/** id → 细节 查找表(与 server ActivityDetail 同款)。 */
export interface ActivityDetail {
  act: ActivityAct
  label?: string
  text?: string
  toolArgs?: unknown
  toolResult?: unknown
  status?: 'ok' | 'error'
  summary?: string
}
export type ActivityMap = Record<string, ActivityDetail>
```
`ChatMessage` 里 `activities?: Activity[]` 改为 `activities?: ActivityMap`。
保留 `ActivityFrame`(Act 帧的宽松形状,handler 用)。

- [ ] **Step 2: 重写 useAIStreamHandler 的 Act* 分支**

`agent-ui/src/hooks/useAIStreamHandler.tsx`:把现在 Act* 分支(累计 `activities[]` 数组、content→`message.content`)整体替换为「构建带标记 content + lookup」:
```ts
} else if (
  chunk.event === RunEvent.Act ||
  chunk.event === RunEvent.ActDelta ||
  chunk.event === RunEvent.ActTool ||
  chunk.event === RunEvent.ActResult ||
  chunk.event === RunEvent.ActEnd
) {
  // 扁平活动流(v2):构建带指令标记的 Markdown content + id→细节 lookup。
  // content 增量并入 message.content(纯追加);think/tool/stage 插标记 + 开表条目。
  const a = chunk as unknown as ActivityFrame
  const ev = a.event
  setMessages((prevMessages) => {
    const newMessages = [...prevMessages]
    const lastMessage = newMessages[newMessages.length - 1]
    if (!lastMessage || lastMessage.role !== 'agent') return newMessages
    const activities: ActivityMap = { ...(lastMessage.activities ?? {}) }

    if (ev === RunEvent.Act && a.id && a.act && a.act !== 'content') {
      // think/tool/stage:插 leaf 指令标记 + 开表条目
      lastMessage.content += `\n\n::${a.act}{id="${a.id}"}\n\n`
      const detail: ActivityDetail = { act: a.act }
      if (a.label) detail.label = a.label
      activities[a.id] = detail
    } else if (ev === RunEvent.ActDelta && a.id && typeof a.text === 'string') {
      if (activities[a.id]) {
        // think 推理增量
        activities[a.id] = {
          ...activities[a.id],
          text: (activities[a.id].text ?? '') + a.text
        }
      } else {
        // content 正文增量
        lastMessage.content += a.text
      }
    } else if (ev === RunEvent.ActTool && a.id && activities[a.id]) {
      activities[a.id] = { ...activities[a.id], toolArgs: a.args }
      // append_section → 通知 ChapterPreview 刷新(取代旧 WritingChapter 帧)
      if (activities[a.id].label === 'append_section') {
        const order = (a.args as { chapterOrder?: number } | undefined)?.chapterOrder
        if (typeof order === 'number') {
          useStore.getState().setWritingChapterOrder(order)
          useStore.getState().bumpChapterWriteSeq()
        }
      }
    } else if (ev === RunEvent.ActResult && a.id && activities[a.id]) {
      activities[a.id] = { ...activities[a.id], toolResult: a.result }
    } else if (ev === RunEvent.ActEnd && a.id && activities[a.id]) {
      activities[a.id] = {
        ...activities[a.id],
        status: a.status,
        summary: a.summary
      }
    }

    lastMessage.activities = activities
    return newMessages
  })
}
```
顶部 import 补:`import type { ActivityMap, ActivityDetail } from '@/types/os'`(已有 `ActivityFrame`)。
注意 `addMessage` 里 agent 消息仍带 `activities: {}`(把 `[]` 改成 `{}`)、`content: ''`。

- [ ] **Step 3: RunCompleted 不再覆盖 content**

同文件 RunCompleted 分支:把 `content: updatedContent` 那段去掉,保留其余(created_at / tool_calls / extra_data 等),即不再覆写 `message.content`(FE 已在流式期间建好带标记的 content)。替换 RunCompleted 分支里返回的对象为:
```ts
return {
  ...message,
  tool_calls: processChunkToolCalls(chunk, message.tool_calls),
  images: chunk.images ?? message.images,
  videos: chunk.videos ?? message.videos,
  response_audio: chunk.response_audio,
  created_at: chunk.created_at ?? message.created_at,
  extra_data: {
    reasoning_steps: chunk.extra_data?.reasoning_steps ?? message.extra_data?.reasoning_steps,
    references: chunk.extra_data?.references ?? message.extra_data?.references
  }
}
```
(去掉 `let updatedContent` 与 `content: updatedContent`。)

- [ ] **Step 4: gate**
```sh
cd agent-ui && pnpm validate && pnpm build
```
预期:全绿。删掉现在用不到的 `lastContent`/RunContent 累计若 typecheck 报 unused(按 lint 提示处理;RunContent 分支可保留为无害的 no-op,或删除 —— 删除更干净,但确认无其它引用)。

- [ ] **Step 5: Commit**
```sh
git add agent-ui/src/types/os.ts agent-ui/src/hooks/useAIStreamHandler.tsx
git commit -m "feat(agent-ui): build markdown+markers content + activities lookup from Act* stream"
```

---

# Task 7: 前端 — MessageItem(MarkdownRenderer + context)、useSessionLoader 还原、删 ActivityTimeline

**Files:** Modify `agent-ui/src/components/chat/ChatArea/Messages/MessageItem.tsx`;Modify `agent-ui/src/hooks/useSessionLoader.tsx`;Delete `agent-ui/src/components/chat/ChatArea/Messages/Activity/`。

- [ ] **Step 1: MessageItem —— 包 ActivitiesContext.Provider + 去掉 ActivityTimeline**

`agent-ui/src/components/chat/ChatArea/Messages/MessageItem.tsx`(最小改动:既有 `message.content` 分支已用 MarkdownRenderer,现在它自动渲染标记组件;只需 Provider 包裹 + 删 ActivityTimeline):
- 去掉 `import ActivityTimeline from './Activity/ActivityTimeline'`。
- 加 import:`import { ActivitiesContext } from '@/components/ui/typography/MarkdownRenderer/activities'`。
- `AgentMessage` 的 return:把外层 `<div className="flex w-full flex-col gap-2">…</div>` 用 Provider 包起来,并删掉 `{<ActivityTimeline activities={message.activities} />}` 那一行:
  ```tsx
  return (
    <ActivitiesContext.Provider value={message.activities ?? null}>
      <div className="flex flex-row items-start gap-4 font-geist">
        <div className="flex-shrink-0">
          <Icon type="agent" size="sm" />
        </div>
        <div className="flex w-full flex-col gap-2">
          {messageContent}
          {message.memory && <MemoryBubble memory={message.memory} />}
        </div>
      </div>
    </ActivitiesContext.Provider>
  )
  ```
  (`messageContent` 的 `message.content` 分支里那个 `<MarkdownRenderer>{message.content}</MarkdownRenderer>` 现在会渲染 `::think/::tool/::stage` 标记为折叠组件;多媒体分支保留不动。流式期间首个活动到达前 `message.content` 为空 → 走 `else` 显示 `AgentThinkingLoader`,首个 think 标记 append 后 content 非空 → 切到 MarkdownRenderer 显示思考块。)`

- [ ] **Step 2: useSessionLoader —— 把 activities 赋给 agent 消息**

`agent-ui/src/hooks/useSessionLoader.tsx`:`messagesFor` 里 push agent 消息处(line ~120-130),加 `activities`:
```ts
filteredMessages.push({
  role: 'agent',
  content: (run.content as string) ?? '',
  activities: (run.activities as ActivityMap | undefined) ?? undefined,
  tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
  extra_data: run.extra_data,
  images: run.images,
  videos: run.videos,
  audio: run.audio,
  response_audio: run.response_audio,
  created_at: run.created_at
})
```
顶部 import:`import { ChatMessage, ToolCall, ReasoningMessage, ChatEntry, ActivityMap } from '@/types/os'`。
(`run.activities` 由 controller getSessionRuns 回带;`ChatEntry` 类型加 `activities?: unknown` —— 见下一步。)

- [ ] **Step 3: ChatEntry 类型加 activities**

`agent-ui/src/types/os.ts` 的 `ChatEntry` 接口里,给 `response` 加 `activities?`(或在顶层加,看 useSessionLoader 取的是 `run.activities` 还是 `run.response.activities`。Step 2 用的是 `run.activities`,而 `run` 是 `ChatEntry`。把 `ChatEntry` 顶层加 `activities?: ActivityMap`):
```ts
export interface ChatEntry {
  message: { ... }
  response: { ... ; created_at: number }
  activities?: ActivityMap   // ← 新增
}
```

- [ ] **Step 4: 删 ActivityTimeline / ActivityItem 目录**
```sh
cd agent-ui && git rm -r src/components/chat/ChatArea/Messages/Activity
```
(确认无其它文件 import 这个目录 —— 仅 MessageItem 引用,已在 Step 1 去掉。)

- [ ] **Step 5: gate**
```sh
cd agent-ui && pnpm validate && pnpm build
```
预期:全绿(无 dangling import)。

- [ ] **Step 6: Commit**
```sh
git add -A
git commit -m "feat(agent-ui): MessageItem renders one Markdown doc with activities context; restore on load; drop ActivityTimeline"
```

---

# Task 8: 冒烟 + 验证

**Files:** none(验证)。

- [ ] **Step 1: 双端 gate**
```sh
cd server && pnpm typecheck && pnpm lint && pnpm test && pnpm build
cd ../agent-ui && pnpm validate && pnpm build
```
预期:全绿。

- [ ] **Step 2: 启服务端 + curl 验证持久化**

```sh
cd server && PORT=3001 node dist/src/main.js > /tmp/nx.log 2>&1 &
sleep 7
```
注册 → 建书 → 发写章消息(沿用 v0.6.0 冒烟的流程),然后:
```sh
# 取该 session 的 runs,确认 content 带标记 + activities 非空
curl -s "http://localhost:3001/sessions/<sessionId>/runs" -H "Authorization: Bearer <token>" \
  | node -e "const r=JSON.parse(require('fs').readFileSync(0));const a=r.find(x=>x.activities);console.log('has activities:', !!a, '| content has marker:', /::(think|tool|stage)\{id=/.test(a?.content||''))"
```
预期:`has activities: true | content has marker: true`。
结束:`pkill -f "node dist/src/main.js"`。

- [ ] **Step 3: 浏览器冒烟(人工)**

`pnpm dev`(根目录,两端并行)。新建小说 → 立项 → 写一章,确认:
1. agent 回复是**一篇 Markdown 文档**,正文是纯 Markdown 样式;
2. `🧠 思考 ·N字` 在思考阶段字数上涨(不冻屏),出现在真实位置,点开看推理;
3. `🔧` 工具组件在文本流中间出现、调用完填 `✓`,点开看参数/返回;
4. `▶ writer`/`▶ settler` 分隔条分组;
5. 章节正文在右侧 ChapterPreview 一节节长出;
6. **刷新页面后,带标记的文档 + think/tool 组件完整保留**;
7. 多轮无 400。

- [ ] **Step 4: Tag**
```sh
git tag v0.6.1-interleaved-timeline
```

---

## Self-Review

**Spec coverage:**
- §3 渲染模型(remark-directive + 指令组件 + sanitize 白名单)→ Task 5。
- §4.1 数据模型(content 带标记 + activities lookup)→ Task 6(handler)+ Task 2(聚合器)。
- §4.2 FE 流式构建 → Task 6 Step 2。
- §4.3 服务端聚合 → Task 2。
- §5.1 schema 列 → Task 1。
- §5.2 controller 收集+聚合+appendTurn → Task 4;getRuns 回带 → Task 4 Step 2;sessions 持久化 → Task 3。
- §5.3 FE 加载还原 → Task 7 Step 2-3。
- §6 流式观感 → Task 6(标记 + lookup)+ Task 5(折叠组件)。
- §7 边界(chapter 进 preview、两份聚合、content 保留)→ Task 6 保留 append_section 刷新;Task 2/6 两份同构聚合。
- §10 验证 → Task 8。✓

**Placeholder scan:** Task 4 Step 1 提到「把 `contentMarkdown`/`activities` 声明到 try 外层」—— 给了具体变量声明指引,非占位。Task 6 Step 4 提到「按 lint 提示处理 unused」—— 这是清理性提示,主体代码已给全。无 TBD/TODO。

**Type consistency:**
- `ActivityDetail` / `ActivityMap` 在 server(Task 2)、FE types(Task 6 Step 1)、activities.tsx(Task 5 Step 2)三处定义同款字段(act/label/text/toolArgs/toolResult/status/summary)。✓
- 标记语法 `::think{id="..."}` 在 aggregator(Task 2)、handler(Task 6)一致。✓
- `RunPair.activities`、`appendTurn(..., activities?)`、`getRuns` 映射、`getSessionRuns` 返回 `activities`、`ChatEntry.activities`、handler 还原 —— 链路字段名一致(均 `activities`)。✓
- Task 5 Step 3 自我修正了 remarkGfm 的遗漏(明确写出最终 import + remarkPlugins 行)。✓

**Scope:** 单一计划,FE 渲染 + BE 持久化,8 个任务,可顺序执行。
