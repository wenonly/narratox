# DeepAgents 迁移 — 设计文档

- 日期:2026-06-19
- 状态:已确认方向(主 agent + 子 agent + prompt 编排 + PostgreSQL 存储),spike 通过,待 review
- 范围:用 **deepagents JS**(`createDeepAgent`)替换自定义 pipeline 运行时(`server/src/pipeline/` 全目录)。获得自动上下文压缩(SummarizationMiddleware)——从根本上消除 `400 Role empty`(trim 孤儿 tool 消息)+ 子 agent 隔离(writer/settler/validator)+ offloading。
- 依赖:`deepagents@1.10.2`(已在 deps)+ `@langchain/langgraph@1.4.2` + PostgresSaver + 现有 Prisma 数据模型。

---

## 1. 为什么要迁移

自定义 pipeline 运行时的 `trimMessages`(makeTrimHook)偶尔裁出孤儿 tool 消息 → GLM `400 Role empty`。自愈(clearThreadCheckpoints/deleteThread)是事后补救,不是根治。deepagents 的 **SummarizationMiddleware** 自动在 85% 窗口时把旧消息压成摘要(保留 tool_call/result 配对,不孤儿)→ **从根本上不产生 400**。

## 2. 目标架构

```
Main Agent (deepagents createDeepAgent)
├── model: ChatOpenAI(z.ai GLM-5.2 + maxTokens 16k)
├── checkpointer: PostgresSaver(agent_memory schema — 会话记忆,自动压缩)
├── systemPrompt: 状态感知编排(CONCEPT→收集 / ACTIVE→委派写→结算→校验)
├── tools: update_novel, get_novel_info(立项)
└── subagents(主 agent 通过 task 工具委派,prompt 描述何时用):
    ├── writer: 写/改章节正文(9 个写作/编辑工具)
    ├── settler: 结算(结构化提取摘要/角色/伏笔 → 写 Prisma)
    └── validator: 校验一致性/质量(读 get_chapter + query_memory)
```

**编排 = prompt 驱动,不是代码硬编码。** 无 PipelineRunner,无 hardcoded stages。

## 3. 存储:全 PostgreSQL

| 存储 | 机制 | 说明 |
|---|---|---|
| 会话记忆 | **PostgresSaver** checkpointer(`agent_memory` schema) | 跨轮消息线程 + SummarizationMiddleware 自动压缩 |
| 虚拟文件系统 | **StateBackend**(默认)→ 存在 graph state → checkpoint → PostgreSQL | offloading(大 tool 结果截断)+ summarization 归档。**无磁盘文件、无 Store。** |
| 小说结构化数据 | **Prisma** `public` schema(Novel/Chapter/ChapterSummary/StoryEvent) | settler 写入这里,与 novelId/chapterId 绑定,可查询 |
| 聊天历史 | Prisma `public.Message` | 前端展示用(controller 落库) |

**Session 隔离**:每本小说 = 1 Session = 1 `thread_id` → PostgresSaver 按 thread_id 隔离。

## 4. 保留 / 删除 / 新建

### 保留(不动)
- `server/src/novel/` — ChapterService(含全部编辑方法:appendSection/replaceText/insertText/deleteText/setChapterTitle/clearChapter/getChapter/list)+ NovelService + ChapterHandler。
- `server/src/memory/` — SummaryService + StoryEventService。
- `server/src/agentos/tools/` — 9 个工具工厂(append-section/replace-text/insert-text/delete-text/set-chapter-title/clear-chapter/get-chapter/list-chapters/query-memory)。
- `server/src/agentos/sessions.service.ts` — 会话/历史管理。
- `server/src/agentos/checkpointer.provider.ts` — PostgresSaver provider。
- `server/src/agentos/context-assembler.service.ts` — 状态感知 prompt(主 agent 用)。
- `server/src/agentos/agentos.constants.ts` — GLM 配置。
- `server/src/agentos/analyst-schema.ts` — settler 结构化输出 schema。
- Prisma schema 全部(含 Message.activities)。
- Auth / controller 骨架。
- **前端全部**(交错时间线/StreamingIndicator/activities 持久化/useAIStreamHandler/useSessionLoader)。

### 删除
- `server/src/pipeline/` **整个目录**(8 个文件:conversational.agent/writer.agent/settler.agent/pipeline-runner/composer/stateless-agent/activity-aggregator/activity.types + pipeline.module + spec)。
- `server/src/agentos/agent-tools.ts` — makeTrimHook(deepagents 自带 SummarizationMiddleware)。
- `server/src/agentos/agentos.module.ts` 里对 PipelineModule 的 import(改为新 module)。

### 新建
- `server/src/agentos/deep-agent.service.ts` — `createDeepAgent` 主 agent + 3 个子 agent spec + checkpointer + 工具注入 + runtime context(userId/novelId)。
- `server/src/agentos/agentos.module.ts` 更新 — 提供 DeepAgentService(替代 PipelineModule)。

## 5. DeepAgentService 设计

```ts
@Injectable()
export class DeepAgentService {
  constructor(
    @Optional() @Inject(CHECKPOINTER) private checkpointer?,
    private novels: NovelService,
    private chapters: ChapterService,
    private summaries: SummaryService,
    private events: StoryEventService,
    private prisma: PrismaService,
    private contextAssembler: ContextAssembler,
    private agentLog: AgentLoggerService,
  ) {}

  async runTurn(args: {
    userId: string; novelId: string; threadId: string;
    userMessage: string; systemPrompt: string;
    emit: (ev: ActivityEvent) => void;
  }): Promise<void> {
    const model = await this.getModel(args.userId);
    const agent = await createDeepAgent({
      model,
      systemPrompt: args.systemPrompt,
      checkpointer: this.checkpointer,
      tools: [
        makeUpdateNovelTool({ userId: args.userId, novelId: args.novelId, novels: this.novels }),
        makeGetNovelInfoTool({ userId: args.userId, novelId: args.novelId, novels: this.novels }),
      ],
      subagents: [
        { name: 'writer', description: '写/改章节正文', systemPrompt: WRITER_AGENT_PROMPT, tools: this.writerTools(args.userId, args.novelId) },
        { name: 'settler', description: '结算章节(提取摘要/伏笔)', systemPrompt: SETTLER_PROMPT, tools: [] },
        { name: 'validator', description: '校验章节一致性', systemPrompt: VALIDATOR_PROMPT, tools: this.validatorTools(args.userId, args.novelId) },
      ],
    });

    const stream = await agent.stream(
      { messages: [{ role: 'user', content: args.userMessage }] },
      { configurable: { thread_id: args.threadId }, streamMode: 'messages', context: { userId: args.userId, novelId: args.novelId } },
    );

    const em = createActivityEmitter(args.emit);
    for await (const chunk of stream) { em.feed(chunk); }
    em.finish();
  }
}
```

> 注意:`createDeepAgent` 是 `async`(初始化中间件栈)。每次 runTurn 构建(per-request userId/novelId 闭包)。model 缓存(per userId)。

### 子 agent 工具
- **writer**:`[append_section, replace_text, insert_text, delete_text, clear_chapter, set_chapter_title, get_chapter, list_chapters, query_memory]`(全部闭包注入 userId/novelId)。
- **settler**:无工具(主 agent 委派 task → settler 在独立上下文里做结构化提取 → 返回结果给主 agent → 主 agent 或 settler 写 DB)。或给 settler 一个 `write_summary` 工具直接写 Prisma。
- **validator**:`[get_chapter, query_memory]`(只读)。

### 系统 prompt
- **主 agent**:状态感知编排(CONCEPT→update_novel 收集;ACTIVE→task(writer)→task(settler)→task(validator))。复用 ContextAssembler 的状态感知逻辑。
- **writer**:复用现有 `WRITER_AGENT_PROMPT`(编辑纪律 + 禁整章大 replace + clear_chapter 重写)。
- **settler**:结构化提取指令(复用 AnalystService 的 settle prompt)。
- **validator**:一致性/质量检查指令(新)。

## 6. Controller 适配

`agentos.controller.ts` 的 `runAgent`:
- `emit` 回调不变(写 Act* 帧 + 累计 content)。
- 把 `this.conversational.runTurn({...emit})` 换成 `this.deepAgent.runTurn({...emit})`。
- `aggregateActivities` / `appendTurn` / `getRuns` 不变(activities 持久化不变)。
- 自愈(clearThreadCheckpoints/deleteThread)**删掉**——deepagents 的 SummarizationMiddleware 不产生孤儿 → 不需要自愈。

## 7. FE 影响:极小

Controller 仍用 `createActivityEmitter` 翻译 deepagents 的 langgraph message-stream → Act* 帧。FE 的交错时间线 / StreamingIndicator / activities 持久化 **全部保留,不改**。

唯一新增:`task` 工具调用(子 agent 委派)在活动流里显示为一个 tool 条目。子 agent 内部的活动是否回流到主 agent 的流(取决于 deepagents 的 task 工具实现)——spike 已确认 deepagents 流式是 message-stream(controller 的 createActivityEmitter 能翻译),所以子 agent 的 tool calls / think 应该也会在流里。

## 8. Spike 结果(已通过)

`scripts/spike-deepagents.ts`:
- ✅ `createDeepAgent` 接受 ChatOpenAI 实例(z.ai GLM-5.2)。
- ✅ invoke 出正确回复。
- ✅ 流式 18 chunks,reasoning=true, content=true → createActivityEmitter 兼容。

## 9. 迁移阶段

| 阶段 | 内容 | 预估 |
|---|---|---|
| 1 | `deep-agent.service.ts`(主 agent + 3 子 agent spec + 工具注入);controller 换调用 | 1 天 |
| 2 | 删 `pipeline/` 全目录 + `agent-tools.ts`;模块重接;gate | 0.5 天 |
| 3 | FE 验证(controller 翻译不变 → 基本不改;处理 task 委派显示) | 0.5 天 |
| 4 | 聊天冒烟(写章 → 结算 → 校验全流程) | 0.5 天 |

## 10. 不在本次(后续)

- **checkpoint 归档定期清理**:虚拟文件系统(offloaded 内容 + summarization 归档)在 checkpoint blob 里累积;超长 session(数百轮)可能需要清理(调 offloading 阈值 / 清旧归档 / 定期 deleteThread)。已记录为 [[deepagents-migration]] memory。
- **deepagents 高级功能**:planning(write_todos)、filesystem 工具(ls/read_file/write_file)、skills、长期记忆(Store)——本次不启用,后续按需。
- **validator 子 agent 的校验标准**:本期给基本 prompt(一致性/质量);后续细化校验规则 + 评分 + 修订回路(spec #2)。

## 11. 风险

- **settler 子 agent 怎么写 DB**:deepagents 子 agent 在独立上下文里跑;它需要访问 Prisma 写 ChapterSummary/StoryEvent。方案:给 settler 一个 `write_summary` 工具(闭包注入 userId/novelId),或主 agent 收到 settler 返回的结构化数据后自己写。迁移时定。
- **ESM/Jest 摩擦**:foundation 当初移除 deepagents 的原因之一。需验证 `pnpm test` 能收集(可能需要 `jest.unstable_mockModule` mock `deepagents`,同之前 mock deepagents 的模式)。
- **task 委派的流式**:子 agent 的活动是否全部回流到主 agent 的 message-stream(让 createActivityEmitter 翻译)。spike 没测 subagent;迁移时验证。
