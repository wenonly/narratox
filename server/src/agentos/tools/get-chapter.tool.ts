import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ChapterService } from '../../novel/chapter.service';

/**
 * Writer 的只读「读当前章节正文」工具。改/续写前先 get_chapter 看现状。
 * 返回是输入(ToolMessage 进上下文),不触发 60s(60s 只看模型输出)。
 */
export function makeGetChapterTool({
  userId,
  novelId,
  chapters,
}: {
  userId: string;
  novelId: string;
  chapters: ChapterService;
}) {
  return tool(
    async ({ chapterOrder }) => {
      const ch = await chapters.getChapter(userId, novelId, chapterOrder);
      if (!ch) return { ok: false, reason: 'not_found' as const };
      return {
        ok: true as const,
        chapterOrder: ch.order,
        title: ch.title,
        content: ch.content ?? '',
        chars: (ch.content ?? '').length,
      };
    },
    {
      name: 'get_chapter',
      description:
        '读取第 chapterOrder 章的当前正文(改/续写前先调用看现状)。返回 content 全文。',
      schema: z.object({
        chapterOrder: z.number().int().describe('章节序号(1-based)'),
      }),
    },
  );
}
