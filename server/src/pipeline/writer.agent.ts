import { Injectable } from '@nestjs/common';
import { GLM_BASE_URL, GLM_MODEL } from '../agentos/agentos.constants';
import { Composer } from './composer';
import {
  runToolLoop,
  type AgentRunContext,
  type StatelessAgent,
} from './stateless-agent';
import type { ActivityEvent } from './activity.types';
import { makeAppendSectionTool } from '../agentos/tools/append-section.tool';
import { makeReplaceTextTool } from '../agentos/tools/replace-text.tool';
import { makeInsertTextTool } from '../agentos/tools/insert-text.tool';
import { makeDeleteTextTool } from '../agentos/tools/delete-text.tool';
import { makeSetChapterTitleTool } from '../agentos/tools/set-chapter-title.tool';
import { makeClearChapterTool } from '../agentos/tools/clear-chapter.tool';
import { makeGetChapterTool } from '../agentos/tools/get-chapter.tool';
import { makeListChaptersTool } from '../agentos/tools/list-chapters.tool';
import { makeQueryMemoryTool } from '../agentos/tools/query-memory.tool';
import { ChapterService } from '../novel/chapter.service';
import { NovelService } from '../novel/novel.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * writer 专家:Composer 拼(写作指令+设定+前情+伏笔+本章目标)→ 单次有界工具循环,
 * 用 append_section 一节节写完整章(正文落 DB,不进聊天)。userId/novelId 闭包注入。
 * 产出扁平活动事件:think(推理)/ tool(append_section 等)/ content(简短完成说明)。
 */
@Injectable()
export class WriterAgent implements StatelessAgent {
  readonly name = 'writer';

  constructor(
    private readonly composer: Composer,
    private readonly chapters: ChapterService,
    private readonly novels: NovelService,
    private readonly prisma: PrismaService,
  ) {}

  async *run(ctx: AgentRunContext): AsyncGenerator<ActivityEvent> {
    const { userId, novelId, input } = ctx;
    const chapterOrder = Number(input.chapterOrder);
    const userMessage =
      typeof input.userMessage === 'string' ? input.userMessage : '';
    if (!Number.isInteger(chapterOrder) || chapterOrder < 1) {
      throw new Error(
        `writer: invalid chapterOrder=${String(input.chapterOrder)}`,
      );
    }

    const prompt = await this.composer.buildWriterContext({
      userId,
      novelId,
      chapterOrder,
      userMessage,
    });

    const { ChatOpenAI } = await import('@langchain/openai');
    const apiKey = process.env.ZHIPUAI_API_KEY;
    if (!apiKey)
      throw new Error('ZHIPUAI_API_KEY is not set. Add it to server/.env.');
    const model = new ChatOpenAI({
      apiKey,
      model: GLM_MODEL,
      temperature: 0.6,
      configuration: { baseURL: GLM_BASE_URL },
      timeout: 120_000,
      maxRetries: 0,
      // GLM-5.2 是 reasoning 模型,无限额时会"想个不停"(曾跑飞到 10 万字思考)。
      // GLM-5.2 无视 thinking.budget_tokens(已 spike),但遵守 max_tokens。
      // 给宽(16k ≈ 实际一轮 ~2-3k 的数倍):正常/深度思考碰不到,只兜住病态跑飞。
      maxTokens: 16_000,
    });

    // 工具闭包注入 userId/novelId(防伪造/越权)。as never 见 swarm 同源的双包摩擦。
    const tools = [
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
      makeInsertTextTool({
        userId,
        novelId,
        chapters: this.chapters,
      }) as never,
      makeDeleteTextTool({
        userId,
        novelId,
        chapters: this.chapters,
      }) as never,
      makeSetChapterTitleTool({
        userId,
        novelId,
        chapters: this.chapters,
      }) as never,
      makeClearChapterTool({
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

    yield* runToolLoop({
      model,
      system: prompt.system,
      user: prompt.user,
      tools,
      agentName: 'writer',
    });
  }
}
