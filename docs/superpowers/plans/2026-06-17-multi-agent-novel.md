# narratox 多 Agent 小说工作台(骨架)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 narratox 从「单 agent chat + 手动采纳」升级为「多 agent swarm + AI 问答建书 + agent 工具自动写」的骨架 —— 创作 Agent(Q&A 建书,替代表单)+ 工作台 swarm(主 Agent + 写作 Agent,handoff)+ 写作 Agent 用工具自动写章节(去掉「采纳」按钮)。

**Architecture:** `@langchain/langgraph-swarm` 的 `createSwarm` + `createHandoffTool`(transfer_to_*);每个 agent 用 `createReactAgent`(独立 prompt/tools/preModelHook 摘要);agent 写入工具是 Phase 1 mutation 层(`ChapterHandler`/`NovelService`)的薄封装,`userId` 闭包注入;共享 thread(`novel.sessionId`)记忆,checkpointer 不变。创作 Agent 是独立的单 agent(书在 Q&A 时还不存在)。

**Tech Stack:** NestJS 11 + `@langchain/langgraph`(prebuilt `createReactAgent`)+ `@langchain/langgraph-swarm`(新)+ `@langchain/openai`(GLM)+ `@langchain/core`(`tool`/`trimMessages`)+ Prisma 7。前端 Next.js 15(无测试器,门禁 `pnpm validate`)。

**Spec:** [docs/superpowers/specs/2026-06-17-multi-agent-novel-design.md](../specs/2026-06-17-multi-agent-novel-design.md)
**Branch:** `feat/multi-agent-novel`

---

## 约定

- **后端 TDD**(jest,`NODE_OPTIONS=--experimental-vm-modules`):纯函数/工具/控制器走 TDD。**LLM 编排代码**(createReactAgent/createSwarm 构建)无法单测,靠 **Task 1 spike + Task 9 E2E + typecheck** 验证 —— 这是本仓库既有纪律(`deep-agent.service.spec` 只测 `extractDelta` 这类纯函数,LLM 接线靠冒烟)。
- **前端无测试器**:门禁 `pnpm validate`(lint+format+typecheck)+ build。
- **Prisma 7 config-driven**:prisma CLI 命令不带 `--schema`。
- **ESM 动态 import**:`createReactAgent`/`createSwarm`/`createHandoffTool`/`@langchain/openai` 都在方法内 `await import()`,不在模块顶层(保 Jest 收集干净,沿用 `deep-agent.service.ts` 模式)。
- **鉴权/隔离**:工具的 `userId` **闭包注入**(构建时绑定),绝不从 LLM 入参取。所有写操作走 Phase 1 的 userId 隔离。
- 每任务一次 commit,conventional commits + `Co-Authored-By: Claude <noreply@anthropic.com>`。
- server 的 typecheck 是 `pnpm typecheck`(`tsc --noEmit`);**实现者必须自己跑并报告精确输出**(此前有误报先例)。

## File Structure

**后端(server/src/)新增/改**
- `agentos/tools/create-novel.tool.ts`(+ `.spec.ts`)— `makeCreateNovelTool({userId, novels})` 工厂,封装 `NovelService.create`
- `agentos/tools/write-chapter.tool.ts`(+ `.spec.ts`)— `makeWriteChapterTool({userId, registry})`,封装 `ResourceRegistry.dispatch`(写章节)
- `agentos/agent-prompts.ts` — 创作/写作/主 agent 的 system prompt 常量
- `agentos/agent-tools.ts` — `makeTrimHook(model)`(preModelHook,trimMessages 摘要)+ 工厂聚合
- `agentos/creation-agent.service.ts` — `buildCreationAgent({userId})`(单 agent + create_novel 工具)
- `agentos/workspace-swarm.service.ts` — `buildSwarm({userId, systemPrompt})`(主+写作,handoff,写章节工具);取代 `deep-agent.service.ts` 的 `buildAgent`
- 改 `agentos/agentos.controller.ts` — `runAgent` 按 `mode` 分流(creation / workspace)
- 改 `agentos/agentos.module.ts` — 注入新服务
- 删/弃用 `agentos/deep-agent.service.ts`(被 workspace-swarm 取代;保留 `extractDelta` 工具函数迁移到共享处)
- 改 `package.json` — 加 `@langchain/langgraph-swarm`,提 `@langchain/langgraph` 为直接依赖,加 `zod`(若非直接)
- `scripts/spike-handoff.ts` — Task 1 的 GLM handoff 验证脚本(验证后可删)

**前端(agent-ui/src/)新增/改**
- `app/novels/new/page.tsx`(新)— 创作聊天页
- `components/workspace/CreationChat.tsx`(新)— 复用聊天基建,指向创作 agent
- 改 `components/chat/ChatArea/Messages/Messages.tsx` — 去掉 onAccept
- 改 `components/chat/ChatArea/MessageArea.tsx` — 去掉 onAccept 转发
- 改 `components/workspace/ChatPanel.tsx` — 去掉采纳
- 改 `components/library/NovelLibrary.tsx` — 「新建小说」跳 `/novels/new`,移除 `NewNovelForm`
- 删 `components/library/NewNovelForm.tsx`

---

# Task 1: GLM handoff 可靠性 spike(架构闸门)

**这是架构闸门。** 验证 GLM-5.2 在 swarm 里能否可靠发出 `transfer_to_<name>`。**通过 → 继续 swarm 路线(Task 2+)。失败 → 停下,按 spec §10.2 回退"自定义路由",重新规划(本计划剩余任务作废,改写)。**

**Files:**
- Modify: `server/package.json`(加依赖)
- Create: `server/scripts/spike-handoff.ts`(验证后可删)

- [ ] **Step 1: 加依赖**

`server/package.json` dependencies 加:
```json
    "@langchain/langgraph": "^1.4.2",
    "@langchain/langgraph-swarm": "^1.0.2",
```
(`@langchain/langgraph` 当前是 deepagents 的传递依赖,提为直接依赖,防止以后删 deepagents 时消失。)`zod` 若已是直接依赖则跳过;否则加 `"zod": "^4.4.3"`。
Run: `cd server && pnpm install`
Expected: 安装成功,`node_modules/@langchain/langgraph-swarm` 出现。

- [ ] **Step 2: 写 spike 脚本** — `server/scripts/spike-handoff.ts`:
```ts
// 一次性验证脚本:GLM 在 swarm 里是否可靠发出 transfer_to_writer。
// 运行: cd server && pnpm exec ts-node scripts/spike-handoff.ts
import 'dotenv/config' // 加载 .env (ZHIPUAI_API_KEY)
import { ChatOpenAI } from '@langchain/openai'
import { createReactAgent } from '@langchain/langgraph/prebuilt'
import { createSwarm, createHandoffTool } from '@langchain/langgraph-swarm'

const MODEL = process.env.ZHIPUAI_API_KEY
  ? new ChatOpenAI({
      apiKey: process.env.ZHIPUAI_API_KEY,
      model: 'GLM-5.2',
      configuration: { baseURL: 'https://api.z.ai/api/coding/paas/v4' },
    })
  : (() => { throw new Error('ZHIPUAI_API_KEY missing in .env') })()

async function main() {
  const main = createReactAgent({
    llm: MODEL,
    name: 'main',
    prompt:
      '你是小说工作台的主 Agent。用户要写正文/写章节时,用 transfer_to_writer 转交给写作 Agent。其它问题自己回答。',
    tools: [
      createHandoffTool({
        agentName: 'writer',
        description: '转交给写作 Agent 来写/续写章节正文',
      }),
    ],
  })
  const writer = createReactAgent({
    llm: MODEL,
    name: 'writer',
    prompt: '你是写作 Agent。收到控制权后,直接写一小段小说正文给用户。',
    tools: [createHandoffTool({ agentName: 'main' })],
  })
  const app = createSwarm({ agents: [main, writer], defaultActiveAgent: 'main' }).compile()

  const stream = await app.stream(
    { messages: [{ role: 'user', content: '帮我写第一章的开头' }] },
    { configurable: { thread_id: 'spike-1' }, streamMode: 'messages' },
  )
  let sawTransfer = false
  for await (const chunk of stream) {
    const msg = Array.isArray(chunk) ? chunk[0] : chunk
    const tcalls = (msg as { tool_calls?: Array<{ name: string }> }).tool_calls
    if (tcalls?.some((t) => t.name === 'transfer_to_writer')) sawTransfer = true
    const txt = (msg as { text?: string; content?: unknown }).text
    if (typeof txt === 'string' && txt) process.stdout.write(txt)
  }
  console.log('\n--- SPIKE RESULT ---')
  console.log(sawTransfer ? 'PASS: GLM emitted transfer_to_writer' : 'FAIL: no transfer_to_writer observed')
  if (!sawTransfer) process.exit(1)
}
main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 3: 跑 spike**

Run: `cd server && pnpm exec ts-node scripts/spike-handoff.ts`
Expected: 打印一段正文 + `PASS: GLM emitted transfer_to_writer`。
**若 FAIL(GLM 没发 transfer):** 重试 1-2 次(模型偶发);仍 FAIL → **停下,报告 BLOCKED**:按 spec §10.2 回退自定义路由,本计划 Task 2+ 作废重写。
**若 PASS:** 继续。连跑 3 次都 PASS 更稳。

- [ ] **Step 4: 确认 typecheck/lint 不被 spike 脚本破坏**

spike 脚本在 `scripts/` 不在 `src/`,但 `tsc --noEmit` 默认含 `src`。确认 `server/tsconfig.json` 的 `include` 不含 `scripts`(通常只含 `src`);若含,把 `scripts/spike-handoff.ts` 加进 `.eslintignore`/tsconfig 排除,或验证后删除脚本。
Run: `cd server && pnpm typecheck && pnpm lint`
Expected: 不受 spike 脚本影响(若受影响,删除 `scripts/spike-handoff.ts`,spike 已完成其使命)。

- [ ] **Step 5: Commit**
```sh
git add server/package.json server/pnpm-lock.yaml server/scripts/spike-handoff.ts
git commit -m "chore(server): add langgraph-swarm dep + GLM handoff spike (PASS)

Co-Authored-By: Claude <noreply@anthropic.com>"
```
(spike 脚本可保留作回归参考,或删。若删,`git add` 只加 package.json/lock。)

---

# Task 2: create_novel 工具(TDD)

**Files:**
- Create: `server/src/agentos/tools/create-novel.tool.ts`
- Test: `server/src/agentos/tools/create-novel.tool.spec.ts`

- [ ] **Step 1: 写失败测试** — `server/src/agentos/tools/create-novel.tool.spec.ts`:
```ts
import { makeCreateNovelTool } from './create-novel.tool'
import type { NovelService } from '../../novel/novel.service'

describe('makeCreateNovelTool', () => {
  it('calls NovelService.create with the bound userId + mapped args, returns novelId', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'n1' })
    const novels = { create } as unknown as NovelService
    const t = makeCreateNovelTool({ userId: 'u1', novels })

    const res = await t.invoke({
      title: '江湖夜雨',
      genre: '武侠',
      synopsis: '一把刀的传奇',
      worldviewText: '大漠武侠',
    })

    expect(create).toHaveBeenCalledWith('u1', {
      title: '江湖夜雨',
      genre: '武侠',
      synopsis: '一把刀的传奇',
      settings: { worldviewText: '大漠武侠' },
    })
    expect(res).toMatchObject({ novelId: 'n1' })
  })

  it('works without optional fields', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'n2' })
    const novels = { create } as unknown as NovelService
    const t = makeCreateNovelTool({ userId: 'u1', novels })
    const res = await t.invoke({ title: '只有书名' })
    expect(create).toHaveBeenCalledWith('u1', { title: '只有书名' })
    expect(res).toMatchObject({ novelId: 'n2' })
  })

  it('binds the userId from closure, never from input', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'n3' })
    const novels = { create } as unknown as NovelService
    const t = makeCreateNovelTool({ userId: 'owner', novels })
    await t.invoke({ title: 'X' })
    expect(create).toHaveBeenCalledWith('owner', expect.objectContaining({ title: 'X' }))
  })
})
```

- [ ] **Step 2: 跑测试见失败** — `cd server && pnpm test -- create-novel.tool.spec.ts` → FAIL(模块不存在)。

- [ ] **Step 3: 写实现** — `server/src/agentos/tools/create-novel.tool.ts`:
```ts
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { NovelService } from '../../novel/novel.service'

/**
 * 创作 Agent 的建书工具。userId 闭包注入(不从 LLM 入参取,防伪造/越权)。
 * worldviewText 映射到 Novel.settings.worldviewText(Phase 1 ContextAssembler 会读它)。
 */
export function makeCreateNovelTool({
  userId,
  novels,
}: {
  userId: string
  novels: NovelService
}) {
  return tool(
    async ({ title, genre, synopsis, worldviewText }) => {
      const novel = await novels.create(userId, {
        title,
        genre: genre ?? undefined,
        synopsis: synopsis ?? undefined,
        settings: worldviewText ? { worldviewText } : undefined,
      })
      return { novelId: novel.id, message: `已创建小说《${title}》。` }
    },
    {
      name: 'create_novel',
      description:
        '创建一本新小说。当通过对话已收集到足够信息(至少有书名;最好还有类型/故事核/世界观)时调用。',
      schema: z.object({
        title: z.string().describe('书名(必需)'),
        genre: z.string().optional().describe('类型/题材,如 玄幻/悬疑/武侠'),
        synopsis: z.string().optional().describe('一句话故事 / 核心冲突'),
        worldviewText: z.string().optional().describe('世界观 / 设定'),
      }),
    },
  )
}
```

- [ ] **Step 4: 跑测试通过** — `cd server && pnpm test -- create-novel.tool.spec.ts` → PASS(3 例)。

- [ ] **Step 5: 门禁 + Commit**
```sh
cd server && pnpm typecheck && pnpm lint
git add server/src/agentos/tools/create-novel.tool.ts server/src/agentos/tools/create-novel.tool.spec.ts
git commit -m "feat(server): create_novel agent tool (wraps NovelService.create)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 3: write_chapter 工具(TDD)

**Files:**
- Create: `server/src/agentos/tools/write-chapter.tool.ts`
- Test: `server/src/agentos/tools/write-chapter.tool.spec.ts`

- [ ] **Step 1: 写失败测试** — `server/src/agentos/tools/write-chapter.tool.spec.ts`:
```ts
import { makeWriteChapterTool } from './write-chapter.tool'
import type { ResourceRegistry } from '../../resources/resource-registry'

describe('makeWriteChapterTool', () => {
  it('append: dispatches a chapter append mutation with the bound userId', async () => {
    const dispatch = jest.fn().mockResolvedValue(undefined)
    const registry = { dispatch } as unknown as ResourceRegistry
    const t = makeWriteChapterTool({ userId: 'u1', registry })

    const res = await t.invoke({ chapterId: 'c1', op: 'append', content: '夜雨敲窗。' })

    expect(dispatch).toHaveBeenCalledWith('u1', {
      resource: 'chapter',
      targetId: 'c1',
      op: 'append',
      content: '夜雨敲窗。',
    })
    expect(res).toMatchObject({ ok: true })
  })

  it('set: dispatches a chapter set mutation', async () => {
    const dispatch = jest.fn().mockResolvedValue(undefined)
    const registry = { dispatch } as unknown as ResourceRegistry
    const t = makeWriteChapterTool({ userId: 'u1', registry })
    await t.invoke({ chapterId: 'c1', op: 'set', content: '全新内容。' })
    expect(dispatch).toHaveBeenCalledWith('u1', expect.objectContaining({ op: 'set', content: '全新内容。' }))
  })

  it('binds userId from closure, not input', async () => {
    const dispatch = jest.fn().mockResolvedValue(undefined)
    const registry = { dispatch } as unknown as ResourceRegistry
    const t = makeWriteChapterTool({ userId: 'owner', registry })
    await t.invoke({ chapterId: 'c1', op: 'append', content: 'x' })
    expect(dispatch).toHaveBeenCalledWith('owner', expect.anything())
  })
})
```

- [ ] **Step 2: 跑测试见失败** — `cd server && pnpm test -- write-chapter.tool.spec.ts` → FAIL。

- [ ] **Step 3: 写实现** — `server/src/agentos/tools/write-chapter.tool.ts`:
```ts
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { ResourceRegistry } from '../../resources/resource-registry'

/**
 * 写作 Agent 的写章节工具。走 Phase 1 mutation 层(ChapterHandler 按 userId 隔离)。
 * append=追加到本章末尾(接着写);set=重写本章。
 */
export function makeWriteChapterTool({
  userId,
  registry,
}: {
  userId: string
  registry: ResourceRegistry
}) {
  return tool(
    async ({ chapterId, op, content }) => {
      await registry.dispatch(userId, {
        resource: 'chapter',
        targetId: chapterId,
        op,
        content,
      })
      return {
        ok: true,
        message: `已${op === 'append' ? '追加到' : '重写'}章节 ${chapterId}。`,
      }
    },
    {
      name: 'write_chapter',
      description:
        '把小说正文写入指定章节。op="append" 追加到本章末尾(接着写);op="set" 重写整章。生成正文后应主动调用,不要只把正文贴在聊天里。',
      schema: z.object({
        chapterId: z.string().describe('目标章节 id'),
        op: z.enum(['append', 'set']).describe('append=追加,set=重写'),
        content: z.string().describe('要写入的正文'),
      }),
    },
  )
}
```

- [ ] **Step 4: 跑测试通过** — `cd server && pnpm test -- write-chapter.tool.spec.ts` → PASS(3 例)。

- [ ] **Step 5: 门禁 + Commit**
```sh
cd server && pnpm typecheck && pnpm lint
git add server/src/agentos/tools/write-chapter.tool.ts server/src/agentos/tools/write-chapter.tool.spec.ts
git commit -m "feat(server): write_chapter agent tool (wraps mutation layer)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 4: Agent prompts + trim hook(纯常量/工具)

**Files:**
- Create: `server/src/agentos/agent-prompts.ts`
- Create: `server/src/agentos/agent-tools.ts`

- [ ] **Step 1: 写 prompt 常量** — `server/src/agentos/agent-prompts.ts`:
```ts
/** 创作 Agent:建书前的问答立项。借鉴 inkos 风格,不强制多步闸门。 */
export const CREATION_AGENT_PROMPT = `你是一位资深小说策划,正在帮作者立项一本新小说。

工作方式:
- 一次只问一个问题,逐步了解:书名(必需)、类型/题材、一句话故事与核心冲突、世界观/设定、文风。
- 作者回答含糊时,给出 2-3 个具体选项供选择。
- 信息足够(至少有书名,最好还有类型和故事核)时,主动建议:"信息够了,我来帮你创建这本书",并调用 create_novel 工具建书。
- 不要一次问一长串问题;不要在信息不足时强行建书。

调用 create_novel 时:把收集到的信息填进对应字段(worldviewText 放世界观/设定)。建书后告诉作者书已创建,可以开始写了。`

/** 写作 Agent:工作台里写/续写章节。生成正文后用 write_chapter 工具落稿。 */
export const WRITER_AGENT_PROMPT = `你是一位小说写作手,在工作台里和作者一起写一本小说的章节。

工作方式:
- 按作者的指示写/续写当前章节的正文。
- 写出正文后,用 write_chapter 工具(op="append" 接着写 / op="set" 重写本章)把正文写入章节 —— 不要只贴在聊天里等作者手动采纳。
- 一次写一段落或一小节;写完调用工具,再询问作者是否继续或调整。
- 遵循小说已有的设定与已有内容,保持人物、世界观一致。`

/**
 * 主 Agent 的 swarm 调度指令,拼在 per-novel 的 ContextAssembler prompt 之后。
 * (主 Agent 的完整 prompt = ContextAssembler 输出 + 这段。)
 */
export const MAIN_AGENT_ROUTE_SUFFIX = `

你是这本小说工作台的主 Agent(前台调度)。判断作者意图:
- 要写/续写正文、写章节 → 用 transfer_to_writer 转交给写作 Agent。
- 转交后由写作 Agent 直接和作者对话写正文。
- 其它(闲聊、关于小说的问答)你自己回答。
判断不准时优先自己回应,需要写正文才转交。`
```

- [ ] **Step 2: 写 trim hook** — `server/src/agentos/agent-tools.ts`:
```ts
import { trimMessages } from '@langchain/core/messages'

/**
 * preModelHook:调用 LLM 前压缩历史(deepagents 自带 SummarizationMiddleware,raw
 * createReactAgent 没有,这里用 trimMessages 兜底,防止长篇上下文爆炸)。
 * strategy="last" 保留最近的对话,includeSystem 保留系统消息。
 */
export function makeTrimHook(model: unknown) {
  // model 用于 token 计数;类型用 unknown 避免与 @langchain/openai 的具体类型耦合。
  return async (state: { messages: unknown[] }) => {
    const trimmed = await trimMessages(state.messages as Parameters<typeof trimMessages>[0], {
      maxTokens: 6000,
      tokenCounter: model as Parameters<typeof trimMessages>[1]['tokenCounter'],
      strategy: 'last',
      includeSystem: true,
      startOn: 'human',
    })
    return { messages: trimmed }
  }
}

/**
 * 从 messages streamMode 的 [message, metadata] 元组里抽出文本增量。
 * (从 deep-agent.service.ts 迁来,creations/workspace 两处流式共用。)
 * tool_calls / 多段 content 等非字符串 content 一律返回 ''(静默丢弃工具噪声)。
 */
export function extractDelta(chunk: unknown): string {
  const msg = (Array.isArray(chunk) ? chunk[0] : chunk) as
    | { text?: string; content?: unknown }
    | undefined
  if (typeof msg?.text === 'string') return msg.text
  if (typeof msg?.content === 'string') return msg.content
  return ''
}
```
> Note: `trimMessages` 与 `preModelHook` 的精确返回契约由 Task 1 spike 已间接验证(createReactAgent 跑通)。若 typecheck 对 `preModelHook` 返回类型有意见,按编译器提示调整返回 shape(通常是 `{ messages: [...] }`)。
> `extractDelta` 抽到这里作为共享纯函数 —— Task 6(workspace)和 Task 7(creation 分支)都 import 它,消除重复。

- [ ] **Step 3: typecheck + lint**
Run: `cd server && pnpm typecheck && pnpm lint`
Expected: 通过(纯常量 + 一个工具函数;若 trimMessages 类型有摩擦,加最小 `as` 收敛,不用 `any`)。

- [ ] **Step 4: Commit**
```sh
git add server/src/agentos/agent-prompts.ts server/src/agentos/agent-tools.ts
git commit -m "feat(server): agent system prompts + trimMessages preModelHook

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 5: 创作 Agent 服务

**Files:**
- Create: `server/src/agentos/creation-agent.service.ts`
- Modify: `server/src/agentos/agentos.module.ts`(注入)

> LLM 编排代码,无单测(Task 1 spike 已证 createReactAgent+GLM 跑通)。验证 = typecheck + build + Task 9 E2E。

- [ ] **Step 1: 写实现** — `server/src/agentos/creation-agent.service.ts`:
```ts
import { Injectable } from '@nestjs/common'
import { GLM_BASE_URL, GLM_MODEL } from './agentos.constants'
import { CREATION_AGENT_PROMPT } from './agent-prompts'
import { makeTrimHook } from './agent-tools'
import { makeCreateNovelTool } from './tools/create-novel.tool'
import { NovelService } from '../novel/novel.service'

/** 创作 Agent 构建产物:有 .stream({messages},{configurable,streamMode}) 的可流式 agent。 */
export interface StreamableAgent {
  stream(
    input: { messages: Array<{ role: string; content: string }> },
    options: { configurable: Record<string, unknown>; streamMode: 'messages' },
  ): Promise<AsyncIterable<unknown>>
}

/**
 * 建书前的创作 Agent(单 agent,非 swarm)。问答收集信息 → create_novel 建书。
 * 每次创作会话构建一个(闭包绑定 userId)。controller 直接用 build() + agent.stream()。
 * ESM 动态 import 保 Jest 干净。
 */
@Injectable()
export class CreationAgentService {
  constructor(private readonly novels: NovelService) {}

  async build(userId: string): Promise<StreamableAgent> {
    const apiKey = process.env.ZHIPUAI_API_KEY
    if (!apiKey) throw new Error('ZHIPUAI_API_KEY is not set. Add it to server/.env.')
    const { ChatOpenAI } = await import('@langchain/openai')
    const { createReactAgent } = await import('@langchain/langgraph/prebuilt')
    const model = new ChatOpenAI({
      apiKey,
      model: GLM_MODEL,
      configuration: { baseURL: GLM_BASE_URL },
    })
    const agent = createReactAgent({
      llm: model,
      name: 'creation',
      prompt: CREATION_AGENT_PROMPT,
      tools: [makeCreateNovelTool({ userId, novels: this.novels })],
      preModelHook: makeTrimHook(model),
    })
    return agent as unknown as StreamableAgent
  }
}
```
> 服务只暴露 `build(userId)`;controller(Task 7)直接 `const agent = await creationAgent.build(user.id)` 再 `agent.stream(...)`。创作会话短,每轮重建可接受(后续如需缓存,在 controller 按 threadId 缓存)。`StreamableAgent` 接口 export,Task 6 的 WorkspaceSwarmService 复用同一接口。

- [ ] **Step 2: 注入到 AgentosModule** — `server/src/agentos/agentos.module.ts` providers 加 `CreationAgentService`(import)。

- [ ] **Step 3: typecheck + lint + build**
Run: `cd server && pnpm typecheck && pnpm lint && pnpm build`
Expected: 通过。

- [ ] **Step 4: Commit**
```sh
git add server/src/agentos/creation-agent.service.ts server/src/agentos/agentos.module.ts
git commit -m "feat(server): CreationAgentService (Q&A onboarding agent + create_novel tool)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 6: 工作台 swarm 服务(主 + 写作,handoff)

**Files:**
- Create: `server/src/agentos/workspace-swarm.service.ts`
- Modify: `server/src/agentos/agentos.module.ts`
- Modify: `server/src/agentos/agentos.controller.spec.ts`(流式部分先不动,Task 7 一起改)

> LLM 编排代码,无单测。验证 = typecheck + build + Task 9 E2E。`extractDelta` 从 `deep-agent.service.ts` 迁来。

- [ ] **Step 1: 写实现** — `server/src/agentos/workspace-swarm.service.ts`:
```ts
import { Injectable, Optional, Inject } from '@nestjs/common'
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint'
import { CHECKPOINTER } from './checkpointer.provider'
import { GLM_BASE_URL, GLM_MODEL } from './agentos.constants'
import { MAIN_AGENT_ROUTE_SUFFIX, WRITER_AGENT_PROMPT } from './agent-prompts'
import { makeTrimHook, extractDelta } from './agent-tools'
import type { StreamableAgent } from './creation-agent.service'
import { makeWriteChapterTool } from './tools/write-chapter.tool'
import { ResourceRegistry } from '../resources/resource-registry'

/**
 * 工作台 swarm:每本小说一个,按 systemPrompt 缓存。主 Agent(路由)+ 写作 Agent(handoff)。
 * 主 Agent 的 prompt = per-novel ContextAssembler 输出 + MAIN_AGENT_ROUTE_SUFFIX。
 * 写作 Agent 用 write_chapter 工具直接写章节(取代手动「采纳」)。
 */
@Injectable()
export class WorkspaceSwarmService {
  private readonly swarms = new Map<string, StreamableAgent>()

  constructor(
    @Optional() @Inject(CHECKPOINTER) private readonly checkpointer?: BaseCheckpointSaver,
    private readonly registry?: ResourceRegistry,
  ) {}

  /** 按 systemPrompt 复用/构建 swarm(userId 闭包注入工具)。 */
  async getSwarm(userId: string, systemPrompt: string): Promise<StreamableAgent> {
    const cacheKey = `${userId}:${systemPrompt}`
    let cached = this.swarms.get(cacheKey)
    if (cached) return cached

    const apiKey = process.env.ZHIPUAI_API_KEY
    if (!apiKey) throw new Error('ZHIPUAI_API_KEY is not set. Add it to server/.env.')
    if (!this.registry) throw new Error('ResourceRegistry not wired')

    const { ChatOpenAI } = await import('@langchain/openai')
    const { createReactAgent } = await import('@langchain/langgraph/prebuilt')
    const { createSwarm, createHandoffTool } = await import('@langchain/langgraph-swarm')

    const model = new ChatOpenAI({
      apiKey,
      model: GLM_MODEL,
      configuration: { baseURL: GLM_BASE_URL },
    })

    const main = createReactAgent({
      llm: model,
      name: 'main',
      prompt: systemPrompt + MAIN_AGENT_ROUTE_SUFFIX,
      tools: [
        createHandoffTool({
          agentName: 'writer',
          description: '转交给写作 Agent 来写/续写章节正文',
        }),
      ],
      preModelHook: makeTrimHook(model),
    })

    const writer = createReactAgent({
      llm: model,
      name: 'writer',
      prompt: WRITER_AGENT_PROMPT,
      tools: [
        makeWriteChapterTool({ userId, registry: this.registry }),
        createHandoffTool({ agentName: 'main' }),
      ],
      preModelHook: makeTrimHook(model),
    })

    const workflow = createSwarm({
      agents: [main, writer],
      defaultActiveAgent: 'main',
    })
    const checkpointer = (this.checkpointer ?? false) as never
    cached = workflow.compile({ checkpointer }) as unknown as StreamableAgent
    this.swarms.set(cacheKey, cached)
    return cached
  }

  /** 在 thread(=novel.sessionId)上推进一轮,逐块产出文本增量(仅非空)。 */
  async *streamTurn({
    userId,
    threadId,
    userMessage,
    systemPrompt,
  }: {
    userId: string
    threadId: string
    userMessage: string
    systemPrompt: string
  }): AsyncGenerator<string> {
    const swarm = await this.getSwarm(userId, systemPrompt)
    const stream = await swarm.stream(
      { messages: [{ role: 'user', content: userMessage }] },
      { configurable: { thread_id: threadId }, streamMode: 'messages' },
    )
    for await (const chunk of stream) {
      const delta = extractDelta(chunk)
      if (delta) yield delta
    }
  }
}
```

- [ ] **Step 2: 注入到 AgentosModule** — providers 加 `WorkspaceSwarmService`。`ResourceRegistry` 在 NovelModule 提供;要让 AgentosModule 用到,需把 `ResourceRegistry` 共享 —— 最简:`NovelModule` 里给 `ResourceRegistry` 加 `@Global()` 或在 NovelModule `exports` 里导出它,然后 AgentosModule import NovelModule。**实现者:** 在 `novel.module.ts` 的 `exports: [ResourceRegistry]` 加上,并在 `agentos.module.ts` `imports: [NovelModule]`(若未导入)。确认 `@Optional()` 在 `WorkspaceSwarmService` 的 `registry` 上,避免单测实例化时强依赖。

- [ ] **Step 3: typecheck + lint + build**
Run: `cd server && pnpm typecheck && pnpm lint && pnpm build`
Expected: 通过。

- [ ] **Step 4: Commit**
```sh
git add server/src/agentos/workspace-swarm.service.ts server/src/agentos/agentos.module.ts server/src/novel/novel.module.ts
git commit -m "feat(server): WorkspaceSwarmService (main + writer, langgraph-swarm handoff)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 7: AgentosController 按 mode 分流(creation / workspace)

**Files:**
- Modify: `server/src/agentos/agentos.controller.ts`
- Modify: `server/src/agentos/agentos.controller.spec.ts`

`runAgent` 的 body 加一个 `mode?: 'creation' | 'workspace'`(缺省按 `session_id` 是否存在判断)。creation 分支用 `CreationAgentService.build` + 直接 stream;workspace 分支用 `WorkspaceSwarmService.streamTurn`。

- [ ] **Step 1: 改 controller** — `server/src/agentos/agentos.controller.ts`:
- 构造函数加 `private readonly creationAgent: CreationAgentService` 和 `private readonly workspace: WorkspaceSwarmService`(import)。
- `runAgent` 的 body 类型加 `mode?: 'creation' | 'workspace'`。
- 在拿到 `message` 后分流:
```ts
    const message = body?.message ?? ''
    res.setHeader('Content-Type', 'application/json')

    const mode: 'creation' | 'workspace' =
      body?.mode ?? (body?.session_id ? 'workspace' : 'creation')

    // 创作:每轮构建创作 agent(闭包带 userId),直接 stream。
    if (mode === 'creation') {
      const threadId = body?.session_id ?? randomCreationThreadId()
      try {
        const agent = await this.creationAgent.build(user.id)
        const stream = await agent.stream(
          { messages: [{ role: 'user', content: message }] },
          { configurable: { thread_id: threadId }, streamMode: 'messages' },
        )
        res.write(JSON.stringify({ event: 'RunStarted', session_id: threadId, created_at: now() }) + '\n')
        for await (const chunk of stream) {
          const delta = extractDelta(chunk)
          if (delta) res.write(JSON.stringify({ event: 'RunContent', content: delta, created_at: now() }) + '\n')
        }
        res.write(JSON.stringify({ event: 'RunCompleted', created_at: now() }) + '\n')
      } catch (err) {
        res.write(JSON.stringify({ event: 'RunError', content: err instanceof Error ? err.message : String(err), created_at: now() }) + '\n')
      } finally {
        res.end()
      }
      return
    }

    // workspace:沿用原流程,但 streamTurn 来自 WorkspaceSwarmService(per-novel prompt)。
    let fullReply = ''
    let completed = false
    let sessionId = body?.session_id ?? ''
    try {
      const session = await this.sessions.resolveSession(user.id, body?.session_id, AGENT_ID, message)
      sessionId = session.id
      const systemPrompt = await this.contextAssembler.forSession(user.id, session.id)
      for await (const frame of this.adapter.toFrames(
        AGENT_ID,
        sessionId,
        this.workspace.streamTurn({ userId: user.id, threadId: sessionId, userMessage: message, systemPrompt }),
      )) {
        if (frame.event === 'RunContent' || frame.event === 'RunCompleted') fullReply = frame.content ?? fullReply
        if (frame.event === 'RunCompleted') completed = true
        res.write(JSON.stringify(frame) + '\n')
      }
    } catch (err) {
      res.write(JSON.stringify({ event: 'RunError', content: err instanceof Error ? err.message : String(err), created_at: now() }) + '\n')
    } finally {
      res.end()
      if (completed && message) {
        try { await this.sessions.appendTurn(user.id, sessionId, message, fullReply) }
        catch (err) { console.error(`[agentos] appendTurn failed for ${sessionId}:`, err instanceof Error ? err.message : err) }
      }
    }
```
- 加一个 threadId 生成 helper(顶部):
```ts
const randomCreationThreadId = (): string =>
  `creation-${Math.random().toString(36).slice(2)}-${now()}`
```
- **import 共享的 `extractDelta`**:`import { extractDelta } from './agent-tools'`(Task 4 已 export)。creation 分支里用 `extractDelta(chunk)` 抽文本增量(workspace 分支走 `WorkspaceSwarmService.streamTurn`,内部也用同一个 extractDelta —— DRY,无重复)。

- [ ] **Step 2: 更新 controller spec** — `server/src/agentos/agentos.controller.spec.ts`:
- `buildController` 的 fake 构造现在需要 `creationAgent` + `workspace`。给 fakes:
```ts
const fakeCreation = { build: jest.fn().mockResolvedValue({ stream: jest.fn() }) }
const fakeWorkspace = { streamTurn: jest.fn(() => asyncFromChunks(['ok'])) }
```
- `new AgentosController(fakeService, new StreamAdapter(), sessions, fakeAssembler, fakeCreation, fakeWorkspace as unknown)`(参数顺序对齐新构造函数)。
- 新增一个用例:creation 分支(body 无 session_id / mode='creation')→ 调 `creationAgent.build(user.id)` 且不调 workspace。
- 现有 workspace 用例(body 有 session_id)→ 调 `workspace.streamTurn` 且带 `systemPrompt`(沿用原断言 + forSession 被调)。

- [ ] **Step 3: 跑测试 + 门禁**
Run: `cd server && pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: 全绿。

- [ ] **Step 4: 删除/弃用 `deep-agent.service.ts`**
`WorkspaceSwarmService` 取代了它。删除 `deep-agent.service.ts` + `deep-agent.service.spec.ts`;移除 `agentos.module` 里对 `DeepAgentService` 的引用。确认无其它处 import(全仓 grep)。
> `extractDelta` 已迁到 `agent-tools.ts`(Task 6/7)。确认迁移后再删。

- [ ] **Step 5: Commit**
```sh
git add server/src/agentos
git commit -m "feat(server): agentos runAgent routes creation vs workspace (swarm + creation agent)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 8: 前端 · 创作聊天页 `/novels/new`(替代表单)

**Files:**
- Create: `agent-ui/src/components/workspace/CreationChat.tsx`
- Create: `agent-ui/src/app/novels/new/page.tsx`
- Modify: `agent-ui/src/components/library/NovelLibrary.tsx`(「新建小说」跳 `/novels/new`)

> 前端无测试器;门禁 `pnpm validate` + build。

- [ ] **Step 1: CreationChat 组件** — `agent-ui/src/components/workspace/CreationChat.tsx`:
```tsx
'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryState } from 'nuqs'
import { useStore } from '@/store'
import useChatActions from '@/hooks/useChatActions'
import MessageArea from '@/components/chat/ChatArea/MessageArea'
import ChatInput from '@/components/chat/ChatArea/ChatInput'
import { listNovels } from '@/api/novels'

/**
 * 创作聊天:指向创作 Agent(无 novel,mode=creation)。流结束后查最新小说并跳转工作台。
 * (create_novel 工具落库后,最新一本 = 刚创建的;listNovels 按 updatedAt desc。)
 */
const CreationChat = () => {
  const router = useRouter()
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const setIsStreaming = useStore((s) => s.setIsStreaming)
  const { initialize } = useChatActions()
  const [, setAgentId] = useQueryState('agent')
  const [, setSessionId] = useQueryState('session')
  const [, setDbId] = useQueryState('db_id')
  const [, setMode] = useQueryState('mode')

  useEffect(() => {
    setAgentId('deep-agent')
    setDbId('default')
    setMode('creation')
    setSessionId(`creation-${Math.random().toString(36).slice(2)}`)
    initialize()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 流结束(isStreaming true→false)后,若创作 Agent 建了书,跳到最新一本。
  useEffect(() => {
    let prev = useStore.getState().isStreaming
    const unsub = useStore.subscribe((s) => {
      if (prev && !s.isStreaming) {
        void (async () => {
          try {
            const novels = await listNovels(endpoint, token)
            if (novels.length) router.replace(`/novels/${novels[0].id}`)
          } catch { /* 忽略 */ }
        })()
      }
      prev = s.isStreaming
    })
    return unsub
  }, [endpoint, token, router])

  return (
    <div className="flex flex-1 flex-col">
      <div className="px-5 py-2 text-xs text-muted">💬 创作 Agent · 问答立项</div>
      <MessageArea />
      <div className="sticky bottom-0 px-4 pb-2">
        <ChatInput />
      </div>
    </div>
  )
}

export default CreationChat
```
> `mode=creation` 通过 nuqs 进 URL,`useAIStreamHandler` 会把它 append 进 FormData(需在 `useAIStreamHandler.ts` 加一行 `formData.append('mode', mode ?? 'workspace')` —— **实现者:** 在 `useAIStreamHandler` 里读 `const [mode] = useQueryState('mode')` 并在 append stream 后 `formData.append('mode', mode ?? 'workspace')`)。
> `ChatInput` 当前按 `selectedAgent||teamId` 禁用;creation 设了 agent=deep-agent,可用。

- [ ] **Step 2: 页面** — `agent-ui/src/app/novels/new/page.tsx`:
```tsx
'use client'
import { Suspense } from 'react'
import RequireAuth from '@/components/auth/RequireAuth'
import CreationChat from '@/components/workspace/CreationChat'
import { useRouter } from 'next/navigation'
import { useStore } from '@/store'
import { Button } from '@/components/ui/button'

export default function NewNovelPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <RequireAuth>
        <CreationShell />
      </RequireAuth>
    </Suspense>
  )
}

const CreationShell = () => {
  const router = useRouter()
  const logout = useStore((s) => s.logout)
  return (
    <div className="flex h-screen bg-background/80">
      <aside className="flex w-60 shrink-0 flex-col gap-3 border-r border-primary/10 px-4 py-5 font-dmmono">
        <button onClick={() => router.push('/')} className="text-left text-xs font-medium text-brand" type="button">‹ 小说库</button>
        <span className="text-xs font-medium uppercase text-white">新建小说</span>
        <div className="mt-auto">
          <Button variant="ghost" size="sm" onClick={() => { logout(); router.replace('/login') }} className="text-muted">登出</Button>
        </div>
      </aside>
      <CreationChat />
    </div>
  )
}
```

- [ ] **Step 3: 小说库「新建小说」跳创作页** — `agent-ui/src/components/library/NovelLibrary.tsx`:
- 「新建小说」按钮的 onClick 从 `setShowForm` 改为 `router.push('/novels/new')`。
- 移除 `showForm` 状态 + `<NewNovelForm>` 渲染 + `NewNovelForm` import。
- 删除 `agent-ui/src/components/library/NewNovelForm.tsx`。

- [ ] **Step 4: 给 useAIStreamHandler 传 mode** — `agent-ui/src/hooks/useAIStreamHandler.tsx`:
- 加 `const [mode] = useQueryState('mode')`,在 `formData.append('stream','true')` 附近加 `formData.append('mode', mode ?? 'workspace')`。

- [ ] **Step 5: 门禁 + build**
Run: `cd agent-ui && pnpm typecheck && pnpm validate && pnpm build`
Expected: 通过(`/novels/new` 路由出现)。

- [ ] **Step 6: Commit**
```sh
git add agent-ui/src/components/workspace/CreationChat.tsx agent-ui/src/app/novels/new/page.tsx agent-ui/src/components/library agent-ui/src/hooks/useAIStreamHandler.tsx
git commit -m "feat(agent-ui): creation chat page at /novels/new (replaces form)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 9: 前端 · 去掉「采纳」按钮

**Files:**
- Modify: `agent-ui/src/components/chat/ChatArea/Messages/Messages.tsx`
- Modify: `agent-ui/src/components/chat/ChatArea/MessageArea.tsx`
- Modify: `agent-ui/src/components/workspace/ChatPanel.tsx`

写作 Agent 现在用 `write_chapter` 工具自动写章节,稿件随流刷新,不再需要手动采纳。

- [ ] **Step 1: Messages 去掉 onAccept** — `agent-ui/src/components/chat/ChatArea/Messages/Messages.tsx`:
- `MessageListProps` 去掉 `onAccept?` / `canAccept?`。
- `MessageWrapperProps` 去掉 `onAccept?` / `canAccept?`。
- `AgentMessageWrapper` 删掉「采纳到本章 ↗」那个 `{onAccept && canAccept && ...}` button 块。
- `Messages` 签名改回 `({ messages }: MessageListProps)`,`AgentMessageWrapper` 不再传 onAccept/canAccept。

- [ ] **Step 2: MessageArea 去掉转发** — `agent-ui/src/components/chat/ChatArea/MessageArea.tsx`:
- 去掉 `onAccept`/`canAccept` props 与对 `<Messages>` 的转发;`MessageArea` 回到无 props(或仅从 store 读 messages)。

- [ ] **Step 3: ChatPanel 去掉采纳** — `agent-ui/src/components/workspace/ChatPanel.tsx`:
- 删掉 `onAccept` / `acceptIntoChapter` 相关逻辑(import、useCallback、按钮、`canAccept`)。
- `<MessageArea>` 不再传 onAccept/canAccept。
- 工作台稿件刷新:写作 Agent 用工具落稿后,流结束 → `refresh()` 拉 novel → ChapterDetail 自动更新。`ChatPanel` 已有 `onAccepted=refresh` 的调用时机吗?**实现者:** 在流结束(isStreaming false)时触发上层 refresh —— 仿 CreationChat 的订阅模式,或在 `useAIStreamHandler` 的 `onComplete` 里调 refresh。最简:ChatPanel 订阅 isStreaming false→true 跳变 → 调 `onAccepted()`(props 已有)。

- [ ] **Step 4: 门禁 + build**
Run: `cd agent-ui && pnpm typecheck && pnpm validate && pnpm build`
Expected: 通过。

- [ ] **Step 5: Commit**
```sh
git add agent-ui/src/components/chat agent-ui/src/components/workspace/ChatPanel.tsx
git commit -m "feat(agent-ui): remove manual accept button (writer agent auto-writes via tool)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 10: 端到端冒烟 + 全门禁 + 收尾

- [ ] **Step 1: server 全门禁**
Run: `cd server && pnpm test && pnpm lint && pnpm format && pnpm typecheck && pnpm build`
Expected: 全绿。

- [ ] **Step 2: agent-ui 全门禁**
Run: `cd agent-ui && pnpm validate && pnpm build`
Expected: 全绿;路由含 `/`、`/login`、`/register`、`/novels/new`、`/novels/[id]`、`/settings`。

- [ ] **Step 3: 端到端冒烟(手动,真实 GLM)**

启 `pnpm --dir server start:dev`(:3001)+ `pnpm --dir agent-ui dev`(:3000)。浏览器:
1. 登录 → 小说库 →「新建小说」→ 进 `/novels/new` 创作 chat。
2. 对创作 Agent 说:"写一本武侠小说,叫《江湖夜雨》,主角是个退隐刀客,世界观是大漠江湖"。
3. 创作 Agent 应追问/确认后调 `create_novel` → 流结束自动跳到 `/novels/[id]` 工作台(验证:新书在库里、工作台打开了它)。
4. 工作台对主 Agent 说:"写第一章的开头"。
5. 验证:**主 Agent 转交写作 Agent**(GLM handoff —— 这是 Task 1 spike 的真实场景);写作 Agent 写正文并**自动调用 `write_chapter`**;**右侧稿件自动出现内容**(无需点「采纳」,且没有「采纳」按钮);章节 status → COMMITTED。
6. 说"接着写一段"→ 稿件继续追加。
7. 切换/新建章节正常;换号看不到他人小说(隔离)。

> 关键观察点:第 5 步的 handoff + 自动写。若 handoff 偶发失败(GLM 没转交),重试;若稳定失败,说明 Task 1 spike 的结论不成立,需回退自定义路由(但 spike 已过,概率低)。

- [ ] **Step 4: 更新 CLAUDE.md(反映多 agent 架构)**
在 server 架构小节补:创作 Agent(`CreationAgentService`,Q&A 建书)+ 工作台 swarm(`WorkspaceSwarmService`,主+写作 handoff via `langgraph-swarm`)+ agent 工具自动写(走 mutation 层,无手动采纳)+ `agent_memory` checkpointer 不变。LangGraph 提为直接依赖。

- [ ] **Step 5: Commit + (可选)合并/打 tag**
```sh
git add CLAUDE.md
git commit -m "docs: CLAUDE.md — note multi-agent swarm architecture

Co-Authored-By: Claude <noreply@anthropic.com>"
```
> 合并到 main / 打 tag(如 `v0.3.0-multi-agent-skeleton`)由用户确认后再做;**不擅自 push**。

---

## Self-Review(plan ↔ spec 覆盖核对)

**Spec 覆盖:**
- §2.1 创作 Agent(单 agent + create_novel)→ Task 2(create_novel 工具)+ Task 5(CreationAgentService)+ Task 7(controller creation 分支)+ Task 8(创作 chat 页)。
- §2.2 工作台 swarm(主+写作,handoff,共享 thread)→ Task 6(WorkspaceSwarmService)+ Task 7(controller workspace 分支)+ Task 1(spike 验 handoff)。
- §3 agent 阵容(创作/主/写作跑通;大纲/角色/世界观定义待启用)→ 主+写作+创作 实装;大纲/角色/世界观 = 非目标(后续 spec),ResourceNav 里已是 P2/P3 占位(Phase 1 已有)。
- §4 工具层(走 mutation 层,删采纳)→ Task 2/3(工具)+ Task 9(删采纳按钮)。`userId` 闭包注入 → Task 2/3 实现+测试覆盖。
- §5 UX(创作 chat 替代表单;工作台自动写)→ Task 8(创作页)+ Task 9(自动写,稿件随流刷新)。
- §6 数据模型(不加新表)→ 全程复用 Novel/Chapter,无新表任务 ✓。
- §7 服务端(DeepAgentService→swarm+创作;preModelHook;提 langgraph 依赖;加 swarm)→ Task 1(依赖)+ Task 4(trim hook)+ Task 5/6(服务)+ Task 7(controller)+ Task 7 Step4(删 deep-agent.service)。
- §8 前端(删采纳、创作页)→ Task 8/9。
- §10 风险:GLM handoff 可靠性 → Task 1 spike + 失败回退说明;摘要丢失 → Task 4 trim hook;身份安全 → Task 2/3 闭包注入。

**类型一致性:** `makeCreateNovelTool({userId, novels})` / `makeWriteChapterTool({userId, registry})` 在 Task 2/3 定义、Task 5/6 调用一致。`streamTurn({userId, threadId, userMessage, systemPrompt})`(workspace)签名在 Task 6 定义、Task 7 调用一致。`mode: 'creation'|'workspace'` 在 Task 7(controller)+ Task 8(FE nuqs)+ useAIStreamHandler 一致。

**已知简化(已在对应任务注明):**
- 创作 agent 每轮重建(Task 5 note;创作会话短,可接受;后续可缓存)。
- FE 检测建书完成用"流结束→listNovels 取最新"(Task 8),非解析工具结果(简化;后续可加 NovelCreated 帧)。
- `extractDelta` 抽到 `agent-tools.ts` 共享(Task 7 note,DRY)。
- LLM 编排代码(Task 5/6)无单测,靠 spike+E2E+typecheck(本仓库既有纪律)。

**无占位符:** 所有 step 含可执行命令与完整代码;Task 5 的 `streamTurn` 占位是**显式说明"删掉它,用 build+stream"**,非真占位(已注明实现者简化路径)。
