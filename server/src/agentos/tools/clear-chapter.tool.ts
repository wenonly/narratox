import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ChapterService } from '../../novel/chapter.service';

/**
 * Writer 的"清空整章正文"工具。保留章节行与标题,只把 content 清空、status 回 DRAFT。
 * 用于"重写整章":clear_chapter 清空 → append_section 一节节重写(避免整章大 replace)。
 * userId/novelId 闭包注入。
 */
export function makeClearChapterTool({
  userId,
  novelId,
  chapters,
}: {
  userId: string;
  novelId: string;
  chapters: ChapterService;
}) {
  return tool(
    async ({ chapterOrder }) =>
      chapters.clearChapter(userId, novelId, chapterOrder),
    {
      name: 'clear_chapter',
      description:
        '清空第 chapterOrder 章的全部正文(保留章节与标题)。要【重写整章】时用它清空,再用 append_section 一节节重写 —— 不要用 replace_text 整章替换。',
      schema: z.object({
        chapterOrder: z.number().int().describe('章节序号(1-based)'),
      }),
    },
  );
}
