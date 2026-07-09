import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { NovelReferenceService } from '../../novel/novel-reference.service';

/**
 * curator + main:按 id 字段级 patch 一条参考资料。id 来自 get_reference。
 * 只传要改的字段,其余不动。改 title 时仍受唯一性约束(冲突报错)。
 * userId/novelId 闭包注入(同其他 novel 工具)。
 */
export function makeUpdateReferenceTool({
  userId,
  novelId,
  references,
}: {
  userId: string;
  novelId: string;
  references: NovelReferenceService;
}) {
  return tool(
    async ({ id, title, content, category, injectTo, order }) => {
      const dto: Record<string, unknown> = {};
      if (title !== undefined) dto.title = title;
      if (content !== undefined) dto.content = content;
      if (category !== undefined) dto.category = category;
      if (injectTo !== undefined) dto.injectTo = injectTo;
      if (order !== undefined) dto.order = order;
      const out = await references.update(userId, novelId, id, dto);
      const updatedFields = Object.keys(dto);
      return { id: out.id, title: out.title, updatedFields };
    },
    {
      name: 'update_reference',
      description:
        '按 id 字段级修改一条参考资料(只传要改的字段)。id 从 get_reference 取。改 title 时仍受唯一性约束(冲突报错)。',
      schema: z.object({
        id: z.string().describe('参考资料 id,来自 get_reference 返回'),
        title: z.string().optional(),
        content: z.string().optional(),
        category: z.string().optional(),
        injectTo: z
          .string()
          .nullish()
          .describe('改注入目标角色,或传 null 改为仅工具可取'),
        order: z.number().optional(),
      }),
    },
  );
}
