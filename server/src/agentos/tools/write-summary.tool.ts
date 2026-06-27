import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ChapterService } from '../../novel/chapter.service';
import type { SummaryService } from '../../memory/chapter-summary.service';
import type { StoryEventService } from '../../memory/story-event.service';
import type { CharacterService } from '../../novel/character.service';
import type { EventService, PlotEventInput } from '../../memory/event.service';
import type { ArcService } from '../../novel/arc.service';

/**
 * settler 子 agent 的「写入结算结果」工具。把提取的事实写入:
 *  - ChapterSummary(摘要/角色变化/物品)
 *  - StoryEvent(伏笔:B1 生命周期)
 *  - CharacterChange(角色时间线:B2 事件驱动状态)
 * userId/novelId 闭包注入(防越权)。
 */
export function makeWriteSummaryTool({
  userId,
  novelId,
  chapters,
  summaries,
  events,
  characters,
  eventService,
  arcService,
}: {
  userId: string;
  novelId: string;
  chapters: ChapterService;
  summaries: SummaryService;
  events: StoryEventService;
  characters: CharacterService;
  eventService: EventService;
  arcService: ArcService;
}) {
  return tool(
    async ({
      chapterOrder,
      summary,
      roleChanges,
      entities,
      newHooks,
      advancedHookIds,
      resolvedHookIds,
      coreHookIds,
      plotEvents,
      currentArcSummary,
      currentVolumeArcSummary,
    }) => {
      const ch = await chapters.findByOrder(userId, novelId, chapterOrder);
      if (!ch)
        return { ok: false as const, reason: 'no_such_chapter' as const };
      await summaries.upsert({
        userId,
        novelId,
        chapterId: ch.id,
        summary,
        roleChanges,
        entities,
      });
      // B2:角色变化写 CharacterChange 时间线(find-or-create 角色)。
      if (roleChanges.length)
        await characters.recordChanges(
          userId,
          novelId,
          chapterOrder,
          roleChanges,
        );
      await events.createHooks(userId, novelId, newHooks, chapterOrder);
      if (advancedHookIds.length)
        await events.advanceHooks(
          userId,
          novelId,
          advancedHookIds,
          chapterOrder,
        );
      await events.resolveHooks(userId, novelId, resolvedHookIds, chapterOrder);
      if (coreHookIds.length)
        await events.markCore(userId, novelId, coreHookIds, true);
      // Phase 11:关键事件账本(独立于伏笔;Event=事实点,伏笔=承诺线)。
      if (plotEvents?.length)
        await eventService.createEvents(
          userId,
          novelId,
          plotEvents as PlotEventInput[],
          chapterOrder,
        );
      // Phase 12:滚动更新当前弧线/卷进展摘要(工具按 chapterOrder 解析目标 arc/volume)。
      if (currentArcSummary || currentVolumeArcSummary)
        await arcService.updateProgressSummary(
          userId,
          novelId,
          chapterOrder,
          currentArcSummary,
          currentVolumeArcSummary,
        );
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
          .array(
            z.object({
              name: z.string().describe('角色名'),
              field: z
                .string()
                .describe(
                  '变化维度:personality/emotion/ability/status/relationship:对方名/appearance/knowledge/other',
                ),
              value: z.string().describe('变化后的值/描述'),
              reason: z.string().describe('故事中导致变化的触发事件(必填)'),
            }),
          )
          .describe('角色状态变化(结构化:哪个维度变成什么,因为什么)'),
        entities: z
          .array(
            z.object({
              type: z.enum(['item', 'place', 'setting']),
              name: z.string(),
              note: z.string(),
            }),
          )
          .describe('物品/地点/设定'),
        newHooks: z
          .array(
            z.object({
              description: z.string().describe('伏笔描述'),
              payoffTiming: z
                .enum([
                  'IMMEDIATE',
                  'NEAR_TERM',
                  'MID_ARC',
                  'SLOW_BURN',
                  'ENDGAME',
                ])
                .describe(
                  '回收时机:IMMEDIATE≤3章 / NEAR_TERM≤12 / MID_ARC≤40 / SLOW_BURN≤120 / ENDGAME贯穿全书',
                ),
              core: z
                .boolean()
                .optional()
                .describe('是否核心伏笔(全书必须回收的大承诺/大谜团)'),
              dependsOn: z
                .array(z.string())
                .optional()
                .describe('依赖的已有伏笔 id(此伏笔回收前需先回收的)'),
            }),
          )
          .describe('本章新埋下的伏笔(含回收时机/核心/依赖)'),
        advancedHookIds: z
          .array(z.string())
          .default([])
          .describe('本章推进(蹭到/发展)的已有伏笔 id'),
        resolvedHookIds: z
          .array(z.string())
          .default([])
          .describe('本章回收的伏笔 id'),
        coreHookIds: z
          .array(z.string())
          .default([])
          .describe('本章标记为核心的已有伏笔 id'),
        plotEvents: z
          .array(
            z.object({
              description: z
                .string()
                .describe('发生了什么(如「沈砚在密室发现血书」)'),
              significance: z
                .enum(['MAJOR', 'MINOR'])
                .describe(
                  'MAJOR=剧情转折/重大揭示/关键冲突(常驻上下文+重点召回);MINOR=次要推进(仅可查)',
                ),
              kind: z
                .string()
                .optional()
                .describe(
                  '可选分类:revelation/confrontation/death/meeting/betrayal/...',
                ),
              involvedCharacters: z
                .array(z.string())
                .optional()
                .describe('涉及角色名'),
              location: z.string().optional().describe('地点名'),
              causedById: z
                .string()
                .optional()
                .describe('导致本事件的事件 id(因果链)'),
              relatedHookId: z
                .string()
                .optional()
                .describe('本事件埋/推进/回收的伏笔 id'),
              relatedHookAction: z
                .enum(['planted', 'advanced', 'resolved'])
                .optional(),
            }),
          )
          .optional()
          .describe(
            '本章关键事件(1-3 个 MAJOR + 若干 MINOR)。区别于伏笔:事件是事实点(已发生),伏笔是承诺线(待回收)',
          ),
        currentArcSummary: z
          .string()
          .optional()
          .describe('当前弧线的滚动进展摘要(据本章+近况重写,一两句)'),
        currentVolumeArcSummary: z
          .string()
          .optional()
          .describe('当前卷的滚动进展摘要(据本章+近况重写,一两句)'),
      }),
    },
  );
}
