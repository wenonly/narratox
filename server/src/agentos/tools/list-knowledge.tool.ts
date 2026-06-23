import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { KnowledgeService } from '../../knowledge/knowledge.service';

/**
 * curator 子 agent 专用:列出全局写作知识库**全部条目的索引**
 * (id/名称/分类/标签/一句话说明),不返回正文。
 * 先调它看清有哪些条目,再用 get_knowledge 按 id 取相关条目的全文。
 * 全局 KB 所有用户共享,无 user 维度。
 */
export function makeListKnowledgeTool({ kb }: { kb: KnowledgeService }) {
  return tool(
    async () => {
      const { entries } = await kb.list({});
      // 仅返回精简索引(不含正文),供 agent 浏览后挑选。
      return entries.map((e) => ({
        id: e.id,
        name: e.name,
        category: e.category,
        tags: e.tags,
        description: e.description,
      }));
    },
    {
      name: 'list_knowledge',
      description:
        '列出全局写作知识库全部条目的索引(id/名称/分类/标签/一句话说明),不含正文。先调它看清有哪些条目,再用 get_knowledge 按 id 取相关条目的全文。',
      schema: z.object({}),
    },
  );
}
