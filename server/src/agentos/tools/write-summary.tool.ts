import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ChapterService } from '../../novel/chapter.service';
import type { SummaryService } from '../../memory/chapter-summary.service';
import type { StoryEventService } from '../../memory/story-event.service';

/**
 * settler 子 agent 的"写入结算结果"工具。把提取的 4 类事实(摘要/角色/物品/伏笔)
 * 写入 ChapterSummary + StoryEvent(Prisma 结构化表,与 novelId/chapterId 绑定)。
 * userId/novelId 闭包注入(防越权)。
 */
export function makeWriteSummaryTool({
  userId,
  novelId,
  chapters,
  summaries,
  events,
}: {
  userId: string;
  novelId: string;
  chapters: ChapterService;
  summaries: SummaryService;
  events: StoryEventService;
}) {
  return tool(
    async ({ chapterOrder, summary, roleChanges, entities, newHooks, resolvedHookIds }) => {
      const ch = await chapters.findByOrder(userId, novelId, chapterOrder);
      if (!ch) return { ok: false as const, reason: 'no_such_chapter' as const };
      await summaries.upsert({
        userId,
        novelId,
        chapterId: ch.id,
        summary,
        roleChanges,
        entities,
      });
      await events.createHooks(userId, novelId, newHooks, chapterOrder);
      await events.resolveHooks(userId, novelId, resolvedHookIds, chapterOrder);
      return { ok: true as const, chapterOrder };
    },
    {
      name: 'write_summary',
      description:
        '把本章结算结果(摘要/角色变化/物品/伏笔)写入数据库。settler 用它持久化提取结果。',
      schema: z.object({
        chapterOrder: z.number().int().describe('章节序号(1-based)'),
        summary: z.string().describe('本章一句话情节摘要'),
        roleChanges: z
          .array(z.object({ name: z.string(), change: z.string() }))
          .describe('角色状态变化'),
        entities: z
          .array(
            z.object({
              type: z.enum(['item', 'place', 'setting']),
              name: z.string(),
              note: z.string(),
            }),
          )
          .describe('物品/地点/设定'),
        newHooks: z.array(z.string()).describe('本章新埋下的伏笔描述'),
        resolvedHookIds: z
          .array(z.string())
          .describe('本章回收的伏笔 id(从 get_chapter 输出的 OPEN 伏笔中挑)'),
      }),
    },
  );
}
