import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { KnowledgeService } from '../../knowledge/knowledge.service';

/**
 * curator 子 agent 专用:按 id 批量取知识库条目的**全文**。
 * 先用 list_knowledge 拿到 id,挑出相关条目后调本工具取正文。
 * 全局 KB 所有用户共享,无 user 维度。
 */
export function makeGetKnowledgeTool({ kb }: { kb: KnowledgeService }) {
  return tool(
    async ({ ids }) => {
      const out: Array<{
        id: string;
        name: string;
        category: string;
        content: string;
      }> = [];
      for (const id of ids) {
        const r = await kb.getEntry(id);
        if (r) {
          out.push({
            id,
            name: r.entry.name,
            category: r.entry.category,
            content: r.content,
          });
        }
      }
      return out;
    },
    {
      name: 'get_knowledge',
      description:
        '按 id 批量取知识库条目的全文。先用 list_knowledge 拿到 id,挑出相关条目后传入它们的 id 列表取正文。',
      schema: z.object({
        ids: z
          .array(z.string())
          .describe('要取全文的条目 id 列表(id 来自 list_knowledge)'),
      }),
    },
  );
}
