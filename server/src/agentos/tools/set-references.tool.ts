import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { NovelReferenceService } from '../../novel/novel-reference.service';

/**
 * curator 子 agent 专用:批量覆写本小说的参考资料(先清后写,可重跑幂等)。
 * userId/novelId 闭包注入(同其他 novel 工具),模型无法越权写其他小说。
 * 每条 entry 必须标 injectTo,决定写作全程该条注入哪个 agent 的 context。
 */
export function makeSetReferencesTool({
  userId,
  novelId,
  references,
}: {
  userId: string;
  novelId: string;
  references: NovelReferenceService;
}) {
  return tool(
    async ({ entries }) => {
      const res = await references.replaceAll(
        userId,
        novelId,
        entries.map((e) => ({
          title: e.title,
          category: e.category,
          content: e.content,
          injectTo: e.injectTo ?? null,
          source: e.source ?? null,
        })),
      );
      return {
        ok: true as const,
        count: (res as { count?: number }).count ?? entries.length,
      };
    },
    {
      name: 'set_references',
      description:
        '批量覆写本小说的参考资料(先清后写,可重跑)。每条需指定 injectTo: 填目标 agent 角色名(如 main/writer/validator/char-writer…)=该条自动进该 agent 上下文; 不填=仅工具可取(库原始资料,按需 get_reference 拉)。务必去重、删冗余、留本书所需。',
      schema: z.object({
        entries: z.array(
          z.object({
            title: z.string(),
            category: z.string().optional(),
            content: z.string().describe('提炼后的正文(markdown),精简去冗余'),
            injectTo: z
              .string()
              .optional()
              .describe(
                '目标 agent 角色名(main/writer/validator/char-writer…);不填=仅工具可取',
              ),
            source: z.string().optional().describe('来源全局KB条目id,逗号分隔'),
          }),
        ),
      }),
    },
  );
}
