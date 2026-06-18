# narratox 工作台 UX 演进(v0.4.0)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把工作台演进为「左侧信息卡+资源(不列章节)+ 右侧章节预览(AI 自动写、骨架+自动跳转+可切换)」,并把创建合并进工作台(统一 swarm,早建 CONCEPT Novel,主 Agent 按状态切立项/写作)。

**Architecture:** 统一 swarm —— 主 Agent 持 `update_novel`(立项填卡)+ `transfer_to_writer`(路由);`ContextAssembler` 按 `Novel.status` 注入状态感知 prompt(CONCEPT→立项,ACTIVE→路由)。`write_chapter` 按序号自动建章;`streamTurn` 检测 write_chapter 工具调用 → 发 `WritingChapter{order}` 信号 → FE 右侧跳章+骨架。删 separate 创作 Agent + `/novels/new`。

**Tech Stack:** NestJS 11 + Prisma 7 + `@langchain/langgraph-swarm` + GLM;Next.js 15(无测试器,门禁 `pnpm validate`)。

**Spec:** [docs/superpowers/specs/2026-06-18-workspace-evolution-design.md](../specs/2026-06-18-workspace-evolution-design.md)
**Branch:** `feat/workspace-evolution`

---

## 约定

- **后端 TDD**(jest):纯函数/工具/控制器走 TDD。**LLM 编排代码**(swarm 构建)靠 spike + E2E + typecheck 验证(本仓库既有纪律)。
- **前端无测试器**:门禁 `pnpm validate` + build。
- **Prisma 7 config-driven**:CLI 不带 `--schema`。
- **ESM 动态 import**:`createReactAgent`/`createSwarm`/`@langchain/openai` 在方法内 `await import()`。
- 工具 `userId`/`novelId` **闭包注入**(防伪造)。
- 实现者必须自己跑 `pnpm typecheck` 并报告精确输出。

## File Structure

**后端(server/)**
- 改 `prisma/schema.prisma` — `NovelStatus` 枚举 + `Novel.status`
- 改 `novel/novel.service.ts` — `create` 建 CONCEPT;`write` 落内容时 CONCEPT→ACTIVE(`ChapterHandler` 或 `NovelService`)
- 新 `agentos/tools/update-novel.tool.ts`(+spec)— `update_novel` 工具
- 改 `agentos/tools/write-chapter.tool.ts`(+spec)— 按序号自动建章
- 改 `agentos/workspace-swarm.service.ts` — streamTurn 发 WritingChapter 信号;主 Agent 加 update_novel 工具 + 状态感知 prompt
- 改 `agentos/context-assembler.service.ts` — 注入 status + 状态感知 prompt
- 改 `agentos/stream-adapter.ts` — `AgentosFrame` 加 `WritingChapter` 事件 + `order` 字段
- 改 `agentos/agentos.controller.ts` — workspace 分支处理 WritingChapter 信号;删 creation 分支
- 删 `agentos/creation-agent.service.ts`(合并进 swarm)
- 改 `agentos/agentos.module.ts` — 移除 CreationAgentService
- 新 `scripts/spike-state-switch.ts` — Task 1 验证脚本

**前端(agent-ui/)**
- 改 `components/library/NovelLibrary.tsx` — 「新建小说」早建 CONCEPT → `/novels/[id]`
- 删 `app/novels/new/page.tsx` + `components/workspace/CreationChat.tsx`
- 改 `components/workspace/ResourceNav.tsx` — 去章节/新章 → 信息卡
- 改 `components/workspace/ChapterDetail.tsx` → `ChapterPreview`(切换器+骨架+WritingChapter)
- 改 `app/novels/[id]/page.tsx` — 适配新 ResourceNav + ChapterPreview
- 改 `hooks/useAIStreamHandler.tsx` — 处理 WritingChapter 事件

---

# Task 1: 主 Agent 状态切换可靠性 spike(架构闸门)

验证主 Agent 能否按状态可靠选对工具:CONCEPT/bare → `update_novel`;信息齐 → `transfer_to_writer`。**通过 → 继续统一 swarm;失败 → 回退 separate 创作 Agent(保留 v0.3.0 split),重新规划。**

**Files:** Create `server/scripts/spike-state-switch.ts`

- [ ] **Step 1: 写 spike 脚本**
```ts
// 验证:主 Agent 按状态选 update_novel(CONCEPT) vs transfer_to_writer(ready)。
// 运行: cd server && pnpm exec ts-node scripts/spike-state-switch.ts
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { createReactAgent } from '@langchain/langgraph/prebuilt'
import { createSwarm, createHandoffTool } from '@langchain/langgraph-swarm'

const MODEL = new ChatOpenAI({
  apiKey: process.env.ZHIPUAI_API_KEY!,
  model: 'GLM-5.2',
  configuration: { baseURL: 'https://api.z.ai/api/coding/paas/v4' },
})

// stub update_novel(只测路由决策,不真写)
const updateNovel = tool(
  async () => ({ ok: true, message: '已更新小说信息。' }),
  { name: 'update_novel', description: '更新小说的基础信息(书名/类型/世界观/文风)。立项收集信息时调用。', schema: z.object({ title: z.string().optional(), genre: z.string().optional() }) },
)

const CONCEPT_PROMPT = `你是小说工作台的主 Agent。这本小说刚创建(信息不全)。
当前状态:书名="未命名",类型=未知,世界观=未知。
你的任务:通过问答收集书名/类型/世界观,每轮调 update_novel 更新。信息够前不要转交写作。`

const READY_PROMPT = `你是小说工作台的主 Agent。这本小说信息已齐全。
当前状态:书名《青云志》,类型=修仙,世界观=九州灵气。
作者要写正文时,用 transfer_to_writer 转交写作 Agent。`

async function run(label: string, prompt: string, userMsg: string, expectTool: string) {
  const main = createReactAgent({
    llm: MODEL, name: 'main', prompt,
    tools: [updateNovel, createHandoffTool({ agentName: 'writer', description: '转交写作 Agent 写正文' })],
  })
  const writer = createReactAgent({
    llm: MODEL, name: 'writer', prompt: '写作 Agent。收到后写一小段正文。',
    tools: [createHandoffTool({ agentName: 'main' })],
  })
  const app = createSwarm({ agents: [main, writer], defaultActiveAgent: 'main' }).compile()
  const stream = await app.stream(
    { messages: [{ role: 'user', content: userMsg }] },
    { configurable: { thread_id: `spike-${label}` }, streamMode: 'messages' },
  )
  let called = ''
  for await (const chunk of stream) {
    const msg = Array.isArray(chunk) ? chunk[0] : chunk
    const tc = (msg as { tool_calls?: Array<{ name: string }> }).tool_calls
    if (tc) for (const t of tc) { if (t.name === expectTool || t.name === 'transfer_to_writer') called = t.name }
  }
  const pass = called === expectTool
  console.log(`[${label}] expect=${expectTool} called=${called} → ${pass ? 'PASS' : 'FAIL'}`)
  return pass
}

async function main() {
  const a = await run('CONCEPT', CONCEPT_PROMPT, '我想写一本叫青云志的修仙小说，世界观是九州灵气复苏。', 'update_novel')
  const b = await run('READY', READY_PROMPT, '开始写第一章。', 'transfer_to_writer')
  console.log(a && b ? '--- SPIKE PASS ---' : '--- SPIKE FAIL ---')
  if (!(a && b)) process.exit(1)
}
main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: 跑 spike** — `cd server && pnpm exec ts-node scripts/spike-state-switch.ts`。重跑 2-3 次。PASS = CONCEPT 场景调 update_novel、READY 场景调 transfer_to_writer(各至少 2/3)。**FAIL → BLOCKED,回退 separate 创作 Agent。**

- [ ] **Step 3: Commit** — `git add server/scripts/spike-state-switch.ts && git commit -m "chore(server): main-agent state-switch spike (PASS)"`

---

# Task 2: Novel.status(CONCEPT/ACTIVE)schema

**Files:** Modify `server/prisma/schema.prisma`

- [ ] **Step 1: 加枚举 + 字段**
```prisma
enum NovelStatus {
  CONCEPT
  ACTIVE
}

model Novel {
  // ...existing fields...
  status     NovelStatus @default(ACTIVE)
  // ...
}
```
- [ ] **Step 2: 迁移** — `cd server && pnpm prisma migrate dev --name novel_status`。若 drift,`--create-only` 检查。
- [ ] **Step 3: typecheck** — `pnpm typecheck`(0 errors)。
- [ ] **Step 4: Commit** — `git add server/prisma && git commit -m "feat(server): Novel.status CONCEPT/ACTIVE enum"`

---

# Task 3: update_novel 工具(TDD)

**Files:** Create `server/src/agentos/tools/update-novel.tool.ts` + `.spec.ts`

- [ ] **Step 1: 写失败测试** — `update-novel.tool.spec.ts`:
```ts
import { makeUpdateNovelTool } from './update-novel.tool'
import type { NovelService } from '../../novel/novel.service'

describe('makeUpdateNovelTool', () => {
  it('calls NovelService.update with bound userId+novelId + mapped args', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'n1' })
    const novels = { update } as unknown as NovelService
    const t = makeUpdateNovelTool({ userId: 'u1', novelId: 'n1', novels })
    const res = await t.invoke({ title: '青云志', genre: '修仙', worldviewText: '九州', style: '凝练' })
    expect(update).toHaveBeenCalledWith('u1', 'n1', expect.objectContaining({
      title: '青云志', genre: '修仙', settings: { worldviewText: '九州', style: '凝练' },
    }))
    expect(res).toMatchObject({ ok: true })
  })
  it('binds userId/novelId from closure', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'n1' })
    const novels = { update } as unknown as NovelService
    const t = makeUpdateNovelTool({ userId: 'owner', novelId: 'nX', novels })
    await t.invoke({ title: 'T' })
    expect(update).toHaveBeenCalledWith('owner', 'nX', expect.anything())
  })
})
```
- [ ] **Step 2: 跑测试见失败** — `pnpm test -- update-novel.tool.spec.ts` → FAIL。
- [ ] **Step 3: 写实现** — `update-novel.tool.ts`:
```ts
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { NovelService } from '../../novel/novel.service'

export function makeUpdateNovelTool({ userId, novelId, novels }: {
  userId: string; novelId: string; novels: NovelService
}) {
  return tool(
    async ({ title, genre, worldviewText, style }) => {
      const settings: Record<string, string> = {}
      if (worldviewText) settings.worldviewText = worldviewText
      if (style) settings.style = style
      await novels.update(userId, novelId, {
        ...(title !== undefined && { title }),
        ...(genre !== undefined && { genre }),
        ...(Object.keys(settings).length > 0 && { settings }),
      })
      return { ok: true, message: '小说信息已更新。' }
    },
    {
      name: 'update_novel',
      description: '更新小说基础信息(书名/类型/世界观/文风)。立项收集到新信息时调用,更新左侧信息卡。',
      schema: z.object({
        title: z.string().optional().describe('书名'),
        genre: z.string().optional().describe('类型/题材'),
        worldviewText: z.string().optional().describe('世界观/设定'),
        style: z.string().optional().describe('文风'),
      }),
    },
  )
}
```
- [ ] **Step 4: 跑测试通过** — `pnpm test -- update-novel.tool.spec.ts` → PASS。
- [ ] **Step 5: 门禁 + Commit** — `pnpm typecheck && pnpm lint && git commit -m "feat(server): update_novel agent tool"`

---

# Task 4: write_chapter 自动建章(TDD)

**Files:** Modify `server/src/novel/chapter.service.ts` + `server/src/agentos/tools/write-chapter.tool.ts` + specs

- [ ] **Step 1: ChapterService 加 `findOrCreateByOrder`**
```ts
  /** 按序号找章节;不存在则创建(到该 order)。ownership-scoped。 */
  async findOrCreateByOrder(userId: string, novelId: string, order: number) {
    await this.assertOwned(userId, novelId)
    let chapter = await this.prisma.chapter.findFirst({ where: { novelId, order } })
    if (!chapter) {
      chapter = await this.prisma.chapter.create({
        data: { novelId, order, title: `第${order}章` },
      })
    }
    return chapter
  }
```
(加测试:`findOrCreateByOrder` — 已有 → 返回;没有 → 创建。)

- [ ] **Step 2: write-chapter.tool 改用 findOrCreateByOrder(替换 findByOrder + not-found 报错)**
```ts
// write-chapter.tool.ts — 把 findByOrder 换成 findOrCreateByOrder
const chapter = await chapters.findOrCreateByOrder(userId, novelId, chapterOrder)
await registry.dispatch(userId, { resource: 'chapter', targetId: chapter.id, op, content })
return { ok: true, message: `已${op === 'append' ? '追加到' : '重写'}第 ${chapterOrder} 章。` }
```
(更新 spec:不再测 not-found → 改测"order 不存在时自动创建 + 写入"。)

- [ ] **Step 3: write_chapter 落内容时 CONCEPT→ACTIVE** — 在 `ChapterHandler.apply` 或 `write_chapter` 工具里,写完后若 novel 还是 CONCEPT → 翻 ACTIVE。最简:在工具里写完后调 `novels.update(userId, novelId, { status: 'ACTIVE' })` —— 但 NovelService.update 不含 status。加一个 `NovelService.activate(userId, novelId)`(update status=ACTIVE,ownership-scoped),工具写完调它。OR 在 `ChapterHandler.apply` 里写完顺便翻 novel status。**选:在 write_chapter 工具 fn 里 dispatch 后,若 novelId 有效,调 novels.activate(userId, novelId)**。加 `NovelService.activate`。
- [ ] **Step 4: 跑测试 + 门禁 + Commit** — `pnpm test && pnpm typecheck && pnpm lint && git commit -m "feat(server): write_chapter auto-creates chapter by order + flips CONCEPT→ACTIVE"`

---

# Task 5: WritingChapter 信号(streamTurn + frame + controller)

**Files:** Modify `stream-adapter.ts`(AgentosFrame)、`workspace-swarm.service.ts`(streamTurn)、`agentos.controller.ts`(workspace 分支)

- [ ] **Step 1: 扩展 AgentosFrame** — `stream-adapter.ts`:
```ts
export type AgentosEvent = 'RunStarted' | 'RunContent' | 'RunCompleted' | 'RunError' | 'WritingChapter';
export interface AgentosFrame {
  event: AgentosEvent;
  content?: string;
  agent_id?: string;
  session_id?: string;
  order?: number;          // WritingChapter 用
  created_at: number;
}
```

- [ ] **Step 2: streamTurn 发信号** — `workspace-swarm.service.ts`:
```ts
// streamTurn 返回 AsyncGenerator<string | { type: 'writing-chapter'; order: number }>
async *streamTurn({ userId, novelId, threadId, userMessage, systemPrompt }) {
  const swarm = await this.getSwarm(userId, novelId, systemPrompt)
  const stream = await swarm.stream(
    { messages: [{ role: 'user', content: userMessage }] },
    { configurable: { thread_id: threadId }, streamMode: 'messages' },
  )
  for await (const chunk of stream) {
    // 检测 write_chapter 工具调用
    const msg = (Array.isArray(chunk) ? chunk[0] : chunk) as {
      tool_calls?: Array<{ name: string; args?: { chapterOrder?: number } }>
    }
    if (msg?.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (tc.name === 'write_chapter' && typeof tc.args?.chapterOrder === 'number') {
          yield { type: 'writing-chapter', order: tc.args.chapterOrder }
        }
      }
    }
    // 文本增量
    const delta = extractDelta(chunk)
    if (delta) yield delta
  }
}
```

- [ ] **Step 3: controller workspace 分支处理信号** — 不再用 `adapter.toFrames`(streamTurn 现在产 string|signal);workspace 分支自己组帧:
```ts
// workspace 分支:迭代 streamTurn,处理 string(累积 RunContent)+ writing-chapter(WritingChapter 帧)
let fullReply = ''
let completed = false
try {
  const session = await this.sessions.resolveSession(user.id, body?.session_id, AGENT_ID, message)
  sessionId = session.id
  const { prompt, novelId } = await this.contextAssembler.forSession(user.id, session.id)
  res.write(JSON.stringify({ event: 'RunStarted', agent_id: AGENT_ID, session_id: sessionId, created_at: now() }) + '\n')
  for await (const item of this.workspace.streamTurn({ userId: user.id, novelId: novelId ?? '', threadId: sessionId, userMessage: message, systemPrompt: prompt })) {
    if (typeof item === 'string') {
      fullReply += item
      res.write(JSON.stringify({ event: 'RunContent', content: fullReply, created_at: now() }) + '\n')
    } else if (item.type === 'writing-chapter') {
      res.write(JSON.stringify({ event: 'WritingChapter', order: item.order, created_at: now() }) + '\n')
    }
  }
  res.write(JSON.stringify({ event: 'RunCompleted', content: fullReply, created_at: now() }) + '\n')
  completed = true
} catch (err) { /* RunError */ }
// finally: appendTurn if completed
```
> 删除 creation 分支(Task 6 合并);`stream-adapter.ts` 的 `toFrames` 现在工作台不用了(creation 也删了)→ 可删 stream-adapter.ts 或留。本任务先留(creation 分支 Task 6 才删);Task 6 清理。

- [ ] **Step 4: typecheck + lint + build + Commit** — `git commit -m "feat(server): WritingChapter signal (streamTurn detects write_chapter → frame)"`

---

# Task 6: 统一 swarm(合并创作)+ 删 creation agent

**Files:** Modify `workspace-swarm.service.ts`、`context-assembler.service.ts`、`agentos.controller.ts`、`agentos.module.ts`;Delete `creation-agent.service.ts`

- [ ] **Step 1: ContextAssembler 状态感知 prompt** — `context-assembler.service.ts`:
  - `forSession` select 加 `status`;`buildSystemPrompt` 按 status 分:
    - `CONCEPT`:加立项指令("基础信息不全,收集书名/类型/世界观/文风,每轮调 update_novel;信息齐前不转交写作")。
    - `ACTIVE`:加路由指令("信息已齐,作者要写正文时 transfer_to_writer")。
  - 返回 `{ prompt, novelId, status }`(controller 用 status 决定早建翻不翻等,可选)。

- [ ] **Step 2: 主 Agent 加 update_novel 工具** — `workspace-swarm.service.ts` getSwarm:
  - 主 Agent tools 加 `makeUpdateNovelTool({userId, novelId, novels: this.novels})`(需注入 NovelService)+ 保留 `transfer_to_writer`。
  - 注入 NovelService(从 NovelModule,已 export)。

- [ ] **Step 3: 删 creation 分支 + CreationAgentService** — `agentos.controller.ts`:
  - runAgent 删 `mode` 分支 + creation 分支(全走 workspace,Task 5 的 workspace 分支)。
  - 构造函数移除 `creationAgent`。
  - `agentos.module.ts` 移除 CreationAgentService。
  - `git rm server/src/agentos/creation-agent.service.ts`。
  - 删 `stream-adapter.ts` 的 `toFrames`(若不再用)或留。
  - 更新 controller spec(移除 creation 测试 + creationAgent fake)。

- [ ] **Step 4: 全门禁 + boot** — `pnpm test && pnpm typecheck && pnpm lint && pnpm build` + boot health=200。
- [ ] **Step 5: Commit** — `git commit -m "feat(server): unified swarm (main agent onboards CONCEPT via update_novel + routes to writer); remove creation agent"`

---

# Task 7: FE 小说库早建 CONCEPT + 删 /novels/new

**Files:** Modify `NovelLibrary.tsx`;Delete `app/novels/new/page.tsx` + `CreationChat.tsx`

- [ ] **Step 1: NovelLibrary「新建小说」→ POST /novels(CONCEPT)→ /novels/[id]**
```tsx
// 「新建小说」onClick:
const onNewNovel = async () => {
  try {
    const novel = await createNovel(endpoint, token, { title: '未命名' }) // CONCEPT(后端 create 默认 CONCEPT)
    router.push(`/novels/${novel.id}`)
  } catch (err) { toast.error(...) }
}
```
> 后端 `NovelService.create` 改默认 `status: CONCEPT`(而非 ACTIVE)—— Task 2 加了字段(default ACTIVE for migration);create 新建时显式 `status: 'CONCEPT'`。

- [ ] **Step 2: 删 `/novels/new` + CreationChat** — `git rm app/novels/new/page.tsx components/workspace/CreationChat.tsx`。

- [ ] **Step 3: 门禁 + build + Commit** — `pnpm validate && pnpm build && git commit -m "feat(agent-ui): new-novel early-creates CONCEPT → /novels/[id]; remove /novels/new"`

---

# Task 8: FE 左侧 ResourceNav → 信息卡(去章节)

**Files:** Modify `ResourceNav.tsx`、`app/novels/[id]/page.tsx`

- [ ] **Step 1: ResourceNav 去章节/新章,加信息卡** — props 改:`novel: Novel`(而非 novelTitle + chapters + selectedChapterId + onNewChapter)。渲染信息卡(title/genre/settings.worldviewText/settings.style)+ 资源占位(大纲/角色/世界观/状态)+ 登出。**无章节列表、无新章**。
- [ ] **Step 2: workspace page 适配** — 移除 selectedChapterId/onNewChapter;`<ResourceNav novel={novel} />`;ChapterPreview 取代 ChapterDetail。
- [ ] **Step 3: 门禁 + build + Commit** — `git commit -m "feat(agent-ui): ResourceNav → novel info card (no chapter list)"`

---

# Task 9: FE 右侧 ChapterPreview(切换器+骨架+WritingChapter)

**Files:** Modify `ChapterDetail.tsx` → `ChapterPreview.tsx`、`useAIStreamHandler.tsx`、`app/novels/[id]/page.tsx`

- [ ] **Step 1: ChapterPreview 组件** — 在 ChapterDetail 基础上:
  - 加**章节切换器** `‹ 第N章 ›`(prev/next,本地 state selectedOrder;从 novel.chapters 找)。
  - **WritingChapter 信号**:props 加 `writingChapterOrder: number | null`;当非 null → 跳到该章 + 显示**骨架**(skeleton)。
  - 流结束(writingChapterOrder 清空)→ 显示正文(从 novel.chapters 读,refresh 后有内容)。
  - CONCEPT(无章节内容)→ 占位"立项中,信息收集完成后开始写作"。

- [ ] **Step 2: useAIStreamHandler 处理 WritingChapter 事件** — 加一个 `WritingChapter` 事件分支:解析 `{event:'WritingChapter', order:N}` → 通过 store 或 callback 通知 workspace(writingChapterOrder = N)。最简:store 加 `writingChapterOrder` state;handler 收到 WritingChapter → setWritingChapterOrder(N);流结束 → setWritingChapterOrder(null)。

- [ ] **Step 3: workspace page 接线** — `writingChapterOrder` 从 store 读,传给 ChapterPreview。ChapterPreview 收到 → 跳章+骨架。

- [ ] **Step 4: store 加 writingChapterOrder** — `store.ts` 加 `writingChapterOrder: number | null` + setter;`login/logout` reset。

- [ ] **Step 5: 门禁 + build + Commit** — `git commit -m "feat(agent-ui): ChapterPreview (switcher + skeleton + WritingChapter auto-jump)"`

---

# Task 10: 端到端冒烟 + 全门禁 + 收尾

- [ ] **Step 1: server 全门禁** — `pnpm test && pnpm lint && pnpm format && pnpm typecheck && pnpm build`
- [ ] **Step 2: agent-ui 全门禁** — `pnpm validate && pnpm build`
- [ ] **Step 3: 端到端冒烟(手动)** — 登录 →「新建小说」→ 进工作台(CONCEPT,信息卡空)→ 聊天立项(主 Agent 问问题+update_novel)→ 信息卡填满 → 主 Agent transfer_to_writer → 写作 Agent 写第1章(自动建章+write_chapter)→ 右侧跳到第1章+骨架→正文 → CONCEPT→ACTIVE → 小说库显示该书(ACTIVE)→ 切换章节浏览。
- [ ] **Step 4: 更新 CLAUDE.md**(统一 swarm + 信息卡 + 章节预览 + Novel.status + WritingChapter)
- [ ] **Step 5: Commit + 合并/打 tag(v0.4.0)** — 由用户确认后。

---

## Self-Review(plan ↔ spec 覆盖)

- §2 统一 swarm(主 Agent 立项/写作)→ Task 1(spike)+ Task 6(合并 + 主 Agent update_novel + state prompt)+ Task 5(streamTurn 信号)。
- §3.1 Novel.status → Task 2(schema)+ Task 4(CONCEPT→ACTIVE)+ Task 7(早建 CONCEPT)。
- §3.2 update_novel → Task 3。
- §3.3 write_chapter 自动建章 → Task 4。
- §3.4 WritingChapter 信号 → Task 5。
- §4 FE(统一页/信息卡/章节预览)→ Task 7(library)+ Task 8(nav)+ Task 9(preview)。
- §5 范围/非目标 → 无世界观/角色/状态资源、无大纲、无 CONCEPT 自动清理 —— 均不做 ✓。
- 类型一致:`makeUpdateNovelTool({userId,novelId,novels})`、`findOrCreateByOrder(userId,novelId,order)`、`WritingChapter{order}`、`NovelStatus='CONCEPT'|'ACTIVE'` 各任务一致。
- 无占位符:每个 step 含命令/代码;spike 是 gate(Task 1)。LLM 编排(swarm)靠 spike+E2E+typecheck(既有纪律)。
