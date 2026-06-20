import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ChapterService } from '../../novel/chapter.service';

/**
 * Main agent 的只读「用户正在读哪一章」工具。readingChapterOrder 是 run 开始时
 * 的快照(客户端 currentChapterOrder 经 run body 传入),闭包注入 —— 不从 LLM 输入取,
 * 与 userId/novelId 同等安全。用于解析「这章/这章开头」等指代。
 */
export function makeGetReadingChapterTool({
  userId,
  novelId,
  readingChapterOrder,
  chapters,
}: {
  userId: string;
  novelId: string;
  readingChapterOrder: number | null;
  chapters: ChapterService;
}) {
  return tool(
    async () => {
      if (readingChapterOrder == null) {
        return { ok: false as const, reason: 'no_active_chapter' as const };
      }
      const ch = await chapters.findByOrder(userId, novelId, readingChapterOrder);
      if (!ch) {
        return {
          ok: false as const,
          reason: 'no_such_chapter' as const,
          order: readingChapterOrder,
        };
      }
      return {
        ok: true as const,
        order: ch.order,
        title: ch.title,
        status: ch.status,
      };
    },
    {
      name: 'get_reading_chapter',
      description:
        '返回用户当前正在阅读的章节(本条消息发送时的快照:{order,title,status})。' +
        '当用户说「这章 / 这章开头 / 这里」等指代时,先调用本工具确认 chapterOrder,' +
        '再把该值传给 writer 委派;不要凭猜测假定章节号。无正在阅读的章节时返回 no_active_chapter。',
      schema: z.object({}), // 无参数 —— 值由闭包注入,绝不来自 LLM
    },
  );
}
