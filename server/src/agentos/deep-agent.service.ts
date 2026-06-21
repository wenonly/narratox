import { Injectable, Optional, Inject } from '@nestjs/common';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import { CHECKPOINTER } from './checkpointer.provider';
import { ModelConfigService } from '../settings/model-config.service';
import { buildChatModel, type ModelConfigRecord } from './model-factory';
import {
  MAIN_AGENT_PROMPT,
  CHAPTER_ORCHESTRATOR_PROMPT,
  WRITER_AGENT_PROMPT,
  SETTLER_AGENT_PROMPT,
  VALIDATOR_AGENT_PROMPT,
} from './agent-prompts';
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
import { makeGetReadingChapterTool } from './tools/get-reading-chapter.tool';
import { makeListChaptersTool } from './tools/list-chapters.tool';
import { makeQueryMemoryTool } from './tools/query-memory.tool';
import { makeWriteSummaryTool } from './tools/write-summary.tool';
import { makeSetVolumeTool } from './tools/set-volume.tool';
import { makeSetChapterPlanTool } from './tools/set-chapter-plan.tool';
import { makeGetOutlineTool } from './tools/get-outline.tool';
import { makeGetChapterPlanTool } from './tools/get-chapter-plan.tool';
import { makeSetWorldEntryTool } from './tools/set-world-entry.tool';
import { makeGetWorldviewTool } from './tools/get-worldview.tool';
import { makeGetWorldEntryTool } from './tools/get-world-entry.tool';
import { makeReportReviewTool } from './tools/report-review.tool';
import { makeSnapshotChapterTool } from './tools/snapshot-chapter.tool';
import { makeRestoreChapterTool } from './tools/restore-chapter.tool';
import { makeSetCharacterTool } from './tools/set-character.tool';
import { makeGetCharacterTool } from './tools/get-character.tool';
import { makeGetCharactersTool } from './tools/get-characters.tool';
// 服务
import { NovelService } from '../novel/novel.service';
import { ChapterService } from '../novel/chapter.service';
import { OutlineService } from '../novel/outline.service';
import { WorldEntryService } from '../novel/world-entry.service';
import { CharacterService } from '../novel/character.service';
import { RevisionSnapshotService } from '../novel/revision-snapshot.service';
import { SummaryService } from '../memory/chapter-summary.service';
import { StoryEventService } from '../memory/story-event.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 不用 createDeepAgent —— 它是「编码 agent 框架」,强制带 filesystem 工具(write_file/read_file/
 * execute 等,且在 REQUIRED_MIDDLEWARE_NAMES 里删不掉)和编码 BASE 提示,会诱导模型把小说正文当
 * 文件 write_file 存储。这里直接用底层 createAgent(langchain)+ 手挑的中间件栈:
 *  - createSubAgentMiddleware:提供 task 工具,委派 writer/settler/validator(generalPurposeAgent:false,
 *    不要 deepagents 默认那个带全套工具的通用子 agent)。
 *  - createSummarizationMiddleware:长对话自动压缩(小说写作上下文长,必需)。
 *  - createPatchToolCallsMiddleware:修复中断/畸形 tool call。
 *  【不包含】createFilesystemMiddleware → 文件系统工具从构造上不存在,任何模型都不会再看到 write_file。
 */
@Injectable()
export class DeepAgentService {
  private readonly models = new Map<string, unknown>();

  constructor(
    private readonly novels: NovelService,
    private readonly chapters: ChapterService,
    private readonly outlines: OutlineService,
    private readonly world: WorldEntryService,
    private readonly characters: CharacterService,
    private readonly snapshots: RevisionSnapshotService,
    private readonly summaries: SummaryService,
    private readonly events: StoryEventService,
    private readonly prisma: PrismaService,
    private readonly modelConfigs: ModelConfigService,
    @Optional()
    @Inject(CHECKPOINTER)
    private readonly checkpointer?: BaseCheckpointSaver,
  ) {}

  /**
   * 取(并缓存)一个 chat 实例。config 由 runTurn 先读一次(getActive)传入,避免每轮 3 次 DB 命中。
   * 按 `${config.id}:${maxTokens}` 缓存 —— 切换活动配置天然 cache miss。maxTokens 角色切分:
   *  - main / writer = 16_000(默认):写正文要输出空间。
   *  - settler / validator = 6_000:短输出,紧上限压住长思考。
   */
  private async getModel(config: ModelConfigRecord, maxTokens = 16_000) {
    const key = `${config.id}:${maxTokens}`;
    const cached = this.models.get(key);
    if (cached) return cached;
    const model = await buildChatModel(config, maxTokens);
    this.models.set(key, model);
    return model;
  }

  async runTurn(args: {
    userId: string;
    novelId: string;
    threadId: string;
    userMessage: string;
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
      systemPrompt,
      emit,
      signal,
      readingChapterOrder,
    } = args;
    // 读一次活动模型配置(getActive 含 apiKey,供工厂;runTurn 里复用,避免 3 次 DB 命中)。
    const activeConfig = await this.modelConfigs.getActive(userId);
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
    };
    // main / writer 复用 16k 默认实例;settler / validator 各取 6k 紧上限实例。
    const model = await this.getModel(config);
    const settlerModel = await this.getModel(config, 6_000);
    const validatorModel = await this.getModel(config, 6_000);

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
    // 子 agent 公用栈:仅 patch(修复畸形 tool call)。子 agent 是短任务,不需要 summarization。
    const subagentStack = () => [createPatchToolCallsMiddleware()] as never;

    const agent = createAgent({
      model: model as never, // dual-package .d.ts friction → as never
      systemPrompt: systemPrompt || MAIN_AGENT_PROMPT,
      tools: [
        makeGetNovelInfoTool({ userId, novelId, novels: this.novels }) as never,
        makeUpdateNovelTool({ userId, novelId, novels: this.novels }) as never,
        makeGetReadingChapterTool({
          userId,
          novelId,
          readingChapterOrder,
          chapters: this.chapters,
        }) as never,
        // 大纲(main 读写):立项后生成/改大纲与细纲,写章前查定位。
        makeSetVolumeTool({
          userId,
          novelId,
          outlines: this.outlines,
        }) as never,
        makeSetChapterPlanTool({
          userId,
          novelId,
          outlines: this.outlines,
        }) as never,
        makeGetOutlineTool({
          userId,
          novelId,
          outlines: this.outlines,
        }) as never,
        makeGetChapterPlanTool({
          userId,
          novelId,
          outlines: this.outlines,
        }) as never,
        // 世界观(main 读写):立项后构建世界观条目,写章前查设定。
        makeSetWorldEntryTool({
          userId,
          novelId,
          world: this.world,
        }) as never,
        makeGetWorldviewTool({
          userId,
          novelId,
          world: this.world,
        }) as never,
        makeGetWorldEntryTool({
          userId,
          novelId,
          world: this.world,
        }) as never,
        // 角色(main 读写):世界观后建角色档案。
        makeSetCharacterTool({
          userId,
          novelId,
          characters: this.characters,
        }) as never,
      ],
      middleware: [
        createSubAgentMiddleware({
          defaultModel: model as never,
          generalPurposeAgent: false, // 不要 deepagents 默认的通用子 agent(它带全套工具)
          defaultMiddleware: subagentStack(),
          // 层级多 agent:主 agent 只委派 chapter 编排 agent;
          // writer/settler/validator 下沉到 chapter 的聚焦上下文里(webnovel 式聚焦过程),
          // 避免 main 长线程稀释「写→结算→校验」流程。
          subagents: [
            {
              name: 'chapter',
              description:
                '写/改/续写/重写章节。作者要写/续写/重写第 N 章时委派;它会在聚焦上下文里跑完 writer → settler → validator(+修订) 全流程。',
              systemPrompt: CHAPTER_ORCHESTRATOR_PROMPT,
              model: model as never,
              tools: [
                // 修订回滚由 chapter 编排(它管 snapshot/restore)。
                makeSnapshotChapterTool({
                  userId,
                  novelId,
                  snapshots: this.snapshots,
                }) as never,
                makeRestoreChapterTool({
                  userId,
                  novelId,
                  snapshots: this.snapshots,
                }) as never,
              ],
              middleware: [
                createSubAgentMiddleware({
                  defaultModel: model as never,
                  generalPurposeAgent: false,
                  defaultMiddleware: subagentStack(),
                  subagents: [
                    {
                      name: 'writer',
                      description: '写/改/续写章节正文。',
                      systemPrompt: WRITER_AGENT_PROMPT,
                      tools: this.writerTools(userId, novelId),
                    },
                    {
                      name: 'settler',
                      description: '结算章节(提取摘要/角色/伏笔)。',
                      systemPrompt: SETTLER_AGENT_PROMPT,
                      model: settlerModel as never,
                      tools: [
                        makeGetChapterTool({
                          userId,
                          novelId,
                          chapters: this.chapters,
                        }) as never,
                        makeWriteSummaryTool({
                          userId,
                          novelId,
                          chapters: this.chapters,
                          summaries: this.summaries,
                          events: this.events,
                          characters: this.characters,
                        }) as never,
                      ],
                    },
                    {
                      name: 'validator',
                      description: '校验章节一致性/质量。',
                      systemPrompt: VALIDATOR_AGENT_PROMPT,
                      model: validatorModel as never,
                      tools: [
                        makeGetChapterTool({
                          userId,
                          novelId,
                          chapters: this.chapters,
                        }) as never,
                        makeQueryMemoryTool({
                          userId,
                          novelId,
                          prisma: this.prisma,
                        }) as never,
                        makeReportReviewTool() as never,
                      ],
                    },
                  ],
                }) as never,
              ],
            },
          ],
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
        input: { messages: Array<{ role: string; content: string }> },
        options: {
          configurable: Record<string, unknown>;
          streamMode: string;
          signal?: AbortSignal;
        },
      ) => Promise<AsyncIterable<unknown>>;
    };

    const stream = await agent.stream(
      { messages: [{ role: 'user', content: userMessage }] },
      { configurable: { thread_id: threadId }, streamMode: 'messages', signal },
    );

    const em = createActivityEmitter(emit);
    for await (const chunk of stream) {
      em.feed(chunk);
    }
    em.finish();
  }

  /** writer 子 agent 的写作/编辑工具 + 大纲只读工具(闭包注入 userId/novelId)。 */
  private writerTools(userId: string, novelId: string) {
    return [
      makeAppendSectionTool({
        userId,
        novelId,
        chapters: this.chapters,
        novels: this.novels,
      }) as never,
      makeReplaceTextTool({
        userId,
        novelId,
        chapters: this.chapters,
      }) as never,
      makeInsertTextTool({ userId, novelId, chapters: this.chapters }) as never,
      makeDeleteTextTool({ userId, novelId, chapters: this.chapters }) as never,
      makeClearChapterTool({
        userId,
        novelId,
        chapters: this.chapters,
      }) as never,
      makeSetChapterTitleTool({
        userId,
        novelId,
        chapters: this.chapters,
      }) as never,
      makeGetChapterTool({ userId, novelId, chapters: this.chapters }) as never,
      makeListChaptersTool({
        userId,
        novelId,
        chapters: this.chapters,
      }) as never,
      makeQueryMemoryTool({ userId, novelId, prisma: this.prisma }) as never,
      // 大纲(writer 只读):写第 N 章前 get_chapter_plan 读细纲节点,get_outline 定位。
      makeGetOutlineTool({
        userId,
        novelId,
        outlines: this.outlines,
      }) as never,
      makeGetChapterPlanTool({
        userId,
        novelId,
        outlines: this.outlines,
      }) as never,
      // 世界观(writer 只读):写到涉及地点/势力/规则时查设定细节。
      makeGetWorldviewTool({
        userId,
        novelId,
        world: this.world,
      }) as never,
      makeGetWorldEntryTool({
        userId,
        novelId,
        world: this.world,
      }) as never,
      // 角色(writer 只读):写涉及角色时查当前态 + 列角色。
      makeGetCharacterTool({
        userId,
        novelId,
        characters: this.characters,
      }) as never,
      makeGetCharactersTool({
        userId,
        novelId,
        characters: this.characters,
      }) as never,
    ];
  }
}
