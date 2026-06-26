import { Injectable, Optional, Inject, Logger } from '@nestjs/common';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import { CHECKPOINTER } from './checkpointer.provider';
import { ModelConfigService } from '../settings/model-config.service';
import { VoiceProfileService } from '../settings/voice-profile.service';
import { buildChatModel, type ModelConfigRecord } from './model-factory';
import {
  AGENT_TREE,
  MAX_TOKENS_BY_TIER,
  PROMPTS,
  resolveModelConfig,
  type AgentSpec,
} from './agent-tree.config';
import { TOOL_REGISTRY, type ToolDeps } from './agent-registry';
import { createActivityEmitter } from './activity-emitter';
import { applyRewind } from './rewind';
import type { ActivityEvent } from './activity.types';
// 服务
import { NovelService } from '../novel/novel.service';
import { ChapterService } from '../novel/chapter.service';
import { OutlineService } from '../novel/outline.service';
import { WorldEntryService } from '../novel/world-entry.service';
import { NovelReferenceService } from '../novel/novel-reference.service';
import { CharacterService } from '../novel/character.service';
import { RevisionSnapshotService } from '../novel/revision-snapshot.service';
import { SummaryService } from '../memory/chapter-summary.service';
import { StoryEventService } from '../memory/story-event.service';
import { PrismaService } from '../prisma/prisma.service';
import { KnowledgeService } from '../knowledge/knowledge.service';

/**
 * 不用 createDeepAgent —— 它是「编码 agent 框架」,强制带 filesystem 工具(write_file/read_file/
 * execute 等,且在 REQUIRED_MIDDLEWARE_NAMES 里删不掉)和编码 BASE 提示,会诱导模型把小说正文当
 * 文件 write_file 存储。这里直接用底层 createAgent(langchain)+ 手挑的中间件栈:
 *  - createSubAgentMiddleware:提供 task 工具,委派 chapter/curator/worldbuilder/outliner/character
 *    (generalPurposeAgent:false,不要 deepagents 默认那个带全套工具的通用子 agent)。
 *  - createSummarizationMiddleware:长对话自动压缩(小说写作上下文长,必需)。
 *  - createPatchToolCallsMiddleware:修复中断/畸形 tool call。
 *  【不包含】createFilesystemMiddleware → 文件系统工具从构造上不存在,任何模型都不会再看到 write_file。
 *
 * agent 树来自 agent-tree.config.ts 的 AGENT_TREE(声明式配置);工具走 TOOL_REGISTRY,
 * prompt 走 PROMPTS。加一个 agent = 加一段配置,不再手改本文件。
 */
@Injectable()
export class DeepAgentService {
  private readonly logger = new Logger('DeepAgentService');
  private readonly models = new Map<string, unknown>();

  constructor(
    private readonly novels: NovelService,
    private readonly chapters: ChapterService,
    private readonly outlines: OutlineService,
    private readonly world: WorldEntryService,
    private readonly characters: CharacterService,
    private readonly references: NovelReferenceService,
    private readonly knowledge: KnowledgeService,
    private readonly snapshots: RevisionSnapshotService,
    private readonly summaries: SummaryService,
    private readonly events: StoryEventService,
    private readonly prisma: PrismaService,
    private readonly modelConfigs: ModelConfigService,
    private readonly voiceProfile: VoiceProfileService,
    @Optional()
    @Inject(CHECKPOINTER)
    private readonly checkpointer?: BaseCheckpointSaver,
  ) {}

  /**
   * 取(并缓存)一个 chat 实例。config 由 runTurn 先读一次(getActive)传入,避免每轮 3 次 DB 命中。
   * 按 `${config.id}:${config.updatedAt}:${maxTokens}:${temperature}` 缓存 —— 切换活动配置 / 按角色
   * temperature 覆盖都会天然 cache miss;且用户在 /settings 原地编辑同一配置(换 provider/key/baseUrl
   * 等)时 updatedAt(@updatedAt)自动 bump → cache miss,不会拿到带旧 key 的死连接。
   * maxTokens 由 AgentSpec.modelTier 经 MAX_TOKENS_BY_TIER 映射。
   */
  private async getModel(config: ModelConfigRecord, maxTokens = 16_000) {
    const key = `${config.id}:${config.updatedAt.getTime()}:${maxTokens}:${config.temperature}`;
    const cached = this.models.get(key);
    if (cached) return cached;
    const model = await buildChatModel(config, maxTokens);
    this.models.set(key, model);
    return model;
  }

  /** 按 spec 的 modelTier + 可选 temperature 覆盖解析出 model 实例。 */
  private async resolveModel(spec: AgentSpec, activeConfig: ModelConfigRecord) {
    return this.getModel(
      resolveModelConfig(spec, activeConfig),
      MAX_TOKENS_BY_TIER[spec.modelTier],
    );
  }

  async runTurn(args: {
    userId: string;
    novelId: string;
    threadId: string;
    userMessage: string;
    userMessageId: string;
    systemPrompt: string;
    emit: (ev: ActivityEvent) => void;
    signal?: AbortSignal;
    readingChapterOrder: number | null;
  }): Promise<void> {
    const {
      userId,
      novelId,
      threadId,
      userMessage,
      userMessageId,
      systemPrompt,
      emit,
      signal,
      readingChapterOrder,
    } = args;
    // 读一次活动模型配置(getActive 含 apiKey,供工厂;runTurn 里复用,避免 3 次 DB 命中)。
    // spec §3.4:getActive 与 voiceProfile.get 合并为单次 Promise.all,省一轮 DB 往返。
    const [activeConfig, voiceProfileMd] = await Promise.all([
      this.modelConfigs.getActive(userId),
      this.voiceProfile.get(userId),
    ]);
    if (!activeConfig) {
      throw new Error('尚未配置模型,请在设置页「设置」中添加并激活一个模型');
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
    this.logger.log(
      `runTurn: ${config.provider} / ${config.model} (baseUrl: ${config.baseUrl ?? 'default'})`,
    );

    // 小说级参考资料:每轮按 novel 现拼 writer 的【写作参考】slice(injectTo=writer/both
    // 条目精要 top6 + 全量索引)。createSubAgentMiddleware 配置是同步的,故必须在 createAgent
    // 之前 await 取完。无条目则 writer 用原始 WRITER_AGENT_PROMPT(配置 promptAugment:'writer',
    // 由 builder 拼接;行为不变)。
    const refsAll = await this.references.listAll(userId, novelId);
    const writerRefs = refsAll.filter(
      (r) => r.injectTo === 'writer' || r.injectTo === 'both',
    );
    const refIndexLines = refsAll
      .map((r) => `- [${r.injectTo ?? '—'}] ${r.title}(${r.category})`)
      .join('\n');
    const writerSlice = writerRefs.length
      ? '\n\n【写作参考】\n索引:\n' +
        refIndexLines +
        '\n\n精要:\n' +
        writerRefs
          .slice(0, 6)
          .map((r) => `### ${r.title}\n${(r.content ?? '').slice(0, 500)}`)
          .join('\n\n')
      : '';

    // 作者画像(per-user,已在 runTurn 开头随 getActive 一起 Promise.all 取回):拼进 writer 的
    // augment slice。空画像 → 不加(走 P1 默认规则)。
    const voiceSlice = voiceProfileMd
      ? '\n\n【作者声音 — 照作者本人的腔调写,不是 AI 自选】\n' +
        voiceProfileMd.slice(0, 1500)
      : '';

    // centaur:同一份画像拼给 validator,作为「校验本章是否像这个作者写的」对照(11 维)。
    // 空 validatorSlice → validator 走原 prompt(dim 11 自我跳过),行为不变。
    const validatorSlice = voiceProfileMd
      ? '\n\n【作者画像 — 校验本章是否像这个作者写的】\n' +
        voiceProfileMd.slice(0, 1500)
      : '';

    const agent = await this.buildAgentGraph({
      userId,
      novelId,
      readingChapterOrder,
      systemPrompt,
      activeConfig: config,
      writerSlice: writerSlice + voiceSlice,
      validatorSlice,
    });

    const stream = await agent.stream(
      { messages: [{ role: 'user', content: userMessage, id: userMessageId }] },
      { configurable: { thread_id: threadId }, streamMode: 'messages', signal },
    );

    const em = createActivityEmitter(emit);
    let chunkCount = 0;
    try {
      for await (const chunk of stream) {
        chunkCount++;
        em.feed(chunk);
      }
    } catch (err) {
      this.logger.error(
        `stream 中断 (chunk #${chunkCount}): ${err instanceof Error ? err.message : err}`,
      );
      if (err instanceof Error && err.stack) {
        this.logger.error(err.stack);
      }
      // 打印错误对象的关键属性(DeepSeek 400 可能带 status/body)
      const anyErr = err as Record<string, unknown>;
      this.logger.error(`err keys: ${Object.keys(anyErr).join(', ')}`);
      const statusVal = anyErr.status;
      const status =
        typeof statusVal === 'string' || typeof statusVal === 'number'
          ? String(statusVal)
          : '?';
      const bodyVal = anyErr.response ?? anyErr.body ?? '?';
      const resp = JSON.stringify(bodyVal).slice(0, 500);
      this.logger.error(`status: ${status} | response: ${resp}`);
      throw err;
    }
    em.finish();
  }

  /**
   * 真回退:把 thread state 里从「锚点 user 消息」起到末尾的消息全部 RemoveMessage 删除,
   * 写一个「已删除」的新 checkpoint —— 下轮 runTurn 加载它时 agent 不再看到被撤回内容。
   * 不调 LLM(仅 state 操作);锚点已被摘要压缩(findIndex<0)或无活动模型配置 → 跳过,
   * 由调用方负责删 DB 行(降级为「仅 UI 撤回」),记日志。best-effort:抛错由调用方兜底。
   */
  async rewind(
    userId: string,
    novelId: string,
    threadId: string,
    langGraphId: string,
  ): Promise<void> {
    // 复用 runTurn 的 graph 构造(同一 checkpointer + messages channel)。rewind 不调 LLM,
    // 但 createAgent 需要 model —— 读活动配置;无配置则跳过(调用方仍删 DB 行)。
    const activeConfig = await this.modelConfigs.getActive(userId);
    if (!activeConfig) {
      this.logger.warn(
        `rewind: 无活动模型配置,跳过 checkpoint 回退(thread ${threadId}),仅删 DB 行`,
      );
      return;
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
    const agent = await this.buildAgentGraph({
      userId,
      novelId,
      readingChapterOrder: null,
      systemPrompt: '',
      activeConfig: config,
      writerSlice: '',
    });

    // 纯逻辑(getState/findIndex/RemoveMessage/updateState)抽到 applyRewind 便于单测。
    // agent 结构上满足 RewindGraph(getState/updateState);buildAgentGraph 返回类型已声明这俩方法。
    const removed = await applyRewind(agent, threadId, langGraphId);
    if (removed < 0) {
      // 锚点已被 summarization 压缩 → state 里已无该消息 → 跳过(摘要可能残留语义,已知限制)。
      this.logger.warn(
        `rewind: 锚点 ${langGraphId} 不在当前 state(可能已压缩),跳过 checkpoint 回退`,
      );
      return;
    }
    if (removed > 0) {
      this.logger.log(
        `rewind: 已从 thread ${threadId} 删除 ${removed} 条消息(锚点 ${langGraphId})`,
      );
    }
  }

  /**
   * 构造本服务使用的 langgraph agent(createAgent + 手挑 deepagents 中间件栈)。
   * 由 runTurn/rewind 调用。agent 树来自 AGENT_TREE(声明式配置):递归 buildNode 把每个
   * spec 解析成 subagent 配置(prompt/model/tools),有 subagents 的节点挂 nested
   * createSubAgentMiddleware。root(main)用 systemPrompt 回退 PROMPTS['MAIN'](状态感知)。
   */
  private async buildAgentGraph(args: {
    userId: string;
    novelId: string;
    readingChapterOrder: number | null;
    systemPrompt: string;
    activeConfig: ModelConfigRecord;
    writerSlice: string;
    validatorSlice?: string;
  }): Promise<{
    stream: (
      input: {
        messages: Array<{ role: string; content: string; id?: string }>;
      },
      options: {
        configurable: Record<string, unknown>;
        streamMode: string;
        signal?: AbortSignal;
      },
    ) => Promise<AsyncIterable<unknown>>;
    getState: (config: {
      configurable: Record<string, unknown>;
    }) => Promise<{ values: { messages?: Array<{ id?: string }> } }>;
    updateState: (
      config: { configurable: Record<string, unknown> },
      values: Record<string, unknown>,
    ) => Promise<unknown>;
  }> {
    const {
      userId,
      novelId,
      readingChapterOrder,
      systemPrompt,
      activeConfig,
      writerSlice,
      validatorSlice = '',
    } = args;

    // 动态 import(保持 Jest collection 干净):底层 createAgent + deepagents 中间件构件。
    const { createAgent } = await import('langchain');
    const {
      createSubAgentMiddleware,
      createSummarizationMiddleware,
      createPatchToolCallsMiddleware,
      createSubagentTransformer,
      StateBackend,
    } = await import('deepagents');

    // SummarizationMiddleware 需要一个 backend(线程内内存文件系统,仅用于上下文压缩临时落地)。
    const backend = new StateBackend();
    // 子 agent 公用栈:仅 patch(修复畸形 tool call)。
    const subagentStack = () => [createPatchToolCallsMiddleware()] as never;

    const deps: ToolDeps = {
      userId,
      novelId,
      readingChapterOrder,
      novels: this.novels,
      chapters: this.chapters,
      outlines: this.outlines,
      world: this.world,
      characters: this.characters,
      references: this.references,
      knowledge: this.knowledge,
      snapshots: this.snapshots,
      summaries: this.summaries,
      events: this.events,
      prisma: this.prisma,
    };
    const resolveTools = (keys: string[]) =>
      keys.map((k) => TOOL_REGISTRY[k](deps) as never);
    const resolvePrompt = (spec: AgentSpec) => {
      if (spec.promptAugment === 'writer')
        return PROMPTS[spec.promptKey] + writerSlice;
      if (spec.promptAugment === 'validator')
        return PROMPTS[spec.promptKey] + validatorSlice;
      return PROMPTS[spec.promptKey];
    };

    const mainModel = await this.resolveModel(AGENT_TREE, activeConfig);

    // 把一个 spec 递归构造成 subagent 配置(含其下 nested createSubAgentMiddleware)。
    const buildNode = async (spec: AgentSpec) => {
      const node: Record<string, unknown> = {
        name: spec.name,
        description: spec.description,
        systemPrompt: resolvePrompt(spec),
        model: await this.resolveModel(spec, activeConfig),
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
      systemPrompt: systemPrompt || PROMPTS[AGENT_TREE.promptKey],
      tools: resolveTools(AGENT_TREE.tools),
      middleware: [
        createSubAgentMiddleware({
          defaultModel: mainModel as never,
          generalPurposeAgent: false, // 不要 deepagents 默认的通用子 agent(它带全套工具)
          defaultMiddleware: subagentStack(),
          subagents: (await Promise.all(
            (AGENT_TREE.subagents ?? []).map(buildNode),
          )) as never,
        }) as never,
        createSummarizationMiddleware({ backend }) as never,
        createPatchToolCallsMiddleware() as never,
      ],
      streamTransformers: [createSubagentTransformer([] as never)] as never,
      ...(this.checkpointer
        ? { checkpointer: this.checkpointer as never }
        : {}),
    }).withConfig({ recursionLimit: 10_000 }) as unknown as {
      // createAgent 的 .d.ts 在 nodenext 下判为 error type(同 @langchain/openai 的 dual-package 摩擦);
      // 且 middleware 上的 `as never` 会让返回类型塌缩 → 给 agent 一个结构化的 .stream 类型。
      stream: (
        input: {
          messages: Array<{ role: string; content: string; id?: string }>;
        },
        options: {
          configurable: Record<string, unknown>;
          streamMode: string;
          signal?: AbortSignal;
        },
      ) => Promise<AsyncIterable<unknown>>;
      // getState/updateState 供后续 rewind 复用同一句柄(langgraph CompiledStateGraph 自带)。
      getState: (config: {
        configurable: Record<string, unknown>;
      }) => Promise<{ values: { messages?: Array<{ id?: string }> } }>;
      updateState: (
        config: { configurable: Record<string, unknown> },
        values: Record<string, unknown>,
      ) => Promise<unknown>;
    };

    return agent;
  }
}
