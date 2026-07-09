import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { OutlineService } from '../../novel/outline.service';

/** outline-writer 的「删第 N 章细纲」工具。userId/novelId 闭包注入。WRITTEN 软护栏。 */
export function makeDeleteChapterPlanTool({
  userId,
  novelId,
  outlines,
}: {
  userId: string;
  novelId: string;
  outlines: OutlineService;
}) {
  return tool(
    async ({ chapterOrder }) => {
      return outlines.deleteChapterPlan(userId, novelId, chapterOrder);
    },
    {
      name: 'delete_chapter_plan',
      description:
        '删第 chapterOrder 章细纲。若该章已写(WRITTEN),返回 warned=true(代码不拦,但删前必须先问作者确认——会失去 validator dim12「细纲兑现」审计依据)。删后该章将无法写章(关卡 assertHasPlan 会拦),需重新 set_chapter_plan 才能写。',
      schema: z.object({
        chapterOrder: z.number().int().describe('章节序号(1-based)'),
      }),
    },
  );
}
