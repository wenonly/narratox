# DeepAgents 迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 用 deepagents JS(`createDeepAgent`)替换自定义 pipeline 运行时,获得自动上下文压缩(SummarizationMiddleware)消除 400 + 子 agent 隔离(writer/settler/validator)。

**Architecture:** 主 agent(deepagents,带 PostgresSaver checkpointer + 自动压缩)+ 3 个子 agent(writer/settler/validator,task 委派,prompt 编排)。Controller 仍用 `createActivityEmitter` 翻译 deepagents 的 message-stream → Act* 帧(FE 不变)。删 pipeline/ 全目录 + agent-tools.ts。

**Tech Stack:** `deepagents@1.10.2` + `@langchain/langgraph@1.4.2` + NestJS 11 + Prisma 7。Gates:server `pnpm typecheck && pnpm lint && pnpm test && pnpm build`。

**Spec:** [docs/superpowers/specs/2026-06-19-deepagents-migration-design.md](../specs/2026-06-19-deepagents-migration-design.md)
**Branch:** `feat/writer-edit-tools`(当前分支,已有 9 个写作/编辑工具 + ChapterService 编辑方法)。

---

# Task 1: 挽救 activity 协议文件(移出 pipeline/)

删 pipeline/ 之前,先把 controller 仍需的 3 个文件移到 `agentos/`。

**Files:** Move `pipeline/activity.types.ts` → `agentos/activity.types.ts`;Move `pipeline/activity-aggregator.ts` → `agentos/activity-aggregator.ts`;Extract `createActivityEmitter` from `pipeline/stateless-agent.ts` → new `agentos/activity-emitter.ts`;Update `agentos.controller.ts` imports。

- [ ] **Step 1:** `git mv server/src/pipeline/activity.types.ts server/src/agentos/activity.types.ts`
- [ ] **Step 2:** `git mv server/src/pipeline/activity-aggregator.ts server/src/agentos/activity-aggregator.ts`;同样 move spec:`git mv server/src/pipeline/activity-aggregator.spec.ts server/src/agentos/activity-aggregator.spec.ts`(if exists)
- [ ] **Step 3:** Create `server/src/agentos/activity-emitter.ts` — 从 `pipeline/stateless-agent.ts` 里**只提取** `createActivityEmitter` 函数 + `ActivityEmitter` interface(不要 `StatelessAgent`/`runToolLoop`/`AgentRunContext`——那些随 pipeline/ 删除):
```ts
import type { ActivityEvent } from './activity.types';
import { nextActId } from './activity.types';

export interface ActivityEmitter {
  feed(chunk: unknown): void;
  finish(): void;
}

export function createActivityEmitter(
  emit: (ev: ActivityEvent) => void,
): ActivityEmitter {
  // ... 完整复制 pipeline/stateless-agent.ts 里的 createActivityEmitter 函数体 ...
  // (它是一个闭包,持有 thinkForMsg/contentForMsg/toolActForCall Maps,
  //  feed() 翻译 message-stream chunk → emit ActivityEvent)
}
```
(从 `pipeline/stateless-agent.ts` 复制 `createActivityEmitter` 的完整函数体 + `ActivityEmitter` interface。修改 import 路径为 `./activity.types`。不要复制 `StatelessAgent`/`AgentRunContext`/`runToolLoop`。)

- [ ] **Step 4:** Update `activity-aggregator.ts` 的 import 路径(`./activity.types` 不变——同目录了)。
- [ ] **Step 5:** Update `activity-aggregator.spec.ts` 的 import 路径(同上)。
- [ ] **Step 6:** Update `agentos.controller.ts` 的 imports:
  - `import type { ActivityEvent } from '../pipeline/activity.types'` → `import type { ActivityEvent } from './activity.types'`
  - `import { nextActId } from '../pipeline/activity.types'` → `import { nextActId } from './activity.types'`
  - `import { aggregateActivities } from '../pipeline/activity-aggregator'` → `import { aggregateActivities } from './activity-aggregator'`
  - `import { ConversationalAgentService } from '../pipeline/conversational.agent'` → **暂时不改**(Task 5 换成 DeepAgentService)。
- [ ] **Step 7:** `cd server && pnpm typecheck` → 预期:通过(pipeline/ 里的文件还引用旧路径,但它们马上要删;typecheck 可能报 pipeline 内部的交叉引用错——如果报,在 pipeline/ 文件里临时改 import 路径,或者在 Task 6 先删再改)。
- [ ] **Step 8:** Commit:
```sh
git add -A
git commit -m "refactor(agentos): salvage activity protocol files from pipeline/ to agentos/"
```

---

# Task 2: 新增 SETTLER + VALIDATOR + MAIN_AGENT prompt

**Files:** Modify `server/src/agentos/agent-prompts.ts`。

- [ ] **Step 1:** 在 `agent-prompts.ts` 末尾加三个新 prompt:
```ts
/** 主 agent(DeepAgents):小说生成流程的编排。状态感知 + 子 agent 委派。 */
export const MAIN_AGENT_PROMPT = `你是一位资深小说编辑+策划,在工作台里和作者一起写一本小说。

【立项阶段(CONCEPT)】
- 先用 get_novel_info 查看已收集的信息和缺失字段。
- 根据 missing 追问;每轮用 update_novel 更新收集到的信息。
- 信息齐全后,告诉作者可以开始写了。

【写作阶段(ACTIVE)】
- 作者要写/续写章节时,用 task 工具委派 writer 子 agent 写正文。
- writer 写完后,用 task 委派 settler 子 agent 结算(提取摘要/伏笔)。
- 结算后,用 task 委派 validator 子 agent 校验一致性。
- 用简短的话告知作者进展(如"第1章已写完并结算")。

【规则】
- 正文不要写在聊天里——通过子 agent 写入章节。
- 每一步都通过 task 委派,不要自己直接写正文。`;

/** settler 子 agent:结算章节(提取摘要/角色/物品/伏笔)。 */
export const SETTLER_AGENT_PROMPT = `你是小说一致性记账员。用 get_chapter 读本章正文,严谨提取事实(客观、不编造)。
提取 4 类:摘要(一句话情节)、角色变化、物品/地点/设定、伏笔(新埋/回收)。
然后用 write_summary 工具写入(它会存进数据库)。`;

/** validator 子 agent:校验章节一致性/质量。 */
export const VALIDATOR_AGENT_PROMPT = `你是小说质检员。用 get_chapter 读本章正文,用 query_memory 查已有设定/伏笔。
检查:人物一致(名字/性格/关系不矛盾)、伏笔连贯、文风统一、无明显逻辑漏洞。
给出简短评价(1-3 句)+ 是否通过(通过/需修订)。`;
```

- [ ] **Step 2:** `pnpm typecheck` → 通过。
- [ ] **Step 3:** Commit:
```sh
git add server/src/agentos/agent-prompts.ts
git commit -m "feat(agentos): MAIN_AGENT + SETTLER + VALIDATOR prompts for deepagents"
```

---

# Task 3: write_summary 工具工厂(settler 子 agent 用)

**Files:** Create `server/src/agentos/tools/write-summary.tool.ts`。

- [ ] **Step 1:** Create the factory(settler 用它把提取的事实写进 ChapterSummary + StoryEvent):
```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { SummaryService } from '../../memory/chapter-summary.service';
import type { StoryEventService } from '../../memory/story-event.service';
import type { ChapterService } from '../../novel/chapter.service';

/** settler 的"写入结算结果"工具。userId/novelId 闭包注入。 */
export function makeWriteSummaryTool({
  userId, novelId, chapters, summaries, events,
}: {
  userId: string; novelId: string;
  chapters: ChapterService; summaries: SummaryService; events: StoryEventService;
}) {
  return tool(
    async ({ chapterOrder, summary, roleChanges, entities, newHooks, resolvedHookIds }) => {
      const ch = await chapters.findByOrder(userId, novelId, chapterOrder);
      if (!ch) return { ok: false, reason: 'no_such_chapter' };
      await summaries.upsert({
        userId, novelId, chapterId: ch.id, summary,
        roleChanges, entities,
      });
      await events.createHooks(userId, novelId, newHooks, chapterOrder);
      await events.resolveHooks(userId, novelId, resolvedHookIds, chapterOrder);
      return { ok: true, chapterOrder };
    },
    {
      name: 'write_summary',
      description: '把本章结算结果(摘要/角色变化/物品/伏笔)写入数据库。settler 用它持久化提取结果。',
      schema: z.object({
        chapterOrder: z.number().int().describe('章节序号'),
        summary: z.string().describe('本章一句话情节摘要'),
        roleChanges: z.array(z.object({
          name: z.string(), change: z.string(),
        })).describe('角色状态变化'),
        entities: z.array(z.object({
          type: z.enum(['item', 'place', 'setting']),
          name: z.string(), note: z.string(),
        })).describe('物品/地点/设定'),
        newHooks: z.array(z.string()).describe('本章新埋下的伏笔描述'),
        resolvedHookIds: z.array(z.string()).describe('本章回收的伏笔 id(从 get_chapter 输出的 OPEN 伏笔中挑)'),
      }),
    },
  );
}
```

- [ ] **Step 2:** `pnpm typecheck` → 通过。
- [ ] **Step 3:** Commit:
```sh
git add server/src/agentos/tools/write-summary.tool.ts
git commit -m "feat(agentos): write_summary tool factory for settler subagent"
```

---

# Task 4: DeepAgentService(createDeepAgent 主 agent + 子 agent + runTurn)

**Files:** Create `server/src/agentos/deep-agent.service.ts`。

- [ ] **Step 1:** Create the service:
```ts
import { Injectable, Optional, Inject } from '@nestjs/common';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import { CHECKPOINTER } from './checkpointer.provider';
import { GLM_BASE_URL, GLM_MODEL } from './agentos.constants';
import { MAIN_AGENT_PROMPT, WRITER_AGENT_PROMPT, SETTLER_AGENT_PROMPT, VALIDATOR_AGENT_PROMPT } from './agent-prompts';
import { createActivityEmitter } from './activity-emitter';
import type { ActivityEvent } from './activity.types';
// 工具工厂
import { makeUpdateNovelTool } from './tools/update-novel.tool';
import { makeGetNovelInfoTool } from './tools/get-novel-info.tool';
import { makeAppendSectionTool } from './tools/append-section.tool';
import { makeReplaceTextTool } from './tools/replace-text.tool';
import { makeInsertTextTool } from './tools/insert-text.tool';
import { makeDeleteTextTool } from './tools/delete-text.tool';
import { makeClearChapterTool } from './tools/clear-chapter.tool';
import { makeSetChapterTitleTool } from './tools/set-chapter-title.tool';
import { makeGetChapterTool } from './tools/get-chapter.tool';
import { makeListChaptersTool } from './tools/list-chapters.tool';
import { makeQueryMemoryTool } from './tools/query-memory.tool';
import { makeWriteSummaryTool } from './tools/write-summary.tool';
// 服务
import { NovelService } from '../novel/novel.service';
import { ChapterService } from '../novel/chapter.service';
import { SummaryService } from '../memory/chapter-summary.service';
import { StoryEventService } from '../memory/story-event.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DeepAgentService {
  private readonly models = new Map<string, unknown>();

  constructor(
    @Optional() @Inject(CHECKPOINTER)
    private readonly checkpointer?: BaseCheckpointSaver,
    private readonly novels: NovelService,
    private readonly chapters: ChapterService,
    private readonly summaries: SummaryService,
    private readonly events: StoryEventService,
    private readonly prisma: PrismaService,
  ) {}

  private async getModel(userId: string) {
    const cached = this.models.get(userId);
    if (cached) return cached;
    const { ChatOpenAI } = await import('@langchain/openai');
    const apiKey = process.env.ZHIPUAI_API_KEY;
    if (!apiKey) throw new Error('ZHIPUAI_API_KEY is not set');
    const model = new ChatOpenAI({
      apiKey, model: GLM_MODEL, temperature: 0.5,
      configuration: { baseURL: GLM_BASE_URL },
      timeout: 120_000, maxRetries: 0, maxTokens: 16_000,
    });
    this.models.set(userId, model);
    return model;
  }

  async runTurn(args: {
    userId: string; novelId: string; threadId: string;
    userMessage: string; systemPrompt: string;
    emit: (ev: ActivityEvent) => void;
  }): Promise<void> {
    const { userId, novelId, threadId, userMessage, systemPrompt, emit } = args;
    const model = await this.getModel(userId);
    const { createDeepAgent } = await import('deepagents');

    const agent = await createDeepAgent({
      model,
      systemPrompt: systemPrompt || MAIN_AGENT_PROMPT,
      ...(this.checkpointer ? { checkpointer: this.checkpointer as never } : {}),
      tools: [
        makeGetNovelInfoTool({ userId, novelId, novels: this.novels }) as never,
        makeUpdateNovelTool({ userId, novelId, novels: this.novels }) as never,
      ],
      subagents: [
        {
          name: 'writer',
          description: '写/改/续写章节正文。作者要写章节时委派。',
          prompt: WRITER_AGENT_PROMPT,
          tools: [
            makeAppendSectionTool({ userId, novelId, chapters: this.chapters, novels: this.novels }) as never,
            makeReplaceTextTool({ userId, novelId, chapters: this.chapters }) as never,
            makeInsertTextTool({ userId, novelId, chapters: this.chapters }) as never,
            makeDeleteTextTool({ userId, novelId, chapters: this.chapters }) as never,
            makeClearChapterTool({ userId, novelId, chapters: this.chapters }) as never,
            makeSetChapterTitleTool({ userId, novelId, chapters: this.chapters }) as never,
            makeGetChapterTool({ userId, novelId, chapters: this.chapters }) as never,
            makeListChaptersTool({ userId, novelId, chapters: this.chapters }) as never,
            makeQueryMemoryTool({ userId, novelId, prisma: this.prisma }) as never,
          ],
        },
        {
          name: 'settler',
          description: '结算章节(提取摘要/角色/伏笔)。章节写完后委派。',
          prompt: SETTLER_AGENT_PROMPT,
          tools: [
            makeGetChapterTool({ userId, novelId, chapters: this.chapters }) as never,
            makeWriteSummaryTool({ userId, novelId, chapters: this.chapters, summaries: this.summaries, events: this.events }) as never,
          ],
        },
        {
          name: 'validator',
          description: '校验章节一致性/质量。结算后委派。',
          prompt: VALIDATOR_AGENT_PROMPT,
          tools: [
            makeGetChapterTool({ userId, novelId, chapters: this.chapters }) as never,
            makeQueryMemoryTool({ userId, novelId, prisma: this.prisma }) as never,
          ],
        },
      ],
    });

    const stream = await agent.stream(
      { messages: [{ role: 'user', content: userMessage }] },
      { configurable: { thread_id: threadId }, streamMode: 'messages' },
    );

    const em = createActivityEmitter(emit);
    for await (const chunk of stream) {
      em.feed(chunk);
    }
    em.finish();
  }
}
```

> **注意**:`createDeepAgent` 的 `subagents` 参数的 `prompt` 字段名(文档用 `systemPrompt`,JS API 可能用 `prompt` 或 `systemPrompt`)——如果 typecheck 报错,换成 `systemPrompt`。以 `deepagents` 的 `.d.ts` 为准:
> ```sh
> grep -n "systemPrompt\|prompt" node_modules/.pnpm/deepagents@1.10.2/node_modules/deepagents/dist/*.d.ts | head
> ```

- [ ] **Step 2:** `pnpm typecheck` → 通过(如 subagent prompt 字段名报错,按上面 grep 的结果改)。
- [ ] **Step 3:** Commit:
```sh
git add server/src/agentos/deep-agent.service.ts
git commit -m "feat(agentos): DeepAgentService — createDeepAgent main + writer/settler/validator subagents"
```

---

# Task 5: Controller + module 切换(DeepAgentService 替代 ConversationalAgentService)

**Files:** Modify `server/src/agentos/agentos.controller.ts`;Modify `server/src/agentos/agentos.module.ts`。

- [ ] **Step 1:** controller import 换:
  - `import { ConversationalAgentService } from '../pipeline/conversational.agent'` → `import { DeepAgentService } from './deep-agent.service'`
  - 构造函数 `private readonly conversational: ConversationalAgentService` → `private readonly deepAgent: DeepAgentService`

- [ ] **Step 2:** `runAgent` 里换调用:
  - `await this.conversational.runTurn({...})` → `await this.deepAgent.runTurn({...})`
  - **删掉自愈逻辑**(try-catch 里的 `attempt` 循环 + `clearThreadCheckpoints` + `Role empty` 检测)——deepagents 不需要自愈(SummarizationMiddleware 不产生孤儿)。
  - runAgent 的 try-catch 只保留基本的 error → RunError。

- [ ] **Step 3:** `agentos.module.ts` 换:
```ts
import { DeepAgentService } from './deep-agent.service';
import { checkpointerProvider } from './checkpointer.provider';
// 删掉 PipelineModule import

@Module({
  imports: [NovelModule, MemoryModule],
  controllers: [AgentosController],
  providers: [SessionsService, ContextAssembler, DeepAgentService, checkpointerProvider],
})
export class AgentosModule {}
```
(checkpointer provider 从 PipelineModule 迁回 AgentosModule——pipeline/ 要删了。)

- [ ] **Step 4:** `pnpm typecheck` → 预期:pipeline/ 的文件还在但不再被 import(ConversationalAgentService 仍存在但 unused)。typecheck 应该通过。

- [ ] **Step 5:** `pnpm test` → controller spec 会失败(它 mock ConversationalAgentService)——更新 mock 为 DeepAgentService。

- [ ] **Step 6:** 更新 `agentos.controller.spec.ts`:
  - mock 从 `ConversationalAgentService` → `DeepAgentService`。
  - `runTurn` mock 签名相同(emit callback)。
  - 断言 `deepAgent.runTurn` 被 call(with userId/novelId/threadId/systemPrompt/emit)。

- [ ] **Step 7:** `pnpm test` → 通过。
- [ ] **Step 8:** Commit:
```sh
git add server/src/agentos/agentos.controller.ts server/src/agentos/agentos.controller.spec.ts server/src/agentos/agentos.module.ts
git commit -m "feat(agentos): controller + module switched to DeepAgentService; remove self-heal"
```

---

# Task 6: 删除 pipeline/ + agent-tools.ts

**Files:** Delete `server/src/pipeline/` (entire directory);Delete `server/src/agentos/agent-tools.ts`;Delete `server/src/agentos/agent-tools.spec.ts`(if exists)。

- [ ] **Step 1:** `git rm -r server/src/pipeline/`
- [ ] **Step 2:** `git rm server/src/agentos/agent-tools.ts`(如果 agent-tools.spec.ts 也存在:`git rm server/src/agentos/agent-tools.spec.ts`)
- [ ] **Step 3:** `pnpm typecheck` → 预期:可能有 dangling refs(如果有其它文件 import 了 pipeline/ 或 agent-tools)。grep 确认:
```sh
grep -rn "from.*pipeline/\|from.*agent-tools" src/
```
如有:修正 import(应该是 0——Task 1 已把 activity 文件移到 agentos/,Task 5 已把 controller 换成 DeepAgentService)。
- [ ] **Step 4:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` → 全绿。
- [ ] **Step 5:** Commit:
```sh
git commit -m "chore(agentos): delete pipeline/ directory + agent-tools.ts (replaced by deepagents)"
```

---

# Task 7: 冒烟 + 验证

**Files:** none(验证)。

- [ ] **Step 1:** 双端 gate:
```sh
cd server && pnpm typecheck && pnpm lint && pnpm test && pnpm build
cd ../agent-ui && pnpm validate && pnpm build
```
- [ ] **Step 2:** Boot server + curl 冒烟:
```sh
cd server && PORT=3001 node dist/src/main.js &
# register → create novel → send "写第1章" → observe Act* stream
# 确认:think + task(writer) + tool(append_section) + task(settler) + content 流出
```
- [ ] **Step 3:** 浏览器(人工):新建小说 → 立项 → 写一章 → 确认交错时间线 + 自动压缩(多轮后不 400)+ settler 结算可见。

---

## Self-Review

**Spec coverage:**
- §2 架构(主 agent + 3 子 agent + prompt 编排)→ Task 4(DeepAgentService)。
- §3 存储(PostgresSaver + StateBackend + Prisma)→ Task 4(checkpointer 注入)+ Task 5(module provider)。
- §4 保留(novel/memory/tools/sessions/checkpointer/FE)→ 不在任何删除 task 里(pipeline/ 删,tools/novel/memory 不删)。
- §4 删除(pipeline/ + agent-tools.ts)→ Task 6。
- §4 新建(deep-agent.service.ts)→ Task 4。
- §5 子 agent 工具(writer 9 个 / settler get_chapter+write_summary / validator get_chapter+query_memory)→ Task 3(write_summary)+ Task 4(subagent specs)。
- §6 controller 适配 → Task 5。
- §7 FE 不变 → 不需要 FE task(createActivityEmitter 仍在 controller 翻译)。
- §9 迁移阶段 → Tasks 1-7。
- §10 后续(checkpoint 清理/deepagents 高级功能)→ 非 target。
- §10 activity-emitter.ts 从 stateless-agent 提取 → Task 1 Step 3。✓

**Placeholder scan:** Task 1 Step 3 的 createActivityEmitter 说"从 stateless-agent.ts 复制完整函数体"——这不是占位符,是指令(函数体在已有文件里,implementer 复制)。Task 4 subagent 的 prompt 字段名给了 grep 指令(resolve ambiguity)。无 TBD。

**Type consistency:**
- `ActivityEvent` / `nextActId` / `aggregateActivities`(Task 1 move)↔ controller import 路径(Task 1 Step 6)一致。
- `createActivityEmitter(emit)`(Task 1)↔ DeepAgentService.runTurn 用(Task 4)一致。
- `DeepAgentService` 构造函数(Task 4)↔ module providers(Task 5)一致。
- `runTurn({userId, novelId, threadId, userMessage, systemPrompt, emit})`(Task 4)↔ controller call(Task 5)一致。
- `makeWriteSummaryTool` 签名(Task 3)↔ settler subagent tools(Task 4)一致。

**Scope:** 单一迁移计划,7 个任务,顺序执行(挽救 → 新建 → 切换 → 删除 → 验证)。
