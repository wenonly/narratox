import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ChapterService } from '../../novel/chapter.service';

/** Writer 的「查找删除」工具。userId/novelId 闭包注入。 */
export function makeDeleteTextTool({
  userId,
  novelId,
  chapters,
}: {
  userId: string;
  novelId: string;
  chapters: ChapterService;
}) {
  return tool(
    async ({ chapterOrder, find }) =>
      chapters.deleteText(userId, novelId, chapterOrder, find),
    {
      name: 'delete_text',
      description:
        '删除第 chapterOrder 章里 find 原文的第一处(逐字引用,先 get_chapter 看原文)。引用要够独特。一次删一小段。',
      schema: z.object({
        chapterOrder: z.number().int().describe('章节序号(1-based)'),
        find: z
          .string()
          .describe('要删除的原文片段(逐字引用自 get_chapter,够独特)'),
      }),
    },
  );
}
