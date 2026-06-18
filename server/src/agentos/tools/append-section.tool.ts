import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ChapterService } from '../../novel/chapter.service';
import type { NovelService } from '../../novel/novel.service';

/**
 * Writer 的「追加一节」工具。content 是一小节(~300-800 字),不是整章 —— 避免
 * 大工具参数触发 z.ai 60s 掐流(spike 证实)。userId/novelId 闭包注入。
 * 首次落内容时 novels.activate(CONCEPT→ACTIVE),与原 write_chapter 一致。
 */
export function makeAppendSectionTool({
  userId,
  novelId,
  chapters,
  novels,
}: {
  userId: string;
  novelId: string;
  chapters: ChapterService;
  novels: NovelService;
}) {
  return tool(
    async ({ chapterOrder, content }) => {
      await chapters.appendSection(userId, novelId, chapterOrder, content);
      await novels.activate(userId, novelId); // 幂等:CONCEPT→ACTIVE
      const ch = await chapters.findByOrder(userId, novelId, chapterOrder);
      return {
        ok: true,
        chapterOrder,
        chars: content.length,
        totalChars: (ch?.content ?? '').length,
      };
    },
    {
      name: 'append_section',
      description:
        '向第 chapterOrder 章末尾追加【一小节】正文(约300-800字)。一章通过多次 append_section 拼成。不要一次写整章。章节不存在会自动创建。',
      schema: z.object({
        chapterOrder: z.number().int().describe('章节序号(1-based)'),
        content: z.string().describe('这一小节的正文(约300-800字,不要整章)'),
      }),
    },
  );
}
