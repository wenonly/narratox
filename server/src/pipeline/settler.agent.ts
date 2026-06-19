import { Injectable } from '@nestjs/common';
import { GLM_BASE_URL, GLM_MODEL } from '../agentos/agentos.constants';
import { analystSchema, type AnalystOutput } from '../agentos/analyst-schema';
import { Composer } from './composer';
import type { AgentRunContext, StatelessAgent } from './stateless-agent';
import type { ActivityEvent } from './activity.types';
import { nextActId } from './activity.types';
import { SummaryService } from '../memory/chapter-summary.service';
import { StoryEventService } from '../memory/story-event.service';
import { ChapterService } from '../novel/chapter.service';

/**
 * ChatOpenAI 的结构子集(同 AnalystService):规避 dual-package 类型摩擦,
 * 在 getModel 单点 as unknown as ChatModel 收口。type-only,运行时不引入静态 import。
 */
interface StructuredRunnable<T> {
  invoke(input: unknown): Promise<T>;
}
interface ChatModel {
  withStructuredOutput<T>(
    schema: unknown,
    options?: { method?: 'functionCalling' | 'jsonMode' },
  ): StructuredRunnable<T>;
}

/**
 * settler 专家:本章正文落定后,一次性 withStructuredOutput(method:'functionCalling')
 * 提取 4 类事实(摘要/角色变化/物品/伏笔)→ 写 ChapterSummary + StoryEvent。
 * **取代原异步 AnalystService**:同步、在流里、可见、错误当场冒(spec §4.1)。
 *
 * 单次结构化调用(非流式),故无 think 增量;产出一条 content 活动概述提取结果。
 */
@Injectable()
export class SettlerAgent implements StatelessAgent {
  readonly name = 'settler';

  constructor(
    private readonly composer: Composer,
    private readonly chapters: ChapterService,
    private readonly summaries: SummaryService,
    private readonly events: StoryEventService,
  ) {}

  async *run(ctx: AgentRunContext): AsyncGenerator<ActivityEvent> {
    const { userId, novelId, input } = ctx;
    const chapterOrder = Number(input.chapterOrder);
    if (!Number.isInteger(chapterOrder) || chapterOrder < 1) {
      throw new Error(`settler: invalid chapterOrder=${input.chapterOrder}`);
    }

    const prompt = await this.composer.buildSettlerContext({
      userId,
      novelId,
      chapterOrder,
    });

    const { ChatOpenAI } = await import('@langchain/openai');
    const apiKey = process.env.ZHIPUAI_API_KEY;
    if (!apiKey) throw new Error('ZHIPUAI_API_KEY is not set. Add it to server/.env.');
    const model = new ChatOpenAI({
      apiKey,
      model: GLM_MODEL,
      temperature: 0.1,
      configuration: { baseURL: GLM_BASE_URL },
      timeout: 90_000,
      maxRetries: 0,
    }) as unknown as ChatModel;

    const structured = model.withStructuredOutput<AnalystOutput>(analystSchema, {
      method: 'functionCalling' as const,
    });
    const result = await structured.invoke([
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ]);

    // 写入:复刻 AnalystService.doSettle 的写入路径(ChapterSummary + StoryEvent)。
    const chapter = await this.chapters.findByOrder(userId, novelId, chapterOrder);
    if (chapter) {
      await this.summaries.upsert({
        userId,
        novelId,
        chapterId: chapter.id,
        summary: result.summary,
        roleChanges: result.roleChanges,
        entities: result.entities,
      });
    }
    await this.events.createHooks(userId, novelId, result.newHooks, chapterOrder);
    await this.events.resolveHooks(
      userId,
      novelId,
      result.resolvedHookIds,
      chapterOrder,
    );

    // 产出一条 content 活动概述提取结果(可见、可展开)。
    const contentId = nextActId('content');
    yield { type: 'Act', id: contentId, act: 'content', label: '结算' };
    yield {
      type: 'ActDelta',
      id: contentId,
      text:
        `已结算第${chapterOrder}章:摘要「${result.summary}」` +
        `;角色变化 ${result.roleChanges.length} 项、物品 ${result.entities.length} 项` +
        `、新伏笔 ${result.newHooks.length} 处、回收伏笔 ${result.resolvedHookIds.length} 处。`,
    };
    yield { type: 'ActEnd', id: contentId, status: 'ok' };
  }
}
