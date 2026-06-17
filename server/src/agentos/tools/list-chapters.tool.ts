import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ChapterService } from '../../novel/chapter.service';

/**
 * 写作 Agent 的只读章节清单工具。按 userId/novelId 闭包隔离,列出全章节的
 * {order,title,status,words},供 writer 在调用 write_chapter 前了解现有章节
 * (序号 / 已写状态)。writer 无法从主 Agent 的 prompt 里习得章节(各 agent
 * system prompt 独立),所以必须自带这个工具。
 *
 * 只读 —— 不走 mutation 层,不改任何状态。
 */
export function makeListChaptersTool({
  userId,
  novelId,
  chapters,
}: {
  userId: string;
  novelId: string;
  chapters: ChapterService;
}) {
  return tool(
    async () => {
      const list = await chapters.list(userId, novelId);
      return {
        chapters: list.map((c) => ({
          order: c.order,
          title: c.title,
          status: c.status,
          words: c.content.length,
        })),
      };
    },
    {
      name: 'list_chapters',
      description:
        '列出这本小说的所有章节(序号/标题/状态/字数)。写正文前调用以了解现有章节。',
      schema: z.object({}),
    },
  );
}
