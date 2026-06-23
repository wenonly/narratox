import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { NovelReferenceService } from '../../novel/novel-reference.service';

/**
 * main + writer 子 agent 共用:从本小说已固化的参考资料里按标题/分类取完整内容。
 * 用于取 injectTo 未标注(工具可取)的条目,或重新取某条全文。不读全局 KB。
 * userId/novelId 闭包注入(同其他 novel 工具)。
 */
export function makeGetReferenceTool({
  userId,
  novelId,
  references,
}: {
  userId: string;
  novelId: string;
  references: NovelReferenceService;
}) {
  return tool(
    async ({ title, category }) => {
      const all = await references.listAll(userId, novelId);
      let hit = all;
      if (category) hit = hit.filter((r) => r.category === category);
      if (title) {
        const q = title.toLowerCase();
        hit = hit.filter((r) => r.title.toLowerCase().includes(q));
      }
      return hit.slice(0, 3).map((r) => ({
        id: r.id,
        title: r.title,
        category: r.category,
        injectTo: r.injectTo,
        content: r.content,
      }));
    },
    {
      name: 'get_reference',
      description:
        '从本小说的参考资料里按标题/分类取完整内容(用于 injectTo 未标注、需深挖的条目)。',
      schema: z.object({
        title: z.string().optional().describe('标题模糊匹配'),
        category: z.string().optional().describe('按分类过滤'),
      }),
    },
  );
}
