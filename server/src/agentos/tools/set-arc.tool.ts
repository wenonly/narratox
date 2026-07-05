import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { OutlineService } from '../../novel/outline.service';
import type { ArcService } from '../../novel/arc.service';

/**
 * outline-writer 的「建/改弧线」工具(Phase 12)。volumeOrder 经 outlines 解析成 volumeId。
 * userId/novelId 闭包注入。upsert by (novel, order)。
 */
export function makeSetArcTool({
  userId,
  novelId,
  outlines,
  arcs,
}: {
  userId: string;
  novelId: string;
  outlines: OutlineService;
  arcs: ArcService;
}) {
  return tool(
    async ({ order, volumeOrder, title, goal, fromChapter, toChapter }) => {
      let volumeId: string | undefined;
      if (volumeOrder !== undefined) {
        const vol = await outlines.findVolumeByOrder(
          userId,
          novelId,
          volumeOrder,
        );
        if (vol) volumeId = vol.id;
      }
      const arc = await arcs.upsertArc(userId, novelId, {
        order,
        volumeId,
        title,
        goal,
        fromChapter,
        toChapter,
      });
      return { ok: true as const, id: arc.id, order };
    },
    {
      name: 'set_arc',
      description:
        '建/改一条弧线(卷内子段,带 chapter range)。建卷后把每卷切成 2-4 弧。upsert by (novel, order)。铁律:弧线的 fromChapter/toChapter 必须落在 volumeOrder 所指卷的章节范围内,严禁跨卷(若全书 24 章/4 卷,卷1=1-6,则挂卷1 的弧 toChapter≤6)。',
      schema: z.object({
        order: z.number().int().describe('弧线序号(全书唯一,1-based)'),
        volumeOrder: z.number().int().optional().describe('所属卷序号'),
        title: z.string().describe('弧线标题(如「拜师」)'),
        goal: z.string().optional().describe('本弧目标/张力'),
        fromChapter: z
          .number()
          .int()
          .describe('起章(含,必须落在 volumeOrder 所指卷的范围内)'),
        toChapter: z
          .number()
          .int()
          .describe('止章(含,必须落在 volumeOrder 所指卷的范围内,严禁跨卷)'),
      }),
    },
  );
}
