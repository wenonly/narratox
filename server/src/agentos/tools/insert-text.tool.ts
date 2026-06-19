import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ChapterService } from '../../novel/chapter.service';

/** Writer 的「锚点后插入」工具。after="" 插在最前。userId/novelId 闭包注入。 */
export function makeInsertTextTool({
  userId,
  novelId,
  chapters,
}: {
  userId: string;
  novelId: string;
  chapters: ChapterService;
}) {
  return tool(
    async ({ chapterOrder, after, content }) =>
      chapters.insertText(userId, novelId, chapterOrder, after, content),
    {
      name: 'insert_text',
      description:
        '在第 chapterOrder 章的 after 原文【之后】插入 content(after="" 表示插在最前)。先 get_chapter 看原文,逐字引用 after 作锚点。一次插一小段。',
      schema: z.object({
        chapterOrder: z.number().int().describe('章节序号(1-based)'),
        after: z
          .string()
          .describe('锚点原文(逐字引用自 get_chapter);空串表示插到本章最前'),
        content: z.string().describe('要插入的新内容(一小段)'),
      }),
    },
  );
}
