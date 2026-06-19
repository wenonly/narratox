import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ChapterService } from '../../novel/chapter.service';

/** Writer 的「查找替换」工具(SEARCH/REPLACE 式)。userId/novelId 闭包注入。 */
export function makeReplaceTextTool({
  userId,
  novelId,
  chapters,
}: {
  userId: string;
  novelId: string;
  chapters: ChapterService;
}) {
  return tool(
    async ({ chapterOrder, find, replace }) =>
      chapters.replaceText(userId, novelId, chapterOrder, find, replace),
    {
      name: 'replace_text',
      description:
        '在第 chapterOrder 章里找到 find 原文(逐字引用,先 get_chapter 看原文),替换为 replace(改第一处)。用于修订已写正文。引用要够独特(避免多处匹配);一次改一小段。空格/换行小差异可容忍。',
      schema: z.object({
        chapterOrder: z.number().int().describe('章节序号(1-based)'),
        find: z
          .string()
          .describe('要替换的原文片段(逐字引用自 get_chapter,够独特)'),
        replace: z.string().describe('替换成的新内容(一小段)'),
      }),
    },
  );
}
