import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { OutlineService } from '../../novel/outline.service';

const nodeSchema = z.object({
  subject: z.string(),
  action: z.string(),
  target: z.string(),
});

/** outline-writer 的「字段级改细纲」工具。全 optional:只改传了的字段。 */
export function makePatchChapterPlanTool({
  userId,
  novelId,
  outlines,
}: {
  userId: string;
  novelId: string;
  outlines: OutlineService;
}) {
  return tool(
    async (input) => {
      const { chapterOrder, ...patch } = input;
      return outlines.patchChapterPlan(userId, novelId, chapterOrder, patch);
    },
    {
      name: 'patch_chapter_plan',
      description:
        '字段级改第 chapterOrder 章细纲(只传要改的字段,未传不动)。数组字段(cpns/mustCover/forbidden)整体替换。patch 不是 upsert:章不存在返 not_found(新建走 set_chapter_plan)。改字段优先用 patch(省 token、少出错)。',
      schema: z.object({
        chapterOrder: z.number().int().describe('章节序号(1-based,不可改)'),
        title: z.string().optional().describe('章标题'),
        cbn: nodeSchema.optional().describe('开篇节点(整体替换)'),
        cpns: z
          .array(nodeSchema)
          .min(1)
          .max(6)
          .optional()
          .describe('情节节点数组(整体替换)'),
        cen: nodeSchema.optional().describe('结尾节点(整体替换)'),
        mustCover: z
          .array(z.string())
          .optional()
          .describe('必须覆盖点(整体替换)'),
        forbidden: z.array(z.string()).optional().describe('禁区(整体替换)'),
        volumeOrder: z.number().int().optional().describe('所属卷序号(移卷)'),
      }),
    },
  );
}
