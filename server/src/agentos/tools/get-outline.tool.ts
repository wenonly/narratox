import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { OutlineService } from '../../novel/outline.service';

/**
 * main + writer 的「查看全书大纲」工具(只读)。userId/novelId 闭包注入。
 * 返回卷列表 + 各章细纲标题/状态 + nextChapterOrder(下一个该写的章,用于自定位)。
 * writer 写章前可调它看大局、定位当前章。
 */
export function makeGetOutlineTool({
  userId,
  novelId,
  outlines,
}: {
  userId: string;
  novelId: string;
  outlines: OutlineService;
}) {
  return tool(
    async () => {
      const { volumes, chapterOutlines } = await outlines.listOutline(
        userId,
        novelId,
      );
      const nextChapterOrder = await outlines.nextChapterOrder(userId, novelId);
      return {
        volumes: volumes.map((v) => ({
          order: v.order,
          title: v.title,
          goal: v.goal,
          synopsis: v.synopsis,
        })),
        chapters: chapterOutlines.map((c) => ({
          chapterOrder: c.chapterOrder,
          title: c.title,
          status: c.status,
        })),
        nextChapterOrder,
      };
    },
    {
      name: 'get_outline',
      description:
        '查看全书大纲(卷列表 + 各章细纲标题/状态)+ 下一个该写的章序号。写章前调用,定位当前位置。',
      schema: z.object({}),
    },
  );
}
