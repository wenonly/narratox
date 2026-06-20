import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { OutlineService } from '../../novel/outline.service';

/**
 * main + writer 的「查看第 N 章细纲」工具(只读)。userId/novelId 闭包注入。
 * writer 写第 chapterOrder 章前调用,拿到 CBN/CPNs/CEN 节点 + 必须覆盖/禁区,
 * 据此写正文。无细纲返回 ok:false(此时应先 set_chapter_plan)。
 */
export function makeGetChapterPlanTool({
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
      const plan = await outlines.getChapterPlan(userId, novelId, chapterOrder);
      if (!plan) {
        return { ok: false as const, reason: 'no_plan' as const, chapterOrder };
      }
      return { ok: true as const, ...plan };
    },
    {
      name: 'get_chapter_plan',
      description:
        '查看第 chapterOrder 章的细纲节点(开篇 CBN/情节 CPNs/结尾 CEN + 必须覆盖/禁区)。写该章前调用,据此写正文。',
      schema: z.object({
        chapterOrder: z.number().int().describe('章节序号(1-based)'),
      }),
    },
  );
}
