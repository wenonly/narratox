import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { NovelReferenceService } from '../../novel/novel-reference.service';

/**
 * curator + main:按 id 删一条参考资料。id 必须属于本 novel(跨租户 404)。
 * userId/novelId 闭包注入(同其他 novel 工具)。
 */
export function makeDeleteReferenceTool({
  userId,
  novelId,
  references,
}: {
  userId: string;
  novelId: string;
  references: NovelReferenceService;
}) {
  return tool(async ({ id }) => references.deleteOne(userId, novelId, id), {
    name: 'delete_reference',
    description:
      '按 id 删一条参考资料。id 从 get_reference 取。删除后不可恢复,慎用。',
    schema: z.object({
      id: z.string().describe('要删除的参考资料 id'),
    }),
  });
}
