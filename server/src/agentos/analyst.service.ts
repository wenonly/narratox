import { Injectable } from '@nestjs/common';
import { AgentLoggerService } from '../logging/agent-logger.service';
import { GLM_BASE_URL, GLM_MODEL } from './agentos.constants';
import { analystSchema, type AnalystOutput } from './analyst-schema';
import { SummaryService } from '../memory/chapter-summary.service';
import { StoryEventService } from '../memory/story-event.service';
import { ChapterService } from '../novel/chapter.service';
import { NovelService } from '../novel/novel.service';

/**
 * 结算 Agent 用到的 ChatOpenAI 表面类型(结构子集)。
 *
 * 为什么不直接 import type { ChatOpenAI }:该包存在 dual-package 解析摩擦,
 * 顶层 import type 走 import-resolution、await import() 走 require-resolution,
 * 两套 ChatOpenAI 类名义上不兼容(protected 成员跨不过去),编译期会报
 * "not a class derived from"。原先用 resolution-mode: require 的 import-type
 * 查询规避,但 ESLint 的类型服务解析不出该 import-attribute 语法,把 ChatModel
 * 判成 error type(no-unsafe-assignment)。这里改用只描述 doSettle 真正调用的
 * 结构子集(withStructuredOutput → invoke),在 getModel 里单点
 * as unknown as ChatModel 收口,既绕开 dual-package 摩擦、也满足严格 eslint。
 * type-only,运行时不引入静态 import,不破坏 dynamic-import-for-ESM 约定。
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

interface NovelSettingsLite {
  style?: string;
  worldviewText?: string;
}

/**
 * 非用户面向结算 Agent。write_chapter 落稿成功后 fire-and-forget 触发 settle()。
 * 单独 ChatOpenAI(temp 0.1),一次 withStructuredOutput(method:'functionCalling') 调用。
 * 按 userId 缓存 model;按 novelId 内存锁防并发结算。settle 绝不抛出(内部 try/catch)。
 */
@Injectable()
export class AnalystService {
  private readonly models = new Map<string, ChatModel>();
  private readonly settlingNovels = new Set<string>();

  constructor(
    private readonly chapters: ChapterService,
    private readonly novels: NovelService,
    private readonly summaries: SummaryService,
    private readonly events: StoryEventService,
    private readonly agentLog: AgentLoggerService,
  ) {}

  private async getModel(userId: string): Promise<ChatModel> {
    const cached = this.models.get(userId);
    if (cached) return cached;
    const { ChatOpenAI } = await import('@langchain/openai');
    const apiKey = process.env.ZHIPUAI_API_KEY;
    if (!apiKey) throw new Error('ZHIPUAI_API_KEY is not set');
    // `await import(...)` 解析为 import-resolution 的 ChatOpenAI,与字段类型
    // (require-resolution)名义不兼容 —— 这里单点 cast 收口,后续调用方拿到的
    // 就是与字段一致的类型,doSettle 里不必再每次 cast。
    const model = new ChatOpenAI({
      apiKey,
      model: GLM_MODEL,
      temperature: 0.1,
      configuration: { baseURL: GLM_BASE_URL },
      timeout: 90_000,
      maxRetries: 0,
    }) as unknown as ChatModel;
    this.models.set(userId, model);
    return model;
  }

  async settle(args: {
    userId: string;
    novelId: string;
    chapterOrder: number;
  }): Promise<void> {
    const { userId, novelId, chapterOrder } = args;
    const log = this.agentLog.forContext({ novelId, chapterOrder });
    // 并发锁:同一小说同一时间只跑一个结算。
    if (this.settlingNovels.has(novelId)) {
      log.info({ phase: 'settle.skip_concurrent' }, 'agent');
      return;
    }
    this.settlingNovels.add(novelId);
    const startedAt = Date.now();
    try {
      log.info({ phase: 'settle.start' }, 'agent');
      await this.doSettle(userId, novelId, chapterOrder);
      log.info(
        { phase: 'settle.success', latencyMs: Date.now() - startedAt },
        'agent',
      );
    } catch (err) {
      log.error(
        {
          phase: 'settle.failed',
          latencyMs: Date.now() - startedAt,
          err: err instanceof Error ? err : new Error(String(err)),
        },
        'agent',
      );
    } finally {
      this.settlingNovels.delete(novelId);
    }
  }

  private async doSettle(
    userId: string,
    novelId: string,
    chapterOrder: number,
  ): Promise<void> {
    const chapter = await this.chapters.findByOrder(
      userId,
      novelId,
      chapterOrder,
    );
    if (!chapter) return; // 章节已不在(被删/越权),静默退出
    const content = chapter.content ?? '';

    const novel = await this.novels.get(userId, novelId);
    const settings = (novel.settings ?? {}) as NovelSettingsLite;
    const openHooks = await this.events.listOpen(userId, novelId);

    const model = await this.getModel(userId);
    const structured = model.withStructuredOutput<AnalystOutput>(
      analystSchema,
      {
        method: 'functionCalling' as const,
      },
    );

    const result = await structured.invoke([
      {
        role: 'system',
        content:
          '你是小说一致性记账员。阅读本章正文,严谨提取事实(客观、不编造)。' +
          'resolvedHookIds 只能从下面给出的 OPEN 伏笔 id 里挑本章确实回收了的;没回收就返回空数组。',
      },
      {
        role: 'user',
        content:
          `【书名】${novel.title}\n【类型】${novel.genre ?? '未指定'}\n` +
          `【简介】${novel.synopsis ?? '未指定'}\n【世界观】${settings.worldviewText ?? '未指定'}\n` +
          `【文风】${settings.style ?? '未指定'}\n\n【本章序号】第${chapterOrder}章\n` +
          `【OPEN 伏笔(仅可从中挑选回收)】\n` +
          (openHooks.length
            ? openHooks.map((h) => `- id=${h.id}: ${h.description}`).join('\n')
            : '(无)') +
          `\n\n【本章正文】\n${content}`,
      },
    ]);

    await this.summaries.upsert({
      userId,
      novelId,
      chapterId: chapter.id,
      summary: result.summary,
      roleChanges: result.roleChanges,
      entities: result.entities,
    });
    await this.events.createHooks(
      userId,
      novelId,
      result.newHooks,
      chapterOrder,
    );
    await this.events.resolveHooks(
      userId,
      novelId,
      result.resolvedHookIds,
      chapterOrder,
    );
  }
}
