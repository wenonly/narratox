import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ArcService } from '../../novel/arc.service';

/**
 * 只读「列弧线」工具(Phase 12)。userId/novelId 闭包注入。
 * 返回 JSON 字符串(防数组被供应商当多模态块)。定位「当前在哪个弧」用。
 */
export function makeGetArcsTool({
  userId,
  novelId,
  arcs,
}: {
  userId: string;
  novelId: string;
  arcs: ArcService;
}) {
  return tool(
    async () => {
      const list = await arcs.listArcs(userId, novelId);
      return JSON.stringify(list);
    },
    {
      name: 'get_arcs',
      description:
        '列出全书弧线(卷内子段:chapter range + 目标 + 进展摘要)。定位「当前在哪个弧」、规划下游弧线时用。',
      schema: z.object({}),
    },
  );
}
