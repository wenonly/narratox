import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { NovelReferenceService } from '../../novel/novel-reference.service';

/**
 * curator + main:新增一条本小说参考资料。title 在本小说内必须唯一(冲突报错)。
 * userId/novelId 闭包注入(同其他 novel 工具),模型无法越权写其他小说。
 */
export function makeAddReferenceTool({
  userId,
  novelId,
  references,
}: {
  userId: string;
  novelId: string;
  references: NovelReferenceService;
}) {
  return tool(
    async ({ title, content, category, injectTo }) => {
      const out = await references.create(userId, novelId, {
        title,
        content,
        category,
        injectTo: injectTo ?? null,
      });
      return { id: out.id, title: out.title };
    },
    {
      name: 'add_reference',
      description:
        '新增一条本小说参考资料。title 必须在本小说内唯一(冲突会报错)。injectTo 留空=仅工具可取(库原始资料);填角色名(如 main/writer/validator)=自动注入该 agent。',
      schema: z.object({
        title: z.string().describe('标题,本小说内唯一'),
        content: z.string().describe('正文(markdown)'),
        category: z.string().optional().describe('分类,如「世界观」「词汇」'),
        injectTo: z
          .string()
          .nullish()
          .describe('目标 agent 角色名;留空/null=仅工具可取,填角色名=自动注入'),
      }),
    },
  );
}
