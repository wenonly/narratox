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
      // 卷 → order 映射 + 每卷的章节范围(从细纲派生),供弧-卷一致性校验。
      const volOrderById = new Map<string, number>(
        volumes.map((v) => [v.id, v.order]),
      );
      const volRangeByOrder = new Map<number, { from: number; to: number }>();
      for (const c of chapterOutlines) {
        if (c.volumeId == null) continue;
        const order = volOrderById.get(c.volumeId);
        if (order == null) continue;
        const cur = volRangeByOrder.get(order);
        if (!cur)
          volRangeByOrder.set(order, {
            from: c.chapterOrder,
            to: c.chapterOrder,
          });
        else {
          cur.from = Math.min(cur.from, c.chapterOrder);
          cur.to = Math.max(cur.to, c.chapterOrder);
        }
      }
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
          chapterRange: volRangeByOrder.get(v.order) ?? null,
        })),
        arcs: arcs.map((a) => ({
          order: a.order,
          volumeOrder: a.volumeId
            ? (volOrderById.get(a.volumeId) ?? null)
            : null,
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
        '查看全书大纲(总纲 + 卷 + 弧线 + 未写章计划)+ 已写章数 + 下一个该写的章序号。volumes 带 chapterRange(细纲派生的本卷章节范围);arcs 带 volumeOrder(所属卷)——校验弧的 fromChapter/toChapter 必须落在 volumeOrder 的 chapterRange 内,跨卷即 bug。chapters 仅未写计划(DRAFT/APPROVED,即 upcoming to-do);已写见 writtenCount,单章正文 get_chapter、细纲 get_chapter_plan。写章前调用,定位当前位置与走向。',
      schema: z.object({}),
    },
  );
}
