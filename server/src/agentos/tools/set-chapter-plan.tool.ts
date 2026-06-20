import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { OutlineService } from '../../novel/outline.service';

/** 细纲节点统一形状:主体 | 动作/变化 | 对象/结果。 */
const nodeSchema = z.object({
  subject: z.string().describe('主体(谁/什么)'),
  action: z.string().describe('动作/变化'),
  target: z.string().describe('对象/结果'),
});

/**
 * main agent 的「创建/更新第 N 章细纲」工具。userId/novelId 闭包注入。
 * 写章前规划:产出 CBN(开篇)+ CPNs(情节)+ CEN(结尾)节点 + 必须覆盖/禁区。
 * volumeOrder 会被解析成 volumeId(把本章挂到某卷)。
 */
export function makeSetChapterPlanTool({
  userId,
  novelId,
  outlines,
}: {
  userId: string;
  novelId: string;
  outlines: OutlineService;
}) {
  return tool(
    async ({
      chapterOrder,
      title,
      cbn,
      cpns,
      cen,
      mustCover,
      forbidden,
      volumeOrder,
    }) => {
      let volumeId: string | undefined;
      if (volumeOrder !== undefined) {
        const vol = await outlines.findVolumeByOrder(
          userId,
          novelId,
          volumeOrder,
        );
        if (vol) volumeId = vol.id;
      }
      await outlines.upsertChapterPlan(userId, novelId, chapterOrder, {
        title,
        cbn,
        cpns,
        cen,
        mustCover,
        forbidden,
        volumeId,
      });
      return { ok: true as const, chapterOrder };
    },
    {
      name: 'set_chapter_plan',
      description:
        '创建或更新第 chapterOrder 章的细纲(结构化节点:开篇 CBN + 情节 CPNs + 结尾 CEN + 必须覆盖/禁区)。写该章前规划时调用。',
      schema: z.object({
        chapterOrder: z.number().int().describe('章节序号(1-based)'),
        title: z.string().optional().describe('章标题'),
        cbn: nodeSchema.describe('开篇节点(本章如何开始)'),
        cpns: z
          .array(nodeSchema)
          .min(1)
          .max(6)
          .describe('情节节点(建议 2-4 个,本章主要事件)'),
        cen: nodeSchema.describe('结尾节点(本章如何收尾,承接下一章)'),
        mustCover: z
          .array(z.string())
          .optional()
          .describe('本章必须覆盖的点(≤4)'),
        forbidden: z.array(z.string()).optional().describe('本章禁区(≤5)'),
        volumeOrder: z
          .number()
          .int()
          .optional()
          .describe('所属卷序号(把本章挂到某卷)'),
      }),
    },
  );
}
