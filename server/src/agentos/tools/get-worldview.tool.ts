import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { WorldEntryService } from '../../novel/world-entry.service';

/**
 * main + writer 的「列出世界观条目」工具(只读)。userId/novelId 闭包注入。
 * 可按 type 过滤。供 main 规划、writer 写前查相关设定。
 */
export function makeGetWorldviewTool({
  userId,
  novelId,
  world,
}: {
  userId: string;
  novelId: string;
  world: WorldEntryService;
}) {
  return tool(
    async ({ type }) => {
      const entries = await world.listEntries(userId, novelId, type);
      return { entries };
    },
    {
      name: 'get_worldview',
      description:
        '列出世界观条目(可按 type 过滤:concept/powerSystem/location/faction/race/rule/item/history)。写涉及具体设定前调用核实。',
      schema: z.object({
        type: z
          .enum([
            'concept',
            'powerSystem',
            'location',
            'faction',
            'race',
            'rule',
            'item',
            'history',
          ])
          .optional()
          .describe('可选:只列某类型;省略列全部'),
      }),
    },
  );
}
