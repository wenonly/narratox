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
    async ({ category, tag, keyword }) => {
      const { entries } = await kb.list({
        category,
        tag,
        search: keyword,
      });
      // 仅返回精简索引(不含正文),供 agent 浏览后挑选。
      // 包成字符串:tool 直接 return 数组会让 ToolMessage.content 变成数组,
      // 部分供应商把数组当成多模态内容块,要求每个元素带 type 字段 → 400
      // "missing field `type`"。返回 JSON 字符串规避。
      const index = entries.map((e) => ({
        id: e.id,
        name: e.name,
        category: e.category,
        tags: e.tags,
        description: e.description,
      }));
      return JSON.stringify(index);
    },
    {
      name: 'list_knowledge',
      description:
        '列出全局写作知识库条目的索引(id/名称/分类/标签/一句话说明),不含正文。已知要哪类就传 category/tag/keyword 过滤减少 token(别盲目拉全量);不传任何过滤返全部。先调它看清有哪些条目,再用 get_knowledge 按 id 取相关条目的全文。',
      schema: z.object({
        category: z
          .enum([
            '人设档案',
            '公式模板',
            '创作须知',
            '拆文案例',
            '词汇素材库',
            '方法论教程',
          ])
          .optional()
          .describe('按分类过滤'),
        tag: z.string().optional().describe('按标签过滤(精确匹配某标签)'),
        keyword: z
          .string()
          .optional()
          .describe('按关键词模糊匹配(命中名称/一句话说明)'),
      }),
    },
  );
}
