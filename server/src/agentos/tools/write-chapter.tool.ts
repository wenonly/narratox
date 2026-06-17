import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ResourceRegistry } from '../../resources/resource-registry';

/**
 * 写作 Agent 的写章节工具。走 Phase 1 mutation 层(ChapterHandler 按 userId 隔离)。
 * append=追加到本章末尾(接着写);set=重写本章。
 */
export function makeWriteChapterTool({
  userId,
  registry,
}: {
  userId: string;
  registry: ResourceRegistry;
}) {
  return tool(
    async ({ chapterId, op, content }) => {
      await registry.dispatch(userId, {
        resource: 'chapter',
        targetId: chapterId,
        op,
        content,
      });
      return {
        ok: true,
        message: `已${op === 'append' ? '追加到' : '重写'}章节 ${chapterId}。`,
      };
    },
    {
      name: 'write_chapter',
      description:
        '把小说正文写入指定章节。op="append" 追加到本章末尾(接着写);op="set" 重写整章。生成正文后应主动调用,不要只把正文贴在聊天里。',
      schema: z.object({
        chapterId: z.string().describe('目标章节 id'),
        op: z.enum(['append', 'set']).describe('append=追加,set=重写'),
        content: z.string().describe('要写入的正文'),
      }),
    },
  );
}
