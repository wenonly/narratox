import { Injectable, Optional, Inject } from '@nestjs/common';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import { CHECKPOINTER } from './checkpointer.provider';
import { ModelConfigService } from '../settings/model-config.service';
import { buildChatModel, type ModelConfigRecord } from './model-factory';
import {
  MAIN_AGENT_PROMPT,
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
import { makeListChaptersTool } from './tools/list-chapters.tool';
import { makeQueryMemoryTool } from './tools/query-memory.tool';
import { makeWriteSummaryTool } from './tools/write-summary.tool';
// 服务
import { NovelService } from '../novel/novel.service';
import { ChapterService } from '../novel/chapter.service';
import { SummaryService } from '../memory/chapter-summary.service';
import { StoryEventService } from '../memory/story-event.service';
import { PrismaService } from '../prisma/prisma.service';

/** deepagents 的 createDeepAgent 无条件注入 7 个文件系统工具(ls / read_file / write_file /
 * edit_file / glob / grep / execute)。它们操作的是内存 StateBackend,与本服务的 PostgreSQL
 * 存储无关 —— agent 调它们只会得到空结果或无意义副作用。createDeepAgent 不允许移除
 * FilesystemMiddleware(它在 REQUIRED_MIDDLEWARE_NAMES 里),所以单独用一个中间件在每次
 * model-call 时按名 filter 掉这些工具(provider 无关,主 agent + 全部 subagent 统一生效)。 */
const FILESYSTEM_TOOL_NAMES = new Set([
  'ls',
  'read_file',
  'write_file',
  'edit_file',
  'glob',
  'grep',
  'execute',
]);

/** 职责单一:只过滤文件系统工具,不再兜任何厂商特定消息(原 GLM generic 重分类已移除)。 */
const excludeFilesystemTools = {
  name: 'excludeFilesystemTools',
  async wrapModelCall(
    request: unknown,
    handler: (req: unknown) => Promise<unknown>,
  ): Promise<unknown> {
    const req = request as { tools?: Array<{ name: string }> };
    const filtered = {
      ...req,
      tools: req.tools?.filter((t) => !FILESYSTEM_TOOL_NAMES.has(t.name)),
    };
    return handler(filtered);
  },
};

@Injectable()
export class DeepAgentService {
  private readonly models = new Map<string, unknown>();

  constructor(
    private readonly novels: NovelService,
    private readonly chapters: ChapterService,
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
  }): Promise<void> {
    const {
      userId,
      novelId,
      threadId,
      userMessage,
      systemPrompt,
      emit,
      signal,
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
    const { createDeepAgent } = await import('deepagents');

    // 每请求构建 agent(userId/novelId 闭包注入工具)。
    const agent = createDeepAgent({
      model: model as never, // dual-package .d.ts friction → as never
      systemPrompt: systemPrompt || MAIN_AGENT_PROMPT,
      middleware: [excludeFilesystemTools as never],
      ...(this.checkpointer
        ? { checkpointer: this.checkpointer as never }
        : {}),
      tools: [
        makeGetNovelInfoTool({ userId, novelId, novels: this.novels }) as never,
        makeUpdateNovelTool({ userId, novelId, novels: this.novels }) as never,
      ],
      subagents: [
        {
          name: 'writer',
          description: '写/改/续写章节正文。作者要写章节时委派。',
          systemPrompt: WRITER_AGENT_PROMPT,
          middleware: [excludeFilesystemTools as never],
          tools: this.writerTools(userId, novelId),
        },
        {
          name: 'settler',
          description: '结算章节(提取摘要/角色/伏笔)。章节写完后委派。',
          systemPrompt: SETTLER_AGENT_PROMPT,
          model: settlerModel as never, // 6k 紧上限:settler 只做提取,无需长思考
          middleware: [excludeFilesystemTools as never],
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
            }) as never,
          ],
        },
        {
          name: 'validator',
          description: '校验章节一致性/质量。结算后委派。',
          systemPrompt: VALIDATOR_AGENT_PROMPT,
          model: validatorModel as never, // 6k 紧上限:validator 只做校验,无需长思考
          middleware: [excludeFilesystemTools as never],
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
          ],
        },
      ],
    }) as unknown as {
      // deepagents 的 .d.ts 在 nodenext 下判为 error type(同 @langchain/openai 的 dual-package 摩擦);
      // 且 middleware 上的 `as never` 会让 createDeepAgent 的返回类型塌缩 → 给 agent 一个结构化的 .stream 类型。
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

  /** writer 子 agent 的 9 个写作/编辑工具(闭包注入 userId/novelId)。 */
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
    ];
  }
}
