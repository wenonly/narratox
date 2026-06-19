import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ChapterService } from '../../novel/chapter.service';

/** Writer 的「改章节标题」工具。userId/novelId 闭包注入。 */
export function makeSetChapterTitleTool({
  userId,
  novelId,
  chapters,
}: {
  userId: string;
  novelId: string;
  chapters: ChapterService;
}) {
  return tool(
    async ({ chapterOrder, title }) =>
      chapters.setChapterTitle(userId, novelId, chapterOrder, title),
    {
      name: 'set_chapter_title',
      description: '修改第 chapterOrder 章的标题。',
      schema: z.object({
        chapterOrder: z.number().int().describe('章节序号(1-based)'),
        title: z.string().describe('新标题'),
      }),
    },
  );
}
