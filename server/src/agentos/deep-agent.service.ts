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

  private async getModel(userId: string) {
    const cached = this.models.get(userId);
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
      maxTokens: 16_000,
    });
    this.models.set(userId, model);
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
    const model = await this.getModel(userId);
    const { createDeepAgent } = await import('deepagents');

    // 每请求构建 agent(userId/novelId 闭包注入工具)。
    const agent = await createDeepAgent({
      model: model as never, // dual-package .d.ts friction → as never
      systemPrompt: systemPrompt || MAIN_AGENT_PROMPT,
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
          tools: this.writerTools(userId, novelId),
        },
        {
          name: 'settler',
          description: '结算章节(提取摘要/角色/伏笔)。章节写完后委派。',
          systemPrompt: SETTLER_AGENT_PROMPT,
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
          tools: [
            makeGetChapterTool({
              userId,
              novelId,
              chapters: this.chapters,
            }) as never,
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

  /** writer 子 agent 的 9 个写作/编辑工具(闭包注入 userId/novelId)。 */
  private writerTools(userId: string, novelId: string) {
    return [
      makeAppendSectionTool({
        userId,
        novelId,
        chapters: this.chapters,
        novels: this.novels,
      }) as never,
      makeReplaceTextTool({ userId, novelId, chapters: this.chapters }) as never,
      makeInsertTextTool({ userId, novelId, chapters: this.chapters }) as never,
      makeDeleteTextTool({ userId, novelId, chapters: this.chapters }) as never,
      makeClearChapterTool({ userId, novelId, chapters: this.chapters }) as never,
      makeSetChapterTitleTool({
        userId,
        novelId,
        chapters: this.chapters,
      }) as never,
      makeGetChapterTool({ userId, novelId, chapters: this.chapters }) as never,
      makeListChaptersTool({ userId, novelId, chapters: this.chapters }) as never,
      makeQueryMemoryTool({ userId, novelId, prisma: this.prisma }) as never,
    ];
  }
}
