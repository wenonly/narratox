import {
  Injectable,
  Logger,
  Optional,
  Inject,
  OnModuleInit,
} from '@nestjs/common';
import { EventEmitter } from 'events';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import { CHECKPOINTER } from './checkpointer.provider';
import { ModelConfigService } from '../settings/model-config.service';
import { AgentModelOverrideService } from '../settings/agent-model-override.service';
import { BenchmarkService } from '../benchmark/benchmark.service';
import { PrismaService } from '../prisma/prisma.service';
import { DissectContextAssembler } from './dissect-context-assembler.service';
import { buildChatModel, type ModelConfigRecord } from './model-factory';
import { MAX_TOKENS_BY_TIER, resolveModelConfig } from './agent-tree.config';
import {
  DISSECT_TREE,
  DISSECT_PROMPTS,
  type DissectSpec,
} from './dissect-tree.config';
import { TOOL_REGISTRY, type ToolDeps } from './agent-registry';
import { pickAgentConfig, type AgentOverrideEntry } from './deep-agent.service';
import { createActivityEmitter } from './activity-emitter';
import type { ActivityEvent } from './activity.types';

/**
 * 拆解 agent 服务:独立于会话 DeepAgentService,绑定 bookId,后台异步跑。
 *
 * 与 DeepAgentService 的区别:
 *  - 不接会话线程(无 novel/session),输入是一本对标书(bookId);
 *  - 后台异步跑(startDissect 不 await),通过 EventEmitter 推活动帧,
 *    controller 把 EventEmitter 流化给前端(SSE-like newline-JSON);
 *  - jobs map 按 bookId 记录 { emitter, abortController },支持断线重连(stream 路由)。
 *
 * 模型解析与 DeepAgentService 同源:per-agent override 优先(activeConfig 兜底),
 * getModel 按 `${id}:${updatedAt}:${maxTokens}:${temperature}` 缓存。agent 树来自
 * DISSECT_TREE(声明式配置),工具走 TOOL_REGISTRY(userId/bookId 闭包注入)。
 */
export interface DissectJob {
  emitter: EventEmitter;
  abortController: AbortController;
}

@Injectable()
export class DissectAgentService implements OnModuleInit {
  private readonly logger = new Logger('DissectAgentService');
  private readonly models = new Map<string, unknown>();
  private readonly jobs = new Map<string, DissectJob>();

  constructor(
    private readonly modelConfigs: ModelConfigService,
    private readonly agentOverrides: AgentModelOverrideService,
    private readonly benchmark: BenchmarkService,
    private readonly dissectContext: DissectContextAssembler,
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(CHECKPOINTER)
    private readonly checkpointer?: BaseCheckpointSaver,
  ) {}

  async onModuleInit(): Promise<void> {
    // 启动时把上次未完成的拆解(RUNNING,可能是进程崩溃遗留)标记为 INTERRUPTED,
    // 避免 UI 永远显示「拆解中」。best-effort:失败只记日志。
    try {
      await this.benchmark.markInterruptedOnBoot();
    } catch (err) {
      this.logger.error(
        `markInterruptedOnBoot failed: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  /**
   * 取(并缓存)chat 实例。cache key 同 DeepAgentService:
   * `${id}:${updatedAt.getTime()}:${maxTokens}:${temperature}`。
   */
  private async getModel(config: ModelConfigRecord, maxTokens = 16_000) {
    const key = `${config.id}:${config.updatedAt.getTime()}:${maxTokens}:${config.temperature}`;
    const cached = this.models.get(key);
    if (cached) return cached;
    const model = await buildChatModel(config, maxTokens);
    this.models.set(key, model);
    return model;
  }

  /**
   * 按 spec 的 modelTier + 可选 per-agent override 解析 model 实例。
   * 复用 pickAgentConfig(override 优先,activeConfig 兜底)+ resolveModelConfig
   * (2 参:config + temperatureOverride)。与 DeepAgentService.resolveModel 同逻辑。
   */
  private async resolveModel(
    spec: DissectSpec,
    activeConfig: ModelConfigRecord,
    overrideMap: Map<string, AgentOverrideEntry>,
  ) {
    const { config: overrideConfig, temperatureOverride } = pickAgentConfig(
      spec.name,
      overrideMap,
      activeConfig,
    );
    // override 的 modelId 空(只设温度)→ overrideConfig=null,用 activeConfig 兜底。
    const config = overrideConfig ?? activeConfig;
    return this.getModel(
      resolveModelConfig(config, temperatureOverride),
      MAX_TOKENS_BY_TIER[spec.modelTier],
    );
  }

  /**
   * 构造拆解 agent(独立于会话 agent 的图):createAgent + createSubAgentMiddleware,
   * subagents 来自 DISSECT_TREE.subagents。中间件栈与 DeepAgentService 一致
   * (subagent 委派 + summarization + patch)。
   */
  private async buildDissectGraph(args: {
    userId: string;
    bookId: string;
    systemPrompt: string;
    activeConfig: ModelConfigRecord;
    overrideMap: Map<string, AgentOverrideEntry>;
  }): Promise<{
    stream: (
      input: { messages: Array<{ role: string; content: string }> },
      options: {
        configurable: Record<string, unknown>;
        streamMode: string;
        signal?: AbortSignal;
      },
    ) => Promise<AsyncIterable<unknown>>;
  }> {
    const { userId, bookId, systemPrompt, activeConfig, overrideMap } = args;

    const { createAgent } = await import('langchain');
    const {
      createSubAgentMiddleware,
      createSummarizationMiddleware,
      createPatchToolCallsMiddleware,
      createSubagentTransformer,
      StateBackend,
    } = await import('deepagents');

    const backend = new StateBackend();
    const subagentStack = () => [createPatchToolCallsMiddleware()] as never;

    // 拆解工具的 deps:novel-bound 服务全 null(bookId-bound 工具不读它们);
    // bookId/benchmark 闭包注入拆解工具(write_benchmark/get_raw_chapter/...)。
    const deps: ToolDeps = {
      userId,
      novelId: '',
      readingChapterOrder: null,
      novels: null as never,
      chapters: null as never,
      outlines: null as never,
      world: null as never,
      characters: null as never,
      references: null as never,
      knowledge: null as never,
      snapshots: null as never,
      summaries: null as never,
      events: null as never,
      eventService: null as never,
      arcs: null as never,
      masterOutlines: null as never,
      prisma: this.prisma,
      bookId,
      benchmark: this.benchmark,
    };
    const resolveTools = (keys: string[]) =>
      keys.map((k) => TOOL_REGISTRY[k](deps) as never);

    const mainModel = await this.resolveModel(
      DISSECT_TREE,
      activeConfig,
      overrideMap,
    );

    // 递归把一个 spec 构造成 subagent 配置(含其下 nested createSubAgentMiddleware)。
    const buildNode = async (
      spec: DissectSpec,
    ): Promise<Record<string, unknown>> => {
      const node: Record<string, unknown> = {
        name: spec.name,
        description: spec.description,
        systemPrompt: DISSECT_PROMPTS[spec.promptKey],
        model: await this.resolveModel(spec, activeConfig, overrideMap),
        tools: resolveTools(spec.tools),
      };
      if (spec.subagents && spec.subagents.length > 0) {
        node.middleware = [
          createSubAgentMiddleware({
            defaultModel: mainModel as never,
            generalPurposeAgent: false,
            defaultMiddleware: subagentStack(),
            subagents: (await Promise.all(
              spec.subagents.map(buildNode),
            )) as never,
          }) as never,
        ];
      }
      return node;
    };

    const agent = createAgent({
      model: mainModel as never, // dual-package .d.ts friction → as never
      systemPrompt: systemPrompt || DISSECT_PROMPTS[DISSECT_TREE.promptKey],
      tools: resolveTools(DISSECT_TREE.tools),
      middleware: [
        createSubAgentMiddleware({
          defaultModel: mainModel as never,
          generalPurposeAgent: false,
          defaultMiddleware: subagentStack(),
          subagents: (await Promise.all(
            (DISSECT_TREE.subagents ?? []).map(buildNode),
          )) as never,
        }) as never,
        createSummarizationMiddleware({ backend }) as never,
        createPatchToolCallsMiddleware() as never,
      ],
      ...(this.checkpointer
        ? { checkpointer: this.checkpointer as never }
        : {}),
      streamTransformers: [createSubagentTransformer([] as never)] as never,
    }).withConfig({ recursionLimit: 500 }) as unknown as {
      stream: (
        input: { messages: Array<{ role: string; content: string }> },
        options: {
          configurable: Record<string, unknown>;
          streamMode: string;
          signal?: AbortSignal;
        },
      ) => Promise<AsyncIterable<unknown>>;
    };

    return agent;
  }

  /**
   * 启动一次拆解(后台异步,不 await)。流程:
   *  1. 读 activeConfig + overrideMap + context prompt;
   *  2. 建 emitter/abortController 入 jobs map;
   *  3. 置 book.status=RUNNING;
   *  4. 后台 IIFE 跑 agent.stream → 活动帧经 emitter 推送 → 完成置 DONE / 失败置 FAILED;
   *  5. finally emit 'done' + 清 jobs map。
   * controller(dissect / stream 路由)订阅 emitter 把帧流化给前端。
   */
  async startDissect(userId: string, bookId: string): Promise<void> {
    const activeConfig = await this.modelConfigs.getActive(userId);
    if (!activeConfig) {
      throw new Error('尚未配置模型,请在设置页激活一个模型');
    }
    const config: ModelConfigRecord = {
      id: activeConfig.id,
      provider: activeConfig.provider,
      model: activeConfig.model,
      baseUrl: activeConfig.baseUrl,
      apiKey: activeConfig.apiKey,
      temperature: activeConfig.temperature,
      updatedAt: activeConfig.updatedAt,
    };
    const overrideMap = await this.agentOverrides.listMap(userId);
    const { prompt } = await this.dissectContext.forBook(userId, bookId);

    const emitter = new EventEmitter();
    const abortController = new AbortController();
    this.jobs.set(bookId, { emitter, abortController });

    await this.prisma.benchmarkBook.update({
      where: { id: bookId },
      data: {
        status: 'RUNNING',
        progress: { chapter: 0, total: 0, agent: 'dissect-main' } as never,
      },
    });

    // 后台跑(不 await):startDissect 立即返回,controller 订阅 emitter 流化。
    (async () => {
      try {
        const agent = await this.buildDissectGraph({
          userId,
          bookId,
          systemPrompt: prompt,
          activeConfig: config,
          overrideMap,
        });
        const stream = await agent.stream(
          { messages: [{ role: 'user', content: '开始拆解。' }] },
          {
            configurable: { thread_id: `dissect-${bookId}` },
            streamMode: 'messages',
            signal: abortController.signal,
          },
        );
        const em = createActivityEmitter((ev: ActivityEvent) =>
          emitter.emit('activity', ev),
        );
        for await (const chunk of stream) em.feed(chunk);
        em.finish();
        await this.prisma.benchmarkBook.update({
          where: { id: bookId },
          data: { status: 'DONE' },
        });
      } catch (err) {
        this.logger.error(
          `dissect ${bookId} failed: ${
            err instanceof Error ? err.message : err
          }`,
        );
        await this.prisma.benchmarkBook.update({
          where: { id: bookId },
          data: { status: 'FAILED' },
        });
      } finally {
        emitter.emit('done');
        this.jobs.delete(bookId);
      }
    })();
  }

  /** 取 bookId 对应的 job(供 controller 订阅 / 断线重连判断)。 */
  getJob(bookId: string): DissectJob | undefined {
    return this.jobs.get(bookId);
  }
}
