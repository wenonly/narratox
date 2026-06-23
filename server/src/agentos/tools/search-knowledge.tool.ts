import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { KnowledgeService } from '../../knowledge/knowledge.service';

/**
 * curator 子 agent 专用:搜全局写作知识库,返回最相关条目的完整内容。
 * 全局 KB 是所有用户共享的参考资料(无 user 维度),故不注入 userId/novelId。
 * 仅 curator 在立项时使用;curator 跑完后 main/writer 不再直查全局 KB
 * (改用 get_reference 取本小说已固化的 NovelReference)。
 */
export function makeSearchKnowledgeTool({ kb }: { kb: KnowledgeService }) {
  return tool(
    async ({ query, category }) => {
      const entries = await kb.search(query, {
        category: category || undefined,
        limit: 8,
      });
      const out: Array<{
        id: string;
        title: string;
        category: string;
        content: string;
      }> = [];
      for (const e of entries) {
        const full = await kb.getEntry(e.id);
        out.push({
          id: e.id,
          title: e.name,
          category: e.category,
          content: full?.content ?? '',
        });
      }
      return out;
    },
    {
      name: 'search_knowledge',
      description:
        '搜索全局写作知识库(方法论/拆文案例/词汇/须知/模板/人设)。返回最相关条目的完整内容。立项时为本书挑选参考资料用。',
      schema: z.object({
        query: z
          .string()
          .describe('搜索关键词,如题材名「悬疑」或主题「开头切入」'),
        category: z
          .string()
          .optional()
          .describe(
            '可选分类:方法论教程/拆文案例/词汇素材库/创作须知/公式模板/人设档案',
          ),
      }),
    },
  );
}
