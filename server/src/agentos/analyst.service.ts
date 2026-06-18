import { Injectable } from '@nestjs/common';
import { GLM_BASE_URL, GLM_MODEL } from './agentos.constants';
import { analystSchema } from './analyst-schema';
import { SummaryService, type RoleChange, type EntityFact } from '../memory/chapter-summary.service';
import { StoryEventService } from '../memory/story-event.service';
import { ChapterService } from '../novel/chapter.service';
import { NovelService } from '../novel/novel.service';

interface NovelSettingsLite { style?: string; worldviewText?: string; }

/**
 * 非用户面向结算 Agent。write_chapter 落稿成功后 fire-and-forget 触发 settle()。
 * 单独 ChatOpenAI(temp 0.1),一次 withStructuredOutput(method:'functionCalling') 调用。
 * 按 userId 缓存 model;按 novelId 内存锁防并发结算。settle 绝不抛出(内部 try/catch)。
 */
@Injectable()
export class AnalystService {
  private readonly models = new Map<string, unknown>();
  private readonly settlingNovels = new Set<string>();

  constructor(
    private readonly chapters: ChapterService,
    private readonly novels: NovelService,
    private readonly summaries: SummaryService,
    private readonly events: StoryEventService,
  ) {}

  private async getModel(userId: string) {
    const cached = this.models.get(userId);
    if (cached) return cached;
    const { ChatOpenAI } = await import('@langchain/openai');
    const apiKey = process.env.ZHIPUAI_API_KEY;
    if (!apiKey) throw new Error('ZHIPUAI_API_KEY is not set');
    const model = new ChatOpenAI({
      apiKey, model: GLM_MODEL, temperature: 0.1,
      configuration: { baseURL: GLM_BASE_URL },
      timeout: 90_000, maxRetries: 0,
    });
    this.models.set(userId, model);
    return model;
  }

  async settle(args: { userId: string; novelId: string; chapterOrder: number }): Promise<void> {
    const { userId, novelId, chapterOrder } = args;
    // 并发锁:同一小说同一时间只跑一个结算。
    if (this.settlingNovels.has(novelId)) return;
    this.settlingNovels.add(novelId);
    try {
      await this.doSettle(userId, novelId, chapterOrder);
    } catch (err) {
      console.error(
        `[agentos] analyst settle failed (novel ${novelId} ch${chapterOrder}):`,
        err instanceof Error ? err.message : err,
      );
    } finally {
      this.settlingNovels.delete(novelId);
    }
  }

  private async doSettle(userId: string, novelId: string, chapterOrder: number): Promise<void> {
    const chapter = await this.chapters.findByOrder(userId, novelId, chapterOrder);
    if (!chapter) return; // 章节已不在(被删/越权),静默退出
    const content = chapter.content ?? '';

    const novel = await this.novels.get(userId, novelId);
    const settings = (novel.settings ?? {}) as NovelSettingsLite;
    const openHooks = await this.events.listOpen(userId, novelId);

    const model = await this.getModel(userId);
    const structured = (model as {
      withStructuredOutput: (s: typeof analystSchema, opts: { method: string }) => {
        invoke: (m: Array<{ role: string; content: string }>) => Promise<unknown>;
      };
    }).withStructuredOutput(analystSchema, { method: 'functionCalling' });

    const result = (await structured.invoke([
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
          (openHooks.length ? openHooks.map((h) => `- id=${h.id}: ${h.description}`).join('\n') : '(无)') +
          `\n\n【本章正文】\n${content}`,
      },
    ])) as { summary: string; roleChanges: RoleChange[]; entities: EntityFact[]; newHooks: string[]; resolvedHookIds: string[] };

    await this.summaries.upsert({
      userId, novelId, chapterId: chapter.id,
      summary: result.summary, roleChanges: result.roleChanges, entities: result.entities,
    });
    await this.events.createHooks(userId, novelId, result.newHooks, chapterOrder);
    await this.events.resolveHooks(userId, novelId, result.resolvedHookIds, chapterOrder);
  }
}
