import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ArcService } from '../../novel/arc.service';

/** outline-writer 的「删一条弧线」工具。无级联(ChapterOutline 不引用 Arc FK)。 */
export function makeDeleteArcTool({
  userId,
  novelId,
  arcs,
}: {
  userId: string;
  novelId: string;
  arcs: ArcService;
}) {
  return tool(async ({ order }) => arcs.deleteArc(userId, novelId, order), {
    name: 'delete_arc',
    description:
      '删一条弧线(卷内子段)。无级联——ChapterOutline 不引用 Arc,删弧对细纲零影响。',
    schema: z.object({
      order: z.number().int().describe('弧线序号(全书唯一,1-based)'),
    }),
  });
}
