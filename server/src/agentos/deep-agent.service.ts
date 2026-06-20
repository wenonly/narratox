import { Injectable, Optional, Inject } from '@nestjs/common';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import { CHECKPOINTER } from './checkpointer.provider';
import { GLM_BASE_URL, GLM_MODEL } from './agentos.constants';
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

/**
 * GLM-5.2(推理模型)间歇会把一条消息流式吐出时 role 缺失,@langchain/openai 于是把它构造成通用
 * ChatMessage(Chunk)(_getType()='generic'),而非 AIMessage(Chunk)。deepagents/langgraph 的 AgentNode
 * 校验只认 AIMessage/Command —— AIMessage.isInstance(generic)=false,于是抛 "expected AIMessage or
 * Command, got object",整轮崩。这里把 generic 重类化为 AIMessage(Chunk),字段尽量保留,让协议续命。
 *
 * 构造器在运行时由【动态 import '@langchain/core/messages'】取到 —— 与 deepagents 同源的 ESM core,
 * 避免 CJS/ESM 双包导致类身份分裂(isInstance 失灵)。
 */
function reclassGenericMessage(
  msg: unknown,
  AIMessage: new (o: Record<string, unknown>) => unknown,
  AIMessageChunk: new (o: Record<string, unknown>) => unknown,
): unknown {
  const m = msg as {
    _getType?: () => string;
    content?: unknown;
    tool_calls?: unknown;
    additional_kwargs?: unknown;
    response_metadata?: unknown;
    id?: unknown;
    constructor?: { name?: string };
  } | null;
  if (!m || typeof m._getType !== 'function' || m._getType() !== 'generic')
    return msg;
  const Cls = (m.constructor?.name ?? '').includes('Chunk')
    ? AIMessageChunk
    : AIMessage;
  return new Cls({
    content: m.content ?? '',
    tool_calls: m.tool_calls ?? [],
    additional_kwargs: m.additional_kwargs ?? {},
    response_metadata: m.response_metadata ?? {},
    id: m.id ?? undefined,
  });
}

@Injectable()
export class DeepAgentService {
  private readonly models = new Map<string, unknown>();

  constructor(
    private readonly novels: NovelService,
    private readonly chapters: ChapterService,
    private readonly summaries: SummaryService,
    private readonly events: StoryEventService,
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(CHECKPOINTER)
    private readonly checkpointer?: BaseCheckpointSaver,
  ) {}

  /**
   * 取(并缓存)一个 GLM-5.2 ChatOpenAI 实例。maxTokens 按「角色」区分:
   *  - main / writer = 16_000(默认):写正文需要输出空间,16k 只兜住病态 reasoning 跑飞。
   *  - settler / validator = 6_000:提取/校验是短输出,更紧的上限进一步压住长思考。
   * 上限取自 b5d6181 的 spike 验证(GLM-5.2 无视 thinking.budget,但遵守 max_tokens;
   * 正常回合 ~2-3k,从不触及上限)。按 `${userId}:${maxTokens}` 缓存,不同上限各一份实例。
   */
  private async getModel(userId: string, maxTokens = 16_000) {
    const key = `${userId}:${maxTokens}`;
    const cached = this.models.get(key);
    if (cached) return cached;
    const { ChatOpenAI } = await import('@langchain/openai');
    const apiKey = process.env.ZHIPUAI_API_KEY;
    if (!apiKey) throw new Error('ZHIPUAI_API_KEY is not set');
    const model = new ChatOpenAI({
      apiKey,
      model: GLM_MODEL,
      temperature: 0.5,
      configuration: { baseURL: GLM_BASE_URL },
      timeout: 120_000,
      maxRetries: 0,
      maxTokens,
    });
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
  }): Promise<void> {
    const { userId, novelId, threadId, userMessage, systemPrompt, emit } = args;
    // main / writer 复用 16k 默认实例;settler / validator 各取 6k 紧上限实例。
    const model = await this.getModel(userId);
    const settlerModel = await this.getModel(userId, 6_000);
    const validatorModel = await this.getModel(userId, 6_000);
    const { createDeepAgent } = await import('deepagents');
    // 与 deepagents 同源的 ESM core:构造 coerce 中间件,兜住 GLM-5.2 间歇吐出的无 role generic 消息。
    const { AIMessage, AIMessageChunk } =
      await import('@langchain/core/messages');
    const coerce = {
      name: 'coerceChatMessage',
      async wrapModelCall(
        request: unknown,
        handler: (req: unknown) => Promise<unknown>,
      ): Promise<unknown> {
        return reclassGenericMessage(
          await handler(request),
          AIMessage,
          AIMessageChunk,
        );
      },
    };

    // 每请求构建 agent(userId/novelId 闭包注入工具)。
    const agent = createDeepAgent({
      model: model as never, // dual-package .d.ts friction → as never
      systemPrompt: systemPrompt || MAIN_AGENT_PROMPT,
      middleware: [coerce as never], // 兜 GLM-5.2 无 role generic 消息
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
          middleware: [coerce as never], // 兜 GLM-5.2 无 role generic 消息
          tools: this.writerTools(userId, novelId),
        },
        {
          name: 'settler',
          description: '结算章节(提取摘要/角色/伏笔)。章节写完后委派。',
          systemPrompt: SETTLER_AGENT_PROMPT,
          model: settlerModel as never, // 6k 紧上限:settler 只做提取,无需长思考
          middleware: [coerce as never], // 兜 GLM-5.2 无 role generic 消息
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
          middleware: [coerce as never], // 兜 GLM-5.2 无 role generic 消息
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
        options: { configurable: Record<string, unknown>; streamMode: string },
      ) => Promise<AsyncIterable<unknown>>;
    };

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
