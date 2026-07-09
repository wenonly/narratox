import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { OutlineService } from '../../novel/outline.service';

/** outline-writer 的「删一卷」工具。cascade 默认 false;true 时事务连删下属。 */
export function makeDeleteVolumeTool({
  userId,
  novelId,
  outlines,
}: {
  userId: string;
  novelId: string;
  outlines: OutlineService;
}) {
  return tool(
    async ({ order, cascade }) => {
      return outlines.deleteVolume(userId, novelId, order, cascade ?? false);
    },
    {
      name: 'delete_volume',
      description:
        '删一卷。cascade 默认 false:若卷下有弧/细纲 → 返回 HAS_DESCENDANTS 清单(请先处理它们,或传 cascade=true)。cascade=true:一次性事务连删卷+下属弧+细纲。删卷前必须问作者:只删卷本体(需先移走下属)还是连下属一起删。',
      schema: z.object({
        order: z.number().int().describe('卷序号(1-based)'),
        cascade: z
          .boolean()
          .optional()
          .describe('true=连删下属弧/细纲;false(默认)=有下属时报错'),
      }),
    },
  );
}
