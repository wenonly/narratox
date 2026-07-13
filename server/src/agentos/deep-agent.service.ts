import { Injectable, Optional, Inject, Logger } from '@nestjs/common';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import { CHECKPOINTER } from './checkpointer.provider';
import { ModelConfigService } from '../settings/model-config.service';
import { AgentModelOverrideService } from '../settings/agent-model-override.service';
import { VoiceProfileService } from '../settings/voice-profile.service';
import { buildChatModel, type ModelConfigRecord } from './model-factory';
import {
  AGENT_TREE,
  MAX_TOKENS_BY_TIER,
  PROMPTS,
  resolveModelConfig,
  buildAgentRoster,
  type AgentSpec,
} from './agent-tree.config';
import { TOOL_REGISTRY, type ToolDeps } from './agent-registry';
import { MAIN_ROLE_REMINDER } from './agent-prompts';
import { buildReferenceSlice } from './reference-slice';
import { buildMasterOutlineSlice } from './master-slice';
import { buildForeSlice } from './fore-slice';
import { buildEventsSlice } from './events-slice';
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
import { EventService } from '../memory/event.service';
import { ArcService } from '../novel/arc.service';
import { MasterOutlineService } from '../novel/master-outline.service';
import { PrismaService } from '../prisma/prisma.service';
import { KnowledgeService } from '../knowledge/knowledge.service';

/**
 * 不用 createDeepAgent —— 它是「编码 agent 框架」,强制带 filesystem 工具(write_file/read_file/
 * execute 等,且在 REQUIRED_MIDDLEWARE_NAMES 里删不掉)和编码 BASE 提示,会诱导模型把小说正文当
 * 文件 write_file 存储。这里直接用底层 createAgent(langchain)+ 手挑的中间件栈:
 *  - createSubAgentMiddleware:提供 task 工具,委派 chapter/curator/outline-critic/wb-critic/char-critic
 *    (generalPurposeAgent:false,不要 deepagents 默认那个带全套工具的通用子 agent)。
 *  - createSummarizationMiddleware:长对话自动压缩(小说写作上下文长,必需)。
 *  - createPatchToolCallsMiddleware:修复中断/畸形 tool call。
 *  【不包含】createFilesystemMiddleware → 文件系统工具从构造上不存在,任何模型都不会再看到 write_file。
 *
 * agent 树来自 agent-tree.config.ts 的 AGENT_TREE(声明式配置);工具走 TOOL_REGISTRY,
 * prompt 走 PROMPTS。加一个 agent = 加一段配置,不再手改本文件。
 */

/**
 * 组装本轮喂给 agent.stream 的消息:只含 user 消息。
 * 职责提醒(MAIN_ROLE_REMINDER)改由 appendRoleReminder 并入 agent systemPrompt(首条 system)——
 * 不能作为本轮 system 注入,否则会成为第 2 条 system,触发 GLM 等模型
 * "System messages are only permitted as the first passed message" 报错。
 */
export function buildTurnMessages(userMessage: string, userMessageId: string) {
  return [{ role: 'user', content: userMessage, id: userMessageId }];
}

/**
 * 把每轮职责提醒追加到 main 的 systemPrompt 末尾,随首条 system 一起下发。
 * 保留 Phase 14「每轮强化编排职责」意图;代价是落在首条(被长历史稀释),
 * 但这是 GLM「只允许首条 system」约束下的根因解(非降级为 user)。
 */
export function appendRoleReminder(systemPrompt: string): string {
  return systemPrompt + '\n\n' + MAIN_ROLE_REMINDER;
}

/** override map 的 value:模型 + per-agent 温度覆盖。 */
export interface AgentOverrideEntry {
  // null = modelId 空(只设温度),运行时由 resolveModel 用 activeConfig 兜底。
  config: ModelConfigRecord | null;
  temperatureOverride: number | null;
}

/**
 * override 优先,无则 active(temperatureOverride=null)。纯函数好测;buildNode 用它解析每个 spec 的 config。
 * overrideMap: agentKey → { config, temperatureOverride }(由 AgentModelOverrideService.listMap 一次性读全量)。
 */
export function pickAgentConfig(
  agentKey: string,
  overrideMap: Map<string, AgentOverrideEntry>,
  activeConfig: ModelConfigRecord,
): AgentOverrideEntry {
  return (
    overrideMap.get(agentKey) ?? {
      config: activeConfig,
      temperatureOverride: null,
    }
  );
}

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
    private readonly eventService: EventService,
    private readonly arcs: ArcService,
    private readonly masterOutlines: MasterOutlineService,
    private readonly prisma: PrismaService,
    private readonly modelConfigs: ModelConfigService,
    private readonly agentOverrides: AgentModelOverrideService,
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

  /**
   * 按 spec 的 modelTier + 可选 temperature 覆盖解析出 model 实例。
   * config 优先级:overrideMap[spec.name](per-agent override) > activeConfig。
   * per-agent 用不同 ModelConfig → cache key 天然不同,无需改 getModel 缓存。
   */
  private async resolveModel(
    spec: AgentSpec,
    activeConfig: ModelConfigRecord,
    overrideMap: Map<string, AgentOverrideEntry>,
  ) {
    const { config: overrideConfig, temperatureOverride } = pickAgentConfig(
      spec.name,
      overrideMap,
      activeConfig,
    );
    // modelId 空(只设温度)的 override:overrideConfig=null → 用 activeConfig 兜底。
    const config = overrideConfig ?? activeConfig;
    return this.getModel(
      resolveModelConfig(config, temperatureOverride),
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
    // spec §3.4:getActive 与 voiceProfile.getForNovel 合并为单次 Promise.all,省一轮 DB 往返。
    const [activeConfig, voiceProfileMd] = await Promise.all([
      this.modelConfigs.getActive(userId),
      this.voiceProfile.getForNovel(userId, novelId),
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
    // per-agent override(Phase 22 Task 4):一次读全量(agentKey → ModelConfigRecord,
    // 含 apiKey),buildNode 据 spec.name 用 pickAgentConfig override 优先解析。
    const overrideMap = await this.agentOverrides.listMap(userId);
    this.logger.log(
      `runTurn: ${config.provider} / ${config.model} (baseUrl: ${config.baseUrl ?? 'default'})`,
    );

    // 小说级参考资料:每轮现取 refsAll;注入由 buildAgentGraph 的 resolvePrompt 按各
    // agent 角色名通用拼装(buildReferenceSlice)。createSubAgentMiddleware 配置同步,
    // 故须在 createAgent 之前 await 取完。无条目则该角色不拼 slice(行为不变)。
    const refsAll = await this.references.listAll(userId, novelId);

    // Phase 18:总纲(全书北极星)拼给 writer——锁战力崩坏/主线漂移于写作源头。
    // main 经 ContextAssembler 拿同一份;此处仅 writer augment。
    const master = await this.masterOutlines.get(userId, novelId);
    const masterSliceRaw = buildMasterOutlineSlice(master as never);
    const masterSlice = masterSliceRaw ? '\n\n' + masterSliceRaw : '';

    // writer 前情(last 5 章摘要):补 N-1 全文(接缝)与 query_memory(远期)间的中程视野。
    // main 不再注入前情(编排者用不上),此处专为 writer。
    const fore = await this.summaries.listRecent(userId, novelId, 5);
    const foreSliceRaw = buildForeSlice(fore);
    const foreSlice = foreSliceRaw ? '\n\n' + foreSliceRaw : '';

    // writer 近期关键事件(Phase 11):最近 8 条 MAJOR,跨 5 章摘要窗口仍记得发生了什么。
    // listRecentMajor 此前是死代码(零生产调用),#2 修复:挂进 writer augment 与 foreSlice 同级。
    const recentEvents = await this.eventService.listRecentMajor(
      userId,
      novelId,
      8,
    );
    const eventsSliceRaw = buildEventsSlice(recentEvents);
    const eventsSlice = eventsSliceRaw ? '\n\n' + eventsSliceRaw : '';

    // writer 字数目标(每章+全书):writer 无 get_novel_info,注入 augment 让它每轮必见(修 bug1)。
    const novelSettings = await this.prisma.novel.findUnique({
      where: { id: novelId },
      select: { settings: true },
    });
    const ns =
      (novelSettings?.settings as {
        chapterWordTarget?: number;
        totalWordTarget?: number;
      } | null) ?? {};
    const targetParts = [
      ns.chapterWordTarget ? `每章${ns.chapterWordTarget}字(写到就停)` : '',
      ns.totalWordTarget ? `全书${ns.totalWordTarget}字` : '',
    ].filter(Boolean);
    const targetSlice = targetParts.length
      ? `\n\n【字数目标】${targetParts.join(' · ')}`
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
      systemPrompt: appendRoleReminder(systemPrompt),
      activeConfig: config,
      overrideMap,
      refsAll,
      voiceSlice,
      validatorSlice,
      masterSlice,
      foreSlice,
      eventsSlice,
      targetSlice,
    });

    const stream = await agent.stream(
      { messages: buildTurnMessages(userMessage, userMessageId) },
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
      overrideMap: new Map(),
      refsAll: [],
      voiceSlice: '',
      masterSlice: '',
      foreSlice: '',
      eventsSlice: '',
      targetSlice: '',
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
    overrideMap: Map<string, AgentOverrideEntry>;
    refsAll: {
      injectTo: string | null;
      title: string;
      category: string;
      content?: string | null;
    }[];
    voiceSlice?: string;
    validatorSlice?: string;
    masterSlice?: string;
    foreSlice?: string;
    eventsSlice?: string;
    targetSlice?: string;
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
      overrideMap,
      refsAll,
      voiceSlice = '',
      validatorSlice = '',
      masterSlice = '',
      foreSlice = '',
      eventsSlice = '',
      targetSlice = '',
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
      eventService: this.eventService,
      arcs: this.arcs,
      masterOutlines: this.masterOutlines,
      prisma: this.prisma,
    };
    const resolveTools = (keys: string[]) =>
      keys.map((k) => TOOL_REGISTRY[k](deps) as never);
    // 通用按角色拼参考资料精要(缓存 per role);curator 额外追加「活的」agent 名单,
    // 供其分析该为哪些角色生成专属精要。
    const refSliceCache = new Map<string, string>();
    const refSliceFor = (role: string) => {
      let s = refSliceCache.get(role);
      if (s === undefined) {
        s = buildReferenceSlice(role, refsAll);
        refSliceCache.set(role, s);
      }
      return s;
    };
    const resolvePrompt = (spec: AgentSpec) => {
      let prompt = PROMPTS[spec.promptKey];
      if (spec.name === 'curator') prompt += '\n\n' + buildAgentRoster();
      const refSlice = refSliceFor(spec.name);
      if (refSlice) prompt += '\n\n' + refSlice;
      if (spec.promptAugment === 'writer')
        prompt +=
          masterSlice + foreSlice + eventsSlice + targetSlice + voiceSlice;
      if (spec.promptAugment === 'validator') prompt += validatorSlice;
      return prompt;
    };

    const mainModel = await this.resolveModel(
      AGENT_TREE,
      activeConfig,
      overrideMap,
    );

    // 把一个 spec 递归构造成 subagent 配置(含其下 nested createSubAgentMiddleware)。
    const buildNode = async (spec: AgentSpec) => {
      const tools = [...spec.tools];
      // tagged 角色自动获得拉取能力:有专属精要(injectTo 命中本角色或 both)→ 按
      // 精要里的【按需索引】get_reference 拉库条目。main/writer 本就静态有,不重复加。
      const hasEssence = refsAll.some(
        (r) => r.injectTo === spec.name || r.injectTo === 'both',
      );
      if (hasEssence && !tools.includes('get_reference'))
        tools.push('get_reference');
      const node: Record<string, unknown> = {
        name: spec.name,
        description: spec.description,
        systemPrompt: resolvePrompt(spec),
        model: await this.resolveModel(spec, activeConfig, overrideMap),
        tools: resolveTools(tools),
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
    }).withConfig({ recursionLimit: 500 }) as unknown as {
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
