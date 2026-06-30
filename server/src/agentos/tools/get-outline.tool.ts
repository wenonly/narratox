import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { OutlineService } from '../../novel/outline.service';

/**
 * main + writer 的「查看全书大纲」工具(只读)。userId/novelId 闭包注入。
 * 返回卷列表 + 各章细纲标题/状态 + nextChapterOrder(下一个该写的章,用于自定位)。
 * writer 写章前可调它看大局、定位当前章。
 */
export function makeGetOutlineTool({
  userId,
  novelId,
  outlines,
}: {
  userId: string;
  novelId: string;
  outlines: OutlineService;
}) {
  return tool(
    async () => {
      const { master, volumes, arcs, chapterOutlines } =
        await outlines.listOutline(userId, novelId);
      const nextChapterOrder = await outlines.nextChapterOrder(userId, novelId);
      return {
        master: master
          ? {
              theme: master.theme,
              mainLine: master.mainLine,
              ending: master.ending,
              powerProgression: master.powerProgression,
              hiddenLines: master.hiddenLines,
              volumeSplitLogic: master.volumeSplitLogic,
            }
          : null,
        volumes: volumes.map((v) => ({
          order: v.order,
          title: v.title,
          goal: v.goal,
          synopsis: v.synopsis,
          bridge: v.bridge,
          mainProgress: v.mainProgress,
        })),
        arcs: arcs.map((a) => ({
          order: a.order,
          title: a.title,
          goal: a.goal,
          fromChapter: a.fromChapter,
          toChapter: a.toChapter,
          summary: a.summary,
        })),
        chapters: chapterOutlines
          .filter((c) => c.status !== 'WRITTEN')
          .map((c) => ({
            chapterOrder: c.chapterOrder,
            title: c.title,
            status: c.status,
          })),
        writtenCount: chapterOutlines.filter((c) => c.status === 'WRITTEN')
          .length,
        nextChapterOrder,
      };
    },
    {
      name: 'get_outline',
      description:
        '查看全书大纲(总纲 + 卷 + 弧线 + 未写章计划)+ 已写章数 + 下一个该写的章序号。chapters 仅未写计划(DRAFT/APPROVED,即 upcoming to-do);已写见 writtenCount,单章正文 get_chapter、细纲 get_chapter_plan。写章前调用,定位当前位置与走向。',
      schema: z.object({}),
    },
  );
}
